// Значок в трее: меню (открыть, обновления, папка now_playing.txt, лог, журнал замеров,
// отчёт по заказам, журнал чат-бота, выход), подсказка «сейчас играет», двойной клик.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const {
    app, Tray, Menu, nativeImage, shell, path, fs, srcDir, log,
    modhost, orderReport, perf,
    getUpd, getMainWindow, getTray, setTray,
    npFilePath, logPath, perfFlush, perfPath, perfDayOf, showMainWindow
  } = ctx;

  function createTray() {
    const icon = nativeImage.createFromPath(path.join(srcDir, 'assets', 'tray16.png')); // tray16@2x.png Windows возьмёт сам на экранах 200%
    setTray(new Tray(icon));
    getTray().setToolTip('Тапёр');

    const menu = Menu.buildFromTemplate([
      {
        label: 'Открыть',
        click: () => { if (getMainWindow()) showMainWindow(); }   // не голый show(): иначе окно мигает на панели задач, а вперёд не выходит
      },
      {
        label: 'Проверить обновления',
        click: () => getUpd().checkForUpdates(true) // откроет плеер, статус — в шапке
      },
      {
        label: 'Открыть папку now_playing.txt (для OBS)',
        click: () => {
          try {
            const p = npFilePath();
            if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '', 'utf8'); }
            shell.showItemInFolder(p);
          } catch (e) { log('now_playing.txt: не открыть папку ' + e.message); }
        }
      },
      // Журналы — одним подменю, чтобы не загромождать меню (слово владельца 15.11.2026)
      {
        label: 'Журналы',
        submenu: [
          {
            label: 'Лог (для отладки)',
            click: () => { try { shell.openPath(logPath()); } catch (e) {} }
          },
          {
            label: 'Журнал замеров',
            click: () => { try { perfFlush(); shell.openPath(perfPath(perf.day || perfDayOf(new Date()))); } catch (e) {} }
          },
          {
            label: 'Отчёт по заказам',
            click: () => { try { orderReport.ensure(); shell.openPath(orderReport.path()); } catch (e) { log('orders-report: не открыть — ' + e.message); } }
          },
          // Журнал чат-бота — только если пак стримера есть в сборке. Открываем последний заполненный:
          // пустой файл ничего не показывает, а имя файла считается по UTC (до 03:00 «сегодня» — вчерашний).
          ...(modhost.packInstalled() ? [{
            label: 'Журнал чат-бота',
            click: () => {
              try {
                const p = modhost.latestJournal(app.getPath('userData'));
                if (p) { shell.openPath(p); return; }
                const dir = path.join(app.getPath('userData'), 'bot-journal');
                shell.openPath(fs.existsSync(dir) ? dir : app.getPath('userData'));
              } catch (e) { log('журнал бота: не открыть — ' + e.message); }
            }
          }] : []),
        ]
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => { app.isQuitting = true; app.quit(); }
      }
    ]);

    getTray().setContextMenu(menu);
    getTray().on('double-click', () => { if (getMainWindow()) showMainWindow(); });
  }

  return { createTray };
}
