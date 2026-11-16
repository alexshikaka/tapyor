// T1: unit-тесты localguard.js — защита локального сервера: Host, команды панели,
// файлы страницы, разрешения браузера и белые списки настроек.
// Раньше это проверялось только скриптом tests/security (не входит в npm run test:unit).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../../src/localguard.js');

const PORT = 47654;
const root = mkdtempSync(join(tmpdir(), 'tapyor-guard-'));
after(() => rmSync(root, { recursive: true, force: true }));

// ---------- Host ----------

test('localguard.hostOk: только 127.0.0.1/localhost с нашим портом', () => {
  assert.equal(G.hostOk({ host: '127.0.0.1:' + PORT }, PORT), true);
  assert.equal(G.hostOk({ host: 'LOCALHOST:' + PORT }, PORT), true);
  assert.equal(G.hostOk({ host: 'localhost:' + PORT }, PORT), true);
  for (const h of ['127.0.0.1', 'localhost:1', 'evil.com:' + PORT, '127.0.0.1:' + PORT + '.evil', 'http://127.0.0.1:' + PORT, '', null, undefined, 123]) {
    assert.equal(G.hostOk(h && typeof h === 'object' ? h : { host: h }, PORT), false, String(h));
  }
  assert.equal(G.hostOk(null, PORT), false);
});

// ---------- команды панели ----------

test('localguard.isWidgetCommand: только три пути панели', () => {
  for (const p of ['/widget/rq', '/widget/setting', '/widget/cmd/next', '/widget/cmd/']) assert.equal(G.isWidgetCommand(p), true, p);
  for (const p of ['/widget/cmd', '/widget/rq/x', '/widget', '/overlay/events', '']) assert.equal(G.isWidgetCommand(p), false, String(p));
});

test('localguard.commandOk: только POST и только со своей страницы', () => {
  assert.equal(G.commandOk('POST', { origin: 'http://127.0.0.1:' + PORT }, PORT), true);
  assert.equal(G.commandOk('post', { origin: 'http://localhost:' + PORT }, PORT), true);
  for (const [method, origin] of [
    ['GET', 'http://127.0.0.1:' + PORT],
    ['POST', 'https://127.0.0.1:' + PORT],
    ['POST', 'http://127.0.0.1:' + (PORT + 1)],
    ['POST', 'http://127.0.0.1:' + PORT + '/'],
    ['POST', ''],
    ['POST', null],
  ]) {
    assert.equal(G.commandOk(method, { origin }, PORT), false, method + ' ' + origin);
  }
  assert.equal(G.commandOk('POST', null, PORT), false);
});

test('localguard.settingOk: из панели меняются только безопасные настройки', () => {
  for (const k of G.WIDGET_SETTINGS) assert.equal(G.settingOk(k), true, k);
  assert.equal(G.settingOk('nowPlayingPath'), false);
  assert.equal(G.settingOk(''), false);
  assert.equal(G.settingOk(null), false);
  assert.equal(G.settingOk(1), false);
});

// ---------- файлы страницы ----------

test('localguard.fileOk: страница отдаёт только свои файлы разрешённых типов', () => {
  assert.equal(G.fileOk(root, join(root, 'index.html')), true);
  assert.equal(G.fileOk(root, join(root, 'ui', 'app.js')), true);
  assert.equal(G.fileOk(root, join(root, 'app.css')), true);
  assert.equal(G.fileOk(root, join(root, 'font.woff2')), true);
  assert.equal(G.fileOk(root, join(root, 'cover.PNG')), true, 'расширение не зависит от регистра');
  assert.equal(G.fileOk(root, join(root, 'a.txt')), true);
});

test('localguard.fileOk: json, ключи, выход из папки и служебные имена закрыты', () => {
  for (const f of [
    join(root, 'da.json'),
    join(root, 'DA.JSON'),
    join(root, 'da.json::$DATA'),
    join(root, 'index.html::$DATA'),
    join(root, 'a.txt.'),
    join(root, 'a.txt '),
    join(root, 'app.exe'),
    join(root, 'без-расширения'),
    join(root, '..', 'secret.txt'),
    root,
    root + '2/index.html',
    join(root, 'ui', '..', '..', 'secret.html'),
  ]) {
    assert.equal(G.fileOk(root, f), false, f);
  }
});

// ---------- своя страница и разрешения ----------

