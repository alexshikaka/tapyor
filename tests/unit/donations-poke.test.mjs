// R4: после сна ПК опрос донатов не должен ждать накопленную паузу ошибок (до 5 минут).
// pokeNow() сбрасывает паузу и опрашивает сейчас; остановленный опрос не запускает;
// второй параллельный запрос не начинается.
// electron подменяется: модуль донатов берёт из него shell и safeStorage.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const origLoad = Module._load;
Module._load = function (r, ...a) {
  if (r === 'electron') return { shell: {}, safeStorage: { isEncryptionAvailable: () => false } };
  return origLoad.call(this, r, ...a);
};
const donations = require('../../src/donations.js');
Module._load = origLoad;

const realFetch = globalThis.fetch;
const flush = () => new Promise((r) => setImmediate(r));

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

function prepare() {
  const store = { donKeys: { da: b64(JSON.stringify({ at: 'tok', rt: 'refresh', exp: Date.now() + 3600 * 1000 })) } };
  const logs = [];
  donations.setup({
    log: (m) => logs.push(String(m)),
    store: { get: (k) => store[k], set: (k, v) => { store[k] = v; } },
    onDonation: async () => {},
    onStatus: () => {},
    onAuthError: () => {},
    onPollOk: () => {},
    onPollFail: () => {},
  });
  return { store, logs };
}

function ok(items) {
  return {
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ data: items || [] }),
  };
}

function fail(status) {
  return {
    ok: false, status, headers: { get: () => null },
    text: async () => JSON.stringify({ message: 'сбой' }),
  };
}

function clocked(t) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  t.after(() => {
    try { donations.stop(); } catch (e) {}
    mock.timers.reset();
    globalThis.fetch = realFetch;
  });
}

test('donations pokeNow: после сбоя опрашивает сразу, а не через накопленную паузу', async (t) => {
  clocked(t);
  prepare();
  const calls = [];
  let n = 0;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    n++;
    return n === 1 ? fail(500) : ok([]);
  };

  donations.start();
  mock.timers.tick(1500); // первый опрос по расписанию
  await flush();
  assert.equal(calls.length, 1, 'первый опрос прошёл');
  assert.equal(donations.status().da.ok, false, 'сбой записан');

  // Без pokeNow следующий запрос был бы только через ~24 с (пауза за 1 ошибку),
  // поэтому сначала отматываем 13 с — при обычной паузе запроса ещё нет.
  mock.timers.tick(13000);
  await flush();
  assert.equal(calls.length, 1, 'до pokeNow пауза ещё держит');

  assert.equal(donations.pokeNow(), 1, 'один активный сервис — один «разбудили»');
  await flush();
  assert.equal(calls.length, 2, 'после сна запрос ушёл сразу');
  assert.equal(donations.status().da.ok, true, 'опрос восстановился');

  // Пауза сброшена: следующий обычный опрос — через базовые 12 с (±8 %), а не через 24 с.
  mock.timers.tick(13000);
  await flush();
  assert.equal(calls.length, 3, 'дальше опрос идёт по обычному расписанию');
});

test('donations pokeNow: второй параллельный опрос не запускается', async (t) => {
  clocked(t);
  prepare();
  const calls = [];
  let release = null;
  globalThis.fetch = (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Promise((res) => { release = () => res(ok([])); });
    return Promise.resolve(ok([]));
  };

  donations.start();
  mock.timers.tick(1500);
  await flush();
  assert.equal(calls.length, 1, 'запрос уже идёт');
  assert.equal(donations.pokeNow(), 0, 'пока идёт запрос — ничего не запускаем');
  await flush();
  assert.equal(calls.length, 1, 'второго параллельного запроса нет');

  release();
  await flush();
  assert.equal(donations.status().da.ok, true, 'первый запрос завершился');
  assert.equal(donations.pokeNow(), 1, 'после завершения — можно опросить сразу');
  await flush();
  assert.equal(calls.length, 2);
});

test('donations pokeNow: остановленный опрос не оживает', async (t) => {
  clocked(t);
  prepare();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return fail(401); // вход отозван — poll сам останавливает опрос
  };

  donations.start();
  mock.timers.tick(1500);
  await flush();
  const afterStop = calls.length;
  assert.ok(afterStop >= 1, 'опрос успел сходить');
  assert.equal(donations.status().da.ok, false);
  assert.equal(donations.pokeNow(), 0, 'остановленный опрос не трогаем');
  await flush();
  assert.equal(calls.length, afterStop, 'после pokeNow запросов нет');
});

test('donations pokeNow: без входа и без start ничего не делает', async (t) => {
  clocked(t);
  prepare();
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return ok([]); };
  assert.equal(donations.pokeNow(), 0, 'опрос не запущен');
  donations.stop();
  assert.equal(donations.pokeNow(), 0, 'после stop — тоже');
  await flush();
  assert.equal(calls.length, 0);
});
