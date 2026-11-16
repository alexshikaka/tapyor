// L9 (аудит 0.32.0): страницам пака ядро ставит строгий CSP и X-Content-Type-Options: nosniff.
// Проверяем настоящий локальный сервер (src/main/local-server.js) без Electron — тот же код, что в программе.
// Сам заголовок не зависит от версии пака: его ставит сервер до вызова страницы модуля.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startLocalServer } from './helpers/local-server.mjs';

const require = createRequire(import.meta.url);
const localGuard = require('../../src/localguard.js');

test('L9: страница модуля отдаётся с MOD_PAGE_CSP и nosniff, POST и чужой Origin отклоняются', async () => {
  const s = await startLocalServer();
  try {
    s.host.mount('/modtest', (req, res, rel) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html>' + rel + '</html>');
    });
    // Переход на саму страницу (так открывает OBS) — отдаётся с заголовками
    const r = await fetch(s.base + '/modtest/playlist', { headers: { 'Sec-Fetch-Mode': 'navigate' } });
    assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy');
    assert.equal(csp, localGuard.modPageCsp(s.port), 'CSP ровно тот, что отдаёт localguard');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.match(csp, /default-src 'none'/);
    const anc = /frame-ancestors([^;]*)/.exec(csp)[1].trim().split(/\s+/);
    assert.deepEqual(anc, ["'self'", 'http://127.0.0.1:' + s.port, 'http://localhost:' + s.port], 'встраивать можно только свои адреса');

    // Страницы модулей — только чтение
    const post = await fetch(s.base + '/modtest/playlist', { method: 'POST' });
    assert.equal(post.status, 405);

    // Чужой сайт не получит поток оверлея (M6) — и это видно на уровне сервера
    const bad = await fetch(s.base + '/modtest/playlist', { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.status, 403);
  } finally { await s.close(); }
});
