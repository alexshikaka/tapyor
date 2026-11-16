'use strict';
// Порт Тапёра для Streamer.bot (0.35, этап Э1): GET /sb/* на том же локальном сервере,
// что отдаёт панель OBS и страницы модулей.
//
// Здесь только протокол: проверка ключа и Origin, разбор параметров, безопасные значения,
// дедлайн ответа, повторы, плоский JSON. Всё остальное (поиск, очередь, окно, настройки)
// приходит через deps — поэтому модуль без Electron и покрыт unit-тестами:
// tests/unit/sbot-port.test.mjs.
//
// Почему ответ всегда 200 + JSON (кроме 401/403): в Streamer.bot 1.0.7 ответ HTTP 500
// не раскладывается ни в одну переменную — как будто ответа не было. Поэтому ошибки
// уходят в status/reply, а не в код ответа.
//
// Решения 12.11 (важнее плана): ответ на /sb/order не позже 8 с — иначе status "search",
// поиск продолжается и итог отдаётся колбэком onLateResult; общая настройка chatOrders;
// не больше 3 поисков и очередь 100; повтор того же msg/redemption — тот же ответ.

const crypto = require('crypto');
const chatorders = require('./chatorders');
const texts = require('./sbot-texts');

const TEMPLATE_CURRENT = 1;
const TEMPLATE_MIN = 1;
const DEADLINE_MS = 8000;          // ответ на /sb/order не позже (решение 11.11–12.11)
const SEARCH_MAX = 3;              // одновременных поисков
const SEARCH_QUEUE_MAX = 100;      // сколько заказов может ждать разбора
const SEARCH_HARD_MS = 30000;      // дольше поиск не держит место в очереди
const REPEAT_TTL_MS = 10 * 60 * 1000;
const REPEAT_MAX = 500;
const PLATFORM_RE = /^[a-z0-9_-]{1,16}$/;

// Сравнение ключа постоянного времени: сначала sha256 (одинаковая длина), потом timingSafeEqual.
// Так длина введённого ключа не видна по времени ответа.
function hashKey(s) {
  return crypto.createHash('sha256').update(String(s == null ? '' : s), 'utf8').digest();
}
function keyMatches(a, b) {
  try { return crypto.timingSafeEqual(hashKey(a), hashKey(b)); } catch (e) { return false; }
}

// Порт ещё не создан (окно стартует): без данных и без обхода ключа — 503 starting (A35-14).
// Раньше отвечали 200 {status:'off'}, и контракт «без ключа — 401» нарушался.
function startingReply() {
  return { code: 503, body: { status: 'starting' } };
}

function posInt(v, def) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.floor(n) : def;
}
function clampInt(v, def, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return def;
  const i = Math.round(n);
  return i < lo ? lo : i > hi ? hi : i;
}
function short(v, n) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
}
function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj || {}, k); }
function firstHeader(v) { return Array.isArray(v) ? v[0] : v; }
function safeMsg(e) { return String((e && e.message) || e || '').slice(0, 160); }

// Границы поисков: не больше max одновременно, очередь — не длиннее queueMax.
// Дедлайн ответа (/sb/order) сюда не входит — он в withDeadline. Здесь только
// освобождение места и жёсткий предел, чтобы зависший поиск не занял слот навсегда.
function createGate(max, queueMax, hardMs) {
  let running = 0;
  const queue = [];
  function next() { while (running < max && queue.length) start(queue.shift()); }
  function start(t) {
    if (t.finished) return;
    running++;
    t.started = true;
    Promise.resolve().then(t.fn).then((v) => done(t, { value: v }), (e) => done(t, { error: e }));
  }
  function done(t, r) {
    if (t.finished) return;
    t.finished = true;
    if (t.started) running--;
    if (!t.answered) { t.answered = true; t.resolve(r); }
    else if (t.onLate) { try { t.onLate(r); } catch (e) {} }
    next();
  }
  function expire(t) {
    if (t.finished) return;
    t.finished = true;
    if (t.started) running--;
    else { const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); }
    if (!t.answered) { t.answered = true; t.resolve({ timeout: true }); }
    next();
  }
  return {
    submit(fn, onLate) {
      return new Promise((resolve) => {
        const t = { fn, onLate: onLate || null, resolve, answered: false, finished: false, started: false };
        if (running < max) start(t);
        else if (queue.length < queueMax) queue.push(t);
        else { resolve({ busy: true }); return; }
        t.timer = setTimeout(() => expire(t), hardMs);
        // Таймер без unref: пока зритель ждёт ответа, его надо дождаться (с unref Node 22 в CI обрывал тест).
      });
    },
    stats() { return { running, queued: queue.length }; },
  };
}

