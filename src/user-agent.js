// Строка user-agent с настоящей версией Chromium (B14).
// Раньше во всех местах был зашит Chrome/130.x, хотя внутри Electron 44 работает
// Chromium новее. Для Google устаревшая версия выглядит подозрительно, и вход
// в YouTube окном мог показывать «браузер небезопасен».
// Модуль не требует electron на верхнем уровне — его можно проверить unit-тестом.
'use strict';

// Прежняя строка: если версию Chromium узнать нельзя, оставляем её.
const FALLBACK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Мажорная версия из строки вида «152.0.7444.60». Пустая строка — версия не распознана.
function chromeMajor(version) {
  if (version == null) return '';
  const m = /^(\d+)(?:\.|$)/.exec(String(version).trim());
  if (!m) return '';
  const major = Number(m[1]);
  return Number.isSafeInteger(major) && major > 0 ? String(major) : '';
}

// chromeVersion не передан — берём версию из текущего процесса (Electron: process.versions.chrome).
function userAgent(chromeVersion) {
  const version = chromeVersion === undefined ? (process.versions && process.versions.chrome) : chromeVersion;
  const major = chromeMajor(version);
  if (!major) return FALLBACK_UA;
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + major + '.0.0.0 Safari/537.36';
}

module.exports = { userAgent, FALLBACK_UA };
