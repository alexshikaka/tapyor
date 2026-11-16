// 0.34.0, задание 6: сторож окна и имитация падений.
// Ни Electron, ни реального времени: всё на чистых функциях и временных папках.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wd = require('../../src/watchdog.js');
const store = require('../../src/settings-store.js');

const made = [];
function tmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-watchdog-' + tag + '-'));
  made.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
});

// ── Решение по причине падения ───────────────────────────────────────────────
test('падение: clean-exit и выход из программы не трогаем', () => {
  assert.equal(wd.goneDecision('clean-exit').action, 'ignore');
  assert.equal(wd.goneDecision('crashed', { quitting: true }).action, 'ignore');
  assert.equal(wd.goneDecision('crashed').action, 'restart');
  assert.equal(wd.goneDecision('oom').action, 'restart');
  assert.equal(wd.goneDecision(undefined).action, 'restart');
});

// ── Счёт петли: 3 за 10 минут, окно скользит ─────────────────────────────────
test('петля: четвёртое падение за 10 минут отклоняется, окно скользит', () => {
  const windowMs = 10 * 60 * 1000;
  const times = [0, 1000, 2000];
  assert.equal(wd.loopDecision(times, 3000, { max: 3, windowMs }).allowed, false);
  assert.equal(wd.loopDecision(times, 3000, { max: 3, windowMs }).count, 3);
  // ровно через 10 минут первое поднятие уходит из окна — снова можно
  assert.equal(wd.loopDecision(times, windowMs + 1, { max: 3, windowMs }).allowed, true);
  // а на 9:59 ещё нельзя
  assert.equal(wd.loopDecision(times, windowMs - 1000, { max: 3, windowMs }).allowed, false);
});

test('петля: ждать до края окна и не считать давние падения', () => {
  const windowMs = 60000, max = 3;
  const l = wd.loopDecision([0, 10000, 20000], 30000, { max, windowMs });
  assert.equal(l.allowed, false);
  assert.equal(l.waitMs, 30000); // первое из окна освободится через 0+60000-30000
  const old = wd.loopDecision([0, 1, 2], 999999, { max, windowMs });
  assert.equal(old.allowed, true);
  assert.equal(old.count, 0);
});

test('сторож: onGone считает поднятия и на четвёртом зовёт onLoop', () => {
  let t = 0;
  const loops = [], recovers = [];
  const w = wd.create({ now: () => t, log: () => {}, onLoop: (r) => loops.push(r), onRecover: (r) => recovers.push(r) });
  t = 1; assert.equal(w.onGone('crashed').action, 'restart');
  t = 2; assert.equal(w.onGone('oom').action, 'restart');
  t = 3; assert.equal(w.onGone('killed').action, 'restart');
  t = 4; assert.equal(w.onGone('crashed').action, 'loop');
  assert.equal(recovers.length, 3);
  assert.equal(loops.length, 1);
  assert.equal(w.state().restarts, 3);
  // через 10 минут от первого — снова можно
  t = 1 + wd.WINDOW_MS + 1;
  assert.equal(w.onGone('crashed').action, 'restart');
});

test('сторож: признак «поднято после сбоя» забирается один раз и стареет', () => {
  let t = 1000;
  let w = wd.create({ now: () => t, log: () => {} });
  assert.equal(w.takeRecover(), false);
  w.onGone('crashed');
  assert.equal(w.takeRecover(), true);
  assert.equal(w.takeRecover(), false, 'повторно не выдаётся');

  t = 5000;
  w = wd.create({ now: () => t, log: () => {}, recoverTtl: 1000 });
  w.onGone('crashed');
  t = 7001;
  assert.equal(w.takeRecover(), false, 'просроченный признак не включает музыку');
});

// ── Зависание: 15 секунд, отклик раньше — только запись ──────────────────────
test('зависание: 15 секунд без отклика → принудительный перезапуск', () => {
  let t = 5000, scheduled = null;
  const hangs = [];
  const w = wd.create({
    now: () => t, log: () => {}, hangMs: 15000,
    setTimeout: (fn) => { scheduled = fn; return 7; },
    clearTimeout: () => { scheduled = null; },
    onHang: (r) => hangs.push(r)
  });
  const r = w.onUnresponsive();
  assert.equal(r.action, 'wait');
  assert.equal(r.ms, 15000);
  assert.ok(scheduled, 'таймер поставлен');
  t = 20000; scheduled(); scheduled = null;
  assert.equal(hangs.length, 1);
  assert.equal(hangs[0].seconds, 15);
});