function createPort(deps) {
  const d = deps || {};
  const log = typeof d.log === 'function' ? d.log : () => {};
  const journal = d.journal && typeof d.journal.append === 'function' ? d.journal : { append: () => {} };
  const version = () => String(d.version == null ? '' : d.version);
  const templateCurrent = posInt(d.templateCurrent, TEMPLATE_CURRENT);
  const templateMin = posInt(d.templateMin, TEMPLATE_MIN);
  const deadlineMs = posInt(d.deadlineMs, DEADLINE_MS);
  const repeatTtl = posInt(d.repeatTtlMs, REPEAT_TTL_MS);
  const repeatMax = posInt(d.repeatMax, REPEAT_MAX);
  const gate = createGate(posInt(d.searchMax, SEARCH_MAX), posInt(d.searchQueueMax, SEARCH_QUEUE_MAX), posInt(d.searchHardMs, SEARCH_HARD_MS));

  const cache = new Map();     // dedup → { at, body }
  const inflight = new Map();  // dedup → Promise<body>
  const reserved = [];         // идущие поиски: [{uid, platform}] — занимают perUser

  // ── плоский ответ ────────────────────────────────────────────────────────
  function base(extra, tplOk) {
    const body = Object.assign({
      status: '', reply: '', orderId: '', track: '', artist: '', title: '',
      place: '', etaMin: '', reason: '', refund: false,
      tapyor: version(), templateOk: tplOk !== false,
    }, extra || {});
    // Шаблон шлёт в чат res.reply как есть: пустой ник не должен оставлять «, твой трек…»,
    // а слишком длинный текст Twitch не примет — обрезаем до 480 с многоточием (A35-6).
    body.reply = texts.clip(texts.tidy(body.reply), texts.REPLY_MAX);
    return body;
  }

  // Ник и uid зрителя. user — только для текста и журнала; uid — для поиска заказов.
  // Если шаблон прислал только uid, ника нет: в чат уйдёт фраза без «@», но никогда не «@<uid>».
  function viewerOf(q) {
    let uid = short(q.get('uid'), 80).replace(/\s+/g, '_');
    let user = short(q.get('user'), 60).replace(/\s+/g, ' ');
    if (user.charAt(0) === '@') user = user.slice(1).trim();
    if (!uid) uid = user;
    const platformRaw = short(q.get('platform'), 16).toLowerCase();
    return { uid, user, platform: PLATFORM_RE.test(platformRaw) ? platformRaw : 'twitch' };
  }

  // free=1 — стример или VIP/модератор при «VIP без ограничений». Права проверил шаблон, ключ
  // порта проверен выше, поэтому верим: проверки по очереди (perUser, chatCap) не применяем.
  function isFree(raw) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
  }

  function chatMode() {
    return String(typeof d.getChatOrders === 'function' ? d.getChatOrders() : 'none');
  }

  // Когда заказы из чата принимает не Streamer.bot — шаблон молчит (раздел 9 плана),
  // иначе на «!sr»/«!song» ответят и бот пака, и Тапёр.
  function offBody(tplOk) {
    return base({ status: 'off', reply: '' }, tplOk);
  }

  function tplCheck(raw, required) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return required ? { old: true, templateOk: false } : { old: false, templateOk: true };
    if (!/^\d+$/.test(s)) return { old: true, templateOk: false };
    const n = parseInt(s, 10);
    if (n < templateMin) return { old: true, templateOk: false };
    if (n < templateCurrent) return { old: false, templateOk: false };
    return { old: false, templateOk: true };
  }

  function isPoints(ctx) { return ctx.kind === 'points'; }
  function pointsRefund(ctx, status) {
    if (!isPoints(ctx)) return false;
    return ['notfound', 'rule', 'limit', 'closed', 'ask', 'error', 'off'].indexOf(status) >= 0;
  }

  function oldBody() {
    return base({ status: 'old', reply: texts.make('old') }, false);
  }
  function notFoundBody(ctx) {
    return base({ status: 'notfound', reply: texts.make('notFound', { ник: ctx.nick }), refund: pointsRefund(ctx, 'notfound') }, ctx.templateOk);
  }
  function ruleBody(ctx, reason) {
    const human = texts.REASONS[reason] || String(reason || 'не подходит');
    return base({
      status: 'rule', reply: texts.make('rules', { ник: ctx.nick, причина: human }),
      reason: human, refund: pointsRefund(ctx, 'rule'),
    }, ctx.templateOk);
  }
  function closedBody(ctx) {
    return base({ status: 'closed', reply: texts.make('closed', { ник: ctx.nick }), refund: pointsRefund(ctx, 'closed') }, ctx.templateOk);
  }
  function errorBody(ctx, kind) {
    const reply = kind === 'overload' ? texts.make('overload') : texts.make('error', { ник: ctx.nick });
    return base({
      status: 'error', reply,
      reason: kind === 'overload' ? 'слишком много заказов сразу' : '',
      refund: pointsRefund(ctx, 'error'),
    }, ctx.templateOk);
  }
  function searchBody(ctx) {
    return base({
      status: 'search',
      // Общая фраза без текста зрителя: в нём могли быть чужие упоминания и ссылки.
      reply: texts.make('search', { ник: ctx.nick }),
      refund: false,
    }, ctx.templateOk);
  }

  function limitBody(ctx, kind, mine, snap) {
    if (kind === 'chat') {
      return base({
        status: 'limit', reply: texts.make('queueFull', { ник: ctx.nick }),
        reason: 'очередь заказов полна', refund: pointsRefund(ctx, 'limit'),
      }, ctx.templateOk);
    }
    const first = mine && mine[0];
    const label = first && first.track ? chatorders.trackLabel(first.track) : '';
    // Место ждущего заказа — для подстановки {place} в своей фразе «Уже ждёт» (A35-10).
    let place = '';
    if (first) {
      const s = snap || {};
      if (s.playing && s.playing === first.key) place = 0;
      else if (Array.isArray(s.items)) {
        const idx = s.items.findIndex((x) => x && x.key === first.key);
        if (idx >= 0) place = idx + 1;
      }
    }
    const reply = label
      ? texts.make('limitTrack', { ник: ctx.nick, трек: label })
      : texts.make('active', { ник: ctx.nick });
    return base({
      status: 'limit', reply, track: label, place,
      artist: first && first.track ? (first.track.author || '') : '',
      title: first && first.track ? (first.track.title || '') : '',
      reason: 'у тебя уже ждёт заказ', refund: pointsRefund(ctx, 'limit'),
    }, ctx.templateOk);
  }

  function askBody(ctx, rec) {
    const items = (rec && Array.isArray(rec.items) ? rec.items : []).filter((it) => it && it.track);
    const primary = items[0] ? items[0].track : null;
    const options = [];
    for (const t of [primary].concat((items[0] && items[0].alts) || [])) {
      if (!t || options.indexOf(t) >= 0) continue;
      if (!checkTrack(t).ok) continue;
      options.push(t);
      if (options.length >= 2) break;
    }
    let reply;
    if (options.length > 1) {
      reply = texts.make('choose', { ник: ctx.nick, варианты: options.map((t, i) => (i + 1) + ') ' + chatorders.trackLabel(t)).join(' ') });
    } else if (options.length === 1) {
      reply = texts.make('askOne', { ник: ctx.nick, трек: chatorders.trackLabel(options[0]) });
    } else {
      reply = texts.make('clarify', { ник: ctx.nick });
    }
    const one = options[0] || primary;
    return base({
      status: 'ask', reply,
      track: one ? chatorders.trackLabel(one) : '',
      artist: one ? (one.author || '') : '', title: one ? (one.title || '') : '',
      refund: pointsRefund(ctx, 'ask'),
    }, ctx.templateOk);
  }

  function checkTrack(t) {
    try { return (typeof d.checkTrack === 'function' ? d.checkTrack(t) : { ok: true }) || { ok: true }; }
    catch (e) { return { ok: false, reason: 'error' }; }
  }

  function makeOrderKey(isPts) {
    return (isPts ? 'sb-points:' : 'sb-cmd:') + (isPts ? 'sp' : 'sc') + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  }

  async function placeOrder(ctx, track, doubt, item) {
    const isPts = isPoints(ctx);
    const key = makeOrderKey(isPts);
    ctx.key = key;
    // Варианты и пометки найденного трека переносим в запись: по ним карточка в «Заказах»
    // показывает причину и другие версии (A35-4).
    const alts = item && Array.isArray(item.alts) ? item.alts.filter(Boolean).slice(0, 5) : [];
    const flags = item && Array.isArray(item.flags) ? item.flags.slice(0, 10) : [];
    const rec = {
      prov: isPts ? 'sb-points' : 'sb-cmd',
      id: key.slice(key.indexOf(':') + 1),
      key,
      name: ctx.user,
      uid: ctx.uid,
      platform: ctx.platform,
      text: ctx.text,
      amount: null,
      currency: '',
      // Для возврата баллов шаблону нужны номер награды и номер списания (Э2).
      reward: ctx.reward || '',
      redemption: ctx.redemption || '',
      items: [{ level: doubt ? 'doubt' : 'exact', track, alts, flags, paid: true }],
      level: doubt ? 'doubt' : 'exact',
      state: 'new',
      got: Date.now(),
      bot: true,
      botAuto: !doubt,
    };
    let placed = { place: null, etaSec: null };
    try {
      if (typeof d.addOrder === 'function') placed = (await d.addOrder(rec, { wait: !doubt })) || placed;
    } catch (e) {
      log('Streamer.bot: заказ не создан — ' + safeMsg(e));
      return errorBody(ctx, 'error');
    }
    const place = typeof placed.place === 'number' && isFinite(placed.place) ? placed.place : '';
    const etaSec = typeof placed.etaSec === 'number' && isFinite(placed.etaSec) ? placed.etaSec : null;
    // Заказ не встал ждать, а заиграл сразу: окно прислало место 1 и ETA 0 (очередь была пуста
    // или ничего не играло). Второй признак — снимок очереди уже говорит, что играет именно он:
    // так фраза не соврёт, даже если окно не успело посчитать ETA. Иначе «через ~1 мин» неправда.
    let playingNow = false;
    try {
      const after = typeof d.queueState === 'function' ? d.queueState() : null;
      playingNow = !!(after && after.playing && after.playing === key);
    } catch (e) { playingNow = false; }
    const startedNow = !doubt && ((place === 1 && etaSec === 0) || playingNow);
    const etaMin = startedNow ? 0 : (etaSec == null ? '' : Math.max(1, Math.round(etaSec / 60)));
    const label = chatorders.trackLabel(track);
    const vars = {
      ник: ctx.nick,
      трек: label,
      время: texts.fmtTime(etaSec),
      место: place === '' ? '' : place,
      причина: '',
    };
    return base({
      status: doubt ? 'pending' : 'queued',
      reply: doubt ? texts.make('awaiting', vars) : startedNow ? texts.make('queuedNow', vars) : texts.make('queued', vars),
      orderId: key,
      track: label,
      artist: track ? (track.author || '') : '',
      title: track ? (track.title || '') : '',
      place,
      etaMin,
      refund: false,
    }, ctx.templateOk);
  }

  // ── один заказ ───────────────────────────────────────────────────────────
  async function processOrder(ctx) {
    const list = (typeof d.listOrders === 'function' ? d.listOrders() : []) || [];
    const snap = (typeof d.queueState === 'function' ? d.queueState() : null) || {};
    const viewer = { uid: ctx.uid, platform: ctx.platform };

    // free=1 (стример, VIP/модератор при «VIP без ограничений»): очередь и лимиты не проверяем.
    if (!ctx.free) {
      if (chatorders.chatWaiting(list, snap) >= ctx.limits.chatCap) return limitBody(ctx, 'chat', null);
      const mine = chatorders.viewerActive(list, snap, viewer);
      const busySame = reserved.filter((r) => r.uid === ctx.uid && r.platform === ctx.platform).length;
      if (mine.length + busySame >= ctx.limits.perUser) return limitBody(ctx, 'user', mine, snap);
    }

    reserved.push(ctx);
    let res;
    try {
      res = await gate.submit(() => {
        if (typeof d.findOrder !== 'function') throw new Error('поиск недоступен');
        return d.findOrder(ctx.text, { fromCommand: true, paid: isPoints(ctx) });
      });
    } finally {
      const i = reserved.indexOf(ctx);
      if (i >= 0) reserved.splice(i, 1);
    }
    if (!res || res.busy) return errorBody(ctx, 'overload');
    if (res.timeout) { log('Streamer.bot: поиск не уложился в отведённое время'); return errorBody(ctx, 'error'); }
    if (res.error) { log('Streamer.bot: поиск — ' + safeMsg(res.error)); return errorBody(ctx, 'error'); }

    const rec = res.value || {};
    const items = (Array.isArray(rec.items) ? rec.items : []).filter((it) => it && it.track);
    const exact = items.find((it) => it.level === 'exact');
    if (exact) {
      const rule = checkTrack(exact.track);
      if (!rule.ok) return ruleBody(ctx, rule.reason);
      return placeOrder(ctx, exact.track, false, exact);
    }
    const doubt = items[0];
    if (doubt && doubt.track) {
      // Сомнительный трек тоже проверяем правилами: 18+, длина, стоп-лист, «не музыка»
      // не должны попадать в «Заказы» даже как «под сомнением» (A35-4).
      const rule = checkTrack(doubt.track);
      if (!rule.ok) return ruleBody(ctx, rule.reason);
      if (ctx.limits.doubt === 'ask') return askBody(ctx, rec);
      return placeOrder(ctx, doubt.track, true, doubt);
    }
    return notFoundBody(ctx);
  }

  function journalOrder(ctx, body) {
    try {
      journal.append({
        at: Date.now(),
        ev: 'order',
        status: String((body && body.status) || ''),
        key: String((body && body.orderId) || ctx.key || ''),
        user: ctx.user,
        uid: ctx.uid,
        platform: ctx.platform,
        kind: ctx.kind,
        text: ctx.text,
        track: String((body && body.track) || ''),
        reason: String((body && body.reason) || ''),
      });
    } catch (e) { log('Streamer.bot: журнал заказа не записан — ' + safeMsg(e)); }
  }

  // Дедлайн 8 секунд на весь заказ (поиск + постановка в очередь). Не успели — search,
  // а настоящий итог уходит в onLateResult (в Э2 — действие «Тапёр: ответ»).
  function withDeadline(ctx) {
    return new Promise((resolve) => {
      let answered = false;
      let timer = null;
      const finish = (body) => {
        if (answered) return false;
        answered = true;
        if (timer) clearTimeout(timer);
        journalOrder(ctx, body);
        resolve(body);
        return true;
      };
      // Дедлайн 8 с без unref: открытый HTTP-запрос Streamer.bot должен получить ответ (0.35.1, CI на Node 22).
      timer = setTimeout(() => finish(searchBody(ctx)), deadlineMs);
      Promise.resolve().then(() => processOrder(ctx)).then((body) => {
        if (!answered) { finish(body); return; }
        if (ctx.dedup) cacheSet(ctx.dedup, body);
        try { if (typeof d.onLateResult === 'function') d.onLateResult(ctx, body); }
        catch (e) { log('Streamer.bot: поздний ответ — ' + safeMsg(e)); }
      }, () => {
        const body = errorBody(ctx, 'error');
        if (!answered) { finish(body); return; }
        if (ctx.dedup) cacheSet(ctx.dedup, body);
        try { if (typeof d.onLateResult === 'function') d.onLateResult(ctx, body); } catch (e) {}
      });
    });
  }

  function cacheGet(k) {
    const e = cache.get(k);
    if (!e) return null;
    if (Date.now() - e.at > repeatTtl) { cache.delete(k); return null; }
    return e.body;
  }
  function cacheSet(k, body) {
    if (!k || !body) return;
    cache.set(k, { at: Date.now(), body });
    while (cache.size > repeatMax) cache.delete(cache.keys().next().value);
  }

  function orderText(raw, cmd) {
    let s = short(raw, 600);
    const c = short(cmd, 40);
    if (c) {
      const low = s.toLowerCase(), cl = c.toLowerCase();
      if (low === cl) return '';
      if (low.indexOf(cl) === 0 && /^\s/.test(s.slice(c.length))) s = s.slice(c.length).trim();
    }
    return s.slice(0, 500);
  }

  function dedupKeyOf(ctx, q) {
    const redemption = short(q.get('redemption'), 120);
    const msg = short(q.get('msg'), 120);
    if (!redemption && !msg) return '';
    return ctx.platform + '|' + ctx.uid + '|' + (redemption ? 'r:' + redemption : 'm:' + msg);
  }

  function handleOrder(q) {
    const kind = q.get('kind') === 'points' ? 'points' : 'cmd';
    const isPts = kind === 'points';
    const tpl = tplCheck(q.get('v'), true);
    if (chatMode() !== 'sbot') return Promise.resolve(base({ status: 'off', reply: '', refund: isPts }, tpl.templateOk));
    if (tpl.old) return Promise.resolve(oldBody());

    const v = viewerOf(q);
    const ctx = {
      user: v.user, uid: v.uid, platform: v.platform, kind, templateOk: tpl.templateOk,
      nick: texts.nick(v.user),
      free: isFree(q.get('free')),
      text: orderText(q.get('text'), q.get('cmd')),
      msg: short(q.get('msg'), 120),
      redemption: short(q.get('redemption'), 120),
      reward: short(q.get('reward'), 120),
      limits: chatorders.safeLimits({ perUser: q.get('perUser'), chatCap: q.get('chatCap'), doubt: q.get('doubt') }),
      dedup: '', key: '',
    };
    if (!v.uid) return Promise.resolve(base({ status: 'error', reply: texts.make('error', { ник: '' }), refund: isPts }, ctx.templateOk));
    const accepting = typeof d.getAccepting === 'function' ? d.getAccepting() : true;
    if (!accepting) return Promise.resolve(closedBody(ctx));
    if (!ctx.text) return Promise.resolve(notFoundBody(ctx));

    ctx.dedup = dedupKeyOf(ctx, q);
    if (ctx.dedup) {
      const hit = cacheGet(ctx.dedup);
      if (hit) return Promise.resolve(hit);
      const running = inflight.get(ctx.dedup);
      if (running) return running;
    }
    const p = withDeadline(ctx);
    if (ctx.dedup) {
      inflight.set(ctx.dedup, p);
      p.then((body) => { inflight.delete(ctx.dedup); cacheSet(ctx.dedup, body); }, () => { inflight.delete(ctx.dedup); });
    }
    return p;
  }

  // ── отмена своего заказа ─────────────────────────────────────────────────
  function handleCancel(q) {
    const tpl = tplCheck(q.get('v'), false);
    if (chatMode() !== 'sbot') return base({ status: 'off', reply: '' }, tpl.templateOk);
    if (tpl.old) return oldBody();
    const v = viewerOf(q);
    const nick = texts.nick(v.user);
    const list = (typeof d.listOrders === 'function' ? d.listOrders() : []) || [];
    const snap = (typeof d.queueState === 'function' ? d.queueState() : null) || {};
    const mine = chatorders.viewerActive(list, snap, { uid: v.uid, platform: v.platform });
    // Отменяем только ожидающий заказ: играющий трек зритель оборвать не может, его пропускает
    // стример. Иначе !cancel снимал песню, которая уже звучит в эфире.
    const waiting = mine.filter((o) => !o.playing);
    const last = waiting.length ? waiting[waiting.length - 1] : null;
    if (!last) {
      const playing = mine.find((o) => o.playing);
      if (playing) {
        const label = chatorders.trackLabel(playing.track);
        return base({
          status: 'playing', reply: texts.make('cancelPlaying', { ник: nick }),
          orderId: playing.key, track: label,
          artist: playing.track ? (playing.track.author || '') : '',
          title: playing.track ? (playing.track.title || '') : '',
          refund: false,
        }, tpl.templateOk);
      }
      return base({ status: 'nothing', reply: texts.make('nothingToCancel', { ник: nick }) }, tpl.templateOk);
    }
    try { if (typeof d.removeOrder === 'function') d.removeOrder(last.key); }
    catch (e) { log('Streamer.bot: заказ не убран — ' + safeMsg(e)); }
    // Баллы возвращает шаблон по событию «заказ снят», а не по этому ответу.
    if (/^sb-points:/.test(last.key)) {
      try { if (typeof d.emitEvent === 'function') d.emitEvent('dropped', last.key, 'cancel'); } catch (e) {}
    }
    try {
      journal.append({ at: Date.now(), ev: 'cancel', status: 'cancelled', key: last.key, user: v.user, uid: v.uid, platform: v.platform, kind: /^sb-points:/.test(last.key) ? 'points' : 'cmd', track: chatorders.trackLabel(last.track) });
    } catch (e) { log('Streamer.bot: журнал отмены не записан — ' + safeMsg(e)); }
    return base({
      status: 'cancelled', reply: texts.make('cancelled', { ник: nick }),
      orderId: last.key, track: chatorders.trackLabel(last.track),
      artist: last.track ? (last.track.author || '') : '', title: last.track ? (last.track.title || '') : '',
      refund: false,
    }, tpl.templateOk);
  }

  // ── «что играет», «моё место», «дальше», «статус» ───────────────────────
  // Название играющего трека для ответов: у снимка окна уже «Исполнитель — Название».
  function nowLabel(now) {
    if (!now) return '';
    return now.track || ((now.artist ? now.artist + ' — ' : '') + (now.title || ''));
  }

  function handleNow(q) {
    const tpl = tplCheck(q.get('v'), false);
    if (chatMode() !== 'sbot') return offBody(tpl.templateOk);
    if (tpl.old) return oldBody();
    const snap = (typeof d.queueState === 'function' ? d.queueState() : null) || {};
    const now = snap.now || null;
    if (!now || !now.title) return base({ status: 'none', reply: texts.make('nowNothing'), playing: 0 }, tpl.templateOk);
    const label = nowLabel(now);
    const who = now.orderId ? String(now.who || '') : '';
    return base({
      status: 'ok', playing: 1,
      reply: who ? texts.make('nowPlayingBy', { трек: label, ник: texts.nick(who) }) : texts.make('nowPlaying', { трек: label }),
      track: label,
      artist: now.artist || '', title: now.title || '',
      orderId: now.orderId || '', user: now.who || '',
    }, tpl.templateOk);
  }

  function handlePlace(q) {
    const tpl = tplCheck(q.get('v'), false);
    if (chatMode() !== 'sbot') return offBody(tpl.templateOk);
    if (tpl.old) return oldBody();
    const v = viewerOf(q);
    const nick = texts.nick(v.user);
    const list = (typeof d.listOrders === 'function' ? d.listOrders() : []) || [];
    const snap = (typeof d.queueState === 'function' ? d.queueState() : null) || {};
    const mine = chatorders.viewerActive(list, snap, { uid: v.uid, platform: v.platform });
    if (!mine.length) return base({ status: 'none', reply: texts.make('noOrder', { ник: nick }) }, tpl.templateOk);
    const last = mine[mine.length - 1];
    const label = chatorders.trackLabel(last.track);
    const artist = last.track ? (last.track.author || '') : '';
    const title = last.track ? (last.track.title || '') : '';
    if (snap.playing && snap.playing === last.key) {
      return base({ status: 'playing', reply: texts.make('placePlaying', { ник: nick }), orderId: last.key, track: label, artist, title, place: 0, etaMin: 0 }, tpl.templateOk);
    }
    const items = Array.isArray(snap.items) ? snap.items : [];
    const idx = items.findIndex((x) => x && x.key === last.key);
    if (idx < 0) return base({ status: 'pending', reply: texts.make('placePending', { ник: nick }), orderId: last.key, track: label, artist, title, place: '', etaMin: '' }, tpl.templateOk);
    let etaSec = Number(snap.curLeft) || 0;
    for (let i = 0; i < idx; i++) etaSec += Number(items[i] && items[i].seconds) || 0;
    return base({
      status: 'ok', reply: texts.make('placeWaiting', { ник: nick, трек: label, место: idx + 1, время: texts.fmtTime(etaSec) }),
      orderId: last.key, track: label, artist, title,
      place: idx + 1, etaMin: Math.max(1, Math.round(etaSec / 60)),
    }, tpl.templateOk);
  }

  function handleNext(q) {
    const tpl = tplCheck(q.get('v'), false);
    if (chatMode() !== 'sbot') return offBody(tpl.templateOk);
    if (tpl.old) return oldBody();
    const snap = (typeof d.queueState === 'function' ? d.queueState() : null) || {};
    const n = clampInt(q.get('n'), 3, 1, 5);
    const list = (Array.isArray(snap.next) ? snap.next : []).slice(0, n)
      .map((t, i) => (i + 1) + '. ' + chatorders.trackLabel(t));
    return base({
      status: 'ok', list: list.join(' | '), count: list.length,
      reply: list.length ? texts.make('nextList', { список: list.join(' | ') }) : texts.make('nextEmpty'),
    }, tpl.templateOk);
  }

  function handleStatus(q) {
    const snap = (typeof d.queueState === 'function' ? d.queueState() : null) || {};
    const waiting = Array.isArray(snap.keys) ? snap.keys.length : 0;
    const accepting = typeof d.getAccepting === 'function' ? !!d.getAccepting() : true;
    const mode = String(typeof d.getChatOrders === 'function' ? d.getChatOrders() : 'none');
    return base({
      status: 'ok', reply: '', accepting: accepting ? 1 : 0,
      orders: waiting, playing: snap.playing ? 1 : 0, chatOrders: mode,
    }, true);
  }

  // ── подтверждение события почтового ящика (Э2) ───────────────────────────
  // Шаблон после выполнения действия зовёт GET /sb/ack?id=<eventId>. Только после этого
  // Тапёр удаляет событие из sbot-mailbox.json. Ответ плоский, как у остальных маршрутов.
  function handleAck(q) {
    const id = short(q.get('id'), 80);
    let ok = false;
    if (id && /^[A-Za-z0-9_-]{1,80}$/.test(id)) {
      try { ok = typeof d.onAck === 'function' ? !!d.onAck(id) : false; }
      catch (e) { log('Streamer.bot: подтверждение не принято — ' + safeMsg(e)); }
    }
    try { journal.append({ at: Date.now(), ev: 'ack', eventId: id, ok: ok ? 1 : 0 }); } catch (e) { log('Streamer.bot: журнал подтверждения не записан — ' + safeMsg(e)); }
    return { status: 'ok', acked: ok ? 1 : 0 };
  }

  // ── управление плеером и приёмом ─────────────────────────────────────────
  function handleControl(q) {
    const tpl = tplCheck(q.get('v'), false);
    if (chatMode() !== 'sbot') return offBody(tpl.templateOk);
    if (tpl.old) return oldBody();
    const v = viewerOf(q);
    const snap = (typeof d.queueState === 'function' ? d.queueState() : null) || {};
    const what = short(q.get('do'), 20).toLowerCase();
    if (['skip', 'pause', 'play'].indexOf(what) < 0 && what !== 'vol') {
      return base({ status: 'error', reply: 'неизвестное управление' }, tpl.templateOk);
    }
    let value;
    if (what === 'vol') {
      const raw = q.get('value');
      if (raw == null || String(raw).trim() === '') return base({ status: 'error', reply: 'громкость не понял' }, tpl.templateOk);
      const n = Number(raw);
      if (!isFinite(n)) return base({ status: 'error', reply: 'громкость не понял' }, tpl.templateOk);
      value = clampInt(n, 0, 0, 100);
    }
    // «Пропустил: <трек>» — трек, который играл до пропуска. Плеер отвечает только «принято»,
    // поэтому берём название из последнего снимка окна; пусто — пропускать нечего.
    const skipLabel = what === 'skip' ? nowLabel(snap.now) : '';
    let r = { ok: false };
    try { if (typeof d.control === 'function') r = d.control(what, value) || r; } catch (e) { r = { ok: false }; }
    if (!r.ok) return base({ status: 'error', reply: 'плеер не ответил' }, tpl.templateOk);
    let reply;
    if (what === 'skip') reply = skipLabel ? texts.make('skipDone', { трек: skipLabel }) : texts.make('skipNothing');
    else if (what === 'pause') reply = texts.make('pauseDone');
    else if (what === 'play') reply = texts.make('playDone');
    else reply = texts.make('volDone', { громкость: value });
    try { journal.append({ at: Date.now(), ev: 'control', do: what, volume: what === 'vol' ? value : '', track: what === 'skip' ? skipLabel : '', user: v.user, uid: v.uid, platform: v.platform }); } catch (e) { log('Streamer.bot: журнал управления не записан — ' + safeMsg(e)); }
    return base({ status: 'ok', reply, volume: what === 'vol' ? value : undefined }, tpl.templateOk);
  }

  function handleAccept(q) {
    const raw = String(q.get('on') == null ? '' : q.get('on')).trim().toLowerCase();
    const open = raw === '1' || raw === 'true' || raw === 'on' ? true : (raw === '0' || raw === 'false' || raw === 'off' ? false : null);
    if (open == null) return base({ status: 'error', reply: 'не понял on: нужно 1 или 0' });
    try { if (typeof d.setAccepting === 'function') d.setAccepting(open); }
    catch (e) { return base({ status: 'error', reply: '' }); }
    try { journal.append({ at: Date.now(), ev: 'accept', open: open ? 1 : 0 }); } catch (e) { log('Streamer.bot: журнал приёма не записан — ' + safeMsg(e)); }
    return base({ status: 'ok', reply: '', accepting: open ? 1 : 0 });
  }

  async function handle(req) {
    try {
      const method = String((req && req.method) || 'GET').toUpperCase();
      if (method !== 'GET') return { code: 405, body: { status: 'error' } };
      const headers = (req && req.headers) || {};
      // Браузерная страница всегда присылает Origin. Streamer.bot — никогда (проверено 12.11).
      if (has(headers, 'origin')) return { code: 403, body: { status: 'origin' } };
      let url;
      try { url = new URL(String((req && req.url) || '/'), 'http://127.0.0.1'); }
      catch (e) { return { code: 400, body: { status: 'error' } }; }
      const supplied = firstHeader(headers['x-tapyor-key']) || url.searchParams.get('key') || '';
      const expected = typeof d.getKey === 'function' ? d.getKey() : d.key;
      if (!expected || !keyMatches(supplied, expected)) return { code: 401, body: { status: 'auth' } };
      const p = url.pathname.replace(/\/+$/, '') || '/';
      const q = url.searchParams;
      let body;
      switch (p) {
        case '/sb/order': body = await handleOrder(q); break;
        case '/sb/cancel': body = handleCancel(q); break;
        case '/sb/now': body = handleNow(q); break;
        case '/sb/place': body = handlePlace(q); break;
        case '/sb/next': body = handleNext(q); break;
        case '/sb/control': body = handleControl(q); break;
        case '/sb/accept': body = handleAccept(q); break;
        case '/sb/status': body = handleStatus(q); break;
        case '/sb/ack': body = handleAck(q); break;
        case '/sb/ping': body = { status: 'ok', tapyor: version() }; break;
        default: body = base({ status: 'error', reply: 'неизвестный запрос' });
      }
      return { code: 200, body: body || { status: 'error' } };
    } catch (e) {
      try { log('Streamer.bot: ' + safeMsg(e)); } catch (x) {}
      return { code: 200, body: { status: 'error', reply: '' } };
    }
  }

  return {
    handle,
    // для отладки и тестов
    stats: () => ({ cache: cache.size, inflight: inflight.size, reserved: reserved.length, search: gate.stats() }),
    templateCurrent, templateMin, deadlineMs,
  };
}

module.exports = {
  createPort,
  keyMatches,
  startingReply,
  TEMPLATE_CURRENT,
  TEMPLATE_MIN,
  DEADLINE_MS,
  SEARCH_MAX,
  SEARCH_QUEUE_MAX,
};
