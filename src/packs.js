'use strict';
// Паки модулей отдельно от Тапёра (docs/PLAN-MODULES-SPLIT.md, этап 2).
//
// Файл пака «.tpack» — JSON:
//   { format: 1, manifest: "<текст manifest.json>", sha256: "<hex от payload>", payload: "<base64: gzip(JSON {путь: base64})>",
//     sig: "<base64url подпись Ed25519 над 'tpack1\n' + manifest + '\n' + sha256>" }
// Пак — только JS/HTML/CSS (без node_modules), поэтому распаковщик zip не нужен.
// Подпись проверяется ДО записи на диск; ключ — отдельная пара «packs» (не та, что у лицензий).
//
// На диске (папка данных): modules/<id>/<версия>/… и modules/<id>/current.json { version, prev }.
// Обновление ставит новую версию рядом и переключает указатель; прошлая остаётся для отката.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MAX_PACK = 20 * 1024 * 1024; // файл пака
const MAX_FILES = 2000;
const ID_RX = /^[a-z0-9][a-z0-9-]{1,40}$/;
const VER_RX = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/;
// M6: подписанный файл пака хранится рядом с установленной версией. По нему при каждом запуске
// заново проверяются подпись и хеши файлов — папка данных пользователя writable, и без этого
// подменённый code модуля исполнялся бы в главном процессе.
const SIG_NAME = 'signature.json';
const BROKEN = 'пак повреждён — переустановите';

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function verCmp(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; }
const signed = (manifestText, sha) => Buffer.from('tpack1\n' + manifestText + '\n' + sha, 'utf8');
function pub(k) {
  const s = String(k || '');
  return s.includes('BEGIN') ? crypto.createPublicKey(s) : crypto.createPublicKey({ key: Buffer.from(s, 'base64'), format: 'der', type: 'spki' });
}
function safeRel(p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').some((x) => x === '..' || x === '' || x === '.')) return null;
  if (s.length > 200 || !/^[\w.\-/ ]+$/.test(s)) return null;
  return s;
}

// ---------- сборка (инструмент владельца) ----------
// dir — папка пака (manifest.json внутри); skip(relPath) — что не класть (тесты)
function build(dir, privateKeyPem, o = {}) {
  const skip = o.skip || ((rel) => /(^|\/)tests\//.test(rel) || /(^|\/)\./.test(rel));
  const files = {};
  (function walk(d, rel) {
    for (const f of fs.readdirSync(d).sort()) {
      const full = path.join(d, f), r = rel ? rel + '/' + f : f;
      if (skip(r)) continue;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else files[r] = fs.readFileSync(full).toString('base64');
    }
  })(dir, '');
  const manifestText = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, '');
  const payload = zlib.gzipSync(Buffer.from(JSON.stringify(files), 'utf8'), { level: 9 });
  const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
  const sig = b64u(crypto.sign(null, signed(manifestText, sha256), crypto.createPrivateKey(privateKeyPem)));
  return Buffer.from(JSON.stringify({ format: 1, manifest: manifestText, sha256, payload: payload.toString('base64'), sig }), 'utf8');
}

