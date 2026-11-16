// Этап 4: сервер активации (server/yc-license) — триал один на компьютер, 3 компьютера на ключ, отвязка,
// отзыв, перебор, админ; выданное сервером проверяется кодом Тапёра (src/license.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { staged } from './helpers/cloud-stage.mjs';
const C = require('../../server/yc-license/core.js');
const L = require('../../src/license.js');

const kp = crypto.generateKeyPairSync('ed25519');
const PEM = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const fp = (n) => L.fpFromRaw({ machineGuid: 'guid-' + n + '-xxxx', uuid: 'uuid-' + n + '-yyyy', disk: 'disk-' + n + '-zzzz' });
let T = Date.UTC(2026, 10, 8);
const env = { privateKey: PEM, adminToken: 'ADM', now: () => T };
const KEY = 'TPR-AB12-CD34-EF56';
async function setup() { const s = C.memoryStore(); await C.handle({ action: 'admin-keys', token: 'ADM', hashes: [C.keyHash(KEY)], edition: 1 }, s, env); return s; }
const call = (s, req) => C.handle(Object.assign({ pack: 'streamer-pack' }, req), s, env);
const lic = (r) => L.gate({ tokens: [r.body.token], pack: 'streamer-pack', fp: r.fp, now: T, pubkeys: [PUB] });

test('триал: выдаётся, Тапёр его принимает; повтор — тот же срок; после конца — отказ', async () => {
  const s = await setup();
  const r = await call(s, { action: 'trial', fp: fp(1) });
  assert.equal(r.status, 200);
  const g = L.gate({ tokens: [r.body.token], pack: 'streamer-pack', fp: fp(1), now: T, pubkeys: [PUB] });
  assert.equal(g.state, 'trial'); assert.equal(g.daysLeft, 30);
  T += 10 * 86400000;
  const again = await call(s, { action: 'trial', fp: fp(1) });
  assert.equal(again.body.again, true);
  assert.equal(L.gate({ tokens: [again.body.token], pack: 'streamer-pack', fp: fp(1), now: T, pubkeys: [PUB] }).daysLeft, 20);
  // переустановка Windows: MachineGuid другой, железо то же — всё равно тот же триал
  const reinstall = fp(1).slice(); reinstall[0] = fp(9)[0];
  assert.equal((await call(s, { action: 'trial', fp: reinstall })).body.again, true);
  T += 25 * 86400000;
  assert.equal((await call(s, { action: 'trial', fp: fp(1) })).body.error, 'trial-used');
  assert.equal((await call(s, { action: 'trial', fp: fp(2) })).status, 200); // другой компьютер — свой триал
});

test('ключ: активация, тот же компьютер повторно, 3 компьютера максимум, отвязка освобождает место', async () => {
  const s = await setup();
  const a1 = await call(s, { action: 'activate', fp: fp(1), key: 'tpr ab12 cd34 ef56' }); // регистр и пробелы прощаем
  assert.equal(a1.status, 200);
  assert.equal(L.gate({ tokens: [a1.body.token], pack: 'streamer-pack', fp: fp(1), now: T, pubkeys: [PUB] }).state, 'full');
  assert.equal((await call(s, { action: 'activate', fp: fp(1), key: KEY })).status, 200);
  await call(s, { action: 'activate', fp: fp(2), key: KEY });
  await call(s, { action: 'activate', fp: fp(3), key: KEY });
  assert.equal((await call(s, { action: 'activate', fp: fp(4), key: KEY })).body.error, 'too-many-pcs');
  assert.equal((await call(s, { action: 'deactivate', fp: fp(2), key: KEY })).body.released, true);
  assert.equal((await call(s, { action: 'activate', fp: fp(4), key: KEY })).status, 200);
});

test('ошибки: нет ключа, отозван, чужой пак, плохой отпечаток, сервер без ключа подписи', async () => {
  const s = await setup();
  assert.equal((await call(s, { action: 'activate', fp: fp(1), key: 'TPR-0000-0000-0000' })).body.error, 'no-key');
  assert.equal((await call(s, { action: 'activate', fp: fp(1), key: 'мусор' })).body.error, 'no-key');
  await C.handle({ action: 'admin-revoke', token: 'ADM', hash: C.keyHash(KEY) }, s, env);
  assert.equal((await call(s, { action: 'activate', fp: fp(1), key: KEY })).body.error, 'key-revoked');
  assert.equal((await C.handle({ action: 'trial', pack: 'skins', fp: fp(1) }, s, env)).body.error, 'bad-pack');
  assert.equal((await call(s, { action: 'trial', fp: ['x', null, null] })).body.error, 'bad-fp');
  assert.equal((await C.handle({ action: 'trial', pack: 'streamer-pack', fp: fp(5) }, s, { now: () => T })).body.error, 'not-configured');
});

