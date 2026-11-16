// Вкладка «Браузер»: разрешения сайтов, масштаб сайтов (brZoom*), каналы br-*.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { app, webContents, ipcMain, browserZoom, brTarget, localGuard, log, cfg, settingsDisk, getMainWindow } = ctx;

  // Вкладка «Браузер»: встраиваемые сайты — только сервисы музыки и без доступа к системе
  // ── Разрешения браузера ──────────────────────────────────────────────────────
  // Electron без своего обработчика одобряет ЛЮБОЙ запрос разрешения автоматически.
  // Во вкладке «Браузер» открывается произвольный сайт, а браузерной обвязки там нет:
  // ни адресной строки, ни значка записи. То есть сайт мог молча получить микрофон,
  // и узнать об этом было бы неоткуда. Для музыки ничего из этого не нужно — отказываем.
  // Списки и правило — в src/localguard.js (там же тесты), здесь только привязка к сессии.
  function permUrl(wc) { try { return wc && wc.getURL ? wc.getURL() : ''; } catch (err) { return ''; } }
  function permAllowed(wc, permission) { return localGuard.permissionOk(permUrl(wc), permission); }
  function guardSession(ses, where) {
    try {
      ses.setPermissionRequestHandler((wc, permission, cb) => {
        const ok = permAllowed(wc, permission);
        if (!ok) log('разрешение «' + permission + '» отклонено (' + where + ', ' + (permUrl(wc) || 'адрес неизвестен').slice(0, 80) + ')');
        cb(ok);
      });
      ses.setPermissionCheckHandler((wc, permission) => permAllowed(wc, permission));
    } catch (err) { log('разрешения: не удалось закрыть сессию ' + where + ' — ' + err.message); }
  }
  app.on('session-created', (ses) => guardSession(ses, 'новая сессия'));

  // ── Масштаб сайтов во вкладке «Браузер» (0.34.0, Б3) ────────────────────────────
  // Клавиши и Ctrl+колесо внутри <webview> не доходят до окна Тапёра. Поэтому ловим их
  // в гостевом webContents (before-input-event / zoom-changed), а масштаб каждого сайта
  // храним в настройке brZoom и применяем при переходе. Масштаб окна (uiZoom) не трогаем.
  const brZoomByWc = new Map();
  // B7b (P5c №10): id webview → id окна-хозяина. Нужен, чтобы br-nav/br-audible не трогали
  // ни главное окно, ни окна входа.
  const brGuestHost = new Map();
  function brZoomWc(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    try {
      const wc = webContents.fromId(n);
      if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return null;
      return wc;
    } catch (e) { return null; }
  }
  // webview, прикреплённый именно к главному окну. hostWebContents — штатное поле Electron;
  // карта brGuestHost — страховка, если оно пустое.
  function brWebviewWc(id) {
    const wc = brZoomWc(id);
    if (!wc) return null;
    const mainWindow = getMainWindow();
    const mainId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : 0;
    let hostId = 0;
    try { hostId = wc.hostWebContents && wc.hostWebContents.id ? wc.hostWebContents.id : 0; } catch (e) {}
    if (!hostId) hostId = brGuestHost.get(wc.id) || 0;
    return brTarget.targetOk({ id: wc.id, type: wc.getType(), destroyed: wc.isDestroyed(), hostId }, mainId) ? wc : null;
  }
  function brZoomMap() {
    const v = cfg('brZoom');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function brZoomSend(wc, factor, host) {
    try {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('br-zoom-changed', { id: wc.id, factor, percent: browserZoom.percent(factor), host: host || browserZoom.hostOf(wc.getURL()) });
      }
    } catch (e) {}
  }
  function brZoomApply(wc, factor, save, url) {
    const f = browserZoom.clamp(factor);
    const host = browserZoom.hostOf(url || wc.getURL());
    try { wc.setZoomFactor(f); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    brZoomByWc.set(wc.id, f);
    if (save && host) {
      const r = browserZoom.remember(brZoomMap(), host, f, browserZoom.LIMIT);
      try { settingsDisk.set('brZoom', r.map); } catch (e) { log('масштаб сайта: не запомнился — ' + ((e && e.message) || e)); }
      if (r.evicted.length) log('браузер: масштаб — убраны старые сайты (' + r.evicted.length + ')');
    }
    brZoomSend(wc, f, host);
    return { ok: true, id: wc.id, factor: f, percent: browserZoom.percent(f), host };
  }
  function brZoomInfo(wc) {
    const f = brZoomByWc.get(wc.id) || (() => { try { return wc.getZoomFactor(); } catch (e) { return 1; } })();
    const host = browserZoom.hostOf(wc.getURL());
    return { ok: true, id: wc.id, factor: f, percent: browserZoom.percent(f), host };
  }
  function brZoomStepFor(wc, action) {
    const cur = brZoomByWc.get(wc.id) || (() => { try { return wc.getZoomFactor(); } catch (e) { return 1; } })();
    const next = browserZoom.nextFactor(cur, action);
    return brZoomApply(wc, next, true);
  }
  function brZoomForUrl(wc, url) {
    const host = browserZoom.hostOf(url);
    if (!host) return;
    brZoomApply(wc, browserZoom.get(brZoomMap(), host), false, url);
  }
  function brZoomAttach(wc) {
    // Клавиши внутри сайта: Ctrl+«+», Ctrl+«−», Ctrl+«0». Перехватываем до страницы и меню.
    wc.on('before-input-event', (event, input) => {
      if (!input || input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
      const key = String(input.key || '');
      let action = '';
      if (key === '+' || key === '=' || key === 'Add') action = 'in';
      else if (key === '-' || key === 'Subtract') action = 'out';
      else if (key === '0' || key === 'Numpad0') action = 'reset';
      if (!action) return;
      event.preventDefault();
      const r = brZoomStepFor(wc, action);
      if (r.ok) log('браузер: масштаб ' + (r.host || 'сайта') + ' — ' + r.percent + '% (клавиши)');
    });
    // Ctrl+колесо мыши: Chromium присылает zoom-changed. Свой масштаб — вместо встроенного.
    wc.on('zoom-changed', (event, direction) => {
      try { event.preventDefault(); } catch (e) {}
      const r = brZoomStepFor(wc, direction === 'out' ? 'out' : 'in');
      if (r.ok) log('браузер: масштаб ' + (r.host || 'сайта') + ' — ' + r.percent + '% (колесо)');
    });
    const onNav = (url) => { try { brZoomForUrl(wc, url || wc.getURL()); } catch (e) {} };
    wc.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => { if (isMainFrame) onNav(url); });
    wc.on('did-navigate', (event, url) => onNav(url));
    wc.on('did-navigate-in-page', (event, url) => onNav(url));
    wc.on('dom-ready', () => onNav(wc.getURL()));
    wc.once('destroyed', () => brZoomByWc.delete(wc.id));
  }
  app.on('web-contents-created', (e, contents) => {
    // B7b (P5c №10): запомнить, какое окно прикрепило webview, — по этому признаку br-nav/br-audible
    // отличают вкладку «Браузер» от главного окна и окна входа.
    contents.on('did-attach-webview', (ev, guest) => {
      if (!guest) return;
      brGuestHost.set(guest.id, contents.id);
      guest.once('destroyed', () => brGuestHost.delete(guest.id));
    });
    if (contents.getType() === 'webview') brZoomAttach(contents);
    contents.on('will-attach-webview', (ev, wp, params) => {
      delete wp.preload;
      wp.nodeIntegration = false; wp.contextIsolation = true; wp.sandbox = true;
      if (!/^https?:\/\//i.test(params.src || '')) ev.preventDefault(); // вкладка «Браузер»: любые сайты, без доступа к Тапёру (sandbox)
    });
    if (contents.getType() === 'webview') contents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) contents.loadURL(url); return { action: 'deny' }; });
  });

  function registerIpc() {
    ipcMain.handle('br-audible', (e, id) => {
      // B7b (P5c №10): только webview главного окна, не любое окно программы.
      const wc = brWebviewWc(id);
      try { return !!(wc && !wc.isDestroyed() && wc.isCurrentlyAudible() && !wc.isAudioMuted()); } catch (err) { return false; }
    });
    // Масштаб сайта во вкладке «Браузер» (0.34.0, Б3): кнопки «−», «100 %», «+»
    ipcMain.handle('br-zoom', (e, id) => {
      const wc = brZoomWc(id);
      return wc ? brZoomInfo(wc) : { ok: false, error: 'окно сайта не найдено' };
    });
    ipcMain.handle('br-zoom-step', (e, id, action) => {
      if (action !== 'in' && action !== 'out' && action !== 'reset') return { ok: false, error: 'неизвестное действие' };
      const wc = brZoomWc(id);
      if (!wc) return { ok: false, error: 'окно сайта не найдено' };
      const r = brZoomStepFor(wc, action);
      if (r.ok) log('браузер: масштаб ' + (r.host || 'сайта') + ' — ' + r.percent + '% (кнопки)');
      return r;
    });
    ipcMain.handle('br-nav', (e, id, action) => {
      try {
        const wc = brWebviewWc(id);
        if (!wc) return { ok: false, error: 'окно браузера не найдено' };
        const nh = wc.navigationHistory;
        const canBack = nh ? nh.canGoBack() : (typeof wc.canGoBack === 'function' ? wc.canGoBack() : false);
        const canFwd = nh ? nh.canGoForward() : (typeof wc.canGoForward === 'function' ? wc.canGoForward() : false);
        if (action === 'back') { if (nh) nh.goBack(); else if (wc.canGoBack && wc.canGoBack()) wc.goBack(); }
        else if (action === 'forward') { if (nh) nh.goForward(); else if (wc.canGoForward && wc.canGoForward()) wc.goForward(); }
        else if (action === 'reload') wc.reload();
        return { ok: true, canBack, canFwd };
      } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    });
  }

  return { registerIpc };
}
