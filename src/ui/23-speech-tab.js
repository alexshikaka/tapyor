  // ===== Вкладка «Книги и подкасты» (по макету, по образцу «Плейлистов») =====
  // Слева: «Слушаю сейчас», подписки на подкасты («Следить»), сохранённые книги, история.
  // Сюда попадает всё, что слушали (место прослушивания — listenMarks) и что сохранили (speechSaved).
  var bkSel = 'lib';      // lib (Библиотека) | hist | w:<ключ>
  var bkList = [];        // записи, на которые ссылаются кнопки (data-w)
  var bkFresh = {};       // подписка → { at, L }: выпуски перечитываем не чаще раза в 30 минут
  var BK_IC_LIB = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h4v14H4zM10 5h4v14h-4z"></path><path d="M17 6l3 13"></path></svg>';
  var BK_IC_HIST = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>';

  function bkKey(sp, workId){ return sp + ':' + workId; }
  // Всё, что есть в разделе: сохранённое + то, что начинали слушать
  function bkEntries(){
    var out = {}, k;
    spSaved.forEach(function (s){
      if (!s || !s.workId) return;
      out[bkKey(s.sp, s.workId)] = { sp: s.sp, workId: s.workId, albumId: s.albumId || String(s.workId).replace(/^ym:/, ''),
        title: s.title, author: s.author, thumb: s.thumb, count: s.count, saved: true, seen: s.seen || '' };
    });
    for (k in marks) {
      var m = marks[k]; if (!m || (m.sp !== 'book' && m.sp !== 'pod')) continue;
      var wid = k.slice(k.indexOf(':') + 1);
      var e = out[k] || (out[k] = { sp: m.sp, workId: wid, albumId: m.alb || wid.replace(/^ym:/, ''), title: m.title, author: m.author, thumb: m.thumb });
      e.mark = m;
      if (!e.thumb) e.thumb = m.thumb;
    }
    return Object.keys(out).map(function (x){ return out[x]; });
  }
  function bkPct(e){
    var m = e.mark; if (!m) return 0;
    if (e.sp === 'book' && m.n) return Math.max(1, Math.min(100, Math.round(((m.idx || 1) - 1 + (m.dur ? m.sec / m.dur : 0)) * 100 / m.n)));
    return m.dur ? Math.max(1, Math.min(100, Math.round(m.sec * 100 / m.dur))) : 0;
  }
  function bkSub(e){
    var m = e.mark;
    if (e.sp === 'book') return m ? 'глава ' + (m.idx || 1) + (m.n ? ' из ' + m.n : '') : (e.count ? e.count + ' ' + chapWord(e.count) : 'книга');
    if (m && m.ep) return String(m.ep).slice(0, 40);
    return e.count ? e.count + ' ' + epWord(e.count) : 'подкаст';
  }
  function bkRef(e){ return bkList.push(e) - 1; }
  function bkNewOf(e){
    var f = bkFresh[e.workId]; if (!f || !f.L || !e.seen) return [];
    return (f.L.tracks || []).filter(function (t){ return t.pub && String(t.pub) > String(e.seen); });
  }

  // ----- левая панель -----
  function bkStarted(){ return bkEntries().filter(function (e){ return e.mark && !e.mark.done; }).sort(function (x, y){ return (y.mark.at || 0) - (x.mark.at || 0); }); }
  function bkSavedList(){ return bkEntries().filter(function (e){ return e.saved; }); }
  function bkRenderSide(){
    var side = $('bkSide'); if (!side) return;
    var h = '<button class="mit mlib' + (bkSel === 'lib' ? ' on' : '') + '" data-k="lib">' + BK_IC_LIB + '<span class="mm"><b>Библиотека</b></span></button>';
    h += '<div class="mypills">';
    function group(title, list, empty){
      h += '<div class="mygh" style="cursor:default"><span class="mygn">' + title + '</span></div>';
      if (!list.length) { h += '<div class="mnote">' + empty + '</div>'; return; }
      list.forEach(function (e){
        var n = bkNewOf(e).length, on = bkSel === 'w:' + bkKey(e.sp, e.workId);
        // подсказка при наведении: полное название, автор и где остановился
        var tip = (e.title || '') + (e.author ? ' — ' + e.author : '') + ' · ' + (e.sp === 'book' ? 'Книга' : 'Подкаст') + ' · ' + bkSub(e) + (n ? ' · новых выпусков: ' + n : '');
        h += '<button class="mit bkit' + (on ? ' on' : '') + '" data-w="' + bkRef(e) + '" data-tip="' + esc(tip) + '">' +
          '<span class="spdot">' + (e.sp === 'book' ? SP_IC_BOOK : SP_IC_POD) + '</span>' +
          '<span class="mm"><b>' + esc(e.title || '') + '</b></span>' +
          (n ? '<span class="bkn" title="Новых выпусков: ' + n + '">' + n + '</span>' : '') + '</button>';
      });
    }
    group('Слушаю сейчас', bkStarted(), 'Начни книгу или подкаст — они появятся здесь.');
    group('Сохранённые', bkSavedList(), '«Сохранить» на странице книги или «Следить» на странице подкаста.');
    h += '</div>';
    h += '<button class="mit mlib bkhist' + (bkSel === 'hist' ? ' on' : '') + '" data-k="hist">' + BK_IC_HIST + '<span class="mm"><b>История прослушанного</b></span></button>';
    side.innerHTML = h;
  }

  // ----- правая часть -----
  function bkTile(e){
    var pct = bkPct(e), i = bkRef(e), n = bkNewOf(e).length;
    return '<button class="lgt bkt" data-w="' + i + '">' +
      '<span class="bkcov">' + (e.thumb ? '<img class="lgi" src="' + esc(e.thumb) + '" alt="" loading="lazy">' : '<span class="lgi ph"></span>') +
        (n ? '<span class="bknew">' + n + ' ' + (n === 1 ? 'новый' : 'новых') + '</span>' : '') +
        (pct ? '<span class="bkbar"><i style="width:' + pct + '%"></i></span>' : '') + '</span>' +
      '<b>' + esc(e.title || '') + '</b><small>' + esc(bkSub(e)) + (e.sp === 'book' && pct ? ' · ' + pct + ' %' : '') + '</small></button>';
  }
  function bkRenderNow(host){
    var started = bkStarted();
    var saved = bkSavedList().filter(function (e){ return !e.mark; }); // начатое уже показано выше
    var fresh = [];
    bkEntries().forEach(function (e){ if (e.saved && e.sp === 'pod') bkNewOf(e).forEach(function (t){ fresh.push(t); }); });
    fresh.sort(function (a, b){ return String(b.pub).localeCompare(String(a.pub)); });
    var h = '<div class="bkhead"><h3>Библиотека</h3><span class="muted">' + (started.length + saved.length) + (fresh.length ? ' · ' + fresh.length + ' новых выпусков' : '') + '</span></div>';
    if (!started.length && !saved.length) h += '<div class="muted">Здесь появятся книги и подкасты, которые ты слушал или сохранил. Найди их в поиске — переключатель «Книги и подкасты».</div>';
    if (started.length) h += '<section class="lgs"><div class="lgh">Слушаю сейчас</div><div class="lgg">' + started.map(bkTile).join('') + '</div></section>';
    if (fresh.length) h += '<section class="lgs"><div class="bkhead" style="margin:0 4px 10px"><span class="lgh" style="margin:0">Новые выпуски</span><button class="pbtn" data-allnew="1">Все новые в очередь</button></div><div class="bkfresh"></div></section>';
    if (saved.length) h += '<section class="lgs"><div class="lgh">Сохранённые</div><div class="lgg">' + saved.map(bkTile).join('') + '</div></section>';
    host.innerHTML = h;
    var fb = host.querySelector('.bkfresh');
    if (fb) appendResults(fresh.slice(0, 30), fb);
    var an = host.querySelector('[data-allnew]');
    if (an) an.onclick = function(){ addMany(fresh, true); toast('В очереди новые выпуски · ' + fresh.length); };
  }
  function bkRenderHist(host){
    var all = bkEntries().filter(function (e){ return e.mark; }).sort(function (a, b){ return (b.mark.at || 0) - (a.mark.at || 0); });
    var h = '<div class="bkhead"><h3>История прослушанного</h3><span class="muted">' + all.length + '</span></div>';
    if (!all.length) h += '<div class="muted">Пока пусто.</div>';
    all.forEach(function (e){
      var d = new Date(e.mark.at || 0);
      h += '<button class="bkrow" data-w="' + bkRef(e) + '">' +
        (e.thumb ? '<img src="' + esc(e.thumb) + '" alt="" loading="lazy">' : '<span class="ph"></span>') +
        '<span class="mm"><b>' + esc(e.title || '') + '</b><small>' + (e.sp === 'book' ? 'книга' : 'подкаст') + ' · ' + (e.mark.done ? 'дослушано' : esc(bkSub(e))) + '</small></span>' +
        '<span class="bkd">' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + '</span></button>';
    });
    host.innerHTML = h;
  }
  function bkRenderMain(){
    var host = $('bkMain'); if (!host) return;
    if (bkSel === 'lib') { bkRenderNow(host); return; }
    if (bkSel === 'hist') { bkRenderHist(host); return; }
    var e = bkEntries().find(function (x){ return 'w:' + bkKey(x.sp, x.workId) === bkSel; });
    if (!e) { bkSel = 'lib'; bkRenderNow(host); return; }
    renderSpeechView(host, { src: 'ym', sp: e.sp, albumId: e.albumId, workId: e.workId, title: e.title, thumb: e.thumb, author: e.author }, { noBack: true });
  }
  function bkRefresh(){ if (curTab !== 'books') return; bkList = []; bkRenderSide(); bkRenderMain(); }
  function bkOpen(){ bkRefresh(); bkCheckNew(); bkFillThumbs(); }
  // Записи, сделанные до 02.11, обложку не хранят: берём её у альбома и запоминаем
  var bkThumbAsked = {};
  async function bkFillThumbs(){
    if (!A.ymSpeech) return;
    var need = bkEntries().filter(function (e){ return !e.thumb && e.albumId && !bkThumbAsked[e.workId]; }), got = false;
    for (var i = 0; i < need.length && i < 20; i++) {
      var e = need[i]; bkThumbAsked[e.workId] = 1;
      var L = await A.ymSpeech(e.albumId, e.sp).catch(function(){ return null; });
      if (!L || L.error || !L.thumb) continue;
      var key = bkKey(e.sp, e.workId);
      if (marks[key]) { marks[key].thumb = L.thumb; if (!marks[key].author) marks[key].author = L.author || ''; }
      spSaved.forEach(function (s){ if (s.workId === e.workId && !s.thumb) s.thumb = L.thumb; });
      if (e.sp === 'book' && L.tracks && L.tracks.length) spBooks[e.workId] = L;
      got = true;
    }
    if (got) { markFlush(); if (A.setSetting) A.setSetting('speechSaved', spSaved.slice(0, 300)); bkRefresh(); }
  }

  // ----- новые выпуски подписок -----
  async function bkCheckNew(){
    if (!A.ymSpeech) return;
    var subs = bkEntries().filter(function (e){ return e.saved && e.sp === 'pod'; }), changed = false;
    for (var i = 0; i < subs.length; i++) {
      var e = subs[i], f = bkFresh[e.workId];
      if (f && Date.now() - f.at < 30 * 60000) continue;
      var L = await A.ymSpeech(e.albumId, 'pod').catch(function(){ return null; });
      if (!L || L.error) continue;
      bkFresh[e.workId] = { at: Date.now(), L: L };
      // подписались раньше, чем Тапёр начал помнить даты, — считаем всё текущее увиденным
      if (!e.seen && L.tracks && L.tracks[0] && L.tracks[0].pub) bkMarkSeen(e.workId, L.tracks[0].pub);
      changed = true;
    }
    if (changed) bkRefresh();
  }
  function bkMarkSeen(workId, pub){
    for (var i = 0; i < spSaved.length; i++) if (spSaved[i].workId === workId) {
      if (String(pub) <= String(spSaved[i].seen || '')) return;
      spSaved[i].seen = pub;
      if (A.setSetting) A.setSetting('speechSaved', spSaved.slice(0, 300));
      return;
    }
  }

  // ----- продолжить и удалить -----
  async function bkContinue(e){
    var L = (e.sp === 'book' && spBooks[e.workId]) || (bkFresh[e.workId] && bkFresh[e.workId].L) || null;
    if (!L) { toast('Загружаю «' + (e.title || '') + '»…'); L = await A.ymSpeech(e.albumId, e.sp).catch(function(){ return null; }); }
    if (!L || L.error || !(L.tracks && L.tracks.length)) { toast('Не удалось загрузить «' + (e.title || '') + '»'); return; }
    var mk = e.mark, idx = 0;
    if (mk) for (var k = 0; k < L.tracks.length; k++) if (String(L.tracks[k].id) === String(mk.id)) { idx = k; break; }
    if (e.sp === 'book') spPlayFrom(L, idx, mk ? mk.sec : 0);
    else spPlayEpisode(L.tracks[idx], mk ? mk.sec : 0);
  }
  function bkRemove(e){
    var key = bkKey(e.sp, e.workId);
    spSaved = spSaved.filter(function (s){ return s.workId !== e.workId; });
    if (A.setSetting) A.setSetting('speechSaved', spSaved.slice(0, 300));
    delete marks[key]; markFlush();
    if (bkSel === 'w:' + key) bkSel = 'lib';
    toast('Убрано из «Книг и подкастов»: «' + (e.title || '') + '»');
    bkRefresh();
  }
  function bkMenu(x, y, e){
    var items = [{ label: e.sp === 'book' ? 'Открыть книгу' : 'Открыть подкаст', act: function(){ bkSel = 'w:' + bkKey(e.sp, e.workId); bkRefresh(); } }];
    if (e.mark) items.push({ label: 'Продолжить слушать', act: function(){ bkContinue(e); } });
    items.push('-');
    items.push({ label: 'Удалить из раздела', danger: true, act: function(){ bkRemove(e); } });
    showCtx(x, y, items);
  }

  (function(){
    var view = $('viewBooks'); if (!view) return;
    view.addEventListener('click', function(ev){
      var k = ev.target.closest('[data-k]');
      if (k && k.closest('#bkSide')) { bkSel = k.dataset.k; bkRefresh(); if (bkSel === 'lib') bkCheckNew(); return; }
      var w = ev.target.closest('[data-w]'); if (!w) return;
      var e = bkList[parseInt(w.dataset.w, 10)]; if (!e) return;
      // нажатие — страница книги или подкаста (слушать — кнопками на ней)
      bkSel = 'w:' + bkKey(e.sp, e.workId); bkRefresh();
    });
    view.addEventListener('contextmenu', function(ev){
      var w = ev.target.closest('[data-w]'); if (!w) return;
      var e = bkList[parseInt(w.dataset.w, 10)]; if (!e) return;
      ev.preventDefault(); bkMenu(ev.clientX, ev.clientY, e);
    });
  })();