test('админ: без пароля нельзя; перебор ключей с одного компьютера упирается в лимит', async () => {
  const s = await setup();
  assert.equal((await C.handle({ action: 'admin-keys', token: 'нет', hashes: [C.keyHash('TPR-1111-2222-3333')] }, s, env)).status, 403);
  let last;
  for (let i = 0; i < C.RATE_PER_HOUR + 1; i++) last = await call(s, { action: 'activate', fp: fp(7), key: 'TPR-0000-0000-' + String(1000 + i) });
  assert.equal(last.body.error, 'rate');
});

test('функция index.js: ключ первым, GET — 405, лицензия через память', async () => {
  process.env.SHARED_KEY = 'K'; process.env.TAPYOR_TEST_STORE = 'memory';
  process.env.LICENSE_PRIVATE_KEY = PEM.replace(/\n/g, '\\n'); // как в переменной окружения
  process.env.TAPYOR_TEST_PUBKEY = PUB;
  const h = staged('yc-license').handler;
  const H = { 'X-Tapyor-Key': 'K' };
  assert.equal((await h({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode, 403);
  assert.equal((await h({ httpMethod: 'GET', headers: H })).statusCode, 405);
  const r = await h({ httpMethod: 'POST', headers: H, body: JSON.stringify({ action: 'trial', pack: 'streamer-pack', fp: fp(1) }) });
  assert.equal(r.statusCode, 200);
  assert.ok(L.verify(JSON.parse(r.body).token, [PUB]));
});

test('нормализация ключа: O→0, I→1, без дефисов', () => {
  assert.equal(C.normKey('tpr-ABI2 CDO4-EF56'), 'TPR-AB12-CD04-EF56');
  assert.equal(C.normKey('AB12CD34EF56'), 'TPR-AB12-CD34-EF56');
  assert.equal(C.normKey('TPR-123'), null);
});

test('ключ в переменной: только середина без BEGIN/END — принимается; чужой ключ — «не настроено»', async () => {
  process.env.SHARED_KEY = 'K'; process.env.TAPYOR_TEST_STORE = 'memory'; process.env.TAPYOR_TEST_PUBKEY = PUB;
  const m = staged('yc-license');
  const bare = PEM.split('\n').filter((x) => x && !x.startsWith('-----')).join('');
  assert.ok(m.keyCheck(m.normPem(bare)));
  assert.ok(m.keyCheck(m.normPem(PEM.replace(/\n/g, ' '))));
  assert.equal(m.normPem('привет'), '');
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.equal(m.keyCheck(m.normPem(other)), '');
  process.env.LICENSE_PRIVATE_KEY = other;
  const r = await m.handler({ httpMethod: 'POST', headers: { 'X-Tapyor-Key': 'K' }, body: JSON.stringify({ action: 'trial', pack: 'streamer-pack', fp: fp(2) }) });
  assert.equal(r.statusCode, 500); assert.equal(JSON.parse(r.body).error, 'not-configured');
  process.env.LICENSE_PRIVATE_KEY = bare;
  const ok = await m.handler({ httpMethod: 'POST', headers: { 'X-Tapyor-Key': 'K' }, body: JSON.stringify({ action: 'trial', pack: 'streamer-pack', fp: fp(3) }) });
  assert.equal(ok.statusCode, 200);
});

// M1 (аудит 0.32.0): отпечаток присылает клиент — перебор со сменой отпечатка упирается в лимит по адресу
test('M1: 40 попыток с разными отпечатками с одного адреса — приходит rate', async () => {
  const s = await setup();
  const envIp = Object.assign({}, env, { ip: '203.0.113.7' });
  const rnd = () => [crypto.randomBytes(16).toString('hex'), crypto.randomBytes(16).toString('hex'), null];
  let rated = 0;
  for (let i = 0; i < 40; i++) {
    const r = await C.handle({ action: 'activate', pack: 'streamer-pack', fp: rnd(), key: 'TPR-0000-0000-' + String(1000 + i) }, s, envIp);
    if (r.body.error === 'rate') rated++;
  }
  assert.equal(rated, 40 - C.RATE_PER_IP_HOUR);
  // другой адрес — свой счётчик
  const other = await C.handle({ action: 'trial', pack: 'streamer-pack', fp: fp(8) }, s, Object.assign({}, env, { ip: '198.51.100.1' }));
  assert.equal(other.status, 200);
});

test('M1: у админки общий лимит в час, до проверки пароля', async () => {
  const s = C.memoryStore();
  let last;
  for (let i = 0; i < C.ADMIN_PER_HOUR + 1; i++) last = await C.handle({ action: 'admin-revoke', token: 'не тот ' + i, hash: 'a'.repeat(64) }, s, env);
  assert.equal(last.body.error, 'rate');
  assert.equal(last.status, 429);
  // даже с верным паролем в тот же час — ждать
  assert.equal((await C.handle({ action: 'admin-keys', token: 'ADM', hashes: [C.keyHash(KEY)] }, s, env)).body.error, 'rate');
});

// M2: одновременные активации одного ключа не превышают MAX_PCS
test('M2: 6 одновременных активаций одного ключа — ровно 3 компьютера', async () => {
  const s = await setup();
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => call(s, { action: 'activate', fp: fp(20 + n), key: KEY })));
  assert.equal(rs.filter((r) => r.status === 200).length, C.MAX_PCS);
  assert.equal(rs.filter((r) => r.body.error === 'too-many-pcs').length, 6 - C.MAX_PCS);
  assert.equal((await s.listMachines(C.keyHash(KEY))).length, C.MAX_PCS);
});

test('M2: база отказала «места нет» (другой экземпляр успел) — too-many-pcs, а не лицензия', async () => {
  const s = await setup();
  s.addMachineIfRoom = async () => false;
  assert.equal((await call(s, { action: 'activate', fp: fp(30), key: KEY })).body.error, 'too-many-pcs');
});

// L2 (аудит 0.32.0): 1000 хэшей — это ≈66 КБ, а MAX_BODY был 64 000 и отвечал 413.
test('L2: пачка из 1000 хэшей (≈66 КБ) проходит, больше лимита — 413', async () => {
  process.env.SHARED_KEY = 'K'; process.env.TAPYOR_TEST_STORE = 'memory'; process.env.ADMIN_TOKEN = 'ADM';
  const m = staged('yc-license');
  const hashes = Array.from({ length: 1000 }, () => crypto.randomBytes(32).toString('hex'));
  const body = JSON.stringify({ action: 'admin-keys', token: 'ADM', hashes });
  assert.ok(body.length > 64000 && body.length < 96000, 'длина тела — ' + body.length);
  const r = await m.handler({ httpMethod: 'POST', headers: { 'X-Tapyor-Key': 'K' }, body });
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).added, 1000);
  const big = await m.handler({ httpMethod: 'POST', headers: { 'X-Tapyor-Key': 'K' }, body: 'x'.repeat(96001) });
  assert.equal(big.statusCode, 413);
});

