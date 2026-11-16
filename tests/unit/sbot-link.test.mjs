import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const linkMod = require('../../src/sbot-link.js');
const { createMailbox } = require('../../src/sbot-mailbox.js');

const KEY = 'tp_SECRET_KEY_0123456789';
const PASSWORD = 'pa ss';

async function settle(n) {
  for (let i = 0; i < (n || 6); i++) await new Promise((r) => setImmediate(r));
}

// Ручные часы: и часы пульта, и таймеры. Так видно точные задержки переподключения.
function fakeClock(start) {
  let t = start || 0;
  let seq = 0;
  const q = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) { const id = ++seq; q.set(id, { fn, at: t + Math.max(0, Number(ms) || 0) }); return id; },
    clearTimeout(id) { q.delete(id); },
    pending() { return Array.from(q.values()).map((x) => x.at - t).sort((a, b) => a - b); },
    async tick(ms) {
      const end = t + ms;
      for (let guard = 0; guard < 2000; guard++) {
        let bestId = 0, best = null;
        for (const [id, x] of q) if (x.at <= end && (!best || x.at < best.at)) { best = x; bestId = id; }
        if (!best) break;
        q.delete(bestId);
        t = best.at;
        try { best.fn(); } catch (e) {}
        await settle(2);
      }
      t = end;
      await settle(2);
    },
  };
}

class FakeWS {
  static instances = [];
  static onSend = null;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.h = {};
    this.sent = [];
    FakeWS.instances.push(this);
  }
  addEventListener(type, fn) { (this.h[type] = this.h[type] || []).push(fn); }
  emit(type, e) { for (const fn of (this.h[type] || []).slice()) fn(e || {}); }
  open() { this.readyState = 1; this.emit('open'); }
  fail() { this.readyState = 3; this.emit('close'); }
  recv(o) { this.emit('message', { data: typeof o === 'string' ? o : JSON.stringify(o) }); }
  send(s) { const m = JSON.parse(s); this.sent.push(m); if (FakeWS.onSend) FakeWS.onSend(this, m); }
  close() { this.readyState = 3; this.emit('close'); }
  static last() { return this.instances[this.instances.length - 1]; }
  static reset() { this.instances = []; this.onSend = null; }
}

// Ответы поддельного Streamer.bot — ровно в формате настоящего 1.0.7 (SB-FORMATS.json):
// на запросы { id, status, … } БЕЗ поля request; на Authenticate — { id: 'auth', status }.
function serve(opts) {
  const o = opts || {};
  const expected = linkMod.authAnswer(o.password == null ? PASSWORD : o.password, 'salt', 'chal');
  FakeWS.onSend = (ws, m) => {
    const reply = (x) => queueMicrotask(() => ws.recv(x));
    switch (m.request) {
      case 'Authenticate':
        reply({ id: m.id, status: m.authentication === expected ? 'ok' : 'error' });
        return;
      case 'GetInfo':
        reply({ id: m.id, status: 'ok', info: { name: 'Streamer.bot', version: o.version || '1.0.7' } });
        return;
      case 'GetBroadcaster': {
        const b = o.broadcaster || {
          platforms: {
            twitch: {
              broadcastUser: 'streamer', broadcastUserName: 'streamer', broadcastUserId: '1000000',
              broadcasterIsAffiliate: false, broadcasterIsPartner: false, broadcasterIsOnboarded: false,
            },
          },
          connected: ['twitch'],
          disconnected: ['youtube', 'kick'],
        };
        reply(Object.assign({ id: m.id, status: 'ok' }, b));
        return;
      }
      case 'GetActions':
        reply({
          id: m.id, status: 'ok',
          actions: (o.actions || []).map((a, i) => (typeof a === 'string'
            ? { id: 'a-' + i, name: a, group: 'Тапёр', enabled: true, subaction_count: 1, trigger_count: 0 }
            : a)),
        });
        return;
      case 'GetCodeTriggers':
        reply({
          id: m.id, status: 'ok',
          triggers: (o.triggers || []).map((t) => (typeof t === 'string'
            ? { name: t, eventName: t, category: 'Custom/Тапёр' }
            : t)),
        });
        return;
      case 'GetGlobals': {
        const variables = {};
        const g = o.globals || {};
        for (const name of Object.keys(g)) {
          const v = g[name];
          variables[name] = v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'value')
            ? { name, value: v.value, lastWrite: '2026-11-12T11:41:05.366+03:00' }
            : { name, value: v, lastWrite: '2026-11-12T11:41:05.366+03:00' };
        }
        reply({ id: m.id, status: 'ok', count: Object.keys(variables).length, variables });
        return;
      }
      case 'DoAction': {
        const fn = o.onAction;
        if (fn) fn(m);
        reply({ id: m.id, status: 'ok', args: { actionName: (m.action && m.action.name) || '', queueName: 'Default' } });
        return;
      }
      case 'ExecuteCodeTrigger': {
        const fn = o.onTrigger;
        if (fn) fn(m);
        reply({ id: m.id, status: 'ok' });
        return;
      }
      default:
        reply({ id: m.id, status: 'error' });
    }
  };
}

function harness(t, over) {
  FakeWS.reset();
  const clock = fakeClock();
  const logs = [], globalsSeen = [], states = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-sbot-link-'));
  let n = 0;
  const mailbox = createMailbox({
    file: path.join(dir, 'sbot-mailbox.json'),
    now: clock.now,
    uuid: () => 'ev-' + (++n),
  });
  const cfg = { enabled: true, host: '127.0.0.1', port: 8080, endpoint: '/' };
  const dep = {
    WebSocket: FakeWS,
    timers: clock,
    now: clock.now,
    mailbox,
    getConfig: () => cfg,
    getPassword: () => ('password' in (over || {}) ? over.password : PASSWORD),
    tapyorUrl: () => 'http://127.0.0.1:47654',
    tapyorKey: () => KEY,
    pendingList: () => ('pending' in (over || {}) ? over.pending : '111,222'),
    onState: (s) => states.push(s),
    onGlobals: (g) => globalsSeen.push(g),
    log: (m) => logs.push(String(m)),
    journal: { append: () => {} },
    uuid: () => 'ev-' + (++n),
    requestTimeoutMs: 500,
    helloTimerMs: 8000,
    ackTimeoutMs: 100,
  };
  const link = linkMod.createLink(Object.assign(dep, over && over.deps ? over.deps : {}));
  t.after(() => {
    link.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  });
  return { link, clock, mailbox, logs, globalsSeen, states, cfg, dir };
}

