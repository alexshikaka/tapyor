// A11 аудита 0.34.0: счётчик «сейчас получаем поток». Пока он не ноль,
// yt-dlp не обновляем — иначе подмена exe ломает только что запущенный поток.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const busy = require('../../src/stream-busy.js');

test('A11: счётчик потоков — сколько начали, столько и закончили', () => {
  busy.reset();
  assert.equal(busy.isBusy(), false);
  assert.equal(busy.begin(), 1);
  assert.equal(busy.begin(), 2);
  assert.equal(busy.isBusy(), true);
  assert.equal(busy.count(), 2);
  assert.equal(busy.end(), 1);
  assert.equal(busy.isBusy(), true, 'пока идёт хоть один поток — занято');
  assert.equal(busy.end(), 0);
  assert.equal(busy.isBusy(), false);
  assert.equal(busy.end(), 0, 'лишний end не уводит счётчик в минус');
  assert.equal(busy.end(), 0);
  assert.equal(busy.count(), 0);
});

test('A11: reset обнуляет счётчик (аварийный выход)', () => {
  busy.begin();
  busy.begin();
  busy.reset();
  assert.equal(busy.isBusy(), false);
  assert.equal(busy.count(), 0);
});
