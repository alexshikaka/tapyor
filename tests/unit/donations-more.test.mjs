// T1: дополнение к donations-*.test.mjs — чистые решения по ошибкам, статус без сети,
// отключение ключа и сверка. electron подменяется, как в donations-poke.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const origLoad = Module._load;
Module._load = function (r, ...a) {
  if (r === 'electron') return { shell: {}, safeStorage: { isEncryptionAvailable: () => false } };
  return origLoad.call(this, r, ...a);
};
const D = require('../../src/donations.js');
Module._load = origLoad;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function memoryStore(init) {
  const data = Object.assign({}, init || {});
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = v; } };
}
function prepare(store) {
  const logs = [];
  D.setup({
    log: (m) => logs.push(String(m)),
    store,
    onDonation: async () => {},
    onStatus: () => {},
    onAuthError: () => {},
    onPollOk: () => {},
    onPollFail: () => {},
  });
  return logs;
}

test('donations: названия сервисов и адрес возврата на месте', () => {
  assert.deepEqual(D.NAMES, { da: 'DonationAlerts', dp: 'DonatePay' });
  assert.match(D.DA_REDIRECT, /^http:\/\/127\.0\.0\.1:\d+\/da-callback$/);
});

test('donations.pollErrorAction: 401/403 — войти заново, 429 — пауза, остальное — повтор', () => {
  for (const s of [401, 403]) assert.equal(D.pollErrorAction(s), 'auth', String(s));
  assert.equal(D.pollErrorAction(429), 'rate');
  for (const s of [400, 500, 502, 0, undefined, null, '401']) assert.equal(D.pollErrorAction(s), 'retry', String(s));
});

test('donations.status: без входов — не подключено, имя и настройка DA', () => {
  prepare(memoryStore());
  const st = D.status();
  assert.equal(st.da.name, 'DonationAlerts');
  assert.equal(st.da.connected, false);
  assert.equal(st.dp.name, 'DonatePay');
  assert.equal(st.dp.connected, false);
  // configured зависит от src/da.json: в сборке его пишет CI из секретов, на ПК владельца он лежит
  // в рабочей папке (в git его нет). Тест не должен падать от наличия файла (13.11, перенос в experiment).
  const daJson = fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'da.json'));
  assert.equal(typeof st.da.configured, 'boolean');
  if (!daJson) assert.equal(st.da.configured, false, 'нет da.json в проверке');
  assert.equal(st.da.account, null);
  assert.equal(st.da.ok, undefined);
  assert.equal(st.da.error, '');
});

test('donations.check: без входов — пусто, с входом — «ещё не опрашивали»', async () => {
  prepare(memoryStore());
  assert.deepEqual(await D.check(), {});

  const store = memoryStore({ donKeys: { dp: b64(JSON.stringify({ key: 'x' })) } });
  prepare(store);
  assert.deepEqual(await D.check(), { dp: { ok: null, pending: true } });
});

test('donations.setKey: чужой сервис отклоняется, пустой ключ отключает', async () => {
  const store = memoryStore();
  prepare(store);
  assert.deepEqual(await D.setKey('da', 'ключ'), { error: 'неизвестный сервис донатов' });
  assert.deepEqual(await D.setKey('xx', 'ключ'), { error: 'неизвестный сервис донатов' });

  store.data.donKeys = { dp: b64(JSON.stringify({ key: 'x' })) };
  store.data.donAccounts = { dp: { name: 'Я' } };
  assert.deepEqual(await D.setKey('dp', '   '), { ok: true });
  assert.equal(store.data.donKeys.dp, undefined, 'ключ удалён');
  assert.equal(store.data.donAccounts.dp, undefined, 'аккаунт удалён');
  assert.equal(D.status().dp.connected, false);
});

test('donations.disconnect: стирает вход и состояние, не бросает', () => {
  const store = memoryStore({ donKeys: { dp: b64(JSON.stringify({ key: 'x' })) }, donAccounts: { dp: { name: 'Я' } } });
  prepare(store);
  assert.equal(D.disconnect('dp'), true);
  assert.equal(store.data.donKeys.dp, undefined);
  assert.equal(store.data.donAccounts.dp, undefined);
  assert.equal(D.status().dp.connected, false);
  assert.equal(D.disconnect('xx'), true, 'неизвестный сервис просто чистит пустое');
});

test('donations.reconnect: без входа — false, чужой сервис — false', () => {
  prepare(memoryStore());
  assert.equal(D.reconnect('dp'), false);
  assert.equal(D.reconnect('xx'), false);
});

test('donations.start/stop/pokeNow: без входов ничего не запускают', () => {
  prepare(memoryStore());
  D.start();
  assert.equal(D.pokeNow(), 0);
  D.stop();
  assert.equal(D.pokeNow(), 0);
  D.daCancel();
  assert.doesNotThrow(() => D.stop());
});
