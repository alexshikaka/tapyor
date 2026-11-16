  // ===== История: отыгранные треки по датам (вкладка после «Плейлистов») =====
  // Хранится в localStorage окна — отдельно от очереди: «Волна» и «Играть» стирают очередь,
  // а здесь всё остаётся. Сколько помнить (100–1000) — выбор прямо во вкладке.
  var HIST_KEY = 'tapHistory', HIST_LIM_KEY = 'tapHistLimit', HIST_DEF = 300;
  function histLimit(){ var n = 0; try { n = Number(localStorage.getItem(HIST_LIM_KEY)); } catch (e) {} return [100, 200, 300, 500, 1000].indexOf(n) >= 0 ? n : HIST_DEF; }
  function histLoad(){ try { var a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function histSave(a){ try { localStorage.setItem(HIST_KEY, JSON.stringify(a)); } catch (e) { console.warn('Тапёр: не сохранилась история', e); } }
  // Только то, что нужно, чтобы снова включить трек; служебные пометки очереди и заказа не храним
  function histSlim(v){ var o = {}; for (var k in v) if (!/^(played|bg|fromList|finished|req|_.*)$/.test(k)) o[k] = v[k]; return o; }
  function histPush(v){
    if (!v || !v.id) return;
    var a = histLoad(), last = a[a.length - 1], key = srcOf(v) + ':' + v.id;
    if (last && last.t && srcOf(last.t) + ':' + last.t.id === key) last.at = Date.now(); // тот же трек сначала — одна запись
    else a.push({ t: histSlim(v), at: Date.now() });
    var lim = histLimit(); if (a.length > lim) a = a.slice(a.length - lim);
    histSave(a);
    if (curTab === 'hist') histRender();
  }
  function histDay(ts){
    var d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0);
    var d0 = new Date(d); d0.setHours(0, 0, 0, 0);
    var diff = Math.round((t - d0) / 86400000);
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  }
  function histRender(){
    var box = $('histList'); if (!box) return;
    var a = histLoad();
    $('histSum').textContent = a.length ? a.length + ' ' + plural(a.length) + ' в истории' : '';
    if (!a.length) { box.innerHTML = '<div class="muted">Пока пусто. Здесь копятся отыгранные треки — даже когда «Волна» или «Играть» заменяют очередь.</div>'; return; }
    box.innerHTML = '';
    var day = '';
    for (var k = a.length - 1; k >= 0; k--) { // свежие сверху
      var e = a[k]; if (!e || !e.t) continue;
      var dd = histDay(e.at);
      if (dd !== day) { day = dd; var h = document.createElement('div'); h.className = 'hist-day'; h.textContent = dd; box.appendChild(h); }
      var row = makeRow(e.t);
      // Со значком часов — чтобы не путалось с длиной трека в конце строки
      var tm = document.createElement('span'); tm.className = 'hist-at';
      tm.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg><span class="mono">' +
        new Date(e.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '</span>';
      tm.title = 'Когда играл';
      row.insertBefore(tm, row.firstChild);
      box.appendChild(row);
    }
  }
  function histOpen(){ $('histLimit').value = String(histLimit()); histRender(); }
  $('histLimit').onchange = function(){
    try { localStorage.setItem(HIST_LIM_KEY, this.value); } catch (e) { console.warn('Тапёр: не сохранился лимит истории', e); }
    var a = histLoad(), lim = histLimit(); if (a.length > lim) histSave(a.slice(a.length - lim));
    histRender();
  };
  $('histClear').onclick = function(){
    askDlg({ title: 'Очистить историю?', text: 'Все отыгранные треки будут удалены из истории. Очередь не изменится.', ok: 'Очистить' }).then(function (r){ if (!r) return; histSave([]); histRender(); });
  };
