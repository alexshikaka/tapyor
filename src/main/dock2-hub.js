// Вторая док-панель OBS — «Пульт плейлиста» (docs/DOCK2.md).
// Один узел на всю программу: окно присылает снимок и события, а страница /dock2,
// модуль «Пульт с телефона» и другие зрители получают их и шлют команды обратно.
// Ничего не знает о внутренностях окна и не требует electron: всё внешнее — в create(deps).
'use strict';

// Белый список команд. Поле → проверка:
//   i/to — целое 0…10000, key — строка до 120, q — строка до 200 (обрезаем пробелы),
//   id/r — токен [A-Za-z0-9_-] до 40, m и a — по таблице docs/DOCK2.md.
const COMMANDS = {
  play: { i: 'index', key: 'key' },
  remove: { i: 'index', key: 'key' },
  ban: { i: 'index', key: 'key' },
  next: { i: 'index', key: 'key' },
  move: { i: 'index', key: 'key', to: 'index' },
  mode: { m: 'mode' },
  wave: { a: 'waveAction' },
  waveat: { j: 'index', key: 'key' },   // включить трек из «Дальше в волне» (16.11)
  tr: { a: 'trAction' },
  search: { q: 'query', id: 'token' },
  more: { id: 'token', from: 'index' },   // следующие 15 треков выдачи, с номера from (16.11)
  add: { r: 'token' },
  playnow: { r: 'token' },
  focus: {}
};
const EVENTS = new Set(['search', 'toast']);
const SSE_MAX = 8;                     // панелей /dock2 одновременно
const SSE_MAX_BUF = 1024 * 1024;      // неотправленного у одного зрителя — больше не копим
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function validField(kind, v) {
  if (kind === 'index') return Number.isInteger(v) && v >= 0 && v <= 10000;
  if (kind === 'key') return typeof v === 'string' && v.length <= 120;
  if (kind === 'query') return typeof v === 'string' && v.trim().length <= 200;
  if (kind === 'token') return typeof v === 'string' && v.length >= 1 && v.length <= 40 && TOKEN_RE.test(v);
  if (kind === 'mode') return v === 'classic' || v === 'live';
  if (kind === 'waveAction') return v === 'play' || v === 'auto';
  if (kind === 'trAction') return v === 'prev' || v === 'playpause' || v === 'next';
  return false;
}

// Чистая проверка команды: новый объект только с разрешёнными полями или null.
// Лишние поля отбрасываются, отсутствующие обязательные — отказ.
function validate(obj) {
  if (!isPlainObject(obj)) return null;
  const c = obj.c;
  if (typeof c !== 'string' || !Object.prototype.hasOwnProperty.call(COMMANDS, c)) return null;
  const out = { c };
  for (const field of Object.keys(COMMANDS[c])) {
    const kind = COMMANDS[c][field];
    const v = obj[field];
    if (!validField(kind, v)) return null;
    out[field] = kind === 'query' ? v.trim() : v;
  }
  return out;
}

