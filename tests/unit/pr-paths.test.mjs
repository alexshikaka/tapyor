// Перевод путей между открытым `tapyor` и закрытым `tapyor-player` (часть B задания 11.11).
// Зачем тест: ошибка здесь отправляет правку не в тот файл — или, хуже, мимо репозитория.
// Списки общие с public-export: снимок и перенос обязаны понимать public/ одинаково.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openToClosed, closedToOpen, checkRepoPath, readOverlayPaths, mapPatchPaths,
  gitQuote, gitUnquote, overlayToOpen, isPublic,
} from '../../tools/lib/pr-paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OVERLAY = new Set(['README.md', 'SECURITY.md', 'LICENSE', 'docs/DEV.md', '.github/workflows/build.yml', 'docs/img/search.png']);
// В снимке для открытого репозитория папки public/ уже нет — файлы лежат на своих местах.
const HAS_PUBLIC = fs.existsSync(path.join(ROOT, 'public'));

test('пути: файлы public/ переводятся в закрытые', () => {
  assert.equal(openToClosed('README.md', OVERLAY), 'public/README.md');
  assert.equal(openToClosed('SECURITY.md', OVERLAY), 'public/SECURITY.md');
  assert.equal(openToClosed('LICENSE', OVERLAY), 'public/LICENSE');
  assert.equal(openToClosed('docs/DEV.md', OVERLAY), 'public/docs/DEV.md');
  assert.equal(openToClosed('.github/workflows/build.yml', OVERLAY), 'public/.github/workflows/build.yml');
  assert.equal(openToClosed('docs/img/search.png', OVERLAY), 'public/docs/img/search.png');
});

test('пути: новый файл в папке только для открытого репозитория тоже уходит в public/', () => {
  assert.equal(openToClosed('.github/ISSUE_TEMPLATE/new.yml', OVERLAY), 'public/.github/ISSUE_TEMPLATE/new.yml');
  assert.equal(openToClosed('docs/img/screenshot.png', OVERLAY), 'public/docs/img/screenshot.png');
});

test('пути: остальное — как есть (код, тесты, документы для людей внутри docs/)', () => {
  for (const p of ['src/main.js', 'src/ui/05-search.js', 'tests/unit/pr-risk.test.mjs', 'tools/check.mjs',
    'docs/OVERLAY.md', 'docs/PR-RULES.md', 'PRIVACY.md', 'package.json', 'CHANGELOG.md']) {
    assert.equal(openToClosed(p, OVERLAY), p, p);
  }
});

test('пути: инструменты надёжности публичны (soak, fault, long-run)', () => {
  for (const f of ['tools/reliability/soak.mjs', 'tools/reliability/fault.mjs', 'tools/reliability/long-run.mjs']) {
    assert.equal(isPublic(f), true, f);
  }
});

test('пути: закрытые пути в снимке и обратно', () => {
  assert.equal(closedToOpen('public/README.md'), 'README.md');
  assert.equal(closedToOpen('public/.github/workflows/build.yml'), '.github/workflows/build.yml');
  assert.equal(closedToOpen('src/main.js'), 'src/main.js');
  assert.equal(overlayToOpen('public/LICENSE'), 'LICENSE');
});

test('пути: абсолютные и с .. отклоняются', () => {
  for (const bad of ['../внешний.md', 'a/../../b', 'C:\\Windows\\x', '/etc/passwd', '']) {
    assert.throws(() => checkRepoPath(bad), /путь вне репозитория/, bad);
  }
  assert.equal(checkRepoPath('./src/main.js'), 'src/main.js');
  assert.equal(checkRepoPath('src\\main.js'), 'src/main.js');
});

