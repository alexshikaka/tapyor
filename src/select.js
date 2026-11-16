'use strict';
// Единый выбор трека: сначала фразовый tier, потом источник, только потом score.
// Никакой сети и Electron — чтобы это можно было гонять на сохранённых заказах.

const match = require('./match');
const reqp = require('./reqparse');

const SOURCE_RANK = { local: 4, ym: 3, sc: 1, au: 1, yt: 0 };
const VERSION_RX = /(?<![\p{L}\p{N}])(?:remix|ремикс|sped\s?up|speed\s?up|slowed|nightcore|cover|кавер|live|лайв|karaoke|караоке|instrumental|минус|mashup|мэшап|version|версия|french|english|russian|acoustic|angrier|tribute|акустик|трибьют)(?![\p{L}\p{N}])/iu;

function trackOf(c) { return c && c.track ? c.track : (c || {}); }
function srcOf(c) { return String(trackOf(c).src || c.src || ''); }
function secOf(c) {
  const n = Number(trackOf(c).seconds != null ? trackOf(c).seconds : c.seconds);
  return isFinite(n) && n > 0 ? n : 0;
}
function words(s) { return match.tokens(String(s || '')); }
function enabled(src, opts) {
  if (!opts || !opts.enabled) return true;
  if (src === 'local') return opts.enabled.local !== false && opts.enabled.lc !== false;
  return opts.enabled[src] !== false;
}
// Для роли «исполнитель» не считаем короткий префикс вроде KING → Kings
// полноценным совпадением: иначе название песни исчезает из проверки.
function sameArtist(w, a) {
  if (!reqp.tokEq(w, a)) return false;
  if (w.length <= 4 && a.length > w.length) return false;
  return true;
}
function cover(need, have) {
  if (!need.length) return 0;
  return need.filter((x) => have.some((y) => reqp.tokEq(x, y))).length / need.length;
}
function hasSeq(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (!reqp.tokEq(hay[i + j], needle[j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// tier: 5 — полная фраза + точный исполнитель; 4 — фраза + исполнитель с опечаткой;
// 3 — фраза без исполнителя; 2 — полное покрытие названия; 1 — частичное; 0 — мусор.
function inspect(candidate, message, opts) {
  opts = opts || {};
  const t = trackOf(candidate);
  const title = words(t.title);
  const artist = words(t.author);
  const msg = words(String(message || '').replace(/^!play\s+/i, ''));
  // Слова исполнителя не должны подтверждать название.
  const rest = msg.filter((w) => !artist.some((a) => sameArtist(w, a)));
  const titleOnlyArtist = title.length > 0 && rest.length > 0 && title.every((w) => artist.some((a) => sameArtist(w, a)));
  // Если в сообщении нет ничего, кроме исполнителя, одноимённый трек — нормальный вариант.
  const titleHay = rest.length ? rest : msg;
  const phraseExact = !titleOnlyArtist && hasSeq(titleHay, title);
  const titleCover = title.length ? cover(title, titleHay) : 0;
  const artistCover = artist.length ? cover(artist, msg) : 0;
  const maxSec = Number(opts.maxSec) || 0;
  const long = !!(maxSec && secOf(t) > maxSec);
  const version = VERSION_RX.test(String(t.title || ''));
  const wantsVersion = VERSION_RX.test(String(message || ''));
  let tier = 0;
  if (!titleOnlyArtist) {
    if (phraseExact && artistCover >= 0.99) tier = 5;
    else if (phraseExact && artistCover >= 0.5) tier = 4;
    else if (phraseExact) tier = 3;
    else if (titleCover >= 0.99) tier = 2;
    else if (titleCover >= 0.6) tier = 1;
  }
  if (long) tier = Math.min(tier, 3);
  if (version && !wantsVersion) tier = Math.min(tier, 2);
  return {
    tier, titleOnlyArtist, phraseExact, titleCover: +titleCover.toFixed(3),
    artistCover: +artistCover.toFixed(3), long, version, wantsVersion, src: srcOf(t), seconds: secOf(t)
  };
}

// a/b: { candidate, score, good }; good — exact, допущенный combo-проверкой.
function better(a, b, message, opts) {
  if (!b) return enabled(srcOf(a.candidate), opts);
  if (!enabled(srcOf(a.candidate), opts)) return false;
  // Точный кандидат всегда важнее сомнительного: источник не должен
  // вытаскивать doubt поверх уже подтверждённого exact.
  if (!!a.good !== !!b.good) return !!a.good;
  const ai = inspect(a.candidate, message, opts);
  const bi = inspect(b.candidate, message, opts);
  const ar = SOURCE_RANK[ai.src] || 0, br = SOURCE_RANK[bi.src] || 0;
  if (ai.tier !== bi.tier) return ai.tier > bi.tier;
  if (ai.artistCover !== bi.artistCover) return ai.artistCover > bi.artistCover;
  if (ai.artistCover > 0 && ai.long !== bi.long) return !ai.long;
  if (ai.artistCover > 0 && ar !== br) return ar > br;
  if (ai.artistCover > 0 && ar === br) return (Number(a.score) || 0) > (Number(b.score) || 0) + 0.02;
  // Без исполнителя score — единственный сигнал. Порог 0.02 не даёт
  // случайному кандидату с +0.01 перебить уже выбранный трек.
  if (ai.artistCover === 0 && bi.artistCover === 0 && ar === br) {
    return (Number(a.score) || 0) > (Number(b.score) || 0) + 0.02;
  }
  if (!!a.good !== !!b.good) return !!a.good;
  return false;
}

function cmp(a, b) {
  if (a.info.tier !== b.info.tier) return b.info.tier - a.info.tier;
  if (a.info.artistCover !== b.info.artistCover) return b.info.artistCover - a.info.artistCover;
  const ar = SOURCE_RANK[a.info.src] || 0, br = SOURCE_RANK[b.info.src] || 0;
  if (ar !== br) return br - ar;
  if (a.info.long !== b.info.long) return a.info.long ? 1 : -1;
  return (Number(b.score) || 0) - (Number(a.score) || 0);
}

function rank(candidates, message, opts) {
  return (candidates || [])
    .filter((c) => c && trackOf(c) && trackOf(c).title && enabled(srcOf(c), opts))
    .map((c) => ({ candidate: c, track: trackOf(c), score: Number(c.score) || 0, info: inspect(c, message, opts) }))
    .sort(cmp);
}

function pick(candidates, message, opts) {
  return rank(candidates, message, opts)[0] || null;
}

// Для неоднозначных названий (нет исполнителя) используем ту же логику,
// что и умный поиск: она лучше различает «Звери — Районы-кварталы» и каверы.
function choose(candidates, message, opts) {
  const ranked = rank(candidates, message, opts);
  const top = ranked[0];
  if (!top || top.info.tier >= 4) return top;
  const ym = [], yt = [];
  for (const r of ranked) {
    if (r.info.src === 'ym') ym.push(r.track);
    else if (r.info.src === 'yt') yt.push(r.track);
  }
  try {
    const q = match.clean(String(message || '').replace(/^!play\s+/i, ''));
    const d = q && q.query ? match.decide(q, ym, yt) : null;
    if (d && d.track) {
      const info = inspect(d.track, message, opts);
      const score = (ranked.find((r) => r.track === d.track) || {}).score || 0;
      if (info.tier >= top.info.tier) return { candidate: d.track, track: d.track, score, info };
    }
  } catch (e) {}
  return top;
}

module.exports = { inspect, rank, pick, choose, better, hasSeq, SOURCE_RANK };
