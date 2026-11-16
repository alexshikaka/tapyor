// Шаги визарда первого запуска. Один шаг = один объект в WIZARD.steps.
// Поля шага: id, routes, label, title, lead, render(el, api), onEnter(api), onLeave(api),
// skippable. Дополнительные (необязательные): header:false — не рисовать верхнюю строку
// (метку и крестик), footer:false — не рисовать подвал, final:true — последний экран.
// api: cmd({op…}), on(evt, fn), next(), route (текущая ветка), facts (состояние для чек-листа).
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WIZARD = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Финал слушателя — одна главная кнопка по ситуации (WIZARD-PLAN.md, 4.2):
  // вошёл в Яндекс → «Включить Мою волну»; собрал демо-плейлист → «Включить мой плейлист»;
  // иначе → «Найти песню». Демо-плейлист отмечает шаг «Плейлисты» (facts.demo /
  // facts.demoPlaylist / facts.playlists.demo), очередь — ответ главного окна (facts.queue).
  const LISTENER_FINAL = {
    wave: {
      label: '▶ Включить Мою волну',
      hint: 'Моя волна заменит очередь бесконечной музыкой. Характер и настроение всегда можно поменять.'
    },
    list: {
      label: '▶ Включить мой плейлист',
      hint: 'Твой список уже в очереди — включаем его.'
    },
    search: {
      label: 'Найти песню',
      hint: 'Введи название в поиске и нажми ▶.'
    }
  };
  let finalEl = null;      // элемент финала слушателя (для обновления кнопки без перерисовки)
  let finalExtra = null;   // последний ответ главного окна: { ym, queue }
  let finalUnsub = null;   // снятие обработчика ответа при выходе с шага

  function listenerFinalChoice(f) {
    const facts = f && typeof f === 'object' ? f : {};
    const music = facts.music && typeof facts.music === 'object' ? facts.music : {};
    if (music.ym === true || facts.ym === true) return 'wave';
    const demo = facts.demo === true || facts.demoPlaylist === true
      || !!(facts.playlists && facts.playlists.demo === true);
    if (demo || Number(facts.queue) > 0) return 'list';
    return 'search';
  }
  function paintListenerFinal(api) {
    if (!finalEl) return;
    const btn = finalEl.querySelector('.wiz-main');
    if (!btn) return;
    const info = Object.assign({}, (api && api.facts) || {}, finalExtra || {});
    const choice = listenerFinalChoice(info);
    const view = LISTENER_FINAL[choice];
    btn.dataset.final = choice;
    btn.textContent = view.label;
    const hint = finalEl.querySelector('.wiz-final-hint');
    if (hint) hint.textContent = view.hint;
  }

  // Маршруты из WIZARD-PLAN.md, раздел 2. Пока шагов-содержимого нет — только развилка и финал.
  const steps = [
    {
      id: 'fork',
      routes: ['listener', 'streamer'],
      label: '',
      title: 'Привет! Это Тапёр',
      lead: 'Как ты будешь им пользоваться?',
      skippable: false,
      header: false,
      footer: false,
      render(el, api) {
        // Выбор сразу ставит настройки ветки и переходит к финалу.
        el.innerHTML = '<div class="wiz-choices">'
          + '<button class="wiz-fork" data-route="listener">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
          + '<path d="M3 15v-3a9 9 0 0 1 18 0v3"></path><rect x="2.5" y="14" width="5" height="7" rx="1.5"></rect><rect x="16.5" y="14" width="5" height="7" rx="1.5"></rect>'
          + '</svg><span>Я слушаю музыку<br>для себя</span></button>'
          + '<button class="wiz-fork" data-route="streamer">'
          + '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="3"></circle>'
          + '<circle cx="32" cy="19" r="8" fill="currentColor"></circle><circle cx="20.7" cy="38.5" r="8" fill="currentColor"></circle><circle cx="43.3" cy="38.5" r="8" fill="currentColor"></circle></svg>'
          + '<span>Я стример и принимаю<br>музыкальные заказы</span></button>'
          + '</div>'
          + '<p class="wiz-note">Выбор можно поменять в любой момент — Настройки → «Стримерам».</p>';
        el.querySelectorAll('.wiz-fork').forEach((b) => {
          b.onclick = () => {
            const branch = b.dataset.route === 'streamer' ? 'streamer' : 'listener';
            api.route = branch;
            api.cmd({ op: 'set', key: 'streamerMode', value: branch === 'streamer' });
            api.cmd({ op: 'set', key: 'queueMode', value: branch === 'streamer' ? 'live' : 'classic' });
            // Окно развилки стояло поверх Тапёра — теперь уезжает в колонку сбоку (src/main/wizard.js, dock).
            api.cmd({ op: 'dock' });
            document.body.classList.add('wiz-docking');
            setTimeout(() => document.body.classList.remove('wiz-docking'), 500);
            api.next();
          };
        });
      }
    },
    {
      id: 'listener-final',
      routes: ['listener'],
      label: '',
      title: 'Всё готово',
      lead: 'Тапёр настроен под тебя. Всё, что видел, можно поменять в Настройках, а пройти знакомство заново — там же.',
      skippable: false,
      footer: false,
      final: true,
      render(el, api) {
        el.innerHTML = '<div class="wiz-final">'
          + '<div class="wiz-final-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"></path></svg></div>'
          + '<button class="wiz-main" type="button"></button>'
          + '<p class="wiz-final-hint"></p>'
          + '<button class="wiz-link" data-final="close" type="button">Закрыть</button>'
          + '</div>';
        finalEl = el;
        paintListenerFinal(api);
        const btn = el.querySelector('.wiz-main');
        btn.onclick = () => {
          const choice = btn.dataset.final;
          if (choice === 'wave') {
            api.cmd({ op: 'tab', tab: 'wave' });
            api.cmd({ op: 'bg' });
          } else if (choice === 'list') {
            api.cmd({ op: 'tab', tab: 'my' });
          } else {
            api.cmd({ op: 'tab', tab: 'search' });
          }
          api.next();
        };
        el.querySelector('[data-final="close"]').onclick = () => api.next();
      },
      onEnter(api) {
        // Главное окно знает про вход в Яндекс и очередь; финал обновляет кнопку по ответу.
        finalExtra = null;
        paintListenerFinal(api);
        finalUnsub = api.on('listenerstate', function (d) {
          if (!d || typeof d !== 'object') return;
          finalExtra = d;
          paintListenerFinal(api);
        });
        api.cmd({ op: 'do', name: 'listenerState' });
      },
      onLeave() {
        if (finalUnsub) { try { finalUnsub(); } catch (e) {} finalUnsub = null; }
        finalExtra = null;
        finalEl = null;
      }
    },
    {
      id: 'streamer-final',
      routes: ['streamer'],
      label: '',
      title: 'Готов к эфиру',
      lead: 'Вот что настроено. Оранжевое можно доделать сейчас или потом.',
      skippable: false,   // 16.11: обычный подвал «← Назад / Дальше» вместо «Включить фон для эфира»
      final: true,
      render(el, api) {
        const rows = checklistRows(api.facts);
        el.innerHTML = '<div class="wiz-final wiz-final-streamer">'
          + '<div class="wiz-check">' + rows.map((r) => '<div class="wiz-check-row">'
            + (r.lamp === false ? '<span class="wiz-lamp blank"></span>' : '<i class="wiz-lamp ' + r.state + '"></i>')
            + '<span class="wiz-check-name">' + esc(r.name) + '</span>'
            + '<span class="wiz-check-value">' + esc(r.value) + '</span>'
            + (r.fix ? '<button class="wiz-fix" type="button" data-fix="' + esc(r.fix) + '">Настроить</button>' : '')
            + '</div>').join('') + '</div>'
          + '</div>';
        el.querySelectorAll('[data-fix]').forEach((b) => {
          b.onclick = () => api.cmd({ op: 'do', name: 'openStep', args: { step: b.dataset.fix } });
        });
      },
    }
  ];

  // Порядок шагов по веткам (WIZARD-PLAN.md, раздел 2). Шаг, которого ещё нет в коде, пропускается.
  // Новый шаг — свой файл src/wizard/steps/<id>.js, который вызывает WIZARD.register({...}),
  // и строка <script src="steps/<id>.js"> в src/wizard/index.html (между steps.js и wizard.js).
  // В Node (тесты) файл шага берёт реестр так: require('../steps.js').register({...}).
  const ORDER = {
    listener: ['fork', 'look', 'logins', 'local', 'search', 'playlists', 'queue', 'listener-final'],
    streamer: ['fork', 'look', 'logins', 'local', 'search', 'playlists', 'donations', 'rules', 'orders',
      'livehelp', 'obs', 'viewers', 'streamer-final']   // «Заказы из чата» сняты 16.11.2026; «Готов к эфиру» — последний
  };

  // Добавить шаг (из своего файла). Повторный id заменяет прежний.
  function register(step) {
    if (!step || !step.id || !Array.isArray(step.routes)) throw new Error('шаг без id или routes');
    const i = steps.findIndex((s) => s.id === step.id);
    if (i >= 0) steps[i] = step; else steps.push(step);
    return step;
  }

  // Маршрут по ветке: null — только развилка (ветку ещё не выбрали).
  function routeFor(route) {
    const r = route === 'listener' || route === 'streamer' ? route : null;
    if (!r) return steps.filter((s) => s.id === 'fork');
    const order = ORDER[r];
    return steps
      .filter((s) => s.routes.indexOf(r) >= 0)
      .sort((a, b) => {
        const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        return (ia < 0 ? 900 : ia) - (ib < 0 ? 900 : ib);
      });
  }

  // «Подсказчик»: визард не повторяет кнопки Тапёра, а показывает, что нажать в самом Тапёре.
  // coach(el, api, { tasks }) рисует список задач; текущая подсвечена в главном окне
  // (вкладка, раздел Настроек, кнопка/поле). Нажал подсвеченную кнопку или заполнил поле —
  // задача отмечена, подсветка переходит к следующей. Шаг может отметить задачу сам: ctl.done(id)
  // (например, когда главное окно сообщило «DonationAlerts на связи»).
  // Задача: { id, text, sub?, tab?, pane?, sel, on?: 'click'|'fill'|'change'|'none', optional? }
  // sel может быть списком через запятую — подсветится первый найденный (у кнопки бывают разные виды).
  // ctl: { done(id), undone(id), show(id), isDone(id), allDone(), stop() } — stop() вызывать в onLeave.
  function coach(el, api, spec) {
    const tasks = (spec && spec.tasks || []).filter(Boolean);
    const st = { done: Object.create(null), cur: '', missing: '', stopped: false };
    const box = document.createElement('ol');
    box.className = 'wiz-tasks';
    el.appendChild(box);
    function task(id) { return tasks.find((t) => t.id === id) || null; }
    function firstOpen() { return tasks.find((t) => !st.done[t.id]) || null; }
    function paint() {
      if (st.stopped) return;
      box.innerHTML = tasks.map((t, i) => {
        const done = !!st.done[t.id];
        const now = t.id === st.cur && !done;
        return '<li class="wiz-task' + (done ? ' done' : '') + (now ? ' now' : '') + (t.optional ? ' opt' : '') + '" data-task="' + esc(t.id) + '">'
          + '<i class="wiz-task-n" aria-hidden="true">' + (done ? '✓' : String(i + 1)) + '</i>'
          + '<span class="wiz-task-t"><span class="wiz-task-text">' + esc(t.text) + (t.optional ? ' <em>по желанию</em>' : '') + '</span>'
          + (t.sub ? '<span class="wiz-task-sub">' + esc(t.sub) + '</span>' : '')
          + (now && st.missing === t.id ? '<span class="wiz-task-miss">Не вижу это в Тапёре — открой ' + esc(t.where || 'нужный раздел') + ' сам.</span>' : '')
          + '</span>'
          + (t.sel && !now ? '<button type="button" class="wiz-task-show" data-show="' + esc(t.id) + '">Показать</button>' : '')
          + '</li>';
      }).join('');
      box.querySelectorAll('[data-task]').forEach((li) => {
        li.onclick = () => show(li.getAttribute('data-task'));
      });
    }
    function show(id) {
      const t = task(id);
      if (!t || st.stopped) return;
      st.cur = t.id;
      st.missing = '';
      if (t.sel || t.tab) api.cmd({ op: 'highlight', tab: t.tab || '', pane: t.pane || '', sel: t.sel || '' });
      paint();
    }
    function moveOn() {
      const n = firstOpen();
      if (n) show(n.id);
      else { st.cur = ''; api.cmd({ op: 'clear' }); paint(); }
      if (!n && spec && typeof spec.onAllDone === 'function') { try { spec.onAllDone(); } catch (e) {} }
    }
    function done(id) {
      if (!task(id) || st.done[id]) return;
      st.done[id] = true;
      if (st.cur === id || !st.cur) moveOn(); else paint();
    }
    function undone(id) { if (st.done[id]) { delete st.done[id]; paint(); } }
    const offAct = api.on('hlAct', (d) => {
      const t = task(st.cur);
      if (!t || !d || d.sel !== t.sel) return;
      const on = t.on || 'click';
      if (on === 'none') return;
      if (on === 'click' && d.kind === 'click') done(t.id);
      else if (on === 'fill' && (d.kind === 'input' || d.kind === 'change') && d.filled) done(t.id);
      else if (on === 'change' && d.kind === 'change') done(t.id);
    });
    const offMiss = api.on('hlMissing', (d) => {
      const t = task(st.cur);
      if (!t || !d || d.sel !== t.sel) return;
      st.missing = t.id;
      paint();
    });
    (spec && spec.initialDone || []).forEach((id) => { if (task(id)) st.done[id] = true; });
    const start = (spec && spec.start && task(spec.start) && !st.done[spec.start]) ? spec.start : '';
    if (start) show(start); else moveOn();
    return {
      done, undone, show,
      isDone(id) { return !!st.done[id]; },
      allDone() { return tasks.every((t) => t.optional || st.done[t.id]); },
      stop() {
        st.stopped = true;
        try { offAct(); offMiss(); } catch (e) {}
      }
    };
  }

  function stepById(id) { return steps.find((s) => s.id === id) || null; }

  function tierLabel(tier, auto) {
    if (tier === 'money' || tier === 'all') return 'Всё сразу в эфир';
    if (tier === 'equal' || tier === 'manual') return 'Всё через меня';
    return auto ? 'Всё сразу в эфир' : 'Сбалансированно';
  }

  // Чек-лист «Готов к эфиру» — только из настоящих настроек и состояний (факты присылает
  // главный процесс, getFacts в src/main.js). fix — id шага визарда для кнопки «Настроить»;
  // lamp:false — пункт без лампочки (OBS — это просто ссылка в настройки).
  function checklistRows(f) {
    const facts = f && typeof f === 'object' ? f : {};
    const music = facts.music || {};
    const don = facts.donations || {};
    const rules = facts.rules || {};
    const chat = facts.chat || {};
    const pack = facts.pack || {};
    const orders = facts.orders || {};
    const sbot = facts.sbot || {};
    const site = facts.site || {};
    const out = [];

    const platforms = [];
    if (music.ym) platforms.push('Яндекс · вход ✓');
    if (music.yt) platforms.push('YouTube · вход ✓');
    const anyMusic = platforms.length > 0;
    const musicOn = music.ymEnabled !== false || music.ytEnabled !== false;
    out.push({
      name: 'Музыка',
      value: anyMusic ? platforms.join(' · ') : (musicOn ? 'можно без входа' : 'площадки выключены'),
      state: anyMusic ? 'ok' : (musicOn ? 'warn' : 'off'),
      fix: anyMusic ? '' : 'logins'
    });

    const donNames = [];
    if (don.da) donNames.push('DonationAlerts на связи');
    if (don.dp) donNames.push('DonatePay подключён');
    out.push({
      name: 'Донаты',
      value: donNames.length ? donNames.join(' · ') : 'не подключены',
      state: donNames.length ? 'ok' : 'warn',
      fix: donNames.length ? '' : 'donations'
    });

    out.push({ name: 'Правила', value: rules.preset === 'all' ? 'Всё сразу в эфир' : rules.preset === 'balanced' ? 'Сбалансированно' : rules.preset === 'manual' ? 'Всё через меня' : (rules.preset === '' ? 'своя настройка' : tierLabel(rules.tier, rules.auto)), state: 'ok', fix: '' });

    out.push({
      name: 'Заказы проверены',
      value: orders.tested ? 'оба пути ✓' : 'не проверяли',
      state: orders.tested ? 'ok' : 'warn',
      fix: orders.tested ? '' : 'orders'
    });

    // OBS — без лампочки: это не состояние, а подсказка, где настроить.
    out.push({ name: 'OBS', value: 'Настройки → OBS и стрим', state: 'off', fix: '', lamp: false });

    let chatValue = 'не нужны';
    let chatState = 'off';
    if (chat.mode === 'pack') {
      chatValue = 'наш бот' + (pack.state === 'trial' && pack.daysLeft ? ' · пробный, ' + pack.daysLeft + ' дн.' : '');
      chatState = pack.enabled ? 'ok' : 'warn';
    } else if (chat.mode === 'sbot') {
      chatValue = sbot.status === 'ok' ? 'Streamer.bot на связи' : 'Streamer.bot · нет связи';
      chatState = sbot.status === 'ok' ? 'ok' : 'warn';
    }
    out.push({ name: 'Заказы из чата', value: chatValue, state: chatState, fix: '' });   // шага «Заказы из чата» нет (16.11) — «Настроить» не показываем

    out.push({
      name: 'Сайт-визитка',
      value: site.url ? 'готова' : (site.connected ? 'не выложена' : 'по желанию'),
      state: site.url ? 'ok' : 'warn',
      fix: site.url ? '' : 'donations'
    });
    return out;
  }

  return { steps, ORDER, register, routeFor, stepById, tierLabel, checklistRows, listenerFinalChoice, coach, esc };
});
