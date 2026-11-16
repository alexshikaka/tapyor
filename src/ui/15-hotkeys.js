  // ===== Горячие клавиши =====
  var HK_NAMES = { playPause: 'Пауза / играть', next: 'Следующий трек', prev: 'Предыдущий трек', like: 'Лайк в Яндексе', shake: 'Встряхнуть волну', volUp: 'Громче', volDown: 'Тише', show: 'Показать Тапёр поверх окон' };
  var HK_DEF = { playPause: 'Ctrl+Alt+P', next: 'Ctrl+Alt+Right', prev: 'Ctrl+Alt+Left', like: 'Ctrl+Alt+L', shake: 'Ctrl+Alt+S', volUp: 'Ctrl+Alt+Up', volDown: 'Ctrl+Alt+Down', show: 'Ctrl+Alt+T' };
  var hk = Object.assign({}, HK_DEF), hkFailed = [], hkRec = null;
  function hkShow(acc){ return acc ? acc.replace(/\+/g, ' + ').replace(/\bLeft\b/, '←').replace(/\bRight\b/, '→').replace(/\bUp\b/, '↑').replace(/\bDown\b/, '↓') : 'не задано'; }
  function renderHk(){
    var box = $('hkList'); box.innerHTML = '';
    Object.keys(HK_NAMES).forEach(function (a){
      var row = document.createElement('div'); row.className = 'srow';
      var bad = hk[a] && hkFailed.indexOf(hk[a]) >= 0;
      row.innerHTML = '<div class="sl"><div class="st">' + HK_NAMES[a] + '</div>' + (bad ? '<div class="sd" style="color:#FFB4AE">Это сочетание занято другой программой — выбери другое</div>' : '') + '</div>';
      var b = document.createElement('button');
      b.className = 'kcap' + (hkRec === a ? ' rec' : (!hk[a] ? ' empty' : '')) + (bad ? ' bad' : '');
      b.textContent = hkRec === a ? 'Нажми сочетание…' : hkShow(hk[a]);
      b.onclick = function(){ hkStart(a); };
      row.appendChild(b); box.appendChild(row);
    });
  }
  async function hkSave(){
    var r = A.setSetting ? await A.setSetting('hotkeys', hk) : null;
    hkFailed = (r && r.failed) || [];
    renderHk();
  }
  function hkStart(a){
    hkRec = a; renderHk();
    if (A.hotkeysPause) A.hotkeysPause(true); // старые сочетания не срабатывают, пока назначаем
  }
  function hkStop(){ hkRec = null; if (A.hotkeysPause) A.hotkeysPause(false).then(function (r){ hkFailed = (r && r.failed) || []; renderHk(); }); renderHk(); }
  function accFrom(e){
    var c = e.code || '', k = '';
    if (/^Key[A-Z]$/.test(c)) k = c.slice(3);
    else if (/^Digit\d$/.test(c)) k = c.slice(5);
    else if (/^F\d{1,2}$/.test(c)) k = c;
    else if (/^Numpad\d$/.test(c)) k = 'num' + c.slice(6);
    else k = ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv' })[c] || '';
    if (!k) return null;
    var mods = [];
    if (e.ctrlKey) mods.push('Ctrl'); if (e.altKey) mods.push('Alt'); if (e.shiftKey) mods.push('Shift'); if (e.metaKey) mods.push('Super');
    if (!mods.length && !/^F\d/.test(k)) return ''; // одна буква без Ctrl/Alt мешала бы печатать
    return mods.concat([k]).join('+');
  }
  document.addEventListener('keydown', function (e){
    if (!hkRec) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { hkStop(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { hk[hkRec] = ''; hkRec = null; hkSave().then(function(){ hkStop(); }); return; }
    var acc = accFrom(e);
    if (acc === null) return; // нажат только Ctrl/Alt/Shift — ждём клавишу
    if (acc === '') { $('hkNote').textContent = 'Добавь Ctrl, Alt или Shift — одна клавиша мешала бы печатать'; return; }
    Object.keys(hk).forEach(function (a){ if (a !== hkRec && hk[a] === acc) hk[a] = ''; }); // одно сочетание — одно действие
    hk[hkRec] = acc; hkRec = null;
    $('hkNote').textContent = 'Нажми на сочетание, чтобы назначить новое. Esc — отмена, Backspace — без сочетания';
    hkSave().then(function(){ hkStop(); });
  }, true);
  $('hkReset').onclick = function(){ hk = Object.assign({}, HK_DEF); hkSave(); };
  if (A.getSetting) A.getSetting('hotkeys').then(function (v){ hk = Object.assign({}, HK_DEF, v || {}); renderHk(); if (A.hotkeysStatus) A.hotkeysStatus().then(function (r){ hkFailed = (r && r.failed) || []; renderHk(); }); });
  else renderHk();
  function stepVol(d){ volTo((volAnim.target != null ? volAnim.target : (parseFloat(volEl.value) || 0)) + d); }
  if (A.onHotkey) A.onHotkey(function (a){
    if (a === 'playPause') $('playpause').click();
    else if (a === 'next') next();
    else if (a === 'prev') prev();
    else if (a === 'like') { if (curTrack && srcOf(curTrack) === 'ym' && ymLoggedIn) toggleLike(curTrack); }
    else if (a === 'shake') $('waveShake').onclick();
    else if (a === 'volUp') stepVol(5);
    else if (a === 'volDown') stepVol(-5);
  });
  // Файл для OBS
  var fmtIn = $('setNpFmt'), idleIn = $('setNpIdle'), fmtTimer = null, idleTimer = null;
  function fmtNp(f, i){
    return String(f || '{artist} — {title}').replace(/\{artist\}/g, i.artist || '').replace(/\{title\}/g, i.title || '')
      .replace(/\{album\}/g, i.album || '').replace(/\{source\}/g, i.source || '').replace(/^[\s—–-]+|[\s—–-]+$/g, '').trim();
  }
  function updNpPreview(){
    var t = curTrack;
    var i = t ? { artist: t.author, title: t.title, album: t.album, source: srcName(t) } : { artist: 'Кино', title: 'Группа крови', album: 'Группа крови', source: 'Яндекс' };
    $('setNpPrev').textContent = fmtNp(fmtIn.value, i) || ' ';
  }
  if (A.getSetting) {
    A.getSetting('nowPlayingFormat').then(function (v){ fmtIn.value = v || '{artist} — {title}'; updNpPreview(); });
    A.getSetting('npIdle').then(function (v){ idleIn.value = v || ''; });
  }
  fmtIn.addEventListener('input', function(){ updNpPreview(); clearTimeout(fmtTimer); fmtTimer = setTimeout(function(){ A.setSetting('nowPlayingFormat', fmtIn.value.trim() || '{artist} — {title}'); }, 400); });
  idleIn.addEventListener('input', function(){ clearTimeout(idleTimer); idleTimer = setTimeout(function(){ A.setSetting('npIdle', idleIn.value); }, 400); });
  $('setNpVars').addEventListener('click', function(e){
    var b = e.target.closest('[data-var]'); if (!b) return;
    var s0 = fmtIn.selectionStart == null ? fmtIn.value.length : fmtIn.selectionStart, s1 = fmtIn.selectionEnd == null ? s0 : fmtIn.selectionEnd;
    fmtIn.value = fmtIn.value.slice(0, s0) + b.dataset.var + fmtIn.value.slice(s1);
    fmtIn.focus(); fmtIn.selectionStart = fmtIn.selectionEnd = s0 + b.dataset.var.length;
    fmtIn.dispatchEvent(new Event('input'));
  });
  $('setNpChoose').onclick = async function(){ var p = await A.npChooseFolder(); if (p) $('setNpPath').textContent = p; };
  $('setNpOpen').onclick = function(){ A.npOpenFolder(); };
  $('setLogCopy').onclick = async function(){ var b = this; var ok = await A.logCopy(); b.textContent = ok ? 'Скопировано ✓' : 'Не получилось'; setTimeout(function(){ b.textContent = 'Скопировать лог'; }, 2500); };
  $('setLogOpen').onclick = function(){ A.logOpen(); };
  $('setMemReport').onclick = async function(){
    var b = this, old = b.textContent;
    b.disabled = true; b.textContent = 'Собираю…';
    try {
      var r = await A.memReport();
      if (!r || r.error) throw new Error((r && r.error) || 'нет отчёта');
      var text = r.text + '\n\nВсего: ' + r.total + ' МБ (частная ' + r.private + ')';
      try { await navigator.clipboard.writeText(text); } catch (e) { var ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      b.textContent = 'Скопировано ✓';
      toast('Отчёт о памяти скопирован — он также записан в журнал');
    } catch (e) { b.textContent = 'Не получилось'; toast('Отчёт о памяти: ' + e.message); }
    setTimeout(function(){ b.textContent = old; b.disabled = false; }, 2500);
  };
  document.querySelector('.set-side').addEventListener('click', function(e){
    var b = e.target.closest('[data-go]'); if (!b) return;
    if (typeof showSettingsPane === 'function') showSettingsPane(b.dataset.go);
    else $(b.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  function refreshSettings(){ if (A.npPath) A.npPath().then(function (p){ $('setNpPath').textContent = p; }); updNpPreview(); }
  function renderSetYm(s){
    if (s && s.loggedIn) {
      $('setYmText').innerHTML = 'Вошли как <b style="color:var(--tx)">' + esc(s.name || s.login || 'Яндекс') + '</b>' + (s.offline ? '' : (s.hasPlus ? ' · <span style="color:#4ADE9A">Плюс активен — треки целиком</span>' : ' · <span style="color:#FFB86B">без Плюса — только отрывки по 30 с</span>'));
      $('setYmBtn').textContent = 'Выйти'; $('setYmBtn').classList.add('ghost');
    } else {
      $('setYmText').textContent = (s && s.error) ? s.error : 'Не выполнен вход. Нужен для треков Яндекса, волн и «Мне нравится»';
      $('setYmBtn').textContent = 'Войти'; $('setYmBtn').classList.remove('ghost');
    }
  }
  $('setYmBtn').onclick = function(){ acctBtn.click(); };

