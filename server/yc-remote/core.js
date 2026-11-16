'use strict';
// Логика облачной функции пульта с телефона (server/yc-remote) без сети и без YDB.
// Протокол и правила безопасности — docs/REMOTE.md, разделы «Протокол функции» и «Безопасность».
//
// Функция — «тупой почтовый ящик»: она видит только зашифрованные куски (base64url), ключа сессии
// у неё нет и содержимое ей недоступно. Право писать снимок/ленту и читать команды — у владельца
// сессии: он присылает host (32 байта), а хранится только SHA-256 этого host. Сравнение — за
// постоянное время (crypto.timingSafeEqual), чтобы по времени ответа нельзя было подобрать.
//
// Ответ всегда { status, body, headers }. Ошибки: 400 bad_request, 403 forbidden, 404 no-session,
// 405 method, 429 rate. CORS — только для запросов со страницы телефона (poll/cmd) и OPTIONS.

const crypto = require('crypto');
const { createRate } = require('./shared')('rate');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // срок жизни сессии без Тапёра
const MAX_EVENTS = 30;        // сколько последних событий хранить
const MAX_CMDS = 50;          // сколько команд хранить
const MAX_S = 65536;          // снимок пульта, знаков base64url
const MAX_EV_PIECE = 16384;   // один кусок события
const MAX_EV = 10;            // кусков событий в одном запросе host
const MAX_C = 2048;           // команда телефона
const CMD_WINDOW_MS = 10 * 1000;
const CMD_LIMIT = 20;         // команд с одной сессии за 10 с

const SID_RE = /^[A-Za-z0-9_-]{22}$/;   // 16 байт base64url
const HOST_RE = /^[A-Za-z0-9_-]{43}$/;  // 32 байта base64url
const PIECE_RE = /^[A-Za-z0-9_-]*$/;    // кусок: base64url без «=»

// Лимиты частоты (server/common/rate.js). Счётчики живут в памяти экземпляра функции; в консоли
// у функции задан предел экземпляров, поэтому лимит почти общий. globalPerMin намеренно высокий:
// один телефон опрашивает раз в секунду, и общий предел не должен резать несколько пультов сразу.
const rateNew = createRate({ perIp: 10, globalPerMin: 6000 });    // новая сессия: 10 за 10 мин с адреса
// 16.11: телефон опрашивает раз в 1 с (после нажатия — 0,35 с), Тапёр — раз в 1 с (после команды — 0,4 с):
// прежних 800 за 10 мин хватало на 5–8 минут, дальше «Нет связи». 3000 — с запасом на частые нажатия.
const ratePhone = createRate({ perIp: 3000, globalPerMin: 12000 }); // poll + cmd: ≈ 3000 за 10 мин с адреса
const rateHost = createRate({ perIp: 3000, globalPerMin: 12000 });  // host: ≈ 3000 за 10 мин с адреса

// Команды на сессию: не чаще 20 за 10 с. Живёт в памяти экземпляра — в таблицу это не кладём
// (в схеме remote_sessions такого поля нет, а лимит нужен только от случайного зацикливания страницы).
const cmdHits = new Map();

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const ok = (body) => ({ status: 200, body, headers: {} });
const fail = (status, error, headers) => ({ status, body: { error }, headers: headers || {} });
const bad = () => fail(400, 'bad_request');
const slow = (sec) => fail(429, 'rate', { 'Retry-After': String(sec) });

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.PAGE_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
}

// CORS нужен только странице телефона: poll и cmd. new/host/end зовёт Node — им он ни к чему.
function withCors(op, res) {
  if (op !== 'poll' && op !== 'cmd') return res;
  return { status: res.status, body: res.body, headers: Object.assign(corsHeaders(), res.headers || {}) };
}

// Куски — строки base64url не длиннее max.
function piece(v, max) { return typeof v === 'string' && v.length <= max && PIECE_RE.test(v); }

