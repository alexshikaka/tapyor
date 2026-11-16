  // ===== Звук: ровная громкость и плавные переходы =====
  // Граф: элемент → норм. громкость (подгонка трека) → затухание (кроссфейд) → общая громкость → ограничитель → колонки.
  // Параллельно звук идёт в анализатор, чтобы измерить громкость треков без данных (YouTube).
  var AX = { ctx: null, master: null, nodes: [], norm: true, xfade: 6, guess: dbLin(-5), broken: false };
  var mediaWatch = null;
  // Явный признак «играет» (аудит 0.34.0, A10): приходит из событий play/pause/ended
  // любого плеера, включая встроенный YouTube (ytx) и сайт Яндекса (ymx) — у них нет
  // своего <audio>, и раньше todayPos() мог решить, что музыка играет, когда она на паузе.
  var playingNow = false;
  var TARGET_LUFS = -14;
  function dbLin(db){ return Math.pow(10, db / 20); }
  // Граф Web Audio больше не используется: он требовал crossOrigin, а потоки Яндекса/YouTube
  // его не дают — из-за этого звук мог вообще не заиграть. Теперь громкость регулируем прямо
  // у элемента (el.volume), это надёжно и никогда не ломает воспроизведение.
  function axInit(){ return false; }
  function axLog(msg){ if (A.log) A.log(msg); }
  function elGain(el){
    var v = curVol();
    return Math.max(0, Math.min(1, v * (el._fade == null ? 1 : el._fade) * (el._norm == null ? 1 : el._norm)));
  }
  function applyVol(){
    allEls().forEach(function (el){ el.volume = elGain(el); });
    ytxVolume(); ymxVolume(); // раньше сайт Яндекса не слушался ползунка и горячих клавиш
  }
  // Ровная громкость: для Яндекса берём громкость трека (r128) и приглушаем слишком громкие.
  // Поднять тихий трек выше 100% нельзя (ограничение элемента), поэтому тихие играют на полной.
  function axTrackStart(el, v){
    var norm = 1;
    if (AX.norm && v && typeof v.lufs === 'number') norm = Math.max(dbLin(-14), Math.min(dbLin(6), dbLin(TARGET_LUFS - v.lufs)));
    el._norm = norm;
    applyVol();
  }

  // Затухание элемента для плавного перехода — через его собственную громкость
  function setFade(el, val){ clearInterval(el._fadeT); el._fade = val; applyVol(); }
  function fadeEl(el, from, to, sec, done){
    clearInterval(el._fadeT); clearTimeout(el._fadeDone);
    var t0 = Date.now();
    el._fade = from; applyVol();
    el._fadeT = setInterval(function(){
      var p = Math.min(1, (Date.now() - t0) / (sec * 1000));
      // кривая «равной мощности»: в середине перехода громкость не проваливается
      el._fade = to > from ? from + (to - from) * Math.sin(p * Math.PI / 2) : from + (to - from) * (1 - Math.cos(p * Math.PI / 2));
      applyVol();
      if (p >= 1) clearInterval(el._fadeT);
    }, 50);
    if (done) el._fadeDone = setTimeout(done, sec * 1000 + 60);
  }
  function stopEl(el){ clearInterval(el._fadeT); clearTimeout(el._fadeDone); dropHls(el); el.pause(); el.removeAttribute('src'); el.load(); setFade(el, 1); }

  // Режим очереди: 'classic' — «Классический плейлист» (по умолчанию), 'live' — «Живая очередь» (сыгранное уезжает вверх)
  var qMode = 'classic';
  function isClassic(){ return qMode === 'classic'; }
  // Стримерские функции выключены — в описаниях не упоминаем заказы: их в программе просто нет
  function stOn(){ return streamerOn !== false; }
  // Кнопки плейлистов: в классике «Играть» / «Играть вперемешку» (заменяют очередь), в живой — «фоном»
  function BGL(){ return isClassic() ? 'Играть' : 'Играть фоном'; }
  function SHL(){ return isClassic() ? 'Играть вперемешку' : 'Фоном вперемешку'; }
  // Подсказки на самих кнопках (раньше это был текст над списком). Для двух режимов — разные
  function BGT(){ return isClassic()
    ? 'Заменить очередь этим списком и играть по порядку' + (stOn() ? '. Ждущие заказы остаются и играют первыми' : '')
    : 'Играет вместо волны' + (stOn() ? ', пока нет заказов. Заказы всё равно идут первыми' : ''); }
  function SHT(){ return isClassic()
    ? 'Заменить очередь этим списком вперемешку' + (stOn() ? '. Ждущие заказы остаются и играют первыми' : '')
    : 'То же вперемешку: играет вместо волны' + (stOn() ? ', пока нет заказов. Заказы всё равно идут первыми' : ''); }
  function bgTitles(root){
    var a = (root || document).querySelectorAll('.lbl-bg'), b = (root || document).querySelectorAll('.lbl-shuf'), k, btn;
    for (k = 0; k < a.length; k++) { btn = a[k].closest('button'); if (btn) { btn.setAttribute('data-tip', BGT()); btn.removeAttribute('title'); } }
    for (k = 0; k < b.length; k++) { btn = b[k].closest('button'); if (btn) { btn.setAttribute('data-tip', SHT()); btn.removeAttribute('title'); } }
  }
  function renderBgLabels(){
    var a = document.querySelectorAll('.lbl-bg'), b = document.querySelectorAll('.lbl-shuf'), k;
    for (k = 0; k < a.length; k++) a[k].textContent = BGL();
    for (k = 0; k < b.length; k++) b[k].textContent = SHL();
    bgTitles();
  }
  // Кнопки этих списков рисуются в разных местах (поиск, артист, плейлисты, мои файлы),
  // поэтому подсказку ставим в момент наведения — она всегда соответствует текущему режиму
  // pointerover, а не mouseover: он срабатывает раньше общего показа подсказок, и текст успевает обновиться.
  // Пишем сразу data-tip — туда подсказки переносятся из title, и старое значение иначе остаётся прежним
  document.addEventListener('pointerover', function(e){
    var b = e.target.closest && e.target.closest('button'); if (!b) return;
    var t = b.querySelector('.lbl-bg') ? BGT() : (b.querySelector('.lbl-shuf') ? SHT() : '');
    if (!t) return;
    b.setAttribute('data-tip', t); b.removeAttribute('title');
  }, true);
  // Плавный переход: текущий трек (только звук) затихает, следующий в это время набирает громкость
  var xf = { el: null, inSec: 0 };
  function hasNextTrack(){ if (isClassic()) return current + 1 < queue.length || (bgOn && bgSel.kind === 'wave') || waveCfg.on; return current + 1 < queue.length || bgOn || waveCfg.on || bgPending; }
  function killXfade(){ if (xf.el) { var e = xf.el; xf.el = null; stopEl(e); } }
  function maybeCrossfade(el){
    if (!AX.xfade || xf.el || previewT || mode !== 'audio' || el !== aud || dragging) return;
    var d = el.duration, c = el.currentTime;
    if (!isFinite(d) || d < 30 || el.paused) return;
    var len = AX.xfade, at = d - len, v = queue[current];
    if (v && typeof v.fadeOut === 'number' && d - v.fadeOut >= 1 && d - v.fadeOut <= 15) { at = v.fadeOut; len = Math.min(12, d - v.fadeOut); }
    if (c < at || c > d - 0.5 || !hasNextTrack()) return;
    startCrossfade(len);
  }
  function startCrossfade(len){
    var oldEl = aud;
    var v = queue[current];
    if (v && v.bg && bgSel.kind === 'wave' && srcOf(v) === 'ym') A.ymWaveFeedback('trackFinished', ymKey(v), oldEl.duration || 0);
    xf.el = oldEl;
    aud = (oldEl === aud2) ? $('aud') : aud2; // новый трек — во второй элемент, старый доигрывает
    stopEl(aud);
    xf.inSec = len;
    fadeEl(oldEl, oldEl._fade == null ? 1 : oldEl._fade, 0, len, function(){ if (xf.el === oldEl) { xf.el = null; stopEl(oldEl); } });
    advance(true);
  }

  // Название трека: заголовок окна, файл для OBS, подсказка в трее
  var APP_TITLE = 'Тапёр';
  var curTrack = null;
  function setNowPlaying(v){
    curTrack = v || null;
    var vd = document.querySelector('.video'); if (vd) vd.classList.toggle('has-track', !!v); // заглушка прячется, когда есть трек
    var line = v ? ((v.author ? v.author + ' — ' : '') + v.title) : '';
    document.title = line || APP_TITLE;
    if (A.nowPlaying) A.nowPlaying(v ? { artist: v.author || '', title: v.title || '', album: v.album || '', source: srcName(v) } : null);
    renderLike();
    updNpPreview();
    updateGlow(v);
    if (typeof ovFeed === 'function') setTimeout(ovFeed, 0);       // оверлей OBS (25-overlay.js) — сразу, не ждать секунды
  }
  function setPlayerBusy(b){ if (A.playerBusy) A.playerBusy(!!b); }

  // «Сцена»: правая колонка светится цветом обложки; при смене трека — плавный переход
  var glowUrl = null, glowTimer = null;
  async function updateGlow(v){
    var url = v ? (v.cover || v.thumb || '') : '';
    if (url === glowUrl) return;
    glowUrl = url;
    var g = $('qglow');
    var color = url && A.coverColor ? await A.coverColor(url).catch(function(){ return null; }) : null;
    if (glowUrl !== url) return; // уже другой трек
    clearTimeout(glowTimer);
    if (!url) {
      // Ничего не играет — сцена светится цветом выбранной темы (класс .idle берёт --acbg из темы)
      g.style.background = '';
      g.classList.add('idle');
      g.style.opacity = '1';
      return;
    }
    g.classList.remove('idle');
    g.style.opacity = '0';
    color = color || '#9B87FF';
    if (typeof vizSetColor === 'function') vizSetColor(color);
    glowTimer = setTimeout(function(){
      g.style.background = 'radial-gradient(130% 60% at 50% 0%, ' + color + '70, ' + color + '00 72%)';
      g.style.opacity = '1';
    }, 350);
  }
  updateGlow(null); // при запуске ничего не играет — сцена сразу светится в цвет темы

  allEls().concat([ytx, ymx]).forEach(function (el) {
    el.addEventListener('ended', function(){ if (el !== master()) return; playingNow = false; onTrackEnded(); });
    el.addEventListener('play', function(){
      if (AX.ctx && AX.ctx.state === 'suspended') AX.ctx.resume().catch(noop);
      if (el !== master()) return;
      playingNow = true;
      if (mode === 'iframe' || mode === 'ymweb') saveToday(); // у ytx/ymx нет своих событий сохранения
      var pv = queue[current];
      if (pv && pv._playT0 && !pv._playLogged) {
        pv._playLogged = true;
        axLog('плеер: первый звук за ' + (Date.now() - pv._playT0) + ' мс');
      }
      setPlayIcon('⏸'); setPlayerBusy(true);
      if (mode === 'split') { if (vidVisible()) video.play().catch(noop); else vidHeld = true; }
    });
    el.addEventListener('pause', function(){
      if (el !== master()) return;
      playingNow = false;
      if (mode === 'iframe' || mode === 'ymweb') saveToday();
      if (!el.ended) killXfade(); // пауза посреди перехода — старый трек тоже молчит
      setPlayIcon('▶'); setPlayerBusy(false);
      if (mode === 'split') video.pause();
    });
    el.addEventListener('playing', function(){ if (el === master()) clearMediaWatch(); });
    el.addEventListener('timeupdate', function(){
      if (el !== master()) return;
      if (el.readyState >= 2 || el.currentTime > 0) clearMediaWatch();
      var d = el.duration || 0, c = el.currentTime || 0;
      $('tcur').textContent = fmt(c);
      $('tdur').textContent = fmt(d);
      if (!dragging && d > 0) setBar(c / d);
      maybeCrossfade(el);
      if (mode === 'split' && !vidHeld) {
        // плавная подгонка видео под звук: перемотка только при сильном расхождении
        var drift = (video.currentTime || 0) - c;
        if (Math.abs(drift) > 1) { try { video.currentTime = c; } catch (e) {} video.playbackRate = 1; }
        else if (Math.abs(drift) > 0.15) { video.playbackRate = drift > 0 ? 0.95 : 1.05; }
        else if (video.playbackRate !== 1) { video.playbackRate = 1; }
      }
    });
    el.addEventListener('error', function(){
      if (el === master()) clearMediaWatch();
      // В split-режиме звук и картинка — разные элементы. Ошибка video не должна
      // оставлять «звук есть, картинки нет»: один раз уходим на iframe.
      if (el === video && mode === 'split' && el.getAttribute('src') && !previewT) {
        var vv = queue[current];
        if (vv && !vv._videoFb) {
          vv._videoFb = true;
          axLog('видео: дорожка не играет — включаю плеер YouTube');
          startMedia(vv, withFallback(vv, { error: 'видео не играет' }));
          return;
        }
      }
      if (el === master() && el.getAttribute('src')) {
        var v = queue[current];
        if (el === ytx && v && !previewT) { ytxStop(); failOver(v, 'ym', 'YouTube: ' + (YX.errText || 'не воспроизводится')); return; }
        if (el === ymx && v && !previewT) { ymxStop(); failOver(v, 'yt', 'Яндекс (сайт): ' + (YW.err || 'ошибка')); return; }
        if (v && (isUrlSrc(v) || srcOf(v) === 'lc') && !previewT) { failOver(v, ymLoggedIn ? 'ym' : 'yt', (srcOf(v) === 'lc' ? 'Файл не играет (формат?)' : srcName(v) + ': поток не играет')); return; }
        // Яндекс/YouTube: ссылку получили, но звук не пошёл (устарела после долгой паузы, не тот формат) —
        // раньше музыка молча вставала; теперь один раз идём по той же цепочке: сайт Яндекса / плеер YouTube / другая площадка
        if (v && (srcOf(v) === 'ym' || srcOf(v) === 'yt') && el !== ytx && el !== ymx && !previewT && !v._mediaFb) {
          v._mediaFb = true;
          var fb = withFallback(v, { error: 'поток не играет' });
          axLog('поток не играет: «' + (v.author || '') + ' — ' + v.title + '» (' + srcName(v) + ') — запасной путь');
          startMedia(v, fb); return;
        }
        setErr('⚠ ' + (el === ytx ? 'YouTube: ' + (YX.errText || 'не воспроизводится') : 'не удалось воспроизвести поток'));
        if (v) playFailed(v, 'поток не играет');
      }
    });
  });

  function setSub(txt){
    var a = curTrack && curTrack.author, el = $('card-sub');
    if (a && typeof txt === 'string' && txt.indexOf(a) === 0) el.innerHTML = artistLinks(a) + esc(txt.slice(a.length));
    else el.textContent = txt;
  }
  function setErr(txt){ $('card-sub').textContent = txt; $('f-sub').textContent = txt; }
  function showTrack(v){
    $('card-title').textContent = v.title;
    $('f-title').textContent = v.title;
    // Внизу: название, под ним исполнитель, под ним источник или «Фон»/«Волна»
    var fa = $('f-artist'), fs = $('f-sub');
    if (fa) { fa.innerHTML = v.author ? artistLinks(v.author) : ''; fa.hidden = !v.author; }
    if (fs) fs.innerHTML = srcDot(v) + '<span class="ss">' + esc(v.bg ? bgLabel() : srcName(v)) + '</span>';
    var fc = $('f-cover');
    if (v.thumb) { fc.src = v.thumb; fc.style.display = ''; } else { fc.style.display = 'none'; }
  }
  function fetchStream(v){ var s = srcOf(v); if (s === 'lc') return A.libStream ? A.libStream(v.id) : Promise.resolve({ error: 'нет доступа к файлам' }); return s === 'ym' ? A.ymStream(v.id) : (s === 'au' ? A.auStream(v.id) : (isUrlSrc(v) ? A.urlStream(v.id) : A.ytStream(v.id))); }
  // HLS (SoundCloud): Chromium не умеет его сам — подключаем hls.js по требованию
  var hlsLoading = null;
  function loadHls(){
    if (window.Hls) return Promise.resolve();
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise(function (res, rej){ var sc = document.createElement('script'); sc.src = 'vendor/hls.min.js'; sc.onload = res; sc.onerror = function(){ hlsLoading = null; rej(new Error('hls.js не загрузился')); }; document.head.appendChild(sc); });
    return hlsLoading;
  }
  function dropHls(el){ if (el && el._hls) { try { el._hls.destroy(); } catch (e) {} el._hls = null; } }
  function setAudioSrc(el, r){
    dropHls(el);
    if (!r.hls) { el.src = r.audioUrl; el.play().catch(noop); return; }
    loadHls().then(function(){
      if (!window.Hls || !Hls.isSupported()) { el.src = r.audioUrl; el.play().catch(noop); return; }
      var h = new Hls({ enableWorker: true, xhrSetup: function (x){ x.withCredentials = false; } });
      el._hls = h;
      h.on(Hls.Events.ERROR, function (ev, d){ if (d && d.fatal) { axLog('HLS: ' + d.type + ' ' + d.details); setTimeout(function(){ if (el._hls === h) dropHls(el); urlSrcFailed(el, 'поток не играет (' + d.details + ')'); }, 0); } });
      h.loadSource(r.audioUrl); h.attachMedia(el);
      h.on(Hls.Events.MANIFEST_PARSED, function(){ el.play().catch(noop); });
    }).catch(function (e){ axLog(e.message); urlSrcFailed(el, e.message); });
  }
  function clearMediaWatch(){ if (mediaWatch) { clearTimeout(mediaWatch); mediaWatch = null; } }
  // Не ждём media-таймаут 30–40 с: если первый байт не пришёл за 3 с,
  // сразу идём по запасной цепочке (для YouTube — встроенный плеер).
  function armMediaWatch(el){
    clearMediaWatch();
    if (!el || previewT || el !== master()) return;
    var v = queue[current];
    if (!v || srcOf(v) !== 'yt' || v._mediaFb) return;
    mediaWatch = setTimeout(function(){
      mediaWatch = null;
      if (el !== master() || previewT) return;
      if (el.readyState >= 2 || el.currentTime > 0) return;
      var vv = queue[current];
      if (!vv || vv._mediaFb) return;
      vv._mediaFb = true;
      axLog('плеер: нет первого байта за 3 с — запасной путь');
      startMedia(vv, withFallback(vv, { error: 'поток не играет (нет данных 3 с)' }));
    }, 3000);
  }
  function urlSrcFailed(el, why){
    clearMediaWatch();
    if (el !== master() || previewT) { if (previewT) setErr('⚠ ' + why); return; }
    var v = queue[current]; if (!v) return;
    failOver(v, ymLoggedIn ? 'ym' : 'yt', srcName(v) + ': ' + why);
  }
  // Вернуть место после поднятия окна сторожем (0.34.0, задание 6). Ждём метаданные:
  // до них браузер не даёт поставить currentTime. Если трек играл на паузе — ставим паузу.
  function applyPendingResume(v){
    var p = pendingResume;
    if (!p || v !== queue[current]) return;
    // «Ждёт перемотки» относится к конкретному треку: сменили трек — забываем.
    if (p.key && p.key !== srcOf(v) + ':' + v.id) { pendingResume = null; return; }
    pendingResume = null;
    var m = master();
    if (!m || typeof m.currentTime !== 'number') return; // встроенный плеер YouTube/сайт Яндекса не перематываем
    var target = Math.max(0, Number(p.pos) || 0);
    function seek(){
      try {
        if (target > 0 && (!isFinite(m.duration) || target < m.duration - 1)) m.currentTime = target;
      } catch (e) { axLog('сторож: перемотка не удалась — ' + (e && e.message ? e.message : e)); }
      if (!p.play) { try { m.pause(); } catch (e2) {} }
    }
    if (m.readyState >= 1) seek();
    else { try { m.addEventListener('loadedmetadata', seek, { once: true }); } catch (e) { seek(); } }
  }
  function startMedia(v, r){
    v._playT0 = Date.now();
    v._playLogged = false;
    // «Видео для OBS» (VO1): запоминаем адрес картинки — страница /video возьмёт его из снимка.
    if (r && r.videoUrl) v._videoUrl = r.videoUrl;
    else if (r && r.url && !r.audioUrl) v._videoUrl = r.url;
    else delete v._videoUrl;
    if (typeof voKick === 'function') voKick();
    video.removeAttribute('poster');
    if (r.alt) { failOver(v, r.alt, r.why || 'не играет'); return; }
    if (r.ymweb) {
      if (xf.el) killXfade();
      if (YX.vid) ytxStop();
      pendingResume = null; // сайт Яндекса не перематываем: место после сбоя не восстановить
      [video, aud, aud2].forEach(function (el){ el.pause(); el.removeAttribute('src'); el.load(); });
      mode = 'ymweb';
      if (v.cover || v.thumb) video.setAttribute('poster', v.cover || v.thumb);
      YW.fade = 1;
      ymxStart(v);
      return;
    }
    if (YW.on || YW.token) ymxStop();
    if (r.iframe) {
      if (xf.el) killXfade();
      pendingResume = null; // встроенный плеер YouTube не перематываем
      [video, aud, aud2].forEach(function (el){ el.pause(); el.removeAttribute('src'); el.load(); });
      mode = 'iframe';
      YX.fade = 1;
      ytxLoad(v.id).catch(function (e){ setErr('⚠ ' + e.message); axLog('YouTube (встроенный плеер): ' + e.message); playFailed(v, e.message); });
      return;
    }
    if (mode === 'iframe' || YX.vid) ytxStop();
    if (r.audioUrl && !r.videoUrl) {
      mode = 'audio'; // только звук: в окне видео — обложка
      video.pause(); video.removeAttribute('src'); video.load();
      if (v.cover || v.thumb) video.setAttribute('poster', v.cover || v.thumb);
      setAudioSrc(aud, r);
    } else if (r.audioUrl) {
      mode = 'split';
      video.muted = true; video.src = r.videoUrl;
      // Видео запускаем сразу, не ожидая события play у отдельного <audio>:
      // иначе звук уже играет, а картинка остаётся чёрной.
      video.play().catch(noop);
      aud.src = r.audioUrl;
      aud.play().catch(noop);
    } else {
      mode = 'single';
      aud.pause(); aud.removeAttribute('src'); aud.load();
      // видео с компьютера (и mp4/webm без картинки): до первого кадра — обложка или значок с расширением
      if (srcOf(v) === 'lc' && (v.cover || v.thumb)) video.setAttribute('poster', v.cover || v.thumb);
      video.muted = false; video.src = r.url;
      video.play().catch(noop);
    }
    var m = master();
    if (srcOf(v) === 'yt' && (mode === 'split' || mode === 'audio')) armMediaWatch(aud);
    axTrackStart(m, v);
    if (xf.inSec && xf.el && !previewT) { fadeEl(m, 0, 1, xf.inSec); } // вход плавного перехода
    else { if (xf.el) killXfade(); setFade(m, 1); }
    xf.inSec = 0;
    applyVol();
    applyPendingResume(v);
  }
  // Энергосбережение: YouTube «видео + звук» (mode 'split') — если окна видео не видно (свёрнуто, в трее,
  // вкладка «Настройки»), картинка на паузе, звук играет. Вернулось — догоняет звук (подгонка в timeupdate).
  var vidHeld = false;
  function vidVisible(){ return !document.hidden && !$('main').classList.contains('no-queue'); }
  function vidSync(){
    if (mode !== 'split') { vidHeld = false; return; }
    if (!vidVisible()) { if (!video.paused) { vidHeld = true; video.pause(); } return; }
    if (vidHeld) { vidHeld = false; if (!aud.paused) { try { video.currentTime = aud.currentTime; } catch (e) {} video.play().catch(noop); } }
  }
  document.addEventListener('visibilitychange', vidSync);
  function isIdle(){ var m = master(); return loadingIdx < 0 && (!m.getAttribute('src') || m.ended); }

  async function playIndex(i) {
    if (i < 0 || i >= queue.length) return;
    var prevItem = queue[current];
    if (prevItem && prevItem !== queue[i] && prevItem.bg && bgSel.kind === 'wave' && srcOf(prevItem) === 'ym' && !prevItem.altFrom && !isIdle()) {
      var m = master();
      if (m.currentTime > 0 && m.duration && m.currentTime < m.duration - 2) { A.ymWaveFeedback('skip', ymKey(prevItem), m.currentTime); trimWaveTail(); }
    }
    previewT = null;
    if (typeof markSave === 'function') markSave(true); // уходим с книги — место запоминается сразу
    current = i; var v = queue[i];
    // Смена трека: «место после сбоя» относится к прежнему треку — забываем его.
    if (pendingResume && pendingResume.key !== srcOf(v) + ':' + v.id) pendingResume = null;
    playingNow = false; // новый трек ещё не заиграл
    v.played = true; delete v._mediaFb; // запасной путь при сбое звука — заново для каждого запуска
    botNotify(v, 'played');
    rqSync(); // заказ заиграл — сразу переносим его в «выполненные», когда доиграет
    // в сыгранном — без повторов: та же песня раньше в ленте убирается, остаётся последняя
    var vk = srcOf(v) + ':' + v.id;
    if (!isClassic() && !spKeyOf(v)) for (var dk = current - 1; dk >= 0; dk--) { var dq = queue[dk]; if (dq && dq.played && !spKeyOf(dq) && srcOf(dq) + ':' + dq.id === vk) { queue.splice(dk, 1); current--; } }
    i = current;
    for (var pk = 0; pk < current; pk++) if (queue[pk]) queue[pk].played = true;
    if (v.bg) bgOn = true;
    if (typeof histPush === 'function') histPush(v);
    loadingIdx = i;
    playingId = v.id; markPlayingRows();
    setNowPlaying(v); showTrack(v);
    spFoldOthers(v); // играет не книга (или другая книга) — раскрытые книги сворачиваются
    renderQueue(true); renderWaveUi(); saveToday();
    if (v.bg) topUpWave(); // в классике это заодно дописывает волну в конец плейлиста
    setSub('Загружаю…');
    var r = await getStream(v);
    if (i !== current) return; // переключили, пока грузилось
    loadingIdx = -1;
    if (!r || (r.error && !r.alt)) {
      ymLoginNotice(v, (r && r.error) || '');
      setErr('⚠ ' + ((r && r.error) ? r.error : 'поток не получен'));
      playFailed(v, (r && r.error) || 'поток не получен');
      return;
    }
    startMedia(v, r);
    if (r.alt || r.ymweb) return;
    setSub(v.author + (r.preview ? (ymLoggedIn ? ' · отрывок 30 с (нужен Плюс)' : ' · отрывок 30 с — войди в Яндекс, чтобы слушать целиком') : '') + (v.altFrom ? ' · замена: в ' + (v.altFrom === 'Яндекс' ? 'Яндексе' : v.altFrom) + ' не играл' : '') + (r.iframe ? ' · плеер YouTube' : ''));
    if (v.bg && bgSel.kind === 'wave' && srcOf(v) === 'ym') A.ymWaveFeedback('trackStarted', ymKey(v));
    prefetchNext();
  }

  // Заранее достать поток следующего трека, чтобы переход был без паузы
  function prefetchNext(){
    if (!prefOn) return;
    var n = queue[current + 1] || waveBuf[0];
    if (n) fetchStream(n).catch(noop);
  }

  function copyTrack(v){ var o = {}; for (var k in v) if (k !== 'played' && k !== 'bg' && k !== 'fromList') o[k] = v[k]; return o; }
  // Заказ встаёт в конец; если ничего не играет или играет фон — фон доигрывает трек, потом заказ
  function addToQueue(v){ if (spKeyOf(v)) { spPackBook(v, 'end'); return; } addMany([v]); }
  function addMany(list, fromList){
    var first = queue.length;
    list.forEach(function (v){ var c = copyTrack(v); if (fromList) c.fromList = true; queue.push(c); });
    renderQueue(); saveToday();
    axLog('очередь: в конец ' + list.length + ' (' + (list[0] ? '«' + list[0].title + '»' : '—') + '), всего ' + queue.length + (spKeyOf(queue[current]) ? ', играет книга' : ''));
    if (!list.length) return;
    if (isIdle() && !(queue[current] && queue[current].bg && !isIdle())) playIndex(firstPending(first));
    else prefetchNext();
  }
  // «Играть следующим»: сразу после текущего трека (фон доигрывает свой трек, потом этот)
  function addNext(v){
    if (spKeyOf(v)) { spPackBook(v, 'next'); return; } // глава — встаёт вся книга
    var at = v.req ? afterCur() : reqInsertAt('next');
    queue.splice(at, 0, copyTrack(v));
    axLog('очередь: «' + v.title + '» следующим, место ' + at + ' из ' + queue.length);
    renderQueue(); saveToday();
    if (isIdle() && !(queue[current] && queue[current].bg && !isIdle())) playIndex(at);
    else { setSub('«' + v.title + '» — следующим'); prefetchNext(); }
  }
  // ===== Ярусы заказов и «слипшаяся группа» (docs/BOT.md, раздел «Очередь») =====
  // Вид заказа: don — донат, pts — баллы канала Twitch, cmd — команда в чате («Твич»).
  // Ярусы — настройка reqTiers: default [донаты + баллы] → команда; money донаты → баллы → команда; equal — все равны.
  // Группа — ждущие заказы под играющим (не «вырванные»). Обычный трек внутри группу не рвёт.
  // Вырванный перетаскиванием заказ (req.free) теряет приоритет, но остаётся заказом; вернули в группу — приоритет вернулся.
  var REQ_TIERS = 'default';
  var REQ_TIER_TABLE = { default: { don: 1, pts: 1, cmd: 2 }, money: { don: 1, pts: 2, cmd: 3 }, equal: { don: 1, pts: 1, cmd: 1 } };
  // Заказ Streamer.bot (0.35): ключи sb-cmd / sb-points — те же ярусы, что у бота пака.
  function reqKind(v){ var k = (v && v.req && v.req.key) || ''; return k.indexOf('twitch-cmd:') === 0 || k.indexOf('sb-cmd:') === 0 ? 'cmd' : k.indexOf('twitch-points:') === 0 || k.indexOf('sb-points:') === 0 ? 'pts' : 'don'; }
  function reqTierOf(kind){ var t = REQ_TIER_TABLE[REQ_TIERS] || REQ_TIER_TABLE.default; return t[kind] || 1; }
  function reqMember(v){ return !!(v && v.req && !v.played && !v.req.free); }
  function reqGroupEnd(skip){ var s0 = afterCur(), last = s0 - 1; for (var k = s0; k < queue.length; k++) if (queue[k] !== skip && reqMember(queue[k])) last = k; return last; }
  // Куда встаёт заказ вида kind: перед первым заказом группы с ярусом ниже, иначе — в конец группы.
  // kind 'next' — обычный трек «Играть следующим»: после первого яруса. Без kind — в конец группы.
  function reqInsertAt(kind){
    var s0 = afterCur(), end = reqGroupEnd();
    var t = kind === 'next' ? 1.5 : kind ? reqTierOf(kind) : Infinity;
    for (var k = s0; k <= end; k++) if (reqMember(queue[k]) && reqTierOf(reqKind(queue[k])) > t) return k;
    return Math.max(s0, end + 1);
  }
  function isBotReq(v){ return !!(v && v.req && /^(?:twitch|sb)-/.test(v.req.key || '')); }
  function isSbReq(v){ return !!(v && v.req && /^sb-/.test(v.req.key || '')); }
  // Сообщить про заказ: заиграл / не прозвучал / ⛔. У заказа пака — мост A.botOrder,
  // у заказа Streamer.bot (0.35) — свой A.sbotOrder (в главном процессе это sbotEvents).
  function botOrderSend(v, type, extra){
    if (isSbReq(v)) { if (typeof A !== 'undefined' && A.sbotOrder) A.sbotOrder(type, v.req.key, extra); }
    else if (typeof A !== 'undefined' && A.botOrder) A.botOrder(type, v.req.key, extra);
  }
  // Один раз на заказ.
  function botNotify(v, type, extra){ if (!isBotReq(v) || v.req.botDone) return; v.req.botDone = true; botOrderSend(v, type, extra); }
  // ⛔ для текущего трека: order уже помечен botDone событием played, прямой ban всё равно нужен.
  function botBan(v, min){ if (!isBotReq(v)) return false; v.req.botDone = true; botOrderSend(v, 'ban', min); return true; }
  // ===== Снимок очереди для Streamer.bot (0.35, Э1) =====
  // Порт /sb/* живёт в главном процессе и не видит очередь окна. Поэтому окно присылает
  // компактный снимок: заказы sb-* (ключи, порядок, длительность), что играет и ближайшие треки.
  // По нему считаются место/время (place/etaMin) и лимиты perUser/chatCap. Ники в снимке — только
  // в памяти процесса; в журнал/отчёт они не попадают.
  var sbotSentSig = '', sbotSentAt = 0;
  function sbotSnapshot(){
    var items = [], playing = '', now = queue[current], k, v;
    for (k = 0; k < queue.length; k++) {
      v = queue[k];
      if (!v || !v.req || !/^sb-/.test(String(v.req.key || ''))) continue;
      if (k === current) { playing = v.req.key; continue; }
      if (k > current && !v.played) items.push({ key: v.req.key, seconds: v.seconds || 0, artist: v.author || '', title: v.title || '' });
    }
    var m = (typeof master === 'function') ? master() : null;
    var curLeft = 0;
    if (m && m.duration && isFinite(m.duration) && !m.paused) curLeft = Math.max(0, Math.round(m.duration - (m.currentTime || 0)));
    else if (now && now.seconds) curLeft = Math.round(now.seconds);
    var next = [];
    for (var j = current + 1; j < queue.length && next.length < 5; j++) {
      var nv = queue[j];
      if (!nv || nv.played) continue;
      next.push({ artist: nv.author || '', title: nv.title || '', seconds: nv.seconds || 0 });
    }
    return {
      keys: items.map(function (x){ return x.key; }),
      playing: playing,
      items: items,
      now: now ? {
        orderId: playing,
        track: (now.author ? now.author + ' — ' : '') + (now.title || ''),
        artist: now.author || '', title: now.title || '',
        who: (now.req && now.req.who) || '', seconds: now.seconds || 0
      } : null,
      curLeft: curLeft,
      next: next
    };
  }
  function sbotPush(){
    if (typeof A === 'undefined' || !A.sbotQueue) return;
    var snap;
    try { snap = sbotSnapshot(); } catch (e) { return; }
    var sig = JSON.stringify([snap.keys, snap.playing, snap.now && snap.now.orderId, snap.now && snap.now.title, snap.next]);
    var t = Date.now();
    // Каждые 5 секунд освежаем «сколько осталось у играющего» — по нему считается время до заказа.
    if (sig === sbotSentSig && t - sbotSentAt < 5000) return;
    sbotSentSig = sig; sbotSentAt = t;
    try { A.sbotQueue(snap); } catch (e) {}
  }
  // Ярусы заказов: сохранённое значение применяем при запуске окна, а не только по клику (0.35).
  if (typeof A !== 'undefined' && A.getSetting) Promise.resolve(A.getSetting('reqTiers')).then(function (v){ if (v === 'default' || v === 'money' || v === 'equal') REQ_TIERS = v; }).catch(function () {});
  function addReq(v){
    var at = reqInsertAt(reqKind(v));
    var item = copyTrack(v);
    queue.splice(at, 0, item);
    renderQueue(); saveToday();
    if (isIdle() && !(queue[current] && queue[current].bg && !isIdle())) playIndex(at);
    else { setSub('Заказ «' + v.title + '» — ' + (at === afterCur() ? 'следующим' : 'после других заказов')); prefetchNext(); }
    return item; // по нему окно считает место и время для ответа в чат
  }
  function firstPending(from){ for (var k = Math.max(0, current + 1); k < queue.length; k++) if (!queue[k].played) return k; return from; }
  function playNow(v){
    if (spKeyOf(v)) { spPackBook(v, 'now'); return; } // глава — играет вся книга, с этой главы
    var at = afterCur(); // играет книга — новый трек встаёт за ней целиком, книга становится отыгравшей
    var item = copyTrack(v);
    queue.splice(at, 0, item);
    playIndex(at);
    return item;
  }

  // Вперёд: следующий в ленте; если его нет — фон
  function advance(auto){
    if (isClassic()) { classicAdvance(auto); return; }
    var nx = queue[current + 1];
    if (spOrderAfterChapter()) return; // глава кончилась, а за книгой ждёт заказ — заказ сейчас
    if (bgPending && !(nx && !nx.played && !nx.fromList && !nx.bg)) { startBg(); return; }
    if (current + 1 < queue.length) { playIndex(current + 1); return; }
    if (bgOn || waveCfg.on || bgPending) playBgNext();
    else if (!auto) { /* дальше ничего нет */ }
    else { setNowPlaying(null); setPlayerBusy(false); }
  }
  // Классика: просто следующая строка. Кончился плейлист: волна-плейлист бесконечна,
  // иначе при включённой «волне после заказов» волна заменяет плейлист, иначе — тишина
  function classicAdvance(auto){
    if (current + 1 < queue.length) { playIndex(current + 1); return; }
    if (bgOn && bgSel.kind === 'wave') { if (waveBuf.length) { classicDrain(true); if (current + 1 < queue.length) { playIndex(current + 1); return; } } playBgNext(); return; }
    if (waveCfg.on) { if (bgSel.kind === 'wave') startBg(); else setBg(lastWave, true); return; }
    if (auto) { setNowPlaying(null); setPlayerBusy(false); }
  }
  // «Дальше» и «Назад» видят книгу как один трек: внутри неё по главам не ходят
  function next(){
    var b = current >= 0 ? spBlockOf(current) : null;
    if (!b) { advance(false); return; }
    var end = b.s + b.n;
    axLog('книга: «Дальше» — через всю книгу');
    if (end < queue.length) { playIndex(end); return; } // книга выше играющего — отыграла, место запомнено
    if (bgOn || waveCfg.on || bgPending) playBgNext();
  }
  function prev(){
    var m = master();
    // позже 3 секунд — с начала: у книги это начало текущей главы
    if (m.getAttribute('src') && (m.currentTime || 0) > 3) { m.currentTime = 0; if (mode === 'split') { try { video.currentTime = 0; } catch (e) {} } return; }
    var b = current >= 0 ? spBlockOf(current) : null;
    var to = b ? b.s - 1 : current - 1;   // из книги — к треку перед ней
    if (to < 0) { if (m.getAttribute('src')) m.currentTime = 0; return; }
    var pb = spBlockOf(to);
    if (pb) { spPlayInPlace(pb); return; } // перед нами книга — она играет на своём месте, с запомненного места
    playIndex(to);
  }
  $('next').onclick = next;
  $('prev').onclick = prev;
  $('playpause').onclick = function(){
    var m = master();
    if (!m.getAttribute('src')) {
      // После сбоя трек был на паузе: владелец нажал «Играть» сам — грузим выбранный
      // трек и перематываем на сохранённое место (play=true, чтобы seek не поставил паузу).
      if (pendingResume && current >= 0 && queue[current]) {
        pendingResume.play = true;
        pendingResume.key = srcOf(queue[current]) + ':' + queue[current].id;
        playIndex(current);
        return;
      }
      var np = -1;
      for (var k = Math.max(0, current + 1); k < queue.length; k++) if (!queue[k].played) { np = k; break; }
      if (np >= 0) playIndex(np); else if (current >= 0 && queue[current]) playIndex(current); else if (bgSel) startBg();
      return;
    }
    if (m.paused) m.play().catch(noop); else m.pause();
  };
  function onTrackEnded(){
    if (previewT) { // прослушивание кончилось — тишина, очередь не трогаем; «Играть» продолжит очередь
      previewT = null;
      allEls().forEach(stopEl); ytxStop(); ymxStop(); xf.el = null;
      video.removeAttribute('poster'); mode = 'single';
      updPreviewBtns(); setNowPlaying(null); setPlayerBusy(false); setSub('Прослушивание закончилось');
      return;
    }
    // Книги/подкасты: отметить последнюю главу/выпуск до advance(), пока current ещё старый.
    try { if (typeof spTrackEndedHook === 'function') spTrackEndedHook(queue[current]); }
    catch (e) { axLog('книга: не удалось сохранить позицию — ' + (e && e.message || e)); }
    var v = queue[current];
    if (v) v.finished = true; // отметка «доиграл до конца» — по ней заказ уходит в «выполненные»
    if (v && v.bg && bgSel.kind === 'wave' && srcOf(v) === 'ym') A.ymWaveFeedback('trackFinished', ymKey(v), aud.duration || 0);
    advance(true);
    rqSync(); // трек доиграл — обновляем «выполненные заказы»
  }
  function stopVideo(){
    xf.el = null; xf.inSec = 0;
    allEls().forEach(stopEl); ytxStop(); ymxStop();
    video.removeAttribute('poster');
    mode = 'single'; loadingIdx = -1; previewT = null;
    playingNow = false;
    bgOn = false; bgPending = false;
    setNowPlaying(null); setPlayerBusy(false);
    playingId = null; markPlayingRows();
    $('card-title').textContent = 'Ничего не играет';
    $('card-sub').textContent = 'Найди трек и запусти';
    $('f-title').textContent = 'Ничего не играет';
    var fa = $('f-artist'); if (fa) { fa.hidden = true; fa.innerHTML = ''; }
    $('f-sub').textContent = 'Найди трек и нажми play';
    $('f-cover').style.display = 'none';
    setBar(0); $('tcur').textContent = '0:00'; $('tdur').textContent = '0:00';
    renderQueue(); renderWaveUi();
  }
  // «Сохранить плейлист»: всё, что сейчас в очереди (в том же порядке), становится плейлистом Тапёра.
  // Названия не спрашиваем — ставим дату и время, переименовать можно прямо из сообщения
  $('saveq').onclick = function(){
    var tracks = queue.filter(function (v){ return v && v.id; });
    if (!tracks.length) { toast('В очереди пусто — нечего сохранять'); return; }
    var d = new Date(), two = function (n){ return (n < 10 ? '0' : '') + n; };
    var name = (isClassic() ? 'Плейлист ' : 'Очередь ') + two(d.getDate()) + '.' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
    var m = localCreate(name, tracks);
    toast('Сохранён плейлист «' + m.title + '» · ' + m.tracks.length + ' ' + plural(m.tracks.length), 'Переименовать', function(){ localRename(m); });
  };
  // «Очистить»: в живой очереди убираем только то, что ещё не играло (сыгранное и играющий остаются);
  // в классике плейлист очищается целиком — вместе с играющим треком и зелёными заказами
  $('clearq').onclick = async function(){
    if (isClassic()) {
      if (queue.length && current >= 0) {
        var ok = await askDlg({ title: 'Очистить плейлист?', text: 'Удалятся все треки, включая играющий' + (stOn() ? ' и зелёные заказы' : '') + ' — музыка остановится. Отыгранное останется во вкладке «История».', ok: 'Очистить' });
        if (!ok) return;
      }
      queue.forEach(function (v){ if (v && !v.played) botNotify(v, 'dropped', 'removed'); });
      queue = []; current = -1;
      stopVideo(); // сам перерисует очередь
      saveToday(); return;
    }
    // Книга — один трек: если она играет, остаётся целиком, а не обрубается на текущей главе
    var keep = [], newCur = -1, curKey = spKeyOf(queue[current]), removed = [];
    queue.forEach(function (v, i){
      if (!(v.played || i === current || (curKey && spKeyOf(v) === curKey))) { if (v) removed.push(v); return; }
      if (i === current) newCur = keep.length;
      keep.push(v);
    });
    removed.forEach(function (v){ botNotify(v, 'dropped', 'removed'); });
    var gone = queue.length - keep.length;
    queue = keep; current = newCur;
    renderQueue(); saveToday();
    axLog('очередь: очищена, убрано ' + gone + ', осталось ' + queue.length);
  };

  function removeAt(i) {
    var rb = spBlockOf(i); if (rb) { spRemoveBook(rb.s, rb.n); return; } // книга убирается только целиком
    var wasCur = i === current;
    if (queue[i] && !queue[i].played) botNotify(queue[i], 'dropped', 'removed');
    queue.splice(i, 1);
    if (i < current) current--;
    else if (wasCur) {
      if (current < queue.length) playIndex(current);
      else { current = queue.length - 1; stopVideo(); }
    }
    renderQueue(); saveToday();
  }

  var lastScrolled = -2, lastScrolledKey = '';
  var botLeftSent = -1;
  function renderQueue(scroll) {
    if (A.botQueue) {
      var bl = 0, bkeys = [];
      for (var bk = 0; bk < queue.length; bk++) {
        if (queue[bk] && bk > current && !queue[bk].played) bl++;
        if (queue[bk] && queue[bk].req && /^twitch-/.test(queue[bk].req.key || '')) bkeys.push(queue[bk].req.key);
      }
      var bsig = bl + '|' + bkeys.join(',');
      if (bsig !== botLeftSent) { botLeftSent = bsig; A.botQueue(bl, bkeys); }
    }
    sbotPush(); // снимок для порта /sb/* — до раннего выхода «очередь пуста»
    var box = $('queue');
    var pending = 0, played = 0;
    queue.forEach(function (v, i){ if (i > current && !v.played) pending++; else if (v.played && i !== current) played++; });
    // Заголовок занят переключателем режима — счётчик короткий, полная фраза во всплывающей подсказке
    var qc = $('qcount');
    if (isClassic()) { qc.textContent = current >= 0 && queue.length ? (current + 1) + '/' + queue.length : String(queue.length); qc.title = current >= 0 && queue.length ? 'Играет ' + (current + 1) + '-й из ' + queue.length : queue.length + ' ' + plural(queue.length) + ' в плейлисте'; }
    else { qc.textContent = String(pending); qc.title = pending + ' в очереди' + (played ? ' · ' + played + ' сыграно' : ''); }
    box.classList.toggle('classic', isClassic());
    // Подпись кнопки очистки зависит от режима: в классике она убирает весь плейлист
    var cq = $('clearq');
    if (cq) {
      cq.textContent = isClassic() ? 'Очистить плейлист' : 'Очистить очередь';
      cq.title = isClassic() ? ('Убрать все треки, включая играющий' + (stOn() ? ' и заказы' : '') + ' — плейлист станет пустым') : 'Убрать из очереди всё, что ещё не играло';
    }
    if (!queue.length && !bgPreview().length) { box.innerHTML = '<div class="muted">Пусто. Добавляй треки из поиска.</div>'; return; }
    box.innerHTML = '';
    var bwrap = null;
    queue.forEach(function (v, i) {
      // Книга — один монолитный блок: общая рамка, внутри шапка и (если развернули) главы
      var wid = spKeyOf(v);
      if (!wid) bwrap = null;
      if (wid) {
        var runN = spRunAt(i);
        if (runN) { bwrap = spBookWrap(i, runN); box.appendChild(bwrap); }
        if (!spBookOpened(wid)) return;
      }
      var isCur = i === current;
      var r = document.createElement('div');
      // Внутри книги всегда действуют правила классического плейлиста: главы не бледнеют
      // и не считаются «уехавшими», даже когда очередь живая
      var cls = isClassic() || !!wid;
      var pend = cls ? i > current : i > current && !v.played;
      r.className = 'qrow' + (isCur ? ' playing' : '') + (v.played && !isCur && !cls ? ' done' : '') + (pend ? ' pend' : '') + (v.req ? ' req' + (reqKind(v) === 'cmd' ? ' req-cmd' : reqKind(v) === 'pts' ? ' req-pts' : '') : '');
      r.dataset.i = i; r._q = v;
      r.draggable = true;
      r.title = isClassic() ? (isCur ? 'Играет' : 'Нажми — заиграет; перетащи — поменяй порядок') : isCur ? 'Играет — можно перетащить' : (pend ? 'Перетащи, чтобы поменять порядок; выше играющего — убрать из очереди' : 'Сыграно — можно вернуть в очередь перетаскиванием вниз');
      r.innerHTML =
        '<div class="qcov" title="' + (isCur ? 'Играет' : 'Играть') + '">' + (v.thumb ? '<img src="' + esc(v.thumb) + '" alt="" loading="lazy">' : '') +
          '<span class="qov">' +
            '<svg class="pl" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>' +
            '<svg class="ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"></path></svg>' +
            '<svg class="eq" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="10" width="3.5" height="10" rx="1"></rect><rect x="10.25" y="4" width="3.5" height="16" rx="1"></rect><rect x="16.5" y="8" width="3.5" height="12" rx="1"></rect></svg>' +
          '</span></div>' +
        '<div class="qm"><div class="qt">' + esc(v.title) + '</div>' +
        subLine(v, srcName(v) + (v.bg ? ' · фон' : '') + (v.req ? (isSbReq(v) ? ' · Streamer.bot ' : (reqKind(v) === 'cmd' ? ' · Twitch ' : reqKind(v) === 'pts' ? ' · баллы ' : ' · ₽ ')) + v.req.who : '')).replace('class="s sub"', 'class="qs sub"') + '</div>';
      // Кнопки и длина трека — одним блоком в конце строки
      var acts = document.createElement('div'); acts.className = 'qact';
      var x = document.createElement('button'); x.className = 'x'; x.title = 'Убрать'; x.setAttribute('aria-label', 'Убрать');
      x.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
      x.onclick = function(){ removeAt(i); };
      var nxAt = v.req ? afterCur() : reqInsertAt('next');
      if (pend && i !== afterCur() && !(i < nxAt && !v.req)) {
        var nb = document.createElement('button'); nb.className = 'x nx'; nb.title = 'Играть следующим'; nb.setAttribute('aria-label', 'Играть следующим');
        nb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14M12 20V9M7 13l5-5 5 5"></path></svg>';
        nb.onclick = function(){ moveItem(i, v.req ? afterCur() : reqInsertAt('next')); };
        acts.appendChild(nb); // встаёт после «трёх точек» — см. ниже
      }
      var mb = document.createElement('button'); mb.className = 'x qmore'; mb.title = 'Ещё'; mb.setAttribute('aria-label', 'Ещё действия'); mb.setAttribute('aria-haspopup', 'menu');
      mb.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"></circle><circle cx="12" cy="12" r="1.9"></circle><circle cx="19" cy="12" r="1.9"></circle></svg>';
      mb.onmousedown = function(e){ e.stopPropagation(); mb._skip = !!ctxEl; if (ctxEl) closeCtx(); };
      mb.onclick = function(e){
        e.stopPropagation(); if (mb._skip) { mb._skip = false; return; }
        var rc = mb.getBoundingClientRect();
        openQueueMenu({ preventDefault: noop, clientX: rc.right, clientY: rc.bottom + 4 }, i);
        if (ctxEl) ctxEl.style.left = Math.max(8, rc.right - ctxEl.offsetWidth) + 'px';
      };
      acts.insertBefore(mb, acts.firstChild);
      acts.appendChild(x);
      var tm = document.createElement('span'); tm.className = 'qtime mono'; tm.textContent = v.duration || '';
      acts.appendChild(tm);
      r.appendChild(acts);
      r.querySelector('.qt').onclick = function(){ playQueueItem(i); };
      r.querySelector('.qcov').onclick = function(){ if (i !== current) playQueueItem(i); };
      r.oncontextmenu = function(e){ openQueueMenu(e, i); };
      if (wid) {
        r.classList.add('inbook'); r.draggable = false;
        r.title = 'Глава книги — внутри блока порядок не меняется';
      }
      ((wid && bwrap) ? bwrap : box).appendChild(r);
    });
    if (!isClassic()) renderBgPreview(box); // в классике волна — обычные строки плейлиста
    // В живой очереди играющий трек — наверху списка (сыгранные уезжают вверх).
    // В классике это не нужно: выбранный трек остаётся на своём месте, список не прыгает.
    var curKey = spKeyOf(queue[current]);
    // Переключение главы внутри играющей книги — правила классики: список не листается
    if (!isClassic() && curKey && curKey === lastScrolledKey) lastScrolled = current;
    else if (!isClassic() && (scroll || lastScrolled !== current)) {
      lastScrolled = current; lastScrolledKey = curKey;
      var cur = curKey ? null : box.querySelector('.qrow.playing');
      // играет книга — ведём к её блоку целиком
      if (curKey) {
        var ws = box.querySelectorAll('.qbwrap');
        for (var hi = 0; hi < ws.length; hi++) {
          var s0 = parseInt(ws[hi].dataset.i, 10), l0 = parseInt(ws[hi].dataset.len, 10);
          if (current >= s0 && current < s0 + l0) { cur = ws[hi]; break; }
        }
      }
      if (cur) {
        var prevRow = cur.previousElementSibling;
        box.scrollTop = Math.max(0, (prevRow ? prevRow.offsetTop : cur.offsetTop) - 4);
      } else box.scrollTop = box.scrollHeight;
    }
    // перелёт: строка начинает со старого места и быстро скользит на новое
    if (queueAnim && scroll) {
      var qa = queueAnim; queueAnim = null;
      var row = Array.prototype.find.call(box.querySelectorAll('.qrow'), function (x){ return x._q === qa.obj; });
      if (row) {
        var dy = qa.top - row.getBoundingClientRect().top;
        if (Math.abs(dy) > 2) {
          row.style.transition = 'none'; row.style.transform = 'translateY(' + dy + 'px)'; row.style.position = 'relative'; row.style.zIndex = '3';
          void row.offsetHeight;
          row.style.transition = 'transform .32s cubic-bezier(.2,.75,.25,1)'; row.style.transform = '';
          setTimeout(function(){ row.style.zIndex = ''; row.style.transition = ''; }, 360);
        }
      }
    }
  }

  // Переставить несыгранную песню: to — место вставки (индекс до удаления); выше играющего не ставим
  function moveItem(from, to){
    if (from < 0 || from >= queue.length) return;
    // Глава книги сама по себе не ездит — едет вся книга; и ничто не встаёт внутрь книги
    var mb = spBlockOf(from); if (mb) { spMoveBook(mb.s, mb.n, spSnapDrop(to)); return; }
    to = spSnapDrop(to);
    var curObj = queue[current];
    // перетаскивание выше играющей — это способ убрать трек из очереди: он становится сыгранным (бледным)
    if (to === from || to === from + 1) return;
    var item = queue.splice(from, 1)[0];
    if (from < to) to--;
    queue.splice(to, 0, item);
    // играющий трек находим по объекту: он мог сдвинуться
    current = curObj ? queue.indexOf(curObj) : -1;
    // инвариант: всё выше играющего — отыгравшее, всё ниже — активная очередь
    if (!isClassic()) queue.forEach(function (v, idx){ v.played = idx <= current; });
    // заказ: в группе — с приоритетом, вырван из группы — без (но остаётся заказом); поднят выше играющего — убран
    if (item && item.req) {
      if (item.played && item !== queue[current]) botNotify(item, 'dropped', 'removed');
      else if (!item.played) { var gi = queue.indexOf(item), gs = afterCur(), ge = reqGroupEnd(item); if (gi >= gs && gi <= ge + 1) delete item.req.free; else item.req.free = true; }
    }
    renderQueue(); saveToday(); prefetchNext();
  }
  // «Играть сейчас»: несыгранная — сразу после текущей и включаем; сыгранная — копия следующей (история не откатывается)
  var queueAnim = null; // { obj, top } — строка «перелетает» на новое место
  function rowTop(obj){ var rows = $('queue').querySelectorAll('.qrow'); for (var k = 0; k < rows.length; k++) if (rows[k]._q === obj) return rows[k].getBoundingClientRect().top; return null; }
  function playQueueItem(i){
    var v = queue[i]; if (!v) return;
    if (spKeyOf(v)) { spActivate(i, 0); return; } // глава книги — книга включается целиком
    if (isClassic()) { playIndex(i); return; }
    var t0 = rowTop(v);
    if (i === current) { playIndex(i); return; }
    var to = afterCur();
    if (i > current && !v.played) {
      if (t0 != null) queueAnim = { obj: v, top: t0 };
      moveItem(i, to); playIndex(queue.indexOf(v)); return;
    }
    var cp = copyTrack(v); if (t0 != null) queueAnim = { obj: cp, top: t0 };
    queue.splice(to, 0, cp); playIndex(to);
  }
  // ===== Переключатель режима очереди =====
  function renderQueueMode(){
    var c = isClassic();
    $('qModeTg').classList.toggle('on', !c); $('qModeTg').setAttribute('aria-pressed', c ? 'false' : 'true'); // кружок у выбранного режима: слева «Классический плейлист», справа «Живая очередь»
    var ls = document.querySelectorAll('#qMode .qm-l');
    for (var k = 0; k < ls.length; k++) ls[k].classList.toggle('on', ls[k].dataset.qm === qMode);
    renderBgLabels();
  }
  function setQueueMode(m){
    if (m !== 'classic') m = 'live';
    if (m === qMode) return;
    qMode = m;
    if (m === 'classic') {
      // всё, что было «дальше в волне» / фоном, становится строками плейлиста
      waveBuf.forEach(function (t){ var c = copyTrack(t); c.bg = true; queue.push(c); });
      waveBuf = [];
    } else {
      // назад в живую: всё под играющим — активная очередь
      queue.forEach(function (v, i){ v.played = i <= current; });
    }
    if (A.setSetting) A.setSetting('queueMode', m);
    renderQueueMode(); renderQueue(true); saveToday(); prefetchNext();
  }
  $('qMode').onclick = function(e){
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'qModeTg') setQueueMode(isClassic() ? 'live' : 'classic');
    else if (b.dataset.qm) setQueueMode(b.dataset.qm);
  };
  if (A.getSetting) A.getSetting('queueMode').then(function (m){ qMode = m === 'live' ? 'live' : 'classic'; renderQueueMode(); renderQueue(); });
  renderQueueMode();

  function trackUrl(v){
    if (srcOf(v) === 'lc') return '';
    if (srcOf(v) === 'ym') return 'https://music.yandex.ru/' + (v.albumId ? 'album/' + v.albumId + '/' : '') + 'track/' + v.id;
    if (srcOf(v) === 'au') return v.link || 'https://audius.co/';
    if (isUrlSrc(v)) return v.id;
    return 'https://www.youtube.com/watch?v=' + v.id;
  }
  function copyText(t){
    function fb(){ var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fb); else fb();
  }

  // Меню по правой кнопке
  var ctxEl = null;
  function closeCtx(){ if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
  // Значки в конце пунктов меню — по смыслу пункта
  var CI = function (d, fill){ return '<svg width="15" height="15" viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') + '" stroke="' + (fill ? 'none' : 'currentColor') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  var CTX_ICONS = [
    [/^Играть сейчас|^Начать сначала/, CI('<path d="M7 5v14l12-7z"></path>', true)],
    [/^Волна по/, CI('<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"></path>')],
    [/^Играть следующим/, CI('<path d="M5 4h14M12 20V9M7 13l5-5 5 5"></path>')],
    [/^Сыграть ещё раз/, CI('<path d="M17 2l4 4-4 4"></path><path d="M3 11v-1a4 4 0 014-4h14M7 22l-4-4 4-4"></path><path d="M21 13v1a4 4 0 01-4 4H3"></path>')],
    [/^В конец очереди|^Все версии/, CI('<path d="M3 6h13M3 12h13M3 18h8M18 14v6M15 17h6"></path>')],
    [/^В плейлист|^＋ Новый плейлист|^Сохранить всю ленту/, CI('<path d="M9 18V5l10-2v7"></path><circle cx="6" cy="18" r="3"></circle><path d="M18 14v7M14.5 17.5h7"></path>')],
    [/^Другие версии/, CI('<path d="M12 3l9 5-9 5-9-5 9-5z"></path><path d="M3 13l9 5 9-5"></path>')],
    [/^В «Мне нравится»/, CI('<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0112 6a5.5 5.5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z"></path>')],
    [/^Убрать из «Мне нравится»/, CI('<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0112 6a5.5 5.5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z"></path>', true)],
    [/^Скопировать/, CI('<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 012-2h8"></path>')],
    [/^Открыть (в|на) /, CI('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"></path>')],
    [/^Искать/, CI('<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>')],
    [/^Страница исполнителя/, CI('<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0116 0"></path>')],
    [/^Убрать из очереди|^Убрать из плейлиста/, CI('<path d="M6 6l12 12M18 6L6 18"></path>')]
  ];
  function ctxIcon(label){ for (var k = 0; k < CTX_ICONS.length; k++) if (CTX_ICONS[k][0].test(label)) return CTX_ICONS[k][1]; return ''; }
  function showCtx(x, y, items){
    closeCtx();
    var m = document.createElement('div'); m.className = 'ctx'; m.setAttribute('role', 'menu');
    items.forEach(function (it){
      if (it === '-') { var hr = document.createElement('div'); hr.className = 'ctx-sep'; m.appendChild(hr); return; }
      var b = document.createElement('button'); b.setAttribute('role', 'menuitem');
      if (it.danger) b.className = 'danger';
      var ic = it.icon !== undefined ? it.icon : ctxIcon(it.label);
      b.innerHTML = '<span class="ctx-l">' + esc(it.label) + '</span>' + (ic ? '<span class="ctx-i" aria-hidden="true">' + ic + '</span>' : '');
      b.onclick = function(){ closeCtx(); it.act(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
    ctxEl = m;
    var first = m.querySelector('button'); if (first) first.focus();
  }
  document.addEventListener('mousedown', function(e){ if (ctxEl && !e.target.closest('.ctx')) closeCtx(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeCtx(); });
  window.addEventListener('blur', closeCtx);
  window.addEventListener('resize', closeCtx);
  $('queue').addEventListener('scroll', closeCtx);

  function openQueueMenu(e, i){
    e.preventDefault();
    var v = queue[i]; if (!v) return;
    var pend = i > current && !v.played;
    var items = [];
    items.push({ label: i === current ? 'Начать сначала' : 'Играть сейчас', act: function(){ var j = queue.indexOf(v); if (j >= 0) playQueueItem(j); } });
    if (pend && i !== afterCur()) items.push({ label: 'Играть следующим', act: function(){ var j = queue.indexOf(v); if (j >= 0) moveItem(j, v.req ? afterCur() : reqInsertAt('next')); } });
    // ⛔ — у ожидающего и у текущего заказа «Твич»: убрать/пропустить трек и закрыть зрителю заказы.
    if ((pend || i === current) && isBotReq(v)) items.push({ label: '⛔ Убрать и закрыть заказы зрителю', icon: '', act: function(){
      var min = (typeof BOT_BAN_MIN !== 'undefined' && BOT_BAN_MIN) || 10;
      var wasCur = i === current;
      botBan(v, min);
      var j = queue.indexOf(v); if (j >= 0) removeAt(j);
      toast((wasCur ? 'Пропустил' : 'Убрал') + '. ' + v.req.who + ' — тайм-аут на заказы');
    } });
    if (!pend && i !== current) items.push({ label: 'Сыграть ещё раз — следующим', act: function(){ queue.splice(afterCur(), 0, copyTrack(v)); renderQueue(); saveToday(); prefetchNext(); } });
    if (pend && i !== queue.length - 1) items.push({ label: 'В конец очереди', act: function(){ var j = queue.indexOf(v); if (j >= 0) moveItem(j, queue.length); } });
    items.push({ label: 'В плейлист…', act: function(){ setTimeout(function(){ openAddToListMenu(e.clientX, e.clientY, [v]); }, 0); } });
    if (ymLoggedIn) items.push({ label: 'Волна по этому треку', act: function(){ waveByTrack(v); } });
    items.push({ label: 'Сохранить всю ленту как плейлист…', act: function(){ askDlg({ title: 'Лента в плейлист', text: 'Все песни из очереди и сыгранные сегодня (' + queue.length + ').', label: 'Название', value: 'Стрим ' + new Date().toLocaleDateString('ru-RU') }).then(function (r){ if (!r) return; var m = localCreate(r.value, dedupeTracks(queue)); toast('Создан «' + m.title + '» · ' + m.tracks.length + ' ' + plural(m.tracks.length)); }); } });
    items.push('-');
    if (srcOf(v) === 'ym' && ymLoggedIn) items.push({ label: likedSet.has(String(v.id)) ? 'Убрать из «Мне нравится»' : 'В «Мне нравится»', act: function(){ toggleLike(v); } });
    if (srcOf(v) === 'ym' && ymLoggedIn) items.push({ label: dislikedSet.has(String(v.id)) ? 'Убрать из «Не нравится»' : 'Не нравится', act: function(){ toggleDislike(v); } });
    items.push({ label: 'Скопировать «Исполнитель — Название»', act: function(){ copyText((v.author ? v.author + ' — ' : '') + v.title); } });
    items.push(srcOf(v) === 'lc' ? { label: 'Показать файл в папке', act: function(){ if (A.libReveal) A.libReveal(v.id); } } : { label: srcOf(v) === 'ym' ? 'Открыть в Яндекс Музыке' : 'Открыть на ' + srcName(v), act: function(){ A.openExternal(trackUrl(v)); } });
    if (v.author) items.push({ label: 'Искать «' + (v.author.length > 28 ? v.author.slice(0, 27) + '…' : v.author) + '»', act: function(){ setTab('search'); search.value = v.author; doSearch({ nav: true }); } });
    if (v.author) items.push({ label: 'Страница исполнителя «' + firstArtist(v) + '»', act: function(){ openArtistPage(firstArtist(v)); } });
    items.push('-');
    items.push({ label: spKeyOf(v) ? 'Убрать книгу из очереди' : 'Убрать из очереди', danger: true, act: function(){ var j = queue.indexOf(v); if (j >= 0) removeAt(j); } });
    showCtx(e.clientX, e.clientY, items);
  }

  // Меню песни в поиске и списках: «⋯» или правая кнопка
  function openTrackMenu(x, y, v, alignRight){
    var items = [];
    items.push({ label: 'Играть сейчас', act: function(){ playNow(v); } });
    items.push({ label: 'Играть следующим', act: function(){ addNext(v); } });
    items.push({ label: 'В конец очереди', act: function(){ addToQueue(v); } });
    items.push({ label: 'В плейлист…', act: function(){ setTimeout(function(){ openAddToListMenu(x, y, [v]); if (alignRight && ctxEl) ctxEl.style.left = Math.max(8, x - ctxEl.offsetWidth) + 'px'; }, 0); } });
    if (ymLoggedIn) items.push({ label: 'Волна по этому треку', act: function(){ waveByTrack(v); } });
    if (v.alts && v.alts.length) items.push({ label: 'Другие версии (' + v.alts.length + ')', act: function(){ setTimeout(function(){ openVersionsMenu(x, y, v); if (alignRight && ctxEl) ctxEl.style.left = Math.max(8, x - ctxEl.offsetWidth) + 'px'; }, 0); } });
    items.push('-');
    if (srcOf(v) === 'ym' && ymLoggedIn) items.push({ label: likedSet.has(String(v.id)) ? 'Убрать из «Мне нравится»' : 'В «Мне нравится»', act: function(){ toggleLike(v); } });
    if (srcOf(v) === 'ym' && ymLoggedIn) items.push({ label: dislikedSet.has(String(v.id)) ? 'Убрать из «Не нравится»' : 'Не нравится', act: function(){ toggleDislike(v); } });
    items.push({ label: 'Скопировать «Исполнитель — Название»', act: function(){ copyText((v.author ? v.author + ' — ' : '') + v.title); } });
    items.push(srcOf(v) === 'lc' ? { label: 'Показать файл в папке', act: function(){ if (A.libReveal) A.libReveal(v.id); } } : { label: srcOf(v) === 'ym' ? 'Открыть в Яндекс Музыке' : 'Открыть на ' + srcName(v), act: function(){ A.openExternal(trackUrl(v)); } });
    if (v.author) items.push({ label: 'Искать «' + (v.author.length > 28 ? v.author.slice(0, 27) + '…' : v.author) + '»', act: function(){ setTab('search'); search.value = v.author; doSearch({ nav: true }); } });
    if (v.author) items.push({ label: 'Страница исполнителя «' + firstArtist(v) + '»', act: function(){ openArtistPage(firstArtist(v)); } });
    var plRow = Array.prototype.find.call(document.querySelectorAll('.row'), function (r){ return r._v === v && r._rm && r.isConnected; });
    if (plRow) { items.push('-'); items.push({ label: 'Убрать из плейлиста' + (plRow._rmWhere ? ' ' + plRow._rmWhere : ''), danger: true, act: plRow._rm }); }
    showCtx(x, y, items);
    if (alignRight && ctxEl) ctxEl.style.left = Math.max(8, x - ctxEl.offsetWidth) + 'px';
  }

  // Перетаскивание несыгранных песен
var dragFrom = -1, dragWave = -1, dropTo = -1, dropWaveTo = -1, dragBook = null;
  // Строка (или рамка книги), перед которой встанет брошенное; в конце — после последней
  function qDropEl(box, to){
    if (to < queue.length) {
      var w = box.querySelector('.qbwrap[data-i="' + to + '"]'); if (w) return { el: w, after: false };
      var r = box.querySelector('.qrow[data-i="' + to + '"]'); if (r) return { el: r, after: false };
    }
    var all = box.querySelectorAll(':scope > .qrow, :scope > .qbwrap');
    return all.length ? { el: all[all.length - 1], after: true } : null;
  }
  function clearDrop(){ var ms = document.querySelectorAll('#queue .drop-before, #queue .drop-after'); for (var k = 0; k < ms.length; k++) ms[k].classList.remove('drop-before', 'drop-after'); }
  (function(){
    var box = $('queue');
    box.addEventListener('dragstart', function(e){
      var bk = e.target.closest && e.target.closest('.qbwrap');
      if (bk) {
        dragBook = { from: parseInt(bk.dataset.i, 10), len: parseInt(bk.dataset.len, 10) };
        bk.classList.add('dragging'); closeCtx();
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'book'); } catch (err) {}
        return;
      }
      var w = e.target.closest && e.target.closest('.qn-row');
      if (w) { dragWave = parseInt(w.dataset.w, 10); w.classList.add('dragging'); closeCtx();
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'wave:' + dragWave); } catch (err) {}
        return; }
      var r = e.target.closest && e.target.closest('.qrow'); if (!r || !r.draggable) return;
      dragFrom = parseInt(r.dataset.i, 10); r.classList.add('dragging'); closeCtx();
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) {}
    });
    box.addEventListener('dragover', function(e){
      if (dragFrom < 0 && dragWave < 0 && !dragBook) return;
      e.preventDefault();
      clearDrop();
      // волна: если наведено на строку волны — переставляем внутри волны
      if (dragWave >= 0) {
        var wr = e.target.closest && e.target.closest('.qn-row');
        if (wr) {
          var wj = parseInt(wr.dataset.w, 10), wrc = wr.getBoundingClientRect();
          var wto = e.clientY > wrc.top + wrc.height / 2 ? wj + 1 : wj;
          dropWaveTo = wto; dropTo = -1;
          if (wto <= wj) wr.classList.add('drop-before'); else wr.classList.add('drop-after');
          return;
        }
      }
      dropWaveTo = -1;
      // Наведение на книгу — только до или после неё целиком: внутрь не бросить
      var bw = e.target.closest && e.target.closest('.qbwrap');
      var r = bw ? null : (e.target.closest && e.target.closest('.qrow'));
      var to;
      if (bw) { var bs = parseInt(bw.dataset.i, 10), bl = parseInt(bw.dataset.len, 10), brc = bw.getBoundingClientRect(); to = e.clientY > brc.top + brc.height / 2 ? bs + bl : bs; }
      else if (!r) to = queue.length;
      else { var i = parseInt(r.dataset.i, 10), rc = r.getBoundingClientRect(); to = e.clientY > rc.top + rc.height / 2 ? i + 1 : i; }
      if (dragWave >= 0) to = Math.max(to, afterCur());   // новый трек из волны не ставим выше играющего (и внутрь книги)
      to = spSnapDrop(to);
      dropTo = to;
      var mk = qDropEl(box, to);
      if (mk) mk.el.classList.add(mk.after ? 'drop-after' : 'drop-before');
    });
    box.addEventListener('drop', function(e){
      if (dragFrom < 0 && dragWave < 0 && !dragBook) return;
      e.preventDefault();
      if (dragBook) { var bb = dragBook; dragBook = null; clearDrop(); spMoveBook(bb.from, bb.len, dropTo < 0 ? queue.length : dropTo); return; }
      // перестановка внутри волны
      if (dragWave >= 0 && dropWaveTo >= 0) {
        var wf = dragWave, wt2 = dropWaveTo; dragWave = -1; dropWaveTo = -1; clearDrop();
        if (wt2 === wf || wt2 === wf + 1) return;
        var witem = waveBuf.splice(wf, 1)[0]; if (!witem) return;
        if (wf < wt2) wt2--;
        waveBuf.splice(wt2, 0, witem);
        renderQueue(); return;
      }
      if (dragWave >= 0) {
        var wj = dragWave; dragWave = -1; dropWaveTo = -1; clearDrop();
        var wt = waveBuf.splice(wj, 1)[0]; if (!wt) return;
        wt.bg = false; wt.played = false;
        var at = spSnapDrop(Math.max(afterCur(), Math.min(dropTo < 0 ? queue.length : dropTo, queue.length)));
        queue.splice(at, 0, wt);
        renderQueue(); saveToday(); prefetchNext(); topUpWave();
        return;
      }
      var f = dragFrom; dragFrom = -1; clearDrop();
      moveItem(f, spSnapDrop(dropTo));
    });
    box.addEventListener('dragend', function(){ dragFrom = -1; dragWave = -1; dropWaveTo = -1; dragBook = null; clearDrop(); var d = box.querySelector('.dragging'); if (d) d.classList.remove('dragging'); });
  })();

  // Лента за сегодня (день начинается в 6 утра — стримы идут за полночь)
  function streamDay(){ var d = new Date(Date.now() - 6 * 3600 * 1000); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  var saveTimer = null;
  var lastPosSaved = null, lastPlaySaved = null; // что уже записано — чтобы не писать на диск зря
  // Позиция играющего трека (0.34.0, задание 6). Нужна, чтобы после падения окна
  // продолжить с того же места. currentTime есть только у настоящего медиа-элемента:
  // у встроенного плеера YouTube и сайта Яндекса вернём 0 — там перемотки нет.
  function todayPos(){
    var v = current >= 0 ? queue[current] : null;
    var m = master();
    var pos = 0, playing = false;
    if (v && loadingIdx < 0 && m && typeof m.getAttribute === 'function' && m.getAttribute('src')) {
      pos = Math.max(0, Number(m.currentTime) || 0);
      // Только явный признак из событий плеера: у ytx/ymx нет своих currentTime/paused,
      // и раньше здесь получалось «играет», даже когда стояла пауза (A10).
      playing = playingNow;
    }
    return { pos: Math.round(pos * 10) / 10, playing: !!playing };
  }
  function saveToday(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      if (!A.setSetting) return;
      // Храним последние 400 строк, но книгу посередине не режем: срез уходит к её началу
      var cut0 = Math.max(0, queue.length - 400);
      if (cut0 > 0) { var cb = spBlockOf(cut0); if (cb && cb.s < cut0) cut0 = cb.s; }
      var items = queue.slice(cut0).map(function (v){
        var it = { src: v.src, id: v.id, albumId: v.albumId, title: v.title, author: v.author, album: v.album, duration: v.duration, seconds: v.seconds, thumb: v.thumb, cover: v.cover, bg: !!v.bg, played: !!v.played, fromList: !!v.fromList, sp: v.sp, workId: v.workId, workTitle: v.workTitle, idx: v.idx };
        // Заказ Streamer.bot: без req.key после перезапуска нельзя отправить played/dropped —
        // трек сыграл бы «бесплатно», а баллы/карточка остались бы висеть (A35-1).
        if (v.req && /^sb-/.test(String(v.req.key || ''))) it.req = { who: v.req.who, amt: v.req.amt, cur: v.req.cur, key: v.req.key, ii: v.req.ii, botDone: !!v.req.botDone };
        return it;
      });
      var cut = queue.length - items.length;
      var p = todayPos();
      lastPosSaved = p.pos; lastPlaySaved = p.playing;
      A.setSetting('today', { day: streamDay(), items: items, current: current - cut, pos: p.pos, playing: p.playing });
    }, 600);
  }
  // Раз в 5 секунд и на паузе. Если позиция и «играет» не изменились — не пишем.
  function posSaveTick(){
    if (!A.setSetting) return;
    var p = todayPos();
    if (lastPosSaved != null && lastPlaySaved === p.playing && Math.abs(p.pos - lastPosSaved) < 1) return;
    saveToday();
  }
  setInterval(posSaveTick, 5000);
  [video, aud, aud2].forEach(function (el){
    if (!el || !el.addEventListener) return;
    el.addEventListener('play', function(){ if (el === master()) saveToday(); });
    el.addEventListener('pause', function(){ if (el === master()) saveToday(); });
    el.addEventListener('seeked', function(){ if (el === master()) saveToday(); });
  });
  // «Поднято после сбоя»: место и «играло ли» приходят из today, а сам признак —
  // из главного процесса (recover-take). Обычный запуск признака не получает,
  // поэтому музыка сама не включается (поведение как раньше).
  var pendingResume = null;
  // «Выбрать, но не включать» после падения: карточка и строка очереди показывают трек,
  // звук не стартует. Перемотка случится, когда владелец сам нажмёт «Играть» (A10).
  function selectPaused(v){
    if (!v) return;
    playingId = v.id; markPlayingRows();
    setNowPlaying(v); showTrack(v);
    renderQueue(true);
    setPlayIcon('▶'); setPlayerBusy(false);
  }
  function resumeAfterCrash(pos, playing){
    if (!A.recoverTake) return;
    A.recoverTake().then(function (r){
      if (!r || !r.recovered) return;
      if (current < 0 || current >= queue.length) {
        toast('Окно Тапёра перезапустилось после сбоя — очередь сохранена');
        return;
      }
      var v = queue[current];
      var play = playing === true;
      pendingResume = { pos: Math.max(0, Number(pos) || 0), play: play, key: srcOf(v) + ':' + v.id };
      if (!play) {
        // Было на паузе — музыку не включаем: только выбираем трек и запоминаем место.
        selectPaused(v);
        toast('Окно Тапёра перезапустилось после сбоя — трек на паузе, нажми «Играть»');
        return;
      }
      playIndex(current);
      toast('Окно Тапёра перезапустилось после сбоя — продолжаю с места');
    }).catch(function(){});
  }
  if (A.getSetting) A.getSetting('today').then(function (t){
    if (!t || t.day !== streamDay() || !Array.isArray(t.items) || !t.items.length) return;
    var tPos = Math.max(0, Number(t.pos) || 0), tPlay = t.playing === true;
    if (queue.length) {
      // Заказ успел прийти раньше, чем загрузилась лента (функц. аудит 01.11, F5).
      // Раньше лента в этом случае молча не возвращалась. Теперь она встаёт перед пришедшим,
      // а играющий трек остаётся тем же.
      // сыгранное — до пришедшего, несыгранное (в том числе оплаченные заказы) — после, чтобы не потерялось
      var cut = Math.min(t.items.length, Math.max(0, (t.current | 0) + 1));
      var seen = {}; queue.forEach(function (v){ seen[srcOf(v) + ':' + v.id] = 1; });
      var before = t.items.slice(0, cut), after = t.items.slice(cut).filter(function (v){ return !seen[srcOf(v) + ':' + v.id]; });
      before.forEach(function (v){ v.played = true; });
      queue = before.concat(queue, after);
      current = current >= 0 ? current + before.length : before.length - 1;
      axLog('лента за сегодня: восстановлена перед ' + (queue.length - t.items.length) + ' уже пришедшими');
      renderQueue(true);
      saveToday();
      return;
    }
    queue = t.items;
    current = Math.min(queue.length - 1, Math.max(-1, t.current | 0));
    renderQueue(true);
    // 0.34.0, задание 6: только если окно поднял сторож — вернуть трек на место.
    resumeAfterCrash(tPos, tPlay);
  });

  // Лайк и «Не нравится» в Яндексе
  var likedSet = new Set();
  var dislikedSet = new Set();
  var THUMB = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2zM17 14l-4.5 6a2.2 2.2 0 0 1-3.3-2.6L10 14H5a2 2 0 0 1-2-2.4l1.3-6A2 2 0 0 1 6.3 4H17z"></path></svg>';
  var THUMB_ON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 3h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2z"></path><path d="M17 14l-4.5 6a2.2 2.2 0 0 1-3.3-2.6L10 14H5a2 2 0 0 1-2-2.4l1.3-6A2 2 0 0 1 6.3 4H17z"></path></svg>';
  var HEART = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"></path></svg>';
  var HEART_ON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"></path></svg>';
  function renderLike(){
    var t = curTrack;
    // Книга или подкаст: на этом месте стоят скорость и таймер сна, лайка и волны там нет
    var speech = typeof isSpeech === 'function' && isSpeech(t);
    var wb = $('waveTrackBtn'); if (wb) wb.hidden = speech || !(t && ymLoggedIn && (srcOf(t) === 'ym' || t.title));
    var show = !speech && !!(t && srcOf(t) === 'ym' && ymLoggedIn);
    var b = $('likeBtn'), d = $('dislikeBtn');
    b.hidden = !show; if (d) d.hidden = !show;
    if (typeof renderSpeechBtns === 'function') renderSpeechBtns();
    if (!show) return;
    var on = likedSet.has(String(t.id));
    b.classList.toggle('on', on);
    b.innerHTML = on ? HEART_ON : HEART;
    b.title = on ? 'Убрать из «Мне нравится»' : 'В «Мне нравится» Яндекса';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!d) return;
    var don = dislikedSet.has(String(t.id));
    d.classList.toggle('on', don);
    d.innerHTML = don ? THUMB_ON : THUMB;
    d.title = don ? 'Убрать из «Не нравится»' : 'Не нравится — Яндекс перестанет это предлагать';
    d.setAttribute('aria-pressed', don ? 'true' : 'false');
  }
  $('likeBtn').onclick = function(){ if (curTrack) toggleLike(curTrack); };
  if ($('dislikeBtn')) $('dislikeBtn').onclick = function(){ if (curTrack) toggleDislike(curTrack); };
  async function toggleLike(t){
    var id = String(t.id), on = !likedSet.has(id);
    if (on) likedSet.add(id); else likedSet.delete(id);
    renderLike();
    var r = await A.ymLike(ymKey(t), on);
    if (!r || r.error) {
      if (on) likedSet.delete(id); else likedSet.add(id);
      renderLike();
      setSub('⚠ лайк не сохранился: ' + ((r && r.error) || 'ошибка'));
    } else if (t.bg && bgSel.kind === 'wave' && srcOf(t) === 'ym') { A.ymWaveFeedback(on ? 'like' : 'unlike', ymKey(t)); trimWaveTail(); }
  }
  // «Не нравится»: отдельный список Яндекса. Лайк и дизлайк вместе не держим —
  // поставил дизлайк на любимый трек, лайк снимается сам.
  async function toggleDislike(t){
    if (!A.ymDislike) return;
    var id = String(t.id), on = !dislikedSet.has(id);
    if (on) dislikedSet.add(id); else dislikedSet.delete(id);
    if (on && likedSet.has(id)) toggleLike(t);
    renderLike();
    var r = await A.ymDislike(ymKey(t), on);
    if (!r || r.error) {
      if (on) dislikedSet.delete(id); else dislikedSet.add(id);
      renderLike();
      setSub('⚠ «Не нравится» не сохранилось: ' + ((r && r.error) || 'ошибка'));
      return;
    }
    if (on && t.bg && bgSel.kind === 'wave' && srcOf(t) === 'ym') { A.ymWaveFeedback('dislike', ymKey(t)); trimWaveTail(); }
    if (on) setSub('«' + t.title + '» — в «Не нравится»');
  }

  // Полоса прогресса
  var seekEl = $('seek'), fillEl = $('seekFill'), knobEl = $('seekKnob'), dragging = false;
  function fmt(s){ s = Math.max(0, Math.floor(s||0)); var m = Math.floor(s/60), ss = s%60; return m + ':' + (ss<10?'0':'') + ss; }
  function setBar(frac){ frac = Math.max(0, Math.min(1, frac)); var p = (frac*100) + '%'; fillEl.style.width = p; knobEl.style.left = p; }
  function fracAt(x){ var r = seekEl.getBoundingClientRect(); return (x - r.left) / r.width; }
  function doSeek(x){
    var m = master(), d = m.duration || 0; if (d <= 0) return;
    var t = Math.max(0, Math.min(1, fracAt(x))) * d;
    m.currentTime = t;
    if (mode === 'split') { try { video.currentTime = t; } catch (e) {} }
    if (typeof voKick === 'function') voKick();
  }
  seekEl.addEventListener('mousedown', function(e){ dragging = true; setBar(fracAt(e.clientX)); });
  document.addEventListener('mousemove', function(e){ if (dragging) setBar(fracAt(e.clientX)); });
  document.addEventListener('mouseup', function(e){ if (dragging) { dragging = false; doSeek(e.clientX); } });

  var volEl = $('vol');
  function showVolVal(){ var n = Math.round(parseFloat(volEl.value) || 0); $('volVal').textContent = n; var mb = $('muteBtn'); mb.classList.toggle('muted', n === 0); mb.setAttribute('aria-label', n === 0 ? 'Включить звук' : 'Выключить звук'); }
  volEl.addEventListener('input', function(){ volAnim.target = null; applyVol(); showVolVal(); });
  // Колёсико мыши над громкостью: очень плавно — один щелчок колёсика = 2%, значение «доезжает» за ~0,3 с
  var volAnim = { target: null, raf: 0 };
  function volStep(){
    var cur = parseFloat(volEl.value) || 0, t = volAnim.target;
    if (t == null) { volAnim.raf = 0; return; }
    var nv = Math.abs(t - cur) < 0.05 ? t : cur + (t - cur) * 0.18;
    volEl.value = nv; applyVol(); showVolVal();
    if (nv === t) { volAnim.target = null; volAnim.raf = 0; return; }
    volAnim.raf = requestAnimationFrame(volStep);
  }
  function volTo(t){ volAnim.target = Math.max(0, Math.min(100, t)); if (!volAnim.raf) volAnim.raf = requestAnimationFrame(volStep); }
  $('volBox').addEventListener('wheel', function(e){
    e.preventDefault();
    var px = e.deltaMode === 1 ? e.deltaY * 33 : (e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY); // строки/страницы → пиксели
    var d = -px / 100 * 2; // 100 px (один щелчок обычной мыши) = 2%
    d = Math.max(-4, Math.min(4, d));
    var base = volAnim.target != null ? volAnim.target : (parseFloat(volEl.value) || 0);
    volTo(base + d);
  }, { passive: false });
  var volBeforeMute = 80;
  $('muteBtn').onclick = function(){ var n = parseFloat(volEl.value) || 0; if (n > 0) { volBeforeMute = n; volTo(0); } else volTo(volBeforeMute || 50); };
  showVolVal();

  // Перетаскиваемая граница между поиском и панелью «видео + очередь»
  var qcol = document.querySelector('.queue-col'), splitter = $('splitter'), splitDrag = false;
  function setQW(w){
    var max = Math.max(300, window.innerWidth - 420);
    w = Math.max(280, Math.min(max, w));
    qcol.style.width = w + 'px';
    return w;
  }
  if (A.getSetting) A.getSetting('queueWidth').then(function(w){ if (w) setQW(w); });
  splitter.addEventListener('mousedown', function(e){ splitDrag = true; splitter.classList.add('drag'); document.body.classList.add('resizing'); e.preventDefault(); });
  document.addEventListener('mousemove', function(e){ if (splitDrag) setQW(window.innerWidth - e.clientX); });
  document.addEventListener('mouseup', function(){
    if (!splitDrag) return;
    splitDrag = false; splitter.classList.remove('drag'); document.body.classList.remove('resizing');
    if (A.setSetting) A.setSetting('queueWidth', parseInt(qcol.style.width, 10));
  });
  window.addEventListener('resize', function(){ if (qcol.style.width) setQW(parseInt(qcol.style.width, 10)); });

  // Горизонтальная граница между окном видео и очередью
  var videoBox = document.querySelector('.nowcard .video'), hsplit = $('hsplitter');
  var vDrag = false, vStartY = 0, vStartH = 0;
  function setVH(h){
    var max = Math.max(120, qcol.clientHeight - 300); // очереди всегда оставляем место
    h = Math.max(80, Math.min(max, h));
    videoBox.style.aspectRatio = 'auto';
    videoBox.style.height = h + 'px';
    return h;
  }
  function resetVH(){ videoBox.style.aspectRatio = ''; videoBox.style.height = ''; }
  if (A.getSetting) A.getSetting('videoHeight').then(function(h){ if (h) setVH(h); });
  hsplit.addEventListener('mousedown', function(e){
    vDrag = true; vStartY = e.clientY; vStartH = videoBox.getBoundingClientRect().height;
    hsplit.classList.add('drag'); document.body.classList.add('resizing-v'); e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){ if (vDrag) setVH(vStartH + (e.clientY - vStartY)); });
  document.addEventListener('mouseup', function(){
    if (!vDrag) return;
    vDrag = false; hsplit.classList.remove('drag'); document.body.classList.remove('resizing-v');
    if (A.setSetting) A.setSetting('videoHeight', parseInt(videoBox.style.height, 10) || null);
  });
  hsplit.addEventListener('dblclick', function(){ resetVH(); if (A.setSetting) A.setSetting('videoHeight', null); });
  window.addEventListener('resize', function(){ if (videoBox.style.height) setVH(parseInt(videoBox.style.height, 10)); });
  // Порт /sb/* пересчитывает место и время по снимку — освежаем его, пока окно не перерисовывает очередь.
  if (typeof A !== 'undefined' && A.sbotQueue) setInterval(sbotPush, 5000);


