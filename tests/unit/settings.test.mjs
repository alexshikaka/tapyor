import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const store = require('../../src/settings-store.js');

function tmp(){ return fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-settings-')); }

test('настройки: значения по умолчанию и set/get', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json');
  store.setup({ file });
  assert.deepEqual(store.all(), {});
  store.set('volume', 42);
  assert.equal(store.get('volume'), 42);
  store.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).volume, 42);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('настройки: replace сохраняет весь объект', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json');
  store.setup({ file });
  store.replace({ a: 1, b: 'x' });
  store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1, b: 'x' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('настройки: .bak создаётся до перезаписи', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ old: true }), 'utf8');
  store.setup({ file });
  store.all();
  store.set('new', true);
  store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')), { old: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { old: true, new: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('настройки: битый файл восстанавливается из .bak', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ broken', 'utf8');
  fs.writeFileSync(file + '.bak', JSON.stringify({ restored: true }), 'utf8');
  store.setup({ file });
  assert.deepEqual(store.all(), { restored: true });
  store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { restored: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('настройки: битый файл без .bak не роняет запуск', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ broken', 'utf8');
  store.setup({ file });
  assert.deepEqual(store.all(), {});
  store.set('ok', true);
  store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true });
  fs.rmSync(dir, { recursive: true, force: true });
});