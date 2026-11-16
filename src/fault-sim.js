'use strict';
// Имитация сбоев сети (0.34.0, шаг 3).
//
// Состояние живёт ТОЛЬКО В ПАМЯТИ: после перезапуска Тапёр снова обычный. Ничего не пишется
// на диск и не отправляется в сеть. Модуль не требует electron на верхнем уровне — покрыт
// unit-тестами (tests/unit/fault-sim.test.mjs).
//
// Режимы:
//   down    — сервис отвечает ошибкой 503 (для yt-dlp — ошибка процесса);
//   offline — как будто нет сети (TypeError('fetch failed') с cause.code = 'ENOTFOUND');
//   slow    — подождать 8 секунд, затем выполнить запрос как обычно;
//   auth    — ответ 401 (вход отозван).
//
// «Вся сеть» (all) — отдельная запись: если у сервиса выбран свой режим, он важнее общей.
// Плашка и меню показывают active(); журнал — не чаще одного раза в 10 секунд на сервис.

const SERVICES = ['yt', 'ym', 'da', 'dp', 'twitch', 'lastfm', 'cloud'];
const ALL = 'all';
const MODES = ['down', 'offline', 'slow', 'auth'];
const SLOW_MS = 8000;
const HIT_LOG_MS = 10000;

const NAMES = {
  yt: 'YouTube',
  ym: 'Яндекс Музыка',
  da: 'DonationAlerts',
  dp: 'DonatePay',
  twitch: 'Twitch',
  lastfm: 'Last.fm',
  cloud: 'Облако Тапёра',
  all: 'Вся сеть'
};

const MODE_TEXT = {
  down: 'недоступен',
  offline: 'нет сети',
  slow: 'медленно',
  auth: 'вход отозван'
};

// Домены взяты из кода каждого сервиса (yandex.js, donations.js, bot/src/twitch/config.js,
// lastfm.js, main.js/license-client.js). Сравнение — по целому хосту или поддомену,
// поэтому «youtube.com.evil.example» и «notyoutube.com» не считаются YouTube.
const DOMAINS = {
  yt: ['youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com', 'youtube-nocookie.com', 'googleapis.com', 'ggpht.com', 'suggestqueries.google.com'],
  ym: ['yandex.ru', 'yandex.net', 'yandex.com', 'yandex.by', 'yandex.kz', 'ya.ru', 'yastatic.net'],
  da: ['donationalerts.com', 'donationalerts.ru'],
  dp: ['donatepay.ru', 'donatepay.com'],
  twitch: ['twitch.tv', 'ttvnw.net', 'jtvnw.net'],
  lastfm: ['last.fm', 'audioscrobbler.com'],
  cloud: ['yandexcloud.net']
};

