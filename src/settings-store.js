// Настройки Тапёра (settings.json) — в памяти, с безопасной записью на диск.
// Раньше файл (~460 КБ с плейлистами) читался и разбирался при каждом cfg() и переписывался целиком при каждом изменении,
// а запись шла «поверх»: выключение ПК посреди записи → битый файл → при запуске {} → первое же изменение стирало всё.
// Теперь:
//  • читаем один раз и держим в памяти; если файл поменяли снаружи — перечитываем (проверка не чаще раза в секунду, R2);
//  • пишем через 400 мс после последнего изменения (пачкой), через временный файл и переименование;
//  • перед записью сохраняем прошлую исправную версию в settings.json.bak, но сдвигаем 5 копий
//    не чаще раза в 10 минут: иначе копии — это последние секунды, а не история (R2);
//  • раз в календарные сутки — копия settings.json.bak.day-ГГГГ-ММ-ДД (храним 5 последних);
//  • битый файл не затираем: откладываем копию settings.json.broken-<время> и поднимаем .bak,
//    а если его нет — суточную копию.
'use strict';
const fs = require('fs');
const path = require('path');

let FILE = '';
let log = () => {};
let now = Date.now;
const S = {
  data: null, mtime: 0, dirty: false, timer: null, good: false,
  lastStat: 0,   // когда последний раз проверяли файл на диске (statSync)
  lastRotate: 0, // когда последний раз сдвигали 5 копий
  day: ''        // за какие сутки уже сделана суточная копия
};
const DELAY = 400;
const BACKUPS = 5;
const STAT_MS = 1000;                 // не чаще раза в секунду (R2, пункт В)
const ROTATE_MS = 10 * 60 * 1000;     // сдвиг копий — не чаще раза в 10 минут
const DAYS_KEEP = 5;                  // сколько суточных копий храним

function setup(o) {
  const v = o || {};
  FILE = typeof v.file === 'string' ? v.file : '';
  if (typeof v.log === 'function') log = v.log;
  // Время — через передаваемую функцию (для тестов); без неё снова настоящие часы.
  now = typeof v.now === 'function' ? v.now : Date.now;
  S.data = null; S.mtime = 0; S.dirty = false; S.good = false;
  S.lastStat = 0; S.lastRotate = 0; S.day = '';
  clearTimeout(S.timer); S.timer = null;
}

function backupPath(n) { return FILE + '.bak' + (n ? '.' + n : ''); }
function dayStamp(t) {
  const d = new Date(t);
  const two = (x) => (x < 10 ? '0' + x : String(x));
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
function dailyPath(day) { return FILE + '.bak.day-' + day; }
function escapeRx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Только точный шаблон имени: settings.json.bak.day-ГГГГ-ММ-ДД. Чужие файлы не трогаем.
function dailyRx() { return new RegExp('^' + escapeRx(path.basename(FILE)) + '\\.bak\\.day-(\\d{4}-\\d{2}-\\d{2})$'); }
// Суточные копии, новые сверху (имя — дата, поэтому достаточно сравнить строки).
function dailyNames() {
  if (!FILE) return [];
  let names = [];
  try { names = fs.readdirSync(path.dirname(FILE)); } catch (e) { return []; }
  const rx = dailyRx();
  return names.filter((n) => rx.test(n)).sort().reverse();
}
function pruneDaily() {
  const all = dailyNames();
  const dir = path.dirname(FILE);
  for (let i = DAYS_KEEP; i < all.length; i++) {
    try { fs.unlinkSync(path.join(dir, all[i])); } catch (e) {}
  }
}

function readBackup() {
  // Сначала пять обычных копий: .bak — свежая, .bak.1…4 — старше.
  for (let n = 0; n < BACKUPS; n++) {
    const f = backupPath(n);
    try { return { data: parseFile(f), label: '.bak' + (n ? '.' + n : '') }; } catch (e) {}
  }
  // Затем суточные, от новой к старой. В журнале — тот же вид имени, что и у .bak.
  const dir = path.dirname(FILE);
  const base = path.basename(FILE);
  for (const name of dailyNames()) {
    try { return { data: parseFile(path.join(dir, name)), label: name.slice(base.length) }; } catch (e) {}
  }
  return null;
}
function rotateBackups(t) {
  // .bak — прошлая, .bak.1 — позапрошлая, ... .bak.4
  for (let n = BACKUPS - 1; n >= 1; n--) {
    const src = backupPath(n - 1), dst = backupPath(n);
    try { if (fs.existsSync(src)) fs.copyFileSync(src, dst); } catch (e) { log('настройки: копия ' + path.basename(dst) + ' не сдвинута — ' + (e && e.message ? e.message : e)); }
  }
  S.lastRotate = t;
}
function rotateDue(t) {
  // Первый flush после запуска сдвигает всегда («копия на запуск»). Сбитые назад
  // часы не должны «замораживать» копии навсегда — тогда тоже сдвигаем.
  return !S.lastRotate || t < S.lastRotate || t - S.lastRotate >= ROTATE_MS;
}
// Суточная копия: первый flush за календарные сутки копирует исправный файл с диска
// до записи нового. Один раз в сутки — поэтому существующую копию не перезаписываем.
function ensureDaily(t) {
  if (!S.good || !FILE) return;
  const day = dayStamp(t);
  if (S.day === day) return;
  const f = dailyPath(day);
  try {
    if (!fs.existsSync(f)) fs.copyFileSync(FILE, f);
    S.day = day;
    pruneDaily();
  } catch (e) {
    log('настройки: суточная копия не сделана — ' + (e && e.message ? e.message : e));
  }
}
function parseFile(f) {
  let text = fs.readFileSync(f, 'utf8');
  // 0.34.0: BOM в начале файла — не порча, а метка UTF-8. Раньше из-за неё JSON.parse
  // считал файл битым и откатывал на .bak. Теперь срезаем и пишем в журнал.
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
    log('настройки: в файле был BOM — убран');
  }
  const v = JSON.parse(text);
  // Валидный JSON может быть null, массивом или числом — это не настройки.
  // Иначе get() падает на null, а set() пишет в массив/строку.
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('settings: JSON is not an object');
  return v;
}

