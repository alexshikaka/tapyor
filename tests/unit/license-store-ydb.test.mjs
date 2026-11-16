// B10 / P5b M4: счётчик hit() в YDB — одна транзакция. Раньше было два запроса (SELECT n, потом
// UPSERT n+1): параллельные вызовы читали одно и то же n и теряли приращения, а от этого зависят
// лимиты 10/час (отпечаток), 30/час (адрес) и 20/час (админка).
//
// YDB здесь — подделка (server/yc-license/store-ydb.js с подменённым ydb-sdk). Проверяем поведение:
// один вызов hit() = один запрос к базе, а параллельные вызовы не теряют счёт. На настоящей YDB не
// проверялось — её у тестов нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');

function fakeYdb() {
  const state = { hits: new Map(), queries: [] };
  const TypedValues = {
    utf8: (s) => ({ t: 'utf8', v: String(s) }),
    uint32: (n) => ({ t: 'uint32', v: Number(n) }),
    uint64: (n) => ({ t: 'uint64', v: Number(n) }),
    timestamp: (d) => ({ t: 'timestamp', v: d })
  };
  const TypedData = { createNativeObjects: (rs) => (rs && rs.rows) || [] };
  const tick = () => new Promise((r) => setTimeout(r, 1));
  // Транзакции YDB последовательны: чтение и запись одной строки не могут разъехаться внутри одного
  // запроса. Один executeQuery = одна транзакция, поэтому приращение делаем сразу, без await.
  async function executeQuery(text, params) {
    state.queries.push(text);
    const k = params && params.$k && params.$k.v;
    const combined = text.includes('UPSERT INTO `hits`') && text.includes('FROM `hits`');
    if (combined) {
      const n = (state.hits.get(k) || 0) + 1;
      state.hits.set(k, n);
      return { resultSets: [{ rows: [{ n }] }] };
    }
    if (text.includes('SELECT n FROM `hits`')) {
      await tick(); // старое чтение успевало разъехаться с записью
      const n = state.hits.get(k) || 0;
      return { resultSets: [{ rows: n ? [{ n }] : [] }] };
    }
    if (text.includes('UPSERT INTO `hits`')) {
      await tick();
      state.hits.set(k, params.$n.v);
      return { resultSets: [] };
    }
    return { resultSets: [] };
  }
  const session = { executeQuery, execute: async () => ({ resultSets: [], opFinished: true }) };
  class Driver {
    async ready() { return true; }
    constructor() {
      this.tableClient = { withSession: (fn) => fn(session) };
      this.queryClient = { do: (o) => o.fn(session) };
    }
  }
  return { mod: { Driver, getCredentialsFromEnv: () => ({}), MetadataAuthService: class {}, TypedValues, TypedData }, state };
}

const fake = fakeYdb();
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'ydb-sdk') return fake.mod;
  return origLoad.call(this, request, parent, isMain);
};
let store;
try { store = require('../../server/yc-license/store-ydb.js'); } finally { Module._load = origLoad; }

test('hit(): счётчик растёт по одному', async () => {
  for (let i = 1; i <= 3; i++) assert.equal(await store.hit('seq-key', 1), i);
});

test('hit(): один вызов — один запрос к базе (чтение и запись в одной транзакции)', async () => {
  const before = fake.state.queries.length;
  await store.hit('one-query', 1);
  const added = fake.state.queries.slice(before);
  assert.equal(added.length, 1, 'hit сделал ' + added.length + ' запроса вместо одного');
  assert.ok(added[0].includes('UPSERT INTO `hits`') && added[0].includes('FROM `hits`'), 'чтение и запись — в одном запросе');
});

test('hit(): параллельные вызовы не теряют счёт (старое SELECT + UPSERT давало 1,1,1)', async () => {
  const vals = await Promise.all([1, 2, 3, 4].map(() => store.hit('par-key', 1)));
  assert.deepEqual([...vals].sort((a, b) => a - b), [1, 2, 3, 4]);
});

test('hit(): разные ключи считаются раздельно', async () => {
  assert.equal(await store.hit('a-key', 1), 1);
  assert.equal(await store.hit('b-key', 1), 1);
  assert.equal(await store.hit('a-key', 1), 2);
});
