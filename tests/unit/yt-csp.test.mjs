// CSP плеера YouTube (P5c №1, B11): чужой скрипт iframe_api больше не выполняется в окне с window.app.
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

test('главное окно: сторонних скриптов YouTube больше нет', () => {
  const c = csp('index.html');
  const s = dir(c, 'script-src');
  assert.ok(s, 'есть script-src');
  assert.ok(!/youtube\.com|ytimg\.com/i.test(s), 'в script-src нет YouTube: ' + s);
  const f = dir(c, 'frame-src');
  assert.match(f, /http:\/\/localhost:\*/, 'frame-src пускает плеер с localhost: ' + f);
  assert.ok(!/youtube\.com/i.test(f), 'в frame-src нет YouTube: ' + f);
});

test('страница плеера: своя строгая CSP', () => {
  const c = csp('ytplayer.html');
  assert.match(dir(c, 'default-src'), /'none'/, 'всё запрещено по умолчанию');
  const s = dir(c, 'script-src');
  assert.match(s, /'self'/);
  assert.match(s, /https:\/\/www\.youtube\.com/);
  assert.match(s, /https:\/\/s\.ytimg\.com/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(c), 'без unsafe-*: ' + c);
  const f = dir(c, 'frame-src');
  assert.match(f, /https:\/\/www\.youtube\.com/);
  assert.match(f, /https:\/\/www\.youtube-nocookie\.com/);
  assert.match(dir(c, 'connect-src'), /https:\/\/www\.youtube\.com/);
});

test('страница плеера: только свои скрипты, без моста окна', () => {
  const src = html('ytplayer.html');
  assert.ok(/<script src="yt-msg\.js"><\/script>/.test(src), 'подключён формат сообщений');
  assert.ok(/<script src="ytplayer\.js"><\/script>/.test(src), 'подключён скрипт плеера');
  assert.ok(!/preload\.js/.test(src), 'preload не подключён');
  assert.ok(!/window\.app/.test(src), 'window.app не упоминается');
  assert.ok(!/<script>[\s\S]*?<\/script>/.test(src), 'нет встроенных скриптов');
});
