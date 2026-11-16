// B7b (P5a №3): битый update-keys.json раньше молча выключал проверку подписи обновлений —
// программа ставила что угодно. Теперь: файл есть, но не читается / не JSON / в нём не список
// ключей — это ошибка (обновления не ставим, в окне состояние ошибки). Пустой список — как раньше:
// проверка выключена.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const UK = require('../../src/update-keys.js');

test('update-keys: пустой список — проверка выключена, это не ошибка', () => {
  const r = UK.parseUpdateKeys('{"keys":[]}');
  assert.deepEqual(r.keys, []);
  assert.equal(r.error, '');
  assert.equal(r.disabled, true);
});

test('update-keys: годный список ключей читается', () => {
  const r = UK.parseUpdateKeys(JSON.stringify({ keys: [' AAA ', 'BBB', '', 7, null] }));
  assert.deepEqual(r.keys, ['AAA', 'BBB']);
  assert.equal(r.error, '');
  assert.equal(r.disabled, false);
});

test('update-keys: битый файл — ошибка, а не «проверка выключена»', () => {
  for (const text of ['', '   ', '{', 'не json', 'null', '[]', '42', '"строка"', '{}', '{"keys":null}', '{"keys":"key"}', '{"keys":{}}']) {
    const r = UK.parseUpdateKeys(text);
    assert.equal(r.error, UK.BROKEN_TEXT, 'должна быть ошибка для: ' + JSON.stringify(text));
    assert.deepEqual(r.keys, []);
    assert.equal(r.disabled, false);
  }
});

test('update-keys: текст ошибки для окна понятен', () => {
  assert.match(UK.BROKEN_TEXT, /подпис/i);
  assert.match(UK.BROKEN_TEXT, /сайт/i);
});