// Значение из query: число ≥ 0. Числа принимаем и строкой («5»), и числом — так удобнее тестам.
// null — мусор (400). Отсутствует — 0.
function qint(v) {
  if (v === undefined) return 0;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function qget(q, k) {
  return q && typeof q === 'object' && has(q, k) ? q[k] : undefined;
}

// SHA-256 host: в базе только хеш, сам host живёт в памяти Тапёра и в QR.
function hostHash(host) { return crypto.createHash('sha256').update(String(host), 'utf8').digest(); }

function hostMatches(row, host) {
  if (!row || typeof row.host_hash !== 'string' || !row.host_hash) return false;
  const want = Buffer.from(row.host_hash, 'hex');
  const got = hostHash(host);
  if (want.length !== got.length) return false;
  return crypto.timingSafeEqual(want, got);
}

// Сессия живёт 12 ч от последнего host. Ровно 12 ч — уже истекла (строгое «старше»).
function stale(row, now) {
  if (!row) return true;
  const at = Number(row.host_at) || 0;
  return !(at > now - SESSION_TTL_MS);
}

function cmdSlot(sid, now) {
  const win = now - CMD_WINDOW_MS;
  const list = (cmdHits.get(sid) || []).filter((t) => t > win);
  if (list.length >= CMD_LIMIT) { cmdHits.set(sid, list); return false; }
  list.push(now);
  cmdHits.set(sid, list);
  // Изредка подчищаем память: страница могла слать команды давно и больше не вернуться.
  if (cmdHits.size > 5000) {
    for (const [k, v] of cmdHits) if (!v.length || v[v.length - 1] <= win) cmdHits.delete(k);
  }
  return true;
}

// Значения запроса host: форма проверяется до обращения к базе.
function hostBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const sid = body.sid, host = body.host;
  if (typeof sid !== 'string' || !SID_RE.test(sid)) return null;
  if (typeof host !== 'string' || !HOST_RE.test(host)) return null;
  if (has(body, 's') && !piece(body.s, MAX_S)) return null;
  if (has(body, 'f') && !piece(body.f, MAX_S)) return null;
  let ev = [];
  if (has(body, 'ev')) {
    if (!Array.isArray(body.ev) || body.ev.length > MAX_EV) return null;
    for (const e of body.ev) if (!piece(e, MAX_EV_PIECE)) return null;
    ev = body.ev;
  }
  if (has(body, 'ack') && !Number.isInteger(body.ack)) return null;
  return { sid, host, ev };
}

async function opNew(store, now) {
  const sid = crypto.randomBytes(16).toString('base64url');
  const host = crypto.randomBytes(32).toString('base64url');
  await store.put({
    sid,
    host_hash: hostHash(host).toString('hex'),
    s: '', sv: 0,
    f: '', fv: 0,
    ev: [], es: 0,
    cmds: [], cs: 0,
    host_at: now,
    phone_at: 0,
    exp: now + SESSION_TTL_MS
  });
  // ttl — в миллисекундах, как phoneAgo/hostAgo в протоколе.
  return ok({ sid, host, ttl: SESSION_TTL_MS });
}

async function opHost(body, store, now) {
  const v = hostBody(body);
  if (!v) return bad();
  let notFound = false, forbidden = false;
  const row = await store.update(v.sid, (cur) => {
    if (stale(cur, now)) { notFound = true; return null; }
    if (!hostMatches(cur, v.host)) { forbidden = true; return cur; }
    if (has(body, 's')) { cur.s = body.s; cur.sv = (Number(cur.sv) || 0) + 1; }
    if (has(body, 'f')) { cur.f = body.f; cur.fv = (Number(cur.fv) || 0) + 1; }
    if (v.ev.length) {
      const list = Array.isArray(cur.ev) ? cur.ev : [];
      let seq = Number(cur.es) || 0;
      for (const e of v.ev) { seq += 1; list.push({ seq, e }); }
      cur.es = seq;
      cur.ev = list.slice(-MAX_EVENTS);
    }
    if (has(body, 'ack')) {
      cur.cmds = (Array.isArray(cur.cmds) ? cur.cmds : []).filter((c) => Number(c.seq) > body.ack);
    }
    cur.host_at = now;
    cur.exp = now + SESSION_TTL_MS;
    return cur;
  });
  if (notFound) return fail(404, 'no-session');
  if (forbidden) return fail(403, 'forbidden');
  const phoneAgo = Number(row.phone_at) ? now - Number(row.phone_at) : null;
  return ok({ cmds: Array.isArray(row.cmds) ? row.cmds : [], phoneAgo });
}

async function opPoll(query, store, now) {
  const sid = qget(query, 'sid');
  if (typeof sid !== 'string' || !SID_RE.test(sid)) return bad();
  const sv = qint(qget(query, 'sv'));
  const fv = qint(qget(query, 'fv'));
  const es = qint(qget(query, 'es'));
  if (sv === null || fv === null || es === null) return bad();

  let notFound = false;
  const row = await store.update(sid, (cur) => {
    if (stale(cur, now)) { notFound = true; return null; }
    cur.phone_at = now;
    return cur;
  });
  if (notFound) return fail(404, 'no-session');

  const out = {
    sv: Number(row.sv) || 0,
    fv: Number(row.fv) || 0,
    ev: (Array.isArray(row.ev) ? row.ev : []).filter((e) => Number(e.seq) > es),
    hostAgo: now - (Number(row.host_at) || 0)
  };
  if (out.sv > sv) out.s = typeof row.s === 'string' ? row.s : '';
  if (out.fv > fv) out.f = typeof row.f === 'string' ? row.f : '';
  return ok(out);
}

