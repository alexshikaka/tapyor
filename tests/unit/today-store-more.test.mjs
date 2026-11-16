// T1: дополнение к today-store.test.mjs — BOM, JSON не того вида, перенос из настроек,
// задержка записи и сброс состояния. Диск — только временные папки.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../../src/today-store.js');

const dirs = [];
function tempFile(name) {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-today-'));
  dirs.push(dir);
  return join(dir, name || 'today.json');
}
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('today-store: задержка записи 400 мс объявлена', () => {
  assert.equal(T.DELAY, 400);
});

test('today-store.get: без setup очередь пустая и ничего не пишется', () => {
  T.setup({});
  assert.equal(T.get(), null);
  T.flush();
  assert.equal(T.get(), null);
});

test('today-store: файл с BOM читается как обычный JSON', () => {
  const file = tempFile();
  writeFileSync(file, '\uFEFF' + JSON.stringify({ q: [1, 2] }), 'utf8');
  T.setup({ file });
  assert.deepEqual(T.get(), { q: [1, 2] });
});

test('today-store: массив и строка в файле — очередь пустая и запись в журнал', () => {
  for (const text of ['[1,2]', '"строка"', '42', '']) {
    const file = tempFile();
    writeFileSync(file, text, 'utf8');
    const logs = [];
    T.setup({ file, log: (s) => logs.push(s) });
    assert.equal(T.get(), null, text);
    assert.ok(logs.some((s) => s.includes('повреждён')), text + ': ' + logs.join(' | '));
  }
});

test('today-store: JSON null — пустая очередь без ошибки', () => {
  const file = tempFile();
  writeFileSync(file, 'null', 'utf8');
  const logs = [];
  T.setup({ file, log: (s) => logs.push(s) });
  assert.equal(T.get(), null);
  assert.deepEqual(logs, []);
});

test('today-store: set и flush пишут файл, set(null) убирает его', () => {
  const file = tempFile();
  T.setup({ file });
  T.set({ a: 1 });
  T.flush();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { a: 1 });
  T.set(null);
  T.flush();
  assert.equal(existsSync(file), false);
});

test('today-store: flush без изменений ничего не пишет', () => {
  const file = tempFile();
  T.setup({ file });
  T.flush();
  assert.equal(existsSync(file), false);
});

test('today-store: setup сбрасывает прочитанное, следующее чтение берёт файл заново', () => {
  const file = tempFile();
  writeFileSync(file, JSON.stringify({ n: 1 }), 'utf8');
  T.setup({ file });
  assert.deepEqual(T.get(), { n: 1 });
  writeFileSync(file, JSON.stringify({ n: 2 }), 'utf8');
  assert.deepEqual(T.get(), { n: 1 }, 'в памяти до сброса');
  T.setup({ file });
  assert.deepEqual(T.get(), { n: 2 });
});

test('today-store.takeFromSettings: без файла, без настроек и без ключа — ничего не делаем', () => {
  T.setup({});
  assert.deepEqual(T.takeFromSettings({ today: { a: 1 } }), { moved: false, today: null });
  const file = tempFile();
  T.setup({ file });
  assert.deepEqual(T.takeFromSettings(null), { moved: false, today: null });
  assert.deepEqual(T.takeFromSettings('строка'), { moved: false, today: null });
  assert.deepEqual(T.takeFromSettings([]), { moved: false, today: null });
  assert.deepEqual(T.takeFromSettings({ other: 1 }), { moved: false, today: null });
});

test('today-store.takeFromSettings: старый ключ переносится и удаляется из настроек', () => {
  const file = tempFile();
  T.setup({ file });
  const settings = { today: { queue: ['x'] }, other: 1 };
  const r = T.takeFromSettings(settings);
  assert.equal(r.moved, true);
  assert.deepEqual(r.today, { queue: ['x'] });
  assert.equal('today' in settings, false);
  T.flush();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { queue: ['x'] });
});

test('today-store.takeFromSettings: массив в старом ключе — очередь пустая', () => {
  const file = tempFile();
  T.setup({ file });
  const r = T.takeFromSettings({ today: [1, 2] });
  assert.equal(r.moved, true);
  assert.equal(r.today, null);
  T.flush();
  assert.equal(existsSync(file), false);
});

test('today-store.takeFromSettings: today.json главнее старого ключа, даже если он битый', () => {
  const file = tempFile();
  writeFileSync(file, '{битый', 'utf8');
  const logs = [];
  T.setup({ file, log: (s) => logs.push(s) });
  const r = T.takeFromSettings({ today: { старый: true } });
  assert.equal(r.moved, true);
  assert.equal(r.today, null, 'битый файл главнее старого ключа');
  assert.ok(logs.some((s) => s.includes('повреждён')));

  const good = tempFile();
  writeFileSync(good, JSON.stringify({ новый: true }), 'utf8');
  T.setup({ file: good });
  const r2 = T.takeFromSettings({ today: { старый: true } });
  assert.deepEqual(r2.today, { новый: true });
});
