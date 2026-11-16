  // ===== Музыка с компьютера =====
  var LIB = { count: 0, folders: [], tracks: null, scanning: null };
  var LIBALL = { src: 'lc', type: 'lib', listId: 'lib', title: 'Вся музыка с компьютера' };
  var libView = { tab: 'songs', q: '', shown: 300, artist: '', album: '' };
  function libApply(st){
    if (!st) return;
    var changed = st.count !== LIB.count;
    LIB.count = st.count || 0; LIB.folders = st.folders || []; LIB.scanning = st.scanning || null;
    if (changed) LIB.tracks = null;
    var c = $('chipLc'); if (c) c.hidden = !LIB.count;
    renderLibSettings();
    if (curTab === 'my') { renderMySide(); if (mySel && mySel.src === 'lc') renderLocalView($('myPl'), mySel); }
  }
  if (A.libStatus) A.libStatus().then(libApply).catch(noop);
  if (A.onLibChanged) A.onLibChanged(function (st){ LIB.tracks = null; libApply(st); });
  if (A.onLibProgress) A.onLibProgress(function (p){
    LIB.scanning = p.finished ? null : p;
    var n = document.querySelector('[data-libscan]'); if (n) n.textContent = p.finished ? '' : 'Читаю файлы… ' + p.done + ' из ' + p.total;
    var s = $('setLibNote'); if (s && !p.finished) s.textContent = 'Читаю файлы… ' + p.done + ' из ' + p.total;
  });
  async function libTracks(){ if (!LIB.tracks) LIB.tracks = A.libAll ? (await A.libAll()) || [] : []; return LIB.tracks; }
  async function libAddFolder(dir){
    if (!A.libAddFolder) return;
    toast('Читаю папку — это займёт немного времени…');
    var r = await A.libAddFolder(dir || '');
    if (!r || r.cancelled) return;
    if (r.error) { toast(r.error); return; }
    LIB.tracks = null; libApply(r.status);
    toast(r.already ? 'Эта папка уже есть' : 'Готово: ' + (r.count || 0) + ' ' + plural(r.count || 0) + ' с компьютера' + (r.added ? ' · новых ' + r.added : ''));
    if (curTab === 'my') selectMy(LIBALL);
  }
  // Убрать папку из Тапёра: файлы на компьютере не трогаем. Одно место на все кнопки и меню
  async function libDropFolder(path){
    if (!path || !A.libRemoveFolder) return;
    var ok = await askDlg({ title: 'Убрать папку?', text: esc(path) + '<br>Файлы на компьютере останутся — Тапёр просто перестанет их показывать.', ok: 'Убрать' });
    if (!ok) return;
    LIB.tracks = null;
    var openedThis = mySel && mySel.src === 'lc' && mySel.path === path;
    libApply(await A.libRemoveFolder(path));
    if (openedThis) selectMy(LIB.count ? LIBALL : (localLists()[0] || null));
  }
  // Порядок в выдаче «На компьютере». Выбор держится между папками и запусками
  var LIB_SORTS = [['artist', 'Исполнитель'], ['title', 'Название'], ['album', 'Альбом'], ['year', 'Год'], ['dur', 'Длительность'], ['folder', 'Папка']];
  var libOrder = { k: 'artist', desc: false };
  try { var lo = JSON.parse(localStorage.getItem('tapLibSort') || 'null'); if (lo && lo.k) libOrder = { k: lo.k, desc: !!lo.desc }; } catch (e) {}
  function saveLibOrder(){ try { localStorage.setItem('tapLibSort', JSON.stringify(libOrder)); } catch (e) { console.warn('Тапёр: не сохранилась сортировка библиотеки', e); } }
  function libCmp(a, b){
    var k = libOrder.k, r;
    if (k === 'title') r = (a.title || '').localeCompare(b.title || '', 'ru') || (a.author || '').localeCompare(b.author || '', 'ru');
    else if (k === 'album') r = (a.album || '').localeCompare(b.album || '', 'ru') || ((a.trackNo || 0) - (b.trackNo || 0)) || (a.title || '').localeCompare(b.title || '', 'ru');
    else if (k === 'year') r = ((a.year || 0) - (b.year || 0)) || (a.author || '').localeCompare(b.author || '', 'ru') || (a.title || '').localeCompare(b.title || '', 'ru');
    else if (k === 'dur') r = ((a.seconds || 0) - (b.seconds || 0)) || (a.title || '').localeCompare(b.title || '', 'ru');
    else if (k === 'folder') r = (a.path || '').localeCompare(b.path || '', 'ru');
    else r = libSort(a, b);
    return libOrder.desc ? -r : r;
  }
  function libSort(a, b){ var x = (a.author || '').localeCompare(b.author || '', 'ru') || (a.album || '').localeCompare(b.album || '', 'ru') || ((a.trackNo || 0) - (b.trackNo || 0)) || (a.title || '').localeCompare(b.title || '', 'ru'); return x; }
  function libNorm(x){ return String(x || '').toLowerCase().replace(/ё/g, 'е'); }
  function libFilter(list, m){
    var V = libView;
    if (m.type === 'folder') list = list.filter(function (t){ return t.path && (t.path === m.path || t.path.indexOf(m.path) === 0); });
    var q = libNorm(V.q).split(/\s+/).filter(Boolean);
    if (q.length) list = list.filter(function (t){ var h = libNorm(t.author + ' ' + t.title + ' ' + (t.album || '')); return q.every(function (w){ return h.indexOf(w) >= 0; }); });
    return list;
  }
  function libGroups(list, key){
    var g = {};
    list.forEach(function (t){
      var k = key === 'artist' ? (t.author || 'Без исполнителя') : ((t.album || 'Без альбома') + '\u0001' + (t.author || ''));
      (g[k] = g[k] || { name: key === 'artist' ? k : (t.album || 'Без альбома'), author: t.author, key: k, tracks: [], thumb: '', year: 0 }).tracks.push(t);
      if (!g[k].thumb && t.thumb) g[k].thumb = t.thumb;
      if (t.year) g[k].year = t.year;
    });
    return Object.keys(g).map(function (k){ return g[k]; }).sort(function (a, b){ return a.name.localeCompare(b.name, 'ru'); });
  }
  async function renderLocalView(host, m){
    var tok = host._tok = (host._tok || 0) + 1;
    host._backFn = null;
    if (!LIB.count && !LIB.folders.length) {
      host.innerHTML = '<div class="lib-empty"><div class="lib-ic">💻</div><h3>Музыка с компьютера</h3>' +
        '<p>Добавь папку с песнями — Тапёр прочитает названия, исполнителей и обложки из файлов. Свои файлы появятся в поиске и в «Плейлисте из текста»: если песня есть на компьютере, играет она.</p>' +
        '<p class="lib-sm">MP3, FLAC, M4A/AAC, OGG/Opus, WAV. Файлы никуда не загружаются. Можно просто перетащить файлы или папку в окно Тапёра.</p>' +
        '<div class="plbtns" style="justify-content:center"><button class="pbtn y" data-lib="add">Добавить папку с музыкой</button><button class="pbtn" data-lib="files">Открыть файлы…</button></div></div>';
      host.querySelector('.plbtns').onclick = libBtn;
      return;
    }
    host.innerHTML = '<div class="muted">Загружаю музыку с компьютера…</div>';
    var all = await libTracks();
    if (host._tok !== tok) return;
    var V = libView;
    var base = libFilter(all, m).slice().sort(libCmp);
    var songs = base.filter(function (t){ return (!V.artist || t.author === V.artist) && (!V.album || ((t.album || 'Без альбома') + '\u0001' + (t.author || '')) === V.album); });
    var artists = libGroups(base, 'artist'), albums = libGroups(base, 'album');
    var title = m.type === 'folder' ? m.title : 'Музыка с компьютера';
    var sel = V.artist ? 'Исполнитель: ' + V.artist : (V.album ? 'Альбом: ' + V.album.split('\u0001')[0] : '');
    var cover = (songs.find(function (t){ return t.thumb; }) || {}).thumb || '';
    host.innerHTML =
      '<div class="plhead">' + (cover ? '<img class="pcov" src="' + esc(cover) + '" alt="">' : '<div class="pcov lib-cov"></div>') +
        '<div class="pinfo"><div class="pk">' + srcDot({ src: 'lc' }) + 'Мои файлы · ' + (m.type === 'folder' ? 'папка' : 'вся музыка') + '</div><h3>' + esc(title) + '</h3>' +
        '<div class="pm">' + all.length + ' ' + plural(all.length) + ' · папок ' + LIB.folders.length + ' <span data-libscan>' + (LIB.scanning ? 'Читаю файлы… ' + LIB.scanning.done + ' из ' + LIB.scanning.total : '') + '</span></div>' +
        '<div class="plbtns">' +
          '<button class="pbtn qadd" data-lib="queue">＋ Всё в очередь</button><button class="pbtn y" data-lib="bg">' + PLAY_SM + '<span class="lbl-bg">' + BGL() + '</span></button><button class="pbtn" data-lib="shuffle">' + SHUF_SVG + '<span class="lbl-shuf">' + SHL() + '</span></button>' +
          '<button class="pbtn" data-lib="save">Сохранить как плейлист</button>' +
          '<button class="pbtn" data-lib="add">＋ Папка</button><button class="pbtn" data-lib="files">Открыть файлы…</button><button class="pbtn" data-lib="rescan" title="Перечитать папки: новые файлы, удалённые, изменённые теги">Обновить</button>' +
        '</div></div></div>' +
      '<div class="lib-bar"><input class="imp-f" id="libQ" placeholder="Найти в своей музыке…" value="' + esc(V.q) + '" aria-label="Найти в своей музыке">' + (sel ? '<button class="lib-chip" data-lib="clear" title="Показать всё">' + esc(sel) + ' ✕</button>' : '') +
        '<label class="lib-sort">Порядок <select class="field" id="libSortSel" aria-label="Порядок песен">' + LIB_SORTS.map(function (x){ return '<option value="' + x[0] + '"' + (libOrder.k === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
        '<button class="lib-sdir" id="libSortDir" title="' + (libOrder.desc ? 'Сейчас по убыванию — нажми, чтобы по возрастанию' : 'Сейчас по возрастанию — нажми, чтобы по убыванию') + '" aria-label="Направление сортировки">' + (libOrder.desc ? '↓' : '↑') + '</button></div>' +
      '<div class="ar-tabs" role="tablist">' + [['songs', 'Песни', songs.length], ['artists', 'Исполнители', artists.length], ['albums', 'Альбомы', albums.length], ['folders', 'Папки', LIB.folders.length]].map(function (x){ return '<button role="tab" data-lt="' + x[0] + '"' + (V.tab === x[0] ? ' class="on"' : '') + '>' + x[1] + ' <small>' + x[2] + '</small></button>'; }).join('') + '</div>' +
      '<div class="lib-body"></div>';
    var body = host.querySelector('.lib-body');
    host.querySelector('.plbtns').onclick = function (e){ libBtn(e, songs, title + (sel ? ' — ' + sel : '')); };
    host.querySelector('.ar-tabs').onclick = function(e){ var b = e.target.closest('[data-lt]'); if (!b) return; V.tab = b.dataset.lt; V.shown = 300; renderLocalView(host, m); };
    var chip = host.querySelector('.lib-chip'); if (chip) chip.onclick = function(){ V.artist = ''; V.album = ''; renderLocalView(host, m); };
    var ss = $('libSortSel'); if (ss) ss.onchange = function(){ libOrder.k = ss.value; saveLibOrder(); V.shown = 300; renderLocalView(host, m); };
    var sd = $('libSortDir'); if (sd) sd.onclick = function(){ libOrder.desc = !libOrder.desc; saveLibOrder(); V.shown = 300; renderLocalView(host, m); };
    var qi = $('libQ'), qt = null;
    qi.oninput = function(){ clearTimeout(qt); qt = setTimeout(function(){ V.q = qi.value; V.shown = 300; renderLocalView(host, m).then(function(){ var x = $('libQ'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }); }, 250); };
    if (V.tab === 'songs') {
      if (!songs.length) { body.innerHTML = '<div class="muted">' + (V.q ? 'Ничего не нашлось.' : 'Песен пока нет — нажми «Обновить», если только что добавил файлы.') + '</div>'; return; }
      var rows = document.createElement('div'); rows.className = 'plrows'; body.appendChild(rows);
      var draw = function(){ var part = songs.slice(rows.childElementCount, V.shown); part.forEach(function (t){ rows.appendChild(makeRow(t)); }); };
      draw();
      if (songs.length > V.shown) {
        var more = document.createElement('button'); more.className = 'pbtn g ar-more'; more.textContent = 'Показать ещё (' + (songs.length - V.shown) + ')';
        more.onclick = function(){ V.shown += 500; draw(); if (songs.length > V.shown) more.textContent = 'Показать ещё (' + (songs.length - V.shown) + ')'; else more.remove(); };
        body.appendChild(more);
      }
    } else if (V.tab === 'artists' || V.tab === 'albums') {
      var list = V.tab === 'artists' ? artists : albums, grid = document.createElement('div'); grid.className = 'ar-grid';
      list.forEach(function (g){
        var c = document.createElement('button'); c.className = 'alc';
        c.innerHTML = (g.thumb ? '<img src="' + esc(g.thumb) + '" alt="" loading="lazy">' : '<span class="ph lib-ph">' + esc((g.name || '?').slice(0, 1).toUpperCase()) + '</span>') + '<b>' + esc(g.name) + '</b><small>' + (V.tab === 'albums' && g.author ? esc(g.author) + ' · ' : '') + (g.year ? g.year + ' · ' : '') + g.tracks.length + ' ' + plural(g.tracks.length) + '</small>';
        c.onclick = function(){ if (V.tab === 'artists') { V.artist = g.name; V.album = ''; } else { V.album = g.key; V.artist = ''; } V.tab = 'songs'; V.shown = 300; renderLocalView(host, m); };
        grid.appendChild(c);
      });
      if (!list.length) body.innerHTML = '<div class="muted">Пусто.</div>'; else body.appendChild(grid);
    } else {
      var fl = document.createElement('div'); fl.className = 'lib-folders';
      LIB.folders.forEach(function (f){
        var r = document.createElement('div'); r.className = 'lib-fold';
        r.innerHTML = '<span class="lib-fi">📁</span><span class="lib-fp" title="' + esc(f.path) + '">' + esc(f.path) + '</span><span class="lib-fc">' + f.count + ' ' + plural(f.count) + '</span><button class="imp-sm" data-fopen="1">Открыть</button><button class="imp-sm" data-fdel="1">Убрать из Тапёра</button>';
        r.querySelector('[data-fopen]').onclick = function(){ selectMy({ src: 'lc', type: 'folder', listId: 'fd:' + f.path, path: f.path, title: f.path.split(/[\\/]/).filter(Boolean).pop() || f.path }); };
        r.querySelector('[data-fdel]').onclick = function(){ libDropFolder(f.path); };
        fl.appendChild(r);
      });
      var add = document.createElement('button'); add.className = 'pbtn'; add.textContent = '＋ Добавить папку'; add.onclick = function(){ libAddFolder(); };
      fl.appendChild(add);
      body.appendChild(fl);
    }
  }
  async function libBtn(e, songs, title){
    var b = e.target.closest('button[data-lib]'); if (!b) return; var k = b.dataset.lib;
    if (k === 'add') { libAddFolder(); return; }
    if (k === 'files') { libOpenFiles(); return; }
    if (k === 'rescan') { b.disabled = true; b.textContent = 'Читаю…'; var st = await A.libRescan(); LIB.tracks = null; libApply(st); toast('Обновлено: ' + st.count + ' ' + plural(st.count)); return; }
    songs = songs || [];
    if (!songs.length) return;
    var L = { src: 'tap', type: 'tap', listId: 'lib-play', title: title || 'Мои файлы', author: 'с компьютера', tracks: songs };
    if (k === 'bg' || k === 'shuffle') setBg({ kind: 'list', list: L, shuffle: k === 'shuffle' }, true);
    else if (k === 'queue') addMany(songs, true);
    else if (k === 'save') askDlg({ title: 'Сохранить как плейлист', label: 'Название', value: (title || 'Мои файлы').slice(0, 100) }).then(function (r){ if (!r) return; var nm = localCreate(r.value, songs); toast('Создан «' + nm.title + '» · ' + nm.tracks.length + ' ' + plural(nm.tracks.length)); });
  }
  async function libOpenFiles(){ if (!A.libOpenFiles) return; var r = await A.libOpenFiles(); if (r && !r.cancelled) handleDropped(r); }
  // Что пришло из перетаскивания или «Открыть файлы…»
  async function handleDropped(r){
    if (!r) return;
    if (r.tracks && r.tracks.length) {
      addMany(r.tracks, true);
      var tr = r.tracks;
      toast('В очередь: ' + tr.length + ' ' + plural(tr.length) + ' с компьютера', 'Сохранить как плейлист', function(){ askDlg({ title: 'Сохранить как плейлист', label: 'Название', value: tr.length === 1 ? (tr[0].author || tr[0].title) : 'С компьютера' }).then(function (x){ if (!x) return; var m = localCreate(x.value, tr); selectMy(m); setTab('my'); }); });
      LIB.tracks = null;
    }
    (r.playlists || []).forEach(function (pl){
      setTab('my');
      openImport({ title: pl.title, source: 'm3u', tab: 'file', items: pl.items.map(function (x){ return { line: x.line, seconds: x.seconds, url: x.track ? '' : x.url, track: x.track || null }; }) });
    });
    for (var k = 0; k < (r.folders || []).length; k++) {
      var f = r.folders[k], name = f.split(/[\\/]/).filter(Boolean).pop() || f;
      var a = await askDlg({ title: 'Папка «' + name + '»', text: 'Добавить её в «Музыку с компьютера»? Тапёр будет показывать эти песни в поиске и следить за новыми файлами.', check: 'Только сыграть сейчас, не добавлять', checked: false, ok: 'Готово' });
      if (!a) continue;
      if (a.checked) { var ft = await A.libFolderTracks(f); if (ft && ft.length) { addMany(ft.sort(libSort), true); toast('В очередь: ' + ft.length + ' ' + plural(ft.length)); } else toast('В папке нет музыки'); }
      else await libAddFolder(f);
    }
    if (r.other && !(r.tracks || []).length && !(r.playlists || []).length && !(r.folders || []).length) toast('Это не музыка — подходят MP3, FLAC, M4A, OGG, WAV и плейлисты M3U');
  }
  // Перетаскивание файлов и папок в окно
  (function(){
    var ov = null, depth = 0;
    function hasFiles(e){ var t = e.dataTransfer && e.dataTransfer.types; return t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
    function show(on){
      if (on && !ov) { ov = document.createElement('div'); ov.className = 'drop-ov'; ov.innerHTML = '<div><b>Отпусти, чтобы добавить</b><span>Песни — в очередь, папку — в «Музыку с компьютера», M3U — в импорт</span></div>'; document.body.appendChild(ov); }
      if (!on && ov) { ov.remove(); ov = null; }
    }
    document.addEventListener('dragenter', function(e){ if (!hasFiles(e)) return; depth++; show(true); });
    document.addEventListener('dragleave', function(e){ if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) show(false); });
    document.addEventListener('dragover', function(e){ if (hasFiles(e)) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch (x) {} } });
    document.addEventListener('drop', async function(e){
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; show(false);
      var paths = A.pathsOf ? A.pathsOf(Array.from(e.dataTransfer.files || [])) : [];
      if (!paths.length || !A.libDrop) return;
      handleDropped(await A.libDrop(paths));
    });
  })();
  (function(){
    var a = $('setLibAdd'); if (a) a.onclick = function(){ libAddFolder(); };
    var r = $('setLibRescan'); if (r) r.onclick = async function(){ r.disabled = true; var st = await A.libRescan(); r.disabled = false; LIB.tracks = null; libApply(st); };
    var f = $('setLibFolders'); if (f) f.onclick = async function(e){ var b = e.target.closest('[data-sfdel]'); if (!b) return; var x = LIB.folders[+b.dataset.sfdel]; if (!x) return; libApply(await A.libRemoveFolder(x.path)); LIB.tracks = null; };
  })();
  function renderLibSettings(){
    var box = $('setLibFolders'); if (!box) return;
    box.innerHTML = LIB.folders.length ? LIB.folders.map(function (f, i){ return '<div class="lib-fold"><span class="lib-fi">📁</span><span class="lib-fp" title="' + esc(f.path) + '">' + esc(f.path) + '</span><span class="lib-fc">' + f.count + '</span><button class="imp-sm" data-sfdel="' + i + '">Убрать</button></div>'; }).join('') : '<div class="sd">Папок пока нет.</div>';
    var n = $('setLibNote'); if (n) n.textContent = LIB.scanning ? 'Читаю файлы… ' + LIB.scanning.done + ' из ' + LIB.scanning.total : (LIB.count ? 'Всего ' + LIB.count + ' ' + plural(LIB.count) : '');
  }

  // ===== «Собрать песни» со страницы во вкладке «Браузер» (ВКонтакте, Telegram Web, YouTube, любые сайты) =====
  // Берём только названия, не сами файлы. Потом Тапёр ищет эти песни на площадках.
  var COLLECT_JS = "(async function(auto){var out=[],seen={},links={};function add(s){s=String(s||'').replace(/\\s+/g,' ').trim();if(!s||s.length>200||seen[s.toLowerCase()])return;seen[s.toLowerCase()]=1;out.push(s);}" +
    "function txt(el){return el?String(el.innerText||el.textContent||'').trim():'';}" +
    "function grab(){" +
      "document.querySelectorAll('.audio_row').forEach(function(r){var p=r.querySelector('.audio_row__performers'),t=r.querySelector('.audio_row__title_inner,.audio_row__title');if(t)add((p?txt(p)+' — ':'')+txt(t));});" +
      "document.querySelectorAll('[data-testid=\"MusicTrackRow\"],[class*=\"AudioRow\"],[class*=\"vkuiSimpleCell\"][class*=\"Audio\"]').forEach(function(r){var t=r.querySelector('[data-testid=\"MusicTrackRow_Title\"],[class*=\"Title\"]'),p=r.querySelector('[data-testid=\"MusicTrackRow_Authors\"],[class*=\"Author\"],[class*=\"Artist\"],[class*=\"Subtitle\"]');if(t)add((p&&txt(p)!==txt(t)?txt(p)+' — ':'')+txt(t));});" +
      "document.querySelectorAll('.Audio').forEach(function(a){var t=a.querySelector('.title'),p=a.querySelector('.performer');if(!t)return;var pp=p?txt(p).split('•')[0].trim():'';add((pp&&!/^\\d/.test(pp)?pp+' — ':'')+txt(t));});" +
      "document.querySelectorAll('ytd-playlist-video-renderer,ytd-playlist-panel-video-renderer').forEach(function(r){var t=r.querySelector('#video-title'),c=r.querySelector('ytd-channel-name #text,#byline');if(t)add((c?txt(c).replace(/\\s*-\\s*Topic$/,'')+' — ':'')+txt(t));});" +
      "document.querySelectorAll('[class*=\"d-track\"] ,[class*=\"CommonTrack_root\"]').forEach(function(r){var t=r.querySelector('[class*=\"d-track__title\"],[class*=\"Meta_title\"]'),p=r.querySelector('[class*=\"d-track__artists\"],[class*=\"Meta_artists\"]');if(t)add((p?txt(p)+' — ':'')+txt(t));});" +
      "document.querySelectorAll('a[href]').forEach(function(a){var h=a.href;if(/music\\.yandex\\.[a-z]+\\/(album|users|playlists|track)|youtube\\.com\\/(watch|playlist)|youtu\\.be\\/|soundcloud\\.com\\/[^/]+\\/[^/]+|open\\.spotify\\.com\\/(track|album|playlist)/.test(h))links[h]=1;});" +
    "}" +
    "grab();if(auto){var sc=document.scrollingElement||document.body,last=-1;for(var i=0;i<25&&sc.scrollHeight!==last;i++){last=sc.scrollHeight;sc.scrollTop=sc.scrollHeight;window.scrollTo(0,sc.scrollHeight);await new Promise(function(r){setTimeout(r,700);});grab();}}" +
    "if(!out.length){String(document.body.innerText||'').split('\\n').forEach(function(l){l=l.trim();if(/^[^-–—]{2,60}\\s[-–—]\\s[^-–—]{2,90}$/.test(l))add(l);});}" +
    "return {title:document.title,host:location.hostname,lines:out.slice(0,2000),links:Object.keys(links).slice(0,300)};})";
  async function brCollect(){
    var w = brView(); if (!w) { toast('Сначала открой страницу во вкладке «Браузер»'); return; }
    var host = ''; try { host = new URL(w.getURL()).hostname; } catch (e) {}
    var auto = /(^|\.)vk\.(com|ru)$/.test(host);
    var b = $('brCollect'); if (b) { b.disabled = true; b.textContent = auto ? 'Листаю и собираю…' : 'Собираю…'; }
    var r = null;
    try { r = await w.executeJavaScript(COLLECT_JS + '(' + (auto ? 'true' : 'false') + ')'); } catch (e) { r = null; }
    if (b) { b.disabled = false; b.textContent = 'Собрать песни'; }
    if (!r || (!r.lines.length && !r.links.length)) { toast(/telegram/.test(host) ? 'Не нашёл песен — открой чат и пролистай его вверх, чтобы музыка подгрузилась' : 'На этой странице не нашёл песен'); return; }
    var items = r.lines.map(function (l){ return { line: l }; }).concat(r.links.map(function (u){ return { url: u, line: '' }; }));
    setTab('my');
    openImport({ title: String(r.title || 'Со страницы').replace(/\s*[|—-]\s*(ВКонтакте|VK|YouTube|Telegram.*)$/i, '').slice(0, 100), source: 'page', tab: 'url', items: items, note: (auto ? 'Тапёр пролистал страницу до конца. ' : '') + 'Собрано со страницы ' + r.host + ' — только названия песен.' });
  }

