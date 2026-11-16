// Поддельный Streamer.bot для тестов и живой проверки (0.35, Э2). Только тесты — в установщик
// и в открытый снимок не попадает (tests/ исключены сборкой).
//
// Умеет: Hello с паролем и без, Authenticate (верный/неверный пароль), GetInfo, GetBroadcaster,
// GetActions, GetCodeTriggers, GetGlobals, DoAction, ExecuteCodeTrigger, обрыв по команде.
// Может сам подтверждать события через GET /sb/ack порта Тапёра — как это делает шаблон.
//
// Запуск вживую:
//   node tests/sbot-fake/fake-sb.mjs --port 18080 --password secret
// Печатает строку {"listening":true,"port":N}; дальше — только имена событий, без args и ников.

import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Имена — как в настоящем шаблоне (E2b, Streamer.bot 1.0.7). Подделка отвечает ровно так же,
// как настоящий: на запросы — { id, status, ... } БЕЗ поля request, на Authenticate — { id, status }.
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
const DEFAULT_ACTIONS = Object.values(ACTIONS).concat(['Тапёр: шаблон v3']);
const DEFAULT_TRIGGERS = [
  { name: 'Заказ принят', eventName: 'tapyor_order_queued', category: 'Custom/Тапёр' },
  { name: 'Заказ ждёт стримера', eventName: 'tapyor_order_pending', category: 'Custom/Тапёр' },
  { name: 'Заказ выполнен', eventName: 'tapyor_order_played', category: 'Custom/Тапёр' },
  { name: 'Заказ снят', eventName: 'tapyor_order_dropped', category: 'Custom/Тапёр' },
  { name: 'Заиграл трек', eventName: 'tapyor_track_started', category: 'Custom/Тапёр' },
  { name: 'Очередь заказов пуста', eventName: 'tapyor_queue_empty', category: 'Custom/Тапёр' },
  { name: 'Приём заказов изменён', eventName: 'tapyor_accept_changed', category: 'Custom/Тапёр' },
];

function hashB64(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('base64'); }
function authAnswer(password, salt, challenge) {
  return hashB64(hashB64(String(password) + String(salt)) + String(challenge));
}
function random(n) { return crypto.randomBytes(n).toString('base64url').slice(0, n); }
function str(v, n) { return String(v == null ? '' : v).slice(0, n || 1000); }
function isoNow() { return new Date().toISOString(); }

// Форматы — из настоящего ответа 1.0.7 (SB-FORMATS.json), не выдуманные.
function actionObject(a, i) {
  if (typeof a === 'string') return { id: 'a-' + i, name: a, group: 'Тапёр', enabled: true, subaction_count: 1, trigger_count: 0 };
  return a;
}
function triggerObject(t) {
  if (typeof t === 'string') return { name: t, eventName: t, category: 'Custom/Тапёр' };
  const o = Object.assign({}, t);
  if (!o.eventName) o.eventName = o.name;
  if (!o.category) o.category = 'Custom/Тапёр';
  return o;
}
function variablesOf(globals) {
  const out = {};
  for (const name of Object.keys(globals || {})) {
    const v = globals[name];
    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'value')) {
      out[name] = { name, value: v.value, lastWrite: v.lastWrite || isoNow() };
    } else {
      out[name] = { name, value: v, lastWrite: isoNow() };
    }
  }
  return out;
}
const DEFAULT_BROADCASTER = {
  platforms: {
    twitch: {
      broadcastUser: 'streamer', broadcastUserName: 'streamer', broadcastUserId: '1000000',
      broadcasterIsAffiliate: false, broadcasterIsPartner: false, broadcasterIsOnboarded: false,
    },
  },
  connected: ['twitch'],
  disconnected: ['youtube', 'kick'],
};

