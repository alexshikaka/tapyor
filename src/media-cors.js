// B7b (P5c №6): кому можно добавлять Access-Control-Allow-Origin к медиа-ответам.
// Заголовок нужен только странице самого Тапёра (ровная громкость и звук для визуализатора),
// а вкладка «Браузер» и её сайты живут в той же сессии — им заголовок не даём.
// Модуль без Electron: решает по данным запроса, поэтому покрыт unit-тестами.
'use strict';

function originOf(u) {
  try {
    const x = new URL(String(u || ''));
    return (x.protocol + '//' + x.host).toLowerCase();
  } catch (e) { return ''; }
}

// details — то, что Electron отдаёт в onHeadersReceived: webContentsId, referrer, url.
// opts.mainWebContentsId — id главного окна; opts.origins — адреса своего сервера.
function isOwn(details, opts) {
  const d = details || {};
  const o = opts || {};
  const mainId = Number(o.mainWebContentsId) || 0;
  if (mainId > 0 && Number(d.webContentsId) === mainId) return true;
  // Запасной путь: у запроса нет id (или он сменился) — сверяем адрес страницы-инициатора.
  const ref = originOf(d.referrer);
  if (!ref) return false;
  return (o.origins || []).map(originOf).filter(Boolean).includes(ref);
}

module.exports = { isOwn, originOf };
