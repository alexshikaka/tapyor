'use strict';
// Почтовый ящик событий Streamer.bot (0.35, этап Э2): <userData>\sbot-mailbox.json.
//
// Зачем: ответ DoAction значит только «Streamer.bot принял запрос», а не «шаблон выполнил
// действие». Поэтому события «заказ выполнен / снят», «приём» и поздний ответ лежат на диске,
// пока шаблон не пришлёт GET /sb/ack?id=<eventId>. Ящик переживает перезапуск Тапёра.
//
// Модуль без Electron, сети и таймеров — только файлы и часы, которые приходят параметрами.
// Покрыт tests/unit/sbot-mailbox.test.mjs.
//
// Правила (решение Claude 12.11):
//  • живёт не дольше 24 часов; просроченное уходит в журнал «не доставлено» и удаляется;
//  • повтор после первой отправки — через 10 с, потом 30 с, дальше каждые 60 с;
//  • удаляется ТОЛЬКО по ack;
//  • запись через временный файл, битый файл не стирается молча (откладывается рядом).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа
const RETRY_MS = [10000, 30000, 60000];      // после 1-й, 2-й, 3-й отправки; дальше 60 с
const MAX_ITEMS = 500;
const MAX_ARG_LEN = 1000;

function makeUuid() {
  try { if (typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (e) {}
  return 'ev-' + Date.now().toString(36) + '-' + crypto.randomBytes(8).toString('hex');
}

// Задержка до следующей попытки после `attempts` отправок.
function retryDelay(attempts) {
  const n = Math.max(0, Math.floor(Number(attempts) || 0));
  if (n <= 0) return 0;
  return RETRY_MS[Math.min(n - 1, RETRY_MS.length - 1)];
}

function str(v, n) { return String(v == null ? '' : v).slice(0, n); }
function num(v, def) { const n = Number(v); return isFinite(n) ? n : def; }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// Аргументы действий Streamer.bot — плоские: строки и числа. Никаких объектов и массивов.
function flatArgs(args) {
  const src = isObj(args) ? args : {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(k)) continue;
    const v = src[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else if (v == null) out[k] = '';
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_ARG_LEN);
    // объекты и массивы не пропускаем: Streamer.bot не разбирает вложенный JSON
  }
  return out;
}

function cleanEntry(e, now) {
  if (!isObj(e)) return null;
  const eventId = str(e.eventId, 80);
  const action = str(e.action, 200);
  if (!eventId || !action) return null;
  const ttlMs = Math.max(1000, num(e.ttlMs, DEFAULT_TTL_MS));
  return {
    eventId,
    action,
    args: flatArgs(e.args),
    createdAt: num(e.createdAt, now),
    attempts: Math.max(0, Math.floor(num(e.attempts, 0))),
    nextAt: Math.max(0, num(e.nextAt, 0)),
    ttlMs,
  };
}

function createMailbox(opts) {
  const o = opts || {};
  const file = String(o.file || '');
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const log = typeof o.log === 'function' ? o.log : () => {};
  const journal = o.journal && typeof o.journal.append === 'function' ? o.journal : { append: () => {} };
  const uuid = typeof o.uuid === 'function' ? o.uuid : makeUuid;
  let items = [];

  function save() {
    if (!file) return false;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, items }, null, 1), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      log('Streamer.bot: ящик не сохранён — ' + str(e && e.message, 160));
      return false;
    }
  }

  function load() {
    items = [];
    if (!file) return;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (e && e.code !== 'ENOENT') log('Streamer.bot: ящик не прочитан — ' + str(e.message, 160));
      return;
    }
    let data = null;
    try { data = JSON.parse(text); } catch (e) {
      // Не стираем молча: откладываем рядом, как settings-store с битым settings.json.
      try {
        const broken = file + '.broken-' + Date.now();
        fs.renameSync(file, broken);
        log('Streamer.bot: ящик был битым — отложен рядом');
      } catch (e2) { log('Streamer.bot: битый ящик не отложен — ' + str(e2 && e2.message, 160)); }
      return;
    }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
    const t = now();
    for (const raw of list) {
      const e = cleanEntry(raw, t);
      if (e) items.push(e);
      if (items.length >= MAX_ITEMS) break;
    }
  }

  function expired(e, at) { return at - e.createdAt >= e.ttlMs; }

  // Просроченные записи — в журнал «не доставлено» и удалить. Возвращает, сколько убрали.
  function sweep(at) {
    const t = num(at, now());
    const keep = [];
    let removed = 0;
    for (const e of items) {
      if (!expired(e, t)) { keep.push(e); continue; }
      removed++;
      try {
        journal.append({
          at: t, ev: 'undelivered', eventId: e.eventId, action: e.action,
          createdAt: e.createdAt, attempts: e.attempts, args: e.args,
        });
      } catch (err) { log('Streamer.bot: запись «не доставлено» не удалась — ' + str(err && err.message, 160)); }
    }
    if (removed) { items = keep; save(); }
    return removed;
  }

  function enqueue(action, args, ttlMs, eventId) {
    const t = now();
    sweep(t);
    const id = str(eventId, 80) || uuid();
    const e = {
      eventId: id,
      action: str(action, 200),
      args: flatArgs(args),
      createdAt: t,
      attempts: 0,
      nextAt: 0,
      ttlMs: Math.max(1000, num(ttlMs, DEFAULT_TTL_MS)),
    };
    if (!e.action) return null;
    items.push(e);
    while (items.length > MAX_ITEMS) items.shift();
    save();
    return e;
  }

  function ack(eventId) {
    const id = str(eventId, 80);
    const i = items.findIndex((e) => e.eventId === id);
    if (i < 0) return false;
    items.splice(i, 1);
    save();
    return true;
  }

  function markAttempt(eventId, at) {
    const id = str(eventId, 80);
    const e = items.find((x) => x.eventId === id);
    if (!e) return false;
    const t = num(at, now());
    e.attempts += 1;
    e.nextAt = t + retryDelay(e.attempts);
    save();
    return true;
  }

  // Что уже пора отправить.
  function due(at) {
    const t = num(at, now());
    return items.filter((e) => !expired(e, t) && e.nextAt <= t).map((e) => Object.assign({}, e, { args: Object.assign({}, e.args) }));
  }

  // После переподключения всё недоставленное отправляем сразу.
  function rescheduleAll() {
    if (!items.length) return 0;
    for (const e of items) e.nextAt = 0;
    save();
    return items.length;
  }

  function count() { return items.length; }
  function all() { return items.map((e) => Object.assign({}, e, { args: Object.assign({}, e.args) })); }
  function get(eventId) {
    const e = items.find((x) => x.eventId === str(eventId, 80));
    return e ? Object.assign({}, e, { args: Object.assign({}, e.args) }) : null;
  }

  load();
  sweep(now());

  return {
    file, load, save, sweep, enqueue, ack, markAttempt, due, rescheduleAll,
    count, all, get,
    // для тестов и отладки
    retryDelay,
  };
}

module.exports = {
  createMailbox,
  flatArgs,
  retryDelay,
  makeUuid,
  DEFAULT_TTL_MS,
  RETRY_MS,
  MAX_ITEMS,
};