function startFakeSb(opts) {
  const o = opts || {};
  const password = o.password == null ? '' : String(o.password);
  const version = str(o.version || '1.0.7', 40);
  const actions = (o.actions || DEFAULT_ACTIONS).map(actionObject);
  const triggers = (o.triggers || []).map(triggerObject);
  const globals = o.globals && typeof o.globals === 'object' ? o.globals : {};
  const broadcaster = o.broadcaster || DEFAULT_BROADCASTER;
  const autoAck = !!o.autoAck;
  const ackDelayMs = Math.max(0, Number(o.ackDelayMs) || 0);
  const logFn = typeof o.log === 'function' ? o.log : () => {};

  const state = {
    port: 0,
    connections: 0,
    requests: [],
    actions: [],
    triggers: [],
    authAttempts: 0,
    acks: [],
    tapyorUrl: '',
    tapyorKey: '',
  };
  const clients = new Set();
  const wss = new WebSocketServer({ host: '127.0.0.1', port: Number(o.port) || 0 });

  function send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }

  async function ack(eventId) {
    if (!autoAck || !eventId || !state.tapyorUrl || !state.tapyorKey) return;
    const url = state.tapyorUrl.replace(/\/+$/, '') + '/sb/ack?id=' + encodeURIComponent(eventId) + '&key=' + encodeURIComponent(state.tapyorKey);
    if (ackDelayMs) await new Promise((r) => setTimeout(r, ackDelayMs));
    try {
      const res = await fetch(url, { headers: { 'X-Tapyor-Key': state.tapyorKey } });
      const body = await res.json().catch(() => null);
      state.acks.push({ eventId, ok: !!(body && body.acked), status: res.status });
      logFn('ack', { eventId: str(eventId, 40), acked: !!(body && body.acked) });
    } catch (e) {
      state.acks.push({ eventId, ok: false, error: str(e && e.message, 120) });
      logFn('ack-error', { eventId: str(eventId, 40), error: str(e && e.message, 120) });
    }
  }

  wss.on('connection', (ws) => {
    state.connections++;
    const salt = random(12);
    const challenge = random(16);
    const expected = password ? authAnswer(password, salt, challenge) : '';
    let authed = !password;
    send(ws, password
      ? { request: 'Hello', info: { name: 'Streamer.bot', version }, authentication: { salt, challenge } }
      : { request: 'Hello', info: { name: 'Streamer.bot', version } });
    clients.add(ws);

    ws.on('message', (raw) => {
      let m = null;
      try { m = JSON.parse(String(raw)); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      state.requests.push({ request: str(m.request, 40), id: m.id == null ? '' : str(m.id, 40) });
      const reply = (obj) => send(ws, Object.assign({ id: m.id }, obj));

      if (m.request === 'Authenticate') {
        state.authAttempts++;
        // Как настоящий 1.0.7: {"id":"auth","status":"ok"} — без поля request.
        if (!password) { reply({ status: 'ok' }); authed = true; return; }
        if (String(m.authentication || '') === expected) { authed = true; reply({ status: 'ok' }); }
        else reply({ status: 'error' });
        return;
      }
      if (!authed) { reply({ status: 'error', error: 'not authenticated' }); return; }

      switch (m.request) {
        case 'GetInfo':
          reply({ status: 'ok', info: { instanceId: 'fake-' + state.port, name: 'Streamer.bot', version, os: 'windows', mode: 'ui', source: 'websocketServer' } });
          return;
        case 'GetBroadcaster':
          reply(Object.assign({ status: 'ok' }, broadcaster));
          return;
        case 'GetActions':
          reply({ status: 'ok', count: actions.length, actions });
          return;
        case 'GetCodeTriggers':
          reply({ status: 'ok', count: triggers.length, triggers });
          return;
        case 'GetGlobals': {
          const variables = variablesOf(globals);
          reply({ status: 'ok', count: Object.keys(variables).length, variables });
          return;
        }
        case 'DoAction': {
          const name = str((m.action && m.action.name) || '', 200);
          const args = m.args && typeof m.args === 'object' ? m.args : {};
          state.actions.push({ name, args, at: Date.now() });
          logFn('doAction', {
            name,
            orderId: str(args.orderId || '', 80),
            redemption: str(args.redemption || '', 80),
            reason: str(args.reason || '', 40),
            open: args.open == null ? '' : args.open,
            ping: args.ping == null ? '' : args.ping,
            eventId: str(args.eventId || '', 80),
          });
          if (name === ACTIONS.setup && args.tapyorUrl) {
            state.tapyorUrl = str(args.tapyorUrl, 200);
            state.tapyorKey = str(args.tapyorKey, 200);
          }
          // Как настоящий: в ответе args запущенного действия, а не пусто.
          reply({
            status: 'ok',
            args: {
              actionName: name,
              queueName: 'Default',
              runningActionId: 'run-' + state.actions.length,
              actionQueuedAt: isoNow(),
            },
          });
          if (args.eventId) ack(str(args.eventId, 80));
          return;
        }
        case 'ExecuteCodeTrigger': {
          const name = str(m.triggerName, 120);
          state.triggers.push({ name, args: m.args || {}, at: Date.now() });
          logFn('trigger', { name });
          reply({ status: 'ok' });
          return;
        }
        default:
          reply({ status: 'error', error: 'unknown request' });
      }
    });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return new Promise((resolve, reject) => {
    wss.on('error', reject);
    wss.on('listening', () => {
      state.port = wss.address().port;
      state.url = 'ws://127.0.0.1:' + state.port + '/';
      resolve({
        port: state.port,
        url: state.url,
        state,
        drop() { for (const c of clients) { try { c.terminate(); } catch (e) {} } clients.clear(); },
        close() {
          for (const c of clients) { try { c.terminate(); } catch (e) {} }
          clients.clear();
          return new Promise((res) => { try { wss.close(() => res()); } catch (e) { res(); } });
        },
      });
    });
  });
}

function isMain() {
  try { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch (e) { return false; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a.indexOf('--') !== 0) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next == null || String(next).indexOf('--') === 0) out[key] = true;
    else { out[key] = String(next); i++; }
  }
  return out;
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  const password = args.password == null ? (process.env.FAKE_SB_PASSWORD || '') : String(args.password);
  const port = Number(args.port) || 0;
  const autoAck = args['no-auto-ack'] ? false : true;
  const srv = await startFakeSb({
    port, password, autoAck,
    ackDelayMs: Number(args['ack-delay']) || 0,
    triggers: DEFAULT_TRIGGERS,
    globals: { tapyorWho: 'all', tapyorCmdOrder: '!sr', tapyorKey: 'fake-key-not-used' },
    log: (ev, d) => { try { console.log(JSON.stringify(Object.assign({ ev }, d || {}))); } catch (e) {} },
  });
  console.log(JSON.stringify({ listening: true, port: srv.port, auth: !!password, autoAck }));
  const bye = () => { srv.close().then(() => process.exit(0)); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

export { startFakeSb, authAnswer, ACTIONS };
