// Чистые функции проверки установщика (без файловой системы — их покрывают unit-тесты).
// Список шаблонов секретов — один на всю программу: src/secret-patterns.js, второй копии нет.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SECRETS = require('../../src/secret-patterns.js');

const TEXT_EXT = /\.(json|js|mjs|cjs|txt|md|html|css|yml|yaml|xml|ini|cfg|conf|toml|csv|ts|tsx|jsx|map|env|properties)$/i;
const BINARY_EXT = /\.(exe|dll|node|so|dylib|bin|png|jpe?g|gif|ico|wav|mp3|ogg|webm|mp4|woff2?|ttf|otf|zip|7z|asar|pak|dat|db|sqlite)$/i;

// Считать ли файл текстовым. Расширение решает в первую очередь; без расширения смотрим,
// есть ли нулевые байты (у двоичных они почти всегда есть в начале).
export function isProbableText(name, buf) {
  const n = String(name || '');
  if (TEXT_EXT.test(n)) return true;
  if (BINARY_EXT.test(n)) return false;
  const bytes = buf || Buffer.alloc(0);
  if (!bytes.length) return true;
  const limit = Math.min(bytes.length, 4096);
  for (let i = 0; i < limit; i++) if (bytes[i] === 0) return false;
  return true;
}

// Чужие пакеты (node_modules) в установщик входят, но наши ключи туда не попадают, а шаблоны
// cookie/authorization совпадают с обычным кодом библиотек (`cookie: jar.getCookieStringSync(`).
// Поэтому секреты ищем только в своих файлах, а node_modules пропускаем.
export function isDependencyPath(p) {
  return /^[\\/]?node_modules[\\/]/i.test(String(p));
}

// Как в tools/scan-secrets.mjs: разрешение даётся по хешу самого значения, а не строки-пометки.
// Для шаблона «слово + 32 hex» значением считается сам hex, иначе — всё совпадение.
function valueForHash(match) {
  return (String(match).match(/[0-9a-f]{32}/i) || [String(match)])[0];
}

// Ищет секреты в тексте. Возвращает только номера строк и правил — значения не выносим наружу,
// чтобы случайно не напечатать ключ в логе сборки.
export function findSecrets(text, { patterns = SECRETS.SECRET_PATTERNS, allowedHashes = SECRETS.ALLOWED_SECRET_HASHES } = {}) {
  const s = String(text == null ? '' : text);
  const found = [];
  for (let i = 0; i < patterns.length; i++) {
    const [re] = patterns[i];
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    for (const m of s.matchAll(new RegExp(re.source, flags))) {
      if (/REDACTED/.test(m[0])) continue;
      const hash = createHash('sha256').update(valueForHash(m[0])).digest('hex');
      if (allowedHashes && allowedHashes.has(hash)) continue;
      found.push({ line: s.slice(0, m.index).split('\n').length, rule: i });
    }
  }
  return found;
}

// В установщике не нужны документы, инструменты и служебные файлы репозитория.
// public/ — витрина открытого репозитория (README, SECURITY, картинки), package-lock.json — lockfile.
export const JUNK = /^[\\/](?:docs|tests|tools|server|\.github|public)[\\/]|^[\\/]package-lock\.json$|^[\\/][^\\/]+\.(?:md|cmd|mjs)$/i;

export function findJunk(paths) {
  return (paths || []).map((p) => String(p)).filter((p) => JUNK.test(p));
}

// Один и тот же файл попал и в app.asar, и в extraResources (так yt-dlp лежал дважды).
// Сравниваем по содержимому (sha256) и размеру, а не по имени: пустые файлы не считаем.
// Публичный ключ чтения Last.fm (CLAUDE.md, «Ключи и секреты»: lastfm.json — публичный ключ чтения, лежит в
// установщике по замыслу). Разрешён ровно один вид файла: extraResources/lastfm.json, в котором только поле
// apiKey из 32 шестнадцатеричных знаков. Любое другое поле или другой вид значения — по-прежнему находка.
export function isPublicLastfmKey(shownPath, text) {
  if (!/(^|\/)lastfm\.json$/i.test(String(shownPath || ''))) return false;
  let j;
  try { j = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return false; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  const keys = Object.keys(j);
  return keys.length === 1 && keys[0] === 'apiKey' && /^[0-9a-f]{32}$/i.test(String(j.apiKey));
}

// src/google-oauth.json в сборке — открытый clientId Google и адрес облачной функции-посредника; секрет Google
// живёт только в переменных облачной функции (CLAUDE.md, «Ключи и секреты»). Разрешён ровно такой вид файла:
// поля clientId (вида <цифры>-<код>.apps.googleusercontent.com) и, необязательно, proxyUrl (https) — больше ничего.
// Найдено на сборке 0.36.0 (13.11): после B7a проверка смотрит все текстовые файлы, и шаблон clientId
// из secret-patterns остановил выпуск.
export function isPublicGoogleOauth(shownPath, text) {
  if (!/(^|[\\/])src[\\/]google-oauth\.json$/i.test(String(shownPath || ''))) return false;
  let j;
  try { j = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return false; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  const keys = Object.keys(j);
  if (!keys.includes('clientId') || keys.some((k) => k !== 'clientId' && k !== 'proxyUrl')) return false;
  if (!/^[0-9]{6,}-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(String(j.clientId))) return false;
  if ('proxyUrl' in j && j.proxyUrl !== '' && !/^https:\/\/[^\s"']+$/.test(String(j.proxyUrl))) return false;
  return true;
}

export function findDuplicates(asarEntries, extraEntries) {
  const asar = (asarEntries || []).filter((e) => e && e.sha256 && e.size > 0);
  const dups = [];
  for (const extra of (extraEntries || [])) {
    if (!extra || !extra.sha256 || !extra.size) continue;
    const matches = asar.filter((e) => e.sha256 === extra.sha256 && e.size === extra.size);
    if (matches.length) dups.push({ extra: extra.path, asar: matches.map((e) => e.path) });
  }
  return dups;
}