async function login(h, opts) {
  const o = opts || {};
  serve(Object.assign({ password: PASSWORD, actions: [], triggers: [], globals: {} }, o));
  h.link.start();
  const ws = FakeWS.last();
  ws.open();
  ws.recv({ request: 'Hello', info: { version: '1.0.7' }, authentication: { salt: 'salt', challenge: 'chal' } });
  await settle();
  return ws;
}

test('sbot-link: адрес только 127.0.0.1 / localhost / ::1, порт и путь — безопасные', () => {
  const bad = linkMod.sanitizeConfig({ host: 'evil.example', port: 70000, endpoint: 'ws://x' });
  assert.equal(bad.host, '127.0.0.1');
  assert.equal(bad.port, 65535);
  assert.equal(bad.endpoint, '/');
  assert.equal(bad.url, 'ws://127.0.0.1:65535/');
  const good = linkMod.sanitizeConfig({ host: 'localhost', port: 8080, endpoint: '/sb' });
  assert.equal(good.host, 'localhost');
  assert.equal(good.url, 'ws://localhost:8080/sb');
  assert.equal(linkMod.sanitizeConfig({ host: '::1' }).url, 'ws://[::1]:8080/');
  assert.equal(linkMod.sanitizeConfig({ host: '127.0.0.1', port: -5 }).port, 1);
});

test('sbot-link: вход по salt/challenge как в Streamer.bot 1.0.7', () => {
  const h = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
  assert.equal(linkMod.authAnswer('pass', 'salt', 'chal'), h(h('passsalt') + 'chal'));
});

test('sbot-link: после входа читает состояние, шлёт адрес/ключ и сверку, ключ не в логе', async (t) => {
  const h = harness(t);
  const actions = [
    'Тапёр: шаблон v3', 'Тапёр: настройка', 'Тапёр: заказ выполнен', 'Тапёр: заказ снят',
    'Тапёр: приём', 'Тапёр: сверка', 'Тапёр: ответ',
  ];
  const triggers = Object.values(linkMod.TRIGGERS);
  await login(h, {
    actions, triggers,
    globals: {
      tapyorWho: 'all', tapyorKey: 'SECRET-GLOBAL', tapyorCmdOrder: '!sr',
      tapyorPendingRedemptions: null, tapyorLastOrder: 'Кино — Кукушка', other: 'x',
    },
  });
  const st = h.link.getState();
  assert.equal(st.status, 'ok');
  assert.equal(st.sbVersion, '1.0.7');
  assert.equal(st.templateFound, true);
  assert.equal(st.templateVersion, 3);
  assert.equal(st.twitch.connected, true);
  assert.equal(st.twitch.name, 'streamer');
  assert.equal(st.bot.connected, null, 'бота в ответе 1.0.7 нет — «не проверить», а не «нет»');
  assert.equal(st.hasPassword, true);
  assert.equal(st.triggersFound.length, triggers.length);
  assert.equal(st.actionsFound.setup, true);
  assert.equal(st.mailbox, 0);
  assert.deepEqual(h.globalsSeen[h.globalsSeen.length - 1], { tapyorWho: 'all', tapyorCmdOrder: '!sr' }, 'ключ и служебные не отданы окну');

  const ws = FakeWS.last();
  const setup = ws.sent.find((m) => m.request === 'DoAction' && m.action && m.action.name === 'Тапёр: настройка');
  assert.ok(setup, 'настройка отправлена');
  assert.equal(setup.args.tapyorUrl, 'http://127.0.0.1:47654');
  assert.equal(setup.args.tapyorKey, KEY);
  assert.match(setup.args.eventId, /^ev-\d+$/);

  const rec = ws.sent.find((m) => m.request === 'DoAction' && m.action && m.action.name === 'Тапёр: сверка');
  assert.ok(rec, 'сверка отправлена');
  assert.equal(rec.args.pending, '111,222');
  assert.equal(rec.args.pendingOk, 1, 'pendingOk=1 — список доказанно полный');

  const all = h.logs.join('\n');
  assert.equal(all.indexOf(KEY), -1, 'ключ не попал в лог');
  assert.equal(all.indexOf(PASSWORD), -1, 'пароль не попал в лог');
  assert.equal(JSON.stringify(st).indexOf('SECRET-GLOBAL'), -1, 'ключ не попал в состояние');
});

test('sbot-link: список ждущих не построен — сверка пропускается, а не отменяет всё', async (t) => {
  const h = harness(t, { pending: null });
  const seen = [];
  await login(h, { actions: ['Тапёр: шаблон v1', 'Тапёр: настройка', 'Тапёр: сверка'], triggers: [], onAction: (m) => seen.push(m) });
  assert.equal(seen.some((m) => m.action.name === 'Тапёр: сверка'), false, 'на ошибке сверку не шлём');
  assert.match(h.logs.join('\n'), /сверка пропущена/);
});

test('sbot-link: доказанно пустой список ждущих — сверка уходит с pendingOk=1', async (t) => {
  const h = harness(t, { pending: '' });
  const seen = [];
  await login(h, { actions: ['Тапёр: шаблон v1', 'Тапёр: настройка', 'Тапёр: сверка'], triggers: [], onAction: (m) => seen.push(m) });
  const rec = seen.find((m) => m.action.name === 'Тапёр: сверка');
  assert.ok(rec, 'сверка отправлена');
  assert.equal(rec.args.pending, '', 'пустая строка — только когда правда пусто');
  assert.equal(rec.args.pendingOk, 1);
});

