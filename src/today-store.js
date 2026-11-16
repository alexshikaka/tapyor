'use strict';
// Очередь с позицией («лента за сегодня») — в отдельном маленьком файле today.json (R2).
//
// Раньше очередь лежала в настройке `today` внутри settings.json. Во время игры окно
// пишет её каждые 5 секунд, а settings-store при каждой записи писал весь файл с
// плейлистами (~460 КБ) и сдвигал все 5 копий. Здесь только очередь: файл маленький,
// пишется с задержкой 400 мс, атомарно (временный файл + fsync + переименование).
//
// Правила:
//  • копий .bak не делаем: очередь — не то, что нужно беречь неделями, а копии
//    настроек разнесены по времени в settings-store;
//  • битый или отсутствующий файл → null (и строка в журнал для битого) — программа
//    не падает и просто начинает с пустой очереди;
//  • модуль без require('electron') на верхнем уровне: проверяется unit-тестами.
const fs = require('fs');
const path = require('path');

const DELAY = 400;
let FILE = '';
let log = () => {};

const S = { data: null, loaded: false, dirty: false, timer: null };

function setup(o) {
  const v = o || {};
  FILE = typeof v.file === 'string' ? v.file : '';
  log = typeof v.log === 'function' ? v.log : () => {};
  clearTimeout(S.timer);
  S.timer = null;
  S.data = null;
  S.loaded = false;
  S.dirty = false;
}

function parseText(text) {
  let t = String(text == null ? '' : text);
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);   // BOM — метка UTF-8, а не порча
  const v = JSON.parse(t);
  if (v == null) return null;                        // пустая очередь
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('JSON не объект');
  return v;
}

function load() {
  if (S.loaded) return S.data;
  S.loaded = true;
  if (!FILE) return (S.data = null);
  let text = '';
  try { text = fs.readFileSync(FILE, 'utf8'); }
  catch (e) {
    // Файла нет — это норма (первый запуск), но в журнале отметим: видно, что очередь пустая.
    if (e && e.code === 'ENOENT') log('очередь: файла today.json ещё нет — начинаю с пустой');
    else log('очередь: файл не прочитан (' + ((e && e.message) || e) + ')');
    S.data = null;
    return S.data;
  }
  try { S.data = parseText(text); }
  catch (e) {
    log('очередь: файл повреждён (' + (e.message || e) + ') — начинаю с пустой');
    S.data = null;
  }
  return S.data;
}

function schedule() {
  S.dirty = true;
  if (!S.timer) S.timer = setTimeout(flush, DELAY);
}

function get() { return load(); }

function set(v) {
  S.loaded = true;
  S.data = v == null ? null : v;
  schedule();
}

function flush() {
  clearTimeout(S.timer);
  S.timer = null;
  if (!S.dirty || !FILE) return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    if (S.data == null) {
      // Пустую очередь не храним: файла нет — чтение и так даёт null.
      try { fs.unlinkSync(FILE); } catch (e) { if (e && e.code !== 'ENOENT') throw e; }
      S.dirty = false;
      return;
    }
    const tmp = FILE + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(S.data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try { fs.renameSync(tmp, FILE); }
    catch (e) {
      fs.writeFileSync(FILE, fs.readFileSync(tmp));
      try { fs.unlinkSync(tmp); } catch (e2) {}
    }
    S.dirty = false;
  } catch (e) {
    log('очередь: ошибка записи ' + (e && e.message ? e.message : e));
  }
}

// A3, перенос без потерь: если в настройках ещё лежит ключ `today`, а today.json нет —
// забираем значение в новое хранилище и убираем ключ из объекта настроек.
// Возвращает { moved, today }. moved=true — main.js должен записать настройки обратно
// (writeSettingsFile + settingsDisk.flush) и вызвать flush() этого хранилища.
// Если today.json уже есть, он главнее старого ключа (после отката и повторного
// обновления в настройках может остаться устаревшая копия очереди).
function takeFromSettings(settings) {
  if (!FILE) return { moved: false, today: null };
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { moved: false, today: null };
  if (!Object.prototype.hasOwnProperty.call(settings, 'today')) return { moved: false, today: null };
  const old = settings.today;
  delete settings.today;

  // today.json уже есть (даже битый) — он главнее старого ключа: после отката версии
  // в настройках могла остаться устаревшая копия очереди.
  if (fs.existsSync(FILE)) return { moved: true, today: load() };

  S.loaded = true;
  S.data = (old && typeof old === 'object' && !Array.isArray(old)) ? old : null;
  if (S.data != null) schedule();
  return { moved: true, today: S.data };
}

module.exports = { setup, get, set, flush, takeFromSettings, DELAY };
