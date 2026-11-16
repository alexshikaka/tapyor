// A8 аудита 0.34.0: Last.fm считается доступным только при 2xx и разобранном JSON
// без поля error. Раньше 401/403 считались «доступен», и автопочинка объявляла «починено».
// Сеть не трогаем: fetch подменяется.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lastfm = require('../../src/lastfm.js');

const KEY = 'test-key';
function reply(status, body, opts = {}) {
  return {
    status,
    json: async () => {
      if (opts.badJson) throw new Error('Unexpected token');
      return body;
    },
  };
}
function okFetch(status, body) {
  const calls = [];
  const fn = async (url) => { calls.push(url); return reply(status, body); };
  return { fn, calls };
}

test('A8: 2xx и JSON без error — доступен, запрос осмысленный', async () => {
  const { fn, calls } = okFetch(200, { artist: { name: 'Cher' } });
  const r = await lastfm.check({ key: KEY, fetch: fn });
  assert.deepEqual(r, { ok: true, status: 200, error: '', reason: '' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /ws\.audioscrobbler\.com\/2\.0\//);
  assert.match(calls[0], /method=artist\.getinfo/);
});

test('A8: 401/403 — недоступен с текстом Б13 про VPN', async () => {
  for (const status of [401, 403]) {
    const { fn } = okFetch(status, {});
    const r = await lastfm.check({ key: KEY, fetch: fn });
    assert.equal(r.ok, false, 'HTTP ' + status);
    assert.equal(r.status, status);
    assert.match(r.reason, /VPN/);
  }
});

test('A8: 5xx/404 и непонятный ответ — недоступен', async () => {
  for (const status of [500, 503, 404]) {
    const { fn } = okFetch(status, {});
    const r = await lastfm.check({ key: KEY, fetch: fn });
    assert.equal(r.ok, false, 'HTTP ' + status);
    assert.ok(r.reason, 'есть текст для владельца');
  }
  const bad = await lastfm.check({ key: KEY, fetch: async () => reply(200, {}, { badJson: true }) });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /непонятно/);
});

test('A8: JSON с error — недоступен', async () => {
  const { fn } = okFetch(200, { error: 10, message: 'Invalid API key' });
  const r = await lastfm.check({ key: KEY, fetch: fn });
  assert.equal(r.ok, false);
  assert.match(r.error, /Invalid API key/);
  assert.match(r.reason, /ошибкой/);
});

test('A8: сеть упала — недоступен; без ключа запроса нет', async () => {
  const r = await lastfm.check({ key: KEY, fetch: async () => { throw new Error('fetch failed'); } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /не отвечает/);

  let called = 0;
  const none = await lastfm.check({ key: '', fetch: async () => { called++; return reply(200, {}); } });
  assert.equal(none.ok, false);
  assert.match(none.reason, /без ключа/);
  assert.equal(called, 0);
});
