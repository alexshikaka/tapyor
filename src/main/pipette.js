// Пипетка по всему экрану: снимок экрана и прозрачное окно-оверлей во весь монитор,
// каналы pick-color / pick-init.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { ipcMain, BrowserWindow, path, log, srcDir, screen, desktopCapturer } = ctx;

  // Обычная <input type="color"> в Electron показывает лупу только внутри окна.
  // Здесь снимаем весь экран и открываем прозрачное окно-оверлей во весь монитор:
  // лупа ездит под курсором по любым приложениям, клик забирает цвет.
  // «Одна пипетка за раз», единый обработчик ответа, отмена по Esc/blur/закрытию и
  // тайм-аут 60 с живут в src/pick-session.js (tests/unit/pick-session.test.mjs).
  let pickSession = null;
  const picker = require('../pick-session.js').create({
    ipc: ipcMain,
    log: log,
    onFinish: function () { pickSession = null; }
  });

  function pickScreenColor() {
    let display = null;
    return picker.start({
      // Снимок экрана — самый долгий шаг; пока он идёт, второй запуск уже получает
      // то же обещание и второго окна не будет.
      prepare: async function () {
        const point = screen.getCursorScreenPoint();
        display = screen.getDisplayNearestPoint(point);
        const scale = display.scaleFactor || 1;
        const thumbW = Math.round(display.size.width * scale);
        const thumbH = Math.round(display.size.height * scale);
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: thumbW, height: thumbH } });
        const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
        if (!src || src.thumbnail.isEmpty()) return null;
        const shot = src.thumbnail.getSize();
        // cssW/cssH — размер экрана в логических пикселях; scale — сколько физических на логический
        pickSession = {
          dataUrl: src.thumbnail.toDataURL(),
          scale: shot.width / display.bounds.width,
          cssW: display.bounds.width,
          cssH: display.bounds.height,
          imgW: shot.width,
          imgH: shot.height
        };
        log('пипетка: экран ' + display.bounds.width + 'x' + display.bounds.height + ' (x' + scale + '), снимок ' + shot.width + 'x' + shot.height + ', рабочих ' + display.workAreaSize.width + 'x' + display.workAreaSize.height);
        return pickSession;
      },
      window: function () {
        const win = new BrowserWindow({
          x: display.bounds.x, y: display.bounds.y,
          width: display.bounds.width, height: display.bounds.height,
          frame: false, transparent: true, backgroundColor: '#00000000',
          alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
          minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
          show: false, enableLargerThanScreen: true,
          webPreferences: { preload: path.join(srcDir, 'pick-preload.js'), contextIsolation: true, sandbox: true }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.loadFile(path.join(srcDir, 'pick.html'));
        win.once('ready-to-show', () => {
          win.setBounds({ x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height });
          win.show(); win.focus();
          setTimeout(() => { try { log('пипетка: окно ' + JSON.stringify(win.getBounds()) + ', контент ' + JSON.stringify(win.getContentBounds())); } catch (e) {} }, 300);
        });
        return win;
      }
    });
  }

  function registerIpc() {
    // Пипетка: окно приложения просит цвет с любого места экрана
    ipcMain.handle('pick-color', async () => {
      try { return await pickScreenColor(); } catch (e) { log('пипетка: ' + e.message); return null; }
    });
    ipcMain.handle('pick-init', () => pickSession || null);
  }

  return { registerIpc };
}
