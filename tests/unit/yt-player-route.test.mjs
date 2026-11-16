// Локальная отдача страницы плеера YouTube (P5c №1, B11): свои файлы отдаются,
// встраивать страницу можно только в окно Тапёра.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g = require('../../src/localguard.js');
const R = path.resolve('/app/src');

test('файлы страницы плеера отдаются, оба имени своего адреса пускаются', () => {
  for (const f of ['ytplayer.html', 'ytplayer.js', 'yt-msg.js', 'ytplayer.css', 'app.css']) {
    assert.equal(g.fileOk(R, path.join(R, f)), true, f);
  }
  assert.equal(g.hostOk({ host: 'localhost:47654' }, 47654), true);
  assert.equal(g.hostOk({ host: '127.0.0.1:47654' }, 47654), true);
  assert.equal(g.hostOk({ host: 'localhost:47655' }, 47654), false);
});

test('встраивать плеер можно только в окно Тапёра', () => {
  assert.equal(g.ytPlayerCsp(47654), "frame-ancestors 'self' http://127.0.0.1:47654 http://localhost:47654");
  assert.match(g.ytPlayerCsp(12345), /http:\/\/127\.0\.0\.1:12345/);
  assert.match(g.ytPlayerCsp(12345), /http:\/\/localhost:12345/);
  assert.ok(!/youtube|evil|example\.com/.test(g.ytPlayerCsp(47654)), 'чужих адресов нет');
});
