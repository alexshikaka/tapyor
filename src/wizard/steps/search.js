// Шаг визарда «Поиск» (WIZARD-PLAN.md, 3.5; макет W05-Search.dc.html).
// Главное окно само впечатывает «Кино — Группа крови» в строку поиска и запускает поиск (умный режим).
// Визард только подсвечивает зону и ждёт событие «трек заиграл» — его присылает главное
// окно (wizardEmit({type:'played'})). Пока трек не заиграл, «Дальше» нет — только «Пропустить».
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.WIZARD && root.WIZARD.register) root.WIZARD.register(api.step);
})(typeof window !== 'undefined' ? window : null, function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // «Дальше» активно, когда шаг можно считать пройденным: трек заиграл или поиск
  // честно не смог (нет сети / ничего не нашлось) — план разрешает идти дальше.
  function nextVisible(model) {
    const m = model || {};
    if (m.played) return true;
    return m.state === 'empty' || m.state === 'offline' || m.state === 'error';
  }
  // Что показать крупно в карточке.
  function bigText(model) {
    const m = model || {};
    if (m.played) return '✓ Играет: ' + (m.played.title || 'трек');
    if (m.state === 'no-full') return 'Чтобы слушать, войди в Яндекс';
    if (m.state === 'empty') return 'Ничего не нашлось';
    if (m.state === 'offline') return 'Похоже, сейчас нет сети';
    if (m.state === 'error') return 'Поиск не запустился';
    if (m.state === 'ready') return 'Выбери песню и нажми ▶';
    return 'Ищу «Кино — Группа крови»…';
  }
  function noteText(model) {
    const m = model || {};
    if (m.played) return 'Шаг засчитан. Музыка осталась в очереди — можно слушать дальше.';
    if (m.state === 'no-full') return 'Песни без входа Яндекс отдаёт отрывками по 30 с, а другие площадки сейчас не отвечают.';
    if (m.state === 'empty') return 'Тапёр уже готов искать — попробуешь, когда появится что искать.';
    if (m.state === 'offline') return 'Поиск заработает, как только вернётся интернет. Всё остальное в Тапёре на месте.';
    if (m.state === 'error') return 'Проверь связь и попробуй поиск ещё раз — шаг можно пропустить.';
    if (m.state === 'ready') return 'Значок справа — откуда трек. Одна и та же песня с разных площадок склеена в одну строку.';
    return 'Тапёр ищет сразу на всех доступных площадках.';
  }

  const step = {
    id: 'search',
    routes: ['listener', 'streamer'],
    label: 'Поиск',
    title: 'Одна строка ищет везде',
    lead: 'Я вписал «Кино — Группа крови». Тапёр нашёл на всех доступных площадках и поставил сверху версии, которые сыграют целиком.',
    header: true,
    footer: false,
    skippable: true,
    render(el, api) {
      el.__wizCurrent = 'search';
      el.__wizSearch = { model: { state: '', played: null }, api: api };
      if (!el.__wizSearchBound) {
        el.__wizSearchBound = true;
        el.addEventListener('click', function (e) {
          if (el.__wizCurrent !== 'search') return;
          const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
          if (!b) return;
          const act = b.dataset.act;
          if (act === 'skip') { api.next(); return; }
          if (act === 'next') { api.next(); return; }
          if (act === 'goLogins') api.cmd({ op: 'do', name: 'wizGoStep', args: { step: 'logins', route: api.route } });
        });
      }
      paint(el);
    },
    onEnter(api) {
      const st = { un: null, unPlayed: null, api: api };
      searchStep.state = st;
      api.cmd({ op: 'do', name: 'wizReset' });
      st.un = api.on('search', function (d) {
        const el = searchStep.el;
        if (!el || el.__wizCurrent !== 'search' || !el.__wizSearch || !d) return;
        const m = el.__wizSearch.model;
        if (typeof d.state === 'string') m.state = d.state;
        if (typeof d.count === 'number') m.count = d.count;
        if (typeof d.canFull === 'boolean') m.canFull = d.canFull;
        if (m.state === 'ready' || m.state === 'no-full') api.cmd({ op: 'highlight', sel: '#results' });
        paint(el);
      });
      st.unPlayed = api.on('played', function (d) {
        const el = searchStep.el;
        if (!el || el.__wizCurrent !== 'search' || !el.__wizSearch) return;
        el.__wizSearch.model.played = { title: (d && d.title) || '' };
        api.cmd({ op: 'clear' });
        paint(el);
      });
      api.cmd({ op: 'do', name: 'searchWatch', args: { on: true } });
      api.cmd({ op: 'do', name: 'searchRun' });
    },
    onLeave() {
      const st = searchStep.state;
      if (st && typeof st.un === 'function') st.un();
      if (st && typeof st.unPlayed === 'function') st.unPlayed();
      searchStep.state = null;
      searchStep.el = null;
      const api = st && st.api;
      if (api) {
        api.cmd({ op: 'do', name: 'searchWatch', args: { on: false } });
        api.cmd({ op: 'clear' });
      }
    }
  };

  const searchStep = { el: null, state: null, step: step };

  function paint(el) {
    searchStep.el = el;
    const box = el.__wizSearch;
    if (!box) return;
    const m = box.model;
    const ready = m.state === 'ready';
    const played = !!m.played;
    let h = '<div class="wiz-sh-page">';

    h += '<div class="wiz-sh-card' + (played ? ' is-done' : '') + (m.state === 'no-full' ? ' is-nofull' : '') + '">'
      + '<span class="wiz-sh-play">' + (played ? '✓' : '▶') + '</span>'
      + '<span class="wiz-sh-big">' + esc(bigText(m)) + '</span>'
      + '</div>';
    h += '<p class="wiz-sh-note">' + esc(noteText(m)) + '</p>';

    if (m.state === 'no-full' && !played) {
      h += '<button class="wiz-sh-back" type="button" data-act="goLogins">Вернуться к «Входам»</button>';
    }

    if (ready && !played) {
      h += '<div class="wiz-sh-tip"><b>Если ничего не играет целиком</b> (нет VPN и нет входа в Яндекс) — '
        + 'здесь будет «Чтобы слушать, войди в Яндекс» и кнопка назад к шагу «Входы».</div>';
    }

    h += '</div>';
    h += '<div class="wiz-sh-foot">'
      + '<button class="wiz-sh-skip" type="button" data-act="skip">Пропустить</button>'
      + '<span class="wiz-sh-grow"></span>'
      // «Дальше» доступна всегда (16.11.2026, слово владельца: не поставил песню — не страшно);
      // после ▶ шаг по-прежнему переходит дальше сам.
      + '<button class="wiz-sh-next" type="button" data-act="next">Дальше</button>'
      + '</div>';
    el.innerHTML = h;
  }

  return { step: step, nextVisible: nextVisible, bigText: bigText, noteText: noteText };
});
