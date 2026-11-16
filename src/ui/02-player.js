  // ===== Вкладки =====
  var curTab = 'search';
  function setTab(t, pane){
    curTab = t;
    document.body.dataset.tab = t; // нужно для оформления: в поиске полосы под шапкой нет
    var bs = document.querySelectorAll('#tabs button');
    for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('active', bs[k].dataset.tab === t);
    $('hrow2').hidden = t !== 'search';
    $('viewSearch').hidden = t !== 'search';
    $('viewWave').hidden = t !== 'wave';
    $('viewMy').hidden = t !== 'my';
    if ($('viewBooks')) $('viewBooks').hidden = t !== 'books';
    $('viewReq').hidden = t !== 'req';
    $('viewHist').hidden = t !== 'hist';
    $('viewBrowser').hidden = t !== 'browser';
    $('viewSettings').hidden = t !== 'settings';
    $('viewLook').hidden = t !== 'look';
    lookPlace(t === 'look');
    $('main').classList.toggle('no-queue', t === 'settings');
    if (t === 'wave' && typeof wavePageOpen === 'function') wavePageOpen();
    if (t === 'my') loadMy(false);
    if (t === 'books' && typeof bkOpen === 'function') bkOpen();
    if (t === 'req') rqOpen();
    if (t === 'hist' && typeof histOpen === 'function') histOpen();
    if (t === 'settings') {
      refreshSettings();
      // В режиме вкладок открываем «О программе», если это не переход на конкретный
      // раздел (pane). В режиме «одним листом» (sheet) всё как раньше — не переключаем.
      var sv = $('viewSettings');
      if (sv && sv.classList.contains('set-tabs') && typeof showSettingsPane === 'function') showSettingsPane(pane || 'sAbout');
    }
    if (t === 'browser') { if (typeof brWake === 'function') brWake(); if (!BR.cur) brShow((BR.last && BR.last.svc) || 'ym', BR.last ? BR.last.url : null); }
    else if (typeof brSleep === 'function') brSleep();
    vidSync(); // в «Настройках» окна видео не видно — картинку YouTube на паузу
  }
  // Карточка оформления живёт в настройках; на вкладке «Оформление» её переносим (одна копия — без двойных обработчиков)
  function lookPlace(inTab){
    var card = document.querySelector('#sLook > .card') || document.querySelector('#lookSlot > .card'); if (!card) return;
    var to = inTab ? $('lookSlot') : $('sLook');
    if (card.parentNode !== to) to.appendChild(card);
  }
  $('tabs').addEventListener('click', function(e){ var b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

  // ===== Плеер =====
  // queue — вся лента за сегодня: заказы и треки фона (bg). Сыгранные остаются бледными сверху.
  var queue = [];
  var current = -1;
  var playingId = null;
  var video = $('player'), aud = $('aud'), aud2 = $('aud2'); // aud и aud2 меняются местами при плавном переходе
  var mode = 'single';            // 'single' | 'split' (звук в <audio>) | 'audio' (только звук, обложка)
  var loadingIdx = -1;            // какой трек сейчас грузится
  var prefOn = true;

  var PLAY_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';
  var PAUSE_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"></path></svg>';
  function setPlayIcon(sym){ $('playpause').innerHTML = (sym === '⏸') ? PAUSE_SVG : PLAY_SVG; document.body.classList.toggle('is-paused', sym !== '⏸'); if (typeof pushWidget === 'function') pushWidget(); if (typeof ovFeed === 'function') setTimeout(ovFeed, 0); if (typeof voKick === 'function') voKick(); }
  setPlayIcon('▶');
  function master(){ return mode === 'iframe' ? ytx : (mode === 'ymweb' ? ymx : ((mode === 'split' || mode === 'audio') ? aud : video)); }

  var SRC = { lc: { n: 'Мои файлы', in: 'твоих файлах', c: '#4ADE9A' }, ym: { n: 'Яндекс', in: 'Яндексе', c: '#FFD43B' }, yt: { n: 'YouTube', in: 'YouTube', c: '#FF5A52' }, sc: { n: 'SoundCloud', in: 'SoundCloud', c: '#FF7A1A' }, bc: { n: 'Bandcamp', in: 'Bandcamp', c: '#41A8C6' }, au: { n: 'Audius', in: 'Audius', c: '#CC0FE0' } };
  function srcOf(v){ return v && SRC[v.src] ? v.src : 'yt'; }
  function srcName(v){ return v && v.src === 'tap' ? 'Тапёр' : SRC[srcOf(v)].n; }
  function srcIn(v){ return SRC[srcOf(v)].in; }
  function srcColor(v){ return v && v.src === 'tap' ? '#9B87FF' : SRC[srcOf(v)].c; }
  function isUrlSrc(v){ var s = srcOf(v); return s === 'sc' || s === 'bc' || s === 'au'; }
  function srcDot(v){ return '<span class="dot" style="background:' + srcColor(v) + '"></span>'; }
  function ymKey(t){ return t.id + (t.albumId ? ':' + t.albumId : ''); }
  // «Исполнитель ● Источник» — исполнитель обычным шрифтом, источник моноширинным
  function subLine(v, extra){
    return '<div class="s sub">' + (v.author ? '<span class="sa">' + artistLinks(v.author) + '</span>' : '') +
      '<span class="dot sd" style="background:' + srcColor(v) + '"></span><span class="ss">' + esc(extra || srcName(v)) + '</span></div>';
  }
  // Имена исполнителей — кликабельные: при наведении подсвечиваются, нажатие ищет исполнителя
  function artistLinks(author){
    if (!window.TapRank) return esc(author);
    return TapRank.splitArtists(author).map(function (p){
      return p.sep ? esc(p.sep) : '<span class="al" data-artist="' + esc(p.name) + '" title="Страница исполнителя «' + esc(p.name) + '»">' + esc(p.name) + '</span>';
    }).join('');
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('.al[data-artist]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    searchArtist(a.dataset.artist);
  }, true);
  document.addEventListener('mousedown', function(e){ if (e.target.closest && e.target.closest('.al[data-artist]')) e.stopPropagation(); }, true);
  // Нажатие на исполнителя где угодно — страница исполнителя (там всё: популярное, все треки, альбомы, похожие)
  function searchArtist(name){
    name = window.TapRank ? TapRank.cleanChannel(name) : name;
    if (!name) return;
    openArtistPage(name);
  }
  function curVol(){ var n = parseFloat($('vol').value); return (isNaN(n) ? 80 : n) / 100; }
  function allEls(){ return [video, aud, aud2]; }

  // ===== Запасной YouTube: официальный встроенный плеер =====
  // Если наша библиотека не смогла достать поток, ролик играет через плеер YouTube.
  // Раньше iframe_api грузился прямо в это окно, где живёт мост к главному процессу:
  // чужой скрипт получал весь window.app (P5c №1). Теперь плеер живёт на отдельной
  // странице http://localhost:<порт>/ytplayer.html — другой origin, без preload.
  // Связь — postMessage с проверкой origin и формата (src/yt-msg.js).
  // Снаружи он по-прежнему выглядит как обычный <video>: те же свойства и события.
  var ytx = new EventTarget();
  var YX = { page: null, origin: '', ready: false, vid: '', st: -1, fade: 1, t: 0, dur: 0, waiters: [], errText: '' };
  Object.defineProperties(ytx, {
    paused: { get: function(){ return YX.st !== 1 && YX.st !== 3; } },
    ended: { get: function(){ return YX.st === 0; } },
    muted: { get: function(){ return false; } },
    readyState: { get: function(){ return YX.vid ? 4 : 0; } },
    duration: { get: function(){ return YX.dur || 0; } },
    currentTime: {
      get: function(){ return YX.t || 0; },
      set: function(t){ var v = Number(t); if (!isFinite(v) || v < 0) return; YX.t = v; ytPost({ t: 1, dir: 'cmd', type: 'seek', value: v }); }
    },
    id: { value: 'ytx' }
  });
  ytx.getAttribute = function(n){ return n === 'src' ? (YX.vid || null) : null; };
  ytx.play = function(){ ytPost({ t: 1, dir: 'cmd', type: 'play' }); return Promise.resolve(); };
  ytx.pause = function(){ ytPost({ t: 1, dir: 'cmd', type: 'pause' }); };
  function ytxEmit(type){ ytx.dispatchEvent(new Event(type)); }
  var YT_ERR = { '-2': 'плеер YouTube не ответил', '-1': 'плеер YouTube не загрузился', '-3': 'YouTube не принял команду', 2: 'неверный адрес ролика', 5: 'ролик не воспроизводится во встроенном плеере', 100: 'ролик удалён или скрыт', 101: 'автор запретил показ вне YouTube', 150: 'автор запретил показ вне YouTube', 153: 'YouTube не принял запрос плеера' };
  // Адрес страницы плеера: другой хост того же порта (окно — 127.0.0.1, плеер — localhost).
  // Окно передаёт свой origin в ?parent=, страница проверяет, что это петля на её же порту.
  function ytPlayerUrl(){
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return '';
    var u = new URL('ytplayer.html', location.href);
    var port = location.port || (location.protocol === 'https:' ? '443' : '80');
    u.host = (location.hostname === 'localhost' ? '127.0.0.1' : 'localhost') + ':' + port;
    u.search = '?parent=' + encodeURIComponent(location.origin);
    return u.href;
  }
  function ytPost(msg){
    if (!YX.page || !YX.origin) return;
    try { var w = YX.page.contentWindow; if (w) w.postMessage(msg, YX.origin); } catch (e) {}
  }
  // Громкость — та же формула, что у <audio>: curVol * плавный переход. Плеер ждёт 0..100.
  function ytxVolume(){ ytPost({ t: 1, dir: 'cmd', type: 'volume', value: Math.round(curVol() * YX.fade * 100) }); }
  function ytxSettle(ok, why){
    var ws = YX.waiters; YX.waiters = [];
    ws.forEach(function(w){ clearTimeout(w.timer); try { if (ok) w.resolve(); else w.reject(why); } catch (e) {} });
  }
  function ytxWait(){
    return new Promise(function(resolve, reject){
      var w = { resolve: resolve, reject: reject, timer: setTimeout(function(){
        if (YX.waiters.indexOf(w) < 0) return;
        ytxFailWaiters(new Error('плеер YouTube не ответил за 15 с'));
      }, 15000) };
      YX.waiters.push(w);
    });
  }
  function ytxFailWaiters(err){
    var ws = YX.waiters; if (!ws.length) return;
    ytxTeardown();
    ws.forEach(function(w){ clearTimeout(w.timer); try { w.reject(err); } catch (e) {} });
    YX.waiters = [];
  }
  function ytxTeardown(){
    if (YX.page) { try { YX.page.remove(); } catch (e) {} }
    YX.page = null; YX.origin = ''; YX.ready = false;
    YX.vid = ''; YX.st = -1; YX.t = 0; YX.dur = 0; YX.errText = '';
    $('ytFrame').hidden = true; video.style.visibility = '';
    try { $('ytFrame').innerHTML = ''; } catch (e) {}
  }
  function ytxStop(){
    if (YX.page) ytPost({ t: 1, dir: 'cmd', type: 'pause' });
    ytxSettle(true); // остановка — не ошибка: ожидавший просто завершает загрузку
    ytxTeardown();
  }
  function ytxEvent(e){
    if (!YX.page || !YX.origin || e.origin !== YX.origin) return;
    if (e.source !== YX.page.contentWindow) return;
    var ev = window.TapYtMsg && window.TapYtMsg.parseEvt(e.data);
    if (!ev) return;
    if (ev.type === 'ready') { YX.ready = true; ytxSettle(true); ytxVolume(); return; }
    if (ev.type === 'state') {
      var was = YX.st; YX.st = ev.value;
      if (ev.value === 1) { if (was !== 1) ytxEmit('play'); }
      else if (ev.value === 2) ytxEmit('pause');
      else if (ev.value === 0) { ytxEmit('timeupdate'); ytxEmit('ended'); }
      return;
    }
    if (ev.type === 'time') { YX.t = ev.value; ytxEmit('timeupdate'); return; }
    if (ev.type === 'duration') { YX.dur = ev.value; return; }
    if (ev.type === 'error') {
      YX.errText = YT_ERR[ev.value] || ('ошибка плеера ' + ev.value);
      axLog('YouTube (встроенный плеер): ' + YX.errText + ' — ' + (YX.vid || '?'));
      // Пока плеер не готов, вызывающий ещё ждёт: иначе очередь повиснет.
      if (YX.waiters.length) { ytxFailWaiters(new Error(YX.errText)); return; }
      ytxEmit('error');
    }
  }
  if (!YX.onMsg) { YX.onMsg = ytxEvent; window.addEventListener('message', YX.onMsg); }
  async function ytxLoad(id){
    var url = ytPlayerUrl();
    if (!url || !window.TapYtMsg) throw new Error('плеер YouTube доступен только из окна программы');
    if (!window.TapYtMsg.isId(String(id || ''))) throw new Error('неверный адрес ролика');
    YX.vid = String(id); YX.st = -1; YX.t = 0; YX.dur = 0; YX.errText = '';
    $('ytFrame').hidden = false; video.style.visibility = 'hidden';
    if (!YX.page) {
      var u = new URL(url);
      YX.origin = u.origin;
      var fr = document.createElement('iframe');
      fr.id = 'ytPlayer';
      fr.title = 'Плеер YouTube';
      fr.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
      fr.src = url;
      var loaded = new Promise(function(resolve){ fr.addEventListener('load', function(){ resolve(); }, { once: true }); });
      var wait = ytxWait();
      YX.page = fr;
      $('ytFrame').innerHTML = '';
      $('ytFrame').appendChild(fr);
      // Ранняя ошибка страницы (API не загрузился) не должна ждать загрузки кадра.
      await Promise.race([loaded, wait]);
      ytPost({ t: 1, dir: 'cmd', type: 'load', id: YX.vid });
      await wait;
    } else {
      ytPost({ t: 1, dir: 'cmd', type: 'load', id: YX.vid });
      if (!YX.ready) await ytxWait();
    }
    ytxVolume(); ymxVolume();
  }
  // ===== Запасной Яндекс: официальный сайт в скрытом окне =====
  var ymx = new EventTarget();
  var YW = { on: false, st: null, at: 0, fade: 1, token: 0 };
  Object.defineProperties(ymx, {
    paused: { get: function(){ return !YW.st || YW.st.paused; } },
    ended: { get: function(){ return !!(YW.st && YW.st.ended); } },
    muted: { get: function(){ return false; } },
    readyState: { get: function(){ return YW.on ? 4 : 0; } },
    duration: { get: function(){ return YW.st ? (YW.st.dur || 0) : 0; } },
    currentTime: {
      get: function(){ if (!YW.st) return 0; var t = YW.st.time || 0; if (!YW.st.paused) t += (Date.now() - YW.at) / 1000; return Math.min(t, YW.st.dur || t); },
      set: function(t){ if (YW.st) { YW.st.time = t; YW.at = Date.now(); } if (A.ymwebCmd) A.ymwebCmd('seek', t); }
    },
    id: { value: 'ymx' }
  });
  ymx.getAttribute = function(n){ return n === 'src' && YW.on ? 'ymweb' : null; };
  ymx.play = function(){ if (A.ymwebCmd) A.ymwebCmd('resume'); return Promise.resolve(); };
  ymx.pause = function(){ if (A.ymwebCmd) A.ymwebCmd('pause'); };
  // громкость сайта Яндекса: отправляем только при изменении (applyVol зовётся часто — при переходах каждые 50 мс)
  function ymxVolume(){ if (!YW.on || !A.ymwebCmd) return; var g = Math.round(curVol() * YW.fade * 1000) / 1000; if (g === YW.sentVol) return; YW.sentVol = g; A.ymwebCmd('volume', g); }
  if (A.onYmwebState) A.onYmwebState(function (d){
    if (!YW.on) return;
    if (d.ev === 'error' && !('time' in d)) { YW.err = d.error; ymx.dispatchEvent(new Event('error')); return; }
    var was = YW.st; YW.st = d; YW.at = Date.now();
    if ((d.ev === 'play' || d.ev === 'playing') && (!was || was.paused)) ymx.dispatchEvent(new Event('play'));
    else if (d.ev === 'pause' && !d.ended) ymx.dispatchEvent(new Event('pause'));
    ymx.dispatchEvent(new Event('timeupdate'));
    if (d.ev === 'ended') ymx.dispatchEvent(new Event('ended'));
  });
  setInterval(function(){ if (YW.on && YW.st && !YW.st.paused) ymx.dispatchEvent(new Event('timeupdate')); }, 500);
  async function ymxStart(v){
    var tk = ++YW.token;
    YW.on = true; YW.st = null; YW.err = null; YW.sentVol = null;
    setSub('Яндекс не отдал трек напрямую — включаю через сайт Яндекс Музыки…');
    var r = A.ymwebPlay ? await A.ymwebPlay(slimForWeb(v), curVol()) : { error: 'нет запасного способа' };
    if (tk !== YW.token) return;
    if (!r || r.error) { YW.on = false; failOver(v, 'yt', 'Яндекс: ' + ((r && r.error) || 'сайт не ответил')); return; }
    setSub((v.author || '') + ' · через сайт Яндекс Музыки');
    ymxVolume();
  }
  function ymxStop(){ if (!YW.on && !YW.token) return; YW.token++; YW.on = false; YW.st = null; if (A.ymwebStop) A.ymwebStop(); }
  function slimForWeb(v){ return { src: v.src, id: v.id, albumId: v.albumId, title: v.title, author: v.author, seconds: v.seconds || 0 }; }

  // ===== Доступность сервисов =====
  // YouTube в России часто открывается только через VPN, а кто-то им вообще не пользуется
  var SVC = { ytOn: true, ymOn: true, ytDownAt: 0, ymweb: true, scOn: true, auOn: true };
if (A.getSetting) A.getSetting('ymEnabled').then(function (v){ SVC.ymOn = v !== false; }).catch(function(e){ axLog('настройка Яндекс: ' + (e && e.message || e)); });
  var YT_RETRY = 10 * 60 * 1000;
  function ytUsable(){ return SVC.ytOn && (!SVC.ytDownAt || Date.now() - SVC.ytDownAt > YT_RETRY); }
  function isNetErr(why){ return /не отвечает|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network|fetch failed|timed out|socket hang up|unable to connect|Connection/i.test(String(why || '')); }
  // Состояние общее с основным процессом: там же о нём узнают заказы (и наоборот — отказ в заказе виден здесь)
  function markYtDown(why){ var was = ytUsable(); SVC.ytDownAt = Date.now(); if (was) { axLog('YouTube недоступен (' + String(why).slice(0, 120) + ') — 10 минут ищу и играю без него'); if (A.ytMark) A.ytMark(true, why); } renderSvc(); }
  function markYtOk(){ if (SVC.ytDownAt) { SVC.ytDownAt = 0; if (A.ytMark) A.ytMark(false); renderSvc(); } }
  function ytFromMain(s){ if (!s) return; var at = s.down ? (s.at || Date.now()) : 0; if (at === SVC.ytDownAt) return; SVC.ytDownAt = at; renderSvc(); }
  if (A.onYtState) A.onYtState(ytFromMain);
  if (A.ytState) A.ytState().then(ytFromMain).catch(function(e){ axLog('состояние YouTube: ' + (e && e.message || e)); });
  // Кнопки площадок в поиске: выключенная в настройках — скрыта; если она была выбрана — «Везде»
  function syncChips(){
    var map = { yt: SVC.ytOn, sc: SVC.scOn, au: SVC.auOn };
    var box = $('chips'); if (!box) return;
    var act = box.querySelector('.chip.active'), lostActive = false;
    Object.keys(map).forEach(function (f){
      var c = box.querySelector('.chip[data-f="' + f + '"]'); if (!c) return;
      c.hidden = map[f] === false;
      if (c.hidden && c === act) lostActive = true;
    });
    if (lostActive) { var all = box.querySelector('.chip[data-f="all"]'); if (all) all.click(); }
  }
  function renderSvc(){
    syncChips();
    var c = document.querySelector('#chips .chip[data-f="yt"]'); if (!c) return;
    var off = !SVC.ytOn, down = SVC.ytOn && !ytUsable();
    c.classList.toggle('down', off || down);
    c.title = off ? 'YouTube выключен в настройках' : (down ? 'YouTube не отвечает. Нажми, чтобы проверить снова' : '');
    if (typeof renderHealthWarn === 'function') renderHealthWarn();
    var t = $('setYtText'); if (t) t.textContent = off ? 'Выключен: поиск и треки только из Яндекса' : (down ? 'Не отвечает — возможно, нужен VPN. Тапёр проверит снова через 10 минут' : 'Поиск, видео и плейлисты работают без входа. Если наш способ не сработает — включится обычный плеер YouTube');
  }

  // Цепочка запасных путей, если поток не получен:
  // YouTube → плеер YouTube → тот же трек в Яндексе; Яндекс → сайт Яндекс Музыки → тот же трек на YouTube
  function withFallback(v, r){
    var y = srcOf(v) === 'yt';
    if (r && !r.error) { if (y) markYtOk(); return r; }
    var why = (r && r.error) || 'нет ответа';
    if (isUrlSrc(v) || srcOf(v) === 'lc') return { alt: ymLoggedIn ? 'ym' : 'yt', why: (srcOf(v) === 'lc' ? 'Файл' : srcName(v)) + ': ' + why };
    if (y) {
      if (isNetErr(why)) markYtDown(why);
      if (SVC.ytOn && ytUsable()) { axLog('YouTube: наш способ не сработал (' + String(why).slice(0, 120) + ') — играю через плеер YouTube'); return { iframe: true }; }
      return { alt: 'ym', why: 'YouTube недоступен' };
    }
    if (SVC.ymweb && !/войди/i.test(why)) { axLog('Яндекс: поток не получен (' + String(why).slice(0, 120) + ') — пробую сайт Яндекс Музыки'); return { ymweb: true, why: why }; }
    return { alt: 'yt', why: why };
  }
  async function getStream(v){
    var t0 = Date.now();
    axLog('плеер: запрос потока «' + (v.author || '') + ' — ' + v.title + '» (' + srcName(v) + ')');
    if (srcOf(v) === 'yt' && !ytUsable()) return { alt: 'ym', why: SVC.ytOn ? 'YouTube недоступен' : 'YouTube выключен' };
    var r = await fetchStream(v);
    axLog('плеер: поток получен за ' + (Date.now() - t0) + ' мс' + (r && r.error ? ' · ' + r.error : ''));
    return withFallback(v, r);
  }
  // Трек не включился ни одним способом.
  // Заказ зрителя возвращается в «Заказы» (активные) с пометкой «не включился» — сам в очередь больше не встаёт.
  // Дальше: фон/«Всё в очередь» — следующий трек всегда; остальное — если включено «Включать фон после очереди» (без тишины),
  // иначе плеер ждёт стримера (решение владельца 26.10.2026).
  function playFailed(v, why){
    if (!v || previewT) return;
    if (v.req) rqFailed(v, why);
    if (v.bg || v.fromList || waveCfg.on || spKeyOf(v)) {
      setSub('⚠ ' + String(why || 'не играет').slice(0, 80) + ' — следующий');
      setTimeout(function(){ if (queue[current] === v) advance(true); }, 1500);
    }
  }
  // Без входа Яндекс пробует отрывок (ym-stream). Если не сыграло ничего и причина — вход,
  // показываем заметное сообщение с кнопкой: мелкую строку в подвале человек не видит.
  function ymLoginNotice(v, why){
    if (ymLoggedIn || !v || srcOf(v) !== 'ym') return false;
    if (!/войди|вход|аккаунт|подписк|плюс/i.test(String(why || ''))) return false;
    if (typeof toast !== 'function' || typeof browserLogin !== 'function') return false;
    toast('Яндекс играет только после входа', 'Войти в Яндекс', browserLogin);
    axLog('Яндекс: без входа не сыграло (' + String(why || '').slice(0, 120) + ') — предложил войти');
    return true;
  }
  // Не играет в своём сервисе — ищем тот же трек в другом и ставим на его место
  async function failOver(v, target, why){
    if (previewT) { setErr('⚠ ' + why); previewT = null; return; }
    if (queue[current] !== v) return;
    if (target === 'yt' && !ytUsable()) target = null;
    if (target === 'ym' && !ymLoggedIn) target = null;
    // Глава книги: замены на другой площадке не бывает, а чужой трек на её месте разорвал бы книгу
    if (spKeyOf(v)) { axLog('книга: глава «' + v.title + '» не играет — замену не ищу (' + why + ')'); target = null; }
    if (!target || v.altTried || !A.findAlt) {
      ymLoginNotice(v, why);
      setErr('⚠ ' + why + (v.altTried ? ' · замена тоже не играет' : ''));
      playFailed(v, why);
      return;
    }
    setSub('Не играет в ' + srcIn(v) + ' — ищу в ' + (target === 'yt' ? 'YouTube' : 'Яндексе') + '…');
    var res = await A.findAlt(slimForWeb(v), target).catch(function(){ return null; });
    if (queue[current] !== v) return;
    if (!res || res.error || !res.track) {
      setErr('⚠ ' + why + ' · в ' + (target === 'yt' ? 'YouTube' : 'Яндексе') + ' не нашёл');
      playFailed(v, why);
      return;
    }
    var nv = copyTrack(res.track);
    nv.bg = v.bg; nv.fromList = v.fromList; nv.played = true; nv.altTried = true; nv.altFrom = srcName(v); if (v.req) nv.req = v.req;
    if (v.sp) { nv.sp = v.sp; nv.workId = v.workId || (v.albumId ? 'ym:' + v.albumId : ''); nv.workTitle = v.workTitle; nv.idx = v.idx; }
    axLog('замена: «' + (v.author || '') + ' — ' + v.title + '» (' + srcName(v) + ') → «' + (nv.author || '') + ' — ' + nv.title + '» (' + srcName(nv) + ')');
    queue[current] = nv; saveToday();
    playIndex(current);
  }

