'use strict';

// Разбор текста заказа. Только чистые функции: без сети, оплаты, очереди и ВК/Telegram.
// confidence — оценка того, что текст является музыкальным заказом (у non_music близка к 0).

const MUSIC_VERBS = new Set([
  'поставь', 'поставьте', 'поставить', 'включи', 'включите', 'сыграй', 'сыграйте', 'спой', 'спойте',
  'заряди', 'зарядите', 'закинь', 'закиньте', 'врубай', 'врубите', 'запусти', 'запустите',
  'play', 'заказ', 'заказываю', 'заказать',
]);
const PLAY_VERBS = new Set(['сыграй', 'сыграйте', 'поиграй', 'играй']);
const TRACK_NOUNS = new Set(['трек', 'песню', 'песня', 'песенку', 'композицию', 'музыку', 'track', 'song']);
const LEAD_FILLERS = new Set([
  'привет', 'здарова', 'эй', 'слушай', 'друг', 'братан', 'бро', 'стример', 'пожалуйста', 'плиз',
  'пжлст', 'please', 'pls', 'можно', 'можешь', 'мне', 'нам', 'ну', 'тогда', 'давай',
]);
const TRAILING_FILLERS = new Set(['пожалуйста', 'плиз', 'please', 'pls', 'пжлст', 'спасибо']);
const WANT_VERBS = new Set(['хочу', 'хотим', 'хотелось']);
const WANT_OBJECTS = new Set(['послушать', 'услышать', 'заказать', 'трек', 'песню']);

const ACTION_VERBS = new Set([
  'выкати', 'выкатывай', 'покажи', 'расскажи', 'сделай', 'убей', 'зайди', 'купи', 'ответь', 'скажи',
  'прочитай', 'прочти', 'сходи', 'открой', 'закрой', 'позови', 'ударь', 'прыгни',
]);
const QUESTION_WORDS = new Set(['как', 'почему', 'когда', 'где', 'зачем', 'что', 'кто', 'сколько', 'какой', 'какая', 'какие']);
const SOCIAL_WORDS = new Set([
  'спасибо', 'привет', 'здарова', 'пока', 'лайк', 'лайки', 'ок', 'окей', 'ку', 'хай', 'лол', 'кек', 'го', 'плюс',
]);
const CHAT_WORDS = new Set([
  'привет', 'здарова', 'здравствуйте', 'спасибо', 'удачи', 'лол', 'кек', 'красава', 'красавчик', 'молодец',
  'классно', 'круто', 'стрим', 'стриме', 'стример', 'всем', 'ребята', 'парни', 'ку', 'хай', 'пока', 'добрый',
]);
const PRONOUNS = new Set(['я', 'мы', 'ты', 'вы', 'мне', 'меня', 'тебе', 'вам', 'нас', 'наш', 'мой', 'моя', 'моё']);
const SOCIAL_SUBSTRINGS = ['лайк', 'подпис', 'репост', 'колокольчик'];
const RECOMMEND_PHRASES = [
  'посоветуй', 'подскажи', 'порекомендуй', 'что послушать', 'как называется', 'что за песня',
  'что за трек', 'что играет', 'название песни', 'какая песня',
];

const DASH_RE = /(?:\s[-–—]\s*|\s*[-–—]\s+|(?<=\p{L})[-–—](?=[A-ZА-ЯЁ]))/u;
const DASH_SPLIT_RE = /(?:\s+[-–—]\s*|\s*[-–—]\s+|(?<=\p{L})[-–—](?=[A-ZА-ЯЁ]))/u;
const OST_RE = /(?<![a-zа-яё0-9])(?:original\s+soundtrack|soundtrack|саундтрек|o\.?s\.?t\.?|ост)(?![a-zа-яё0-9])/i;
const FROM_RE = /(?<![a-zа-яё0-9])(?:из|from)\s+(?:the\s+)?(?:фильма|игры|сериала|аниме|мультфильма|movie|film|game|series|show)\s+(.+)$/i;
const FEAT_RE = /(?<![a-zа-яё0-9])(?:feat\.?|ft\.?|featuring|при участии)(?![a-zа-яё0-9])\s*/i;
const BY_RE = /^(.+?)\s+(?:by|от|исполнитель)\s+(.+)$/i;

