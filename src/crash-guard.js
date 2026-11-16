'use strict';
// R1: общая ловушка ошибок главного процесса.
// Ошибка в любом месте программы (включая пак бота через modhost) больше не роняет процесс
// и не показывает системное окно Electron: событие попадает в журнал, повторяющиеся записи
// считаются, а об отчёте заботится переданная снаружи функция.
//
// Модуль без Electron и без сети: только чистая логика, чтобы покрыть unit-тестами.
// Секреты и пути ПК вырезаются тем же набором правил, что в debug-report.js.
const path = require('path');
const debugReport = require('./debug-report');

const MAX_STACK = 2000;          // стек в журнале — не длиннее 2 000 символов
const REPEAT_MS = 60 * 1000;     // одинаковый отпечаток полностью — не чаще раза в минуту
const MAX_REPORTS = 5;           // не больше 5 отчётов за запуск

// Сообщение из чего угодно: Error, строка, null, объект. Само не бросает.
function toMessage(value) {
  try {
    if (value instanceof Error) return String(value.message || value.name || 'ошибка');
    if (typeof value === 'string') return value;
    if (value == null) return String(value);
    if (typeof value === 'object') {
      try { if (typeof value.message === 'string' && value.message) return value.message; } catch (e) {}
      try { if (value.reason != null && value.reason !== value) return toMessage(value.reason); } catch (e) {}
      try {
        const s = JSON.stringify(value);
        if (s && s !== '{}') return s;
      } catch (e) {}
      try { return Object.prototype.toString.call(value); } catch (e) {}
    }
    return String(value);
  } catch (e) { return 'ошибка без описания'; }
}

function toStack(value) {
  try {
    if (value && typeof value.stack === 'string') return value.stack;
  } catch (e) {}
  return '';
}

// Имя пользователя из путей, cookies, токены и заголовки — как в отчёте для проверки.
// Каждый шаг отдельно: если один шаблон сломается, остальные всё равно сработают.
function scrub(text) {
  let s = String(text == null ? '' : text);
  try { s = debugReport.scrubHeaders(s); } catch (e) {}
  try { s = debugReport.scrubWinPaths(s); } catch (e) {}
  try { s = debugReport.scrubUserPaths(s); } catch (e) {}
  try { s = debugReport.scrubSecrets(s); } catch (e) {}
  return s;
}

// Первая строка стека с нашим файлом. root — папка программы; в упакованной сборке
// путь содержит app.asar, поэтому дополнительно ищем «src\<файл>.js».
function ownStackLine(stack, root) {
  const lines = String(stack == null ? '' : stack)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^at\s/.test(s));
  if (!lines.length) return '';
  const base = String(root || '').replace(/[\\/]+$/, '');
  let own = '';
  if (base) {
    const low = base.toLowerCase();
    own = lines.find((s) => s.toLowerCase().indexOf(low) >= 0) || '';
  }
  if (!own) own = lines.find((s) => /(^|[\\/])src[\\/][^\\/\s()]+\.js/.test(s)) || '';
  return own || lines[0] || '';
}

// Отпечаток ошибки: сообщение + первая строка стека с нашим файлом.
function fingerprint(message, stack, root) {
  return String(message == null ? '' : message) + '\n' + ownStackLine(stack, root);
}

function create(options) {
  const o = options || {};
  const log = typeof o.log === 'function' ? o.log : function () {};
  const report = typeof o.report === 'function' ? o.report : null;
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const root = typeof o.root === 'string' && o.root ? o.root : path.join(__dirname, '..');

  let exceptions = 0;
  let rejections = 0;
  let lastAt = 0;
  let reports = 0;
  const seen = new Map();         // отпечаток → { fullAt, repeats, reported }

  function callLog(line) {
    try { log(line); } catch (e) { /* журнал не должен ломать обработчик */ }
  }

  function callReport(fp, text) {
    if (!report || reports >= MAX_REPORTS) return;
    reports++;
    try {
      const r = report(fp, text);
      if (r && typeof r.catch === 'function') r.catch(function () {});
    } catch (e) { /* отчёт не должен ломать обработчик */ }
  }

  function handle(rejection, value) {
    try {
      const at = now();
      if (rejection) rejections++; else exceptions++;
      lastAt = at;

      const rawMessage = toMessage(value);
      const rawStack = toStack(value);
      const message = scrub(rawMessage).slice(0, 500);
      const stack = scrub(rawStack.slice(0, MAX_STACK)).slice(0, MAX_STACK);
      const kind = rejection ? 'необработанное отклонение' : 'необработанная ошибка';
      const fp = fingerprint(rawMessage, rawStack, root);

      let rec = seen.get(fp);
      if (!rec) {
        rec = { fullAt: null, repeats: 0, reported: false };
        seen.set(fp, rec);
      }

      const full = rec.fullAt == null || at - rec.fullAt >= REPEAT_MS;
      if (full) {
        rec.fullAt = at;
        rec.repeats = 0;
        const text = 'главный процесс: ' + kind + ' — ' + message + (stack ? '\n' + stack : '');
        callLog(text);
        if (!rec.reported) {
          rec.reported = true;
          callReport(fp, text);
        }
      } else {
        rec.repeats++;
        callLog('главный процесс: ' + kind + ' повторилась ' + rec.repeats + ' раз — ' + message);
      }
    } catch (e) { /* обработчик никогда не бросает */ }
  }

  return {
    onException: (err) => handle(false, err),
    onRejection: (reason) => handle(true, reason),
    stats: () => ({ exceptions, rejections, lastAt })
  };
}

// Ровно два обработчика на переданный process: ошибка и отклонённое обещание.
// Ни один не бросает, даже если сам guard сломан.
function install(proc, guard) {
  if (!proc || typeof proc.on !== 'function') return;
  const g = guard || {};
  proc.on('uncaughtException', function (err) {
    try { if (typeof g.onException === 'function') g.onException(err); } catch (e) {}
  });
  proc.on('unhandledRejection', function (reason) {
    try { if (typeof g.onRejection === 'function') g.onRejection(reason); } catch (e) {}
  });
}

module.exports = { create, install, MAX_STACK, REPEAT_MS, MAX_REPORTS };
