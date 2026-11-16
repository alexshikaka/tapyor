// Шаг визарда «Заказы в деле» (WZ4, WIZARD-PLAN.md 5.3, макет S09).
// Главное окно создаёт два пробных заказа тем же путём, что отладочный «Тестовый заказ»
// (reqTest → путь настоящего доната, деньги не двигаются, пометка «тест»):
//   «Кино — Кукушка» с достаточной суммой — сам в очередь;
//   «Кино — Группа крови» с недостаточной — ждёт решения.
// Щелчок «＋ В очередь» на карточке ждущего заказа засчитывает шаг (событие wz4OrderAdded).
// После шага и при закрытии визарда главное окно убирает пробные заказы.
// UMD: в Node файл берёт реестр из ../steps.js, в окне — из window.WIZARD.
(function (root, factory) {
  var api = factory();
  var W = (typeof module !== 'undefined' && module.exports) ? require('../steps.js') : (root && root.WIZARD);
  if (W && W.register) W.register(api.step);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var SYM = { RUB: '₽', UAH: '₴', KZT: '₸', USD: '$', EUR: '€' };
  var S = {
    phase: 'idle',      // idle → loading → ready → added; error — если не вышло
    data: null,
    active: false,
    wired: false,
    msg: '',
    timers: []
  };
  var apiRef = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function q(id) { return document.getElementById(id); }
  function money(n, cur) {
    var v = Math.round(Number(n) || 0);
    return String(v) + ' ' + (SYM[cur] || cur || '');
  }
  function clearTimers() {
    for (var i = 0; i < S.timers.length; i++) clearTimeout(S.timers[i]);
    S.timers = [];
  }
  function later(fn, ms) {
    var id = setTimeout(function () {
      var k = S.timers.indexOf(id);
      if (k >= 0) S.timers.splice(k, 1);
      try { fn(); } catch (e) {}
    }, ms);
    S.timers.push(id);
    return id;
  }

  function block(el, cls, title, text, strong) {
    if (!el) return;
    el.className = 'wz4-card ' + cls;
    el.innerHTML = '<div class="wz4-ord-title">' + esc(title) + '</div>'
      + '<div class="wz4-ord-text">' + esc(text) + '</div>'
      + (strong ? '<div class="wz4-ord-strong">' + esc(strong) + '</div>' : '');
    el.hidden = false;
  }

  function paint() {
    var status = q('wz4OrdStatus');
    if (status) {
      if (S.phase === 'loading') status.textContent = 'Отправляю два пробных доната — это как настоящие, деньги не двигаются…';
      else if (S.phase === 'added') status.textContent = '✓ Шаг засчитан — пробные заказы убираю…';
      else if (S.phase === 'error') status.textContent = S.msg || 'Не получилось отправить пробные донаты';
      else if (S.phase === 'ready') status.textContent = 'Пробные донаты отправлены. После шага они исчезнут.';
      else status.textContent = '';
      status.hidden = !status.textContent;
    }

    var first = q('wz4OrdFirst'), second = q('wz4OrdSecond');
    var manual = q('wz4OrdManual');
    if (manual) manual.hidden = !(S.phase === 'ready' && S.data && !S.data.auto);

    if (!S.data || (S.phase !== 'ready' && S.phase !== 'added')) {
      if (first) first.hidden = true;
      if (second) second.hidden = true;
      return;
    }
    var d = S.data;
    var f = d.first || {};
    var s = d.second || {};
    var cur = d.currency || 'RUB';

    if (f.queued) {
      block(first, 'wz4-ord-go', '✓ 1 · Сразу в эфир',
        '«' + (f.title || 'Кино — Кукушка') + '», ' + money(f.amount, cur) + ' — нашёл точно и сам поставил в очередь. Зелёный — значит заказ зрителя.');
    } else {
      block(first, 'wz4-ord-neutral', '1 · Заказ пришёл',
        '«' + (f.title || 'Кино — Кукушка') + '», ' + money(f.amount, cur) + ' — сам в очередь не встал: ' +
        (d.auto ? 'возможно, не нашёл точно или трек уже в очереди. Посмотри карточку во вкладке «Заказы».'
          : 'сейчас набор «Всё через меня», решаешь ты.'));
    }

    if (!s.paid) {
      block(second, 'wz4-ord-wait', '2 · Ждёт тебя',
        '«' + (s.title || 'Кино — Группа крови') + '», ' + money(s.amount, cur) + ' — не хватает суммы. Такие заказы копятся во вкладке «Заказы».',
        'Нажми «＋ В очередь» на карточке');
    } else if (s.queued) {
      block(second, 'wz4-ord-go', '✓ 2 · Тоже в эфире',
        '«' + (s.title || 'Кино — Группа крови') + '», ' + money(s.amount, cur) + ' — тоже встал в очередь. Суммы хватило.');
    } else {
      block(second, 'wz4-ord-wait', '2 · Ждёт тебя',
        '«' + (s.title || 'Кино — Группа крови') + '», ' + money(s.amount, cur) + ' — заказ во вкладке «Заказы».',
        'Нажми «＋ В очередь» на карточке');
    }
  }

  function highlights(d) {
    var f = d.first || {};
    var s = d.second || {};
    if (f.queued) {
      later(function () {
        if (apiRef && S.active) apiRef.cmd({ op: 'highlight', tab: 'req', sel: '#queue .qrow[data-wz4q]' });
      }, 220);
    }
    if (!s.queued) {
      later(function () {
        if (apiRef && S.active) apiRef.cmd({ op: 'highlight', tab: 'req', sel: '[data-wz4wait]' });
      }, f.queued ? 2600 : 500);
    }
  }

  function wire(api) {
    apiRef = api;
    if (S.wired) return;
    S.wired = true;
    api.on('wz4OrdersLoading', function () {
      if (!S.active) return;
      S.phase = 'loading';
      S.data = null;
      S.msg = '';
      clearTimers();
      paint();
    });
    api.on('wz4OrdersReady', function (d) {
      if (!S.active || !d) return;
      S.phase = 'ready';
      S.data = d;
      S.msg = '';
      paint();
      highlights(d);
    });
    api.on('wz4OrderAdded', function () {
      if (!S.active || S.phase !== 'ready') return;
      S.phase = 'added';
      // Для финала «Готов к эфиру»: пункт «Заказы проверены» (контракт с WZ5).
      api.cmd({ op: 'set', key: 'wizardOrdersTested', value: true });
      clearTimers();
      paint();
      later(function () { if (apiRef && S.active) apiRef.next(); }, 900);
    });
    api.on('wz4OrdersError', function () {
      if (!S.active) return;
      S.phase = 'error';
      S.msg = 'Не получилось отправить пробные донаты — проверь связь и попробуй ещё раз';
      paint();
    });
  }

  var step = {
    id: 'orders',
    routes: ['streamer'],
    label: 'Заказы в деле',
    title: 'Как это выглядит в эфире',
    lead: 'Я отправил два пробных доната. Деньги никуда не идут, после шага пробные заказы исчезнут.',
    skippable: true,
    render: function (el, api) {
      wire(api);
      el.innerHTML = ''
        + '<div class="wz4-sub wz4-ord-status" id="wz4OrdStatus" hidden></div>'
        + '<div class="wz4-sub wz4-ord-manual" id="wz4OrdManual" hidden>Сейчас набор «Всё через меня» — ждут оба заказа.</div>'
        + '<div class="wz4-card wz4-ord-go" id="wz4OrdFirst" hidden></div>'
        + '<div class="wz4-card wz4-ord-wait" id="wz4OrdSecond" hidden></div>'
        + '<p class="wz4-note">«▶ Сейчас» — играет немедленно. «Не то» — Тапёр покажет другие варианты. «Искать сам» — найдёшь вручную.</p>';
      paint();
    },
    onEnter: function (api) {
      S.active = true;
      S.phase = 'idle';
      S.data = null;
      S.msg = '';
      clearTimers();
      paint();
      if (api && api.cmd) api.cmd({ op: 'do', name: 'wz4OrdersStart' });
    },
    onLeave: function (api) {
      S.active = false;
      clearTimers();
      if (api && api.cmd) {
        api.cmd({ op: 'do', name: 'wz4OrdersCleanup' });
        api.cmd({ op: 'clear' });
      }
    }
  };

  return { step: step };
});
