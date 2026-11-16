// R6: общий тайм-аут для запросов без AbortSignal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { withTimeout } = require('../../src/with-timeout.js');

test('быстрый ответ проходит как есть', async () => {
  assert.equal(await withTimeout(Promise.resolve('ок'), 1000, 'проверка'), 'ок');
  assert.deepEqual(await withTimeout(Promise.resolve({ a: 1 }), 1000, 'проверка'), { a: 1 });
});

test('ошибка операции до срока — её же и отдаём', async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error('сеть упала')), 1000, 'проверка'), /сеть упала/);
});

test('нет ответа — понятная ошибка не позже срока', async () => {
  const t = Date.now();
  await assert.rejects(withTimeout(new Promise(() => {}), 1000, 'поиск YouTube'), /поиск YouTube: нет ответа за 1 с/);
  const spent = Date.now() - t;
  assert.ok(spent >= 900, 'сработал слишком рано: ' + spent + ' мс');
  assert.ok(spent < 2000, 'сработал слишком поздно: ' + spent + ' мс');
});

test('секунды в сообщении — из срока', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 2000, 'Вход YouTube'), /Вход YouTube: нет ответа за 2 с/);
});

test('поздний отказ проигравшего не всплывает необработанным', async () => {
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    let rejectLate;
    const slow = new Promise((_, reject) => { rejectLate = reject; });
    await assert.rejects(withTimeout(slow, 60, 'медленный'), /медленный: нет ответа/);
    rejectLate(new Error('поздний отказ'));
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(seen, [], 'поздний отказ остался необработанным');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
