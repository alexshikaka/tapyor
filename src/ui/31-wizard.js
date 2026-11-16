// Визард первого запуска в главном окне (14.11.2026): подсветка зоны, открытие вкладки,
// запись настроек и тема для окна визарда. Окно визарда немодальное — Тапёр работает как обычно.
// Все цвета — переменные темы. Подсветка переживает перерисовку: если элемент пересоздали,
// MutationObserver находит его заново по сохранённому селектору.
// Действия шагов: wizardAction('typeSearch', function (args) {...}) — в своей части интерфейса
// (src/ui/32-wiz-<задание>.js). Окно визарда вызывает их командой { op:'do', name, args }.
// Ответ визарду — wizardEmit({ type: 'played', ... }) → событие шага (api.on('played', fn)).
var WIZ_ACTIONS = {};
function wizardAction(name, fn) { WIZ_ACTIONS[name] = fn; }
function wizardEmit(evt) { try { (window.app || {}).wizardEvent(evt || {}); } catch (e) {} }
(function () {
  var A = window.app || {};
  var TABS = { search: 1, wave: 1, my: 1, req: 1, hist: 1, browser: 1, settings: 1, look: 1, books: 1 };
  var THEME_VARS = ['--bg00', '--bg0', '--bg1', '--bg2', '--bg3', '--bg4',
    '--ln', '--ln2', '--ln3',
    '--tx', '--tx2', '--tx3', '--tx4', '--tx5',
    '--ac', '--ac2', '--acr', '--acbg', '--pri', '--prit',
    '--ok', '--warn', /* состояния: зелёная/оранжевая лампочка чек-листа финала */
    '--hov', '--hov2', '--hov3',
    '--r-panel', '--r-card', '--r-ctl',
    '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--gutter'];
  var hl = { el: null, pos: null, tab: '', sel: '' };
  var wizardOpen = false;
  var themeTimer = null;
  var hlTimer = null;

  // Подсветка (16.11.2026, слово владельца): без затемнения — тонкая рамка акцентом по контуру элемента
  // ВНУТРЬ и мягкое свечение внутрь, пульсирует. Рамка не выходит за элемент, поэтому её не режут
  // прокручиваемые родители и она не наезжает на соседний интерфейс при прокрутке.
  // Обычный блок — слой ::after поверх содержимого (класс wiz-hl-ov; детям с фоном рамку не закрыть).
  // Поля ввода, картинки и элементы со своим ::after — тенью внутрь у самого элемента (wiz-hl).
  var HL_NO_PSEUDO = { INPUT: 1, TEXTAREA: 1, SELECT: 1, IMG: 1, VIDEO: 1, IFRAME: 1, CANVAS: 1 };
  function restoreStyles() {
    if (!hl.el) return;
    try {
      hl.el.classList.remove('wiz-hl', 'wiz-hl-ov', 'wiz-hl-sc');
      hl.el.removeAttribute('data-wiz-hl');
      if (hl.pos) hl.el.style.position = hl.pos.v;
    } catch (e) {}
    hl.el = null;
    hl.pos = null;
  }
  function clearHighlight() {
    hl.tab = '';
    hl.sel = '';
    clearTimeout(hlTimer);
    restoreStyles();
  }
  function applyHighlight(el) {
    // Переключатель сам цвета акцента — рамка на нём теряется; подсвечиваем всю строку настройки
    if (el && el.classList && el.classList.contains('toggle') && el.closest) {
      var row = el.closest('.srow, .rq-exact, label');
      if (row) el = row;
    }
    if (!el || hl.el === el) return;
    restoreStyles();
    hl.el = el;
    var overlay = !HL_NO_PSEUDO[el.tagName];
    // Блок, который сам прокручивается (выдача поиска): слой ::after уехал бы вместе с содержимым —
    // рамку рисуем обводкой внутрь по краю самого блока, она стоит на месте (16.11).
    var scroller = false;
    try { var csx = getComputedStyle(el); scroller = /(auto|scroll)/.test(csx.overflowY + ' ' + csx.overflowX); } catch (e) {}
    if (scroller && overlay) { overlay = false; el.classList.add('wiz-hl-sc'); }
    if (overlay) {
      try {
        var after = getComputedStyle(el, '::after').content;
        if (after && after !== 'none' && after !== 'normal') overlay = false;   // свой ::after не трогаем
      } catch (e) {}
    }
    if (overlay) {
      try {
        if (getComputedStyle(el).position === 'static') { hl.pos = { v: el.style.position }; el.style.position = 'relative'; }
      } catch (e) {}
      el.classList.add('wiz-hl-ov');
    }
    el.classList.add('wiz-hl');
    el.setAttribute('data-wiz-hl', '');
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  }
  function findHighlighted() {
    if (!hl.sel) return;
    if (hl.tab && typeof curTab !== 'undefined' && curTab !== hl.tab) return;
    var el = null;
    try { el = document.querySelector(hl.sel); } catch (e) { return; }
    if (el) applyHighlight(el);
  }
  // Раздел Настроек: setTab('settings') без раздела открыл бы «О программе».
  var PANE_RE = /^s[A-Z][A-Za-z]{1,20}$/;
  function openTab(tab, pane) {
    if (!tab || !TABS[tab]) return;
    try {
      if (tab === 'settings' && typeof pane === 'string' && PANE_RE.test(pane)) setTab('settings', pane);
      else setTab(tab);
    } catch (e) {}
  }
  var missTimer = null;
  function highlight(tab, sel, pane) {
    clearHighlight();
    if (tab && TABS[tab]) {
      // Уже открыт нужный раздел — не дёргаем вкладку (перерисовка сбросила бы ввод).
      var same = typeof curTab !== 'undefined' && curTab === tab
        && (tab !== 'settings' || !pane || !document.getElementById(pane) || !document.getElementById(pane).hidden);
      if (!same) openTab(tab, pane);
      hl.tab = tab;
    }
    hl.sel = typeof sel === 'string' ? sel : '';
    clearTimeout(missTimer);
    if (!hl.sel) return;
    clearTimeout(hlTimer);
    hlTimer = setTimeout(findHighlighted, 30);
    setTimeout(findHighlighted, 180);
    setTimeout(findHighlighted, 600);
    // Не нашли кнопку — говорим визарду: он подскажет, где искать самому.
    var want = hl.sel;
    missTimer = setTimeout(function () {
      if (hl.sel === want && !hl.el) wizardEmit({ type: 'hlMissing', sel: want });
    }, 1500);
  }

  // Человек нажал подсвеченную кнопку или заполнил подсвеченное поле в Тапёре — визард
  // отмечает задачу. Значения паролей и ключей не передаём: только «заполнено».
  function reportAct(e) {
    var el = hl.el;
    if (!el || !wizardOpen || !e.target || !el.contains(e.target)) return;
    var t = e.target;
    var tag = (t.tagName || '').toLowerCase();
    var field = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.type === 'click' && field && tag !== 'select') return; // клик в поле — ещё не ввод
    var evt = { type: 'hlAct', sel: hl.sel, kind: e.type };
    if (field) {
      var secret = t.type === 'password' || /key|tok|pass/i.test(t.id || '');
      var v = String(t.value || '');
      evt.filled = v.trim() !== '';
      if (!secret) evt.value = v.slice(0, 200);
    }
    wizardEmit(evt);
  }
  var actTimer = null;
  document.addEventListener('click', reportAct, true);
  document.addEventListener('change', reportAct, true);
  document.addEventListener('input', function (e) {
    clearTimeout(actTimer);
    actTimer = setTimeout(function () { reportAct(e); }, 350);
  }, true);

  // Перерисовка списка/выдачи: элемент заменён — подсвечиваем новый.
  try {
    new MutationObserver(function () {
      if (!hl.sel) return;
      clearTimeout(hlTimer);
      hlTimer = setTimeout(findHighlighted, 40);
    }).observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  // Развилка визарда поверх Тапёра: затемнение на всё окно, мышь не проходит (клавиши держит
  // главный процесс — окно выключено). Снимается после ответа или при закрытии визарда.
  var block = null;
  function blockUi(on) {
    if (!on) {
      if (block && block.parentNode) {
        var b = block; block = null;
        b.style.opacity = '0';
        setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 260);
      }
      return;
    }
    if (block) return;
    block = document.createElement('div');
    block.id = 'wizBlock';
    block.setAttribute('aria-hidden', 'true');
    block.style.cssText = 'position:fixed;inset:0;z-index:5000;opacity:0;transition:opacity .25s;'
      + 'background:color-mix(in srgb, var(--bg00) 72%, transparent);-webkit-app-region:no-drag';
    document.body.appendChild(block);
    requestAnimationFrame(function () { if (block) block.style.opacity = '1'; });
  }

  function setKey(key, value) {
    var k = String(key || '');
    if (!k) return;
    if (k === 'streamerMode' && typeof applyStreamer === 'function') applyStreamer(value !== false, false);
    if (k === 'queueMode' && typeof setQueueMode === 'function') {
      // setQueueMode сам сохраняет queueMode и перерисовывает очередь
      setQueueMode(value === 'live' ? 'live' : 'classic');
      return;
    }
    if (A.setSetting) A.setSetting(k, value);
  }

  function playBg() {
    var card = document.getElementById('wavecard');
    var btn = document.getElementById('wavePlay');
    if (!btn) return;
    // Уже идёт фон — второй щелчок его остановит; «включить» не должно выключать.
    if (card && card.classList.contains('on-air')) return;
    try { btn.click(); } catch (e) {}
  }

  function themePayload() {
    var cs = getComputedStyle(document.documentElement);
    var vars = {};
    THEME_VARS.forEach(function (n) { vars[n] = (cs.getPropertyValue(n) || '').trim(); });
    var body = getComputedStyle(document.body);
    return {
      vars: vars,
      className: document.documentElement.className,
      font: body.fontFamily,
      fontSize: body.fontSize
    };
  }
  function sendTheme() {
    if (!wizardOpen || !A.wizardTheme) return;
    clearTimeout(themeTimer);
    themeTimer = setTimeout(function () { try { A.wizardTheme(themePayload()); } catch (e) {} }, 60);
  }

  if (A.onWizardOpened) {
    A.onWizardOpened(function () {
      wizardOpen = true;
      sendTheme();
    });
  }
  if (A.onWizardClosed) {
    A.onWizardClosed(function () {
      wizardOpen = false;
      clearHighlight();
      blockUi(false);
    });
  }
  if (A.onWizardCmd) {
    A.onWizardCmd(function (cmd) {
      if (!cmd || typeof cmd !== 'object') return;
      if (cmd.op === 'highlight') { highlight(cmd.tab, cmd.sel, cmd.pane); return; }
      if (cmd.op === 'clear') { clearHighlight(); blockUi(false); return; }
      if (cmd.op === 'block') { blockUi(!!cmd.on); return; }
      if (cmd.op === 'tab') { clearHighlight(); openTab(cmd.tab, cmd.pane); return; }
      if (cmd.op === 'set') { setKey(cmd.key, cmd.value); return; }
      if (cmd.op === 'bg') { playBg(); return; }
      if (cmd.op === 'do' && WIZ_ACTIONS[cmd.name]) {
        try { WIZ_ACTIONS[cmd.name](cmd.args); } catch (e) { try { console.warn('визард: ' + cmd.name + ': ' + e.message); } catch (e2) {} }
      }
    });
  }

  // Смена темы/оболочки — сразу отдаём визарду новые переменные.
  try {
    new MutationObserver(function () { if (wizardOpen) sendTheme(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  } catch (e) {}

  // Настройки → «О программе»: пройти знакомство заново.
  var about = document.getElementById('aboutWizard');
  if (about) {
    about.onclick = function () {
      if (!A.wizardOpen) return;
      A.wizardOpen({ from: 'settings' }).catch(function () {});
    };
  }
})();
