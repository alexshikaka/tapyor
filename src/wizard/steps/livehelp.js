// Справка «Живая очередь» (WZ3, 14.11.2026). Здесь — её пункты и шаг визарда стримера.
// Файл работает в двух окнах: в визарде (шаг livehelp) и в главном окне, где эта же
// справка открывается диалогом (src/ui/32-wiz-wz3.js берёт пункты из window.TapLiveHelp).
// В Node — require('../steps.js').register(require('./livehelp.js').step).
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.TapLiveHelp = api;
    // В окне визарда регистрируем шаг сами; в главном окне WIZARD нет — просто отдаём пункты.
    if (root.WIZARD && typeof root.WIZARD.register === 'function') root.WIZARD.register(api.step);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  // Пункты — по WIZARD-PLAN.md, 5.4 и макету LiveHelp.dc.html. Пятый — только стримеру.
  function items(streamer) {
    const out = [
      {
        n: 1,
        kind: 'layers',
        title: 'Два слоя: очередь и фон',
        text: 'Сверху — то, что ты поставил сам. Ниже, пунктиром, — фон: что заиграет потом.'
      },
      {
        n: 2,
        kind: 'order',
        title: 'Очередь доигрывает до конца',
        text: 'Всё добавленное играет по порядку. Сыгранное уезжает вверх и бледнеет. «＋ В очередь» — в конец твоей очереди, но раньше фона.'
      },
      {
        n: 3,
        kind: 'after',
        title: 'Кончилась очередь — играет фон',
        text: 'Моя волна или выбранный плейлист продолжают сами — без тишины. Выключить: Настройки → Воспроизведение.'
      },
      {
        n: 4,
        kind: 'bg',
        title: '«Играть фоном»',
        text: 'У плейлистов и волн кнопка теперь «Играть фоном». Список становится фоном и не стирает твою очередь. В классическом плейлисте «Играть» заменял всё.'
      }
    ];
    if (streamer === true) {
      out.push({
        n: 5,
        kind: 'streamer',
        streamer: true,
        title: 'Заказы зрителей — первыми',
        text: 'Заказы зрителей встают первыми и подсвечены — даже раньше твоей очереди.'
      });
    }
    return out;
  }

  let unsub = null;

  const step = {
    id: 'livehelp',
    routes: ['streamer'],
    label: 'Живая очередь',
    title: 'Два режима плейлиста',
    lead: 'Классический — как в обычном плеере. Живая очередь — музыка не кончается: после твоей очереди играет фон.',
    skippable: true,
    render(el) {
      el.innerHTML = '<div class="wiz-livehelp">'
        + '<p>Справка открыта в Тапёре слева от очереди. Подсвечен переключатель режима — «Классический плейлист» или «Живая очередь». Прочитай и нажми «Понятно» — вернёмся сюда же.</p>'
        + '<p class="wiz-note">Если закрыл случайно — «?» у переключателя режима очереди.</p>'
        + '</div>';
    },
    onEnter(api) {
      // Справка живёт в главном окне: открываем её командой и ждём закрытия.
      // Очередь видна на вкладке «Поиск»; подсвечиваем переключатель режима, справку ставим рядом (15.11)
      api.cmd({ op: 'highlight', tab: 'search', sel: '#qMode' });
      api.cmd({ op: 'do', name: 'openLiveHelp', args: { anchor: true } });
      unsub = api.on('livehelp', function (d) {
        if (d && d.closed === true) api.next();
      });
    },
    onLeave(api) {
      if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
      // Ушли с шага раньше (пропустили) — справку в главном окне закрываем.
      if (api && typeof api.cmd === 'function') api.cmd({ op: 'do', name: 'closeLiveHelp' });
    }
  };

  return { items, step };
});
