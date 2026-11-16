'use strict';
// Пульт Тапёра → Streamer.bot (0.35, этап Э2) — docs/PLAN-STREAMERBOT.md, разделы 4–6, 9, 10.
//
// Тапёр — клиент WebSocket-сервера Streamer.bot: входит по паролю (Hello → Authenticate),
// читает состояние шаблона (GetInfo / GetBroadcaster / GetActions / GetCodeTriggers / GetGlobals),
// присылает шаблону адрес и ключ своего порта (DoAction «Тапёр: настройка»), сверяет висящие
// заказы и надёжно доставляет события заказов через почтовый ящик (src/sbot-mailbox.js).
//
// Модуль без require('electron'): WebSocket, часы, таймеры, файлы ящика и настройки приходят
// через deps — поэтому покрыт unit-тестами (tests/unit/sbot-link.test.mjs).
//
// Чего здесь нет и почему:
//  • пароль не хранится и не печатается — расшифровку отдаёт главный процесс (getPassword);
//  • ники уходят только в args для Streamer.bot и в журнал; в лог — ни действий с никами, ни args;
//  • ответ DoAction не считается доставкой: событие удаляется из ящика только по /sb/ack.

const crypto = require('crypto');
const mailboxModule = require('./sbot-mailbox');
const sbotSettings = require('./sbot-settings');

// Имена действий и триггеров шаблона — в одном месте (решение Claude 4).
// order/reward — не служебные события, но окну полезно знать, есть ли они в шаблоне.
const ACTIONS = {
  setup: 'Тапёр: настройка',
  played: 'Тапёр: заказ выполнен',
  dropped: 'Тапёр: заказ снят',
  accept: 'Тапёр: приём',
  reconcile: 'Тапёр: сверка',
  findReward: 'Тапёр: найти награду',
  reply: 'Тапёр: ответ',
  order: 'Тапёр: заказ',
  reward: 'Тапёр: награда',
};
const TRIGGERS = {
  queued: 'tapyor_order_queued',
  pending: 'tapyor_order_pending',
  played: 'tapyor_order_played',
  dropped: 'tapyor_order_dropped',
  track: 'tapyor_track_started',
  empty: 'tapyor_queue_empty',
  accept: 'tapyor_accept_changed',
};

// Тестовые данные для кнопки «Нажать» на вкладке «Для умельцев» (0.35, Э4).
// Те же поля, что шлёт Тапёр в обычной работе (раздел 5 плана), только ник «зритель».
// Это проверка действия стримера, а не настоящий заказ: в очередь ничего не попадает.
const TRIGGER_TEST = {
  tapyor_order_queued: { user: 'зритель', uid: '1', platform: 'test', kind: 'cmd', track: 'Кино — Кукушка', artist: 'Кино', title: 'Кукушка', place: 3, etaMin: 5 },
  tapyor_order_pending: { user: 'зритель', uid: '1', platform: 'test', kind: 'cmd', track: 'Кино — Кукушка', artist: 'Кино', title: 'Кукушка', etaMin: 5 },
  tapyor_order_played: { user: 'зритель', uid: '1', platform: 'test', kind: 'cmd', track: 'Кино — Кукушка', artist: 'Кино', title: 'Кукушка', etaMin: 5 },
  tapyor_order_dropped: { user: 'зритель', uid: '1', platform: 'test', kind: 'cmd', track: 'Кино — Кукушка', artist: 'Кино', title: 'Кукушка', reason: 'removed', etaMin: 5 },
  tapyor_track_started: { track: 'Кино — Кукушка', user: '' },
  tapyor_queue_empty: {},
  tapyor_accept_changed: { open: 1 },
};
// Заказы в тестовых данных получают orderId вида `test-<время>`: действие стримера может
// показать его в чате или записать в свою переменную, и по нему видно, что это проверка.
const ORDER_TRIGGERS = ['tapyor_order_queued', 'tapyor_order_pending', 'tapyor_order_played', 'tapyor_order_dropped'];
function testTriggerArgs(name, ts) {
  const base = TRIGGER_TEST[name];
  if (!base) return null;
  const args = Object.assign({}, base);
  if (ORDER_TRIGGERS.indexOf(name) >= 0) args.orderId = 'test-' + (Number(ts) || Date.now());
  return args;
}

const HOSTS = ['127.0.0.1', 'localhost', '::1'];
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const DEFAULT_ENDPOINT = '/';
const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000]; // дальше 60 с
const AUTH_RETRY_MS = 60000;
const REPLY_TTL_MS = 2 * 60 * 1000;                     // поздний ответ не нужен позже двух минут
const MAILBOX_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const HELLO_TIMEOUT_MS = 8000;
const ACK_TIMEOUT_MS = 5000;
const ENDPOINT_RE = /^\/[A-Za-z0-9/_.-]{0,99}$/;

// Категории триггеров шаблона: в 1.0.7 — «Custom/Тапёр», в списке Trigger — просто «Тапёр».
// «Custom/Тапёр-тест» — отдельная тестовая категория, служебные триггеры туда не относим.
const TRIGGER_CATEGORIES = ['', 'Тапёр', 'Custom/Тапёр'];
// Переменные, которые окну не отдаём: ключ порта и служебные отметки шаблона.
const GLOBALS_SKIP = ['tapyorKey', 'tapyorPendingRedemptions', 'tapyorLastOrder'];

const TEXTS = {
  off: 'Подключение к Streamer.bot выключено',
  connecting: 'Подключаюсь к Streamer.bot…',
  auth: 'Streamer.bot не принял пароль',
  needPassword: 'В Streamer.bot включён пароль — впиши его в настройках',
  ok: 'Связь со Streamer.bot есть',
  error: 'Streamer.bot не отвечает',
};

function safeMsg(e) { return String((e && e.message) || e || '').slice(0, 160); }
function str(v, n) { return String(v == null ? '' : v).slice(0, n); }
function int(v, def) { const n = Number(v); return isFinite(n) ? Math.trunc(n) : def; }

