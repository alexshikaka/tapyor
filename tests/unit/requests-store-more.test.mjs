// T1: дополнение к requests-store.test.mjs — пустой файл, отсутствие обоих файлов,
// сохранение не-списка, ровно 300 записей и ошибка записи.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../src/requests-store.js');

const dirs = [];
function tempFile(name) {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-requests-'));
  dirs.push(dir);
  return join(dir, name || 'requests.json');
}
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('requests-store: предел хранения — 300 записей', () => {
  assert.equal(R.MAX, 300);
});

test('requests-store.read: пустой файл — пустой список, битый файл отложен', () => {
  const file = tempFile();
  writeFileSync(file, '', 'utf8');
  const logs = [];
  assert.deepEqual(R.read(file, { log: (s) => logs.push(s) }), []);
  assert.ok(logs.some((s) => s.includes('не прочитать')));
  assert.ok(readdirSync(join(file, '..')).some((f) => f.includes('.broken-')), 'битый файл отложен');
});

test('requests-store.read: JSON null — не список, файл отложен', () => {
  const file = tempFile();
  writeFileSync(file, 'null', 'utf8');
  assert.deepEqual(R.read(file), []);
  assert.ok(readdirSync(join(file, '..')).some((f) => f.includes('.broken-')));
});

test('requests-store.read: нет ни основного, ни .bak — пустой список без исключения', () => {
  const file = tempFile();
  assert.deepEqual(R.read(file), []);
  assert.equal(readdirSync(join(file, '..')).length, 0, 'ничего не создаём');
});

test('requests-store.read: основной файл пропал, а .bak цел — восстанавливаем из .bak', () => {
  const file = tempFile();
  writeFileSync(file + '.bak', JSON.stringify([{ id: 1 }]), 'utf8');
  const logs = [];
  assert.deepEqual(R.read(file, { log: (s) => logs.push(s) }), [{ id: 1 }]);
  assert.ok(logs.some((s) => s.includes('восстановил из')));
});

test('requests-store.save: не список сохраняется как пустой список', () => {
  const file = tempFile();
  assert.equal(R.save(file, 'не список'), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), []);
  assert.equal(R.save(file, { a: 1 }), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), []);
});

test('requests-store.save: ровно 300 сохраняются все, 301 — только последние 300', () => {
  const file = tempFile();
  const list = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  assert.equal(R.save(file, list(300)), true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).length, 300);

  assert.equal(R.save(file, list(301)), true);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.length, 300);
  assert.equal(saved[0].id, 1, 'первая запись вытеснена');
  assert.equal(saved[299].id, 300);
});

test('requests-store.save: .bak хранит прошлую версию, пустой список тоже пишется', () => {
  const file = tempFile();
  writeFileSync(file, JSON.stringify([{ old: true }]), 'utf8');
  assert.equal(R.save(file, []), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), []);
  assert.deepEqual(JSON.parse(readFileSync(file + '.bak', 'utf8')), [{ old: true }]);
});

test('requests-store.save: ошибка записи — false и журнал, без исключения', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-requests-dir-'));
  dirs.push(dir);
  const target = join(dir, 'это-папка');
  mkdirSync(target);
  const logs = [];
  assert.equal(R.save(target, [{ id: 1 }], { log: (s) => logs.push(s) }), false);
  assert.ok(logs.some((s) => s.includes('не сохранить')), logs.join(' | '));
  assert.equal(existsSync(join(dir, 'это-папка')), true);
});
