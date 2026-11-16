  // ===== Вкладка «Моё» =====
  var myLoaded = false, myPls = [], myErr = '', mySel = null, myItems = [], ytPls = [], ytMyErr = '';
  var YT_LIKED = { src: 'yt', type: 'liked', title: 'Понравившиеся на YouTube', author: 'YouTube', listId: 'LL' };
  var LIKED = { src: 'ym', type: 'liked', title: 'Мне нравится', author: 'Яндекс Музыка' };
  var DISLIKED = { src: 'ym', type: 'disliked', title: 'Не нравится', author: 'Яндекс Музыка' };
  var myWantLast = '';
  async function loadMy(force){
    if (myLoaded && !force) { renderMySide(); return; }
    myLoaded = true; myPls = []; myErr = '';
    renderMySide(true);
    // Показываем вкладку сразу: списки Яндекса и YouTube идут по сети и могут думать секунды
    // (а YouTube без входа ещё и падает по таймауту) — ждать их, чтобы нарисовать библиотеку, незачем
    if (!mySel && !imp && !impHost().querySelector('.imp')) {
      var want = myLast(), early = myFindById(want);
      myWantLast = early ? '' : want;
      selectMy(early || LIBRARY);
    }
    if (ymLoggedIn && A.ymMy) {
      var r = await A.ymMy();
      myPls = ((r && r.playlists) || []).map(function (p){ if (!p.saved) p.own = true; return p; });
      myErr = (r && r.error) || '';
    }
    ytPls = []; ytMyErr = '';
    if (A.ytAuthStatus) { await ytAuthRefresh(); }
    if (ytLogged() && A.ytMy) {
      var y = await A.ytMy();
      ytPls = (y && y.playlists) || []; ytMyErr = (y && y.error) || '';
    }
    renderMySide();
    // Списки пришли: открываем то, что было выбрано в прошлый раз, если оно с площадки
    if (myWantLast) {
      var late = myFindById(myWantLast); myWantLast = '';
      if (late && mySel && mySel.src === 'lib') { selectMy(late); return; }
    }
    if (!mySel && !imp && !impHost().querySelector('.imp')) { selectMy(myFindById(myLast()) || LIBRARY); return; }
    if (mySel && mySel.src === 'lib') renderLibrary($('myPl')); // в библиотеке прибавилось плиток
  }
  // ===== Кракозябры в своих плейлистах (0.34.0): проверка и исправление по кнопке =====
  // Причина — файл настроек когда-то перекодировали вне Тапёра. Здесь только показываем
  // плашку; исправление и копия настроек — в главном процессе (src/mojibake.js).
  var MOJI = { broken: 0, fixable: 0, unfixable: 0, foreign: 0, busy: false, checked: false, sig: '' };
  function mojiCheck(){
    if (!A.mojibakeCheck) return;
    A.mojibakeCheck().then(function (r){
      MOJI.checked = true;
      var ok = !!(r && r.ok);
      var own = ok ? (Number(r.broken) || 0) : 0;
      var fixable = ok ? (Number(r.fixable) || 0) : 0;
      var unfixable = ok ? (Number(r.unfixable) || 0) : 0;
      var foreign = ok ? (Number(r.foreign) || 0) : 0;
      var sig = own + '|' + fixable + '|' + unfixable + '|' + foreign;
      MOJI.broken = own; MOJI.fixable = fixable; MOJI.unfixable = unfixable; MOJI.foreign = foreign;
      // Раньше плашка не перерисовывалась, если общее число не поменялось, и могла
      // остаться со старым текстом. Теперь важен любой сдвиг: починено, осталось, чужое.
      if (sig !== MOJI.sig) { MOJI.sig = sig; if (curTab === 'my') renderMySide(); }
    }).catch(function(){});
  }
  // Плашка в «Моих плейлистах»: честно пишем, сколько строк починим, сколько не выйдет
  // и сколько испорченного относится к чужим плейлистам (их программа не трогает).
  function mojiPlate(){
    // Хотфикс 0.36.3: плашку показываем, только пока есть что исправить кнопкой. Если
    // осталось лишь неисправимое (символы, которых нет в старой кодировке) или только
    // чужие плейлисты (их программа не трогает) — нажать всё равно нечего, плашка просто
    // нагоняла бы вечное напоминание ни о чём.
    if (!MOJI.fixable) return '';
    var h = '<div class="moji">';
    h += '<span>Названия своих плейлистов испорчены — в файле настроек неправильная кодировка.</span> ';
    h += '<button class="pbtn y" data-moji="1"' + (MOJI.busy ? ' disabled' : '') + '>' + (MOJI.busy ? 'Исправляю…' : 'Исправить') + '</button> ';
    h += '<span class="sd">— исправлю ' + MOJI.fixable + ', перед этим будет копия настроек.' +
      (MOJI.unfixable ? ' Ещё ' + MOJI.unfixable + ' восстановить не выйдет: в них символы, которых нет в старой кодировке.' : '') +
      (MOJI.foreign ? ' Ещё ' + MOJI.foreign + ' — не плейлисты Тапёра, их не трогаем.' : '') + '</span>';
    h += '</div>';
    return h;
  }
  function mojiReload(){
    if (!A.getSetting) { renderMySide(); return Promise.resolve(); }
    return A.getSetting('savedLists').then(function (v){
      savedLists = (Array.isArray(v) ? v : []).filter(function (x){ return x && x.src === 'tap'; });
      var reOpen = mySel && mySel.src === 'tap' ? localGet(listId(mySel)) : null;
      if (reOpen) mySel = reOpen;
      renderMySide();
      if (reOpen) renderListView($('myPl'), reOpen, false);
    }).catch(function(){ renderMySide(); });
  }
  function mojiApply(){
    if (!A.mojibakeFix || MOJI.busy) return;
    MOJI.busy = true;
    if (curTab === 'my') renderMySide();
    // Ошибка может случиться и до ответа: Promise.resolve ловит синхронное исключение,
    // finally снимает «занято» при любом исходе — успех, частичная починка, ошибка.
    var p;
    try { p = A.mojibakeFix(); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (r){
      if (!r || !r.ok) { toast('Не исправил: ' + ((r && r.error) || 'ошибка')); return null; }
      var parts = [];
      if (r.fixed) parts.push('исправлено ' + r.fixed);
      if (r.failed) parts.push('не вышло ' + r.failed);
      if (r.skipped) parts.push('чужих не трогаю ' + r.skipped);
      toast(parts.length ? 'Кодировка: ' + parts.join(' · ') : 'Исправлять нечего');
      // Перечитываем: плашка покажет, что осталось и почему, а не прежнее число.
      return mojiReload();
    }).catch(function (e){
      toast('Не исправил: ' + ((e && e.message) || e));
    }).finally(function (){
      MOJI.busy = false;
      if (curTab === 'my') renderMySide();
      mojiCheck();
    });
  }
  mojiCheck();
  // ===== Обложки плейлистов: свои (настройка plCovers), цвет пилюли по обложке, меню плейлиста =====
  var plCovers = {};
  if (A.getSetting) A.getSetting('plCovers').then(function (v){ plCovers = (v && typeof v === 'object') ? v : {}; if (curTab === 'my') renderMySide(); });
  var LIKED_GRAD = { ym: { t: 'grad', a: '#FF3D6E', b: '#9B87FF' }, yt: { t: 'grad', a: '#FF4E45', b: '#FF8A3D' } };
  function coverFor(m){
    if (!m) return null;
    var c = plCovers[listId(m)]; if (c) return c;
    if (m.type === 'liked') return LIKED_GRAD[m.src === 'yt' ? 'yt' : 'ym'];
    if (m.type === 'disliked') return { t: 'grad', a: '#6EA8FF', b: '#3B4A6B' };
    if (m.src === 'lc') return { t: 'grad', a: '#4ADE9A', b: '#2A7A5A' };
    var th = m.thumb || (m.tracks ? ((m.tracks.find(function (t){ return t.thumb; }) || {}).thumb || '') : '');
    return th ? { t: 'img', src: th } : null;
  }
  function coverHtml(c, cls, emptyStyle){
    if (!c) return '<span class="' + cls + ' ph"' + (emptyStyle ? ' style="' + emptyStyle + '"' : '') + '></span>';
    if (c.t === 'img') return '<img class="' + cls + '" src="' + esc(c.src) + '" alt="" loading="lazy" decoding="async">';
    if (c.t === 'grad') return '<span class="' + cls + ' ph" style="background:linear-gradient(135deg,' + esc(c.a) + ',' + esc(c.b) + ')"></span>';
    if (c.t === 'grid') return '<span class="' + cls + ' ph cgrid">' + c.srcs.slice(0, 4).map(function (u){ return '<img src="' + esc(u) + '" alt="" loading="lazy">'; }).join('') + '</span>';
    return '<span class="' + cls + ' ph"></span>';
  }
  // Окно «Обложка плейлиста»: варианты от Тапёра + своя картинка
  async function pickCover(m){
    var tracks = m.tracks;
    if (!tracks && m.src !== 'lc') { var r0 = await loadList(m).catch(function(){ return null; }); tracks = (r0 && r0.tracks) || []; }
    if (m.src === 'lc') tracks = (await libTracks()).filter(function (t){ return m.type !== 'folder' || (t.path || '').indexOf(m.path) === 0; });
    var seen = {}, thumbs = (tracks || []).map(function (t){ return t.cover || t.thumb; }).filter(function (u){ if (!u || seen[u]) return false; seen[u] = 1; return true; }).slice(0, 8);
    var base = colorFor(m.title || '');
    var GR = [[base, '#1E2029'], ['#9B87FF', '#4A3F8F'], ['#FF3D6E', '#9B87FF'], ['#FFB86B', '#C2410C'], ['#4ADE9A', '#2A7A5A'], ['#3BA8F0', '#1E3A8A'], ['#F472B6', '#7C3AED'], ['#E5E7EB', '#6B7280']];
    var opts = [];
    if (thumbs.length >= 4) opts.push({ t: 'grid', srcs: thumbs.slice(0, 4), n: 'Коллаж из 4 обложек' });
    thumbs.forEach(function (u){ opts.push({ t: 'img', src: u, n: 'Обложка песни' }); });
    GR.forEach(function (g){ opts.push({ t: 'grad', a: g[0], b: g[1], n: 'Цвет' }); });
    var ov = document.createElement('div'); ov.className = 'ask-ov';
    ov.innerHTML = '<div class="ask cov-dlg" role="dialog" aria-modal="true" aria-label="Обложка плейлиста"><h4>Обложка «' + esc(m.title) + '»</h4><p>Тапёр предлагает варианты из песен плейлиста и цвета. Можно загрузить свою картинку.</p>' +
      '<div class="cov-grid">' + opts.map(function (o, k){ return '<button class="cov-o" data-k="' + k + '" title="' + esc(o.n) + '">' + coverHtml(o, 'cov-i') + '</button>'; }).join('') +
      '<label class="cov-o cov-up" title="Загрузить картинку"><input type="file" accept="image/*" hidden><span>＋<br>Своя<br>картинка</span></label></div>' +
      '<div class="ask-b">' + (plCovers[listId(m)] ? '<button class="pbtn g" data-x="reset">Как было</button>' : '') + '<button class="pbtn g" data-x="0">Отмена</button></div></div>';
    document.body.appendChild(ov);
    function done(c){ ov.remove(); document.removeEventListener('keydown', key, true); if (c === undefined) return; if (c) plCovers[listId(m)] = c; else delete plCovers[listId(m)]; if (A.setSetting) A.setSetting('plCovers', plCovers); renderMySide(); if (mySel && listId(mySel) === listId(m)) selectMy(mySel); toast(c ? 'Обложка изменена' : 'Обложка как была'); }
    function key(e){ if (e.key === 'Escape') { e.stopPropagation(); done(undefined); } }
    document.addEventListener('keydown', key, true);
    ov.onclick = function(e){
      if (e.target === ov) { done(undefined); return; }
      var b = e.target.closest('[data-k]'); if (b) { var o = opts[+b.dataset.k]; done(o.t === 'img' ? { t: 'img', src: o.src } : (o.t === 'grid' ? { t: 'grid', srcs: o.srcs } : { t: 'grad', a: o.a, b: o.b })); return; }
      var x = e.target.closest('[data-x]'); if (x) done(x.dataset.x === 'reset' ? null : undefined);
    };
    ov.querySelector('input[type=file]').onchange = function(){
      var f = this.files && this.files[0]; if (!f) return;
      createImageBitmap(f).then(function (bm){
        var S = 300, cv = document.createElement('canvas'); cv.width = cv.height = S;
        var sc = Math.max(S / bm.width, S / bm.height), w = bm.width * sc, h = bm.height * sc;
        cv.getContext('2d').drawImage(bm, (S - w) / 2, (S - h) / 2, w, h);
        done({ t: 'img', src: cv.toDataURL('image/jpeg', 0.85) });
      }).catch(function(){ toast('Не получилось открыть картинку'); });
    };
  }
  // Меню плейлиста по правой кнопке на пилюле
  async function listTracksOf(m){
    if (m.src === 'tap') return m;
    if (m.src === 'lc') { var all = await libTracks(); return { src: 'tap', type: 'tap', listId: 'lib-play', title: m.title, tracks: all.filter(function (t){ return m.type !== 'folder' || (t.path || '').indexOf(m.path) === 0; }) }; }
    var r = await loadList(m).catch(function(){ return null; });
    return r && !r.error ? Object.assign({}, m, r, { title: m.title }) : null;
  }
  function openListMenu(x, y, m){
    var local = m.src === 'tap', lc = m.src === 'lc';
    var ownYm = m.src === 'ym' && m.own && m.kind, ownYt = m.src === 'yt' && m.mine && m.listId && m.type === 'playlist';
    var withL = function (fn){ return async function(){ var L = await listTracksOf(m); if (!L || !(L.tracks || []).length) { toast('Плейлист пустой или не загрузился'); return; } fn(L); }; };
    var it = [];
    it.push({ label: 'В конец очереди — всё', act: withL(function (L){ addMany(L.tracks, true); }) });
    it.push({ label: BGL(), act: withL(function (L){ setBg({ kind: 'list', list: L, shuffle: false }, true); }) });
    it.push({ label: SHL(), act: withL(function (L){ setBg({ kind: 'list', list: L, shuffle: true }, true); }) });
    if (ymLoggedIn) it.push({ label: 'Волна по плейлисту', act: withL(function (L){ waveByList(L); }) });
    it.push('-');
    if (local) it.push({ label: 'Переименовать', act: function(){ localRename(m); } });
    else if (ownYm || ownYt) it.push({ label: 'Переименовать', act: async function(){ var L = await listTracksOf(m); platformRename(L || m, ownYm ? 'ym' : 'yt', $('myPl')); } });
    it.push({ label: 'Сменить обложку…', act: function(){ pickCover(m); } });
    if (!lc) {
      it.push({ label: 'Перенести на Яндекс Музыку…', act: withL(function (L){ transferList(L, 'ym'); }) });
      it.push({ label: 'Перенести на YouTube…', act: withL(function (L){ transferList(L, 'yt'); }) });
    }
    it.push({ label: 'Сохранить в файл M3U', act: withL(function (L){ exportM3u(L); }) });
    if (local && m.links && m.links.ym) it.push({ label: 'Синхронизировать с Яндексом', act: function(){ syncList(m, 'ym'); } });
    if (local && m.links && m.links.yt) it.push({ label: 'Синхронизировать с YouTube', act: function(){ syncList(m, 'yt'); } });
    if (!local && !lc) it.push({ label: 'Копия в мои плейлисты', act: withL(function (L){ var nm = localCreate(m.title, L.tracks); toast('Создан «' + nm.title + '» · ' + nm.tracks.length + ' ' + plural(nm.tracks.length), 'Переименовать', function(){ localRename(nm); }); }) });
    it.push({ label: 'Объединить с другими…', act: function(){ mergeSel = new Set([listId(m)]); mergeMap = {}; mergeMap[listId(m)] = m; renderMySide(); } });
    if (local || ownYm || ownYt || (lc && m.type === 'folder')) {
      it.push('-');
      if (local) it.push({ label: 'Удалить плейлист', danger: true, act: function(){ localDelete(m); } });
      else if (lc) it.push({ label: 'Убрать папку', danger: true, act: function(){ libDropFolder(m.path); } });
      else it.push({ label: 'Удалить ' + (ownYm ? 'на Яндексе' : 'на YouTube'), danger: true, act: async function(){ var L = await listTracksOf(m); platformDelete(L || m, ownYm ? 'ym' : 'yt'); } });
    }
    showCtx(x, y, it);
  }
  // Панель слева (28.10.2026): вместо вкладок — «Библиотека» и группы по площадкам.
  // Группы сворачиваются по нажатию на заголовок, состояние запоминается; «На компьютере» — последняя.
  var LIBRARY = { src: 'lib', type: 'library', listId: 'library', title: 'Библиотека' };
  // Цвета групп — те же, что у источников в остальной программе (см. SRC в 02-player.js)
  var MY_GROUPS = [{ id: 'tap', n: 'Тапёр' }, { id: 'ym', n: 'Яндекс' }, { id: 'yt', n: 'YouTube' }, { id: 'lc', n: 'На компьютере' }];
  function grpColor(id){ return srcColor({ src: id }); }
  var myShut = {};
  try { var sh = JSON.parse(localStorage.getItem('tapMyShut') || 'null'); if (sh && typeof sh === 'object') myShut = sh; } catch (e) {}
  function myToggleGroup(id){ myShut[id] = !myShut[id]; try { localStorage.setItem('tapMyShut', JSON.stringify(myShut)); } catch (e) { console.warn('Тапёр: не сохранились свёрнутые плейлисты', e); } renderMySide(); }
  // Что было открыто в прошлый раз: в первый раз — «Библиотека», дальше — последний выбранный пункт
  function saveMyLast(m){ try { localStorage.setItem('tapMyLast', m ? listId(m) : ''); } catch (e) { console.warn('Тапёр: не сохранился последний плейлист', e); } }
  function myLast(){ try { return localStorage.getItem('tapMyLast') || ''; } catch (e) { return ''; } }
  function myFindById(id){
    if (!id || id === listId(LIBRARY)) return id ? LIBRARY : null;
    var all = [LIKED, DISLIKED, YT_LIKED, LIBALL].concat(localLists(), myPls, ytPls);
    var hit = all.find(function (x){ return x && listId(x) === id; });
    if (hit) return hit;
    var f = LIB.folders.find(function (x){ return 'lc:fd:' + x.path === id; });
    return f ? { src: 'lc', type: 'folder', listId: 'fd:' + f.path, path: f.path, title: f.path.split(/[\\/]/).filter(Boolean).pop() || f.path } : null;
  }
  function myRow(m){
    var i = myItems.push(m) - 1;
    var on = mergeSel ? mergeSel.has(listId(m)) : (mySel && listId(mySel) === listId(m));
    return '<button class="mit' + (on ? ' on' : '') + (mergeSel ? ' msel' : '') + '" data-i="' + i + '">' +
      (mergeSel ? '<span class="mchk" aria-hidden="true">' + (on ? '✓' : '') + '</span>' : '') +
      '<span class="mm"><b>' + esc(m.title) + '</b></span></button>';
  }
  function renderMySide(loading){
    var side = $('mySide'); myItems = [];
    var mine = localLists();
    var own = myPls.filter(function (p){ return p.own; }), saved = myPls.filter(function (p){ return !p.own; });
    var h = '<div class="myact">' +
      '<button class="myab" data-new="1" data-tip="Пустой плейлист Тапёра"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Новый</button>' +
      '<button class="myab" data-import="1" data-tip="Импорт: текст, ссылка, файл"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path></svg>Импорт</button>' +
      '<button class="myab wide' + (mergeSel ? ' on' : '') + '" data-merge="1" data-tip="Собрать несколько плейлистов в один"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v5a6 6 0 0 0 6 6M18 4v5a6 6 0 0 1-6 6v5"></path></svg>Объединить</button></div>';
    if (mergeSel) h += '<div class="mbar"><b>Объединить плейлисты</b><span>Отметь 2 или больше — выбрано ' + mergeSel.size + '</span><div><button class="pbtn y" data-mgo="1"' + (mergeSel.size < 2 ? ' disabled' : '') + '>Объединить</button><button class="pbtn" data-mcancel="1">Отмена</button></div></div>';
    var libOn = mySel && listId(mySel) === listId(LIBRARY);
    var li = myItems.push(LIBRARY) - 1;
    h += '<button class="mit mlib' + (libOn ? ' on' : '') + '" data-i="' + li + '">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h4v14H4zM10 5h4v14h-4z"></path><path d="M17 6l3 13"></path></svg>' +
      '<span class="mm"><b>Библиотека</b></span></button>';
    h += '<div class="mypills">';
    var note = function (t, btn){ h += '<div class="mnote">' + t + '</div>' + (btn || ''); };
    MY_GROUPS.forEach(function (g){
      var shut = !!myShut[g.id];
      // Галочка — у правого края: слева она отодвигала бы названия и съедала ширину
      h += '<button class="mygh' + (shut ? ' shut' : '') + '" data-mygrp="' + g.id + '" aria-expanded="' + (shut ? 'false' : 'true') + '">' +
        '<span class="dot" style="background:' + grpColor(g.id) + '"></span><span class="mygn">' + g.n + '</span>' +
        '<svg class="mych" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l7 7 7-7"></path></svg></button>';
      if (shut) return;
      if (g.id === 'tap') {
        h += mojiPlate();
        if (!mine.length) note('Пока пусто. «＋» — новый плейлист, «⇣» — импорт.');
        mine.forEach(function (p){ h += myRow(p); });
      } else if (g.id === 'ym') {
        if (!ymLoggedIn) note('Войди в Яндекс, чтобы видеть «Мне нравится» и свои плейлисты.', '<button class="myab" data-login="1">Войти в Яндекс</button>');
        else {
          h += myRow(LIKED);
          h += myRow(DISLIKED);
          own.forEach(function (p){ h += myRow(p); });
          if (saved.length) { h += '<span class="mysep">Сохранённые:</span>'; saved.forEach(function (p){ h += myRow(p); }); }
          if (loading) note('Загружаю плейлисты…'); else if (myErr) note('⚠ ' + esc(myErr));
          h += '<button class="myab ghost" data-refresh="1">Обновить</button>';
        }
      } else if (g.id === 'yt') {
        if (!ytLogged()) note('Войди в YouTube, чтобы видеть свои плейлисты и лайки.', '<button class="myab" data-ytlogin="1">Войти в YouTube</button>');
        else {
          h += myRow(YT_LIKED);
          ytPls.forEach(function (p){ h += myRow(p); });
          if (loading) note('Загружаю плейлисты…'); else if (ytMyErr) note('⚠ ' + esc(ytMyErr));
        }
      } else {
        if (LIB.count || LIB.folders.length) {
          h += myRow(LIBALL);
          LIB.folders.forEach(function (f){ h += myRow({ src: 'lc', type: 'folder', listId: 'fd:' + f.path, path: f.path, title: f.path.split(/[\\/]/).filter(Boolean).pop() || f.path }); });
        }
        h += '<button class="myab add" data-libadd="1">＋ Папка</button>';
      }
    });
    h += '</div>';
    side.innerHTML = h;
  }

  // ===== «Библиотека»: всё, что есть в Тапёре, плиткой по группам. «На компьютере» — последняя =====
  var libItems = [], libHtml = '', libHtmlKey = '';
  function libTile(m, sub){
    var i = libItems.push(m) - 1;
    return '<button class="lgt" data-li="' + i + '">' + coverHtml(coverFor(m), 'lgi') +
      '<b>' + esc(m.title) + '</b><small>' + esc(sub || '') + '</small></button>';
  }
  function libSection(title, color, tiles){
    if (!tiles) return '';
    return '<section class="lgs"><div class="lgh"><span class="dot" style="background:' + color + '"></span>' + title + '</div><div class="lgg">' + tiles + '</div></section>';
  }
  function libKey(){
    return [localLists().map(function (p){ return listId(p) + ':' + p.title + ':' + ((p.tracks || []).length); }).join(','),
      myPls.map(function (p){ return listId(p) + ':' + p.title; }).join(','),
      ytPls.map(function (p){ return listId(p) + ':' + p.title; }).join(','),
      ymLoggedIn ? 1 : 0, ytLogged() ? 1 : 0, LIB.count, LIB.folders.map(function (f){ return f.path + ':' + f.count; }).join(','),
      JSON.stringify(plCovers)].join('|');
  }
  function renderLibrary(host){
    var key = libKey(), t0 = (window.performance || Date).now();
    // Пока ничего не менялось, берём готовую разметку: заново собирать её при каждом возврате незачем
    if (libHtmlKey === key) {
      if (host.querySelector('.lgtop')) return;
      host.innerHTML = libHtml;
      libLog('из памяти', libItems.length, t0);
      return;
    }
    libItems = [];
    var mine = localLists();
    var own = myPls.filter(function (p){ return p.own; }), saved = myPls.filter(function (p){ return !p.own; });
    var h = '<div class="lgtop"><h3>Библиотека</h3><span>всё, что есть в Тапёре</span></div>';

    var t = mine.map(function (p){ return libTile(p, (p.tracks || []).length + ' ' + plural((p.tracks || []).length)); }).join('');
    t += '<button class="lgt lgnew" data-libnew="1"><span class="lgi ph nw"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></span><b>Новый</b><small>пустой плейлист</small></button>';
    h += libSection('Мои плейлисты', grpColor('tap'), t);

    if (ymLoggedIn) {
      var ty = libTile(LIKED, 'лайки') + own.concat(saved).map(function (p){ return libTile(p, countText(p)); }).join('');
      h += libSection('Яндекс', grpColor('ym'), ty);
    }
    if (ytLogged()) {
      var tv = libTile(YT_LIKED, 'лайки') + ytPls.map(function (p){ return libTile(p, countText(p)); }).join('');
      h += libSection('YouTube', grpColor('yt'), tv);
    }
    if (LIB.count || LIB.folders.length) {
      var tl = libTile(LIBALL, LIB.count.toLocaleString('ru-RU') + ' ' + plural(LIB.count)) +
        LIB.folders.map(function (f){ return libTile({ src: 'lc', type: 'folder', listId: 'fd:' + f.path, path: f.path, title: f.path.split(/[\\/]/).filter(Boolean).pop() || f.path }, 'папка · ' + f.count); }).join('');
      h += libSection('На компьютере', grpColor('lc'), tl);
    }
    libHtml = h; libHtmlKey = key;
    var t1 = (window.performance || Date).now();
    host.innerHTML = h;
    libLog('сборка ' + Math.round(t1 - t0) + ' мс', libItems.length, t0);
  }
  // Замер: сколько прошло до первого показанного кадра. Числа — в журнал программы
  function libLog(what, n, t0){
    if (!A.log) return;
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      A.log('библиотека: ' + n + ' плиток, ' + what + ', до кадра ' + Math.round(((window.performance || Date).now()) - t0) + ' мс');
    }); });
  }
  $('myPl').addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-li],[data-libnew]'); if (!b) return;
    if (b.dataset.libnew) { askDlg({ title: 'Новый плейлист', label: 'Название', value: 'Мой плейлист' }).then(function (r){ if (!r) return; selectMy(localCreate(r.value, [])); }); return; }
    var m = libItems[parseInt(b.dataset.li, 10)]; if (m) selectMy(m);
  });
  $('myPl').addEventListener('contextmenu', function(e){
    var b = e.target.closest && e.target.closest('.lgt[data-li]'); if (!b) return;
    e.preventDefault();
    var m = libItems[parseInt(b.dataset.li, 10)]; if (m) openListMenu(e.clientX, e.clientY, m);
  });

  $('mySide').addEventListener('contextmenu', function(e){
    var b = e.target.closest('.mit[data-i]'); if (!b || mergeSel) return;
    e.preventDefault();
    openListMenu(e.clientX, e.clientY, myItems[parseInt(b.dataset.i, 10)]);
  });
  $('mySide').addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.moji) { mojiApply(); return; }
    if (b.dataset.mygrp) { myToggleGroup(b.dataset.mygrp); return; }
    if (b.dataset.refresh) { loadMy(true); return; }
    if (b.dataset.login) { browserLogin(); return; }
    if (b.dataset.ytlogin) { openYtDlg(); return; }
    if (b.dataset.import) { impSrc = null; openImport(); return; }
    if (b.dataset.libadd) { libAddFolder(); return; }
    if (b.dataset.new) { askDlg({ title: 'Новый плейлист', label: 'Название', value: 'Мой плейлист' }).then(function (r){ if (!r) return; var m = localCreate(r.value, []); selectMy(m); }); return; }
    if (b.dataset.merge) { if (mergeSel) mergeSel = null; else { mergeSel = new Set(); mergeMap = {}; } renderMySide(); return; }
    if (b.dataset.mcancel) { mergeSel = null; renderMySide(); return; }
    if (b.dataset.mgo) { doMerge(); return; }
    if (b.dataset.i != null) {
      var m = myItems[parseInt(b.dataset.i, 10)];
      if (mergeSel) { var id = listId(m); if (mergeSel.has(id)) mergeSel.delete(id); else { mergeSel.add(id); mergeMap[id] = m; } renderMySide(); return; }
      selectMy(m);
    }
  });
  // Объединение: отмеченные плейлисты (любые — Яндекс, YouTube, свои) → новый плейлист Тапёра
  var mergeSel = null, mergeMap = {};
  async function doMerge(){
    var sel = Array.from(mergeSel).map(function (id){ return mergeMap[id]; }).filter(Boolean);
    if (sel.length < 2) return;
    var r = await askDlg({ title: 'Объединить ' + sel.length + ' ' + (sel.length < 5 ? 'плейлиста' : 'плейлистов'), text: esc(sel.map(function (m){ return '«' + m.title + '»'; }).join(' + ')) + '<br>Повторы песен уберу. Получится новый плейлист Тапёра.', label: 'Название', value: sel.map(function (m){ return m.title; }).join(' + ').slice(0, 100),
      check: sel.some(function (m){ return m.src === 'tap'; }) ? 'Удалить исходные плейлисты Тапёра' : '', checked: false, ok: 'Объединить' });
    if (!r) return;
    toast('Собираю треки…');
    var all = [];
    for (var k = 0; k < sel.length; k++) {
      var m = sel[k];
      var L = m.src === 'tap' ? m : await loadList(m).catch(function(){ return null; });
      if (!L || L.error) { toast('Не удалось загрузить «' + m.title + '» — пропускаю'); continue; }
      all = all.concat(L.tracks || []);
    }
    var before = all.length; all = dedupeTracks(all);
    var nm = localCreate(r.value, all);
    if (r.checked) sel.forEach(function (m){ if (m.src === 'tap') { var i = savedLists.indexOf(localGet(listId(m))); if (i >= 0) savedLists.splice(i, 1); } });
    mergeSel = null; saveLocal(nm); selectMy(nm);
    toast('Готово: «' + nm.title + '» · ' + nm.tracks.length + ' ' + plural(nm.tracks.length) + (before - all.length ? ', повторов убрано: ' + (before - all.length) : ''));
  }
  function markMySel(){
    var bs = document.querySelectorAll('#mySide .mit');
    for (var k = 0; k < bs.length; k++) {
      var x = myItems[parseInt(bs[k].dataset.i, 10)];
      bs[k].classList.toggle('on', !!x && !!mySel && listId(x) === listId(mySel));
    }
  }
  function selectMy(m){
    var prevSel = mySel;
    mySel = m || LIBRARY;
    m = mySel;
    // Выбранный пункт переживает переключение вкладок и перезапуск
    saveMyLast(m);
    var grp = m.src === 'lc' ? 'lc' : (m.src === 'ym' ? 'ym' : (m.src === 'yt' ? 'yt' : 'tap'));
    if (m.src !== 'lib' && myShut[grp]) {
      myShut[grp] = false; try { localStorage.setItem('tapMyShut', JSON.stringify(myShut)); } catch (e) { console.warn('Тапёр: не сохранились свёрнутые плейлисты', e); }
      renderMySide(); // группа была свёрнута — список строк изменился
    } else markMySel();
    if (m.src === 'lib') { renderLibrary($('myPl')); return; }
    if (m.src === 'lc') { if (!prevSel || prevSel.listId !== m.listId) libView = { tab: 'songs', q: '', shown: 300, artist: '', album: '' }; renderLocalView($('myPl'), m); return; }
    renderListView($('myPl'), m, false);
  }

  // ===== Импорт плейлиста: текст, ссылка, файл → поиск песен → Тапёр / Яндекс / YouTube =====
  // Тот же поиск песен, что в «Плейлисте из текста»: Точно / Похоже — проверь / Не нашлось.
  // Перенос плейлиста на площадку — тот же мастер, только поиск идёт на одной площадке (imp.only).
  var imp = null, impShowExact = true, impShowRemoved = false, impTab = 'text', impSrc = null;
  // Ф1: где искать песни. '' — «Авто» (там, где играет целиком), 'ym' / 'yt' — только эта площадка.
  var impOnly = '', impPasted = false, impPrevTimer = 0, impVkShown = '';
  if (A.getSetting) A.getSetting('impOnly').then(function (v){ impOnly = (v === 'ym' || v === 'yt') ? v : ''; });
  function impHost(){ return $('myPl'); }
  // Ф5: ссылку ВКонтакте не разбираем — сразу открываем музыку во вкладке «Браузер».
  var IMP_VK = /^(?:https?:\/\/)?(?:m\.)?vk\.(?:com|ru)(?:[\/?#]|$)/i;
  function impVk(u){ return IMP_VK.test(String(u || '').trim()); }
  function impToVk(box){
    brOpen('https://vk.com/audios');
    var b = $('brCollect'); if (b) b.classList.add('hl');
    if (box) box.innerHTML = '<div class="imp-note">ВКонтакте: музыка открыта во вкладке «Браузер» — нажми там «Собрать песни».</div>';
  }
  function impCheckVk(box, u){
    if (!impVk(u)) return false;
    var v = String(u || '').trim();
    if (impVkShown !== v) { impVkShown = v; impToVk(box); }
    return true;
  }
  // Выбор «Искать»: механизм only уже есть у переноса плейлиста — здесь он же.
  function impSearchHtml(){
    var opts = [['', 'Авто — там, где играет целиком'], ['ym', 'только Яндекс'], ['yt', 'только YouTube']];
    return '<div class="imp-src" role="group" aria-label="Где искать">' +
      '<span class="imp-l" style="margin:0">Искать</span>' +
      opts.map(function (o){
        var off = (o[0] === 'ym' && SVC.ymOn === false) || (o[0] === 'yt' && SVC.ytOn === false);
        return '<button type="button" data-io="' + o[0] + '" aria-pressed="' + (impOnly === o[0] ? 'true' : 'false') + '"' + (impOnly === o[0] ? ' class="on"' : '') + (off ? ' disabled title="Выключено в настройках"' : '') + '>' + o[1] + '</button>';
      }).join('') + '</div>';
  }

  function ytCanWrite(){ return !!(ytAuth && ytAuth.oauth && ytAuth.oauth.canWrite); }
  var IMP_TABS = [{ id: 'text', n: 'Текст' }, { id: 'url', n: 'Ссылка' }, { id: 'file', n: 'Файл' }];
  var SRC_NOTE = { 'youtube-chapters': 'главы видео', 'youtube-timestamps': 'таймкоды в описании', 'youtube-list': 'список в описании', telegram: 'Telegram', csv: 'таблица CSV', m3u: 'плейлист M3U', spotify: 'Spotify', deezer: 'Deezer', apple: 'Apple Music', platform: 'площадка', page: 'страница в «Браузере»', text: 'текст' };
  function openImport(pre){
    mySel = null;
    var bs = document.querySelectorAll('#mySide .mit'); for (var k = 0; k < bs.length; k++) bs[k].classList.remove('on');
    impHost()._tok = (impHost()._tok || 0) + 1; // отменить загрузку открытого плейлиста
    impPasted = false; impVkShown = '';
    if (pre && pre.items) { impSrc = pre; impTab = pre.tab || 'url'; }
    renderImportInput();
  }
  function impLines(text){ return String(text || '').split(/\r?\n/).map(function (l){ return l.trim(); }).filter(function (l){ return l && /[\p{L}\p{N}]/u.test(l); }).slice(0, 2000); }
  // Строки текста → пункты (ссылки на музыку узнаём и открываем отдельно)
  var MLINK = /^(https?:\/\/)?(www\.|m\.)?(music\.yandex\.[a-z]+|(music\.)?youtube\.com|youtu\.be|soundcloud\.com|on\.soundcloud\.com|[\w-]+\.bandcamp\.com|open\.spotify\.com|music\.apple\.com|deezer\.com|t\.me)\//i;
  function textItems(text){ return impLines(text).map(function (l){ return MLINK.test(l) && !/\s/.test(l) ? { url: l, line: '' } : { line: l }; }); }
  function impTargetsHtml(prev){
    var ymOk = ymLoggedIn, ytOk = ytCanWrite();
    return '<div class="imp-tg"><span class="imp-l" style="margin:0">Куда сохранить</span>' +
      '<label class="imp-chk"><input type="checkbox" checked disabled> В Тапёр</label>' +
      '<label class="imp-chk"><input type="checkbox" id="impYm"' + (ymOk ? (prev.ym !== false ? ' checked' : '') : ' disabled') + '> И в Яндекс Музыку' + (ymOk ? '' : ' <span>(нужен вход)</span>') + '</label>' +
      '<label class="imp-chk"><input type="checkbox" id="impYt"' + (ytOk ? (prev.yt ? ' checked' : '') : ' disabled') + '> И на YouTube' + (ytOk ? '' : ' <span>(' + (ytAuth.oauth && ytAuth.oauth.account ? 'войди заново, разрешив изменения' : 'нужен вход через браузер') + ')</span>') + '</label></div>';
  }
  function renderImportInput(){
    var h = impHost(), prev = imp || {};
    var src = impSrc;
    if ((impOnly === 'ym' && SVC.ymOn === false) || (impOnly === 'yt' && SVC.ytOn === false)) impOnly = '';
    var body = '';
    if (impTab === 'text') {
      body = '<div class="imp-d">По одной песне в строке, лучше «Исполнитель — Название». Можно вставлять и ссылки на треки и плейлисты (Яндекс, YouTube, SoundCloud, Spotify, Deezer, Apple Music). Мусор вроде [www.сайт], номеров и #хэштегов уберу сам. До 2000 строк.</div>' +
        '<label class="imp-l" for="impPaste">Список песен</label>' +
        '<textarea id="impPaste" class="imp-ta" spellcheck="false" placeholder="Scars On Broadway - Till the End&#10;Надя Горбачёва - Подмосковные вечера&#10;https://open.spotify.com/playlist/…"></textarea>' +
        '<div class="imp-ok" id="impPasteOk" hidden></div>';
    } else if (impTab === 'url') {
      body = '<div class="imp-d">Ссылка на <b>длинное видео YouTube</b> (микс, сборник, стрим — по главам или таймкодам в описании), <b>плейлист</b> Яндекса, YouTube, SoundCloud, Spotify, Deezer, Apple Music. Для ВКонтакте открой свою страницу с музыкой во вкладке «Браузер» и нажми там «Собрать песни».</div>' +
        '<div class="imp-q" style="margin:0"><input id="impUrl" class="imp-f" placeholder="https://…" spellcheck="false" aria-label="Ссылка"><button class="pbtn y" id="impUrlGo" style="height:40px">Открыть</button></div>' +
        '<div id="impSrcBox"></div>';
    } else {
      body = '<div class="imp-d">Подойдут:<br>• <b>Таблица CSV</b> — выгрузки Exportify (Spotify), TuneMyMusic, Soundiiz и любые с колонками «Исполнитель» и «Название».<br>• <b>Плейлист M3U / PLS</b> из AIMP, Winamp, foobar2000 — песни с компьютера сразу на месте, остальные найду.<br>• Обычный <b>.txt</b> со списком.</div>' +
        '<div><button class="pbtn y" id="impFileGo">Выбрать файл…</button></div><div id="impSrcBox"></div>';
    }
    h.innerHTML = '<div class="imp">' +
      '<div class="imp-h">Импорт плейлиста</div>' +
      '<div class="ar-tabs" role="tablist" style="padding-top:0">' + IMP_TABS.map(function (t){ return '<button role="tab" data-it="' + t.id + '"' + (impTab === t.id ? ' class="on"' : '') + '>' + t.n + '</button>'; }).join('') + '</div>' +
      '<label class="imp-l" for="impName">Название плейлиста</label><input id="impName" class="imp-f" maxlength="100">' +
      body + impSearchHtml() + impTargetsHtml(prev) +
      '<div class="imp-btns"><button class="pbtn acc" id="impGo">Собрать плейлист</button><button class="pbtn g" id="impCancel">Отмена</button></div>' +
      '</div>';
    $('impName').value = (src && impTab !== 'text' && src.title) || prev.title || (impTab === 'text' ? 'Плейлист из текста' : 'Новый плейлист');
    h.querySelector('.ar-tabs').onclick = function(e){ var b = e.target.closest('[data-it]'); if (!b) return; impTab = b.dataset.it; if (impTab === 'text') impSrc = null; renderImportInput(); };
    var sbox = h.querySelector('.imp-src');
    if (sbox) sbox.onclick = function(e){
      var b = e.target.closest('[data-io]'); if (!b || b.disabled) return;
      impOnly = b.dataset.io || '';
      if (A.setSetting) A.setSetting('impOnly', impOnly);
      var bs = sbox.querySelectorAll('[data-io]');
      for (var k = 0; k < bs.length; k++) { var on = bs[k].dataset.io === impOnly; bs[k].classList.toggle('on', on); bs[k].setAttribute('aria-pressed', on ? 'true' : 'false'); }
    };
    function cnt(){ return impTab === 'text' ? textItems($('impPaste').value).length : (impSrc ? impSrc.items.length : 0); }
    // После вставки показываем, сколько строк взяли (пустые и мусорные не считаем)
    function upd(e){
      if (e && e.inputType === 'insertFromPaste') impPasted = true;
      var n = cnt();
      $('impGo').textContent = n ? 'Собрать плейлист · ' + n + ' ' + lineWord(n) : 'Собрать плейлист';
      $('impGo').disabled = !n;
      var ok = $('impPasteOk');
      if (ok) {
        var lines = impLines($('impPaste').value).length;
        ok.hidden = !(impPasted && lines);
        ok.textContent = lines ? '✓ Вставлено ' + lines + ' ' + lineWord(lines) : '';
      }
    }
    if (impTab === 'text') {
      $('impPaste').value = prev.text || '';
      $('impPaste').addEventListener('input', upd);
      $('impPaste').addEventListener('paste', function(){ impPasted = true; setTimeout(function(){ upd(); }, 0); });
    }
    if (impTab === 'url') {
      var go = async function(){
        var u = $('impUrl').value.trim(); if (!u) return;
        if (impCheckVk($('impSrcBox'), u)) { upd(); return; }
        $('impUrlGo').disabled = true; $('impUrlGo').textContent = 'Открываю…';
        var r = A.importUrl ? await A.importUrl(u).catch(function (e){ return { error: String(e) }; }) : { error: 'нет связи с программой' };
        $('impUrlGo').disabled = false; $('impUrlGo').textContent = 'Открыть';
        if (!r || r.error) {
          impSrc = null;
          // ВКонтакте — не ошибка: открываем «Браузер» на музыке и объясняем одной строкой.
          if (r && r.vk) impCheckVk($('impSrcBox'), u);
          else $('impSrcBox').innerHTML = '<div class="imp-note bad">⚠ ' + esc((r && r.error) || 'не получилось') + '</div>';
          upd(); return;
        }
        impSrc = { title: r.title, items: r.items || [], source: r.source, note: r.note, video: r.video, url: u };
        if (impSrc.title && (!$('impName').value || /^(Новый плейлист|Плейлист из текста)$/.test($('impName').value))) $('impName').value = impSrc.title.slice(0, 100);
        renderSrcBox(); upd();
      };
      $('impUrlGo').onclick = go;
      $('impUrl').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); go(); } });
      $('impUrl').addEventListener('input', function(){ impCheckVk($('impSrcBox'), $('impUrl').value); });
      $('impUrl').addEventListener('paste', function(){ var x = $('impUrl'); setTimeout(function(){ impCheckVk($('impSrcBox'), x.value); }, 0); });
      if (impSrc && impSrc.url) $('impUrl').value = impSrc.url;
      setTimeout(function(){ var x = $('impUrl'); if (x && !x.value) x.focus(); }, 0);
    }
    if (impTab === 'file') {
      $('impFileGo').onclick = async function(){
        var r = A.importFile ? await A.importFile().catch(function (e){ return { error: String(e) }; }) : { error: 'нет связи с программой' };
        if (!r || r.cancelled) return;
        if (r.error && !(r.items && r.items.length)) { impSrc = null; $('impSrcBox').innerHTML = '<div class="imp-note bad">⚠ ' + esc(r.error) + '</div>'; upd(); return; }
        impSrc = { title: r.title, items: r.items || [], source: r.source };
        if (impSrc.title) $('impName').value = impSrc.title.slice(0, 100);
        renderSrcBox(); upd();
      };
    }
    if (impSrc && impTab !== 'text') renderSrcBox();
    function renderSrcBox(){
      var box = $('impSrcBox'); if (!box || !impSrc) return;
      var it = impSrc.items, ready = it.filter(function (x){ return x.track; }).length;
      box.innerHTML = '<div class="imp-note">' + (it.length ? '✓ Нашёл ' + it.length + ' ' + lineWord(it.length) + (SRC_NOTE[impSrc.source] ? ' — ' + esc(SRC_NOTE[impSrc.source]) : '') + (ready ? ' · ' + ready + ' уже с площадки' : '') : 'Списка песен тут нет.') + (impSrc.note ? '<br><span>' + esc(impSrc.note) + '</span>' : '') +
        (impSrc.video && !it.length ? '<br><button class="imp-sm hl" id="impVidQ">Добавить само видео в очередь</button>' : '') + '</div>' +
        (it.length ? '<div class="imp-prev" id="impPrev"></div>' : '');
      var vq = $('impVidQ'); if (vq) vq.onclick = function(){ addToQueue(impSrc.video); toast('Видео в очереди'); };
      requestAnimationFrame(impPreviewRows);
    }
    upd();
    $('impCancel').onclick = function(){ imp = null; impSrc = null; selectMy(ymLoggedIn ? LIKED : (savedLists[0] || null)); };
    $('impGo').onclick = function(){
      var items = impTab === 'text' ? textItems($('impPaste').value) : (impSrc ? impSrc.items.map(function (x){ return Object.assign({}, x); }) : []);
      if (!items.length) return;
      startImport({ title: $('impName').value.trim() || 'Новый плейлист', text: impTab === 'text' ? $('impPaste').value : '', items: items, ym: !!($('impYm') && $('impYm').checked), yt: !!($('impYt') && $('impYt').checked), tap: true, only: impOnly, source: impTab === 'text' ? 'text' : (impSrc && impSrc.source) });
    };
  }
  // Сколько строк списка влезает до кнопки: считаем по высоте окна, а не «6 строк» навсегда.
  function impPreviewRows(){
    var prev = $('impPrev'); if (!prev || !impSrc) return;
    var it = impSrc.items || [];
    var cs = null; try { cs = getComputedStyle(prev); } catch (e) {}
    var lh = parseFloat(cs && cs.lineHeight) || 20;
    var pad = (parseFloat(cs && cs.paddingTop) || 0) + (parseFloat(cs && cs.paddingBottom) || 0);
    var step = lh + 2; // gap между строками
    var avail = Math.max(0, prev.clientHeight - pad);
    var maxRows = avail > 0 ? Math.max(1, Math.floor((avail + 2) / step)) : 6;
    var show = Math.min(it.length, maxRows);
    var more = it.length - show;
    if (more > 0 && show > 1) { show--; more = it.length - show; }
    prev.innerHTML = it.slice(0, show).map(function (x){ return '<div class="o">' + esc(x.line || x.url || '') + '</div>'; }).join('') +
      (more > 0 ? '<div class="o">… и ещё ' + more + '</div>' : '');
  }
  window.addEventListener('resize', function(){
    clearTimeout(impPrevTimer);
    impPrevTimer = setTimeout(function(){ if (impSrc && impTab !== 'text' && $('impPrev')) impPreviewRows(); }, 120);
  });
  var bc = $('brCollect'); if (bc) bc.addEventListener('click', function(){ bc.classList.remove('hl'); });
  function lineWord(n){ n = n % 100; if (n >= 11 && n <= 14) return 'строк'; n = n % 10; if (n === 1) return 'строка'; if (n >= 2 && n <= 4) return 'строки'; return 'строк'; }
  // Ссылки внутри списка: плейлист → его песни, видео-микс → главы
  async function expandUrls(items, run){
    var out = [];
    for (var k = 0; k < items.length; k++) {
      var x = items[k];
      if (!x.url || x.track) { out.push(x); continue; }
      if (imp && imp.run === run) { imp.stage = 'Открываю ссылки… ' + (k + 1) + ' из ' + items.length; renderImportResults(); }
      var r = A.importUrl ? await A.importUrl(x.url).catch(function(){ return null; }) : null;
      if (!imp || imp.run !== run) return null;
      if (r && !r.error && r.items && r.items.length) out = out.concat(r.items);
      else if (r && r.video) out.push({ line: (r.video.author ? r.video.author + ' — ' : '') + r.video.title, track: r.video });
      else out.push({ line: x.url, bad: (r && r.error) || 'ссылка не открылась' });
    }
    return out;
  }
  // o: { title, items, ym, yt, tap, only, mode: 'import'|'transfer', from (плейлист-источник) }
  async function startImport(o){
    var run = (imp && imp.run || 0) + 1;
    imp = Object.assign({ tap: true }, o, { run: run, done: 0, items: [], stage: '' });
    impShowExact = o.mode !== 'transfer'; impShowRemoved = false;
    renderImportResults();
    var raw = o.items.slice(0, 2000);
    if (raw.some(function (x){ return x.url && !x.track; })) { raw = await expandUrls(raw, run); if (!raw) return; }
    if (!imp || imp.run !== run) return;
    imp.stage = '';
    imp.items = raw.slice(0, 2000).map(function (x){
      var it = { line: x.line || (x.track ? (x.track.author ? x.track.author + ' — ' : '') + x.track.title : ''), seconds: x.seconds || 0, status: 'wait', alts: [] };
      if (x.bad) { it.status = 'none'; it.note = x.bad; }
      else if (x.track && (!imp.only || srcOf(x.track) === imp.only)) { it.track = x.track; it.status = 'exact'; it.given = true; }
      return it;
    });
    imp.done = imp.items.filter(function (i){ return i.status !== 'wait'; }).length;
    imp.cur = 0;
    renderImportResults();
    var next = 0, lastDraw = 0;
    async function worker(){
      while (imp && imp.run === run && next < imp.items.length) {
        var it = imp.items[next++];
        if (it.status !== 'wait') continue;
        var r = null;
        try { r = await A.matchLine(it.line, { seconds: it.seconds, only: imp.only || '' }); }
        catch (e) { axLog('импорт: не удалось сопоставить «' + it.line + '» — ' + (e && e.message || e)); }
        if (!imp || imp.run !== run) return;
        Object.assign(it, r || { status: 'none', alts: [] });
        if (window.TapRank && it.track && (it.status === 'exact' || it.status === 'close') && searchMode !== 'src' && !it.remembered && !it.local && !imp.only) {
          // вариант выдачи из поиска: среди почти одинаково подходящих берём тот, что выше по выбранному варианту
          var q0 = it.query || it.line, base = TapRank.relevance(q0, it.track);
          var cand = [it.track].concat(it.alts || []).filter(function (c){ return TapRank.relevance(q0, c) >= base - 8; });
          var best = TapRank.rank(q0, cand.map(function (c){ return Object.assign({}, c); }), searchMode, rankCtx())[0];
          if (best && (best.src !== it.track.src || best.id !== it.track.id)) { var old = it.track; it.track = cand.find(function (c){ return c.src === best.src && c.id === best.id; }) || it.track; it.alts = [old].concat((it.alts || []).filter(function (c){ return c !== it.track; })); }
          if (it.track.src !== 'ym') it.preview = false; // пометка отрывка относится только к выбранному треку
        }
        if (it.status === 'skip') it.removed = true;
        imp.done++;
        if (Date.now() - lastDraw > 400 || imp.done === imp.items.length) { lastDraw = Date.now(); renderImportResults(); }
        else updImpProgress();
      }
    }
    await Promise.all([worker(), worker(), worker()]);
  }
  function updImpProgress(){
    var b = document.querySelector('.imp-bar i'), t = $('impCount');
    if (!b || !imp || !imp.items.length) return;
    b.style.width = Math.round(imp.done / imp.items.length * 100) + '%';
    t.textContent = imp.done + ' из ' + imp.items.length;
  }
  function impIncluded(){ return imp.items.filter(function (i){ return !i.removed && i.track && i.status === 'exact'; }); }
  // Ф1: Яндекс без полного доступа отдаёт только отрывок 30 с — помечаем такую строку.
  function impIsPreview(it){
    if (!it || !it.track || it.track.src !== 'ym') return false;
    return !!(it.preview || !(ymLoggedIn && ymPlus));
  }
  function impPvText(n){
    var a = n % 100, b = n % 10;
    var song = (a >= 11 && a <= 14) ? 'песен' : (b === 1 ? 'песня' : (b >= 2 && b <= 4 ? 'песни' : 'песен'));
    var part = (a >= 11 && a <= 14) ? 'отрывки' : (b === 1 ? 'отрывок' : 'отрывки');
    return n + ' ' + song + ' — только ' + part;
  }
  // Строки, по которым ходят стрелками: сначала «Похоже», потом «Не нашлось», потом «Точно»
  function impOrder(){
    var items = imp.items.filter(function (i){ return !i.removed; });
    var close = items.filter(function (i){ return i.status === 'close'; }), none = items.filter(function (i){ return i.status === 'none'; });
    var exact = items.filter(function (i){ return i.status === 'exact'; }).sort(function (a, b){ return (b.pickedAt || 0) - (a.pickedAt || 0); });
    return { close: close, none: none, exact: exact, nav: close.concat(none, impShowExact ? exact : []) };
  }
  function renderImportResults(){
    var h = impHost(); if (!imp) return;
    if (imp.stage || !imp.items.length) { h.innerHTML = '<div class="imp"><div class="imp-h">' + esc(imp.title) + '</div><div class="muted">' + esc(imp.stage || 'Готовлю список…') + '</div></div>'; return; }
    var open = {}; imp.items.forEach(function (it, k){ if (it._open) open[k] = true; });
    imp.items.forEach(function (it, k){ it._k = k; });
    var O = impOrder(), close = O.close, none = O.none, exact = O.exact;
    var removed = imp.items.filter(function (i){ return i.removed && i.status !== 'skip'; });
    var inc = impIncluded(), by = {}; inc.forEach(function (i){ var s = srcOf(i.track); by[s] = (by[s] || 0) + 1; });
    var finished = imp.done >= imp.items.length;
    var curK = O.nav[imp.cur] ? O.nav[imp.cur]._k : -1;
    function row(it, kind){
      var t = it.track;
      var m = t ? srcDot(t) + esc((t.author ? t.author + ' — ' : '') + t.title) + (t.duration ? ' <span class="imp-du">' + esc(t.duration) + '</span>' : '') + (it.picked ? ' <span class="imp-pk">подтверждено</span>' : (it.remembered ? ' <span class="imp-pk">как в прошлый раз</span>' : (it.local ? ' <span class="imp-pk">с компьютера</span>' : ''))) + (it.durWarn ? ' <span class="imp-pk warn">другая длина</span>' : '') + (impIsPreview(it) ? ' <span class="imp-pk warn">отрывок 30 с</span>' : '') : '<span style="color:var(--tx5)">' + esc(it.note || '—') + '</span>';
      // одинаковый набор кнопок у всех строк: ▶ · Это та песня · Найти · Убрать (лишнее — неактивно, столбцы не прыгают)
      var k = it._k;
      var btns = kind === 'removed'
        ? '<button class="imp-sm hl" data-back="' + k + '">Вернуть</button>'
        : '<button class="imp-sm imp-pv" data-pv="' + k + '" title="Прослушать (Пробел)" aria-label="Прослушать"' + (t ? '' : ' disabled') + '>' + (t ? pvIcon(t) : PV_PLAY) + '</button>' +
          (kind === 'exact' ? '<button class="imp-sm ok done" disabled>✓ Та песня</button>' : '<button class="imp-sm ok" data-ok="' + k + '" title="Enter"' + (t ? '' : ' disabled') + '>Это та песня</button>') +
          '<button class="imp-sm' + (kind === 'none' ? ' hl' : '') + (open[k] ? ' on' : '') + '" data-ed="' + k + '" title="Другие варианты и поиск (F)">Найти</button>' +
          '<button class="imp-sm" data-rm="' + k + '" title="Delete">Убрать</button>';
      var ed = '';
      if (open[it._k]) {
        ed = '<div class="imp-ed">' + ((it.alts || []).length ? (it.alts || []).slice(0, 9).map(function (a, j){
            return '<div class="imp-alt"><span class="imp-kn">' + (j + 1) + '</span><button class="imp-sm imp-pv" data-pv="' + it._k + ':' + j + '" title="Прослушать" aria-label="Прослушать">' + pvIcon(a) + '</button>' +
              '<span class="an">' + srcDot(a) + esc((a.author ? a.author + ' — ' : '') + a.title) + '</span>' + (a.duration ? '<span class="ad">' + esc(a.duration) + '</span>' : '') +
              '<button class="imp-sm ok" data-pick="' + it._k + ':' + j + '">Это та песня</button></div>';
          }).join('') : '<div class="imp-none">Вариантов нет — поищи по-другому:</div>') +
          '<div class="imp-q"><input class="imp-f" data-qin="' + it._k + '" value="' + esc(it.query || it.line) + '" aria-label="Запрос"><button class="imp-sm hl" data-q="' + it._k + '">Найти</button></div></div>';
      }
      return '<div class="imp-r ' + kind + (it._flash ? ' flash' : '') + (it._k === curK ? ' kcur' : '') + '" data-row="' + it._k + '"><span class="o" title="' + esc(it.line) + '">' + esc(it.line) + (it.seconds ? ' <i>' + esc(fmtSecs(it.seconds)) + '</i>' : '') + '</span><span class="m">' + m + '</span><span class="b">' + btns + '</span></div>' + ed;
    }
    var srcChips = Object.keys(by).map(function (s){ return srcName({ src: s }) + ' ' + by[s]; }).join(' · ');
    var pvN = inc.filter(impIsPreview).length;
    var tgt = [imp.tap ? 'Тапёр' : '', imp.ym ? 'Яндекс Музыку' : '', imp.yt ? 'YouTube' : ''].filter(Boolean);
    var html = '<div class="imp">' +
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><button class="back" id="impBack">' + (imp.mode === 'transfer' ? '← К плейлисту' : '← Изменить список') + '</button><div class="imp-h" style="flex:1;min-width:200px">' + esc(imp.title) + (imp.mode === 'transfer' ? ' <span class="imp-to">→ ' + esc(imp.only === 'yt' ? 'YouTube' : 'Яндекс Музыка') + '</span>' : '') + '</div></div>' +
      '<div class="imp-prog"><span class="imp-bar"><i style="width:' + Math.round(imp.done / imp.items.length * 100) + '%"></i></span><span id="impCount">' + imp.done + ' из ' + imp.items.length + '</span></div>' +
      '<div class="imp-chips"><span class="c-ok">Точно: ' + exact.length + '</span><span class="c-cl">Похоже: ' + close.length + '</span><span class="c-no">Не нашлось: ' + none.length + '</span>' + (srcChips ? '<span class="c-src">' + esc(srcChips) + '</span>' : '') + (pvN ? '<span class="c-cl">' + esc(impPvText(pvN)) + '</span>' : '') + '</div>' +
      (close.length || none.length ? '<div class="imp-keys">С клавиатуры: <b>↑↓</b> строки · <b>Enter</b> — это та песня · <b>1–9</b> — вариант · <b>Пробел</b> — послушать · <b>F</b> — найти · <b>Delete</b> — убрать</div>' : '') +
      '<div class="imp-list" tabindex="0">';
    if (close.length) html += '<div class="imp-g"><i style="background:#FFB86B"></i>Похоже — проверь <span>' + close.length + '</span></div>' + close.map(function (i){ return row(i, 'close'); }).join('');
    if (none.length) html += '<div class="imp-g"><i style="background:#FF8A7A"></i>Не нашлось <span>' + none.length + '</span></div>' + none.map(function (i){ return row(i, 'none'); }).join('');
    if (exact.length) {
      html += '<button class="imp-g imp-gt" id="impExactT"><i style="background:#4ADE9A"></i>Точно <span>' + exact.length + ' — ' + (impShowExact ? 'свернуть' : 'показать') + '</span></button>';
      if (impShowExact) html += exact.map(function (i){ return row(i, 'exact'); }).join('');
    }
    if (removed.length) {
      html += '<button class="imp-g imp-gt" id="impRemT"><i style="background:#5A5E6C"></i>Убрано <span>' + removed.length + ' — ' + (impShowRemoved ? 'свернуть' : 'показать') + '</span></button>';
      if (impShowRemoved) html += removed.map(function (i){ return row(i, 'removed'); }).join('');
    }
    if (!finished) html += '<div class="muted">Ищу… это займёт около ' + Math.max(1, Math.round((imp.items.length - imp.done) / 3 * 1.2 / 60)) + ' мин. Пока можно проверять найденное.</div>';
    html += '</div>' +
      '<div class="imp-save"><button class="pbtn y" id="impSave"' + (finished && inc.length ? '' : ' disabled') + '>' + (imp.mode === 'transfer' ? 'Создать на ' + (imp.only === 'yt' ? 'YouTube' : 'Яндексе') : 'Сохранить') + ' · ' + inc.length + ' ' + plural(inc.length) + '</button>' +
      (imp.mode !== 'transfer' ? '<button class="pbtn qadd" id="impQueue"' + (inc.length ? '' : ' disabled') + '>Сразу в очередь</button>' : '') +
      '<span>Сохранятся только «Точно» — ' + (imp.mode === 'transfer' ? 'новый плейлист на ' + (imp.only === 'yt' ? 'YouTube' : 'Яндексе') : 'в ' + tgt.join(', ')) + (close.length ? '. Похожие подтверди кнопкой «Это та песня»' : '') + '</span><span id="impMsg"></span></div>' +
      '</div>';
    var listEl = h.querySelector('.imp-list'), keep = listEl ? listEl.scrollTop : 0, hadFocus = listEl && document.activeElement === listEl;
    h.innerHTML = html;
    var nl = h.querySelector('.imp-list'); if (nl) { nl.scrollTop = keep; if (hadFocus) nl.focus(); }
    $('impBack').onclick = function(){
      if (imp) imp.run++;
      if (imp && imp.mode === 'transfer' && imp.from) { var f = imp.from; imp = null; selectMy(f); return; }
      renderImportInput();
    };
    var et = $('impExactT'); if (et) et.onclick = function(){ impShowExact = !impShowExact; renderImportResults(); };
    var rt = $('impRemT'); if (rt) rt.onclick = function(){ impShowRemoved = !impShowRemoved; renderImportResults(); };
    $('impSave').onclick = saveImport;
    var iq = $('impQueue'); if (iq) iq.onclick = function(){ addMany(impIncluded().map(function (i){ return i.track; }), true); toast('В очереди: ' + impIncluded().length); };
  }
  function fmtSecs(s){ s = Math.round(s || 0); var m = Math.floor(s / 60), x = s % 60; return m + ':' + (x < 10 ? '0' : '') + x; }
  // Клавиатура в списке проверки
  function impKey(e){
    if (!imp || curTab !== 'my' || !impHost().querySelector('.imp-list')) return;
    var tg = e.target, typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA');
    if (typing || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('.ask-ov')) return;
    var O = impOrder(), nav = O.nav; if (!nav.length) return;
    if (imp.cur >= nav.length) imp.cur = nav.length - 1;
    var it = nav[imp.cur], k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); imp.cur = Math.max(0, Math.min(nav.length - 1, imp.cur + (k === 'ArrowDown' ? 1 : -1))); renderImportResults(); impScroll(); return; }
    if (!it) return;
    if (k === 'Enter') { e.preventDefault(); if (it.track && it.status !== 'exact') { confirmImp(it); } else { imp.cur = Math.min(nav.length - 1, imp.cur + 1); renderImportResults(); impScroll(); } return; }
    if (k === ' ') { e.preventDefault(); if (it.track) previewTrack(it.track); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); it.removed = true; it._open = false; renderImportResults(); impScroll(); return; }
    if (k === 'f' || k === 'F' || k === 'а' || k === 'А') { e.preventDefault(); it._open = true; renderImportResults(); var inp = impHost().querySelector('[data-qin="' + it._k + '"]'); if (inp) { inp.focus(); inp.select(); } return; }
    if (/^[1-9]$/.test(k)) {
      var j = +k - 1;
      if (!it._open) { it._open = true; renderImportResults(); impScroll(); return; }
      var a = (it.alts || [])[j]; if (!a) return;
      e.preventDefault(); impPick(it, j);
    }
  }
  document.addEventListener('keydown', impKey);
  function impScroll(){ var r = impHost().querySelector('.imp-r.kcur'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }
  function impPick(it, j){
    var a = it.alts[j];
    if (it.track) it.alts[j] = it.track; else it.alts.splice(j, 1);
    it.track = a;
    it.preview = !!(a && a.src === 'ym' && !(ymLoggedIn && ymPlus));
    confirmImp(it);
  }
  impHost().addEventListener('click', async function(e){
    if (!imp) return;
    var b = e.target.closest('button');
    var rowEl = e.target.closest('.imp-r');
    if (rowEl && !b) { var O = impOrder(), kk = +rowEl.dataset.row, ix = O.nav.findIndex(function (x){ return x._k === kk; }); if (ix >= 0 && ix !== imp.cur) { imp.cur = ix; renderImportResults(); var l = impHost().querySelector('.imp-list'); if (l) l.focus(); } return; }
    if (!b) return;
    var d = b.dataset, it;
    if (d.ed != null) { it = imp.items[+d.ed]; it._open = !it._open; renderImportResults(); return; }
    if (d.rm != null) { it = imp.items[+d.rm]; it.removed = true; it._open = false; renderImportResults(); return; }
    if (d.back != null) { it = imp.items[+d.back]; it.removed = false; it._flash = true; renderImportResults(); setTimeout(function(){ it._flash = false; }, 1600); return; }
    if (d.ok != null) { it = imp.items[+d.ok]; if (it.track) confirmImp(it); return; }
    if (d.pv != null) {
      var pp = String(d.pv).split(':'); it = imp.items[+pp[0]];
      var tr = pp.length > 1 ? (it.alts || [])[+pp[1]] : it.track;
      if (tr) previewTrack(tr);
      return;
    }
    if (d.pick) { var p = d.pick.split(':'); impPick(imp.items[+p[0]], +p[1]); return; }
    if (d.q != null) {
      it = imp.items[+d.q];
      var inp = impHost().querySelector('[data-qin="' + d.q + '"]');
      var qv = inp ? inp.value.trim() : ''; if (!qv) return;
      b.textContent = 'Ищу…'; b.disabled = true;
      var r = await A.matchLine(qv, { only: imp.only || '', noLocal: false });
      if (!imp) return;
      it.query = qv;
      it.alts = ((r && r.track) ? [r.track] : []).concat((r && r.alts) || []);
      it._open = true;
      renderImportResults();
    }
  });
  impHost().addEventListener('keydown', function(e){
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.qin != null) { var b = impHost().querySelector('[data-q="' + e.target.dataset.qin + '"]'); if (b) b.click(); }
    if (e.key === 'Escape' && e.target.dataset && e.target.dataset.qin != null) { var l = impHost().querySelector('.imp-list'); if (l) l.focus(); }
  });
  // «Это та песня»: строка уезжает в начало «Точно», подсвечивается и запоминается на будущее
  function confirmImp(it){
    it.status = 'exact'; it.picked = true; it._open = false; it.pickedAt = Date.now(); it._flash = true;
    if (A.matchRemember && it.track && it.line) A.matchRemember(it.line, imp.only || '', slimTrack(it.track));
    renderImportResults(); impScroll();
    setTimeout(function(){ it._flash = false; var r = impHost().querySelector('[data-row="' + it._k + '"]'); if (r) r.classList.remove('flash'); }, 1600);
  }

  // Прослушивание варианта: играет, но в очередь и в ленту дня не попадает
  var previewT = null;
  var PV_PLAY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"></path></svg>';
  var PV_STOP = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h12v12H6z"></path></svg>';
  function pvActive(t){ return !!(previewT && t && previewT.id === t.id && previewT.src === t.src && master().getAttribute('src') && !master().paused); }
  function pvIcon(t){ return pvActive(t) ? PV_STOP : PV_PLAY; }
  function updPreviewBtns(){
    if (!imp) return;
    var bs = impHost().querySelectorAll('[data-pv]');
    for (var k = 0; k < bs.length; k++) {
      var pp = String(bs[k].dataset.pv).split(':'), it = imp.items[+pp[0]];
      var tr = it && (pp.length > 1 ? (it.alts || [])[+pp[1]] : it.track);
      var on = pvActive(tr); bs[k].innerHTML = on ? PV_STOP : PV_PLAY; bs[k].classList.toggle('on', on);
    }
  }
  async function previewTrack(t){
    if (pvActive(t)) { master().pause(); updPreviewBtns(); return; }
    previewT = t;
    showTrack(t); setNowPlaying(t); setSub('Прослушивание…');
    var r = await getStream(t);
    if (previewT !== t) return;
    if (!r || r.error) { setErr('⚠ ' + ((r && r.error) || 'поток не получен')); previewT = null; return; }
    startMedia(t, r);
    setSub((t.author || '') + ' · прослушивание (в очередь не попадёт)');
    updPreviewBtns();
  }
  allEls().concat([ytx, ymx]).forEach(function (el){ el.addEventListener('play', updPreviewBtns); el.addEventListener('pause', updPreviewBtns); });

  // ===== Сохранение: Тапёр + площадки. Перенос и синхронизация с площадками =====
  function tapKey(t){ return srcOf(t) + ':' + t.id; }
  // items: [{ line, track, seconds }] → найти каждую песню на площадке target и создать/дополнить плейлист
  async function pushTo(target, title, items, setMsg, link){
    var tracks = [], map = {}, missing = [];
    for (var k = 0; k < items.length; k++) {
      var it = items[k], t = it.track;
      if (t && srcOf(t) === target) { tracks.push(t); map[tapKey(t)] = String(t.id); continue; }
      if (setMsg) setMsg('Ищу песни на ' + (target === 'yt' ? 'YouTube' : 'Яндексе') + '… ' + (k + 1) + ' из ' + items.length);
      var line = it.line || (t ? (t.author ? t.author + ' — ' : '') + t.title : '');
      var r = A.matchLine ? await A.matchLine(line, { only: target, seconds: it.seconds || (t && t.seconds) || 0 }).catch(function(){ return null; }) : null;
      if (r && r.status === 'exact' && r.track) { tracks.push(r.track); if (t) map[tapKey(t)] = String(r.track.id); }
      else missing.push(line);
    }
    var seen = {}; tracks = tracks.filter(function (t){ if (seen[t.id]) return false; seen[t.id] = 1; return true; });
    if (setMsg) setMsg('Создаю плейлист на ' + (target === 'yt' ? 'YouTube' : 'Яндексе') + '…');
    var res;
    if (target === 'ym') {
      var ymT = tracks.filter(function (t){ return t.albumId; }).map(function (t){ return { id: t.id, albumId: t.albumId }; });
      res = link ? await A.ymPlAdd(link.kind, ymT) : await A.ymPlCreate(title, ymT);
      if (res && res.ok && !link) link = { uid: res.uid, kind: res.kind, title: title };
    } else {
      var ids = tracks.map(function (t){ return t.id; });
      res = link ? await A.ytPlAdd(link.listId, ids) : await A.ytPlCreate(title, ids);
      if (res && res.listId && !link) link = { listId: res.listId, title: title };
    }
    if (!res) res = { error: 'нет ответа' };
    return { ok: !!(res.ok || res.partial), error: res.error, quota: res.quota, needLogin: res.needLogin, count: res.count || 0, link: link, map: map, missing: missing, partial: res.partial };
  }
  function pushText(target, r){
    var where = target === 'yt' ? 'YouTube' : 'Яндекс Музыку';
    if (!r.ok) return 'В ' + where + ' не получилось: ' + (r.error || 'ошибка') + '.';
    return 'В ' + where + ': ' + r.count + ' ' + plural(r.count) + (r.partial ? ' (не всё: ' + (r.error || 'прервалось') + ')' : '') + (r.missing.length ? ', не нашлось там: ' + r.missing.length : '') + '.';
  }
  function setLink(m, target, r){
    if (!m || !r.link) return;
    m.links = m.links || {}; m.linkMap = m.linkMap || {};
    m.links[target] = r.link;
    m.linkMap[target] = Object.assign(m.linkMap[target] || {}, r.map || {});
  }
  async function saveImport(){
    var inc = impIncluded(); if (!inc.length) return;
    var I = imp, btn = $('impSave'); btn.disabled = true;
    var setMsg = function (t){ var m = $('impMsg'); if (m && imp === I) m.textContent = t; };
    var msgs = [];
    if (I.mode === 'transfer') {
      var r = await pushTo(I.only, I.title, inc, setMsg);
      msgs.push(pushText(I.only, r));
      if (I.from && I.from.src === 'tap' && r.ok) { var m0 = localGet(listId(I.from)); if (m0) { setLink(m0, I.only, r); saveLocal(m0); } }
      if (r.needLogin) msgs.push('Войди в YouTube заново (Настройки → Аккаунты) и разреши Тапёру менять плейлисты.');
      myLoaded = false; imp = null;
      await loadMy(true);
      if (I.from) selectMy(I.from.src === 'tap' ? (localGet(listId(I.from)) || I.from) : I.from);
      planNote(msgs.join(' '), r.ok);
      return;
    }
    var tracks = inc.map(function (i){ return slimTrack(i.track); });
    // Название спрашиваем здесь: к этому моменту видно, сколько песен нашлось, и его хочется поправить
    var nm = await askDlg({ title: 'Сохранить плейлист', text: 'Найдено песен: ' + tracks.length + '.', label: 'Название', value: I.title, ok: 'Сохранить' });
    if (!nm) { btn.disabled = false; return; }
    if (nm.value) I.title = nm.value.slice(0, 100);
    var meta = { src: 'tap', type: I.source === 'text' ? 'text' : 'tap', listId: 'tp' + Date.now() + Math.floor(Math.random() * 1000), title: I.title, author: I.source === 'text' ? 'Из текста' : 'Тапёр', count: tracks.length, thumb: (tracks.find(function (t){ return t.thumb; }) || {}).thumb || '', tracks: tracks };
    savedLists.unshift(slim(meta)); meta = savedLists[0];
    msgs.push('Сохранено в Тапёр: ' + tracks.length + ' ' + plural(tracks.length) + '.');
    var anyBad = false;
    for (var x = 0, T = ['ym', 'yt']; x < T.length; x++) {
      var tg = T[x]; if (!I[tg]) continue;
      if (tg === 'ym' && !ymLoggedIn) continue;
      var pr = await pushTo(tg, I.title, inc, setMsg);
      msgs.push(pushText(tg, pr)); if (!pr.ok) anyBad = true;
      setLink(meta, tg, pr);
    }
    if (A.setSetting) A.setSetting('savedLists', savedLists);
    imp = null;
    if (I.ym || I.yt) myLoaded = false;
    if (myLoaded) renderMySide(); else await loadMy(true);
    selectMy(meta);
    planNote(msgs.join(' '), !anyBad);
  }
  function planNote(text, ok){ setTimeout(function(){ var n = $('myPl').querySelector('.plnote'); if (n) { n.textContent = (ok ? '✓ ' : '⚠ ') + text; n.style.color = ok ? '#4ADE9A' : '#FFB86B'; } }, 60); }

  // «Перенести на…»: любой плейлист → мастер с поиском только на выбранной площадке
  function transferList(L, target){
    if (target === 'ym' && !ymLoggedIn) { toast('Сначала войди в Яндекс', 'Войти', browserLogin); return; }
    if (target === 'yt' && !ytCanWrite()) { toast(ytAuth.oauth && ytAuth.oauth.account ? 'Войди в YouTube заново — разреши Тапёру менять плейлисты' : 'Нужен вход в YouTube через браузер', 'Войти', openYtDlg); return; }
    var items = (L.tracks || []).map(function (t){ return { line: (t.author ? t.author + ' — ' : '') + t.title, seconds: t.seconds || 0, track: t }; });
    if (!items.length) { toast('Плейлист пустой'); return; }
    mySel = null; setTab('my');
    startImport({ title: L.title, items: items, only: target, mode: 'transfer', tap: false, from: L.src === 'tap' ? localGet(listId(L)) || L : L });
  }
  function exportM3u(L){
    if (!A.m3uExport) return;
    A.m3uExport(L.title, (L.tracks || []).map(slimTrack)).then(function (r){ if (r && r.ok) toast('Сохранено в файл «' + r.file + '»'); else if (r && r.error) toast('Не сохранилось: ' + r.error); });
  }
  function openTransferMenu(x, y, L){
    var it = [];
    it.push({ label: 'Перенести на Яндекс Музыку…', act: function(){ transferList(L, 'ym'); } });
    it.push({ label: 'Перенести на YouTube…', act: function(){ transferList(L, 'yt'); } });
    it.push('-');
    it.push({ label: 'Сохранить в файл M3U (для AIMP, foobar…)', act: function(){ exportM3u(L); } });
    showCtx(x, y, it);
  }
  // Синхронизация: плейлист Тапёра → его копия на площадке (новые песни добавить, убранные убрать)
  async function syncList(m, target){
    var link = m.links && m.links[target]; if (!link) return;
    var where = target === 'yt' ? 'YouTube' : 'Яндекс Музыке';
    toast('Сверяю с копией на ' + where + '…');
    var rem = await A.plRemote(target, link).catch(function (e){ return { error: String(e) }; });
    if (!rem || rem.error) {
      if (rem && rem.gone) { var g = await askDlg({ title: 'Копии больше нет', text: 'Плейлист «' + esc(link.title || m.title) + '» на ' + where + ' не нашёлся — возможно, его удалили. Отвязать?', ok: 'Отвязать' }); if (g) { delete m.links[target]; saveLocal(m); refreshOpenList(m); } return; }
      toast('Не получилось сверить: ' + ((rem && rem.error) || 'ошибка')); return;
    }
    var remoteIds = target === 'yt' ? rem.items.map(function (x){ return x.videoId; }) : rem.ids;
    var have = new Set(remoteIds), mp = (m.linkMap && m.linkMap[target]) || {};
    var keys = new Set(m.tracks.map(tapKey));
    var add = m.tracks.filter(function (t){ var id = srcOf(t) === target ? String(t.id) : mp[tapKey(t)]; return !id || !have.has(id); });
    var gone = Object.keys(mp).filter(function (k){ return !keys.has(k) && have.has(mp[k]); }).map(function (k){ return mp[k]; });
    if (!add.length && !gone.length) { toast('Копия на ' + where + ' уже такая же'); return; }
    var r = await askDlg({ title: 'Синхронизировать с ' + (target === 'yt' ? 'YouTube' : 'Яндексом'), text: (add.length ? 'Добавить: <b>' + add.length + '</b> ' + plural(add.length) + '<br>' : '') + (gone.length ? 'Убрать: <b>' + gone.length + '</b> (их убрали из плейлиста Тапёра)<br>' : '') + '<span style="color:var(--tx4)">Песни, которые ты добавил прямо на ' + where + ', не трогаю. Новые ищу только «Точно».</span>', ok: 'Синхронизировать' });
    if (!r) return;
    var msgs = [];
    if (add.length) {
      var pr = await pushTo(target, m.title, add.map(function (t){ return { line: (t.author ? t.author + ' — ' : '') + t.title, track: t, seconds: t.seconds }; }), function (t){ toast(t); }, link);
      setLink(m, target, pr); msgs.push(pushText(target, pr));
    }
    if (gone.length) {
      var rr = target === 'yt' ? await A.ytPlRemove(link.listId, gone) : await A.ymPlRemove(link.kind, gone);
      msgs.push(rr && rr.ok ? 'Убрано: ' + (rr.count || 0) + '.' : 'Убрать не получилось: ' + ((rr && rr.error) || 'ошибка') + '.');
      if (rr && rr.ok) Object.keys(mp).forEach(function (k){ if (!keys.has(k)) delete mp[k]; });
    }
    saveLocal(m); refreshOpenList(m); myLoaded = false;
    planNote(msgs.join(' '), true);
  }

  // Ровная громкость и переход — читаем до первого трека (граф звука нужно собрать до загрузки потока)
  function setNormalize(on){
    AX.norm = on;
    allEls().forEach(function (el){ if (!on) el._norm = 1; });
    if (on && curTrack) { var m = master(); if (m === aud || m === aud2 || m === video) axTrackStart(m, curTrack); }
    applyVol();
  }
  if (A.getSetting) {
    A.getSetting('crossfade').then(function (v){ AX.xfade = v == null ? 6 : (parseInt(v, 10) || 0); showXfade(AX.xfade); });
    A.getSetting('normalize').then(function (v){ AX.norm = v !== false; });
    A.getSetting('ytEnabled').then(function (v){ SVC.ytOn = v !== false; renderSvc(); });
    A.getSetting('ymWebFallback').then(function (v){ SVC.ymweb = v !== false; });
    A.getSetting('scEnabled').then(function (v){ SVC.scOn = v !== false; renderSvc(); });
    A.getSetting('auEnabled').then(function (v){ SVC.auOn = v !== false; renderSvc(); });
  } else { axInit(); }

