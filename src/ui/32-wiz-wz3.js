// WZ3 (14.11.2026): справка «Живая очередь» в главном окне, «?» у переключателя режима
// очереди, первый показ при переключении и ответы шагам слушателя (вход в Яндекс, очередь).
// Цвета — только переменные темы; диалог собран готовыми классами (.modal, .mbox, .yl-x,
// .yl-btn). Пункты справки — src/wizard/steps/livehelp.js (window.TapLiveHelp).
'use strict';

  var wz3App = window.app || {};
  var WZ3_HELP = null;
  var WZ3_SEEN = { ready: false, value: false, wait: [] };

  function wz3Esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function wz3IsStreamer() {
    return typeof streamerOn === 'undefined' ? true : streamerOn !== false;
  }

  // ── Мини-схемы пунктов (по макету LiveHelp.dc.html) ─────────────────────────
  function wz3Lbl(t) { return '<div class="lh-lbl">' + wz3Esc(t) + '</div>'; }
  function wz3Bar(t, c) { return '<div class="lh-bar' + (c ? ' ' + c : '') + '">' + wz3Esc(t) + '</div>'; }
  function wz3Arrow(dir, text) {
    var d = dir === 'up' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7';
    return '<div class="lh-arrow">' + (dir === 'down' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="' + d + '"></path></svg>' : '')
      + '<span>' + wz3Esc(text) + '</span>'
      + (dir === 'up' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="' + d + '"></path></svg>' : '')
      + '</div>';
  }
  function wz3Dia(it) {
    if (it.kind === 'layers') {
      return wz3Lbl('Очередь')
        + wz3Bar('▶ Группа крови', 'cur') + wz3Bar('Выхода нет') + wz3Bar('Искала')
        + wz3Lbl('Дальше в волне · фон') + wz3Bar('∿ Моя волна', 'bg') + wz3Bar('∿ Моя волна', 'bg');
    }
    if (it.kind === 'order') {
      return wz3Bar('✓ Кукушка', 'done') + wz3Bar('✓ Группа крови', 'done')
        + wz3Arrow('up', 'сыгранное уезжает вверх')
        + wz3Bar('▶ Выхода нет', 'cur') + wz3Bar('Искала') + wz3Bar('＋ новый трек', 'new');
    }
    if (it.kind === 'after') {
      return wz3Bar('✓ Искала', 'done') + wz3Arrow('down', 'очередь кончилась')
        + wz3Bar('▶ ∿ трек из волны', 'wavecur') + wz3Bar('∿ ещё из волны', 'bg') + wz3Bar('∿ и ещё…', 'bg');
    }
    if (it.kind === 'bg') {
      return '<div class="lh-mini"><div class="lh-mini-t">Хиты всех времён</div>'
        + '<div class="lh-mini-s">плейлист · 30 песен</div>'
        + '<div class="lh-mini-b"><span class="lh-pill acc">▶ Играть фоном</span><span class="lh-pill">Вперемешку</span></div></div>'
        + '<div class="lh-mini-note">станет фоном вместо волны — очередь цела</div>';
    }
    return '';
  }
  function wz3Rows(items) {
    return (items || []).map(function (it) {
      if (it.kind === 'streamer') {
        return '<div class="lh-row lh-streamer"><span class="lh-dot" aria-hidden="true"></span>'
          + '<span><b>Только у стримера:</b> ' + wz3Esc(it.text) + '</span></div>';
      }
      return '<div class="lh-row" data-n="' + it.n + '">'
        + '<div class="lh-dia">' + wz3Dia(it) + '</div>'
        + '<div class="lh-txt"><div class="lh-n">' + it.n + '</div><h3>' + wz3Esc(it.title) + '</h3>'
        + '<p>' + wz3Esc(it.text) + '</p></div></div>';
    }).join('');
  }

  // ── Окно справки ────────────────────────────────────────────────────────────
  function wz3HelpKey(e) {
    if (e && e.key === 'Escape') wz3CloseHelp('esc');
  }
  function wz3MarkSeen() {
    if (WZ3_SEEN.value) return;
    WZ3_SEEN.value = true;
    if (wz3App.setSetting) wz3App.setSetting('liveHelpSeen', true);
  }
  function wz3WhenSeen(fn) {
    if (WZ3_SEEN.ready) { fn(); return; }
    WZ3_SEEN.wait.push(fn);
  }
  // Справка «прикреплена» к переключателю режима (шаг визарда стримера, 15.11.2026): стоит слева от
  // колонки очереди, стрелка показывает на подсвеченный переключатель. Узкое окно — обычный диалог.
  var WZ3_ANCHOR = false;
  function wz3Place() {
    var ov = WZ3_HELP; if (!ov || ov.hidden || !WZ3_ANCHOR) return;
    var dlg = ov.querySelector('.lh-dlg'), tip = ov.querySelector('.lh-tip'), hole = ov.querySelector('.lh-hole');
    var qm = document.getElementById('qMode'), col = document.querySelector('.queue-col');
    var r = qm && qm.getBoundingClientRect(), c = col && col.getBoundingClientRect();
    var w = c ? Math.min(600, c.left - 40) : 0;
    var fits = !!(r && c && r.width && w >= 380);
    ov.classList.toggle('lh-anchored', fits);
    if (!fits) { dlg.style.cssText = ''; if (tip) tip.hidden = true; if (hole) hole.hidden = true; return; }
    // Затемнено всё, кроме справки и колонки очереди: «окно» в затемнении над очередью (16.11)
    if (hole) {
      hole.hidden = false;
      var rad = getComputedStyle(col).borderTopLeftRadius || '0px';
      hole.style.cssText = 'left:' + Math.round(c.left) + 'px;top:' + Math.round(c.top) + 'px;width:' + Math.round(c.width) + 'px;height:' + Math.round(c.height) + 'px;border-radius:' + rad;
    }
    var top = Math.max(16, r.top - 18);
    dlg.style.cssText = 'left:' + Math.round(c.left - 18 - w) + 'px;top:' + Math.round(top) + 'px;width:' + Math.round(w) + 'px;max-height:' + Math.round(window.innerHeight - top - 16) + 'px';
    if (tip) { tip.hidden = false; tip.style.left = Math.round(c.left - 19) + 'px'; tip.style.top = Math.round(r.top + r.height / 2 - 9) + 'px'; }
  }
  window.addEventListener('resize', wz3Place);
  function openLiveHelp(opts) {
    WZ3_ANCHOR = !!(opts && opts.anchor);
    if (WZ3_HELP && WZ3_HELP.hidden === false) { wz3Place(); return; }
    var ov = WZ3_HELP;
    if (!ov) {
      ov = WZ3_HELP = document.createElement('div');
      ov.className = 'modal';
      ov.id = 'liveHelp';
      ov.hidden = true;
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-labelledby', 'lhTitle');
      ov.innerHTML = '<div class="mbox lh-dlg">'
        + '<div class="lh-head"><div class="lh-head-text">'
        // 16.11.2026 (слово владельца): сначала — что режимов два, ниже — подробно про живую очередь
        + '<div class="lh-kicker">Режимы плейлиста</div>'
        + '<h2 class="lh-title" id="lhTitle">Классический плейлист и живая очередь</h2>'
        + '<div class="lh-modes">'
        + '<div class="lh-mode"><b>Классический плейлист</b><span>Как в обычном плеере: треки стоят на месте, нажал — заиграл, дальше по порядку. Кончился список — тишина.</span></div>'
        + '<div class="lh-mode on"><b>Живая очередь</b><span>Сначала играет всё, что ты поставил, потом — фон: Моя волна или любой плейлист. Музыка не кончается.</span></div>'
        + '</div>'
        + '<div class="lh-where" hidden>Переключатель режимов — справа над очередью, он подсвечен.</div>'
        + '</div><button class="yl-x lh-x" type="button" aria-label="Закрыть справку" title="Закрыть">'
        + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>'
        + '</button></div>'
        + '<div class="lh-body" id="lhBody"></div>'
        + '<div class="lh-foot"><span class="lh-note">Справка снова — «?» у переключателя режимов</span>'
        + '<span class="lh-grow"></span>'
        + '<button class="yl-btn g" type="button" data-lh="classic">Вернуть классический</button>'
        + '<button class="yl-btn" type="button" data-lh="ok">Понятно</button>'
        + '</div></div>';
      var tipEl = document.createElement('div');
      tipEl.className = 'lh-tip'; tipEl.hidden = true; tipEl.setAttribute('aria-hidden', 'true');
      var holeEl = document.createElement('div');
      holeEl.className = 'lh-hole'; holeEl.hidden = true; holeEl.setAttribute('aria-hidden', 'true');
      ov.insertBefore(holeEl, ov.firstChild);
      ov.appendChild(tipEl);
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) wz3CloseHelp('overlay'); });
      ov.querySelector('[data-lh=ok]').onclick = function () { wz3CloseHelp('ok'); };
      ov.querySelector('[data-lh=classic]').onclick = function () {
        if (typeof isClassic === 'function' && !isClassic() && typeof setQueueMode === 'function') setQueueMode('classic');
        wz3CloseHelp('classic');
      };
      ov.querySelector('.lh-x').onclick = function () { wz3CloseHelp('x'); };
    }
    var body = ov.querySelector('#lhBody');
    var items = (window.TapLiveHelp && typeof window.TapLiveHelp.items === 'function')
      ? window.TapLiveHelp.items(wz3IsStreamer()) : [];
    body.innerHTML = items.length ? '<div class="lh-sec">Как работает живая очередь</div>' + wz3Rows(items) : '<p class="lh-lead">Справка не загрузилась — перезапусти Тапёр.</p>';
    body.scrollTop = 0;
    ov.querySelector('.lh-where').hidden = !WZ3_ANCHOR;
    ov.hidden = false;
    if (WZ3_ANCHOR) wz3Place(); else { ov.classList.remove('lh-anchored'); ov.querySelector('.lh-dlg').style.cssText = ''; ov.querySelector('.lh-tip').hidden = true; ov.querySelector('.lh-hole').hidden = true; }
    wz3MarkSeen();
    document.addEventListener('keydown', wz3HelpKey, true);
    try { ov.querySelector('[data-lh=ok]').focus(); } catch (e) {}
  }
  function wz3CloseHelp(reason) {
    if (!WZ3_HELP || WZ3_HELP.hidden) return;
    WZ3_HELP.hidden = true;
    document.removeEventListener('keydown', wz3HelpKey, true);
    if (typeof wizardEmit === 'function') wizardEmit({ type: 'livehelp', closed: true, reason: reason || '' });
    try {
      var b = document.querySelector('#qMode .qm-help');
      if (b) b.focus();
    } catch (e) {}
  }

  // Первый показ — при первом переключении на «Живую очередь» у слушателя. Стримеру
  // справка идёт шагом визарда (или по «?») — переключение режима ему не перекрываем.
  function wz3MaybeHelpOnSwitch() {
    if (wz3IsStreamer()) return;
    wz3WhenSeen(function () {
      if (WZ3_SEEN.value) return;
      // Ловим клик в фазе перехвата — режим переключится только после нас. Даём ему это сделать.
      setTimeout(function () {
        if (WZ3_SEEN.value) return;
        if (typeof isClassic === 'function' && isClassic()) return; // уже вернулись в классический
        openLiveHelp();
      }, 0);
    });
  }

  // Шаг «Очередь» и финал слушателя спрашивают главное окно о входе в Яндекс и очереди.
  function wz3ListenerState() {
    var n = 0;
    try { n = (typeof queue !== 'undefined' && queue && queue.length) ? queue.length : 0; } catch (e) {}
    var ym = false;
    try { ym = typeof ymLoggedIn !== 'undefined' && ymLoggedIn === true; } catch (e) {}
    if (typeof wizardEmit === 'function') wizardEmit({ type: 'listenerstate', ym: ym, queue: n });
  }

  // Настройки: показывали ли справку хоть раз (пишется сюда же, из окна).
  if (wz3App.getSetting) {
    wz3App.getSetting('liveHelpSeen').then(function (v) {
      WZ3_SEEN.ready = true;
      WZ3_SEEN.value = v === true || WZ3_SEEN.value;
      var w = WZ3_SEEN.wait;
      WZ3_SEEN.wait = [];
      w.forEach(function (fn) { try { fn(); } catch (e) {} });
    }).catch(function () {
      WZ3_SEEN.ready = true;
      var w = WZ3_SEEN.wait;
      WZ3_SEEN.wait = [];
      w.forEach(function (fn) { try { fn(); } catch (e) {} });
    });
  } else {
    WZ3_SEEN.ready = true;
  }

  // Действия шагов визарда (команда {op:'do', name, args}).
  wizardAction('openLiveHelp', function (a) { openLiveHelp({ anchor: !!(a && a.anchor) }); });
  wizardAction('closeLiveHelp', function () { wz3CloseHelp('wizard'); });
  wizardAction('listenerState', function () { wz3ListenerState(); });

  // «?» рядом с переключателем режима очереди и первый показ при переключении на живую.
  (function () {
    var qm = document.getElementById('qMode');
    if (!qm) return;
    var help = document.createElement('button');
    help.className = 'qm-help';
    help.type = 'button';
    help.textContent = '?';
    help.title = 'Что такое живая очередь';
    help.setAttribute('aria-label', 'Что такое живая очередь');
    help.onclick = function () { openLiveHelp(); };
    // «?» — справа от «Живая очередь» (владелец 15.11), а не между переключателем и текстом.
    qm.appendChild(help);

    qm.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var toLive = false;
      if (b.dataset && b.dataset.qm === 'live') toLive = true;
      else if (b.dataset && b.dataset.qm === 'classic') toLive = false;
      else if (b.id === 'qModeTg') toLive = typeof isClassic === 'function' && isClassic();
      if (toLive && typeof isClassic === 'function' && isClassic()) wz3MaybeHelpOnSwitch();
    }, true);
  })();
