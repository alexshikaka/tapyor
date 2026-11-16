// Работа с Яндекс Музыкой (неофициальный API, как у сторонних клиентов)
const crypto = require('crypto');

const API = 'https://api.music.yandex.net';
const CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d'; // публичный id клиента Яндекс Музыки
const SALT = 'XGRlBW9FXlekgbPrRHuSiA';

let log = () => {};
function setLogger(fn) { log = fn; }

// Крючки для автопочинки (0.34.0, шаг 5): сетевые ошибки api() подряд.
// Считает и решает диспетчер (src/autofix.js); здесь только «был сбой / был ответ».
let onNetFail = null, onNetOk = null;
function setHooks(o) {
  onNetFail = (o && typeof o.fail === 'function') ? o.fail : null;
  onNetOk = (o && typeof o.ok === 'function') ? o.ok : null;
}

function headers(token) {
  const h = {
    'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621',
    'Accept-Language': 'ru',
    'User-Agent': 'Yandex-Music-API'
  };
  if (token) h.Authorization = 'OAuth ' + token;
  return h;
}

async function api(pathAndQuery, token, timeoutMs) {
  let res;
  try {
    res = await fetch(API + pathAndQuery, { headers: headers(token), signal: AbortSignal.timeout(timeoutMs || 12000) });
  } catch (e) {
    // Именно сетевая ошибка (нет связи, тайм-аут) — не HTTP-ответ. HTTP-ошибки
    // ловит быстрая проверка, здесь их не считаем.
    if (onNetFail) { try { onNetFail(e); } catch (x) {} }
    throw e;
  }
  if (onNetOk) { try { onNetOk(); } catch (x) {} }
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('HTTP ' + res.status + ': ' + txt.slice(0, 200)); }
  if (!res.ok || j.error) {
    const err = new Error('HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return j.result;
}

function cover(uri, size) { return uri ? 'https://' + String(uri).replace('%%', size) : ''; }

function fmt(ms) {
  const sec = Math.max(0, Math.round((ms || 0) / 1000));
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function mapTrack(t) {
  const artists = (t.artists || []).map((a) => a.name).join(', ');
  const album = (t.albums || [])[0] || {};
  const title = t.version ? t.title + ' (' + t.version + ')' : t.title;
  const cu = t.coverUri || album.coverUri || t.ogImage;
  const at = String(t.type || '').toLowerCase();
  const aType = String(album.type || '').toLowerCase();
  const aMeta = String(album.metaType || '').toLowerCase();
  // Глава книги или выпуск подкаста — не музыка для заказов. availableForOptions:bookmate
  // признаком не является: он стоит и у обычных альбомов.
  const speech = at === 'podcast-episode' || aType === 'audiobook' || aType === 'podcast' ||
    aMeta === 'audiobook' || aMeta === 'podcast';
  return {
    src: 'ym',
    id: String(t.id),
    speech: speech || undefined,
    albumId: album.id ? String(album.id) : '',
    title: title || '',
    author: artists,
    duration: fmt(t.durationMs),
    seconds: Math.round((t.durationMs || 0) / 1000),
    thumb: cover(cu, '200x200'),
    cover: cover(cu, '600x600'),
    album: album.title || '',
    available: t.available !== false,
    explicit: t.contentWarning === 'explicit' || t.explicit === true || undefined,
    // громкость трека (EBU R128) и точки затухания — для ровной громкости и плавных переходов
    lufs: t.r128 && typeof t.r128.i === 'number' ? t.r128.i : undefined,
    fadeOut: t.fade && typeof t.fade.outStart === 'number' ? t.fade.outStart : undefined
  };
}

// Поиск: треки (лучший результат первым), плейлисты и исполнители одним запросом
async function search(query, token) {
  const r = await api('/search?type=all&page=0&nocorrect=false&text=' + encodeURIComponent(query), token);
  let list = ((r && r.tracks && r.tracks.results) || []).map(mapTrack);
  if (r && r.best && r.best.type === 'track' && r.best.result) {
    const b = mapTrack(r.best.result);
    list = [b].concat(list.filter((x) => x.id !== b.id));
  }
  const playlists = ((r && r.playlists && r.playlists.results) || []).map(mapPlaylist).filter((p) => p.count > 0).slice(0, 16);
  let artists = ((r && r.artists && r.artists.results) || []).map(mapArtist);
  if (r && r.best && r.best.type === 'artist' && r.best.result) {
    const b = mapArtist(r.best.result);
    artists = [b].concat(artists.filter((x) => x.id !== b.id));
  }
  const playlistsTotal = (r && r.playlists && r.playlists.total) || playlists.length;
  return { tracks: list.filter((x) => x.available), playlists, playlistsTotal, artists: artists.slice(0, 12), total: (r && r.tracks && r.tracks.total) || 0 };
}
// Книги и подкасты Яндекса — это те же альбомы с пометкой типа (metaType: podcast | audiobook).
// Подкасты ищутся своим типом, книги — среди альбомов: отдельного типа для них у Яндекса нет.
// Книга или подкаст: Яндекс различает их полем metaType у альбома.
// Если поля нет, смотрим на косвенные признаки: у книги есть автор-писатель и жанр audiobook,
// у подкаста — свой тип в поиске. Неизвестное считаем подкастом только в последнюю очередь.
function speechKind(a) {
  // Проверено живьём 02.11 на логе владельца: у книги Яндекса metaType = podcast (как у подкаста),
  // а отличает её type = audiobook. Доступность bookmate признаком НЕ является — она стоит и у
  // обычных альбомов (Бах, джаз), поэтому по ней судить нельзя.
  const tp = String(a.type || '').toLowerCase();
  if (tp === 'audiobook') return 'book';
  if (tp === 'podcast') return 'pod';
  const mt = String(a.metaType || a.metaTypeStr || a.meta_type || '').toLowerCase();
  if (mt === 'audiobook') return 'book';
  if (mt === 'podcast') return 'pod';
  const g = String(a.genre || '').toLowerCase();
  if (g === 'audiobook' || g === 'audiobooks') return 'book';
  if (g === 'podcast' || g === 'podcasts') return 'pod';
  return a._kindHint || 'pod';
}
function mapSpeech(a) {
  const kind = speechKind(a);
  return {
    src: 'ym', sp: kind, type: kind === 'book' ? 'book' : 'podcast',
    albumId: String(a.id), workId: 'ym:' + a.id,
    title: a.title || '', author: ((a.artists || []).map((x) => x.name)).join(', '),
    count: a.trackCount || 0, year: a.year || 0,
    thumb: cover(a.coverUri, '200x200'), cover: cover(a.coverUri, '600x600')
  };
}
async function searchSpeech(query, token) {
  const q = encodeURIComponent(query);
  const [pod, alb] = await Promise.all([
    api('/search?type=podcast&page=0&nocorrect=false&text=' + q, token).catch(() => null),
    api('/search?type=album&page=0&nocorrect=false&text=' + q, token).catch(() => null)
  ]);
  // Поиск подкастов отдаёт подкасты, поиск альбомов — всё подряд: книги и подкасты берём по metaType.
  const podRaw = ((pod && pod.podcasts && pod.podcasts.results) || []).map((a) => Object.assign({ _kindHint: 'pod' }, a));
  const albAll = ((alb && alb.albums && alb.albums.results) || []);
  const albRaw = albAll.filter((a) => ['audiobook', 'podcast'].indexOf(String(a.metaType || '').toLowerCase()) >= 0 ||
    String(a.type || '').toLowerCase() === 'audiobook');
  const pods = podRaw.map(mapSpeech);
  const books = albRaw.map(mapSpeech);
  const nb = pods.concat(books).filter((x) => x.sp === 'book').length;
  log('Яндекс: книги и подкасты «' + query + '» — найдено ' + (pods.length + books.length) + ' (книг ' + nb + ')');
  const seen = new Set();
  return books.concat(pods).filter((x) => {
    if (!x.title || seen.has(x.albumId)) return false;
    seen.add(x.albumId); return true;
  });
}
// Главы книги или выпуски подкаста. Каждой дорожке ставим sp и workId — по ним плеер понимает, что это речь.
async function speechTracks(token, albumId, kind) {
  const r = await api('/albums/' + encodeURIComponent(albumId) + '/with-tracks', token);
  // Тип берём у самого альбома — он надёжнее того, что пришло из поиска
  const sp = r ? speechKind(r) : (kind === 'book' ? 'book' : 'pod');
  const workTitle = (r && r.title) || '';
  const workId = 'ym:' + albumId;
  // У выпуска подкаста есть дата (pubDate): по ней ставим от новых к старым
  let list = [].concat.apply([], (r && r.volumes) || []).map((t) => Object.assign(mapTrack(t), { pub: t.pubDate || '' })).filter((t) => t.available);
  if (sp === 'pod' && list.some((t) => t.pub)) {
    list = list.slice().sort((a, b) => String(b.pub).localeCompare(String(a.pub)));
    log('Яндекс: подкаст ' + albumId + ' — выпуски от ' + String(list[0].pub).slice(0, 10) + ' до ' + String(list[list.length - 1].pub).slice(0, 10));
  }
  const tracks = list.map((t, i) => Object.assign(t, { sp: sp, workId: workId, workTitle: workTitle, idx: i + 1 }));
  log('Яндекс: альбом ' + albumId + ' (' + (sp === 'book' ? 'книга' : 'подкаст') + ') — дорожек ' + tracks.length);
  const d = r && r.description;
  return {
    src: 'ym', sp: sp, type: sp === 'book' ? 'book' : 'podcast',
    albumId: String(albumId), workId: workId, title: workTitle,
    author: ((r && r.artists) || []).map((a) => a.name).join(', '),
    about: (typeof d === 'string' ? d : (d && d.text)) || (r && r.shortDescription) || '',
    count: tracks.length, thumb: cover(r && r.coverUri, '200x200'), cover: cover(r && r.coverUri, '600x600'),
    tracks: tracks
  };
}

// S7: следующая порция плейлистов для «Ещё плейлисты» (общий поиск отдаёт только первые несколько)
async function searchPlaylistsPage(query, page, token) {
  const r = await api('/search?type=playlist&page=' + (page || 0) + '&nocorrect=false&text=' + encodeURIComponent(query), token);
  return ((r && r.playlists && r.playlists.results) || []).map(mapPlaylist).filter((p) => p.count > 0);
}

// Следующие страницы треков (для прокрутки при фильтре «Яндекс»)
async function searchTracksPage(query, page, token) {
  const r = await api('/search?type=track&page=' + (page || 0) + '&nocorrect=false&text=' + encodeURIComponent(query), token);
  return ((r && r.tracks && r.tracks.results) || []).map(mapTrack).filter((x) => x.available);
}

function playlistCover(p) {
  const c = p.cover || {};
  return c.uri || (c.itemsUri || [])[0] || p.ogImage || '';
}
function mapPlaylist(p) {
  const owner = p.owner || {};
  return {
    src: 'ym', type: 'playlist',
    uid: String(owner.uid || p.uid || ''), kind: String(p.kind != null ? p.kind : ''),
    uuid: p.playlistUuid || '',
    title: p.title || '',
    author: owner.name || owner.login || '',
    count: p.trackCount || (p.tracks ? p.tracks.length : 0),
    thumb: cover(playlistCover(p), '200x200')
  };
}
function mapArtist(a) {
  const c = (a.cover && (a.cover.uri || a.cover.prefix)) || a.ogImage || '';
  return { id: String(a.id), name: a.name || '', thumb: c ? cover(c, '200x200') : '' };
}

// Подсказки при наборе
async function suggest(part, token) {
  const r = await api('/search/suggest?part=' + encodeURIComponent(part), token, 6000);
  const out = [];
  if (r && r.best && r.best.text) out.push(r.best.text);
  ((r && r.suggestions) || []).forEach((s) => { if (typeof s === 'string' && out.indexOf(s) < 0) out.push(s); });
  return out.slice(0, 8);
}

async function accountStatus(token) {
  const r = await api('/account/status', token);
  const acc = (r && r.account) || {};
  // аватарка — по возможности (Яндекс ID), без неё кнопка покажет первую букву имени
  let avatar = '';
  try {
    const res = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + token }, signal: AbortSignal.timeout(5000) });
    if (res.ok) { const j = await res.json(); if (j && j.default_avatar_id && !j.is_avatar_empty) avatar = 'https://avatars.yandex.net/get-yapic/' + j.default_avatar_id + '/islands-middle'; }
  } catch (e) { log('яндекс: аватарка не загрузилась — ' + ((e && e.message) || e)); }
  return {
    uid: acc.uid ? String(acc.uid) : '',
    login: acc.login || '',
    name: acc.displayName || acc.fullName || acc.login || '',
    hasPlus: !!(r && r.plus && r.plus.hasPlus),
    avatar
  };
}

