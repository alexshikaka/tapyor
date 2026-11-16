// Формат сообщений между окном Тапёра и страницей плеера YouTube (P5c №1, B11).
// Проверяем чистые функции: белый список типов, типы полей, границы чисел и адрес петли.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../src/yt-msg.js');

const cmd = (o) => Object.assign({ t: 1, dir: 'cmd' }, o);
const evt = (o) => Object.assign({ t: 1, dir: 'evt' }, o);

test('команды: белый список и поля нужных типов', () => {
  assert.deepEqual(M.parseCmd(cmd({ type: 'play' })), { type: 'play' });
  assert.deepEqual(M.parseCmd(cmd({ type: 'pause' })), { type: 'pause' });
  assert.deepEqual(M.parseCmd(cmd({ type: 'load', id: 'dQw4w9WgXcQ' })), { type: 'load', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(M.parseCmd(cmd({ type: 'seek', value: 12.5 })), { type: 'seek', value: 12.5 });
  assert.deepEqual(M.parseCmd(cmd({ type: 'volume', value: 80 })), { type: 'volume', value: 80 });
  // Лишние поля не мешают: формат знает только свои.
  assert.deepEqual(M.parseCmd(cmd({ type: 'play', extra: 'мусор' })), { type: 'play' });
});

test('команды: мусор отклоняется', () => {
  const bad = [
    null, undefined, 0, 'play', [], {},
    cmd({ type: 'stop' }),
    cmd({ type: '' }),
    { t: 2, dir: 'cmd', type: 'play' },
    { t: 1, dir: 'evt', type: 'play' },
    { dir: 'cmd', type: 'play' },
    cmd({ type: 'load' }),
    cmd({ type: 'load', id: '' }),
    cmd({ type: 'load', id: 7 }),
    cmd({ type: 'load', id: 'x'.repeat(65) }),
    cmd({ type: 'load', id: 'a b' }),
    cmd({ type: 'load', id: 'javascript:alert(1)' }),
    cmd({ type: 'seek' }),
    cmd({ type: 'seek', value: '2' }),
    cmd({ type: 'seek', value: NaN }),
    cmd({ type: 'seek', value: Infinity }),
    cmd({ type: 'seek', value: -1 }),
    cmd({ type: 'seek', value: 1e9 }),
    cmd({ type: 'volume' }),
    cmd({ type: 'volume', value: '80' }),
    cmd({ type: 'volume', value: -1 }),
    cmd({ type: 'volume', value: 101 }),
    cmd({ type: 'volume', value: NaN })
  ];
  for (const b of bad) assert.equal(M.parseCmd(b), null, JSON.stringify(b));
});

test('события: белый список и поля нужных типов', () => {
  assert.deepEqual(M.parseEvt(evt({ type: 'ready' })), { type: 'ready' });
  for (const v of [-1, 0, 1, 2, 3, 5]) assert.deepEqual(M.parseEvt(evt({ type: 'state', value: v })), { type: 'state', value: v });
  assert.deepEqual(M.parseEvt(evt({ type: 'time', value: 3.25 })), { type: 'time', value: 3.25 });
  assert.deepEqual(M.parseEvt(evt({ type: 'duration', value: 240 })), { type: 'duration', value: 240 });
  assert.deepEqual(M.parseEvt(evt({ type: 'error', value: 150 })), { type: 'error', value: 150 });
  // Лишние поля не мешают и здесь: формат знает только свои.
  assert.deepEqual(M.parseEvt(evt({ type: 'ready', extra: 1 })), { type: 'ready' });
});

test('события: мусор отклоняется', () => {
  const bad = [
    null, {}, evt({ type: 'play' }),
    { t: 1, dir: 'cmd', type: 'ready' },
    evt({ type: 'state' }), evt({ type: 'state', value: 4 }), evt({ type: 'state', value: 1.5 }),
    evt({ type: 'time', value: -1 }), evt({ type: 'duration', value: '10' }),
    evt({ type: 'error', value: 'x' }), evt({ type: 'error', value: 1e6 })
  ];
  for (const b of bad) assert.equal(M.parseEvt(b), null, JSON.stringify(b));
});

test('адрес: только петля, только http и только настоящий порт', () => {
  assert.equal(M.parseLoopbackOrigin('http://127.0.0.1:47654'), 'http://127.0.0.1:47654');
  assert.equal(M.parseLoopbackOrigin('http://localhost:1'), 'http://localhost:1');
  assert.equal(M.parseLoopbackOrigin('HTTP://LOCALHOST:8080'), 'http://localhost:8080');
  for (const b of ['', null, undefined, 'https://localhost:8080', 'http://127.0.0.1', 'http://127.0.0.1:0',
    'http://127.0.0.1:65536', 'http://127.0.0.1:8080/x', 'http://evil.example:8080',
    'http://localhost.evil:8080', 'http://[::1]:8080', 'file:///x']) {
    assert.equal(M.parseLoopbackOrigin(b), '', String(b));
    assert.equal(M.isLoopbackOrigin(b), false, String(b));
  }
});
