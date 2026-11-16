// Узкий мост окна визарда: только команды главному окну, закрытие и события от него.
// Весь API Тапёра этому окну не нужен и не отдаётся.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizardApi', {
  cmd: (payload) => { try { ipcRenderer.send('wizard-cmd', payload || {}); } catch (e) {} },
  // wizard-close — ipcMain.handle, поэтому invoke (send до handle не доходит).
  close: () => { try { ipcRenderer.invoke('wizard-close').catch(() => {}); } catch (e) {} },
  onEvent: (fn) => { if (typeof fn === 'function') ipcRenderer.on('wizard-evt', (e, data) => fn(data)); }
});
