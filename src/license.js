'use strict';
// Лицензии модулей: отпечаток компьютера, проверка подписи, привратник.
// План — docs/PLAN-MODULES-SPLIT.md (этап 1), основа — docs/MODULES-LICENSING.md.
//
// Формат лицензии: «tpl1.<payload>.<подпись>» (base64url). payload — JSON:
//   { v: 1, kind: 'full'|'trial', pack, edition, fp: [3 хэша или null], key?, iat, exp? }
// Подпись Ed25519 закрытым ключом сервера активации (или владельца — ручная выдача). Тапёр знает только
// открытый ключ и проверяет подпись офлайн. Встроенный crypto Node — без библиотек.
//
// Отпечаток: 3 части (MachineGuid Windows, UUID компьютера, серийник системного диска), каждая — отдельный хэш.
// «Этот компьютер» — если совпали хотя бы 2 части (или все, если в лицензии их меньше двух).
// Наружу (на сервер) уходят только хэши.
//
// Честно: код открыт, проверку можно вырезать. Защищаемся от «скинь ключик», а не от взломщика.

const crypto = require('crypto');
const { execFile } = require('child_process');

const PREFIX = 'tpl1';
const FP_SALT = 'tapyor-fp-v1:';
const DAY = 86400000;
const CLOCK_SLACK = DAY; // часы назад больше чем на сутки — подозрительно

// Открытые ключи проверки лицензий (Ed25519, SPKI DER в base64). Закрытые — только у сервера и владельца.
// Несколько — чтобы можно было сменить ключ: старые лицензии продолжают проверяться.
const LICENSE_PUBKEYS = [
  'MCowBQYDK2VwAyEA/9tdSxNcIxeXPM1QakjeHV02xUnhbVyD4+44EtkwSrw=', // licenses, создан 08.11.2026
];
// Открытые ключи проверки паков модулей (этап 2) — отдельная пара, не та, что у лицензий.
const PACK_PUBKEYS = [
  'MCowBQYDK2VwAyEAAuqz72sH3uOWbNTvTpy8dipwJKOwS/uu99iY+6V1ZXk=', // packs, создан 08.11.2026 (вечер; первый ключ выведен — попал в облако)
];

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---------- отпечаток ----------
const JUNK = /^(|0+|f+|none|null|default string|to be filled by o\.?e\.?m\.?|system serial number|not specified|not applicable|n\/a|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|03000200-0400-0500-0006-000700080009)$/i;
function cleanPart(v) {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ').replace(/^\.+|\.+$/g, '');
  if (JUNK.test(s) || /^[0\-.\s]+$/.test(s) || s.length < 4) return null;
  return s.toUpperCase();
}
function hashPart(v) { const c = cleanPart(v); return c ? crypto.createHash('sha256').update(FP_SALT + c).digest('hex').slice(0, 32) : null; }
// raw: { machineGuid, uuid, disk } → [h1, h2, h3]
function fpFromRaw(raw) { return [hashPart(raw && raw.machineGuid), hashPart(raw && raw.uuid), hashPart(raw && raw.disk)]; }

// Одна команда PowerShell → JSON с тремя значениями. Ошибка любой части — null, остальные читаются.
const PS = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$g=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid",
  "$u=(Get-CimInstance Win32_ComputerSystemProduct).UUID",
  "$d=$null; try { $n=(Get-Partition -DriveLetter ($env:SystemDrive.Substring(0,1)) | Select-Object -First 1).DiskNumber; $d=(Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq $n } | Select-Object -First 1).SerialNumber } catch {}",
  "if (-not $d) { $d=(Get-CimInstance Win32_DiskDrive | Sort-Object Index | Select-Object -First 1).SerialNumber }",
  "[pscustomobject]@{ machineGuid=\"$g\"; uuid=\"$u\"; disk=\"$d\" } | ConvertTo-Json -Compress",
].join('; ');
let fpCache = null;
function readRawWindows(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(null); return; }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS],
      { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        if (err) { resolve(null); return; }
        try { resolve(JSON.parse(String(stdout || '').trim())); } catch (e) { resolve(null); }
      });
  });
}
// o.read — подмена чтения (тесты); результат кэшируется на время работы Тапёра
async function fingerprint(o = {}) {
  if (fpCache && !o.fresh) return fpCache;
  const raw = await (o.read || readRawWindows)();
  const parts = fpFromRaw(raw || {});
  fpCache = { parts, ok: parts.filter(Boolean).length >= 2 };
  return fpCache;
}
function fpMatch(licFp, myFp) {
  const a = Array.isArray(licFp) ? licFp : [], b = Array.isArray(myFp) ? myFp : [];
  const have = a.filter(Boolean).length;
  if (!have) return false;
  let same = 0;
  for (let i = 0; i < 3; i++) if (a[i] && b[i] && a[i] === b[i]) same++;
  return same >= Math.min(2, have);
}
// Короткий код компьютера для экрана и ручной выдачи (не секрет)
function fpCode(parts) { return (parts || []).map((p) => (p ? p.slice(0, 8) : '--------')).join('-'); }

