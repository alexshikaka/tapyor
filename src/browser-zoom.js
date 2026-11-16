'use strict';
// Масштаб сайтов во вкладке «Браузер» (0.34.0, Б3).
// Только расчёты, без require('electron'): шаг 10 %, границы 50–200 %, ключ сайта —
// имя хоста без «www.», в настройке brZoom храним не больше 200 сайтов (старые вытесняются).
// Сам масштаб применяет main.js к гостевому webContents; интерфейс только просит изменить.

const MIN = 0.5;
const MAX = 2;
const STEP = 0.1;
const LIMIT = 200;
const DEFAULT = 1;

function validFactor(v) {
  const n = Number(v);
  return isFinite(n) && n > 0;
}

// Один знак после запятой: 0,7 + 0,1 не должно превращаться в 0,799999…
function roundFactor(v) {
  return Math.round(Number(v) * 10) / 10;
}

function clamp(v) {
  const n = Number(v);
  if (!isFinite(n)) return DEFAULT;
  return Math.min(MAX, Math.max(MIN, roundFactor(n)));
}

// Следующий масштаб: 'in' / 'out' / 'reset'. Неизвестное действие — без изменений.
function nextFactor(current, action) {
  const cur = clamp(current);
  if (action === 'reset') return DEFAULT;
  if (action === 'in') return clamp(roundFactor(cur + STEP));
  if (action === 'out') return clamp(roundFactor(cur - STEP));
  return cur;
}

function percent(factor) {
  return Math.round(clamp(factor) * 100);
}

// Ключ сайта: нижний регистр, без www. и точки на конце. Порт и путь не входят.
function hostOf(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    let h = String(u.hostname || '').toLowerCase().replace(/\.$/, '');
    if (h.indexOf('www.') === 0) h = h.slice(4);
    return h;
  } catch (e) { return ''; }
}

function get(map, host) {
  if (!host || !map || typeof map !== 'object') return DEFAULT;
  const v = map[host];
  return validFactor(v) ? clamp(v) : DEFAULT;
}

// Вернуть новый brZoom: сайт добавляется в конец, при переполнении первые (самые старые)
// вытесняются. Масштаб 100 % не храним — это и так поведение по умолчанию.
function remember(map, host, factor, limit) {
  const max = Math.max(1, Number(limit) || LIMIT);
  const out = {};
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const k of Object.keys(map)) {
      if (!k || k.length > 255) continue;
      if (!validFactor(map[k])) continue;
      const f = clamp(map[k]);
      if (f !== DEFAULT) out[k] = f;
    }
  }
  if (host) {
    delete out[host];
    const f = validFactor(factor) ? clamp(factor) : DEFAULT;
    if (f !== DEFAULT) out[host] = f;
  }
  const keys = Object.keys(out);
  const evicted = [];
  for (let i = 0; i < keys.length - max; i++) { delete out[keys[i]]; evicted.push(keys[i]); }
  return { map: out, evicted };
}

module.exports = { MIN, MAX, STEP, LIMIT, DEFAULT, clamp, nextFactor, percent, hostOf, get, remember };
