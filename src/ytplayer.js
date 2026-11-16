// Страница встроенного плеера YouTube (P5c №1, B11).
// Живёт на http://localhost:<порт> (другой origin, чем окно на 127.0.0.1) и без preload:
// чужой скрипт iframe_api здесь не видит мост окна. Связь — только postMessage с проверкой
// event.origin, event.source и формата сообщения (src/yt-msg.js).
'use strict';
(function () {
  var M = window.TapYtMsg;
  var box = document.getElementById('yt');
  if (!M || !box) return;

  var ST_OK = { '-1': 1, '0': 1, '1': 1, '2': 1, '3': 1, '5': 1 };
  var parentOrigin = readParentOrigin();
  var apiReady = false, player = null, wanted = '', state = -1;
  var tick = null, lastDur = -1, sentReady = false, apiFailed = false;

  function ownPort() { return location.port || (location.protocol === 'https:' ? '443' : '80'); }

  // Ожидаемый адрес окна. Окно передаёт свой origin в ?parent=, но принять его можно,
  // только если это петля на нашем же порту: чужой адрес управления не получает.
  function readParentOrigin() {
    var raw = '';
    try { raw = new URLSearchParams(location.search).get('parent') || ''; } catch (e) { return ''; }
    var o = M.parseLoopbackOrigin(raw);
    if (!o) return '';
    try { if (new URL(o).port !== String(ownPort())) return ''; } catch (e) { return ''; }
    return o;
  }

  function send(type, value) {
    if (!parentOrigin) return;
    var msg = { t: 1, dir: 'evt', type: type };
    if (type !== 'ready') msg.value = value;
    try { window.parent.postMessage(msg, parentOrigin); } catch (e) {}
  }

  function sendTime() {
    if (!player) return;
    var t = 0, d = 0;
    try { t = player.getCurrentTime() || 0; } catch (e) {}
    try { d = player.getDuration() || 0; } catch (e) {}
    if (!(t >= 0 && t <= M.MAX_SEC)) t = 0;
    if (d > 0 && d <= M.MAX_SEC && d !== lastDur) { lastDur = d; send('duration', d); }
    send('time', t);
  }
  function startTick() { stopTick(); tick = setInterval(sendTime, 250); }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  function onState(code) {
    if (!ST_OK[String(code)]) return;
    state = code;
    send('state', code);
    if (code === 1) { startTick(); sendTime(); }
    else stopTick();
    if (code === 0) sendTime();
  }

  function create(id) {
    wanted = id;
    if (!apiReady || player || !(window.YT && window.YT.Player)) return;
    player = new window.YT.Player(box, {
      videoId: id,
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: function () {
          if (!sentReady) { sentReady = true; send('ready'); }
          lastDur = -1;
          sendTime();
        },
        onStateChange: function (e) { onState(e && e.data); },
        onError: function (e) { send('error', Number(e && e.data) || 0); }
      }
    });
  }

  function apiReadyNow() {
    if (apiReady) return;
    apiReady = true;
    if (wanted) create(wanted);
  }
  function apiFail(code) {
    if (apiFailed || apiReady) return;
    apiFailed = true;
    send('error', code);
  }
  function loadApi() {
    if (window.YT && window.YT.Player) { apiReadyNow(); return; }
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      try { if (typeof prev === 'function') prev(); } catch (e) {}
      apiReadyNow();
    };
    var sc = document.createElement('script');
    sc.src = 'https://www.youtube.com/iframe_api';
    sc.onerror = function () { apiFail(-1); };
    document.head.appendChild(sc);
    setTimeout(function () { if (!(window.YT && window.YT.Player)) apiFail(-2); }, 15000);
  }

  // Команды окна: origin и source — точные, тип и поля — из белого списка.
  window.addEventListener('message', function (e) {
    if (!parentOrigin) return;
    if (e.origin !== parentOrigin) return;
    if (e.source !== window.parent) return;
    var cmd = M.parseCmd(e.data);
    if (!cmd) return;
    if (cmd.type === 'load') {
      wanted = cmd.id;
      if (player) { try { player.loadVideoById(cmd.id); } catch (x) { send('error', -3); } }
      else create(cmd.id);
      return;
    }
    if (!player) return;
    try {
      if (cmd.type === 'play') player.playVideo();
      else if (cmd.type === 'pause') player.pauseVideo();
      else if (cmd.type === 'seek') { player.seekTo(cmd.value, true); sendTime(); }
      else if (cmd.type === 'volume') player.setVolume(Math.max(0, Math.min(100, Math.round(cmd.value))));
    } catch (x) { send('error', -3); }
  });

  if (!parentOrigin) return; // окно не назвалось — плеер не запускаем вовсе
  loadApi();
})();