// ---------- формат и подпись ----------
function sign(payload, privateKeyPem) {
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = crypto.sign(null, Buffer.from(PREFIX + '.' + body), crypto.createPrivateKey(privateKeyPem));
  return PREFIX + '.' + body + '.' + b64u(sig);
}
function pubKeyObj(k) {
  if (k && typeof k === 'object' && k.type === 'public') return k;
  const s = String(k || '');
  if (s.includes('BEGIN')) return crypto.createPublicKey(s);
  return crypto.createPublicKey({ key: Buffer.from(s, 'base64'), format: 'der', type: 'spki' });
}
// Возвращает payload, если подпись верна хоть одним из ключей, иначе null
function verify(token, pubkeys = LICENSE_PUBKEYS) {
  const p = String(token || '').trim().split('.');
  if (p.length !== 3 || p[0] !== PREFIX) return null;
  let sig; try { sig = unb64u(p[2]); } catch (e) { return null; }
  const data = Buffer.from(p[0] + '.' + p[1]);
  for (const k of pubkeys) {
    try { if (crypto.verify(null, data, pubKeyObj(k), sig)) { const j = JSON.parse(unb64u(p[1]).toString('utf8')); return j && j.v === 1 ? j : null; } } catch (e) {}
  }
  return null;
}

// ---------- защита часов ----------
// store: { get(k), set(k, v) }. Помним самую позднюю виденную дату; если сейчас заметно раньше — часы перевели назад.
// M3 (аудит 0.32.0): одна запись в settings.json правится руками. Поэтому extra — самая поздняя дата из других мест,
// которые собирает modhost: файл в папке данных, реестр HKCU, время выдачи лицензий (iat — часы сервера),
// время сервера из заголовка Date. Действует самая поздняя из всех (docs/MODULES-LICENSING.md).
function clockCheck(store, now = Date.now(), extra = 0) {
  const seen = Math.max(Number(store.get('licClockMax')) || 0, Number(extra) || 0);
  if (seen && now < seen - CLOCK_SLACK) return { ok: false, seen };
  if (now > (Number(store.get('licClockMax')) || 0)) store.set('licClockMax', Math.max(now, Number(store.get('licClockMax')) || 0));
  return { ok: true, seen: Math.max(seen, now) };
}
// Самое позднее время выдачи среди подписанных лицензий (их iat ставит сервер — подделать нельзя)
function latestIat(tokens, pubkeys = LICENSE_PUBKEYS) {
  let m = 0;
  for (const t of tokens || []) { const j = verify(t, pubkeys); if (j && Number(j.iat) > m) m = Number(j.iat); }
  return m;
}

// ---------- привратник ----------
// tokens — лицензии этого пака (полная и/или триал), fp — отпечаток этого компьютера.
// Возвращает: { enabled, state: 'full'|'trial'|'trial-ended'|'none'|'other-pc'|'clock', edition, daysLeft, exp }
function gate({ tokens = [], pack, fp, sinceEdition = 1, now = Date.now(), clockOk = true, pubkeys = LICENSE_PUBKEYS }) {
  let best = { enabled: false, state: 'none', edition: 0 };
  let otherPc = false, trialEnded = null;
  for (const t of tokens) {
    const j = verify(t, pubkeys);
    if (!j || j.pack !== pack) continue;
    if (!fpMatch(j.fp, fp)) { otherPc = true; continue; }
    const edition = Number(j.edition) || 0;
    if (j.kind === 'full' && !j.exp) {
      if (edition >= sinceEdition) return { enabled: true, state: 'full', edition, key: j.key || null };
      best = { enabled: false, state: 'edition', edition };
      continue;
    }
    if (j.kind === 'trial' || j.exp) {
      const exp = Number(j.exp) || 0;
      if (!clockOk) { trialEnded = { enabled: false, state: 'clock', edition, exp }; continue; }
      if (exp > now && edition >= sinceEdition) {
        const daysLeft = Math.max(1, Math.ceil((exp - now) / DAY));
        if (!best.enabled) best = { enabled: true, state: 'trial', edition, daysLeft, exp };
      } else trialEnded = { enabled: false, state: 'trial-ended', edition, daysLeft: 0, exp };
    }
  }
  if (best.enabled) return best;
  if (trialEnded) return trialEnded;
  if (otherPc && best.state === 'none') return { enabled: false, state: 'other-pc', edition: 0 };
  return best;
}

module.exports = { fingerprint, fpFromRaw, fpMatch, fpCode, hashPart, sign, verify, gate, clockCheck, latestIat, CLOCK_SLACK, LICENSE_PUBKEYS, PACK_PUBKEYS, PREFIX, _resetFp: () => { fpCache = null; } };
