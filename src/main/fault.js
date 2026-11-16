// Имитация сбоев сети: каналы fault-get / fault-set / fault-clear (0.34.0, шаг 3).
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { ipcMain, log, faultSim, faultSimModule, faultSnapshot, libSend } = ctx;

  // Состояние только в памяти: после перезапуска пусто. Сервис и режим проверяются
  // по белому списку внутри src/fault-sim.js.
  function faultPayload() { return Object.assign({ ok: true }, faultSnapshot()); }
  function faultSend() { libSend('fault-changed', faultSnapshot()); }
  ipcMain.handle('fault-get', () => faultPayload());
  ipcMain.handle('fault-set', (e, service, mode) => {
    const svc = String(service == null ? '' : service);
    const m = mode == null ? '' : String(mode);
    if (!faultSimModule.isService(svc)) return { ok: false, error: 'неизвестный сервис' };
    if (m && !faultSimModule.isMode(m)) return { ok: false, error: 'неизвестный режим' };
    if (!faultSim.set(svc, m)) return { ok: false, error: 'не удалось изменить имитацию' };
    const name = faultSimModule.NAMES[svc] || svc;
    log(m ? ('имитация: ' + name + ' — ' + faultSimModule.MODE_TEXT[m] + ' (выключится после перезапуска)')
      : ('имитация: ' + name + ' — выключена'));
    faultSend();
    return faultPayload();
  });
  ipcMain.handle('fault-clear', () => {
    faultSim.clear();
    log('имитация: выключена');
    faultSend();
    return faultPayload();
  });
}
