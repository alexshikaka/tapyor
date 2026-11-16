'use strict';
// Куда вообще можно открыть браузер из окна Тапёра.
//
// Список ТОЧНЫЙ, а не «любой https»: домены музыки (как было до 0.33.1) плюс наши страницы —
// репозиторий, задачи, политика данных — и Telegram владельца. Всё остальное не открывается.
//
// Зачем отдельным модулем (0.33.1): в 0.33.0 правила жили прямо в main.js, и в них не было
// github.com, ни t.me — кнопки «О программе» молча ничего не делали. Отдельный модуль покрыт
// unit-тестами (tests/unit/open-external.test.mjs), поэтому такую ошибку теперь поймает `npm test`,
// а не владелец.
const RULES = [
  // Музыка и её страницы — как было
  /^https:\/\/([a-z0-9-]+\.)*(yandex\.(ru|com|by|kz|cloud)|ya\.ru|youtube\.com|youtu\.be|soundcloud\.com|bandcamp\.com|audius\.co)\//i,
  // Наши страницы: исходники, задачи (issues/new/choose), политика данных (blob/main/PRIVACY.md)
  /^https:\/\/github\.com\/alexshikaka\/tapyor(\/|$|\?)/i,
  // Telegram: канал и привязанный к нему чат. Хвосты вроде «tapyorchat2» и чужие каналы не проходят.
  /^https:\/\/t\.me\/tapyor(\/|\?|$)/i,
  /^https:\/\/t\.me\/tapyorchat(\/|\?|$)/i,
  // Поддержка автора (G4): DonationAlerts и ЮMoney — кнопки в «О программе».
  // Похожие домены вроде donationalerts.com.evil.example не проходят: после домена нужен «/».
  /^https:\/\/([a-z0-9-]+\.)*(donationalerts\.com|yoomoney\.ru)(\/|$|\?)/i,
  // Покупка ключа пака стримера (15.11.2026): только страницы товаров GGSel, без поддоменов.
  /^https:\/\/ggsel\.net\/catalog\/product\/\d+(\/|\?|$)/i
];

// Можно ли открыть этот адрес в браузере. Только https и только из списка.
function allowed(url) {
  const u = String(url == null ? '' : url);
  if (!u) return false;
  return RULES.some((re) => re.test(u));
}

// ── Второй белый список: кнопки стримерской части (open-link, B5-1) ──────────
// Был регулярным выражением прямо в обработчике main.js и проверял «в адресе есть имя хоста»
// (подошёл бы https://evil.com/?x=github.com). Теперь правила такие же строгие, как у allowed:
// только https, хост — точное совпадение или поддомен из списка, без user:pass@, длина ≤ 2000.
const LINK_HOSTS = [
  'donationalerts.com',
  'donatepay.ru',
  'donatepay.eu',
  'boosty.to',
  'github.com',
  'github.io',
  't.me',
  'twitch.tv',
  'youtube.com',
  'youtu.be',
  'vk.com',
  'vkvideo.ru',
  'kick.com',
  'music.yandex.ru',
  'soundcloud.com',
  'developers.sber.ru'
];

// Разбор адреса: https, без входа в самом адрессе, длина ≤ 2000. Возвращает URL или null.
function parseStrict(url) {
  const u = String(url == null ? '' : url);
  if (!u || u.length > 2000) return null;
  let x;
  try { x = new URL(u); } catch (e) { return null; }
  if (x.protocol !== 'https:') return null;
  if (x.username || x.password) return null;
  return x;
}

// Хост — ровно из списка или его поддомен (не «содержит» имя).
function hostStrictOk(url, hosts) {
  const x = parseStrict(url);
  if (!x) return false;
  const host = x.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith('.' + h));
}

// Можно ли открыть этот адрес кнопкой из стримерской части.
function allowedLink(url) {
  return hostStrictOk(url, LINK_HOSTS);
}

// ── Адреса, которые присылает сервер (B5-2) ─────────────────────────────────
// Вход в Яндекс (код устройства) и вход в GitHub присылают адрес страницы подтверждения.
// Открываем только свой домен, иначе — известный запасной (вызывающий код пишет строку в журнал).
const YANDEX_DEVICE_HOSTS = ['ya.ru', 'yandex.ru', 'yandex.com'];
const YANDEX_DEVICE_FALLBACK = 'https://ya.ru/device';
const GITHUB_DEVICE_FALLBACK = 'https://github.com/login/device';

function yandexDeviceUrl(url) {
  const u = String(url == null ? '' : url);
  return hostStrictOk(u, YANDEX_DEVICE_HOSTS) ? u : YANDEX_DEVICE_FALLBACK;
}

function githubDeviceUrl(url) {
  const u = String(url == null ? '' : url);
  // Только сам github.com: gist.github.com и прочие поддомены адрес подтверждения не выдают.
  const x = parseStrict(u);
  return x && x.hostname.toLowerCase() === 'github.com' ? u : GITHUB_DEVICE_FALLBACK;
}

module.exports = {
  allowed, RULES,
  allowedLink, LINK_HOSTS,
  yandexDeviceUrl, githubDeviceUrl,
  YANDEX_DEVICE_FALLBACK, GITHUB_DEVICE_FALLBACK
};
