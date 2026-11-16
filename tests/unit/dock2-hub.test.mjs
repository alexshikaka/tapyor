// DOCK2: узел второй док-панели OBS (src/main/dock2-hub.js) без Electron.
// Поддельные ipcMain, окно и req/res — в самом тесте (docs/DOCK2.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const localGuard = require(path.join(ROOT, 'src', 'localguard.js'));
const hubModule = require(path.join(ROOT, 'src', 'main', 'dock2-hub.js'));
const { create, validate } = hubModule;

const PORT = 47777;

function fakeIpc() {
  const on = new Map(), handle = new Map();
  return {
    on: (ch, fn) => on.set(ch, fn),
    handle: (ch, fn) => handle.set(ch, fn),
    onMap: on,
    handleMap: handle
  };
}

function fakeWindow() {
  const sent = [];
  const win = {
    isDestroyed: () => false,
    webContents: { send: (ch, data) => sent.push({ ch, data }) }
  };
  return { win, sent };
}

function fakeRes() {
  const res = {
    status: 0, headers: null, body: '', ended: false, writes: [],
    writeHead(code, headers) { res.status = code; res.headers = headers || null; },
    write(data) { res.writes.push(String(data)); return true; },
    end(data) { if (data != null) res.body += String(data); res.ended = true; },
    destroy() {}
  };
  return res;
}

function fakeReq(opts = {}) {
  const req = new EventEmitter();
  req.method = opts.method || 'GET';
  req.headers = opts.headers || {};
  if (opts.body !== undefined) {
    process.nextTick(() => { req.emit('data', Buffer.from(opts.body)); req.emit('end'); });
  }
  return req;
}

function makeHub(extra = {}) {
  const ipc = fakeIpc();
  const { win, sent } = fakeWindow();
  const logs = [];
  let focus = 0;
  const hub = create({
    ipcMain: ipc,
    getMainWindow: () => win,
    showMainWindow: () => { focus++; },
    localGuard,
    log: (line) => logs.push(String(line)),
    fs,
    path,
    srcDir: path.join(ROOT, 'src'),
    getPort: () => PORT,
    ...extra
  });
  return { hub, ipc, win, sent, logs, focus: () => focus };
}

const SNAP = {
  v: 1, at: Date.now(), mode: 'classic', cur: 0,
  np: { title: 'Трек', artist: 'Артист', playing: true, pos: 1, dur: 10 },
  items: [{ i: 0, key: 'ym:1', title: 'Трек', artist: 'Артист' }]
};

test('validate: каждая команда из таблицы', () => {
  assert.deepEqual(validate({ c: 'play', i: 0, key: 'ym:1' }), { c: 'play', i: 0, key: 'ym:1' });
  assert.deepEqual(validate({ c: 'remove', i: 5, key: 'yt:abc' }), { c: 'remove', i: 5, key: 'yt:abc' });
  assert.deepEqual(validate({ c: 'ban', i: 2, key: 'ym:9' }), { c: 'ban', i: 2, key: 'ym:9' });
  assert.deepEqual(validate({ c: 'next', i: 3, key: 'sc:7' }), { c: 'next', i: 3, key: 'sc:7' });
  assert.deepEqual(validate({ c: 'move', i: 1, key: 'ym:1', to: 4 }), { c: 'move', i: 1, key: 'ym:1', to: 4 });
  assert.deepEqual(validate({ c: 'mode', m: 'classic' }), { c: 'mode', m: 'classic' });
  assert.deepEqual(validate({ c: 'mode', m: 'live' }), { c: 'mode', m: 'live' });
  assert.deepEqual(validate({ c: 'wave', a: 'play' }), { c: 'wave', a: 'play' });
  assert.deepEqual(validate({ c: 'wave', a: 'auto' }), { c: 'wave', a: 'auto' });
  // «Дальше в волне»: номер трека в волне и его ключ (16.11)
  assert.deepEqual(validate({ c: 'waveat', j: 2, key: 'ym:5', x: 1 }), { c: 'waveat', j: 2, key: 'ym:5' });
  assert.equal(validate({ c: 'waveat', j: -1, key: 'ym:5' }), null);
  assert.equal(validate({ c: 'waveat', j: 1 }), null);
  assert.deepEqual(validate({ c: 'more', id: 'Sab_1', from: 15 }), { c: 'more', id: 'Sab_1', from: 15 });
  assert.equal(validate({ c: 'more', id: 'a b', from: 15 }), null);
  assert.deepEqual(validate({ c: 'tr', a: 'prev' }), { c: 'tr', a: 'prev' });
  assert.deepEqual(validate({ c: 'tr', a: 'playpause' }), { c: 'tr', a: 'playpause' });
  assert.deepEqual(validate({ c: 'tr', a: 'next' }), { c: 'tr', a: 'next' });
  assert.deepEqual(validate({ c: 'search', q: '  песня  ', id: 's_1-A' }), { c: 'search', q: 'песня', id: 's_1-A' });
  assert.deepEqual(validate({ c: 'add', r: 'r1' }), { c: 'add', r: 'r1' });
  assert.deepEqual(validate({ c: 'playnow', r: 'r_2' }), { c: 'playnow', r: 'r_2' });
  assert.deepEqual(validate({ c: 'focus' }), { c: 'focus' });
  // пустая строка поиска допустима
  assert.deepEqual(validate({ c: 'search', q: '   ', id: 's1' }), { c: 'search', q: '', id: 's1' });
});