test('зависание: окно ожило раньше — таймер снят, в журнал секунды', () => {
  let t = 5000, scheduled = null;
  const w = wd.create({
    now: () => t, log: () => {},
    setTimeout: (fn) => { scheduled = fn; return 7; },
    clearTimeout: () => { scheduled = null; }
  });
  w.onUnresponsive();
  t = 11000;
  const r = w.onResponsive();
  assert.equal(r.action, 'alive');
  assert.equal(r.seconds, 6);
  assert.equal(scheduled, null, 'таймер снят');
  assert.equal(w.onResponsive().action, 'none');
});

test('зависание: 15 секунд считаются от начала, а не от обнаружения', () => {
  let t = 20000, scheduled = null, delay = -1;
  const hangs = [];
  const w = wd.create({
    now: () => t, log: () => {}, hangMs: 15000,
    setTimeout: (fn, ms) => { scheduled = fn; delay = ms; return 1; },
    clearTimeout: () => {},
    onHang: (r) => hangs.push(r)
  });
  // окно молчит с 14000 — обнаружено на 20000, ждать осталось 9 секунд
  const r = w.onUnresponsive(14000);
  assert.equal(r.action, 'wait');
  assert.equal(r.ms, 9000);
  assert.equal(delay, 9000);
  t = 29000; scheduled();
  assert.equal(hangs[0].seconds, 15);
});

test('зависание: resetHang снимает таймер без записи «ожило»', () => {
  let scheduled = null;
  const w = wd.create({
    now: () => 5000, log: () => {},
    setTimeout: (fn) => { scheduled = fn; return 1; },
    clearTimeout: () => { scheduled = null; }
  });
  w.onUnresponsive();
  w.resetHang();
  assert.equal(scheduled, null);
  assert.equal(w.onResponsive().action, 'none');
});

// ── Пульс окна: сон ПК не должен перезапускать живое окно ────────────────────
test('пульс: обычный тик — ждём, сон 10 минут — пропуск без перезапуска', () => {
  assert.equal(wd.heartbeatDecision({ now: 10000, lastTick: 8000, lastPong: 9000 }).action, 'wait');
  const sleep = wd.heartbeatDecision({ now: 10 * 60 * 1000 + 8000, lastTick: 8000, lastPong: 8000 });
  assert.equal(sleep.action, 'skip');
  assert.equal(sleep.pausedMs, 10 * 60 * 1000);
  // Граница: ровно три периода — ещё не сон; больше — сон/занятость главного процесса.
  // lastPong здесь свежий, чтобы проверять только промежуток между тиками.
  assert.equal(wd.heartbeatDecision({ now: 8000 + 3 * wd.PING_MS, lastTick: 8000, lastPong: 8000 + 3 * wd.PING_MS }).action, 'wait');
  assert.equal(wd.heartbeatDecision({ now: 8001 + 3 * wd.PING_MS, lastTick: 8000, lastPong: 8001 + 3 * wd.PING_MS }).action, 'skip');
});

test('пульс: после сна 10 минут окно не перезапускается', () => {
  let t = 8000, scheduled = null;
  const hangs = [];
  const w = wd.create({
    now: () => t, log: () => {},
    setTimeout: (fn) => { scheduled = fn; return 1; },
    clearTimeout: () => { scheduled = null; },
    onHang: (r) => hangs.push(r)
  });
  t = 10 * 60 * 1000 + 8000;
  const d = wd.heartbeatDecision({ now: t, lastTick: 8000, lastPong: 8000 });
  assert.equal(d.action, 'skip');
  // то, что делает главный процесс на skip: сбросить отсчёт, не звать onUnresponsive
  if (d.action === 'skip') w.resetHang();
  assert.equal(scheduled, null, 'таймер зависания не поставлен');
  assert.equal(hangs.length, 0, 'перезапуска нет');
  assert.equal(w.state().restarts, 0);
});

test('пульс: честное зависание 15+ секунд — перезапуск, но с запасом на ответ', () => {
  let t = 20000, scheduled = null, delay = -1;
  const hangs = [];
  const w = wd.create({
    now: () => t, log: () => {},
    setTimeout: (fn, ms) => { scheduled = fn; delay = ms; return 1; },
    clearTimeout: () => { scheduled = null; },
    onHang: (r) => hangs.push(r)
  });
  const d = wd.heartbeatDecision({ now: t, lastTick: 18000, lastPong: 5000 });
  assert.equal(d.action, 'hung');
  assert.equal(d.startedAt, 5000);
  const r = w.onUnresponsive(d.startedAt);
  assert.equal(r.action, 'wait');
  assert.ok(r.ms >= wd.MISS_MS, 'не меньше 5 секунд на ответ окна');
  assert.equal(delay, wd.MISS_MS);
  t = 25000; scheduled();
  assert.equal(hangs.length, 1, 'перезапуск случился');
  assert.equal(hangs[0].seconds, 20);
});