test('localguard.isOwnPage: свой порт и свои файлы, чужие — нет', () => {
  G.setOwn({ port: PORT, root });
  assert.equal(G.isOwnPage('http://127.0.0.1:' + PORT + '/index.html'), true);
  assert.equal(G.isOwnPage('http://localhost:' + PORT + '/'), true);
  assert.equal(G.isOwnPage('http://127.0.0.1:' + (PORT + 1) + '/'), false);
  assert.equal(G.isOwnPage('https://127.0.0.1:' + PORT + '/'), false);
  assert.equal(G.isOwnPage('http://example.com/'), false);

  const inside = pathToFileURL(join(root, 'ui', 'index.html')).toString();
  const outside = pathToFileURL(join(tmpdir(), 'чужой.html')).toString();
  assert.equal(G.isOwnPage(inside), true);
  assert.equal(G.isOwnPage(outside), false);
  assert.equal(G.isOwnPage('file:///не/существует'), false);
  assert.equal(G.isOwnPage(''), false);
  assert.equal(G.isOwnPage(null), false);
});

test('localguard.permissionOk: чужим — только полный экран и запись в буфер', () => {
  G.setOwn({ port: PORT, root });
  const own = 'http://127.0.0.1:' + PORT + '/index.html';
  const alien = 'https://example.com/';
  for (const p of ['fullscreen', 'clipboard-sanitized-write']) {
    assert.equal(G.permissionOk(alien, p), true, p);
  }
  for (const p of ['media', 'audioCapture', 'display-capture', 'geolocation', 'notifications', '', null]) {
    assert.equal(G.permissionOk(alien, p), false, String(p));
  }
  for (const p of ['fullscreen', 'clipboard-sanitized-write', 'media', 'audioCapture', 'display-capture']) {
    assert.equal(G.permissionOk(own, p), true, p);
  }
  assert.equal(G.permissionOk(own, 'geolocation'), false);
  assert.equal(G.permissionOk('', 'fullscreen'), false, 'адрес неизвестен — отказ');
  assert.equal(G.permissionOk('http://127.0.0.1:' + (PORT + 1) + '/', 'media'), false, 'чужой порт — чужие правила');
});

// ---------- настройки интерфейса ----------

test('localguard.uiSettingOk: белый список интерфейса, путь nowPlayingPath закрыт', () => {
  for (const k of ['searchMode', 'queueMode', 'savedLists', 'theme', 'sbotAccepting', 'chatOrders']) {
    assert.equal(G.uiSettingOk(k), true, k);
  }
  for (const k of ['nowPlayingPath', 'ghToken', 'ymToken', 'нет-такой', '', null, 1]) {
    assert.equal(G.uiSettingOk(k), false, String(k));
  }
  assert.ok(G.UI_SETTINGS instanceof Set);
});

test('localguard.uiSettingHidden: входы, ключи и секреты модулей не отдаются в окно', () => {
  for (const k of ['ymToken', 'ytCookies', 'ytOauth', 'donKeys', 'ghToken', 'modLicenseKey', 'modLicenses']) {
    assert.equal(G.uiSettingHidden(k), true, k);
  }
  assert.equal(G.uiSettingHidden('modSecure.abc'), true);
  assert.equal(G.uiSettingHidden('sbotSecure.key'), true);
  for (const k of ['searchMode', 'modSecure', 'sbotSecure', '', null, undefined]) {
    assert.equal(G.uiSettingHidden(k), false, String(k));
  }
  assert.ok(G.HIDDEN_SETTINGS instanceof Set);
});

// ---------- CSP и запросы к страницам модулей ----------

test('localguard.MOD_PAGE_CSP: без встроенных скриптов, eval и плагинов', () => {
  assert.ok(G.MOD_PAGE_CSP.includes("script-src 'self'"));
  assert.ok(G.MOD_PAGE_CSP.includes("frame-ancestors 'self'"));
  assert.ok(!G.MOD_PAGE_CSP.includes('unsafe-inline'));
  assert.ok(!G.MOD_PAGE_CSP.includes('unsafe-eval'));
  assert.ok(!G.MOD_PAGE_CSP.includes('object-src'));
});

test('localguard.modPageCsp: встраивать можно в оба своих адреса', () => {
  const csp = G.modPageCsp(PORT);
  assert.ok(csp.includes('http://127.0.0.1:' + PORT));
  assert.ok(csp.includes('http://localhost:' + PORT));
  assert.ok(csp.includes("frame-ancestors 'self'"));
});