function create(ctx) {
  const {
    ipcMain, getMainWindow: getMainWindowRaw, showMainWindow: showMainWindowRaw,
    localGuard: localGuardRaw, log: logRaw, fs, path, srcDir: srcDirRaw, senderOk: senderOkRaw, getPort: getPortRaw, openUrl
  } = ctx;
  const getMainWindow = typeof getMainWindowRaw === 'function' ? getMainWindowRaw : () => null;
  const showMainWindow = typeof showMainWindowRaw === 'function' ? showMainWindowRaw : () => {};
  const localGuard = localGuardRaw || {};
  const log = typeof logRaw === 'function' ? logRaw : () => {};
  const srcDir = srcDirRaw || '';
  const senderOk = typeof senderOkRaw === 'function' ? senderOkRaw : null;
  const getPort = typeof getPortRaw === 'function' ? getPortRaw : null;

  let state = null;              // последний снимок окна
  let seenPort = 0;              // порт из последнего запроса к странице
  const sse = new Set();         // ответы EventSource
  const mods = new Map();        // id → { want, fns: Set }
  let lastViewers = 0;

  function mainWindow() {
    const w = getMainWindow();
    return w && (!w.isDestroyed || !w.isDestroyed()) ? w : null;
  }

  function sendWindow(channel, payload) {
    try {
      const w = mainWindow();
      if (w && w.webContents && typeof w.webContents.send === 'function') w.webContents.send(channel, payload);
    } catch (e) { /* окно закрывается — рассылать некуда */ }
  }

  function viewers() {
    let n = sse.size;
    for (const m of mods.values()) if (m.want) n++;
    return n;
  }

  // Число зрителей поменялось — говорим окну: пока ноль, оно ничего не собирает.
  function notifyViewers() {
    const n = viewers();
    if (n === lastViewers) return;
    lastViewers = n;
    sendWindow('dock2-clients', n);
  }

  function broadcast(msg) {
    const payload = 'data: ' + JSON.stringify(msg) + '\n\n';
    let dropped = false;
    for (const res of sse) {
      // A38 M4: зритель не читает (OBS скрыл источник) — не копим снимки в памяти, отключаем; он переподключится сам
      if (res.writableLength > SSE_MAX_BUF) { try { res.destroy(); } catch (e) { /* уже закрыт */ } sse.delete(res); dropped = true; continue; }
      try { res.write(payload); } catch (e) { sse.delete(res); dropped = true; }
    }
    for (const m of mods.values()) {
      for (const fn of m.fns) {
        try { fn(msg); } catch (e) { /* подписчик сломался — остальные не страдают */ }
      }
    }
    if (dropped) notifyViewers();
  }

  // Строка журнала — только вид действия; from — имя модуля (без ников и названий).
  function logCommand(cmd, from) {
    const who = String(from == null ? '' : from).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    log('док2: ' + cmd.c + (who ? ' (' + who + ')' : ''));
  }

  function command(obj, from) {
    const cmd = validate(obj);
    if (!cmd) return { ok: false, error: 'bad-command' };
    logCommand(cmd, from);
    if (cmd.c === 'focus') {
      try { showMainWindow(); } catch (e) { /* окна нет — нечего показывать */ }
      return { ok: true };
    }
    sendWindow('dock2-cmd', cmd);
    return { ok: true };
  }

  function url(port) {
    const p = Number(port) || 0;
    return p ? 'http://127.0.0.1:' + p + '/dock2' : '';
  }

  function currentPort() {
    if (getPort) {
      try {
        const p = Number(getPort()) || 0;
        if (p) return p;
      } catch (e) { /* сервер ещё не поднят */ }
    }
    return seenPort;
  }

  function modRequestOk(req, port) {
    if (typeof localGuard.modRequestOk !== 'function') return true;
    return !!localGuard.modRequestOk((req && req.headers) || {}, port);
  }

  function pageCsp(port) {
    return typeof localGuard.widgetFrameCsp === 'function' ? localGuard.widgetFrameCsp(port) : '';
  }

  // Тело команды: только JSON-объект, не больше 4 КБ. null — отказ (400).
  function readCommand(req, limit) {
    return new Promise((resolve) => {
      let size = 0, over = false, done = false;
      const chunks = [];
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      req.on('data', (chunk) => {
        if (done) return;
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
        size += b.length;
        if (size > limit) { over = true; chunks.length = 0; return; }
        chunks.push(b);
      });
      req.on('end', () => {
        if (over) return finish(null);
        let obj;
        try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return finish(null); }
        finish(isPlainObject(obj) ? obj : null);
      });
      req.on('error', () => finish(null));
      req.on('aborted', () => finish(null));
    });
  }

  async function handle(req, res, p, port) {
    const pathName = String(p || '');
    if (pathName !== '/dock2' && pathName !== '/dock2/' && !pathName.startsWith('/dock2/')) return false;
    const nPort = Number(port) || 0;
    if (nPort) seenPort = nPort;
    const method = String((req && req.method) || 'GET').toUpperCase();

    if (pathName === '/dock2' || pathName === '/dock2/') {
      if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405); res.end(); return true; }
      fs.readFile(path.join(srcDir, 'dock2.html'), (err, data) => {
        if (err) { res.writeHead(500); res.end('dock2 not found'); return; }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': pageCsp(nPort),
          'X-Frame-Options': 'SAMEORIGIN'
        });
        res.end(data);
      });
      return true;
    }

    if (pathName === '/dock2/state') {
      if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405); res.end(); return true; }
      // Чужая страница в браузере не должна читать состояние очереди (M6).
      if (!modRequestOk(req, nPort)) { res.writeHead(403); res.end('forbidden'); return true; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(state || {}));
      return true;
    }

    if (pathName === '/dock2/events') {
      if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405); res.end(); return true; }
      if (!modRequestOk(req, nPort)) { res.writeHead(403); res.end('forbidden'); return true; }
      if (sse.size >= SSE_MAX) { res.writeHead(503); res.end('busy'); return true; }   // A38 M4: не больше SSE_MAX панелей сразу
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      });
      res.write('retry: 2000\n\n');
      res.write('data: ' + JSON.stringify(state || {}) + '\n\n');
      sse.add(res);
      notifyViewers();
      const hb = setInterval(() => {
        try { res.write('data: {"hb":1}\n\n'); } catch (e) { clearInterval(hb); sse.delete(res); notifyViewers(); }
      }, 4000);
      req.on('close', () => { clearInterval(hb); sse.delete(res); notifyViewers(); });
      return true;
    }

    if (pathName === '/dock2/cmd') {
      if (method !== 'POST') { res.writeHead(405); res.end(); return true; }
      const body = await readCommand(req, 4096);
      const cmd = body && validate(body);
      if (!cmd) { res.writeHead(400); res.end(); return true; }
      command(cmd, '');
      res.writeHead(204); res.end();
      return true;
    }

    return false;
  }

  function forModule(id) {
    const key = String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'module';
    let m = mods.get(key);
    if (!m) { m = { want: false, fns: new Set() }; mods.set(key, m); }
    return {
      // fn получает и снимки, и события; при подписке сразу отдаём последний снимок.
      on(fn) {
        if (typeof fn !== 'function') return () => {};
        m.fns.add(fn);
        if (state) { try { fn(state); } catch (e) {} }
        return () => { m.fns.delete(fn); };
      },
      want(on) {
        const w = !!on;
        if (m.want === w) return;
        m.want = w;
        notifyViewers();
      },
      cmd(obj) { return command(obj, key); },
      get() { return state; }
    };
  }

  // ── IPC окна и настроек ────────────────────────────────────────────────────
  if (ipcMain && typeof ipcMain.on === 'function') {
    ipcMain.on('dock2-state', (ev, st) => {
      if (senderOk && !senderOk(ev, 'dock2-state')) return;
      if (!isPlainObject(st) || st.v !== 1) return;
      state = st;
      broadcast(st);
    });
    ipcMain.on('dock2-event', (ev, msg) => {
      if (senderOk && !senderOk(ev, 'dock2-event')) return;
      if (!isPlainObject(msg) || !EVENTS.has(msg.ev)) return;
      broadcast(msg);
    });
  }
  if (ipcMain && typeof ipcMain.handle === 'function') {
    ipcMain.handle('dock2-url', () => url(currentPort()));
    // A38 H1: окно после перезагрузки (сторож) или если OBS/модуль подключились раньше него — спрашивает
    // текущее число зрителей само, а не ждёт события «изменилось» (оно уже было и не повторится).
    ipcMain.handle('dock2-viewers', () => viewers());
    // A38 M2: «Открыть» в настройках — только свой адрес пульта (общий openExternal пропускает лишь https)
    ipcMain.handle('dock2-open', () => {
      const u = url(currentPort());
      if (!u || typeof openUrl !== 'function') return false;
      try { openUrl(u); return true; } catch (e) { return false; }
    });
  }

  return {
    handle,
    url,
    viewers,
    validate,
    command,
    forModule,
    state: () => state
  };
}

module.exports = { create, validate, COMMANDS, EVENTS };
