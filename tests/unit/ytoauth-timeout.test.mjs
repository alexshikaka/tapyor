// R6: вход и обновление доступа YouTube не должны висеть вечно.
// Поддельный fetch не отвечает вовсе: вызывающий обязан получить обычную ошибку не позже срока.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ytr = require('../../src/ytoauth-request.js');

test('tokenRequest: срок 15 с, оба пути (облако и Google)', async () => {
  assert.equal(ytr.TIMEOUT_MS, 15000);
});

test('tokenRequest: fetch молчит — ошибка не позже срока', async () => {
  let signal = null;
  const fetch = (url, o) => { signal = o && o.signal; return new Promise(() => {}); };
  const t = Date.now();
  await assert.rejects(ytr.tokenRequest(fetch, { clientId: 'id', clientSecret: 's' }, { code: 'c' }, 120), /Вход YouTube: нет ответа/);
  assert.ok(Date.now() - t < 1000, 'ошибка пришла позже срока');
  assert.ok(signal && typeof signal.aborted === 'boolean', 'запросу не передан signal');
});

test('tokenRequest: через облако — тот же срок', async () => {
  const seen = [];
  const fetch = (url, o) => { seen.push({ url, o }); return new Promise(() => {}); };
  await assert.rejects(ytr.tokenRequest(fetch, { clientId: 'id', proxyUrl: 'https://cloud/token' }, { refresh_token: 'r' }, 80), /Вход YouTube: нет ответа/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://cloud/token');
  assert.ok(seen[0].o.signal, 'запросу не передан signal');
});

test('tokenRequest: быстрый ответ разбирается как раньше', async () => {
  const fetch = async (url, o) => ({ json: async () => ({ access_token: 'tok', expires_in: 3600 }), o });
  const j = await ytr.tokenRequest(fetch, { clientId: 'id', clientSecret: 's' }, { code: 'c' });
  assert.equal(j.access_token, 'tok');
});
