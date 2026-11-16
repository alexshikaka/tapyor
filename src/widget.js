// Скрипт панели OBS (src/widget.html). Вынесен из страницы в 0.35.x (L7, аудит 0.32.0):
// CSP виджета запрещает встроенные скрипты ('unsafe-inline' убран). Поведение панели не менялось.

(function(){
  var feedEl = document.getElementById('feed');
  var cntEl = document.getElementById('cnt');
  var npEl = document.getElementById('np');
  var tmEl = document.getElementById('tm');
  var ppEl = document.getElementById('pp');
  var tgEl = document.getElementById('exactTg');
  var connEl = document.getElementById('conn');
  var connText = document.getElementById('connText');
  var fltEl = document.getElementById('flt');
  // Фильтр ленты: своё значение у панели (хранится в OBS), карточки несут data-kind.
  var flt = (function(){ try { var v = localStorage.getItem('dockFeedSrc'); return /^(all|don|chat|pts)$/.test(v || '') ? v : 'all'; } catch (e) { return 'all'; } })();
  function applyFilter(){
    var cards = feedEl.querySelectorAll('.rq[data-kind]');
    var n = { all: cards.length, don: 0, chat: 0, pts: 0 }, shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var k = cards[i].getAttribute('data-kind');
      if (n[k] != null) n[k]++;
      var off = flt !== 'all' && k !== flt;
      cards[i].classList.toggle('flt-off', off);
      if (!off) shown++;
    }
    if (!fltEl) return;
    var bs = fltEl.querySelectorAll('[data-f]');
    for (var j = 0; j < bs.length; j++) {
      var f = bs[j].getAttribute('data-f');
      bs[j].classList.toggle('on', f === flt);
      bs[j].setAttribute('aria-pressed', f === flt ? 'true' : 'false');
      var sp = bs[j].querySelector('span'); if (sp) sp.textContent = n[f];
    }
    var em = feedEl.querySelector('.dock-flt-empty');
    if (cards.length && !shown && !em) { em = document.createElement('div'); em.className = 'dock-empty dock-flt-empty'; em.textContent = 'Таких сообщений нет'; feedEl.appendChild(em); }
    else if (em && (shown || !cards.length)) em.parentNode.removeChild(em);
  }
  if (fltEl) fltEl.addEventListener('click', function(e){
    var b = e.target.closest('[data-f]'); if (!b) return;
    flt = b.getAttribute('data-f');
    try { localStorage.setItem('dockFeedSrc', flt); } catch (er) {}
    applyFilter();
  });
  var stickBottom = true;
  var lastHtml = '';

  function fmt(t){ t = Math.max(0, Math.round(t || 0)); var m = Math.floor(t / 60), s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }

  function applySkin(st){
    if (!st) return;
    // те же классы темы и оболочки, что в приложении
    document.documentElement.className = st.dockClass != null ? st.dockClass : (st.htmlClass || '');
    document.documentElement.setAttribute('style', st.dockStyle != null ? st.dockStyle : (st.htmlStyle || ''));
    if (st.scale) document.documentElement.style.zoom = (Math.max(50, Math.min(200, st.scale)) / 100);
  }

  function render(st){
    if (!st) return;
    applySkin(st);

    tgEl.classList.toggle('on', !!st.reqAuto);
    tgEl.setAttribute('aria-pressed', st.reqAuto ? 'true' : 'false');

    var html = st.feedHtml || '';
    cntEl.textContent = (st.msgCount || 0) + ' сообщ.';
    if (html !== lastHtml) {
      var nearBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 60;
      if (nearBottom) stickBottom = true;
      lastHtml = html;
      feedEl.innerHTML = html || '<div class="dock-empty">Сообщений пока нет</div>';
      applyFilter();
      if (st.newOnTop) feedEl.scrollTop = 0;
      else if (stickBottom) feedEl.scrollTop = feedEl.scrollHeight;
    }

    var playing = st.np && st.np.playing;
    ppEl.innerHTML = playing
      ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z"/></svg>';
    npEl.innerHTML = st.np && st.np.title
      ? '<b>' + esc(st.np.title) + '</b>' + (st.np.artist ? ' · ' + esc(st.np.artist) : '')
      : 'ничего не играет';
    tmEl.textContent = fmt(st.np && st.np.pos);
  }

  feedEl.addEventListener('scroll', function(){
    stickBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 60;
  });

  // Кнопки карточек работают как в приложении: передаём нажатие в приложение
  feedEl.addEventListener('click', function(e){
    var btn = e.target.closest('[data-rq]');
    if (!btn) return;
    e.preventDefault();
    var dataset = {};
    for (var k in btn.dataset) if (btn.dataset[k] != null) dataset[k] = btn.dataset[k];
    // Поиск и настройки показывают окно плеера, остальные кнопки его не трогают
    var opensWindow = ["find", "textfind", "settings"].indexOf(dataset.rq) >= 0;
    fetch('/widget/rq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset: dataset, focus: opensWindow })
    }).catch(function(){});
  });

  function cmd(action){
    fetch('/widget/cmd/' + encodeURIComponent(action), { method: 'POST' }).catch(function(){});
  }
  document.querySelectorAll('[data-cmd]').forEach(function(b){
    b.addEventListener('click', function(){ cmd(b.dataset.cmd); });
  });

  tgEl.addEventListener('click', function(){
    var on = !tgEl.classList.contains('on');
    tgEl.classList.toggle('on', on);
    fetch('/widget/setting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'reqAuto', value: on })
    }).catch(function(){});
  });

  // ── Статус связи: зелёный «Подключён», красный «Отключён»
  var connected = null;
  var lastAlive = Date.now();

  function setConn(on){
    if (connected === on) return;
    connected = on;
    if (connEl) connEl.classList.toggle('on', on);
    if (connText) connText.textContent = on ? 'Подключён' : 'Отключён';
    if (!on) feedEl.innerHTML = '<div class="dock-empty">Нет связи с Тапёром.<br>Проверь, что программа запущена.</div>';
  }

  var es = new EventSource('/widget/events');
  es.onopen = function(){ lastAlive = Date.now(); setConn(true); };
  es.onerror = function(){ setConn(false); };
  es.onmessage = function(e){
    lastAlive = Date.now();
    setConn(true);
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg && msg.hb) return;
    render(msg);
  };

  // Если сигналов нет дольше 10 секунд — считаем, что Тапёр закрылся
  setInterval(function(){ if (Date.now() - lastAlive > 10000) setConn(false); }, 2000);

  fetch('/widget/state').then(function(r){ return r.json(); }).then(function(st){ lastAlive = Date.now(); setConn(true); render(st); }).catch(function(){ setConn(false); });
})();
