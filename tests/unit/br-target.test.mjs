// B7b (P5c №10): br-audible(id) и br-nav(id) принимали любой webContents.id — можно было
// перезагрузить или перелистнуть не вкладку «Браузер», а главное окно либо окно входа.
// Теперь id принимается, только если это webview, прикреплённый к главному окну.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BT = require('../../src/br-target.js');

const MAIN = 7;
const good = (over = {}) => Object.assign({ id: 12, type: 'webview', destroyed: false, hostId: MAIN }, over);

test('br-target: webview главного окна — можно', () => {
  assert.equal(BT.targetOk(good(), MAIN), true);
});

test('br-target: чужое окно, другой хост, не webview — нельзя', () => {
  assert.equal(BT.targetOk(good({ type: 'window' }), MAIN), false, 'главное окно');
  assert.equal(BT.targetOk(good({ type: 'remote' }), MAIN), false);
  assert.equal(BT.targetOk(good({ hostId: 8 }), MAIN), false, 'webview другого окна');
  assert.equal(BT.targetOk(good({ hostId: 0 }), MAIN), false);
  assert.equal(BT.targetOk(good({ destroyed: true }), MAIN), false);
  assert.equal(BT.targetOk(good({ id: 0 }), MAIN), false);
  assert.equal(BT.targetOk(good({ id: -1 }), MAIN), false);
  assert.equal(BT.targetOk(good({ id: 1.5 }), MAIN), false);
  assert.equal(BT.targetOk(good({ id: '12' }), MAIN), true, 'числовая строка — тот же id');
});

test('br-target: без главного окна или без данных — нельзя', () => {
  assert.equal(BT.targetOk(good(), 0), false);
  assert.equal(BT.targetOk(good(), null), false);
  assert.equal(BT.targetOk(null, MAIN), false);
  assert.equal(BT.targetOk({}, MAIN), false);
});