// ---------- проверка ----------
// Возвращает { ok, manifest, files: {путь: Buffer} } или { ok:false, error }
// expectId — необязательный ожидаемый id пака (L12): подписанный пак другого модуля ставить нельзя.
function inspect(buf, pubkeys, coreVersion, expectId) {
  try {
    if (!buf || buf.length > MAX_PACK) return { ok: false, error: 'файл пака слишком большой или пустой' };
    let j; try { j = JSON.parse(Buffer.from(buf).toString('utf8')); } catch (e) { return { ok: false, error: 'это не файл пака' }; }
    if (!j || j.format !== 1 || typeof j.manifest !== 'string' || typeof j.payload !== 'string') return { ok: false, error: 'неизвестный формат пака' };
    const payload = Buffer.from(j.payload, 'base64');
    const sha = crypto.createHash('sha256').update(payload).digest('hex');
    if (sha !== j.sha256) return { ok: false, error: 'файл пака повреждён' };
    const good = (pubkeys || []).some((k) => { try { return crypto.verify(null, signed(j.manifest, sha), pub(k), unb64u(j.sig)); } catch (e) { return false; } });
    if (!good) return { ok: false, error: 'подпись пака не прошла проверку — пак не от автора Тапёра' };
    let manifest; try { manifest = JSON.parse(j.manifest); } catch (e) { return { ok: false, error: 'манифест пака повреждён' }; }
    if (!manifest || !ID_RX.test(String(manifest.id)) || !VER_RX.test(String(manifest.version))) return { ok: false, error: 'в манифесте нет имени или версии' };
    // L12 (аудит 0.32.0): ядро ждёт только свой пак. Подписанный, но чужой по id пак иначе лёг бы мёртвым грузом.
    if (expectId && String(manifest.id) !== String(expectId)) return { ok: false, error: 'это пак другого модуля' };
    if (coreVersion && manifest.minCore && verCmp(coreVersion, manifest.minCore) < 0) return { ok: false, error: 'нужен Тапёр ' + manifest.minCore + ' или новее', needCore: manifest.minCore, manifest };
    const raw = JSON.parse(zlib.gunzipSync(payload, { maxOutputLength: 100 * 1024 * 1024 }).toString('utf8'));
    const files = {};
    const names = Object.keys(raw || {});
    if (names.length > MAX_FILES) return { ok: false, error: 'в паке слишком много файлов' };
    for (const n of names) { const r = safeRel(n); if (!r) return { ok: false, error: 'в паке недопустимый путь: ' + String(n).slice(0, 60) }; files[r] = Buffer.from(String(raw[n]), 'base64'); }
    if (!files['manifest.json']) return { ok: false, error: 'в паке нет manifest.json' };
    for (const m of manifest.modules || []) { const r = safeRel(m.main); if (!r || !files[r]) return { ok: false, error: 'модуль ' + (m.id || '?') + ': нет файла ' + String(m.main) }; }
    return { ok: true, manifest, files };
  } catch (e) { return { ok: false, error: 'не удалось прочитать пак: ' + (e && e.message || e) }; }
}

// ---------- установка ----------
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function writeJsonAtomic(f, obj) { fs.writeFileSync(f + '.tmp', JSON.stringify(obj, null, 2)); fs.renameSync(f + '.tmp', f); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }

function current(root, id) {
  const c = readJson(path.join(root, id, 'current.json'));
  if (!c || !VER_RX.test(String(c.version))) return null;
  const dir = path.join(root, id, c.version);
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest || manifest.version !== c.version) return null;
  return { dir, manifest, version: c.version, prev: c.prev || null };
}

// M6: проверка УСТАНОВЛЕННОЙ версии — при каждом запуске, а не только при установке.
// Читаем сохранённый подписанный файл пака (signature.json), заново проверяем подпись тем же
// inspect() и сверяем хеши каждого файла на диске с подписанным содержимым. Так подмена файла
// модуля или манифеста в папке данных не проходит: модули не запускаются.
// { ok:true, dir, manifest, version, prev } | { ok:false, error:'пак повреждён — переустановите' } |
// { ok:false, notInstalled:true } — если пака действительно нет.
function verifyInstalled(root, id, pubkeys) {
  const cur = current(root, id);
  if (!cur) {
    const cj = readJson(path.join(root, id, 'current.json'));
    return cj ? { ok: false, error: BROKEN } : { ok: false, notInstalled: true };
  }
  let buf;
  try { buf = fs.readFileSync(path.join(cur.dir, SIG_NAME)); }
  catch (e) {
    // Пак поставлен версией Тапёра до проверки при запуске (до 0.36): signature.json тогда не сохранялся.
    // Считать такой пак повреждённым нельзя — у всех, кто уже поставил пак, после обновления молча встали бы
    // бот и оверлей (приёмка B10, 13.11). Пускаем как раньше, но с пометкой legacy: окно попросит
    // переустановить пак, после переустановки или обновления пака проверка станет полной.
    if (e && e.code === 'ENOENT' && cur.manifest) return { ok: true, legacy: true, dir: cur.dir, manifest: cur.manifest, version: cur.version, prev: cur.prev };
    return { ok: false, error: BROKEN };
  }
  const r = inspect(buf, pubkeys); // без coreVersion: совместимость с ядром проверяется отдельно
  if (!r.ok || !r.manifest) return { ok: false, error: BROKEN };
  if (r.manifest.id !== id || r.manifest.version !== cur.version) return { ok: false, error: BROKEN };
  for (const rel of Object.keys(r.files)) {
    let got;
    try { got = fs.readFileSync(path.join(cur.dir, ...rel.split('/'))); } catch (e) { return { ok: false, error: BROKEN }; }
    const want = crypto.createHash('sha256').update(r.files[rel]).digest('hex');
    const have = crypto.createHash('sha256').update(got).digest('hex');
    if (want !== have) return { ok: false, error: BROKEN };
  }
  return { ok: true, dir: cur.dir, manifest: r.manifest, version: cur.version, prev: cur.prev };
}


