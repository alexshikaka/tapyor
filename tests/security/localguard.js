// Проверка защиты локального сервера: чужой сайт не может управлять Тапёром и менять настройки.
const g = require('../../src/localguard');
const assert = require('assert');
const P = 47654;
// адрес
assert.ok(g.hostOk({ host: '127.0.0.1:47654' }, P));
assert.ok(g.hostOk({ host: 'localhost:47654' }, P));
assert.ok(!g.hostOk({ host: 'evil.example:47654' }, P), 'чужое имя (DNS rebinding)');
assert.ok(!g.hostOk({}, P), 'без Host');
// команды панели
assert.ok(g.isWidgetCommand('/widget/rq') && g.isWidgetCommand('/widget/setting') && g.isWidgetCommand('/widget/cmd/next'));
assert.ok(!g.isWidgetCommand('/widget/events') && !g.isWidgetCommand('/widget'));
assert.ok(g.commandOk('POST', { origin: 'http://127.0.0.1:47654' }, P), 'со страницы панели');
assert.ok(!g.commandOk('POST', { origin: 'https://evil.example' }, P), 'с чужого сайта');
assert.ok(!g.commandOk('POST', {}, P), 'без Origin (форма/картинка с чужого сайта)');
assert.ok(!g.commandOk('GET', { origin: 'http://127.0.0.1:47654' }, P), 'GET не меняет состояние');
// P5c №12: заголовки Referer/Sec-Fetch-Dest не различают страницу панели и страницу пака — обе на
// одном origin, и fetch со страницы может сам поставить referrer. Поэтому проверка осталась по
// Origin (её чужой сайт подделать не может), а Referer её не заменяет.
assert.ok(!g.commandOk('POST', { origin: 'https://evil.example', referer: 'http://127.0.0.1:47654/widget', 'sec-fetch-dest': 'empty' }, P), 'Referer не заменяет Origin');
assert.ok(!g.commandOk('POST', { origin: 'null', referer: 'http://127.0.0.1:47654/widget' }, P), 'Origin: null не пускаем');
assert.ok(g.commandOk('POST', { origin: 'http://127.0.0.1:47654', referer: 'http://127.0.0.1:47654/overlay' }, P), 'страница пака на своём origin сейчас не отличима — проверка по Origin');
// настройки
assert.ok(g.settingOk('reqAuto'));
for (const k of ['nowPlayingPath', 'nowPlayingFormat', 'widgetPort', 'ytCookies', 'theme', '__proto__', 7]) assert.ok(!g.settingOk(k), k);

// ── Отдача файлов (аудит 01.11, H1/M4) ──────────────────────────────────────
const path = require('path');
const R = path.resolve('/app/src');
assert.ok(g.fileOk(R, path.join(R, 'index.html')), 'страница');
assert.ok(g.fileOk(R, path.join(R, 'ui.js')), 'скрипт');
assert.ok(g.fileOk(R, path.join(R, 'skins', 'skins.css')), 'подпапка модуля оболочек');
for (const f of ['da.json', 'yoomoney.json', 'google-oauth.json', 'lastfm.json', 'github-oauth.json', 'recipes.json', 'НОВЫЙ.JSON'])
  assert.ok(!g.fileOk(R, path.join(R, f)), 'любой .json закрыт: ' + f);
// ревью 01.11: обходы чёрного списка на Windows
for (const f of ['da.json::$DATA', 'da.json:x', 'da.json.', 'da.json ', 'da.JSON..', 'secret.txt::$DATA'])
  assert.ok(!g.fileOk(R, R + path.sep + f), 'обход через имя: ' + f);
for (const f of ['main.js.bak', 'settings.dat', 'noext', 'key.pem'])
  assert.ok(!g.fileOk(R, path.join(R, f)), 'не файл страницы: ' + f);
assert.ok(g.fileOk(R, path.join(R, 'fonts', 'onest.woff2')) && g.fileOk(R, path.join(R, 'assets', 'logo.svg')), 'шрифты и картинки страницы');
assert.ok(!g.fileOk(R, path.join(R, '..', 'package.json')), 'выход из папки');
assert.ok(!g.fileOk(R, path.resolve('/app/src-old/index.html')), 'каталог-сосед с тем же началом имени');

