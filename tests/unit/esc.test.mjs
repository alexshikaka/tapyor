// esc() — единственное, что стоит между названием трека / именем донатера и innerHTML.
// Функция живёт в скрипте окна (src/ui/16-account.js), поэтому достаём её текст и
// выполняем в песочнице, а не тянем весь интерфейс.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync('src/ui/16-account.js', 'utf8');
const m = /function esc\(s\)\{[^\n]+\}/.exec(src);
assert.ok(m, 'функция esc не найдена в src/ui/16-account.js');
const ctx = {};
vm.runInNewContext(m[0] + '; this.esc = esc;', ctx);
const esc = ctx.esc;

test('esc: опасные символы экранированы', () => {
  assert.equal(esc('<b>'), '&lt;b&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('"x"'), '&quot;x&quot;');
  // одинарная кавычка: без неё атрибут в одинарных кавычках — дыра (аудит 01.11, M5)
  assert.equal(esc("it's"), 'it&#39;s');
});

test('esc: попытка вырваться из атрибута не проходит', () => {
  const name = `x' onmouseover='alert(1)`;          // «имя донатера»
  const html = `<span title='${esc(name)}'>`;
  assert.ok(!html.includes(`' onmouseover='`), html);
  const name2 = `x" onerror="alert(1)`;
  assert.ok(!(`<img alt="${esc(name2)}">`).includes(`" onerror="`));
});

test('esc: пустые значения', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});