// buf — файл пака; o: { root, pubkeys, coreVersion, expectId, keep } → { ok, manifest, dir, from } | { ok:false, error }
function install(buf, o) {
  const r = inspect(buf, o.pubkeys, o.coreVersion, o.expectId);
  if (!r.ok) return r;
  const id = r.manifest.id, ver = r.manifest.version;
  if (r.files[SIG_NAME]) return { ok: false, error: 'в паке зарезервированное имя: ' + SIG_NAME };
  const base = path.join(o.root, id);
  fs.mkdirSync(base, { recursive: true });
  const cur = current(o.root, id);
  // L6: обычная установка не понижает версию. Понижение — только явной кнопкой «Откатить»
  // (packs.rollback). Иначе индекс паков или подменённый packsIndexUrl мог бы тихо поставить
  // старую подписанную версию поверх новой — со старыми ошибками.
  if (cur && verCmp(ver, cur.version) < 0) {
    return { ok: false, error: 'эта версия пака старше установленной (' + cur.version + '): понижение — только кнопкой «Откатить»' };
  }
  const dest = path.join(base, ver);
  const tmp = dest + '.tmp-' + process.pid + '-' + Date.now();
  rmrf(tmp);
  for (const [rel, data] of Object.entries(r.files)) {
    const f = path.join(tmp, ...rel.split('/'));
    if (!path.resolve(f).startsWith(path.resolve(tmp) + path.sep)) { rmrf(tmp); return { ok: false, error: 'недопустимый путь в паке' }; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  }
  // M6: кладём рядом исходный подписанный файл пака — по нему проверяем версию при каждом запуске
  fs.writeFileSync(path.join(tmp, SIG_NAME), Buffer.from(buf));
  const same = !!(cur && cur.version === ver); // та же версия — переустановка (починка), прошлая остаётся прошлой
  rmrf(dest);
  fs.renameSync(tmp, dest);
  writeJsonAtomic(path.join(base, 'current.json'), { version: ver, prev: same ? cur.prev : (cur ? cur.version : null), at: Date.now() });
  // храним текущую и одну прошлую; остальное — убрать
  const keep = new Set([ver, same ? cur.prev : (cur && cur.version)].filter(Boolean));
  for (const f of fs.readdirSync(base)) if (VER_RX.test(f) && !keep.has(f)) rmrf(path.join(base, f));
  return { ok: true, manifest: r.manifest, dir: dest, from: cur ? cur.version : null, same };
}

function rollback(root, id) {
  const cur = current(root, id);
  if (!cur || !cur.prev) return { ok: false, error: 'прошлой версии нет' };
  const pm = readJson(path.join(root, id, cur.prev, 'manifest.json'));
  if (!pm) return { ok: false, error: 'прошлая версия повреждена' };
  writeJsonAtomic(path.join(root, id, 'current.json'), { version: cur.prev, prev: cur.version, at: Date.now() });
  return { ok: true, version: cur.prev };
}

function remove(root, id) {
  if (!ID_RX.test(String(id))) return { ok: false, error: 'неверное имя пака' };
  rmrf(path.join(root, id));
  return { ok: true };
}

// Список паков packs.json (tapyor-web): { packs: [{ id, name, version, minCore, url, size, about }] }
function parseIndex(text) {
  const j = JSON.parse(String(text));
  return ((j && j.packs) || []).filter((p) => p && ID_RX.test(String(p.id)) && VER_RX.test(String(p.version)) && /^https:\/\//.test(String(p.url || '')));
}

module.exports = { build, inspect, install, current, verifyInstalled, rollback, remove, parseIndex, verCmp, safeRel, SIG_NAME, BROKEN };
