// Классификатор опасности чужого PR. По одному случаю на каждый пункт списка владельца (11.11):
// такие правки не переносим молча, а сначала советуемся. Ошибка в классификаторе = опасная правка
// проходит как обычная (сборка, лицензии, сеть) — поэтому список проверяется построчно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrChange, canRunPrTests, PR_TEST_MANUAL } from '../../tools/lib/pr-risk.mjs';

const files = (...list) => list.map((path) => ({ path, additions: 1, deletions: 0 }));
const codes = (r) => r.flags.map((f) => f.code);
const diffAdd = (path, lines) => [
  'diff --git a/' + path + ' b/' + path,
  '--- a/' + path,
  '+++ b/' + path,
  '@@ -1,1 +1,2 @@',
  ' context',
  ...lines.map((l) => '+' + l),
].join('\n');

test('опасно: .github/ — сборка и workflow', () => {
  assert.ok(codes(classifyPrChange({ files: files('.github/workflows/build.yml') })).includes('ci'));
});

test('опасно: package.json и package-lock.json', () => {
  assert.ok(codes(classifyPrChange({ files: files('package.json') })).includes('manifest'));
  assert.ok(codes(classifyPrChange({ files: files('package-lock.json') })).includes('lock'));
});

test('опасно: build/ и настройки electron-builder', () => {
  assert.ok(codes(classifyPrChange({ files: files('build/icon.ico') })).includes('build-assets'));
  assert.ok(codes(classifyPrChange({ files: files('electron-builder.yml') })).includes('builder'));
});

test('опасно: server/, лицензии, модули, мост и настройки', () => {
  for (const [path, code] of [
    ['server/yc-report/index.js', 'server'],
    ['src/license.js', 'license'],
    ['src/license-client.js', 'license'],
    ['src/modhost.js', 'modhost'],
    ['src/packs.js', 'packs'],
    ['src/localguard.js', 'localguard'],
    ['src/preload.js', 'preload'],
    ['src/settings-store.js', 'settings'],
    ['src/main.js', 'main'],
  ]) {
    assert.ok(codes(classifyPrChange({ files: files(path) })).includes(code), path + ' → ' + code);
  }
});

test('опасно: документы, которые нельзя менять мимоходом', () => {
  for (const [path, code] of [
    ['PRIVACY.md', 'privacy-doc'],
    ['LICENSE', 'license-doc'],
    ['SECURITY.md', 'security-doc'],
    ['THIRD-PARTY.md', 'third-party'],
  ]) {
    assert.ok(codes(classifyPrChange({ files: files(path) })).includes(code), path + ' → ' + code);
  }
});

test('опасно: tools/ — то, что бежит при сборке и выпуске', () => {
  assert.ok(codes(classifyPrChange({ files: files('tools/check.mjs') })).includes('tools'));
});

test('опасно A3: tests/ — код тестов исполняется при проверке PR', () => {
  for (const path of ['tests/unit/evil.test.mjs', 'tests/ui/t40.py', 'tests/security/localguard.js']) {
    assert.ok(codes(classifyPrChange({ files: files(path) })).includes('tests'), path);
  }
});

test('опасно A3: модули профиля, сети, секретов и безопасности', () => {
  for (const [path, code] of [
    ['src/user-data.js', 'user-data'],
    ['src/debug-report.js', 'debug'],
    ['src/debug-backup.js', 'debug'],
    ['src/debug-reset.js', 'debug'],
    ['src/fault-sim.js', 'fault-sim'],
    ['src/autofix.js', 'autofix'],
    ['src/watchdog.js', 'watchdog'],
    ['src/mojibake.js', 'mojibake'],
    ['src/browser-zoom.js', 'browser-zoom'],
    ['src/donations.js', 'donations'],
    ['src/ytauth.js', 'ytauth'],
    ['src/ytoauth.js', 'ytoauth'],
    ['src/secret-patterns.js', 'secret-patterns'],
    ['src/open-external.js', 'open-external'],
  ]) {
    assert.ok(codes(classifyPrChange({ files: files(path) })).includes(code), path + ' → ' + code);
  }
});

