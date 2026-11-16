// Проверка облачных функций: ответ облака → понятная причина и место, куда смотреть.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cc = require('../../src/cloud-check.js');

test('classify: живая функция, ключ, оплата, квоты, удалена, падение, сеть', () => {
  assert.equal(cc.classify(405, '{"error":"only POST"}'), 'ok');
  assert.equal(cc.classify(405, '{"error":"POST only"}'), 'ok');
  assert.equal(cc.classify(403, '{"error":"forbidden"}'), 'key');
  assert.equal(cc.classify(403, '<html>Billing account is suspended</html>'), 'billing');
  assert.equal(cc.classify(403, ''), 'billing');
  assert.equal(cc.classify(402, ''), 'billing');
  assert.equal(cc.classify(429, 'Too Many Requests'), 'quota');
  assert.equal(cc.classify(404, 'Not Found'), 'missing');
  assert.equal(cc.classify(502, 'Bad Gateway'), 'error');
  assert.equal(cc.classify(0, '', new Error('timeout')), 'net');
});

test('check + summary: всё хорошо и один отказ с подсказкой и ссылкой', async () => {
  const resp = { 'https://f/da': [405, '{"error":"only POST"}'], 'https://f/g': [403, 'billing account suspended'], 'https://f/r': [405, '{"error":"POST only"}'] };
  let sentKey = null;
  const fetch = async (u, o) => { sentKey = o.headers['x-k']; const [s, b] = resp[u]; return { status: s, text: async () => b }; };
  const list = await cc.check([{ id: 'da', url: 'https://f/da' }, { id: 'google', url: 'https://f/g' }, { id: 'report', url: 'https://f/r' }, { id: 'x', url: '' }], { fetch, key: 'K', keyHeader: 'x-k' });
  assert.equal(sentKey, 'K');
  assert.equal(list.length, 3);
  const s = cc.summary(list);
  assert.equal(s.state, 'bad');
  assert.match(s.text, /вход YouTube через Google: облако отказало/);
  assert.match(s.details, /center\.yandex\.cloud\/billing/);
  assert.deepEqual(cc.summary(list.filter((x) => x.kind === 'ok')).state, 'ok');
  assert.equal(cc.summary([]).state, 'off');
});

test('сеть упала — предупреждение, а не «сломано»', async () => {
  const list = await cc.check([{ id: 'da', url: 'https://f/da' }], { fetch: async () => { throw new Error('ETIMEDOUT'); }, key: 'K', keyHeader: 'h' });
  assert.equal(cc.summary(list).state, 'warn');
});
