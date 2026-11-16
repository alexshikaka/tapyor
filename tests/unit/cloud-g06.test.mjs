// G-06: свои ошибки облачных функций отличимы от ответов провайдера (Яндекс/Google/DonationAlerts).
// У наших ошибок есть tapyor_error; у ответа провайдера его нет, а поле error — как раньше у всех.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staged } from './helpers/cloud-stage.mjs';

process.env.SHARED_KEY = 'K';
process.env.DA_CLIENT_ID = '1'; process.env.DA_CLIENT_SECRET = 's';
process.env.GOOGLE_CLIENT_ID = 'g'; process.env.GOOGLE_CLIENT_SECRET = 's';
process.env.GITHUB_TOKEN = 't'; process.env.GITHUB_REPO = 'o/r';
process.env.TAPYOR_TEST_STORE = 'memory';

const da = staged('yc-da').handler;
const gg = staged('yc-google').handler;
const rpMod = staged('yc-report');
const rp = rpMod.handler;
const lic = staged('yc-license').handler;
const H = { 'X-Tapyor-Key': 'K' };
const ev = (body, o = {}) => Object.assign({ httpMethod: 'POST', headers: H, body: JSON.stringify(body), requestContext: { identity: { sourceIp: '7.7.7.1' } } }, o);
const DA_OK = { grant_type: 'refresh_token', refresh_token: 'x' };
const json = (r) => JSON.parse(r.body);

// Наши ошибки: tapyor_error есть, error не изменился
test('G-06: ключ, метод, размер, битый запрос — свои коды', async () => {
  for (const h of [da, gg]) {
    let j = json(await h({ httpMethod: 'POST', headers: {}, body: '{}' }));
    assert.equal(j.tapyor_error, 'forbidden'); assert.equal(j.error, 'forbidden');

    j = json(await h({ httpMethod: 'GET', headers: H }));
    assert.equal(j.tapyor_error, 'method'); assert.equal(j.error, 'only POST');

    const big = { grant_type: 'refresh_token', refresh_token: 'я'.repeat(2100) };
    j = json(await h(ev(big)));
    assert.equal(j.tapyor_error, 'too_big'); assert.equal(j.error, 'too big');

    j = json(await h(ev({ grant_type: 'nope' })));
    assert.equal(j.tapyor_error, 'bad_request'); assert.equal(j.error, 'bad grant_type');
  }
});

test('G-06: нет ключей сервиса в переменных — not_configured (error прежний)', async () => {
  const id = process.env.DA_CLIENT_ID, sec = process.env.DA_CLIENT_SECRET;
  delete process.env.DA_CLIENT_ID; delete process.env.DA_CLIENT_SECRET;
  try {
    const j = json(await da(ev(DA_OK)));
    assert.equal(j.tapyor_error, 'not_configured');
    assert.equal(j.error, 'not-configured');
  } finally { process.env.DA_CLIENT_ID = id; process.env.DA_CLIENT_SECRET = sec; }
});

test('G-06: провайдер завис / сеть / не JSON — наши коды, error прежний', async () => {
  global.fetch = async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; };
  let j = json(await da(ev(DA_OK)));
  assert.equal(j.tapyor_error, 'provider_timeout'); assert.equal(j.error, 'провайдер не ответил вовремя');

  global.fetch = async () => { throw new Error('ECONNRESET'); };
  j = json(await gg(ev(DA_OK)));
  assert.equal(j.tapyor_error, 'provider_unreachable'); assert.equal(j.error, 'сеть недоступна');

  global.fetch = async () => ({ ok: false, status: 500, text: async () => '<html>oops' });
  j = json(await gg(ev(DA_OK)));
  assert.equal(j.tapyor_error, 'provider_bad_response');
  assert.match(j.error, /Google ответил не JSON, код 500/);
});

test('G-06: отказ провайдера — БЕЗ tapyor_error (видно, что это не наше облако)', async () => {
  global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }) });
  const rg = json(await gg(ev(DA_OK)));
  assert.equal(rg.tapyor_error, undefined, 'у отказа Google не должно быть нашего кода');
  assert.equal(rg.error, 'invalid_grant');
  assert.equal(rg.error_description, 'Bad Request');

  global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_request', message: 'bad' }) });
  const rd = json(await da(ev(DA_OK)));
  assert.equal(rd.tapyor_error, undefined, 'у отказа DonationAlerts не должно быть нашего кода');
  assert.equal(rd.error, 'invalid_request');
});

test('G-06: успешный ответ не несёт tapyor_error', async () => {
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) });
  const j = json(await da(ev(DA_OK)));
  assert.equal(j.access_token, 'a');
  assert.equal(j.tapyor_error, undefined);
});

test('G-06: yc-report — суточный лимит и «слишком часто» коды свои, error прежний', async () => {
  const REP = (iid) => ({ httpMethod: 'POST', headers: H, requestContext: { identity: { sourceIp: '5.5.5.1' } }, body: JSON.stringify({ fp: 'abc', service: 'ym', stage: 'play', code: 'E1', msg: 'm', app: '0.32.0', iid }) });
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/search/issues')) return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 30 }) };
    return { ok: true, status: 200, text: async () => '[]' };
  };
  let j = JSON.parse((await rp(REP('inst-a'))).body);
  assert.equal(j.tapyor_error, 'daily_limit'); assert.equal(j.error, 'daily limit');

  // Теперь суточный запас свободен: первая отправка создаёт задачу, вторая с тем же iid — «слишком часто»
  // (сброс нужен, чтобы поднять и суточный счётчик экземпляра, и память «одна установка в минуту»)
  rpMod._rate.reset();
  global.fetch = async (url, o) => {
    const u = String(url);
    if (u.includes('/search/issues')) return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0 }) };
    if (o && o.method === 'POST') return { ok: true, status: 201, text: async () => '{"number":3}' };
    return { ok: true, status: 200, text: async () => '[]' };
  };
  assert.equal((await rp(REP('inst-b'))).statusCode, 200);
  const r2 = await rp(REP('inst-b'));
  assert.equal(r2.statusCode, 429);
  j = JSON.parse(r2.body);
  assert.equal(j.tapyor_error, 'rate_limited'); assert.equal(j.error, 'slow down');
});

test('G-06: yc-license — свои коды, а обычный ответ «ключа нет» без кода', async () => {
  let j = json(await lic({ httpMethod: 'POST', headers: {}, body: '{}', requestContext: { identity: { sourceIp: '6.6.6.1' } } }));
  assert.equal(j.tapyor_error, 'forbidden');

  j = json(await lic({ httpMethod: 'GET', headers: H }));
  assert.equal(j.tapyor_error, 'method'); assert.equal(j.error, 'only POST');

  j = json(await lic({ httpMethod: 'POST', headers: H, body: '{oops', requestContext: { identity: { sourceIp: '6.6.6.2' } } }));
  assert.equal(j.tapyor_error, 'bad_request'); assert.equal(j.error, 'bad json');

  // Не настроен закрытый ключ: ядро отвечает not-configured 500 → наш код not_configured
  const saved = process.env.LICENSE_PRIVATE_KEY;
  delete process.env.LICENSE_PRIVATE_KEY;
  try {
    const r = await lic(ev({ action: 'trial', pack: 'streamer-pack', fp: ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)] }, { requestContext: { identity: { sourceIp: '6.6.6.3' } } }));
    j = json(r);
    assert.equal(r.statusCode, 500);
    assert.equal(j.error, 'not-configured');
    assert.equal(j.tapyor_error, 'not_configured');
  } finally { if (saved !== undefined) process.env.LICENSE_PRIVATE_KEY = saved; }
});