test('пути: public/ — ровно то, что собирает снимок (обратный перевод совпадает)', {
  skip: HAS_PUBLIC ? false : 'в снимке нет public/: файлы уже лежат на своих местах',
}, () => {
  const overlay = readOverlayPaths(ROOT);
  for (const name of ['README.md', 'SECURITY.md', 'LICENSE', 'docs/DEV.md', '.github/workflows/build.yml']) {
    assert.ok(overlay.has(name), 'в public/ нет ' + name);
  }
  for (const open of overlay) {
    assert.equal(openToClosed(open, overlay), 'public/' + open, 'перевод и обратно для ' + open);
  }
});

test('патч: заголовки переводятся, /dev/null не трогаем', () => {
  const patch = [
    'diff --git a/README.md b/README.md',
    'index 1111111..2222222 100644',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-старое',
    '+новое',
    'diff --git a/.github/workflows/build.yml b/.github/workflows/build.yml',
    '--- a/.github/workflows/build.yml',
    '+++ b/.github/workflows/build.yml',
    'diff --git a/src/old.js b/src/old.js',
    'deleted file mode 100644',
    '--- a/src/old.js',
    '+++ /dev/null',
    '',
  ].join('\n');
  const out = mapPatchPaths(patch, OVERLAY);
  assert.match(out, /^diff --git a\/public\/README\.md b\/public\/README\.md$/m);
  assert.match(out, /^--- a\/public\/README\.md$/m);
  assert.match(out, /^\+\+\+ b\/public\/README\.md$/m);
  assert.match(out, /^diff --git a\/public\/\.github\/workflows\/build\.yml b\/public\/\.github\/workflows\/build\.yml$/m);
  assert.match(out, /^--- a\/src\/old\.js$/m, 'путь закрытого файла не меняется');
  assert.match(out, /^\+\+\+ \/dev\/null$/m, '/dev/null остаётся');
  assert.match(out, /^-старое$/m, 'содержимое не трогаем');
});

test('патч: новый файл и двоичный патч', () => {
  const patch = [
    'diff --git a/docs/img/new.png b/docs/img/new.png',
    'new file mode 100644',
    'index 0000000..3333333',
    '--- /dev/null',
    '+++ b/docs/img/new.png',
    'Binary files /dev/null and b/docs/img/new.png differ',
    '',
  ].join('\n');
  const out = mapPatchPaths(patch, OVERLAY);
  assert.match(out, /^\+\+\+ b\/public\/docs\/img\/new\.png$/m);
  assert.match(out, /^Binary files \/dev\/null and b\/public\/docs\/img\/new\.png differ$/m);
});

test('патч: переименование без смены пути', () => {
  const patch = [
    'diff --git a/src/a.js b/src/b.js',
    'similarity index 100%',
    'rename from src/a.js',
    'rename to src/b.js',
    '',
  ].join('\n');
  assert.equal(mapPatchPaths(patch, OVERLAY), patch);
});

test('патч: путь в кавычках (пробел, кириллица) остаётся рабочим', () => {
  const cyr = 'src/' + 'файл с пробелом.js';
  const quoted = gitQuote('a/' + cyr) + ' ' + gitQuote('b/' + cyr);
  assert.equal(gitUnquote(gitQuote('a/' + cyr)), 'a/' + cyr);
  const patch = 'diff --git ' + quoted + '\n--- ' + gitQuote('a/' + cyr) + '\n+++ ' + gitQuote('b/' + cyr) + '\n';
  const out = mapPatchPaths(patch, OVERLAY);
  assert.equal(out, patch, 'не публичный путь не меняется, кавычки сохраняются');
  // А публичный путь в кавычках (так git пишет кириллицу) получает public/
  const pub = 'docs/img/' + 'новая картинка.png';
  const p2 = 'diff --git ' + gitQuote('a/' + pub) + ' ' + gitQuote('b/' + pub) + '\n';
  const o2 = mapPatchPaths(p2, OVERLAY);
  assert.equal(o2, 'diff --git ' + gitQuote('a/public/' + pub) + ' ' + gitQuote('b/public/' + pub) + '\n');
});
