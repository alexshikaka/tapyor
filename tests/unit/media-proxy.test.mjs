import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMediaProxy } = require('../../src/media-proxy.js');

function targetServer() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(206, {
        'content-type': 'video/mp4',
        'accept-ranges': 'bytes',
        'content-range': 'bytes 0-3/4'
      });
      res.end('TEST');
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('media-proxy: Range и локальный URL', async () => {
  const target = await targetServer();
  const port = target.address().port;
  // тесты поднимают свой сервер на 127.0.0.1 — в приложении такой адрес запрещён
  const proxy = createMediaProxy(() => {}, { allowHosts: [/^127\.0\.0\.1$/], allowPrivate: true });
  try {
    const local = await proxy.localize(`http://127.0.0.1:${port}/media`);
    assert.match(local.url, /^http:\/\/127\.0\.0\.1:\d+\/s\/[a-f0-9]{32}$/);
    const r = await fetch(local.url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-type'), 'video/mp4');
    assert.equal(r.headers.get('content-range'), 'bytes 0-3/4');
    assert.equal(await r.text(), 'TEST');
  } finally {
    await proxy.close();
    await new Promise((resolve) => target.close(resolve));
  }
});

test('media-proxy: неизвестный токен — 404', async () => {
  const target = await targetServer();
  const port = target.address().port;
  // тесты поднимают свой сервер на 127.0.0.1 — в приложении такой адрес запрещён
  const proxy = createMediaProxy(() => {}, { allowHosts: [/^127\.0\.0\.1$/], allowPrivate: true });
  try {
    const local = await proxy.localize(`http://127.0.0.1:${port}/media`);
    const bad = local.url.replace(/[a-f0-9]{32}$/, '0'.repeat(32));
    const r = await fetch(bad);
    assert.equal(r.status, 404);
  } finally {
    await proxy.close();
    await new Promise((resolve) => target.close(resolve));
  }
});

test('media-proxy: чужой хост не проксируется', async () => {
  const proxy = createMediaProxy(() => {});   // список по умолчанию, как в приложении
  try {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',   // метаданные облака
      'http://192.168.1.1/',                         // роутер в домашней сети
      'http://127.0.0.1:8080/secret',                // что-то на своём компьютере
      'https://evil.example/stream'                  // просто чужой сайт
    ]) {
      const r = await proxy.localize(url);
      assert.ok(r && r.error, 'ожидался отказ для ' + url);
      assert.ok(!r.url, 'токен выдавать нельзя: ' + url);
    }
    const ok = await proxy.localize('https://rr1---sn-abc.googlevideo.com/videoplayback?x=1');
    assert.ok(ok && (ok.url || ok.error !== 'адрес не разрешён'), 'googlevideo должен проходить проверку списка');
  } finally {
    await proxy.close();
  }
});

test('media-proxy: запрос с чужим Host отклоняется', async () => {
  const target = await targetServer();
  const port = target.address().port;
  const proxy = createMediaProxy(() => {}, { allowHosts: [/^127\.0\.0\.1$/], allowPrivate: true });
  try {
    const local = await proxy.localize(`http://127.0.0.1:${port}/media`);
    const u = new URL(local.url);
    // fetch не даёт подменить Host, поэтому запрос делаем вручную
    const code = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { Host: 'evil.example' } },
        (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(code, 403, 'подменённый Host должен давать 403');
  } finally {
    await proxy.close();
    await new Promise((resolve) => target.close(resolve));
  }
});