test('sbot-link: ответ на пароль узнаётся по id «auth» без поля request (как в 1.0.7)', async (t) => {
  const h = harness(t);
  serve({ password: PASSWORD, actions: ['Тапёр: шаблон v1'], triggers: [], globals: {} });
  h.link.start();
  const ws = FakeWS.last();
  ws.open();
  ws.recv({ request: 'Hello', info: { version: '1.0.7' }, authentication: { salt: 'salt', challenge: 'chal' } });
  await settle();
  const sent = ws.sent.filter((m) => m.request === 'Authenticate');
  assert.equal(sent.length, 1, 'пароль отправлен один раз');
  assert.equal(sent[0].id, 'auth', 'ответ ждём по id «auth»');
  // Старый код ждал request === 'Authenticate' и терял этот ответ — вход не работал.
  assert.equal(h.link.getState().status, 'ok', 'ответ {id:"auth",status:"ok"} принят');
  assert.equal(h.link.getState().templateVersion, 1);
});

test('sbot-link: триггеры — категории Custom/Тапёр и Тапёр, сопоставление по eventName', async (t) => {
  const h = harness(t);
  await login(h, {
    actions: ['Тапёр: шаблон v1'],
    triggers: [
      { name: 'Заиграл трек', eventName: 'tapyor_track_started', category: 'Custom/Тапёр' },
      { name: 'Заказ снят', eventName: 'tapyor_order_dropped', category: 'Тапёр' },
      { name: 'Чужой', eventName: 'tapyor_order_played', category: 'Custom/Другое' },
      { name: 'Тест', eventName: 'tapyor_test_queued', category: 'Custom/Тапёр-тест' },
    ],
    globals: {},
  });
  const got = h.link.getState().triggersFound;
  assert.deepEqual(got.slice().sort(), ['tapyor_order_dropped', 'tapyor_track_started']);
  assert.equal(got.indexOf('tapyor_order_played'), -1, 'чужая категория не считается');
  assert.equal(got.indexOf('tapyor_test_queued'), -1, 'тестовая категория — не служебный триггер');
});

test('sbot-link: переменные — объект variables, value внутри, служебные не отдаются', async (t) => {
  const h = harness(t);
  await login(h, {
    actions: [], triggers: [],
    globals: {
      tapyorWho: 'all',
      tapyorTest: 'Кино ё & x=1',
      tapyorKey: 'SECRET',
      tapyorPendingRedemptions: null,
      tapyorLastOrder: 'Кино — Кукушка',
      other: 'x',
    },
  });
  const want = { tapyorWho: 'all', tapyorTest: 'Кино ё & x=1' };
  assert.deepEqual(h.link.getGlobals(), want);
  assert.deepEqual(h.globalsSeen[h.globalsSeen.length - 1], want);
});

test('sbot-link: Twitch — broadcastUser и connected массивом; бот неизвестен', async (t) => {
  const h = harness(t);
  await login(h, {
    actions: [], triggers: [], globals: {},
    broadcaster: {
      platforms: {
        twitch: {
          broadcastUser: 'streamer', broadcastUserName: 'streamer', broadcastUserId: '1000000',
          broadcasterIsAffiliate: false, broadcasterIsPartner: false, broadcasterIsOnboarded: false,
        },
      },
      connected: ['twitch'],
      disconnected: ['youtube', 'kick'],
    },
  });
  const st = h.link.getState();
  assert.equal(st.twitch.connected, true);
  assert.equal(st.twitch.name, 'streamer');
  assert.equal(st.bot.connected, null, 'бота-аккаунта в ответе нет — «не проверить»');
});

test('sbot-link: Twitch не подключён — connected false, а не «неизвестно»', async (t) => {
  const h = harness(t);
  await login(h, {
    actions: [], triggers: [], globals: {},
    broadcaster: {
      platforms: { twitch: { broadcastUser: 'streamer' } },
      connected: ['youtube'],
      disconnected: ['twitch'],
    },
  });
  assert.equal(h.link.getState().twitch.connected, false);
});

test('sbot-link: actionsFound — все служебные действия шаблона', async (t) => {
  const h = harness(t);
  await login(h, { actions: Object.values(linkMod.ACTIONS), triggers: [], globals: {} });
  const f = h.link.getState().actionsFound;
  assert.deepEqual(Object.keys(f).sort(), Object.keys(linkMod.ACTIONS).sort());
  for (const k of Object.keys(linkMod.ACTIONS)) assert.equal(f[k], true, k);
  assert.equal(linkMod.ACTIONS.findReward, 'Тапёр: найти награду');
  assert.equal(linkMod.ACTIONS.reply, 'Тапёр: ответ');
});

test('sbot-link: неверный пароль — статус auth, повтор через 60 с, без частых попыток', async (t) => {
  const h = harness(t);
  serve({ password: 'другой', actions: [], triggers: [], globals: {} });
  h.link.start();
  const ws = FakeWS.last();
  ws.open();
  ws.recv({ request: 'Hello', authentication: { salt: 'salt', challenge: 'chal' } });
  await settle();
  assert.equal(h.link.getState().status, 'auth');
  assert.equal(h.link.getState().nextRetryMs, 60000);
  assert.equal(FakeWS.instances.length, 1, 'сразу не переподключается');
  assert.ok(h.clock.pending().indexOf(60000) >= 0, 'повтор назначен через 60 с');
  await h.clock.tick(60000);
  assert.equal(FakeWS.instances.length, 2, 'через 60 с — новая попытка');
});

test('sbot-link: сервер требует пароль, а его нет — статус needPassword без повторов', async (t) => {
  const h = harness(t, { password: '' });
  serve({ password: PASSWORD, actions: [], triggers: [], globals: {} });
  h.link.start();
  const ws = FakeWS.last();
  ws.open();
  ws.recv({ request: 'Hello', authentication: { salt: 'salt', challenge: 'chal' } });
  await settle();
  assert.equal(h.link.getState().status, 'needPassword');
  assert.equal(FakeWS.instances.length, 1);
  assert.deepEqual(h.clock.pending(), [], 'сам не повторяет — ждёт, пока впишут пароль');
});

test('sbot-link: Streamer.bot без авторизации — входим сразу', async (t) => {
  const h = harness(t);
  serve({ actions: ['Тапёр: шаблон v1'], triggers: [], globals: {} });
  h.link.start();
  const ws = FakeWS.last();
  ws.open();
  ws.recv({ request: 'Hello', info: { version: '1.0.7' } });
  await settle();
  assert.equal(h.link.getState().status, 'ok');
  assert.equal(h.link.getState().templateVersion, 1);
});

