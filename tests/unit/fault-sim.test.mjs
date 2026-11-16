import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('../../src/fault-sim.js');

function sim(opts) { return fs.create(Object.assign({ sleep: async () => {} }, opts || {})); }

test('serviceOf: адреса каждого сервиса', () => {
  assert.equal(fs.serviceOf('https://www.youtube.com/watch?v=abc'), 'yt');
  assert.equal(fs.serviceOf('https://music.youtube.com/playlist?list=x'), 'yt');
  assert.equal(fs.serviceOf('https://i.ytimg.com/vi/abc/mqdefault.jpg'), 'yt');
  assert.equal(fs.serviceOf('https://rr3---sn.googlevideo.com/videoplayback'), 'yt');
  assert.equal(fs.serviceOf('https://oauth2.googleapis.com/token'), 'yt');
  assert.equal(fs.serviceOf('https://api.music.yandex.net/search?text=x'), 'ym');
  assert.equal(fs.serviceOf('https://music.yandex.ru/album/1/track/2'), 'ym');
  assert.equal(fs.serviceOf('https://passport.yandex.ru/auth'), 'ym');
  assert.equal(fs.serviceOf('https://www.donationalerts.com/api/v1/alerts/donations'), 'da');
  assert.equal(fs.serviceOf('https://donatepay.ru/api/v1/user'), 'dp');
  assert.equal(fs.serviceOf('https://api.twitch.tv/helix/chat/messages'), 'twitch');
  assert.equal(fs.serviceOf('wss://eventsub.wss.twitch.tv/ws'), 'twitch');
  assert.equal(fs.serviceOf('https://ws.audioscrobbler.com/2.0/'), 'lastfm');
  assert.equal(fs.serviceOf('https://functions.yandexcloud.net/d4eabc'), 'cloud');
});

test('serviceOf: чужие адреса и подделки — null', () => {
  assert.equal(fs.serviceOf('https://example.com/api'), null);
  assert.equal(fs.serviceOf('https://notyoutube.com/watch'), null);
  assert.equal(fs.serviceOf('https://youtube.com.evil.example/watch'), null);
  assert.equal(fs.serviceOf('https://api.music.yandex.net.evil.example/'), null);
  assert.equal(fs.serviceOf('https://yandexcloud.net.example.com/'), null);
  assert.equal(fs.serviceOf(''), null);
  assert.equal(fs.serviceOf(null), null);
  assert.equal(fs.serviceOf('не адрес'), null);
});

test('down: ответ 503 через обёртку fetch', async () => {
  const s = sim({ log: () => {} });
  s.set('yt', 'down');
  let called = 0;
  const r = await s.wrapFetch(() => { called++; return 'real'; })('https://www.youtube.com/watch?v=x');
  assert.equal(r.status, 503);
  assert.equal(called, 0);
});

test('auth: ответ 401 через обёртку fetch', async () => {
  const s = sim({ log: () => {} });
  s.set('da', 'auth');
  const r = await s.wrapFetch(() => 'real')('https://www.donationalerts.com/api/v1/user/oauth');
  assert.equal(r.status, 401);
});

test('offline: TypeError(fetch failed) с cause.code ENOTFOUND', async () => {
  const s = sim({ log: () => {} });
  s.set('lastfm', 'offline');
  await assert.rejects(
    () => s.wrapFetch(() => 'real')('https://ws.audioscrobbler.com/2.0/'),
    (e) => e instanceof TypeError && e.message === 'fetch failed' && e.cause && e.cause.code === 'ENOTFOUND'
  );
});

test('slow: ждёт 8 секунд, затем обычный запрос', async () => {
  const waits = [];
  const s = sim({ sleep: async (ms) => { waits.push(ms); }, log: () => {} });
  s.set('ym', 'slow');
  const r = await s.wrapFetch(() => 'real')('https://api.music.yandex.net/search');
  assert.equal(r, 'real');
  assert.deepEqual(waits, [8000]);
});

test('applyCall: тайм-аут вызывающего меньше задержки срабатывает раньше', async () => {
  const waits = [];
  const s = sim({ sleep: async (ms) => { waits.push(ms); }, log: () => {} });
  s.set('yt', 'slow');
  let ran = false;
  await assert.rejects(
    () => s.applyCall('yt', () => { ran = true; return 'ok'; }, { timeoutMs: 3000 }),
    /timeout/
  );
  assert.equal(ran, false);
  assert.deepEqual(waits, [3000]);
});

test('без имитации обёртка зовёт настоящий fetch с теми же аргументами', () => {
  const s = sim();
  let got = null;
  const real = function () { got = { args: Array.prototype.slice.call(arguments), self: this }; return 'ok'; };
  const init = { method: 'POST', body: 'x' };
  const w = s.wrapFetch(real);
  const ctx = { marker: 1 };
  assert.equal(w.call(ctx, 'https://example.com/api', init), 'ok');
  assert.equal(got.self, ctx);
  assert.equal(got.args.length, 2);
  assert.equal(got.args[0], 'https://example.com/api');
  assert.equal(got.args[1], init);
});

test('clear всё выключает и режимы по сервисам снимаются', () => {
  const s = sim();
  s.set('yt', 'down');
  s.set('ym', 'offline');
  s.set('all', 'slow');
  assert.equal(s.active().length, 3);
  s.clear('yt');
  assert.equal(s.modeForUrl('https://www.youtube.com/'), 'slow');
  s.clear();
  assert.equal(s.isEmpty(), true);
  assert.deepEqual(s.active(), []);
  assert.equal(s.modeForUrl('https://www.youtube.com/'), null);
});

test('вся сеть: свой режим сервиса важнее, чужие адреса тоже ловятся', () => {
  const s = sim();
  s.set('all', 'offline');
  s.set('yt', 'down');
  assert.equal(s.modeForUrl('https://www.youtube.com/watch'), 'down');
  assert.equal(s.modeForUrl('https://example.com/'), 'offline');
  assert.deepEqual(s.active().map((x) => x.service), ['all', 'yt']);
});

test('active: «вся сеть» первой, затем постоянный порядок сервисов', () => {
  const s = sim();
  s.set('lastfm', 'auth');
  s.set('yt', 'down');
  s.set('all', 'slow');
  assert.deepEqual(s.active(), [
    { service: 'all', mode: 'slow' },
    { service: 'yt', mode: 'down' },
    { service: 'lastfm', mode: 'auth' }
  ]);
});

test('журнал: не чаще раза в 10 секунд на сервис', () => {
  let t = 1000;
  const lines = [];
  const s = fs.create({ now: () => t, log: (m) => lines.push(m), sleep: async () => {} });
  s.set('yt', 'down');
  s.wrapFetch(() => 'x')('https://www.youtube.com/');
  s.wrapFetch(() => 'x')('https://youtu.be/abc');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /имитация: YouTube — недоступен, запрос к www\.youtube\.com/);
  t += 10001;
  s.wrapFetch(() => 'x')('https://www.youtube.com/');
  assert.equal(lines.length, 2);
});

test('неизвестный сервис и режим не принимаются', () => {
  const s = sim();
  assert.equal(s.set('evil', 'down'), false);
  assert.equal(s.set('yt', 'explode'), false);
  assert.equal(s.set('yt', 'down'), true);
  assert.deepEqual(s.state(), { yt: 'down' });
});
