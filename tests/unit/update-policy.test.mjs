// R3: обновление не перезапускает программу посреди стрима.
// Решение — src/update-policy.js: чистая функция без Electron, поэтому проверяется здесь.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pol = require('../../src/update-policy.js');

// ── decide: все сочетания трёх входов ────────────────────────────────────────
// Строка: [sessionActive, playerBusy, installRequested] → что должно быть.
const CASES = [
  // стример сам нажал кнопку — ставим сразу, даже если играет музыка и заказы идут
  [true, true, true, 'install-now'],
  [true, false, true, 'install-now'],
  [false, true, true, 'install-now'],
  [false, false, true, 'install-now'],
  // сессии нет и музыка не играет — только что запустили программу, ничего не делали
  [false, false, false, 'install-now'],
  // хоть что-то было (играло или приходил заказ) или сейчас играет — ждём выхода
  [false, true, false, 'wait-quit'],
  [true, false, false, 'wait-quit'],
  [true, true, false, 'wait-quit'],
];

test('decide: все сочетания сессии, плеера и кнопки', () => {
  for (const [sessionActive, playerBusy, installRequested, want] of CASES) {
    assert.equal(pol.decide({ sessionActive, playerBusy, installRequested }), want,
      'sessionActive=' + sessionActive + ', playerBusy=' + playerBusy + ', installRequested=' + installRequested);
  }
  assert.equal(CASES.length, 8, 'сочетаний должно быть ровно 8');
});

test('decide: без явной активности сессии не перезапускаем (безопасный выбор)', () => {
  // Параметр забыли передать — это не повод закрыть программу посреди работы.
  assert.equal(pol.decide({}), 'wait-quit');
  assert.equal(pol.decide(), 'wait-quit');
  assert.equal(pol.decide({ playerBusy: false }), 'wait-quit');
});

// ── Сессия: играло что-то или приходил заказ в этом запуске ──────────────────
test('сессия: сначала не активна, после markPlayed — активна', () => {
  const s = pol.createSession();
  assert.equal(s.active(), false);
  s.markPlayed();
  assert.equal(s.active(), true);
});

test('сессия: после markOrder активна', () => {
  const s = pol.createSession();
  s.markOrder();
  assert.equal(s.active(), true);
});

test('сессия: счётчики независимы у разных запусков', () => {
  const a = pol.createSession();
  const b = pol.createSession();
  a.markPlayed();
  assert.equal(a.active(), true);
  assert.equal(b.active(), false, 'чужой запуск не делает сессию активной');
  b.markOrder();
  assert.equal(b.active(), true);
});

test('сессия: повторные отметки не ломают ответ', () => {
  const s = pol.createSession();
  s.markPlayed(); s.markPlayed(); s.markOrder(); s.markOrder();
  assert.equal(s.active(), true);
  assert.equal(typeof s.active(), 'boolean');
});
