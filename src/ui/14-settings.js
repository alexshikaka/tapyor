  // ===== Настройки =====
  function setTg(el, on){ el.classList.toggle('on', !!on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  var tgs = document.querySelectorAll('[data-set-tg]');
  Array.prototype.forEach.call(tgs, function (el){
    var key = el.dataset.setTg;
    if (A.getSetting) A.getSetting(key).then(function (v){ setTg(el, !!v); if (key === 'prefetch') prefOn = v !== false; });
    el.onclick = function(){
      var on = !el.classList.contains('on');
      setTg(el, on);
      if (A.setSetting) A.setSetting(key, on);
      if (key === 'prefetch') prefOn = on;
      if (key === 'normalize') setNormalize(on);
      if (key === 'ytEnabled') { SVC.ytOn = on; renderSvc(); }
      if (key === 'ymEnabled') SVC.ymOn = on;
      if (key === 'ymWebFallback') SVC.ymweb = on;
      if (key === 'scEnabled') { SVC.scOn = on; renderSvc(); }
    if (key === 'reqAuto') { RQ.auto = on; syncReqAuto(); pushWidget(true); }
      if (key === 'auEnabled') { SVC.auOn = on; renderSvc(); }
    };
  });
  // Группа «Стримерам» (пункт 10): выкл — нет вкладки «Заказы», разделов «Донаты» и «OBS», донаты не опрашиваются
  var streamerOn = true;
  function applyStreamer(on, save){
    streamerOn = on !== false;
    document.body.classList.toggle('no-streamer', !streamerOn);
    setTg($('setStreamerTg'), streamerOn);
    try { localStorage.setItem('tapStreamer', streamerOn ? '1' : '0'); } catch (e) { console.warn('Тапёр: не сохранился режим стримера', e); }
    if (save && A.setSetting) A.setSetting('streamerMode', streamerOn);
    if (!streamerOn && curTab === 'req') setTab('search');
    // Описания, где упоминаются заказы, перерисовываем сразу — иначе подсказки остаются от прежнего режима
    try { renderQueue(); renderWaveUi(); renderBgLabels(); } catch (e) {}
    // волны в уже показанной выдаче поиска — подсказка без «заказов», если функции для стримеров выключены
    try { document.querySelectorAll('.wpill[data-wname]').forEach(function (b){ var t = wpillTitle(b.dataset.wname); b.title = t; if (b.dataset.tip != null) b.dataset.tip = t; }); } catch (e) {}
  }
  try { applyStreamer(localStorage.getItem('tapStreamer') !== '0'); } catch (e) {}
  if (A.getSetting) A.getSetting('streamerMode').then(function (v){ applyStreamer(v !== false); });
  $('setStreamerTg').onclick = function(){ applyStreamer(!streamerOn, true); };
  // Первый крестик: «свернуть или закрыть». Галочка «запомнить» — и больше не спрашиваем
  var closeAskOpen = false;
  function askClose(){
    if (closeAskOpen) return;
    closeAskOpen = true;
    var ov = document.createElement('div'); ov.className = 'ask-ov';
    ov.innerHTML = '<div class="ask cls-dlg" role="dialog" aria-modal="true" aria-labelledby="clsH"><h4 id="clsH">Свернуть или закрыть?</h4>' +
      '<p>Свёрнутый Тапёр продолжает играть и ловить заказы — он живёт в трее у часов. Закрытый — выключается совсем.</p>' +
      '<div class="cls-b"><button class="pbtn y" data-c="tray">Свернуть в трей</button><button class="pbtn g" data-c="quit">Закрыть Тапёр</button></div>' +
      '<label class="ask-c"><input type="checkbox" checked> Запомнить выбор</label>' +
      '<p class="cls-n">Поменять можно в любой момент: Настройки → Программа → «Крестик сворачивает в трей».</p></div>';
    document.body.appendChild(ov);
    var chk = ov.querySelector('input[type=checkbox]');
    setTimeout(function(){ var b = ov.querySelector('[data-c=tray]'); if (b) b.focus(); }, 0);
    function done(choice){
      closeAskOpen = false; ov.remove(); document.removeEventListener('keydown', key, true);
      if (!choice) return; // передумал — окно остаётся открытым
      var remember = !!(chk && chk.checked);
      if (remember) { var tg = document.querySelector('[data-set-tg="closeToTray"]'); if (tg) setTg(tg, choice === 'tray'); }
      if (A.closeChoice) A.closeChoice({ tray: choice === 'tray', remember: remember });
    }
    function key(e){ if (e.key === 'Escape') { e.stopPropagation(); done(null); } }
    document.addEventListener('keydown', key, true);
    ov.onclick = function(e){
      if (e.target === ov) { done(null); return; }
      var b = e.target.closest('[data-c]'); if (b) done(b.dataset.c);
    };
  }
  if (A.onAskClose) A.onAskClose(askClose);
  // Вкладка «Оформление» вверху (пункт 7): тумблер в разделе «Оформление» настроек
  function applyLookTab(on, save){
    on = on !== false;
    $('tabLook').hidden = !on; setTg($('setLookTab'), on);
    try { localStorage.setItem('tapLookTab', on ? '1' : '0'); } catch (e) { console.warn('Тапёр: не сохранилась вкладка оформления', e); }
    if (save && A.setSetting) A.setSetting('lookTab', on);
    if (!on && curTab === 'look') setTab('settings', 'sAbout');
  }
  try { applyLookTab(localStorage.getItem('tapLookTab') !== '0'); } catch (e) {}
  if (A.getSetting) A.getSetting('lookTab').then(function (v){ applyLookTab(v !== false); });
  $('setLookTab').onclick = function(e){ e.preventDefault(); applyLookTab($('tabLook').hidden, true); };
  $('lookZoom').onclick = function(){ $('zoomBtn').click(); };
  var qSeg = $('setQuality');
  var qSelects = [$('vidQ'), $('vfsQ'), $('voQ')].filter(Boolean);
  function applyQuality(v){
    v = String(v || '720');
    var bs = qSeg.querySelectorAll('button');
    for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', bs[k].dataset.v === v);
    qSelects.forEach(function(s){ s.value = v; });
  }
  function setQuality(v){
    applyQuality(v);
    if (A.setSetting) A.setSetting('videoQuality', String(v || '720'));
  }
  if (A.getSetting) A.getSetting('videoQuality').then(applyQuality);
  qSeg.onclick = function(e){
    var b = e.target.closest('button'); if (!b) return;
    setQuality(b.dataset.v);
  };
  qSelects.forEach(function(s){ s.onchange = function(){ setQuality(s.value); }; });
  // Громкость при запуске
  var setVol = $('setVol');
  if (A.getSetting) A.getSetting('startVolume').then(function (v){
    v = v == null ? 80 : v;
    setVol.value = v; $('setVolVal').textContent = v + '%';
    volEl.value = v; applyVol(); showVolVal();
  });
  setVol.addEventListener('input', function(){ $('setVolVal').textContent = setVol.value + '%'; });
  setVol.addEventListener('change', function(){ if (A.setSetting) A.setSetting('startVolume', parseInt(setVol.value, 10)); });
  // Плавный переход
  var xSeg = $('setXfade');
  function showXfade(v){ var bs = xSeg.querySelectorAll('button'); for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', bs[k].dataset.v === String(v)); }
  xSeg.onclick = function(e){
    var b = e.target.closest('button'); if (!b) return;
    AX.xfade = parseInt(b.dataset.v, 10) || 0; showXfade(AX.xfade);
    if (A.setSetting) A.setSetting('crossfade', AX.xfade);
  };


  // ===== Вход в YouTube (три способа) =====
  var ytAuth = { cookies: null, oauth: { configured: false, account: null }, useCookies: false };
  function ytLogged(){ return !!(ytAuth.cookies || ytAuth.oauth.account); }
  async function ytAuthRefresh(){
    if (!A.ytAuthStatus) return;
    ytAuth = await A.ytAuthStatus();
    renderYtSettings();
    if (ytDlgOpen) renderYtDlg();
    if (typeof refreshAcctYt === 'function') refreshAcctYt();
  }
  function renderYtSettings(){
    var t = $('setYtAcc'); if (!t) return;
    var names = [];
    if (ytAuth.oauth.account) names.push(ytAuth.oauth.account.name + ' (через браузер)');
    if (ytAuth.cookies) names.push(ytAuth.cookies.name + (ytAuth.cookies.via === 'window' ? ' (вход в окне)' : ' (ключ из браузера)'));
    t.textContent = names.length ? 'Вошёл: ' + names.join(', ') : 'Не выполнен вход — плейлисты, лайки и Premium недоступны';
    $('setYtLogin').textContent = names.length ? 'Управлять' : 'Войти';
    $('setYtCookRow').hidden = !ytAuth.cookies;
  }
  var ytDlgOpen = false, ytBrowser = 'chrome', ytMsg = null, ytBusy = '';
  function ytPic(kind){
    var P = {
      avatar: '<svg viewBox="0 0 300 120" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="300" height="26" fill="#23252F"/><circle cx="12" cy="13" r="4" fill="#FF5A52"/><circle cx="24" cy="13" r="4" fill="#FFD43B"/><circle cx="36" cy="13" r="4" fill="#4ADE9A"/><rect x="52" y="6" width="150" height="14" rx="7" fill="#15161C"/><text x="60" y="17" font-size="9" fill="#C9CBD4">youtube.com</text><rect x="12" y="38" width="30" height="20" rx="4" fill="#FF4E45"/><rect x="60" y="42" width="150" height="12" rx="6" fill="#2A2D38"/><circle cx="276" cy="48" r="11" fill="#9B87FF"/><circle cx="276" cy="48" r="16" fill="none" stroke="#C9BEFF" stroke-width="2" stroke-dasharray="3 3"/><text x="214" y="82" font-size="10" fill="#C9BEFF">твоя аватарка</text><rect x="12" y="70" width="80" height="44" rx="4" fill="#2A2D38"/><rect x="100" y="70" width="80" height="44" rx="4" fill="#2A2D38"/></svg>',
      f12: '<svg viewBox="0 0 300 120" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="300" height="120" fill="#1A1B22"/><rect width="160" height="120" fill="#23252F"/><rect x="160" width="140" height="120" fill="#0E0F13" stroke="#9B87FF" stroke-width="2"/><text x="168" y="16" font-size="9" fill="#9EA2B0">панель разработчика</text><rect x="168" y="26" width="120" height="6" rx="3" fill="#2A2D38"/><rect x="168" y="38" width="100" height="6" rx="3" fill="#2A2D38"/><rect x="168" y="50" width="110" height="6" rx="3" fill="#2A2D38"/><text x="14" y="64" font-size="11" fill="#7C8090">YouTube</text></svg>',
      tab: function(name, others){ return '<svg viewBox="0 0 300 120" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="300" height="120" fill="#0E0F13"/><rect width="300" height="26" fill="#1A1B22"/><text x="10" y="17" font-size="10" fill="#9EA2B0">' + others + '</text><rect x="158" y="4" width="62" height="18" rx="4" fill="rgba(155,135,255,.25)" stroke="#9B87FF"/><text x="189" y="17" font-size="10" font-weight="700" fill="#ECEDF2" text-anchor="middle">' + name + '</text><text x="228" y="17" font-size="10" fill="#9EA2B0">»</text><path d="M189 30 L189 44" stroke="#9B87FF" stroke-width="2"/><text x="189" y="58" font-size="10" fill="#C9BEFF" text-anchor="middle">нажми сюда</text></svg>'; },
      filter: function(f, before, after){ return '<svg viewBox="0 0 300 120" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="300" height="120" fill="#0E0F13"/><rect width="300" height="22" fill="#1A1B22"/><text x="8" y="15" font-size="9" fill="#9EA2B0">' + before + '</text><rect x="74" y="4" width="34" height="14" rx="3" fill="rgba(155,135,255,.25)" stroke="#9B87FF"/><text x="91" y="14" font-size="9" font-weight="700" fill="#ECEDF2" text-anchor="middle">' + f + '</text><text x="114" y="15" font-size="9" fill="#9EA2B0">' + after + '</text><rect y="28" width="300" height="20" fill="#1C1A28"/><rect x="8" y="33" width="10" height="11" rx="1" fill="#C9CBD4"/><text x="24" y="42" font-size="10" fill="#ECEDF2">www.youtube.com</text><text x="226" y="42" font-size="9" fill="#9EA2B0">200 · document</text></svg>'; },
      menu: function(a, b){ return '<svg viewBox="0 0 300 120" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="300" height="120" fill="#0E0F13"/><rect y="6" width="300" height="20" fill="#1C1A28"/><text x="24" y="20" font-size="10" fill="#ECEDF2">www.youtube.com</text><rect x="40" y="24" width="110" height="88" rx="4" fill="#23252F" stroke="#3A3D4A"/><text x="50" y="40" font-size="9" fill="#9EA2B0">…</text><rect x="42" y="46" width="106" height="16" fill="rgba(155,135,255,.25)"/><text x="50" y="58" font-size="9" fill="#ECEDF2">' + a + '  ›</text><text x="50" y="76" font-size="9" fill="#9EA2B0">…</text><rect x="150" y="46" width="146" height="58" rx="4" fill="#23252F" stroke="#3A3D4A"/><text x="158" y="60" font-size="9" fill="#9EA2B0">…</text><rect x="152" y="66" width="142" height="16" fill="rgba(155,135,255,.4)" stroke="#9B87FF"/><text x="158" y="78" font-size="9" font-weight="700" fill="#ECEDF2">' + b + '</text><text x="158" y="96" font-size="9" fill="#9EA2B0">…</text></svg>'; },
      paste: '<div style="height:100%;display:flex;align-items:center;justify-content:center"><span class="yl-btn">Вставить ключ</span></div>'
    };
    return P[kind];
  }
  function ytSteps(){
    var ff = ytBrowser === 'firefox';
    var ui = function(t){ return '<span class="yl-ui">' + t + '</span>'; }, k = function(t){ return '<kbd>' + t + '</kbd>'; };
    return [
      { t: 'Открой YouTube и проверь, что ты вошёл', d: 'Зайди на ' + ui('youtube.com') + ' в своём обычном браузере. Справа вверху должна быть твоя аватарка, а не кнопка «Войти». Если YouTube открывается только с VPN — включи его.', p: ytPic('avatar') },
      { t: 'Нажми ' + k('F12'), d: 'Сбоку или снизу откроется «панель разработчика». Не пугайся — это просто окно для просмотра, мы ничего в нём не меняем. <b>Важно знать:</b> если панель сама переключила браузер в режим «не в сети», YouTube начнёт «не грузиться» — как будто пропал интернет. Лечится это на следующем шаге. Если ' + k('F12') + ' не срабатывает: ' + k('Ctrl') + '+' + k('Shift') + '+' + k('I') + (ff ? '' : '. В Яндекс Браузере также: меню ☰ → «Дополнительно» → «Дополнительные инструменты» → «Инструменты разработчика»') + '.', p: ytPic('f12') },
      ff ? { t: 'Открой вкладку ' + ui('Сеть') + ' <span class="yl-mute">(Network)</span>', d: 'Она в верхнем ряду панели, рядом с «Консоль» и «Отладчик». Если рядом с поиском в панели есть выпадающий список — там должно стоять ' + ui('Нет ограничений') + ' (No throttling). Если стоит ' + ui('Не в сети') + ' (Offline) — страница перестанет грузиться «как будто нет интернета»: выбери в этом списке «Нет ограничений».', tip: 'Кстати, если YouTube вдруг «не грузится» с открытой панелью — почти всегда виноват именно режим «Не в сети» в этом списке. Верни «Нет ограничений» и нажми ' + k('F5') + '.', p: ytPic('tab')('Сеть', 'Инспектор  Консоль  Отладчик') }
         : { t: 'Открой вкладку ' + ui('Network') + ' <span class="yl-mute">(или «Сеть»)</span>', d: 'Она в верхнем ряду панели. Не видно — нажми ' + ui('»') + ' в этом ряду и выбери её из списка. Если страница «не грузится» и есть список рядом с поиском — в нём должно стоять ' + ui('No throttling') + ', а не ' + ui('Offline') + ' (в русской панели — ' + ui('Нет ограничений') + ', а не ' + ui('Не в сети') + '). Список бывает скрыт: тогда нажми ' + ui('⋮') + ' (три точки) в панели → ' + ui('More tools') + ' → ' + ui('Network conditions') + ', и там выбери ' + ui('No throttling') + '.', tip: 'Это самая частая причина «пропал интернет» при открытой панели. Режим ' + ui('Offline') + ' выключает сеть только для этой вкладки браузера — интернет на компьютере при этом работает.', p: ytPic('tab')('Network', 'Elements  Console  Sources') },
      ff ? { t: 'Обнови страницу ' + k('F5') + ' и нажми фильтр ' + ui('HTML'), d: 'Список заполнится строками. В ряду фильтров над списком нажми ' + ui('HTML') + ' — останется строка ' + ui('www.youtube.com') + ' (в колонке «Файл» будет «/»).', tip: 'Пусто? Нажми ' + k('F5') + ' ещё раз при открытой панели.', p: ytPic('filter')('HTML', 'Все', 'CSS  JS  XHR  Шрифты') }
         : { t: 'Обнови страницу ' + k('F5') + ' и нажми фильтр ' + ui('Doc'), d: 'Список заполнится строками. В ряду фильтров над списком нажми ' + ui('Doc') + ' <span class="yl-mute">(«Документ»)</span> — останется одна строка ' + ui('www.youtube.com') + '.', tip: 'Строк несколько или ни одной? Нажми ' + k('F5') + ' ещё раз при открытой панели.', p: ytPic('filter')('Doc', 'All  Fetch/XHR', 'CSS  JS  Img  Media') },
      ff ? { t: 'Правой кнопкой по строке → ' + ui('Копировать значение') + ' → ' + ui('Копировать как cURL (POSIX)'), d: 'В английской версии: ' + ui('Copy Value') + ' → ' + ui('Copy as cURL (POSIX)') + '. Подойдёт и «как cURL (Windows)» — Тапёр поймёт любой.', p: ytPic('menu')('Копировать значение', 'Копировать как cURL (POSIX)') }
         : { t: 'Правой кнопкой по строке → ' + ui('Copy') + ' → ' + ui('Copy as cURL (bash)'), d: 'В русской версии: ' + ui('Копировать') + ' → ' + ui('Копировать как cURL (bash)') + '. Подойдёт любой пункт со словом <b>cURL</b> — Тапёр разберётся сам.', p: ytPic('menu')('Copy', 'Copy as cURL (bash)') },
      { t: 'Вернись в Тапёр и нажми «Вставить ключ»', d: 'Тапёр сам найдёт в скопированном тексте нужное, проверит и покажет твой аккаунт. После этого панель в браузере можно закрыть (' + k('F12') + ').', tip: 'Не нажимай «Выйти» на YouTube в этом браузере — ключ перестанет работать. Если всё-таки вышел — просто повтори шаги.', p: ytPic('paste') }
    ];
  }
  var YT_ERR_TEXT = {
    empty: 'Буфер обмена пуст. Сначала скопируй строку (шаг 5), потом нажми «Вставить ключ».',
    'not-recognized': 'Это не похоже на скопированный запрос. В шаге 5 выбери пункт со словом cURL.',
    'no-cookies': 'В скопированном тексте нет данных входа. Проверь, что выбран пункт со словом cURL (шаг 5) и строка www.youtube.com (шаг 4).',
    'not-logged-in': 'В скопированном нет входа в аккаунт. Похоже, в этом браузере ты не вошёл в YouTube — справа вверху нет аватарки (шаг 1).',
    wrongSite: 'Скопирована строка не с YouTube. В шаге 4 нужна строка www.youtube.com — включи фильтр Doc (в Firefox — HTML) и обнови страницу.',
    blocked: 'Google не пустил вход в окне программы — так бывает. Используй «Ключ из браузера» ниже: это надёжно.',
    cancelled: 'Окно входа закрыто.',
    'not-configured': 'Этот способ включится в одной из следующих версий — сейчас работают два других.',
    timeout: 'Не дождался ответа из браузера. Попробуй ещё раз.',
    access_denied: 'В браузере нажата «Отмена».'
  };
  function ytCard(n, title, tag, tagCls, text, gives, body){
    return '<div class="yl-way' + (n === 3 ? ' on' : '') + '"><div class="yl-h"><b>' + title + '</b><span class="yl-tag ' + tagCls + '">' + tag + '</span></div><p>' + text + '</p><div class="yl-gives">' + gives + '</div>' + body + '</div>';
  }
  function accLine(a, kind){ return '<div class="yl-acc">' + (a.photo ? '<img src="' + esc(a.photo) + '" alt="">' : '<span class="yl-ava"></span>') + '<span>✓ ' + esc(a.name) + '</span><button class="yl-link" data-ylout="' + kind + '">Выйти</button></div>'; }
  function renderYtDlg(){
    var box = $('ytDlgBody'); if (!box) return;
    var o = ytAuth.oauth, ck = ytAuth.cookies;
    var c1 = o.account ? accLine(o.account, 'oauth') : (o.configured ? '<button class="yl-btn g" data-yl="oauth"' + (ytBusy ? ' disabled' : '') + '>' + (ytBusy === 'oauth' ? 'Жду ответа из браузера…' : 'Открыть браузер') + '</button>' + (ytBusy === 'oauth' ? '<button class="yl-link" data-yl="oauth-cancel">Отмена</button>' : '') : '<div class="yl-soon">Включится в одной из следующих версий</div>');
    var c2 = ck && ck.via === 'window' ? accLine(ck, 'cookies') : '<button class="yl-btn g" data-yl="window"' + (ytBusy ? ' disabled' : '') + '>' + (ytBusy === 'window' ? 'Окно входа открыто…' : 'Войти в окне') + '</button>';
    var c3 = ck && ck.via === 'paste' ? accLine(ck, 'cookies') : '<div class="yl-soon" style="color:#C9BEFF">Инструкция ниже ↓</div>';
    var h = '<div class="yl-ways">' +
      ytCard(1, 'Через браузер', 'ПРОЩЕ ВСЕГО', 'g', 'Откроется обычная страница Google в твоём браузере. Нажимаешь «Разрешить» — готово.', '<span>плейлисты</span><span>лайки</span><span class="no">Premium</span>', c1) +
      ytCard(2, 'Внутри Тапёра', 'ДЛЯ PREMIUM', 'y', 'Окно входа Google прямо в программе. Иногда Google такое окно не пускает — тогда бери третий способ.', '<span>Premium без рекламы</span><span>плейлисты</span><span>меньше проверок</span>', c2) +
      ytCard(3, 'Ключ из браузера', 'САМЫЙ НАДЁЖНЫЙ', 'p', 'Копируешь из своего браузера «ключ входа» и вставляешь сюда. Пара минут по инструкции ниже.', '<span>Premium без рекламы</span><span>плейлисты</span><span>меньше проверок</span>', c3) +
      '</div>';
    if (ytMsg && !ytPasteRes) h += '<div class="yl-res ' + (ytMsg.ok ? 'ok' : 'bad') + '">' + (ytMsg.ok ? (ytMsg.photo ? '<img src="' + esc(ytMsg.photo) + '" alt="">' : '<span class="yl-ava"></span>') : '<span style="font-size:20px">⚠</span>') + '<div style="flex:1"><div style="font-weight:600">' + esc(ytMsg.title) + '</div>' + (ytMsg.text ? '<div class="yl-small">' + esc(ytMsg.text) + '</div>' : '') + '</div>' + (ytMsg.ok ? '<button class="yl-btn g" data-yl="close">Готово</button>' : '') + '</div>';
    h += '<div class="yl-sec"><h2>Как достать ключ входа</h2><div class="yl-small">Ничего не устанавливаем и ничего не меняем — только копируем. Выбери свой браузер:</div>' +
      '<div class="yl-tabs"><button data-ylb="chrome" class="' + (ytBrowser === 'chrome' ? 'on' : '') + '">Chrome · Яндекс Браузер · Edge · Opera</button><button data-ylb="firefox" class="' + (ytBrowser === 'firefox' ? 'on' : '') + '">Firefox</button></div><div class="yl-steps">';
    ytSteps().forEach(function (s, i){
      h += '<div class="yl-st"><div class="yl-n">' + (i + 1) + '</div><div><div class="yl-t">' + s.t + '</div><div class="yl-d">' + s.d + '</div>' + (s.tip ? '<div class="yl-tip">' + s.tip + '</div>' : '') + '</div><div class="yl-pic">' + s.p + '</div></div>';
    });
    h += '</div><div class="yl-paste"><button class="yl-btn" data-yl="paste"' + (ytBusy ? ' disabled' : '') + '>' + (ytBusy === 'paste' ? 'Проверяю…' : 'Вставить ключ') + '</button><textarea id="ytPasteBox" placeholder="Тапёр возьмёт скопированное из буфера обмена. Или вставь сюда: Ctrl+V" spellcheck="false"></textarea></div>' + pasteStatus() +
      (ck ? '<label class="yl-opt"><input type="checkbox" id="ytUseCk"' + (ytAuth.useCookies ? ' checked' : '') + '> Использовать вход и для основного способа воспроизведения <span class="yl-mute">— реже будет проверка «ты не робот». YouTube может заметить частое использование; если боишься за аккаунт — не включай</span></label>' : '') +
      '<div class="yl-safe"><div style="font-size:18px">🔒</div><div><b>Ключ — это доступ к твоему аккаунту.</b> Тапёр хранит его зашифрованным только на этом компьютере и никуда не отправляет, даже в журнал работы. Никому его не пересылай. Чтобы отключить — «Выйти» здесь. Чтобы ключ точно перестал работать везде: Google → «Безопасность» → «Выйти на всех устройствах».</div></div></div>';
    box.innerHTML = h;
    var ta = $('ytPasteBox');
    if (ta) ta.addEventListener('paste', function(e){ var t = (e.clipboardData || window.clipboardData).getData('text'); e.preventDefault(); ytPaste(t); });
    var uc = $('ytUseCk'); if (uc) uc.onchange = function(){ ytAuth.useCookies = uc.checked; if (A.setSetting) A.setSetting('ytUseCookies', uc.checked); };
  }
  // Итог вставки ключа — прямо под полем вставки: что вставили и чем закончилось (сам ключ не показываем)
  var ytPasteRes = null;
  var PASTE_KIND = { curl: 'cURL (bash)', 'curl-cmd': 'cURL (Windows cmd)', powershell: 'PowerShell', 'cookies.txt': 'файл cookies.txt', headers: 'заголовки запроса', 'cookie-string': 'строка cookie', text: 'обычный текст' };
  function pasteStatus(){
    if (ytBusy === 'paste') return '<div class="yl-pres busy"><span class="yl-spin"></span><div>Проверяю ключ…</div></div>';
    var r = ytPasteRes; if (!r) return '';
    var what = r.pasted ? 'Вставлено: ' + (PASTE_KIND[r.pasted.kind] || 'текст') + ' · ' + r.pasted.len.toLocaleString('ru-RU') + ' симв.' + (r.count ? ' · записей входа: ' + r.count : '') : '';
    if (r.ok) return '<div class="yl-pres ok"><span class="yl-pi">✓</span><div><b>Готово! Вошёл как ' + esc(r.name || 'аккаунт YouTube') + '</b><div class="yl-small">' + esc(what) + (r.unchecked ? ' · проверить не удалось: ' + esc(r.message || 'YouTube не отвечает') + ', но ключ сохранён' : ' · ключ проверен') + '</div></div></div>';
    return '<div class="yl-pres bad"><span class="yl-pi">⚠</span><div><b>' + esc(ytMsg && !ytMsg.ok ? ytMsg.title : 'Не получилось') + '</b><div class="yl-small">' + esc(what) + (ytMsg && ytMsg.text ? ' — ' + esc(ytMsg.text) : '') + '</div></div></div>';
  }
  async function ytPaste(text){
    ytBusy = 'paste'; ytMsg = null; ytPasteRes = null; renderYtDlg();
    var r;
    try { r = A.ytLoginPaste ? await A.ytLoginPaste(text || '') : { error: 'failed' }; }
    catch (e) { r = { error: 'failed', message: e && e.message }; }
    finally { ytBusy = ''; }
    ytPasteRes = r || { error: 'failed' };
    if (r && r.ok) ytMsg = { ok: true, title: 'Вошёл как ' + (r.name || 'аккаунт YouTube'), photo: r.photo, text: r.unchecked ? 'Ключ сохранён, но проверить не удалось: ' + (r.message || 'YouTube не отвечает') : 'Ключ проверен, всё нужное на месте (записей: ' + r.count + ')' };
    else {
      var code = r && r.error;
      ytMsg = { ok: false, title: code === 'rejected' ? 'YouTube не принял ключ' : 'Это не тот текст', text: code === 'rejected' ? (r.message || '') + '. Повтори шаги 1–5.' : (r && r.wrongSite ? YT_ERR_TEXT.wrongSite : (YT_ERR_TEXT[code] || ('Ошибка: ' + code))) };
    }
    await ytAuthRefresh(); renderYtDlg();
    var pr = document.querySelector('#ytDlg .yl-pres'); if (pr) pr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (r && r.ok) { myLoaded = false; if (curTab === 'my') loadMy(true); }
  }
  function openYtDlg(){ ytDlgOpen = true; ytMsg = null; ytPasteRes = null; $('ytDlg').hidden = false; renderYtDlg(); ytAuthRefresh(); }
  function closeYtDlg(){ ytDlgOpen = false; $('ytDlg').hidden = true; if (typeof qcSoon === 'function') qcSoon(); }
  $('ytDlg').addEventListener('click', async function(e){
    if (e.target === $('ytDlg')) { closeYtDlg(); return; }
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ylb) { ytBrowser = b.dataset.ylb; renderYtDlg(); return; }
    if (b.dataset.ylout) { await A.ytLogout(b.dataset.ylout); ytMsg = null; await ytAuthRefresh(); myLoaded = false; return; }
    var a = b.dataset.yl; if (!a) return;
    if (a === 'close') { closeYtDlg(); return; }
    if (a === 'paste') { ytPaste(''); return; }
    if (a === 'oauth-cancel') { A.ytOauthCancel(); return; }
    if (a === 'oauth' || a === 'window') {
      ytBusy = a; ytMsg = null; renderYtDlg();
      var r = null;
      try { r = a === 'oauth' ? await A.ytOauthLogin() : await A.ytLoginWindow(); }
      catch (e) { r = { error: 'failed', message: e && e.message }; }
      finally { ytBusy = ''; }
      ytMsg = r && r.ok ? { ok: true, title: 'Вошёл как ' + (r.name || 'аккаунт YouTube'), photo: r.photo, text: a === 'oauth' ? 'Плейлисты и лайки — во вкладке «Плейлисты»' : 'Premium и плейлисты подключены' }
        : { ok: false, title: 'Вход не выполнен', text: YT_ERR_TEXT[r && r.error] || ('Ошибка: ' + ((r && r.error) || 'нет ответа')) };
      await ytAuthRefresh(); renderYtDlg();
      if (r && r.ok) { myLoaded = false; if (curTab === 'my') loadMy(true); }
    }
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && ytDlgOpen) closeYtDlg(); });
  $('ytDlgClose').onclick = closeYtDlg;
  $('setYtLogin').onclick = openYtDlg;
  var ytCookTg = $('setYtUseCk');
  if (ytCookTg) ytCookTg.onclick = function(){ var on = !ytCookTg.classList.contains('on'); setTg(ytCookTg, on); ytAuth.useCookies = on; if (A.setSetting) A.setSetting('ytUseCookies', on); };
  ytAuthRefresh().then(function(){ if (ytCookTg) setTg(ytCookTg, ytAuth.useCookies); });


  // ===== Состояние сервисов (самопроверка) =====
  var health = null, healthBusy = false, healthNote = '';
  var SVC_NAMES = { yandex: 'Яндекс Музыка', youtube: 'YouTube', soundcloud: 'SoundCloud', audius: 'Audius' };
  var ST_TEXT = { ok: 'Работает', warn: 'Частично', fail: 'Не работает', skip: 'Не проверялось' };
  function agoText(t){
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'только что'; if (m < 60) return m + ' мин назад';
    var h = Math.round(m / 60); if (h < 24) return h + ' ч назад';
    return Math.round(h / 24) + ' дн назад';
  }
  // В окне не показываем названия внутренних библиотек (yt-dlp, hls.js и т.п.)
  function noLib(t){ return String(t == null ? '' : t).replace(/\s*\(поток HLS\)/g, '').replace(/\b(yt-?dlp(\.exe)?|ytdl(-core)?|yt-search|hls\.js|hls)\b/gi, 'движок').replace(/движок:\s*движок/gi, 'движок'); }
  function renderHealth(){
    var box = $('healthBox'); if (!box) return;
    var h = '';
    // Быстрая проверка — аналог чеклиста поиска (Ф4): те же пункты и лампочки.
    // Строки строит общий qcRowsHtml() из src/ui/05-search.js, данные — QC.items.
    var qcWhen = QC.running ? 'проверяю…' : (QC.at ? 'проверено ' + agoText(QC.at) : 'ещё не проверялось');
    h += '<div class="hs-svc hs-qc"><div class="hs-head"><b>Быстрая проверка</b><span class="hs-title">' + esc(qcWhen) + '</span></div>' + qcRowsHtml() + '</div>';
    if (!health) h += '<div class="srow"><div class="sl"><div class="sd">Глубокая проверка ещё не шла. Тапёр запускает её сам раз в сутки, когда музыка не играет, — или нажми «Проверить сейчас».</div></div></div>';
    else {
      h += '<div class="ck-g">Подробности по площадкам</div>';
      ['yandex', 'youtube', 'soundcloud', 'audius'].forEach(function (k){
        var s = health.services && health.services[k]; if (!s) return;
        h += '<div class="hs-svc hs-platform"><div class="hs-head"><b>' + SVC_NAMES[k] + '</b><span class="hs-pill ' + s.status + '">' + ST_TEXT[s.status] + '</span><span class="hs-title">' + esc(noLib(s.title)) + '</span>' +
          ((s.status === 'fail' || s.status === 'warn') && (k === 'yandex' || k === 'youtube') ? '<button class="btn ghost" data-hs-browser="' + (k === 'yandex' ? 'ym' : 'yt') + '">Слушать на сайте</button>' : '') + '</div>';
        (s.steps || []).forEach(function (st){
          var ic = st.ok === true ? '<span class="hs-ic ok">✓</span>' : (st.ok === false ? '<span class="hs-ic bad">✕</span>' : '<span class="hs-ic">–</span>');
          h += '<div class="hs-step">' + ic + '<span class="hs-n">' + esc(noLib(st.name)) + '</span><span class="hs-t">' + esc(noLib(st.text)) + '</span></div>';
        });
        h += '</div>';
      });
      var det = JSON.stringify(health, null, 2);
      h += '<div class="hs-foot"><span class="sd">Проверено ' + agoText(health.at) + ' · правила сайтов: версия ' + ((health.recipes && health.recipes.version) || '?') + ' (' + esc((health.recipes && health.recipes.source) || '') + ')</span>' +
        '<details class="hs-det"><summary>Подробности для разработчика</summary><pre>' + esc(det) + '</pre><button class="btn ghost" id="hsCopy">Скопировать</button></details></div>';
    }
    if (healthNote) h += '<div class="srow"><div class="sl"><div class="sd" style="color:#FFD43B">' + esc(healthNote) + '</div></div></div>';
    box.innerHTML = h;
    var c = $('hsCopy'); if (c) c.onclick = function(){ copyText(JSON.stringify(health, null, 2)); c.textContent = '✓ Скопировано'; };
    $('hsRun').disabled = healthBusy; $('hsRun').textContent = healthBusy ? 'Проверяю… (до минуты)' : 'Проверить сейчас';
    renderHealthWarn(); // значок в шапке: быстрая и глубокая проверки вместе
  }
  async function runHealth(manual){
    if (healthBusy || !A.healthRun) return;
    // Мешает только звук, который идёт прямо сейчас (на паузе — можно проверять)
    var m = master();
    var playing = loadingIdx >= 0 || (m.getAttribute('src') && !m.paused && !m.ended);
    if (playing && manual) { healthNote = 'Поставь музыку на паузу: проверка ненадолго открывает сайт Яндекса без звука.'; renderHealth(); return; }
    if (YW.on && manual) { healthNote = 'Сейчас трек идёт через сайт Яндекса — проверка его прервёт. Переключи на трек из другого источника или перезапусти Тапёр.'; renderHealth(); return; }
    // Играет музыка, а проверка сама по расписанию — не отменяем её целиком, а гоняем тихо:
    // всё, кроме сайта Яндекса (его вердикт переносится с прошлого раза). Иначе у стримера,
    // где музыка идёт почти всегда, глубокая проверка не случалась бы вовсе.
    var quiet = playing || YW.on;
    healthBusy = true; healthNote = ''; renderHealth();
    var r = await A.healthRun(quiet ? { skipAudio: true } : null).catch(function(){ return null; });
    healthBusy = false;
    if (r && r.busy) healthNote = 'Музыка играет — проверю позже.';
    else if (r) health = r;
    renderHealth();
    if (r && !r.busy) qcSoon(); // после глубокой проверки (она обновляет движок) — лампочки заново
  }
  // «Проверить сейчас» обновляет и быструю проверку (список выше), и глубокую (площадки ниже).
  $('hsRun').onclick = function(){
    if (!QC.running && !QC.fixing) runQC();
    runHealth(true);
  };
  $('healthBox').addEventListener('click', function(e){
    var qa = e.target.closest('[data-qa]');
    if (qa) { qcAction(qa.dataset.qa, qa.dataset.qid); return; }
    var ql = e.target.closest('[data-qlink]');
    if (ql) { e.preventDefault(); if (A.openExternal) A.openExternal(ql.dataset.qlink); return; }
    var b = e.target.closest('[data-hs-browser]'); if (b) { setTab('browser'); brShow(b.dataset.hsBrowser); }
  });
  // Нажатие на «⚠ Проблем»: показываем проверки вместо выдачи (Ф3).
  // qcShow свернёт выданное и страницу внутри поиска, поставит проверки сверху и прокрутит к ним.
  $('healthWarn').onclick = function(){ qcShow(); };
  if (A.healthGet) A.healthGet().then(function (h){ health = h; renderHealth(); });
  // Сама раз в сутки, когда ничего не играет (первый раз — через 3 минуты после запуска)
  function healthTick(){ if (!health || Date.now() - health.at > 20 * 3600 * 1000) runHealth(false); }
  // Сайт Яндекса тихий прогон не трогает — ловим минуты тишины, чтобы проверить и его
  function siteTick(){
    if (healthBusy || !health) return;
    var m = master();
    if (loadingIdx >= 0 || (m.getAttribute('src') && !m.paused && !m.ended) || YW.on) return;
    var sAt = health.siteAt != null ? health.siteAt : health.at;
    if (Date.now() - sAt > 20 * 3600 * 1000) runHealth(false);
  }
  setInterval(siteTick, 5 * 60 * 1000);
  setTimeout(healthTick, 3 * 60 * 1000);
  setInterval(healthTick, 30 * 60 * 1000);

  // ===== Вкладка «Браузер»: сайты сервисов (если кнопки Тапёра не работают) =====
  var BR = { cur: '', views: {}, last: null };
  // Через минуту после ухода с вкладки «Браузер» закрываем сайты, если они молчат:
  // живые webContents сайтов держат сотни мегабайт и не освобождаются сами.
  var brSleepT = 0;
  function brWake(){ clearTimeout(brSleepT); brSleepT = 0; }
  function brSleep(){ clearTimeout(brSleepT); brSleepT = setTimeout(brRelease, 60000); }
  function brRelease(){
    brSleepT = 0;
    for (var k in BR.views) {
      try { if (BR.views[k].isCurrentlyAudible && BR.views[k].isCurrentlyAudible()) { brSleep(); return; } } catch (e) {}
    }
    var n = 0;
    for (var key in BR.views) { try { var id = BR.views[key].getWebContentsId(); if (id && A.brClose) A.brClose(id); } catch (e) {} try { BR.views[key].remove(); n++; } catch (e) {} }
    BR.views = {}; BR.cur = '';
    brZoomPaint(null);
    if (n) axLog('браузер: закрыл сайты после ухода с вкладки (' + n + ')');
    // Вкладка открыта (окно было свёрнуто) — не оставляем пустоту: вернём сайт сразу
    if (n && typeof curTab !== 'undefined' && curTab === 'browser' && BR.last) brShow(BR.last.svc, BR.last.url);
    if (n && A.brSwClear) A.brSwClear().catch(function(){});
  }
  var BR_SVC = {
    ym: { url: 'https://music.yandex.ru/', partition: 'persist:yandex-login' },
    yt: { url: 'https://www.youtube.com/', partition: '' },
    web: { url: 'https://ya.ru/', partition: 'persist:browser' }
  };
  // Какой вкладке принадлежит адрес
  function brSvcFor(u){
    var h = ''; try { h = new URL(u).hostname.toLowerCase(); } catch (e) { return 'web'; }
    if (/(^|\.)music\.yandex\.(ru|com|by|kz)$/.test(h)) return 'ym';
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(h)) return 'yt';
    return 'web';
  }
  // Ссылка t.me открывается как обычный сайт во вкладке «Браузер».
  function isTgLink(q){ return /^(https?:\/\/)?(www\.)?((t|telegram)\.me|web\.telegram\.org)\//i.test(String(q).trim()); }
  // Открыть адрес во вкладке «Браузер»
  function brOpen(u){
    var svc = brSvcFor(u);
    var had = !!BR.views[svc];
    brShow(svc, had ? null : u);
    setTab('browser');
    if (had) { try { BR.views[svc].loadURL(u); } catch (e) {} }
  }
  // Строка адреса: адрес → открыть, иначе — поиск в Яндексе
  $('brAddr').addEventListener('submit', function(e){
    e.preventDefault();
    var t = $('brUrl').value.trim(); if (!t) return;
    var u;
    if (/^https?:\/\//i.test(t)) u = t;
    else if (/^(t|telegram)\.me\//i.test(t)) u = 'https://' + t;
    else if (/^[^\s]+\.[a-zа-я]{2,}(\/\S*)?$/i.test(t)) u = 'https://' + t;
    else u = 'https://ya.ru/search/?text=' + encodeURIComponent(t);
    $('brUrl').blur();
    brOpen(u);
  });
  // Масштаб сайта во вкладке «Браузер» (0.34.0, Б3). Клавиши и колесо ловит главный
  // процесс в гостевом webContents, здесь — кнопки и показ процентов.
  function brZoomId(){
    var w = brView(); if (!w) return 0;
    try { return w.getWebContentsId() || 0; } catch (e) { return 0; }
  }
  function brZoomPaint(z){
    var b = $('brZoomPct'); if (!b) return;
    var p = z && z.percent != null ? z.percent : 100;
    b.textContent = p + ' %';
  }
  function brZoomInit(){
    var id = brZoomId();
    if (!id || !A.brZoom) { brZoomPaint(null); return; }
    A.brZoom(id).then(function (r){ if (r && r.ok) brZoomPaint(r); }).catch(function(){});
  }
  function brZoomStep(action){
    var id = brZoomId();
    if (!id || !A.brZoomStep) return;
    A.brZoomStep(id, action).then(function (r){ if (r && r.ok) brZoomPaint(r); }).catch(function(){});
  }
  $('brZoomOut').onclick = function(){ brZoomStep('out'); };
  $('brZoomPct').onclick = function(){ brZoomStep('reset'); };
  $('brZoomIn').onclick = function(){ brZoomStep('in'); };
  if (A.onBrZoom) A.onBrZoom(function (z){
    if (!z) return;
    var w = brView(); if (!w) return;
    try { if (w.getWebContentsId() === z.id) brZoomPaint(z); } catch (e) {}
  });
  function brView(){ return BR.views[BR.cur]; }
  function brShow(svc, firstUrl){
    if (!BR_SVC[svc]) return;
    if (svc === 'web') $('brSvc').querySelector('[data-svc=web]').hidden = false;
    BR.cur = svc;
    BR.last = { svc: svc, url: firstUrl || BR_SVC[svc].url };
    var bs = $('brSvc').querySelectorAll('button'); for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', bs[k].dataset.svc === svc);
    if (!BR.views[svc]) {
      var w = document.createElement('webview');
      if (BR_SVC[svc].partition) w.setAttribute('partition', BR_SVC[svc].partition);
      if (svc === 'yt' && A.chromeUA) w.setAttribute('useragent', A.chromeUA);
      w.setAttribute('src', firstUrl || BR_SVC[svc].url);
      // сайт сам звук не включает — только после нажатия на нём (иначе открытая страница могла бы поставить Тапёр на паузу)
      w.setAttribute('webpreferences', 'autoplayPolicy=user-gesture-required');
      w.className = 'br-web';
      w.addEventListener('media-started-playing', function(){ brOnPlay(w); });
      // Запоминаем все звуки страницы (сайт может играть и вне документа), чтобы потом поставить их на паузу
      w.addEventListener('dom-ready', function(){ try { w.executeJavaScript("(function(){if(window.__tapM)return;window.__tapM=new Set();var p=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.__tapM.add(this);return p.apply(this,arguments)};})()"); } catch (e) {} });
      var upd = function(){ if (BR.cur === svc && document.activeElement !== $('brUrl')) { try { $('brUrl').value = w.getURL(); } catch (e) {} } try { if (BR.cur === svc) BR.last = { svc: svc, url: w.getURL() || BR_SVC[svc].url }; } catch (e) {} if (BR.cur === svc) brZoomInit(); };
      w.addEventListener('did-navigate', upd); w.addEventListener('did-navigate-in-page', upd);
      var em = $('brEmpty'); if (em) em.remove();
      $('brWrap').appendChild(w);
      BR.views[svc] = w;
    }
    for (var key in BR.views) BR.views[key].style.display = key === svc ? 'flex' : 'none';
    try { $('brUrl').value = BR.views[svc].getURL() || firstUrl || BR_SVC[svc].url; } catch (e) { $('brUrl').value = firstUrl || BR_SVC[svc].url; }
    try { if (BR.cur === svc && BR.views[svc] && BR.views[svc].getURL) BR.last = { svc: svc, url: BR.views[svc].getURL() || (firstUrl || BR_SVC[svc].url) }; } catch (e) {}
    brZoomInit();
  }
  // Окно свернули дольше чем на минуту — сайты закрываем; развернули — возвращаем тот же сайт.
  // Раньше здесь был класс «calm», но он значит «окно не в фокусе»: сайты закрывались, когда стример
  // просто переключался в OBS или в чат.
  if (A.onWinMinimized) A.onWinMinimized(function (min){
    if (typeof curTab === 'undefined' || curTab !== 'browser') return;
    if (min) { brSleep(); return; }
    brWake();
    if (!BR.cur && BR.last) brShow(BR.last.svc, BR.last.url);
  });
  // Сайт заиграл — Тапёр встаёт на паузу, чтобы не было двух музык сразу.
  // Но только если сайт правда звучит дольше 2 с и ты сейчас смотришь вкладку «Браузер»:
  // немое автовидео, превью при наведении, короткие звуки уведомлений и фоновые вкладки на музыку не влияют.
  function brOnPlay(w){
    clearTimeout(w._tapPlayT);
    w._tapPlayT = setTimeout(async function(){
      if (curTab !== 'browser' || BR.views[BR.cur] !== w) return;
      var id = 0; try { id = w.getWebContentsId(); } catch (e) {}
      var audible = id && A.brAudible ? await A.brAudible(id).catch(function(){ return false; }) : false;
      if (!audible) return;
      var m = master();
      if (m.getAttribute('src') && !m.paused) { m.pause(); setSub('Тапёр на паузе — играет сайт во вкладке «Браузер»'); }
    }, 2000);
  }
  // Тапёр заиграл — останавливаем звук на сайтах
  function brPauseAll(){
    for (var key in BR.views) { try { BR.views[key].executeJavaScript("(window.__tapM?Array.from(window.__tapM):[]).concat(Array.from(document.querySelectorAll('audio,video'))).forEach(function(m){ try { m.pause(); } catch (e) {} })").catch(noop); } catch (e) {} }
  }
  allEls().concat([ytx, ymx]).forEach(function (el){ el.addEventListener('play', function(){ if (el === master()) brPauseAll(); }); });
  $('brSvc').onclick = function(e){ var b = e.target.closest('button[data-svc]'); if (b && !b.disabled) brShow(b.dataset.svc); };
  // Назад / вперёд / обновить. Через главный процесс: у <webview> в новых Electron этих методов
  // уже нет, поэтому кнопки раньше молча ничего не делали.
  function brNavFallback(w, action){
    try {
      if (action === 'reload') { if (w.reload) w.reload(); return true; }
      var can = action === 'back' ? (w.canGoBack && w.canGoBack()) : (w.canGoForward && w.canGoForward());
      if (can) { if (action === 'back') w.goBack(); else w.goForward(); return true; }
    } catch (e) {}
    return false;
  }
  function brNav(action){
    var w = brView(); if (!w) return;
    var id = 0; try { id = w.getWebContentsId(); } catch (e) {}
    if (!id || !A.brNav) { brNavFallback(w, action); return; }
    A.brNav(id, action).then(function (r){ if (!r || !r.ok) brNavFallback(w, action); }).catch(function(){ brNavFallback(w, action); });
  }
  $('brBack').onclick = function(){ brNav('back'); };
  $('brFwd').onclick = function(){ brNav('forward'); };
  $('brReload').onclick = function(){ brNav('reload'); };
  $('brCollect').onclick = brCollect;

  // Запасной способ Яндекса: вход на сайте и проверка
  $('setYwLogin').onclick = async function(){
    if (!A.ymwebLogin) return;
    $('setYwText').textContent = 'Открыл окно сайта — войди в Яндекс, оно закроется само';
    var r = await A.ymwebLogin();
    $('setYwText').textContent = r && r.ok ? '✓ Вход на сайте есть. Запасной способ готов' : 'Окно закрыто без входа';
  };
  $('setYwTest').onclick = function(){
    var v = queue[current];
    if (!v || srcOf(v) !== 'ym') { $('setYwText').textContent = 'Включи любой трек из Яндекса и нажми «Проверить» ещё раз'; return; }
    $('setYwText').textContent = 'Проверяю: играю «' + v.title + '» через сайт… Подробности — в журнале работы';
    startMedia(v, { ymweb: true });
  };

  // ===== Настройки: вкладки по пунктам левого меню =====
  // По умолчанию tabs: открыт ровно один раздел. Старая общая простыня включается
  // невидимой настройкой settingsLayout: "sheet" (без пункта в интерфейсе).
  var settingsPaneId = 'sAbout';
  var settingsLayoutMode = 'tabs';
  var settingsView = $('viewSettings');
  function settingsPanes(){ return Array.prototype.slice.call(document.querySelectorAll('#viewSettings .set-main > section')); }
  function showSettingsPane(id){
    var target = document.getElementById(id);
    if (!target || !settingsView) return;
    settingsPaneId = id;
    if (settingsLayoutMode !== 'tabs') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    settingsPanes().forEach(function (p) {
      if (p === target) { p.hidden = false; p.classList.add('on'); }
      else if (!p.hidden) { p.dataset.setTabHidden = '1'; p.hidden = true; p.classList.remove('on'); }
    });
    document.querySelectorAll('.set-side [data-go]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.go === id);
    });
    var main = document.querySelector('.set-main'); if (main) main.scrollTop = 0;
  }
  function applySettingsLayout(mode){
    settingsLayoutMode = mode === 'sheet' ? 'sheet' : 'tabs';
    if (!settingsView) return;
    settingsView.classList.toggle('set-tabs', settingsLayoutMode === 'tabs');
    settingsView.classList.toggle('set-sheet', settingsLayoutMode === 'sheet');
    if (settingsLayoutMode === 'tabs') {
      showSettingsPane(settingsPaneId || 'sAcc');
    } else {
      settingsPanes().forEach(function (p) {
        p.classList.remove('on');
        // Отладочный раздел не показываем всей простынёй: он появляется только после «tapyor debug».
        if (p.dataset && p.dataset.dbgClosed === '1') return;
        if (p.dataset.setTabHidden) { p.hidden = false; delete p.dataset.setTabHidden; }
      });
      document.querySelectorAll('.set-side [data-go]').forEach(function (b){ b.classList.remove('on'); });
    }
  }
  // Первый кадр — вкладки; если сохранена старая простыня, сразу переключаемся.
  applySettingsLayout('tabs');
  if (A.getSetting) A.getSetting('settingsLayout').then(function (v){ if (v === 'sheet') applySettingsLayout('sheet'); }).catch(function(){});
  window.applySettingsLayout = applySettingsLayout;
  window.showSettingsPane = showSettingsPane;

  // Страховка от потери разделов: каждый пункт слева должен вести в существующую секцию.
  (function checkSettingsPanes(){
    var missing = [];
    document.querySelectorAll('.set-side [data-go]').forEach(function (b){ if (!document.getElementById(b.dataset.go)) missing.push(b.dataset.go); });
    if (missing.length && typeof axLog === 'function') axLog('настройки: нет разделов для пунктов ' + missing.join(', '));
  })();

