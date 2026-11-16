'use strict';
// Логика сервера активации Тапёра (без облака и базы — их подставляют снаружи, поэтому её можно тестировать).
// docs/PLAN-MODULES-SPLIT.md, этап 4. Формат лицензии — src/license.js в Тапёре.
//
// Действия:
//   trial      { pack, fp }        → пробная лицензия на 30 дней; один триал на компьютер (совпадение 2 из 3 частей)
//   activate   { pack, fp, key }   → полная лицензия; на ключ не больше MAX_PCS компьютеров
//   deactivate { pack, fp, key }   → освободить место этого компьютера на ключе
//   admin-keys { token, hashes, edition, note }   → загрузить хэши новых ключей (только владелец)
//   admin-revoke { token, hash }                  → отозвать ключ
//   admin-unrevoke { token, hash }                → вернуть отозванный ключ (отозвал по ошибке)
//   admin-list   { token }                        → все ключи: статус, редакция, компьютеры (время, код компьютера)
//   admin-release { token, hash, mid }            → освободить место компьютера на ключе (покупатель сменил ПК)
// В базе нет ни ключей, ни серийников — только хэши.
const crypto = require('crypto');

const TRIAL_DAYS = 30;
const DAY = 86400000;
const MAX_PCS = 3;
const RATE_PER_HOUR = 10;      // с одного компьютера (по отпечатку)
const RATE_PER_IP_HOUR = 30;   // с одного адреса (M1: отпечаток присылает сам клиент — его можно менять, адрес — нет)
const ADMIN_PER_HOUR = 20;     // попыток админки в час всего, с любых адресов (M1)
const ADMIN_PER_IP_HOUR = 10;  // L3: попыток админки в час с одного адреса (чтобы не подбирали пароль)
const PACKS = new Set(['streamer-pack']);
const HEX32 = /^[0-9a-f]{32}$/;
const ADMIN_ACTIONS = new Set(['admin-keys', 'admin-revoke', 'admin-unrevoke', 'admin-list', 'admin-release']);
// Код компьютера — как его показывает Тапёр (src/license.js fpCode): по 8 знаков от каждой части отпечатка
const fpCode = (fp) => (fp || []).map((p) => (p ? String(p).slice(0, 8) : '--------')).join('-');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function sign(payload, pem) {
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  return 'tpl1.' + body + '.' + b64u(crypto.sign(null, Buffer.from('tpl1.' + body), crypto.createPrivateKey(pem)));
}
function normKey(k) {
  const s = String(k || '').toUpperCase().replace(/[\s_]+/g, '').replace(/[ОO]/g, '0').replace(/[IІL]/g, '1');
  const body = s.replace(/^TPR-?/, '').replace(/-/g, '');
  if (!/^[0-9A-Z]{12}$/.test(body)) return null;
  return 'TPR-' + body.slice(0, 4) + '-' + body.slice(4, 8) + '-' + body.slice(8, 12);
}
const keyHash = (k) => crypto.createHash('sha256').update('tapyor-key-v1:' + k).digest('hex');
function cleanFp(fp) {
  if (!Array.isArray(fp) || fp.length !== 3) return null;
  const p = fp.map((x) => (x && HEX32.test(String(x)) ? String(x) : null));
  return p.filter(Boolean).length >= 2 ? p : null;
}
function fpMatch(a, b) {
  const have = a.filter(Boolean).length; if (!have) return false;
  let same = 0; for (let i = 0; i < 3; i++) if (a[i] && b[i] && a[i] === b[i]) same++;
  return same >= Math.min(2, have);
}
const fail = (error, status = 400) => ({ status, body: { error } });
const ok = (body) => ({ status: 200, body });