function load() {
  const t = now();
  // в памяти есть несохранённые изменения — берём из памяти
  if (S.data && S.dirty) return S.data;
  // файл проверяли меньше секунды назад — данные из памяти (R2, пункт В).
  // Внешняя правка всё равно подхватится: следующая проверка — через ≤ 1 с.
  if (S.data && S.lastStat && t >= S.lastStat && t - S.lastStat < STAT_MS) return S.data;
  S.lastStat = t;
  let st = null;
  try { st = fs.statSync(FILE); } catch (e) {}
  if (S.data && st && st.mtimeMs === S.mtime) return S.data;
  if (!st) {
    // файла нет (первый запуск или сбой между записями) — пробуем запасную копию
    const b = readBackup();
    S.data = (b && b.data) || {}; S.mtime = 0; S.good = false;
    if (b) { log('настройки: основного файла нет — восстановлено из ' + b.label); schedule(); }
    return S.data;
  }
  try {
    S.data = parseFile(FILE); S.mtime = st.mtimeMs; S.good = true;
  } catch (e) {
    const bad = FILE + '.broken-' + Date.now();
    try { fs.copyFileSync(FILE, bad); } catch (e2) { log('настройки: битый файл не отложен — ' + (e2 && e2.message ? e2.message : e2)); }
    const b = readBackup();
    log('настройки: файл повреждён (' + e.message + '), копия ' + path.basename(bad) + (b ? ', восстановлено из ' + b.label : ', запасной копии нет — начинаю с пустых'));
    S.data = (b && b.data) || {}; S.mtime = st.mtimeMs; S.good = false;
    schedule();
  }
  return S.data;
}

function schedule() {
  S.dirty = true;
  if (!S.timer) S.timer = setTimeout(flush, DELAY);
}

function flush() {
  clearTimeout(S.timer); S.timer = null;
  if (!S.dirty || !S.data || !FILE) return;
  const t = now();
  const tmp = FILE + '.tmp';
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(S.data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // прошлая версия на диске исправна — можно сделать суточную копию и сдвинуть ротацию
    if (S.good) {
      ensureDaily(t);
      if (rotateDue(t)) {
        rotateBackups(t);
        // .bak — ровно та версия, что сейчас на диске (до записи новой)
        try { fs.copyFileSync(FILE, backupPath(0)); } catch (e) { log('настройки: резервная копия не сделана — ' + (e && e.message ? e.message : e)); }
      }
    }
    try { fs.renameSync(tmp, FILE); }
    catch (e) { fs.writeFileSync(FILE, fs.readFileSync(tmp)); try { fs.unlinkSync(tmp); } catch (e2) {} }
    S.dirty = false; S.good = true;
    S.lastStat = t;
    try { S.mtime = fs.statSync(FILE).mtimeMs; } catch (e) {}
  } catch (e) { log('настройки: ошибка записи ' + e.message); }
}

const all = () => load();
const get = (k) => load()[k];
function set(k, v) { const s = load(); if (v == null) delete s[k]; else s[k] = v; schedule(); }
// Записать весь объект (после правок нескольких ключей)
function replace(obj) { load(); if (obj !== S.data) S.data = obj; schedule(); }

module.exports = { setup, all, get, set, replace, flush };
