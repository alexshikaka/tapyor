// B14: проверки CI ставят зависимости через `npm ci`, а не `npm install`.
// `npm install` может обновить пакеты мимо package-lock.json — тогда проверки
// идут не на том, что попадёт в сборку. Разбор YAML — через js-yaml из node_modules.
//
// В рабочем (закрытом) репозитории файлы лежат в .github/workflows/ и public/.github/workflows/
// (public/ потом ложится поверх открытого). В открытом снимке public/ уже развёрнут,
// поэтому ищем файлы там, где они есть, — тест не должен зависеть от раскладки.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function workflowFiles() {
  const files = [];
  for (const dir of ['.github/workflows', 'public/.github/workflows']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).sort()) {
      if (/\.ya?ml$/i.test(name)) files.push(path.join(dir, name).replace(/\\/g, '/'));
    }
  }
  return files;
}

function stepsOf(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const doc = yaml.load(text);
  const steps = [];
  for (const job of Object.values((doc && doc.jobs) || {})) {
    for (const step of (job && job.steps) || []) {
      if (step && typeof step.run === 'string') steps.push(step.run);
    }
  }
  return steps;
}

test('CI: файлы проверок есть и разбираются как YAML', () => {
  const files = workflowFiles();
  assert.ok(files.length > 0, 'не найдено ни одного файла проверок CI');
  for (const file of files) {
    assert.doesNotThrow(() => stepsOf(file), file + ' не разбирается как YAML');
  }
});

test('CI: установка зависимостей — только npm ci, не npm install', () => {
  for (const file of workflowFiles()) {
    for (const run of stepsOf(file)) {
      assert.ok(!/(^|\s)npm\s+install(\s|$)/.test(run), file + ': шаг использует npm install');
    }
  }
});

test('CI: проверки и сборка ставят зависимости через npm ci', () => {
  const required = ['.github/workflows/test.yml', '.github/workflows/build.yml'];
  for (const file of required) {
    // В открытом снимке test.yml может отсутствовать: там свои проверки.
    if (!fs.existsSync(path.join(ROOT, file))) continue;
    assert.ok(stepsOf(file).some((run) => /(^|\s)npm\s+ci(\s|$)/.test(run)),
      file + ' должен ставить зависимости через npm ci');
  }
});