async function opCmd(body, store, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad();
  const sid = body.sid, c = body.c;
  if (typeof sid !== 'string' || !SID_RE.test(sid)) return bad();
  if (!piece(c, MAX_C)) return bad();
  if (!cmdSlot(sid, now)) return slow(Math.ceil(CMD_WINDOW_MS / 1000));

  let notFound = false;
  await store.update(sid, (cur) => {
    if (stale(cur, now)) { notFound = true; return null; }
    const seq = (Number(cur.cs) || 0) + 1;
    cur.cs = seq;
    const cmds = Array.isArray(cur.cmds) ? cur.cmds : [];
    cmds.push({ seq, c });
    cur.cmds = cmds.slice(-MAX_CMDS);
    return cur;
  });
  if (notFound) return fail(404, 'no-session');
  return ok({ ok: true });
}

async function opEnd(body, store, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad();
  const sid = body.sid, host = body.host;
  if (typeof sid !== 'string' || !SID_RE.test(sid)) return bad();
  if (typeof host !== 'string' || !HOST_RE.test(host)) return bad();

  let notFound = false, forbidden = false;
  await store.update(sid, (cur) => {
    if (stale(cur, now)) { notFound = true; return null; }
    if (!hostMatches(cur, host)) { forbidden = true; return cur; }
    return null; // сессия удаляется
  });
  if (notFound) return fail(404, 'no-session');
  if (forbidden) return fail(403, 'forbidden');
  return ok({ ok: true });
}

// op, method, query, body, ip, store, now → { status, body, headers }
async function handle(op, method, query, body, ip, store, now) {
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const name = String(op || '');
  const how = String(method || '').toUpperCase();
  const event = { requestContext: { identity: { sourceIp: String(ip || '') } } };

  // Предварительный запрос браузера: тела нет, op может быть любым.
  if (how === 'OPTIONS') return { status: 204, body: null, headers: corsHeaders() };

  if (name === 'new') {
    if (how !== 'POST') return fail(405, 'method');
    const wait = rateNew.wait(event, at);
    if (wait) return slow(wait);
    return opNew(store, at);
  }
  if (name === 'host') {
    if (how !== 'POST') return fail(405, 'method');
    const wait = rateHost.wait(event, at);
    if (wait) return slow(wait);
    return opHost(body, store, at);
  }
  if (name === 'poll') {
    if (how !== 'GET') return withCors('poll', fail(405, 'method'));
    const wait = ratePhone.wait(event, at);
    if (wait) return withCors('poll', slow(wait));
    return withCors('poll', await opPoll(query, store, at));
  }
  if (name === 'cmd') {
    if (how !== 'POST') return withCors('cmd', fail(405, 'method'));
    const wait = ratePhone.wait(event, at);
    if (wait) return withCors('cmd', slow(wait));
    return withCors('cmd', await opCmd(body, store, at));
  }
  if (name === 'end') {
    if (how !== 'POST') return fail(405, 'method');
    return opEnd(body, store, at);
  }
  return bad();
}

// Хранилище в памяти — для тестов и dev-server.js. Интерфейс тот же, что у store-ydb.js.
// update() атомарен: на одну сессию выполняется ровно один «прочитал-изменил-записал», без
// переплетения параллельных вызовов (очередь промисов, как withKeyLock в yc-license).
function memoryStore() {
  const rows = new Map();
  const locks = new Map();
  const clone = (r) => (r ? JSON.parse(JSON.stringify(r)) : null);

  return {
    async get(sid) { return rows.has(sid) ? clone(rows.get(sid)) : null; },
    async put(row) { rows.set(row.sid, clone(row)); },
    async del(sid) { rows.delete(sid); },
    async update(sid, fn) {
      const prev = locks.get(sid) || Promise.resolve();
      let release;
      const mine = new Promise((r) => { release = r; });
      const chain = prev.then(() => mine);
      locks.set(sid, chain);
      await prev;
      try {
        const cur = rows.has(sid) ? clone(rows.get(sid)) : null;
        const next = await fn(cur);
        if (next) rows.set(sid, clone(next)); else rows.delete(sid);
        return next ? clone(next) : null;
      } finally {
        release();
        if (locks.get(sid) === chain) locks.delete(sid);
      }
    }
  };
}

// Только для тестов: сбросить лимиты частоты и счётчики команд между проверками.
function resetRates() {
  rateNew.reset();
  ratePhone.reset();
  rateHost.reset();
  cmdHits.clear();
}

module.exports = {
  handle, memoryStore, corsHeaders, resetRates,
  SESSION_TTL_MS, MAX_EVENTS, MAX_CMDS, MAX_S, MAX_EV_PIECE, MAX_EV, MAX_C, CMD_LIMIT
};
