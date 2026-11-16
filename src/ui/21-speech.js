  // ===== Речь: книги и подкасты — скорость, таймер сна, память места =====
  // Книга и подкаст — это обычные треки с пометкой sp: 'book' (глава книги) или 'pod' (выпуск).
  // Всё здесь работает для любого источника: Яндекс, лента подкаста, файлы с компьютера.
  // Место прослушивания помним сами, а не на стороне площадки: так «Продолжить» работает везде одинаково.

  function isSpeech(v){ return !!(v && (v.sp === 'book' || v.sp === 'pod')); }
  // Ключ всей книги (подкаста), а не отдельной главы: место помним на уровне произведения
  function spWorkKey(v){
    if (!isSpeech(v)) return '';
    return v.sp + ':' + (v.workId || (v.albumId ? srcOf(v) + ':' + v.albumId : srcOf(v) + ':' + v.id));
  }
  function spTrackKey(v){ return srcOf(v) + ':' + v.id; }

  // ----- скорость -----
  var SPD_LIST = [0.75, 1, 1.25, 1.5, 1.75, 2];
  var spdCur = 1;
  function fmtSpd(r){ return String(r).replace('.', ',') + '×'; }
  function spdFor(v){ var k = spWorkKey(v); var m = k && marks[k]; return (m && m.spd) || 1; }
  function applyRate(){
    var r = isSpeech(curTrack) ? spdFor(curTrack) : 1;
    spdCur = r;
    allEls().forEach(function (el){
      if (el.tagName === 'VIDEO') return; // в раздельном режиме скорость видео подгоняется под звук
      try { if (el.playbackRate !== r) el.playbackRate = r; } catch (e) {}
    });
  }
  function setSpd(r){
    var v = curTrack, k = spWorkKey(v); if (!k) return;
    var m = marks[k] || (marks[k] = { at: Date.now() });
    m.spd = r;
    applyRate(); renderSpeechBtns(); markFlush();
  }

  // ----- таймер сна -----
  var slp = { until: 0, atEnd: false, timer: 0 };
  function slpOn(){ return slp.until > 0 || slp.atEnd; }
  function slpClear(){ slp.until = 0; slp.atEnd = false; renderSpeechBtns(); }
  function slpSet(min, atEnd){
    slp.until = atEnd ? 0 : Date.now() + min * 60000;
    slp.atEnd = !!atEnd;
    renderSpeechBtns();
    setSub(atEnd ? 'Таймер сна: до конца главы' : 'Таймер сна: ' + min + ' мин');
  }
  function slpFire(){
    var m = master(); slpClear(); markSave(true);
    if (!m) return;
    if (allEls().indexOf(m) >= 0) {
      fadeEl(m, m._fade == null ? 1 : m._fade, 0, 20, function(){
        try { m.pause(); } catch (e) {}
        setFade(m, 1); setSub('Таймер сна: пауза');
      });
    } else { try { m.pause(); } catch (e) {} setSub('Таймер сна: пауза'); }
  }
  slp.timer = setInterval(function(){
    if (!slp.until) return;
    if (Date.now() >= slp.until) slpFire(); else renderSleepLbl();
  }, 1000);
  function slpLeft(){ return slp.until ? Math.max(1, Math.round((slp.until - Date.now()) / 60000)) : 0; }

  // ----- память места -----
  var marks = {}, markT = 0, flushT = 0;
  if (A.getSetting) A.getSetting('listenMarks').then(function (v){
    if (v && typeof v === 'object') marks = v;
    renderSpeechBtns(); applyRate();
  });
  function marksTrim(){
    var keys = Object.keys(marks);
    if (keys.length <= 200) return marks;
    keys.sort(function (a, b){ return (marks[b].at || 0) - (marks[a].at || 0); });
    var out = {}; keys.slice(0, 200).forEach(function (k){ out[k] = marks[k]; });
    marks = out; return marks;
  }
  function markFlush(){
    clearTimeout(flushT);
    flushT = setTimeout(function(){ if (A.setSetting) A.setSetting('listenMarks', marksTrim()); }, 1500);
  }
  function markSave(force){
    var v = curTrack; if (!isSpeech(v)) return;
    var k = spWorkKey(v); if (!k) return;
    var m = master(); if (!m) return;
    var sec = m.currentTime || 0;
    // Уходим с главы (force) — запоминаем её даже в первую секунду, иначе «Назад» и
    // «Продолжить» начинали бы книгу с первой главы
    if (!(sec > 1) && !force) return;
    var now = Date.now();
    if (!force && now - markT < 10000) return;
    markT = now;
    var old = marks[k] || {};
    marks[k] = spMarkInfo(v, old, { sec: Math.max(0, sec - 2), dur: m.duration || v.seconds || 0, at: now });
    markFlush();
  }
  // Запись места: глава и секунда + всё, чтобы показать книгу во вкладке «Книги и подкасты»
  function spMarkInfo(v, old, o){
    var b = (v === queue[current] && typeof spBlockOf === 'function') ? spBlockOf(current) : null;
    // Дослушанная книга должна пережить markSave(true), который playIndex вызывает сразу
    // после ended. Переносим done только для той же главы: у новой главы это уже другая запись.
    var same = String(old.id || '') === String(v.id);
    var eps = old.eps && typeof old.eps === 'object' ? Object.assign({}, old.eps) : {};
    if (v.sp === 'pod') {
      var eid = String(v.id), prev = eps[eid] || {};
      eps[eid] = { sec: o.sec, dur: o.dur, at: o.at, done: prev.done === true };
      var keys = Object.keys(eps);
      if (keys.length > 300) {
        keys.sort(function (a, b){ return (eps[b].at || 0) - (eps[a].at || 0); });
        var keep = {}; keys.slice(0, 300).forEach(function (k){ keep[k] = eps[k]; }); eps = keep;
      }
    }
    return {
      tk: spTrackKey(v), id: String(v.id), idx: v.idx || 0, sec: o.sec, dur: o.dur, at: o.at,
      title: v.workTitle || v.title, sp: v.sp, spd: old.spd || 1,
      alb: v.albumId || old.alb || '', thumb: v.thumb || old.thumb || '', author: v.author || old.author || '',
      n: b ? b.n : (old.n || 0), ep: v.sp === 'pod' ? v.title : (old.ep || ''),
      done: same && old.done ? true : false,
      doneAt: same && old.done ? (old.doneAt || 0) : 0,
      eps: eps
    };
  }
  function spMarkEpisodeDone(v, el){
    if (!v || v.sp !== 'pod') return;
    var k = spWorkKey(v); if (!k) return;
    var old = marks[k] || {};
    var m = spMarkInfo(v, old, { sec: v.seconds || (el && el.duration) || 0, dur: v.seconds || (el && el.duration) || 0, at: Date.now() });
    var e = m.eps[String(v.id)] || {};
    e.done = true; e.sec = m.sec; e.dur = m.dur; e.at = m.at;
    m.eps[String(v.id)] = e;
    marks[k] = m; markFlush();
  }
  // Последняя глава книги доиграла сама: это событие ended, а не «Дальше»/переключение.
  // Вешаем capture-слушатель: 03-queue обрабатывает ended раньше (bubble) и сразу зовёт playIndex.
  function spMarkLastChapter(v, el){
    if (!v) return;
    if (v.sp === 'pod') { spMarkEpisodeDone(v, el); return; }
    if (v.sp !== 'book') return;
    var k = spWorkKey(v); if (!k) return;
    var b = spBlockOf(current), n = (marks[k] && marks[k].n) || (b && b.n) || 0;
    if (!n || Number(v.idx || 0) !== Number(n)) return;
    var old = marks[k] || {};
    var m = spMarkInfo(v, old, { sec: v.seconds || (el && el.duration) || 0, dur: v.seconds || (el && el.duration) || 0, at: Date.now() });
    m.done = true; m.doneAt = Date.now();
    marks[k] = m; markFlush();
  }
  // Место, на котором остановились: им пользуются страницы книги и подкаста («Продолжить слушать»)
  function spMark(v){ var k = typeof v === 'string' ? v : spWorkKey(v); return (k && marks[k]) || null; }
  // Включить трек с запомненной секунды: ставим пометку, перемотка случится, когда поток заиграет
  function spResumeAt(v, sec){ if (v && sec > 0) v._seekTo = sec; return v; }

  // ----- кнопки в подвале (на месте лайка и «Волны по треку») -----
  var CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"></path></svg>';
  function renderSleepLbl(){
    var lb = $('sleepBtn'), tx = $('sleepLbl'); if (!lb || !tx) return;
    tx.textContent = slp.atEnd ? 'До конца главы' : (slp.until ? slpLeft() + ' мин' : 'Таймер сна');
    lb.classList.toggle('on', slpOn());
  }
  function renderSpeechBtns(){
    var on = isSpeech(curTrack);
    var sb = $('spdBtn'), lb = $('sleepBtn');
    if (sb) {
      sb.hidden = !on;
      var r = spdFor(curTrack);
      sb.textContent = fmtSpd(r);
      sb.classList.toggle('on', r !== 1);
    }
    if (lb) lb.hidden = !on;
    renderSleepLbl();
    applyRate();
  }
  if ($('spdBtn')) $('spdBtn').onclick = function(){
    var rc = $('spdBtn').getBoundingClientRect(), cur = spdFor(curTrack);
    showCtx(rc.left, rc.top - 8, SPD_LIST.map(function (r){
      return { label: fmtSpd(r) + (r === 1 ? ' — обычная' : ''), icon: r === cur ? CHECK : '', act: function(){ setSpd(r); } };
    }));
  };
  if ($('sleepBtn')) $('sleepBtn').onclick = function(){
    var rc = $('sleepBtn').getBoundingClientRect(), items = [];
    [15, 30, 45, 60].forEach(function (n){
      items.push({ label: n === 60 ? 'Через 1 час' : 'Через ' + n + ' мин', icon: (!slp.atEnd && slpLeft() === n) ? CHECK : '', act: function(){ slpSet(n, false); } });
    });
    items.push({ label: 'В конце главы', icon: slp.atEnd ? CHECK : '', act: function(){ slpSet(0, true); } });
    if (slpOn()) { items.push('-'); items.push({ label: 'Выключить таймер', act: function(){ slpClear(); setSub('Таймер сна выключен'); } }); }
    showCtx(rc.left, rc.top - 8, items);
  };

  // ----- связь с плеером -----
  allEls().concat([ytx, ymx]).forEach(function (el){
    el.addEventListener('timeupdate', function(){
      if (el !== master()) return;
      if (isSpeech(curTrack)) {
        if (el.tagName !== 'VIDEO' && el.playbackRate !== undefined && el.playbackRate !== spdCur) { try { el.playbackRate = spdCur; } catch (e) {} }
        markSave(false);
      }
      // «В конце главы»: встаём на паузу сами, до события «трек кончился», иначе очередь поедет дальше
      if (slp.atEnd) { var d = el.duration || 0, c = el.currentTime || 0; if (d > 0 && d - c <= 0.4) slpFire(); }
    });
    el.addEventListener('pause', function(){ if (el === master()) markSave(true); });
    el.addEventListener('play', function(){ if (el === master()) applyRate(); });
    // Продолжить с запомненной секунды: перематываем, как только поток готов
    el.addEventListener('loadedmetadata', function(){
      if (el !== master()) return;
      var v = queue[current];
      if (v && v._seekTo > 0) { try { el.currentTime = v._seekTo; } catch (e) {} v._seekTo = 0; }
    });
  });
  // 03-queue вызывает этот хук в своём ended-обработчике до advance(): иначе очередь
  // успевает переключиться и current уже указывает на следующий трек.
  function spTrackEndedHook(v){
    if (!v || v !== queue[current]) return;
    spMarkLastChapter(v, master());
  }
  window.addEventListener('beforeunload', function(){ markSave(true); });

  // ----- книга в очереди: одна строка, внутри — свои главы -----
  var spOpenBooks = {};   // workId → развёрнута ли книга
  var spColors = {};      // workId → цвет, взятый с обложки
  function spBookOpened(wid){ return !!spOpenBooks[wid]; }
  // Длина блока, если на этом месте начинается книга (иначе 0)
  function spKeyOf(v){
    if (!v || v.sp !== 'book') return '';
    return v.workId || (v.albumId ? 'ym:' + v.albumId : '');
  }
  function spRunAt(i){
    var k = spKeyOf(queue[i]);
    if (!k) return 0;
    if (i > 0 && spKeyOf(queue[i - 1]) === k) return 0;
    var n = 1;
    while (queue[i + n] && spKeyOf(queue[i + n]) === k) n++;
    return n;
  }
  // Внутрь книги ничего не вклинивается: точка броска съезжает к краю блока
  function spSnapDrop(to){
    for (var i = 0; i < queue.length; ) {
      var n = spRunAt(i);
      if (!n) { i++; continue; }
      if (to > i && to < i + n) return (to - i) * 2 < n ? i : i + n;
      i += n;
    }
    return to;
  }
  function spBookColor(v, el){
    var wid = v.workId;
    if (spColors[wid]) return spColors[wid];
    var url = v.thumb || v.cover || '';
    if (url && A.coverColor) A.coverColor(url).then(function (c){
      if (!c) return;
      spColors[wid] = c;
      if (el && el.isConnected) el.style.background = c;
    }).catch(noop);
    return '';
  }
  var SP_CHEV_DOWN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l7 7 7-7"></path></svg>';
  var SP_CHEV_UP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 15l-7-7-7 7"></path></svg>';
  var SP_QOV = '<span class="qov">' +
    '<svg class="pl" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>' +
    '<svg class="ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"></path></svg>' +
    '<svg class="eq" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="10" width="3.5" height="10" rx="1"></rect><rect x="10.25" y="4" width="3.5" height="16" rx="1"></rect><rect x="16.5" y="8" width="3.5" height="12" rx="1"></rect></svg>' +
    '</span>';
  var SP_X = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  // «Макс Фрай. «Чужак (сборник)». Часть 3» → «Макс Фрай. «Чужак (сборник)»»
  function spBookTitle(v){
    if (v.workTitle) return v.workTitle;
    var t = String(v.title || '');
    var m = /^(.*?)[.,]?\s*(часть|глава|part|chapter)\s*\d+.*$/i.exec(t);
    return m ? m[1].trim() : t;
  }
  // Начался трек: все раскрытые книги, кроме той, что играет, сворачиваются
  function spFoldOthers(v){
    var k = spKeyOf(v);
    for (var x in spOpenBooks) if (x !== k) delete spOpenBooks[x];
  }
  // Рамка книги: монолит — общая обводка, тянется и бледнеет целиком
  function spBookWrap(i, len){
    var v = queue[i];
    var w = document.createElement('div');
    var done = !isClassic() && current >= 0 && i + len <= current; // вся книга выше играющего — отыграла
    var playing = current >= i && current < i + len;
    w.className = 'qbwrap' + (done ? ' done' : '') + (playing ? ' playing' : '') + (spBookOpened(spKeyOf(v)) ? ' open' : '');
    w.dataset.i = i; w.dataset.len = len;
    w.draggable = true;
    // Высота — прямо в элементе: в живой очереди рамку сжимало в черту, и это не должно
    // зависеть от того, какой файл оформления загружен
    w.style.flex = '0 0 auto'; w.style.flexShrink = '0'; w.style.minHeight = '58px';
    w.appendChild(spBookHeader(i, len));
    spWatchWrap(w);
    return w;
  }
  // Проверка после отрисовки: если рамку всё же сжало — в лог её размеры и стили
  var spWrapLogged = '';
  function spWatchWrap(w){
    requestAnimationFrame(function(){
      if (!w.isConnected) return;
      var h = w.offsetHeight, hd = w.querySelector('.qbook');
      if (h >= 40) return;
      var cs = getComputedStyle(w), box = w.parentNode, sig = h + '|' + (hd ? hd.offsetHeight : -1);
      if (sig === spWrapLogged) return; spWrapLogged = sig;
      axLog('книга: рамка сжата до ' + h + ' px (шапка ' + (hd ? hd.offsetHeight + ' px, display ' + getComputedStyle(hd).display : 'нет') +
        '; flex ' + cs.flex + ', min-height ' + cs.minHeight + ', display ' + cs.display + ', overflow ' + cs.overflow +
        '; список ' + (box ? box.clientHeight + '/' + box.scrollHeight + ' px, ' + getComputedStyle(box).display : '?') + ')');
    });
  }
  function spBookHeader(i, len){
    var v = queue[i], open = spBookOpened(spKeyOf(v));
    var el = document.createElement('div');
    el.className = 'qbook';
    el.title = 'Книга — один трек: нажми, чтобы продолжить; перетащи, чтобы передвинуть целиком';
    // На какой главе стоим: играющая; иначе — запомненное место
    var at = 0, k;
    if (current >= i && current < i + len) at = current - i;
    else {
      var mk0 = spMark(v);
      if (mk0) for (k = 0; k < len; k++) if (String(queue[i + k].id) === String(mk0.id)) { at = k; break; }
    }
    var left = 0; for (k = at; k < len; k++) left += queue[i + k].seconds || 0;
    var pct = Math.round(at * 100 / len);
    el.innerHTML =
      '<div class="bfill" style="width:' + pct + '%"></div>' +
      '<div class="qcov bcov" title="Играть книгу">' + (v.thumb ? '<img src="' + esc(v.thumb) + '" alt="">' : '') + SP_QOV + '</div>' +
      '<div class="bm"><div class="bt">' + esc(spBookTitle(v)) + '</div>' +
      '<div class="bs">Книга · глава ' + (at + 1) + ' из ' + len + (left ? ' · осталось ' + spLong(left) : '') + '</div></div>' +
      '<button class="bx" type="button" data-a="fold" aria-label="' + (open ? 'Свернуть главы' : 'Показать главы') + '">' + (open ? SP_CHEV_UP : SP_CHEV_DOWN) + '</button>' +
      '<button class="bx" type="button" data-a="drop" aria-label="Убрать книгу">' + SP_X + '</button>';
    var fill = el.querySelector('.bfill');
    var c = spBookColor(v, fill);
    if (c) fill.style.background = c;
    el.onclick = function(e){
      var b = e.target.closest('button');
      if (b && b.dataset.a === 'fold') { spOpenBooks[spKeyOf(v)] = !open; renderQueue(); return; }
      if (b && b.dataset.a === 'drop') { spRemoveBook(i, len); return; }
      spPlayBook(i, len);
    };
    return el;
  }
  // ----- книга в очереди — один трек -----
  // Границы книги, в которой стоит строка i (или null, если это не глава)
  function spBlockOf(i){
    var k = spKeyOf(queue[i]); if (!k) return null;
    var s = i, e = i;
    while (s > 0 && spKeyOf(queue[s - 1]) === k) s--;
    while (e + 1 < queue.length && spKeyOf(queue[e + 1]) === k) e++;
    return { s: s, n: e - s + 1 };
  }
  // «Сразу за играющим»: если играет книга — за всей книгой, иначе следующая строка.
  // Сюда встают «Играть сейчас», «Играть следующим» и заказы — внутрь книги не попадает ничего.
  function afterCur(){
    var b = current >= 0 ? spBlockOf(current) : null;
    return b ? b.s + b.n : Math.max(0, current + 1);
  }
  // Включить главу i: книга включается целиком, как один трек.
  // Живая очередь: книга, которая стоит ниже или уже отыграла, переезжает сразу за играющим
  // целиком, а то, что играло, становится отыгравшим. Внутри книги ничего не двигается.
  function spActivate(i, sec){
    var v = queue[i]; if (!v) return;
    var b = spBlockOf(i);
    if (sec > 0) spResumeAt(v, sec);
    if (!b || isClassic() || (current >= b.s && current < b.s + b.n)) { playIndex(i); return; }
    lastScrolledKey = ''; // книгу включили снаружи — очередь ведёт к ней
    spMoveBook(b.s, b.n, afterCur());
    playIndex(queue.indexOf(v));
  }
  // Глава, с которой книга продолжится, и секунда (по запомненному месту)
  function spResumePoint(b){
    var mk = spMark(queue[b.s]);
    if (mk) for (var k = 0; k < b.n; k++) if (String(queue[b.s + k].id) === String(mk.id)) return { i: b.s + k, sec: mk.sec || 0 };
    return { i: b.s, sec: 0 };
  }
  // «Назад» на книгу: она играет там, где стоит, — ничего не переезжает
  function spPlayInPlace(b){
    var rp = spResumePoint(b);
    if (rp.sec > 0) spResumeAt(queue[rp.i], rp.sec);
    playIndex(rp.i);
  }
  // Нажали на свёрнутую книгу: с запомненного места, иначе с первой главы
  function spPlayBook(i, len){
    var at = i, sec = 0, k;
    var mk = spMark(queue[i]);
    if (mk) {
      for (k = 0; k < len; k++) if (String(queue[i + k].id) === String(mk.id)) { at = i + k; sec = mk.sec || 0; break; }
    }
    spActivate(at, sec);
  }
  // Глава кончилась, а сразу за книгой ждёт заказ: заказ играет сейчас, книга становится
  // отыгравшей, а место запоминается на начале следующей главы
  function spOrderAfterChapter(){
    var b = current >= 0 ? spBlockOf(current) : null;
    if (!b || isClassic()) return false;
    var end = b.s + b.n, nq = queue[end];
    if (current >= end - 1 || !nq || !nq.req || nq.played) return false;
    spMarkChapter(queue[current + 1], 0);
    playIndex(end);
    return true;
  }
  function spMarkChapter(v, sec){
    var k = spWorkKey(v); if (!k) return;
    var old = marks[k] || {};
    marks[k] = spMarkInfo(v, old, { sec: sec || 0, dur: v.seconds || 0, at: Date.now() });
    markFlush();
  }
  // Книга двигается по очереди целиком, порядок глав внутри не меняется
  function spMoveBook(from, len, to){
    if (to >= from && to <= from + len) return;
    var curObj = queue[current];
    var items = queue.splice(from, len);
    if (from < to) to -= len;
    for (var k = 0; k < len; k++) queue.splice(to + k, 0, items[k]);
    current = curObj ? queue.indexOf(curObj) : -1;
    if (!isClassic()) queue.forEach(function (v, idx){ v.played = idx <= current; });
    renderQueue(); saveToday(); prefetchNext();
  }
  function spRemoveBook(i, len){
    var wasCur = current >= i && current < i + len;
    queue.splice(i, len);
    if (current >= i + len) current -= len;
    if (wasCur) {
      if (i < queue.length) { current = i - 1; playIndex(i); }
      else { current = queue.length - 1; stopVideo(); }
    }
    renderQueue(); saveToday();
  }