async function apiPost(pathAndQuery, token, json) {
  const h = headers(token);
  h['Content-Type'] = 'application/json';
  const res = await fetch(API + pathAndQuery, { method: 'POST', headers: h, body: JSON.stringify(json || {}), signal: AbortSignal.timeout(12000) });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('HTTP ' + res.status + ': ' + txt.slice(0, 200)); }
  if (!res.ok || j.error) { const err = new Error('HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200)); err.status = res.status; throw err; }
  return j.result;
}

async function apiForm(pathAndQuery, token, fields) {
  const h = headers(token);
  h['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(API + pathAndQuery, { method: 'POST', headers: h, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(15000) });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('HTTP ' + res.status + ': ' + txt.slice(0, 200)); }
  if (!res.ok || j.error) { const err = new Error('HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200)); err.status = res.status; throw err; }
  return j.result;
}

// --- Волны (радио Яндекса) ---
// Обычная станция: 'user:onyourwave', 'genre:rock', 'artist:123', 'mood:calm' …
// «Сессия» по семенам — так новое приложение Яндекса включает свои варианты волны
const WAVE = 'user:onyourwave';
let wave = { kind: 'station', station: WAVE, batch: '', session: '' };

// mood: all | active | fun | calm | sad;  diversity: default | favorite | discover | popular;
// language: any | russian | not-russian | without-words
async function waveStart(token, o) {
  o = o || {};
  const seeds = Array.isArray(o.seeds) ? o.seeds.filter(Boolean) : [];
  if (seeds.length) {
    // Характер, настроение и язык в сессии задаются такими же «семенами», как в вебе Яндекса.
    // Значения «как есть» (all / default / any) не передаём — это и есть поведение по умолчанию.
    const sets = [];
    if (o.diversity && o.diversity !== 'default') sets.push('settingDiversity:' + o.diversity);
    if (o.mood && o.mood !== 'all') sets.push('settingMoodEnergy:' + o.mood);
    if (o.language && o.language !== 'any') sets.push('settingLanguage:' + o.language);
    try {
      const r = await apiPost('/rotor/session/new', token, { seeds: seeds.concat(sets), includeTracksInResponse: true });
      wave = { kind: 'session', station: seeds[0], batch: (r && r.batchId) || '', session: (r && r.radioSessionId) || '' };
      const list = seqTracks(r);
      log('Волна (сессия): ' + seeds.concat(sets).join(',') + ' → треков ' + list.length);
      if (list.length) return list;
    } catch (e) { log('Волна (сессия) не запустилась: ' + e.message + ' — пробую как станцию'); }
  }
  const station = o.station || (seeds.find((x) => /^[a-z-]+:[^:]+$/i.test(x) && !/^setting/i.test(x))) || WAVE;
  wave = { kind: 'station', station: station, batch: '', session: '' };
  try {
    await apiPost('/rotor/station/' + station + '/settings2', token, {
      moodEnergy: o.mood || 'all',
      diversity: o.diversity || 'default',
      language: o.language || 'any'
    });
  } catch (e) { log('Волна: настройки для ' + station + ' не применились — ' + e.message); }
  await waveFeedback(token, 'radioStarted');
  return waveTracks(token, '');
}

function seqTracks(r) {
  return ((r && r.sequence) || []).map((x) => x && x.track).filter(Boolean).map(mapTrack).filter((t) => t.available);
}

async function waveTracks(token, lastId) {
  let r;
  if (wave.kind === 'session' && wave.session) {
    r = await apiPost('/rotor/session/' + encodeURIComponent(wave.session) + '/tracks', token, { queue: lastId ? [lastId] : [] });
  } else {
    r = await api('/rotor/station/' + wave.station + '/tracks?settings2=true' + (lastId ? '&queue=' + encodeURIComponent(lastId) : ''), token);
  }
  if (r && r.batchId) wave.batch = r.batchId;
  const list = seqTracks(r);
  log('Волна ' + wave.station + ': получено треков ' + list.length);
  return list;
}

// Обратная связь, чтобы волна подстраивалась (ошибки не критичны)
async function waveFeedback(token, type, trackKey, played) {
  const ts = new Date().toISOString();
  try {
    if (wave.kind === 'session' && wave.session) {
      const ev = { type: type, timestamp: ts };
      if (trackKey) ev.trackId = trackKey;
      if (played != null) ev.totalPlayedSeconds = Math.max(0, Math.round(played));
      await apiPost('/rotor/session/' + encodeURIComponent(wave.session) + '/feedback', token, { event: ev, batchId: wave.batch || undefined });
      return;
    }
    const body = { type: type, timestamp: ts, from: 'mobile-radio-' + wave.station.replace(/[^a-z0-9]+/gi, '-') };
    if (trackKey) body.trackId = trackKey;
    if (played != null) body.totalPlayedSeconds = Math.max(0, Math.round(played));
    await apiPost('/rotor/station/' + wave.station + '/feedback' + (wave.batch ? '?batch-id=' + encodeURIComponent(wave.batch) : ''), token, body);
  } catch (e) { log('Волна: отзыв «' + type + '» не принят — ' + e.message); }
}

// Список всех станций: жанры, настроения, занятия, эпохи
function mapStation(st) {
  const s = (st && st.station) || st || {};
  const id = s.id ? s.id.type + ':' + s.id.tag : '';
  const icon = s.icon || s.fullImageUrl || {};
  return { id: id, type: s.id ? s.id.type : '', name: s.name || '', color: (icon.backgroundColor || '').trim(), parent: s.parentId ? s.parentId.type + ':' + s.parentId.tag : '' };
}
async function stationsList(token) {
  const r = await api('/rotor/stations/list?language=ru', token);
  return (r || []).map(mapStation).filter((x) => x.id && x.name);
}

// Единственный источник вариантов волны: и «Для вас» на вкладке, и «Что играет» в панели очереди.
async function waveContexts(token, seeds) {
  let qs = '';
  if (Array.isArray(seeds) && seeds.length) qs = '?seeds=' + encodeURIComponent(seeds.join(','));
  const r = await api('/rotor/wave/settings' + qs, token, 10000);
  const out = [], seen = {};
  const blocks = (r && Array.isArray(r.blocks)) ? r.blocks : [];
  for (const b of blocks) {
    const items = (b && Array.isArray(b.items)) ? b.items : [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const name = String(it.name || it.title || '').trim();
      if (!name) continue;
      let station = '';
      if (it.id && typeof it.id === 'object' && it.id.type && it.id.tag) station = it.id.type + ':' + it.id.tag;
      if (!station && typeof it.id === 'string' && /^[a-z-]+:/.test(it.id)) station = it.id;
      if (!station && typeof it.idForFrom === 'string') {
        const m = /^([a-z-]+)-(.+)$/.exec(it.idForFrom);
        if (m) station = m[1] + ':' + m[2];
      }
      let seeds = Array.isArray(it.seeds) ? it.seeds.filter((x) => typeof x === 'string') : [];
      if (!station && !seeds.length) continue;
      const key = name + '|' + station + '|' + seeds.join(',');
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({
        name: name,
        station: station,
        seeds: seeds,
        color: (it.icon && it.icon.backgroundColor) || it.color || '',
        description: String(it.description || it.rupDescription || '').trim(),
        icon: it.icon || null,
        restrictions: it.restrictions || null
      });
    }
  }
  return { defaultStation: (r && r.defaultStation) || null, contexts: out.slice(0, 40) };
}

// --- Плейлисты и «Мне нравится» ---
async function tracksByIds(token, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const r = await apiForm('/tracks', token, { 'track-ids': chunk.join(','), 'with-positions': 'false' });
    (r || []).forEach((t) => out.push(mapTrack(t)));
  }
  return out.filter((t) => t.available);
}
async function likedTracks(token, uid, limit) {
  const r = await api('/users/' + encodeURIComponent(uid) + '/likes/tracks?if-modified-since-revision=0', token);
  const ids = (((r && r.library && r.library.tracks) || [])).map((t) => t.albumId ? t.id + ':' + t.albumId : String(t.id));
  const total = ids.length;
  const tracks = await tracksByIds(token, ids.slice(0, limit || 500));
  return { title: 'Мне нравится', count: total, tracks: tracks };
}
async function userPlaylists(token, uid) {
  const own = ((await api('/users/' + encodeURIComponent(uid) + '/playlists/list', token)) || []).map(mapPlaylist);
  let liked = [];
  try {
    liked = ((await api('/users/' + encodeURIComponent(uid) + '/likes/playlists', token)) || [])
      .map((x) => x && x.playlist).filter(Boolean).map((p) => Object.assign(mapPlaylist(p), { saved: true }));
  } catch (e) { log('Яндекс: сохранённые плейлисты — ' + e.message); }
  return own.concat(liked);
}
async function playlistTracks(token, pl) {
  let r;
  if (pl.uuid && !pl.kind) r = await api('/playlist/' + encodeURIComponent(pl.uuid) + '?rich-tracks=true', token);
  else r = await api('/users/' + encodeURIComponent(pl.uid) + '/playlists/' + encodeURIComponent(pl.kind) + '?rich-tracks=true', token);
  const items = (r && r.tracks) || [];
  let tracks = items.map((x) => x && x.track).filter(Boolean).map(mapTrack).filter((t) => t.available);
  if (!tracks.length && items.length) {
    tracks = await tracksByIds(token, items.map((x) => (x.albumId ? x.id + ':' + x.albumId : String(x.id))).slice(0, 500));
  }
  const meta = mapPlaylist(r || {});
  return Object.assign(meta, { title: meta.title || pl.title || 'Плейлист', count: (r && r.trackCount) || tracks.length, tracks: tracks });
}
async function albumTracks(token, albumId) {
  const r = await api('/albums/' + encodeURIComponent(albumId) + '/with-tracks', token);
  const tracks = [].concat.apply([], (r && r.volumes) || []).map(mapTrack).filter((t) => t.available);
  return { src: 'ym', type: 'album', title: (r && r.title) || 'Альбом', author: ((r && r.artists) || []).map((a) => a.name).join(', '), count: tracks.length, thumb: cover(r && r.coverUri, '200x200'), tracks: tracks };
}
async function artistTracks(token, artistId) {
  const r = await api('/artists/' + encodeURIComponent(artistId) + '/tracks?page=0&page-size=200', token);
  const tracks = ((r && r.tracks) || []).map(mapTrack).filter((t) => t.available);
  let name = '';
  try { const b = await api('/artists/' + encodeURIComponent(artistId) + '/brief-info', token, 8000); name = b && b.artist && b.artist.name; } catch (e) { log('яндекс: имя исполнителя не получено — ' + ((e && e.message) || e)); }
  return { src: 'ym', type: 'artist', artistId: String(artistId), title: name || 'Исполнитель', author: 'Популярные треки', count: tracks.length, thumb: tracks[0] ? tracks[0].thumb : '', tracks: tracks };
}
// Страница исполнителя: популярное, альбомы, синглы, сборники, похожие
function mapAlbum(a) {
  const t = a.type === 'single' ? 'single' : (a.type === 'compilation' || a.type === 'podcast' ? 'compilation' : 'album');
  return { src: 'ym', id: String(a.id), title: a.version ? a.title + ' (' + a.version + ')' : (a.title || ''), year: a.year || (a.releaseDate ? Number(String(a.releaseDate).slice(0, 4)) : 0), type: t, thumb: cover(a.coverUri, '200x200'), count: a.trackCount || 0, author: ((a.artists || []).map((x) => x.name)).join(', ') };
}
async function artistInfo(token, artistId) {
  const b = await api('/artists/' + encodeURIComponent(artistId) + '/brief-info', token);
  let albums = (b && b.albums) || [];
  try { const d = await api('/artists/' + encodeURIComponent(artistId) + '/direct-albums?page=0&page-size=100&sort-by=year', token); if (d && d.albums && d.albums.length) albums = d.albums; } catch (e) { log('яндекс: полный список альбомов не получен — ' + ((e && e.message) || e)); }
  const a = (b && b.artist) || {};
  const c = (a.cover && (a.cover.uri || a.cover.prefix)) || a.ogImage || '';
  const desc = a.description && (a.description.text || a.description);
  return {
    id: String(artistId), name: a.name || '', photo: c ? cover(c, '400x400') : '',
    about: typeof desc === 'string' ? desc : '',
    popular: ((b && b.popularTracks) || []).map(mapTrack).filter((t) => t.available).slice(0, 20),
    albums: albums.filter((x) => x.available !== false).map(mapAlbum),
    also: ((b && b.alsoAlbums) || []).filter((x) => x.available !== false).map((x) => Object.assign(mapAlbum(x), { type: 'compilation' })),
    similar: ((b && b.similarArtists) || []).map(mapArtist).slice(0, 16)
  };
}
// Лайки: список id и поставить/снять
async function likedIds(token, uid) {
  const r = await api('/users/' + encodeURIComponent(uid) + '/likes/tracks?if-modified-since-revision=0', token);
  return (((r && r.library && r.library.tracks) || [])).map((t) => String(t.id));
}
async function setLike(token, uid, trackKey, on) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/likes/tracks/' + (on ? 'add-multiple' : 'remove'), token, { 'track-ids': String(trackKey) });
}
// «Не нравится» — отдельный список Яндекса, устроен так же, как лайки.
// Нужен, чтобы «Моя волна» перестала предлагать трек, и чтобы список был виден во вкладке «Плейлисты».
async function dislikedTracks(token, uid, limit) {
  const r = await api('/users/' + encodeURIComponent(uid) + '/dislikes/tracks?if-modified-since-revision=0', token);
  const ids = (((r && r.library && r.library.tracks) || [])).map((t) => t.albumId ? t.id + ':' + t.albumId : String(t.id));
  const total = ids.length;
  const tracks = await tracksByIds(token, ids.slice(0, limit || 500));
  return { title: 'Не нравится', count: total, tracks: tracks };
}
async function dislikedIds(token, uid) {
  const r = await api('/users/' + encodeURIComponent(uid) + '/dislikes/tracks?if-modified-since-revision=0', token);
  return (((r && r.library && r.library.tracks) || [])).map((t) => String(t.id));
}
async function setDislike(token, uid, trackKey, on) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/dislikes/tracks/' + (on ? 'add-multiple' : 'remove'), token, { 'track-ids': String(trackKey) });
}
// Новый плейлист в аккаунте и добавление треков (порциями по 100)
async function createPlaylist(token, uid, title) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/playlists/create', token, { title: title, visibility: 'private' });
}
async function addToPlaylist(token, uid, kind, revision, tracks, startAt) {
  let rev = revision || 1, at = startAt || 0;
  const list = tracks.filter((t) => t && t.id && t.albumId);
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100).map((t) => ({ id: String(t.id), albumId: String(t.albumId) }));
    const r = await apiForm('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind) + '/change-relative', token,
      { diff: JSON.stringify([{ op: 'insert', at: at, tracks: chunk }]), revision: String(rev) });
    rev = (r && r.revision) || rev + 1;
    at += chunk.length;
  }
  return { kind: String(kind), revision: rev, count: at - (startAt || 0) };
}
async function trackById(token, id) {
  const list = await tracksByIds(token, [String(id)]);
  return list[0] || null;
}


