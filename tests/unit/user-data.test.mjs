// 0.34.0, задание 4: выбор папки данных и уборка тестовых профилей.
// Ни Electron, ни реестра: только временные папки в os.tmpdir().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ud = require('../../src/user-data.js');

const made = [];
function tmpRoot(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-unit-' + tag + '-'));
  made.push(d);
  return d;
}
function mk(root, name) {
  const p = path.join(root, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}
process.on('exit', () => {
  for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
});

const FLAG = '--tapyor-test-profile=';

test('флаг с верной папкой включает тестовый профиль', () => {
  const tmp = tmpRoot('valid');
  const dir = mk(tmp, 'tapyor-test-20261111-120000-abc123');
  const r = ud.chooseUserData({ argv: ['Tapyor.exe', FLAG + dir], env: {}, appData: tmp, tmpdir: tmp });
  assert.equal(r.test, true);
  assert.equal(r.path, path.resolve(dir));
});

test('флаг главнее env TAPYOR_USER_DATA', () => {
  const tmp = tmpRoot('flag-vs-env');
  const dir = mk(tmp, 'tapyor-test-1');
  const r = ud.chooseUserData({ argv: [FLAG + dir], env: { TAPYOR_USER_DATA: 'C:\\Old' }, appData: tmp, tmpdir: tmp });
  assert.equal(r.test, true);
  assert.equal(r.path, path.resolve(dir));
});

test('папка вне os.tmpdir — флаг игнорируется, работает env', () => {
  const tmp = tmpRoot('outside');
  const otherTmp = tmpRoot('outside-other');
  const dir = mk(otherTmp, 'tapyor-test-outside');
  const r = ud.chooseUserData({ argv: [FLAG + dir], env: { TAPYOR_USER_DATA: 'C:\\Old' }, appData: tmp, tmpdir: tmp });
  assert.equal(r.test, false);
  assert.equal(r.path, 'C:\\Old');
});

test('неверный префикс — флаг игнорируется', () => {
  const tmp = tmpRoot('prefix');
  const dir = mk(tmp, 'not-tapyor-test-1');
  const r = ud.chooseUserData({ argv: [FLAG + dir], env: {}, appData: tmp, tmpdir: tmp });
  assert.equal(r.test, false);
  assert.equal(r.path, path.join(tmp, 'Тапёр'));
});

test('папки нет — флаг игнорируется', () => {
  const tmp = tmpRoot('missing');
  const dir = path.join(tmp, 'tapyor-test-missing');
  const r = ud.chooseUserData({ argv: [FLAG + dir], env: {}, appData: tmp, tmpdir: tmp });
  assert.equal(r.test, false);
  assert.equal(r.path, path.join(tmp, 'Тапёр'));
});

test('без флага: env, затем старые папки, затем «Тапёр»', () => {
  const tmp = tmpRoot('usual');
  const appData = mk(tmp, 'appdata');
  const old = mk(appData, 'stream-player');

  let r = ud.chooseUserData({ argv: [], env: { TAPYOR_USER_DATA: 'C:\\Env' }, appData, tmpdir: tmp });
  assert.equal(r.path, 'C:\\Env');
  assert.equal(r.test, false);

  r = ud.chooseUserData({ argv: [], env: {}, appData, tmpdir: tmp });
  assert.equal(r.path, old);
  assert.equal(r.test, false);

  fs.rmSync(old, { recursive: true, force: true });
  r = ud.chooseUserData({ argv: [], env: {}, appData, tmpdir: tmp });
  assert.equal(r.path, path.join(appData, 'Тапёр'));
  assert.equal(r.test, false);
});

test('«Плеер для стрима» важнее «stream-player»', () => {
  const tmp = tmpRoot('order');
  const appData = mk(tmp, 'appdata');
  const a = mk(appData, 'Плеер для стрима');
  mk(appData, 'stream-player');
  const r = ud.chooseUserData({ argv: [], env: {}, appData, tmpdir: tmp });
  assert.equal(r.path, a);
});

test('уборка удаляет только папки tapyor-test-* внутри tmpdir', () => {
  const tmp = tmpRoot('clean');
  mk(tmp, 'tapyor-test-a');
  mk(tmp, 'tapyor-test-b-2');
  mk(tmp, 'other');
  fs.writeFileSync(path.join(tmp, 'tapyor-test-file'), 'x');
  const removed = ud.cleanupOldTestProfiles(tmp);
  assert.deepEqual(removed.sort(), ['tapyor-test-a', 'tapyor-test-b-2']);
  assert.equal(fs.existsSync(path.join(tmp, 'tapyor-test-a')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'tapyor-test-b-2')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'other')), true);
  assert.equal(fs.existsSync(path.join(tmp, 'tapyor-test-file')), true);
});