// ── Разрешения (H2) ─────────────────────────────────────────────────────────
g.setOwn({ port: 47654, root: path.resolve('/app/src') });
const OWN = 'http://127.0.0.1:47654/index.html', ALIEN = 'https://evil.example/';
// ревью 01.11: своя — только страница своего порта и файлы из папки программы
for (const u of ['http://127.0.0.1:9999/', 'http://localhost:3000/x', 'http://127.0.0.1:476540/'])
  assert.ok(!g.isOwnPage(u) && !g.permissionOk(u, 'media'), 'чужой локальный сервис — не своя страница: ' + u);
assert.ok(g.isOwnPage('http://localhost:47654/zoom.html'), 'свой порт по имени localhost');
assert.ok(!g.isOwnPage('file:///C:/temp/evil.html') && !g.isOwnPage('file:///tmp/evil.html'), 'чужой file:// — не своя страница'); // export-scan:allow — выдуманный путь в образце
assert.ok(!g.isOwnPage(require('url').pathToFileURL(path.resolve('/app/src-old/index.html')).href), 'папка-сосед — не своя');
assert.ok(g.isOwnPage(require('url').pathToFileURL(path.join(path.resolve('/app/src'), 'zoom.html')).href), 'свой file:// из папки программы');
assert.ok(g.permissionOk(OWN, 'display-capture'), 'визуализатор снимает звук своего окна');
assert.ok(g.permissionOk(OWN, 'media'), 'своей странице — захват звука');
assert.ok(g.permissionOk(require('url').pathToFileURL(path.join(path.resolve('/app/src'), 'zoom.html')).href, 'media'), 'file:// из папки программы — своя страница');
for (const p of ['media', 'audioCapture', 'videoCapture', 'display-capture', 'geolocation', 'notifications', 'usb', 'hid', 'serial', 'bluetooth', 'clipboard-read'])
  assert.ok(!g.permissionOk(ALIEN, p), 'чужому сайту нельзя: ' + p);
assert.ok(!g.permissionOk(OWN, 'geolocation'), 'своей странице геолокация не нужна');
assert.ok(!g.permissionOk('', 'media'), 'неизвестный адрес — чужой');
assert.ok(!g.permissionOk('http://127.0.0.1.evil.example/', 'media'), 'похожее имя — чужое');
assert.ok(g.permissionOk(ALIEN, 'fullscreen'), 'безопасное разрешение не трогаем');

// B3 (стабилизация 12.11): белые списки. Новое разрешение Chromium само не одобряется.
assert.ok(!g.permissionOk('https://evil.example/', 'something-new'), 'неизвестное разрешение чужому — отказ');
assert.ok(!g.permissionOk(OWN, 'something-new'), 'неизвестное разрешение своей — отказ');
assert.ok(!g.permissionOk(OWN, ''), 'пустое разрешение — отказ');
assert.ok(g.permissionOk(ALIEN, 'fullscreen'), 'чужому — «на весь экран»');
assert.ok(!g.permissionOk(ALIEN, 'media'), 'чужому — не микрофон');
assert.ok(g.permissionOk(OWN, 'media'), 'своей странице — микрофон');
assert.ok(g.permissionOk(OWN, 'audioCapture') && g.permissionOk(OWN, 'display-capture'), 'своей — захват звука и экрана');
for (const p of ['geolocation', 'notifications', 'clipboard-read'])
  assert.ok(!g.permissionOk(OWN, p) && !g.permissionOk(ALIEN, p), 'запрещено всем: ' + p);
assert.ok(g.permissionOk(ALIEN, 'clipboard-sanitized-write'), 'чужому — запись в буфер без чтения');
assert.ok(!g.permissionOk(OWN, 'videoCapture'), 'своей странице камера не нужна');
assert.ok(!g.permissionOk('', 'fullscreen') && !g.permissionOk(null, 'fullscreen'), 'проверка без адреса (wc = null) — отказ');

