  // ===== WZ5: визард стримера — OBS, заказы из чата, финал (14.11.2026) =====
  // Действия шагов визарда в главном окне (команда {op:'do', name, args}) и кнопки «?»
  // у разделов настроек: они открывают визард одним шагом (wizard-open {from:'settings', step}).
  // Ничего своего не дублируем: пробный период пака, Streamer.bot, фон — те же функции, что в окне.
  (function () {
    // Шаги, которые можно открыть отдельно. id — из WIZARD-PLAN.md и WIZ-COMMON.md.
    var STEP_IDS = {
      look: 1, logins: 1, local: 1, search: 1, playlists: 1, queue: 1, livehelp: 1,
      donations: 1, rules: 1, orders: 1, obs: 1, chat: 1
    };

    function app() { return window.app || {}; }

    function emit(evt) {
      if (typeof wizardEmit === 'function') wizardEmit(evt);
    }

    function openStep(step) {
      var id = String(step == null ? '' : step);
      if (!STEP_IDS[id]) return false;
      var A = app();
      if (!A.wizardOpen) return false;
      var r = A.wizardOpen({ from: 'settings', step: id });
      if (r && typeof r.catch === 'function') r.catch(function () {});
      return true;
    }

    // Последний шаг стримера: «Пак стримера — месяц бесплатно» (16.11.2026). Ставим пак, если его нет,
    // и включаем пробный период; открываем раздел «Пак стримера» — там видно, что получилось
    // (ошибку сети и т. п. раздел показывает сам). Тот же путь, что кнопки раздела.
    wizardAction('packTry', function () {
      var A = app();
      try { if (typeof openPackPane === 'function') openPackPane(); else setTab('settings', 'sPack'); } catch (e) {}
      if (typeof pkDo !== 'function' || !A.modStatus) return;
      Promise.resolve(A.modStatus()).catch(function () { return null; }).then(function (st) {
        st = st || {};
        var lic = st.license || {};
        if (lic.enabled) return;   // пак уже работает — ничего не включаем
        var steps = !st.installed && A.packInstall
          ? function () { return A.packInstall().then(function (r) { return r && r.ok === false ? r : A.licTrial(); }); }
          : function () { return A.licTrial(); };
        pkDo(steps, 'Пробный период пака включён: 30 дней');
      });
    });

    // «Настроить» на финале: этот шаг визарда открывается отдельно.
    wizardAction('openStep', function (args) { openStep(args && args.step); });

    // Плейлист для фона: сначала только что собранный в шаге «Плейлисты» (ещё не сохранён),
    // потом последний свой плейлист. Тот же путь, что «Играть фоном» у плейлиста.
    function bgList() {
      try {
        if (typeof imp !== 'undefined' && imp && typeof impIncluded === 'function') {
          var tr = impIncluded().map(function (i) { return i && i.track; }).filter(Boolean);
          if (tr.length) return { src: 'tap', type: 'tap', listId: 'wizbg', title: imp.title || 'Плейлист из текста', tracks: tr };
        }
      } catch (e) { console.warn('визард: собранный плейлист не взят', e); }
      try {
        if (typeof savedLists !== 'undefined' && savedLists && savedLists.length) {
          for (var k = 0; k < savedLists.length; k++) {
            var m = savedLists[k];
            if (m && m.src === 'tap' && m.tracks && m.tracks.length) return m;
          }
        }
      } catch (e) { console.warn('визард: свои плейлисты не прочитаны', e); }
      try {
        if (typeof mySel !== 'undefined' && mySel && mySel.src === 'tap' && mySel.tracks && mySel.tracks.length) return mySel;
      } catch (e) { console.warn('визард: открытый плейлист не взят', e); }
      return null;
    }

    // «Включить фон для эфира»: Моя волна, если вошёл в Яндекс; иначе собранный плейлист.
    wizardAction('streamBg', function () {
      var kind = 'none';
      var title = '';
      var err = '';
      try {
        if (typeof ymLoggedIn !== 'undefined' && ymLoggedIn && typeof setBg === 'function') {
          setBg({ kind: 'wave', station: 'user:onyourwave', name: 'Моя волна' }, true);
          kind = 'wave';
          title = 'Моя волна';
          try { setTab('wave'); } catch (e) {}
        } else {
          var list = bgList();
          if (list && typeof setBg === 'function') {
            setBg({ kind: 'list', list: list, shuffle: false }, true);
            kind = 'list';
            title = list.title || '';
            try { setTab('my'); } catch (e) {}
          } else {
            err = 'Нет ни входа в Яндекс, ни собранного плейлиста';
          }
        }
      } catch (e) {
        kind = 'none';
        err = (e && e.message) || String(e);
      }
      emit({ type: 'bgStarted', kind: kind, title: title, error: err });
    });

    // ── Кнопки «?» у разделов настроек ──────────────────────────────────────
    // Открывают визард одним шагом: wizard-open {from:'settings', step:'<id>'}.
    // Кнопка маленькая, из готового класса .btn.ghost; цвета — переменные темы.
    var HELP = [
      { sel: '#sLook .sec-h', step: 'look', name: 'Оформление' },
      { sel: '#sAcc .sec-h', step: 'logins', name: 'Входы' },
      { sel: '#sStream .sec-h', step: 'donations', name: 'Донаты' },
      { sel: '#sOrders .sec-h', step: 'rules', name: 'Правила заказов' }
    ];

    function helpBtn(step, name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost wiz-help';
      b.setAttribute('data-wiz-step', step);
      b.title = 'Коротко о разделе: ' + name;
      b.setAttribute('aria-label', 'Справка: ' + name);
      b.textContent = '?';
      b.style.minWidth = '32px';
      b.style.height = '28px';
      b.style.padding = '0 10px';
      b.style.marginLeft = '10px';
      return b;
    }
    function addHelp(host, step, name) {
      if (!host) return;
      var has = host.querySelector('[data-wiz-step="' + step + '"]');
      if (has) return;
      host.appendChild(helpBtn(step, name));
    }
    function installHelp() {
      HELP.forEach(function (h) {
        var head = document.querySelector(h.sel);
        if (!head) return;
        // Подпись раздела — прямой <span> в шапке: кнопка встаёт рядом с ней, справа.
        var host = head.querySelector(':scope > span') || head;
        addHelp(host, h.step, h.name);
      });
      var impH = document.querySelector('#myPl .imp-h');
      if (impH) addHelp(impH, 'playlists', 'Импорт плейлистов');
    }
    installHelp();
    // Окно импорта перерисовывается (вход, результат) — «?» нужно поставить заново.
    try {
      var myPl = document.getElementById('myPl');
      if (myPl) new MutationObserver(function () {
        var impH = myPl.querySelector('.imp-h');
        if (impH) addHelp(impH, 'playlists', 'Импорт плейлистов');
      }).observe(myPl, { childList: true, subtree: true });
    } catch (e) { console.warn('визард: кнопка «?» у импорта не поставлена', e); }

    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-wiz-step]') : null;
      if (!b) return;
      e.preventDefault();
      var A = app();
      if (!A.wizardOpen) return;
      var r = A.wizardOpen({ from: 'settings', step: b.getAttribute('data-wiz-step') });
      if (r && typeof r.catch === 'function') r.catch(function () {});
    });
  })();
