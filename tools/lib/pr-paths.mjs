// Списки «что попадает в открытый репозиторий» и перевод путей между открытым
// `alexshikaka/tapyor` и закрытым `tapyor-player`. Один источник правды:
//   tools/public-export.mjs  — собирает снимок (закрытые пути → открытые);
//   tools/import-pr.mjs      — переносит чужой PR (открытые пути → закрытые);
//   tools/pr-digest.mjs      — проверяет, ложится ли PR на текущую experiment.
//
// Добавил внутренний документ или инструмент — допиши списки ЗДЕСЬ, а не в инструментах.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Документы, которые нужны людям снаружи (остальное в docs/ — внутренняя кухня: сессии, аудиты, планы, рынок)
export const DOCS_PUBLIC = new Set(['docs/DEV.md', 'docs/UI-RULES.md', 'docs/SKINS.md', 'docs/OVERLAY.md', 'docs/BOT-GUIDE.md', 'docs/STREAMERBOT-GUIDE.md']);
export const EXCLUDE = [
  /^docs\//,                    // кроме DOCS_PUBLIC
  /^modules\//,                 // копия пака: его исходник и так в открытом tapyor-modules, в установщик не входит
  /^\.github\//,                // свой CI у открытого репозитория (docs/PUBLIC-REPO.md, шаг 3)
  /^(CLAUDE|AGENTS|GEMINI|TODO)\.md$/, /^\.cursorrules$/,
  /\.cmd$/,                     // кнопки владельца на его ПК
  /^tools\/(export-history|build-audit-pack|make-release-drill|build-real-orders|order-selector-replay[^/]*|benchmark-[^/]*|keys-batch|issue-own-license|copy-license-key|diag-fingerprint|check-fingerprint)\./,
  // выпуск, ключи, облако и перенос пака — инструменты владельца (11.11)
  /^tools\/(release-preflight|release-postcheck|license-tool|pack-tool|sync-modules|phone-test|public-export|cloud-deploy|cloud-license-check|open-release|update-keys|sign-release)\./,
  /^public\//,                  // кладётся поверх отдельно, см. ниже
  /^tests\/.*real/i,            // разборы настоящих заказов со стримов
  // проверяет инструмент владельца tools/update-keys.mjs — наружу не идут оба
  /^tests\/unit\/update-keys\.test\.mjs$/,
  // tools/reliability/* (soak, fault, long-run) — общие инструменты проверок; их здесь нет намеренно,
  // они уходят в открытый репозиторий.
];
// Картинки открытых документов: снимки инструкции Streamer.bot (сняты на выдуманных данных, SB2 15.11)
export const DOCS_PUBLIC_DIRS = [/^docs\/img\/streamerbot\/[a-z0-9-]+\.png$/];
export const isPublic = (f) => !/^public\//.test(f) && (DOCS_PUBLIC.has(f) || DOCS_PUBLIC_DIRS.some((re) => re.test(f)) || !EXCLUDE.some((re) => re.test(f)));

// public/ — файлы ТОЛЬКО для открытого репозитория. В снимке они ложатся поверх рабочих:
// public/README.md → README.md, public/docs/DEV.md → docs/DEV.md и т.д.
export const isOverlayPath = (f) => /^public\/./.test(f);
export const overlayToOpen = (f) => (isOverlayPath(f) ? f.slice('public/'.length) : f);
export const openOverlaySet = (files) => new Set(files.filter(isOverlayPath).map(overlayToOpen));

// Особые места, где открытая версия файла — единственная (не «поверх рабочего»):
// .github целиком принадлежит открытому репозиторию, docs/img — картинки README.
// Существующие файлы public/ ловятся и без этого списка (overlay), но новый файл в этих
// папках в закрытом репозитории тоже должен лечь в public/.
export const OVERLAY_EXACT = new Set(['README.md', 'SECURITY.md', 'LICENSE', 'docs/DEV.md']);
export const OVERLAY_PREFIXES = ['.github/', 'docs/img/'];

// Путь в снимке → путь в закрытом репозитории.
export const openToClosed = (openPath, overlay) => {
  const p = checkRepoPath(openPath);
  const mapped = overlay.has(p) || OVERLAY_EXACT.has(p) || OVERLAY_PREFIXES.some((pre) => p.startsWith(pre));
  return mapped ? 'public/' + p : p;
};

// Путь в закрытом репозитории → путь в снимке (public/README.md → README.md).
export const closedToOpen = (closedPath) => overlayToOpen(checkRepoPath(closedPath));

