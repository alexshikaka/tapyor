import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const peaks = require('../../src/debug-peaks.js');
const counters = require('../../src/debug-counters.js');

test('пики нагрузки: максимум и время фиксации', () => {
  const p = peaks.create();
  peaks.add(p, 100, 2.5, 1000);
  peaks.add(p, 120, 1.5, 2000); // память выросла, ЦП упал
  peaks.add(p, 110, 5.5, 3000); // память ниже пика, ЦП выше

  const s = peaks.snapshot(p);
  assert.equal(s.mem, 120);
  assert.equal(s.memAt, 2000);
  assert.equal(s.cpu, 5.5);
  assert.equal(s.cpuAt, 3000);
  assert.equal(s.lastMem, 110);
  assert.equal(s.lastCpu, 5.5);
  assert.equal(s.lastAt, 3000);
});

test('пики нагрузки: сброс начинает с текущего замера', () => {
  const p = peaks.create();
  peaks.add(p, 100, 2, 1000);
  peaks.add(p, 140, 7, 2000);
  peaks.add(p, 110, 3, 3000);

  peaks.reset(p, 4000);
  let s = peaks.snapshot(p);
  assert.equal(s.mem, 110);
  assert.equal(s.memAt, 4000);
  assert.equal(s.cpu, 3);
  assert.equal(s.cpuAt, 4000);

  // Меньше нового пика — не перебивает; выше — перебивает.
  peaks.add(p, 90, 1, 5000);
  peaks.add(p, 150, 8, 6000);
  s = peaks.snapshot(p);
  assert.equal(s.mem, 150);
  assert.equal(s.memAt, 6000);
  assert.equal(s.cpu, 8);
  assert.equal(s.cpuAt, 6000);
});

test('пики нагрузки: без замеров сброс оставляет пусто', () => {
  const p = peaks.create();
  peaks.reset(p, 1234);
  const s = peaks.snapshot(p);
  assert.equal(s.mem, null);
  assert.equal(s.cpu, null);
  assert.equal(s.memAt, 0);
  assert.equal(s.cpuAt, 0);
});

test('счётчики автопочинок: увеличение по сервисам и снимок', () => {
  const c = counters.create();
  assert.deepEqual(counters.snapshot(c), {
    youtube: 0, yandex: 0, donationalerts: 0, donatepay: 0, twitch: 0, lastfm: 0, github: 0, cloud: 0
  });
  counters.bump(c, 'youtube');
  counters.bump(c, 'youtube');
  counters.bump(c, 'twitch');
  counters.bump(c, 'неизвестный'); // молча игнорируем
  const s = counters.snapshot(c);
  assert.equal(s.youtube, 2);
  assert.equal(s.twitch, 1);
  assert.equal(s.yandex, 0);
  // 0.34.0, шаг 5: успешные и неуспешные считаются отдельно — «2 (1 не вышла)».
  counters.record(c, 'youtube', false);
  counters.record(c, 'youtube', true);
  counters.record(c, 'cloud', true);
  const d = counters.detail(c);
  assert.deepEqual(d.youtube, { ok: 3, fail: 1, total: 4 });
  assert.deepEqual(d.cloud, { ok: 1, fail: 0, total: 1 });
  assert.deepEqual(d.twitch, { ok: 1, fail: 0, total: 1 });
  assert.equal(counters.snapshot(c).youtube, 4);
  assert.equal(counters.snapshot(c).cloud, 1);
  counters.record(c, 'неизвестный', false); // молча игнорируем
  assert.equal(counters.snapshot(c).github, 0);
});
