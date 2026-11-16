// Аудит 0.32.0, находки M3–M7 (Claude, 10.11): защита часов из нескольких мест, отвязка только после «готово»,
// поток оверлея — только со своих страниц, превью встраивается только в окно Тапёра.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../../src/license.js');
const C = require('../../src/license-client.js');
const G = require('../../src/localguard.js');

const DAY = 86400000;
const mem = (o = {}) => ({ d: Object.assign({}, o), get(k) { return this.d[k]; }, set(k, v) { this.d[k] = v; } });

test('M3: подправленная licClockMax не спасает, если другое место помнит дату позже', () => {
  const now = Date.UTC(2026, 10, 10);
  const later = now + 40 * DAY;                     // когда-то часы уже были на 40 дней вперёд (файл/реестр/сервер)
  const s = mem({ licClockMax: now - 5 * DAY });    // в settings.json дату «откатили»
  assert.equal(L.clockCheck(s, now, later).ok, false);
  assert.equal(L.clockCheck(s, now, 0).ok, true);   // без других мест — как раньше
  assert.equal(L.clockCheck(s, now, now + DAY / 2).ok, true); // меньше суток — допуск
});

test('M3: время выдачи лицензии (iat от сервера) тоже считается', () => {
  const kp = crypto.generateKeyPairSync('ed25519');
  const pem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const t1 = L.sign({ v: 1, kind: 'trial', pack: 'p', edition: 1, fp: [], iat: 1000, exp: 5000 }, pem);
  const t2 = L.sign({ v: 1, kind: 'full', pack: 'p', edition: 1, fp: [], iat: 3000 }, pem);
  assert.equal(L.latestIat([t1, t2, 'мусор'], [pub]), 3000);
  assert.equal(L.latestIat([], [pub]), 0);
});

test('M7: отвязка — успех только при { ok: true }; ошибка сервера не выдаётся за успех', async () => {
  const store = mem({ licServerUrl: 'https://example.test/f' });
  const resp = (status, body) => async () => ({ ok: status === 200, status, json: async () => body, headers: { get: () => null } });
  const o = (f) => ({ fetch: f, store, keyHeader: 'X-K', cloudKey: 'k', plain: true });
  assert.deepEqual((await C.call('deactivate', {}, o(resp(200, { ok: true, released: true })))).ok, true);
  const bad = await C.call('deactivate', {}, o(resp(404, { error: 'no-key' })));
  assert.equal(bad.ok, false); assert.equal(bad.code, 'no-key');
  const weird = await C.call('deactivate', {}, o(resp(200, { token: 'x' })));
  assert.equal(weird.ok, false);
  const net = await C.call('deactivate', {}, o(async () => { throw new Error('offline'); }));
  assert.equal(net.ok, false); assert.equal(net.code, 'net');
});

test('M3: время сервера берётся из заголовка Date; нет сети — 0', async () => {
  const store = mem({ licServerUrl: 'https://example.test/f' });
  const d = 'Tue, 10 Nov 2026 20:00:00 GMT';
  const t = await C.serverTime({ store, keyHeader: 'X-K', cloudKey: 'k', fetch: async () => ({ headers: { get: (h) => (h === 'date' ? d : null) } }) });
  assert.equal(t, Date.parse(d));
  assert.equal(await C.serverTime({ store, keyHeader: 'X-K', cloudKey: 'k', fetch: async () => { throw new Error('x'); } }), 0);
  assert.equal(await C.serverTime({ store: mem(), keyHeader: 'X-K', cloudKey: 'k', fetch: async () => ({}) }), 0);
});

test('M6: поток оверлея — только со своих страниц', () => {
  const P = 47654;
  assert.equal(G.modRequestOk({}, P), true);                                                     // OBS: без заголовков
  assert.equal(G.modRequestOk({ 'sec-fetch-site': 'same-origin' }, P), true);                    // OBS/превью: свой адрес
  assert.equal(G.modRequestOk({ origin: 'http://localhost:' + P, 'sec-fetch-site': 'same-origin' }, P), true);
  assert.equal(G.modRequestOk({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, P), false);
  assert.equal(G.modRequestOk({ origin: 'https://evil.example' }, P), false);                    // старый браузер без Sec-Fetch
  assert.equal(G.modRequestOk({ origin: 'null' }, P), false);                                    // песочница чужого сайта
  assert.equal(G.modRequestOk({ 'sec-fetch-site': 'same-site' }, P), false);
  assert.equal(G.modRequestOk({ 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' }, P), true); // переход на страницу — можно
});

test('M5: страницу модуля можно встроить только в окно Тапёра (оба своих адреса)', () => {
  const csp = G.modPageCsp(47654);
  assert.match(csp, /frame-ancestors 'self' http:\/\/127\.0\.0\.1:47654 http:\/\/localhost:47654/);
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /\*/);
});
