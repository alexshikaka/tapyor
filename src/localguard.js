// Защита локального сервера Тапёра (127.0.0.1:<порт>).
// Порт панели OBS постоянный (47654), поэтому любой сайт в браузере может «постучаться» на него.
// Правила:
//  1) Host — только 127.0.0.1/localhost с нашим портом (защита от подмены адреса, DNS rebinding);
//  2) команды панели (/widget/rq, /widget/cmd/*, /widget/setting) — только POST и только со страницы самого Тапёра
//     (заголовок Origin = наш адрес; браузер ставит его сам, сайт подделать не может);
//  3) из панели можно менять только безопасные настройки.
'use strict';

const WIDGET_SETTINGS = new Set(['reqAuto', 'widgetLook', 'widgetScale']);

function ownOrigins(port) { return ['http://127.0.0.1:' + port, 'http://localhost:' + port]; }

function hostOk(headers, port) {
  const h = String((headers && headers.host) || '').toLowerCase();
  return h === '127.0.0.1:' + port || h === 'localhost:' + port;
}

function isWidgetCommand(p) { return p === '/widget/rq' || p === '/widget/setting' || p.startsWith('/widget/cmd/') || p === '/dock2/cmd'; }

// Можно ли выполнить команду панели
//
// P5c №12: пробовали добавить проверку Referer/Sec-Fetch-Dest, чтобы принимать команды только со
// страницы /widget. Надёжно это не работает: страницы пака живут на том же origin (127.0.0.1:порт),
// а fetch() со страницы может сам задать referrer — по правилам браузера это разрешено для
// same-origin URL. Значит «я со страницы /widget» подделывается одной строкой в коде модуля.
// Sec-Fetch-Dest у fetch всегда `empty`, а Origin и Sec-Fetch-Site у страницы пака такие же, как у
// /widget, — отличить их нельзя. Настоящая граница — отдельный origin (свой порт/домен) или
// отдельные права у страницы, чего в текущей схеме нет (для плеера YouTube это делает B11).
// Поэтому оставляем честную проверку Origin: её чужой сайт подделать не может. Вид, что Referer
// разграничивает «своих», не создаём — это была бы ложная защита.
function commandOk(method, headers, port) {
  if (String(method).toUpperCase() !== 'POST') return false;
  const o = String((headers && headers.origin) || '').toLowerCase();
  return ownOrigins(port).includes(o);
}

function settingOk(key) { return typeof key === 'string' && WIDGET_SETTINGS.has(key); }

