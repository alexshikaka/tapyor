  // ===== Аккаунт Яндекс Музыки =====
  var acctBtn = $('acct');
  var acctFirst = true;
  // Круглая кнопка входа: логотип (нет входа) или аватарка (вход есть); при наведении раскрывается текст
  var YM_LOGO = '<span class="ai" style="background:#FFD43B"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E0F13" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 18V6l10-2v12"></path><circle cx="6.5" cy="18" r="2.5"></circle><circle cx="16.5" cy="16" r="2.5"></circle></svg></span>';
  var YT_LOGO = '<span class="ai" style="background:#FF0033"><svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg></span>';
  function acctFace(o){
    if (o.avatar) return '<span class="ai" style="background:var(--bg4)"><img src="' + esc(o.avatar) + '" alt="" referrerpolicy="no-referrer"></span>';
    if (o.name) return '<span class="ai" style="background:' + o.color + '">' + esc(o.name.trim().slice(0, 1).toUpperCase()) + '</span>';
    return o.logo;
  }
  function acctRender(btn, o){ btn.innerHTML = acctFace(o) + '<span class="at">' + esc(o.text) + '</span>'; btn.title = ''; btn.setAttribute('aria-label', o.text); }
  async function refreshAcct(){
    if (!A.ymStatus) return;
    var s = null;
    try { s = await A.ymStatus(); }
    catch (e) { s = { loggedIn: false, error: 'не удалось проверить вход' }; }
    var was = ymLoggedIn;
    ymLoggedIn = !!(s && s.loggedIn);
    ymPlus = !!(s && s.loggedIn && (s.hasPlus || s.offline));
    renderSetYm(s);
    if (s && s.loggedIn) {
      acctRender(acctBtn, { avatar: s.avatar, name: s.name || s.login || 'Я', color: '#FFD43B', logo: YM_LOGO, text: (s.name || s.login || 'Яндекс') + (s.offline ? '' : (s.hasPlus ? ' · Плюс' : ' · без Плюса')) + ' — выйти' });
      acctBtn.dataset.in = '1';
    } else {
      acctRender(acctBtn, { logo: YM_LOGO, text: (s && s.error) ? 'Войти в Яндекс · ' + s.error : 'Войти в Яндекс' });
      acctBtn.dataset.in = '';
    }
    if (ymLoggedIn !== was || ymLoggedIn) { myLoaded = false; if (curTab === 'my') loadMy(true); }
    if (!acctFirst && ymLoggedIn !== was && typeof qcSoon === 'function') qcSoon(); // вошёл/вышел — лампочки заново
    acctFirst = false;
    if (ymLoggedIn) {
      if (A.ymLikeIds) A.ymLikeIds().then(function (ids){ likedSet = new Set((ids || []).map(String)); renderLike(); });
      if (A.ymDislikeIds) A.ymDislikeIds().then(function (ids){ dislikedSet = new Set((ids || []).map(String)); renderLike(); });
      // Сначала показываем последний список станций из кэша, потом обновляем из сети.
      if (typeof useCachedStations === 'function') useCachedStations();
      if (A.ymStations) A.ymStations().then(function (list){
        if (list && list.length) { stations = list; if (typeof saveCachedStations === 'function') saveCachedStations(list); }
        else if (typeof useCachedStations === 'function') useCachedStations();
        renderGenres();
        if (typeof renderWavePage === 'function') renderWavePage();
      }).catch(function(){
        if (typeof useCachedStations === 'function') useCachedStations();
        renderGenres();
      });
      variants.loaded = false;
      if (!$('waveSettings').hidden) loadVariants(); else renderVariants();
    } else { likedSet = new Set(); dislikedSet = new Set(); stations = []; renderGenres(); renderVariants(); }
    renderWaveUi(); renderLike();
    ensureWavePreview();
  }

  acctRender(acctBtn, { logo: YM_LOGO, text: 'Войти в Яндекс' });
  var acctBtnYt = $('acctYt');
  acctRender(acctBtnYt, { logo: YT_LOGO, text: 'Войти в YouTube' });
  async function refreshAcctYt() {
    if (!A.ytAuthStatus) return;
    var s = null;
    try { s = await A.ytAuthStatus(); } catch (e) { s = null; }
    var who = (s && s.cookies && s.cookies.name) || (s && s.oauth && s.oauth.account && s.oauth.account.name) || '';
    if (s && (s.cookies || (s.oauth && s.oauth.account))) {
      var ph = (s.oauth && s.oauth.account && s.oauth.account.photo) || (s.cookies && s.cookies.photo) || '';
      acctRender(acctBtnYt, { avatar: ph, name: who || 'Y', color: '#FF0033', logo: YT_LOGO, text: (who || 'YouTube') + ' — вход в YouTube' });
      acctBtnYt.dataset.in = '1';
    } else {
      acctRender(acctBtnYt, { logo: YT_LOGO, text: 'Войти в YouTube' });
      acctBtnYt.dataset.in = '';
    }
  }
  // Вход: по умолчанию через обычный браузер по коду; запасной — окно внутри приложения
  var lm = $('loginModal'), lmUrl = '', loginBusy = false;
  // Перейти в браузер: сама через 10 с или по нажатию (15.11.2026: раньше браузер открывался сразу,
  // и код в окне никто не успевал прочитать).
  var LM_WAIT = 10, lmTimer = null, lmLeft = 0, lmOpened = false;
  function lmBtn(){
    var b = $('lmOpen'); if (!b) return;
    b.textContent = lmOpened ? 'Открыть страницу ещё раз' : ('Перейти в браузер (' + lmLeft + ')');
    b.classList.toggle('pri', !lmOpened);
  }
  function lmStop(){ clearInterval(lmTimer); lmTimer = null; }
  function lmGo(){
    lmStop();
    if (lmUrl) A.openExternal(lmUrl);
    lmOpened = true; lmBtn();
    $('lmText').textContent = 'Страница Яндекса открыта в браузере. Введи там этот код:';
  }
  function lmCountdown(){
    lmStop(); lmOpened = false; lmLeft = LM_WAIT; lmBtn();
    lmTimer = setInterval(function(){ lmLeft -= 1; if (lmLeft <= 0) lmGo(); else lmBtn(); }, 1000);
  }
  function closeLoginModal(){ lmStop(); lm.hidden = true; }
  async function inAppLogin(){
    acctRender(acctBtn, { logo: YM_LOGO, text: 'Открываю вход…' });
    var r = await A.ymLogin();
    if (r && r.error && r.error !== 'вход отменён') alert('Вход в Яндекс: ' + r.error);
    refreshAcct();
  }
  async function browserLogin(){
    if (loginBusy) { lm.hidden = false; return; }
    if (!A.ymLoginBrowserStart) return inAppLogin();
    loginBusy = true;
    try {
      $('lmText').textContent = 'Готовлю вход…';
      $('lmCode').textContent = '• • • • • • •';
      lm.hidden = false;
      var s = await A.ymLoginBrowserStart();
      if (!s || s.error) { closeLoginModal(); return inAppLogin(); }
      lmUrl = s.open_url || s.verification_url;
      $('lmText').textContent = 'Запомни код — сейчас откроется страница Яндекса, введи его там:';
      $('lmCode').textContent = s.user_code;
      lmCountdown();
      var r = await A.ymLoginBrowserWait();
      if (r && r.error && r.error !== 'вход отменён') alert('Вход в Яндекс: ' + r.error);
    } catch (e) {
      alert('Вход в Яндекс: ' + (e && e.message || e));
    } finally {
      loginBusy = false;
      closeLoginModal();
      refreshAcct();
    }
  }
  $('lmOpen').onclick = function(){ lmGo(); };
  $('lmInApp').onclick = function(){ A.ymLoginBrowserCancel(); closeLoginModal(); loginBusy = false; inAppLogin(); };
  $('lmCancel').onclick = function(){ A.ymLoginBrowserCancel(); closeLoginModal(); loginBusy = false; refreshAcct(); };
  acctBtn.addEventListener('click', async function(){
    if (acctBtn.dataset.in) {
      if (confirm('Выйти из аккаунта Яндекс Музыки?')) { await A.ymLogout(); refreshAcct(); }
      return;
    }
    browserLogin();
  });

  acctBtnYt.addEventListener('click', function(){
    openYtDlg();
    ytAuthRefresh().then(refreshAcctYt);
  });
  refreshAcct();