function hostOf(url) {
  const s = typeof url === 'string' ? url : (url && (url.url || url.href)) ? String(url.url || url.href) : '';
  try { return new URL(s).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

// По адресу — сервис или null. Чистая функция: состояние имитации не читает.
function serviceOf(url) {
  const host = hostOf(url);
  if (!host) return null;
  for (const s of SERVICES) {
    const list = DOMAINS[s] || [];
    for (const d of list) if (hostMatches(host, d)) return s;
  }
  return null;
}

function isService(s) { return s === ALL || SERVICES.indexOf(String(s)) >= 0; }
function isMode(m) { return MODES.indexOf(String(m)) >= 0; }

function netError(url) {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname: hostOf(url) || 'unknown' };
  err.simulated = true;
  return err;
}

function serviceError(service, mode) {
  const name = NAMES[service] || String(service || 'сервис');
  const err = new Error(name + (mode === 'auth' ? ': вход отозван (имитация)' : ': сервис недоступен (имитация)'));
  if (mode === 'auth') err.status = 401;
  err.simulated = true;
  return err;
}

function responseFor(mode) {
  return new Response('', {
    status: mode === 'down' ? 503 : 401,
    statusText: mode === 'down' ? 'Service Unavailable' : 'Unauthorized'
  });
}

function urlOfInput(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  if (input && typeof input.href === 'string') return input.href;
  return '';
}

function create(opts) {
  const o = opts || {};
  let log = typeof o.log === 'function' ? o.log : function () {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const sleep = typeof o.sleep === 'function' ? o.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const slowMs = Number(o.slowMs) > 0 ? Number(o.slowMs) : SLOW_MS;
  const hitLogMs = Number(o.hitLogMs) >= 0 ? Number(o.hitLogMs) : HIT_LOG_MS;
  const state = Object.create(null);
  const lastHit = Object.create(null);

  function setLog(fn) { if (typeof fn === 'function') log = fn; }

  function set(service, mode) {
    const s = String(service == null ? '' : service);
    if (!isService(s)) return false;
    if (mode == null || mode === '') { delete state[s]; return true; }
    const m = String(mode);
    if (!isMode(m)) return false;
    state[s] = m;
    return true;
  }

  function clear(service) {
    if (service == null) { for (const k of Object.keys(state)) delete state[k]; return true; }
    const s = String(service);
    if (!isService(s)) return false;
    delete state[s];
    return true;
  }

  function isEmpty() { return Object.keys(state).length === 0; }

  // Режим конкретного сервиса; если у него своего нет — общий режим «вся сеть».
  function modeFor(service) {
    const s = String(service || '');
    if (s === ALL) return state[ALL] || null;
    return state[s] || state[ALL] || null;
  }

  function modeForUrl(url) {
    const s = serviceOf(url);
    return s ? modeFor(s) : (state[ALL] || null);
  }

  // Список для плашки и меню: «вся сеть» первой, затем сервисы в постоянном порядке.
  function active() {
    const out = [];
    for (const s of [ALL].concat(SERVICES)) if (state[s]) out.push({ service: s, mode: state[s] });
    return out;
  }

  function stateCopy() {
    const out = {};
    for (const k of Object.keys(state)) out[k] = state[k];
    return out;
  }

  function note(service, mode, url) {
    const key = String(service || ALL);
    const t = now();
    if (lastHit[key] != null && t - lastHit[key] < hitLogMs) return;
    lastHit[key] = t;
    const name = NAMES[key] || key;
    const host = hostOf(url);
    try {
      log('имитация: ' + name + ' — ' + (MODE_TEXT[mode] || mode) + ', запрос к ' + (host || 'сервису'));
    } catch (e) { /* журнал не должен ронять запрос */ }
  }

  // Для запросов через fetch: вернуть Response 503/401, бросить сетевую ошибку,
  // подождать 8 секунд или выполнить запрос как обычно.
  function applyFetch(url, call) {
    const mode = modeForUrl(url);
    if (!mode) return call();
    const service = serviceOf(url) || ALL;
    note(service, mode, url);
    if (mode === 'slow') return sleep(slowMs).then(() => call());
    if (mode === 'offline') return Promise.reject(netError(url));
    return Promise.resolve(responseFor(mode));
  }

  // Для запросов не через fetch (yt-dlp, yt-search, media-proxy, сайт Яндекса).
  // timeoutMs — тайм-аут вызывающего: если он меньше задержки, срабатывает он.
  function applyCall(service, call, options) {
    const mode = modeFor(service);
    if (!mode) return Promise.resolve().then(call);
    const target = String(service || ALL);
    note(target, mode, (options && options.url) || '');
    if (mode === 'slow') {
      const timeoutMs = Number(options && options.timeoutMs) || 0;
      if (timeoutMs > 0 && timeoutMs < slowMs) {
        return sleep(timeoutMs).then(() => { throw new Error((NAMES[target] || target) + ': timeout (имитация)'); });
      }
      return sleep(slowMs).then(call);
    }
    if (mode === 'offline') return Promise.reject(netError((options && options.url) || ''));
    return Promise.reject(serviceError(target, mode));
  }

  // Обёртка fetch. Без включённой имитации — тот же вызов с теми же аргументами,
  // без лишних Promise и задержек (нулевые накладные расходы).
  function wrapFetch(realFetch) {
    if (typeof realFetch !== 'function') return realFetch;
    return function () {
      if (isEmpty()) return realFetch.apply(this, arguments);
      const url = urlOfInput(arguments[0]);
      const mode = modeForUrl(url);
      if (!mode) return realFetch.apply(this, arguments);
      const self = this, args = arguments;
      return applyFetch(url, () => realFetch.apply(self, args));
    };
  }

  return {
    setLog, set, clear, active, state: stateCopy, isEmpty,
    modeFor, modeForUrl, serviceOf,
    applyFetch, applyCall, wrapFetch,
    slowMs
  };
}

module.exports = {
  SERVICES, MODES, ALL, NAMES, MODE_TEXT, DOMAINS, SLOW_MS, HIT_LOG_MS,
  serviceOf, isService, isMode, create
};
