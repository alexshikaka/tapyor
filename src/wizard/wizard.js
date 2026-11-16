// Окно визарда: показывает шаги из steps.js, держит маршрут и передаёт команды
// главному окну. Вся логика шагов — в steps.js; здесь только рамка и переходы.
'use strict';

(function () {
  const W = window.WIZARD;
  if (!W) return;
  const bridge = window.wizardApi || null;
  const state = { from: 'first', route: null, index: 0, facts: null, started: false, single: false };
  const listeners = Object.create(null);
  const els = {
    head: document.getElementById('wizHead'),
    step: document.getElementById('wizStep'),
    close: document.getElementById('wizClose'),
    title: document.getElementById('wizTitle'),
    lead: document.getElementById('wizLead'),
    body: document.getElementById('wizBody'),
    foot: document.getElementById('wizFoot'),
    skip: document.getElementById('wizSkip'),
    back: document.getElementById('wizBack'),
    next: document.getElementById('wizNext')
  };

  function currentList() { return W.routeFor(state.route); }
  function currentStep() { return currentList()[state.index] || null; }

  const api = {
    facts: null,
    cmd(payload) { if (bridge && bridge.cmd) bridge.cmd(payload || {}); },
    on(evt, fn) {
      if (typeof fn !== 'function') return function () {};
      const key = String(evt || '');
      (listeners[key] = listeners[key] || []).push(fn);
      return function () {
        const a = listeners[key];
        if (!a) return;
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
      };
    },
    next() { advance(); },
    back() { goBack(); },
    close() { closeWizard(); }
  };
  Object.defineProperty(api, 'route', {
    get() { return state.route; },
    set(v) {
      state.route = v === 'listener' || v === 'streamer' ? v : null;
      const list = currentList();
      if (state.index >= list.length) state.index = Math.max(0, list.length - 1);
    }
  });

  function fire(evt, data) {
    const a = listeners[evt];
    if (!a) return;
    a.slice().forEach((fn) => { try { fn(data); } catch (e) { console.warn('визард: обработчик события', e); } });
  }

  // Тему присылает главное окно: те же переменные, шрифт и классы оболочки.
  function applyTheme(t) {
    if (!t || typeof t !== 'object') return;
    if (typeof t.className === 'string') document.documentElement.className = t.className;
    if (t.vars && typeof t.vars === 'object') {
      for (const k of Object.keys(t.vars)) {
        if (!/^--[a-z0-9-]+$/i.test(k)) continue;
        const v = t.vars[k];
        if (typeof v === 'string' && v) document.documentElement.style.setProperty(k, v);
      }
    }
    if (typeof t.font === 'string' && t.font) document.documentElement.style.setProperty('--wiz-font', t.font);
    if (typeof t.fontSize === 'string' && t.fontSize) document.body.style.fontSize = t.fontSize;
  }

  function render() {
    const step = currentStep();
    if (!step) return;
    els.head.hidden = step.header === false;
    els.step.textContent = step.label ? ('Шаг ' + (state.index + 1) + ' · ' + step.label) : '';
    els.step.hidden = !step.label;
    els.close.hidden = step.closable === false;
    els.title.textContent = step.title || '';
    els.lead.textContent = step.lead || '';
    els.lead.hidden = !step.lead;
    // Подвал есть на всех шагах, кроме развилки: «Назад» нужен и там, где у шага свои кнопки.
    // footer:false убирает только «Пропустить» и «Дальше».
    const canBack = !state.single && state.index > 0;
    els.foot.hidden = step.footer === false && !canBack;
    els.back.hidden = !canBack;
    els.next.hidden = step.footer === false;
    els.skip.hidden = step.footer === false || step.skippable === false;
    // Один шаг из настроек: после него визард закрывается, «Дальше» становится «Готово».
    // На последнем шаге маршрута «Дальше» закрывает визард — подписываем «Готово»
    els.next.textContent = (state.single || state.index === currentList().length - 1) ? 'Готово' : 'Дальше';
    els.body.innerHTML = '';
    els.body.scrollTop = 0;
    // Шаг — на <body>: широкая раскладка развилки в wizard.css относится только к ней
    document.body.setAttribute('data-step', step.id);
    try { step.render(els.body, api); } catch (e) { console.error('визард: шаг «' + step.id + '»', e); }
    if (typeof step.onEnter === 'function') { try { step.onEnter(api); } catch (e) { console.warn('визард: onEnter', e); } }
  }

  function leave() {
    const step = currentStep();
    if (step && typeof step.onLeave === 'function') { try { step.onLeave(api); } catch (e) { console.warn('визард: onLeave', e); } }
  }

  function closeWizard() {
    leave();
    if (bridge && bridge.close) bridge.close();
    else { try { window.close(); } catch (e) {} }
  }

  function advance() {
    leave();
    if (bridge && bridge.cmd) bridge.cmd({ op: 'clear' });
    if (state.single) { closeWizard(); return; }
    const list = currentList();
    if (state.index + 1 < list.length) {
      state.index += 1;
      render();
      return;
    }
    closeWizard();
  }

  function goBack() {
    if (state.single || state.index <= 0) return;
    leave();
    if (bridge && bridge.cmd) bridge.cmd({ op: 'clear' });
    state.index -= 1;
    render();
  }

  function start(init) {
    const d = init && typeof init === 'object' ? init : {};
    // Окно уже что-то показывает (шаг из настроек или «Настроить» на финале):
    // закрываем текущий шаг, чтобы он снял свои подписки, и только потом переключаемся.
    if (state.started) leave();
    state.from = d.from === 'settings' || d.from === 'debug' ? d.from : 'first';
    let route = d.route === 'listener' || d.route === 'streamer' ? d.route : null;
    const stepId = typeof d.step === 'string' ? d.step : '';
    if (!route && stepId) {
      const s = W.stepById(stepId);
      if (s && s.routes && s.routes.length) route = s.routes[0];
    }
    state.route = route;
    // Одна часть визарда из Настроек («?» у раздела): шаг открыт отдельно, после него закрываемся.
    // «Пройти знакомство заново» приходит без step и ведёт весь маршрут.
    state.single = state.from === 'settings' && !!stepId;
    if (d.facts) state.facts = d.facts;
    api.facts = state.facts;
    const list = currentList();
    state.index = 0;
    if (stepId) {
      const i = list.findIndex((s) => s.id === stepId);
      if (i >= 0) state.index = i;
    }
    state.started = true;
    render();
  }

  function onEvent(d) {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'theme') { applyTheme(d.theme); return; }
    if (d.type === 'init' || d.type === 'open') { start(d); return; }
    if (d.type === 'facts') {
      state.facts = d.facts || null;
      api.facts = state.facts;
      const step = currentStep();
      if (state.started && step && step.final) {
        els.body.innerHTML = '';
        try { step.render(els.body, api); } catch (e) { console.warn('визард: чек-лист', e); }
      }
      return;
    }
    if (d.type) fire(d.type, d);
  }

  els.close.onclick = closeWizard;
  els.next.onclick = advance;
  els.skip.onclick = advance;
  if (els.back) els.back.onclick = goBack;

  if (bridge && bridge.onEvent) bridge.onEvent(onEvent);

  // Если главное окно почему-то не прислало init — показываем развилку сами.
  const q = new URLSearchParams(location.search);
  const fallback = {
    from: q.get('from') || 'first',
    step: q.get('step') || '',
    route: q.get('route') || ''
  };
  setTimeout(() => { if (!state.started) start(fallback); }, 400);
})();
