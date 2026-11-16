// Локальный сервер Тапёра: страница окна, панель OBS (/widget*), порт /sb/*, файлы с компьютера.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const {
    http, fs, path, dialog, log, crypto, library, localGuard, serverErrors, uiBuild, sbotPort, perf, uiToast,
    LOCAL_KEY, MIME, extBadgeSvg, cookieKey, lcoverCache, lcoverSmall, LCOVER_MAX,
    getMainWindow, showMainWindow, getSbotHandle, getAppUrl, setAppUrl,
    readSettingsFile, writeSettingsFile, srcDir, dock2Hub
  } = ctx;

  async function serveLocal(req, res, p) {
    const bad = (code) => { res.writeHead(code); res.end(); };
    if (cookieKey(req) !== LOCAL_KEY) return bad(403);
    const id = p.split('/')[2] || '';
    if (p.startsWith('/lcover/')) {
      let c = lcoverCache.get(id);
      if (!c) {
        c = await library.cover(id).catch(() => null);
        if (!c) {
          const f = library.pathOf(id); if (!f) return bad(404);
          res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'max-age=3600' }); res.end(extBadgeSvg(f)); return;
        }
        c = lcoverSmall(c);
        lcoverCache.set(id, c);
        if (lcoverCache.size > LCOVER_MAX) lcoverCache.delete(lcoverCache.keys().next().value);
      }
      res.writeHead(200, { 'Content-Type': c.mime, 'Cache-Control': 'max-age=3600' }); res.end(c.data); return;
    }
    const file = library.pathOf(id);
    if (!file) return bad(404);
    let st; try { st = fs.statSync(file); } catch (e) { return bad(404); }
    const type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      let a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : st.size - 1;
      if (!m[1] && m[2]) { a = Math.max(0, st.size - +m[2]); b = st.size - 1; }
      if (a >= st.size || b < a) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); res.end(); return; }
      b = Math.min(b, st.size - 1);
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': 'bytes ' + a + '-' + b + '/' + st.size, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file, { start: a, end: b }).on('error', () => res.destroy()).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }
  }

  // ── Виджет для OBS ──────────────────────────────────────────────────────────
  // Отдельная страница /widget, которую OBS берёт источником «Браузер».
  // Приложение присылает ей состояние по SSE, а она возвращает команды плееру.
  const widgetClients = new Set();
  const widgetStateFns = new Set();   // подписчики моста модулей (remote-bridge)
  let widgetExtra = 0;                // зрители-модули: прибавка к widgetClients.size
  let widgetState = { orders: [], np: { title: '', artist: '', playing: false }, reqAuto: false, scale: 100, theme: null };
  let serverPort = 0;
  let httpServerRef = null;
  let restartingServer = false, portToastShown = false;
  function notifyPortChanged(actual, requested) {
    if (portToastShown || !actual || !requested || actual === requested) return;
    portToastShown = true;
    const msg = 'Порт ' + requested + ' занят — адрес для OBS изменился: http://127.0.0.1:' + actual + '/overlay/playlist';
    log(msg);
    uiToast(msg);
  }
  let dockGuard = null;
  // Страницы модулей на этом же сервере (оверлей-плейлист для OBS): префикс → обработчик модуля (src/modhost.js).
  // Только чтение: GET/HEAD, команд плееру через них нет.
  const modMounts = new Map();

  // Сколько панелей OBS сейчас открыто — окно шлёт им состояние, только если есть кому (экономия процессора)
  function widgetCount() {
    const n = widgetClients.size + widgetExtra;
    perf.overlayNow = n;
    perf.overlayPeak = Math.max(perf.overlayPeak, n);
    try { if (getMainWindow() && !getMainWindow().isDestroyed()) getMainWindow().webContents.send('widget-clients', n); } catch (e) {}
  }
  function widgetBroadcast() {
    const payload = 'data: ' + JSON.stringify(widgetState) + '\n\n';
    for (const res of widgetClients) {
      try { res.write(payload); } catch (e) { widgetClients.delete(res); }
    }
    for (const fn of widgetStateFns) {
      try { fn(widgetState); } catch (e) { /* подписчик сломался — остальные не страдают */ }
    }
  }
  // Отдать мосту модулей последние состояния ленты (remote-bridge → core.remote.feed.on).
  function onWidgetState(fn) {
    if (typeof fn !== 'function') return () => {};
    widgetStateFns.add(fn);
    return () => { widgetStateFns.delete(fn); };
  }
  // Модуль стал зрителем первой панели: окно собирает ленту, как при открытой /widget.
  function setWidgetExtra(n) {
    widgetExtra = Math.max(0, Number(n) || 0);
    widgetCount();
  }
  // Короткая общая отправка окну: и маршруты /widget/*, и мост модулей шлют одинаково.
  function widgetSend(channel, payload) {
    if (getMainWindow() && !getMainWindow().isDestroyed()) getMainWindow().webContents.send(channel, payload);
  }
  // Настройка из панели (тумблер «Точные»): белый список — localGuard.settingOk.
  function widgetSetting(key, value) {
    if (!localGuard.settingOk(key)) return false;
    const s = readSettingsFile();
    s[key] = value;
    writeSettingsFile(s);
    widgetSend('widget-setting', { key, value });
    return true;
  }

  // ── «Видео для OBS» (VO1) ───────────────────────────────────────────────────
  // Отдельная страница /video: картинка YouTube поверх стрима. Состояние собирает окно
  // и присылает каналом video-state; страница получает его по SSE. Превью в настройках
  // (?preview=1) тоже подключается к потоку, но зрителем OBS не считается.
  const videoClients = new Set();   // { res, preview }
  let videoState = {
    kind: 'none', url: '', ytId: '', cover: '', t: 0, at: 0, playing: false, rate: 1,
    look: { border: false, color: '', width: 4, hideAudio: true }
  };
  function videoRealCount() {
    let n = 0;
    for (const c of videoClients) if (!c.preview) n++;
    return n;
  }
  function videoCount() {
    const n = videoRealCount();
    try { if (getMainWindow() && !getMainWindow().isDestroyed()) getMainWindow().webContents.send('video-clients', n); } catch (e) {}
  }
  function videoBroadcast() {
    const payload = 'data: ' + JSON.stringify(videoState) + '\n\n';
    for (const c of videoClients) {
      try { c.res.write(payload); } catch (e) { videoClients.delete(c); }
    }
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 200000) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }

  // Крошечный локальный веб-сервер — отдаёт страницу приложения по http,
  // чтобы встроенный плеер YouTube работал (из file:// он не запускается).
  // Свободен ли порт: если занят, вернём 0 (система даст любой свободный)
  function pickPort(preferred) {
    return new Promise((resolve) => {
      if (!preferred) return resolve(0);
      const probe = http.createServer();
      probe.once('error', () => resolve(0));
      probe.listen(preferred, '127.0.0.1', () => probe.close(() => resolve(preferred)));
    });
  }

  // Ответ порта /sb/*: всегда JSON. Порт создаётся после запуска сервера, поэтому в первые
  // мгновения честно отвечаем 503 «starting» — без данных и без обхода ключа (A35-14).
  function sbotRespond(req, res) {
    const send = (code, body) => {
      try {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body || {}));
      } catch (e) { /* клиент уже закрыл соединение */ }
    };
    if (!getSbotHandle()) {
      const r = sbotPort.startingReply();
      send(r.code, r.body);
      return;
    }
    Promise.resolve()
      .then(() => getSbotHandle().handle({ method: req.method, url: req.url, headers: req.headers }))
      .then((r) => send((r && r.code) || 200, (r && r.body) || { status: 'error' }))
      .catch((e) => { try { log('Streamer.bot: ' + (e && e.message || e)); } catch (x) {} send(200, { status: 'error', reply: '' }); });
  }

  function startServer(preferredPort) {
    const root = srcDir;
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
    const server = http.createServer(async (req, res) => {
      let p;
      try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
      if (p === '/') p = '/index.html';
      // Только наш адрес: чужие сайты не должны дотягиваться до сервера через подмену имени
      if (!localGuard.hostOk(req.headers, serverPort)) { res.writeHead(403); res.end('forbidden'); return; }
      // Команды панели OBS — только POST со страницы самого Тапёра
      if (localGuard.isWidgetCommand(p) && !localGuard.commandOk(req.method, req.headers, serverPort)) {
        log('панель: отклонён запрос ' + req.method + ' ' + p + ' (не со страницы Тапёра)');
        res.writeHead(403); res.end('forbidden'); return;
      }

      // Streamer.bot: GET /sb/* — свой порт, свой ключ, Origin запрещён (0.35, Э1).
      // Только этот префикс: общую проверку Origin не ставим, иначе сломаются страницы модулей.
      if (p.startsWith('/sb/')) { sbotRespond(req, res); return; }

      // Страницы модулей (оверлей для OBS)
      for (const [pre, fn] of modMounts) {
        if (p !== pre && !p.startsWith(pre + '/')) continue;
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
        if (!localGuard.modRequestOk(req.headers, serverPort)) { // M6: чужой сайт не займёт поток оверлея
          if (!global.__modDenyLogged || Date.now() - global.__modDenyLogged > 60000) { global.__modDenyLogged = Date.now(); log('модули: отклонён запрос к ' + p + ' с чужой страницы (' + String(req.headers.origin || req.headers['sec-fetch-site'] || '?').slice(0, 60) + ')'); }
          res.writeHead(403); res.end('forbidden'); return;
        }
        let q; try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams; } catch (e) { q = new URLSearchParams(); }
        // TAP-15: страницы модулей живут на адресе приложения — строгий CSP, чтобы случайная вставка
        // текста в страницу не стала кодом. Ставит ядро, а не модуль: защита не зависит от версии пака.
        res.setHeader('Content-Security-Policy', localGuard.modPageCsp(serverPort));
        // B7b (P5c №5): не даём чужому сайту встроить страницу модуля (от превью оверлея
        // с localhost заголовок не ставим — см. localGuard.frameOptionsFor).
        const xfo = localGuard.frameOptionsFor(req.headers.host);
        if (xfo) res.setHeader('X-Frame-Options', xfo);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try { fn(req, res, p.slice(pre.length) || '/', q); } catch (e) { log('модули: страница ' + pre + ' — ' + e.message); try { res.writeHead(500); res.end(); } catch (x) {} }
        return;
      }

      // «Видео для OBS»: страница и поток состояния
      if (p === '/video' || p === '/video/') {
        fs.readFile(path.join(root, 'video-overlay.html'), (err, data) => {
          if (err) { res.writeHead(500); res.end('video not found'); return; }
          const hd = {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': localGuard.videoPageCsp(serverPort),
            'X-Content-Type-Options': 'nosniff'
          };
          const xfo = localGuard.frameOptionsFor(req.headers.host);
          if (xfo) hd['X-Frame-Options'] = xfo;   // превью с localhost в окне на 127.0.0.1 не ломаем
          res.writeHead(200, hd);
          res.end(data);
        });
        return;
      }
      if (p === '/video/events') {
        // Чужая страница в браузере не должна слушать состояние видео (M6).
        if (!localGuard.modRequestOk(req.headers, serverPort)) { res.writeHead(403); res.end('forbidden'); return; }
        let preview = false;
        try { preview = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('preview') === '1'; } catch (e) {}
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive'
        });
        res.write('retry: 2000\n\n');
        res.write('data: ' + JSON.stringify(videoState) + '\n\n');
        const client = { res, preview };
        videoClients.add(client); videoCount();
        const hb = setInterval(() => {
          try { res.write('data: {"hb":1}\n\n'); } catch (e) { clearInterval(hb); videoClients.delete(client); videoCount(); }
        }, 4000);
        req.on('close', () => { clearInterval(hb); videoClients.delete(client); videoCount(); });
        return;
      }

      // Вторая док-панель OBS: страница, снимок, поток событий и команды (DOCK2)
      if (dock2Hub && (p === '/dock2' || p.startsWith('/dock2/'))) {
        if (await dock2Hub.handle(req, res, p, serverPort)) return;
      }

      // Виджет OBS: страница, поток состояния и команды плееру
      if (p === '/widget' || p === '/widget/') {
        fs.readFile(path.join(root, 'widget.html'), (err, data) => {
          if (err) { res.writeHead(500); res.end('widget not found'); return; }
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            // B7b (P5c №5): панель OBS открывается отдельной страницей, во фрейм чужого сайта не идёт.
            'Content-Security-Policy': localGuard.widgetFrameCsp(serverPort),
            'X-Frame-Options': 'SAMEORIGIN'
          });
          res.end(data);
        });
        return;
      }
      // /app.css — обычный файл src/app.css (раньше вырезался из <style> index.html на каждый запрос)
      // Скрипт окна: части src/ui/*.js склеиваются в один ui.js (см. src/ui-build.js)
      if (p === '/ui.js') {
        try {
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(uiBuild.buildUiCached(root));
        } catch (e) { log('ui.js: ошибка сборки ' + e.message); res.writeHead(500); res.end('/* ' + String(e.message).replace(/\*\//g, '') + ' */'); }
        return;
      }
      if (p === '/widget/rq' && req.method === 'POST') {
        try {
          const body = await readBody(req);
          // раньше писали тело целиком (до 200 КБ) — в лог идёт только тип действия
          log('док: клик ' + String((body && (body.action || (body.dataset && body.dataset.rq))) || 'без действия').slice(0, 60));
          if (body && body.focus) {
            // Кнопка, которая открывает окно приложения (поиск, настройки): показываем его поверх всех
            dockGuard = null;
            if (typeof showMainWindow === 'function') showMainWindow();
          } else if (getMainWindow() && !getMainWindow().isDestroyed()) {
            // Остальные действия (в очередь, пауза) не должны поднимать окно плеера
            dockGuard = { focused: getMainWindow().isFocused(), minimized: getMainWindow().isMinimized(), at: Date.now() };
            setTimeout(() => {
              if (!dockGuard || Date.now() - dockGuard.at > 2500 || !getMainWindow() || getMainWindow().isDestroyed()) return;
              if (dockGuard.minimized && !getMainWindow().isMinimized()) getMainWindow().minimize();
              else if (!dockGuard.focused && getMainWindow().isFocused()) getMainWindow().blur();
              dockGuard = null;
            }, 900);
          }
          widgetSend('widget-rq', body || {});
        } catch (e) {
          log('док: клик ' + e.message);
        }
        res.writeHead(204); res.end();
        return;
      }
      if (p === '/widget/state') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(widgetState));
        return;
      }
      if (p === '/widget/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive'
        });
        res.write('retry: 2000\n\n');
        res.write('data: ' + JSON.stringify(widgetState) + '\n\n');
        widgetClients.add(res); widgetCount();
        // Каждые 4 секунды — короткий сигнал «жив», чтобы док видел, что связь есть
        const hb = setInterval(() => {
          try { res.write('data: {"hb":1}\n\n'); } catch (e) { clearInterval(hb); widgetClients.delete(res); }
        }, 4000);
        req.on('close', () => { clearInterval(hb); widgetClients.delete(res); widgetCount(); });
        return;
      }
      if (p.startsWith('/widget/cmd/')) {
        const action = p.slice('/widget/cmd/'.length);
        // Поиск из панели: показываем окно плеера поверх и ставим курсор в строку поиска
        if (action === 'search' && typeof showMainWindow === 'function') showMainWindow();
        if (getMainWindow() && !getMainWindow().isDestroyed()) getMainWindow().webContents.send('widget-cmd', action);
        res.writeHead(204); res.end();
        return;
      }
      if (p === '/widget/setting' && req.method === 'POST') {
        try {
          const body = await readBody(req);
          widgetSetting(body && body.key, body && body.value);
        } catch (e) {
          log('виджет: настройки ' + e.message);
        }
        res.writeHead(204); res.end();
        return;
      }

      // Страница встроенного плеера YouTube (P5c №1): отдельный origin (localhost), без моста
      // окна. Встраивать её разрешено только окну Тапёра — точный frame-ancestors заголовком:
      // в <meta> эта директива игнорируется браузером.
      if (p === '/ytplayer.html') {
        fs.readFile(path.join(root, 'ytplayer.html'), (err, data) => {
          if (err) { res.writeHead(404); res.end('not found'); return; }
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': localGuard.ytPlayerCsp(serverPort),
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store'
          });
          res.end(data);
        });
        return;
      }

      // Свои файлы с компьютера: только из списка Тапёра и только для окна Тапёра (метка в cookie)
      if (p.startsWith('/lfile/') || p.startsWith('/lcover/')) { serveLocal(req, res, p); return; }
      const file = path.normalize(path.join(root, p));
      // Только файлы страницы: .json закрыт целиком, выход из папки — с разделителем (localguard.fileOk)
      if (!localGuard.fileOk(root, file)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const hd = { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' };
        // Локальная отдача без кэша: иначе после обновления Chromium может показать старую страницу
        if (/\.(html|js|css)$/i.test(path.extname(file))) hd['Cache-Control'] = 'no-store';
        if (p === '/index.html') { const ck = localGuard.sessionCookie(LOCAL_KEY); if (ck.length) hd['Set-Cookie'] = ck; }
        res.writeHead(200, hd);
        res.end(data);
      });
    });
    httpServerRef = server;
    return pickPort(preferredPort).then((port) => new Promise((resolve) => {
      let retried = false;
      let listening = false; // успешный listen: дальше ошибки сервера только пишем в журнал (R5)
      const listen = (p) => {
        server.listen(p, '127.0.0.1', () => {
          listening = true;
          serverPort = server.address().port;
          localGuard.setOwn({ port: serverPort });
          log('сервер на порту ' + serverPort + (preferredPort && serverPort !== preferredPort ? ' (запрошен ' + preferredPort + ', занят)' : ''));
          if (preferredPort && serverPort !== preferredPort) notifyPortChanged(serverPort, preferredPort);
          resolve(serverPort);
        });
      };
      server.on('error', (e) => {
        log('сервер: ' + (e && e.message || e));
        // R5: повтор и окно — только пока сервер не начал слушать. Поздняя ошибка
        // не должна закрывать рабочий сервер и менять адрес панели OBS.
        const action = serverErrors.errorAction({ listening, retried });
        if (action === 'log') return;
        try { server.close(); } catch (x) {}
        if (action === 'retry') {
          retried = true;
          log('сервер: повтор на свободном порту');
          setTimeout(() => listen(0), 50);
          return;
        }
        const msg = 'Не удалось запустить локальный сервер Тапёра: ' + (e && e.message || e);
        log(msg);
        try { dialog.showErrorBox('Локальный сервер не запущен', msg + '\n\nПанель OBS и оверлей будут недоступны.'); } catch (x) {}
        resolve(0);
      });
      listen(port);
    }));
  }

    // Перезапуск локального сервера на другом порту (нужно только для смены адреса панели)
    async function restart(port) {
      if (restartingServer) return serverPort;
      restartingServer = true;
      try {
        try { if (httpServerRef) httpServerRef.close(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 250));
        const actual = await startServer(port);
        serverPort = actual;
        setAppUrl('http://127.0.0.1:' + actual + '/index.html');
        if (getMainWindow() && !getMainWindow().isDestroyed()) getMainWindow().loadURL(getAppUrl());
        return actual;
      } catch (e) {
        log('сервер: перезапуск не удался — ' + (e && e.message || e));
        return serverPort;
      } finally { restartingServer = false; }
    }
  return {
    start: startServer,
    restart,
    getPort: () => serverPort,
    setWidgetState: (st) => { widgetState = st; },
    widgetState: () => widgetState,
    onWidgetState,
    setWidgetExtra,
    widgetSend,
    widgetSetting,
    widgetBroadcast,
    widgetCount,
    setVideoState: (st) => { videoState = st; },
    videoState: () => videoState,
    videoBroadcast,
    videoClients: videoRealCount,
    mount: (pre, fn) => { modMounts.set(pre, fn); },
    unmount: (pre) => { modMounts.delete(pre); },
    pageUrl: (p) => (serverPort ? 'http://127.0.0.1:' + serverPort + p : ''),
    originUrl: () => 'http://127.0.0.1:' + serverPort
  };
}
