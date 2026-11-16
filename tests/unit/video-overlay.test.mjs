// VO1: «Видео для OBS» — страница /video и выбор вида картинки.
// Проверяем чистую логику страницы (перемотка с учётом at и порога 0,6 с, адрес встроенного
// плеера), выбор вида в окне Тапёра, CSP страницы и отдачу локальным сервером (/video, /video/events).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SRC_DIR, startLocalServer } from './helpers/local-server.mjs';

const require = createRequire(import.meta.url);
const { seekTarget, needsSeek, embedUrl, ytEstimate, ytNeedsSeek } = require('../../src/video-overlay.js');
const { voPickKind } = require('../../src/ui/33-video-obs.js');
const G = require('../../src/localguard.js');

const PORT = 47654;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('страница /video: перемотка учитывает at и порог 0,6 с', () => {
  assert.equal(seekTarget({ t: 10, at: 1000, playing: true }, 3000), 12, 'пока играет — досчитываем время');
  assert.equal(seekTarget({ t: 10, at: 1000, playing: false }, 3000), 10, 'на паузе время не идёт');
  assert.equal(seekTarget({ t: 0, at: 5000, playing: true }, 4000), 0, 'отрицательное время не уходит');
  assert.equal(seekTarget({ t: 10 }, 3000), 10, 'без at — просто t');
  assert.equal(seekTarget(null, 1000), 0, 'нет состояния — 0');
  assert.equal(seekTarget({ t: '7.5', at: 0, playing: false }, 1000), 7.5);

  const st = { t: 12, at: 1000, playing: false };
  assert.equal(needsSeek(st, 2000, 11.5), false, 'расхождение 0,5 с — не перематываем');
  assert.equal(needsSeek(st, 2000, 11.3), true, 'расхождение 0,7 с — перематываем');

  // Учёт at: за 10 секунд картинка должна уйти на 10 секунд вперёд
  const live = { t: 100, at: 0, playing: true };
  assert.equal(needsSeek(live, 10000, 109.5), false, '0,5 с от досчитанного — не трогаем');
  assert.equal(needsSeek(live, 10000, 109.2), true, '0,8 с от досчитанного — перематываем');
  assert.equal(needsSeek(live, 10000, 108.5, 2), false, 'свой порог: 1,5 с — не трогаем');
  assert.equal(needsSeek(live, 10000, 107.5, 2), true, 'свой порог: 2,5 с — перематываем');
});

test('страница /video: адрес встроенного плеера YouTube', () => {
  const st = { t: 12.9, at: 1000, playing: false };
  assert.equal(
    embedUrl('abc', st, 2000),
    'https://www.youtube-nocookie.com/embed/abc?autoplay=1&mute=1&controls=0&start=12',
    'кнопки, автозапуск и старт целыми секундами'
  );
  assert.match(embedUrl('a b', st, 2000), /embed\/a%20b\?/, 'id кодируется');
  assert.equal(embedUrl('', st, 2000), '', 'без ytId адреса нет');
  assert.match(embedUrl('abc', st, 2000, 'http://127.0.0.1:47654'), /&enablejsapi=1&origin=http%3A%2F%2F127\.0\.0\.1%3A47654$/,
    'со страницы — команды плееру разрешены и указан свой адрес');
});

test('страница /video: подгонка встроенного плеера YouTube (15.11)', () => {
  assert.equal(ytEstimate(null, 0, true, 1000), null, 'время плеера ещё неизвестно');
  assert.equal(ytEstimate(10, 1000, true, 3000), 12, 'играет — время идёт');
  assert.equal(ytEstimate(10, 1000, false, 3000), 10, 'пауза — стоит');
  const st = { t: 50, at: 1000, playing: true };
  assert.equal(ytNeedsSeek(st, 1000, 49.5), false, 'полсекунды — не дёргаем');
  assert.equal(ytNeedsSeek(st, 1000, 40), true, 'отстал на 10 с — перематываем');
  assert.equal(ytNeedsSeek(st, 1000, null), false, 'пока плеер не ответил — не трогаем');
});

