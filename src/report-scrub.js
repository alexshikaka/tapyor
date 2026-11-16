// B7b (P5b L1): вычистка текста отчёта об ошибке перед отправкой в облако.
// Раньше reportScrub в main.js вырезал только C:\Users\<имя>, почту и token=…, поэтому
// в отчёт попадали D:\Music\…, UNC-пути и адреса с параметрами. Здесь — те же вычистки,
// что в отчёте для проверки (src/debug-report.js): любой абсолютный путь → <путь>,
// у адреса с параметрами — только хост.
// Модуль без Electron: tests/unit/report-scrub.test.mjs.
'use strict';

const debugReport = require('./debug-report');

function scrub(s) {
  let t = debugReport.scrubUserPaths(s);
  t = debugReport.scrubWinPaths(t);
  t = debugReport.scrubSecrets(t);
  t = debugReport.scrubUrls(t);
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '…@…')
    .replace(/(token|cookie|sapisid|sid|auth|key|secret|password)[=:]\s*\S+/gi, '$1=…')
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '…');
}

module.exports = { scrub };
