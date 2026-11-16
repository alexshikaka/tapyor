// Проверки снимка для открытого репозитория: пути ПК, имена пользователя и ники (список запрещённых
// слов — во внешнем файле), почта/телефоны, метаданные картинок, внутренние заметки.
// Чистые функции без побочных эффектов — чтобы каждую проверку можно было покрыть тестом
// (tests/unit/export-scan.test.mjs), не собирая настоящий снимок.
//
// Список запрещённых слов НЕ хранится в репозитории: он лежит вне его, путь задаётся переменной
// TAPYOR_EXPORT_DENYLIST (по умолчанию — E:\Tapyor\private\export-denylist.txt). Файла нет — проверка
// ников пропускается с предупреждением.
import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|ico|svg)$/i;

// Шаблонные имена пользователя — это не личные данные: из них состоят примеры в документации.
// «Имя», «Name», «Test» — такие же заглушки, как <имя> и USERNAME.
const TEMPLATE_USER = /^(?:(?:user|users|username|name|имя|test|tester|example|demo|anon|anonymous)\d*|%username%|<[^<>]+>|…|\.\.\.|\*+|x{3,}|\$\{?username\}?)$/i;
export const isTemplateUser = (name) => TEMPLATE_USER.test(String(name || '').trim());

// Пометка-разрешение на строке: нарочный образец (путь, имя, служебная папка) с выдуманными
// данными, который нужен тесту или проверке именно в таком виде. Такая строка не сканируется —
// так же, как шаблоны ключей пропускают строки с scan-secrets:allow. Ставить только на образец.
export const ALLOW_MARK = 'export-scan:allow';