// День стрима — ровно как в окне (src/ui/03-queue.js, streamDay): начинается в 6 утра,
// без ведущих нулей. По нему уборка при запуске понимает, та ли это лента «today».
function streamDayAt(ts) {
  const d = new Date(Number(ts) - 6 * 3600 * 1000);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

// Пароль и ключ — только внутри; на диск открытым текстом не попадают.
function hashB64(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('base64'); }

// Как проверено в настоящем Streamer.bot 1.0.7 (E0-RESULTS.md):
// secret = base64(sha256(пароль + salt)), auth = base64(sha256(secret + challenge)).
function authAnswer(password, salt, challenge) {
  return hashB64(hashB64(String(password == null ? '' : password) + String(salt == null ? '' : salt)) + String(challenge == null ? '' : challenge));
}

// GetBroadcaster в Streamer.bot 1.0.7: { platforms: { twitch: { broadcastUser, … } }, connected: ['twitch'],
// disconnected: [...] }. Бота-аккаунта в ответе нет вовсе — значит «неизвестно» (null), а не «нет».
// Запасной путь — старый плоский ответ (подделка до 12.11): connected/username/bot сверху.
function parseBroadcaster(m) {
  const r = m && typeof m === 'object' ? m : {};
  const out = { twitch: { connected: null, name: '' }, bot: { connected: null, name: '' } };
  const connectedList = Array.isArray(r.connected)
    ? r.connected.map((x) => String(x == null ? '' : x).toLowerCase())
    : null;
  const tw = r.platforms && typeof r.platforms === 'object' && r.platforms.twitch && typeof r.platforms.twitch === 'object'
    ? r.platforms.twitch : null;
  if (tw) {
    out.twitch.name = str(tw.broadcastUser || tw.broadcastUserName || tw.username, 80);
    out.twitch.connected = connectedList ? connectedList.indexOf('twitch') >= 0 : null;
  } else {
    const src = r.broadcaster && typeof r.broadcaster === 'object' ? r.broadcaster : r;
    const platform = String(src.platform || r.platform || '').toLowerCase();
    if (!platform || platform === 'twitch') {
      out.twitch.connected = src.connected == null
        ? (typeof r.connected === 'boolean' ? r.connected : null)
        : !!src.connected;
      out.twitch.name = str(src.username || src.name || src.broadcaster || r.username || r.name, 80);
    }
  }
  // Бот: в настоящем ответе 1.0.7 его нет — connected остаётся null («не проверить»).
  const botRaw = r.bot || r.botAccount || null;
  if (botRaw) {
    if (typeof botRaw === 'string') out.bot = { connected: true, name: str(botRaw, 80) };
    else {
      out.bot = {
        connected: botRaw.connected == null ? true : !!botRaw.connected,
        name: str(botRaw.username || botRaw.name, 80),
      };
    }
  } else if (r.botConnected != null || r.isBotConnected != null) {
    out.bot = { connected: !!(r.botConnected == null ? r.isBotConnected : r.botConnected), name: '' };
  }
  return out;
}

// GetCodeTriggers: [{ name, eventName, category }]. Сопоставляем по eventName, а не по name:
// в 1.0.7 name — человеческое («Заиграл трек»), eventName — наше (tapyor_track_started).
function parseTriggers(m) {
  const raw = m && (m.triggers || m.codeTriggers || m.customTriggers);
  const known = Object.values(TRIGGERS);
  const seen = new Set();
  for (const t of Array.isArray(raw) ? raw : []) {
    if (!t) continue;
    const item = typeof t === 'string' ? { name: t, eventName: t, category: '' } : t;
    const category = String(item.category == null ? '' : item.category).trim();
    if (TRIGGER_CATEGORIES.indexOf(category) < 0) continue;
    const name = String(item.eventName || item.name || '').trim();
    if (known.indexOf(name) >= 0) seen.add(name);
  }
  return known.filter((n) => seen.has(n));
}

// GetGlobals в 1.0.7: variables — объект { имя: { name, value, lastWrite } }, value может быть null.
// Окну отдаём { имя: value } только tapyor*, без ключа и служебных отметок шаблона.
// Запасной путь — старый список [{ name, value }] (подделка до 12.11).
function parseGlobals(m) {
  const raw = (m && (m.variables || m.globals)) || {};
  const out = {};
  function put(name, value) {
    const n = String(name == null ? '' : name);
    if (!/^tapyor/i.test(n) || GLOBALS_SKIP.indexOf(n) >= 0) return;
    if (value == null || typeof value === 'object') return;
    out[n] = value;
  }
  if (Array.isArray(raw)) {
    for (const g of raw) {
      if (!g || typeof g !== 'object') continue;
      put(g.name || g.variable, g.value === undefined ? g.val : g.value);
    }
  } else if (raw && typeof raw === 'object') {
    for (const n of Object.keys(raw)) {
      const v = raw[n];
      put(n, v && typeof v === 'object' && hasOwn(v, 'value') ? v.value : v);
    }
  }
  return out;
}

function hasOwn(obj, k) { return Object.prototype.hasOwnProperty.call(obj || {}, k); }

function sanitizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rawHost = String(r.host == null ? DEFAULT_HOST : r.host).trim().toLowerCase();
  const host = HOSTS.indexOf(rawHost) >= 0 ? rawHost : DEFAULT_HOST;
  const port = Math.min(65535, Math.max(1, int(r.port, DEFAULT_PORT)));
  const rawEndpoint = String(r.endpoint == null ? DEFAULT_ENDPOINT : r.endpoint).trim();
  const endpoint = ENDPOINT_RE.test(rawEndpoint) ? rawEndpoint : DEFAULT_ENDPOINT;
  const shownHost = host === '::1' ? '[::1]' : host;
  return {
    enabled: !!r.enabled,
    host, port, endpoint,
    url: 'ws://' + shownHost + ':' + port + endpoint,
  };
}

