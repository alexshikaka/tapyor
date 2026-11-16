// Локальный media-proxy: браузер играет с 127.0.0.1, а поток идёт
// на googlevideo через явно выбранное семейство IPv4/IPv6.
//
// Зачем: Chromium может выбрать IPv6, который у провайдера/в VPN сбрасывается,
// и ждать media-таймаут 30–40 секунд. Здесь маршрут проверяется быстро и явно.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { userAgent } = require('./user-agent');

const UA = userAgent();
const PROBE_TIMEOUT = 3000;
const ROUTE_TTL = 5 * 60 * 1000;
const TOKEN_TTL = 4 * 60 * 60 * 1000;

// Куда вообще можно ходить. Токен случайный и снаружи не угадать, но без списка целей
// прокси остаётся заготовкой под SSRF: любая будущая точка, куда попадёт чужой URL,
// превратит его в способ дотянуться до соседей по сети или до localhost.
const DEFAULT_HOSTS = [/(^|\.)googlevideo\.com$/i, /(^|\.)youtube\.com$/i, /(^|\.)ytimg\.com$/i];
// Частные и служебные адреса — отдельный запрет: даже если хост в списке, он не должен
// резолвиться в домашнюю сеть. Проверяем по имени; полноценная защита — ещё и после DNS.
const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd])/i;

