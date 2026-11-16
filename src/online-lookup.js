'use strict';
/**
 * Онлайн-проверка метаданных для Electron (main-процесс, Node 18+ — встроенный fetch).
 * Deezer, iTunes и MusicBrainz — без ключей; Last.fm — с ключом приложения; YouTube oEmbed.
 * Нейросеть не используется: только канонические исполнитель/название.
 *
 * Использование в main.js:
 *   const lookup = require('./online-lookup');
 *   lookup.setup({ cachePath: path.join(app.getPath('userData'), 'lookup-cache.json'), log });
 *   const { cand, s } = await lookup.findCanonical(artist, title, text);
 */
const fs = require('fs');
const path = require('path');
const lastfm = require('./lastfm');
const atomic = require('./atomic-write');
const { stringSim } = require('./match-score');

const VERSION_RX = /(?<![\p{L}\p{N}])(?:remix|ремикс|sped\s?up|speed\s?up|slowed|nightcore|cover|кавер|live|лайв|karaoke|караоке|instrumental|минус|mashup|мэшап|version|версия|acoustic|angrier|tribute|french|english|russian)(?![\p{L}\p{N}])/iu; // R9: \b не видит кириллицу
const UA = 'Tapyor (https://github.com/alexshikaka/tapyor)'; // MusicBrainz просит в User-Agent имя и адрес проекта — открытый репозиторий
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- кэш (JSON-файл, без нативных зависимостей) ----------
let cachePath = path.join(process.cwd(), 'lookup-cache.json');
let cache = null;
let saveTimer = null;
const inflight = new Map();
const MAX_CANONICAL = 2;
const QUEUE_WAIT_MS = 1000;
let canonicalActive = 0;
const canonicalWaiters = [];
let log = () => {};
// circuit breaker: после 3 ошибок не дёргаем сервис 5 минут
const failures = new Map();
function blocked(host) { const f = failures.get(host); return !!f && f.until > Date.now(); }
function good(host) { failures.delete(host); }
function bad(host, e) {
  const f = failures.get(host) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 3) { f.until = Date.now() + 5 * 60 * 1000; f.n = 0; log('lookup: ' + host + ' временно пропущен — ' + (e && e.message || 'ошибка')); }
  failures.set(host, f);
}

function setup(opts = {}) {
  if (opts.cachePath) cachePath = opts.cachePath;
  if (opts.log) log = opts.log;
  cache = null;
}

// Глобальный семафор: внешние справочники не должны получать десятки
// одновременных запросов. Лишние ждут не дольше 1 с, потом канон пропускается.
function acquireCanonical(waitMs) {
  if (canonicalActive < MAX_CANONICAL) { canonicalActive++; return Promise.resolve(true); }
  return new Promise((resolve) => {
    const w = { done: false, resolve: null };
    const timer = setTimeout(() => {
      if (w.done) return;
      w.done = true;
      const i = canonicalWaiters.indexOf(w);
      if (i >= 0) canonicalWaiters.splice(i, 1);
      resolve(false);
    }, Math.max(100, Number(waitMs) || QUEUE_WAIT_MS));
    w.resolve = () => { if (w.done) return; w.done = true; clearTimeout(timer); resolve(true); };
    canonicalWaiters.push(w);
  });
}
function releaseCanonical() {
  const w = canonicalWaiters.shift();
  if (w) w.resolve(); // слот переходит ожидающему
  else if (canonicalActive > 0) canonicalActive--;
}
function init(opts = {}) { setup(opts); }
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { cache = {}; }
  return cache;
}
function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); atomic.writeFileAtomic(cachePath, JSON.stringify(cache)); } catch { /* не критично */ }
  }, 1000);
}

// ---------- ограничение частоты по хосту ----------
const nextSlot = {};
async function throttle(host, interval) {
  const now = Date.now();
  const at = Math.max(now, nextSlot[host] || 0);
  nextSlot[host] = at + interval;
  if (at > now) await sleep(at - now);
}

async function getJson(url, host, interval) {
  const c = loadCache();
  if (url in c) { good(host); return c[url]; }
  if (blocked(host)) return null;
  await throttle(host, interval);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) { bad(host, new Error('HTTP ' + res.status)); return null; }
    const data = await res.json();
    good(host);
    c[url] = data;
    saveCacheSoon();
    return data;
  } catch (e) {
    bad(host, e);
    return null;
  }
}

const qs = (o) => new URLSearchParams(o).toString();

