// ===== «Видео для OBS» (VO1) =====
// Отдельная страница /video показывает картинку YouTube поверх стрима. Состояние собирает
// это окно и шлёт в главный процесс, только пока страницу смотрит OBS или открыто превью
// в настройках (энергосбережение). Настройки: обводка и её цвет/толщина, «скрывать музыку».
var VOW = { border: false, color: '', width: 4, hideAudio: true, clients: 0, preview: false, url: '', last: '', sentAt: 0, lastState: null, timer: 0, obs: null };

// Какой вид показать: video (картинка YouTube), iframe (запасной плеер), cover (обложка) или none.
// Чистая функция: работает и в Node (unit-тест), ничего не читает из DOM.
function voPickKind(o) {
  o = o || {};
  if (!o.track) return 'none';
  var src = String(o.src || '');
  var mode = String(o.mode || '');
  var url = String(o.url || '');
  var ytId = String(o.ytId || '');
  if (src === 'yt' && (mode === 'split' || mode === 'single') && url) return 'video';
  if (src === 'yt' && mode === 'iframe' && ytId) return 'iframe';
  if (o.hideAudio === false && o.cover) return 'cover';
  return 'none';
}

function voAccent() {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--ac');
    return String(v || '').trim();
  } catch (e) { return ''; }
}

// Цвет к виду HEX для подписи; понимает #rgb/#rrggbb и rgb()/rgba().
function voHexOf(v) {
  var s = String(v == null ? '' : v).trim();
  var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h.toUpperCase();
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(function (n) {
      var x = Math.max(0, Math.min(255, Number(n) || 0)).toString(16);
      return x.length === 1 ? '0' + x : x;
    }).join('').toUpperCase();
  }
  return '';
}

function voLook() {
  return {
    border: !!VOW.border,
    color: String(VOW.color || voAccent()),
    width: Number(VOW.width) || 4,
    hideAudio: VOW.hideAudio !== false
  };
}

// Снимок для страницы OBS: что играет и как выглядит. playing — по звуку (master()),
// чтобы пауза картинки ради энергосбережения (vidHeld) не считалась паузой.
function voSnap() {
  var look = voLook();
  var st = { kind: 'none', url: '', ytId: '', cover: '', t: 0, at: Date.now(), playing: false, rate: 1, look: look };
  var v = (typeof queue !== 'undefined' && queue && typeof current === 'number') ? queue[current] : null;
  if (!v) return st;
  st.cover = String(v.cover || v.thumb || '');
  var idle = false;
  try { idle = isIdle(); } catch (e) { idle = false; }
  var url = '';
  if (v._videoUrl) url = String(v._videoUrl);
  else { try { url = video.getAttribute('src') || ''; } catch (e) {} }
  var ytId = '';
  try { if (mode === 'iframe' && YX && YX.vid) ytId = String(YX.vid); } catch (e) {}
  var m = null;
  try { m = master(); } catch (e) {}
  if (m) {
    try { st.t = Number(m.currentTime) || 0; } catch (e) {}
    try { st.playing = !m.paused; } catch (e) {}
    try { st.rate = Number(m.playbackRate) || 1; } catch (e) {}
  }
  st.kind = voPickKind({
    track: !idle,
    src: (typeof srcOf === 'function' ? srcOf(v) : ''),
    mode: (typeof mode === 'string' ? mode : ''),
    url: url, ytId: ytId, cover: st.cover, hideAudio: look.hideAudio
  });
  if (st.kind === 'video') st.url = url;
  if (st.kind === 'iframe') st.ytId = ytId;
  return st;
}

function voActive() { return VOW.clients > 0 || VOW.preview; }

// Отправка состояния: при изменениях/по команде и раз в 5 секунд, пока играет.
function voPush(force) {
  if (!voActive() || !A || !A.videoPush) return;
  var st;
  try { st = voSnap(); } catch (e) { return; }
  var sig = JSON.stringify([st.kind, st.url, st.ytId, st.cover, st.playing, st.look.border, st.look.color, st.look.width, st.look.hideAudio]);
  var now = Date.now(), drift = false;
  var prev = VOW.lastState;
  if (st.kind === 'video' && prev && prev.kind === 'video' && prev.playing) {
    var exp = prev.t + (now - prev.at) / 1000;
    drift = Math.abs(exp - st.t) > 1.2;   // перемотку ловим и без явного события
  }
  var tick = st.playing && now - VOW.sentAt >= 5000;
  if (!force && sig === VOW.last && !drift && !tick) return;
  VOW.last = sig; VOW.sentAt = now; VOW.lastState = st;
  try { A.videoPush(st); } catch (e) {}
}

// Плеер изменился (трек, пауза, перемотка, режим) — отправить сразу, но не посреди кадра.
function voKick() {
  if (!VOW) return;
  setTimeout(function () { voPush(true); }, 0);
}

function voMenu() {
  var d = $('voDot');
  if (d) d.hidden = !(VOW.clients > 0);
}

function voWidthUi() {
  var seg = $('voWidth');
  if (!seg) return;
  Array.prototype.forEach.call(seg.querySelectorAll('button[data-v]'), function (b) {
    b.classList.toggle('on', Number(b.dataset.v) === (Number(VOW.width) || 4));
  });
}