test('зависание: очень давнее начало всё равно ждёт MISS_MS от вызова', () => {
  let scheduled = null, delay = -1;
  const w = wd.create({
    now: () => 700000, log: () => {},
    setTimeout: (fn, ms) => { scheduled = fn; delay = ms; return 1; },
    clearTimeout: () => {}
  });
  const r = w.onUnresponsive(100000); // 10 минут назад
  assert.equal(r.action, 'wait');
  assert.equal(r.ms, wd.MISS_MS);
  assert.equal(delay, wd.MISS_MS);
  assert.ok(scheduled);
});

// ── Ввод секунд зависания ────────────────────────────────────────────────────
test('секунды зависания: только целое 5–60', () => {
  assert.equal(wd.parseHangSeconds(30), 30);
  assert.equal(wd.parseHangSeconds('30'), 30);
  assert.equal(wd.parseHangSeconds(' 5 '), 5);
  assert.equal(wd.parseHangSeconds(60), 60);
  assert.equal(wd.parseHangSeconds(61), null);
  assert.equal(wd.parseHangSeconds(4), null);
  assert.equal(wd.parseHangSeconds(0), null);
  assert.equal(wd.parseHangSeconds(-5), null);
  assert.equal(wd.parseHangSeconds(30.5), null);
  assert.equal(wd.parseHangSeconds('abc'), null);
  assert.equal(wd.parseHangSeconds(''), null);
  assert.equal(wd.parseHangSeconds(null), null);
  assert.equal(wd.parseHangSeconds(NaN), null);
  assert.equal(wd.parseHangSeconds(Infinity), null);
});

// ── Только тестовый профиль ─────────────────────────────────────────────────
test('имитации падений разрешены только в тестовом профиле', () => {
  assert.equal(wd.imitationGuard(true).ok, true);
  assert.equal(wd.imitationGuard(false).ok, false);
  assert.equal(wd.imitationGuard(undefined).ok, false);
  assert.match(wd.imitationGuard(false).error, /тестов/);
});

// ── Порча настроек: store поднимает их из .bak ──────────────────────────────
test('повреждение settings.json: копия .bak цела, настройки поднялись', () => {
  const dir = tmp('corrupt');
  const file = path.join(dir, 'settings.json');
  let t = new Date(2026, 10, 12, 12, 0, 0).getTime();
  fs.writeFileSync(file, JSON.stringify({ a: 1, today: { day: 'd', items: [1] } }), 'utf8');
  store.setup({ file, now: () => t });
  store.get('a');
  store.set('b', 2);
  store.flush();
  // вторая запись через 11 минут (R2: копии сдвигаются не чаще раза в 10 минут):
  // теперь .bak — прошлая исправная версия {a, b}
  t += 11 * 60 * 1000;
  store.set('c', 3);
  store.flush();
  const bakBefore = fs.readFileSync(file + '.bak', 'utf8');

  const bytes = wd.corruptSettings(file);
  assert.ok(bytes > 0);
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), bakBefore, '.bak не тронут');
  assert.throws(() => JSON.parse(fs.readFileSync(file, 'utf8')));

  const logs = [];
  store.setup({ file, log: (s) => logs.push(s) });
  assert.equal(store.get('a'), 1);
  assert.equal(store.get('b'), 2);
  assert.equal(store.get('c'), undefined, 'последняя запись могла не попасть в .bak — это допустимо');
  assert.ok(logs.some((s) => /файл повреждён/.test(s) && /восстановлено из \.bak/.test(s)));
  const broken = fs.readdirSync(dir).filter((n) => n.indexOf('settings.json.broken-') === 0);
  assert.equal(broken.length, 1, 'битый файл отложен отдельно');
});

test('повреждение settings.json без .bak: копия делается из исправного файла', () => {
  const dir = tmp('nobak');
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ keep: 'да' }), 'utf8');
  wd.corruptSettings(file);
  assert.ok(fs.existsSync(file + '.bak'), 'страховочная копия появилась');
  const logs = [];
  store.setup({ file, log: (s) => logs.push(s) });
  assert.equal(store.get('keep'), 'да');
});

test('порча без файла ничего не делает', () => {
  assert.equal(wd.corruptSettings(''), 0);
});
