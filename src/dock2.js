// Скрипт второй док-панели OBS — «Пульт плейлиста» (src/dock2.html, docs/DOCK2.md).
// Ничего не знает о внутренностях окна: рисует снимок и шлёт команды POST /dock2/cmd.

(function () {
  'use strict';

  var listEl = document.getElementById('d2list');
  var afterEl = document.getElementById('d2after');
  var qEl = document.getElementById('d2q');
  var findEl = document.getElementById('d2find');
  var connEl = document.getElementById('d2conn');
  var connText = document.getElementById('d2connText');
  var npEl = document.getElementById('d2np');
  var tmEl = document.getElementById('d2time');
  var ppEl = document.getElementById('d2pp');
  var logoEl = document.getElementById('d2logo');

  var state = null;
  var connected = null;
  var lastAlive = Date.now();

  var searchTimer = null;
  var lastSearchId = '';
  var searchItems = [];
  var searchDone = false;
  var activeIdx = -1;
  var findOpen = false;

  var dragI = -1;
  var dragKey = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(t) {
    t = Math.max(0, Math.round(Number(t) || 0));
    var m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function plural(n, forms) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  // Обложка: только безопасные адреса. Свои файлы — /lcover/…, площадки — https.
  function safeThumb(u) {
    var s = String(u == null ? '' : u);
    if (!s) return '';
    return /^(https?:\/\/|data:image\/|blob:|\/(?!\/))/.test(s) ? s : '';
  }

  function coverHtml(thumb) {
    var s = safeThumb(thumb);
    return '<span class="d2-cov">' + (s ? '<img src="' + esc(s) + '" alt="" loading="lazy">' : '') + '</span>';
  }

  function reqLabel(req) {
    if (!req) return '';
    var who = req.who ? String(req.who) : '';
    if (req.kind === 'cmd') return 'Твич' + (who ? ' · ' + who : '');
    if (req.kind === 'pts') return 'Баллы' + (who ? ' · ' + who : '');
    if (req.kind === 'sb') return 'Streamer.bot' + (who ? ' · ' + who : '');
    return 'Донат' + (who ? ' · ' + who : '');
  }

  function post(cmd) {
    try {
      window.fetch('/dock2/cmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd)
      }).catch(function () {});
    } catch (e) { /* запрос не ушёл — панель просто останется как была */ }
  }

  // Оформление — ровно как у первой панели: классы и переменные темы на <html>.
  function applySkin(look) {
    if (!look || typeof look !== 'object') return;
    var root = document.documentElement;
    root.className = look.cls != null ? String(look.cls) : '';
    root.setAttribute('style', look.style != null ? String(look.style) : '');
    var scale = Number(look.scale);
    if (!scale) scale = 100;
    root.style.zoom = Math.max(50, Math.min(200, scale)) / 100;
  }

  function setConn(on) {
    if (connected === on) return;
    connected = on;
    if (connEl) connEl.classList.toggle('on', on);
    if (connText) connText.textContent = on ? 'Подключён' : 'Отключён';
  }

  // ── Очередь ──────────────────────────────────────────────────────────────
  function rowActions(it) {
    var html = '';
    if (it.canNext) {
      html += '<button type="button" class="d2-nx" data-act="next" title="Играть следующим" aria-label="Играть следующим">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M5 4h14M12 20V9M7 13l5-5 5 5"></path></svg></button>';
    }
    if (it.ban) {
      html += '<button type="button" class="d2-ban" data-act="ban" title="Убрать и закрыть заказы зрителю" aria-label="Убрать и закрыть заказы зрителю">⛔</button>';
    }
    html += '<button type="button" class="d2-x" data-act="remove" title="Убрать" aria-label="Убрать">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M6 6l12 12M18 6L6 18"></path></svg></button>';
    return html;
  }

  function rowClass(it) {
    var cls = 'd2-row';
    if (it.st === 'playing') cls += ' playing';
    else if (it.st === 'done') cls += ' done';
    else if (it.st === 'pend') cls += ' pend';
    if (it.bg) cls += ' bg';
    if (it.req) {
      cls += ' req';
      if (it.req.kind === 'cmd') cls += ' req-cmd';
      else if (it.req.kind === 'pts') cls += ' req-pts';
    }
    return cls;
  }

  function subText(it) {
    var parts = [];
    if (it.artist) parts.push(String(it.artist));
    var meta = [];
    if (it.srcName) meta.push(String(it.srcName));
    if (it.bg) meta.push('фон');
    if (meta.length) parts.push(meta.join(' · '));
    return parts.join(' · ');
  }
  // Кто заказал — отдельной строкой: в конце подписи ник обрезался многоточием в узкой панели (16.11)
  function whoHtml(it) {
    return it.req ? '<span class="d2-who">' + esc(reqLabel(it.req)) + '</span>' : '';
  }

  function rowHtml(it, index) {
    var i = Number.isInteger(it.i) ? it.i : index;
    return '<div class="' + rowClass(it) + '" data-i="' + i + '" data-key="' + esc(it.key || '') + '" data-len="1" draggable="true">' +
      coverHtml(it.thumb) +
      '<span class="d2-body">' +
        '<span class="d2-title">' + esc(it.title) + '</span>' +
        '<span class="d2-sub">' + esc(subText(it)) + '</span>' + whoHtml(it) +
      '</span>' +
      '<span class="d2-acts">' + rowActions(it) + '</span>' +
      '<span class="d2-dur">' + esc(it.dur) + '</span>' +
    '</div>';
  }

  // Книга: одна строка-блок, название первой главы + число глав; действия — по первой главе.
  function bookHtml(first, group, index) {
    var i = Number.isInteger(first.i) ? first.i : index;
    var cls = rowClass(first) + ' d2-book';
    if (group.some(function (x) { return x && x.st === 'playing'; })) cls += ' playing';
    var n = group.length;
    var title = first.title;
    return '<div class="' + cls + '" data-i="' + i + '" data-key="' + esc(first.key || '') + '" data-len="' + n + '" draggable="false">' +
      coverHtml(first.thumb) +
      '<span class="d2-body">' +
        '<span class="d2-title">' + esc(title) + '</span>' +
        '<span class="d2-sub">' + esc(subText(first)) + '</span>' + whoHtml(first) +
      '</span>' +
      '<span class="d2-book-badge">' + n + ' ' + plural(n, ['глава', 'главы', 'глав']) + '</span>' +
      '<span class="d2-acts">' + rowActions(first) + '</span>' +
    '</div>';
  }

  function renderList(st) {
    var items = Array.isArray(st.items) ? st.items : [];
    var html = '';
    for (var i = 0; i < items.length;) {
      var it = items[i] || {};
      if (it.book) {
        var j = i;
        while (j < items.length && items[j] && items[j].book === it.book) j++;
        html += bookHtml(it, items.slice(i, j), i);
        i = j;
      } else {
        html += rowHtml(it, i);
        i++;
      }
    }
    if (!html) html = '<div class="d2-empty">' + (st.mode === 'live' ? 'Живая очередь пуста' : 'Плейлист пуст') + '</div>';
    listEl.innerHTML = html;
  }

  function renderAfter(st) {
    var after = Array.isArray(st.after) ? st.after : [];
    if (st.mode !== 'live' || !after.length) {
      afterEl.hidden = true;
      afterEl.innerHTML = '';
      return;
    }
    var html = '<div class="d2-after-t">Дальше в волне</div>';
    after.slice(0, 10).forEach(function (t, j) {
      t = t || {};
      // нажатие — включить этот трек волны (как в окне Тапёра)
      html += '<div class="d2-ar" data-wj="' + j + '" data-wkey="' + esc(t.key || '') + '" title="Включить">' + coverHtml(t.thumb) +
        '<span class="d2-arm">' +
          '<span class="d2-art">' + esc(t.title) + '</span>' +
          '<span class="d2-ars">' + esc(t.artist) + '</span>' +
        '</span>' +
      '</div>';
    });
    afterEl.innerHTML = html;
    afterEl.hidden = false;
  }
  afterEl.addEventListener('click', function (e) {
    var r = e.target.closest('.d2-ar[data-wj]'); if (!r) return;
    post({ c: 'waveat', j: Number(r.getAttribute('data-wj')), key: r.getAttribute('data-wkey') || '' });
  });

  function renderBar(st) {
    var np = st.np || {};
    var playing = !!np.playing;
    ppEl.innerHTML = playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l12 7-12 7z"></path></svg>';
    npEl.innerHTML = np.title
      ? '<b>' + esc(np.title) + '</b>' + (np.artist ? ' · ' + esc(np.artist) : '')
      : 'ничего не играет';
    updateTime();
  }

  function updateTime() {
    var st = state;
    if (!st || !st.np) { tmEl.textContent = '0:00'; return; }
    var np = st.np;
    var pos = Number(np.pos) || 0;
    if (np.playing) pos += (Date.now() - (Number(st.at) || Date.now())) / 1000;
    var dur = Number(np.dur) || 0;
    tmEl.textContent = fmt(pos) + (dur ? ' / ' + fmt(dur) : '');
  }

  function render(st) {
    if (!st || st.v !== 1) return;
    state = st;
    applySkin(st.look);
    renderList(st);
    renderAfter(st);
    renderBar(st);
  }

  // ── Поиск для панели ─────────────────────────────────────────────────────
  function newId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function openFind() {
    findOpen = true;
    findEl.hidden = false;
  }

  function closeFind() {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    findOpen = false;
    findEl.hidden = true;
    findEl.innerHTML = '';
    searchItems = [];
    searchDone = false;
    activeIdx = -1;
    lastSearchId = '';
  }

  function findRow(t, idx) {
    t = t || {};
    return '<div class="d2-fr' + (idx === activeIdx ? ' act' : '') + '" data-r="' + esc(t.r || '') + '" data-idx="' + idx + '">' +
      coverHtml(t.thumb) +
      '<span class="d2-fm">' +
        '<span class="d2-ft">' + esc(t.title) + '</span>' +
        '<span class="d2-fs">' + esc([t.artist, t.srcName, t.dur].filter(Boolean).join(' · ')) + '</span>' +
      '</span>' +
      '<button type="button" class="d2-fp" data-fa="playnow" title="Играть сейчас" aria-label="Играть сейчас">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l12 7-12 7z"></path></svg></button>' +
      '<button type="button" class="d2-fa" data-fa="add" title="В очередь">+ В очередь</button>' +
    '</div>';
  }

  function renderFind() {
    if (!findOpen) return;
    if (!searchItems.length) {
      findEl.innerHTML = '<div class="d2-empty">' + (searchDone ? 'Ничего не нашлось' : 'Ищу…') + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < searchItems.length; i++) html += findRow(searchItems[i], i);
    findEl.innerHTML = html;
    var act = findEl.querySelector('.d2-fr.act');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
  }

  function onSearchEvent(ev) {
    if (!ev || ev.id !== lastSearchId) return; // выдача старого запроса — мимо
    searchItems = Array.isArray(ev.items) ? ev.items : [];
    searchDone = !!ev.done;
    if (!searchItems.length) activeIdx = -1;
    else if (activeIdx < 0 || activeIdx >= searchItems.length) activeIdx = 0;
    if (qEl.value.trim()) openFind();
    renderFind();
  }

  function moveActive(d) {
    if (!searchItems.length) return;
    activeIdx = (activeIdx + d + searchItems.length) % searchItems.length;
    renderFind();
  }

  qEl.addEventListener('input', function () {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    var q = qEl.value;
    searchTimer = setTimeout(function () {
      searchTimer = null;
      if (!q.trim()) { closeFind(); return; }
      var id = newId();
      lastSearchId = id;
      searchItems = [];
      searchDone = false;
      activeIdx = -1;
      openFind();
      findEl.innerHTML = '<div class="d2-empty">Ищу…</div>';
      post({ c: 'search', q: q, id: id });
    }, 300);
  });

  qEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeFind(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); return; }
    if (e.key === 'Enter') {
      if (!searchItems.length || activeIdx < 0) return;
      e.preventDefault();
      post({ c: 'playnow', r: searchItems[activeIdx].r });
    }
  });

  findEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-fa]');
    var row = e.target.closest('.d2-fr');
    if (!row) return;
    var r = row.getAttribute('data-r');
    if (btn) { post({ c: btn.getAttribute('data-fa'), r: r }); return; }
    post({ c: 'playnow', r: r });
  });

  document.addEventListener('click', function (e) {
    if (!findOpen) return;
    if (e.target.closest && (e.target.closest('#d2find') || e.target.closest('#d2q'))) return;
    closeFind();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && findOpen) closeFind();
  });

  // ── Кнопки очереди ───────────────────────────────────────────────────────
  listEl.addEventListener('click', function (e) {
    var row = e.target.closest('.d2-row');
    if (!row) return;
    var i = parseInt(row.getAttribute('data-i'), 10);
    var key = row.getAttribute('data-key') || '';
    if (!Number.isFinite(i)) return;
    var act = e.target.closest('[data-act]');
    if (act) {
      var action = act.getAttribute('data-act');
      if (action === 'remove' || action === 'ban' || action === 'next') post({ c: action, i: i, key: key });
      return;
    }
    if (e.target.closest('.d2-cov') || e.target.closest('.d2-title')) post({ c: 'play', i: i, key: key });
  });

  // ── Перетаскивание строк (HTML5 drag&drop) ───────────────────────────────
  function clearDrop() {
    var ms = listEl.querySelectorAll('.drop-before, .drop-after');
    for (var k = 0; k < ms.length; k++) ms[k].classList.remove('drop-before', 'drop-after');
  }

  function clearDrag() {
    dragI = -1;
    dragKey = '';
    clearDrop();
    var d = listEl.querySelector('.dragging');
    if (d) d.classList.remove('dragging');
  }

  listEl.addEventListener('dragstart', function (e) {
    var row = e.target.closest('.d2-row');
    if (!row || row.classList.contains('d2-book')) { e.preventDefault(); return; }
    var i = parseInt(row.getAttribute('data-i'), 10);
    if (!Number.isFinite(i)) { e.preventDefault(); return; }
    dragI = i;
    dragKey = row.getAttribute('data-key') || '';
    row.classList.add('dragging');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragI));
    } catch (x) { /* синтетическое событие без dataTransfer */ }
  });

  listEl.addEventListener('dragover', function (e) {
    if (dragI < 0) return;
    var row = e.target.closest('.d2-row');
    if (!row) return;
    e.preventDefault();
    var rc = row.getBoundingClientRect();
    var after = e.clientY > rc.top + rc.height / 2;
    clearDrop();
    row.classList.add(after ? 'drop-after' : 'drop-before');
    try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
  });

  listEl.addEventListener('drop', function (e) {
    if (dragI < 0) return;
    var row = e.target.closest('.d2-row');
    if (!row) return;
    e.preventDefault();
    var after = row.classList.contains('drop-after');
    var base = parseInt(row.getAttribute('data-i'), 10);
    var len = parseInt(row.getAttribute('data-len'), 10) || 1;
    if (Number.isFinite(base)) post({ c: 'move', i: dragI, key: dragKey, to: base + (after ? len : 0) });
    clearDrag();
  });

  listEl.addEventListener('dragend', clearDrag);

  // ── Остальные кнопки ─────────────────────────────────────────────────────
  var cmdButtons = document.querySelectorAll('.d2-bar [data-cmd]');
  for (var ci = 0; ci < cmdButtons.length; ci++) {
    (function (b) {
      b.addEventListener('click', function () { post({ c: 'tr', a: b.getAttribute('data-cmd') }); });
    })(cmdButtons[ci]);
  }

  logoEl.addEventListener('click', function () { post({ c: 'focus' }); });

  // ── Связь с Тапёром ─────────────────────────────────────────────────────
  function onMessage(e) {
    lastAlive = Date.now();
    setConn(true);
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || msg.hb) return;
    if (msg.ev === 'search') { onSearchEvent(msg); return; }
    if (msg.ev === 'toast') return; // короткие сообщения окна пульту пока не нужны
    render(msg);
  }

  var es = new EventSource('/dock2/events');
  es.onopen = function () { lastAlive = Date.now(); setConn(true); };
  es.onerror = function () { setConn(false); };
  es.onmessage = onMessage;

  // Если сигналов нет дольше 10 секунд — считаем, что Тапёр закрылся
  setInterval(function () { if (Date.now() - lastAlive > 10000) setConn(false); }, 2000);

  window.fetch('/dock2/state').then(function (r) { return r.json(); }).then(function (st) {
    if (!st || st.v !== 1) return;
    lastAlive = Date.now();
    setConn(true);
    render(st);
  }).catch(function () { setConn(false); });

  // Время в подвале: позиция из снимка + прошедшее с ним, пока играет.
  setInterval(function () { if (!document.hidden) updateTime(); }, 1000);
})();