test('validate: мусор, длины и лишние поля', () => {
  const bad = [
    null, undefined, 0, '', 'focus', [], {},
    { c: 'nope' }, { c: 1 }, { c: 'play' },
    { c: 'play', i: -1, key: 'k' }, { c: 'play', i: 10001, key: 'k' }, { c: 'play', i: 1.5, key: 'k' },
    { c: 'play', i: '1', key: 'k' }, { c: 'play', i: 1, key: 5 },
    { c: 'move', i: 1, key: 'k', to: -1 }, { c: 'move', i: 1, key: 'k', to: 10001 },
    { c: 'mode', m: 'other' }, { c: 'wave', a: 'next' }, { c: 'tr', a: 'auto' },
    { c: 'search', q: 'x', id: 'плохой id' }, { c: 'search', q: 'x', id: 'a/b' },
    { c: 'add', r: '' }, { c: 'add', r: 'r'.repeat(41) },
    { c: 'play', i: 1, key: 'k'.repeat(121) },
    { c: 'search', q: 'q'.repeat(201), id: 's1' }
  ];
  for (const v of bad) assert.equal(validate(v), null, JSON.stringify(v));

  // границы длин проходят
  assert.equal(validate({ c: 'play', i: 10000, key: 'k'.repeat(120) }).i, 10000);
  assert.equal(validate({ c: 'search', q: 'q'.repeat(200), id: 'i'.repeat(40) }).id.length, 40);
  assert.equal(validate({ c: 'add', r: 'r'.repeat(40) }).r.length, 40);

  // лишние поля отбрасываются, команда остаётся
  assert.deepEqual(validate({ c: 'mode', m: 'live', i: 3, key: 'x', evil: true }), { c: 'mode', m: 'live' });
  assert.deepEqual(validate({ c: 'focus', text: 'привет' }), { c: 'focus' });
});

test('счётчик зрителей: SSE + модули, dock2-clients при изменении', async () => {
  const { hub, sent } = makeHub();
  assert.equal(hub.viewers(), 0);

  const mod1 = hub.forModule('remote');
  const mod2 = hub.forModule('overlay');
  mod1.want(false);
  assert.equal(hub.viewers(), 0);
  assert.equal(sent.length, 0);

  mod1.want(true);
  assert.equal(hub.viewers(), 1);
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-clients').map((x) => x.data), [1]);

  mod2.want(true);
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-clients').map((x) => x.data), [1, 2]);

  const req = fakeReq();
  const res = fakeRes();
  assert.equal(await hub.handle(req, res, '/dock2/events', PORT), true);
  assert.equal(res.status, 200);
  assert.match(String(res.headers['Content-Type']), /text\/event-stream/);
  assert.equal(hub.viewers(), 3);
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-clients').map((x) => x.data), [1, 2, 3]);

  // повторный want(true) число не меняет — лишнего сообщения нет
  mod1.want(true);
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-clients').map((x) => x.data), [1, 2, 3]);

  req.emit('close');
  assert.equal(hub.viewers(), 2);
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-clients').map((x) => x.data), [1, 2, 3, 2]);

  mod1.want(false);
  mod2.want(false);
  assert.equal(hub.viewers(), 0);
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-clients').map((x) => x.data), [1, 2, 3, 2, 1, 0]);
});

