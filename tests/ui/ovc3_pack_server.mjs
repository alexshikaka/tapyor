// OVC3: настоящий пак для UI-проверок вкладки «Моушн-оверлей».
// Поднимает модуль оверлея из modules/streamer-pack (не поддельный modCmd), отдаёт страницы
// пака и окно Тапёра на одном адресе (localhost:<порт>) и даёт тесту маленький пульт:
//   GET  /__test/state  — сохранённые настройки, журнал команд, что получила страница превью
//   POST /__test/cmd    — modCmd('overlay', cmd, arg), как из окна
//   POST /__test/push   — снимок плеера (что играет), как от ядра
//   POST /__test/reset  — настройки по умолчанию и чистый журнал
// Запуск: node tests/ui/ovc3_pack_server.mjs --port <порт>
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const argPort = process.argv.indexOf('--port');
const port = Number(argPort >= 0 ? process.argv[argPort + 1] : 0) || 8845;
const overlayDir = path.join(root, 'modules', 'streamer-pack', 'overlay');
if (!fs.existsSync(path.join(overlayDir, 'src', 'index.js'))) {
  console.error('Нет пака: ' + overlayDir + ' (сначала npm run modules)');
  process.exit(2);
}
const { activate } = require(path.join(overlayDir, 'src', 'index.js'));
const { normalize } = require(path.join(overlayDir, 'src', 'settings.js'));

const store = {};
const handlers = {};
let mounted = null;
const log = { cmds: [], feeds: [], shows: 0, events: 0, errors: [] };

const core = {
  settings: {
    get: (k) => store[k],
    set: (k, v) => { store[k] = v; }
  },
  player: {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return () => {}; },
    want: () => {},
    coverImage: async () => null
  },
  http: {
    mount: (prefix, mh) => { mounted = { prefix, mh }; },
    unmount: () => {},
    url: (p) => 'http://localhost:' + port + p
  },
  log: () => {}
};

const overlay = await activate(core);
store.overlay = normalize({});
overlay.cfg = normalize(store.overlay);
const now = Date.now();
overlay.snap = {
  np: { title: 'Звезда по имени Солнце', artist: 'Кино', who: 'Зритель', cover: '', pos: 12, dur: 240, playing: true, at: now },
  next: [
    { title: 'Группа крови', artist: 'Кино', who: 'Друг' },
    { title: 'Перемен', artist: 'Кино', who: '' },
    { title: 'Кукушка', artist: 'Кино', who: '' }
  ],
  after: []
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.webm': 'video/webm', '.map': 'application/json'
};

function sendJson(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 2e6) s = s.slice(0, 2e6); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
  });
}
function capture(chunk) {
  String(chunk).split(/\n\n/).forEach((block) => {
    block.split(/\n/).forEach((line) => {
      if (line.startsWith('event: show')) log.shows++;
      else if (line.startsWith('data: ')) {
        try {
          const d = JSON.parse(line.slice(6));
          if (d && d.cfg) log.feeds.push(d);
        } catch (e) { /* служебный кадр */ }
      }
    });
  });
}
function serveStatic(res, pathname) {
  let rel = pathname === '/app2' ? '/index.html' : pathname.slice('/app2'.length);
  rel = decodeURIComponent(rel);
  const file = path.normalize(path.join(root, 'src', rel));
  if (!file.startsWith(path.join(root, 'src'))) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pn = decodeURIComponent(u.pathname);
  try {
    if (pn === '/__test/status') {
      return sendJson(res, {
        installed: true, running: true, error: null, dev: false, prev: null, server: false, keyMask: '',
        manifest: { id: 'streamer-pack', version: '0.3.1', minCore: '0.32.0', modules: [{ id: 'overlay', name: 'Оверлей-плейлист' }] },
        license: { enabled: true, state: 'full' },
        modules: { overlay: { name: 'Оверлей-плейлист', running: true, error: null } }
      });
    }
    if (pn === '/__test/styles') {
      return sendJson(res, overlay.command('styles'));
    }
    if (pn === '/__test/state') {
      return sendJson(res, {
        cfg: overlay.cfg, cmds: log.cmds.slice(-80), feeds: log.feeds.slice(-80),
        shows: log.shows, clients: overlay.clients.size, motionObs: overlay.motionObs(), errors: log.errors
      });
    }
    if (pn === '/__test/cmd' && req.method === 'POST') {
      const b = await readBody(req);
      log.cmds.push({ cmd: b.cmd, arg: b.arg === undefined ? null : b.arg });
      let out;
      try { out = overlay.command(b.cmd, b.arg); }
      catch (e) { log.errors.push(String(e && e.message || e)); return sendJson(res, { error: String(e && e.message || e) }, 400); }
      return sendJson(res, out);
    }
    if (pn === '/__test/push' && req.method === 'POST') {
      const b = await readBody(req);
      overlay.snap = b;
      overlay.broadcast();
      return sendJson(res, { ok: true });
    }
    if (pn === '/__test/reset' && req.method === 'POST') {
      store.overlay = normalize({});
      overlay.cfg = normalize(store.overlay);
      log.cmds.length = 0; log.feeds.length = 0; log.shows = 0;
      overlay.broadcast();
      return sendJson(res, { ok: true, cfg: overlay.cfg });
    }
    if (pn === '/overlay' || pn.startsWith('/overlay/')) {
      const sub = pn === '/overlay' ? '/' : pn.slice('/overlay'.length);
      if (sub === '/events') {
        log.events++;
        const orig = res.write.bind(res);
        res.write = (chunk, ...rest) => { capture(chunk); return orig(chunk, ...rest); };
      }
      if (!mounted) { res.writeHead(503); res.end('not mounted'); return; }
      return mounted.mh(req, res, sub, u.searchParams);
    }
    if (pn === '/app2' || pn.startsWith('/app2/')) return serveStatic(res, pn);
    res.writeHead(404); res.end('not found');
  } catch (e) {
    log.errors.push(String(e && e.stack || e));
    try { res.writeHead(500); res.end('error'); } catch (x) {}
  }
});

server.listen(port, () => {
  console.log('READY ' + port);
});
process.on('SIGTERM', () => { try { server.close(); } catch (e) {} process.exit(0); });
process.on('SIGINT', () => { try { server.close(); } catch (e) {} process.exit(0); });
