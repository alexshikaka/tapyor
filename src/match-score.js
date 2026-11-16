'use strict';
// Чистое ранжирование кандидатов заказа. Без сети, DOM и Electron.
const reqp = require('./reqparse');

const VERSION_RX = /(?<![\p{L}\p{N}])(?:remix|ремикс|sped\s?up|speed\s?up|slowed|nightcore|cover|кавер|live|лайв|karaoke|караоке|instrumental|минус|mashup|мэшап)(?![\p{L}\p{N}])/iu;
const SOURCE_BONUS = { ym: 0.03, yt: 0, sc: -0.01, au: -0.01, local: 0.02 };

function uniq(a) { return Array.from(new Set(a)); }
function frac(a, b) { if (!a.length) return 0; return a.filter((x) => b.some((y) => reqp.tokEq(x, y))).length / a.length; }
function bigrams(a) { const out = new Set(); for (let i = 0; i + 1 < a.length; i++) out.add(a[i] + ' ' + a[i + 1]); return out; }
function phraseCover(a, b) {
  const x = bigrams(a), y = bigrams(b); if (!x.size) return 0;
  let n = 0; x.forEach((v) => { if (y.has(v)) n++; }); return n / x.size;
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function stringSim(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}
function tokens(s) { return reqp.tokens(String(s || '')); }
function norm(s) { return (reqp.prep(String(s || '')) || '').replace(/\s+/g, ' ').trim(); }

// scoreCandidate({ message, query, track, wantsYouTube, allowVersions })
function scoreCandidate(o) {
  const message = String(o.message || '');
  const query = String(o.query || message);
  const track = o.track || {};
  const src = track.src || o.source || '';
  const msg = uniq(tokens(message));
  const q = uniq(tokens(query));
  const title = uniq(tokens(track.title));
  const author = uniq(tokens(track.author));
  const titleCover = frac(title, msg);                 // насколько название присутствует в сообщении
  const queryTitle = frac(q, title);                   // насколько запрос покрывает название
  const queryCover = frac(q, msg);                     // насколько запрос взят из сообщения
  const artistCover = author.length ? frac(author, msg) : 0;
  const phrase = phraseCover(q, title);
  const fuzzy = stringSim(norm(query), norm(track.title));
  const youtube = !!(o.wantsYouTube || /(?:ютуб|youtube|youtu\.be|с ютуба|на ютубе)/iu.test(message));
  let score = 0.38 * queryTitle + 0.22 * titleCover + 0.15 * fuzzy + 0.10 * artistCover + 0.08 * phrase + 0.07 * queryCover;
  const parts = { title: +titleCover.toFixed(3), queryTitle: +queryTitle.toFixed(3), queryCover: +queryCover.toFixed(3), artist: +artistCover.toFixed(3), phrase: +phrase.toFixed(3), fuzzy: +fuzzy.toFixed(3) };
  const base = score;
  let sourceBonus = 0, shortPenalty = 0, versionPenalty = 0;
  if (src === 'ym') sourceBonus += SOURCE_BONUS.ym;
  else if (src === 'local') sourceBonus += SOURCE_BONUS.local;
  else if (src === 'sc' || src === 'au') sourceBonus += SOURCE_BONUS[src];
  if (src === 'yt' && youtube) sourceBonus += 0.08;
  // Слишком короткое общее название без исполнителя — опасный exact.
  if (title.length <= 2 && artistCover < 0.5) shortPenalty -= 0.12;
  // Версия: разрешение не является предпочтением; запрет — отдельный жёсткий фильтр.
  const version = VERSION_RX.test(track.title || '');
  if (version && o.allowVersions === false) versionPenalty -= 0.25;
  score += sourceBonus + shortPenalty + versionPenalty;
  parts.source = +sourceBonus.toFixed(3);
  parts.shortPenalty = +shortPenalty.toFixed(3);
  parts.versionPenalty = +versionPenalty.toFixed(3);
  parts.version = version;
  parts.base = +base.toFixed(3);
  return { score: +Math.max(0, Math.min(1, score)).toFixed(4), parts, titleWords: title.length, artistWords: author.length };
}

function rankCandidates(list) {
  return (list || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
}
function margin(list) {
  const a = rankCandidates(list); return a.length < 2 ? 1 : (a[0].score || 0) - (a[1].score || 0);
}
module.exports = { scoreCandidate, rankCandidates, margin, stringSim, phraseCover, tokens, isVersion: (title) => VERSION_RX.test(String(title || '')) };