// ---------- источники ----------
async function searchDeezer(q) {
  const d = await getJson('https://api.deezer.com/search?' + qs({ q, limit: 5 }), 'deezer', 300);
  return (d?.data || []).map((x) => ({ artist: x.artist?.name || '', title: x.title || '' }));
}
async function searchLastfm(q) {
  if (!lastfm.configured() || blocked('lastfm')) return [];
  try {
    const list = await lastfm.trackSearch(q, '');
    good('lastfm');
    return list;
  } catch (e) {
    bad('lastfm', e);
    return [];
  }
}
async function searchItunes(q) {
  const d = await getJson('https://itunes.apple.com/search?' + qs({ term: q, entity: 'song', limit: 5 }), 'itunes', 3000);
  return (d?.results || []).map((x) => ({ artist: x.artistName || '', title: x.trackName || '' }));
}
async function searchMusicBrainz(q) {
  const d = await getJson('https://musicbrainz.org/ws/2/recording?' + qs({ query: q, fmt: 'json', limit: 5 }), 'mb', 1100);
  return (d?.recordings || []).map((x) => ({ artist: x['artist-credit']?.[0]?.name || '', title: x.title || '' }));
}
async function youtubeTitle(url) {
  const d = await getJson('https://www.youtube.com/oembed?' + qs({ url, format: 'json' }), 'yt', 300);
  return { artist: d?.author_name || '', title: d?.title || '' };
}

// ---------- сопоставление ----------
const tokens = (s) => new Set((s.toLowerCase().replace(/\(.*?\)|\[.*?\]|\bfeat\.?|\bft\.?/g, ' ').match(/[\p{L}\p{N}']+/gu)) || []);
const overlap = (a, b) => (a.size ? [...a].filter((x) => b.has(x)).length / a.size : 0);
const titleOverlap = (cand, text) => overlap(tokens(cand.title || ''), tokens(text));

function score(cand, text) {
  const tt = tokens(cand.title);
  if (!tt.size) return 0;
  const ta = tokens(cand.artist);
  const tx = tokens(text);
  const fuzzy = stringSim(String(cand.title || '').toLowerCase(), String(text || '').toLowerCase());
  // fuzzy важнее простого пересечения слов: bad lair ≈ Bad Liar, а не BAD.
  return 0.55 * fuzzy + 0.30 * overlap(tt, tx) + 0.15 * (ta.size ? overlap(ta, tx) : 0.5);
}

async function bestMatch(artist, title, text, opts = {}) {
  const q = `${artist} ${title}`.trim() || text.replace(/https?:\/\/\S+/g, '').slice(0, 100).trim();
  if (!q) return { cand: null, s: 0 };
  let best = null;
  let bestS = 0;
  let first = null;
  for (const fn of [searchDeezer, searchLastfm, searchItunes, searchMusicBrainz]) {
    for (const cand of await fn(q)) {
      const s = score(cand, text);
      const candSim = stringSim(String(cand.title || '').toLowerCase(), String(text || '').toLowerCase());
      const queryCover = overlap(tokens(text || ''), tokens(cand.title || ''));
      const version = VERSION_RX.test(String(cand.title || '')) && !VERSION_RX.test(String(text || ''));
      if (!first && !version && (queryCover >= 0.99 || candSim >= 0.72)) first = cand;
      if (s > bestS) { best = cand; bestS = s; }
    }
    if (bestS >= 0.85) break; // уже уверены — не дёргаем остальные источники
  }
  // Для запроса без исполнителя первый результат каталога обычно и есть оригинал.
  if (opts.firstOnly && first) return { cand: first, s: Math.max(score(first, text), 0.86) };
  return { cand: best, s: bestS };
}

// ---------- API для основного процесса ----------
// Ищет канонические метаданные на Deezer/iTunes/MusicBrainz.
// Не решает, заказ это или нет, и не понижает статус заказа.
async function findCanonical(artist, title, text, opts = {}) {
  const a = String(artist || '').trim();
  const t = String(title || '').trim();
  if (!t && !a) return { cand: null, s: 0 };
  const key = a + '|' + t + '|' + String(text || '');
  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    const slot = await acquireCanonical(opts.queueWaitMs);
    if (!slot) return { cand: null, s: 0, skipped: 'busy' };
    try {
      const found = bestMatch(a, t, String(text || ''), { firstOnly: !a });
      let timer;
      const ms = Math.max(250, Number(opts.timeoutMs) || 12000);
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ cand: null, s: 0 }), ms); });
      const { cand, s } = await Promise.race([found, timeout]);
      clearTimeout(timer);
      let score = s;
      if (!a && cand && titleOverlap(cand, text) >= 0.99) score = Math.max(score, 0.86);
      if (cand && score >= 0.75) log('lookup: ' + [cand.artist, cand.title].filter(Boolean).join(' — ') + ' (' + score.toFixed(2) + ')');
      return { cand, s: score };
    } finally { releaseCanonical(); }
  })();
  inflight.set(key, work);
  try { return await work; } finally { inflight.delete(key); }
}

module.exports = { setup, init, findCanonical, bestMatch, youtubeTitle, _test: { score, tokens } };
