// R1: облачная функция пульта (server/yc-remote/core.js) — протокол docs/REMOTE.md.
// Хранилище в памяти, время подставляется: проверяем форму, версии, события, команды, лимиты и CORS.
// core.js берём из собранной папки (cloud-pack кладёт рядом common/), как и остальные функции.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cloudDir } from './helpers/cloud-stage.mjs';

const require = createRequire(import.meta.url);
const C = require(path.join(cloudDir(), 'yc-remote', 'core.js'));

const IP = '203.0.113.20';
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);
let store, T;

beforeEach(() => {
  C.resetRates();
  store = C.memoryStore();
  T = T0;
});

// op, method, query, body, ip → ответ core
const call = (op, method, query, body, ip) =>
  C.handle(op, method, query || {}, body === undefined ? {} : body, ip || IP, store, T);

async function newSession(ip) {
  const r = await call('new', 'POST', {}, {}, ip);
  assert.equal(r.status, 200, 'new: ' + JSON.stringify(r.body));
  return r.body;
}

test('полный сценарий: new → host(s,f) → poll → cmd ×3 → host(ack) → events → end → 404', async () => {
  const { sid, host, ttl } = await newSession();
  assert.match(sid, /^[A-Za-z0-9_-]{22}$/, 'sid — 16 байт base64url');
  assert.match(host, /^[A-Za-z0-9_-]{43}$/, 'host — 32 байта base64url');
  assert.equal(ttl, 12 * 60 * 60 * 1000, 'ttl 12 ч в миллисекундах');

  // В хранилище — только SHA-256 host, самого host нет.
  const row = await store.get(sid);
  assert.equal(row.host_hash, crypto.createHash('sha256').update(host).digest('hex'));
  assert.equal(row.host, undefined);
  assert.equal(row.host_at, T);

  // host со снимком и лентой
  let r = await call('host', 'POST', {}, { sid, host, s: 'S1', f: 'F1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.cmds, []);
  assert.equal(r.body.phoneAgo, null, 'телефон ещё не опрашивал');

  // телефон получает s и f
  r = await call('poll', 'GET', { sid, sv: 0, fv: 0, es: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.sv, 1);
  assert.equal(r.body.fv, 1);
  assert.equal(r.body.s, 'S1');
  assert.equal(r.body.f, 'F1');
  assert.deepEqual(r.body.ev, []);
  assert.equal(r.body.hostAgo, 0);

  // повторно — без s и f: версии не изменились
  r = await call('poll', 'GET', { sid, sv: 1, fv: 1, es: 0 });
  assert.equal('s' in r.body, false, 's не повторяется');
  assert.equal('f' in r.body, false, 'f не повторяется');

  // Тапёр видит, как давно был телефон
  T += 2500;
  r = await call('host', 'POST', {}, { sid, host });
  assert.equal(r.body.phoneAgo, 2500);

  // три команды телефона
  for (let i = 1; i <= 3; i++) {
    r = await call('cmd', 'POST', {}, { sid, c: 'C' + i });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  }
  r = await call('host', 'POST', {}, { sid, host });
  assert.deepEqual(r.body.cmds.map((x) => [x.seq, x.c]), [[1, 'C1'], [2, 'C2'], [3, 'C3']]);

  // ack принимает всё — команды удалены
  r = await call('host', 'POST', {}, { sid, host, ack: 3 });
  assert.deepEqual(r.body.cmds, []);
  r = await call('host', 'POST', {}, { sid, host });
  assert.deepEqual(r.body.cmds, []);

  // события: seq по порядку
  await call('host', 'POST', {}, { sid, host, ev: ['E1', 'E2'] });
  r = await call('poll', 'GET', { sid, sv: 1, fv: 1, es: 0 });
  assert.deepEqual(r.body.ev.map((x) => [x.seq, x.e]), [[1, 'E1'], [2, 'E2']]);
  r = await call('poll', 'GET', { sid, sv: 1, fv: 1, es: 2 });
  assert.deepEqual(r.body.ev, [], 'всё уже получено');
  r = await call('poll', 'GET', { sid, sv: 1, fv: 1, es: 1 });
  assert.deepEqual(r.body.ev.map((x) => x.seq), [2], 'только новее es');

  // «Отключить»: сессия удалена, poll — 404
  r = await call('end', 'POST', {}, { sid, host });
  assert.deepEqual(r.body, { ok: true });
  assert.equal(await store.get(sid), null);
  r = await call('poll', 'GET', { sid, sv: 0, fv: 0, es: 0 });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'no-session');
});

test('чужой host: host/end — 403, сессия не меняется; битая форма host — 400', async () => {
  const { sid, host } = await newSession();
  const foreign = 'B'.repeat(43);
  let r = await call('host', 'POST', {}, { sid, host: foreign });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden');
  r = await call('end', 'POST', {}, { sid, host: foreign });
  assert.equal(r.status, 403);
  assert.ok(await store.get(sid), 'чужая попытка не удалила сессию');
  // наш host по-прежнему работает
  assert.equal((await call('host', 'POST', {}, { sid, host })).status, 200);
  // не 43 знака — это уже неверная форма, а не чужой токен
  r = await call('host', 'POST', {}, { sid, host: 'x'.repeat(42) });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad_request');
});

test('мусор во всех полях — 400 bad_request', async () => {
  const { sid, host } = await newSession();
  const cases = [
    ['host', 'POST', {}, null],
    ['host', 'POST', {}, []],
    ['host', 'POST', {}, { sid: 'короткий', host }],
    ['host', 'POST', {}, { sid, host: 'x'.repeat(42) }],
    ['host', 'POST', {}, { sid, host: 'x'.repeat(43) + '!' }],
    ['host', 'POST', {}, { sid, host, s: 5 }],
    ['host', 'POST', {}, { sid, host, s: 'A'.repeat(C.MAX_S + 1) }],
    ['host', 'POST', {}, { sid, host, f: [] }],
    ['host', 'POST', {}, { sid, host, ev: 'x' }],
    ['host', 'POST', {}, { sid, host, ev: Array(11).fill('A') }],
    ['host', 'POST', {}, { sid, host, ev: ['A'.repeat(C.MAX_EV_PIECE + 1)] }],
    ['host', 'POST', {}, { sid, host, ev: [5] }],
    ['host', 'POST', {}, { sid, host, ack: '3' }],
    ['host', 'POST', {}, { sid, host, ack: 1.5 }],
    ['poll', 'GET', { sid: 'x', sv: 0, fv: 0, es: 0 }, {}],
    ['poll', 'GET', { sid, sv: 'abc', fv: 0, es: 0 }, {}],
    ['poll', 'GET', { sid, sv: '-1', fv: 0, es: 0 }, {}],
    ['poll', 'GET', { sid, sv: 0, fv: '1.5', es: 0 }, {}],
    ['poll', 'GET', { sid, sv: 0, fv: 0, es: ' ' }, {}],
    ['cmd', 'POST', {}, null],
    ['cmd', 'POST', {}, { sid, c: 5 }],
    ['cmd', 'POST', {}, { sid, c: 'A'.repeat(C.MAX_C + 1) }],
    ['cmd', 'POST', {}, { sid: 'x', c: 'AA' }],
    ['end', 'POST', {}, null],
    ['end', 'POST', {}, { sid: 'x', host }],
    ['end', 'POST', {}, { sid, host: 'x'.repeat(42) }]
  ];
  for (const [op, method, query, body] of cases) {
    const r = await call(op, method, query, body);
    assert.equal(r.status, 400, op + ': ' + JSON.stringify(body));
    assert.equal(r.body.error, 'bad_request');
  }
  // неизвестная операция и пустая — тоже 400
  assert.equal((await call('nope', 'POST', {}, {})).status, 400);
  assert.equal((await call('', 'POST', {}, {})).status, 400);
});

test('методы: не тот метод — 405; OPTIONS — 204 с CORS', async () => {
  assert.equal((await call('new', 'GET')).status, 405);
  assert.equal((await call('host', 'GET')).status, 405);
  assert.equal((await call('end', 'GET')).status, 405);
  let r = await call('poll', 'POST', {}, {});
  assert.equal(r.status, 405);
  assert.equal(r.body.error, 'method');
  assert.ok(r.headers['Access-Control-Allow-Origin'], 'CORS нужен и на ошибке poll');
  r = await call('cmd', 'GET', {});
  assert.equal(r.status, 405);
  assert.ok(r.headers['Access-Control-Allow-Origin'], 'CORS нужен и на ошибке cmd');

  r = await call('poll', 'OPTIONS', {}, {});
  assert.equal(r.status, 204);
  assert.equal(r.body, null);
  assert.equal(r.headers['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS');
  assert.equal(r.headers['Access-Control-Allow-Headers'], 'Content-Type');
  assert.equal(r.headers['Access-Control-Max-Age'], '600');
  // OPTIONS работает и без op
  r = await C.handle('', 'OPTIONS', {}, {}, IP, store, T);
  assert.equal(r.status, 204);
});

test('размеры на границе: s/f 65 536, ev 10 × 16 384, c 2 048 — принимаются', async () => {
  const { sid, host } = await newSession();
  const S = 'A'.repeat(65536), F = 'B'.repeat(65536);
  const EV = Array.from({ length: 10 }, (_, i) => String.fromCharCode(65 + i).repeat(16384));
  let r = await call('host', 'POST', {}, { sid, host, s: S, f: F, ev: EV });
  assert.equal(r.status, 200);

  r = await call('poll', 'GET', { sid, sv: 0, fv: 0, es: 0 });
  assert.equal(r.body.s.length, 65536);
  assert.equal(r.body.f.length, 65536);
  assert.equal(r.body.ev.length, 10);
  assert.equal(r.body.ev[0].e.length, 16384);

  r = await call('cmd', 'POST', {}, { sid, c: 'D'.repeat(2048) });
  assert.equal(r.status, 200);
  r = await call('host', 'POST', {}, { sid, host });
  assert.equal(r.body.cmds[0].c.length, 2048);
});

test('команды: хранится 50 последних, seq продолжается после ack', async () => {
  const { sid, host } = await newSession();
  let sent = 0;
  // по 20 команд за 10 с — иначе сработает лимит на сессию
  for (let batch = 0; batch < 3; batch++) {
    const n = batch < 2 ? 20 : 15;
    for (let i = 0; i < n; i++) {
      const r = await call('cmd', 'POST', {}, { sid, c: 'C' + (++sent) });
      assert.equal(r.status, 200, 'команда ' + sent);
    }
    T += 11000;
  }
  let r = await call('host', 'POST', {}, { sid, host });
  assert.equal(r.body.cmds.length, 50);
  assert.equal(r.body.cmds[0].seq, 6, 'старые выкинуты');
  assert.equal(r.body.cmds[49].seq, 55);

  r = await call('host', 'POST', {}, { sid, host, ack: 10 });
  assert.equal(r.body.cmds.length, 45);
  assert.equal(r.body.cmds[0].seq, 11);

  // новая команда продолжает нумерацию, а не начинает с 1
  T += 11000;
  assert.equal((await call('cmd', 'POST', {}, { sid, c: 'NEW' })).status, 200);
  r = await call('host', 'POST', {}, { sid, host, ack: 0 });
  assert.equal(r.body.cmds[r.body.cmds.length - 1].seq, 56);
  assert.equal(r.body.cmds[r.body.cmds.length - 1].c, 'NEW');
});

test('события: хранится 30 последних, seq по порядку', async () => {
  const { sid, host } = await newSession();
  for (let i = 0; i < 5; i++) {
    const ev = Array.from({ length: 10 }, (_, j) => 'E' + (i * 10 + j + 1));
    const r = await call('host', 'POST', {}, { sid, host, ev });
    assert.equal(r.status, 200);
  }
  let r = await call('poll', 'GET', { sid, sv: 0, fv: 0, es: 0 });
  assert.equal(r.body.ev.length, 30);
  assert.equal(r.body.ev[0].seq, 21);
  assert.equal(r.body.ev[29].seq, 50);
  assert.equal(r.body.ev[29].e, 'E50');

  r = await call('poll', 'GET', { sid, sv: 0, fv: 0, es: 45 });
  assert.deepEqual(r.body.ev.map((x) => x.seq), [46, 47, 48, 49, 50]);
});

test('истечение 12 ч: poll и host — 404 no-session, сессия удалена', async () => {
  const a = await newSession();
  T += C.SESSION_TTL_MS - 1;
  let r = await call('poll', 'GET', { sid: a.sid, sv: 0, fv: 0, es: 0 });
  assert.equal(r.status, 200, 'за миллисекунду до срока жива');
  T += 2;
  r = await call('poll', 'GET', { sid: a.sid, sv: 0, fv: 0, es: 0 });
  assert.equal(r.status, 404);
  assert.equal(await store.get(a.sid), null);

  const b = await newSession();
  T += C.SESSION_TTL_MS + 1;
  r = await call('host', 'POST', {}, { sid: b.sid, host: b.host });
  assert.equal(r.status, 404);
  r = await call('end', 'POST', {}, { sid: b.sid, host: b.host });
  assert.equal(r.status, 404);
});

test('host обновляет exp на 12 ч вперёд и не трогает номер события', async () => {
  const { sid, host } = await newSession();
  await call('host', 'POST', {}, { sid, host, s: 'S', ev: ['E1'] });
  let row = await store.get(sid);
  assert.equal(row.es, 1);
  assert.equal(row.exp, T + C.SESSION_TTL_MS);

  T += 3600000;
  await call('host', 'POST', {}, { sid, host });
  row = await store.get(sid);
  assert.equal(row.exp, T + C.SESSION_TTL_MS);
  assert.equal(row.host_at, T);
  assert.equal(row.es, 1, 'без новых событий seq не растёт');
  assert.equal(row.sv, 1, 'без s версия не растёт');
});

test('CORS: poll/cmd — PAGE_ORIGIN, без переменной «*»; new/host/end без CORS', async () => {
  const { sid, host } = await newSession();
  const old = process.env.PAGE_ORIGIN;
  try {
    process.env.PAGE_ORIGIN = 'https://example.test';
    let r = await call('poll', 'GET', { sid, sv: 0, fv: 0, es: 0 });
    assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://example.test');
    assert.equal(r.headers['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS');
    assert.equal(r.headers['Access-Control-Allow-Headers'], 'Content-Type');
    assert.equal(r.headers['Access-Control-Max-Age'], '600');
    r = await call('cmd', 'POST', {}, { sid, c: 'AA' });
    assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://example.test');
    r = await call('host', 'POST', {}, { sid, host });
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined, 'host зовёт Node, CORS не нужен');
    r = await call('new', 'POST', {}, {});
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
    r = await call('end', 'POST', {}, { sid, host: 'wrong' });
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
  } finally {
    if (old === undefined) delete process.env.PAGE_ORIGIN; else process.env.PAGE_ORIGIN = old;
  }
  const r = await call('poll', 'OPTIONS', {}, {});
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*', 'без переменной — «*»');
});

test('лимит cmd на сессию: 20 за 10 с; другая сессия — свой счётчик', async () => {
  const a = await newSession();
  for (let i = 0; i < C.CMD_LIMIT; i++) {
    const r = await call('cmd', 'POST', {}, { sid: a.sid, c: 'AA' });
    assert.equal(r.status, 200, 'команда ' + (i + 1));
  }
  let r = await call('cmd', 'POST', {}, { sid: a.sid, c: 'AA' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'rate');
  assert.ok(r.headers['Retry-After'], 'Retry-After есть');
  assert.ok(r.headers['Access-Control-Allow-Origin'], 'CORS на 429 тоже есть');

  const b = await newSession();
  assert.equal((await call('cmd', 'POST', {}, { sid: b.sid, c: 'AA' })).status, 200);

  T += 10001;
  assert.equal((await call('cmd', 'POST', {}, { sid: a.sid, c: 'AA' })).status, 200, 'окно прошло');
});

test('лимит new: 10 за 10 мин с адреса, другой адрес — свой счётчик', async () => {
  C.resetRates();
  const ip = '198.51.100.7';
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('new', 'POST', {}, {}, ip)).status, 200, 'сессия ' + (i + 1));
  }
  let r = await call('new', 'POST', {}, {}, ip);
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'rate');
  assert.ok(r.headers['Retry-After']);
  assert.equal((await call('new', 'POST', {}, {}, '198.51.100.8')).status, 200);
});

test('poll без снимка/ленты: sv и fv нули, s и f не появляются', async () => {
  const { sid } = await newSession();
  const r = await call('poll', 'GET', { sid, sv: 0, fv: 0, es: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.sv, 0);
  assert.equal(r.body.fv, 0);
  assert.equal('s' in r.body, false);
  assert.equal('f' in r.body, false);
  assert.deepEqual(r.body.ev, []);
});

test('end чужим host не удаляет сессию; верный host удаляет', async () => {
  const { sid, host } = await newSession();
  assert.equal((await call('end', 'POST', {}, { sid, host: 'C'.repeat(43) })).status, 403);
  assert.ok(await store.get(sid));
  assert.equal((await call('end', 'POST', {}, { sid, host })).status, 200);
  assert.equal(await store.get(sid), null);
});