// Управление своими плейлистами: сведения, название, удаление, треки
async function playlistInfo(token, uid, kind) {
  const r = await api('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind), token);
  return { revision: r.revision || 1, count: r.trackCount || 0, title: r.title || '', items: ((r && r.tracks) || []).map((x) => ({ id: String(x.id), albumId: x.albumId ? String(x.albumId) : '' })) };
}
async function appendTracks(token, uid, kind, tracks) {
  const info = await playlistInfo(token, uid, kind);
  return addToPlaylist(token, uid, kind, info.revision, tracks, info.count);
}
async function renamePlaylist(token, uid, kind, title) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind) + '/name', token, { value: String(title).slice(0, 100) });
}
async function deletePlaylist(token, uid, kind) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind) + '/delete', token, {});
}
// Убрать треки по id (все вхождения). Удаляем с конца, чтобы номера не сдвигались
async function removeTracks(token, uid, kind, ids) {
  const want = new Set((ids || []).map(String));
  const info = await playlistInfo(token, uid, kind);
  let rev = info.revision, n = 0;
  for (let i = info.items.length - 1; i >= 0; i--) {
    if (!want.has(info.items[i].id)) continue;
    const r = await apiForm('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind) + '/change-relative', token,
      { diff: JSON.stringify([{ op: 'delete', from: i, to: i + 1 }]), revision: String(rev) });
    rev = (r && r.revision) || rev + 1; n++;
  }
  return { count: n, revision: rev };
}

