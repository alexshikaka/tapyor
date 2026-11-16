'use strict';
// Пересчёт доната в валюту стримера (B-05, решение владельца 08.11.2026: «считать по курсу»).
// Источник 1 — курс ЦБ РФ (cbr-xml-daily.ru, база RUB), источник 2 — open.er-api.com (база RUB).
// Курс кэшируется в файле на 12 часов. Не удалось узнать курс — вернём null: заказ уйдёт стримеру на решение,
// а не встанет сам и не будет молча считаться оплаченным.
const fs = require('fs');

const TTL = 12 * 3600 * 1000;
const SOURCES = [
  { url: 'https://www.cbr-xml-daily.ru/daily_json.js', parse: (j) => {
    const out = { RUB: 1 };
    for (const [k, v] of Object.entries((j && j.Valute) || {})) if (v && v.Value > 0 && v.Nominal > 0) out[k] = v.Nominal / v.Value; // сколько единиц валюты за 1 рубль
    return out;
  } },
  { url: 'https://open.er-api.com/v6/latest/RUB', parse: (j) => (j && j.result === 'success' && j.rates) ? Object.assign({ RUB: 1 }, j.rates) : null },
];

let cachePath = '';
let log = () => {};
let fetchFn = (u, o) => fetch(u, o);
let mem = null; // { at, rates }
let pending = null;

function setup(o = {}) {
  if (o.cachePath) cachePath = o.cachePath;
  if (o.log) log = o.log;
  if (o.fetch) fetchFn = o.fetch;
  mem = null; pending = null;
}
function readCache() {
  if (mem) return mem;
  try { const j = JSON.parse(fs.readFileSync(cachePath, 'utf8')); if (j && j.rates && j.at) mem = j; } catch (e) {}
  return mem;
}
function writeCache(c) {
  mem = c;
  if (!cachePath) return;
  try { fs.writeFileSync(cachePath + '.tmp', JSON.stringify(c)); fs.renameSync(cachePath + '.tmp', cachePath); } catch (e) { log('курс: не записал кэш — ' + e.message); }
}
async function load(timeoutMs) {
  for (const s of SOURCES) {
    try {
      const r = await fetchFn(s.url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rates = s.parse(await r.json());
      if (rates && Object.keys(rates).length > 3) return { at: Date.now(), rates, src: s.url.split('/')[2] };
    } catch (e) { log('курс: ' + s.url.split('/')[2] + ' — ' + (e && e.message || e)); }
  }
  return null;
}
async function rates(timeoutMs = 3000) {
  const c = readCache();
  if (c && Date.now() - c.at < TTL) return c.rates;
  if (!pending) pending = load(timeoutMs).then((n) => { pending = null; if (n) { writeCache(n); return n.rates; } return c ? c.rates : null; }); // старый курс лучше, чем никакого
  return pending;
}
// amount в валюте from → в валюту to. null — не смогли пересчитать.
async function convert(amount, from, to, timeoutMs) {
  const a = Number(amount);
  if (!isFinite(a)) return null;
  const f = String(from || '').toUpperCase().trim(), t = String(to || '').toUpperCase().trim();
  if (!f || !t) return null;
  if (f === t) return a;
  const r = await rates(timeoutMs);
  if (!r || !(r[f] > 0) || !(r[t] > 0)) return null;
  return Math.round((a / r[f]) * r[t] * 100) / 100;
}

module.exports = { setup, convert, rates, _sources: SOURCES };