initWidgetUi();
setInterval(function(){ pushWidget(false); }, 1500);
  refreshAcctYt();
  renderWaveUi();

  function plural(n){ n=n%100; if(n>=11&&n<=14)return'треков'; n=n%10; if(n===1)return'трек'; if(n>=2&&n<=4)return'трека'; return'треков'; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  // Масштаб интерфейса: кнопка открывает отдельное окно (не зависит от zoom и раскладки)
  (function(){
    var btn = document.getElementById('zoomBtn'), lbl = document.getElementById('zoomLbl');
    if (!btn) return;
    function paint(v){
      var pct = Math.round((Number(v) || 1) * 100);
      if (lbl) lbl.textContent = pct + '%';
      var l2 = document.getElementById('lookZoomLbl'); if (l2) l2.textContent = pct + '%';
      btn.title = 'Масштаб интерфейса: ' + pct + '%';
      document.documentElement.style.setProperty('--ui-zoom', String((Number(v) || 1)));
      try { localStorage.setItem('tapUiZoom', String(Number(v) || 1)); } catch (e) { console.warn('Тапёр: не сохранился масштаб', e); }
      if (A.setSetting) A.setSetting('uiZoom', Number(v) || 1);
    }
    function themePayload(){
      var cs = getComputedStyle(document.documentElement);
      var pick = function(n){ return (cs.getPropertyValue(n) || '').trim(); };
      var shell = document.querySelector('.app-shell');
      var navBtn = document.querySelector('nav button');
      return {
        bg: pick('--bg1'), bg0: pick('--bg00') || pick('--bg0'), bg2: pick('--bg3'), bg4: pick('--bg4'),
        line: pick('--ln'), tx: pick('--tx'), tx2: pick('--tx2'), ac: pick('--ac'), prit: pick('--prit'),
        font: getComputedStyle(document.body).fontFamily,
        baseFont: getComputedStyle(document.body).fontSize,
        pixel: /Press Start|Pixelify/i.test(getComputedStyle(document.body).fontFamily),
        // цвет подвала — им же красится само окно, чтобы по краям не было полоски другого цвета
        winBg: getComputedStyle(document.documentElement).backgroundColor,
        radiusPanel: shell ? getComputedStyle(shell).borderBottomLeftRadius : '0px',
        radiusCtl: navBtn ? getComputedStyle(navBtn).borderTopLeftRadius : '0px'
      };
    }
    var syncT = null;
    function syncTheme(){
      clearTimeout(syncT);
      syncT = setTimeout(function(){ if (A.zoomTheme) A.zoomTheme(themePayload()); }, 80);
    }
    // скрытое окно масштаба — часть интерфейса: держим его тему в актуальном состоянии
    try {
      new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
    } catch (e) {}
    setTimeout(syncTheme, 200);
    if (A.onUiZoom) A.onUiZoom(function(v){ if (v) paint(v); });
    if (A.getSetting) A.getSetting('uiZoom').then(function(z){ if (z) paint(z); });
    btn.onclick = function(){
      var r = btn.getBoundingClientRect();
      if (A.zoomPopup) A.zoomPopup({ right: r.right, bottom: r.bottom, theme: themePayload() });
    };
  })();


  // Перемотка: подсказка идёт за курсором (отдельный элемент, не мешает общим)
  (function(){
    var seek = document.getElementById('seek'); if (!seek) return;
    var tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip);
    tip.textContent = seek.getAttribute('data-seek-tip') || 'Перемотка';
    var timer = null, vis = false, mx = 0, my = 0;
    function pos(){
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var x = mx + 12, y = my + 18;
      if (x + tw > window.innerWidth - 8) x = mx - tw - 12;
      if (y + th > window.innerHeight - 8) y = my - th - 12;
      tip.style.left = Math.round(Math.max(8, x)) + 'px';
      tip.style.top = Math.round(Math.max(8, y)) + 'px';
    }
    function hideSeek(){ clearTimeout(timer); timer = null; vis = false; tip.classList.remove('on'); }
    document.addEventListener('pointermove', function(e){
      mx = e.clientX; my = e.clientY;
      var r = seek.getBoundingClientRect();
      var inside = mx >= r.left && mx <= r.right && my >= r.top - 4 && my <= r.bottom + 4;
      if (inside) {
        if (!vis && !timer) timer = setTimeout(function(){ vis = true; tip.classList.add('on'); pos(); }, 600);
        if (vis) pos();
      } else if (vis || timer) { hideSeek(); }
    }, true);
    document.addEventListener('pointerdown', hideSeek, true);
    window.addEventListener('blur', hideSeek);
  })();
  // Единые подсказки: title → data-tip, показ одним fixed-элементом с задержкой
  (function(){
    var tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl);
    var timer = null, cur = null, mx = 0, my = 0;
    function conv(root){
      if (!root.querySelectorAll) return;
      var list = root.querySelectorAll('[title]');
      for (var i = 0; i < list.length; i++) {
        var el = list[i], t = el.getAttribute('title');
        if (t) el.setAttribute('data-tip', t); // новый title всегда свежее прежней подсказки
        el.removeAttribute('title');
      }
    }
    function place(el){
      var tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
      var x, y;
      if (el.hasAttribute('data-tip-follow')) {
        // подсказка идёт за курсором (перемотка)
        x = mx + 12; y = my + 18;
        if (x + tw > window.innerWidth - 8) x = mx - tw - 12;
        if (y + th > window.innerHeight - 8) y = my - th - 12;
      } else {
        var r = el.getBoundingClientRect();
        x = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
        y = r.bottom + 8;
        if (y + th > window.innerHeight - 8) y = r.top - th - 8;
      }
      tipEl.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - tw - 8, x))) + 'px';
      tipEl.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - th - 8, y))) + 'px';
    }
    function show(el){
      var t = el.getAttribute('data-tip'); if (!t) return;
      tipEl.textContent = t;
      tipEl.classList.add('on');
      place(el);
    }
    function hide(){
      if (timer) { clearTimeout(timer); timer = null; }
      cur = null;
      tipEl.classList.remove('on');
    }
    document.addEventListener('pointermove', function(e){ mx = e.clientX; my = e.clientY; if (cur && tipEl.classList.contains('on') && cur.hasAttribute('data-tip-follow')) place(cur); }, true);
    document.addEventListener('pointerover', function(e){
      var el = e.target && e.target.closest && e.target.closest('[data-tip],[title]');
      mx = e.clientX; my = e.clientY;
      if (!el) { hide(); return; }
      var t = el.getAttribute('title');
      if (t) el.setAttribute('data-tip', t);
      if (el.hasAttribute('title')) el.removeAttribute('title');
      if (el === cur) return;
      hide();
      cur = el;
      timer = setTimeout(function(){ if (cur === el) show(el); }, 600);
    }, true);
    document.addEventListener('pointerout', function(e){
      var el = e.target && e.target.closest && e.target.closest('[data-tip]');
      if (!el) return;
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      if (el === cur) hide();
    }, true);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') hide(); });
    conv(document);
    try {
      new MutationObserver(function(muts){
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes') {
            var el = m.target, t = el.getAttribute && el.getAttribute('title');
            if (t) { el.setAttribute('data-tip', t); el.removeAttribute('title'); }
          } else if (m.type === 'childList') {
            for (var j2 = 0; j2 < m.addedNodes.length; j2++) if (m.addedNodes[j2].nodeType === 1) conv(m.addedNodes[j2]);
          }
        }
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    } catch (e) {}
  })();