// Проверка пути: только относительный, без .. и без диска — иначе патч может писать куда угодно.
export function checkRepoPath(p) {
  const s = String(p).replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..') || s.includes('\0')) {
    throw new Error('путь вне репозитория: ' + JSON.stringify(p));
  }
  return s.replace(/^\.\/+/, '');
}

// Список файлов под public/ (через git ls-files; без git — обходом папки).
export function readOverlayPaths(root) {
  try {
    const out = execFileSync('git', ['ls-files', 'public'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return openOverlaySet(out.split('\n').filter(Boolean));
  } catch (e) {
    const found = [];
    const walk = (dir, rel) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const childRel = rel ? rel + '/' + ent.name : ent.name;
        if (ent.isDirectory()) walk(path.join(dir, ent.name), childRel);
        else if (ent.isFile() && !childRel.startsWith('public/.')) found.push(childRel);
      }
    };
    const pubDir = path.join(root, 'public');
    if (fs.existsSync(pubDir)) walk(pubDir, 'public');
    return openOverlaySet(found);
  }
}

// ── Патч git: перевод путей в заголовках ─────────────────────────────────────────────────────────
// Git по умолчанию берёт не-ASCII пути (и пути с пробелами) в кавычки C-стиля:
//   diff --git "a/\320\264..." "b/\320\264..."
// Поэтому мало заменить «a/» — надо развернуть и снова завернуть путь.
const C_ESCAPES = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34 };

export function gitUnquote(token) {
  if (!(token.length >= 2 && token[0] === '"' && token[token.length - 1] === '"')) return token;
  const body = token.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) { bytes.push(92); break; }
    if (/[0-7]/.test(next)) {
      let oct = next;
      i++;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] || '')) oct += body[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(body.slice(i + 2, i + 4))) {
      bytes.push(parseInt(body.slice(i + 2, i + 4), 16) & 0xff);
      i += 3;
    } else {
      bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0) & 0xff);
      i++;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

export function gitQuote(s) {
  if (!/[\x00-\x20"\\\x7f]|[^\x00-\x7f]/.test(s)) return s;
  let out = '"';
  for (const b of Buffer.from(s, 'utf8')) {
    if (b === 34) out += '\\"';
    else if (b === 92) out += '\\\\';
    else if (b === 10) out += '\\n';
    else if (b === 9) out += '\\t';
    else if (b < 32 || b >= 127) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out + '"';
}

function rewriteToken(token, overlay) {
  const raw = gitUnquote(token);
  if (raw === '/dev/null') return token;
  let prefix = '';
  let p = raw;
  if (p.startsWith('a/') || p.startsWith('b/')) { prefix = p.slice(0, 2); p = p.slice(2); }
  const mapped = openToClosed(p, overlay);
  const result = prefix + mapped;
  // Если исходный токен был в кавычках — оставляем кавычки: так безопаснее для git apply.
  return token.startsWith('"') ? gitQuote(result) : result;
}

// «--- a/путь» / «+++ b/путь» (+ необязательный хвост после табуляции)
function rewriteFileMarker(line, overlay) {
  const m = line.match(/^(---|\+\+\+) (("[^"]*(?:\\.[^"]*)*")|\S+)(\t.*)?$/);
  if (!m) return line;
  return m[1] + ' ' + rewriteToken(m[2], overlay) + (m[4] || '');
}

const TOKEN = '(?:"(?:[^"\\\\]|\\\\.)*"|\\S+)';
const DIFF_GIT_RE = new RegExp('^diff --git (' + TOKEN + ') (' + TOKEN + ')$');

// Пути из строки «diff --git a/… b/…» (развёрнутые из кавычек). null — если строка не заголовок.
export function parseDiffGitLine(line) {
  const m = String(line).match(DIFF_GIT_RE);
  return m ? [gitUnquote(m[1]), gitUnquote(m[2])] : null;
}

export function mapPatchPaths(patch, overlay) {
  return String(patch).split('\n').map((line) => {
    const g = line.match(DIFF_GIT_RE);
    if (g) return 'diff --git ' + rewriteToken(g[1], overlay) + ' ' + rewriteToken(g[2], overlay);
    if (line.startsWith('--- ') || line.startsWith('+++ ')) return rewriteFileMarker(line, overlay);
    const r = line.match(/^(rename from|rename to|copy from|copy to) (.+)$/);
    if (r) {
      const token = r[2].trim();
      const mapped = rewriteToken(token, overlay);
      return r[1] + ' ' + (token.startsWith('"') ? mapped : gitQuote(mapped));
    }
    const b = line.match(/^Binary files (.+) and (.+) differ$/);
    if (b) return 'Binary files ' + rewriteToken(b[1], overlay) + ' and ' + rewriteToken(b[2], overlay) + ' differ';
    return line;
  }).join('\n');
}
