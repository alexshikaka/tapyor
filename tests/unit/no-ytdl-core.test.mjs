// Запасной поток YouTube через @distube/ytdl-core убран 13.11 (решение владельца).
// Зачем тест: журнал владельца за 18.10–13.11 — 134 включения запасного пути, ни одного
// играющего трека. Библиотека исполняла скрипты YouTube внутри главного процесса, пользы
// не давала. Тест не даёт вернуть её случайно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

test('main.js: запасного потока через ytdl-core нет', () => {
  assert.doesNotMatch(mainSrc, /require\(\s*['"]@distube\/ytdl-core['"]\s*\)/, 'вернули require("@distube/ytdl-core")');
  assert.doesNotMatch(mainSrc, /\bytdl\.getInfo\b/, 'вернули вызов ytdl.getInfo');
});

test('package.json: зависимости @distube/ytdl-core нет', () => {
  const deps = pkg.dependencies || {};
  assert.equal(deps['@distube/ytdl-core'], undefined, 'вернули зависимость @distube/ytdl-core');
  const rootDeps = (lock.packages && lock.packages[''] && lock.packages[''].dependencies) || {};
  assert.equal(rootDeps['@distube/ytdl-core'], undefined, 'вернули @distube/ytdl-core в package-lock.json');
});
