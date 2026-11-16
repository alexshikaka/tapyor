  // ===== Книги и подкасты: переключатель в поиске, выдача, страницы =====
  // Переключатель делит выдачу по смыслу: музыка — речь. В режиме «Книги и подкасты»
  // музыка не ищется вовсе, поэтому он быстрее обычного поиска.

  var searchKind = 'all';   // all | mus | sp
  var spCache = {};         // запрос → найденное: переключение режима не ищет заново
  var spSaved = [];         // сохранённые книги и подкасты (вкладка «Книги и подкасты»)
  if (A.getSetting) A.getSetting('speechSaved').then(function (v){ spSaved = Array.isArray(v) ? v : []; });

  function chapWord(n){ n = n % 100; if (n >= 11 && n <= 14) return 'глав'; n = n % 10; if (n === 1) return 'глава'; if (n >= 2 && n <= 4) return 'главы'; return 'глав'; }
  function epWord(n){ n = n % 100; if (n >= 11 && n <= 14) return 'выпусков'; n = n % 10; if (n === 1) return 'выпуск'; if (n >= 2 && n <= 4) return 'выпуска'; return 'выпусков'; }
  function spKindName(m){ return m.sp === 'book' ? 'книга' : 'подкаст'; }
  // Значок типа: книга или микрофон — чтобы одно от другого было видно с первого взгляда
  var SP_IC_BOOK = '<svg class="spic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"></path><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"></path></svg>';
  var SP_IC_POD = '<svg class="spic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg>';
  function spIcon(m){ return m.sp === 'book' ? SP_IC_BOOK : SP_IC_POD; }
  function spCount(m){ var n = m.count || (m.tracks ? m.tracks.length : 0); return n ? n + ' ' + (m.sp === 'book' ? chapWord(n) : epWord(n)) : ''; }
  function spLong(sec){ sec = Math.round(sec || 0); var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? h + ' ч ' + (m ? m + ' мин' : '') : m + ' мин'; }

  function spFind(q){
    if (spCache[q]) return Promise.resolve(spCache[q]);
    if (!A.ymSpeechSearch || SVC.ymOn === false) return Promise.resolve([]);
    return A.ymSpeechSearch(q).then(function (list){
      list = Array.isArray(list) ? list : [];
      spCache[q] = list;
      return list;
    }).catch(function(){ return []; });
  }

  // Режим «Всё»: книги и подкасты идут блоком, как плейлисты, и приходят поздним источником
  function spLateBlock(q, token){
    spFind(q).then(function (list){
      if (token !== searchToken || !list.length || !results.isConnected) return;
      var sec = spSection(list);
      var lbl = Array.prototype.find.call(results.querySelectorAll('.xlbl'), function (x){ return x.textContent === 'Треки'; });
      if (lbl) { results.insertBefore(sec, lbl); return; }
      var area = results.querySelector('.tarea');
      if (area) results.insertBefore(sec, area); else results.appendChild(sec);
    });
  }
  function spSection(list){
    var sec = document.createElement('div'); sec.className = 'xsec';
    var row = document.createElement('div'); row.className = 'pls';
    list.forEach(function (m){
      var b = document.createElement('button'); b.className = 'plc'; b.dataset.src = 'ym';
      b.innerHTML = (m.thumb ? '<img src="' + esc(m.thumb) + '" alt="">' : '<span class="ph"></span>') +
        '<span class="mm"><b>' + esc(m.title) + '</b><small>' + spIcon(m) + ' ' + spKindName(m) +
        (spCount(m) ? ' · ' + spCount(m) : '') + (m.author ? ' · ' + esc(m.author) : '') + '</small></span>';
      b.onclick = function(){ openSpeechPage(m); };
      row.appendChild(b);
    });
    carousel(sec, 'Книги и подкасты', row);
    return sec;
  }

  // Режим «Книги и подкасты»: обычные строки, как у треков
  async function spOnlyResults(q, token){
    var list = await spFind(q);
    if (token !== searchToken) return;
    results.innerHTML = '';
    renderSearchBack();
    setHint('');
    if (!list.length) {
      var note = document.createElement('div'); note.className = 'muted';
      note.textContent = ymLoggedIn ? 'Книг и подкастов не нашлось.' : 'Войди в Яндекс — книги и подкасты берутся оттуда.';
      results.appendChild(note); return;
    }
    var lbl = document.createElement('div'); lbl.className = 'xlbl'; lbl.style.padding = '0 8px 4px';
    lbl.textContent = 'Книги и подкасты';
    results.appendChild(lbl);
    list.forEach(function (m){ results.appendChild(spRow(m)); });
  }
  function spRow(m){
    var row = document.createElement('div'); row.className = 'row'; row.dataset.src = 'ym';
    row.innerHTML =
      '<div class="cover-wrap"><img class="cover" src="' + esc(m.thumb || '') + '" alt="">' +
      '<span class="cover-ov"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg></span></div>' +
      '<div class="meta"><div class="t">' + esc(m.title) + '</div>' +
      '<div class="s sub">' + spIcon(m) + ' ' + spKindName(m) + ' · Яндекс' +
      (m.author ? ' · ' + esc(m.author) : '') + (spCount(m) ? ' · ' + spCount(m) : '') + '</div></div>';
    row.onclick = function(){ openSpeechPage(m); };
    return row;
  }

  // ----- страница книги или подкаста -----
  function spMarkIndex(tracks, mk){
    if (!mk) return 0;
    for (var i = 0; i < tracks.length; i++) if (String(tracks[i].id) === String(mk.id)) return i;
    return Math.max(0, Math.min(tracks.length - 1, (mk.idx || 1) - 1));
  }
  function spSlim(m){
    return { src: 'ym', sp: m.sp, albumId: m.albumId, workId: m.workId, title: m.title,
      author: m.author || '', count: m.count || (m.tracks ? m.tracks.length : 0), thumb: m.thumb || '', at: Date.now() };
  }
  function spSavedAt(m){ for (var i = 0; i < spSaved.length; i++) if (spSaved[i].workId === m.workId) return i; return -1; }
  function spToggleSave(m){
    var i = spSavedAt(m);
    if (i >= 0) spSaved.splice(i, 1);
    else { var sl = spSlim(m); if (m.tracks && m.tracks[0] && m.tracks[0].pub) sl.seen = m.tracks[0].pub; spSaved.unshift(sl); }
    if (A.setSetting) A.setSetting('speechSaved', spSaved.slice(0, 300));
    toast(i >= 0 ? 'Убрано из «Книг и подкастов»' : 'Сохранено в «Книги и подкасты»');
    return i < 0;
  }
  function openSpeechPage(m){ results.hidden = true; $('searchPl').hidden = false; renderSpeechView($('searchPl'), m); }

  async function renderSpeechView(host, m, opts){
    opts = opts || {};
    var tok = host._tok = (host._tok || 0) + 1;
    host._backFn = null;
    var back = opts.noBack ? '' : '<button class="back" data-back="1">← Назад к поиску</button>';
    host.innerHTML = back + '<div class="muted">Загружаю «' + esc(m.title || '') + '»…</div>';
    bindBack(host);
    var L = m.tracks ? m : await A.ymSpeech(m.albumId, m.sp);
    if (host._tok !== tok) return;
    if (!L || L.error) {
      host.innerHTML = back + '<div class="muted">Не удалось открыть: ' + esc((L && L.error) || 'ошибка') + '</div>';
      bindBack(host); return;
    }
    L.sp = L.sp || m.sp; L.workId = L.workId || m.workId; L.albumId = L.albumId || m.albumId;
    if (L.sp === 'book' && L.tracks && L.tracks.length) spBooks[spKeyOf(L.tracks[0])] = L;
    if (L.sp === 'pod' && L.tracks && L.tracks[0] && L.tracks[0].pub && typeof bkMarkSeen === 'function') {
      if (typeof bkFresh !== 'undefined') bkFresh[L.workId] = { at: Date.now(), L: L };
      bkMarkSeen(L.workId, L.tracks[0].pub);
    }
    var book = L.sp === 'book', tracks = L.tracks || [];
    var mk = spMark(L), at = spMarkIndex(tracks, mk);
    var doneBook = !!(book && mk && mk.done);
    var eps = (mk && mk.eps && typeof mk.eps === 'object') ? mk.eps : {};
    var total = 0; tracks.forEach(function (t){ total += t.seconds || 0; });
    var done = 0; for (var i = 0; i < at; i++) done += tracks[i].seconds || 0;
    if (mk) done += mk.sec || 0;
    var pct = total ? Math.max(0, Math.min(100, Math.round(done * 100 / total))) : 0;
    var saved = spSavedAt(L) >= 0;

    var btns = '';
    if (book) {
      if (doneBook) {
        btns += '<button class="pbtn y" data-a="restart"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"></path></svg>Слушать сначала</button>';
      } else {
        btns += '<button class="pbtn y" data-a="listen"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"></path></svg>' +
          (mk ? 'Продолжить слушать · глава ' + (at + 1) + ', ' + fmt(mk.sec) : 'Слушать') + '</button>';
        if (mk) btns += '<button class="pbtn" data-a="restart">Слушать сначала</button>';
      }
      btns += '<button class="pbtn" data-a="queue">＋ Книгу в очередь</button>';
    } else {
      // Подкаст: выпуски от новых к старым. «Слушать всё» заменяет очередь, «Всё в очередь» — в конец
      btns += '<button class="pbtn y" data-a="all" title="Заменить очередь всеми выпусками — от последнего к первому"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"></path></svg>Слушать всё</button>';
      btns += '<button class="pbtn" data-a="allq" title="Все выпуски в конец очереди — от последнего к первому">＋ Всё в очередь</button>';
      if (mk) btns += '<button class="pbtn" data-a="listen">Продолжить · ' + esc(mk.ep ? String(mk.ep).slice(0, 28) + ', ' : '') + fmt(mk.sec) + '</button>';
    }
    btns += '<button class="pbtn" data-a="save">' + (saved ? (book ? 'Убрать из сохранённых' : 'Не следить') : (book ? 'Сохранить' : 'Следить')) + '</button>';

    host.innerHTML = back +
      '<div class="plhead">' + (L.thumb ? '<img class="pcov" src="' + esc(L.thumb) + '" alt="">' : '<div class="pcov"></div>') +
        '<div class="pinfo"><div class="pk">' + spIcon(L) + ' ' + spKindName(L) + ' · Яндекс</div>' +
        '<div class="ptitle"><h3>' + esc(L.title || '') + '</h3><span class="pcount">' + spCount(L) +
        (total ? ' · ' + spLong(total) : '') + (doneBook ? ' · дослушано' : '') + '</span></div>' +
        '<div class="pm">' + esc(L.author || '') + '</div>' +
        '<div class="plbtns">' + btns + '</div></div></div>' +
      (book && mk && !doneBook ? '<div class="plnote" style="display:flex;align-items:center;gap:10px">' +
        '<span style="flex:1 1 auto;height:6px;border-radius:3px;background:var(--bg3);overflow:hidden;display:block">' +
        '<i style="display:block;height:6px;width:' + pct + '%;background:var(--ac)"></i></span>' +
        '<span>прослушано ' + pct + ' %</span></div>' : '') +
      (L.about ? '<div class="plnote">' + esc(String(L.about).slice(0, 400)) + '</div>' : '') +
      '<div class="plrows"></div>';
    bindBack(host);

    var rowsBox = host.querySelector('.plrows');
    if (!tracks.length) rowsBox.innerHTML = '<div class="muted">Здесь пусто.</div>';
    tracks.forEach(function (t, i){
      var r = makeRow(t);
      if (book) r.onclick = function(){ spPlayFrom(L, i, 0); };
      if (!book) {
        var ep = eps[String(t.id)];
        if (ep && (ep.done || ep.sec > 0)) {
          var meta = r.querySelector('.meta');
          var line = document.createElement('div');
          line.className = 'sp-ep';
          if (ep.done) {
            line.innerHTML = '<span class="sp-ep-done">✓ дослушано</span>';
            r.onclick = function(){ spPlayEpisode(t, 0); };
          } else {
            var left = Math.max(0, (ep.dur || t.seconds || 0) - (ep.sec || 0));
            var pc = ep.dur ? Math.max(1, Math.min(100, Math.round(ep.sec * 100 / ep.dur))) : 0;
            line.innerHTML = '<span class="sp-ep-bar"><i style="width:' + pc + '%"></i></span>' +
              '<span>осталось ' + spLong(left) + '</span>';
            r.onclick = function(){ spPlayEpisode(t, ep.sec || 0); };
          }
          if (meta) meta.appendChild(line);
        }
      }
      if (i === at && mk) r.classList.add('playing');
      rowsBox.appendChild(r);
    });

    host.querySelector('.plbtns').onclick = function(e){
      var b = e.target.closest('button'); if (!b) return;
      var a = b.dataset.a;
      if (a === 'save') { renderSpeechView(host, L, opts); if (typeof bkRefresh === 'function') bkRefresh(); return; }
      if (!tracks.length) return;
      if (a === 'listen' && !book) { spPlayEpisode(tracks[at], mk ? mk.sec : 0); return; }
      if (a === 'all') { spReplaceWith(tracks); toast('Играют все выпуски «' + (L.title || '') + '» · ' + tracks.length); return; }
      if (a === 'allq') { addMany(tracks, true); toast('В очереди все выпуски · ' + tracks.length); return; }
      if (a === 'listen') spPlayFrom(L, at, mk ? mk.sec : 0);
      else if (a === 'restart') spPlayFrom(L, 0, 0);
      else if (a === 'queue') spPackBook(tracks[at], 'end');

    };
    // «Сохранить» меняет список до перерисовки страницы
    host.querySelector('[data-a="save"]').addEventListener('mousedown', function(){ spToggleSave(L); }, true);
  }

  // ----- любая кнопка у главы — вся книга -----
  var spBooks = {}; // ключ книги → загруженная книга со всеми главами
  function spBookFor(v){
    var key = spKeyOf(v);
    if (spBooks[key]) return Promise.resolve(spBooks[key]);
    var id = v.albumId || String(key).replace(/^ym:/, '');
    if (!A.ymSpeech || !id) return Promise.resolve(null);
    return A.ymSpeech(id, 'book').then(function (L){
      if (!L || L.error || !(L.tracks && L.tracks.length)) return null;
      spBooks[key] = L; return L;
    }).catch(function(){ return null; });
  }
  // mode: now — играть с этой главы; next — вся книга следующей; end — вся книга в конец
  async function spPackBook(v, mode){
    var key = spKeyOf(v), k;
    // книга уже стоит в очереди — работаем с ней, вторую копию не ставим
    for (k = 0; k < queue.length; k++) if (spKeyOf(queue[k]) === key) {
      var b = spBlockOf(k), at = b.s;
      for (var j = 0; j < b.n; j++) if (String(queue[b.s + j].id) === String(v.id)) { at = b.s + j; break; }
      if (mode === 'now') { spActivate(at, 0); return; }
      if (mode === 'next' && !(current >= b.s && current < b.s + b.n)) { spMoveBook(b.s, b.n, spSnapDrop(reqInsertAt())); toast('Книга — следующей'); return; }
      toast('Эта книга уже в очереди'); return;
    }
    toast('Загружаю книгу целиком…');
    var L = await spBookFor(v);
    if (!L) {
      axLog('книга: не удалось загрузить главы «' + (v.workTitle || v.title) + '» — ставлю одну главу');
      L = { tracks: [v], albumId: v.albumId, workId: key, title: v.workTitle || v.title };
    }
    var tracks = L.tracks, idx = 0;
    for (k = 0; k < tracks.length; k++) if (String(tracks[k].id) === String(v.id)) { idx = k; break; }
    if (mode === 'now') { spPlayFrom(L, idx, 0); return; }
    var pos = mode === 'next' ? spSnapDrop(reqInsertAt()) : queue.length;
    var copies = tracks.map(function (t){ var c = copyTrack(t); c.fromList = true; return c; });
    Array.prototype.splice.apply(queue, [pos, 0].concat(copies));
    axLog('книга: «' + (L.title || v.workTitle) + '» — ' + copies.length + ' ' + chapWord(copies.length) + (mode === 'next' ? ' следующей' : ' в конец очереди'));
    renderQueue(); saveToday();
    if (isIdle() && !(queue[current] && queue[current].bg && !isIdle())) playIndex(pos + idx);
    else { prefetchNext(); toast(mode === 'next' ? 'Книга — следующей' : 'Книга в очереди'); }
  }

  // «Слушать всё»: очередь заменяется списком. Отыгравшее остаётся сверху, ждущие заказы —
  // сразу под первым треком (как «Играть» в классике), остальное ждущее уходит
  function spReplaceWith(tracks){
    if (!tracks || !tracks.length) return;
    var copies = tracks.map(function (t){ var c = copyTrack(t); c.fromList = true; return c; });
    var cut = isClassic() ? 0 : afterCur();
    var head = queue.slice(0, cut), tail = queue.slice(cut);
    var greens = tail.filter(function (v){ return v.req && !v.played; });
    queue = head.concat([copies[0]], greens, copies.slice(1));
    if (isClassic()) current = -1;
    axLog('очередь: заменена — ' + copies.length + ' (' + (copies[0].workTitle || copies[0].title) + '), убрано ждущих ' + (tail.length - greens.length));
    playIndex(head.length);
  }
  // Выпуск подкаста с запомненной секунды
  function spPlayEpisode(t, sec){
    if (!t) return;
    var at = afterCur(), c = copyTrack(t);
    if (sec > 0) spResumeAt(c, sec);
    queue.splice(at, 0, c);
    playIndex(at);
  }

  // Включить книгу с нужной главы: вся книга уходит в очередь, играет выбранная глава
  function spPlayFrom(L, idx, sec){
    var tracks = L.tracks || []; if (!tracks.length) return;
    lastScrolledKey = ''; // запуск со страницы книги — очередь всегда показывает книгу
    // Эта книга уже стоит в очереди — включаем её, а не добавляем вторую копию
    var key = 'ym:' + L.albumId, k;
    for (k = 0; k < queue.length; k++) if (spKeyOf(queue[k]) === key) {
      var b = spBlockOf(k), want = tracks[Math.max(0, Math.min(tracks.length - 1, idx || 0))];
      var at0 = b.s;
      for (var j = 0; j < b.n; j++) if (String(queue[b.s + j].id) === String(want.id)) { at0 = b.s + j; break; }
      spActivate(at0, sec);
      return;
    }
    var base = afterCur();
    var copies = tracks.map(function (t){ var c = copyTrack(t); c.fromList = true; return c; });
    Array.prototype.splice.apply(queue, [base, 0].concat(copies));
    var at = base + Math.max(0, Math.min(tracks.length - 1, idx || 0));
    if (sec > 0) spResumeAt(queue[at], sec);
    playIndex(at);
  }

  // ----- переключатель «Всё · Музыка · Книги и подкасты» -----
  (function(){
    var seg = $('kindSeg'); if (!seg) return;
    seg.addEventListener('click', function(e){
      var b = e.target.closest('button[data-k]'); if (!b || b.dataset.k === searchKind) return;
      searchKind = b.dataset.k;
      var all = seg.querySelectorAll('button[data-k]');
      for (var i = 0; i < all.length; i++) {
        var on = all[i] === b;
        all[i].classList.toggle('on', on);
        all[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (!$('searchPl').hidden) closeSearchList();
      if (search.value.trim()) doSearch({ back: true });
    });
  })();
