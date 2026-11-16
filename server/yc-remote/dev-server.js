'use strict';
// Локальный сервер для ручных проверок пульта: страница телефона → эта функция → поддельный Тапёр.
// Слушает только 127.0.0.1. Хранилище — в памяти (YDB и ydb-sdk не нужны).
//
// Запуск: node server/yc-remote/dev-server.js [порт]     (по умолчанию 8879)
// Проверка: new → host → poll, например:
//   node -e "fetch('http://127.0.0.1:8879/?op=new',{method:'POST',body:'{}'}).then(r=>r.text()).then(console.log)"
// В лог — только вид запроса и код ответа: ни sid, ни host, ни тела.

process.env.TAPYOR_TEST_STORE = 'memory'; // до загрузки index.js — чтобы взялось хранилище в памяти
const http = require('http');
const { handler } = require('./index');

const PORT = Number(process.argv[2]) || 8879;
const HOST = '127.0.0.1';
const MAX_BODY = 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too big'), { code: 'too_big' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function queryOf(url) {
  const q = {};
  for (const [k, v] of url.searchParams) q[k] = v;
  return q;
}

const server = http.createServer(async (req, res) => {
  let op = '';
  try {
    const url = new URL(req.url || '/', 'http://' + HOST + ':' + PORT);
    const query = queryOf(url);
    op = String(query.op || '');
    const body = await readBody(req);
    const event = {
      httpMethod: req.method,
      headers: req.headers,
      queryStringParameters: query,
      body,
      isBase64Encoded: false,
      // Адрес видит только локальный сервер; в облаке его подставляет шлюз (server/common/ip.js).
      requestContext: { identity: { sourceIp: req.socket.remoteAddress || HOST } }
    };
    const r = await handler(event);
    res.writeHead(r.statusCode, r.headers || {});
    res.end(r.body || '');
    console.log('dev-server: ' + (op || '?') + ' → ' + r.statusCode);
  } catch (e) {
    const tooBig = e && e.code === 'too_big';
    console.log('dev-server: ' + (op || '?') + ' → ' + (tooBig ? 413 : 500));
    if (!res.headersSent) res.writeHead(tooBig ? 413 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: tooBig ? 'too big' : 'server', tapyor_error: tooBig ? 'too_big' : 'server' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log('dev-server: http://' + HOST + ':' + PORT + ' (хранилище в памяти, только локально)');
});
