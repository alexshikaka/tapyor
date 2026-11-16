// R5: обработчик ошибки локального сервера. Раньше он был один на всю жизнь:
// любая ошибка после успешного запуска закрывала сервер и перезапускала его на
// случайном порту (панель OBS теряла адрес) или показывала окно «не запущен».
// Теперь повтор и окно — только пока сервер ещё не начал слушать.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverErrors = require('../../src/server-errors.js');

test('server-errors: до запуска первая ошибка — повтор, вторая — окно', () => {
  assert.equal(serverErrors.errorAction({ listening: false, retried: false }), 'retry');
  assert.equal(serverErrors.errorAction({ listening: false, retried: true }), 'fatal');
});

test('server-errors: после успешного listen ошибка только пишется в журнал', () => {
  assert.equal(serverErrors.errorAction({ listening: true, retried: false }), 'log');
  assert.equal(serverErrors.errorAction({ listening: true, retried: true }), 'log');
});

test('server-errors: пустые данные — как «ещё не слушает»', () => {
  assert.equal(serverErrors.errorAction(), 'retry');
  assert.equal(serverErrors.errorAction(null), 'retry');
});
