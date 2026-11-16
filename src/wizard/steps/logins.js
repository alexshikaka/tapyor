// Шаг визарда «Входы» (WIZ6-COACH.md). Своих кнопок входа больше нет: шаг — подсказчик,
// он подсвечивает настоящие кнопки Настройки → «Аккаунты» (#setYmBtn / #setYtLogin),
// а переключатели «пользоваться площадкой» — рядом с ними.
// Лампочки площадок — из быстрой проверки Тапёра (quickCheck, канал qc-run уже есть).
// Чистые функции (lamps / onlyYandex / splitSc / loginTasks) проверяет юнит-тест.
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const registry = isNode ? require('../steps.js') : (root && root.WIZARD);
  const api = factory(registry);
  if (isNode) module.exports = api;
  else if (registry && typeof registry.register === 'function') registry.register(api.step);
})(typeof window !== 'undefined' ? window : null, function (registry) {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function stateWord(state) {
    if (!state || state === 'run') return { s: '', t: 'проверяю…' };
    if (state === 'ok') return { s: 'ok', t: 'работает' };
    if (state === 'off') return { s: 'off', t: 'выключено' };
    if (state === 'warn') return { s: 'warn', t: 'работает с оговоркой' };
    return { s: 'warn', t: 'не отвечает — нужен VPN' };
  }

  // quickCheck отдаёт SoundCloud и Audius одной строкой sc. Разделяем по её тексту:
  // «Audius не отвечает» значит SoundCloud жив, и наоборот.
  function splitSc(it) {
    var st = it && it.state ? it.state : '';
    var text = String((it && it.text) || '');
    if (st === 'ok') return { sc: 'ok', au: 'ok' };
    if (st === 'warn') {
      if (/audius\s+не\s+отвечает/i.test(text)) return { sc: 'ok', au: 'warn' };
      if (/soundcloud\s+не\s+отвечает/i.test(text)) return { sc: 'warn', au: 'ok' };
      return { sc: 'warn', au: 'warn' };
    }
    if (st === 'bad' || st === 'off' || st === 'run') return { sc: st, au: st };
    return { sc: '', au: '' };
  }

  // Лампочки четырёх площадок. items — {ymSvc, ytSvc, sc} из быстрой проверки,
  // enabled — {ym, yt} из настроек (ymEnabled / ytEnabled).
  function lamps(items, enabled) {
    var it = items || {}, on = enabled || {};
    var sc = splitSc(it.sc);
    var out = [
      { id: 'ym', name: 'Яндекс Музыка', svc: it.ymSvc, st: (it.ymSvc || {}).state, who: 'ym' },
      { id: 'yt', name: 'YouTube', svc: it.ytSvc, st: (it.ytSvc || {}).state, who: 'yt' },
      { id: 'sc', name: 'SoundCloud', svc: it.sc, st: sc.sc, who: '' },
      { id: 'au', name: 'Audius', svc: it.sc, st: sc.au, who: '' }
    ];
    return out.map(function (l) {
      if (l.who && on[l.who] === false) return { id: l.id, name: l.name, state: 'off', text: 'выключено' };
      var w = stateWord(l.st);
      return { id: l.id, name: l.name, state: w.s, text: w.t };
    });
  }

  // «Доступен только Яндекс»: Яндекс работает, а YouTube, SoundCloud и Audius — нет.
  function onlyYandex(list) {
    var by = {};
    (list || []).forEach(function (l) { by[l.id] = l; });
    if (!by.ym || by.ym.state !== 'ok') return false;
    return ['yt', 'sc', 'au'].every(function (id) { return !by[id] || by[id].state !== 'ok'; });
  }

  function scNote(list) {
    var by = {};
    (list || []).forEach(function (l) { by[l.id] = l; });
    var sc = by.sc || {}, au = by.au || {};
    var dead = [];
    if (sc.state === 'warn') dead.push('SoundCloud');
    if (au.state === 'warn') dead.push('Audius');
    if (dead.length) return 'Работают без входа. Не отвечают: ' + dead.join(' и ') + ' — нужен VPN.';
    return 'Работают без входа.';
  }

  // Задачи шага. Ссылки — на настоящие кнопки раздела Настройки → «Аккаунты»;
  // ни одна не обязательна: без входа поиск работает сразу.
  function loginTasks() {
    return [
      {
        id: 'ym',
        text: 'Войти в Яндекс Музыку',
        sub: 'Моя волна, лайки и твои плейлисты. Можно без входа — поиск работает и так.',
        tab: 'settings',
        pane: 'sAcc',
        sel: '#setYmBtn',
        on: 'none',
        optional: true
      },
      {
        id: 'yt',
        text: 'Войти в YouTube',
        sub: 'Твои плейлисты и лайки. Тоже по желанию.',
        tab: 'settings',
        pane: 'sAcc',
        sel: '#setYtLogin',
        on: 'none',
        optional: true
      }
    ];
  }

  const step = {
    id: 'logins',
    routes: ['listener', 'streamer'],
    label: 'Входы',
    title: 'Откуда будет музыка',
    lead: 'Проверил связь с площадками прямо сейчас:',
    skippable: true,
    render(el, api) {
      el.__wizCurrent = 'logins';
      loginStep.el = el;
      // Повторный вход на шаг: старый подсказчик снимаем, чтобы не осталось подписок.
      if (loginStep.ctl) { try { loginStep.ctl.stop(); } catch (e) {} loginStep.ctl = null; }
      el.innerHTML = '';
      const box = el.__wizLogins = {
        data: { items: null, accounts: {}, enabled: { ym: true, yt: true } },
        api: api,
        status: null,
        coach: null
      };
      // Список задач — сверху, сводка лампочек — под ним.
      if (registry && typeof registry.coach === 'function') {
        box.coach = registry.coach(el, api, { tasks: loginTasks() });
      }
      box.status = document.createElement('div');
      box.status.className = 'wiz-lg-status';
      el.appendChild(box.status);
      loginStep.ctl = box.coach;
      paint(el);
    },
    onEnter(api) {
      const st = { un: null, api: api };
      loginStep.state = st;
      api.cmd({ op: 'do', name: 'wizReset' });
      st.un = api.on('logins', function (d) {
        const el = loginStep.el;
        if (!el || el.__wizCurrent !== 'logins' || !el.__wizLogins || !d) return;
        const model = el.__wizLogins.data;
        if (d.items) model.items = d.items;
        if (d.accounts) model.accounts = d.accounts;
        if (d.enabled) model.enabled = d.enabled;
        paint(el);
      });
      api.cmd({ op: 'do', name: 'loginsCheck' });
    },
    onLeave() {
      const st = loginStep.state;
      if (st && typeof st.un === 'function') st.un();
      if (st && st.api) st.api.cmd({ op: 'do', name: 'loginsWatch', args: { on: false } });
      loginStep.state = null;
      loginStep.el = null;
      if (loginStep.ctl) { try { loginStep.ctl.stop(); } catch (e) {} loginStep.ctl = null; }
    }
  };

  const loginStep = { el: null, state: null, ctl: null, step: step };

  // Задача «Войти» отмечена, только если вход действительно есть: человек мог нажать
  // кнопку и передумать. Поэтому состояние берём из ответа главного окна, а не из клика.
  function syncDone(box) {
    if (!box || !box.coach) return;
    const a = box.data.accounts || {};
    if (a.ym && a.ym.loggedIn) box.coach.done('ym');
    else box.coach.undone('ym');
    if (a.yt && a.yt.name) box.coach.done('yt');
    else box.coach.undone('yt');
  }

  function paint(el) {
    const box = el.__wizLogins;
    if (!box || !box.status) return;
    const d = box.data;
    const list = lamps(d.items, d.enabled);
    const only = onlyYandex(list);

    let h = '<div class="wiz-lg-lamps">' + list.map(function (l) {
      return '<div class="wiz-lg-lamp ' + (l.state || '') + '">'
        + '<i class="wiz-lamp ' + (l.state || '') + '"></i>'
        + '<span class="wiz-lg-name">' + esc(l.name) + '</span>'
        + '<span class="wiz-lg-state">' + esc(l.text) + '</span></div>';
    }).join('') + '</div>';

    h += '<p class="wiz-lg-note">Можно без входа — поиск работает сразу.</p>';
    h += '<p class="wiz-lg-note">' + esc(scNote(list)) + '</p>';
    h += '<p class="wiz-lg-note">Не пользуешься площадкой — выключи переключатель рядом с кнопкой «Войти».</p>';
    if (only) {
      h += '<p class="wiz-lg-note"><b>Сейчас работает только Яндекс Музыка.</b> Войди — и будет играть целиком.</p>';
      h += '<p class="wiz-lg-note">Есть VPN? Включи — откроются YouTube и SoundCloud. Чтобы Яндекс при этом не тормозил — Настройки → «VPN и Яндекс».</p>';
    }
    if (box.api && box.api.route === 'streamer') h += '<p class="wiz-lg-note">Заказы ищутся сначала в Яндексе — без входа заказ из Яндекса не сыграет.</p>';
    box.status.innerHTML = h;
    syncDone(box);
  }

  return {
    step: step,
    tasks: loginTasks,
    lamps: lamps,
    onlyYandex: onlyYandex,
    splitSc: splitSc
  };
});