function createMediaProxy(log, opts) {
  // allowHosts нужен юнит-тестам: они поднимают свой сервер на 127.0.0.1.
  // В приложении options не передаются, значит работает список по умолчанию.
  const allowHosts = (opts && opts.allowHosts) || DEFAULT_HOSTS;
  const allowPrivate = !!(opts && opts.allowPrivate);
  // Имитация сбоев сети (0.34.0): проверка на входе в прокси — за секунды до https.request.
  const fault = (opts && opts.fault) || null;
  function hostAllowed(url) {
    let h = '';
    try { h = new URL(url).hostname; } catch (e) { return false; }
    if (!allowPrivate && PRIVATE_HOST.test(h)) return false;
    return allowHosts.some((re) => re.test(h));
  }
  const say = (m) => { try { if (typeof log === 'function') log('media-proxy: ' + m); } catch (e) {} };
  const routes = new Map(); // host -> {family, at}
  const tokens = new Map(); // token -> {url, family, at}
  let server = null;
  let starting = null;
  let port = 0;
  let cleaner = null;

  function requestOnce(url, family, timeoutMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let done = false;
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      let timer = null;
      let req = null;
      function finish(r) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        try { if (req) req.destroy(); } catch (e) {}
        resolve(Object.assign({ family, ms: Date.now() - t0 }, r));
      }
      try {
        req = mod.request(u, {
          method: 'GET',
          family,
          headers: { 'User-Agent': UA, Range: 'bytes=0-0', 'Accept-Encoding': 'identity' }
        }, (res) => {
          const status = res.statusCode || 0;
          res.resume();
          finish({ ok: status >= 200 && status < 400, status });
        });
        req.on('error', (e) => finish({ ok: false, error: e.code || e.message || 'error' }));
        timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
        req.end();
      } catch (e) {
        finish({ ok: false, error: e.code || e.message || 'error' });
      }
    });
  }

  async function chooseFamily(url) {
    let host = '';
    try { host = new URL(url).host; } catch (e) { return { error: 'плохой URL' }; }
    const c = routes.get(host);
    if (c && Date.now() - c.at < ROUTE_TTL) return { family: c.family, cached: true };
    const [v4, v6] = await Promise.all([
      requestOnce(url, 4, PROBE_TIMEOUT),
      requestOnce(url, 6, PROBE_TIMEOUT)
    ]);
    const family = v4.ok ? 4 : (v6.ok ? 6 : 0);
    say('probe ' + host + ' v4=' + (v4.ok ? (v4.status || 'ok') : (v4.error || 'fail')) + ' (' + v4.ms + 'ms)' + ' v6=' + (v6.ok ? (v6.status || 'ok') : (v6.error || 'fail')) + ' (' + v6.ms + 'ms)' + ' -> ' + (family ? 'IPv' + family : 'нет'));
    if (!family) return { error: 'нет рабочего маршрута (v4: ' + (v4.error || v4.status || 'fail') + ', v6: ' + (v6.error || v6.status || 'fail') + ')' };
    routes.set(host, { family, at: Date.now() });
    return { family };
  }

  function start() {
    if (server) return Promise.resolve(port);
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        // Только наш адрес: защита от подмены имени (DNS rebinding), как в src/localguard.js
        const host = String(req.headers.host || '').toLowerCase();
        if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) { res.writeHead(403); res.end('forbidden'); return; }
        const m = /^\/s\/([a-f0-9]{32})$/.exec((req.url || '').split('?')[0]);
        if (!m) { res.writeHead(404); res.end('not found'); return; }
        const item = tokens.get(m[1]);
        if (!item || Date.now() - item.at > TOKEN_TTL) { res.writeHead(404); res.end('expired'); return; }
        proxyTo(item.url, item.family, req, res, 0);
      });
      server.on('error', (e) => { say('server error: ' + e.message); });
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        say('слушает 127.0.0.1:' + port);
        resolve(port);
      });
      cleaner = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of tokens) if (now - v.at > TOKEN_TTL) tokens.delete(k);
        for (const [k, v] of routes) if (now - v.at > ROUTE_TTL) routes.delete(k);
      }, 60000);
      if (cleaner.unref) cleaner.unref();
    }).catch((e) => { starting = null; server = null; throw e; });
    return starting;
  }

  // Своему окну отвечаем его же origin, чужому — ничего: без заголовка браузер не отдаст
  // ответ странице, даже если она как-то узнает токен.
  function ownOrigin(req) {
    const o = String((req && req.headers && req.headers.origin) || '');
    return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o) ? o : '';   // '' — заголовка нет: «null» пустил бы песочницы
  }

  function proxyTo(target, family, clientReq, clientRes, redirects) {
    let u;
    try { u = new URL(target); } catch (e) { clientRes.writeHead(400); clientRes.end('bad url'); return; }
    // Имитация: уже выданный поток тоже не отдаём, если сервис «сломан» (кроме «медленно»:
    // задержку делает localize, а поток должен продолжиться).
    const faultMode = fault ? fault.modeForUrl(target) : null;
    if (faultMode && faultMode !== 'slow') {
      try { clientRes.writeHead(faultMode === 'auth' ? 401 : 503); clientRes.end('simulated'); } catch (e) {}
      return;
    }
    const mod = u.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': clientReq.headers['user-agent'] || UA,
      'Accept-Encoding': 'identity',
      'Referer': 'https://www.youtube.com/',
      'Origin': 'https://www.youtube.com'
    };
    for (const h of ['range', 'if-range', 'accept']) {
      if (clientReq.headers[h]) headers[h] = clientReq.headers[h];
    }
    let upstream = null;
    let ended = false;
    const done = () => { if (ended) return; ended = true; try { if (upstream) upstream.destroy(); } catch (e) {} };
    clientRes.on('close', done);
    try {
      upstream = mod.request(u, { method: 'GET', family, headers }, (up) => {
        const st = up.statusCode || 0;
        const loc = up.headers.location;
        if (st >= 300 && st < 400 && loc && redirects < 3) {
          up.resume();
          let next = '';
          try { next = new URL(loc, target).toString(); } catch (e) {}
          // перенаправление проверяем тем же списком: иначе googlevideo мог бы увести прокси в домашнюю сеть
          if (!next || !hostAllowed(next)) { say('перенаправление не из списка разрешённых — остановил'); clientRes.writeHead(502); clientRes.end('redirect blocked'); return; }
          proxyTo(next, family, clientReq, clientRes, redirects + 1);
          return;
        }
        const out = {
          'Content-Type': up.headers['content-type'] || 'application/octet-stream',
          'Accept-Ranges': up.headers['accept-ranges'] || 'bytes',
          'Cache-Control': 'no-store',
          // раньше было '*' — отдаём только своему окну, а не любому сайту
        };
        const ao = ownOrigin(clientReq); if (ao) out['Access-Control-Allow-Origin'] = ao;
        for (const h of ['content-length', 'content-range']) if (up.headers[h]) out[h] = up.headers[h];
        try { clientRes.writeHead(st, out); } catch (e) { done(); return; }
        up.on('error', done);
        up.pipe(clientRes);
        up.on('end', () => { try { clientRes.end(); } catch (e) {} });
      });
      upstream.on('error', (e) => {
        say('upstream error: ' + (e.code || e.message || 'error'));
        done();
        if (!clientRes.headersSent) { try { clientRes.writeHead(502); clientRes.end('upstream error'); } catch (e) {} }
      });
      upstream.end();
    } catch (e) {
      done();
      if (!clientRes.headersSent) { try { clientRes.writeHead(502); clientRes.end('upstream error'); } catch (e2) {} }
    }
  }

  async function localize(url) {
    if (!hostAllowed(url)) {
      say('адрес не из списка разрешённых, проксировать не буду');
      return { error: 'адрес не разрешён' };
    }
    // Имитация сбоя YouTube: 503/401/нет сети — сразу ошибка, «медленно» — задержка 8 с.
    if (fault) {
      const mode = fault.modeForUrl(url);
      if (mode) {
        try { await fault.applyCall('yt', () => {}, { url: url }); }
        catch (e) { say('имитация сбоя — поток не готовлю'); return { error: e && e.message ? e.message : String(e) }; }
      }
    }
    const r = await chooseFamily(url);
    if (!r || r.error) return { error: r.error || 'нет маршрута' };
    await start();
    const token = crypto.randomBytes(16).toString('hex');
    tokens.set(token, { url, family: r.family, at: Date.now() });
    return { url: 'http://127.0.0.1:' + port + '/s/' + token, family: r.family };
  }

  async function wrap(stream) {
    if (!stream || stream.error) return stream;
    const out = Object.assign({}, stream);
    if (stream.audioUrl) {
      const a = await localize(stream.audioUrl);
      if (a.error) return { error: 'media-proxy audio: ' + a.error };
      out.audioUrl = a.url;
      out._audioFamily = a.family;
    }
    if (stream.videoUrl) {
      const v = await localize(stream.videoUrl);
      if (v.error) {
        say('видео не проксируется (' + v.error + ') — оставляю только звук');
        delete out.videoUrl;
      } else {
        out.videoUrl = v.url;
        out._videoFamily = v.family;
      }
    }
    if (stream.url) {
      const u = await localize(stream.url);
      if (u.error) return { error: 'media-proxy: ' + u.error };
      out.url = u.url;
      out._family = u.family;
    }
    return out;
  }

  async function close() {
    if (cleaner) clearInterval(cleaner);
    cleaner = null;
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null; starting = null; port = 0; tokens.clear(); routes.clear();
  }

  return { wrap, localize, start, close, _routes: routes, _tokens: tokens };
}

module.exports = { createMediaProxy };