const VERSION_SUFFIX = '(?:\\s+(?:version|версия|версии|вариант|ver\\.?))?';
const VERSION_DEFS = [
  ['slowed', 'slowed(?:\\s*(?:\\+|and|&)?\\s*reverb|\\s+down)?|слоу(?:д|ед)?(?:\\s*(?:\\+|и)?\\s*реверб)?|замедленн[а-яё]*'],
  ['spedup', 'sped\\s*up|speed(?:ed)?\\s*up|ускоренн[а-яё]*'],
  ['nightcore', 'nightcore|найткор[а-яё]*'],
  ['karaoke', 'karaoke|караоке'],
  ['instrumental', 'instrumental|инструментал[а-яё]*|минусовк[а-яё]*|минус|без\\s+слов'],
  ['remix', 'remix|ремикс[а-яё]*|рэмикс[а-яё]*'],
  ['cover', 'cover|кавер[а-яё]*'],
  ['live', 'live|лайв|жив(?:ая|ой|ое|ую)|концертн[а-яё]*'],
].map(([key, alt]) => ({
  key,
  fullRe: new RegExp(`^(?:${alt})${VERSION_SUFFIX}$`, 'i'),
  endRe: new RegExp(`(?<=^|\\s)(?:${alt})${VERSION_SUFFIX}$`, 'i'),
}));
const VERSION_QUERY_WORD = {
  live: 'live', remix: 'remix', cover: 'cover', instrumental: 'instrumental',
  karaoke: 'karaoke', slowed: 'slowed', spedup: 'sped up', nightcore: 'nightcore',
};

const MAX_SEGMENTS = 5;
const MAX_HYPOTHESES = 10;

// ---------- утилиты ----------

function collapse(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function normToken(token) {
  return token.toLowerCase().replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/g, '');
}

