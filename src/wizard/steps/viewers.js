// Последний шаг визарда стримера «Взаимодействие со зрителями» (16.11.2026, слово владельца, макет «вариант A»).
// Окно визарда снова встаёт по центру поверх Тапёра (команда center в src/main/wizard.js). Две карточки-выбора:
//   • Пак стримера (слева, главная) — «Свой бот и оверлеи», месяц бесплатно. Внутри — сцена эфира: слева
//     чат Twitch, где бот ставит песни, справа вверху — оверлей пака, стили сменяются сами.
//     «Попробовать бесплатно» ставит пак и включает пробный период (packTry в src/ui/32-wiz-wz5.js).
//   • «Настроить Streamer.bot» (справа) — связь с чатом через посредника, бесплатно; скриншот программы.
//     Открывает Настройки → Streamer.bot.
// После выбора — итог «Готов к эфиру» (последний шаг). Кадры — src/wizard/img/ov-*.webp (демо-страница пака на фоне «картинки
// игры» с сайта), скриншот Streamer.bot — src/wizard/img/sbot.webp (прислал владелец).
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const registry = isNode ? require('../steps.js') : (root && root.WIZARD);
  const api = factory(registry);
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (registry) {
  const OVERLAYS = [
    ['neon', 'Неон'], ['card', 'Карточка'], ['vinyl', 'Винил'], ['cassette', 'Кассета'],
    ['win95', 'Windows 95'], ['polaroid', 'Полароид'], ['winamp', 'Winamp'], ['popart', 'Поп-арт']
  ];
  const SLIDE_MS = 2800;
  // Пример переписки в чате: зритель заказывает — бот отвечает
  const CHAT = [
    ['u1', 'kot_v_sapogah', '!play Кино — Группа крови', true],
    ['bot', 'Тапёр', '@kot_v_sapogah поставил «Группа крови» — 2-й в очереди', false],
    ['u2', 'lera_k', '!play Земфира — Хочешь?', true],
    ['bot', 'Тапёр', '@lera_k «Хочешь?» — 3-й в очереди', false]
  ];

  let slideTimer = null;
  function stopSlides() { clearInterval(slideTimer); slideTimer = null; }
  function esc(s) { return registry && registry.esc ? registry.esc(s) : String(s); }

  const step = {
    id: 'viewers',
    routes: ['streamer'],
    label: 'Зрители',
    title: 'Взаимодействие со зрителями',
    lead: 'Пусть зрители заказывают музыку прямо из чата Twitch — командой или за баллы канала.',
    skippable: false,   // подвал «← Назад / Дальше» (16.11): выбор не обязателен
    render(el, api) {
      stopSlides();
      const chat = '<div class="wiz-vw-chat" aria-hidden="true"><span class="wiz-vw-chat-h">Чат Twitch</span>'
        + CHAT.map((m) => '<p><span class="' + m[0] + '">' + esc(m[1]) + '</span>: '
          + (m[3] ? '<span class="cmd">' + esc(m[2]) + '</span>' : esc(m[2])) + '</p>').join('') + '</div>';
      el.innerHTML = '<div class="wiz-vw">'
        + '<div class="wiz-vw-choices">'
        + '<button type="button" class="wiz-vw-choice wiz-vw-pack" data-vw="pack">'
        + '<span class="wiz-vw-k">Месяц бесплатно</span>'
        + '<b>Пак стримера</b>'
        + '<span class="wiz-vw-what">Свой бот и оверлеи</span>'
        + '<span class="wiz-vw-stage">'
        + OVERLAYS.map((o, i) => '<img src="img/ov-' + o[0] + '.webp" alt="Оверлей «' + o[1] + '»"' + (i ? '' : ' class="on"') + '>').join('')
        + chat + '</span>'
        + '<span class="wiz-vw-dots" aria-hidden="true">' + OVERLAYS.map((o, i) => '<i' + (i ? '' : ' class="on"') + '></i>').join('') + '</span>'
        + '<span class="wiz-vw-sub">Бот отвечает в чате Twitch и ставит песни: командой и за баллы канала. Работает из коробки — войти через Twitch, и всё. Оверлеи — 26 стилей.</span>'
        + '<span class="wiz-vw-cta">Попробовать бесплатно</span>'
        + '</button>'
        + '<button type="button" class="wiz-vw-choice wiz-vw-sb" data-vw="sbot">'
        + '<span class="wiz-vw-k">Бесплатно</span>'
        + '<b>Настроить Streamer.bot</b>'
        + '<span class="wiz-vw-what">Связь с чатом через посредника</span>'
        + '<img class="wiz-vw-shot" src="img/sbot.webp" alt="Окно Streamer.bot">'
        + '<span class="wiz-vw-sub">Если у тебя уже стоит Streamer.bot: он принимает команды в чате, Тапёр ставит песни. Нужна настройка — Тапёр подскажет, что нажать.</span>'
        + '<span class="wiz-vw-cta">Перейти к настройке</span>'
        + '</button>'
        + '</div>'
        + '</div>';
      // Выбор открывает нужное в Тапёре и ведёт к итогу «Готов к эфиру» (он теперь последний — 16.11)
      el.querySelector('[data-vw="pack"]').onclick = () => {
        api.cmd({ op: 'do', name: 'packTry' });
        api.next();
      };
      el.querySelector('[data-vw="sbot"]').onclick = () => {
        api.cmd({ op: 'tab', tab: 'settings', pane: 'sSbot' });
        api.next();
      };
      // Оверлеи на сцене сменяются сами, плавно; точки показывают, какой сейчас
      const imgs = el.querySelectorAll('.wiz-vw-stage img');
      const dots = el.querySelectorAll('.wiz-vw-dots i');
      let i = 0;
      slideTimer = setInterval(() => {
        if (imgs.length < 2) return;
        imgs[i].classList.remove('on'); if (dots[i]) dots[i].classList.remove('on');
        i = (i + 1) % imgs.length;
        imgs[i].classList.add('on'); if (dots[i]) dots[i].classList.add('on');
      }, SLIDE_MS);
    },
    onEnter(api) {
      // Окно визарда — снова по центру поверх Тапёра (шире обычного: две карточки со сценой)
      api.cmd({ op: 'center', big: true });
    },
    onLeave(api) {
      stopSlides();
      // «← Назад» — обратно в колонку сбоку. При закрытии визарда команда безвредна.
      if (api && api.cmd) api.cmd({ op: 'dock' });
    }
  };

  if (registry && typeof registry.register === 'function') registry.register(step);
  return { step, OVERLAYS };
});
