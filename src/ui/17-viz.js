  // ===== Визуализатор и «на весь экран» (пункты 12 и 14) =====
  // Когда у трека нет картинки (только звук, сайт Яндекса, файл без видео), в окне видео — обложка слева
  // и столбики до правого края. Звук берём у самого окна Тапёра (захват своей страницы через Electron:
  // viz-arm в main.js), поэтому медиа-элементы не трогаем — потоки Яндекса не ломаются (см. 0.10.1).
  // Не услышали (запасной путь через скрытый сайт Яндекса, отказ захвата) — спокойные «дышащие» столбики.
  // Экономия (docs/POWER-PLAN.md): ≤60 кадров/с, рисуем только когда окно видно и в фокусе и музыка играет;
  // пауза — столбики опускаются и рисование останавливается; захват закрывается через 20 с без дела.
  var VZ = { on: false, raf: 0, last: 0, color: '', bars: [], peak: 0.4, cap: null, capFailed: false, capBusy: false,
    quiet: 0, idleT: 0, w: 0, h: 0, dpr: 1, noise: [] };
  var vizEl = $('viz'), vizCv = $('vizCv'), vizCov = $('vizCov'), vidBox = $('vidBox');
  var vizReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function vizSetColor(c){ VZ.color = c || ''; }
  // Вид столбиков: цвет (vizColor: cover — обложка, accent — акцент темы, grad — сверху обложка, к низу акцент)
  // и скругление — как у обложки рядом (в оболочках без скруглений углы прямые сами). Читаем раз в секунду, не каждый кадр.
  var VST = { at: 0, ac: '', round: true }, vizMode = 'grad';
  try { vizMode = localStorage.getItem('tapVizColor') || 'grad'; } catch (e) {}
  function vizStyle(){
    var now = Date.now(); if (now - VST.at < 1000) return VST;
    VST.at = now;
    VST.ac = getComputedStyle(document.documentElement).getPropertyValue('--ac').trim() || 'currentColor';
    VST.round = parseFloat(getComputedStyle(vizCov).borderTopLeftRadius) > 0;
    return VST;
  }
  function vizColorSet(m, save){
    vizMode = m === 'accent' || m === 'cover' ? m : 'grad'; VST.at = 0;
    try { localStorage.setItem('tapVizColor', vizMode); } catch (e) { console.warn('Тапёр: не сохранился цвет визуализатора', e); }
    if (save && A.setSetting) A.setSetting('vizColor', vizMode);
    var bs = document.querySelectorAll('#setVizColor button');
    for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', bs[k].dataset.v === vizMode);
    if (VZ.on) vizDraw();
  }
  if (A.getSetting) A.getSetting('vizColor').then(function (v){ if (v) vizColorSet(v); });
  $('setVizColor').addEventListener('click', function(e){ var b = e.target.closest('button[data-v]'); if (b) vizColorSet(b.dataset.v, true); });
  vizColorSet(vizMode);
  function vizWanted(){
    var v = queue[current];
    if (!v || isIdle()) return false;
    if (mode === 'iframe' || mode === 'split') return false;          // есть картинка YouTube
    if (mode === 'single') return !(video.videoWidth > 0);            // видеофайл/поток с картинкой
    return true;                                                       // 'audio', 'ymweb'
  }
  function vizPlaying(){ var m = master(); return !!m && !m.paused && !document.body.classList.contains('is-paused'); }
  function vizCanDraw(){ return !document.hidden && !document.body.classList.contains('calm'); }

  // Размер холста — по рамке, с учётом плотности пикселей
  function vizSize(){
    var r = vizCv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (w !== VZ.w || h !== VZ.h || d !== VZ.dpr) { VZ.w = vizCv.width = w; VZ.h = vizCv.height = h; VZ.dpr = d; }
    var n = Math.max(12, Math.min(32, Math.round(r.width / 16)));
    if (VZ.bars.length !== n) { VZ.bars = new Array(n).fill(0); VZ.noise = VZ.bars.map(function(){ return Math.random() * 6.28; }); }
  }
  if (window.ResizeObserver) new ResizeObserver(function(){ if (VZ.on) { vizSize(); vizDraw(); } }).observe(vizCv);

  // Захват звука своего окна (только в Тапёре; в браузерных проверках — сразу спокойные столбики)
  async function vizCapture(){
    if (VZ.cap || VZ.capFailed || VZ.capBusy || !A.vizArm || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return;
    VZ.capBusy = true;
    var stream = null;
    try {
      await A.vizArm();
      var st = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream = st;
      st.getVideoTracks().forEach(function (t){ t.stop(); });           // картинка не нужна
      if (!st.getAudioTracks().length) throw new Error('без звука');
      var ctx = new AudioContext(), src = ctx.createMediaStreamSource(st), an = ctx.createAnalyser();
      an.fftSize = 1024; an.smoothingTimeConstant = 0.55;   // подобрано с владельцем 26.10: живо, но плавно
      src.connect(an);                                                   // в колонки не подключаем: звук окна и так идёт туда (enableLocalEcho в main.js)
      VZ.cap = { st: st, ctx: ctx, an: an, buf: new Uint8Array(an.frequencyBinCount) };
      axLog('визуализатор: слушаю звук окна');
    } catch (e) {
      try { if (stream) stream.getTracks().forEach(function (t){ t.stop(); }); } catch (e2) {}
      VZ.capFailed = true;
      axLog('визуализатор: захват звука не вышел (' + (e && e.message || e) + ') — спокойные столбики');
    }
    VZ.capBusy = false;
  }
  function vizRelease(){
    VZ.capFailed = false;
    if (!VZ.cap) return;
    try { VZ.cap.st.getTracks().forEach(function (t){ t.stop(); }); VZ.cap.ctx.close(); } catch (e) {}
    VZ.cap = null;
    axLog('визуализатор: отпустил звук окна');
  }

  // Уровни столбиков: из звука (полосы — по логарифму частот) или спокойный шум
  function vizLevels(t){
    var n = VZ.bars.length, out = new Array(n), playing = vizPlaying();
    if (!playing) { for (var z = 0; z < n; z++) out[z] = 0; return out; }
    var c = VZ.cap, heard = false;
    if (c && VZ.quiet < 90) {
      c.an.getByteFrequencyData(c.buf);
      var lo = 2, hi = Math.min(c.buf.length - 1, 280), mx = 0;
      for (var i = 0; i < n; i++) {
        var a = Math.floor(lo * Math.pow(hi / lo, i / n)), b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / n)));
        var s = 0; for (var k = a; k < b; k++) s += c.buf[k]; s = s / (b - a) / 255;
        out[i] = s; if (s > mx) mx = s;
      }
      // своя громкость не должна решать высоту: подстраиваемся под самый громкий кусок
      VZ.peak = Math.max(mx, VZ.peak * 0.992, 0.12);
      for (var j = 0; j < n; j++) out[j] = Math.pow(Math.min(1, out[j] / VZ.peak), 1.35);
      VZ.quiet = mx < 0.01 ? VZ.quiet + 1 : 0;                           // ~3 с тишины при игре — значит, не слышим
      heard = VZ.quiet < 90;
    }
    if (!heard) {
      for (var q = 0; q < n; q++) {
        var ph = VZ.noise[q], f = 0.35 + 0.25 * Math.sin(t / 900 + ph) + 0.15 * Math.sin(t / 370 + ph * 2.3);
        out[q] = Math.max(0.08, f * (1 - q / (n * 1.6)));
      }
    }
    return out;
  }

  // Один общий уровень громкости для оверлея OBS (осциллограмма бежит лентой — ей нужно одно число): 0…1,
  // подстраивается под самый громкий кусок, как столбики. null — не слышим (нет захвата, пауза, ~3 с тишины при игре).
  var ovPeak = 0.1, ovQuiet = 0;
  function vizOvLevel(){
    var c = VZ.cap; if (!c || !vizPlaying()) return null;
    c.an.getByteFrequencyData(c.buf);
    var n = Math.min(c.buf.length, 220), s = 0;
    for (var i = 2; i < n; i++) s += c.buf[i];
    s = s / (n - 2) / 255;
    ovQuiet = s < 0.004 ? ovQuiet + 1 : 0;
    if (ovQuiet > 33) return null;                                     // ~3 с тишины при игре — оверлей перейдёт на имитацию
    ovPeak = Math.max(s, ovPeak * 0.995, 0.05);
    return Math.pow(Math.min(1, s / ovPeak), 1.2);
  }

  // 32 полосы для OBS-оверлея: логарифмическая шкала, усреднение соседних FFT-бинов.
  // Возвращает null, если звук сейчас не слышен — страница сама включит волну.
  var ovSpecSm = [], ovSpecPeak = 0;
  function vizOvSpectrum(){
    var c = VZ.cap; if (!c || !vizPlaying()) return null;
    c.an.getByteFrequencyData(c.buf);
    var n = 32, lo = 2, hi = Math.min(c.buf.length - 1, 280), out = new Array(n), mx = 0;
    for (var i = 0; i < n; i++) {
      var a = Math.floor(lo * Math.pow(hi / lo, i / n));
      var b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / n)));
      var s = 0; for (var k = a; k < b; k++) s += c.buf[k];
      s = s / (b - a) / 255; out[i] = s; if (s > mx) mx = s;
    }
    if (mx < 0.008) return null;
    ovSpecPeak = Math.max(mx, ovSpecPeak * 0.995, 0.08);
    for (var j = 0; j < n; j++) {
      var v = Math.pow(Math.min(1, out[j] / ovSpecPeak), 1.35);
      ovSpecSm[j] = ovSpecSm[j] == null ? v : ovSpecSm[j] + (v - ovSpecSm[j]) * 0.35;
      out[j] = Math.round(ovSpecSm[j] * 1000) / 1000;
    }
    return out;
  }

  function vizDraw(t){
    var g = vizCv.getContext('2d'), n = VZ.bars.length; if (!g || !n) return;
    var W = VZ.w, H = VZ.h, gap = Math.max(2, W / n * 0.34), bw = (W - gap * (n - 1)) / n, st = vizStyle(), col;
    g.clearRect(0, 0, W, H);
    if (bw < 1 || H < 4) return;                                       // окно видео свёрнуто в полоску
    if (vizMode === 'accent') col = st.ac;
    else if (vizMode === 'grad') { col = g.createLinearGradient(0, 0, 0, H); col.addColorStop(0, VZ.color || st.ac); col.addColorStop(1, st.ac); }
    else col = VZ.color || st.ac;
    g.fillStyle = col;
    for (var i = 0; i < n; i++) {
      var h = Math.max(3 * VZ.dpr, VZ.bars[i] * H * 0.92), x = i * (bw + gap);
      g.globalAlpha = 0.5 + 0.5 * (1 - i / n);
      g.beginPath();
      if (st.round && g.roundRect) g.roundRect(x, H - h, bw, h, Math.max(0, Math.min(bw / 2, 4 * VZ.dpr, h / 2))); else g.rect(x, H - h, bw, h);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function vizFrame(t){
    VZ.raf = 0;
    if (!VZ.on || !vizCanDraw()) return;
    var fps = vizReduce.matches ? 8 : 60;                              // 60 кадров/с: столбиков мало, это дёшево (замер владельца: ~1,4% ЦП всего Тапёра)
    if (t - VZ.last >= 1000 / fps - 2) {
      VZ.last = t;
      var lv = vizLevels(t), moving = false;
      for (var i = 0; i < VZ.bars.length; i++) {
        var b = VZ.bars[i], to = lv[i];
        b += (to - b) * (to > b ? 0.75 : 0.24);                        // вверх — быстро, вниз — плавно (одобрено владельцем 26.10)
        if (Math.abs(b - to) > 0.004 || b > 0.004) moving = true;
        VZ.bars[i] = b;
      }
      vizDraw(t);
      if (!vizPlaying() && !moving) return;                            // опустились на паузе — больше не рисуем
    }
    VZ.raf = requestAnimationFrame(vizFrame);
  }
  function vizKick(){ if (!VZ.raf && VZ.on && vizCanDraw()) VZ.raf = requestAnimationFrame(vizFrame); }

  // Главная развилка: показать/спрятать, начать/остановить рисование и захват
  function vizUpdate(){
    var want = vizWanted();
    if (want !== VZ.on) {
      VZ.on = want; vizEl.hidden = !want; vidBox.classList.toggle('viz-on', want);
      if (want) { vizSize(); VZ.bars = VZ.bars.map(function(){ return 0; }); }
    }
    if (want) {
      var v = queue[current], u = (v && (v.cover || v.thumb)) || 'assets/icon.png';
      if (vizCov.getAttribute('src') !== u) vizCov.setAttribute('src', u);
    }
    clearTimeout(VZ.idleT);
    // захват звука держим, только пока столбики видно: окно в фоне/свёрнуто дольше 20 с — отпускаем (аудит 0.22).
    // Исключение — оверлей OBS с «настоящим звуком» (25-overlay.js): он нужен и при свёрнутом окне, пока трек играет.
    var ovNeed = typeof ovWantsLevels === 'function' && ovWantsLevels() && vizPlaying();
    if ((want && vizPlaying() && vizCanDraw()) || ovNeed) { VZ.quiet = 0; vizCapture(); }
    else VZ.idleT = setTimeout(vizRelease, 20000);
    vizKick();
  }
  allEls().concat([ytx, ymx]).forEach(function (el){
    ['play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata'].forEach(function (ev){ el.addEventListener(ev, function(){ setTimeout(vizUpdate, 0); }); });
  });
  function vizWake(){ setTimeout(vizUpdate, 0); }                     // после того, как 00-core переключит body.calm
  window.addEventListener('focus', vizWake);
  window.addEventListener('blur', vizWake);
  document.addEventListener('visibilitychange', vizWake);
  vizCov.addEventListener('error', function(){ if (vizCov.getAttribute('src') !== 'assets/icon.png') vizCov.setAttribute('src', 'assets/icon.png'); });

  // ===== На весь экран (пункт 14) =====
  var vfsHideT = 0, vfsState = false, vfsWant = false;
  function vfsOn(){ return vfsState; }
  // Разворачиваем само окно Тапёра. Через requestFullscreen страница оставалась прежнего
  // размера посреди экрана — отсюда брались чёрные поля по бокам у видео и визуализатора.
  function vfsSet(on){
    vfsWant = !!on;
    if (A.winFullscreen) { A.winFullscreen(!!on); return; }
    if (on) { if (vidBox.requestFullscreen) vidBox.requestFullscreen().catch(function (e){ axLog('весь экран: ' + e.message); }); }
    else if (document.fullscreenElement) document.exitFullscreen().catch(noop);
  }
  function vfsToggle(){ vfsSet(!vfsOn()); }
  function vfsSync(){
    if (!vfsOn()) return;
    var v = queue[current] || {}, m = master(), d = (m && m.duration) || 0, c = (m && m.currentTime) || 0;
    $('vfsT').textContent = v.title || 'Ничего не играет';
    $('vfsA').textContent = v.author || '';
    if (!vfsDrag) vfsPaint(d > 0 ? Math.min(1, c / d) : 0);
    $('vfsTm').textContent = fmt(c) + ' / ' + fmt(d);
  }
  function vfsPoke(){
    vidBox.classList.add('vfs-show'); clearTimeout(vfsHideT);
    if (vfsOver || vfsDrag) return; // мышь на полосе или тянут перемотку — не прячем
    vfsHideT = setTimeout(function(){ vidBox.classList.remove('vfs-show'); }, 2500);
  }
  $('vidFs').onclick = function(e){ e.stopPropagation(); vfsToggle(); };
  $('vfsX').onclick = function(e){ e.stopPropagation(); vfsToggle(); };
  // ===== Управление в полном экране: кнопки, перемотка, «растянуть», клавиши =====
  var vfsSeekEl = $('vfsSeek'), vfsFillEl = $('vfsFill'), vfsKnobEl = $('vfsKnob'), vfsDrag = false, vfsOver = false;
  function vfsPaint(frac){ var p = (Math.max(0, Math.min(1, frac)) * 100) + '%'; vfsFillEl.style.width = p; vfsKnobEl.style.left = p; }
  function vfsFrac(x){ var r = vfsSeekEl.getBoundingClientRect(); return r.width ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0; }
  // Перематываем так же, как полосой внизу окна: у «раздельного» режима звук и картинка двигаются вместе
  function vfsSeekAt(t){
    var m = master(), d = (m && m.duration) || 0; if (d <= 0) return;
    t = Math.max(0, Math.min(d - 0.3, t));
    m.currentTime = t;
    if (mode === 'split') { try { video.currentTime = t; } catch (e) {} }
    vfsSync();
  }
  function vfsStep(sec){ var m = master(); if (!m) return; vfsSeekAt(((m.currentTime) || 0) + sec); vfsPoke(); }
  vfsSeekEl.addEventListener('mousedown', function(e){ e.stopPropagation(); e.preventDefault(); vfsDrag = true; vfsSeekEl.classList.add('drag'); vfsPaint(vfsFrac(e.clientX)); });
  document.addEventListener('mousemove', function(e){ if (vfsDrag) { vfsPaint(vfsFrac(e.clientX)); vfsPoke(); } });
  document.addEventListener('mouseup', function(e){
    if (!vfsDrag) return;
    vfsDrag = false; vfsSeekEl.classList.remove('drag');
    var m = master(), d = (m && m.duration) || 0;
    if (d > 0) vfsSeekAt(vfsFrac(e.clientX) * d);
    vfsPoke();
  });
  $('vfsBar').addEventListener('mouseenter', function(){ vfsOver = true; clearTimeout(vfsHideT); vidBox.classList.add('vfs-show'); });
  $('vfsBar').addEventListener('mouseleave', function(){ vfsOver = false; if (vfsOn()) vfsPoke(); });
  $('vfsPlay').onclick = function(e){ e.stopPropagation(); $('playpause').click(); vfsPoke(); };
  $('vfsPrev').onclick = function(e){ e.stopPropagation(); prev(); vfsPoke(); };
  $('vfsNext').onclick = function(e){ e.stopPropagation(); next(); vfsPoke(); };
  // «Растянуть»: картинка заполняет экран целиком, лишнее по краям обрезается. Выбор запоминается.
  function vfsFill(on){
    var v = (on == null) ? !vidBox.classList.contains('vfs-fill') : !!on;
    vidBox.classList.toggle('vfs-fill', v);
    // Подпись на кнопке — что произойдёт по нажатию, а не как сейчас
    $('vfsFitTx').textContent = v ? 'Вписать' : 'Растянуть';
    $('vfsFit').title = v ? 'Вернуть всю картинку целиком (будут полосы) — клавиша F' : 'Растянуть на весь экран (края обрежутся) — клавиша F';
    try { localStorage.setItem('tapVfsFill', v ? '1' : ''); } catch (e) { console.warn('Тапёр: не сохранилась заливка', e); }
    return v;
  }
  $('vfsFit').onclick = function(e){ e.stopPropagation(); vfsFill(); vfsPoke(); };
  document.addEventListener('keydown', function(e){
    if (!vfsOn() || e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || (t && t.isContentEditable)) return;
    if (e.key === 'Escape') { e.preventDefault(); vfsSet(false); }
    if (e.code === 'Space') { e.preventDefault(); $('playpause').click(); vfsPoke(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); vfsStep(5); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); vfsStep(-5); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); stepVol(5); vfsPoke(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepVol(-5); vfsPoke(); }
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') { e.preventDefault(); vfsFill(); vfsPoke(); }
  });
  vidBox.addEventListener('dblclick', function(e){ if (!e.target.closest('.vfs-bar')) vfsToggle(); });
  vidBox.addEventListener('mousemove', function(){ if (vfsOn()) vfsPoke(); });
  function vfsApply(on){
    vfsState = !!on; vidBox.classList.toggle('vfs', vfsState);
    document.body.classList.toggle('vfs-mode', vfsState);
    $('vidFs').setAttribute('aria-label', vfsState ? 'Выйти из полного экрана' : 'На весь экран');
    if (vfsState) { try { vfsFill(localStorage.getItem('tapVfsFill') === '1'); } catch (e) {} vfsSync(); vfsPoke(); }
    if (VZ.on) { vizSize(); vizDraw(); vizKick(); }
  }
  // Окно развернули или свернули: показываем видео на весь экран только если просили мы (а не F11)
  if (A.onWinFullscreen) A.onWinFullscreen(function (on){ if (on && !vfsWant) return; vfsApply(on); if (!on) vfsWant = false; });
  document.addEventListener('fullscreenchange', function(){ if (!A.winFullscreen) vfsApply(document.fullscreenElement === vidBox); });
  allEls().concat([ytx, ymx]).forEach(function (el){ el.addEventListener('timeupdate', function(){ if (el === master()) vfsSync(); }); });
