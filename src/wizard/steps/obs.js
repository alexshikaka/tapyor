// Шаг визарда стримера «OBS — что увидят зрители» (WIZARD-PLAN.md 5.5, макет S11-Obs).
// Подсказчик: подсвечивает настоящие кнопки Настройки → OBS и стрим / Оверлей-плейлист.
// Пункт про оверлеи — только когда Пак стримера установлен и у него есть пробный период.
// В Node файл отдаёт чистые решения для юнит-тестов; в окне визарда — регистрирует шаг.
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const registry = isNode ? require('../steps.js') : (root && root.WIZARD);
  const api = factory(registry);
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (registry) {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Показывать ли карточку «Оверлеи для стрима — попробуй бесплатно».
  // Только когда есть сам пак и можно начать его пробный период: без пака или без пробного
  // периода карточки нет. Состояния — из facts.pack (src/main.js, getFacts).
  function overlayCardVisible(facts) {
    const p = facts && typeof facts === 'object' ? facts.pack : null;
    if (!p || p.installed !== true) return false;
    return p.trialAvailable === true;
  }

  // Задачи «что нажать в Тапёре» (переделано 15.11.2026: визард не повторяет кнопки Тапёра).
  // Всё по желанию; отмечается нажатием подсвеченного. Оверлеи — только когда пак есть.
  function obsTasks(facts) {
    const t = [
      { id: 'np', text: 'Название трека на экране: включи «Писать название трека в файл»', sub: 'Тапёр пишет его в файл, а в OBS добавь источник «Текст» из этого файла.',
        tab: 'settings', pane: 'sObs', sel: '#sObs [data-set-tg="npEnabled"]', on: 'click', optional: true, where: 'Настройки → OBS и стрим' },
      { id: 'panel', text: 'Панель Тапёра внутри OBS: нажми «Скопировать»', sub: 'Для тебя, не для зрителей. В OBS: Док-панели → Пользовательские → вставь адрес.',
        tab: 'settings', pane: 'sObs', sel: '#wgCopy', on: 'click', optional: true, where: 'Настройки → OBS и стрим' }
    ];
    if (overlayCardVisible(facts)) {
      t.push({ id: 'overlay', text: 'Оверлеи для стрима: включи пробный период', sub: 'Что играет и что дальше — красиво поверх эфира. 30 дней бесплатно.',
        tab: 'settings', pane: 'sOverlay', sel: '#ovPanel [data-pack-trial], #ovPanel [data-pack-open]', on: 'click', optional: true, where: 'Настройки → Оверлей-плейлист' });
    }
    return t;
  }

  let ctl = null;
  let factsTimer = null;
  function stopCoach() { if (ctl) { try { ctl.stop(); } catch (e) {} ctl = null; } }

  // Что есть для OBS (15.11.2026, слово владельца: «просто покажи, что есть настройки OBS»).
  // Шаг ничего не требует: открывает Настройки → «OBS и стрим», подсвечивает этот пункт меню
  // и коротко перечисляет, что там лежит. Настроить — когда будет удобно.
  function obsList(facts) {
    const out = [
      ['OBS и стрим', 'название трека в файл для источника «Текст» и панель Тапёра внутри OBS (лента сообщений и кнопки плеера)'],
      ['Видео для OBS', 'картинка YouTube поверх эфира: рамка, скрытие, когда играет только музыка']
    ];
    const p = facts && typeof facts === 'object' ? facts.pack : null;
    if (p && p.installed === true) out.push(['Оверлей-плейлист', 'что играет и что дальше — красиво поверх эфира (Пак стримера)']);
    return out;
  }

  const step = {
    id: 'obs',
    routes: ['streamer'],
    label: 'OBS',
    title: 'Что есть для OBS',
    lead: 'Слева в Настройках подсвечен блок «Стримерам». Сейчас ничего делать не нужно — загляни, когда будешь готов.',
    skippable: true,
    render(el, api) {
      stopCoach();
      el.innerHTML = '<ul class="wiz-obs-list">' + obsList(api.facts).map((x) =>
        '<li><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></li>').join('') + '</ul>'
        + '<p class="wiz-hint">Все разделы — в Настройках, группа «Стримерам».</p>';
    },
    onEnter(api) {
      // Подсвечиваем весь блок «Стримерам» в меню Настроек (слово владельца 16.11)
      if (api && api.cmd) api.cmd({ op: 'highlight', tab: 'settings', pane: 'sObs', sel: '#setStreamBlock' });
    },
    onLeave(api) {
      stopCoach();
      clearTimeout(factsTimer);
      if (api && api.cmd) api.cmd({ op: 'clear' });
    }
  };

  if (registry && typeof registry.register === 'function') registry.register(step);
  return { step, overlayCardVisible, obsTasks, obsList };
});