// L3 (аудит 0.32.0): пароль сравнивается постоянным временем; неудачные попытки admin-* упираются в лимит по адресу.
test('L3: постоянное сравнение пароля, счётчик неудачных попыток по адресу, строка в журнал', async () => {
  const s = C.memoryStore();
  const logs = [];
  const envIp = Object.assign({}, env, { ip: '203.0.113.9', log: (m) => logs.push(String(m)) });
  assert.equal(C.sameSecret('ADM', 'ADM'), true);
  assert.equal(C.sameSecret('ADM', 'ADM '), false, 'разная длина — сразу отказ');
  assert.equal(C.sameSecret('', ''), false, 'пустой пароль не проходит');
  assert.equal(C.sameSecret(null, 'ADM'), false);
  let last;
  for (let i = 0; i < C.ADMIN_PER_IP_HOUR + 1; i++) {
    last = await C.handle({ action: 'admin-revoke', token: 'не тот пароль ' + i, hash: 'a'.repeat(64) }, s, envIp);
  }
  assert.equal(last.status, 429);
  assert.equal(last.body.error, 'rate');
  assert.ok(logs.some((m) => /неверный пароль/.test(m)), 'журнал: ' + JSON.stringify(logs));
  assert.ok(!logs.join(' ').includes('не тот пароль'), 'пароля в журнале нет');
  // другой адрес — свой счётчик: пароль всё равно неверный, но это не rate
  const other = await C.handle({ action: 'admin-revoke', token: 'нет', hash: 'a'.repeat(64) }, s, Object.assign({}, env, { ip: '198.51.100.9' }));
  assert.equal(other.status, 403);
  assert.equal(other.body.error, 'forbidden');
});

