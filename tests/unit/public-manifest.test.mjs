// Служебные файлы ОТКРЫТОГО снимка (D2, находки F5/F6/F14/F15) — tools/lib/public-manifest.mjs.
// Зачем тест: снимок не должен обещать чужих скриптов, врать про лицензию и вести по мёртвым ссылкам.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePackageJson, sanitizeLock, stripDeadLinks, INTERNAL_SCRIPTS, OPEN_REPOSITORY,
} from '../../tools/lib/public-manifest.mjs';

const PJ = {
  name: 'tapyor',
  license: 'UNLICENSED',
  scripts: {
    start: 'electron .',
    test: 'node tools/check.mjs',
    lint: 'node tools/build-ui.mjs && node tools/lint.mjs',
    'audit:pack': 'node tools/build-audit-pack.mjs',
    'audit:pack:history': 'node tools/build-audit-pack.mjs --with-history --with-todo',
    'release:check': 'node tools/release-preflight.mjs',
    'history:export': 'node tools/export-history.mjs',
    'drill:make': 'node tools/make-release-drill.mjs',
    modules: 'node tools/sync-modules.mjs',
    'release:post': 'node tools/release-postcheck.mjs'
  }
};

test('package.json снимка: MIT, repository и только публичные скрипты', () => {
  const out = sanitizePackageJson(PJ);
  assert.equal(out.license, 'MIT');
  assert.deepEqual(out.repository, OPEN_REPOSITORY);
  for (const name of ['start', 'test', 'lint']) assert.ok(out.scripts[name], 'потерян скрипт ' + name);
  for (const name of INTERNAL_SCRIPTS) assert.equal(out.scripts[name], undefined, 'остался внутренний скрипт ' + name);
  assert.equal(PJ.license, 'UNLICENSED', 'исходный объект не меняется');
  assert.ok(PJ.scripts['audit:pack'], 'исходный объект не меняется');
});

test('package-lock.json снимка: корневой пакет MIT, остальное на месте', () => {
  const lock = {
    name: 'tapyor', version: '0.35.1', lockfileVersion: 3,
    packages: {
      '': { name: 'tapyor', version: '0.35.1', license: 'UNLICENSED', dependencies: { a: '1.0.0' } },
      'node_modules/a': { version: '1.0.0', license: 'MIT' }
    }
  };
  const out = sanitizeLock(lock);
  assert.equal(out.packages[''].license, 'MIT');
  assert.equal(out.packages['node_modules/a'].license, 'MIT');
  assert.deepEqual(out.packages[''].dependencies, { a: '1.0.0' });
});

test('CHANGELOG: локальная мёртвая ссылка становится текстом, живая и внешняя остаются', () => {
  const exists = (p) => p === 'README.md' || p === 'docs/DEV.md';
  const md = [
    'см. [живое](README.md) и [мёртвое](docs/CHECKS.md)',
    'внешнее [сайт](https://example.org/x) не трогаем',
    'якорь [тут](#раздел) не трогаем',
    'картинка ![схема](docs/img/gone.png) тоже мёртвая',
    'битая [путь](../вне.md) остаётся'
  ].join('\n');
  const out = stripDeadLinks(md, exists);
  assert.match(out, /\[живое\]\(README\.md\)/);
  assert.ok(!out.includes('[мёртвое]'), out);
  assert.match(out, /см\. \[живое\]\(README\.md\) и мёртвое/, out);
  assert.match(out, /\[сайт\]\(https:\/\/example\.org\/x\)/);
  assert.match(out, /\[тут\]\(#раздел\)/);
  assert.ok(!out.includes('![схема]'), out);
  assert.ok(out.includes('схема'), 'текст картинки остаётся');
  assert.match(out, /\[путь\]\(\.\.\/вне\.md\)/);
});
