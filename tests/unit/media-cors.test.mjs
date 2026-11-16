// B7b (P5c №6): заголовок Access-Control-Allow-Origin: * добавлялся ко всем медиа-ответам
// общей сессии. Вкладка «Браузер» (в т.ч. YouTube) живёт в той же сессии, поэтому чужой сайт
// мог читать медиа-ответы. Теперь заголовок — только запросам страниц самого Тапёра.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MC = require('../../src/media-cors.js');

const opts = { mainWebContentsId: 7, origins: ['http://127.0.0.1:47654', 'http://localhost:47654'] };

test('media-cors: запрос самого окна Тапёра — свой', () => {
  assert.equal(MC.isOwn({ webContentsId: 7 }, opts), true);
  assert.equal(MC.isOwn({ webContentsId: 7, referrer: 'https://www.youtube.com/' }, opts), true, 'iframe внутри окна — тот же webContents');
  assert.equal(MC.isOwn({ webContentsId: 7, referrer: 'https://evil.example/' }, opts), true, 'главное — id окна');
});

test('media-cors: чужая вкладка «Браузер» и чужой сайт — не свои', () => {
  assert.equal(MC.isOwn({ webContentsId: 9 }, opts), false, 'webview-гость: id другой');
  assert.equal(MC.isOwn({ webContentsId: 9, referrer: 'https://www.youtube.com/watch?v=1' }, opts), false);
  assert.equal(MC.isOwn({ webContentsId: 9, referrer: 'https://evil.example/' }, opts), false);
});

test('media-cors: запасной путь по referrer — только свои адреса', () => {
  assert.equal(MC.isOwn({ webContentsId: 0, referrer: 'http://127.0.0.1:47654/index.html' }, opts), true);
  assert.equal(MC.isOwn({ webContentsId: 0, referrer: 'http://localhost:47654/' }, opts), true);
  assert.equal(MC.isOwn({ webContentsId: 0, referrer: 'http://127.0.0.1:47655/' }, opts), false, 'чужой порт');
  assert.equal(MC.isOwn({ webContentsId: 0, referrer: 'http://127.0.0.1:47654.evil/' }, opts), false);
  assert.equal(MC.isOwn({ webContentsId: 0, referrer: 'https://127.0.0.1:47654/' }, opts), false, 'не наш протокол');
  assert.equal(MC.isOwn({ webContentsId: 0, referrer: 'мусор' }, opts), false);
  assert.equal(MC.isOwn({ webContentsId: 0 }, opts), false, 'referrer нет — отказ');
});

test('media-cors: без главного окна и без данных — отказ', () => {
  assert.equal(MC.isOwn({ webContentsId: 7 }, { mainWebContentsId: 0, origins: [] }), false);
  assert.equal(MC.isOwn(null, opts), false);
  assert.equal(MC.isOwn({}, null), false);
  assert.equal(MC.originOf('http://127.0.0.1:47654/index.html'), 'http://127.0.0.1:47654');
  assert.equal(MC.originOf(''), '');
});
