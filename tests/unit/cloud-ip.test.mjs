// B10 / P5b M3: адрес клиента для лимитов. Берём только sourceIp облака, а X-Forwarded-For —
// лишь последнее значение и только если sourceIp нет. Первое значение клиент подставляет сам.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ipOf } = require('../../server/common/ip.js');

test('адрес из requestContext главнее X-Forwarded-For', () => {
  const e = { requestContext: { identity: { sourceIp: '203.0.113.5' } }, headers: { 'X-Forwarded-For': '1.2.3.4' } };
  assert.equal(ipOf(e), '203.0.113.5');
});

test('без sourceIp — последнее значение X-Forwarded-For, а не первое (первое подделывает клиент)', () => {
  const e = { headers: { 'X-Forwarded-For': '6.6.6.6, 198.51.100.7, 203.0.113.9' } };
  assert.equal(ipOf(e), '203.0.113.9');
  assert.equal(ipOf({ headers: { 'x-forwarded-for': ' 10.0.0.1 , 10.0.0.2 ' } }), '10.0.0.2');
});

test('пустой sourceIp не отменяет запасное значение из заголовка', () => {
  const e = { requestContext: { identity: { sourceIp: '' } }, headers: { 'X-Forwarded-For': '1.1.1.1, 2.2.2.2' } };
  assert.equal(ipOf(e), '2.2.2.2');
});

test('источника адреса нет — пустая строка (лимит по адресу не считается)', () => {
  assert.equal(ipOf({}), '');
  assert.equal(ipOf(null), '');
  assert.equal(ipOf({ headers: {} }), '');
  assert.equal(ipOf({ requestContext: { identity: {} }, headers: { 'X-Forwarded-For': '' } }), '');
});