test('имя новой папки: tapyor-test-<время>-<случайное>', () => {
  const p = ud.makeTestProfileDir('C:\\Temp', new Date(2026, 10, 11, 21, 5, 7), 'ab12cd');
  assert.equal(path.basename(p), 'tapyor-test-20261111-210507-ab12cd');
  assert.equal(path.dirname(p), 'C:\\Temp');
});

test('validTestProfileDir принимает только настоящую папку внутри tmp', () => {
  const tmp = tmpRoot('valid-dir');
  const real = mk(tmp, 'tapyor-test-real');
  assert.equal(ud.validTestProfileDir(real, tmp), true);
  assert.equal(ud.validTestProfileDir(tmp, tmp), false);
  assert.equal(ud.validTestProfileDir(path.join(tmp, 'tapyor-test-nope'), tmp), false);
});

test('A7: env TAPYOR_USER_DATA на %TEMP%\\tapyor-test-* открывается как тестовый', () => {
  const tmp = tmpRoot('env-test');
  const dir = mk(tmp, 'tapyor-test-20261111-120000-abc');
  const r = ud.chooseUserData({ argv: [], env: { TAPYOR_USER_DATA: dir }, appData: tmp, tmpdir: tmp });
  assert.equal(r.test, true, 'временной тестовой папке — плашка и никакого реестра');
  assert.equal(r.path, path.resolve(dir));

  // Та же строка, но вне os.tmpdir() — обычный профиль, как раньше.
  const other = tmpRoot('env-other');
  const outside = mk(other, 'tapyor-test-outside');
  const r2 = ud.chooseUserData({ argv: [], env: { TAPYOR_USER_DATA: outside }, appData: tmp, tmpdir: tmp });
  assert.equal(r2.test, false);
  assert.equal(r2.path, outside);

  // Файл с похожим именем — не профиль.
  const fake = path.join(tmp, 'tapyor-test-file');
  fs.writeFileSync(fake, 'x');
  const r3 = ud.chooseUserData({ argv: [], env: { TAPYOR_USER_DATA: fake }, appData: tmp, tmpdir: tmp });
  assert.equal(r3.test, false);
});

test('A7: уборка не удаляет текущий профиль и занятые (lock-файл / isBusy)', () => {
  const tmp = tmpRoot('keep');
  const cur = mk(tmp, 'tapyor-test-current');
  const locked = mk(tmp, 'tapyor-test-locked');
  fs.writeFileSync(path.join(locked, 'SingletonLock'), 'x');
  const lockedOld = mk(tmp, 'tapyor-test-old-lock');
  fs.writeFileSync(path.join(lockedOld, 'lockfile'), 'x');
  const busy = mk(tmp, 'tapyor-test-busy');
  const free = mk(tmp, 'tapyor-test-free');
  const removed = ud.cleanupOldTestProfiles(tmp, {
    keep: [cur],
    isBusy: (p) => path.basename(p) === 'tapyor-test-busy',
  });
  assert.deepEqual(removed.sort(), ['tapyor-test-free']);
  for (const p of [cur, locked, lockedOld, busy]) assert.equal(fs.existsSync(p), true, 'не удалена: ' + p);
  assert.equal(fs.existsSync(free), false, 'свободную старую папку убрали');
  assert.equal(ud.profileBusy(locked), true);
  assert.equal(ud.profileBusy(free), false);
});
