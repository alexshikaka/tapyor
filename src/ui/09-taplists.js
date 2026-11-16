  // ===== Свои плейлисты Тапёра =====
  function localLists(){ return savedLists.filter(function (x){ return x.src === 'tap'; }); }
  function localGet(id){ return savedLists.find(function (x){ return listId(x) === id; }) || null; }
  function trackKeyOf(t){ var k = window.TapRank ? TapRank.songKey(t) : ''; return k ? srcOf(t) + '|' + k : srcOf(t) + ':' + t.id; }
  function dedupeTracks(list){ var seen = {}, idSeen = {}, out = []; list.forEach(function (t){ var a = srcOf(t) + ':' + t.id, b = trackKeyOf(t); if (idSeen[a] || seen[b]) return; idSeen[a] = seen[b] = 1; out.push(t); }); return out; }
  function countDups(list){ return list.length - dedupeTracks(list).length; }
  function saveLocal(m){
    if (m) { m.count = (m.tracks || []).length; m.thumb = ((m.tracks || []).find(function (t){ return t.thumb; }) || {}).thumb || ''; }
    if (A.setSetting) A.setSetting('savedLists', savedLists);
    renderMySide();
  }
  function refreshOpenList(m){
    var id = listId(m);
    if (mySel && listId(mySel) === id && curTab === 'my') renderListView($('myPl'), m, false);
  }
  function localCreate(title, tracks){
    var m = { src: 'tap', type: 'tap', listId: 'tp' + Date.now() + Math.floor(Math.random() * 1000), title: String(title || 'Мой плейлист').slice(0, 100), author: 'Тапёр', tracks: (tracks || []).map(slimTrack) };
    savedLists.unshift(m); saveLocal(m);
    return m;
  }
  function localAdd(m, tracks){
    var have = {}; m.tracks.forEach(function (t){ have[srcOf(t) + ':' + t.id] = 1; });
    var add = tracks.filter(function (t){ return t && t.id && !have[srcOf(t) + ':' + t.id]; }).map(slimTrack);
    m.tracks = m.tracks.concat(add); saveLocal(m); refreshOpenList(m);
    toast(add.length ? 'В «' + m.title + '» ' + (add.length === 1 ? 'добавлена песня' : 'добавлено: ' + add.length) : 'Уже есть в «' + m.title + '»');
  }
  function localRemoveTrack(m, i){ var t = m.tracks.splice(i, 1)[0]; saveLocal(m); refreshOpenList(m); toast('Убрано: «' + (t && t.title || '') + '»', 'Вернуть', function(){ m.tracks.splice(i, 0, t); saveLocal(m); refreshOpenList(m); }); }
  function localRename(m){ askDlg({ title: 'Переименовать плейлист', label: 'Название', value: m.title }).then(function (r){ if (!r || !r.value) return; m.title = r.value.slice(0, 100); saveLocal(m); refreshOpenList(m); }); }
  function localDedupe(m){ var n = countDups(m.tracks); m.tracks = dedupeTracks(m.tracks); saveLocal(m); refreshOpenList(m); toast('Убрано повторов: ' + n); }
  function localDelete(m){
    var idx = savedLists.indexOf(m); if (idx < 0) return;
    savedLists.splice(idx, 1); saveLocal();
    if (mySel && listId(mySel) === listId(m)) selectMy(localLists()[0] || (ymLoggedIn ? LIKED : null));
    toast('Плейлист «' + m.title + '» удалён', 'Вернуть', function(){ savedLists.splice(idx, 0, m); saveLocal(); selectMy(m); });
  }
  // Свои плейлисты на площадках: название и удаление
  async function platformRename(L, target, host){
    var r = await askDlg({ title: 'Переименовать на ' + (target === 'yt' ? 'YouTube' : 'Яндексе'), label: 'Название', value: L.title }); if (!r || !r.value) return;
    var res = target === 'yt' ? await A.ytPlRename(L.listId, r.value) : await A.ymPlRename(L.kind, r.value);
    if (!res || !res.ok) { toast('Не получилось: ' + ((res && res.error) || 'ошибка')); return; }
    L.title = r.value; (target === 'yt' ? ytPls : myPls).forEach(function (p){ if (listId(p) === listId(L)) p.title = r.value; });
    renderMySide(); renderListView(host, L, false); toast('Переименовано');
  }
  async function platformDelete(L, target){
    var where = target === 'yt' ? 'YouTube' : 'Яндекс Музыке';
    var r = await askDlg({ title: 'Удалить плейлист на ' + (target === 'yt' ? 'YouTube' : 'Яндексе') + '?', text: '«' + esc(L.title) + '» исчезнет из твоего аккаунта на ' + where + '. Вернуть его Тапёр не сможет — но сначала сохранит копию в «Мои плейлисты».', ok: 'Удалить' });
    if (!r) return;
    var copy = (L.tracks || []).length ? localCreate(L.title + ' (копия)', L.tracks) : null;
    var res = target === 'yt' ? await A.ytPlDelete(L.listId) : await A.ymPlDelete(L.kind);
    if (!res || !res.ok) { toast('Не получилось: ' + ((res && res.error) || 'ошибка')); return; }
    if (target === 'yt') ytPls = ytPls.filter(function (p){ return listId(p) !== listId(L); }); else myPls = myPls.filter(function (p){ return listId(p) !== listId(L); });
    renderMySide(); selectMy(copy || (ymLoggedIn ? LIKED : null));
    toast('Удалено на ' + where + (copy ? ' · копия в «Мои плейлисты»' : ''));
  }
  function bindPlDrag(box, m){
    var from = -1;
    box.addEventListener('dragstart', function(e){ var r = e.target.closest && e.target.closest('.prow'); if (!r) return; from = parseInt(r.dataset.pi, 10); r.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from)); } catch (x) {} });
    box.addEventListener('dragover', function(e){
      if (from < 0) return; e.preventDefault();
      box.querySelectorAll('.drop-before,.drop-after').forEach(function (x){ x.classList.remove('drop-before', 'drop-after'); });
      var r = e.target.closest && e.target.closest('.prow'); if (!r) return;
      var rc = r.getBoundingClientRect(); r.classList.add(e.clientY > rc.top + rc.height / 2 ? 'drop-after' : 'drop-before');
    });
    box.addEventListener('drop', function(e){
      if (from < 0) return; e.preventDefault();
      var r = e.target.closest && e.target.closest('.prow'); var f = from; from = -1;
      if (!r) return;
      var i = parseInt(r.dataset.pi, 10), rc = r.getBoundingClientRect(), to = e.clientY > rc.top + rc.height / 2 ? i + 1 : i;
      if (to === f || to === f + 1) { refreshOpenList(m); return; }
      var t = m.tracks.splice(f, 1)[0]; if (f < to) to--; m.tracks.splice(to, 0, t);
      saveLocal(m); refreshOpenList(m);
    });
    box.addEventListener('dragend', function(){ from = -1; box.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(function (x){ x.classList.remove('dragging', 'drop-before', 'drop-after'); }); });
  }
  // Меню «В плейлист…»
  function openAddToListMenu(x, y, tracks){
    tracks = (tracks || []).filter(Boolean); if (!tracks.length) return;
    var items = [{ label: '＋ Новый плейлист…', act: function(){ askDlg({ title: 'Новый плейлист', label: 'Название', value: tracks.length === 1 ? (tracks[0].author || 'Мой плейлист') : 'Мой плейлист' }).then(function (r){ if (!r) return; var m = localCreate(r.value, []); localAdd(m, tracks); }); } }];
    var ls = localLists();
    if (ls.length) items.push('-');
    ls.slice(0, 14).forEach(function (m){ items.push({ label: m.title + ' · ' + (m.tracks || []).length, act: function(){ localAdd(m, tracks); } }); });
    // Свои плейлисты на площадках: песни с других площадок Тапёр сначала найдёт там
    var ymOwn = ymLoggedIn ? myPls.filter(function (p){ return p.own && p.kind; }) : [];
    var ytOwn = ytCanWrite() ? ytPls.filter(function (p){ return p.listId; }) : [];
    if (ymOwn.length) { items.push('-'); ymOwn.slice(0, 10).forEach(function (p){ items.push({ label: 'Яндекс: ' + p.title, act: function(){ addToPlatform(p, 'ym', tracks); } }); }); }
    if (ytOwn.length) { items.push('-'); ytOwn.slice(0, 10).forEach(function (p){ items.push({ label: 'YouTube: ' + p.title, act: function(){ addToPlatform(p, 'yt', tracks); } }); }); }
    showCtx(x, y, items);
  }

  async function addToPlatform(p, target, tracks){
    toast('Добавляю в «' + p.title + '»…');
    var r = await pushTo(target, p.title, tracks.map(function (t){ return { track: t, line: (t.author ? t.author + ' — ' : '') + t.title, seconds: t.seconds }; }), null, target === 'yt' ? { listId: p.listId, title: p.title } : { uid: p.uid, kind: p.kind, title: p.title });
    if (!r.ok) { toast('Не получилось: ' + (r.error || 'ошибка')); return; }
    toast(r.count ? 'В «' + p.title + '» добавлено: ' + r.count + (r.missing.length ? ', не нашлось на ' + (target === 'yt' ? 'YouTube' : 'Яндексе') + ': ' + r.missing.length : '') : 'Не нашлось на ' + (target === 'yt' ? 'YouTube' : 'Яндексе'));
    p.count = (p.count || 0) + r.count; renderMySide();
    if (mySel && listId(mySel) === listId(p) && curTab === 'my') renderListView($('myPl'), p, false);
  }
  // Небольшое окно ввода (в Electron нет window.prompt)
  function askDlg(o){
    return new Promise(function (resolve){
      var ov = document.createElement('div'); ov.className = 'ask-ov';
      ov.innerHTML = '<div class="ask" role="dialog" aria-modal="true"><h4>' + esc(o.title || '') + '</h4>' +
        (o.text ? '<p>' + o.text + '</p>' : '') +
        (o.label ? '<label>' + esc(o.label) + '<input type="text" maxlength="100"></label>' : '') +
        (o.check ? '<label class="ask-c"><input type="checkbox"' + (o.checked ? ' checked' : '') + '> ' + esc(o.check) + '</label>' : '') +
        '<div class="ask-b"><button class="pbtn g" data-x="0">Отмена</button><button class="pbtn y" data-x="1">' + esc(o.ok || 'Готово') + '</button></div></div>';
      document.body.appendChild(ov);
      var inp = ov.querySelector('input[type=text]'), chk = ov.querySelector('input[type=checkbox]');
      if (inp) { inp.value = o.value || ''; setTimeout(function(){ inp.focus(); inp.select(); }, 0); }
      function done(ok){ ov.remove(); document.removeEventListener('keydown', key, true); resolve(ok ? { value: inp ? inp.value.trim() : '', checked: chk ? chk.checked : false } : null); }
      function key(e){ if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); if (!inp || inp.value.trim()) done(true); } }
      document.addEventListener('keydown', key, true);
      ov.onclick = function(e){ if (e.target === ov) done(false); var b = e.target.closest('[data-x]'); if (b) { if (b.dataset.x === '1' && inp && !inp.value.trim()) { inp.focus(); return; } done(b.dataset.x === '1'); } };
    });
  }
  // Короткое сообщение внизу, с кнопкой «Вернуть»
  var toastT = null;
  function toast(text, btn, act){
    var t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = '<span>' + esc(text) + '</span>' + (btn ? '<button>' + esc(btn) + '</button>' : '');
    if (btn) t.querySelector('button').onclick = function(){ t.hidden = true; act(); };
    t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function(){ t.hidden = true; }, btn ? 7000 : 3000);
  }
  if (A.onUiToast) A.onUiToast(function (t) { if (typeof toast === 'function') toast(t); });
  function bindBack(host){ var b = host.querySelector('[data-back]'); if (b) b.onclick = host._backFn || closeSearchList; }

