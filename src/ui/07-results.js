  // Состояние выдачи: все найденные треки и где они показаны
  var S = { tracks: [], box: null, boxes: {}, history: [] };
  function srcLabel(src){ return { lc: 'Мои файлы (с компьютера)', ym: 'Яндекс Музыка', yt: 'YouTube', sc: 'SoundCloud', au: 'Audius' }[src] || src; }
  function buildTrackArea(){
    S.boxes = {}; S.box = null;
    var wrap = document.createElement('div'); wrap.className = 'tarea';
    if (searchMode === 'src') {
      srcOrder.forEach(function (src){
        var sec = document.createElement('div'); sec.className = 'tsec'; sec.dataset.src = src; sec.hidden = true;
        sec.innerHTML = '<div class="xlbl" style="padding:10px 8px 4px">' + esc(srcLabel(src)) + '</div>';
        var box = document.createElement('div'); box.className = 'trows'; sec.appendChild(box);
        S.boxes[src] = box; wrap.appendChild(sec);
      });
    } else { S.box = document.createElement('div'); S.box.className = 'trows'; wrap.appendChild(S.box); }
    return wrap;
  }
  // Показать треки заново (после смены варианта или когда пришли SoundCloud/Audius)
  function rerenderTracks(rebuild){
    var area = results.querySelector('.tarea'); if (!area) return;
    if (rebuild) { var n = buildTrackArea(); area.replaceWith(n); area = n; }
    var list = S.tracks.map(function (v){ return v; });
    if (searchMode === 'src') {
      Object.keys(S.boxes).forEach(function (src){
        var box = S.boxes[src]; box.innerHTML = '';
        var part = list.filter(function (v){ return srcOf(v) === src; });
        part.forEach(function (v){ v.alts = []; box.appendChild(makeRow(v)); });
        box.parentNode.hidden = !part.length;
      });
    } else {
      S.box.innerHTML = '';
      TapRank.rank(curQuery, list, searchMode, rankCtx()).forEach(function (v){ S.box.appendChild(makeRow(v)); });
    }
  }
  // Добавить треки в выдачу (без повторов)
  // ── Выдача не прыгает под курсором (функц. аудит 01.11, S2) ───────────────
  // Поздний ответ (SoundCloud, Audius, библиотека, опоздавший YouTube) пересортировывает выдачу.
  // Если в этот момент пользователь ведёт мышь к треку, строки меняются местами и клик попадает
  // в другой трек — на стриме это видно зрителям. Поэтому, пока курсор над выдачей и двигался
  // в последние 1,5 с (или была прокрутка), перестановку откладываем.
  var ptrIn = false, ptrAt = 0, calmT = null, calmQ = [];
  results.addEventListener('pointerenter', function(){ ptrIn = true; ptrAt = Date.now(); }, { passive: true });
  results.addEventListener('pointermove', function(){ ptrAt = Date.now(); }, { passive: true });
  results.addEventListener('wheel', function(){ ptrAt = Date.now(); }, { passive: true });
  results.addEventListener('pointerleave', function(){ ptrIn = false; flushCalm(); }, { passive: true });
  function busy(){ return ptrIn && Date.now() - ptrAt < 1500; }
  function flushCalm(){
    clearTimeout(calmT); calmT = null;
    if (busy()) { calmT = setTimeout(flushCalm, 1550 - (Date.now() - ptrAt)); return; }
    var q = calmQ; calmQ = [];
    q.forEach(function (job){ if (job.token === searchToken) { try { job.fn(); } catch (e) { axLog('выдача: ' + e.message); } } });
  }
  // fn выполнится сразу, если пользователь не целится, иначе — когда успокоится
  function whenCalm(fn){
    if (!busy()) { fn(); return; }
    calmQ = calmQ.filter(function (j){ return j.fn !== fn; });
    calmQ.push({ token: searchToken, fn: fn });
    if (!calmT) calmT = setTimeout(flushCalm, 1550 - (Date.now() - ptrAt));
  }
  function rerankLate(){ rerenderTracks(false); }

  function addTracks(list, late){
    // «Музыка» не показывает главы книг и выпуски подкастов; «Всё» и «Книги и подкасты» — как раньше.
    if (searchKind === 'mus') list = (list || []).filter(function (v){ return !(v && v.speech); });
    var fresh = [];
    (list || []).forEach(function (v){ if (!v || !v.id) return; var k = srcOf(v) + v.id; if (shownIds.has(k)) return; shownIds.add(k); fresh.push(v); });
    if (!fresh.length) return 0;
    S.tracks = S.tracks.concat(fresh);
    if (searchMode === 'src') {
      fresh.forEach(function (v){ var box = S.boxes[srcOf(v)]; if (!box) return; v.alts = []; box.appendChild(makeRow(v)); box.parentNode.hidden = false; });
    } else if (late) {
      // первая выдача и пустой список — сразу (раньше ждали, пока мышь успокоится, и треки «не грузились»);
      // поздние источники поверх уже показанных — когда пользователь не целится
      if (late === 'now' || !S.box.querySelector('.row')) rerenderTracks(false); else whenCalm(rerankLate);
    }
    else {
      // следующая порция при прокрутке: дубли уже показанных песен — в «другие версии», остальное — в конец
      var shown = {}; S.box.querySelectorAll('.row').forEach(function (r){ if (r._v) { var k = TapRank.songKey(r._v); if (k) shown[k] = r._v; } });
      TapRank.rank(curQuery, fresh, searchMode, rankCtx()).forEach(function (v){
        var k = TapRank.songKey(v);
        if (k && shown[k]) { shown[k].alts = (shown[k].alts || []).concat([v], v.alts || []); return; }
        S.box.appendChild(makeRow(v));
      });
    }
    return fresh.length;
  }
  function renderSearchBack(){
    var old = results.querySelector('.sback'); if (old) old.remove();
    if (!S.history.length) return;
    var prev = S.history[S.history.length - 1];
    var b = document.createElement('button'); b.className = 'back sback'; b.textContent = '← Назад: «' + (prev.length > 32 ? prev.slice(0, 31) + '…' : prev) + '»';
    b.onclick = function(){ var q = S.history.pop(); search.value = q; doSearch({ back: true }); };
    results.insertBefore(b, results.firstChild);
  }

  async function doSearch(opts) {
    opts = opts || {};
    var q = search.value.trim(); if (!q) return;
    // «tapyor debug» — вход в отладочное меню. Это не поиск: поле очищаем, в историю и
    // подсказки запрос не пишем, обычный поиск не запускаем.
    if (isDebugCommand(q)) {
      clearTimeout(sgTimer); sgToken++; hideSuggest();
      search.value = '';
      openDebugMenu();
      return;
    }
    var searchT0 = Date.now();
    axLog('поиск: старт «' + q + '»');
    clearTimeout(sgTimer); sgToken++; sgLastSearched = q; hideSuggest();
    // «Назад» — только если пришли сюда из выдачи (кнопка «Найти», «Искать …» и т.п.); новый поиск руками историю сбрасывает
    if (opts.nav && curQuery && curQuery !== q) { S.history.push(curQuery); if (S.history.length > 20) S.history.shift(); }
    else if (!opts.back && !opts.nav) S.history = [];
    var token = ++searchToken;
    curQuery = q; shownIds = new Set(); hasMoreYt = false; hasMoreYm = false; loadingMore = false; ymPage = 1;
    S.tracks = [];
    qcLeave(); // новый поиск возвращает выдачу после списка проверок (Ф3)
    closeSearchList();
    setHint('Ищу…');
    results.innerHTML = '<div class="muted">Ищу…</div>';
    renderSearchBack();
    results.scrollTop = 0;
    sgToken++; hideSuggest();
    if (isTgLink(q)) { results.innerHTML = '<div class="muted">Ссылка Telegram — открываю во вкладке «Браузер»…</div>'; setHint(''); brOpen(/^https?:/i.test(q) ? q : 'https://' + q); return; }
    if (isLink(q) && A.resolveLink) {
      var lr = await A.resolveLink(q);
      if (token !== searchToken) return;
      if (lr) { renderLinkResult(lr); renderSearchBack(); return; }
    }
    // Книги и подкасты: в своём режиме музыку не ищем вовсе
    if (searchKind === 'sp') { await spOnlyResults(q, token); return; }
    var lcP = (A.libSearch && LIB.count) ? A.libSearch(q, 30).catch(function(){ return []; }) : Promise.resolve([]);
    var ymP = (SVC.ymOn !== false && A.ymSearch ? A.ymSearch(q) : Promise.resolve(null)).catch(function(){ return null; });
    var scP = (SVC.scOn && A.scSearch) ? A.scSearch(q, 15).catch(function(){ return []; }) : Promise.resolve([]);
    var auP = (SVC.auOn && A.auSearch) ? A.auSearch(q, 10).catch(function(){ return []; }) : Promise.resolve([]);
    var ytSkip = !ytUsable();
    var ytP = ytSkip ? Promise.resolve({ skipped: true }) : A.ytSearch(q).catch(function(e){ return { error: String(e) }; });
    // YouTube не держит первую отрисовку (функц. аудит 01.11, S1). Без VPN он молчит до таймаута
    // в 8 с, а Яндекс ответил за полсекунды. Даём YouTube короткое окно: успел — выдача общая,
    // как раньше; не успел — рисуем Яндекс сейчас, YouTube доедет поздним источником.
    var YT_GRACE = 1200, ytLate = false;
    var ytEarly = ytSkip ? ytP : Promise.race([ytP, new Promise(function (r){ setTimeout(function(){ r('late'); }, YT_GRACE); })]);
    var both = await Promise.all([ymP, ytEarly]);
    if (token !== searchToken) return; // уже ищем другое
    if (both[1] === 'late') { ytLate = true; both[1] = null; }
    var ym = both[0] || {}, yt = both[1] || {};
    if (!ytLate) { if (yt.error && isNetErr(yt.error)) markYtDown(yt.error); else if (yt.videos && yt.videos.length) markYtOk(); }
    var ytNote = !SVC.ytOn ? 'YouTube выключен в настройках' : ((ytSkip || (yt.error && isNetErr(yt.error))) ? 'YouTube не отвечает — ищу без него' : '');
    var ymTracks = ym.tracks || [];
    var ytVideos = (yt.videos || []).map(function (v){ v.src = 'yt'; return v; });
    // S7: все плейлисты сразу; блок сам показывает 3 строки и кнопку «Ещё плейлисты»
    var pls = (ym.playlists || []).concat(yt.playlists || []);
    // S6: исполнители лентой по релевантности (порядок Яндекса, лучший — первым)
    var arts = ym.artists || [], artist = arts.length ? arts[0] : null;
    var waves = ymLoggedIn ? computeWaves(q, ym.artists || []) : [];
    dropSizeWatch();
    results.innerHTML = '';
    renderSearchBack();
    if (arts.length) results.appendChild(artistsSection(arts));
    if (waves.length) results.appendChild(wavesSection(waves));
    // у Яндекса плейлистов больше, чем отдал общий поиск — догрузим, когда долистают ленту до конца
    var ymMore = (ym.playlistsTotal || 0) > (ym.playlists || []).length && A.ymSearchPls ? function (){ return A.ymSearchPls(q, 0); } : null;
    if (pls.length) results.appendChild(plsSection('Плейлисты', pls, ymMore));
    if (waves.length || pls.length || artist) { var l = document.createElement('div'); l.className = 'xlbl'; l.style.padding = '0 8px 4px'; l.textContent = 'Треки'; results.appendChild(l); }
    var empty = document.createElement('div'); empty.className = 'muted tempty';
    empty.textContent = (!ymTracks.length && !ytVideos.length) ? (ytNote ? ytNote + '. Ищу на других площадках…' : (yt.error ? 'Ошибка поиска: ' + yt.error : 'Ищу на других площадках…')) : '';
    if (empty.textContent) results.appendChild(empty);
    results.appendChild(buildTrackArea());
    addTracks(ymTracks.concat(ytVideos), 'now');
    if (searchKind === 'all') spLateBlock(q, token); // книги и подкасты — поздним источником, выдача их не ждёт
    setHint(ytNote || '');
    hasMoreYt = !ytLate && ytUsable() && !yt.error; hasMoreYm = ymTracks.length >= 10;
    maybeLoadMore();
    // SoundCloud и Audius отвечают дольше — добавляем их в выдачу, когда придут
    var lateLeft = ytLate ? 4 : 3;
    function lateDone(){ if (--lateLeft || token !== searchToken) return; var e = results.querySelector('.tempty'); if (e) { if (S.tracks.length) e.remove(); else if (!pls.length && !artist) e.textContent = ytNote ? ytNote + '. Больше нигде не нашлось.' : 'Ничего не нашлось.'; else e.remove(); } }
    if (ytLate) ytP.then(function (y){
      if (token !== searchToken) return;
      y = y || {};
      if (y.error && isNetErr(y.error)) markYtDown(y.error); else if (y.videos && y.videos.length) markYtOk();
      var vids = (y.videos || []).map(function (v){ v.src = 'yt'; return v; });
      if (vids.length) { addTracks(vids, true); var e = results.querySelector('.tempty'); if (e) e.remove(); }
      hasMoreYt = ytUsable() && !y.error;
      // плейлисты YouTube — в уже показанный блок, когда пользователь не целится (вставка выше треков сдвинула бы строки)
      var ypl = y.playlists || [];
      if (ypl.length) whenCalm(function (){
        var sec = results.querySelector('.xsec[data-pls]');
        if (sec && sec._addPls) { sec._addPls(ypl); return; }
        var area = results.querySelector('.tarea'); if (!area) return;
        var lbl = Array.prototype.find.call(results.querySelectorAll('.xlbl'), function (x){ return x.textContent === 'Треки'; });
        if (!lbl) { lbl = document.createElement('div'); lbl.className = 'xlbl'; lbl.style.padding = '0 8px 4px'; lbl.textContent = 'Треки'; results.insertBefore(lbl, area); }
        results.insertBefore(plsSection('Плейлисты', ypl), lbl);
      });
      if (y.error && isNetErr(y.error)) setHint('YouTube не отвечает — ищу без него');
      lateDone();
    });
    [scP, auP, lcP].forEach(function (p){ p.then(function (list){ if (token !== searchToken) return; if (Array.isArray(list) && list.length) { addTracks(list, true); var e = results.querySelector('.tempty'); if (e) e.remove(); } lateDone(); }); });
    axLog('поиск: готово за ' + (Date.now() - searchT0) + ' мс');
  }

  function renderLinkResult(lr){
    results.innerHTML = '';
    if (lr.error) { results.innerHTML = '<div class="muted">По ссылке: ' + esc(lr.error) + '</div>'; setHint(''); return; }
    setHint('Найдено по ссылке');
    if (lr.list) results.appendChild(plsSection(lr.list.type === 'album' ? 'Альбом' : (lr.list.type === 'artist' ? 'Исполнитель' : 'Плейлист'), [lr.list]));
    if (lr.tracks && lr.tracks.length) {
      var l = document.createElement('div'); l.className = 'xlbl'; l.style.padding = '0 8px 4px'; l.textContent = 'Трек'; results.appendChild(l);
      appendResults(lr.tracks);
    }
    if (lr.list && !(lr.tracks && lr.tracks.length)) openSearchList(lr.list); // ссылка на плейлист — сразу открываем
  }

  function computeWaves(q, artists){
    var norm = function (x){ return String(x || '').toLowerCase().replace(/ё/g, 'е').trim(); };
    var ql = norm(q); if (ql.length < 2) return [];
    var out = [];
    stations.forEach(function (s){
      var n = norm(s.name);
      var exact = n === ql;
      if (exact || (ql.length >= 3 && n.indexOf(ql) >= 0) || (n.length >= 3 && ql.indexOf(n) >= 0)) {
        out.push({ name: s.name, station: s.id, sub: TYPE_NAMES[s.type] || 'волна', color: s.color, rank: (exact ? 0 : 2) + (s.type === 'genre' ? 0 : 1) });
      }
    });
    out.sort(function (a, b){ return a.rank - b.rank; });
    out = out.slice(0, 5);
    var a = artists[0];
    if (a) {
      var an = norm(a.name);
      if (an === ql || (ql.length >= 3 && an.indexOf(ql) >= 0) || (an.length >= 3 && ql.indexOf(an) >= 0)) out.push({ name: 'В стиле ' + a.name, station: 'artist:' + a.id, sub: 'артист', color: '' });
    }
    return out;
  }
  // S6: лента исполнителей. Кнопок в выдаче нет — карточка с кнопками раскрывается по нажатию.
  var CHEV_R = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
  var CHEV_L = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  // Карусель для выдачи: лента листается вбок, кнопки «назад/вперёд» — в строке заголовка справа
  // (владелец 01.11: место под стрелки рядом с лентой не держим). Всё помещается — кнопок нет.
  // more/load — дозагрузка, когда долистали до конца (плейлисты Яндекса).
  function carousel(sec, title, strip, more, load){
    var head = document.createElement('div'); head.className = 'xhead';
    head.innerHTML = '<div class="xlbl">' + esc(title) + '</div>';
    var btns = document.createElement('div'); btns.className = 'car-btns';
    function nav(cls, svg, label){ var b = document.createElement('button'); b.className = 'car-nav ' + cls; b.innerHTML = svg; b.title = label; b.setAttribute('aria-label', label); return b; }
    // свои имена классов: «.pv» уже занят предпросмотром виджета и перекрашивал кнопку
    var prev = nav('car-prev', CHEV_L, 'Пролистнуть назад'), next = nav('car-next', CHEV_R, 'Пролистнуть вперёд');
    btns.appendChild(prev); btns.appendChild(next); head.appendChild(btns);
    strip.classList.add('car-s');
    function canMore(){ return !!(more && more()); }
    function upd(){
      var max = strip.scrollWidth - strip.clientWidth, m = canMore();
      prev.disabled = strip.scrollLeft <= 2;
      next.disabled = strip.scrollLeft >= max - 2 && !m;
      btns.hidden = max <= 2 && !m;
      if (m && max > 2 && strip.scrollLeft >= max - 260) load();   // почти доехали до конца — подгружаем заранее
    }
    function step(d){ strip.scrollBy({ left: d * Math.max(160, strip.clientWidth - 120), behavior: 'smooth' }); }
    prev.onclick = function(){ step(-1); };
    next.onclick = function(){ var max = strip.scrollWidth - strip.clientWidth; if (strip.scrollLeft >= max - 2 && canMore()) load(); else step(1); };
    strip.addEventListener('scroll', upd, { passive: true });
    sec.appendChild(head); sec.appendChild(strip);
    requestAnimationFrame(upd);
    watchSize(strip, upd);
    return upd;
  }
  // S6: исполнители — компактные «пилюли» одной строкой; нажатие — страница исполнителя
  function artistsSection(arts){
    var sec = document.createElement('div'); sec.className = 'xsec'; sec.dataset.arts = '1';
    var strip = document.createElement('div'); strip.className = 'arow-s';
    arts.forEach(function (a){
      var b = document.createElement('button'); b.className = 'arc'; b.title = 'Страница исполнителя: играть, волна, все треки, альбомы, похожие';
      b.innerHTML = (a.thumb ? '<img src="' + esc(a.thumb) + '" alt="">' : '<span class="ph"></span>') + '<span class="am"><b>' + esc(a.name) + '</b><small>Исполнитель</small></span>';
      b.onclick = function(){ openArtistPage(a.name, a.id); };
      strip.appendChild(b);
    });
    carousel(sec, 'Исполнители', strip);
    return sec;
  }
  // Подсказка волны: про заказы — только со включёнными функциями для стримеров (applyStreamer обновляет)
  function wpillTitle(name){ return 'Включить волну «' + name + '»' + (stOn() ? ' (заказы всё равно первыми)' : ''); }
  function wavesSection(waves){
    var sec = document.createElement('div'); sec.className = 'xsec'; sec.dataset.src = 'ym';
    sec.innerHTML = '<div class="xlbl">Волны</div>';
    var row = document.createElement('div'); row.className = 'waves';
    waves.forEach(function (w){
      var b = document.createElement('button'); b.className = 'wpill';
      if (bgSel.kind === 'wave' && bgSel.station === w.station && !bgSel.seeds) b.classList.add('on');
      b.innerHTML = '<i style="background:' + colorFor(w.name, w.color) + '"></i><span class="wpn">' + esc(w.name) + '</span><small>' + esc(w.sub) + '</small>';
      b.dataset.wname = w.name; b.title = wpillTitle(w.name);
      b.onclick = function(){ setBg({ kind: 'wave', station: w.station, name: w.name }, true); var all = row.querySelectorAll('.wpill'); for (var k = 0; k < all.length; k++) all[k].classList.toggle('on', all[k] === b); };
      row.appendChild(b);
    });
    sec.appendChild(row);
    return sec;
  }
  function countText(p){ var n = p.count || (p.tracks ? p.tracks.length : 0); return n ? n + ' ' + (p.src === 'yt' ? 'видео' : plural(n)) : ''; }
  // Наблюдатели за размером блоков выдачи: снимаем при каждой новой выдаче, чтобы старые узлы
  // не держались в памяти на длинном стриме (ревью 01.11)
  var sizeWatch = [];
  // через кадр: правка раскладки прямо в обработчике снова меняет размер — «ResizeObserver loop» (t20)
  function watchSize(el, fn){ if (!window.ResizeObserver) return; var pend = false; var ro = new ResizeObserver(function(){ if (pend) return; pend = true; requestAnimationFrame(function(){ pend = false; fn(); }); }); ro.observe(el); sizeWatch.push(ro); }
  function dropSizeWatch(){ sizeWatch.forEach(function (ro){ try { ro.disconnect(); } catch (e) {} }); sizeWatch = []; }
  // S7: плейлисты — до 3 строк, листаются вбок теми же стрелками; в конце догружаются плейлисты Яндекса
  function plsSection(title, pls, fetchMore){
    var sec = document.createElement('div'); sec.className = 'xsec'; sec.dataset.pls = '1';
    var row = document.createElement('div'); row.className = 'pls';
    function card(p){
      var b = document.createElement('button'); b.className = 'plc'; b.dataset.src = p.src;
      b.innerHTML = (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="">' : '<span class="ph"></span>') +
        '<span class="mm"><b>' + esc(p.title) + '</b><small>' + srcDot(p) + srcName(p) + (countText(p) ? ' · ' + countText(p) : '') + (p.author ? ' · ' + esc(p.author) : '') + '</small></span>';
      b.onclick = function(){ openSearchList(p); };
      return b;
    }
    var have = {}, loading = false;
    function plKey(p){ return p.src + ':' + (p.uid || '') + ':' + (p.kind || p.listId || p.title); }
    function addNew(list){ (list || []).forEach(function (p){ var k = plKey(p); if (have[k]) return; have[k] = 1; row.appendChild(card(p)); }); }
    addNew(pls);
    // Сколько строк: влезают в одну — одна; иначе до трёх, остальное — вбок
    var CARD_W = 254;
    function layout(){
      var w = row.clientWidth || (sec.clientWidth - 70); if (!w) return;
      var per = Math.max(1, Math.floor(w / CARD_W)), n = row.children.length;
      var t = 'repeat(' + Math.max(1, Math.min(3, Math.ceil(n / per))) + ', auto)';
      if (row.style.gridTemplateRows !== t) row.style.gridTemplateRows = t;
    }
    var car;
    async function load(){
      if (loading || !fetchMore) return;
      var f = fetchMore, tok = searchToken; fetchMore = null; loading = true;
      var list = []; try { list = (await f()) || []; } catch (e) {}
      loading = false;
      if (tok !== searchToken || !sec.isConnected) return;   // уже ищем другое
      addNew(list); layout(); if (car) car();
    }
    // опоздавшие плейлисты (YouTube) дописываются в конец, без перерисовки блока
    sec._addPls = function (list){ addNew(list); layout(); if (car) car(); };
    car = carousel(sec, title, row, function (){ return !!fetchMore; }, load);
    requestAnimationFrame(function(){ layout(); car(); });
    watchSize(row, layout);
    return sec;
  }

  function appendResults(list, host) {
    host = host || results;
    var added = 0;
    list.forEach(function (v) {
      if (!v || !v.id) return;
      if (host === results) { if (shownIds.has(v.src + v.id)) return; shownIds.add(v.src + v.id); }
      added++;
      host.appendChild(makeRow(v));
    });
    return added;
  }

  // Подгрузка следующей порции, когда долистали почти до конца
  async function maybeLoadMore() {
    if (loadingMore || !curQuery || results.hidden || curFilter === 'sc' || curFilter === 'au' || curFilter === 'lc') return;
    if (results.scrollTop + results.clientHeight < results.scrollHeight - 300) return;
    var useYm = curFilter === 'ym';
    if (useYm ? !hasMoreYm : (curFilter === 'yt' ? !hasMoreYt : !hasMoreYt)) return;
    loadingMore = true;
    var token = searchToken;
    var loader = document.createElement('div'); loader.className = 'muted'; loader.textContent = 'Загружаю ещё…';
    results.appendChild(loader);
    var more = useYm ? await A.ymSearchPage(curQuery, ymPage++) : await A.ytSearchMore(curQuery, shownIds.size + 20);
    loader.remove();
    loadingMore = false;
    if (token !== searchToken) return;
    if (!more || more.error || !Array.isArray(more)) { if (useYm) hasMoreYm = false; else hasMoreYt = false; return; }
    if (!useYm) more = more.map(function (v){ v.src = 'yt'; return v; });
    if (addTracks(more, false) === 0) { if (useYm) hasMoreYm = false; else hasMoreYt = false; return; }
    maybeLoadMore();
  }
  results.addEventListener('scroll', maybeLoadMore);
  $('smode').onclick = function(e){ e.stopPropagation(); if (ctxEl) closeCtx(); openSmodeMenu(); };

  function makeRow(v) {
    var row = document.createElement('div'); row.className = 'row' + (v.id === playingId ? ' playing' : '');
    row.dataset.id = v.id; row._v = v;
    row.dataset.src = srcOf(v);
    row.innerHTML =
      '<div class="cover-wrap"><img class="cover" src="' + esc(v.thumb) + '" alt="">' +
      '<span class="cover-ov"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"></path></svg></span></div>' +
      '<div class="meta"><div class="t">' + esc(v.title) + '</div>' + subLine(v) + '</div>';
    if (srcOf(v) === 'ym' && !ymLoggedIn) {
      var lg = document.createElement('span'); lg.className = 'rbadge'; lg.textContent = 'нужен вход';
      lg.title = 'Без входа Яндекс играет только отрывок 30 секунд — нажми «Войти в Яндекс»';
      badgeBox(row).appendChild(lg);
    } else if (v._acc === 'preview') { var pv = document.createElement('span'); pv.className = 'rbadge'; pv.textContent = 'отрывок'; pv.title = 'Площадка даёт только 30 секунд (нет подписки)'; badgeBox(row).appendChild(pv); }
    if (v.alts && v.alts.length) {
      var vb = document.createElement('button'); vb.className = 'rbadge vers';
      var srcs = []; v.alts.forEach(function (a){ var n = srcName(a); if (srcs.indexOf(n) < 0) srcs.push(n); });
      vb.textContent = '+' + v.alts.length + ' ' + verWord(v.alts.length); vb.title = 'Эта же песня: ' + srcs.join(', ');
      vb.onclick = function(e){ e.stopPropagation(); var r = vb.getBoundingClientRect(); openVersionsMenu(r.left, r.bottom + 4, v); };
      badgeBox(row).appendChild(vb);
    }
    // Кнопки и длина трека — одним блоком в конце строки
    var acts = document.createElement('div'); acts.className = 'ract';
    var add = document.createElement('button'); add.className = 'add';
    add.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>В очередь';
    add.onclick = function(e){ e.stopPropagation(); addToQueue(v); };
    // «Играть следующим» — только значок, вид как у «⋯»
    var nxt = document.createElement('button'); nxt.className = 'nxt'; nxt.title = 'Играть следующим'; nxt.setAttribute('aria-label', 'Играть следующим');
    nxt.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14M12 20V9M7 13l5-5 5 5"></path></svg>';
    nxt.onclick = function(e){ e.stopPropagation(); addNext(v); };

    var more = document.createElement('button'); more.className = 'more'; more.title = 'Ещё'; more.setAttribute('aria-label', 'Ещё действия'); more.setAttribute('aria-haspopup', 'menu');
    more.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"></circle><circle cx="12" cy="12" r="1.9"></circle><circle cx="19" cy="12" r="1.9"></circle></svg>';
    more.onclick = function(e){ e.stopPropagation(); if (more._skip) { more._skip = false; return; } var r = more.getBoundingClientRect(); openTrackMenu(r.right - 4, r.bottom + 4, v, true); };
    more.onmousedown = function(e){ e.stopPropagation(); if (ctxEl) { closeCtx(); more._skip = true; } };
    acts.appendChild(more);
    acts.appendChild(nxt);
    acts.appendChild(add);
    var tm = document.createElement('span'); tm.className = 'time mono'; tm.textContent = v.duration || '';
    acts.appendChild(tm);
    row.appendChild(acts);
    row.oncontextmenu = function(e){ e.preventDefault(); openTrackMenu(e.clientX, e.clientY, v); };
    row.onclick = function(){ playNow(v); };
    return row;
  }
  function badgeBox(row){ var b = row.querySelector('.rbs'); if (!b) { b = document.createElement('div'); b.className = 'rbs'; row.querySelector('.meta').appendChild(b); } return b; }
  function verWord(n){ n = n % 100; if (n >= 11 && n <= 14) return 'версий'; n = n % 10; if (n === 1) return 'версия'; if (n >= 2 && n <= 4) return 'версии'; return 'версий'; }
  // «Другие версии»: та же песня на других площадках или в других альбомах
  function openVersionsMenu(x, y, v){
    var items = [];
    [v].concat(v.alts || []).forEach(function (a, k){
      var lbl = srcName(a) + ' · ' + (a.author ? a.author + ' — ' : '') + a.title + (a.duration ? ' · ' + a.duration : '');
      if (lbl.length > 70) lbl = lbl.slice(0, 69) + '…';
      items.push({ label: (k === 0 ? '★ ' : '▶ ') + lbl, act: function(){ playNow(a); } });
    });
    items.push('-');
    items.push({ label: 'Все версии — в конец очереди', act: function(){ addMany([v].concat(v.alts || [])); } });
    showCtx(x, y, items);
  }
  function markPlayingRows(){
    var rows = document.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('playing', rows[i].dataset.id === playingId);
  }

  // Фильтр по источнику: Везде / Яндекс / YouTube
  var curFilter = 'all';
  $('chips').addEventListener('click', function(e){
    var b = e.target.closest('.chip'); if (!b || b.disabled || !b.dataset.f) return;
    if (b.dataset.f === 'yt' && SVC.ytOn && !ytUsable()) { SVC.ytDownAt = 0; renderSvc(); if (search.value.trim()) doSearch(); return; }
    curFilter = b.dataset.f;
    var all = this.querySelectorAll('.chip[data-f]');
    for (var k = 0; k < all.length; k++) all[k].classList.toggle('active', all[k] === b);
    results.dataset.f = curFilter;
    maybeLoadMore();
  });