// ── Отдача файлов страницы (аудит безопасности 01.11, H1 и M4) ──────────────
// Любой .json закрыт целиком: рядом лежат ключи сборки, а страница json с сервера не берёт.
// Выход из папки проверяется с разделителем — иначе подошёл бы каталог-сосед «src-что-то».
// Ревью 01.11 (DeepSeek): чёрный список «не .json» обходился на Windows — `/da.json::$DATA`
// (поток NTFS) не кончается на .json, а читается как da.json. Теперь белый список расширений
// страницы, а двоеточие, хвостовые точки/пробелы и сам .json запрещены.
const path = require('path');
const PAGE_EXT = new Set(['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.webm', '.mp4', '.txt']);
function fileOk(root, file) {
  const r = path.resolve(root), f = path.resolve(file);
  if (f !== r && !f.startsWith(r + path.sep)) return false;
  const rel = f.slice(r.length);
  if (/[:*?"<>|]/.test(rel)) return false;          // потоки NTFS (::$DATA) и прочие служебные имена
  if (/[. ]$/.test(f)) return false;                // «da.json.» — Windows отрезает точку и открывает da.json
  if (/\.json$/i.test(f)) return false;
  return PAGE_EXT.has(path.extname(f).toLowerCase());
}

// ── Разрешения браузера (H2, стабилизация 12.11, B3) ────────────────────────
// Белые списки: всё, чего в них нет (включая новые виды разрешений Chromium и пустое),
// отклоняется. Чужим сайтам во вкладке «Браузер» нужен только «на весь экран»; запись
// в буфер обмена не даёт прочитать данные. Своим страницам — ещё микрофон/звук и захват
// экрана (визуализатор). Неизвестный адрес (проверка без wc) — отказ.
const PERM_ALIEN_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write']);
const PERM_OWN_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'media', 'audioCapture', 'display-capture']);
// «Своя» страница — только адрес своего сервера (его порт) и файлы из папки программы.
// Раньше подходил любой порт 127.0.0.1 и любой file:// — ревью 01.11: чужой локальный сервис
// во вкладке «Браузер» получал бы микрофон, а главное окно, уведённое туда, — мост window.app.
const own = { port: 0, root: '' };
function setOwn(o) { if (o && o.port) own.port = Number(o.port) || 0; if (o && o.root) own.root = path.resolve(o.root); }
function isOwnPage(url) {
  const u = String(url || '');
  if (own.port && (u.startsWith('http://127.0.0.1:' + own.port + '/') || u.startsWith('http://localhost:' + own.port + '/'))) return true;
  if (own.root && /^file:\/\//i.test(u)) {
    let f = '';
    try { f = require('url').fileURLToPath(u.split(/[?#]/)[0]); } catch (e) { return false; }
    const a = path.resolve(f), b = own.root;
    const same = process.platform === 'win32' ? (x, y) => x.toLowerCase() === y.toLowerCase() : (x, y) => x === y;
    return same(a, b) || same(a.slice(0, b.length + 1), b + path.sep);
  }
  return false;
}
function permissionOk(url, permission) {
  const u = String(url || '');
  if (!u) return false;                       // адрес неизвестен (проверка без wc) — отказ
  if (isOwnPage(u)) return PERM_OWN_ALLOW.has(permission);
  return PERM_ALIEN_ALLOW.has(permission);
}

// ── Какие настройки интерфейс может записать (функц. аудит 01.11, F3) ────────
// Раньше set-setting принимал любой ключ. Среди настроек есть nowPlayingPath — путь файла,
// в который основной процесс потом пишет текст. То есть страница выбирала бы, куда писать на
// диске. Пока окно своё, это не дыра, но к плагинам 1.0 стало бы произвольной записью файлов.
// Список собран по всем вызовам setSetting в src/ui (строковые ключи + переключатели data-set-tg).
// Новая настройка из интерфейса = новая строка здесь, иначе она молча не сохранится
// (отказ пишется в лог: «настройка … из интерфейса отклонена»).
const UI_SETTINGS = new Set([
  'auEnabled',
  'autoStart',
  'autoUpdate',
  'bgWave',
  'chatOrders', // Streamer.bot: кто принимает заказы из чата (0.35, Э1)
  'closeToTray',
  'crossfade',
  'donLinks',
  'dock2Ban', // вторая док-панель OBS: кнопка ⛔ у заказов Твича (DOCK2)
  'hotkeys',
  'impOnly', // импорт: где искать песни — авто / только Яндекс / только YouTube (Ф1)
  'libInSearch',
  'listenMarks',
  'liveHelpSeen', // справка «Живая очередь» показана (WZ3, 14.11.2026)
  'speechSaved',
  'lookTab',
  'mediaKeys',
  'normalize',
  'nowPlayingFormat',
  'npEnabled',
  'npIdle',
  'perfWatch',
  'plCovers',
  'preferLocal',
  'prefetch',
  'queueMode',
  'queueWidth',
  'reportsEnabled',
  'reqAuto',
  'reqTiers', // ярусы заказов: default | money | equal (docs/BOT.md)
  'reqCurrency',
  'reqPrice',
  'reqRules',
  'savedLists',
  'sbotAccepting', // Streamer.bot: приём заказов открыт/закрыт (0.35, Э1)
  'scEnabled',
  'searchMode',
  'settingsLayout',
  'site',
  'skin',
  'skinAdj',
  'skinFont',
  'skinSchemes',
  'srcOrder',
  'startVolume',
  'streamerMode',
  'theme',
  'themeBar',
  'themes',
  'today',
  'uiZoom',
  'videoHeight',
  'videoQuality',
  'vizColor',
  'voBorder', // «Видео для OBS»: обводка, цвет, толщина, скрывать музыкальные треки (VO1)
  'voColor',
  'voHideAudio',
  'voWidth',
  'wave',
  'widgetLook',
  'widgetNewOnTop',
  'widgetPort',
  'widgetScale',
  'wizardDone', // знакомство первого запуска пройдено (14.11.2026): визард сам больше не открывается
  'wizardOrdersTested', // шаг «Заказы в деле»: тестовые заказы прошли оба пути (WZ5, финал)
  'ymEnabled',
  'ymWebFallback',
  'ytEnabled',
  'ytUseCookies'
]);
function uiSettingOk(key) { return typeof key === 'string' && UI_SETTINGS.has(key); }

// ── Какие настройки get-setting НЕ отдаёт в окно (B5-3, стабилизация 12.11) ──
// Входы, ключи и лицензии пака живут в том же settings.json, но окну они не нужны:
// раньше список был прямо в main.js, и modLicenses в нём не было — токены лицензий уходили
// в окно. Интерфейс modLicenses не читает (поиск по src/ui), поэтому ключ скрыт.
const HIDDEN_SETTINGS = new Set(['ymToken', 'ytCookies', 'ytOauth', 'donKeys', 'ghToken', 'modLicenseKey', 'modLicenses']);
function uiSettingHidden(key) {
  const k = String(key == null ? '' : key);
  return HIDDEN_SETTINGS.has(k) || k.startsWith('modSecure.') || k.startsWith('sbotSecure.');
}

// Что можно странице модуля (оверлей): свои скрипты, стили и шрифты, обложки с https, поток событий со своего адреса.
// Встроенных скриптов, eval, плагинов, отправки форм и чужих адресов — нет. Встраивать можно только в окно Тапёра.
const MOD_PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data: blob: https:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
// M5: превью в окне Тапёра грузится с http://localhost:<порт> (другой origin, чем окно на 127.0.0.1) — тогда у страницы
// модуля нет доступа к parent.app. Встраивать её разрешено только в окно Тапёра — оба своих адреса.
function modPageCsp(port) { return MOD_PAGE_CSP.replace("frame-ancestors 'self'", "frame-ancestors 'self' " + ownOrigins(port).join(' ')); }

// Страница плеера YouTube (P5c №1): её можно встраивать только в окно Тапёра — свои адреса.
// В <meta> директива frame-ancestors браузером игнорируется, поэтому заголовок ставит сервер.
function ytPlayerCsp(port) { return "frame-ancestors 'self' " + ownOrigins(port).join(' '); }

// VO1: страница «Видео для OBS» (/video). Свой скрипт и стиль файлами (встроенных нет), звук и
// картинка YouTube идут с https, встроенный плеер — только youtube-nocookie, лишнего не разрешаем.
const VIDEO_PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; " +
  "img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self'; " +
  "frame-src https://www.youtube-nocookie.com; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
function videoPageCsp(port) {
  return VIDEO_PAGE_CSP.replace("frame-ancestors 'self'", "frame-ancestors 'self' " + ownOrigins(port).join(' '));
}

// M6 (аудит 0.32.0): запросы к страницам модулей (поток /overlay/events, обложки, скрипты) — только со своих страниц.
// Чужой сайт в браузере делает EventSource на 127.0.0.1 → браузер сам ставит Origin сайта и Sec-Fetch-Site: cross-site,
// подделать их страница не может. OBS (страница со своего адреса) таких заголовков не шлёт или шлёт same-origin.
// Переход на саму страницу (navigate) пускаем: её показ ничего не занимает, а встраивание режет frame-ancestors.
function modRequestOk(headers, port) {
  const h = headers || {};
  const mode = String(h['sec-fetch-mode'] || '').toLowerCase();
  if (mode === 'navigate') return true;
  const site = String(h['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site' || site === 'same-site') return false;
  const o = h.origin;
  if (o !== undefined && !ownOrigins(port).includes(String(o).toLowerCase())) return false; // в т.ч. Origin: null
  return true;
}

// B7b (P5c №5): панель OBS и страницы модулей не должны открываться во фрейме чужого сайта.
// OBS берёт панель отдельной страницей (не во фрейме). Превью оверлея в окне Тапёра — iframe
// с нашего же сервера, поэтому своим адресам встраивание разрешено.
function widgetFrameCsp(port) {
  return "frame-ancestors 'self' " + ownOrigins(port).join(' ');
}
// X-Frame-Options для страниц модулей. Превью оверлея грузится с localhost, а окно живёт на
// 127.0.0.1 — для SAMEORIGIN это разные origin, и заголовок сломал бы превью. В этом одном
// случае его не ставим: от чужого сайта страницу защищает frame-ancestors (modPageCsp).
function frameOptionsFor(host) {
  const h = String(host || '').toLowerCase();
  if (/^localhost:\d+$/.test(h)) return '';
  return 'SAMEORIGIN';
}

// B7b (P5c №8): метка доступа к своим файлам. Скрипт окна её не читает (поиск по src/ui:
// document.cookie не используется), поэтому HttpOnly можно. Две cookie — Path=/lfile и
// Path=/lcover: метка уходит только туда, а не на всю страницу. (13.11: один Path=/l не
// работал — по правилам браузера /l совпадает с /l/…, но не с /lfile/…, и свои файлы не играли.)
// Порт в cookie указать нельзя: cookie привязана к хосту, поэтому другой локальный сервис на
// 127.0.0.1:<другой порт> её тоже получит — остаточный риск записан в отчёте.
// Возвращает список заголовков Set-Cookie (пустой — если ключ негодный).
function sessionCookie(key) {
  const k = String(key == null ? '' : key);
  if (!/^[0-9a-f]+$/i.test(k)) return [];
  return ['/lfile', '/lcover'].map((p) => 'tapk=' + k + '; Path=' + p + '; HttpOnly; SameSite=Strict');
}

module.exports = { MOD_PAGE_CSP, modPageCsp, modRequestOk, widgetFrameCsp, frameOptionsFor, sessionCookie, ownOrigins, hostOk, isWidgetCommand, commandOk, settingOk, WIDGET_SETTINGS, fileOk, setOwn, isOwnPage, permissionOk, uiSettingOk, UI_SETTINGS, uiSettingHidden, HIDDEN_SETTINGS, ytPlayerCsp, videoPageCsp, VIDEO_PAGE_CSP };
