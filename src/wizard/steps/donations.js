// Шаг визарда «Донаты» (WC2, WIZ6-COACH.md): визард не повторяет кнопки и поля Тапёра,
// а задачами показывает, что нажать в Настройках → «Донаты». Кнопку входа DonationAlerts,
// поле ключа DonatePay, цену с валютой и сайт-визитку рисует сам Тапёр (#stDon, #stPrice, #stSite).
// Подключённое отмечается по состоянию (событие donState), а не по клику: вход мог не получиться.
// UMD: в Node файл берёт реестр из ../steps.js, в окне — из window.WIZARD.
(function (root, factory) {
  var W = (typeof module !== 'undefined' && module.exports) ? require('../steps.js') : (root && root.WIZARD);
  var api = factory(W);
  if (W && W.register) W.register(api.step);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (W) {
  'use strict';

  // Настоящие элементы Настроек → «Донаты» (src/index.html и renderStDon в src/ui/10-requests.js).
  // on:'none' — задачу отмечает состояние подключения; on:'fill' — цена, вписанная в поле.
  function donationTasks() {
    return [
      {
        id: 'da',
        text: 'Нажми «Подключить» у DonationAlerts',
        sub: 'Откроется окно входа в браузере. Тапёр получит донаты и текст сообщений с песнями.',
        tab: 'settings', pane: 'sStream', sel: '#stDon [data-don="da"]', on: 'none',
        where: 'Настройки → Донаты'
      },
      {
        id: 'dp',
        text: 'Или вставь API-ключ DonatePay',
        sub: 'Поле «API-ключ» и кнопка «Подключить» — в том же разделе. Хватит одного сервиса.',
        tab: 'settings', pane: 'sStream',
        sel: '#stDon [data-dk="dp"], #stDon [data-don="key"][data-k="dp"]', on: 'none',
        optional: true, where: 'Настройки → Донаты'
      },
      {
        id: 'price',
        text: 'Впиши цену за трек',
        sub: 'Рядом выбери валюту. Донат меньше цены — заказ ждёт твоего решения.',
        tab: 'settings', pane: 'sStream', sel: '#stPrice', on: 'fill',
        where: 'Настройки → Донаты'
      },
      {
        id: 'site',
        text: 'Посмотри «Сайт-визитку»',
        sub: 'По желанию: одна страница со всеми кнопками доната. Карточка ниже на этой же странице.',
        tab: 'settings', pane: 'sStream', sel: '#stSite', on: 'none',
        optional: true, where: 'Настройки → Донаты'
      }
    ];
  }

  var S = {
    active: false,
    wired: false,
    seen: false,       // состояние хоть раз приходило — его можно взять как initialDone
    da: null,
    dp: null,
    msg: '',
    box: null,
    coach: null,
    readyTimer: null
  };
  var apiRef = null;

  function q(id) { return document.getElementById(id); }

  function paint() {
    var msg = q('wz4Msg');
    if (msg) { msg.textContent = S.msg; msg.hidden = !S.msg; }
  }

  function doneList() {
    var out = [];
    if (S.da && S.da.connected) out.push('da');
    if (S.dp && S.dp.connected) out.push('dp');
    return out;
  }

  // Список задач создаём один раз за вход и только когда есть рамка шага.
  function buildCoach() {
    if (S.coach || !S.box || !apiRef) return;
    if (!W || typeof W.coach !== 'function') return;
    S.coach = W.coach(S.box, apiRef, {
      tasks: donationTasks(),
      initialDone: doneList(),
      start: 'da'
    });
  }

  // Состояние поменялось — переносим отметки в задачи. done/undone не дёргают
  // подсветку, если человек уже ушёл с задачи.
  function syncCoach() {
    if (!S.coach) { buildCoach(); return; }
    if (S.da && S.da.connected) S.coach.done('da'); else S.coach.undone('da');
    if (S.dp && S.dp.connected) S.coach.done('dp'); else S.coach.undone('dp');
  }

  function wire(api) {
    apiRef = api;
    if (S.wired) return;
    S.wired = true;
    api.on('donState', function (d) {
      if (!S.active || !d) return;
      S.seen = true;
      clearTimeout(S.readyTimer);
      S.da = d.da || { connected: false };
      S.dp = d.dp || { connected: false };
      S.msg = '';
      syncCoach();
      paint();
    });
    api.on('donError', function (d) {
      if (!S.active) return;
      S.msg = (d && d.what === 'state')
        ? 'Не получилось узнать состояние донатов — посмотри Настройки → Донаты сам.'
        : 'Не получилось — посмотри Настройки → Донаты сам.';
      // Задачи показываем даже при сбое: человек всё равно может нажать всё руками.
      buildCoach();
      paint();
    });
    api.on('hlAct', function (d) {
      if (!S.active || !d) return;
      // Нажал вход DonationAlerts — говорим, что ждём подключения; отметит состояние.
      if (d.sel === '#stDon [data-don="da"]' && d.kind === 'click') {
        S.msg = 'Вход открылся в браузере — отмечу сам, когда подключится.';
        paint();
      }
      // Сайт-визитка — по желанию: любое действие в её карточке считаем «посмотрел».
      if (d.sel === '#stSite' && S.coach && !S.coach.isDone('site')) S.coach.done('site');
    });
  }

  var step = {
    id: 'donations',
    routes: ['streamer'],
    label: 'Донаты',
    title: 'Как зрители закажут музыку',
    lead: 'Зритель донатит и пишет в сообщении песню — Тапёр сам найдёт её и поставит в очередь.',
    skippable: true,
    render: function (el, api) {
      wire(api);
      el.innerHTML = ''
        + '<div id="wzDonTasks"></div>'
        + '<p class="wz4-note">Подсвеченное — в окне Тапёра рядом. Уже подключённое отмечено ✓.</p>'
        + '<div class="wz4-msg" id="wz4Msg" hidden></div>';
      S.box = q('wzDonTasks');
      S.msg = '';
      paint();
      // Повторный вход: прошлое состояние уже знаем — задачи и подсветка сразу.
      if (S.seen) buildCoach();
    },
    onEnter: function (api) {
      apiRef = api;
      S.active = true;
      S.msg = '';
      paint();
      clearTimeout(S.readyTimer);
      // Первый вход: ждём ответ не дольше 1,2 с — задачи нужны даже при сбое связи с окном.
      if (!S.seen) {
        S.readyTimer = setTimeout(function () {
          if (!S.active || S.seen) return;
          buildCoach();
        }, 1200);
      }
      if (api && api.cmd) api.cmd({ op: 'do', name: 'wz4DonState' });
    },
    onLeave: function (api) {
      S.active = false;
      clearTimeout(S.readyTimer);
      if (S.coach) { try { S.coach.stop(); } catch (e) {} S.coach = null; }
      S.box = null;
      if (api && api.cmd) api.cmd({ op: 'clear' });
    }
  };

  return { step: step, donationTasks: donationTasks };
});
