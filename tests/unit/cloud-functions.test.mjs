// G-02/G-04: облачные функции yc-da и yc-google — ключ первым, лимит тела, base64, таймаут провайдера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { staged } from './helpers/cloud-stage.mjs';

process.env.SHARED_KEY = 'K';
process.env.DA_CLIENT_ID = '1'; process.env.DA_CLIENT_SECRET = 's';
process.env.GOOGLE_CLIENT_ID = 'g'; process.env.GOOGLE_CLIENT_SECRET = 's';
const da = staged('yc-da').handler;
const gg = staged('yc-google').handler;
const H = { 'X-Tapyor-Key': 'K' };
const ev = (body, o = {}) => Object.assign({ httpMethod: 'POST', headers: H, body: JSON.stringify(body) }, o);
const okFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) });
const DA_OK = { grant_type: 'refresh_token', refresh_token: 'x' };

test('ключ проверяется первым; GET с ключом — 405 (так Тапёр проверяет, жива ли функция)', async () => {
  for (const h of [da, gg]) {
    assert.equal((await h({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode, 403);
    assert.equal((await h({ httpMethod: 'GET', headers: H })).statusCode, 405);
  }
});

test('G-04: тело больше 4000 байт — 413, до обращения к провайдеру', async () => {
  let called = 0; global.fetch = async () => { called++; return okFetch(); };
  const big = { grant_type: 'refresh_token', refresh_token: 'я'.repeat(2100) }; // > 4000 байт в UTF-8
  assert.equal((await da(ev(big))).statusCode, 413);
  assert.equal((await gg(ev(big))).statusCode, 413);
  assert.equal(called, 0);
});

test('G-04: тело в base64 разбирается', async () => {
  global.fetch = okFetch;
  const b64 = Buffer.from(JSON.stringify(DA_OK)).toString('base64');
  const r = await da({ httpMethod: 'POST', headers: H, body: b64, isBase64Encoded: true });
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).access_token, 'a');
});

test('мусор вместо JSON — 400', async () => {
  assert.equal((await da({ httpMethod: 'POST', headers: H, body: 'null' })).statusCode, 400);
  assert.equal((await gg({ httpMethod: 'POST', headers: H, body: '{oops' })).statusCode, 400);
});

test('G-02: провайдер завис — функция отвечает 504, запрос идёт с таймаутом', async () => {
  let gotSignal = null;
  global.fetch = async (u, o) => { gotSignal = o.signal; const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; };
  const r = await da(ev(DA_OK));
  assert.equal(r.statusCode, 504);
  assert.ok(gotSignal, 'fetch получил signal');
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  assert.equal((await gg(ev({ grant_type: 'refresh_token', refresh_token: 'x' }))).statusCode, 502);
});
