// G1: строки Streamer.bot в чеклисте — только когда заказы из чата идут через него.
// sbotEnabled значит «пульт был включён» (владелец когда-то подключал Streamer.bot),
// и сам по себе ошибку в чеклисте показывать не должен. Без сети, Electron и файлов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../src/sbot-check.js');

test('sbot-check: заказы через Streamer.bot — строки чеклиста показываем', () => {
  assert.equal(C.showInChecklist({ chatOrders: 'sbot', sbotEnabled: false }), true);
  assert.equal(C.showInChecklist({ chatOrders: 'sbot', sbotEnabled: true }), true);
  assert.equal(C.showInChecklist({ chatOrders: 'sbot' }), true);
});

test('sbot-check: заказы не через Streamer.bot — старый sbotEnabled не повод для ошибки', () => {
  assert.equal(C.showInChecklist({ chatOrders: 'pack', sbotEnabled: true }), false);
  assert.equal(C.showInChecklist({ chatOrders: 'none', sbotEnabled: true }), false);
  assert.equal(C.showInChecklist({ chatOrders: 'pack', sbotEnabled: false }), false);
});

test('sbot-check: пустые и испорченные настройки — не показываем', () => {
  assert.equal(C.showInChecklist(null), false);
  assert.equal(C.showInChecklist(undefined), false);
  assert.equal(C.showInChecklist({}), false);
  assert.equal(C.showInChecklist({ chatOrders: 'SBOT', sbotEnabled: true }), false);
});
