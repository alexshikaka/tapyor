'use strict';
// Выбор папки данных Тапёра и уборка тестовых профилей (0.34.0, задание 4).
//
// Обычный запуск работает как раньше: env TAPYOR_USER_DATA → старые папки
// «Плеер для стрима» / «stream-player» → «Тапёр». Новое — флаг
// --tapyor-test-profile=<папка>: он проверяется ПЕРВЫМ и принимается, только если
// папка уже существует, лежит внутри os.tmpdir() и её имя начинается с «tapyor-test-».
// Иначе флаг молча игнорируется — обычный профиль открывается как обычно.
//
// Модуль без require('electron') и без обращений к реестру: его можно проверять
// unit-тестами на временных папках.
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_FLAG = '--tapyor-test-profile=';
const TEST_PREFIX = 'tapyor-test-';
const OLD_FOLDERS = ['Плеер для стрима', 'stream-player'];
const APP_FOLDER = 'Тапёр';

// Действующий ли сейчас тестовый профиль. Ставит pinUserData в main.js после
// выбора папки; читает modhost.js, чтобы не писать общий реестр из тестового профиля.
let activeTest = false;
function setTestProfileActive(v) { activeTest = !!v; }
function isTestProfileActive() { return activeTest; }

function argValue(argv, prefix) {
  for (const a of argv || []) {
    if (typeof a === 'string' && a.indexOf(prefix) === 0) return a.slice(prefix.length);
  }
  return '';
}

// Имя папки без учёта регистра диска (Windows): path.relative сам регистр не прощает.
function sameOrInside(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  const pp = process.platform === 'win32' ? p.toLowerCase() : p;
  const cc = process.platform === 'win32' ? c.toLowerCase() : c;
  const rel = path.relative(pp, cc);
  if (!rel) return false;                       // сам os.tmpdir() тестовым профилем не бывает
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && rel.indexOf('..' + path.sep) !== 0;
}

// Папка годится, только если это настоящая папка (не ссылка) внутри tmp с нужным именем.
function validTestProfileDir(dir, tmpdir, opts) {
  const o = opts || {};
  if (!dir) return false;
  const full = path.resolve(dir);
  const root = path.resolve(tmpdir || os.tmpdir());
  if (path.basename(full).indexOf(TEST_PREFIX) !== 0) return false;
  if (!sameOrInside(root, full)) return false;
  const check = o.isDir || ((p) => { try { const st = fs.lstatSync(p); return st.isDirectory() && !st.isSymbolicLink(); } catch (e) { return false; } });
  try { return !!check(full); } catch (e) { return false; }
}

function parseTestProfileArg(argv) {
  return argValue(argv, TEST_FLAG);
}

// Возвращает { path, test }. Живёт без Electron — appData передают снаружи.
function chooseUserData(o) {
  const opts = o || {};
  const argv = opts.argv || process.argv || [];
  const env = opts.env || process.env || {};
  const tmpdir = opts.tmpdir || os.tmpdir();
  const raw = parseTestProfileArg(argv);
  if (validTestProfileDir(raw, tmpdir, opts)) return { path: path.resolve(raw), test: true };
  if (env.TAPYOR_USER_DATA) {
    // Переменная могла остаться на бывшем тестовом профиле (%TEMP%\tapyor-test-*).
    // Такой путь открываем как ТЕСТОВЫЙ (плашка, без реестра): иначе обычный запуск
    // работал бы во временной папке, а уборка потом удалила бы её (аудит 0.34.0, A7).
    if (validTestProfileDir(env.TAPYOR_USER_DATA, tmpdir, opts)) return { path: path.resolve(env.TAPYOR_USER_DATA), test: true };
    return { path: env.TAPYOR_USER_DATA, test: false };
  }
  const appData = opts.appData || '';
  const exists = opts.exists || ((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  for (const n of OLD_FOLDERS) {
    const p = path.join(appData, n);
    if (exists(p)) return { path: p, test: false };
  }
  return { path: path.join(appData, APP_FOLDER), test: false };
}

function two(n) { return n < 10 ? '0' + n : String(n); }
function stampCompact(d) {
  return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
}

// Новая временная папка тестового профиля: %TEMP%\tapyor-test-<время>-<случайное>.
// Папку создаёт вызывающий (главный процесс) прямо перед перезапуском.
function makeTestProfileDir(tmpdir, now, rand) {
  const root = tmpdir || os.tmpdir();
  const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  const r = String(rand == null ? Math.random().toString(36).slice(2, 8) : rand).replace(/[^a-z0-9]/gi, '') || 'x';
  return path.join(root, TEST_PREFIX + stampCompact(d) + '-' + r);
}

// Файлы, которые Electron держит в папке данных, пока программа работает.
// Есть такой файл — папку не трогаем: её может держать живой тестовый профиль.
const LOCK_NAMES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];

function samePath(a, b) {
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

function profileBusy(dir, opts) {
  const o = opts || {};
  if (typeof o.isBusy === 'function') {
    try { if (o.isBusy(dir)) return true; } catch (e) { /* проверка не должна мешать уборке */ }
  }
  for (const n of LOCK_NAMES) {
    try { if (fs.existsSync(path.join(dir, n))) return true; } catch (e) {}
  }
  return false;
}

// Удаляет старые тестовые профили. Только папки, только с префиксом tapyor-test-
// и только внутри переданного tmpdir. Файлы с похожим именем не трогаются.
// Никогда не удаляет текущий профиль (opts.keep / opts.current) и папки, занятые
// работающим Тапёром (lock-файл Electron или opts.isBusy) — аудит 0.34.0, A7.
function cleanupOldTestProfiles(tmpdir, opts) {
  const o = opts || {};
  const root = path.resolve(tmpdir || os.tmpdir());
  const keep = [].concat(o.keep || [], o.current ? [o.current] : []).filter(Boolean);
  let names = [];
  try { names = fs.readdirSync(root); } catch (e) { return []; }
  const removed = [];
  for (const name of names) {
    if (name.indexOf(TEST_PREFIX) !== 0) continue;
    const p = path.join(root, name);
    let st = null;
    try { st = fs.lstatSync(p); } catch (e) { continue; }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    if (keep.some((k) => samePath(k, p))) continue;      // текущий профиль не трогаем
    if (profileBusy(p, o)) continue;                     // папку держит живой Тапёр
    const rm = o.rm || ((x) => fs.rmSync(x, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    try { rm(p); removed.push(name); } catch (e) { /* папку держит процесс — удалит следующий запуск */ }
  }
  return removed;
}

module.exports = {
  TEST_FLAG, TEST_PREFIX,
  chooseUserData, parseTestProfileArg, validTestProfileDir,
  makeTestProfileDir, cleanupOldTestProfiles, profileBusy,
  setTestProfileActive, isTestProfileActive
};