function createLink(deps) {
  const d = deps || {};
  const log = typeof d.log === 'function' ? d.log : () => {};
  const now = typeof d.now === 'function' ? d.now : () => Date.now();
  const uuid = typeof d.uuid === 'function' ? d.uuid : mailboxModule.makeUuid;
  const getConfig = typeof d.getConfig === 'function' ? d.getConfig : () => ({});
  const getPassword = typeof d.getPassword === 'function' ? d.getPassword : () => '';
  const tapyorUrl = typeof d.tapyorUrl === 'function' ? d.tapyorUrl : () => '';
  const tapyorKey = typeof d.tapyorKey === 'function' ? d.tapyorKey : () => '';
  const pendingList = typeof d.pendingList === 'function' ? d.pendingList : () => '';
  // Кто принимает заказы из чата: true — Streamer.bot. Пишем это в tapyorOn при подключении,
  // чтобы стример видел в глобальных переменных, работает ли шаблон. Сам шаблон tapyorOn не читает:
  // при выключенном режиме он по-прежнему получает `off` и молчит.
  const orderMode = typeof d.getOrderMode === 'function' ? d.getOrderMode : () => false;
  const onState = typeof d.onState === 'function' ? d.onState : () => {};
  const onGlobals = typeof d.onGlobals === 'function' ? d.onGlobals : () => {};
  const mailbox = d.mailbox && typeof d.mailbox.due === 'function' ? d.mailbox : null;
  const WS = d.WebSocket || globalThis.WebSocket;
  const backoff = Array.isArray(d.backoffMs) && d.backoffMs.length ? d.backoffMs.map((x) => Math.max(0, int(x, 0))) : BACKOFF_MS;
  const authRetryMs = Math.max(0, int(d.authRetryMs, AUTH_RETRY_MS));
  const requestTimeoutMs = Math.max(1, int(d.requestTimeoutMs, REQUEST_TIMEOUT_MS));
  const helloTimerMs = Math.max(1, int(d.helloTimerMs, HELLO_TIMEOUT_MS));
  const replyTtlMs = Math.max(1000, int(d.replyTtlMs, REPLY_TTL_MS));
  const mailboxTtlMs = Math.max(1000, int(d.mailboxTtlMs, MAILBOX_TTL_MS));
  const ackTimeoutMs = Math.max(1, int(d.ackTimeoutMs, ACK_TIMEOUT_MS));
  const timers = d.timers || {
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearTimeout: (t) => { if (t) clearTimeout(t); },
  };

  let ws = null;
  let stopped = true;
  let ready = false;
  let booted = false;
  let attempt = 0;
  let reqSeq = 0;
  let retryTimer = null;
  let helloTimer = null;
  let authTimer = null;
  let pumpTimer = null;
  let pumping = false;
  let orderEvents = true;
  let globals = {};
  const pending = new Map();       // id → { resolve, timer }
  const ackWaiters = new Map();    // eventId → { resolve, timer }
  const sending = new Set();

  const st = {
    status: 'off', text: TEXTS.off,
    host: DEFAULT_HOST, port: DEFAULT_PORT, endpoint: DEFAULT_ENDPOINT,
    hasPassword: false,
    sbVersion: '', twitch: { connected: false, name: '' }, bot: { connected: false, name: '' },
    templateVersion: null, templateFound: false,
    actionsFound: {}, triggersFound: [],
    lastOrderAt: 0, tapyorUrl: '', nextRetryMs: 0,
  };

  function config() { const c = sanitizeConfig(getConfig()); st.host = c.host; st.port = c.port; st.endpoint = c.endpoint; st.hasPassword = !!getPassword(); return c; }

  function getState() {
    return {
      status: st.status, text: st.text,
      host: st.host, port: st.port, endpoint: st.endpoint,
      hasPassword: st.hasPassword,
      sbVersion: st.sbVersion,
      // null — «не проверить»: в ответе 1.0.7 бота нет, а площадка может быть не подключена.
      twitch: { connected: st.twitch.connected == null ? null : !!st.twitch.connected, name: st.twitch.name },
      bot: { connected: st.bot.connected == null ? null : !!st.bot.connected, name: st.bot.name },
      templateVersion: st.templateVersion, templateFound: st.templateFound,
      actionsFound: Object.assign({}, st.actionsFound),
      triggersFound: st.triggersFound.slice(),
      lastOrderAt: st.lastOrderAt,
      tapyorUrl: st.tapyorUrl || tapyorUrl(),
      nextRetryMs: st.nextRetryMs,
      mailbox: mailbox ? mailbox.count() : 0,
    };
  }

  function emitState() {
    try { onState(getState()); } catch (e) { log('Streamer.bot: состояние не передано — ' + safeMsg(e)); }
  }

  function setStatus(status, extra) {
    st.status = status;
    st.text = (extra && extra.text) || TEXTS[status] || '';
    if (extra && typeof extra.nextRetryMs === 'number') st.nextRetryMs = extra.nextRetryMs;
    else if (status === 'ok' || status === 'off') st.nextRetryMs = 0;
    if (extra) {
      for (const k of Object.keys(extra)) {
        if (['text', 'nextRetryMs'].indexOf(k) >= 0) continue;
        st[k] = extra[k];
      }
    }
    emitState();
  }

  function clearTimer(name) {
    const t = name === 'retry' ? retryTimer : name === 'hello' ? helloTimer : name === 'auth' ? authTimer : pumpTimer;
    if (t) timers.clearTimeout(t);
    if (name === 'retry') retryTimer = null;
    else if (name === 'hello') helloTimer = null;
    else if (name === 'auth') authTimer = null;
    else pumpTimer = null;
  }

  function closeSocket() {
    const sock = ws;
    ws = null;
    ready = false;
    booted = false;
    try { if (sock) sock.close(); } catch (e) {}
  }

  function rejectPending() {
    for (const p of pending.values()) { try { timers.clearTimeout(p.timer); } catch (e) {} try { p.reject(new Error('нет связи')); } catch (e) {} }
    pending.clear();
  }

  function nextDelay() {
    const i = Math.min(attempt, backoff.length - 1);
    attempt++;
    return backoff[i];
  }

  function schedule(ms) {
    clearTimer('retry');
    st.nextRetryMs = ms;
    emitState();
    retryTimer = timers.setTimeout(() => { retryTimer = null; if (!stopped) connect(); }, ms);
  }

  function stop() {
    stopped = true;
    ready = false;
    booted = false;
    clearTimer('retry'); clearTimer('hello'); clearTimer('auth'); clearTimer('pump');
    rejectPending();
    closeSocket();
    setStatus('off');
  }

  function start() {
    stopped = false;
    const c = config();
    if (!c.enabled) { setStatus('off'); return; }
    if (ws) return;
    clearTimer('retry');
    attempt = 0;
    connect();
  }

  // Настройки сменились (адрес, порт, пароль, включённость) — подключаемся заново.
  function applyConfig() {
    const c = config();
    if (!c.enabled) { stop(); return; }
    if (stopped) { start(); return; }
    clearTimer('retry');
    ready = false; booted = false;
    rejectPending();
    closeSocket();
    attempt = 0;
    connect();
  }

  // После сна ПК (R4): не ждать паузу повтора — подключиться сразу, снова начиная с 5 с.
  // Живое (или идущее) соединение не рвём. Проблемы входа — нет пароля или он не принят —
  // не трогаем: там частые попытки только вредят, повтор и так назначен.
  function pokeNow() {
    if (stopped) return false;
    const c = config();
    if (!c.enabled) return false;
    if (ws) return false;
    if (st.status === 'needPassword' || st.status === 'auth') return false;
    clearTimer('retry');
    attempt = 0;
    log('Streamer.bot: после сна — подключаюсь сразу, не жду паузу повтора');
    connect();
    return true;
  }

  function connect() {
    if (stopped) return;
    const c = config();
    if (!c.enabled) { setStatus('off'); return; }
    if (ws) return;
    if (typeof WS !== 'function') { setStatus('error', { text: 'WebSocket недоступен в этой версии программы' }); schedule(nextDelay()); return; }
    ready = false; booted = false;
    setStatus('connecting');
    let sock;
    try { sock = new WS(c.url); }
    catch (e) { log('Streamer.bot: адрес не открылся — ' + safeMsg(e)); setStatus('error'); schedule(nextDelay()); return; }
    ws = sock;
    let helloSeen = false;
    helloTimer = timers.setTimeout(() => {
      helloTimer = null;
      if (sock !== ws) return;
      log('Streamer.bot: приветствие не пришло за ' + Math.round(helloTimerMs / 1000) + ' с');
      closeSocket();
      setStatus('error', { text: 'Streamer.bot не ответил на подключение' });
      schedule(nextDelay());
    }, helloTimerMs);
    try {
      sock.addEventListener('message', (ev) => onMessage(sock, ev && ev.data));
      sock.addEventListener('close', () => onClose(sock));
      sock.addEventListener('error', () => { /* закрытие придёт отдельно */ });
      sock.addEventListener('open', () => {
        if (sock !== ws) return;
        log('Streamer.bot: соединение открыто, жду приветствие');
        helloSeen = false;
      });
    } catch (e) {
      log('Streamer.bot: WebSocket не поддержал обработчики — ' + safeMsg(e));
      closeSocket();
      setStatus('error');
      schedule(nextDelay());
    }
    // Некоторые среды присылают Hello синхронно ещё до open — тогда helloSeen уже true.
    void helloSeen;
  }

  function onClose(sock) {
    if (sock !== ws) return; // это наше собственное закрытие (смена настроек, пароль)
    ws = null;
    ready = false;
    booted = false;
    clearTimer('hello'); clearTimer('auth');
    rejectPending();
    if (stopped) return;
    const wasAuth = st.status === 'auth';
    const wasNeed = st.status === 'needPassword';
    if (wasNeed) return; // нет пароля — ждём, пока его впишут
    if (wasAuth) { setStatus('auth'); schedule(authRetryMs); return; }
    setStatus('error', { text: 'Нет связи со Streamer.bot' });
    schedule(nextDelay());
  }

  function onMessage(sock, data) {
    if (sock !== ws) return;
    let m = null;
    try { m = JSON.parse(typeof data === 'string' ? data : String(data)); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.request === 'Hello' || m.event === 'Hello') { onHello(sock, m); return; }
    if (m.request === 'Authenticate') { onAuth(sock, m); return; }
    // Streamer.bot 1.0.7 отвечает на Authenticate без поля request: {"id":"auth","status":"ok"}.
    // Раньше ответ ждали только по request и теряли — вход не работал.
    if (m.id != null && String(m.id) === 'auth') { onAuth(sock, m); return; }
    const p = m.id == null ? null : pending.get(String(m.id));
    if (p) {
      pending.delete(String(m.id));
      try { timers.clearTimeout(p.timer); } catch (e) {}
      p.resolve(m);
    }
  }

  function onHello(sock, m) {
    clearTimer('hello');
    const a = m.authentication;
    if (a && (a.salt != null || a.challenge != null)) {
      const pw = String(getPassword() || '');
      if (!pw) {
        log('Streamer.bot: сервер требует пароль, а он не задан');
        setStatus('needPassword');
        closeSocket();
        return;
      }
      const answer = authAnswer(pw, a.salt, a.challenge);
      try { sock.send(JSON.stringify({ request: 'Authenticate', id: 'auth', authentication: answer })); }
      catch (e) { log('Streamer.bot: пароль не отправлен — ' + safeMsg(e)); closeSocket(); setStatus('error'); schedule(nextDelay()); return; }
      authTimer = timers.setTimeout(() => {
        authTimer = null;
        if (sock !== ws) return;
        log('Streamer.bot: ответ на пароль не пришёл');
        closeSocket();
        setStatus('error');
        schedule(nextDelay());
      }, requestTimeoutMs);
      return;
    }
    // Сервер без пароля — входим сразу.
    onReady();
  }

  function onAuth(sock, m) {
    if (sock !== ws) return;
    clearTimer('auth');
    if (String(m.status || '').toLowerCase() === 'ok') {
      log('Streamer.bot: вход выполнен');
      onReady();
      return;
    }
    ready = false;
    log('Streamer.bot: пароль не принят');
    closeSocket();
    setStatus('auth', { nextRetryMs: authRetryMs });
    schedule(authRetryMs);
  }

  function launch(fn) {
    Promise.resolve().then(fn).catch((e) => log('Streamer.bot: ' + safeMsg(e)));
  }

  function onReady() {
    if (stopped || !ws) return;
    ready = true;
    booted = false;
    attempt = 0;
    clearTimer('retry');
    setStatus('ok');
    launch(async () => {
      await refreshAll();
      if (!ready) return;
      try { await sendSetup(); } catch (e) { if (ready) log('Streamer.bot: настройка не отправлена — ' + safeMsg(e)); }
      try { await sendReconcile(); } catch (e) { if (ready) log('Streamer.bot: сверка не отправлена — ' + safeMsg(e)); }
      if (!ready) return;
      booted = true;
      if (mailbox) { try { mailbox.rescheduleAll(); } catch (e) {} }
      pump();
      emitState();
    });
  }

  function request(name, params, ms) {
    return new Promise((resolve, reject) => {
      if (!ready || !ws) { reject(new Error('нет связи')); return; }
      const id = 'r' + (++reqSeq);
      const timer = timers.setTimeout(() => {
        pending.delete(id);
        reject(new Error(name + ': нет ответа'));
      }, Math.max(1, int(ms, requestTimeoutMs)));
      pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify(Object.assign({ request: name, id }, params || {})));
      } catch (e) {
        pending.delete(id);
        try { timers.clearTimeout(timer); } catch (e2) {}
        reject(e);
      }
    });
  }

  async function refreshAll() {
    const tasks = [
      (async () => {
        const m = await request('GetInfo', {}, requestTimeoutMs);
        const info = (m && (m.info || m)) || {};
        if (info.version) st.sbVersion = str(info.version, 40);
      })(),
      (async () => {
        const m = await request('GetBroadcaster', {}, requestTimeoutMs);
        const b = parseBroadcaster(m);
        st.twitch = b.twitch;
        st.bot = b.bot;
      })(),
      (async () => {
        const m = await request('GetActions', {}, requestTimeoutMs);
        const list = (m && m.actions) || [];
        const names = new Set();
        let version = 0;
        let found = false;
        for (const a of Array.isArray(list) ? list : []) {
          const n = String((a && a.name) || '');
          if (!n) continue;
          names.add(n);
          const mm = /^Тапёр:\s*шаблон\s+v(\d+)$/i.exec(n);
          if (mm) { found = true; version = Math.max(version, parseInt(mm[1], 10)); }
        }
        st.templateFound = found;
        st.templateVersion = found ? version : null;
        // Все служебные действия шаблона: настройка, выполнен, снят, приём, сверка, найти награду, ответ,
        // заказ, награда. Окну нужно видеть каждое — чего нет, то и не предложим.
        const foundActions = {};
        for (const key of Object.keys(ACTIONS)) foundActions[key] = names.has(ACTIONS[key]);
        st.actionsFound = foundActions;
      })(),
      (async () => {
        const m = await request('GetCodeTriggers', {}, requestTimeoutMs);
        st.triggersFound = parseTriggers(m);
      })(),
      (async () => {
        const m = await request('GetGlobals', { persisted: true }, requestTimeoutMs);
        globals = parseGlobals(m);
        try { onGlobals(Object.assign({}, globals)); } catch (e) {}
      })(),
    ];
    const res = await Promise.allSettled(tasks);
    for (const r of res) if (r.status === 'rejected' && ready) log('Streamer.bot: ' + safeMsg(r.reason));
    emitState();
  }

  function setupArgs(extra) {
    const e = extra || {};
    return Object.assign({}, e, {
      tapyorUrl: String(tapyorUrl() || ''),
      tapyorKey: String(tapyorKey() || ''),
      // Только для показа: 1 — заказы из чата принимает Streamer.bot, 0 — бот пака или никто.
      // Явно переданный tapyorOn (белый список настроек, A35-11) важнее: его пишет сам Тапёр.
      tapyorOn: hasOwn(e, 'tapyorOn') ? (Number(e.tapyorOn) ? 1 : 0) : (orderMode() ? 1 : 0),
      eventId: str(e.eventId, 80) || uuid(),
    });
  }

  // Перечитать глобальные переменные (persisted → true). Нужно после записи конструктора:
  // Streamer.bot сохраняет их действием «Тапёр: настройка», и без перечитывания окно видело бы
  // старые значения и показывало «изменено в Streamer.bot» сразу после своей же записи.
  async function readGlobals() {
    if (!ready) return false;
    const m = await request('GetGlobals', { persisted: true }, requestTimeoutMs);
    globals = parseGlobals(m);
    try { onGlobals(Object.assign({}, globals)); } catch (e) {}
    emitState();
    return true;
  }

  async function refreshGlobals() {
    try { return await readGlobals(); }
    catch (e) { if (ready) log('Streamer.bot: переменные не перечитаны — ' + safeMsg(e)); return false; }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const t = timers.setTimeout(resolve, Math.max(0, int(ms, 0)));
      if (t && t.unref) t.unref();
    });
  }

  async function sendSetup() {
    const args = setupArgs();
    const m = await request('DoAction', { action: { name: ACTIONS.setup }, args }, requestTimeoutMs);
    if (m && m.status && String(m.status) !== 'ok') log('Streamer.bot: действие «Тапёр: настройка» не запустилось');
    return m;
  }

  async function sendReconcile() {
    // pendingList() отдаёт null, если список не построен (ошибка/неожиданные данные).
    // Тогда сверку не шлём: пустой список шаблон понял бы как «ничего не ждёт» и отменил бы всё.
    const pending = pendingList();
    if (pending == null) {
      log('Streamer.bot: сверка пропущена — список ждущих заказов не построен');
      return null;
    }
    // pendingOk=1 — доказательство, что пустая строка означает «правда пусто» (A35-3).
    const args = setupArgs({ pending: String(pending), pendingOk: 1 });
    return request('DoAction', { action: { name: ACTIONS.reconcile }, args }, requestTimeoutMs);
  }

  // Плоские args: строки и числа. Ключ и адрес порта подставляет сам Тапёр.
  function flat(obj) { return mailboxModule.flatArgs(obj); }

  function enqueue(action, args, ttlMs, eventId) {
    if (!mailbox) return '';
    const id = str(eventId, 80) || uuid();
    const a = flat(Object.assign({}, args || {}, { eventId: id }));
    mailbox.enqueue(action, a, ttlMs, id);
    pump();
    return id;
  }

  function sendOnce(action, args) {
    if (!ready) return false;
    const a = flat(Object.assign({ eventId: uuid() }, args || {}));
    request('DoAction', { action: { name: action }, args: a }, requestTimeoutMs)
      .then((m) => { if (m && m.status && String(m.status) !== 'ok') log('Streamer.bot: действие «' + action + '» не запустилось'); })
      .catch((e) => { if (ready) log('Streamer.bot: действие «' + action + '» — ' + safeMsg(e)); });
    return true;
  }

  function trigger(name, args, force) {
    if (!force && !orderEvents) return false;
    if (!ready || !st.triggersFound || st.triggersFound.indexOf(name) < 0) return false;
    const a = flat(Object.assign({ eventId: uuid() }, args || {}));
    request('ExecuteCodeTrigger', { triggerName: name, args: a }, requestTimeoutMs)
      .catch((e) => { if (ready) log('Streamer.bot: триггер «' + name + '» — ' + safeMsg(e)); });
    return true;
  }

  // Служебное событие заказа: played / dropped. durable — через ящик (заказы за баллы).
  function notify(type, args, opts) {
    if (!orderEvents) return false;
    const action = ACTIONS[type];
    if (!action) return false;
    const o = opts || {};
    const eventId = uuid();
    const payload = Object.assign({}, args || {}, { eventId });
    if (o.durable && mailbox) enqueue(action, payload, mailboxTtlMs, eventId);
    else sendOnce(action, payload);
    const trig = TRIGGERS[type];
    if (trig) trigger(trig, payload);
    return true;
  }

  // Приём открыт/закрыт: важно и когда режим уже выключен (шаблон ставит награду на паузу).
  function accept(open) {
    const eventId = uuid();
    const args = { open: open ? 1 : 0, eventId };
    if (mailbox) enqueue(ACTIONS.accept, args, mailboxTtlMs, eventId);
    else sendOnce(ACTIONS.accept, args);
    trigger(TRIGGERS.accept, { open: open ? 1 : 0, eventId }, true);
    return true;
  }

  // Поздний ответ из порта: с ящиком, но не дольше двух минут.
  function reply(args) {
    if (!orderEvents) return false;
    if (mailbox) enqueue(ACTIONS.reply, args, replyTtlMs);
    else sendOnce(ACTIONS.reply, args);
    return true;
  }

  function waitAck(eventId, ms) {
    return new Promise((resolve) => {
      const id = str(eventId, 80);
      const timer = timers.setTimeout(() => { ackWaiters.delete(id); resolve(false); }, Math.max(1, int(ms, ackTimeoutMs)));
      ackWaiters.set(id, { resolve, timer });
    });
  }

  function ack(eventId) {
    const id = str(eventId, 80);
    let ok = false;
    if (mailbox) ok = mailbox.ack(id);
    if (ok) {
      log('Streamer.bot: событие подтверждено');
      emitState();
    }
    const w = ackWaiters.get(id);
    if (w) {
      ackWaiters.delete(id);
      try { timers.clearTimeout(w.timer); } catch (e) {}
      try { w.resolve(true); } catch (e) {}
    }
    return ok;
  }

  function schedulePump() {
    if (pumpTimer) return;
    if (!ready || !booted || !mailbox) return;
    const list = mailbox.all();
    if (!list.length) return;
    let next = Infinity;
    for (const e of list) next = Math.min(next, e.nextAt || 0);
    if (!isFinite(next)) return;
    const delay = Math.max(0, next - now());
    pumpTimer = timers.setTimeout(() => { pumpTimer = null; pump(); }, Math.min(delay, 60000));
  }

  function pump() {
    if (!ready || !booted || !mailbox || pumping) return;
    try { mailbox.sweep(now()); } catch (e) {}
    const list = mailbox.due(now());
    if (!list.length) { schedulePump(); return; }
    pumping = true;
    (async () => {
      for (const e of list) {
        if (!ready) break;
        if (sending.has(e.eventId)) continue;
        sending.add(e.eventId);
        try {
          const m = await request('DoAction', { action: { name: e.action }, args: e.args }, requestTimeoutMs);
          if (!m || (m.status && String(m.status) !== 'ok')) log('Streamer.bot: событие «' + str(e.action, 40) + '» не принято');
        } catch (err) {
          if (ready) log('Streamer.bot: событие «' + str(e.action, 40) + '» — ' + safeMsg(err));
        } finally {
          sending.delete(e.eventId);
          mailbox.markAttempt(e.eventId, now());
        }
      }
    })().finally(() => { pumping = false; schedulePump(); emitState(); });
  }

  // «Проверить связь»: GetInfo + «Тапёр: настройка» и ждём /sb/ack ≤ 5 с.
  async function testConnection() {
    const cfg = config();
    if (!cfg.enabled) return { ok: false, message: 'подключение к Streamer.bot выключено' };
    if (st.status === 'needPassword') return { ok: false, message: TEXTS.needPassword };
    if (st.status === 'auth') return { ok: false, message: TEXTS.auth };
    if (!ready) return { ok: false, message: 'нет связи со Streamer.bot' };
    let version = st.sbVersion;
    try {
      const m = await request('GetInfo', {}, requestTimeoutMs);
      const info = (m && (m.info || m)) || {};
      if (info.version) version = str(info.version, 40);
      if (!version) return { ok: false, message: 'Streamer.bot ответил без версии (GetInfo)' };
    } catch (e) {
      return { ok: false, message: 'Streamer.bot не отвечает на GetInfo' };
    }
    const eventId = uuid();
    const wait = waitAck(eventId, ackTimeoutMs);
    try {
      await request('DoAction', { action: { name: ACTIONS.setup }, args: setupArgs({ eventId, ping: 1 }) }, requestTimeoutMs);
    } catch (e) {
      return { ok: false, message: 'не удалось запустить действие «Тапёр: настройка»', version };
    }
    const got = await wait;
    if (!got) return { ok: false, message: 'действие «Тапёр: настройка» не подтвердило получение — проверь, что шаблон импортирован', version };
    return { ok: true, message: 'обе стороны работают', version };
  }

  // Записать настройки конструктора в Streamer.bot: только переменные конструктора
  // (+ tapyorOn для показа), значения уже проверены. Служебные (сверка, награда, адрес,
  // ключ) окно подменить не может — иначе сверка/пауза награды сломаются (A35-11).
  async function writeSettings(obj) {
    if (!ready) return { ok: false, message: 'нет связи со Streamer.bot' };
    const clean = {};
    const src = obj && typeof obj === 'object' ? obj : {};
    for (const k of Object.keys(src)) {
      if (sbotSettings.CONSTRUCTOR_VARS.indexOf(k) < 0 && k !== 'tapyorOn') continue;
      if (k === 'tapyorUrl' || k === 'tapyorKey') continue; // их подставляет сам Тапёр
      const v = src[k];
      if (typeof v === 'string' || typeof v === 'number') clean[k] = v;
    }
    if (!Object.keys(clean).length) return { ok: false, message: 'нечего записывать' };
    const args = setupArgs(clean);
    try {
      const m = await request('DoAction', { action: { name: ACTIONS.setup }, args }, requestTimeoutMs);
      if (!m || (m.status && String(m.status) !== 'ok')) return { ok: false, message: 'Streamer.bot не запустил действие «Тапёр: настройка»' };
      return { ok: true, message: 'записано', count: Object.keys(clean).length };
    } catch (e) {
      return { ok: false, message: 'Streamer.bot не ответил: ' + safeMsg(e) };
    }
  }

  // «Найти награду» (0.35, Э4): действие шаблона ищет награду по названию и кладёт её номер
  // в глобальную переменную tapyorRewardId. Ждём /sb/ack (значит, действие отработало),
  // затем читаем глобальные заново. Нет ack — всё равно пробуем прочитать: шаблон мог
  // быть старой версии, но номер уже записан.
  async function findReward() {
    if (!ready) return { ok: false, message: config().enabled ? 'нет связи со Streamer.bot' : 'подключение к Streamer.bot выключено' };
    const eventId = uuid();
    const wait = waitAck(eventId, ackTimeoutMs);
    try {
      const m = await request('DoAction', { action: { name: ACTIONS.findReward }, args: setupArgs({ eventId }) }, requestTimeoutMs);
      if (m && m.status && String(m.status) !== 'ok') return { ok: false, message: 'Streamer.bot не запустил действие «Тапёр: найти награду»' };
    } catch (e) {
      return { ok: false, message: 'Streamer.bot не ответил: ' + safeMsg(e) };
    }
    await wait;
    // Действие могло ещё не записать переменную к моменту ack (в настоящем Streamer.bot шаги
    // идут асинхронно). Читаем до трёх раз с короткой паузой.
    let rewardId = '';
    for (let i = 0; i < 3; i++) {
      if (i) await sleep(400);
      try { await readGlobals(); } catch (e) { /* номера может не быть вовсе */ }
      rewardId = String(globals.tapyorRewardId || '');
      if (rewardId) break;
    }
    const name = String(globals.tapyorRewardName || '');
    return {
      ok: !!rewardId,
      rewardId,
      name,
      message: rewardId
        ? 'награда найдена' + (name ? ': «' + str(name, 100) + '»' : '')
        : 'награда не найдена — создай её в Streamer.bot (Platforms → Twitch → Channel Point Rewards)',
    };
  }

  // «Нажать» на вкладке «Для умельцев»: запускает триггер умельца с тестовыми данными.
  // Работает и когда заказы из чата принимает бот пака: это кнопка проверки, а не заказ.
  async function testTrigger(name) {
    const id = str(name, 80);
    if (!hasOwn(TRIGGER_TEST, id)) return { ok: false, message: 'неизвестный триггер' };
    if (!ready) return { ok: false, message: config().enabled ? 'нет связи со Streamer.bot' : 'подключение к Streamer.bot выключено' };
    if (!st.triggersFound || st.triggersFound.indexOf(id) < 0) {
      return { ok: false, message: 'Streamer.bot не видит этот триггер — импортируй шаблон и перезапусти Streamer.bot' };
    }
    const args = flat(Object.assign({ eventId: uuid() }, testTriggerArgs(id, now())));
    try {
      const m = await request('ExecuteCodeTrigger', { triggerName: id, args }, requestTimeoutMs);
      if (m && m.status && String(m.status) !== 'ok') return { ok: false, message: 'Streamer.bot не принял триггер' };
      return { ok: true, message: 'триггер отправлен — проверь своё действие в Streamer.bot' };
    } catch (e) {
      return { ok: false, message: 'Streamer.bot не ответил: ' + safeMsg(e) };
    }
  }

  function refreshSettings() {
    if (!ready) return Promise.resolve(false);
    return Promise.resolve().then(() => sendSetup()).then(() => sendReconcile()).then(() => true, (e) => { log('Streamer.bot: настройка не обновлена — ' + safeMsg(e)); return false; });
  }

  function getGlobals() { return Object.assign({}, globals); }
  function noteOrder() { st.lastOrderAt = now(); emitState(); }
  function setOrderMode(on) { orderEvents = !!on; }

  return {
    start, stop, applyConfig, pokeNow, setOrderMode,
    getState, getGlobals, noteOrder,
    notify, accept, reply, trigger,
    ack, testConnection, writeSettings, refreshSettings,
    findReward, testTrigger, refreshGlobals,
    // для тестов и отладки
    _state: st,
  };
}

