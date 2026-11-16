// Классификатор опасности чужого PR (часть A задания 11.11). Список — из решения владельца:
// такие правки сперва обсуждаем, а не переносим молча. Работает по метаданным PR и тексту диффа;
// описание и комментарии PR сюда не передаются — это чужие данные, а не инструкции.
import { parseDiffGitLine } from './pr-paths.mjs';

const FILE_RULES = [
  [/^\.github\//, 'ci', '.github/ — сборка и workflow'],
  [/^package\.json$/, 'manifest', 'package.json — зависимости и настройки electron-builder'],
  [/^package-lock\.json$/, 'lock', 'package-lock.json — закреплённые версии зависимостей'],
  [/^build\//, 'build-assets', 'build/ — значки и ресурсы сборки'],
  [/^electron-builder\.(json|ya?ml|js|mjs|cjs|toml)$/, 'builder', 'настройки electron-builder'],
  [/^server\//, 'server', 'server/ — облачные функции и лицензии'],
  [/^tests\//, 'tests', 'tests/ — код тестов исполняется при проверке PR'],
  [/^src\/license[^/]*\.js$/, 'license', 'src/license*.js — проверка лицензий'],
  [/^src\/modhost\.js$/, 'modhost', 'src/modhost.js — модули и мост ядра'],
  [/^src\/packs\.js$/, 'packs', 'src/packs.js — подписанные паки'],
  [/^src\/localguard\.js$/, 'localguard', 'src/localguard.js — защита локального сервера'],
  [/^src\/preload\.js$/, 'preload', 'src/preload.js — мост window.app'],
  [/^src\/settings-store\.js$/, 'settings', 'src/settings-store.js — хранение настроек'],
  [/^src\/main\.js$/, 'main', 'src/main.js — IPC и сеть главного процесса'],
  // Файлы, которые трогают профиль, сеть, секреты и безопасность (аудит 0.34.0, A3):
  // их правку не переносим молча, даже если она выглядит обычной.
  [/^src\/user-data\.js$/, 'user-data', 'src/user-data.js — выбор папки данных и уборка профилей'],
  [/^src\/debug-[^/]*\.js$/, 'debug', 'src/debug-*.js — отладочные сбросы, копии и отчёт'],
  [/^src\/fault-sim\.js$/, 'fault-sim', 'src/fault-sim.js — имитация сетевых сбоев'],
  [/^src\/autofix\.js$/, 'autofix', 'src/autofix.js — автопочинка сервисов'],
  [/^src\/watchdog\.js$/, 'watchdog', 'src/watchdog.js — сторож окна'],
  [/^src\/mojibake\.js$/, 'mojibake', 'src/mojibake.js — исправление кодировки плейлистов'],
  [/^src\/browser-zoom\.js$/, 'browser-zoom', 'src/browser-zoom.js — масштаб сайтов'],
  [/^src\/donations\.js$/, 'donations', 'src/donations.js — донаты и ключи сервисов'],
  [/^src\/ytauth\.js$/, 'ytauth', 'src/ytauth.js — вход в YouTube (cookies)'],
  [/^src\/ytoauth\.js$/, 'ytoauth', 'src/ytoauth.js — вход в YouTube (OAuth)'],
  [/^src\/secret-patterns\.js$/, 'secret-patterns', 'src/secret-patterns.js — шаблоны секретов'],
  [/^src\/open-external\.js$/, 'open-external', 'src/open-external.js — открытие внешних ссылок'],
  [/^PRIVACY\.md$/, 'privacy-doc', 'PRIVACY.md — политика данных'],
  [/^LICENSE$/, 'license-doc', 'LICENSE — лицензия ядра'],
  [/^SECURITY\.md$/, 'security-doc', 'SECURITY.md — правила безопасности'],
  [/^THIRD-PARTY\.md$/, 'third-party', 'THIRD-PARTY.md — лицензии сторонних частей'],
  [/^tools\//, 'tools', 'tools/ — бежит при сборке, проверках и выпуске'],
];

const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|bmp|ico|exe|msi|dll|zip|7z|rar|gz|tpack|woff2?|ttf|otf|eot|mp3|wav|ogg|flac|mp4|webm|mov|pdf|asar)$/i;
const NETWORK = [/\bhttps?:\/\//i, /\bfetch\s*\(/, /\bnet\.request\b/, /\bWebSocket\b/];

function fileList(files) {
  return (Array.isArray(files) ? files : []).map((f) => (typeof f === 'string' ? { path: f } : f || {})).filter((f) => f.path);
}

function countDiffLines(diff) {
  let plus = 0, minus = 0, inHunk = false;
  for (const line of String(diff).split('\n')) {
    if (parseDiffGitLine(line)) { inHunk = false; continue; }
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith('+')) plus++;
    else if (line.startsWith('-')) minus++;
  }
  return plus + minus;
}

// change: { files: [{path, additions, deletions, changeType}], diff: '…', additions, deletions }
// → { dangerous, flags: [{ code, path, reason }], totalChanges }
export function classifyPrChange(change = {}) {
  const files = fileList(change.files);
  const diff = String(change.diff || '');
  const flags = [];
  const seen = new Set();
  const add = (code, path, reason) => {
    const key = code + '|' + (path || '');
    if (seen.has(key)) return;
    seen.add(key);
    flags.push({ code, path: path || '', reason });
  };

  const touched = new Set();
  for (const f of files) {
    const p = f.path;
    touched.add(p);
    for (const [re, code, reason] of FILE_RULES) if (re.test(p)) add(code, p, reason);
    if (String(f.changeType || '').toUpperCase() === 'DELETED' && /^tests\//.test(p)) add('tests-deleted', p, 'удаляется тест');
    if (BINARY_EXT.test(p)) add('binary', p, 'двоичный файл');
  }

  // Разбор диффа: удалённые тесты, двоичные файлы, добавленные адреса и сетевые вызовы.
  let curPath = '', inHunk = false;
  const addedByFile = new Map();
  for (const line of diff.split('\n')) {
    const pair = parseDiffGitLine(line);
    if (pair) {
      curPath = pair[0].replace(/^a\//, '');
      if (curPath) touched.add(curPath);
      inHunk = false;
      continue;
    }
    if (!inHunk && /^(---|\+\+\+) /.test(line)) continue;
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (/^deleted file mode /.test(line) && /^tests\//.test(curPath)) add('tests-deleted', curPath, 'удаляется тест');
    if (line === 'GIT binary patch' || /^Binary files .* differ$/.test(line)) add('binary', curPath, 'двоичный файл');
    if (inHunk && line.startsWith('+')) {
      const text = line.slice(1);
      if (!addedByFile.has(curPath)) addedByFile.set(curPath, []);
      addedByFile.get(curPath).push(text);
    }
  }
  for (const [p, lines] of addedByFile) {
    if (lines.some((l) => NETWORK.some((re) => re.test(l)))) {
      add('network', p, 'новый адрес или запрос в сеть — нужна правка PRIVACY.md в том же PR');
    }
  }
  if (flags.some((f) => f.code === 'network') && !touched.has('PRIVACY.md')) {
    add('privacy-missing', '', 'сеть добавили, а PRIVACY.md не правили');
  }

  const hasTotals = Number.isFinite(change.additions) && Number.isFinite(change.deletions);
  let total = hasTotals
    ? change.additions + change.deletions
    : files.reduce((s, f) => s + (Number(f.additions) || 0) + (Number(f.deletions) || 0), 0);
  if (!total && diff) total = countDiffLines(diff);
  if (total > 500) add('big', '', 'правка больше 500 строк (' + total + ')');

  return { dangerous: flags.length > 0, flags, totalChanges: total };
}

// Строка для сводки: «⚠️ code — reason (path)». Путь приходит из PR — это чужие
// данные: убираем переводы строк и обратные кавычки, иначе можно сломать разметку (A12).
function oneLine(s, n) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f`]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...t];
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : t;
}
export function describeFlag(f) {
  return '⚠️ ' + (f.path ? '`' + oneLine(f.path, 200) + '` — ' : '') + oneLine(f.reason, 240);
}

// A3: запускать ли тесты PR. Тесты и часть модулей из PR исполняют его код с правами
// пользователя, поэтому при найденных ⚠ без явного --force тесты не запускаем:
// владелец сначала смотрит дифф, потом запускает вручную.
export const PR_TEST_MANUAL = 'тесты PR исполняют его код — запусти вручную после просмотра диффа';
export function canRunPrTests(flags, force) {
  if (!Array.isArray(flags) || !flags.length) return { run: true, message: '' };
  if (force) return { run: true, message: '' };
  return { run: false, message: PR_TEST_MANUAL };
}
