// T1: дополнение к vpn-nets.test.mjs — ASN и партнёрский CDN, проверка clean,
// склейка соседних и вложенных сетей, вычитание чужих сетей.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const V = require('../../src/vpn-nets.js');

test('vpn-nets: ASN Яндекса — десять номеров без повторов', () => {
  assert.equal(V.ASNS.length, 10);
  assert.equal(new Set(V.ASNS).size, V.ASNS.length);
  for (const a of V.ASNS) assert.match(a, /^AS\d+$/);
});

test('vpn-nets: партнёрский CDN входит во встроенный список, чужие сети — нет', () => {
  assert.deepEqual(V.EXTRA, ['178.176.128.0/18']);
  for (const e of V.EXTRA) assert.ok(V.NETS.includes(e), e);
  for (const d of V.DENY) {
    assert.match(d, /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/);
    assert.ok(!V.NETS.includes(d), d + ' не должна быть в списке Яндекса');
  }
  assert.equal(V.LINE, V.NETS.join(', '));
});

test('vpn-nets.clean: мусор, повторы и неверные маски отбрасываются', () => {
  assert.deepEqual(V.clean(['5.35.104.0/21', '5.35.104.0/21', '256.0.0.0/8', '1.2.3.4/0', '1.2.3.4/33', 'не сеть', '', null]), ['5.35.104.0/21']);
  assert.deepEqual(V.clean(null), []);
  assert.deepEqual(V.clean([]), []);
  assert.deepEqual(V.clean('5.35.104.0/21'), [], 'строка — не список');
});

test('vpn-nets.clean: сортировка числовая, а не по алфавиту', () => {
  const out = V.clean(['10.0.0.0/8', '9.0.0.0/8', '2.0.0.0/8']);
  assert.deepEqual(out, ['2.0.0.0/8', '9.0.0.0/8', '10.0.0.0/8']);
});

test('vpn-nets.collapse: пусто, одна сеть, соседние и вложенные', () => {
  assert.deepEqual(V.collapse([]), []);
  assert.deepEqual(V.collapse(['10.0.0.0/24']), ['10.0.0.0/24']);
  assert.deepEqual(V.collapse(['10.0.1.0/24', '10.0.0.0/24']), ['10.0.0.0/23'], 'соседние /24 склеиваются');
  assert.deepEqual(V.collapse(['10.0.0.0/16', '10.0.1.0/24']), ['10.0.0.0/16'], 'вложенная пропадает');
});

test('vpn-nets.withoutDeny: пустой запрет и запрет вне списка ничего не меняют', () => {
  const list = ['10.0.0.0/24', '10.0.1.0/24'];
  assert.deepEqual(V.withoutDeny(list, []), ['10.0.0.0/23']);
  assert.deepEqual(V.withoutDeny(list, ['192.168.0.0/16']), ['10.0.0.0/23']);
});

test('vpn-nets.withoutDeny: из широкой сети вырезается только чужой кусок', () => {
  assert.deepEqual(V.withoutDeny(['10.0.0.0/24'], ['10.0.0.128/25']), ['10.0.0.0/25']);
  assert.deepEqual(V.withoutDeny(['10.0.0.0/24'], ['10.0.0.0/24']), []);
  assert.deepEqual(V.withoutDeny(['10.0.0.0/23'], ['10.0.1.0/24']), ['10.0.0.0/24']);
});

test('vpn-nets.withoutDeny: запрет на всю сеть даёт пустой список', () => {
  assert.deepEqual(V.withoutDeny(['10.0.0.0/16'], ['10.0.0.0/8']), []);
});
