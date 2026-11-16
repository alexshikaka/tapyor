// Страница QR-кода для OBS (src/sitepage.js). Зачем тест: раньше она грузила qrcodejs с cdnjs —
// то есть каждый зритель стримера тянул чужой скрипт с чужого сервера. Теперь QR рисует сам Тапёр
// готовым SVG: ни <script>, ни внешних адресов (А8, PRIVACY.md, THIRD-PARTY.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const site = require('../../src/sitepage.js');

const P = { nick: 'Тест', qrCaption: 'Заказать песню', colors: { pri: '#8B7CF6' } };
const URL1 = 'https://example.github.io/tapyor-page/';

test('qr: страница без единого скрипта и без cdnjs', () => {
  const html = site.buildQr(P, URL1);
  assert.ok(!/<script/i.test(html), 'в qr.html не должно быть <script>');
  assert.ok(!/cdnjs/i.test(html), 'cdnjs больше не используется');
  assert.ok(!/qrcodejs/i.test(html), 'внешняя библиотека QR не упоминается');
  assert.ok(!/\son\w+\s*=/i.test(html), 'нет встроенных обработчиков on*');
});

test('qr: внешних адресов нет — только xmlns SVG (это не запрос в сеть)', () => {
  const html = site.buildQr(P, URL1);
  const ext = (html.match(/https?:\/\/[^"'\s>]+/g) || []).filter((u) => !/^http:\/\/www\.w3\.org\//.test(u));
  assert.deepEqual(ext, [], 'в qr.html нет ни одного внешнего адреса: ' + ext.join(', '));
});

test('qr: SVG встроен, не пустой и содержит рисунок', () => {
  const html = site.buildQr(P, URL1);
  assert.match(html, /<svg[\s>]/i, 'SVG на месте');
  const m = html.match(/<svg[\s\S]*?<\/svg>/i);
  assert.ok(m, 'SVG закрыт');
  assert.ok(m[0].length > 500, 'SVG не пустой: ' + m[0].length + ' знаков');
  assert.match(m[0], /(path|<rect)/i, 'внутри есть модули кода');
  assert.match(m[0], /viewBox|width=/i, 'у SVG есть размеры');
});

test('qr: при смене адреса рисунок меняется', () => {
  const a = site.buildQr(P, 'https://example.github.io/one/');
  const b = site.buildQr(P, 'https://example.github.io/two/');
  const svg = (h) => (h.match(/<svg[\s\S]*?<\/svg>/i) || [''])[0];
  assert.notEqual(svg(a), svg(b), 'другой адрес — другой код');
});

test('qr: прозрачный фон для OBS остался', () => {
  const html = site.buildQr(P, URL1);
  assert.match(html, /html,body\{[^}]*background:transparent/, 'фон страницы прозрачный');
});

test('qr: подпись экранируется, а не вставляется как разметка', () => {
  const html = site.buildQr({ qrCaption: '<script>alert(1)</script>' }, URL1);
  assert.ok(!/<script/i.test(html), 'подпись не стала скриптом');
  assert.match(html, /&lt;script&gt;/, 'подпись экранирована');
});
