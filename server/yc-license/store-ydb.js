'use strict';
// Хранилище сервера активации в YDB serverless (схема — schema.yql). Колонки одним словом: ydb-sdk переименовывает
// snake_case в camelCase, так проще. Пустые части отпечатка хранятся как ''.
const { Driver, getCredentialsFromEnv, MetadataAuthService, TypedValues, TypedData } = require('ydb-sdk');

// Вход в YDB от имени сервисного аккаунта функции. Штатный способ ydb-sdk требует тяжёлый пакет
// @yandex-cloud/nodejs-sdk (без него: «Cannot find module …metadata-token-service», 08.11) — поэтому токен
// берём сами у сервиса метаданных функции и обновляем заранее, за 5 минут до конца срока.
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
// Таблицы создаются сами при первом запуске функции (утилита ydb не нужна). Уже есть — пропускаем.
const SCHEMA = [
  'CREATE TABLE `keys` (kh Utf8, ed Uint32, st Utf8, note Utf8, created Uint64, PRIMARY KEY (kh))',
  'CREATE TABLE `machines` (kh Utf8, mid Utf8, f1 Utf8, f2 Utf8, f3 Utf8, at Uint64, PRIMARY KEY (kh, mid))',
  'CREATE TABLE `trials` (id Utf8, pack Utf8, f1 Utf8, f2 Utf8, f3 Utf8, ed Uint32, iat Uint64, exp Uint64, PRIMARY KEY (id))',
  'CREATE TABLE `hits` (k Utf8, n Uint32, at Timestamp, PRIMARY KEY (k)) WITH (TTL = Interval("PT2H") ON at)',
];
async function ensureSchema(d) {
  for (const sql of SCHEMA) {
    try {
      await d.queryClient.do({ fn: async (session) => {
        const r = await session.execute({ text: sql });
        for await (const rs of r.resultSets) { for await (const _ of rs.rows) { /* DDL без строк */ } }
        await r.opFinished;
      } });
      console.log('license: создана таблица ' + sql.split('`')[1]);
    } catch (e) {
      if (!/already exists|exist|path.*exists/i.test(String(e && e.message || e))) throw e;
    }
  }
}
const num = (x) => (x && typeof x.toNumber === 'function' ? x.toNumber() : Number(x));
const u8 = (s) => TypedValues.utf8(String(s == null ? '' : s));
const u64 = (n) => TypedValues.uint64(Math.floor(Number(n) || 0));
const u32 = (n) => TypedValues.uint32(Math.floor(Number(n) || 0));
// Каждый запрос — одна транзакция (serializable, с фиксацией). Если две транзакции задели одни и те же строки,
// YDB отменяет одну («locks invalidated» / ABORTED) — повторяем до 3 раз; все наши запросы можно безопасно повторить.
const RETRY = /abort|locks invalidated|overloaded|unavailable|bad.?session/i;
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
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
    }
  }
}
const fpOut = (r) => [r.f1 || null, r.f2 || null, r.f3 || null];