// Уборка при запуске Тапёра (решение Claude 8): заказы за баллы из прошлого запуска, которые
// так и не заиграли, отдаются событием «снят» с причиной «Тапёр был закрыт». Чистая функция:
// ничего не пишет, главный процесс кладёт результат в почтовый ящик и помечает записи.
//
// today — лента за сегодня (настройка `today`; с R2 живёт в отдельном файле today.json).
// Если тот же день и трек заказа
// уже стоит в восстановленной очереди (items[].req.key — окно сохраняет его с 0.35), заказ
// НЕ снимаем: он сыграет и придёт played, баллы не потеряются и песня не станет бесплатной.
function startupDrops(list, startedAt, today) {
  const started = Number(startedAt) || 0;
  const out = [];
  const kept = new Set();
  const t = today && typeof today === 'object' ? today : null;
  if (t && Array.isArray(t.items) && String(t.day || '') && String(t.day) === streamDayAt(started)) {
    for (const it of t.items) {
      const key = it && it.req && it.req.key ? String(it.req.key) : '';
      if (key) kept.add(key);
    }
  }
  for (const rec of Array.isArray(list) ? list : []) {
    if (!rec || !/^sb-points:/.test(String(rec.key || ''))) continue;
    if (rec.state === 'dismissed' || rec.playedAt || rec.droppedAt) continue;
    if (!(Number(rec.got) < started)) continue; // заказ этого запуска ещё может заиграть
    const items = Array.isArray(rec.items) ? rec.items : [];
    if (items.some((it) => it && it.state === 'skip')) continue;
    if (kept.has(String(rec.key))) continue; // трек в восстановленной очереди — сыграет, придёт played
    const item = items.find((it) => it && it.track) || null;
    const tr = item && item.track ? item.track : null;
    const artist = tr ? str(tr.author || tr.artist || '', 200) : '';
    const title = tr ? str(tr.title || '', 300) : '';
    out.push({
      action: ACTIONS.dropped,
      args: {
        orderId: str(rec.key, 80),
        user: str(rec.name, 60),
        uid: rec.uid == null ? '' : str(rec.uid, 80),
        platform: str(rec.platform || '', 16),
        kind: 'points',
        track: (artist ? artist + ' — ' : '') + title,
        artist, title,
        reward: str(rec.reward || '', 120),
        redemption: str(rec.redemption || '', 120),
        reason: 'closed',
      },
      rec,
    });
  }
  return out;
}