test('sbot-link: переподключение 5 → 10 → 20 → 40 → 60 → 60 секунд', async (t) => {
  const h = harness(t);
  const ws0 = await login(h);
  ws0.fail();
  await settle(2);
  assert.equal(h.link.getState().status, 'error');
  const delays = [];
  for (let i = 0; i < 6; i++) {
    const p = h.clock.pending();
    const retry = p.filter((x) => x > 0)[0];
    delays.push(retry);
    await h.clock.tick(retry);
    FakeWS.last().fail();
    await settle(2);
  }
  assert.deepEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.equal(FakeWS.instances.length, 7, 'каждая попытка — новое соединение');
});

// R4: после сна ПК пульт не должен ждать паузу повтора (до 60 с), но живое
// соединение рвать нельзя, а частые попытки при неверном пароле — вредны.
test('sbot-link: после сна pokeNow не рвёт живое соединение', async (t) => {
  const h = harness(t);
  await login(h);
  assert.equal(h.link.getState().status, 'ok');
  assert.equal(h.link.pokeNow(), false, 'связь есть — ничего не делаем');
  assert.equal(FakeWS.instances.length, 1);
  assert.equal(FakeWS.last().readyState, 1);
});

test('sbot-link: после сна pokeNow подключается сразу, не ожидая паузу повтора', async (t) => {
  const h = harness(t);
  const ws0 = await login(h);
  ws0.fail();
  await settle(2);
  assert.equal(h.link.getState().status, 'error');
  assert.equal(FakeWS.instances.length, 1);
  assert.ok(h.clock.pending().indexOf(5000) >= 0, 'повтор назначен через 5 с');
  assert.equal(h.link.pokeNow(), true);
  assert.equal(FakeWS.instances.length, 2, 'новая попытка сразу');
  assert.equal(h.link.getState().status, 'connecting');
  assert.equal(h.clock.pending().indexOf(5000), -1, 'старая пауза повтора снята');
});

test('sbot-link: после сна pokeNow сбрасывает и накопленную паузу повтора', async (t) => {
  const h = harness(t);
  const ws0 = await login(h);
  ws0.fail();
  await settle(2);
  await h.clock.tick(5000);
  FakeWS.last().fail();
  await settle(2);
  assert.ok(h.clock.pending().indexOf(10000) >= 0, 'вторая пауза — 10 с');
  assert.equal(h.link.pokeNow(), true);
  FakeWS.last().fail();
  await settle(2);
  assert.ok(h.clock.pending().indexOf(5000) >= 0, 'после poke снова начинаем с 5 с');
  assert.equal(h.clock.pending().indexOf(20000), -1);
});

test('sbot-link: после сна pokeNow не трогает остановленный пульт', async (t) => {
  const h = harness(t);
  await login(h);
  h.link.stop();
  assert.equal(h.link.pokeNow(), false);
  assert.equal(FakeWS.instances.length, 1);
});

test('sbot-link: после сна pokeNow не частит при проблеме входа', async (t) => {
  const h = harness(t);
  serve({ password: 'другой', actions: [], triggers: [], globals: {} });
  h.link.start();
  const ws = FakeWS.last();
  ws.open();
  ws.recv({ request: 'Hello', authentication: { salt: 'salt', challenge: 'chal' } });
  await settle();
  assert.equal(h.link.getState().status, 'auth');
  assert.equal(h.link.pokeNow(), false, 'неверный пароль — ждём 60 с, а не долбим');
  assert.equal(FakeWS.instances.length, 1);
  assert.ok(h.clock.pending().indexOf(60000) >= 0, 'повтор остался прежним');
});


test('sbot-link: события заказов — ящик, повтор, ack, sb-cmd без ящика, приём и поздний ответ', async (t) => {
  const h = harness(t);
  const seenActions = [], seenTriggers = [];
  await login(h, {
    actions: ['Тапёр: шаблон v2', 'Тапёр: настройка', 'Тапёр: заказ выполнен', 'Тапёр: заказ снят', 'Тапёр: приём', 'Тапёр: ответ'],
    triggers: Object.values(linkMod.TRIGGERS),
    onAction: (m) => seenActions.push(m),
    onTrigger: (m) => seenTriggers.push(m),
  });
  const ws = FakeWS.last();

  h.link.notify('played', { orderId: 'sb-points:1', user: 'зритель', track: 'Кино — Кукушка', reward: 'r', redemption: 'red-1' }, { durable: true });
  await settle();
  assert.equal(h.mailbox.count(), 1, 'событие за баллы — в ящике, пока нет ack');
  const entry = h.mailbox.all()[0];
  assert.equal(entry.action, 'Тапёр: заказ выполнен');
  assert.equal(entry.args.orderId, 'sb-points:1');
  assert.equal(entry.args.reward, 'r');
  assert.equal(entry.args.redemption, 'red-1');
  const sentPlayed = seenActions.filter((m) => m.action.name === 'Тапёр: заказ выполнен');
  assert.equal(sentPlayed.length, 1, 'DoAction отправлен');
  assert.equal(sentPlayed[0].args.eventId, entry.eventId);
  assert.ok(seenTriggers.some((m) => m.triggerName === 'tapyor_order_played'), 'триггер тоже нажали');

  h.link.ack(entry.eventId);
  assert.equal(h.mailbox.count(), 0, 'ack удаляет из ящика');
  assert.equal(h.link.getState().mailbox, 0);

  // sb-cmd: одна попытка, без ящика
  const before = seenActions.length;
  h.link.notify('played', { orderId: 'sb-cmd:1', user: 'зритель', track: 'Кино — Кукушка' }, { durable: false });
  await settle();
  assert.equal(h.mailbox.count(), 0, 'sb-cmd не попадает в ящик');
  assert.equal(seenActions.length, before + 1, 'но действие отправлено');

  // Режим выключен: события заказов молчат, а приём — работает
  h.link.setOrderMode(false);
  assert.equal(h.link.notify('dropped', { orderId: 'sb-points:2', reason: 'removed' }, { durable: true }), false);
  assert.equal(h.link.reply({ reply: 'поздно' }), false);
  await settle();
  assert.equal(h.mailbox.count(), 0);
  assert.equal(h.link.accept(false), true, 'приём закрывается всегда');
  await settle();
  assert.equal(h.mailbox.count(), 1);
  assert.equal(h.mailbox.all()[0].action, 'Тапёр: приём');
  assert.equal(h.mailbox.all()[0].args.open, 0);
  assert.ok(seenTriggers.some((m) => m.triggerName === 'tapyor_accept_changed' && m.args.open === 0));
  h.link.setOrderMode(true);

  h.link.reply({ reply: '@зритель поставил', msgId: 'm1', user: 'зритель', platform: 'twitch', kind: 'cmd', reward: '', redemption: '', refund: false });
  await settle();
  const rep = h.mailbox.all().find((e) => e.action === 'Тапёр: ответ');
  assert.ok(rep, 'поздний ответ в ящике');
  assert.equal(rep.ttlMs, linkMod.REPLY_TTL_MS, 'живёт не дольше двух минут');
  assert.ok(ws.sent.length > 0);
});

