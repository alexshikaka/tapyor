// Проверка путей, которые приходят из окна Тапёра (B7b, аудиты P5c №2 и №3).
// Главный процесс не верит окну на слово: файл для импорта и папки библиотеки проверяются
// здесь. Модуль без Electron и без записи на диск — только чтение состояния файлов,
// поэтому покрыт unit-тестами (tests/unit/path-guard.test.mjs).
'use strict';

const fs = require('fs');
const path = require('path');
const { MEDIA_EXT } = require('./tags');

// Что «Импорт» реально понимает. Тот же список — в фильтре диалога и в проверке перетаскивания.
const IMPORT_EXT = new Set(['.json', '.html', '.htm', '.csv', '.tsv', '.txt', '.m3u', '.m3u8', '.pls']);
// Файл из перетаскивания: больше 5 МБ в память целиком не читаем (и это не список песен).
const IMPORT_MAX = 5 * 1024 * 1024;

// Абсолютный путь любой платформы: приложение живёт на Windows, но тесты могут идти где угодно.
function isAbsolute(p) { return path.win32.isAbsolute(p) || path.posix.isAbsolute(p); }
function clean(p) { return typeof p === 'string' ? p.trim() : ''; }
function extOf(p) { return path.extname(p).toLowerCase(); }
function isMedia(p) { return MEDIA_EXT.includes(extOf(p)); }
// Плейлисты, которые библиотека разбирает сама (lib-drop по ним открывает «Импорт»).
function isPlaylist(p) { return /\.(m3u8?|pls)$/i.test(p); }

function lstatFile(p) {
  try {
    const st = fs.lstatSync(p);
    // Символическая ссылка может указывать куда угодно — обычным файлом не считаем.
    if (st.isSymbolicLink() || !st.isFile()) return { error: 'это не обычный файл' };
    return { st };
  } catch (e) { return { error: 'файл не найден или не читается' }; }
}

// Системные папки и корни дисков: обходить их в поисках музыки нельзя — это долго и не нужно.
// Сравниваем путями Windows (приложение живёт на Windows), поэтому проверка одинаково
// работает и в тестах на другой системе.
const SYSTEM_DIRS = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'];
function systemDirs() {
  const list = SYSTEM_DIRS.slice();
  for (const k of ['SystemRoot', 'windir', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData']) {
    if (process.env[k]) list.push(process.env[k]);
  }
  return list.map((d) => path.win32.resolve(String(d)).toLowerCase().replace(/\\+$/, ''));
}
function isSystemDir(p0) {
  const p = clean(p0);
  if (!p) return false;
  const r = path.win32.resolve(p).toLowerCase();
  if (/^[a-z]:\\*$/.test(r)) return true;              // корень диска: C:\ или D:\
  const low = r.replace(/\\+$/, '');
  return systemDirs().some((d) => low === d || low.startsWith(d + '\\'));
}

// Папка для библиотеки (кнопка «Добавить папку» или перетаскивание папки).
// Только существующая обычная папка, не ссылка, не системная и не корень диска.
function libraryFolder(p0) {
  const p = clean(p0);
  if (!p || !isAbsolute(p)) return { ok: false, error: 'путь к папке не выбран' };
  if (p.includes('\0')) return { ok: false, error: 'в пути недопустимый символ' };
  if (isSystemDir(p)) return { ok: false, error: 'системную папку или корень диска не добавляю' };
  let st;
  try { st = fs.lstatSync(p); } catch (e) { return { ok: false, error: 'папка не найдена' }; }
  if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, error: 'это не папка' };
  return { ok: true, path: path.resolve(p) };
}

// Что вообще можно перетащить в окно: музыку/видео, плейлист M3U/PLS, обычную папку.
// Всё остальное (текст, программы, ссылки, системные папки) — отказ.
function dropPath(p0) {
  const p = clean(p0);
  if (!p || !isAbsolute(p) || p.includes('\0')) return { ok: false };
  let st;
  try { st = fs.lstatSync(p); } catch (e) { return { ok: false }; }
  if (st.isSymbolicLink()) return { ok: false };
  if (st.isDirectory()) return isSystemDir(p) ? { ok: false } : { ok: true, folder: true };
  if (st.isFile() && (isMedia(p) || isPlaylist(p))) return { ok: true, file: true };
  return { ok: false };
}

// Ключ папки для сравнения: на Windows имена нечувствительны к регистру.
function folderKey(p) {
  const r = path.resolve(String(p || ''));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
function underFolder(p, dir) {
  const a = folderKey(p), b = folderKey(dir);
  if (!a || !b || a === b) return false;
  const rel = path.relative(b, a);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
// Папка уже в библиотеке (сама или внутри добавленной).
function inLibraryFolder(p, folders) {
  const a = folderKey(p);
  if (!a) return false;
  for (const f of folders || []) if (folderKey(f) === a || underFolder(p, f)) return true;
  return false;
}
// Убрать из библиотеки можно только ровно ту папку, которую добавляли.
function libraryFolderExact(p, folders) {
  const a = folderKey(p);
  if (!a) return false;
  return (folders || []).some((f) => folderKey(f) === a);
}

// Файл для «Импорта». options.maxBytes: 0 — без ограничения (файл выбрал человек в диалоге),
// иначе предел (по умолчанию 5 МБ) — для пути, который пришёл из окна перетаскиванием.
// → { ok: true, path, size } | { ok: false, error }
function importFile(p0, options) {
  const p = clean(p0);
  if (!p || !isAbsolute(p)) return { ok: false, error: 'путь к файлу не выбран' };
  if (p.includes('\0')) return { ok: false, error: 'в пути недопустимый символ' };
  if (!IMPORT_EXT.has(extOf(p))) return { ok: false, error: 'подходят только списки песен: json, html, csv, tsv, txt, m3u, m3u8, pls' };
  const r = lstatFile(p);
  if (r.error) return { ok: false, error: r.error };
  const max = options && options.maxBytes != null ? Number(options.maxBytes) : IMPORT_MAX;
  if (max > 0 && r.st.size > max) return { ok: false, error: 'файл больше 5 МБ — такой список не читаю' };
  return { ok: true, path: path.resolve(p), size: r.st.size };
}

module.exports = {
  IMPORT_EXT, IMPORT_MAX, importFile,
  libraryFolder, dropPath, inLibraryFolder, libraryFolderExact, isSystemDir, folderKey,
  isAbsolute, isMedia, isPlaylist
};
