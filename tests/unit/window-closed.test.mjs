// R12, п. 3: страховка окна. Если главное окно закрылось не через штатный путь
// (например, window.close() из страницы), программа не должна остаться без окна
// и без выхода. Штатные пути (крестик → трей или выход, трей, «Выход») не трогаем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wc = require('../../src/window-closed.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('идёт выход — ничего не делаем', () => {
  assert.equal(wc.closedDecision({ quitting: true }).action, 'none');
});

test('окно спрятано в трей (не закрыто) — ничего не делаем', () => {
  const d = wc.closedDecision({ quitting: false, hiddenToTray: true });
  assert.equal(d.action, 'none');
});

test('сторож пересоздаёт окно после падения — не выходим', () => {
  const d = wc.closedDecision({ quitting: false, hiddenToTray: false, recovering: true });
  assert.equal(d.action, 'none');
});

test('закрыто вне выхода — выйти штатно', () => {
  const d = wc.closedDecision({ quitting: false, hiddenToTray: false, recovering: false });
  assert.equal(d.action, 'quit');
  assert.match(d.why, /закрыто вне выхода/i);
});

test('без данных — выходим: лучше закрыться, чем остаться без окна', () => {
  assert.equal(wc.closedDecision().action, 'quit');
  assert.equal(wc.closedDecision(null).action, 'quit');
});

test('main.js: на closed главного окна решение берётся из модуля, выход штатный', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(src, /require\('\.\/window-closed'\)/, 'модуль подключён');
  // Ищем именно наш обработчик по вызову чистой функции: on('closed' в файле много,
  // например у окна входа Яндекса, — первый по тексту был бы не тот.
  const at = src.indexOf('windowClosedModule.closedDecision(');
  assert.ok(at > 0, 'в main.js есть вызов решения');
  const before = src.slice(Math.max(0, at - 800), at);
  assert.match(before, /on\('closed'/, 'вызов — в обработчике closed');
  const after = src.slice(at, at + 600);
  assert.match(after, /app\.isQuitting = true/, 'выход штатный');
  assert.match(after, /app\.quit\(\)/, 'выход штатный');
  assert.match(src, /окно закрыто вне выхода/, 'запись в журнал есть');
});
