'use strict';
// Что делать с ошибкой локального сервера (R5). Без Electron — чтобы покрыть тестом.
// listening — сервер уже начал слушать (успешный listen); retried — повтор после
// первой ошибки уже был. До запуска: первая ошибка — повтор на свободном порту,
// вторая — окно «сервер не запущен». После запуска — только запись в журнал:
// адрес для OBS не должен меняться из-за поздней ошибки.
function errorAction(o) {
  const opts = o || {};
  if (opts.listening) return 'log';
  if (!opts.retried) return 'retry';
  return 'fatal';
}

module.exports = { errorAction };
