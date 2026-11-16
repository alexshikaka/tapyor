// R5: общая запись файла «через временный» — временный файл рядом, fsync, переименование.
// Нужна кэшам (рецепты, справочники, сети Яндекса) и заказам: обрыв посреди записи
// не должен оставить половинчатый файл.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const atomic = require('../../src/atomic-write.js');

function tmpdir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-aw-'));
  t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  return d;
}

// Временные файлы нашего вида: «.<имя>.tmp-<pid>-<номер>»
function tempLeft(dir) {
  return fs.readdirSync(dir).filter((n) => n.indexOf('.tmp-') >= 0);
}

test('atomic-write: пишет новый файл', (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'lookup-cache.json');
  assert.equal(atomic.writeFileAtomic(file, '{"a":1}'), true);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
  assert.deepEqual(tempLeft(dir), [], 'временных файлов не осталось');
});

test('atomic-write: заменяет прошлое содержимое целиком', (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'cache.json');
  fs.writeFileSync(file, 'старое', 'utf8');
  atomic.writeFileAtomic(file, 'новое');
  assert.equal(fs.readFileSync(file, 'utf8'), 'новое');
  assert.deepEqual(tempLeft(dir), []);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['cache.json'], 'лишних файлов нет');
});

test('atomic-write: fsync идёт до переименования, а при сбое переименования временный файл убран', (t) => {
  const dir = tmpdir(t);
  // Путь назначения занят папкой: переименование файла поверх папки не удаётся
  // (и на Windows, и на Linux) — проверяем ветку ошибки.
  const target = path.join(dir, 'cache.json');
  fs.mkdirSync(target);
  const order = [];
  const origFsync = fs.fsyncSync;
  const origRename = fs.renameSync;
  fs.fsyncSync = function (...a) { order.push('fsync'); return origFsync.apply(fs, a); };
  fs.renameSync = function (...a) { order.push('rename'); return origRename.apply(fs, a); };
  t.after(() => { fs.fsyncSync = origFsync; fs.renameSync = origRename; });
  assert.throws(() => atomic.writeFileAtomic(target, 'x'), 'ошибка переименования не проглочена');
  assert.deepEqual(order, ['fsync', 'rename'], 'сначала сброс на диск, потом переименование');
  assert.deepEqual(tempLeft(dir), [], 'временный файл удалён');
});

test('atomic-write: ошибка открытия тоже пробрасывается', (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'нет-такой-папки', 'cache.json');
  assert.throws(() => atomic.writeFileAtomic(file, 'x'));
  assert.deepEqual(fs.readdirSync(dir), [], 'после себя ничего не оставил');
});

test('atomic-write: две записи подряд не путают временные файлы', (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'cache.json');
  atomic.writeFileAtomic(file, '1');
  atomic.writeFileAtomic(file, '2');
  assert.equal(fs.readFileSync(file, 'utf8'), '2');
  assert.deepEqual(tempLeft(dir), []);
});