// L4 (аудит 0.32.0): функция лицензий «закрыта по умолчанию» — без SHARED_KEY не работает вовсе.
test('L4: без SHARED_KEY yc-license отвечает 403, остальные функции — как раньше', async () => {
  const old = process.env.SHARED_KEY;
  try {
    delete process.env.SHARED_KEY;
    process.env.TAPYOR_TEST_STORE = 'memory';
    const m = staged('yc-license');
    const body = JSON.stringify({ action: 'trial', pack: 'streamer-pack', fp: fp(4) });
    assert.equal((await m.handler({ httpMethod: 'POST', headers: {}, body })).statusCode, 403);
    assert.equal((await m.handler({ httpMethod: 'POST', headers: { 'X-Tapyor-Key': 'что угодно' }, body })).statusCode, 403);
    const k = require('../../server/common/key.js');
    assert.equal(k.keyOk({}), true, 'старые функции без ключа пускают — так задумано');
    assert.equal(k.keyOk({}, { required: true }), false, 'строгий режим без переменной — отказ');
    // yc-da без общего ключа по-прежнему не 403 (её поведение не меняем)
    const da = await staged('yc-da').handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    assert.notEqual(da.statusCode, 403);
  } finally { process.env.SHARED_KEY = old; }
});

test('index.js: адрес берётся из requestContext, не из тела', async () => {
  process.env.SHARED_KEY = 'K'; process.env.TAPYOR_TEST_STORE = 'memory'; process.env.TAPYOR_TEST_PUBKEY = PUB;
  process.env.LICENSE_PRIVATE_KEY = PEM.replace(/\n/g, '\\n');
  const h = staged('yc-license').handler;
  let last;
  for (let i = 0; i < C.RATE_PER_IP_HOUR + 1; i++) {
    const f = [crypto.randomBytes(16).toString('hex'), crypto.randomBytes(16).toString('hex'), null];
    last = await h({ httpMethod: 'POST', headers: { 'X-Tapyor-Key': 'K' }, requestContext: { identity: { sourceIp: '192.0.2.55' } },
      body: JSON.stringify({ action: 'activate', pack: 'streamer-pack', fp: f, key: 'TPR-0000-0000-' + String(2000 + i), ip: '1.1.1.' + i }) });
  }
  assert.equal(last.statusCode, 429);
});

// Учёт ключей у автора: список активаций, возврат отзыва, освобождение места.
test('админ: список ключей с компьютерами; вернуть отзыв; освободить место; без пароля — отказ', async () => {
  const s = await setup();
  const h = C.keyHash(KEY);
  await call(s, { action: 'activate', fp: fp(1), key: KEY });
  T += 60000;
  await call(s, { action: 'activate', fp: fp(2), key: KEY });
  await call(s, { action: 'trial', fp: fp(5) });
  assert.equal((await C.handle({ action: 'admin-list', token: 'нет' }, s, env)).status, 403);
  const l = await C.handle({ action: 'admin-list', token: 'ADM' }, s, env);
  assert.equal(l.status, 200);
  assert.equal(l.body.trials, 1); assert.equal(l.body.maxPcs, 3);
  const k = l.body.keys.find((x) => x.hash === h);
  assert.equal(k.status, 'ok'); assert.equal(k.edition, 1); assert.equal(k.pcs.length, 2);
  assert.ok(k.pcs[0].at < k.pcs[1].at, 'по времени активации');
  assert.equal(k.pcs[0].code, L.fpCode(fp(1)), 'код компьютера — как показывает Тапёр');
  assert.ok(!JSON.stringify(l.body).includes(fp(1)[0]), 'полный отпечаток наружу не уходит');
  // освободить место первого компьютера
  const rel = await C.handle({ action: 'admin-release', token: 'ADM', hash: h, mid: k.pcs[0].mid }, s, env);
  assert.equal(rel.body.released, true);
  assert.equal((await C.handle({ action: 'admin-release', token: 'ADM', hash: h, mid: k.pcs[0].mid }, s, env)).body.released, false);
  // отзыв и возврат
  await C.handle({ action: 'admin-revoke', token: 'ADM', hash: h }, s, env);
  assert.equal((await call(s, { action: 'activate', fp: fp(3), key: KEY })).body.error, 'key-revoked');
  await C.handle({ action: 'admin-unrevoke', token: 'ADM', hash: h }, s, env);
  assert.equal((await call(s, { action: 'activate', fp: fp(3), key: KEY })).status, 200);
  const l2 = await C.handle({ action: 'admin-list', token: 'ADM' }, s, env);
  assert.equal(l2.body.keys.find((x) => x.hash === h).pcs.length, 2);
  assert.equal((await C.handle({ action: 'admin-revoke', token: 'ADM', hash: 'zz' }, s, env)).body.error, 'bad-hash');
});