test('sbot-link: триггер жмут только если Streamer.bot его видит', async (t) => {
  const h = harness(t);
  const seen = [];
  await login(h, { actions: ['Тапёр: шаблон v1'], triggers: ['tapyor_order_played'], onTrigger: (m) => seen.push(m) });
  h.link.notify('dropped', { orderId: 'sb-cmd:1', reason: 'removed' }, { durable: false });
  h.link.notify('played', { orderId: 'sb-cmd:2' }, { durable: false });
  await settle();
  assert.equal(seen.some((m) => m.triggerName === 'tapyor_order_dropped'), false);
  assert.equal(seen.some((m) => m.triggerName === 'tapyor_order_played'), true);
});

test('sbot-link: ящик повторяет отправку по часам пульта', async (t) => {
  const h = harness(t);
  const seen = [];
  await login(h, { actions: ['Тапёр: шаблон v1'], triggers: [], onAction: (m) => seen.push(m) });
  h.link.notify('dropped', { orderId: 'sb-points:7', reason: 'failed' }, { durable: true });
  await settle();
  assert.equal(h.mailbox.count(), 1);
  assert.equal(seen.filter((m) => m.action.name === 'Тапёр: заказ снят').length, 1);
  await h.clock.tick(9999);
  assert.equal(seen.filter((m) => m.action.name === 'Тапёр: заказ снят').length, 1, 'до 10 с не повторяет');
  await h.clock.tick(1);
  assert.equal(seen.filter((m) => m.action.name === 'Тапёр: заказ снят').length, 2, 'через 10 с — повтор');
  await h.clock.tick(30000);
  assert.equal(seen.filter((m) => m.action.name === 'Тапёр: заказ снят').length, 3, 'потом через 30 с');
  await h.clock.tick(60000);
  assert.equal(seen.filter((m) => m.action.name === 'Тапёр: заказ снят').length, 4, 'и дальше через 60 с');
  assert.equal(h.mailbox.count(), 1, 'без ack событие остаётся');
});

test('sbot-link: запись настроек — только переменные конструктора, служебные не подменить', async (t) => {
  const h = harness(t);
  const seen = [];
  await login(h, { actions: ['Тапёр: шаблон v1'], triggers: [], onAction: (m) => seen.push(m) });
  const r = await h.link.writeSettings({
    tapyorWho: 'all', tapyorPauseMin: 30, bad: 'x', 'tapyor-x': 'y',
    tapyorUrl: 'http://evil', tapyorKey: 'tp_EVIL', nested: { a: 1 },
    tapyorPendingRedemptions: 'r:1;r:2', tapyorRewardId: 'reward-evil', tapyorLastOrder: '999', tapyorOn: 1,
  });
  assert.equal(r.ok, true);
  const m = seen.filter((x) => x.action.name === 'Тапёр: настройка').pop();
  assert.equal(m.args.tapyorWho, 'all');
  assert.equal(m.args.tapyorPauseMin, 30);
  assert.equal(m.args.tapyorOn, 1, 'tapyorOn разрешён — его пишет шаблон для показа');
  assert.equal(m.args.bad, undefined);
  assert.equal(m.args.nested, undefined);
  assert.equal(m.args.tapyorPendingRedemptions, undefined, 'сверку окно не перезаписывает');
  assert.equal(m.args.tapyorRewardId, undefined, 'номер награды окно не подменяет');
  assert.equal(m.args.tapyorLastOrder, undefined, 'пауза между заказами не сбивается');
  assert.equal(m.args.tapyorUrl, 'http://127.0.0.1:47654', 'адрес Тапёра не подменяется окном');
  assert.equal(m.args.tapyorKey, KEY, 'ключ не подменяется окном');
});

test('sbot-link: tapyorOn=1 только когда заказы из чата принимает Streamer.bot', async (t) => {
  // false — бот пака или никто; true — Streamer.bot. Значение только для показа:
  // шаблон его не читает, при выключенном режиме он по-прежнему получает off.
  const off = harness(t);
  const wsOff = await login(off, { actions: ['Тапёр: шаблон v1'], triggers: [] });
  const setupOff = wsOff.sent.filter((m) => m.request === 'DoAction' && m.action.name === 'Тапёр: настройка').pop();
  assert.equal(setupOff.args.tapyorOn, 0);
  off.link.stop();

  const on = harness(t, { deps: { getOrderMode: () => true } });
  const wsOn = await login(on, { actions: ['Тапёр: шаблон v1'], triggers: [] });
  const setupOn = wsOn.sent.filter((m) => m.request === 'DoAction' && m.action.name === 'Тапёр: настройка').pop();
  assert.equal(setupOn.args.tapyorOn, 1);
});

test('sbot-link: «Проверить связь» ждёт ack и говорит, что именно не так', async (t) => {
  const h = harness(t);
  let linkRef = null;
  await login(h, {
    actions: ['Тапёр: шаблон v1'], triggers: [],
    onAction: (m) => { if (m.action.name === 'Тапёр: настройка' && m.args.ping === 1) queueMicrotask(() => linkRef.ack(m.args.eventId)); },
  });
  linkRef = h.link;
  const good = await h.link.testConnection();
  assert.equal(good.ok, true);
  assert.equal(good.message, 'обе стороны работают');
  assert.equal(good.version, '1.0.7');

  // Без ack: тот же GetInfo, но шаблон молчит — ждём timeout (100 мс в тесте)
  FakeWS.onSend = ((prev) => (ws, m) => { if (m.request === 'DoAction') queueMicrotask(() => ws.recv({ id: m.id, status: 'ok' })); else prev(ws, m); })(FakeWS.onSend);
  const p = h.link.testConnection();
  await settle();
  await h.clock.tick(150);
  const bad = await p;
  assert.equal(bad.ok, false);
  assert.match(bad.message, /не подтвердило/);
});

