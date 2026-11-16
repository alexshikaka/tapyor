// B7b (P5c №2): импорт файла — путь, пришедший из окна (перетаскивание), главный процесс
// принимает только если это обычный файл понятного расширения и не больше 5 МБ.
// Кнопка «Выбрать файл…» показывает диалог в главном процессе: там путь выбирает человек,
// поэтому ограничение размера не применяется (выгрузки Telegram бывают большими).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PG = require('../../src/path-guard.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-path-guard-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function file(name, bytes) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, bytes == null ? 'Исполнитель — Название\n' : bytes);
  return p;
}

test('path-guard: импорт принимает обычный файл понятного расширения', () => {
  for (const name of ['list.txt', 'result.json', 'chat.html', 'songs.csv', 'songs.tsv', 'a.m3u', 'a.m3u8', 'a.pls']) {
    const r = PG.importFile(file(name));
    assert.equal(r.ok, true, name + ': ' + r.error);
    assert.equal(r.path, path.resolve(path.join(tmp, name)));
  }
});

test('path-guard: импорт не принимает чужое расширение, папку и несуществующий файл', () => {
  assert.equal(PG.importFile(file('song.mp3')).ok, false, 'музыка — не список песен');
  assert.equal(PG.importFile(file('evil.exe')).ok, false, 'программа');
  assert.equal(PG.importFile(file('noext')).ok, false, 'без расширения');
  assert.equal(PG.importFile(tmp).ok, false, 'папка');
  assert.equal(PG.importFile(path.join(tmp, 'нет-такого.txt')).ok, false, 'нет файла');
  assert.equal(PG.importFile('').ok, false);
  assert.equal(PG.importFile(null).ok, false);
  assert.equal(PG.importFile(42).ok, false);
  assert.equal(PG.importFile('list.txt').ok, false, 'относительный путь из окна не принимаем');
});

test('path-guard: импорт из перетаскивания — не больше 5 МБ', () => {
  const big = path.join(tmp, 'big.txt');
  fs.writeFileSync(big, Buffer.alloc(PG.IMPORT_MAX + 1, 0x41));
  const r = PG.importFile(big);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /5 МБ/);
  const ok = path.join(tmp, 'five.txt');
  fs.writeFileSync(ok, Buffer.alloc(PG.IMPORT_MAX, 0x41));
  assert.equal(PG.importFile(ok).ok, true, 'ровно 5 МБ — можно');
});

test('path-guard: файл из диалога можно больше 5 МБ, но не папку', () => {
  const big = path.join(tmp, 'huge.json');
  fs.writeFileSync(big, Buffer.alloc(PG.IMPORT_MAX + 10, 0x7B));
  assert.equal(PG.importFile(big).ok, false, 'по правилу перетаскивания — нет');
  assert.equal(PG.importFile(big, { maxBytes: 0 }).ok, true, 'выбранный в диалоге — да');
  assert.equal(PG.importFile(tmp, { maxBytes: 0 }).ok, false, 'папка — нет и из диалога');
});

// B7b (P5c №3): папки библиотеки. lib-add-folder принимает только существующую папку,
// lib-folder-tracks/lib-remove-folder — только папку из библиотеки (или сразу после
// проверенного перетаскивания), lib-drop — только музыку, плейлисты и обычные папки.

test('path-guard: папка библиотеки — обычная существующая папка, не системная и не корень диска', () => {
  const music = path.join(tmp, 'music');
  fs.mkdirSync(music, { recursive: true });
  assert.equal(PG.libraryFolder(music).ok, true);
  assert.equal(PG.libraryFolder(music).path, path.resolve(music));
  assert.equal(PG.libraryFolder(path.join(tmp, 'нет-такой')).ok, false, 'нет папки');
  assert.equal(PG.libraryFolder(file('note.txt')).ok, false, 'файл, а не папка');
  assert.equal(PG.libraryFolder('music').ok, false, 'относительный путь из окна не принимаем');
  assert.equal(PG.libraryFolder(null).ok, false);
  for (const d of ['C:\\Windows', 'C:\\Windows\\System32', 'C:\\Program Files', 'C:\\Program Files (x86)\\App', 'C:\\ProgramData', 'D:\\', 'C:\\']) {
    assert.equal(PG.libraryFolder(d).ok, false, d + ' — системная папка или корень диска');
  }
});

test('path-guard: символическая ссылка не считается папкой или файлом', (t) => {
  const target = path.join(tmp, 'real-folder');
  fs.mkdirSync(target, { recursive: true });
  const link = path.join(tmp, 'link-folder');
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { t.skip('нет прав на символические ссылки: ' + (e && e.code)); return; }
  assert.equal(PG.libraryFolder(link).ok, false, 'ссылка — не папка библиотеки');
  assert.equal(PG.dropPath(link).ok, false, 'ссылка — не то, что можно перетащить');
});

test('path-guard: lib-drop берёт музыку, плейлисты и папки, но не любой файл и не систему', () => {
  const music = path.join(tmp, 'drop-music');
  fs.mkdirSync(music, { recursive: true });
  const track = file('track.mp3');
  assert.equal(PG.dropPath(track).ok, true);
  assert.equal(PG.dropPath(file('video.mkv')).ok, true, 'видео тоже играет');
  assert.equal(PG.dropPath(file('list.m3u')).ok, true, 'M3U открывается как импорт');
  assert.equal(PG.dropPath(file('notes.txt')).ok, false, 'текст — не музыка');
  assert.equal(PG.dropPath(file('evil.exe')).ok, false);
  assert.equal(PG.dropPath(music).ok, true, 'обычная папка');
  assert.equal(PG.dropPath(path.join(tmp, 'нет-такой')).ok, false);
  assert.equal(PG.dropPath('C:\\Windows').ok, false, 'системную папку не обходим');
  assert.equal(PG.dropPath('').ok, false);
  assert.equal(PG.dropPath(null).ok, false);
});

test('path-guard: lib-folder-tracks/lib-remove-folder — только папки библиотеки', () => {
  const lib = path.join(tmp, 'library');
  const album = path.join(lib, 'album');
  const sub = path.join(album, 'cd1');
  fs.mkdirSync(sub, { recursive: true });
  const folders = [lib, album];
  assert.equal(PG.inLibraryFolder(lib, folders), true);
  assert.equal(PG.inLibraryFolder(album, folders), true);
  assert.equal(PG.inLibraryFolder(sub, folders), true, 'вложенная папка уже внутри библиотеки');
  assert.equal(PG.inLibraryFolder(tmp, folders), false);
  assert.equal(PG.inLibraryFolder('C:\\Windows', folders), false);
  assert.equal(PG.inLibraryFolder('', folders), false);
  assert.equal(PG.libraryFolderExact(album, folders), true);
  assert.equal(PG.libraryFolderExact(sub, folders), false, 'убрать можно только саму добавленную папку');
  assert.equal(PG.libraryFolderExact(tmp, folders), false);
  assert.equal(PG.libraryFolderExact(null, folders), false);
  assert.equal(PG.inLibraryFolder(album, []), false);
});
