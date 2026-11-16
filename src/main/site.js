// Сайт-визитка стримера и визуализатор: каналы site-* и viz-arm.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { ipcMain, dialog, session, shell, fs, sitepage, log, getMainWindow } = ctx;

  // Сайт-визитка
  ipcMain.handle('site-status', () => sitepage.status());
  ipcMain.handle('site-preview', (e, p) => sitepage.build(p || {}));
  ipcMain.handle('site-publish', (e, p) => sitepage.publish(p || {}));
  ipcMain.handle('site-gh-token', (e, tok) => sitepage.setToken(tok));
  ipcMain.handle('site-gh-device-start', () => sitepage.deviceStart().catch((err) => ({ error: err.message })));
  ipcMain.handle('site-gh-device-wait', () => sitepage.deviceWait().catch((err) => ({ error: err.message })));
  ipcMain.handle('site-gh-device-cancel', () => { sitepage.deviceCancel(); return true; });
  ipcMain.handle('site-save', async (e, p) => {
    const r = await dialog.showSaveDialog(getMainWindow(), { title: 'Сохранить страницу', defaultPath: 'index.html', filters: [{ name: 'Страница', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return { cancelled: true };
    fs.writeFileSync(r.filePath, sitepage.build(p || {}), 'utf8'); shell.showItemInFolder(r.filePath); return { ok: true, path: r.filePath };
  });

  function registerIpc() {
    // Визуализатор (пункт 12): окно Тапёра слушает само себя — звук своей страницы, без экрана и других программ.
    // Разрешаем только главному окну и только сразу после его просьбы (viz-arm); сайты во вкладке «Браузер» сюда не попадают.
    let vizArmUntil = 0;
    ipcMain.handle('viz-arm', (e) => { const mainWindow = getMainWindow(); if (mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents) vizArmUntil = Date.now() + 5000; return true; });
    try {
      session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
        const mainWindow = getMainWindow();
        const ok = Date.now() < vizArmUntil && mainWindow && !mainWindow.isDestroyed() && req.frame && req.frame === mainWindow.webContents.mainFrame;
        vizArmUntil = 0;
        if (!ok) { cb(); return; } // cb() без аргументов — отказ (cb({}) в Electron 44 бросает ошибку); проверено 26.10
        log('визуализатор: захват звука окна');
        // enableLocalEcho: без него Electron уводит звук окна в захват и колонки молчат (Windows, 26.10)
        cb({ video: req.frame, audio: req.frame, enableLocalEcho: true }); // картинку окно сразу останавливает — нужен только звук
      });
    } catch (e) { log('визуализатор: захват недоступен — ' + e.message); }
  }

  return { registerIpc };
}