test('sbot-link: выключенный пульт молчит и не подключается', async (t) => {
  const h = harness(t);
  h.cfg.enabled = false;
  h.link.start();
  await settle();
  assert.equal(FakeWS.instances.length, 0);
  assert.equal(h.link.getState().status, 'off');
  const r = await h.link.testConnection();
  assert.equal(r.ok, false);
  assert.match(r.message, /выключено/);
});

test('sbot-link: уборка при запуске — только заказы за баллы прошлого запуска и без пропусков', () => {
  const started = Date.now();
  const old = started - 60 * 60 * 1000;
  const list = [
    { key: 'sb-points:1', name: 'зритель', uid: '1', platform: 'twitch', got: old, reward: 'Заказать песню', redemption: 'red-1', items: [{ level: 'exact', track: { author: 'Кино', title: 'Кукушка' } }] },
    { key: 'sb-points:2', name: 'второй', got: old, playedAt: old + 1000, items: [{ level: 'exact', track: { author: 'Кино', title: 'Мама' } }] },
    { key: 'sb-points:3', name: 'третий', got: old, items: [{ level: 'exact', track: { author: 'Кино', title: 'Группа крови' }, state: 'skip' }] },
    { key: 'sb-points:4', name: 'четвёртый', got: started + 1, items: [{ level: 'exact', track: { author: 'Кино', title: 'Звезда' } }] },
    { key: 'sb-cmd:5', name: 'пятый', got: old, items: [{ level: 'exact', track: { author: 'Кино', title: 'Печаль' } }] },
    { key: 'sb-points:6', name: 'шестой', got: old, droppedAt: old + 5 },
  ];
  const drops = linkMod.startupDrops(list, started);
  assert.equal(drops.length, 1, 'только первый заказ: прошлый запуск, баллы, не играл, не пропущен');
  assert.equal(drops[0].action, 'Тапёр: заказ снят');
  assert.equal(drops[0].args.reason, 'closed');
  assert.equal(drops[0].args.track, 'Кино — Кукушка');
  assert.equal(drops[0].args.reward, 'Заказать песню');
  assert.equal(drops[0].args.redemption, 'red-1');
  assert.equal(drops[0].args.kind, 'points');
  assert.equal(drops[0].rec.key, 'sb-points:1');
});

test('sbot-link: уборка при запуске не снимает заказ, чей трек стоит в восстановленной очереди', () => {
  const started = Date.now();
  const old = started - 60 * 60 * 1000;
  const rec = {
    key: 'sb-points:10', name: 'зритель', uid: '1', platform: 'twitch', got: old,
    reward: 'r', redemption: 'red-10', items: [{ level: 'exact', track: { author: 'Кино', title: 'Кукушка' } }],
  };
  const day = linkMod.streamDayAt(started);
  const today = { day: day, items: [{ src: 'ym', id: '1', author: 'Кино', title: 'Кукушка', req: { key: 'sb-points:10', who: 'зритель' } }] };
  assert.equal(linkMod.startupDrops([rec], started, today).length, 0, 'трек уже в ленте today — сыграет и придёт played');
  // Лента другого дня не считается восстановленной.
  assert.equal(linkMod.startupDrops([rec], started, { day: '2000-1-1', items: today.items }).length, 1);
  // Элемент без req (сохранён версией до 0.35) ничего не доказывает — заказ снимаем.
  assert.equal(linkMod.startupDrops([rec], started, { day: day, items: [{ src: 'ym', id: '1' }] }).length, 1);
  // День стрима начинается в 6 утра — как в окне (03-queue.js).
  const early = new Date(2026, 10, 12, 5, 30).getTime();
  assert.equal(linkMod.streamDayAt(early), '2026-11-11');
});

test('sbot-link: снятый при запуске заказ закрывается в карточке и не занимает лимит', () => {
  const rec = {
    key: 'sb-points:11', state: 'new',
    items: [{ level: 'exact', track: { author: 'Кино', title: 'Мама' } }, {}],
  };
  assert.equal(linkMod.markStartupDrop(rec, 12345), true);
  assert.equal(rec.state, 'dismissed', 'карточка закрыта');
  assert.equal(rec.droppedAt, 12345);
  assert.equal(rec.droppedReason, 'closed');
  assert.ok(rec.items.every((it) => it.state === 'skip'), 'варианты пропущены');
  assert.equal(linkMod.markStartupDrop(null), false);
});

test('sbot-link: смена «кто принимает» — открыть/закрыть приём', () => {
  assert.equal(linkMod.chatOrdersChange('none', 'sbot'), 'open');
  assert.equal(linkMod.chatOrdersChange('pack', 'sbot'), 'open');
  assert.equal(linkMod.chatOrdersChange('sbot', 'none'), 'close');
  assert.equal(linkMod.chatOrdersChange('sbot', 'pack'), 'close');
  assert.equal(linkMod.chatOrdersChange('none', 'pack'), null);
  assert.equal(linkMod.chatOrdersChange('sbot', 'sbot'), null);
});

test('sbot-link: бесплатная команда Streamer.bot — не платный заказ', () => {
  assert.equal(linkMod.isPaidOrder('sbot', false), false, '!sr через Streamer.bot — бесплатный чат, как бот пака');
  assert.equal(linkMod.isPaidOrder('bot', false), false);
  assert.equal(linkMod.isPaidOrder('sbot', true), true, 'баллы канала — платный (явный признак)');
  assert.equal(linkMod.isPaidOrder('da', false), true, 'донат — платный');
  assert.equal(linkMod.isPaidOrder('test', false), true, 'пробный заказ идёт как донат');
});

