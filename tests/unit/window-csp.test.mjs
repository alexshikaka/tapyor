// B13 (остаток L7/P5c): CSP главного окна. connect-src — точный список хостов, а не «любой https».
// Само окно в сеть ходит только через hls.js (CDN потоков SoundCloud/Bandcamp); поиск, потоки,
// отчёты и прочее идут через главный процесс, поэтому их адресов в connect-src быть не должно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function html(file) { return fs.readFileSync(path.join(root, 'src', file), 'utf8'); }
function csp(file) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i.exec(html(file));
  assert.ok(m, file + ': нет CSP');
  return m[1];
}
function dir(c, name) {
  return c.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) || '';
}
function sources(c, name) {
  return dir(c, name).split(/\s+/).slice(1).filter(Boolean);
}

// Хосты, к которым окно ходит само: hls.js тянет список и куски потоков SoundCloud.
// Медиа-CDNN те же, что в правиле CORS главного процесса (src/main.js:897): sndcdn.com,
// soundcloud.cloud, bcbits.com.
const WINDOW_HOSTS = ['https://*.sndcdn.com', 'https://*.soundcloud.cloud', 'https://*.bcbits.com'];

test('главное окно: в connect-src нет «любого https» и «любого http»', () => {
  const c = csp('index.html');
  const src = sources(c, 'connect-src');
  assert.ok(src.length > 0, 'есть connect-src: ' + c);
  assert.ok(!src.includes('https:'), 'connect-src не разрешает любой https: ' + dir(c, 'connect-src'));
  assert.ok(!src.includes('http:'), 'connect-src не разрешает любой http: ' + dir(c, 'connect-src'));
  assert.ok(!src.includes('*'), 'connect-src без «*»: ' + dir(c, 'connect-src'));
  assert.ok(src.includes("'self'"), 'свой сервер: ' + dir(c, 'connect-src'));
  assert.ok(src.includes('http://127.0.0.1:*'), 'свой сервер и медиа-прокси на петле: ' + dir(c, 'connect-src'));
});

test('главное окно: каждый внешний адрес connect-src — точный хост с https://', () => {
  const src = sources(csp('index.html'), 'connect-src')
    .filter((x) => x !== "'self'" && x !== 'http://127.0.0.1:*');
  assert.ok(src.length > 0, 'в connect-src есть хосты потоков');
  for (const x of src) {
    assert.match(x, /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'точный хост с https:// и без пути: ' + x);
  }
  for (const h of WINDOW_HOSTS) assert.ok(src.includes(h), 'в connect-src нужен ' + h + ': ' + src.join(' '));
});

test('главное окно: обложки и потоки не открыты «*», https остаётся осознанно', () => {
  const c = csp('index.html');
  for (const name of ['img-src', 'media-src']) {
    assert.ok(dir(c, name), 'есть ' + name);
    assert.ok(!sources(c, name).includes('*'), name + ' без «*»: ' + dir(c, name));
    // Обложки и потоки приходят с десятков меняющихся CDN — узкий список сломал бы показ (B13, п. 3).
    assert.ok(sources(c, name).includes('https:'), name + ' пускает обложки/потоки с https: ' + dir(c, name));
  }
});
