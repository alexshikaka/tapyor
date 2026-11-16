// L11 (аудит 0.32.0): триал может кончиться во время работы — состояние лицензии пересчитывается раз в час.
// «Пора ли пересчитывать» и «не чаще раза в сутки ходить на сервер за временем» — чистые функции, проверяем их.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../../src/license-schedule.js');

const H = 3600000;

test('L11: периоды — час на пересчёт лицензии, сутки на время сервера', () => {
  assert.equal(S.LICENSE_RECHECK_MS, H);
  assert.equal(S.SERVER_TIME_MS, 24 * H);
});

test('L11: «пора ли пересчитывать лицензию» — чистая функция', () => {
  assert.equal(S.licenseRecheckDue(0, 1000), true, 'ещё не считали');
  assert.equal(S.licenseRecheckDue(undefined, 1000), true);
  assert.equal(S.licenseRecheckDue(1000, 1000), false, 'только что считали');
  assert.equal(S.licenseRecheckDue(1000, 1000 + H - 1), false, 'час ещё не прошёл');
  assert.equal(S.licenseRecheckDue(1000, 1000 + H), true, 'прошёл час');
  assert.equal(S.licenseRecheckDue(1000, 1000 + 5 * H), true);
  assert.equal(S.licenseRecheckDue(1000, 500), true, 'часы перевели назад — пересчитываем');
  assert.equal(S.licenseRecheckDue(1000, 61000, 60000), true, 'свой период');
  assert.equal(S.licenseRecheckDue(1000, 60000, 60000), false);
});

test('L11: время сервера — не чаще раза в сутки, ошибка тоже кэшируется', async () => {
  let t = 1000, calls = 0;
  const c = S.createTimeCache({ ttl: 24 * H, now: () => t, load: async () => { calls++; return t + 5000; } });
  assert.equal(await c.get(), 6000);
  assert.equal(await c.get(), 6000);
  assert.equal(calls, 1, 'второй раз — из кэша, а не запрос');
  t += 24 * H - 1;
  assert.equal(await c.get(), 6000);
  assert.equal(calls, 1, 'сутки ещё не прошли');
  t += 2;
  assert.equal(await c.get(), t + 5000);
  assert.equal(calls, 2, 'через сутки — снова запрос');

  // ошибка сети: 0 и тоже кэш — сервер не дёргаем на каждом пересчёте
  let bad = 0;
  const e = S.createTimeCache({ ttl: 24 * H, now: () => 5000, load: async () => { bad++; throw new Error('нет сети'); } });
  assert.equal(await e.get(), 0);
  assert.equal(await e.get(), 0);
  assert.equal(bad, 1);

  // два одновременных вопроса — одна загрузка
  let n = 0;
  const q = S.createTimeCache({ ttl: 1000, now: () => 1, load: () => new Promise((r) => { n++; setTimeout(() => r(42), 5); }) });
  const [a, b] = await Promise.all([q.get(), q.get()]);
  assert.equal(a, 42);
  assert.equal(b, 42);
  assert.equal(n, 1);
});