test('sbot-link: включили режим Streamer.bot — приём открывается', () => {
  assert.equal(linkMod.nextAccepting('none', 'sbot', false), true, 'включили — приём открыт');
  assert.equal(linkMod.nextAccepting('pack', 'sbot', false), true);
  assert.equal(linkMod.nextAccepting('sbot', 'sbot', false), false, 'режим не менялся — не трогаем');
  assert.equal(linkMod.nextAccepting('none', 'pack', true), true, 'выключили Streamer.bot — состояние как было');
  assert.equal(linkMod.nextAccepting('sbot', 'none', false), false);
  assert.equal(linkMod.nextAccepting('sbot', 'none', true), true);
});

// ── Вживую против поддельного Streamer.bot (tests/sbot-fake/fake-sb.mjs) ──────
// Настоящий WebSocket и настоящий sha256-вход: проверяем протокол, а не только свою логику.

async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) {
    let v = false;
    try { v = !!fn(); } catch (e) { v = false; }
    if (v) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return false;
}

async function ackServer(handler) {
  const http = await import('node:http');
  const srv = http.createServer((req, res) => {
    let ok = false;
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      ok = !!handler.ack(u.searchParams.get('id') || '');
    } catch (e) {}
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', acked: ok ? 1 : 0 }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  return { url: 'http://127.0.0.1:' + port, close: () => new Promise((r) => srv.close(r)) };
}

test('sbot-link + fake-sb: вход, состояние, настройка, событие и ack через настоящий порт', async (t) => {
  const { startFakeSb } = await import('../sbot-fake/fake-sb.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-sbot-live-'));
  const fake = await startFakeSb({
    password: 'тест-пароль',
    version: '1.0.7',
    actions: ['Тапёр: шаблон v4'].concat(Object.values(linkMod.ACTIONS)),
    triggers: Object.values(linkMod.TRIGGERS),
    globals: { tapyorWho: 'all', tapyorKey: 'НЕ ОТДАВАТЬ', tapyorCmdOrder: '!sr' },
    autoAck: true,
  });
  let link = null;
  const ack = await ackServer({ ack: (id) => link && link.ack(id) });
  const mailbox = createMailbox({ file: path.join(dir, 'sbot-mailbox.json'), now: () => Date.now() });
  const logs = [];
  link = linkMod.createLink({
    WebSocket: globalThis.WebSocket,
    mailbox,
    log: (m) => logs.push(String(m)),
    getConfig: () => ({ enabled: true, host: '127.0.0.1', port: fake.port, endpoint: '/' }),
    getPassword: () => 'тест-пароль',
    tapyorUrl: () => ack.url,
    tapyorKey: () => KEY,
    pendingList: () => '',
    onState: () => {},
    onGlobals: () => {},
    journal: { append: () => {} },
    requestTimeoutMs: 1500,
  });
  t.after(async () => {
    try { link.stop(); } catch (e) {}
    await fake.close();
    await ack.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  });

  link.start();
  assert.ok(await waitFor(() => link.getState().status === 'ok', 3000), 'вошли по паролю');
  assert.ok(await waitFor(() => fake.state.actions.some((a) => a.name === 'Тапёр: настройка'), 3000), 'настройка дошла');
  const setup = fake.state.actions.find((a) => a.name === 'Тапёр: настройка');
  assert.equal(setup.args.tapyorUrl, ack.url);
  assert.equal(setup.args.tapyorKey, KEY);
  assert.equal(link.getState().sbVersion, '1.0.7');
  assert.equal(link.getState().templateVersion, 4);
  assert.equal(link.getState().twitch.connected, true);
  assert.equal(link.getState().twitch.name, 'streamer');
  assert.equal(link.getState().bot.connected, null, 'в ответе 1.0.7 бота нет');
  assert.equal(link.getState().triggersFound.length, Object.values(linkMod.TRIGGERS).length);
  for (const k of Object.keys(linkMod.ACTIONS)) assert.equal(link.getState().actionsFound[k], true, k);
  assert.deepEqual(link.getGlobals(), { tapyorWho: 'all', tapyorCmdOrder: '!sr' });
  assert.equal(logs.join('\n').indexOf(KEY), -1);

  // Заказ за баллы: событие в ящике, шаблон получил действие и сам подтвердил через /sb/ack.
  link.notify('played', {
    orderId: 'sb-points:live1', user: 'зритель', track: 'Кино — Кукушка',
    reward: 'Заказать песню', redemption: 'red-live-1',
  }, { durable: true });
  assert.ok(await waitFor(() => fake.state.actions.some((a) => a.name === 'Тапёр: заказ выполнен'), 3000), 'действие отправлено');
  assert.ok(await waitFor(() => fake.state.triggers.some((x) => x.name === 'tapyor_order_played'), 3000), 'триггер нажат');
  assert.ok(await waitFor(() => mailbox.count() === 0, 3000), 'ack удалил событие из ящика');
  assert.ok(await waitFor(() => fake.state.acks.some((x) => x.ok), 3000), 'подтверждение дошло до Тапёра');

  const test = await link.testConnection();
  assert.equal(test.ok, true, 'проверка связи в обе стороны');
});

test('sbot-link: «Найти награду» — действие шаблона, ack, номер из глобальных', async (t) => {
  const h = harness(t);
  const g = { tapyorRewardName: 'Заказать песню' };
  let acted = 0;
  await login(h, {
    globals: g,
    onAction: (m) => {
      if (!m.action || m.action.name !== linkMod.ACTIONS.findReward) return;
      acted++;
      g.tapyorRewardId = 'reward-42';
      h.link.ack(m.args.eventId);
    },
  });
  const r = await h.link.findReward();
  assert.equal(acted, 1, 'действие «Тапёр: найти награду» отправлено один раз');
  assert.equal(r.ok, true);
  assert.equal(r.rewardId, 'reward-42');
  assert.match(r.message, /награда найдена/);
  assert.deepEqual(h.globalsSeen[h.globalsSeen.length - 1], { tapyorRewardName: 'Заказать песню', tapyorRewardId: 'reward-42' });
  assert.equal(h.link.getGlobals().tapyorRewardId, 'reward-42', 'окно сразу видит номер');
});

