import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const throttle = require('../../src/report-throttle.js');

const NOW = 1_800_000_000_000;

test('первая попытка по отпечатку разрешена', () => {
  assert.equal(throttle.attemptAllowed(NOW, 'abc123', Object.create(null)), true);
});

test('повтор того же отпечатка раньше 10 минут запрещён', () => {
  const state = Object.create(null);
  state.abc123 = NOW;
  assert.equal(throttle.attemptAllowed(NOW + 9 * 60 * 1000, 'abc123', state), false);
  assert.equal(throttle.attemptAllowed(NOW + 60 * 1000, 'abc123', state), false);
});

test('через 10 минут тот же отпечаток снова разрешён', () => {
  const state = Object.create(null);
  state.abc123 = NOW;
  assert.equal(throttle.attemptAllowed(NOW + throttle.ATTEMPT_MS, 'abc123', state), true);
  assert.equal(throttle.attemptAllowed(NOW + 11 * 60 * 1000, 'abc123', state), true);
});

test('другой отпечаток не ограничен чужим временем', () => {
  const state = Object.create(null);
  state.abc123 = NOW;
  assert.equal(throttle.attemptAllowed(NOW + 60 * 1000, 'def456', state), true);
});

test('без отпечатка не мешаем и не падаем на пустом состоянии', () => {
  assert.equal(throttle.attemptAllowed(NOW, '', null), true);
  assert.equal(throttle.attemptAllowed(NOW, 'abc123', null), true);
});