test('какой вид показать: video / iframe / cover / none', () => {
  const base = { track: true, src: 'yt', cover: '', hideAudio: true };
  assert.equal(voPickKind({ ...base, mode: 'split', url: 'https://cdn/v.mp4' }), 'video', 'YouTube: видео + звук');
  assert.equal(voPickKind({ ...base, mode: 'single', url: 'https://cdn/v.mp4' }), 'video', 'YouTube одним потоком');
  assert.equal(voPickKind({ ...base, mode: 'iframe', ytId: 'abc' }), 'iframe', 'запасной встроенный плеер');
  assert.equal(voPickKind({ ...base, mode: 'iframe', ytId: '' }), 'none', 'iframe без id — пусто');

  const noPic = { ...base, src: 'ym', mode: 'audio', cover: 'https://c/cover.jpg' };
  assert.equal(voPickKind(noPic), 'none', 'Яндекс при «скрывать» — прозрачно');
  assert.equal(voPickKind({ ...noPic, hideAudio: false }), 'cover', 'Яндекс без «скрывать» — обложка');
  assert.equal(voPickKind({ ...noPic, cover: '', hideAudio: false }), 'none', 'нет обложки — прозрачно');

  const ytAudio = { track: true, src: 'yt', mode: 'audio', cover: 'https://c/cover.jpg', hideAudio: true };
  assert.equal(voPickKind(ytAudio), 'none', 'качество «Только звук» — прозрачно');
  assert.equal(voPickKind({ ...ytAudio, hideAudio: false }), 'cover', '«Только звук» без «скрывать» — обложка');

  assert.equal(voPickKind({ ...base, track: false, mode: 'split', url: 'https://cdn/v.mp4' }), 'none', 'ничего не играет — пусто');
  assert.equal(voPickKind({ track: true, src: 'lc', mode: 'single', url: '/lfile/x.mp4', cover: 'c', hideAudio: false }), 'cover', 'музыка с компьютера — обложка, не видео');
  assert.equal(voPickKind(null), 'none');
});

test('CSP страницы /video: только свой код и фрейм youtube-nocookie', () => {
  const csp = G.videoPageCsp(PORT);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/, 'встроенных скриптов и стилей нет');
  const frameSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('frame-src '));
  assert.equal(frameSrc, 'frame-src https://www.youtube-nocookie.com', 'ничего лишнего во frame-src: ' + frameSrc);
  assert.match(csp, /media-src[^;]*https:/, 'видео приходит с https');
  assert.match(csp, /frame-ancestors 'self' http:\/\/127\.0\.0\.1:47654 http:\/\/localhost:47654/);
});

test('локальный сервер: /video отдаёт страницу с CSP, скрипт и стиль — отдельными файлами', async () => {
  const s = await startLocalServer();
  try {
    const page = await fetch(s.base + '/video');
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy') || '';
    assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com/);
    const html = await page.text();
    assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].length, 0, 'встроенных <script> нет');
    assert.equal([...html.matchAll(/<style\b/gi)].length, 0, 'встроенных <style> нет');
    assert.match(html, /<script src="video-overlay\.js"><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="video-overlay\.css">/);

    const js = await fetch(s.base + '/video-overlay.js');
    assert.equal(js.status, 200);
    assert.match(String(js.headers.get('content-type')), /javascript/i);
    const css = await fetch(s.base + '/video-overlay.css');
    assert.equal(css.status, 200);
    assert.match(String(css.headers.get('content-type')), /text\/css/);
    assert.ok(fs.existsSync(path.join(SRC_DIR, 'video-overlay.html')), 'страница лежит в src');
  } finally { await s.close(); }
});

test('локальный сервер: /video/events — SSE и счётчик без ?preview=1', async () => {
  const s = await startLocalServer();
  const a1 = new AbortController();
  const a2 = new AbortController();
  try {
    assert.equal(typeof s.host.videoClients, 'function', 'счётчик клиентов отдаётся окну');
    const prev = await fetch(s.base + '/video/events?preview=1', { signal: a1.signal });
    assert.equal(prev.status, 200);
    assert.match(String(prev.headers.get('content-type')), /text\/event-stream/);
    await sleep(150);
    assert.equal(s.host.videoClients(), 0, 'превью не считается зрителем OBS');

    const obs = await fetch(s.base + '/video/events', { signal: a2.signal });
    assert.equal(obs.status, 200);
    await sleep(150);
    assert.equal(s.host.videoClients(), 1, 'страница OBS считается');

    s.host.setVideoState({ kind: 'none', look: { border: false } });
    assert.deepEqual(s.host.videoState(), { kind: 'none', look: { border: false } });
    s.host.videoBroadcast();
  } finally {
    a1.abort(); a2.abort();
    await s.close();
  }
});
