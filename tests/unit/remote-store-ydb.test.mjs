// R1: хранилище пульта в YDB (server/yc-remote/store-ydb.js) с подменённым ydb-sdk.
// Настоящей YDB у тестов нет — проверяем поведение: get/put/del, update в одной транзакции,
// отсутствие потерянных приращений при параллельных вызовах и повтор после ABORTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');

function fakeYdb() {
  const state = {
    rows: new Map(), ddl: [], events: [], queries: [],
    txStarts: 0, open: {}, commits: 0, rollbacks: 0, settings: null,
    failNext: false, chain: Promise.resolve()
  };
  const TypedValues = {
    utf8: (s) => ({ t: 'utf8', v: String(s) }),
    uint32: (n) => ({ t: 'uint32', v: Number(n) }),
    uint64: (n) => ({ t: 'uint64', v: Number(n) }),
    timestamp: (d) => ({ t: 'timestamp', v: d })
  };
  const TypedData = { createNativeObjects: (rs) => (rs && rs.rows) || [] };
  const val = (p) => (p == null ? undefined : p.v);

  function exec(text, params) {
    state.queries.push(text);
    if (text.includes('UPSERT INTO `remote_sessions`')) {
      if (state.failNext) { state.failNext = false; throw new Error('Transaction ABORTED'); }
      const exp = val(params.$exp);
      const sid = val(params.$sid);
      state.rows.set(sid, {
        sid,
        host_hash: val(params.$hh),
        s: val(params.$s), sv: val(params.$sv),
        f: val(params.$f), fv: val(params.$fv),
        ev: val(params.$ev), es: val(params.$es),
        cmds: val(params.$cmds), cs: val(params.$cs),
        host_at: val(params.$ha), phone_at: val(params.$pa),
        exp: exp instanceof Date ? exp.getTime() : Number(exp)
      });
      return { resultSets: [] };
    }
    if (text.includes('DELETE FROM `remote_sessions`')) {
      state.rows.delete(val(params.$sid));
      return { resultSets: [] };
    }
    if (text.includes('SELECT ') && text.includes('FROM `remote_sessions`')) {
      const src = state.rows.get(val(params.$sid));
      // ydb-sdk отдаёт snake_case-колонки как camelCase — как настоящая база, а не как мы записали.
      const row = src ? {
        sid: src.sid,
        hostHash: src.host_hash,
        s: src.s, sv: src.sv,
        f: src.f, fv: src.fv,
        ev: src.ev, es: src.es,
        cmds: src.cmds, cs: src.cs,
        hostAt: src.host_at, phoneAt: src.phone_at,
        exp: src.exp
      } : null;
      return { resultSets: [{ rows: row ? [row] : [] }] };
    }
    return { resultSets: [] };
  }

  // Транзакции YDB последовательны: одна транзакция на строку за раз. Глобальная очередь
  // показывает, что параллельные update не теряют приращений.
  async function beginTransaction() {
    let release;
    const mine = new Promise((r) => { release = r; });
    const prev = state.chain;
    state.chain = prev.then(() => mine);
    await prev;
    state.txStarts++;
    let open = true;
    const done = () => { if (open) { open = false; release(); } };
    const id = 'tx' + state.txStarts;
    state.open[id] = done;
    return { id };
  }

  const session = {
    // Как настоящий ydb-sdk 5: запрос в транзакции — третьим аргументом { txId }, фиксация/отмена — через сессию.
    executeQuery: async (text, params, txc) => {
      const inTx = !!(txc && txc.txId);
      if (inTx && !state.open[txc.txId]) throw new Error('transaction not found');
      state.events.push({ tx: inTx, text }); return exec(text, params);
    },
    beginTransaction: async (settings) => { state.settings = settings; return beginTransaction(); },
    commitTransaction: async ({ txId }) => { const d = state.open[txId]; if (!d) throw new Error('transaction not found'); delete state.open[txId]; state.commits++; d(); },
    rollbackTransaction: async ({ txId }) => { const d = state.open[txId]; if (!d) throw new Error('transaction not found'); delete state.open[txId]; state.rollbacks++; d(); },
    execute: async ({ text }) => { state.ddl.push(text); return { resultSets: [], opFinished: true }; }
  };

  class Driver {
    constructor() {
      this.tableClient = { withSession: (fn) => fn(session) };
      this.queryClient = { do: (o) => o.fn(session) };
    }
    async ready() { return true; }
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
try { store = require('../../server/yc-remote/store-ydb.js'); } finally { Module._load = origLoad; }

const EXP = Date.UTC(2026, 10, 17, 12);
const row = (sid, extra) => Object.assign({
  sid,
  host_hash: 'ab'.repeat(32),
  s: '', sv: 0,
  f: '', fv: 0,
  ev: [], es: 0,
  cmds: [], cs: 0,
  host_at: 1000, phone_at: 0,
  exp: EXP
}, extra || {});

test('таблица создаётся сама, TTL — по колонке exp', async () => {
  await store.get('nobody-' + '0'.repeat(15));
  assert.ok(fake.state.ddl.length >= 1, 'DDL выполнен');
  const sql = fake.state.ddl.join('\n');
  assert.match(sql, /CREATE TABLE `remote_sessions`/);
  assert.match(sql, /exp Timestamp/);
  assert.match(sql, /TTL = Interval\("PT1M"\) ON exp/);
});

test('get / put / del: строка сохраняется и читается целиком', async () => {
  const sid = 'S'.repeat(22);
  const r = row(sid, { s: 'AA', sv: 1, f: 'BB', fv: 2, ev: [{ seq: 1, e: 'x' }], es: 1, cmds: [{ seq: 1, c: 'y' }], cs: 1, phone_at: 2000 });
  await store.put(r);
  assert.deepEqual(await store.get(sid), r);
  await store.del(sid);
  assert.equal(await store.get(sid), null);
});

test('update: читает, меняет и пишет в одной serializable-транзакции', async () => {
  const sid = 'T'.repeat(22);
  await store.put(row(sid));
  const before = { tx: fake.state.txStarts, commits: fake.state.commits, events: fake.state.events.length };
  const got = await store.update(sid, (r) => {
    assert.ok(r, 'строка передана в fn');
    r.sv += 1;
    r.s = 'NEW';
    return r;
  });
  assert.equal(got.sv, 1);
  assert.equal(got.s, 'NEW');

  assert.equal(fake.state.txStarts - before.tx, 1, 'одна транзакция');
  assert.equal(fake.state.commits - before.commits, 1, 'одна фиксация');
  const ops = fake.state.events.slice(before.events);
  assert.ok(ops.length >= 2, 'чтение и запись');
  assert.ok(ops.every((e) => e.tx === true), 'всё внутри транзакции');
  assert.ok(ops.some((e) => /SELECT /.test(e.text)) && ops.some((e) => /UPSERT INTO/.test(e.text)));
  assert.deepEqual(fake.state.settings, { serializableReadWrite: {} }, 'serializable');

  assert.equal((await store.get(sid)).sv, 1);
});

test('update: нет строки — fn получает null; null в ответ — удаление', async () => {
  const sid = 'U'.repeat(22);
  let seen = 'not-called';
  const got = await store.update(sid, (r) => { seen = r; return row(sid, { s: 'CREATED' }); });
  assert.equal(seen, null);
  assert.equal(got.s, 'CREATED');
  assert.equal((await store.get(sid)).s, 'CREATED');

  assert.equal(await store.update(sid, () => null), null);
  assert.equal(await store.get(sid), null);
});

test('update: параллельные вызовы не теряют приращений', async () => {
  const sid = 'W'.repeat(22);
  await store.put(row(sid));
  await Promise.all(Array.from({ length: 8 }, () =>
    store.update(sid, (r) => { r.sv += 1; return r; })));
  assert.equal((await store.get(sid)).sv, 8);
});

test('update: транзакция отменена (ABORTED) — повтор, приращение одно', async () => {
  const sid = 'X'.repeat(22);
  await store.put(row(sid));
  const before = fake.state.txStarts;
  fake.state.failNext = true;
  const got = await store.update(sid, (r) => { r.sv = 9; return r; });
  assert.equal(got.sv, 9);
  assert.equal((await store.get(sid)).sv, 9);
  assert.ok(fake.state.txStarts - before >= 2, 'была повторная попытка');
  assert.ok(fake.state.rollbacks >= 1, 'отменённая транзакция закрыта');
});

test('update: ошибка не глотается, сессия не зависает', async () => {
  const sid = 'Y'.repeat(22);
  await store.put(row(sid));
  await assert.rejects(() => store.update(sid, () => { throw new Error('сломалось'); }), /сломалось/);
  // следующая транзакция по той же строке проходит
  const got = await store.update(sid, (r) => { r.sv = 3; return r; });
  assert.equal(got.sv, 3);
});