function voColorUi() {
  var own = VOW.color || '';
  var val = own || voAccent();
  var sw = $('voSw'), hx = $('voHex'), note = $('voColorNote');
  if (sw) sw.style.background = val || 'var(--ac)';
  if (hx) hx.textContent = own ? (voHexOf(own) || own) : (voHexOf(val) || 'акцент темы');
  if (note) note.textContent = own ? 'Свой цвет обводки' : 'По умолчанию — акцент текущей темы';
}

function voPickColor() {
  if (typeof colOpenFor !== 'function') return;
  var start = VOW.color || voAccent();
  colOpenFor('Цвет обводки видео', start, function (hex) {
    var v = String(hex || '').toUpperCase();
    // Отмена возвращает исходный цвет: если он был «как акцент темы», так и оставляем.
    if (!v || (VOW.color === '' && v === String(start || '').toUpperCase())) VOW.color = '';
    else { VOW.color = v; if (A.setSetting) A.setSetting('voColor', v); }
    voColorUi(); voPush(true);
  });
}

// Превью — с http://localhost:<порт>, другого origin, чем окно (127.0.0.1): странице не виден parent.app.
function voPreviewSrc(on) {
  var base = (location.protocol === 'http:' && location.port) ? 'http://localhost:' + location.port : '';
  if (!on || !base) return 'about:blank';
  return base + '/video?preview=1';
}

function voPreview() {
  var fr = $('voFrame');
  if (!fr) return;
  var src = voPreviewSrc(VOW.preview);
  if (fr.getAttribute('src') !== src) fr.setAttribute('src', src);
}

// Раздел виден — превью подключено и окно шлёт состояние; ушли — превью отключено.
function voWatch() {
  var sec = $('sVideo');
  if (!sec) return;
  if (!window.IntersectionObserver) { VOW.preview = !sec.hidden; voPreview(); return; }
  VOW.obs = new IntersectionObserver(function (es) {
    var vis = es.some(function (e) { return e.isIntersecting; });
    if (vis === VOW.preview) return;
    VOW.preview = vis;
    voPreview();
    if (vis) voPush(true);
  });
  VOW.obs.observe(sec);
}

function voInit() {
  var urlEl = $('voUrl'), copyBtn = $('voCopy');
  if (A.videoUrl) A.videoUrl().then(function (u) {
    VOW.url = u || '';
    if (urlEl) urlEl.textContent = VOW.url || 'сервер ещё не запущен';
  });
  if (A.videoClients) A.videoClients().then(function (n) {
    VOW.clients = Number(n) || 0;
    voMenu();
    if (VOW.clients > 0) voPush(true);
  });
  if (A.onVideoClients) A.onVideoClients(function (n) {
    var was = VOW.clients;
    VOW.clients = Number(n) || 0;
    voMenu();
    if (VOW.clients > 0 && !(was > 0)) setTimeout(function () { voPush(true); }, 50);
  });

  if (copyBtn) copyBtn.onclick = function () {
    if (!VOW.url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(VOW.url).then(function () { toast('Адрес для OBS скопирован'); }).catch(function () { prompt('Скопируй адрес:', VOW.url); });
    } else prompt('Скопируй адрес:', VOW.url);
  };

  var colBtn = $('voColorBtn');
  if (colBtn) colBtn.onclick = voPickColor;

  var seg = $('voWidth');
  if (seg) seg.onclick = function (e) {
    var b = e.target.closest('button[data-v]');
    if (!b) return;
    VOW.width = Number(b.dataset.v) || 4;
    if (A.setSetting) A.setSetting('voWidth', VOW.width);
    voWidthUi(); voPush(true);
  };

  // Тумблеры сохраняет общий обработчик data-set-tg (src/ui/14-settings.js); здесь только
  // подхватываем новое значение и сразу показываем его в превью.
  var btg = $('voBorderTg');
  if (btg) btg.addEventListener('click', function () { VOW.border = btg.classList.contains('on'); voPush(true); });
  var htg = $('voHideAudioTg');
  if (htg) htg.addEventListener('click', function () { VOW.hideAudio = htg.classList.contains('on'); voPush(true); });

  if (A.getSetting) {
    A.getSetting('voBorder').then(function (v) { VOW.border = v === true; voPush(true); });
    A.getSetting('voColor').then(function (v) { VOW.color = v ? String(v).toUpperCase() : ''; voColorUi(); voPush(true); });
    A.getSetting('voWidth').then(function (v) { VOW.width = Number(v) || 4; voWidthUi(); voPush(true); });
    A.getSetting('voHideAudio').then(function (v) { VOW.hideAudio = v !== false; voPush(true); });
  }

  voColorUi(); voWidthUi(); voMenu(); voWatch();
  if (!VOW.timer) VOW.timer = setInterval(function () { voPush(false); }, 1000);
}

if (typeof document !== 'undefined') voInit();
if (typeof module !== 'undefined' && module.exports) module.exports = { voPickKind: voPickKind };
