// R5: requests.json — список заказов. Верный JSON, но не список, раньше ронял
// requests.slice/requests.find в главном процессе. Теперь чтение проверяет массив,
// а запись идёт через временный файл с fsync (src/atomic-write.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const store = require('../../src/requests-store.js');

function tmpdir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-req-'));
  t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  return d;
}

function setup(t) {
  const dir = tmpdir(t);
  const logs = [];
  return { dir, logs, file: path.join(dir, 'requests.json'), log: (m) => logs.push(String(m)) };
}

function brokenFiles(dir) {
  return fs.readdirSync(dir).filter((n) => n.indexOf('.broken-') >= 0);
}

test('requests-store: читает верный файл-список и ничего не переименовывает', (t) => {
  const h = setup(t);
  const list = [{ key: 'da:1', name: 'зритель' }, { key: 'da:2' }];
  fs.writeFileSync(h.file, JSON.stringify(list), 'utf8');
  assert.deepEqual(store.read(h.file, { log: h.log }), list);
  assert.deepEqual(h.logs, [], 'без ошибок журнал молчит');
  assert.deepEqual(brokenFiles(h.dir), []);
  assert.equal(fs.existsSync(h.file), true);
});

test('requests-store: верный JSON, но не массив — как битый файл', (t) => {
  const h = setup(t);
  fs.writeFileSync(h.file, '{"ключ":"не список"}', 'utf8');
  assert.deepEqual(store.read(h.file, { log: h.log }), [], 'пустой список вместо падения');
  assert.ok(h.logs.length >= 1, 'в журнал записано');
  assert.equal(fs.existsSync(h.file), false, 'битый файл убран');
  const bad = brokenFiles(h.dir);
  assert.equal(bad.length, 1, 'рядом лежит .broken-…');
  assert.equal(fs.readFileSync(path.join(h.dir, bad[0]), 'utf8'), '{"ключ":"не список"}', 'содержимое сохранено');
});

test('requests-store: не массив, а .bak верный — восстановление из .bak', (t) => {
  const h = setup(t);
  fs.writeFileSync(h.file, '"строка вместо списка"', 'utf8');
  fs.writeFileSync(h.file + '.bak', JSON.stringify([{ key: 'da:7' }]), 'utf8');
  assert.deepEqual(store.read(h.file, { log: h.log }), [{ key: 'da:7' }]);
  assert.match(h.logs.join('\n'), /\.bak/);
  assert.deepEqual(brokenFiles(h.dir), [], 'при живой копии файл не переименовываем');
});

test('requests-store: битый JSON, а .bak верный — восстановление из .bak', (t) => {
  const h = setup(t);
  fs.writeFileSync(h.file, '{"оборвано":', 'utf8');
  fs.writeFileSync(h.file + '.bak', JSON.stringify([{ key: 'dp:1' }]), 'utf8');
  assert.deepEqual(store.read(h.file, { log: h.log }), [{ key: 'dp:1' }]);
  assert.deepEqual(brokenFiles(h.dir), []);
});

test('requests-store: оба файла битые — пустой список и .broken', (t) => {
  const h = setup(t);
  fs.writeFileSync(h.file, 'не json', 'utf8');
  fs.writeFileSync(h.file + '.bak', 'тоже не json', 'utf8');
  assert.deepEqual(store.read(h.file, { log: h.log }), []);
  assert.ok(h.logs.length >= 1);
  assert.equal(fs.existsSync(h.file), false);
  assert.equal(brokenFiles(h.dir).length, 1);
  assert.equal(fs.existsSync(h.file + '.bak'), true, '.bak не трогаем');
});

test('requests-store: запись оставляет .bak прошлой версии и кладёт новый список', (t) => {
  const h = setup(t);
  const oldList = [{ key: 'da:old' }];
  fs.writeFileSync(h.file, JSON.stringify(oldList), 'utf8');
  const ok = store.save(h.file, [{ key: 'da:new' }], { log: h.log });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file, 'utf8')), [{ key: 'da:new' }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file + '.bak', 'utf8')), oldList);
  assert.deepEqual(h.logs, []);
  const temp = fs.readdirSync(h.dir).filter((n) => n.indexOf('.tmp-') >= 0);
  assert.deepEqual(temp, [], 'временных файлов не осталось');
});

test('requests-store: запись хранит не больше 300 последних', (t) => {
  const h = setup(t);
  const list = Array.from({ length: 305 }, (_, i) => ({ key: 'da:' + i }));
  store.save(h.file, list, { log: h.log });
  const got = JSON.parse(fs.readFileSync(h.file, 'utf8'));
  assert.equal(got.length, 300);
  assert.equal(got[0].key, 'da:5');
  assert.equal(got[299].key, 'da:304');
});

test('requests-store: ошибка записи — журнал и false, без исключения', (t) => {
  const h = setup(t);
  const bad = path.join(h.dir, 'нет-такой-папки', 'requests.json');
  assert.doesNotThrow(() => store.save(bad, [{ key: 'da:1' }], { log: h.log }));
  assert.equal(store.save(bad, [{ key: 'da:1' }], { log: h.log }), false);
  assert.match(h.logs.join('\n'), /не сохранить/);
});
