// R2: очередь с позицией — в отдельном маленьком файле today.json (src/today-store.js).
// Только временные папки в os.tmpdir(): настоящая папка данных не читается.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const today = require('../../src/today-store.js');
const store = require('../../src/settings-store.js');

const made = [];
function tmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-today-' + tag + '-'));
  made.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
});

test('today-store: запись и чтение, копий .bak не делает', () => {
  const dir = tmp('rw');
  const file = path.join(dir, 'today.json');
  today.setup({ file });
  const value = { day: '2026-11-12', items: [{ src: 'ym', id: '1', title: 'Трек' }], current: 0, pos: 12.5, playing: true };
  today.set(value);
  assert.deepEqual(today.get(), value, 'в памяти — записанное значение');
  today.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), value, 'после flush файл на диске');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['today.json'], 'никаких .bak рядом нет');

  // новый запуск (setup заново) читает с диска
  today.setup({ file });
  assert.deepEqual(today.get(), value);
});

test('today-store: битый или отсутствующий файл → null, программа не падает', () => {
  const dir = tmp('broken');
  const file = path.join(dir, 'today.json');
  const logs = [];
  today.setup({ file, log: (s) => logs.push(s) });
  assert.equal(today.get(), null, 'файла нет — null');
  assert.ok(logs.some((s) => /очередь: файла today\.json ещё нет/.test(s)), 'отсутствие файла отмечено в журнале');

  fs.writeFileSync(file, '{"day": ', 'utf8');
  today.setup({ file, log: (s) => logs.push(s) });
  assert.equal(today.get(), null, 'битый файл — null');
  assert.ok(logs.some((s) => /очередь: файл повреждён/.test(s)), 'битый файл виден в журнале: ' + logs.join(' | '));

  fs.writeFileSync(file, '[1,2,3]', 'utf8');
  today.setup({ file, log: (s) => logs.push(s) });
  assert.equal(today.get(), null, 'массив — не очередь, тоже null');

  // после ошибки запись снова работает
  today.set({ day: 'd', items: [] });
  today.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { day: 'd', items: [] });
});

test('today-store: отложенная запись и flush без ожидания', async () => {
  const dir = tmp('delay');
  const file = path.join(dir, 'today.json');
  today.setup({ file });
  today.set({ n: 1 });
  assert.equal(fs.existsSync(file), false, 'сразу на диск не пишем');
  await new Promise((r) => setTimeout(r, 550));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 1 }, 'через 400 мс записано');

  today.set({ n: 2 });
  today.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 2 }, 'flush пишет сразу');
});

test('today-store: set(null) убирает файл, чтение даёт null', () => {
  const dir = tmp('clear');
  const file = path.join(dir, 'today.json');
  today.setup({ file });
  today.set({ a: 1 });
  today.flush();
  assert.equal(fs.existsSync(file), true);
  today.set(null);
  today.flush();
  assert.equal(fs.existsSync(file), false, 'файл убран');
  today.setup({ file });
  assert.equal(today.get(), null);
});

test('перенос: today уходит из settings.json в today.json, остальные ключи целы', () => {
  const dir = tmp('migrate');
  const settingsFile = path.join(dir, 'settings.json');
  const todayFile = path.join(dir, 'today.json');
  const queue = { day: '2026-11-12', items: [{ src: 'yt', id: 'x' }], current: 0, pos: 3, playing: false };
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'violet', savedLists: [{ title: 'Мой' }], today: queue }), 'utf8');

  // как при запуске: сначала настройки в памяти, потом перенос
  store.setup({ file: settingsFile });
  today.setup({ file: todayFile });
  const s = store.all();
  const r = today.takeFromSettings(s);
  assert.equal(r.moved, true, 'ключ today забрали из настроек');
  assert.equal('today' in s, false, 'в объекте настроек ключа больше нет');
  assert.equal(s.theme, 'violet', 'остальные ключи целы');
  assert.deepEqual(r.today, queue, 'перенесено без потерь');
  assert.deepEqual(today.get(), queue, 'очередь в памяти нового хранилища');

  // main.js: записать настройки обратно и сохранить очередь
  store.replace(s);
  store.flush();
  today.flush();

  const disk = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal('today' in disk, false, 'в settings.json ключа today нет');
  assert.equal(disk.theme, 'violet', 'настройки не испорчены');
  assert.deepEqual(disk.savedLists, [{ title: 'Мой' }], 'плейлисты целы');
  assert.deepEqual(JSON.parse(fs.readFileSync(todayFile, 'utf8')), queue, 'очередь в today.json');
});

test('перенос: если today.json уже есть, он главнее старого ключа в настройках', () => {
  const dir = tmp('migrate2');
  const todayFile = path.join(dir, 'today.json');
  const fresh = { day: '2026-11-12', items: [{ id: 'new' }] };
  fs.writeFileSync(todayFile, JSON.stringify(fresh), 'utf8');
  today.setup({ file: todayFile });
  const s = { theme: 'mono', today: { day: '2026-11-11', items: [{ id: 'old' }] } };
  const r = today.takeFromSettings(s);
  assert.equal(r.moved, true, 'старый ключ из настроек всё равно убираем');
  assert.equal('today' in s, false);
  assert.deepEqual(r.today, fresh, 'остаётся более свежий today.json');
  assert.deepEqual(today.get(), fresh);
});

test('перенос: нет ключа today — ничего не трогаем', () => {
  const dir = tmp('migrate3');
  const todayFile = path.join(dir, 'today.json');
  today.setup({ file: todayFile });
  const s = { theme: 'violet' };
  const r = today.takeFromSettings(s);
  assert.equal(r.moved, false);
  assert.deepEqual(s, { theme: 'violet' });
  assert.equal(fs.existsSync(todayFile), false, 'файл не создаём без надобности');
});
