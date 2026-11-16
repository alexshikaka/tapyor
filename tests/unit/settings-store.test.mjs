import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const store = require('../../src/settings-store.js');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

test('settings-store: файл с BOM читается, не считается битым и не откатывается на .bak', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-settings-bom-'));
  try {
    const file = join(dir, 'settings.json');
    writeFileSync(file, '\uFEFF' + JSON.stringify({ fromBom: 7 }), 'utf8');
    // Если бы файл признали битым, store поднял бы это значение из .bak.
    writeFileSync(file + '.bak', JSON.stringify({ fromBom: 99 }), 'utf8');
    const logs = [];
    store.setup({ file, log: (s) => logs.push(s) });
    assert.equal(store.get('fromBom'), 7, 'прочитано не из .bak');
    assert.ok(logs.some((s) => s.includes('настройки: в файле был BOM — убран')), 'нет записи в журнал про BOM: ' + logs.join(' | '));
    assert.equal(readdirSync(dir).some((f) => f.includes('.broken-')), false, 'файл признан битым');
  } finally {
    store.setup({ file: '' });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings-store: ротация назад (не чаще раза в 10 минут) и восстановление из .bak', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-settings-'));
  try {
    const file = join(dir, 'settings.json');
    let t = new Date(2026, 10, 12, 12, 0, 0).getTime();   // 12.11.2026, 12:00 по местному
    writeFileSync(file, JSON.stringify({ a: 1 }), 'utf8');
    store.setup({ file, now: () => t });
    store.get('a');
    store.set('b', 2);
    store.flush();
    assert.ok(existsSync(file + '.bak'), 'после первой записи должен быть .bak');

    // Второй сдвиг — только через 10 минут, а не сразу: иначе все 5 копий
    // оказываются за последние секунды (R2).
    store.set('c', 3);
    store.flush();
    assert.equal(existsSync(file + '.bak.1'), false, 'в пределах 10 минут копии не сдвигаются');

    t += 10 * MIN + 1;
    store.set('d', 4);
    store.flush();
    assert.ok(existsSync(file + '.bak.1'), 'через 10 минут — второй сдвиг');

    writeFileSync(file, Buffer.alloc(64));
    const logs = [];
    store.setup({ file, log: (s) => logs.push(s) });
    assert.equal(store.get('a'), 1);
    assert.ok(logs.some((s) => /восстановлено из \.bak/.test(s)));
  } finally {
    store.setup({ file: '' });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('копии: 100 записей за минуту — один сдвиг; через 11 минут — второй', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-settings-rotate-'));
  try {
    const file = join(dir, 'settings.json');
    let t = new Date(2026, 10, 12, 12, 0, 0).getTime();
    writeFileSync(file, JSON.stringify({ n: 0 }), 'utf8');
    // .bak уже есть от прошлого запуска: первый flush после запуска сдвигает всегда
    writeFileSync(file + '.bak', JSON.stringify({ old: true }), 'utf8');
    store.setup({ file, now: () => t });
    store.get('n');
    for (let i = 0; i < 100; i++) {
      store.set('n', i + 1);
      store.flush();
      t += 500;   // 100 записей = 50 секунд
    }
    assert.ok(existsSync(file + '.bak.1'), 'первый flush после запуска сдвинул копии');
    assert.equal(existsSync(file + '.bak.2'), false, 'за минуту сдвиг должен быть только один');
    const bak1 = readFileSync(file + '.bak.1', 'utf8');
    assert.deepEqual(JSON.parse(bak1), { old: true }, '.bak.1 — копия, которая была до запуска');

    t += 11 * MIN;
    store.set('n', 101);
    store.flush();
    assert.ok(existsSync(file + '.bak.2'), 'через 11 минут — второй сдвиг');
    assert.deepEqual(JSON.parse(readFileSync(file + '.bak.2', 'utf8')), { old: true }, '.bak.2 — прошлая .bak.1');
    assert.deepEqual(JSON.parse(readFileSync(file + '.bak.1', 'utf8')), { n: 0 }, '.bak.1 — прошлая .bak (до записи)');
  } finally {
    store.setup({ file: '' });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('суточные копии: одна за сутки, хранится 5, шестая вытесняет старую', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-settings-day-'));
  try {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ v: 0 }), 'utf8');
    const days = [];
    // 6 дней подряд: в каждый день первый flush делает суточную копию
    for (let i = 1; i <= 6; i++) {
      const t = new Date(2026, 10, i, 12, 0, 0).getTime();   // 1..6 ноября 2026
      days.push('settings.json.bak.day-2026-11-0' + i);
      store.setup({ file, now: () => t });
      store.set('v', i);
      store.flush();
      // в тот же день пишем ещё — второй суточной копии быть не должно
      store.set('v', i * 10);
      store.flush();
      assert.equal(readdirSync(dir).filter((n) => n.startsWith('settings.json.bak.day-')).length, Math.min(i, 5),
        'за сутки ровно одна суточная копия, хранится не больше 5');
    }
    for (const d of days.slice(1)) assert.ok(existsSync(join(dir, d)), 'есть ' + d);
    assert.equal(existsSync(join(dir, days[0])), false, 'самая старая суточная копия удалена (шестая вытеснила)');
    assert.equal(existsSync(join(dir, 'settings.json.bak.day-2026-11-07')), false, 'лишних копий нет');
  } finally {
    store.setup({ file: '' });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('восстановление: основной файл битый, .bak нет, есть суточная — поднимаем из суточной', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-settings-dayload-'));
  try {
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{ broken', 'utf8');
    writeFileSync(file + '.bak.day-2026-11-11', JSON.stringify({ fromDay: 'old' }), 'utf8');
    writeFileSync(file + '.bak.day-2026-11-12', JSON.stringify({ fromDay: 'fresh' }), 'utf8');
    const logs = [];
    store.setup({ file, log: (s) => logs.push(s) });
    assert.deepEqual(store.all(), { fromDay: 'fresh' }, 'взята самая новая суточная копия');
    assert.ok(logs.some((s) => /восстановлено из \.bak\.day-2026-11-12/.test(s)),
      'в журнале видно, откуда подняли: ' + logs.join(' | '));
    assert.equal(readdirSync(dir).some((n) => n.startsWith('settings.json.broken-')), true, 'битый файл отложен');
  } finally {
    store.setup({ file: '' });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('load: statSync не чаще раза в секунду, внешняя правка видна в пределах секунды', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-settings-stat-'));
  try {
    const file = join(dir, 'settings.json');
    let t = 1_000_000;
    writeFileSync(file, JSON.stringify({ a: 1 }), 'utf8');
    store.setup({ file, now: () => t });
    assert.equal(store.get('a'), 1);

    // файл поменяли снаружи (метку времени двигаем руками — так надёжнее на любом диске)
    writeFileSync(file, JSON.stringify({ a: 2 }), 'utf8');
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);

    t += 500;
    assert.equal(store.get('a'), 1, 'в пределах секунды — из памяти, без statSync');
    t += 600;
    assert.equal(store.get('a'), 2, 'через секунду внешняя правка подхвачена');
  } finally {
    store.setup({ file: '' });
    rmSync(dir, { recursive: true, force: true });
  }
});