test('A3: тесты PR без --force не запускаются, с --force — можно', () => {
  const flags = [{ code: 'tests', path: 'tests/unit/evil.test.mjs', reason: 'тесты' }];
  const no = canRunPrTests(flags, false);
  assert.equal(no.run, false);
  assert.equal(no.message, PR_TEST_MANUAL);
  assert.match(no.message, /запусти вручную/);
  assert.deepEqual(canRunPrTests(flags, true), { run: true, message: '' });
  assert.deepEqual(canRunPrTests([], false), { run: true, message: '' });
  assert.deepEqual(canRunPrTests(undefined, false), { run: true, message: '' });
});

test('опасно: новый адрес в сети в добавленной строке', () => {
  const diff = diffAdd('src/ui/01-skins.js', ["const u = 'https://example.com/api';"]);
  const r = classifyPrChange({ files: files('src/ui/01-skins.js'), diff });
  assert.ok(codes(r).includes('network'), 'адрес найден');
});

test('опасно: fetch(, net.request, WebSocket в добавленных строках', () => {
  for (const snippet of [
    "const r = await fetch(url);",
    "const r = net.request({ method: 'GET' });",
    "const ws = new WebSocket('wss://example.com');",
  ]) {
    const diff = diffAdd('src/x.js', [snippet]);
    const r = classifyPrChange({ files: files('src/x.js'), diff });
    assert.ok(codes(r).includes('network'), snippet);
  }
});

test('опасно: сеть добавили, а PRIVACY.md не правили', () => {
  const diff = diffAdd('src/x.js', ["fetch('https://example.com')"]);
  const withoutDoc = classifyPrChange({ files: files('src/x.js'), diff });
  assert.ok(codes(withoutDoc).includes('privacy-missing'));
  const withDoc = classifyPrChange({ files: files('src/x.js', 'PRIVACY.md'), diff });
  assert.ok(!codes(withDoc).includes('privacy-missing'), 'PRIVACY.md в том же PR — отдельного флага нет');
});

test('опасно: старые строки в диффе не считаются новой сетью', () => {
  const diff = [
    'diff --git a/src/x.js b/src/x.js',
    '--- a/src/x.js',
    '+++ b/src/x.js',
    '@@ -1,1 +1,1 @@',
    "-fetch('https://old.example.com')",
    "+// без сети",
  ].join('\n');
  const r = classifyPrChange({ files: files('src/x.js'), diff });
  assert.ok(!codes(r).includes('network'), 'удалённый вызов — не новый адрес');
});

test('опасно: двоичный файл (по расширению и по диффу)', () => {
  assert.ok(codes(classifyPrChange({ files: files('src/assets/font.woff2') })).includes('binary'));
  const diff = [
    'diff --git a/img/cover.png b/img/cover.png',
    'new file mode 100644',
    'GIT binary patch',
    'literal 10',
  ].join('\n');
  const r = classifyPrChange({ files: files('img/cover.png'), diff });
  assert.ok(codes(r).includes('binary'));
});

test('опасно: удаление тестов (по диффу и по метаданным)', () => {
  const diff = [
    'diff --git a/tests/unit/old.test.mjs b/tests/unit/old.test.mjs',
    'deleted file mode 100644',
    '--- a/tests/unit/old.test.mjs',
    '+++ /dev/null',
    '',
  ].join('\n');
  const byDiff = classifyPrChange({ files: files('tests/unit/old.test.mjs'), diff });
  assert.ok(codes(byDiff).includes('tests-deleted'));
  const byMeta = classifyPrChange({ files: [{ path: 'tests/unit/old.test.mjs', changeType: 'DELETED', additions: 0, deletions: 5 }] });
  assert.ok(codes(byMeta).includes('tests-deleted'));
});

test('опасно: правка больше 500 строк', () => {
  const big = classifyPrChange({ files: files('src/x.js'), additions: 400, deletions: 101 });
  assert.ok(codes(big).includes('big'));
  const notBig = classifyPrChange({ files: files('src/x.js'), additions: 400, deletions: 100 });
  assert.ok(!codes(notBig).includes('big'), 'ровно 500 — не «больше 500»');
});

test('обычная правка опасной не считается', () => {
  const r = classifyPrChange({ files: files('src/ui/05-search.js', 'src/ui/07-results.js'), additions: 10, deletions: 2 });
  assert.equal(r.dangerous, false);
  assert.deepEqual(r.flags, []);
  assert.equal(r.totalChanges, 12);
});

test('пустые данные не падают', () => {
  const r = classifyPrChange();
  assert.equal(r.dangerous, false);
  assert.deepEqual(r.flags, []);
});