// ── Белый список настроек интерфейса (функц. аудит 01.11, F3) ───────────────
const fs = require('fs');
assert.ok(g.uiSettingOk('theme') && g.uiSettingOk('today') && g.uiSettingOk('ytEnabled'), 'обычные настройки');
for (const k of ['nowPlayingPath', 'ymToken', 'ytCookies', 'donSeen', '__proto__', 'constructor', '', 7, null])
  assert.ok(!g.uiSettingOk(k), 'интерфейсу нельзя: ' + String(k));
// Сверка с кодом: каждый ключ, который интерфейс реально пишет, обязан быть в списке —
// иначе настройка молча перестанет сохраняться.
const uiDir = path.join(__dirname, '..', '..', 'src', 'ui');
const used = new Set();
for (const f of fs.readdirSync(uiDir)) {
  const src = fs.readFileSync(path.join(uiDir, f), 'utf8');
  for (const m of src.matchAll(/setSetting\('([a-zA-Z]+)'/g)) used.add(m[1]);
}
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'index.html'), 'utf8');
for (const m of html.matchAll(/data-set-tg="([a-zA-Z]+)"/g)) used.add(m[1]);
const missing = [...used].filter((k) => !g.uiSettingOk(k));
assert.deepEqual(missing, [], 'интерфейс пишет настройки, которых нет в UI_SETTINGS: ' + missing.join(', '));

// ── CSP страниц модулей (L9, аудит 0.32.0) ──────────────────────────────────
// Заголовок страницам пака ставит ядро (src/main/local-server.js), а не модуль. Проверяем сам текст:
// без встроенных скриптов и eval, всё запрещено по умолчанию, встраивать можно только своим страницам.
const modCsp = g.modPageCsp(47654);
for (const c of [g.MOD_PAGE_CSP, modCsp]) {
  assert.ok(!/unsafe-inline|unsafe-eval/.test(c), 'CSP страниц модулей без unsafe-*: ' + c);
  assert.ok(/(?:^|;)\s*default-src 'none'(?:;|$)/.test(c), "всё запрещено по умолчанию: " + c);
  assert.ok(/(?:^|;)\s*script-src 'self'(?:;|$)/.test(c), 'скрипты — только свои файлы: ' + c);
  assert.ok(/(?:^|;)\s*connect-src 'self'(?:;|$)/.test(c), 'сеть — только свой адрес: ' + c);
}
const frameAncestors = (csp) => {
  const m = /frame-ancestors([^;]*)/.exec(csp);
  return m ? m[1].trim().split(/\s+/) : null;
};
// «только свои адреса»: 'self' и оба имени нашего порта — больше ничего
assert.deepEqual(frameAncestors(modCsp), ["'self'", 'http://127.0.0.1:47654', 'http://localhost:47654'], 'frame-ancestors — только свои адреса');
assert.deepEqual(frameAncestors(g.modPageCsp(12345)), ["'self'", 'http://127.0.0.1:12345', 'http://localhost:12345'], 'порт подставляется');
assert.ok(!/evil|example\.com/.test(modCsp), 'чужих адресов в CSP нет');

// ── Скрытые от интерфейса настройки (B5-3, стабилизация 12.11) ──────────────
// get-setting не должен отдавать в окно входы, ключи и лицензии пака. Раньше список жил
// прямо в main.js и modLicenses в нём не было — токены лицензий уходили в окно.
for (const k of ['ymToken', 'ytCookies', 'ytOauth', 'donKeys', 'ghToken', 'modLicenseKey', 'modLicenses', 'modSecure.pack', 'sbotSecure.sbot'])
  assert.ok(g.uiSettingHidden(k), 'скрыта от окна: ' + k);
for (const k of ['theme', 'today', 'savedLists', 'modLicenseKeyX', 'modLicensesX', 'xmodSecure.a', '', null, undefined, 7])
  assert.ok(!g.uiSettingHidden(k), 'обычная настройка: ' + String(k));
// Интерфейс modLicenses не читает (поиск по src/ui) — значит, скрывать безопасно.
assert.ok(!fs.readdirSync(uiDir).some((f) => fs.readFileSync(path.join(uiDir, f), 'utf8').includes('modLicenses')), 'интерфейс не читает modLicenses');
// Обработчик get-setting обязан пользоваться общей проверкой, а не своим списком.
assert.ok(/localGuard\.uiSettingHidden\(/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8')), 'get-setting через localguard');
console.log('localguard: ok');