test('sbot-link: награда не нашлась — ответ без падения', async (t) => {
  const h = harness(t);
  await login(h, {
    globals: { tapyorRewardName: 'Моя награда' },
    onAction: (m) => { if (m.action && m.action.name === linkMod.ACTIONS.findReward) h.link.ack(m.args.eventId); },
  });
  const pending = h.link.findReward();
  await settle(8);
  await h.clock.tick(1000); // три попытки чтения с паузой 400 мс
  const r = await pending;
  assert.equal(r.ok, false);
  assert.equal(r.rewardId, '');
  assert.match(r.message, /награда не найдена/);
  h.link.stop();
  const off = await h.link.findReward();
  assert.equal(off.ok, false);
  assert.match(off.message, /подключение|нет связи/i);
});

test('sbot-link: refreshGlobals перечитывает переменные без переподключения', async (t) => {
  const h = harness(t);
  const g = { tapyorWho: 'all', tapyorCmdOrder: '!sr' };
  await login(h, { globals: g });
  assert.equal(h.link.getGlobals().tapyorWho, 'all');
  g.tapyorWho = 'sub';
  g.tapyorChatCap = '15';
  const before = h.states.length;
  const okRead = await h.link.refreshGlobals();
  assert.equal(okRead, true);
  assert.equal(h.link.getGlobals().tapyorWho, 'sub', 'новое значение видно окну');
  assert.equal(h.link.getGlobals().tapyorChatCap, '15');
  assert.ok(h.states.length > before, 'состояние отправлено окну');
  h.link.stop();
  assert.equal(await h.link.refreshGlobals(), false, 'без связи — честный отказ');
});

test('sbot-link: «Нажать» — тестовый триггер, работает и в режиме бота пака', async (t) => {
  const h = harness(t);
  const ws = await login(h, { triggers: Object.values(linkMod.TRIGGERS) });
  h.link.setOrderMode(false); // заказы принимает бот пака — кнопка проверки всё равно работает
  const r = await h.link.testTrigger(linkMod.TRIGGERS.queued);
  assert.equal(r.ok, true, r.message);
  const sent = ws.sent.filter((m) => m.request === 'ExecuteCodeTrigger').pop();
  assert.ok(sent, 'ExecuteCodeTrigger отправлен');
  assert.equal(sent.triggerName, 'tapyor_order_queued');
  assert.equal(sent.args.user, 'зритель');
  assert.equal(sent.args.place, 3);
  assert.equal(sent.args.etaMin, 5);
  assert.equal(sent.args.kind, 'cmd');
  assert.match(sent.args.orderId, /^test-\d+$/, 'у тестового заказа есть orderId test-<время>');
  assert.match(sent.args.eventId, /^ev-\d+$/);
  assert.equal(sent.args.tapyorKey, undefined, 'ключ в тестовые данные не попадает');

  // Все четыре заказа получают orderId; не заказы (трек, пустая очередь) — нет.
  for (const trig of ['tapyor_order_queued', 'tapyor_order_pending', 'tapyor_order_played', 'tapyor_order_dropped']) {
    const a = linkMod.testTriggerArgs(trig, 12345);
    assert.equal(a.orderId, 'test-12345', trig);
    assert.equal(a.kind, 'cmd', trig);
    assert.equal(a.etaMin, 5, trig);
  }
  assert.equal(linkMod.testTriggerArgs('tapyor_track_started', 12345).orderId, undefined);

  const bad = await h.link.testTrigger('tapyor_hack');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /неизвестный/);
  const accept = await h.link.testTrigger(linkMod.TRIGGERS.accept);
  assert.equal(accept.ok, true);
  const last = ws.sent.filter((m) => m.request === 'ExecuteCodeTrigger').pop();
  assert.equal(last.args.open, 1);
});

test('sbot-link: «Нажать» без зарегистрированного триггера — понятная причина', async (t) => {
  const h = harness(t);
  await login(h, { triggers: [linkMod.TRIGGERS.track] });
  const r = await h.link.testTrigger(linkMod.TRIGGERS.empty);
  assert.equal(r.ok, false);
  assert.match(r.message, /не видит этот триггер/);
  const ok = await h.link.testTrigger(linkMod.TRIGGERS.track);
  assert.equal(ok.ok, true);
});

test('sbot-link + fake-sb: неверный пароль и сервер без пароля', async (t) => {
  const { startFakeSb } = await import('../sbot-fake/fake-sb.mjs');
  const wrong = await startFakeSb({ password: 'правильный' });
  const good = await startFakeSb({ password: '' });
  const mk = (port, pw) => linkMod.createLink({
    WebSocket: globalThis.WebSocket,
    getConfig: () => ({ enabled: true, host: '127.0.0.1', port, endpoint: '/' }),
    getPassword: () => pw,
    requestTimeoutMs: 1500,
  });
  const a = mk(wrong.port, 'неправильный');
  const b = mk(good.port, '');
  t.after(async () => { a.stop(); b.stop(); await wrong.close(); await good.close(); });
  a.start();
  assert.ok(await waitFor(() => a.getState().status === 'auth', 3000), 'неверный пароль — статус auth');
  assert.equal(wrong.state.authAttempts, 1);
  b.start();
  assert.ok(await waitFor(() => b.getState().status === 'ok', 3000), 'без пароля входим сразу');
});

test('sbot-link + fake-sb: обрыв и переподключение', async (t) => {
  const { startFakeSb } = await import('../sbot-fake/fake-sb.mjs');
  const fake = await startFakeSb({ password: '' });
  const link = linkMod.createLink({
    WebSocket: globalThis.WebSocket,
    getConfig: () => ({ enabled: true, host: '127.0.0.1', port: fake.port, endpoint: '/' }),
    getPassword: () => '',
    backoffMs: [60, 120],
    requestTimeoutMs: 1000,
  });
  t.after(async () => { link.stop(); await fake.close(); });
  link.start();
  assert.ok(await waitFor(() => link.getState().status === 'ok', 3000));
  fake.drop();
  assert.ok(await waitFor(() => link.getState().status === 'error', 2000), 'обрыв виден');
  assert.ok(await waitFor(() => link.getState().status === 'ok', 3000), 'сам переподключился');
  assert.ok(fake.state.connections >= 2);
});

