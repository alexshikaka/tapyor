// Шаг визарда «Правила заказов» (WC2, WIZ6-COACH.md): три готовых набора остаются в визарде —
// в Тапёре их нет. После выбора набора открываем Настройки → «Заказы» и задачами показываем,
// что поменялось: «Точные — сразу в очередь» и те переключатели, которые набор поменял.
// Задачи отмечаются сами, когда главное окно подтвердит новые настройки. Своего стоп-листа
// больше нет — он правится в Тапёре, там же и подсвечивается (по желанию).
// UMD: в Node файл берёт реестр из ../steps.js, в окне — из window.WIZARD.
(function (root, factory) {
  var W = (typeof module !== 'undefined' && module.exports) ? require('../steps.js') : (root && root.WIZARD);
  var api = factory(W);
  if (W && W.register) W.register(api.step);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (W) {
  'use strict';

  // Таблица из WIZARD-PLAN.md 5.2. true у флагов — «играет», false — «ждёт тебя».
  // maxSec — секунды: 600 = 10 минут, 420 = 7 минут, 0 = без ограничения.
  var PRESETS = {
    all: { reqAuto: true, explicitOk: true, repeatOk: true, versionOk: true, maxSec: 600 },
    balanced: { reqAuto: true, explicitOk: false, repeatOk: false, versionOk: true, maxSec: 420 },
    manual: { reqAuto: false, explicitOk: false, repeatOk: false, versionOk: false, maxSec: 0 }
  };
  var ORDER = ['all', 'balanced', 'manual'];
  var META = {
    all: { name: 'Всё сразу в эфир', desc: 'Мат, повторы, каверы — играют. Ждут только длиннее 10 минут и нехватка суммы.' },
    balanced: { name: 'Сбалансированно', desc: 'Точные — сразу. Мат и повторы ждут тебя. Каверы играют. Длиннее 7 минут ждёт.' },
    manual: { name: 'Всё через меня', desc: 'Каждый заказ ждёт твоего решения.' }
  };
  // Настоящие переключатели в Настройках → Заказы: что набор ставит и где это в Тапёре.
  var TOGGLE = {
    explicitOk: { id: 'stExplicit', name: 'Мат (18+) можно', on: 'включено — треки с матом играют', off: 'выключено — заказы с матом ждут тебя' },
    repeatOk: { id: 'stRepeat', name: 'Повторять уже игравшие', on: 'включено — повтор можно заказать ещё раз', off: 'выключено — повторы ждут тебя' },
    versionOk: { id: 'stVersion', name: 'Каверы и другие версии', on: 'включено — каверы и live играют', off: 'выключено — версии ждут тебя' }
  };
  var apiRef = null;

  function presetToSettings(name) {
    var p = PRESETS[String(name || '')];
    return p ? Object.assign({}, p) : null;
  }

  // Какой набор сейчас стоит. Пустая строка — настройки правили вручную.
  function settingsToPreset(settings) {
    var s = settings && typeof settings === 'object' ? settings : {};
    var auto = s.reqAuto === true;
    var explicit = s.explicitOk !== false;
    var repeat = s.repeatOk !== false;
    var version = s.versionOk !== false;
    var max = s.maxSec == null ? 420 : (Number(s.maxSec) || 0);
    for (var i = 0; i < ORDER.length; i++) {
      var p = PRESETS[ORDER[i]];
      if (p.reqAuto === auto && p.explicitOk === explicit && p.repeatOk === repeat
        && p.versionOk === version && p.maxSec === max) return ORDER[i];
    }
    return '';
  }

  // Переключатели, которые новый набор меняет относительно текущих настроек.
  // Отсутствующий флаг в программе значит «включено» — так же, как в settingsToPreset.
  function changedToggles(prev, next) {
    var a = prev && typeof prev === 'object' ? prev : {};
    var b = next && typeof next === 'object' ? next : {};
    var out = [];
    var keys = ['explicitOk', 'repeatOk', 'versionOk'];
    for (var i = 0; i < keys.length; i++) {
      if ((a[keys[i]] !== false) !== (b[keys[i]] !== false)) out.push(keys[i]);
    }
    return out;
  }

  // Задачи шага: «точные» — всегда, дальше только то, что набор поменял, и стоп-лист по желанию.
  function presetTasks(key, prev) {
    var p = PRESETS[key] || {};
    var name = (META[key] && META[key].name) || 'Набор';
    var list = [{
      id: 'reqAuto',
      text: 'Точные — сразу в очередь',
      sub: 'Набор «' + name + '»: ' + (p.reqAuto
        ? 'включено — точные заказы встают в очередь сами'
        : 'выключено — каждый заказ ждёт тебя'),
      tab: 'settings', pane: 'sOrders', sel: '#sOrders [data-set-tg="reqAuto"]', on: 'none'
    }];
    var changed = changedToggles(prev, p);
    for (var i = 0; i < changed.length; i++) {
      var k = changed[i];
      var t = TOGGLE[k];
      if (!t) continue;
      list.push({
        id: k,
        text: t.name,
        sub: 'Набор «' + name + '»: ' + (p[k] !== false ? t.on : t.off),
        tab: 'settings', pane: 'sOrders', sel: '#' + t.id, on: 'none'
      });
    }
    list.push({
      id: 'stop',
      text: 'Стоп-лист',
      sub: 'Слова и исполнители, которых у тебя не будет. Уже заполнен — поправь, если надо.',
      tab: 'settings', pane: 'sOrders', sel: '#stStop', on: 'change', optional: true
    });
    return list;
  }

  var S = {
    inited: false, active: false, wired: false,
    auto: false, rules: {}, stopText: '', done: false,
    match: '', defaulted: false, msg: '',
    box: null, coach: null, tasks: null, pending: '', tour: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function q(id) { return document.getElementById(id); }

  function paint() {
    for (var i = 0; i < ORDER.length; i++) {
      var key = ORDER[i];
      var b = q('wz4Pre-' + key);
      if (!b) continue;
      var on = S.match === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      var mark = b.querySelector('.wz4-pre-mark');
      if (mark) mark.textContent = on ? ' ✓' : '';
    }
    var manual = q('wz4Manual');
    if (manual) manual.hidden = !(S.inited && S.done && !S.match);
    var msg = q('wz4Msg');
    if (msg) { msg.textContent = S.msg; msg.hidden = !S.msg; }
  }

  function stopTour() {
    clearTimeout(S.tour);
    S.tour = null;
  }

  // Списка задач с галочками у шага нет (15.11.2026, слово владельца: «зелёные галочки убрать»).
  // Выбрал набор — Тапёр слева сам по очереди подсвечивает переключатели, которые набор поменял,
  // а под наборами — одна строка, что получилось.
  function buildCoach() {
    stopTour();
    if (S.coach) { try { S.coach.stop(); } catch (e) {} S.coach = null; }
    if (S.box) S.box.innerHTML = '';
  }

  // Выбрал набор — под наборами одна строка, что получилось. Подсветка не скачет по переключателям
  // (слово владельца 16.11): весь раздел «Заказы» подсвечен с входа на шаг.
  function startTour() {
    stopTour();
    var name = (META[S.match] && META[S.match].name) || '';
    if (S.box) {
      S.box.innerHTML = '<p class="wz4-done">Набор «' + esc(name) + '» включён. Слева в Настройках подсвечены правила заказов — '
        + 'там видно, что поменялось, и можно поправить по одному.</p>';
    }
  }

  function wire(api) {
    apiRef = api;
    if (S.wired) return;
    S.wired = true;
    api.on('rulesState', function (d) {
      if (!S.active || !d) return;
      S.inited = true;
      S.auto = d.auto === true;
      S.rules = d.rules && typeof d.rules === 'object' ? d.rules : {};
      S.stopText = typeof d.stopText === 'string' ? d.stopText : '';
      S.done = d.done === true;
      S.msg = '';
      var merged = Object.assign({}, S.rules, { reqAuto: S.auto });
      var match = settingsToPreset(merged);
      // Первый запуск: заводские настройки не совпадают ни с одним набором, а по умолчанию
      // в плане выбран «Сбалансированно» — сразу выставляем его, чтобы выбор был правдой.
      if (!match && !S.done && !S.defaulted) {
        S.defaulted = true;
        S.match = 'balanced';
        paint();
        var p = presetToSettings('balanced');
        if (p) api.cmd({ op: 'do', name: 'wz4RulesApply', args: p });
        return;
      }
      S.match = match;
      // Набор применился — показываем это в задачах (они отметятся сами, по очереди).
      if (S.pending && match === S.pending) {
        S.pending = '';
        startTour(S.tasks || []);
      }
      paint();
    });
    api.on('rulesError', function () {
      if (!S.active) return;
      S.pending = '';
      S.msg = 'Не получилось сохранить правила — попробуй ещё раз';
      paint();
    });
  }

  function applyPreset(key) {
    var p = presetToSettings(key);
    if (!p || !apiRef) return;
    var prev = Object.assign({}, S.rules, { reqAuto: S.auto });
    S.tasks = presetTasks(key, prev);
    S.match = key;
    S.defaulted = true;
    S.pending = key;
    S.msg = '';
    buildCoach();
    paint();
    apiRef.cmd({ op: 'do', name: 'wz4RulesApply', args: p });
  }

  var step = {
    id: 'rules',
    routes: ['streamer'],
    label: 'Правила заказов',
    title: 'Как пускать заказы в эфир',
    lead: '',
    skippable: true,
    render: function (el, api) {
      wire(api);
      var presets = ORDER.map(function (key) {
        var m = META[key];
        return '<button type="button" class="wz4-preset" id="wz4Pre-' + key + '" aria-pressed="false">'
          + '<b>' + esc(m.name) + '<span class="wz4-pre-mark"></span></b>'
          + '<span>' + esc(m.desc) + '</span></button>';
      }).join('');
      el.innerHTML = ''
        + '<div class="wz4-card wz4-flow">'
        + '  <div class="wz4-flow-top"><span class="wz4-chip">донат с песней</span><span class="wz4-sub">→ два пути:</span></div>'
        + '  <div class="wz4-paths">'
        + '    <div class="wz4-path wz4-path-go"><b>Сразу в эфир</b><span>нашёл точно — сам встаёт в очередь, ты ничего не жмёшь</span></div>'
        + '    <div class="wz4-path wz4-path-wait"><b>Ждёт тебя</b><span>во вкладке «Заказы» с пометкой почему; в очередь — твоей кнопкой</span></div>'
        + '  </div>'
        + '</div>'
        + presets
        + '<div class="wz4-sub wz4-manual" id="wz4Manual" hidden>Сейчас правила изменены вручную — выбери набор, чтобы знать, что получится.</div>'
        + '<div id="wzRulesTasks"></div>'
        + '<p class="wz4-note">Всё спорное — во вкладке «Заказы», решаешь одной кнопкой. Тонкая настройка и стоп-лист — Настройки → Заказы.</p>'
        + '<div class="wz4-msg" id="wz4Msg" hidden></div>';

      S.box = q('wzRulesTasks');
      for (var i = 0; i < ORDER.length; i++) {
        (function (key) {
          var b = q('wz4Pre-' + key);
          if (b) b.onclick = function () { applyPreset(key); };
        })(ORDER[i]);
      }
      paint();
    },
    onEnter: function (api) {
      S.active = true;
      S.pending = '';
      S.tasks = null;
      stopTour();
      if (S.coach) { try { S.coach.stop(); } catch (e) {} S.coach = null; }
      if (api && api.cmd) {
        // Сразу открываем Настройки → «Заказы»: наборы меняют настройки там (слово владельца 15.11)
        api.cmd({ op: 'highlight', tab: 'settings', pane: 'sOrders', sel: '#sOrders' });
        api.cmd({ op: 'do', name: 'wz4RulesGet' });
      }
    },
    onLeave: function (api) {
      S.active = false;
      S.pending = '';
      stopTour();
      if (S.coach) { try { S.coach.stop(); } catch (e) {} S.coach = null; }
      S.box = null;
      if (api && api.cmd) api.cmd({ op: 'clear' });
    }
  };

  return {
    step: step,
    presetToSettings: presetToSettings,
    settingsToPreset: settingsToPreset,
    changedToggles: changedToggles,
    presetTasks: presetTasks,
    PRESETS: PRESETS
  };
});