// Прямая ссылка на mp3 трека
async function streamUrl(trackId, token) {
  const infos = await api('/tracks/' + encodeURIComponent(trackId) + '/download-info', token);
  if (!infos || !infos.length) throw new Error('нет вариантов загрузки');
  const mp3 = infos.filter((i) => i.codec === 'mp3');
  const pool = (mp3.length ? mp3 : infos).slice().sort((a, b) => (b.bitrateInKbps || 0) - (a.bitrateInKbps || 0));
  const full = pool.filter((i) => !i.preview);
  const pick = (full.length ? full : pool)[0];
  const preview = !full.length;

  const sep = pick.downloadInfoUrl.indexOf('?') >= 0 ? '&' : '?';
  const res = await fetch(pick.downloadInfoUrl + sep + 'format=json', { headers: headers(token), signal: AbortSignal.timeout(12000) });
  const txt = await res.text();
  let host, path, ts, s;
  try {
    const j = JSON.parse(txt);
    host = j.host; path = j.path; ts = j.ts; s = j.s;
  } catch (e) {
    const g = (tag) => { const m = new RegExp('<' + tag + '>([^<]*)</' + tag + '>').exec(txt); return m ? m[1] : ''; };
    host = g('host'); path = g('path'); ts = g('ts'); s = g('s');
  }
  if (!host || !path) throw new Error('не удалось разобрать ссылку загрузки');
  const sign = crypto.createHash('md5').update(SALT + path.slice(1) + s).digest('hex');
  log('Яндекс: поток ' + trackId + ' ' + (pick.bitrateInKbps || '?') + ' кбит/с' + (preview ? ' (превью)' : ''));
  return { audioUrl: 'https://' + host + '/get-mp3/' + sign + '/' + ts + path, preview: preview, bitrate: pick.bitrateInKbps };
}

module.exports = { artistInfo, CLIENT_ID, setLogger, setHooks, search, searchSpeech, speechTracks, searchTracksPage, searchPlaylistsPage, suggest, accountStatus, streamUrl, waveStart, waveTracks, waveFeedback, stationsList, waveContexts, likedTracks, userPlaylists, playlistTracks, albumTracks, artistTracks, trackById, likedIds, setLike, dislikedTracks, dislikedIds, setDislike, createPlaylist, addToPlaylist, playlistInfo, appendTracks, renamePlaylist, deletePlaylist, removeTracks, _test: { mapTrack, mapStation, cover, fmt, seqTracks } };
