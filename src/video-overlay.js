// VO1: страница /video — картинка YouTube для источника «Браузер» в OBS.
/* global document, EventSource, window, location */
// Звук не нужен: <video muted>, громкость страница не трогает. Состояние приходит по SSE
// из главного процесса (окно Тапёра собирает его и шлёт канал video-state).
// Чистые функции (перемотка, адрес встроенного плеера) работают и в Node:
// tests/unit/video-overlay.test.mjs.
(function () {
  'use strict';

  // Куда перемотать: t из снимка + сколько прошло с момента at (только пока играет).
  function seekTarget(st, now) {
    if (!st) return 0;
    var t = Number(st.t);
    if (!isFinite(t) || t < 0) t = 0;
    var n = Number(now);
    if (!isFinite(n)) n = Date.now();
    var at = Number(st.at);
    var add = 0;
    if (st.playing && isFinite(at)) add = Math.max(0, (n - at) / 1000);
    return Math.max(0, t + add);
  }

  // Пора ли перематывать: расхождение больше порога (по умолчанию 0,6 с).
  function needsSeek(st, now, current, threshold) {
    var cur = Number(current);
    if (!isFinite(cur)) cur = 0;
    var lim = threshold == null ? 0.6 : Number(threshold);
    return Math.abs(seekTarget(st, now) - cur) > lim;
  }

  // Адрес встроенного плеера: перезагружаем только при смене ролика, старт — целыми секундами.
  // enablejsapi + origin — чтобы плеер принимал команды postMessage и сообщал своё время (подгонка ниже).
  function embedUrl(id, st, now, origin) {
    if (!id) return '';
    var start = Math.floor(seekTarget(st, now));
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(String(id)) +
      '?autoplay=1&mute=1&controls=0&start=' + start +
      (origin ? '&enablejsapi=1&origin=' + encodeURIComponent(String(origin)) : '');
  }

  // Подгонка встроенного плеера (15.11.2026): где он сейчас — по последнему сообщению infoDelivery
  // плюс прошедшее время, если играет. Перематываем, когда расхождение больше 1 с.
  function ytEstimate(cur, curAt, playing, now) {
    if (cur == null) return null;
    var c = Number(cur);
    if (!isFinite(c)) return null;
    var add = playing && isFinite(Number(curAt)) ? Math.max(0, (Number(now) - Number(curAt)) / 1000) : 0;
    return c + add;
  }
  function ytNeedsSeek(st, now, est, threshold) {
    if (est == null) return false;
    var lim = threshold == null ? 1 : Number(threshold);
    return Math.abs(seekTarget(st, now) - est) > lim;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { seekTarget: seekTarget, needsSeek: needsSeek, embedUrl: embedUrl, ytEstimate: ytEstimate, ytNeedsSeek: ytNeedsSeek };
  }
  if (typeof document === 'undefined') return;

  var frame = null, videoEl = null, ytEl = null, coverEl = null;
  var lastUrl = '', ytId = '', pendingSeek = false, lastState = null;
  var YT_ORIGIN = 'https://www.youtube-nocookie.com';
  var yt = { cur: null, curAt: 0, state: -1, ready: false };

  // Команда встроенному плееру (протокол IFrame API без загрузки чужого скрипта: CSP страницы его не пускает)
  function ytPost(func, args) {
    if (!ytEl || !ytEl.contentWindow) return;
    try { ytEl.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), YT_ORIGIN); } catch (e) { /* фрейм ещё грузится */ }
  }
  function ytListen() {
    if (!ytEl || !ytEl.contentWindow) return;
    try { ytEl.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'vo', channel: 'widget' }), YT_ORIGIN); } catch (e) { /* позже */ }
  }
  // Свести встроенный плеер с Тапёром: время и пауза.
  function syncYt(st, now) {
    if (!yt.ready) return;
    var est = ytEstimate(yt.cur, yt.curAt, yt.state === 1, now);
    if (ytNeedsSeek(st, now, est)) {
      ytPost('seekTo', [seekTarget(st, now), true]);
      yt.cur = seekTarget(st, now); yt.curAt = now;
    }
    if (st.playing && yt.state !== 1 && yt.state !== 3) ytPost('playVideo');
    else if (!st.playing && yt.state === 1) ytPost('pauseVideo');
  }

  function show(node, on) { if (node) node.hidden = !on; }

  function applyLook(look) {
    look = look || {};
    if (!frame) return;
    frame.style.borderRadius = '12px';
    if (look.border) {
      frame.style.borderStyle = 'solid';
      frame.style.borderWidth = (Number(look.width) || 4) + 'px';
      frame.style.borderColor = String(look.color || 'transparent');
    } else {
      frame.style.borderStyle = 'none';
      frame.style.borderWidth = '0px';
      frame.style.borderColor = 'transparent';
    }
  }

  function syncVideo(st, now) {
    if (!videoEl) return;
    if (videoEl.readyState >= 1 && (pendingSeek || needsSeek(st, now, videoEl.currentTime))) {
      try { videoEl.currentTime = seekTarget(st, now); } catch (e) { /* метаданных ещё нет */ }
      pendingSeek = false;
    }
    if (st.playing) {
      if (videoEl.paused) {
        var p = videoEl.play();
        if (p && p.catch) p.catch(function () { /* автозапуск может быть запрещён — не ошибка */ });
      }
    } else if (!videoEl.paused) {
      videoEl.pause();
    }
  }

  function apply(st, now) {
    if (!st || !frame) return;
    now = now || Date.now();
    applyLook(st.look);
    var kind = String(st.kind || 'none');
    document.body.classList.toggle('vo-hidden', kind === 'none');
    show(videoEl, kind === 'video');
    show(ytEl, kind === 'iframe');
    show(coverEl, kind === 'cover');

    if (kind === 'video') {
      var url = String(st.url || '');
      if (url && url !== lastUrl) {
        lastUrl = url;
        pendingSeek = true;
        videoEl.muted = true;
        try { videoEl.src = url; } catch (e) { /* пустой адрес — ничего не грузим */ }
      }
      syncVideo(st, now);
    } else if (kind === 'iframe') {
      var id = String(st.ytId || '');
      if (id && id !== ytId) {
        ytId = id;
        yt.cur = null; yt.ready = false; yt.state = -1;
        if (ytEl) ytEl.src = embedUrl(id, st, now, location.origin);
      } else {
        syncYt(st, now);
      }
    } else if (kind === 'cover') {
      var cover = String(st.cover || '');
      if (cover && coverEl && coverEl.getAttribute('src') !== cover) coverEl.src = cover;
    }
  }

  function init() {
    frame = document.getElementById('voFrame');
    videoEl = document.getElementById('voVideo');
    ytEl = document.getElementById('voYt');
    coverEl = document.getElementById('voCover');

    if (videoEl) {
      videoEl.muted = true;
      videoEl.addEventListener('loadedmetadata', function () {
        if (!pendingSeek || !lastState) return;
        try { videoEl.currentTime = seekTarget(lastState, Date.now()); } catch (e) { /* не даёт браузер */ }
        pendingSeek = false;
        if (lastState.playing) {
          var p = videoEl.play();
          if (p && p.catch) p.catch(function () { /* тихо */ });
        }
      });
    }

    if (ytEl) ytEl.addEventListener('load', function () { ytListen(); setTimeout(ytListen, 600); });
    // Ответы встроенного плеера: время и состояние (1 — играет, 2 — пауза, 3 — буферизация)
    window.addEventListener('message', function (e) {
      if (e.origin !== YT_ORIGIN || !ytEl || e.source !== ytEl.contentWindow) return;
      var d = null;
      try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (er) { return; }
      if (!d || typeof d !== 'object') return;
      if (d.event === 'onReady') { yt.ready = true; if (lastState) syncYt(lastState, Date.now()); }
      if (d.event === 'onStateChange' && typeof d.info === 'number') yt.state = d.info;
      if (d.event === 'infoDelivery' && d.info && typeof d.info === 'object') {
        yt.ready = true;
        if (typeof d.info.playerState === 'number') yt.state = d.info.playerState;
        if (typeof d.info.currentTime === 'number') { yt.cur = d.info.currentTime; yt.curAt = Date.now(); }
      }
    });
    // Пока показан встроенный плеер — сверяемся раз в 2 с (состояние от Тапёра приходит реже)
    setInterval(function () { if (lastState && lastState.kind === 'iframe') syncYt(lastState, Date.now()); }, 2000);

    try {
      // Превью в настройках (?preview=1) передаёт пометку дальше — иначе сервер посчитал бы его зрителем OBS
      var es = new EventSource('/video/events' + (/[?&]preview=1(&|$)/.test(location.search || '') ? '?preview=1' : ''));
      es.onmessage = function (ev) {
        var st = null;
        try { st = JSON.parse(ev.data); } catch (e) { return; }
        if (!st || st.hb) return;
        lastState = st;
        apply(st, Date.now());
      };
    } catch (e) { /* EventSource нет — страница просто пустая */ }
  }

  init();
})();