test('localguard.modRequestOk: переход пускаем, чужие страницы — нет', () => {
  assert.equal(G.modRequestOk({ 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' }, PORT), true);
  assert.equal(G.modRequestOk({ 'sec-fetch-site': 'cross-site' }, PORT), false);
  assert.equal(G.modRequestOk({ 'sec-fetch-site': 'same-site' }, PORT), false);
  assert.equal(G.modRequestOk({ 'sec-fetch-site': 'same-origin' }, PORT), true);
  assert.equal(G.modRequestOk({ 'sec-fetch-site': 'none' }, PORT), true);
  assert.equal(G.modRequestOk({ origin: 'http://127.0.0.1:' + PORT }, PORT), true);
  assert.equal(G.modRequestOk({ origin: 'http://localhost:' + PORT }, PORT), true);
  assert.equal(G.modRequestOk({ origin: 'http://127.0.0.1:' + (PORT + 1) }, PORT), false);
  assert.equal(G.modRequestOk({ origin: 'null' }, PORT), false);
  assert.equal(G.modRequestOk({}, PORT), true);
  assert.equal(G.modRequestOk(null, PORT), true);
});

// ---------- B7b: панель OBS и страницы модулей не встраиваются в чужой сайт ----------

test('localguard.widgetFrameCsp: панель OBS можно встроить только в свои адреса', () => {
  const csp = G.widgetFrameCsp(PORT);
  assert.match(csp, /^frame-ancestors 'self'/);
  assert.ok(csp.includes('http://127.0.0.1:' + PORT));
  assert.ok(csp.includes('http://localhost:' + PORT));
  assert.ok(!csp.includes('*'), 'никаких «любых» сайтов');
});

test('localguard.frameOptionsFor: X-Frame-Options, и превью оверлея не ломается', () => {
  assert.equal(G.frameOptionsFor('127.0.0.1:' + PORT), 'SAMEORIGIN');
  // Превью оверлея — iframe с localhost в окне на 127.0.0.1: разные имена, SAMEORIGIN его заблокирует.
  assert.equal(G.frameOptionsFor('localhost:' + PORT), '');
  assert.equal(G.frameOptionsFor('LOCALHOST:' + PORT), '');
  assert.equal(G.frameOptionsFor(''), 'SAMEORIGIN');
  assert.equal(G.frameOptionsFor(null), 'SAMEORIGIN');
});

// ---------- B7b: cookie метки локальных файлов ----------

// Сопоставление пути cookie, как его делает браузер (RFC 6265, 5.1.4): путь cookie совпадает с путём
// запроса или является его началом, за которым идёт «/» (или сам путь cookie кончается на «/»).
function cookiePathMatches(cookiePath, reqPath) {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}
function cookieReaches(cookies, reqPath) {
  return cookies.some((c) => {
    const m = /;\s*Path=([^;]+)/i.exec(c);
    return cookiePathMatches(m ? m[1] : '/', reqPath);
  });
}

test('localguard.sessionCookie: только пути /lfile и /lcover, HttpOnly и SameSite=Strict', () => {
  const list = G.sessionCookie('abc123');
  assert.ok(Array.isArray(list) && list.length === 2);
  for (const c of list) {
    assert.match(c, /^tapk=abc123;/);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    assert.ok(!/;\s*Port/i.test(c), 'порт в cookie не указать');
    assert.ok(!/Domain=/i.test(c), 'только наш хост');
  }
  // Ошибка 13.11 (живая проверка R11): с Path=/l браузер не отдавал метку на /lfile/… — свои файлы не играли.
  assert.ok(cookieReaches(list, '/lfile/abc'), 'метка уходит на /lfile/…');
  assert.ok(cookieReaches(list, '/lcover/abc'), 'метка уходит на /lcover/…');
  assert.ok(!cookieReaches(list, '/index.html'), 'на страницу окна метка не уходит');
  assert.ok(!cookieReaches(list, '/ui.js'), 'на скрипт окна метка не уходит');
  assert.ok(!cookieReaches(list, '/widget'), 'на панель OBS метка не уходит');
  // В заголовок cookie нельзя подставить «;» и перевод строки.
  assert.deepEqual(G.sessionCookie(''), []);
  assert.deepEqual(G.sessionCookie(null), []);
  assert.deepEqual(G.sessionCookie('abc; evil=1'), []);
  assert.deepEqual(G.sessionCookie('не-ключ'), []);
});

test('cookiePathMatches: старый Path=/l не доходит до /lfile (так и была ошибка)', () => {
  assert.equal(cookieReaches(['tapk=1; Path=/l'], '/lfile/abc'), false);
});

