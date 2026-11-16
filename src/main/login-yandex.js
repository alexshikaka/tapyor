// Окно входа в Яндекс: настоящая страница Яндекса, ловим пропуск (токен) из адреса после входа.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { BrowserWindow, ym, loginNav, log, getMainWindow } = ctx;

  function yandexLogin() {
    return new Promise((resolve) => {
      const parent = getMainWindow();
      const win = new BrowserWindow({
        width: 480, height: 720, parent: parent || undefined, modal: !!parent,
        autoHideMenuBar: true, title: 'Вход в Яндекс', backgroundColor: '#ffffff',
        webPreferences: { partition: 'persist:yandex-login' }
      });
      let done = false;
      const check = (u) => {
        // B7b (P5c №7): токен — только с https-адреса Яндекса; decodeURIComponent внутри
        // decode — в try, иначе страница с «%» в адресе обрывает вход.
        const tok = loginNav.accessToken(u);
        if (tok && !done) {
          done = true;
          resolve({ token: tok });
          setImmediate(() => { if (!win.isDestroyed()) win.close(); });
        }
      };
      const stayOnHttps = (e, u) => {
        if (!loginNav.navAllowed(u)) { e.preventDefault(); log('вход Яндекса: переход не на https отклонён'); }
      };
      win.webContents.on('will-redirect', (e, u) => { stayOnHttps(e, u); check(u); });
      win.webContents.on('will-navigate', (e, u) => { stayOnHttps(e, u); check(u); });
      win.webContents.on('did-navigate', (e, u) => check(u));
      win.webContents.on('did-navigate-in-page', (e, u) => check(u));
      // Новое окно — только https и только домены Яндекса (B7b, P5c №7).
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (!loginNav.yandexOpenAllowed(url)) { log('вход Яндекса: новое окно отклонено'); return { action: 'deny' }; }
        win.loadURL(url);
        return { action: 'deny' };
      });
      win.on('closed', () => { if (!done) resolve({ error: 'вход отменён' }); });
      win.loadURL('https://oauth.yandex.ru/authorize?response_type=token&client_id=' + ym.CLIENT_ID);
    });
  }

  return { yandexLogin };
}