test('снимок и события доходят до SSE и модулей; on отдаёт последний снимок', () => {
  const { hub, ipc, sent } = makeHub();
  const got = [];
  const off = hub.forModule('remote').on((msg) => got.push(msg));

  // при подписке снимка ещё нет — ничего не приходит
  assert.deepEqual(got, []);

  ipc.onMap.get('dock2-state')({}, SNAP);
  assert.deepEqual(hub.forModule('remote').get(), SNAP);
  assert.deepEqual(got, [SNAP]);
  assert.equal(sent.filter((x) => x.ch === 'dock2-cmd').length, 0);

  // подписка после снимка сразу получает его
  const late = [];
  hub.forModule('late').on((m) => late.push(m));
  assert.deepEqual(late, [SNAP]);

  ipc.onMap.get('dock2-event')({}, { ev: 'toast', text: 'Готово' });
  ipc.onMap.get('dock2-event')({}, { ev: 'search', id: 's1', q: 'x', done: true, items: [] });
  assert.equal(got.length, 3);
  assert.equal(got[1].ev, 'toast');
  assert.equal(got[2].ev, 'search');

  // чужие события и снимки без v === 1 не проходят
  ipc.onMap.get('dock2-event')({}, { ev: 'evil' });
  ipc.onMap.get('dock2-state')({}, { mode: 'classic' });
  ipc.onMap.get('dock2-state')({}, null);
  assert.equal(got.length, 3);
  assert.deepEqual(hub.forModule('remote').get(), SNAP);

  off();
  ipc.onMap.get('dock2-event')({}, { ev: 'toast', text: 'Ещё' });
  assert.equal(got.length, 3, 'отписка работает');
});

test('SSE получает снимок, событие и сердцебиение', async () => {
  const { hub, ipc } = makeHub();
  const req = fakeReq();
  const res = fakeRes();
  await hub.handle(req, res, '/dock2/events', PORT);
  assert.match(res.writes[0], /retry: 2000/);
  assert.match(res.writes[1], /^data: \{\}\n\n$/);

  ipc.onMap.get('dock2-state')({}, SNAP);
  ipc.onMap.get('dock2-event')({}, { ev: 'toast', text: 'Привет' });
  const data = res.writes.join('');
  assert.match(data, /"v":1/);
  assert.match(data, /"ev":"toast"/);
  req.emit('close');
});

test('forModule().cmd: мусор — bad-command, годная команда уходит окну', () => {
  const { hub, sent } = makeHub();
  const mod = hub.forModule('remote');
  assert.deepEqual(mod.cmd(null), { ok: false, error: 'bad-command' });
  assert.deepEqual(mod.cmd({ c: 'hack', i: 0 }), { ok: false, error: 'bad-command' });
  assert.deepEqual(mod.cmd({ c: 'play', i: 1, key: 'ym:2' }), { ok: true });
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-cmd').map((x) => x.data), [{ c: 'play', i: 1, key: 'ym:2' }]);
});

test('focus: showMainWindow, без IPC; в журнал — только вид действия', () => {
  const { hub, ipc, sent, logs, focus } = makeHub();
  assert.deepEqual(hub.forModule('remote').cmd({ c: 'focus' }), { ok: true });
  assert.equal(focus(), 1);
  assert.equal(sent.length, 0);

  ipc.onMap.get('dock2-state')({}, SNAP);
  hub.command({ c: 'remove', i: 1, key: 'ym:2' }, 'remote');
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-cmd').map((x) => x.data), [{ c: 'remove', i: 1, key: 'ym:2' }]);
  assert.ok(logs.includes('док2: focus (remote)'));
  assert.ok(logs.includes('док2: remove (remote)'));
  // названий треков и ников в журнале нет — только вид
  assert.ok(!logs.some((l) => /ym:2|Трек|Артист/.test(l)), logs.join('\n'));
});

