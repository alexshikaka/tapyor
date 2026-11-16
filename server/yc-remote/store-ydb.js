'use strict';
// Хранилище пульта с телефона в YDB serverless (схема — schema.yql). Колонки одним словом: ydb-sdk
// переименовывает snake_case в camelCase, так проще. ev и cmds — JSON-строки (массивы объектов).
//
// Вход в базу — как у yc-license: сервисным аккаунтом функции через метаданные (обход тяжёлого пакета
// @yandex-cloud/nodejs-sdk). Таблица создаётся сама при первом запуске; TTL по колонке exp — YDB
// подчищает истёкшие сессии, а точное правило «12 ч от последнего host» проверяет core.js.
const { Driver, getCredentialsFromEnv, MetadataAuthService, TypedValues, TypedData } = require('ydb-sdk');

const META_URL = 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';
const metaToken = {
  token: '', exp: 0, busy: null,
  getToken() { if (Date.now() > this.exp) this.initialize().catch(() => {}); return this.token; },
  initialize() {
    if (!this.busy) {
      this.busy = (async () => {
        const r = await fetch(META_URL, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
        const j = await r.json();
        if (!j || !j.access_token) throw new Error('метаданные не дали токен (у функции нет сервисного аккаунта?)');
        this.token = j.access_token;
        this.exp = Date.now() + Math.max(60, (Number(j.expires_in) || 3600) - 300) * 1000;
      })().finally(() => { this.busy = null; });
    }
    return this.busy;
  }
};
const authService = () => (process.env.YDB_METADATA_CREDENTIALS === '1' ? new MetadataAuthService(metaToken) : getCredentialsFromEnv());

let driver = null;
async function getDriver() {
  if (driver) return driver;
  const d = new Driver({ endpoint: process.env.YDB_ENDPOINT, database: process.env.YDB_DATABASE, authService: authService() });
  if (!(await d.ready(10000))) throw new Error('YDB не ответила за 10 с');
  await ensureSchema(d);
  driver = d;
  return d;
}

// Таблица создаётся сама. exp — абсолютное время конца сессии; TTL с минутой запаса удаляет строку
// чуть позже (точный срок проверяет core.js), зато YDB успевает подчищать брошенные сессии.
const SCHEMA = [
  'CREATE TABLE `remote_sessions` (' +
  ' sid Utf8, host_hash Utf8, s Utf8, sv Uint32, f Utf8, fv Uint32, ev Utf8, es Uint32,' +
  ' cmds Utf8, cs Uint32, host_at Uint64, phone_at Uint64, exp Timestamp, PRIMARY KEY (sid))' +
  ' WITH (TTL = Interval("PT1M") ON exp)'
];
async function ensureSchema(d) {
  for (const sql of SCHEMA) {
    try {
      await d.queryClient.do({ fn: async (session) => {
        const r = await session.execute({ text: sql });
        for await (const rs of r.resultSets) { for await (const _ of rs.rows) { /* DDL без строк */ } }
        await r.opFinished;
      } });
      console.log('remote: создана таблица remote_sessions');
    } catch (e) {
      if (!/already exists|exist|path.*exists/i.test(String(e && e.message || e))) throw e;
    }
  }
}

const num = (x) => (x && typeof x.toNumber === 'function' ? x.toNumber() : Number(x) || 0);
const u8 = (s) => TypedValues.utf8(String(s == null ? '' : s));
const u32 = (n) => TypedValues.uint32(Math.floor(Number(n) || 0));
const u64 = (n) => TypedValues.uint64(Math.floor(Number(n) || 0));

const SELECT = 'DECLARE $sid AS Utf8; SELECT sid, host_hash, s, sv, f, fv, ev, es, cmds, cs, host_at, phone_at, exp FROM `remote_sessions` WHERE sid = $sid;';
const DELETE = 'DECLARE $sid AS Utf8; DELETE FROM `remote_sessions` WHERE sid = $sid;';
const UPSERT = 'DECLARE $sid AS Utf8; DECLARE $hh AS Utf8; DECLARE $s AS Utf8; DECLARE $sv AS Uint32;' +
  ' DECLARE $f AS Utf8; DECLARE $fv AS Uint32; DECLARE $ev AS Utf8; DECLARE $es AS Uint32;' +
  ' DECLARE $cmds AS Utf8; DECLARE $cs AS Uint32; DECLARE $ha AS Uint64; DECLARE $pa AS Uint64;' +
  ' DECLARE $exp AS Timestamp;' +
  ' UPSERT INTO `remote_sessions` (sid, host_hash, s, sv, f, fv, ev, es, cmds, cs, host_at, phone_at, exp)' +
  ' VALUES ($sid, $hh, $s, $sv, $f, $fv, $ev, $es, $cmds, $cs, $ha, $pa, $exp);';

function parseList(s) {
  try { const v = JSON.parse(String(s || '')); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function rowOut(r) {
  // ydb-sdk отдаёт snake_case-колонки как camelCase (см. комментарий в yc-license/store-ydb.js),
  // поэтому читаем оба вида: настоящая YDB и подделка в тестах приходят по-разному.
  const pick = (a, b) => (r[a] !== undefined ? r[a] : r[b]);
  return {
    sid: r.sid,
    host_hash: pick('host_hash', 'hostHash') || '',
    s: r.s || '', sv: num(r.sv),
    f: r.f || '', fv: num(r.fv),
    ev: parseList(r.ev), es: num(r.es),
    cmds: parseList(r.cmds), cs: num(r.cs),
    host_at: num(pick('host_at', 'hostAt')), phone_at: num(pick('phone_at', 'phoneAt')),
    exp: r.exp instanceof Date ? r.exp.getTime() : num(r.exp)
  };
}
function rowParams(row) {
  return {
    $sid: u8(row.sid), $hh: u8(row.host_hash),
    $s: u8(row.s), $sv: u32(row.sv),
    $f: u8(row.f), $fv: u32(row.fv),
    $ev: u8(JSON.stringify(row.ev || [])), $es: u32(row.es),
    $cmds: u8(JSON.stringify(row.cmds || [])), $cs: u32(row.cs),
    $ha: u64(row.host_at), $pa: u64(row.phone_at),
    $exp: TypedValues.timestamp(new Date(Number(row.exp) || 0))
  };
}

// Один запрос — одна транзакция (serializable, с фиксацией). При пересечении строк YDB отменяет
// одну транзакцию («locks invalidated» / ABORTED) — повторяем до 3 раз.
const RETRY = /abort|locks invalidated|overloaded|unavailable|bad.?session/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(text, params) {
  const d = await getDriver();
  for (let i = 0; ; i++) {
    try {
      return await d.tableClient.withSession(async (s) => {
        const r = await s.executeQuery(text, params || {});
        return (r.resultSets || []).map((rs) => TypedData.createNativeObjects(rs));
      }, 10000);
    } catch (e) {
      if (i >= 2 || !RETRY.test(String((e && (e.message || e.name)) || e))) throw e;
      await sleep(50 + Math.random() * 150);
    }
  }
}

module.exports = {
  async get(sid) {
    const sets = await q(SELECT, { $sid: u8(sid) });
    const rows = (sets || []).find((s) => s && s.length) || [];
    return rows[0] ? rowOut(rows[0]) : null;
  },
  async put(row) { await q(UPSERT, rowParams(row)); },
  async del(sid) { await q(DELETE, { $sid: u8(sid) }); },
  // update — атомарно «прочитал-изменил-записал» в одной serializable-транзакции. fn получает
  // текущую строку (или null) и возвращает новую строку, либо null — тогда сессия удаляется.
  async update(sid, fn) {
    const d = await getDriver();
    for (let i = 0; ; i++) {
      try {
        return await d.tableClient.withSession(async (session) => {
          // Настоящий ydb-sdk 5: beginTransaction даёт только { id }; запросы и фиксация — через сессию с txId.
          const meta = await session.beginTransaction({ serializableReadWrite: {} });
          const tx = { txId: meta.id };
          try {
            const r = await session.executeQuery(SELECT, { $sid: u8(sid) }, tx);
            const sets = (r.resultSets || []).map((rs) => TypedData.createNativeObjects(rs));
            const rows = sets.find((s) => s && s.length) || [];
            const cur = rows[0] ? rowOut(rows[0]) : null;
            const next = await fn(cur);
            if (next) await session.executeQuery(UPSERT, rowParams(next), tx);
            else await session.executeQuery(DELETE, { $sid: u8(sid) }, tx);
            await session.commitTransaction(tx);
            return next;
          } catch (e) {
            try { await session.rollbackTransaction(tx); } catch (e2) { /* транзакция уже закрыта */ }
            throw e;
          }
        }, 10000);
      } catch (e) {
        if (i >= 2 || !RETRY.test(String((e && (e.message || e.name)) || e))) throw e;
        await sleep(50 + Math.random() * 150);
      }
    }
  }
};
