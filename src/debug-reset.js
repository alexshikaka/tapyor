'use strict';
// Правила отладочных сбросов (0.34.0, задание 4). Без Electron и диска в чистых
// функциях: main.js читает настройки, зовёт нужную функцию и записывает результат.
//
// Что не трогают сбросы никогда: входы и ключи сервисов, токены лицензий (кроме
// явного сброса лицензии/триала), плейлисты, темы и защита часов (licClockMax,
// lic-clock.dat, реестр). Список «что оставить» — ниже, по нему же строится текст
// переспроса в интерфейсе.
const fs = require('fs');
const path = require('path');

// Что сброс настроек сохраняет: входы, ключи, лицензии, плейлисты, темы.
// Выбранная тема (theme) и цвет полосы окна (themeBar) — вместе со списком тем:
// иначе после сброса своя тема осталась бы в списке, но Тапёр выглядел бы заводским.
const KEEP_EXACT = [
  'modLicenses', 'licClockMax', 'modLicenseKey',       // лицензия и защита часов
  'savedLists', 'themes', 'theme', 'themeBar',         // плейлисты и темы
  'ymToken', 'ytCookies', 'ytOauth', 'ytOauthAccount', 'ytOauthScope', 'ytAccount', // входы в Яндекс и YouTube
  'donKeys', 'donAccounts', 'ghToken', 'ghAccount'      // донаты и GitHub
];
const KEEP_PREFIX = ['modSecure.', 'sbotSecure.'];     // секреты модулей, ключ покупки, ключ и пароль пульта

function keepKey(key) {
  const k = String(key || '');
  if (KEEP_EXACT.indexOf(k) >= 0) return true;
  for (const p of KEEP_PREFIX) if (k.indexOf(p) === 0) return true;
  return false;
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }

// Заводские настройки + сохранённые входы/ключи/лицензии/плейлисты/темы.
function resetSettings(data, defaults) {
  const out = clone(defaults || {});
  const src = data || {};
  for (const k of Object.keys(src)) if (keepKey(k)) out[k] = src[k];
  return out;
}

function b64uText(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Вид токена лицензии без проверки подписи: для удаления триала подпись не нужна,
// а gate() всё равно не примет неподписанный токен.
function tokenKind(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2 || parts[0] !== 'tpl1') return '';
    const j = JSON.parse(b64uText(parts[1]));
    return j && typeof j.kind === 'string' ? j.kind : '';
  } catch (e) { return ''; }
}

// Лицензия и ключ покупки — только локально; сервер и защиту часов не трогаем.
function resetLicense(data) {
  const out = clone(data || {});
  delete out.modLicenses;
  delete out.modLicenseKey;
  delete out['modSecure.streamer-pack.core.licenseKey'];
  return out;
}

// Убираем только токены kind:'trial'. Полные лицензии и всё остальное остаются.
function resetTrial(data) {
  const out = clone(data || {});
  const all = out.modLicenses;
  if (!all || typeof all !== 'object' || Array.isArray(all)) return out;
  const next = {};
  for (const pack of Object.keys(all)) {
    const arr = all[pack];
    if (!Array.isArray(arr)) { next[pack] = arr; continue; }
    const kept = arr.filter((t) => tokenKind(t) !== 'trial');
    if (kept.length) next[pack] = kept;
  }
  if (Object.keys(next).length) out.modLicenses = next;
  else delete out.modLicenses;
  return out;
}

// Переписать все settings.json.bak*, включая суточные settings.json.bak.day-ГГГГ-ММ-ДД
// (с R2 они тоже участвуют в восстановлении, src/settings-store.js). Без этого
// settings-store при отсутствии основного файла поднимет старые настройки из копии.
// log — необязательный: main.js передаёт журнал, чтобы неудачная перезапись копии не пропала молча.
function rewriteBackups(settingsFile, data, log) {
  const say = typeof log === 'function' ? log : () => {};
  const file = String(settingsFile || '');
  if (!file) return 0;
  const dir = path.dirname(file);
  const base = path.basename(file);
  const rx = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.bak(?:\\.\\d+|\\.day-\\d{4}-\\d{2}-\\d{2})?$');
  const json = JSON.stringify(data, null, 2);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return 0; }
  let n = 0;
  for (const f of names) {
    if (!rx.test(f)) continue;
    try { fs.writeFileSync(path.join(dir, f), json, 'utf8'); n++; }
    catch (e) { say('отладка: копия настроек «' + f + '» не переписана — ' + ((e && e.message) || e)); }
  }
  return n;
}

module.exports = {
  resetSettings, resetLicense, resetTrial, rewriteBackups,
  tokenKind, keepKey, KEEP_EXACT, KEEP_PREFIX
};