function tidy(s) {
  return collapse(String(s || '')).replace(/^[\s"'«»“”.,:;!\-–—]+|[\s"'«»“”.,:;!\-–—]+$/g, '');
}

function countWords(s) {
  return s.split(/\s+/).filter(Boolean).length;
}

function hasLetters(s) {
  return /[a-zа-яё0-9]/i.test(s);
}

function hasMusicWord(s) {
  return /(?:^|\s)(?:music|музык[а-яё]*|мелоди[а-яё]*)(?=\s|$)/i.test(s);
}

function titleLike(s) {
  const words = String(s || '').split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  if (/^[a-z0-9 '’&.,!?-]{2,60}$/i.test(s) && words.length <= 3 && /[a-z]/i.test(s)) return true; // Numb, Queen
  const caps = words.filter((w) => /^[A-ZА-ЯЁ]/.test(w)).length;
  return words.length >= 2 && caps >= 2; // «Кино Группа крови», но не «На чай»
}

function cleanText(text) {
  return collapse(
    String(text)
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\p{Extended_Pictographic}/gu, ' ')
      .replace(/[«»“”„"]/g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/[–—−]/g, (ch) => (ch === '−' ? '-' : ch)) // длинные тире сохраняем, минус приводим к '-'
  );
}

// ---------- вводные слова и команда ----------

function stripLeadAndTrail(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let start = 0;
  let end = tokens.length;
  let hasVerb = false;
  let firstVerb = '';

  while (start < end) {
    const word = normToken(tokens[start]);
    const next = start + 1 < end ? normToken(tokens[start + 1]) : '';
    if (LEAD_FILLERS.has(word)) { start += 1; continue; }
    if (MUSIC_VERBS.has(word)) {
      hasVerb = true;
      if (!firstVerb) firstVerb = word;
      start += 1;
      continue;
    }
    if (WANT_VERBS.has(word) && WANT_OBJECTS.has(next)) {
      hasVerb = true;
      if (!firstVerb) firstVerb = word;
      start += 2;
      continue;
    }
    if (TRACK_NOUNS.has(word)) { hasVerb = true; start += 1; continue; }
    break;
  }
  while (end > start && TRAILING_FILLERS.has(normToken(tokens[end - 1]))) end -= 1;

  return { rest: tokens.slice(start, end).join(' '), hasVerb, firstVerb };
}

// ---------- ранние отказы: это точно не заказ ----------

function detectNonMusic(fullText, rest, hasVerb, firstVerb) {
  if (!hasLetters(rest)) return hasVerb ? 'NO_TITLE' : 'EMPTY_TEXT';

  const lower = rest.toLowerCase();
  const tokens = rest.split(/\s+/).map(normToken).filter(Boolean);
  const hasDash = DASH_RE.test(rest);

  if (tokens.length > 0 && tokens.every((t) => SOCIAL_WORDS.has(t) || /^а?х[ах]*$/.test(t))) return 'SOCIAL_ONLY';
  if (!hasDash && SOCIAL_SUBSTRINGS.some((p) => lower.includes(p))) return 'SOCIAL_ACTION';

  const fullLower = fullText.toLowerCase();
  if (RECOMMEND_PHRASES.some((p) => fullLower.includes(p))) return 'RECOMMENDATION_REQUEST';

  if (PLAY_VERBS.has(firstVerb) && ['в', 'во', 'на'].includes(tokens[0])) return 'GAME_REQUEST';
  if (!hasDash && ACTION_VERBS.has(tokens[0])) return 'ACTION_COMMAND';
  if (!hasVerb && !hasDash && QUESTION_WORDS.has(tokens[0])) return 'QUESTION_WORD';
  return '';
}

// ---------- несколько песен ----------

function splitSegments(rest) {
  const bullet = /^\s*(?:\d+[.)]|[•*])\s+/;
  let parts = rest.split(/\r?\n|;|\s\|\s/).map((p) => p.replace(bullet, '').trim()).filter(Boolean);

  if (parts.length === 1) {
    const only = parts[0];
    if (DASH_RE.test(only)) {
      const sub = only.split(/\s*(?:,|\s\+\s|\s&\s|\sи\s|\sand\s)\s*/i).map((p) => p.trim()).filter(Boolean);
      if (sub.length >= 2 && sub.every((p) => DASH_RE.test(p))) parts = sub;
    } else if (only.includes(',')) {
      const sub = only.split(/\s*,\s*/).filter(Boolean);
      if (sub.length >= 2 && sub.length <= MAX_SEGMENTS && sub.every((p) => countWords(p) >= 2 && countWords(p) <= 6)) {
        parts = sub;
      }
    }
  }
  return parts.slice(0, MAX_SEGMENTS);
}

// ---------- извлечение частей одной песни ----------

function removeNoise(s) {
  return collapse(
    s
      .replace(/[(\[]\s*(?:official\s*(?:music\s*)?(?:video|audio|clip)?|lyric\s*video|lyrics?|audio|video|клип|текст|hd|4k|remaster(?:ed)?(?:\s*\d{4})?|официальн[а-яё]*\s*клип)\s*[)\]]/gi, ' ')
      .replace(/\s+(?:official\s+(?:music\s+)?(?:video|audio)|lyric\s+video|lyrics|клип|текст\s+песни)\s*$/i, ' ')
  );
}

function extractFeat(s) {
  const m = FEAT_RE.exec(s);
  if (!m) return { s, guests: '' };
  let before = s.slice(0, m.index);
  const after = s.slice(m.index + m[0].length);
  let guests;
  let tail;
  if (/[(\[]\s*$/.test(before)) {
    before = before.replace(/[(\[]\s*$/, '');
    const close = after.search(/[)\]]/);
    guests = close === -1 ? after : after.slice(0, close);
    tail = close === -1 ? '' : after.slice(close + 1);
  } else {
    const delimiter = after.search(/\s[-–—]\s|[(\[]/);
    guests = delimiter === -1 ? after : after.slice(0, delimiter);
    tail = delimiter === -1 ? '' : after.slice(delimiter);
  }
  return { s: collapse(`${before} ${tail}`), guests: tidy(guests) };
}

function matchVersion(text) {
  const found = VERSION_DEFS.find((def) => def.fullRe.test(text));
  return found ? found.key : '';
}

// Версия ищется только в скобках или в конце строки: «Oasis - Live Forever» остаётся названием.
function extractVersion(s) {
  let version = '';
  let out = s.replace(/[(\[]([^)\]]*)[)\]]/g, (whole, inner) => {
    if (version) return whole;
    const key = matchVersion(inner.trim());
    if (!key) return whole;
    version = key;
    return ' ';
  });

  if (!version) {
    const trimmed = out.replace(/[\s.,;:!]+$/, '');
    for (const def of VERSION_DEFS) {
      const m = def.endRe.exec(trimmed);
      if (!m) continue;
      const head = trimmed.slice(0, m.index);
      const rest = head.replace(/[\s\-–—]+$/, '');
      if (!hasLetters(rest)) continue;
      const ownPart = /\s[-–—]\s*$/.test(head);
      if (ownPart && trimmed.split(DASH_SPLIT_RE).length === 2) continue;
      version = def.key;
      out = rest;
      break;
    }
  }
  return { s: collapse(out), version };
}

function splitAroundOst(part) {
  const m = OST_RE.exec(part);
  const before = tidy(part.slice(0, m.index));
  const after = tidy(part.slice(m.index + m[0].length).replace(/^[\s:,\-–—]+/, ''));
  return { before, after };
}

// «Vigilante Hotline Miami OST» без тире: граница названия неизвестна, даём варианты.
function ostSplits(text, markerAtEnd) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const n = tokens.length;
  if (n <= 1) return [{ title: text, context: '' }];
  const out = [];
  for (let k = 1; k <= Math.min(3, n - 1); k += 1) {
    out.push(markerAtEnd
      ? { title: tokens.slice(0, k).join(' '), context: tokens.slice(k).join(' ') }
      : { title: tokens.slice(n - k).join(' '), context: tokens.slice(0, n - k).join(' ') });
  }
  out.push({ title: text, context: '' });
  return out;
}

// Без тире граница исполнителя и названия неизвестна: перечисляем правдоподобные варианты.
function noDashVariants(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const n = tokens.length;
  if (n === 0) return [];
  if (n === 1) return [{ artist: '', title: text }];
  if (n === 2) {
    return [
      { artist: tokens[0], title: tokens[1] },
      { artist: '', title: text },
      { artist: tokens[1], title: tokens[0] },
    ];
  }
  const out = [];
  for (let k = 1; k <= Math.min(3, n - 1); k += 1) {
    out.push({ artist: tokens.slice(0, k).join(' '), title: tokens.slice(k).join(' ') });
  }
  out.push({ artist: '', title: text });
  out.push({ artist: tokens[n - 1], title: tokens.slice(0, n - 1).join(' ') });
  return out;
}

function candidatesFromParts(parts) {
  if (parts.length === 0) return [];
  if (parts.length === 1) return noDashVariants(parts[0]);
  if (parts.length === 2) {
    return [
      { artist: parts[0], title: parts[1] },
      { artist: parts[1], title: parts[0] },
    ];
  }
  return [
    { artist: parts[0], title: parts.slice(1).join(' - ') },
    { artist: parts.slice(0, -1).join(' - '), title: parts[parts.length - 1] },
  ];
}

function buildQueries({ title, artist, version, context, ost, guests }) {
  const base = collapse(`${artist} ${title}`);
  const queries = [base];
  if (guests) queries.push(collapse(`${base} feat. ${guests}`));
  if (version) queries.push(collapse(`${base} ${VERSION_QUERY_WORD[version]}`));
  if (context) {
    const suffix = ost ? ' OST' : '';
    queries.push(collapse(`${title} ${context}${suffix}`));
    if (artist) queries.push(collapse(`${artist} ${title} ${context}`));
  }
  return Array.from(new Set(queries.filter(Boolean))).slice(0, 4);
}

function parseSegment(raw) {
  const info = { dash: false, by: false, version: '', ost: false, feat: false, hypotheses: [] };

  let s = removeNoise(raw);
  const featResult = extractFeat(s);
  s = featResult.s;
  const guests = featResult.guests;
  info.feat = Boolean(guests);

  const versionResult = extractVersion(s);
  s = versionResult.s;
  info.version = versionResult.version;

  let context = '';
  s = s.replace(/[(\[]([^)\]]*)[)\]]/g, (whole, inner) => {
    if (info.ost || !OST_RE.test(inner)) return whole;
    info.ost = true;
    context = tidy(inner.replace(OST_RE, ' '));
    return ' ';
  });
  s = collapse(s);

  if (!info.ost) {
    const fromMatch = FROM_RE.exec(s);
    if (fromMatch) {
      context = tidy(fromMatch[1]);
      s = collapse(s.slice(0, fromMatch.index));
    }
  }

  let parts = s.split(DASH_SPLIT_RE).map(tidy).filter(Boolean);
  info.dash = parts.length >= 2;
  // «Отличного настроения!!! Би-2 - плывет корабль»: слева от тире
  // поздравление и исполнитель; для artist берём последнее предложение.
  if (parts.length >= 2 && /[.!?…]/.test(parts[0])) {
    const tail = parts[0].split(/[.!?…]+/).pop().trim();
    if (tail) parts[0] = tail;
  }

  let candidates;
  const ostIndex = info.ost ? -1 : parts.findIndex((p) => OST_RE.test(p));
  if (ostIndex !== -1) {
    info.ost = true;
    const { before, after } = splitAroundOst(parts[ostIndex]);
    const others = parts.filter((_, i) => i !== ostIndex);
    if (before && after) {
      candidates = [{ artist: others.join(' '), title: before, context: after }];
    } else if (others.length >= 2) {
      // «Vigilante (feat. ...) - Gundam Narrative OST - Hiroyuki Sawano»:
      // первый кусок — название, последний — исполнитель, OST в середине — контекст.
      candidates = [{
        title: others[0],
        artist: others[others.length - 1],
        context: [before, after, ...others.slice(1, -1)].filter(Boolean).join(' '),
      }];
    } else if (others.length === 0) {
      const text = before || after;
      candidates = ostSplits(text, Boolean(before)).map((c) => ({ artist: '', ...c }));
    } else {
      context = before || after;
      parts = others;
    }
  }

  if (!candidates) {
    if (parts.length === 1) {
      const byMatch = BY_RE.exec(parts[0]);
      if (byMatch) {
        info.by = true;
        candidates = [{ artist: tidy(byMatch[2]), title: tidy(byMatch[1]) }];
      }
    }
    if (!candidates) candidates = candidatesFromParts(parts);
  }

  info.hypotheses = candidates
    .map((c) => ({
      title: tidy(c.title),
      artist: tidy(c.artist),
      version: info.version,
      context: tidy(c.context || context),
      ost: info.ost,
      guests,
    }))
    .filter((h) => h.title);
  return info;
}

// ---------- оценка ----------

function shapePoints(words) {
  if (words >= 1 && words <= 8) return 35;
  if (words >= 9 && words <= 14) return 10;
  return 0;
}

function analyzeOrder(text) {
  const nonMusic = (code, conf) => ({
    intent: 'non_music', confidence: conf, hypotheses: [], reasons: [code],
  });

  if (typeof text !== 'string') return nonMusic('EMPTY_TEXT', 0);
  const hadUrl = /https?:\/\/\S+/i.test(text);
  const cleaned = cleanText(text);
  if (!hasLetters(cleaned)) return nonMusic(hadUrl ? 'URL_ONLY' : 'EMPTY_TEXT', 0);

  const { rest, hasVerb, firstVerb } = stripLeadAndTrail(cleaned);
  const blocked = detectNonMusic(cleaned, rest, hasVerb, firstVerb);
  if (blocked) return nonMusic(blocked, 0.05);

  const reasons = [];
  const segmentTexts = splitSegments(rest);
  const segments = segmentTexts.map((seg) => ({ raw: seg, ...parseSegment(seg) }));
  if (segments.every((seg) => seg.hypotheses.length === 0)) return nonMusic('NO_TITLE', 0.05);

  const musicMarker = hasMusicWord(rest);
  const allTokens = rest.split(/\s+/).map(normToken).filter(Boolean);
  const chatHits = allTokens.filter((t) => CHAT_WORDS.has(t) || SOCIAL_WORDS.has(t)).length;
  const segmentScores = segments.map((seg) => {
    const structural = seg.dash || seg.by || seg.ost || seg.feat || seg.version || hasVerb || musicMarker;
    // Без музыкального сигнала короткий бытовой текст не должен получать 35 баллов.
    const plausibleTitle = titleLike(seg.raw) && chatHits === 0;
    let points = structural || plausibleTitle ? shapePoints(countWords(seg.raw)) : 0;
    if (seg.dash) { points += 45; reasons.push('DASH_SEPARATOR'); }
    else if (seg.by) { points += 35; reasons.push('BY_SEPARATOR'); }
    else if (countWords(seg.raw) >= 2 && structural) reasons.push('NO_SEPARATOR_AMBIGUOUS');
    if (seg.version) { points += 20; reasons.push('VERSION_MARKER'); }
    if (seg.ost) { points += 35; reasons.push('OST_MARKER'); }
    if (seg.feat) { points += 15; reasons.push('FEAT_MARKER'); }
    if (musicMarker) { points += 25; reasons.push('MUSIC_MARKER'); }
    if (shapePoints(countWords(seg.raw)) === 0) reasons.push('TOO_LONG');
    return points;
  });

  let points = Math.min(...segmentScores);
  if (hasVerb) { points += 35; reasons.push('MUSIC_VERB'); }
  if (segments.length > 1) { points += 10; reasons.push('MULTIPLE_SONGS'); }

  const tokens = allTokens;
  const hasDash = DASH_RE.test(rest);
  if (chatHits > 0) { points -= Math.min(60, chatHits * 20); reasons.push('CHAT_WORDS'); }
  if (!hasDash && tokens.some((t) => PRONOUNS.has(t))) { points -= 30; reasons.push('SENTENCE_LIKE'); }
  if (rest.includes('?')) { points -= 35; reasons.push('QUESTION_MARK'); }

  const score = Math.max(0, Math.min(99, points));
  const intent = score >= 70 ? 'music' : score >= 30 ? 'maybe' : 'non_music';
  const uniqueReasons = Array.from(new Set(reasons));

  if (intent === 'non_music') {
    return { intent, confidence: score / 100, hypotheses: [], reasons: [...uniqueReasons, 'LOW_SCORE'] };
  }

  const seen = new Set();
  const hypotheses = [];
  segments.forEach((seg, songIndex) => {
    seg.hypotheses.forEach((h) => {
      const key = [songIndex, h.title, h.artist, h.version, h.context].join('|').toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      hypotheses.push({
        title: h.title,
        artist: h.artist,
        version: h.version,
        context: h.context,
        queries: buildQueries(h),
        songIndex,
      });
    });
  });

  return { intent, confidence: score / 100, hypotheses: hypotheses.slice(0, MAX_HYPOTHESES), reasons: uniqueReasons };
}

module.exports = { analyzeOrder };
