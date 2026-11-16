// Метка сборки (А12): dev / stable / source и коммит. Зачем тест: по этой метке программа
// решает, показывать ли «dev» в шапке, и что писать в «О программе» и в отчётах об ошибках.
// Ошибка здесь = отладочная сборка выглядит стабильной (или наоборот).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildInfo, buildLabel } = require('../../src/build-info.js');

// Временная папка «приложения» с нужным package.json — как app.getAppPath() в сборке.
function appWith(pkg, isPackaged) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-buildinfo-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  return { getAppPath: () => dir, isPackaged, getVersion: () => pkg.version || '0.0.0' };
}

test('build-info: из исходников всегда source, даже если метка есть', () => {
  const app = appWith({ version: '0.32.0', tapyorBuild: 'stable', tapyorCommit: 'abc1234' }, false);
  const r = buildInfo(app);
  assert.equal(r.build, 'source');
  assert.equal(r.commit, 'abc1234', 'коммит из метки, если он есть');
});

test('build-info: метки нет — dev, а не stable', () => {
  const app = appWith({ version: '0.32.0' }, true);
  assert.equal(buildInfo(app).build, 'dev', 'по умолчанию стабильной себя не объявляет');
});

test('build-info: stable только явно, и коммит из метки', () => {
  const app = appWith({ version: '0.32.0', tapyorBuild: 'stable', tapyorCommit: 'abc1234' }, true);
  const r = buildInfo(app);
  assert.equal(r.build, 'stable');
  assert.equal(r.commit, 'abc1234');
  assert.equal(r.version, '0.32.0');
});

test('build-info: dev из закрытого CI и мусорная метка', () => {
  assert.equal(buildInfo(appWith({ version: '0.32.0', tapyorBuild: 'dev' }, true)).build, 'dev');
  assert.equal(buildInfo(appWith({ version: '0.32.0', tapyorBuild: 'что-то' }, true)).build, 'dev', 'непонятная метка — dev');
  assert.equal(buildInfo(appWith({ version: '0.32.0', tapyorBuild: 'STABLE' }, true)).build, 'stable', 'регистр не важен');
});

test('build-info: подпись для журнала и отчётов', () => {
  assert.equal(buildLabel({ version: '0.32.0', build: 'dev', commit: 'abc1234' }), '0.32.0 dev (abc1234)');
  assert.equal(buildLabel({ version: '0.32.0', build: 'stable', commit: 'abc1234' }), '0.32.0 stable (abc1234)');
  assert.equal(buildLabel({ version: '0.32.0', build: 'source', commit: 'abc1234' }), '0.32.0 из исходников (abc1234)');
  assert.equal(buildLabel({ version: '0.32.0', build: 'stable' }), '0.32.0 stable');
  assert.equal(buildLabel({}), '', 'пустое не даёт мусора в журнале');
});
