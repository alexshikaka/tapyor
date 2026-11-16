import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// 29-debug.js — часть общего скрипта окна, но чистая проверка внизу файла экспортируется
// и в Node: DOM-код запускается только при наличии document.
const { isDebugCommand } = require('../../src/ui/29-debug.js');

test('вход в отладочное меню: регистр и лишние пробелы', () => {
  assert.equal(isDebugCommand('tapyor debug'), true);
  assert.equal(isDebugCommand('Tapyor Debug'), true);
  assert.equal(isDebugCommand('TAPYOR DEBUG'), true);
  assert.equal(isDebugCommand('  tapyor   debug  '), true);
  assert.equal(isDebugCommand('\ttapyor\tdebug\n'), true);
});

test('вход в отладочное меню: похожие запросы не подходят', () => {
  assert.equal(isDebugCommand('tapyor debugger'), false);
  assert.equal(isDebugCommand('tapyor debug 2'), false);
  assert.equal(isDebugCommand('tapyor'), false);
  assert.equal(isDebugCommand('debug'), false);
  assert.equal(isDebugCommand('tapyor  debug  now'), false);
  assert.equal(isDebugCommand('xtapyor debug'), false);
});

test('вход в отладочное меню: пустое и не строковое — не команда', () => {
  assert.equal(isDebugCommand(''), false);
  assert.equal(isDebugCommand('   '), false);
  assert.equal(isDebugCommand(null), false);
  assert.equal(isDebugCommand(undefined), false);
  assert.equal(isDebugCommand(42), false);
});