module.exports = {
  async getKey(h) {
    const [rows] = await q('DECLARE $h AS Utf8; SELECT ed, st FROM `keys` WHERE kh = $h;', { $h: u8(h) });
    const r = rows && rows[0];
    return r ? { edition: num(r.ed), status: r.st } : null;
  },
  async addKeys(hs, edition, note, now) {
    for (const h of hs) {
      const [rows] = await q('DECLARE $h AS Utf8; SELECT kh FROM `keys` WHERE kh = $h;', { $h: u8(h) });
      if (rows && rows.length) continue; // уже есть (и, возможно, отозван) — не трогаем
      await q('DECLARE $h AS Utf8; DECLARE $ed AS Uint32; DECLARE $note AS Utf8; DECLARE $at AS Uint64;' +
        ' UPSERT INTO `keys` (kh, ed, st, note, created) VALUES ($h, $ed, "ok", $note, $at);', { $h: u8(h), $ed: u32(edition), $note: u8(note), $at: u64(now) });
    }
  },
  async revokeKey(h) { await q('DECLARE $h AS Utf8; UPDATE `keys` SET st = "revoked" WHERE kh = $h;', { $h: u8(h) }); },
  async unrevokeKey(h) { await q('DECLARE $h AS Utf8; UPDATE `keys` SET st = "ok" WHERE kh = $h;', { $h: u8(h) }); },
  // admin-list: все ключи и машины. YDB отдаёт не больше 1000 строк за запрос — читаем страницами по ключу таблицы.
  async listAll() {
    const keys = [], machines = [];
    for (let after = ''; ;) {
      const [rows] = await q('DECLARE $a AS Utf8; SELECT kh, ed, st, note, created FROM `keys` WHERE kh > $a ORDER BY kh LIMIT 1000;', { $a: u8(after) });
      for (const r of rows || []) keys.push({ kh: r.kh, edition: num(r.ed), status: r.st, note: r.note || '', created: num(r.created) });
      if (!rows || rows.length < 1000) break;
      after = rows[rows.length - 1].kh;
    }
    for (let ak = '', am = ''; ;) {
      const [rows] = await q('DECLARE $k AS Utf8; DECLARE $m AS Utf8;' +
        ' SELECT kh, mid, f1, f2, f3, at FROM `machines` WHERE kh > $k OR (kh = $k AND mid > $m) ORDER BY kh, mid LIMIT 1000;', { $k: u8(ak), $m: u8(am) });
      for (const r of rows || []) machines.push({ kh: r.kh, mid: r.mid, fp: fpOut(r), at: num(r.at) });
      if (!rows || rows.length < 1000) break;
      ak = rows[rows.length - 1].kh; am = rows[rows.length - 1].mid;
    }
    const [tr] = await q('SELECT COUNT(*) AS n FROM `trials`;');
    return { keys, machines, trials: tr && tr[0] ? num(tr[0].n) : 0 };
  },
  async listMachines(h) {
    const [rows] = await q('DECLARE $h AS Utf8; SELECT mid, f1, f2, f3, at FROM `machines` WHERE kh = $h;', { $h: u8(h) });
    return (rows || []).map((r) => ({ mid: r.mid, fp: fpOut(r), at: num(r.at) }));
  },
  async addMachine(h, mid, fp, at) { await this.updateMachine(h, mid, fp, at); },
  // M2: подсчёт машин и добавление — в одной транзакции. Параллельная активация того же ключа с другого экземпляра
  // функции заденет те же строки, YDB отменит одну из транзакций, а при повторе (q) она увидит уже новое число.
  async addMachineIfRoom(h, mid, fp, at, max) {
    // сначала чтение, потом запись: так YDB не нужно читать таблицу после изменения в той же транзакции
    const sets = await q('DECLARE $h AS Utf8; DECLARE $m AS Utf8; DECLARE $a AS Utf8; DECLARE $b AS Utf8; DECLARE $c AS Utf8;' +
      ' DECLARE $at AS Uint64; DECLARE $max AS Uint64;' +
      ' $n = (SELECT COUNT(*) FROM `machines` WHERE kh = $h);' +
      ' SELECT $n AS n;' +
      ' UPSERT INTO `machines` (kh, mid, f1, f2, f3, at)' +
      ' SELECT $h AS kh, $m AS mid, $a AS f1, $b AS f2, $c AS f3, $at AS at FROM AS_TABLE(AsList(AsStruct(1 AS x))) WHERE $n < $max;',
      { $h: u8(h), $m: u8(mid), $a: u8(fp[0]), $b: u8(fp[1]), $c: u8(fp[2]), $at: u64(at), $max: u64(max) });
    const rows = sets.find((s) => s && s.length && 'n' in s[0]);
    const n = rows ? num(rows[0].n) : NaN;
    if (!Number.isFinite(n)) throw new Error('addMachineIfRoom: база не вернула число машин');
    return Number.isFinite(n) && n < max;
  },
  async updateMachine(h, mid, fp, at) {
    await q('DECLARE $h AS Utf8; DECLARE $m AS Utf8; DECLARE $a AS Utf8; DECLARE $b AS Utf8; DECLARE $c AS Utf8; DECLARE $at AS Uint64;' +
      ' UPSERT INTO `machines` (kh, mid, f1, f2, f3, at) VALUES ($h, $m, $a, $b, $c, $at);',
      { $h: u8(h), $m: u8(mid), $a: u8(fp[0]), $b: u8(fp[1]), $c: u8(fp[2]), $at: u64(at) });
  },
  async removeMachine(h, mid) { await q('DECLARE $h AS Utf8; DECLARE $m AS Utf8; DELETE FROM `machines` WHERE kh = $h AND mid = $m;', { $h: u8(h), $m: u8(mid) }); },
  async findTrial(fp, pack) {
    // кандидаты — совпала хоть одна часть; «2 из 3» проверяет core.js
    const none = '-none-';
    const [rows] = await q('DECLARE $p AS Utf8; DECLARE $a AS Utf8; DECLARE $b AS Utf8; DECLARE $c AS Utf8;' +
      ' SELECT id, f1, f2, f3, ed, iat, exp FROM `trials` WHERE pack = $p AND (f1 = $a OR f2 = $b OR f3 = $c);',
      { $p: u8(pack), $a: u8(fp[0] || none), $b: u8(fp[1] || none), $c: u8(fp[2] || none) });
    const { fpMatch } = require('./core');
    const r = (rows || []).map((x) => ({ id: x.id, fp: fpOut(x), edition: num(x.ed), iat: num(x.iat), exp: num(x.exp) })).find((x) => fpMatch(x.fp, fp));
    return r || null;
  },
  async addTrial(id, fp, pack, edition, iat, exp) {
    await q('DECLARE $id AS Utf8; DECLARE $p AS Utf8; DECLARE $a AS Utf8; DECLARE $b AS Utf8; DECLARE $c AS Utf8; DECLARE $ed AS Uint32; DECLARE $iat AS Uint64; DECLARE $exp AS Uint64;' +
      ' UPSERT INTO `trials` (id, pack, f1, f2, f3, ed, iat, exp) VALUES ($id, $p, $a, $b, $c, $ed, $iat, $exp);',
      { $id: u8(id), $p: u8(pack), $a: u8(fp[0]), $b: u8(fp[1]), $c: u8(fp[2]), $ed: u32(edition), $iat: u64(iat), $exp: u64(exp) });
  },
  // M4: чтение и запись счётчика — в ОДНОЙ транзакции. Раньше было два запроса (SELECT n, потом
  // UPSERT n+1): параллельные вызовы читали одно и то же n и счётчик рос на 1 вместо N. А от него
  // зависят лимиты 10/час (отпечаток), 30/час (адрес) и 20/час (админка) — то есть перебор ускорялся.
  // Теперь $next = MAX(n)+1 и запись идут одним запросом (q() выполняет его в одной транзакции). Если
  // две транзакции задели одну строку, YDB отменяет одну, q() повторяет её и видит уже новое число.
  async hit(k, now) {
    const sets = await q('DECLARE $k AS Utf8; DECLARE $at AS Timestamp;' +
      ' $next = (SELECT COALESCE(MAX(n), 0u) + 1u FROM `hits` WHERE k = $k);' +
      ' SELECT $next AS n;' +
      ' UPSERT INTO `hits` (k, n, at)' +
      ' SELECT $k AS k, $next AS n, $at AS at FROM AS_TABLE(AsList(AsStruct(1 AS x)));',
      { $k: u8(k), $at: TypedValues.timestamp(new Date(now)) });
    const rows = sets.find((s) => s && s.length && 'n' in s[0]);
    const n = rows ? num(rows[0].n) : NaN;
    if (!Number.isFinite(n)) throw new Error('hit: база не вернула число');
    return n;
  },
};
