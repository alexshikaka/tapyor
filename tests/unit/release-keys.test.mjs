// Ключи подписи обновлений: разбор src/update-keys.json и сверка наборов.
// Без ключей проверка подписи обновлений в программе выключена — выпуск не должен уходить молча.
import { test } from 'node:test';
import assert from 'node:assert';
import { parseKeys, keyCheck, sameKeys } from '../../tools/lib/release-keys.mjs';

test('пустой список ключей — ошибка с понятным текстом', () => {
  const r = keyCheck('{ "keys": [] }');
  assert.equal(r.ok, false);
  assert.match(r.hint, /Создать ключи обновлений/);
  assert.match(r.hint, /проверка подписи/);
});

test('--allow-unsigned разрешает осознанный выпуск без подписи', () => {
  const r = keyCheck('{ "keys": [] }', { allowUnsigned: true });
  assert.equal(r.ok, true);
  assert.equal(r.unsigned, true);
});

test('один ключ — проверка пройдена, число в имени', () => {
  const r = keyCheck('{ "keys": ["AAAA"] }');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.match(r.name, /1/);
});

test('битый JSON — ошибка, а не тихий пропуск', () => {
  const r = keyCheck('{ ключи: ');
  assert.equal(r.ok, false);
});

test('parseKeys: пустые строки и не-строки отбрасываются', () => {
  assert.deepEqual(parseKeys('{ "keys": ["AAAA", "", "  ", 42, null] }'), ['AAAA']);
});

test('sameKeys не зависит от порядка ключей', () => {
  assert.equal(sameKeys(['AAAA', 'BBBB'], ['BBBB', 'AAAA']), true);
});

test('sameKeys: разные наборы и пустые — false', () => {
  assert.equal(sameKeys(['AAAA'], ['BBBB']), false);
  assert.equal(sameKeys(['AAAA', 'BBBB'], ['AAAA']), false);
  assert.equal(sameKeys([], []), false);
});
