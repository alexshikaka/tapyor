  // ===== Открытый плейлист (в поиске и во вкладке «Плейлисты») =====
  var savedLists = [];
  // Закладки на чужие плейлисты («Ссылки») убраны 28.10.2026 — остаются только свои плейлисты Тапёра
  if (A.getSetting) A.getSetting('savedLists').then(function (v){ savedLists = (Array.isArray(v) ? v : []).filter(function (x){ return x && x.src === 'tap'; }); if (curTab === 'my') renderMySide(); });
  function listId(m){ return m.src + ':' + (m.type === 'liked' || m.type === 'disliked' ? m.type : (m.listId || m.uuid || (m.uid && m.kind ? m.uid + '/' + m.kind : '') || m.artistId || m.title)); }
  function slimTrack(v){
    var o = {};
    for (var k in v) { if (k[0] === '_' || k === 'alts' || k === 'played' || k === 'bg' || k === 'fromList' || k === 'altTried') continue; var x = v[k]; if (x != null && (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')) o[k] = x; }
    return o;
  }
  function slim(m){
    var o = { src: m.src, type: m.type, listId: m.listId, uid: m.uid, kind: m.kind, uuid: m.uuid, artistId: m.artistId, title: m.title, author: m.author, count: m.count || (m.tracks ? m.tracks.length : 0), thumb: m.thumb };
    if (m.src === 'tap') { o.tracks = (m.tracks || []).map(slimTrack); if (m.links) o.links = m.links; if (m.linkMap) o.linkMap = m.linkMap; }
    if (m.own) o.own = true; if (m.mine) o.mine = true;
    return o;
  }
  function openSearchList(meta){ results.hidden = true; $('searchPl').hidden = false; renderListView($('searchPl'), meta, true); }
  function closeSearchList(){ results.hidden = false; $('searchPl').hidden = true; $('searchPl').innerHTML = ''; }
  function loadList(meta){
    if (meta.src === 'ym' && meta.type === 'liked') return A.ymLiked();
    if (meta.src === 'ym' && meta.type === 'disliked') return A.ymDisliked();
    if (meta.src === 'yt' && meta.type === 'liked') return A.ytLiked();
    if (meta.src === 'sc' || meta.src === 'bc') return A.urlList(meta.listId);
    if (meta.src === 'ym' && meta.type === 'artist') return A.ymArtist(meta.artistId);
    if (meta.src === 'ym' && meta.type === 'album') return A.ymAlbum(meta.albumId);
    if (meta.src === 'ym') return A.ymPlaylist({ uid: meta.uid, kind: meta.kind, uuid: meta.uuid, title: meta.title });
    return A.ytPlaylist(meta.listId, meta.title);
  }
  async function renderListView(host, meta, withBack, backFn, backLabel){
    var tok = host._tok = (host._tok || 0) + 1;
    host._backFn = backFn || null;
    var back = withBack ? '<button class="back" data-back="1">' + esc(backLabel || '← Назад к поиску') + '</button>' : '';
    var local = meta.src === 'tap';
    if (local) { var cur = localGet(listId(meta)); if (cur) meta = cur; }
    host.innerHTML = back + '<div class="muted">Загружаю «' + esc(meta.title || '') + '»…</div>';
    bindBack(host);
    var list = meta.tracks ? meta : await loadList(meta);
    if (host._tok !== tok) return;
    if (!list || list.error) { host.innerHTML = back + '<div class="muted">Не удалось открыть: ' + esc((list && list.error) || 'ошибка') + '</div>'; bindBack(host); return; }
    var L = local ? meta : {};
    if (!local) [meta, list].forEach(function (o){ for (var k in o) if (o[k] !== undefined && o[k] !== '' && o[k] !== null) L[k] = o[k]; });
    L.tracks = list.tracks || [];
    var kindName = local ? (L.type === 'text' ? 'плейлист из текста' : 'плейлист Тапёра') : (L.type === 'album' ? 'альбом' : (L.type === 'artist' ? 'исполнитель' : (L.type === 'liked' ? 'любимое' : (L.type === 'disliked' ? 'не нравится' : 'плейлист'))));
    var ownYm = !local && L.src === 'ym' && L.type === 'playlist' && L.own && L.kind, ownYt = !local && L.src === 'yt' && L.type === 'playlist' && L.mine && L.listId;
    var linksTxt = local && L.links ? Object.keys(L.links).map(function (k){ return (k === 'yt' ? 'YouTube' : 'Яндекс') + ' «' + (L.links[k].title || L.title) + '»'; }).join(', ') : '';
    var thumb = L.thumb || (local ? ((L.tracks.find(function (t){ return t.thumb; }) || {}).thumb || '') : '');
    var dupN = local ? countDups(L.tracks) : 0;
    host.innerHTML = back +
      '<div class="plhead">' + (plCovers[listId(L)] ? coverHtml(plCovers[listId(L)], 'pcov') : (thumb ? '<img class="pcov" src="' + esc(thumb) + '" alt="">' : '<div class="pcov"' + (L.type === 'liked' ? ' style="background:linear-gradient(135deg,#FF3D6E,#9B87FF)"' : (local ? ' style="background:linear-gradient(135deg,#9B87FF,#4A3F8F)"' : '')) + '></div>')) +
        '<div class="pinfo"><div class="pk">' + srcDot(L) + srcName(L) + ' · ' + kindName + '</div>' +
        '<div class="ptitle"><h3' + (local ? ' class="ren" title="Дважды нажми, чтобы переименовать"' : '') + '>' + esc(L.title) + '</h3>' +
          '<span class="pcount">' + (L.tracks.length + ' ' + (L.src === 'yt' ? 'видео' : plural(L.tracks.length))) + '</span></div>' +
        '<div class="pm">' + (L.author && L.type !== 'liked' && !local ? esc(L.author) : '') + '</div>' +
        '<div class="plbtns">' +
          '<button class="pbtn qadd" data-a="queue">＋ Всё в очередь</button>' +
          '<button class="pbtn y" data-a="bg"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"></path></svg><span class="lbl-bg">' + BGL() + '</span></button>' +
          '<button class="pbtn" data-a="shuffle"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"></path></svg><span class="lbl-shuf">' + SHL() + '</span></button>' +
          (ymLoggedIn && L.tracks.length ? '<button class="pbtn" data-a="wave">' + WAVE_SVG + 'Волна по плейлисту</button>' : '') +
          (!local && L.tracks.length ? '<button class="pbtn" data-a="copy" title="Свой плейлист Тапёра с этими треками — его можно менять">Копия в мои плейлисты</button>' : '') +
          (L.tracks.length ? '<button class="pbtn" data-a="xfer" title="Сделать такой же плейлист на Яндексе или YouTube, или сохранить в файл">Перенести ▾</button>' : '') +
          (local && L.links && L.links.ym ? '<button class="pbtn" data-a="sync-ym" title="Добавить на Яндекс новые песни и убрать удалённые">⟳ Синхронизировать с Яндексом</button>' : '') +
          (local && L.links && L.links.yt ? '<button class="pbtn" data-a="sync-yt" title="Добавить на YouTube новые песни и убрать удалённые">⟳ Синхронизировать с YouTube</button>' : '') +
          (ownYm || ownYt ? '<button class="pbtn" data-a="pren">Переименовать</button><button class="pbtn danger" data-a="pdel">Удалить ' + (ownYm ? 'на Яндексе' : 'на YouTube') + '</button>' : '') +
          (local ? '<button class="pbtn" data-a="rename">Переименовать</button>' : '') +
          (local && dupN ? '<button class="pbtn" data-a="dedupe">Убрать повторы (' + dupN + ')</button>' : '') +
          (local ? '<button class="pbtn danger" data-a="del">Удалить плейлист</button>' : '') +
        '</div></div></div>' +
      '<div class="plnote">' + (linksTxt ? 'Копии на площадках: ' + esc(linksTxt) + '.' : '') + '</div>' +
      '<div class="plrows"></div>';
    bindBack(host);
    var rowsBox = host.querySelector('.plrows');
    if (!L.tracks.length) rowsBox.innerHTML = '<div class="muted">' + (local ? 'Пока пусто. Добавляй песни через «⋯» → «В плейлист…» в поиске или очереди.' : 'Здесь пусто.') + '</div>';
    else if (!local) {
      appendResults(L.tracks, rowsBox);
      if (ownYm || ownYt) rowsBox.querySelectorAll('.row').forEach(function (r){
        var t = r._v; if (!t) return;
        r._rmWhere = ownYm ? 'на Яндексе' : 'на YouTube';
        var mb0 = r.querySelector('.more'); if (mb0) mb0.title = 'Ещё · здесь «Убрать ' + r._rmWhere + '»';
        r._rm = async function(){
          var res = ownYm ? await A.ymPlRemove(L.kind, [t.id]) : await A.ytPlRemove(L.listId, [t.id]);
          if (res && res.ok) { r.remove(); L.tracks = L.tracks.filter(function (x){ return x !== t; }); toast('Убрано: «' + t.title + '»'); }
          else toast('Не получилось: ' + ((res && res.error) || 'ошибка'));
        };
      });
    }
    else {
      L.tracks.forEach(function (t, i){
        var r = makeRow(t); r.dataset.pi = i; r.draggable = true; r.classList.add('prow');
        r.title = 'Перетащи, чтобы поменять порядок';
        var mb1 = r.querySelector('.more'); if (mb1) mb1.title = 'Ещё · здесь «Убрать из плейлиста»';
        r._rm = function(){ localRemoveTrack(L, i); }; // «Убрать из плейлиста» — в меню «⋯» песни
        rowsBox.appendChild(r);
      });
      bindPlDrag(rowsBox, L);
    }
    var h3 = host.querySelector('h3.ren'); if (h3) h3.ondblclick = function(){ localRename(L); };
    host.querySelector('.plbtns').onclick = function(e){
      var b = e.target.closest('button'); if (!b) return;
      var a = b.dataset.a;
      if (a === 'rename') { localRename(L); return; }
      if (a === 'xfer') { var rc = b.getBoundingClientRect(); openTransferMenu(rc.left, rc.bottom + 4, L); return; }
      if (a === 'sync-ym' || a === 'sync-yt') { var lm = localGet(listId(L)); if (lm) syncList(lm, a.slice(5)); return; }
      if (a === 'pren') { platformRename(L, ownYm ? 'ym' : 'yt', host); return; }
      if (a === 'pdel') { platformDelete(L, ownYm ? 'ym' : 'yt'); return; }
      if (a === 'del') { localDelete(L); return; }
      if (a === 'dedupe') { localDedupe(L); return; }
      if (a === 'copy') { var cm = localCreate(L.title, L.tracks); toast('Создан плейлист «' + cm.title + '» · ' + cm.tracks.length + ' ' + plural(cm.tracks.length), 'Переименовать', function(){ localRename(cm); }); return; }
      if (!L.tracks.length) return;
      if (a === 'bg') setBg({ kind: 'list', list: L, shuffle: false }, true);
      else if (a === 'shuffle') setBg({ kind: 'list', list: L, shuffle: true }, true);
      else if (a === 'wave') waveByList(L);
      else if (a === 'queue') addMany(L.tracks, true);
    };
  }

  // ===== Страница исполнителя: Яндекс (играет сразу) + Deezer (полная дискография) =====
  function firstArtist(v){
    var p = window.TapRank ? TapRank.parse(v) : { artist: v.author };
    var a = (window.TapRank ? TapRank.splitArtists(p.artist || v.author || '') : [{ name: v.author }]).find(function (x){ return x.name; });
    return window.TapRank ? TapRank.cleanChannel(a ? a.name : (v.author || '')) : (a ? a.name : v.author);
  }
  var AP = null; // открытая страница: { name, data, tab }
  var AP_TABS = [{ id: 'search', n: 'Поиск' }, { id: 'pop', n: 'Популярное' }, { id: 'all', n: 'Все треки' }, { id: 'album', n: 'Альбомы' }, { id: 'single', n: 'Синглы и EP' }, { id: 'compilation', n: 'Сборники' }, { id: 'similar', n: 'Похожие' }];
  function apNorm(x){ return String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  function listenersText(n){ if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' млн слушателей'; if (n >= 1e3) return Math.round(n / 1e3) + ' тыс. слушателей'; return n + ' слушателей'; }
  function fansText(n){ if (!n) return ''; if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' млн поклонников'; if (n >= 1e3) return Math.round(n / 1e3) + ' тыс. поклонников'; return n + ' поклонников'; }
  async function openArtistPage(name, ymId){
    name = String(name || '').trim(); if (!name) return;
    closeCtx(); setTab('search');
    search.value = name; sgLastSearched = name; clearTimeout(sgTimer); sgToken++; hideSuggest();
    results.hidden = true; var host = $('searchPl'); host.hidden = false;
    var tok = host._tok = (host._tok || 0) + 1;
    host._backFn = null;
    host.innerHTML = '<button class="back" data-back="1">← Назад к поиску</button><div class="muted">Собираю всё об исполнителе «' + esc(name) + '»…</div>';
    bindBack(host);
    var r = A.artistPage ? await A.artistPage(name, ymId || '') : null;
    if (host._tok !== tok) return;
    if (!r || (!r.ym && !r.dz && !r.lf)) { host.innerHTML = '<button class="back" data-back="1">← Назад к поиску</button><div class="muted">Не нашёл исполнителя «' + esc(name) + '» ни в Яндексе, ни в справочнике Deezer.' + (r && r.errors && r.errors.length ? '<br><span style="font-size:12px">' + esc(r.errors.join(' · ')) + '</span>' : '') + '</div>'; bindBack(host); return; }
    // Альбомы: сначала Яндекс (играют сразу), потом из Deezer те, которых в Яндексе нет
    var y = r.ym, d = r.dz, albums = [], seen = {};
    if (y) y.albums.concat(y.also || []).forEach(function (a){ var k = a.type + '|' + apNorm(a.title); if (seen[k]) return; seen[k] = 1; albums.push(a); });
    if (d) d.albums.forEach(function (a){ var k = a.type + '|' + apNorm(a.title), k2 = apNorm(a.title); if (seen[k] || (y && y.albums.some(function (x){ return apNorm(x.title) === k2; }))) return; seen[k] = 1; a.author = d.name; albums.push(a); });
    albums.sort(function (a, b){ return (b.year || 0) - (a.year || 0); });
    var lf = r.lf;
    AP = { name: (y && y.name) || (d && d.name) || (lf && lf.name) || name, ymId: y && y.id, photo: (y && y.photo) || (d && d.photo) || '', about: (y && y.about) || (lf && lf.bio) || '', aboutSrc: y && y.about ? '' : (lf && lf.bio ? 'Last.fm' : ''), lfUrl: lf && lf.url, tags: lf ? lf.tags : [], listeners: lf ? lf.listeners : 0, fans: d && d.fans, albums: albums,
      popular: y && y.popular.length ? y.popular : null, dzTop: d ? d.top : [], similar: (y && y.similar.length ? y.similar.map(function (x){ return { name: x.name, thumb: x.thumb, ymId: x.id }; }) : (d && d.similar.length ? d.similar : (lf ? lf.similar : []))), tab: 'pop', srcs: [y ? 'Яндекс' : '', d ? 'Deezer' : '', lf ? 'Last.fm' : ''].filter(Boolean) };
    renderArtistPage(host);
    // Все треки — подгружаем сразу, чтобы на вкладке было видно их число
    if (AP.ymId && A.ymArtist) { var P0 = AP; A.ymArtist(P0.ymId).then(function (r){ if (P0.allTracks) return; P0.allTracks = (r && r.tracks) || []; if (AP !== P0) return; if (P0.tab === 'all') renderArtistPage(host); else { var sm = host.querySelector('.ar-tabs [data-apt=all] small'); if (sm) sm.textContent = P0.allTracks.length; } }); }
  }
  var SHUF_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"></path></svg>';
  var PLAY_SM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"></path></svg>';
  // Значки для единого ряда кнопок (исполнитель, выдача поиска)
  var WAVE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"></path></svg>';
  var FIND_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>';
  function apLoadAll(P){ if (P.allTracks || !P.ymId || !A.ymArtist) return Promise.resolve(); return A.ymArtist(P.ymId).then(function (r){ if (!P.allTracks) P.allTracks = (r && r.tracks) || []; }); }
  function apRest(P){ var have = {}; (P.popList || []).forEach(function (t){ have[t.id] = 1; }); return (P.allTracks || []).filter(function (t){ return !have[t.id]; }); }
  // Выдача поиска по имени исполнителя — прямо на его странице (по выбранной «Выдаче»)
  async function apSearch(P, body, host){
    if (!P.searchRes) {
      body.innerHTML = '<div class="muted">Ищу «' + esc(P.name) + '» на всех площадках…</div>';
      var tk = host._tok, q = P.name;
      var ps = [
        (A.ymSearch ? A.ymSearch(q) : Promise.resolve(null)).then(function (r){ return (r && r.tracks) || []; }).catch(function(){ return []; }),
        (ytUsable() && A.ytSearch ? A.ytSearch(q) : Promise.resolve(null)).then(function (r){ return ((r && r.videos) || []).map(function (v){ v.src = 'yt'; return v; }); }).catch(function(){ return []; }),
        (SVC.scOn && A.scSearch ? A.scSearch(q, 15) : Promise.resolve([])).catch(function(){ return []; }),
        (SVC.auOn && A.auSearch ? A.auSearch(q, 10) : Promise.resolve([])).catch(function(){ return []; })
      ];
      var all = [].concat.apply([], await Promise.all(ps));
      if (host._tok !== tk || AP !== P) return;
      P.searchRes = all;
      if (P.tab !== 'search') return;
      body.innerHTML = '';
    }
    var list = searchMode === 'src' ? P.searchRes.slice().sort(function (a, b){ return srcOrder.indexOf(srcOf(a)) - srcOrder.indexOf(srcOf(b)); }) : TapRank.rank(P.name, P.searchRes.map(function (v){ return v; }), searchMode, rankCtx());
    var note = document.createElement('div'); note.className = 'plnote'; note.textContent = 'Выдача поиска по «' + P.name + '» со всех площадок — «Выдача: ' + smodeOf(searchMode).n + '». Сменить можно кнопкой «Выдача» сверху.';
    body.appendChild(note);
    if (!list.length) { body.insertAdjacentHTML('beforeend', '<div class="muted">Ничего не нашлось.</div>'); return; }
    list.forEach(function (v){ body.appendChild(makeRow(v)); });
  }
  function renderArtistPage(host){
    var P = AP; host._backFn = null;
    host._rr = { tok: host._tok, fn: function(){ renderArtistPage(host); } };
    var cnt = function (t){ return P.albums.filter(function (a){ return a.type === t; }).length; };
    var meta = [cnt('album') ? cnt('album') + ' альб.' : '', cnt('single') ? cnt('single') + ' синглов и EP' : '', P.listeners ? listenersText(P.listeners) : fansText(P.fans)].filter(Boolean).join(' · ');
    host.innerHTML = '<button class="back" data-back="1">← Назад к поиску</button>' +
      '<div class="arh">' + (P.photo ? '<img class="arp" src="' + esc(P.photo) + '" alt="">' : '<div class="arp"></div>') +
        '<div class="pinfo"><div class="pk">Исполнитель · данные: ' + esc(P.srcs.join(' + ')) + '</div><h3>' + esc(P.name) + '</h3>' +
        (meta ? '<div class="pm">' + esc(meta) + '</div>' : '') +
        (P.tags && P.tags.length ? '<div class="ar-tags">' + P.tags.map(function (t){ return '<button data-tag="' + esc(t) + '" title="Популярное в жанре «' + esc(t) + '»">' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
        (P.about ? '<div class="ar-about" title="Нажми, чтобы развернуть">' + esc(P.about) + (P.aboutSrc ? ' <span class="ar-src">— ' + esc(P.aboutSrc) + '</span>' : '') + '</div>' : '') +
        // Один ряд действий (пункт 2): очередь — первой и выделена; остальные одного вида; действуют на открытую вкладку
        '<div class="plbtns ar-acts">' +
          '<button class="pbtn qadd" data-ap="queue">＋ Всё в очередь</button>' +
          '<button class="pbtn y" data-ap="bg">' + PLAY_SM + '<span class="lbl-bg">' + BGL() + '</span></button>' +
          '<button class="pbtn" data-ap="shuffle">' + SHUF_SVG + '<span class="lbl-shuf">' + SHL() + '</span></button>' +
          (P.ymId && ymLoggedIn ? '<button class="pbtn" data-ap="wave">' + WAVE_SVG + 'Волна в стиле</button>' : '') +
          '<button class="pbtn" data-ap="search">' + FIND_SVG + 'Поиск</button>' +
          '<button class="pbtn" data-ap="save">Сохранить как плейлист</button>' +
        '</div></div></div>' +
      '<div class="ar-tabs" role="tablist">' + AP_TABS.map(function (t){
        if (t.id === 'search') return P.tab === 'search' ? '<button role="tab" data-apt="search" class="on">Поиск</button>' : '';
        var n = t.id === 'pop' ? (P.popular || P.dzTop || []).length : (t.id === 'similar' ? P.similar.length : (t.id === 'all' ? (P.ymId ? (P.allTracks ? P.allTracks.length : '…') : 0) : cnt(t.id)));
        return n ? '<button role="tab" data-apt="' + t.id + '"' + (P.tab === t.id ? ' class="on"' : '') + '>' + t.n + ' <small>' + n + '</small></button>' : '';
      }).join('') + '</div><div class="ar-body"></div>';
    bindBack(host);
    var tg = host.querySelector('.ar-tags');
    if (tg) tg.onclick = function(e){ var b = e.target.closest('button[data-tag]'); if (b) openTagPage(host, b.dataset.tag); };
    host.querySelector('.ar-acts').onclick = function(e){
      var b = e.target.closest('button'); if (!b) return; var k = b.dataset.ap;
      if (k === 'wave') { setBg({ kind: 'wave', station: 'artist:' + P.ymId, name: 'В стиле ' + P.name }, true); return; }
      if (k === 'search') { P.tab = 'search'; renderArtistPage(host); return; }
      // треки открытой вкладки: «Все треки» — все, иначе популярное
      var all = P.tab === 'all' && P.allTracks, list = all ? P.allTracks : (P.popList || P.popular || []);
      var what = all ? 'Все треки' : 'Популярное';
      if (!list.length) { toast('Треки ещё загружаются'); return; }
      var L = { src: 'ym', type: 'artist', artistId: P.ymId, title: P.name, author: what, thumb: P.photo, tracks: list };
      if (k === 'bg' || k === 'shuffle') setBg({ kind: 'list', list: L, shuffle: k === 'shuffle' }, true);
      else if (k === 'queue') addMany(list, true);
      else if (k === 'save') askDlg({ title: 'Сохранить как плейлист', label: 'Название', value: P.name + ' — ' + what.toLowerCase() }).then(function (r){ if (!r) return; var m = localCreate(r.value, list); toast('Создан «' + m.title + '» · ' + m.tracks.length + ' ' + plural(m.tracks.length)); });
    };
    var ab = host.querySelector('.ar-about'); if (ab) ab.onclick = function(){ ab.classList.toggle('open'); };
    host.querySelector('.ar-tabs').onclick = function(e){ var b = e.target.closest('[data-apt]'); if (!b) return; P.tab = b.dataset.apt; renderArtistPage(host); };
    if (!host.querySelector('.ar-tabs [data-apt="' + P.tab + '"]')) { var f = host.querySelector('.ar-tabs [data-apt]'); if (f) P.tab = f.dataset.apt; host.querySelectorAll('.ar-tabs [data-apt]').forEach(function (b){ b.classList.toggle('on', b.dataset.apt === P.tab); }); }
    var body = host.querySelector('.ar-body');
    if (P.tab === 'search') { apSearch(P, body, host); }
    else if (P.tab === 'all') {
      if (P.allTracks) {
        if (P.allTracks.length) appendResults(P.allTracks, body); else body.insertAdjacentHTML('beforeend', '<div class="muted">Треков не нашлось.</div>');
      } else {
        body.innerHTML = '<div class="muted">Загружаю все треки…</div>';
        var tk = host._tok;
        apLoadAll(P).then(function(){ if (host._tok === tk && AP === P && P.tab === 'all') renderArtistPage(host); });
      }
    } else if (P.tab === 'pop') {
      if (P.popular) {
        // Популярное + «Загрузить ещё» (дальше по популярности из всех треков исполнителя)
        if (!P.popList) P.popList = P.popular.slice();
        var rowsP = document.createElement('div'); rowsP.className = 'plrows'; body.appendChild(rowsP);
        appendResults(P.popList, rowsP);
        if (P.ymId) {
          var more = document.createElement('button'); more.className = 'pbtn g ar-more'; more.textContent = 'Загрузить ещё';
          var hideIfDone = function(){ if (P.allTracks && !apRest(P).length) more.remove(); };
          more.onclick = async function(){
            more.disabled = true; more.textContent = 'Загружаю…';
            await apLoadAll(P);
            var add = apRest(P).slice(0, 20);
            P.popList = P.popList.concat(add); appendResults(add, rowsP);
            more.disabled = false; more.textContent = 'Загрузить ещё';
            if (!add.length) { more.textContent = 'Больше нет'; more.disabled = true; }
            hideIfDone();
          };
          body.appendChild(more); hideIfDone();
        }
      } else renderFindRows(body, P.dzTop, 'Популярное по данным Deezer — Тапёр ищет каждую песню на площадках');
    } else if (P.tab === 'similar') {
      var g = document.createElement('div'); g.className = 'ar-sim';
      P.similar.forEach(function (x){ var b = document.createElement('button'); b.className = 'ar-simc'; b.innerHTML = (x.thumb ? '<img src="' + esc(x.thumb) + '" alt="">' : '<span class="ph"></span>') + '<span>' + esc(x.name) + '</span>'; b.onclick = function(){ openArtistPage(x.name, x.ymId); }; g.appendChild(b); });
      body.appendChild(g);
    } else {
      var grid = document.createElement('div'); grid.className = 'ar-grid';
      P.albums.filter(function (a){ return a.type === P.tab; }).forEach(function (a){
        var c = document.createElement('button'); c.className = 'alc';
        c.innerHTML = (a.thumb ? '<img src="' + esc(a.thumb) + '" alt="" loading="lazy">' : '<span class="ph"></span>') + '<b>' + esc(a.title) + '</b><small>' + (a.year ? a.year + ' · ' : '') + (a.count ? a.count + ' ' + plural(a.count) + ' · ' : '') + (a.src === 'ym' ? srcDot({ src: 'ym' }) + 'Яндекс' : '<span class="dot" style="background:#A238FF"></span>найду на площадках') + '</small>';
        c.onclick = function(){ openArtistAlbum(host, a); };
        grid.appendChild(c);
      });
      body.appendChild(grid);
    }
  }
  function openArtistAlbum(host, a){
    var back = function(){ renderArtistPage(host); };
    if (a.src === 'ym') { renderListView(host, { src: 'ym', type: 'album', albumId: a.id, listId: 'album' + a.id, title: a.title, author: AP.name, thumb: a.thumb }, true, back, '← К исполнителю'); return; }
    renderDzAlbum(host, a, back);
  }
  // Альбом из справочника: треклист + автоматический поиск каждой песни на площадках
  async function renderDzAlbum(host, a, back){
    var tok = host._tok = (host._tok || 0) + 1;
    host._backFn = back;
    host._rr = { tok: tok, fn: function(){ renderDzAlbum(host, a, back); } };
    host.innerHTML = '<button class="back" data-back="1">← К исполнителю</button><div class="muted">Загружаю треклист «' + esc(a.title) + '»…</div>'; bindBack(host);
    var al = await A.dzAlbum(a.id);
    if (host._tok !== tok) return;
    if (!al || al.error) { host.innerHTML = '<button class="back" data-back="1">← К исполнителю</button><div class="muted">Не удалось загрузить: ' + esc((al && al.error) || 'ошибка') + '</div>'; bindBack(host); return; }
    host.innerHTML = '<button class="back" data-back="1">← К исполнителю</button>' +
      '<div class="plhead">' + (al.thumb ? '<img class="pcov" src="' + esc(al.thumb) + '" alt="">' : '<div class="pcov"></div>') +
        '<div class="pinfo"><div class="pk"><span class="dot" style="background:#A238FF"></span>Альбом из справочника Deezer</div><h3>' + esc(al.title) + '</h3><div class="pm">' + esc(al.author) + (al.year ? ' · ' + al.year : '') + ' · ' + al.tracks.length + ' ' + plural(al.tracks.length) + '</div>' +
        '<div class="plbtns"><button class="pbtn qadd" data-da="queue">＋ Найденное в очередь</button><button class="pbtn y" data-da="bg"><span class="lbl-bg">' + BGL() + '</span></button><button class="pbtn" data-da="save">Сохранить как плейлист</button></div></div></div>' +
      '<div class="plnote">Этого альбома нет в Яндексе — Тапёр ищет каждую песню на площадках (по выбранной «Выдаче»). «Точно» — нашлась та самая, «Похоже» — проверь, «Не нашлось» — можно поискать вручную.</div><div class="plrows"></div>';
    bindBack(host);
    var rows = host.querySelector('.plrows');
    var items = renderFindRows(rows, al.tracks);
    var found = function(){ return items.filter(function (it){ return it.track; }).map(function (it){ return it.track; }); };
    host.querySelector('.plbtns').onclick = function(e){
      var b = e.target.closest('button'); if (!b) return; var f = found();
      if (!f.length) { toast('Пока ничего не нашлось — подожди, идёт поиск'); return; }
      var L = { src: 'tap', type: 'tap', listId: 'dz' + al.id, title: al.title, author: al.author, thumb: al.thumb, tracks: f };
      if (b.dataset.da === 'bg') setBg({ kind: 'list', list: L, shuffle: false }, true);
      else if (b.dataset.da === 'queue') addMany(f, true);
      else if (b.dataset.da === 'save') askDlg({ title: 'Сохранить как плейлист', label: 'Название', value: al.author + ' — ' + al.title }).then(function (r){ if (!r) return; var m = localCreate(r.value, f); toast('Создан «' + m.title + '» · ' + m.tracks.length + ' ' + plural(m.tracks.length)); });
    };
  }
  // Тег исполнителя: популярное в жанре по Last.fm, каждая песня ищется на площадках.
  // Нет Last.fm (ключа или связи) — обычный поиск по слову тега.
  async function openTagPage(host, tag){
    var plain = function(){ search.value = tag; doSearch({ nav: true }); };
    if (!A.lfTagTop) { plain(); return; }
    var tok = host._tok = (host._tok || 0) + 1, back = function(){ renderArtistPage(host); };
    host._backFn = back;
    host._rr = { tok: tok, fn: function(){ openTagPage(host, tag); } };
    host.innerHTML = '<button class="back" data-back="1">← К исполнителю</button><div class="muted">Собираю популярное в жанре «' + esc(tag) + '»…</div>'; bindBack(host);
    var r = await A.lfTagTop(tag).catch(function (err){ return { error: String(err && err.message || err) }; });
    if (host._tok !== tok) return;
    if (!r || r.error || !r.tracks || !r.tracks.length) { if (r && r.error) axLog('тег «' + tag + '»: ' + r.error + ' — обычный поиск'); plain(); return; }
    host.innerHTML = '<button class="back" data-back="1">← К исполнителю</button>' +
      '<div class="plhead"><div class="pcov" style="background:linear-gradient(135deg,var(--ac),var(--bg3))"></div>' +
        '<div class="pinfo"><div class="pk">Жанр · данные: Last.fm</div><h3>' + esc(tag) + '</h3><div class="pm">' + r.tracks.length + ' ' + plural(r.tracks.length) + ' · популярное</div>' +
        '<div class="plbtns"><button class="pbtn qadd" data-tq="queue">＋ Найденное в очередь</button><button class="pbtn y" data-tq="bg">' + PLAY_SM + '<span class="lbl-bg">' + BGL() + '</span></button><button class="pbtn" data-tq="save">Сохранить как плейлист</button><button class="pbtn" data-tq="plain">' + FIND_SVG + 'Обычный поиск</button></div></div></div>' +
      '<div class="plnote">Самое популярное с этим тегом на Last.fm — Тапёр ищет каждую песню на площадках.</div><div class="plrows"></div>';
    bindBack(host);
    var items = renderFindRows(host.querySelector('.plrows'), r.tracks);
    host.querySelector('.plbtns').onclick = function(e){
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tq === 'plain') { plain(); return; }
      var f = items.filter(function (it){ return it.track; }).map(function (it){ return it.track; });
      if (!f.length) { toast('Пока ничего не нашлось — подожди, идёт поиск'); return; }
      var L = { src: 'tap', type: 'tap', listId: 'tag:' + tag, title: tag, author: 'Last.fm', thumb: '', tracks: f };
      if (b.dataset.tq === 'bg') setBg({ kind: 'list', list: L, shuffle: false }, true);
      else if (b.dataset.tq === 'queue') addMany(f, true);
      else if (b.dataset.tq === 'save') askDlg({ title: 'Сохранить как плейлист', label: 'Название', value: 'Жанр: ' + tag }).then(function (x){ if (!x) return; var m = localCreate(x.value, f); toast('Создан «' + m.title + '» · ' + m.tracks.length + ' ' + plural(m.tracks.length)); });
    };
  }
  // Строки «найти на площадках»: каждая песня ищется так же, как в «Плейлисте из текста»
  function renderFindRows(box, tracks, note){
    if (note) { var n = document.createElement('div'); n.className = 'plnote'; n.textContent = note; box.appendChild(n); }
    var items = tracks.map(function (t, i){
      var it = { src: t, track: null, status: 'wait' };
      var r = document.createElement('div'); r.className = 'frow';
      r.innerHTML = '<span class="fn mono">' + (i + 1) + '</span><div class="meta"><div class="t">' + esc(t.title) + '</div><div class="s sub"><span class="sa">' + artistLinks(t.author || '') + '</span></div></div><span class="time mono">' + esc(t.duration || '') + '</span><span class="fst wait">ищу…</span>';
      it.el = r; box.appendChild(r);
      return it;
    });
    var next = 0, tok = (box._ftok = (box._ftok || 0) + 1);
    async function worker(){
      while (next < items.length && box._ftok === tok && box.isConnected) {
        var it = items[next++], t = it.src, res = null;
        try { res = A.matchLine ? await A.matchLine((t.author ? t.author + ' — ' : '') + t.title) : null; }
        catch (e) { axLog('исполнитель: не удалось сопоставить «' + t.title + '» — ' + (e && e.message || e)); }
        if (!box.isConnected || box._ftok !== tok) return;
        res = res || { status: 'none' };
        if (res.track && window.TapRank && searchMode !== 'src' && (res.status === 'exact' || res.status === 'close')) {
          var q0 = res.query || t.title, base = TapRank.relevance(q0, res.track);
          var cand = [res.track].concat(res.alts || []).filter(function (c){ return TapRank.relevance(q0, c) >= base - 8; });
          var best = TapRank.rank(q0, cand.map(function (c){ return Object.assign({}, c); }), searchMode, rankCtx())[0];
          if (best) res.track = cand.find(function (c){ return c.src === best.src && c.id === best.id; }) || res.track;
        }
        it.status = res.status; it.track = (res.status === 'exact' || res.status === 'close') ? res.track : null;
        if (it.track) {
          var row = makeRow(it.track);
          var b = document.createElement('span'); b.className = 'rbadge ' + (res.status === 'exact' ? 'okb' : 'clb'); b.textContent = res.status === 'exact' ? 'точно' : 'похоже — проверь'; b.title = 'Искал: ' + (t.author ? t.author + ' — ' : '') + t.title;
          badgeBox(row).insertBefore(b, badgeBox(row).firstChild);
          it.el.replaceWith(row); it.el = row;
        } else {
          var st = it.el.querySelector('.fst'); st.className = 'fst none'; st.textContent = 'не нашлось';
          var sb = document.createElement('button'); sb.className = 'pbtn g fsearch'; sb.textContent = 'Найти'; sb.onclick = function(){ search.value = (t.author ? t.author + ' ' : '') + t.title; doSearch({ nav: true }); };
          it.el.appendChild(sb);
        }
      }
    }
    worker(); worker(); worker();
    return items;
  }

