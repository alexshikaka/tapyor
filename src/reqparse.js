// Заказы со стрима: поиск песен в сообщениях донатов.
// Песня «точно» найдена, только если и исполнитель, и название найденного трека есть в тексте сообщения.
// Сообщения без тире, ссылки и слов про музыку не ищем вовсе — на стримах большинство донатов не про песни
// (у владельца это заказы кораблей: «Выкати Варяг и Грозу» не должно превращаться в песню «Гроза»).
// Работает в Node (main.js и проверки). Поиск треков делает вызывающий: plan() → запросы, judge() → вердикт.
(function (root) {
  'use strict';
  var STOP = { the: 1, a: 1, an: 1, feat: 1, ft: 1, featuring: 1, ost: 1, official: 1, video: 1, audio: 1, lyrics: 1, lyric: 1, hd: 1, hq: 1, 'клип': 1, music: 1, mv: 1, 'и': 1, '&': 1, x: 1, vs: 1 };
  // Слова-просьбы и вежливость — выкидываем из поискового запроса
  var FILLER = ['шикака', 'шикаке', 'шикаку', 'поставь', 'поставьте', 'поставить', 'включи', 'включите', 'включай', 'включайте', 'врубай', 'врубайте', 'вруби', 'запусти', 'играй', 'сыграй', 'пожалуйста', 'пожалуста', 'плиз', 'пж', 'пжл', 'плз', 'please', 'pls', 'plz', 'песню', 'песня', 'песни', 'трек', 'трека', 'треки', 'музыку', 'музыка', 'музыки', 'музон', 'song', 'track', 'play', 'привет', 'приветик', 'хай', 'ку', 'всем', 'давай', 'можно', 'хочу', 'заказываю', 'заказ', 'заказать', 'закажи', 'заказывайте', 'донат', 'донатик', 'от', 'для', 'тебя', 'меня', 'нас', 'спасибо', 'немного', 'что', 'нибудь', 'нить', 'то', 'какую', 'нибуть', 'еще', 'ещё', 'тоже', 'плиииз', 'бро', 'брат', 'стрим', 'стрима', 'чат', 'чату', 'срочно', 'как', 'где', 'когда', 'почему', 'зачем', 'кто', 'дела', 'дело', 'это', 'так', 'тут', 'там', 'сейчас', 'сегодня', 'ребята', 'парни', 'девчонки', 'мужики', 'пацаны', 'друзья', 'зрители', 'подписчики'];
  // Слова, по которым понятно, что просят музыку (без них и без тире/ссылки сообщение не ищем)
  var MUSIC_RX = /(песн|трек|музык|музон|мелоди|клип|song|track|music|♪|🎵|🎶|(?:^|[^\p{L}])(?:поставь|поставьте|включи|включите|включай|включайте|врубай|врубайте|вруби|запусти|играй|сыграй|!sr|sr)(?![\p{L}]))/iu;
  var URL_RX = /(https?:\/\/[^\s<>"']+|(?:www\.)?(?:youtu\.be|youtube\.com|music\.youtube\.com|music\.yandex\.(?:ru|com|by|kz)|vk\.com|vk\.ru|soundcloud\.com|on\.soundcloud\.com|t\.me|open\.spotify\.com|[a-z0-9-]+\.bandcamp\.com)\/[^\s<>"']*)/gi;
  // Латиница и кириллица, которые выглядят одинаково (Erа с русской «а» → Era)
  var CYR2LAT = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X' };
  var LAT2CYR = {}; Object.keys(CYR2LAT).forEach(function (k) { if (!LAT2CYR[CYR2LAT[k]]) LAT2CYR[CYR2LAT[k]] = k; });

  function fixMixedWord(w) {
    var lat = (w.match(/[a-z]/gi) || []).length, cyr = (w.match(/[а-яё]/gi) || []).length;
    if (!lat || !cyr) return w;
    var map = lat >= cyr ? CYR2LAT : LAT2CYR;
    return w.split('').map(function (ch) { return map[ch] || ch; }).join('');
  }
  // Подготовка текста: склейки «ШутКороль» → «Шут Король», смешанные буквы, звёздочки цензуры, эмодзи
  function prep(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/([а-яё])([А-ЯЁ])/g, '$1 $2')
      .replace(/([a-z])([A-Z][a-z])/g, '$1 $2')
      .replace(/[\p{L}\p{N}]+/gu, fixMixedWord)
      .replace(/[\u{1F000}-\u{1FAFF}☀-➿]/gu, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е')
      .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function normAll(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  var TOKEN_ALIAS = {
    'рамштайн':'rammstein', 'пусси':'pussy', 'эминем':'eminem', 'линкинпарк':'linkin park',
    'слипкнот':'slipknot', 'вархамер':'warhammer', 'радиотапок':'radiotapok',
    'радио':'radio', 'тапок':'tapok', 'вин':'win', 'vin':'win', 'невер':'never',
    'линкин':'linkin', 'парк':'park'
  };
  function tokens(s) {
    return norm(s).split(' ').filter(Boolean).flatMap(function (t) { return (TOKEN_ALIAS[t] || t).split(' '); }).filter(function (t) { return t && !STOP[t]; });
  }
  function lev1(a, b) { // расстояние правки не больше 1
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++d > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return d + (a.length - i) + (b.length - j) <= 1;
  }
  // Простая транслитерация для сравнения «Nautilus» и «Наутилус».
  var TRANSLIT = { а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'kh', ц:'ts', ч:'ch', ш:'sh', щ:'shch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya' };
  function translit(s) { return String(s || '').toLowerCase().split('').map(function (ch) { return TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch; }).join(''); }

  var ALIAS = { 'эминем':'eminem', 'рамштайн':'rammstein', 'радиотапок':'radiotapok', 'радио тапок':'radio tapok', 'радио':'radio', 'тапок':'tapok', 'линкинпарк':'linkin park', 'слипкнот':'slipknot' };
  function alias(s) { return ALIAS[s] || s; }
  // Слово совпадает с учётом окончаний («кукушку» ≈ «кукушка») и одной опечатки в длинных словах
  function tokEq(a, b) {
    if (a === b) return true;
    if (alias(a) === alias(b)) return true;
    if (translit(alias(a)) === translit(alias(b))) return true;
    var n = Math.min(a.length, b.length);
    if (n >= 4) { var p = 0; while (p < n && a[p] === b[p]) p++; if (p >= Math.max(4, Math.max(a.length, b.length) - 2)) return true; }
    if (Math.max(a.length, b.length) >= 5 && lev1(a, b)) return true;
    return false;
  }
  function frac(need, have) {
    if (!need.length) return 0;
    var k = 0; need.forEach(function (t) { if (have.some(function (h) { return tokEq(t, h); })) k++; });
    return k / need.length;
  }
  function isFiller(w) { return FILLER.indexOf(w) >= 0; }
  function requestTokens(s) { return tokens(prep(s)).filter(function (t) { return t && !isFiller(t); }); }

  // Тире между словами: « - », « — », «- », «-» между буквами («Nirvana-Smells»). Не «BB-67», не «х-90».
  var DASH_RX = /([\p{L}\p{N}'’?!.)»"]) ?[-–—]{1,2} ?(?=[\p{L}«"(])|([\p{L}\p{N}]) [-–—]{1,2}(?=[\p{L}\p{N}«"(])/gu;

  function splitChunks(text) {
    // по строкам, «;», «+», «/» и запятой — если в каждом куске своё тире
    var parts = text.split(/\n|;|\s\+\s|\s\/\s/);
    var out = [];
    parts.forEach(function (p) {
      var commas = p.split(/,\s*/);
      var dashed = commas.filter(function (c) { DASH_RX.lastIndex = 0; return DASH_RX.test(c); });
      if (commas.length > 1 && dashed.length >= 2) out.push.apply(out, commas); else out.push(p);
    });
    return out.map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function lastWords(s, n) { var w = s.split(' ').filter(Boolean); return w.slice(Math.max(0, w.length - n)).join(' '); }
  function firstWords(s, n) { return s.split(' ').filter(Boolean).slice(0, n).join(' '); }
  function clip(s) { return s.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/[«»"“”]/g, ' ').replace(/\s+/g, ' ').trim(); }
  // «Король и Шут Король и Шут» (склейка при копировании) → «Король и Шут»
  function dedupe(s) { var w = s.split(' '); var h = w.length / 2; if (w.length >= 2 && w.length % 2 === 0 && w.slice(0, h).join(' ').toLowerCase() === w.slice(h).join(' ').toLowerCase()) return w.slice(0, h).join(' '); return s; }
  function dropFiller(s) { return s.split(' ').filter(function (w) { return w && !isFiller(normAll(w)); }).join(' '); }

  // Из одного куска с тире — запросы для поиска (с разной обрезкой лишнего слева и справа)
  function dashQueries(chunk) {
    // Составной заказ: «Название (feat. ...) - OST - Исполнитель».
    // Тире здесь разделяет не исполнителя и название, а части описания.
    var segs = chunk.split(/\s[-–—]{1,2}\s/).map(function (s){ return dropFiller(clip(s)); }).filter(function (s){ return /\p{L}/u.test(s); });
    if (segs.length >= 3) {
      var title = dedupe(segs[0]), artist = segs[segs.length - 1], middle = segs.slice(1, -1).join(' ').trim();
      var out2 = [];
      function add2(q, w) { if (q && /\p{L}/u.test(q)) out2.push({ query: q.trim(), kind: 'dash', w: w || 0 }); }
      add2(title + ' ' + artist, 0);
      if (middle) {
        add2(title + ' ' + middle + ' ' + artist, 1);
        add2(title + ' ' + middle, 2);
        add2(artist + ' ' + title, 3);
      }
      return out2;
    }
    var m, out = [];
    DASH_RX.lastIndex = 0;
    while ((m = DASH_RX.exec(chunk))) {
      var cut = m.index + (m[1] || m[2] || '').length;
      var left = chunk.slice(0, cut), right = chunk.slice(m.index + m[0].length);
      // слева — после последней точки/восклицания/вопроса; справа — до конца предложения
      left = left.split(/[.!?…:]+/).pop();
      right = right.split(/[.!?…]+(?:\s|$)/)[0];
      left = dedupe(dropFiller(clip(left))); right = dropFiller(clip(right));
      if (!/\p{L}/u.test(left) || !/\p{L}/u.test(right)) continue;
      var lw = left.split(' ').length, rw = right.split(' ').length;
      var R = rw > 3 ? [firstWords(right, 2), firstWords(right, 3), firstWords(right, 6)] : [right];
      var L = lw <= 2 ? [left] : lw <= 4 ? [left, lastWords(left, 2), lastWords(left, 1)] : [lastWords(left, 2), lastWords(left, 4), lastWords(left, 1)];
      // сначала короткие сочетания: лишние слова мешают поиску сильнее, чем недостающие
      L.forEach(function (l, i) { R.forEach(function (r, j) { out.push({ query: (l + ' ' + r).trim(), kind: 'dash', w: i + j }); }); });
    }
    return out;
  }

  // План поиска для сообщения: ссылки, запросы по тире, запросы по словам про музыку.
  // signal: 'link' | 'dash' | 'music' | 'latin' | 'none'
  function plan(message) {
    var raw = String(message || '');
    var links = (raw.match(URL_RX) || []).map(function (u) { return /^https?:/i.test(u) ? u : 'https://' + u; });
    var text = prep(raw.replace(URL_RX, ' '));
    var queries = [], seen = {};
    function add(q) { var k = normAll(q.query); if (!k || seen[k] || k.length < 3) return; seen[k] = 1; queries.push(q); }
    // Название в кавычках — самый явный сигнал: «Терентий», «моряк с Ордынки».
    var quoteRx = /[«"“]([^»"”]{2,90})[»"”]/g, qm;
    while ((qm = quoteRx.exec(text))) {
      var inner = qm[1].replace(/\s+/g, ' ').trim();
      if (inner.split(' ').length <= 12) add({ query: inner, kind: 'quote' });
    }
    // Если пользователь скопировал полное название ролика, ищем его целиком.
    // Это важнее любых разборов: YouTube отлично находит точную строку.
    var whole = text.replace(/\s+/g, ' ').trim();
    var dashN = (whole.match(/[-–—]/g) || []).length;
    // Только для сложной скопированной строки, а не для обычного «Кино - Группа крови».
    // Строку с несколькими заказами целиком не ищем: там другой chunk.
    if (!links.length && !/[;\n|]/.test(whole) && whole.split(' ').length >= 4 && (dashN >= 2 || /(?<![\p{L}\p{N}])(?:ost|саундтрек|feat\.?|ft\.?)(?![\p{L}\p{N}])/iu.test(whole) || /\s\/\s/.test(whole))) {
      var rawQ = dropFiller(whole).replace(/\s+/g, ' ').trim();
      if (rawQ) add({ query: rawQ, kind: 'raw' });
    }
    // Копия названия с YouTube: [Serious Sam 3 на русском] Hero [Onsa Media].
    // Скобки нельзя просто вырезать — в них часто и есть название.
    var bracketRx = /\[([^\]]{2,90})\]\s*([^\[\]]{0,50})/g, bm;
    var firstBracket = text.indexOf('[');
    if (firstBracket > 0) {
      var pre = dropFiller(clip(text.slice(0, firstBracket))).replace(/\s+/g, ' ').trim();
      pre = pre.replace(/^(?:на|для|мне|под|в|с)\s+\S+\s+/iu, '').replace(/\s+и\s*$/iu, '').trim();
      if (pre.split(' ').length >= 3) {
        add({ query: pre, kind: 'quote' });
        var tailQ = lastWords(pre, 8);
        if (tailQ && tailQ !== pre) add({ query: tailQ, kind: 'quote' });
      }
    }
    while ((bm = bracketRx.exec(text))) {
      var inner = bm[1].replace(/\s+/g, ' ').trim();
      var tail = bm[2].replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
      if (inner.split(' ').length >= 2) add({ query: (inner + ' ' + tail).replace(/[.,;:]+$/g, '').trim(), kind: 'quote' });
    }
    // Несколько заказов через «и»: Doom ... и Serious Sam ...
    if (/\s+и\s+/i.test(text)) {
      text.split(/\s+и\s+/i).forEach(function (part) {
        var q = dropFiller(clip(part)).replace(/\s+/g, ' ').trim();
        q = q.replace(/[.,;:]+$/g, '').trim();
        if (q.split(' ').length >= 3 && q.split(' ').length <= 12) add({ query: q, kind: 'quote' });
      });
    }
    splitChunks(text).forEach(function (c, ci) { dashQueries(c).sort(function (x, y) { return x.w - y.w; }).forEach(function (q) { q.chunk = ci; add(q); }); });
    var signal = links.length ? 'link' : queries.length ? 'dash' : 'none';
    if (!queries.length && MUSIC_RX.test(text)) {
      signal = links.length ? 'link' : 'music';
      var ms = text.split(/[.!?…\n;]+|\)\)+/).map(function (s) { return dropFiller(clip(s)).replace(/^[,\s]+|[,\s]+$/g, '').replace(/[.,;:]+$/g, '').trim(); }).filter(Boolean);
      ms.forEach(function (q, i) {
        var wn = q.split(' ').length;
        if (wn >= 2 && wn <= 12) add({ query: q, kind: 'music' });
        // «Инстасамка. За деньги да» — исполнитель и название в соседних фразах.
        if (i + 1 < ms.length) {
          var nw = ms[i + 1].split(' ').length;
          if ((wn === 1 && nw >= 2 && nw <= 8) || (wn >= 2 && nw === 1)) add({ query: q + ' ' + ms[i + 1], kind: 'music' });
        }
      });
    }
    // Коротко и латиницей («NIGHTWISH Amaranth») — пробуем, но засчитываем только точное совпадение
    if (!queries.length && !links.length && /^[a-z0-9 '’&.,!?-]{4,60}$/i.test(text) && text.split(' ').length <= 6 && /[a-z]{3}/i.test(text)) {
      signal = 'latin'; add({ query: clip(text), kind: 'latin' });
    }
    // Совсем без тире и без слов про музыку («кино печаль»): пробуем сочетания слов.
    // Одиночные слова не ищем — заказы кораблей («Выкати Варяг и Грозу») не должны становиться песнями.
    if (!queries.length && !links.length) {
      var combos = 0;
      text.split(/[.!?…\n;]+|\)\)+/).forEach(function (s) {
        // только слова от 3 букв: «за», «ты», «не» в поиск не годятся
        var words = dropFiller(clip(s)).replace(/[,\s]+/g, ' ').trim().split(' ').filter(function (w) {
          var n = normAll(w);
          return n && n.length > 2 && !STOP[n] && !isFiller(n);
        });
        if (words.length < 2 || words.length > 6) return;
        // сначала вся фраза целиком — она точнее всего
        add({ query: words.slice(0, Math.min(words.length, 4)).join(' '), kind: 'combo' });
        for (var len = 2; len <= 3; len++) {
          for (var i = 0; i + len <= words.length && combos < 3; i++) {
            add({ query: words.slice(i, i + len).join(' '), kind: 'combo' });
            combos++;
          }
        }
      });
      if (queries.length) signal = 'combo';
    }
    return { links: links, queries: queries.slice(0, 12), signal: signal, text: text };
  }

  // Название ролика часто содержит «Official Video», год, канал и теги.
  // Для сравнения убираем их, иначе точное совпадение песни не засчитывается.
  function cleanTitleForMatch(s) {
    return String(s || '')
      .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
      .replace(/@[\w.-]+/g, ' ')
      .replace(/\.(?:mp4|wmv|avi|mov|webm|mkv|mp3|flac|wav)\b/gi, ' ')
      .replace(/(?<![\p{L}\p{N}])(?:official\s*(?:music\s*)?(?:video|audio)|lyric\s*video|lyrics?|audio|video|hd|hq|4k|remaster(?:ed)?|\d{4}|поёт|поет|исполняет|песня|трек)(?![\p{L}\p{N}])/giu, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Насколько найденный трек подтверждается текстом сообщения
  function judge(message, track, query) {
    var have = tokens(prep(message));
    var tt = tokens(cleanTitleForMatch(track.title)), at = tokens(track.author);
    if (!tt.length) return { level: 'none', t: 0, a: 0 };
    var t = frac(tt, have), a = at.length ? frac(at, have) : 0;
    // Все значимые слова заказа должны найтись в названии/исполнителе.
    // Лишние слова ролика («Nottoys», «Chi Mai», «OST») не должны мешать.
    var core = requestTokens(query || message);
    var coreCover = core.length ? frac(core, tt.concat(at)) : 0;
    var coreExact = core.length >= 2 && coreCover >= 0.99;
    // Канал/лишний тег в заголовке не должен требовать своего присутствия в сообщении.
    var channelOnly = at.filter(function (x) { return !have.some(function (y) { return tokEq(x, y); }); });
    var titleCore = tt.filter(function (x) { return !channelOnly.some(function (y) { return tokEq(x, y); }); });
    var titleCover = titleCore.length ? frac(titleCore, core) : 0;
    var titleExact = titleCore.length >= 2 && titleCover >= 0.99 && (track.src === 'yt' || a >= 0.99 || at.length >= 3);
    // У YouTube в author лежит канал, а не исполнитель. Если название полностью совпало,
    // канал не должен мешать точному совпадению; иначе «Skai» превращает верный трек в doubt.
    var exact = coreExact || titleExact || (t >= 0.99 && (track.src === 'yt' || a >= 0.99 || (at.length >= 3 && a >= 0.66)));
    var level = exact ? 'exact' : (t >= 0.99 || (t >= 0.5 && a >= 0.5)) ? 'doubt' : 'none';
    return { level: level, t: t, a: a };
  }

  // Пометки спорного трека. rules: { maxSec, stopWords:[...], explicitOk }
  var NONMUSIC = /(обзор|review|(?<![\p{L}\p{N}])стрим(?![\p{L}\p{N}])|stream|gameplay|геймплей|летсплей|let'?s ?play|прохожден|подкаст|podcast|интервью|interview|реакци|reaction|трейлер|trailer|новост|(?<![\p{L}\p{N}])news(?![\p{L}\p{N}])|выпуск|tutorial|гайд|guide|туториал|asmr|аудиокниг|audiobook|пранк|prank|compilation|подборк|сборник|(?<![\p{L}\p{N}])mix(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])микс(?![\p{L}\p{N}])|\d+\s*(hours?|час)|full album|полный альбом|nonstop|non-stop|best of|лучшее за)/iu;
  var TROLL = /(ear ?rape|earrape|громк\S* звук|скример|screamer|bass ?boosted|басс ?буст|loud|орущ|крик)/i;
  var VERSION = /(?<![\p{L}\p{N}])(remix|ремикс|sped ?up|speed ?up|slowed|nightcore|cover|кавер|live|лайв|karaoke|караоке|8d|reverb|instrumental|минус|phonk ?remix|mashup|мэшап)(?![\p{L}\p{N}])/iu;
  function stopHit(words, hay) {
    var h = ' ' + normAll(hay) + ' ';
    for (var i = 0; i < (words || []).length; i++) {
      var w = normAll(words[i]); if (!w) continue;
      if (w.length <= 4 ? h.indexOf(' ' + w + ' ') >= 0 : h.indexOf(' ' + w) >= 0) return words[i];
    }
    return '';
  }
  function flags(track, message, rules) {
    rules = rules || {};
    var out = [], hay = (track.author || '') + ' ' + (track.title || '') + ' ' + (track.album || '');
    var maxSec = rules.maxSec == null ? 420 : rules.maxSec;
    if (maxSec && track.seconds && track.seconds > maxSec) out.push({ k: 'long', t: 'длинный: ' + fmt(track.seconds) });
    if (track.explicit && !rules.explicitOk) out.push({ k: 'explicit', t: '18+' });
    var s = stopHit(rules.stopWords, hay);
    if (s) out.push({ k: 'stop', t: 'стоп-лист: ' + s });
    if (NONMUSIC.test(track.title || '') && !NONMUSIC.test(message || '')) out.push({ k: 'nonmusic', t: 'не музыка?' });
    if (TROLL.test(hay)) out.push({ k: 'troll', t: 'троллинг?' });
    var v = (track.title || '').match(VERSION);
    if (v && !new RegExp('(?<![\\p{L}\\p{N}])' + v[1].replace(/\s/g, '\\s?') + '(?![\\p{L}\\p{N}])', 'iu').test(message || '')) out.push({ k: 'version', t: 'не та версия: ' + v[1].toLowerCase() });
    return out;
  }
  function fmt(sec) { sec = Math.round(sec || 0); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s; }

  // Сколько треков оплачено. price — цена в валюте стримера; amount — сумма в ней же (или null, если валюта другая)
  function paidCount(amount, price) { if (!price || amount == null) return Infinity; return Math.floor((amount + 0.001) / price); }

  // Стоп-лист по умолчанию (владелец: «ничего связанного с расизмом и ЛГБТ»). Срабатывает по словам в названии,
  // исполнителе и альбоме — стример правит список в настройках.
  var DEFAULT_STOP = ['лгбт', 'lgbt', 'lgbtq', 'pride', 'прайд', 'gay', 'гей', 'геи', 'лесби', 'lesbian', 'трансгендер', 'transgender', 'queer', 'квир', 'rainbow pride', 'white power', 'white pride', 'sieg heil', 'зиг хайль', 'расист', 'racist', 'нацист', 'nazi', 'kkk', 'ку клукс'];

  var api = { plan: plan, judge: judge, flags: flags, paidCount: paidCount, prep: prep, tokens: tokens, tokEq: tokEq, fmt: fmt, DEFAULT_STOP: DEFAULT_STOP, MUSIC_RX: MUSIC_RX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TapReq = api;
})(this);
