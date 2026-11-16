// A9 аудита 0.34.0: 403 от донатов — такой же отзыв входа, как 401.
// Раньше Тапёр дважды переподключал опрос вместо «войдите заново».
// electron подменяется: модуль донатов берёт из него shell и safeStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === 'electron') return { shell: {}, safeStorage: { isEncryptionAvailable: () => false } };
  return orig.call(this, r, ...a);
};
const donations = require('../../src/donations.js');
Module._load = orig;

test('A9: 401 и 403 — вход отозван, дальше не переподключаем', () => {
  assert.equal(donations.pollErrorAction(401), 'auth');
  assert.equal(donations.pollErrorAction(403), 'auth', '403 — тот же отзыв входа');
});

test('A9: 429 — пауза, остальное — повтор с отступом', () => {
  assert.equal(donations.pollErrorAction(429), 'rate');
  for (const status of [0, 400, 404, 500, 502, 503, undefined]) {
    assert.equal(donations.pollErrorAction(status), 'retry', String(status));
  }
});
