// B7b (P5a №16): повторное нажатие «Поставить» не должно запускать тот же установщик
// второй раз. Перед spawn состояние становится 'installing', и следующий вызов ничего не делает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const updater = require('../../src/main/updater.js');

test('updater: установщик другого канала запускается только из состояния downloaded', () => {
  assert.equal(updater.canRunOtherInstaller({ channel: 'stable', version: '0.36.0', file: 'C:\\tmp\\a.exe', state: 'downloaded' }), true);
  assert.equal(updater.canRunOtherInstaller({ file: 'C:\\tmp\\a.exe', state: 'installing' }), false, 'уже ставится — второй раз нельзя');
  assert.equal(updater.canRunOtherInstaller({ file: 'C:\\tmp\\a.exe', state: 'downloading' }), false);
  assert.equal(updater.canRunOtherInstaller({ file: '', state: 'downloaded' }), false, 'нет файла');
  assert.equal(updater.canRunOtherInstaller({ state: 'downloaded' }), false);
  assert.equal(updater.canRunOtherInstaller(null), false);
  assert.equal(updater.canRunOtherInstaller(undefined), false);
});

// Проверка, что runOtherInstaller пользуется этим правилом: читаем исходник модуля.
// (Сам установщик не запускаем — тест не должен ничего ставить на ПК.)
test('updater: runOtherInstaller помечает installing до spawn и проверяет состояние', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const src = fs.readFileSync(path.join(root, 'src', 'main', 'updater.js'), 'utf8');
  const body = src.slice(src.indexOf('function runOtherInstaller'));
  assert.match(body, /canRunOtherInstaller\(otherJob\)/, 'проверка состояния');
  const setAt = body.indexOf("otherJob.state = 'installing'");
  const spawnAt = body.indexOf('spawn(');
  assert.ok(setAt > 0, 'состояние installing выставляется');
  assert.ok(spawnAt > 0 && setAt < spawnAt, 'installing — до запуска установщика');
});