// Пометить заказ снятым при запуске: карточка в «Заказах» закрывается (state dismissed),
// её варианты пропускаются, а droppedAt/rqPending перестают считать заказ ждущим.
// Без этого зритель был бы заблокирован на 24 ч, а стример мог бы поставить уже возвращённый заказ.
function markStartupDrop(rec, at) {
  if (!rec || typeof rec !== 'object') return false;
  rec.droppedAt = Number(at) || Date.now();
  rec.droppedReason = 'closed';
  rec.state = 'dismissed';
  const items = Array.isArray(rec.items) ? rec.items : [];
  for (const it of items) { if (it && typeof it === 'object') it.state = 'skip'; }
  return true;
}

// Что делать с приёмом при смене «кто принимает заказы из чата» (решение Claude 9):
// включили Streamer.bot — открыть награду, выключили — закрыть (пауза).
function chatOrdersChange(prev, next) {
  const p = String(prev || 'none');
  const n = String(next || 'none');
  if (p === n) return null;
  if (n === 'sbot') return 'open';
  if (p === 'sbot') return 'close';
  return null;
}

// Платный ли заказ: донат и баллы — да; бесплатная команда из чата (бот пака или Streamer.bot) — нет.
// От этого зависит, ждёт ли неуверенный канонический трек стримера (A35-5).
// Раньше любой prov, кроме 'bot', считался платным — и бесплатный !sr через Streamer.bot
// попадал в «Заказы» вместо очереди.
function isPaidOrder(prov, paid) {
  if (paid) return true;
  const p = String(prov == null ? '' : prov);
  return p !== 'bot' && p !== 'sbot';
}

// Приём после смены режима: включили Streamer.bot — приём открыт (sbotAccepting=true).
// В уже включённом режиме состояние не трогаем: его могли закрыть командой /sb/accept?on=0,
// и тогда экран показывает «Приём закрыт из Streamer.bot — открыть».
function nextAccepting(prev, next, current) {
  const p = String(prev || 'none');
  const n = String(next || 'none');
  if (n === 'sbot' && p !== 'sbot') return true;
  return !!current;
}

module.exports = {
  createLink,
  authAnswer,
  sanitizeConfig,
  parseBroadcaster,
  parseTriggers,
  parseGlobals,
  startupDrops,
  markStartupDrop,
  streamDayAt,
  chatOrdersChange,
  nextAccepting,
  isPaidOrder,
  ACTIONS,
  TRIGGERS,
  TRIGGER_TEST,
  testTriggerArgs,
  TRIGGER_CATEGORIES,
  GLOBALS_SKIP,
  HOSTS,
  TEXTS,
  BACKOFF_MS,
  AUTH_RETRY_MS,
  REPLY_TTL_MS,
  MAILBOX_TTL_MS,
};
