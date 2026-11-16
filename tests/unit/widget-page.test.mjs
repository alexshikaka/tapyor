// L7 (аудит 0.32.0): у панели OBS встроенный скрипт вынесен в src/widget.js, в CSP нет 'unsafe-inline'.
// Проверяем и саму страницу, и что локальный сервер отдаёт widget.js (fileOk пропускает .js из src/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { SRC_DIR, startLocalServer } from './helpers/local-server.mjs';

const require = createRequire(import.meta.url);
const localGuard = require('../../src/localguard.js');

const read = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');

test('L7: в widget.html нет встроенного скрипта, в CSP нет unsafe-inline, поведение — в widget.js', () => {
  const html = read('widget.html');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)];
  assert.equal(inline.length, 0, 'встроенных <script> в панели быть не должно');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(csp, 'CSP панели есть');
  const scriptSrc = /(?:^|;)\s*script-src([^;]*)/.exec(csp[1]);
  assert.ok(scriptSrc, 'script-src в CSP есть');
  assert.doesNotMatch(scriptSrc[1], /unsafe-inline|unsafe-eval/, 'script-src: ' + scriptSrc[1].trim());
  assert.match(html, /<script src="\/widget\.js"><\/script>/, 'скрипт подключён файлом');
  // сервер отдаёт .js из src/ — отдельного правила не нужно, но пусть будет проверено
  assert.ok(localGuard.fileOk(path.resolve(SRC_DIR), path.join(SRC_DIR, 'widget.js')), 'widget.js отдаётся');
  // весь прежний код панели на месте (перенос без изменения поведения)
  const js = read('widget.js');
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'widget.js' }), 'widget.js синтаксически целый');
  for (const part of ['EventSource(\'/widget/events\')', '/widget/state', '/widget/rq', '/widget/setting', '/widget/cmd/']) {
    assert.ok(js.includes(part), 'в widget.js есть ' + part);
  }
  assert.doesNotMatch(js, /<\/script>/i);
});

test('L7: локальный сервер отдаёт /widget и /widget.js', async () => {
  const s = await startLocalServer();
  try {
    const page = await fetch(s.base + '/widget');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<script src="\/widget\.js">/);
    const js = await fetch(s.base + '/widget.js');
    assert.equal(js.status, 200);
    assert.match(String(js.headers.get('content-type')), /javascript/i);
    const text = await js.text();
    assert.match(text, /EventSource\('\/widget\/events'\)/);
    assert.doesNotMatch(text, /<script/i);
  } finally { await s.close(); }
});