// ── пути ПК ─────────────────────────────────────────────────────────────────────────────────────
// Любая буква диска + Tapyor, Users\<настоящее имя>, варианты MSYS/Git Bash и file:///.
const DRIVE_TAPYOR = /\b[A-Za-z]:(?:\\\\|[\\/])(?:[^\s'"`<>|]*[\\/])?Tapyor(?:[\\/][^\s'"`<>|]*)?/gi;
const MSYS_TAPYOR = /(?<![\w])\/[A-Za-z]\/Tapyor(?:[\\/][^\s'"`<>|]*)?/gi;
const FLAT_TAPYOR = /\b[A-Za-z]--Tapyor(?:[-\\/\w.]*)?/gi;
const FILE_URL = /\bfile:\/\/\/[A-Za-z]:(?:\\\\|[\\/])[^\s'"`<>|]*/gi;
const USERS_PATH = /(?:[A-Za-z]:(?:\\\\|[\\/])|(?<![\w])\/[A-Za-z]\/|(?<![\w])\/)(?:Users|home)(?:\\\\|[\\/])([^\\/\s'"`<>|()]+)/gi;

// ── почта и телефоны ───────────────────────────────────────────────────────────────────────────
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_OK = (m) => /^noreply@/i.test(m)
  || /@users\.noreply\.github\.com$/i.test(m)
  || /@(?:example\.com|example\.org|test\.local)$/i.test(m);
// Не почта: имена файлов («tray16@2x.png»), служебные имена в адресах (git@github.com, user:pass@host).
const EMAIL_LOCAL_OK = /^(?:noreply|git|ssh|user|pass|https?|www|mailto)$/i;
const EMAIL_FILE_EXT = /\.(?:png|jpe?g|gif|svg|webp|ico|bmp|css|js|mjs|cjs|ts|tsx|jsx|json|txt|md|html?|ya?ml|exe|dll|zip|gz|tgz|mp[34]|webm|flac|wav|ogg)$/i;
const inUrlUserinfo = (s, idx) => {
  const token = s.slice(0, idx).split(/[\s"'`<>()]/).pop() || '';
  return token.includes('://');
};
// Международный формат: «+» и 8–15 цифр с разделителями. Номера без «+» не считаем телефоном.
const PHONE = /(?<![\p{L}\p{N}_])\+\d[\d\s().-]{5,}\d(?![\p{L}\p{N}_])/gu;

// ── внутренние заметки ─────────────────────────────────────────────────────────────────────────
const NOTES = [
  [/\bTODO\s*\(\s*владелец\s*\)/giu, 'TODO(владелец)'],
  [/не\s+публиковать/giu, 'не публиковать'],
  [/(?<![\p{L}])внутреннее(?![\p{L}])/giu, 'внутреннее'],
  [/only\s+for\s+owner/giu, 'only for owner'],
  [/(?:handoff|sandbox|private|vault)[\\/]/giu, 'ссылка на служебную папку'],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Сколько строк до позиции (1 — первая).
export function lineAt(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// Прочитать внешний список запрещённых слов. Возвращает { words, warning }.
export function readDenylist(file) {
  if (!file || !fs.existsSync(file)) {
    return { words: [], warning: 'список запрещённых слов не найден, проверка ников пропущена' };
  }
  try {
    const words = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))
      .map((s) => s.replace(/^"(.*)"$/, '$1'))
      .filter(Boolean);
    return { words: Array.from(new Set(words)), warning: '' };
  } catch {
    return { words: [], warning: 'список запрещённых слов не прочитан, проверка ников пропущена' };
  }
}

// Проверка текста. opts: { denylist: [слова], file?: относительный путь }
export function scanText(text, opts = {}) {
  const s = String(text == null ? '' : text);
  const out = [];
  const seen = new Set();
  // Номера строк с пометкой-разрешением: их пропускаем целиком.
  const allowLines = new Set();
  if (s.includes(ALLOW_MARK)) for (const m of s.matchAll(new RegExp(escapeRe(ALLOW_MARK), 'g'))) allowLines.add(lineAt(s, m.index));
  const add = (kind, index, detail) => {
    const line = lineAt(s, index);
    if (allowLines.has(line)) return;
    const key = kind + '|' + line + '|' + index;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, line, detail: detail || '' });
  };
  // Пути ПК
  for (const re of [DRIVE_TAPYOR, MSYS_TAPYOR, FLAT_TAPYOR, FILE_URL]) {
    for (const m of s.matchAll(re)) add('путь ПК', m.index);
  }
  for (const m of s.matchAll(USERS_PATH)) {
    if (!isTemplateUser(m[1])) add('путь ПК', m.index);
  }
  // Запрещённые слова (ники, имя пользователя Windows)
  for (const w of (opts.denylist || [])) {
    const word = String(w || '').trim();
    if (word.length < 2) continue;
    const re = new RegExp('(?<![\\p{L}\\p{N}_])' + escapeRe(word) + '(?![\\p{L}\\p{N}_])', 'giu');
    for (const m of s.matchAll(re)) add('запрещённое слово', m.index);
  }
  // Почта. В package-lock.json адреса — служебные данные npm-пакетов (не владельца), не проверяем.
  const lockFile = /(?:^|[\\/])package-lock\.json$/i.test(String(opts.file || ''));
  for (const m of (lockFile ? [] : s.matchAll(EMAIL))) {
    const local = m[0].slice(0, m[0].lastIndexOf('@'));
    if (EMAIL_OK(m[0]) || EMAIL_LOCAL_OK.test(local) || EMAIL_FILE_EXT.test(m[0]) || inUrlUserinfo(s, m.index)) continue;
    add('почта', m.index);
  }
  // Телефоны
  for (const m of s.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) add('телефон', m.index);
  }
  // Внутренние заметки
  for (const [re, detail] of NOTES) for (const m of s.matchAll(re)) add('внутренняя заметка', m.index, detail);
  out.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  return out;
}

// ── метаданные картинок (без сторонних библиотек) ──────────────────────────────────────────────
function pngFindings(buf) {
  const out = [];
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return out;
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt' || type === 'eXIf') {
      out.push({ kind: 'картинка с метаданными', line: 0, detail: 'PNG ' + type });
    }
    if (type === 'IEND') break;
    if (len > buf.length) break;
    pos += 12 + len;
  }
  return out;
}

function jpegFindings(buf) {
  const out = [];
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return out;
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) break;
    const marker = buf[pos + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / начало сжатых данных
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2) break;
    if (marker === 0xe1) out.push({ kind: 'картинка с метаданными', line: 0, detail: 'JPEG APP1 (EXIF/XMP)' });
    if (marker === 0xfe) out.push({ kind: 'картинка с метаданными', line: 0, detail: 'JPEG COM' });
    pos += 2 + len;
  }
  return out;
}

function svgFindings(text) {
  const out = [];
  if (!/<svg[\s>]/i.test(text)) return out;
  if (/<metadata[\s>]/i.test(text)) out.push({ kind: 'картинка с метаданными', line: 0, detail: 'SVG metadata' });
  const attr = /(inkscape|sodipodi):([\w-]+)\s*=\s*"([^"]*)"/gi;
  const pathLike = /^(?:[A-Za-z]:[\\/]|file:\/\/|\/(?:home|Users|[A-Za-z])\/|%USERPROFILE%)/;
  for (const m of text.matchAll(attr)) {
    if (pathLike.test(m[3].trim())) out.push({ kind: 'картинка с метаданными', line: 0, detail: 'SVG ' + m[1] + ':' + m[2] });
  }
  return out;
}

export function scanImage(buf, name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  try {
    if (ext === '.png') return pngFindings(buf);
    if (ext === '.jpg' || ext === '.jpeg') return jpegFindings(buf);
    if (ext === '.svg') return svgFindings(buf.toString('utf8'));
  } catch (e) {
    return [];
  }
  return [];
}

// Все картинки папки: [{ file, size }], пути через «/» и по алфавиту.
export function listImages(rootDir) {
  const out = [];
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), r);
      else if (ent.isFile() && IMAGE_EXT.test(ent.name)) out.push({ file: r, size: fs.statSync(path.join(dir, ent.name)).size });
    }
  };
  if (fs.existsSync(rootDir)) walk(rootDir, '');
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// Пройти готовый снимок (папку) и вернуть находки с путями. opts: { denylist, skip:Set }
export function scanSnapshotDir(rootDir, opts = {}) {
  const skip = opts.skip || new Set();
  const out = [];
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + ent.name : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full, r); continue; }
      if (!ent.isFile() || skip.has(r)) continue;
      const buf = fs.readFileSync(full);
      let found;
      if (IMAGE_EXT.test(ent.name)) found = scanImage(buf, ent.name);
      else if (buf.includes(0)) found = [];
      else found = scanText(buf.toString('utf8'), Object.assign({}, opts, { file: r }));
      for (const f of found) out.push(Object.assign({ file: r }, f));
    }
  };
  if (fs.existsSync(rootDir)) walk(rootDir, '');
  return out;
}
