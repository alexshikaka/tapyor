// G-05/TAP-05: лимит частоты облачных функций и общий суточный лимит автоотчётов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { staged } from './helpers/cloud-stage.mjs';

process.env.SHARED_KEY = 'K';
process.env.DA_CLIENT_ID = '1'; process.env.DA_CLIENT_SECRET = 's';
process.env.GOOGLE_CLIENT_ID = 'g'; process.env.GOOGLE_CLIENT_SECRET = 's';
process.env.GITHUB_TOKEN = 't'; process.env.GITHUB_REPO = 'o/r';
const da = staged('yc-da');
const gg = staged('yc-google');
const rp = staged('yc-report');
const H = { 'X-Tapyor-Key': 'K' };
const ev = (ip, body = { grant_type: 'refresh_token', refresh_token: 'x' }) => ({ httpMethod: 'POST', headers: H, body: JSON.stringify(body), requestContext: { identity: { sourceIp: ip } } });
const okFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) });

for (const [name, m] of [['yc-da', da], ['yc-google', gg]]) {
  test(name + ': 30 запросов за 10 минут с одного адреса, дальше 429 с Retry-After; другой адрес — проходит', async () => {
    m._rate.reset(); let calls = 0; global.fetch = async () => { calls++; return okFetch(); };
    for (let i = 0; i < 30; i++) assert.equal((await m.handler(ev('1.1.1.1'))).statusCode, 200);
    const r = await m.handler(ev('1.1.1.1'));
    assert.equal(r.statusCode, 429);
    assert.ok(Number(r.headers['Retry-After']) > 0 && Number(r.headers['Retry-After']) <= 600);
    assert.equal(calls, 30, 'к провайдеру лишний запрос не ушёл');
    assert.equal((await m.handler(ev('2.2.2.2'))).statusCode, 200);
  });
  test(name + ': через 10 минут адрес снова пускают', () => {
    m._rate.reset(); const t0 = 1e12;
    for (let i = 0; i < 30; i++) assert.equal(m._rate.wait(ev('3.3.3.3'), t0 + i), 0);
    assert.ok(m._rate.wait(ev('3.3.3.3'), t0 + 1000) > 0);
    assert.equal(m._rate.wait(ev('3.3.3.3'), t0 + 10 * 60 * 1000 + 50), 0);
  });
  test(name + ': общий предел — 120 в минуту на всех', () => {
    m._rate.reset(); const t0 = 2e12;
    for (let i = 0; i < 120; i++) assert.equal(m._rate.wait(ev('10.0.' + (i >> 8) + '.' + (i & 255)), t0), 0);
    assert.ok(m._rate.wait(ev('9.9.9.9'), t0) > 0);
    assert.equal(m._rate.wait(ev('9.9.9.9'), t0 + 60000), 0);
  });
  test(name + ': без ключа и GET лимит не тратят', async () => {
    m._rate.reset();
    for (let i = 0; i < 200; i++) await m.handler({ httpMethod: 'POST', headers: {}, body: '{}', requestContext: { identity: { sourceIp: '4.4.4.4' } } });
    global.fetch = okFetch;
    assert.equal((await m.handler(ev('4.4.4.4'))).statusCode, 200);
  });
}

const REP = (iid, fp = 'abc') => ({ httpMethod: 'POST', headers: H, requestContext: { identity: { sourceIp: '5.5.5.' + (iid.length % 200) } }, body: JSON.stringify({ fp, service: 'ym', stage: 'play', code: 'E1', msg: 'm', app: '0.32.0', iid }) });
test('yc-report: суточный лимит новых задач берётся у GitHub (общий для всех экземпляров)', async () => {
  rp._rate.reset(); let created = 0, searched = 0;
  global.fetch = async (url, o) => {
    const u = String(url);
    if (u.includes('/search/issues')) { searched++; assert.match(decodeURIComponent(u), /label:auto-report created:>=\d{4}-\d\d-\d\d/); return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 30 }) }; }
    if (u.includes('/issues?')) return { ok: true, status: 200, text: async () => '[]' };
    if (o && o.method === 'POST') { created++; return { ok: true, status: 201, text: async () => '{"number":1}' }; }
    throw new Error('unexpected ' + u);
  };
  const r = await rp.handler(REP('inst-1'));
  assert.equal(r.statusCode, 429);
  assert.equal(JSON.parse(r.body).error, 'daily limit');
  assert.equal(searched, 1); assert.equal(created, 0);
});
test('yc-report: GitHub не сказал счётчик — работает по памяти, задачу создаёт', async () => {
  rp._rate.reset(); let created = 0;
  global.fetch = async (url, o) => {
    const u = String(url);
    if (u.includes('/search/issues')) return { ok: false, status: 503, text: async () => 'down' };
    if (u.includes('/issues?')) return { ok: true, status: 200, text: async () => '[]' };
    created++; return { ok: true, status: 201, text: async () => '{"number":7}' };
  };
  const r = await rp.handler(REP('inst-2'));
  assert.equal(r.statusCode, 200); assert.equal(created, 1);
});
test('yc-report: одна установка — не чаще раза в минуту', async () => {
  rp._rate.reset();
  global.fetch = async (url) => (String(url).includes('/search/') ? { ok: true, status: 200, text: async () => '{"total_count":0}' } : String(url).includes('/issues?') ? { ok: true, status: 200, text: async () => '[]' } : { ok: true, status: 201, text: async () => '{"number":2}' });
  assert.equal((await rp.handler(REP('same'))).statusCode, 200);
  assert.equal((await rp.handler(REP('same'))).statusCode, 429);
});
