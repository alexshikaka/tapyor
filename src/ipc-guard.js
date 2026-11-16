// Страж IPC (стабилизация 12.11, B1): кто зовёт канал главного процесса.
// Раньше эта проверка жила прямо в main.js и при СВОЕЙ ошибке пропускала вызов
// (catch → true). Теперь наоборот: любая ошибка внутри проверки — отказ.
// Ошибка пишется в журнал не чаще раза в 10 секунд на канал, чтобы сбой не засыпал журнал.
// Модуль не требует electron на верхнем уровне: всё внешнее приходит в create().
'use strict';

const ERROR_LOG_MS = 10 * 1000;

function create(opts) {
  const o = opts || {};
  const isOwnPage = o.isOwnPage;
  const hasWindow = o.hasWindow;
  const ymwebContents = o.ymwebContents;
  const log = typeof o.log === 'function' ? o.log : () => {};
  const lastErrorAt = new Map();   // канал → время последней строки об ошибке

  function logCheckError(channel) {
    const key = String(channel);
    const now = Date.now();
    if (now - (lastErrorAt.get(key) || 0) < ERROR_LOG_MS) return;
    lastErrorAt.set(key, now);
    log('IPC: канал «' + channel + '» отклонён — ошибка проверки отправителя');
  }

  function senderOk(ev, channel) {
    try {
      const frame = ev && ev.senderFrame;
      const url = frame && frame.url ? String(frame.url) : '';
      // Адрес ещё не известен (окно грузится) — верим только своим окнам, не встроенным сайтам.
      if (!url) return !!(ev && ev.sender && hasWindow(ev.sender));
      if (isOwnPage(url)) return true;
      // Исключение — окно запасного пути Яндекса. Там чужая страница (music.yandex.ru),
      // но preload в ней наш, и он обязан отвечать в главный процесс. Пускаем только эти
      // два канала и только от самого окна: сверяем webContents, а не адрес, иначе любая
      // вкладка с music.yandex.ru во «Браузере» смогла бы притвориться запасным путём.
      if (channel === 'ymweb-state' || channel === 'ymweb-reply') {
        const wc = ymwebContents ? ymwebContents() : null;
        if (wc && !wc.isDestroyed() && ev.sender === wc) return true;
      }
      log('IPC: канал «' + channel + '» отклонён, вызов не со страницы Тапёра');
      return false;
    } catch (err) {
      logCheckError(channel);
      return false;
    }
  }

  return { senderOk };
}

module.exports = { create };
