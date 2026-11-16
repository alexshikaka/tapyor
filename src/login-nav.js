// B7b (P5c №7): правила навигации в окнах входа Яндекс и Google.
// Модальное окно программы не должно показывать чужой https (фишинг), а токен Яндекса
// нельзя принимать из адреса любого хоста. Модуль без Electron — tests/unit/login-nav.test.mjs.
'use strict';

function urlOf(u) {
  try { return new URL(String(u == null ? '' : u)); } catch (e) { return null; }
}
// Переходы внутри окна входа — только https.
function navAllowed(u) {
  const x = urlOf(u);
  return !!x && x.protocol === 'https:';
}
function hostOf(u) {
  const x = urlOf(u);
  if (!x || x.protocol !== 'https:') return '';
  return x.hostname.toLowerCase();
}
// Яндексовые домены: yandex.ru/com/net/by/kz/ua/… и ya.ru, вместе с поддоменами.
const YANDEX_HOST = /(^|\.)yandex\.[a-z]{2,3}(\.[a-z]{2})?$|(^|\.)ya\.ru$/;
// Google и YouTube: accounts.google.com, consent.google.com, www.youtube.com, youtu.be…
const GOOGLE_HOST = /(^|\.)(google\.[a-z]{2,3}(\.[a-z]{2})?|youtube\.com|youtu\.be|youtube-nocookie\.com|googleusercontent\.com|gstatic\.com|ggpht\.com)$/;

function yandexHost(u) { const h = hostOf(u); return !!h && YANDEX_HOST.test(h); }
function googleHost(u) { const h = hostOf(u); return !!h && GOOGLE_HOST.test(h); }
// Новое окно из окна входа: только https и только домены своего провайдера.
function yandexOpenAllowed(u) { return navAllowed(u) && yandexHost(u); }
function googleOpenAllowed(u) { return navAllowed(u) && googleHost(u); }

// access_token из адреса возврата Яндекса. Только https-адрес Яндекса; разбор в try —
// страница с «%» в адресе раньше роняла вход в crash-guard.
function accessToken(u) {
  if (!navAllowed(u) || !yandexHost(u)) return '';
  const m = /access_token=([^&#]+)/.exec(String(u));
  if (!m) return '';
  if (m[1].length > 4096) return '';
  try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
}

module.exports = { navAllowed, yandexHost, googleHost, yandexOpenAllowed, googleOpenAllowed, accessToken };
