// Шаг визарда «Оформление» (WIZ6-COACH.md). Раньше здесь были свои образцы оболочек и тем —
// копия выбора в Настройках. Теперь шаг только подсказывает: подсвечивает настоящую карточку
// оформления (оболочки и список тем), а любой выбор в ней отмечает задачу.
// Чистую функцию themeTasks проверяет юнит-тест.
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const registry = isNode ? require('../steps.js') : (root && root.WIZARD);
  const api = factory(registry);
  if (isNode) module.exports = api;
  else if (registry && typeof registry.register === 'function') registry.register(api.step);
})(typeof window !== 'undefined' ? window : null, function (registry) {
  // Настоящая карточка оформления. Она же переезжает во вкладку «Оформление» (#lookSlot),
  // поэтому в селекторе два места: подсветка не теряется при переключении вкладки.
  function themeTasks() {
    return [{
      id: 'theme',
      text: 'Выбери тему',
      sub: 'Оболочка и цвета — здесь. Выбор сразу виден на окне Тапёра.',
      tab: 'settings',
      pane: 'sLook',
      sel: '#sLook .card, #lookSlot .card',
      on: 'click'
    }];
  }

  const step = {
    id: 'look',
    routes: ['listener', 'streamer'],
    label: 'Оформление',
    title: 'Каким будет твой Тапёр?',
    lead: 'Выбирай — окно слева меняется сразу. Потом всё можно поменять в Настройках.',
    skippable: true,
    render(el, api) {
      el.__wizCurrent = 'look';
      if (lookStep.ctl) { try { lookStep.ctl.stop(); } catch (e) {} lookStep.ctl = null; }
      el.innerHTML = '';
      if (registry && typeof registry.coach === 'function') {
        lookStep.ctl = registry.coach(el, api, { tasks: themeTasks() });
      }
    },
    onLeave() {
      if (lookStep.ctl) { try { lookStep.ctl.stop(); } catch (e) {} lookStep.ctl = null; }
    }
  };

  const lookStep = { ctl: null, step: step };

  return { step: step, tasks: themeTasks };
});