// L3: сравнение пароля владельца за постоянное время. Разная длина — сразу отказ, без сравнения
// (timingSafeEqual требует одинаковых буферов). Пустой пароль не пускает никогда.
function sameSecret(a, b) {
  const x = Buffer.from(String(a == null ? '' : a), 'utf8');
  const y = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
// Строка в журнал функции: значения пароля и адреса не печатаем — только факт и счётчик попыток.
function say(env, msg) { try { if (env && typeof env.log === 'function') env.log(msg); } catch (e) { /* журнал не должен ломать ответ */ } }

// Один «активировать» на ключ за раз внутри экземпляра функции (M2). Между экземплярами гонку закрывает
// store.addMachineIfRoom — проверка «меньше MAX_PCS» и запись одной транзакцией в базе.
const keyLocks = new Map();
async function withKeyLock(h, fn) {
  const prev = keyLocks.get(h) || Promise.resolve();
  let release; const mine = new Promise((r) => { release = r; });
  const chain = prev.then(() => mine);
  keyLocks.set(h, chain);
  await prev;
  try { return await fn(); } finally { release(); if (keyLocks.get(h) === chain) keyLocks.delete(h); }
}

// env: { privateKey, adminToken, now(), ip }, store — см. store-ydb.js / тестовый в памяти.
// ip — адрес клиента, который видит облако (index.js); подделать его из тела запроса нельзя.
async function handle(req, store, env) {
  const now = env.now ? env.now() : Date.now();
  const hour = Math.floor(now / 3600000);
  const ip = String(env.ip || '');
  const action = String((req && req.action) || '');
  if (ADMIN_ACTIONS.has(action)) {
    // M1: у админки свой лимит — общий на час, до проверки пароля (сменой адреса не обойти)
    if ((await store.hit('adm:' + hour, now)) > ADMIN_PER_HOUR) return fail('rate', 429);
    // L3: второй счётчик — с одного адреса, как у обычных запросов (M1). Срабатывает до сравнения
    // пароля, поэтому неудачный подбор упирается в лимит, а не только в длину токена.
    let admTry = 0;
    if (ip) {
      admTry = await store.hit('admip:' + ip + ':' + hour, now);
      if (admTry > ADMIN_PER_IP_HOUR) { say(env, 'админка: слишком много попыток с одного адреса — отказ, ждать час'); return fail('rate', 429); }
    }
    if (!env.adminToken || !sameSecret(req.token, env.adminToken)) {
      say(env, 'админка: неверный пароль (попытка ' + (admTry || 1) + ' за час) — отказ');
      return fail('forbidden', 403);
    }
    if (action === 'admin-list') {
      const all = await store.listAll();
      const byKey = new Map();
      for (const m of all.machines) {
        if (!byKey.has(m.kh)) byKey.set(m.kh, []);
        byKey.get(m.kh).push({ mid: m.mid, at: m.at, code: fpCode(m.fp) });
      }
      const keys = all.keys.map((k) => ({ hash: k.kh, edition: k.edition, status: k.status, note: k.note, created: k.created,
        pcs: (byKey.get(k.kh) || []).sort((a, b) => a.at - b.at) }));
      return ok({ ok: true, now, maxPcs: MAX_PCS, trials: all.trials, keys });
    }
    if (action !== 'admin-keys') {
      const hash = String(req.hash || '');
      if (!/^[0-9a-f]{64}$/.test(hash)) return fail('bad-hash');
      if (action === 'admin-revoke') { await store.revokeKey(hash); return ok({ ok: true }); }
      if (action === 'admin-unrevoke') { await store.unrevokeKey(hash); return ok({ ok: true }); }
      // admin-release
      const mid = String(req.mid || '');
      if (!mid || mid.length > 64) return fail('bad-mid');
      const had = (await store.listMachines(hash)).some((m) => m.mid === mid);
      if (had) await store.removeMachine(hash, mid);
      return ok({ ok: true, released: had });
    }
    const hashes = (Array.isArray(req.hashes) ? req.hashes : []).filter((h) => /^[0-9a-f]{64}$/.test(String(h)));
    if (!hashes.length || hashes.length > 1000) return fail('bad-hashes');
    await store.addKeys(hashes, Math.max(1, Number(req.edition) || 1), String(req.note || '').slice(0, 100), now);
    return ok({ ok: true, added: hashes.length });
  }
  const pack = String((req && req.pack) || '');
  if (!PACKS.has(pack)) return fail('bad-pack');
  const fp = cleanFp(req.fp);
  if (!fp) return fail('bad-fp');
  if (!env.privateKey) return fail('not-configured', 500);
  // перебор ключей и спам триалов. M1: сначала адрес (его не подменить), потом компьютер (второй слой).
  if (ip && (await store.hit('ip:' + ip + ':' + hour, now)) > RATE_PER_IP_HOUR) return fail('rate', 429);
  if ((await store.hit((fp[0] || fp[1] || fp[2]) + ':' + hour, now)) > RATE_PER_HOUR) return fail('rate', 429);

  if (action === 'trial') {
    const t = await store.findTrial(fp, pack);
    if (t && fpMatch(t.fp, fp)) {
      // триал уже был: идёт — выдаём тот же (переустановка Тапёра), кончился — отказ
      if (t.exp > now) return ok({ token: sign({ v: 1, kind: 'trial', pack, edition: t.edition, fp, iat: t.iat, exp: t.exp }, env.privateKey), again: true });
      return fail('trial-used', 403);
    }
    const iat = now, exp = now + TRIAL_DAYS * DAY, edition = 1;
    await store.addTrial(crypto.randomUUID(), fp, pack, edition, iat, exp);
    return ok({ token: sign({ v: 1, kind: 'trial', pack, edition, fp, iat, exp }, env.privateKey) });
  }

  if (action === 'activate' || action === 'deactivate') {
    const key = normKey(req.key);
    if (!key) return fail('no-key', 404);
    const h = keyHash(key);
    const k = await store.getKey(h);
    if (!k) return fail('no-key', 404);
    if (k.status === 'revoked') return fail('key-revoked', 403);
    const res = await withKeyLock(h, async () => {
      const pcs = await store.listMachines(h);
      const mine = pcs.find((m) => fpMatch(m.fp, fp));
      if (action === 'deactivate') { if (mine) await store.removeMachine(h, mine.mid); return ok({ ok: true, released: !!mine }); }
      if (!mine) {
        if (pcs.length >= MAX_PCS) return fail('too-many-pcs', 403);
        // M2: «есть место?» и запись — одной транзакцией; другой экземпляр мог успеть занять место
        if (!(await store.addMachineIfRoom(h, crypto.randomUUID(), fp, now, MAX_PCS))) return fail('too-many-pcs', 403);
      } else if (fp.some((x, i) => x !== mine.fp[i])) {
        await store.updateMachine(h, mine.mid, fp, now); // часть железа поменялась — запоминаем новый отпечаток
      }
      return null;
    });
    if (res) return res;
    return ok({ token: sign({ v: 1, kind: 'full', pack, edition: k.edition, fp, key: h.slice(0, 12), iat: now }, env.privateKey) });
  }
  return fail('bad-action');
}

// Хранилище в памяти — для тестов и как образец того, что должна уметь база
function memoryStore() {
  const keys = new Map(), machines = new Map(), trials = [], hits = new Map();
  return {
    async getKey(h) { return keys.get(h) || null; },
    async addKeys(hs, edition, note, now) { for (const h of hs) if (!keys.has(h)) keys.set(h, { edition, status: 'ok', note, created: now }); },
    async revokeKey(h) { const k = keys.get(h); if (k) k.status = 'revoked'; },
    async unrevokeKey(h) { const k = keys.get(h); if (k) k.status = 'ok'; },
    async listAll() {
      const ms = [];
      for (const [kh, m] of machines) for (const [mid, x] of m) ms.push({ kh, mid, fp: x.fp, at: x.at });
      return { keys: [...keys.entries()].map(([kh, k]) => ({ kh, edition: k.edition, status: k.status, note: k.note || '', created: k.created || 0 })),
        machines: ms, trials: trials.length };
    },
    async listMachines(h) { return [...(machines.get(h) || new Map()).entries()].map(([mid, m]) => ({ mid, fp: m.fp, at: m.at })); },
    async addMachine(h, mid, fp, at) { if (!machines.has(h)) machines.set(h, new Map()); machines.get(h).set(mid, { fp, at }); },
    async addMachineIfRoom(h, mid, fp, at, max) { if (!machines.has(h)) machines.set(h, new Map()); const m = machines.get(h); if (m.size >= max) return false; m.set(mid, { fp, at }); return true; },
    async updateMachine(h, mid, fp, at) { machines.get(h).set(mid, { fp, at }); },
    async removeMachine(h, mid) { const m = machines.get(h); if (m) m.delete(mid); },
    async findTrial(fp, pack) { return trials.find((t) => t.pack === pack && fpMatch(t.fp, fp)) || null; },
    async addTrial(id, fp, pack, edition, iat, exp) { trials.push({ id, fp, pack, edition, iat, exp }); },
    async hit(k) { const n = (hits.get(k) || 0) + 1; hits.set(k, n); return n; },
  };
}

module.exports = { handle, memoryStore, normKey, keyHash, fpMatch, sign, sameSecret, TRIAL_DAYS, MAX_PCS, RATE_PER_HOUR, RATE_PER_IP_HOUR, ADMIN_PER_HOUR, ADMIN_PER_IP_HOUR };