test('handle: страница, состояние, команда; чужие пути — false', async () => {
  const { hub, ipc, sent } = makeHub();
  ipc.onMap.get('dock2-state')({}, SNAP);

  assert.equal(await hub.handle(fakeReq(), fakeRes(), '/other', PORT), false);
  assert.equal(await hub.handle(fakeReq(), fakeRes(), '/dock2/unknown', PORT), false);

  const stateRes = fakeRes();
  assert.equal(await hub.handle(fakeReq(), stateRes, '/dock2/state', PORT), true);
  assert.equal(stateRes.status, 200);
  assert.match(String(stateRes.headers['Content-Type']), /application\/json/);
  assert.deepEqual(JSON.parse(stateRes.body), SNAP);

  const cmdRes = fakeRes();
  const cmdReq = fakeReq({ method: 'POST', body: JSON.stringify({ c: 'remove', i: 0, key: 'ym:1', evil: 1 }) });
  assert.equal(await hub.handle(cmdReq, cmdRes, '/dock2/cmd', PORT), true);
  assert.equal(cmdRes.status, 204);
  assert.deepEqual(sent.filter((x) => x.ch === 'dock2-cmd').map((x) => x.data), [{ c: 'remove', i: 0, key: 'ym:1' }]);

  const badJson = fakeRes();
  assert.equal(await hub.handle(fakeReq({ method: 'POST', body: '{' }), badJson, '/dock2/cmd', PORT), true);
  assert.equal(badJson.status, 400);

  const badCmd = fakeRes();
  assert.equal(await hub.handle(fakeReq({ method: 'POST', body: JSON.stringify({ c: 'nope' }) }), badCmd, '/dock2/cmd', PORT), true);
  assert.equal(badCmd.status, 400);

  const huge = fakeRes();
  const hugeBody = JSON.stringify({ c: 'search', q: 'x'.repeat(5000), id: 's1' });
  assert.equal(await hub.handle(fakeReq({ method: 'POST', body: hugeBody }), huge, '/dock2/cmd', PORT), true);
  assert.equal(huge.status, 400);

  // страница: заголовки как у /widget (CSP, запрет фрейма, без кэша)
  const pageRes = fakeRes();
  const ended = new Promise((resolve) => { const end = pageRes.end; pageRes.end = (d) => { end(d); resolve(); }; });
  assert.equal(await hub.handle(fakeReq(), pageRes, '/dock2', PORT), true);
  await ended;
  assert.equal(pageRes.status, 200);
  assert.match(String(pageRes.headers['Content-Type']), /text\/html/);
  assert.equal(pageRes.headers['Cache-Control'], 'no-store');
  assert.equal(pageRes.headers['X-Frame-Options'], 'SAMEORIGIN');
  assert.match(String(pageRes.headers['Content-Security-Policy']), /frame-ancestors/);
  assert.match(pageRes.body, /dock2\.js/);
});

test('dock2-url и проверка отправителя IPC', () => {
  const ipc = fakeIpc();
  const { sent } = fakeWindow();
  const seen = [];
  const hub = create({
    ipcMain: ipc,
    getMainWindow: () => null,
    showMainWindow: () => {},
    localGuard,
    log: () => {},
    fs,
    path,
    srcDir: path.join(ROOT, 'src'),
    getPort: () => PORT,
    senderOk: (ev, channel) => { seen.push(channel); return ev && ev.ok === true; }
  });
  assert.equal(ipc.handleMap.get('dock2-url')(), 'http://127.0.0.1:' + PORT + '/dock2');

  ipc.onMap.get('dock2-state')({ ok: false }, SNAP);
  assert.equal(hub.state(), null, 'чужой вызов не сохраняется');
  ipc.onMap.get('dock2-state')({ ok: true }, SNAP);
  assert.deepEqual(hub.state(), SNAP);
  assert.deepEqual(seen, ['dock2-state', 'dock2-state']);
  assert.equal(sent.length, 0);
});

test('url: без порта — пустая строка', () => {
  const { hub } = makeHub();
  assert.equal(hub.url(0), '');
  assert.equal(hub.url(PORT), 'http://127.0.0.1:' + PORT + '/dock2');
});

test('A38 H1/M2/M4: окно спрашивает число зрителей; «Открыть» — только свой адрес; зависший и девятый зритель', async () => {
  const opened = [];
  const { hub, ipc } = makeHub({ openUrl: (u) => opened.push(u) });
  assert.equal(await ipc.handleMap.get('dock2-viewers')(), 0, 'зрителей нет — 0');
  const mod = hub.forModule('remote');
  mod.want(true);
  assert.equal(await ipc.handleMap.get('dock2-viewers')(), 1, 'модуль с want(true) — зритель, окно узнаёт это по запросу');
  assert.equal(await ipc.handleMap.get('dock2-open')(), true);
  assert.deepEqual(opened, ['http://127.0.0.1:' + PORT + '/dock2'], 'открывается ровно свой адрес пульта');

  // зависший зритель: неотправленного больше 1 МБ — отключаем, снимки в памяти не копятся
  const reqs = [];
  const r = () => { const q = fakeReq({ headers: { host: '127.0.0.1:' + PORT } }); reqs.push(q); return q; };
  const stuck = fakeRes();
  let destroyed = false;
  stuck.writableLength = 2 * 1024 * 1024;
  stuck.destroy = () => { destroyed = true; };
  await hub.handle(r(), stuck, '/dock2/events', PORT);
  ipc.onMap.get('dock2-state')({}, SNAP);
  assert.equal(destroyed, true, 'зависший зритель отключён');

  // больше 8 панелей сразу — отказ 503
  for (let k = 0; k < 8; k++) await hub.handle(r(), fakeRes(), '/dock2/events', PORT);
  const ninth = fakeRes();
  await hub.handle(r(), ninth, '/dock2/events', PORT);
  assert.equal(ninth.status, 503, 'девятая панель — 503');
  for (const q of reqs) q.emit('close');   // сердцебиения остановлены — тест не висит
});
