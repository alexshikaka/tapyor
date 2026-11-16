// B7b (P5c №10): кому из окна можно управлять по id.
// br-audible(id) и br-nav(id) раньше брали любой webContents.id — так можно было перезагрузить
// главное окно или окно входа. Разрешаем только webview, прикреплённый к главному окну.
// Модуль без Electron: tests/unit/br-target.test.mjs.
'use strict';

function targetOk(info, mainId) {
  const i = info || {};
  const id = Number(i.id), main = Number(mainId);
  if (!Number.isInteger(id) || id <= 0) return false;
  if (!Number.isInteger(main) || main <= 0) return false;
  if (i.destroyed) return false;
  if (i.type !== 'webview') return false;
  return Number(i.hostId) === main;
}

module.exports = { targetOk };
