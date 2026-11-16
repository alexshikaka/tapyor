// Last.fm: описание исполнителя, жанровые теги, слушатели, похожие. Ключ — в lastfm.json (кладёт сборка из секрета).
const fs = require('fs');
const path = require('path');
const API = 'https://ws.audioscrobbler.com/2.0/';
function key() {
  for (const p of [path.join(__dirname, 'lastfm.json'), path.join(process.resourcesPath || '', 'lastfm.json')]) {
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.apiKey) return j.apiKey; } catch (e) {}
  }
  return '';
}
function configured() { return !!key(); }
async function call(method, params) {
  const k = key(); if (!k) throw new Error('нет ключа Last.fm');
  const q = new URLSearchParams(Object.assign({ method, api_key: k, format: 'json' }, params));
  const r = await fetch(API + '?' + q.toString(), { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Tapyor/1.0' } });
  const j = await r.json();
  if (j && j.error) throw new Error('Last.fm ' + j.error + ': ' + (j.message || ''));
  return j;
}
// Текст описания без HTML и без хвоста «Read more on Last.fm»
function cleanBio(s) {
  return String(s || '').replace(/<a [^>]*>[^<]*<\/a>\.?/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
async function artist(name) {
  let j;
  try { j = await call('artist.getinfo', { artist: name, autocorrect: '1', lang: 'ru' }); } catch (e) { throw e; }
  const a = j && j.artist; if (!a) return null;
  let bio = cleanBio(a.bio && a.bio.summary);
  if (bio.length < 40) { // русского описания нет — берём английское
    try { const e2 = await call('artist.getinfo', { artist: name, autocorrect: '1' }); bio = cleanBio(e2.artist && e2.artist.bio && e2.artist.bio.summary) || bio; } catch (e) {}
  }
  const tags = ((a.tags && a.tags.tag) || []).map((t) => t.name).filter(Boolean).slice(0, 6);
  const similar = ((a.similar && a.similar.artist) || []).map((x) => ({ name: x.name, thumb: '' }));
  return { name: a.name, url: a.url, bio, tags, listeners: Number(a.stats && a.stats.listeners) || 0, plays: Number(a.stats && a.stats.playcount) || 0, similar };
}
// Топ треков по тегу (жанру) — для кнопок-тегов на странице исполнителя
// Поиск трека по названию/исполнителю — только метаданные, без превью.
async function trackSearch(track, artist) {
  const params = { track: String(track || ''), limit: '5', autocorrect: '1' };
  if (artist) params.artist = String(artist);
  const j = await call('track.search', params);
  const list = (j && j.results && j.results.trackmatches && j.results.trackmatches.track) || [];
  return list.map((x) => ({ artist: x.artist || '', title: x.name || '', url: x.url || '' })).filter((x) => x.title);
}
async function tagTop(tag) {
  const j = await call('tag.gettoptracks', { tag: String(tag || ''), limit: '50' });
  const list = (j && j.tracks && j.tracks.track) || [];
  const fmt = (s) => { s = Number(s) || 0; return s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : ''; };
  return { tag: String(tag || ''), tracks: list.map((t) => ({ title: t.name, author: (t.artist && t.artist.name) || '', duration: fmt(t.duration) })).filter((t) => t.title) };
}

// Быстрая проверка доступности (аудит 0.34.0, A8). Раньше хватало «fetch не бросил
// исключение», поэтому ответ 401/403 считался «доступен», а автопочинка объявляла
// «починено». Теперь: только 2xx, только разобранный JSON и только без поля error.
// 401/403 — почти всегда блокировка из России (Б13): подсказка про VPN.
// opts.fetch и opts.key — для unit-тестов, в программе не нужны.
async function check(opts) {
  const o = opts || {};
  const k = o.key != null ? String(o.key) : key();
  if (!k) return { ok: false, status: 0, error: 'нет ключа', reason: 'Last.fm без ключа' };
  const doFetch = typeof o.fetch === 'function' ? o.fetch : fetch;
  const q = new URLSearchParams({ method: 'artist.getinfo', artist: 'Cher', api_key: k, format: 'json', autocorrect: '1' });
  let r;
  try {
    r = await doFetch(API + '?' + q.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Tapyor/1.0' }
    });
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e), reason: 'Last.fm не отвечает' };
  }
  const status = Number(r && r.status) || 0;
  if (status === 401 || status === 403) {
    return { ok: false, status: status, error: 'HTTP ' + status, reason: 'Last.fm из России обычно работает только через VPN' };
  }
  if (!(status >= 200 && status < 300)) {
    return { ok: false, status: status, error: 'HTTP ' + status, reason: status === 404 ? 'Last.fm не принял ключ' : 'Last.fm не отвечает' };
  }
  let j;
  try { j = await r.json(); } catch (e) {
    return { ok: false, status: status, error: 'ответ не JSON', reason: 'Last.fm ответил непонятно' };
  }
  if (!j || typeof j !== 'object' || j.error) {
    const why = j && j.error ? ('код ' + j.error + (j.message ? ': ' + j.message : '')) : 'пустой ответ';
    return { ok: false, status: status, error: why, reason: 'Last.fm ответил ошибкой' };
  }
  return { ok: true, status: status, error: '', reason: '' };
}

module.exports = { artist, trackSearch, tagTop, check, configured };
