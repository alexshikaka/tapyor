// Шаг «Очередь» ветки слушателя (WZ3, 14.11.2026). Продолжает «Плейлисты»:
// подсвечиваем колонку очереди, объясняем трек, перетаскивание и «Мою волну»
// (волну — только если вошёл в Яндекс). Тексты — WIZARD-PLAN.md, 4.1.
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.TapWizQueue = api;
    if (root.WIZARD && typeof root.WIZARD.register === 'function') root.WIZARD.register(api.step);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  let rootEl = null;
  let unsub = null;

  // Волну показываем, только если вход в Яндекс подтверждён — фактами или ответом окна.
  function waveOn(api, extra) {
    if (extra && extra.ym === true) return true;
    const facts = api && api.facts && typeof api.facts === 'object' ? api.facts : {};
    return !!(facts.music && facts.music.ym === true);
  }
  function paint(api, extra) {
    if (!rootEl) return;
    const card = rootEl.querySelector('#wizQueueWave');
    if (card) card.hidden = !waveOn(api, extra);
  }

  const step = {
    id: 'queue',
    routes: ['listener'],
    label: 'Очередь',
    title: 'Твой плейлист уже играет',
    lead: 'Справа — очередь: что играет и что дальше.',
    skippable: true,
    render(el, api) {
      rootEl = el;
      el.innerHTML = '<div class="wiz-qcard"><b>Нажми любой трек</b>'
        + '<span>он заиграет на своём месте — остальные никуда не уедут.</span></div>'
        + '<div class="wiz-qcard"><b>Перетаскивай как хочешь</b>'
        + '<span>«＋ В очередь» из поиска ставит трек в конец.</span></div>'
        + '<div class="wiz-qcard" id="wizQueueWave" hidden><b>Моя волна</b>'
        + '<span>Бесконечная музыка под твой вкус. Характер, настроение, язык — здесь же.</span></div>';
      paint(api, null);
    },
    onEnter(api) {
      api.cmd({ op: 'highlight', sel: '.queue-col' });
      api.cmd({ op: 'do', name: 'listenerState' });
      unsub = api.on('listenerstate', function (d) { paint(api, d || {}); });
    },
    onLeave(api) {
      api.cmd({ op: 'clear' });
      if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
      rootEl = null;
    }
  };

  return { step, waveOn };
});
