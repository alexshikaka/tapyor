'use strict';
// «Кракозябры» в названиях своих плейлистов (0.34.0).
// Причина (расследование MOJIBAKE-034): settings.json когда-то перекодировали ВНЕ Тапёра —
// UTF-8 прочитали как Windows-1251 и записали обратно. Здесь только обратное преобразование:
// cp1251 → байты → UTF-8. Без iconv и без require('electron'), чтобы покрыть тестами.

// Windows-1251, байты 0x80–0xFF. 0x98 в кодировке не определён.
const HIGH = [
  0x0402, 0x0403, 0x201A, 0x0453, 0x201E, 0x2026, 0x2020, 0x2021, 0x20AC, 0x2030, 0x0409, 0x2039, 0x040A, 0x040C, 0x040B, 0x040F,
  0x0452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0, 0x2122, 0x0459, 0x203A, 0x045A, 0x045C, 0x045B, 0x045F,
  0x00A0, 0x040E, 0x045E, 0x0408, 0x00A4, 0x0490, 0x00A6, 0x00A7, 0x0401, 0x00A9, 0x0404, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x0407,
  0x00B0, 0x00B1, 0x0406, 0x0456, 0x0491, 0x00B5, 0x00B6, 0x00B7, 0x0451, 0x2116, 0x0454, 0x00BB, 0x0458, 0x0405, 0x0455, 0x0457,
];
for (let i = 0xC0; i <= 0xFF; i++) HIGH.push(0x0410 + (i - 0xC0));
const DEC = [];           // байт → символ
const ENC = new Map();    // код символа → байт
for (let b = 0; b < 0x80; b++) { DEC[b] = String.fromCharCode(b); ENC.set(b, b); }
for (let b = 0x80; b <= 0xFF; b++) {
  const cp = HIGH[b - 0x80];
  if (!cp) continue;      // 0x98
  DEC[b] = String.fromCharCode(cp);
  ENC.set(cp, b);
}

function byteOf(ch) {
  const cp = ch.codePointAt(0);
  return ENC.has(cp) ? ENC.get(cp) : -1;
}

// Строка похожа на UTF-8, прочитанный как cp1251: пары «Р»/«С» + символ из
// диапазона продолжения (0x80–0xBF). Две пары — чтобы «Р°» или «С» в обычном
// тексте не считались порчей.
function looksBroken(s) {
  if (typeof s !== 'string' || s.length < 2) return false;
  let n = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    if (a !== 'Р' && a !== 'С') continue;
    const b = byteOf(s[i + 1]);
    if (b >= 0x80 && b <= 0xBF) n++;
  }
  return n >= 2;
}

// Строгий UTF-8: никаких U+FFFD, переполнений и суррогатов. null — байты не UTF-8.
function decodeUtf8(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { out.push(String.fromCharCode(b)); i++; continue; }
    let len = 0, cp = 0;
    if (b >= 0xC2 && b <= 0xDF) { len = 2; cp = b & 0x1F; }
    else if (b >= 0xE0 && b <= 0xEF) { len = 3; cp = b & 0x0F; }
    else if (b >= 0xF0 && b <= 0xF4) { len = 4; cp = b & 0x07; }
    else return null;
    if (i + len > bytes.length) return null;
    for (let j = 1; j < len; j++) {
      const c = bytes[i + j];
      if (c < 0x80 || c > 0xBF) return null;
      cp = (cp << 6) | (c & 0x3F);
    }
    if (len === 3 && (cp < 0x800 || (cp >= 0xD800 && cp <= 0xDFFF))) return null;
    if (len === 4 && (cp < 0x10000 || cp > 0x10FFFF)) return null;
    out.push(String.fromCodePoint(cp));
    i += len;
  }
  return out.join('');
}

// Обратное преобразование только если оно без потерь: все символы есть в cp1251,
// результат — валидный UTF-8 без U+FFFD и сам уже не выглядит испорченным.
function fix(s) {
  if (!looksBroken(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const b = byteOf(ch);
    if (b < 0) return s;
    bytes.push(b);
  }
  const out = decodeUtf8(bytes);
  if (out == null || out.indexOf('\uFFFD') >= 0) return s;
  if (looksBroken(out)) return s;
  return out;
}

// Сколько испорченных строк в одной записи (плейлисте или треке): title, author, album.
function brokenIn(obj) {
  let n = 0;
  if (!obj || typeof obj !== 'object') return 0;
  for (const k of ['title', 'author', 'album']) if (looksBroken(obj[k])) n++;
  return n;
}

// Испорченные строки плейлиста вместе с его треками.
function brokenInList(m) {
  let n = brokenIn(m);
  if (m && Array.isArray(m.tracks)) for (const t of m.tracks) n += brokenIn(t);
  return n;
}

// Что испорчено и что из этого можно починить.
// own — строки своих плейлистов (src:'tap'): только их и правим;
// fixable / unfixable — из own те, что восстановятся без потерь, и те, что нет;
// foreign — испорченные строки чужих плейлистов: их программа не трогает.
function scan(lists) {
  const r = { total: 0, own: 0, fixable: 0, unfixable: 0, foreign: 0 };
  if (!Array.isArray(lists)) return r;
  for (const m of lists) {
    if (!m || typeof m !== 'object') continue;
    const own = m.src === 'tap';
    const objs = [m].concat(Array.isArray(m.tracks) ? m.tracks : []);
    for (const o of objs) {
      if (!o || typeof o !== 'object') continue;
      for (const k of ['title', 'author', 'album']) {
        if (!looksBroken(o[k])) continue;
        r.total++;
        if (!own) { r.foreign++; continue; }
        r.own++;
        if (fix(o[k]) !== o[k]) r.fixable++; else r.unfixable++;
      }
    }
  }
  return r;
}

// Сколько строк в своих плейлистах выглядят испорченными.
function countBroken(lists) {
  return scan(lists).own;
}

// Исправить только свои плейлисты (src:'tap'). Чужие и служебные поля не трогаем.
// Возвращает:
//   lists   — новый список плейлистов;
//   fixed   — сколько строк изменилось;
//   failed  — сколько своих испорченных строк восстановить не удалось;
//   skipped — сколько испорченных строк пропущено, потому что они в чужих плейлистах.
function fixLists(lists) {
  const res = { lists: [], fixed: 0, failed: 0, skipped: 0 };
  if (!Array.isArray(lists)) return res;
  for (const m of lists) {
    if (!m || m.src !== 'tap') {
      res.skipped += brokenInList(m);
      res.lists.push(m);
      continue;
    }
    const o = Object.assign({}, m);
    for (const k of ['title', 'author', 'album']) {
      if (typeof o[k] !== 'string') continue;
      const f = fix(o[k]);
      if (f !== o[k]) { o[k] = f; res.fixed++; }
      else if (looksBroken(o[k])) res.failed++;
    }
    if (Array.isArray(m.tracks)) {
      o.tracks = m.tracks.map(function (t) {
        if (!t || typeof t !== 'object') return t;
        const x = Object.assign({}, t);
        for (const k of ['title', 'author', 'album']) {
          if (typeof x[k] !== 'string') continue;
          const f = fix(x[k]);
          if (f !== x[k]) { x[k] = f; res.fixed++; }
          else if (looksBroken(x[k])) res.failed++;
        }
        return x;
      });
    }
    res.lists.push(o);
  }
  return res;
}

module.exports = { looksBroken, fix, scan, countBroken, fixLists };
