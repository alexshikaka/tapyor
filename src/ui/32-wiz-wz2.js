  // ===== Визард первого запуска: шаги WZ2 (Оформление, Входы, Музыка с компьютера, Поиск,
  // Плейлисты). Окно визарда шлёт команды {op:'do', name, args} (см. src/ui/31-wizard.js),
  // а сюда приходят ответы через wizardEmit({type:'...'}) → событие шага api.on(...).
  // Никаких новых каналов IPC: только существующие функции Тапёра (вход, поиск, импорт,
  // библиотека, темы). Цвета нигде не задаются — тему применяют существующие applyTheme/applySkin.
  (function () {
    var A = window.app || {};
    var W = {
      loginsTimer: null,
      qcBound: false,
      libBound: false,
      localWatch: false,
      searchWatch: false,
      importWatch: false,
      importTimer: null,
      importBound: false,
      mediaBound: false,
      lastAccounts: '',
      lastImportDone: -1,
      lastImportTotal: -1,
      playedKey: '',
      searchToken: 0
    };

    function emit(evt) { try { wizardEmit(evt || {}); } catch (e) {} }
    function qcItems() { return (typeof QC !== 'undefined' && QC && QC.items) ? QC.items : {}; }
    function platformItems() {
      var q = qcItems();
      return { ymSvc: q['ym.svc'] || null, ytSvc: q['yt.svc'] || null, sc: q['sc'] || null };
    }
    function enabledNow() {
      return {
        ym: typeof SVC === 'undefined' ? true : SVC.ymOn !== false,
        yt: typeof SVC === 'undefined' ? true : SVC.ytOn !== false
      };
    }
    // Есть ли площадка, которая отвечает (для текста «онлайн-площадки недоступны» и демо).
    function webNow() {
      var q = qcItems();
      if (!q['ym.svc'] && !q['yt.svc'] && !q.sc) return true;   // проверки ещё не было — не пугаем
      var ym = q['ym.svc'], yt = q['yt.svc'], sc = q.sc;
      if (ym && (ym.state === 'ok' || ym.state === 'warn')) return true;
      if (yt && yt.state === 'ok') return true;
      if (sc && (sc.state === 'ok' || sc.state === 'warn')) return true;
      return false;
    }
    function libCount() { return (typeof LIB !== 'undefined' && LIB && LIB.count) ? LIB.count : 0; }
    function canDemoNow() {
      if (libCount() > 0) return true;                          // музыка с компьютера есть — демо покажем
      return webNow();
    }

    // ── Оформление ────────────────────────────────────────────────────────────
    // Своих образцов тем в визарде больше нет: шаг подсвечивает настоящую карточку
    // оформления. Выбор делает сам Тапёр, визарду ничего применять не нужно.

    // ── Входы ─────────────────────────────────────────────────────────────────
    function accountsNow() {
      var ymP = A.ymStatus ? A.ymStatus().catch(function () { return null; }) : Promise.resolve(null);
      var ytP = A.ytAuthStatus ? A.ytAuthStatus().catch(function () { return null; }) : Promise.resolve(null);
      return Promise.all([ymP, ytP]).then(function (r) {
        var ym = r[0] || {}, yt = r[1] || null, yName = '';
        if (yt) {
          if (yt.cookies && yt.cookies.name) yName = yt.cookies.name;
          else if (yt.oauth && yt.oauth.account && yt.oauth.account.name) yName = yt.oauth.account.name;
        }
        return {
          ym: {
            loggedIn: !!ym.loggedIn,
            hasPlus: !!(ym.loggedIn && (ym.hasPlus || ym.offline)),
            name: ym.name || ym.login || ''
          },
          yt: { name: yName }
        };
      });
    }
    function emitAccounts() {
      accountsNow().then(function (acc) {
        var sig = JSON.stringify(acc);
        if (sig === W.lastAccounts) return;
        W.lastAccounts = sig;
        emit({ type: 'logins', accounts: acc });
      }).catch(function () {});
    }
    // Пункт быстрой проверки пришёл — сообщаем лампочкам сразу, не дожидаясь конца.
    function bindQc() {
      if (W.qcBound || !A.onQcItem) return;
      W.qcBound = true;
      A.onQcItem(function (it) {
        if (!it || !/^(ym\.svc|yt\.svc|sc)$/.test(String(it.id || ''))) return;
        emit({ type: 'logins', items: platformItems() });
      });
    }
    function startLoginsWatch() {
      if (W.loginsTimer) return;
      W.loginsTimer = setInterval(function () { emitAccounts(); }, 2500);
    }
    wizardAction('loginsCheck', function () {
      bindQc();
      // Шаг открыли заново — состояние входа нужно прислать ещё раз, даже если оно не менялось.
      W.lastAccounts = '';
      emit({ type: 'logins', items: platformItems(), enabled: enabledNow() });
      emitAccounts();
      if (A.qcRun) {
        A.qcRun().then(function () {
          if (typeof QC !== 'undefined' && QC && QC.items) QC.items = QC.items || QC.items;
          emit({ type: 'logins', items: platformItems(), enabled: enabledNow() });
          emitAccounts();
          startLoginsWatch();
        }, function () { startLoginsWatch(); });
      } else {
        startLoginsWatch();
      }
    });
    wizardAction('loginsWatch', function (a) {
      if (a && a.on === false) { clearInterval(W.loginsTimer); W.loginsTimer = null; }
      else startLoginsWatch();
    });
    // Кнопки «Войти» и «Не пользуюсь» живут только в Настройках → «Аккаунты»:
    // визард их подсвечивает и узнаёт состояние из accountsNow выше.

    // ── Музыка с компьютера ───────────────────────────────────────────────────
    function statusNow() {
      if (A.libStatus) return A.libStatus().catch(function () { return null; });
      return Promise.resolve(null);
    }
    function emitLocal(progress) {
      statusNow().then(function (st) {
        var evt = { type: 'local', web: webNow() };
        if (st) {
          evt.status = {
            count: Number(st.count) || 0,
            folders: (st.folders || []).map(function (f) { return { path: f.path, count: Number(f.count) || 0 }; })
          };
        } else if (typeof LIB !== 'undefined') {
          evt.status = { count: Number(LIB.count) || 0, folders: (LIB.folders || []).map(function (f) { return { path: f.path, count: Number(f.count) || 0 }; }) };
        }
        if (progress) evt.progress = progress;
        emit(evt);
      });
    }
    function bindLib() {
      if (W.libBound) return;
      W.libBound = true;
      if (A.onLibProgress) A.onLibProgress(function (p) {
        if (!W.localWatch || !p) return;
        emit({
          type: 'local',
          progress: { done: Number(p.done) || 0, total: Number(p.total) || 0, finished: !!p.finished },
          web: webNow()
        });
        if (p.finished) emitLocal();
      });
      // Папку добавили/убрали в Настройках — главное окно сообщает об этом событием lib-*.
      if (A.onLibChanged) A.onLibChanged(function () {
        if (W.localWatch) emitLocal();
      });
    }
    wizardAction('localWatch', function (a) {
      W.localWatch = !(a && a.on === false);
      if (!W.localWatch) return;
      bindLib();
      var p = null;
      if (typeof LIB !== 'undefined' && LIB.scanning) p = { done: LIB.scanning.done || 0, total: LIB.scanning.total || 0, finished: false };
      emitLocal(p);
    });
    // Кнопка «Добавить папку…» живёт в Настройках → «Музыка с компьютера» (#setLibAdd):
    // визард её подсвечивает, а о добавленных папках узнаёт из emitLocal выше.

    // ── Поиск ─────────────────────────────────────────────────────────────────
    function resultRows() {
      var res = document.getElementById('results');
      return res ? res.querySelectorAll('.row').length : 0;
    }
    // Сыграет ли хоть что-то целиком: Яндекс с Плюсом, YouTube (есть VPN) или SoundCloud/Audius.
    function canFullNow() {
      var q = qcItems();
      if (typeof ymLoggedIn !== 'undefined' && ymLoggedIn) {
        if (typeof ymPlus === 'undefined' || ymPlus) return true;
      }
      var yt = q['yt.svc'], sc = q.sc;
      if (typeof ytUsable === 'function' && ytUsable() && !(yt && yt.state === 'bad')) return true;
      if (!sc) return true;                       // проверки ещё не было — не пугаем «войди»
      return sc.state === 'ok' || sc.state === 'warn';
    }
    function trackTitle(t) {
      if (!t) return '';
      return (t.author ? t.author + ' — ' : '') + (t.title || '');
    }
    function onPlayed() {
      var t = (typeof curTrack !== 'undefined') ? curTrack : null;
      var key = '';
      try { key = t ? (srcOf(t) + ':' + t.id) : ''; } catch (e) { key = ''; }
      if (key && key === W.playedKey) return;
      W.playedKey = key || String(Date.now());
      emit({ type: 'played', title: trackTitle(t) });
    }
    // «Трек заиграл» — общий звук окна. Медиасобытия не всплывают, но в фазе перехвата их видно.
    function watchMedia() {
      if (W.mediaBound) return;
      W.mediaBound = true;
      document.addEventListener('playing', function () { if (W.searchWatch) onPlayed(); }, true);
      if (A.onYmwebState) A.onYmwebState(function (d) { if (W.searchWatch && d && d.ev === 'play') onPlayed(); });
    }
    wizardAction('searchWatch', function (a) {
      W.searchWatch = !(a && a.on === false);
      if (W.searchWatch) { W.playedKey = ''; watchMedia(); }
    });
    wizardAction('searchRun', function () {
      W.searchToken += 1;
      var tok = W.searchToken;
      W.playedKey = '';
      watchMedia();
      try { setTab('search'); } catch (e) {}
      try {
        if (typeof search !== 'undefined' && search) search.value = 'Кино — Группа крови';
        if (typeof hideSuggest === 'function') hideSuggest();
      } catch (e) {}
      emit({ type: 'search', state: 'waiting' });
      var q = null;
      try { q = typeof doSearch === 'function' ? doSearch() : null; } catch (e) { q = null; }
      Promise.resolve(q).then(function () {
        setTimeout(function () { if (tok !== W.searchToken) return; afterSearch(tok); }, 250);
      }, function () {
        if (tok !== W.searchToken) return;
        emit({ type: 'search', state: 'error' });
      });
    });
    function afterSearch(tok) {
      var rows = resultRows();
      var q = qcItems();
      var netBad = !!(q.net && q.net.state === 'bad');
      if (netBad) { emit({ type: 'search', state: 'offline', count: rows }); return; }
      if (rows > 0) { emit({ type: 'search', state: canFullNow() ? 'ready' : 'no-full', count: rows, canFull: canFullNow() }); return; }
      // Поздние площадки (SoundCloud, Audius) отвечают дольше — даём им время.
      setTimeout(function () {
        if (tok !== W.searchToken) return;
        var rows2 = resultRows();
        if (rows2 > 0) emit({ type: 'search', state: canFullNow() ? 'ready' : 'no-full', count: rows2, canFull: canFullNow() });
        else emit({ type: 'search', state: 'empty', count: 0 });
      }, 1400);
    }

    // ── Плейлисты (демо импорта) ──────────────────────────────────────────────
    function importHost() { return document.getElementById('myPl'); }
    function stopped() { return typeof imp === 'undefined' || !imp || !Array.isArray(imp.items); }
    function stopImportTimer() { clearInterval(W.importTimer); W.importTimer = null; }
    function importTick() {
      if (!W.importWatch || stopped()) return;
      var total = imp.items.length;
      if (!total) return;
      var done = Number(imp.done) || 0;
      if (done !== W.lastImportDone || total !== W.lastImportTotal) {
        W.lastImportDone = done;
        W.lastImportTotal = total;
        emit({ type: 'import', stage: 'progress', done: done, total: total });
      }
      if (done < total) return;
      stopImportTimer();
      var inc = typeof impIncluded === 'function' ? impIncluded() : [];
      var previews = 0;
      try { previews = typeof impIsPreview === 'function' ? inc.filter(impIsPreview).length : 0; } catch (e) { previews = 0; }
      emit({ type: 'import', stage: 'done', found: inc.length, previews: previews, total: total });
    }
    function bindImport() {
      if (W.importBound) return;
      var host = importHost();
      if (!host) return;
      W.importBound = true;
      host.addEventListener('input', function (e) {
        if (!W.importWatch || !e.target || e.target.id !== 'impPaste') return;
        var n = typeof impLines === 'function' ? impLines(e.target.value).length : 0;
        emit({ type: 'import', stage: 'pasted', n: n });
      });
    }
    wizardAction('importInfo', function () {
      emit({ type: 'import', stage: 'info', canDemo: canDemoNow() });
    });
    wizardAction('importOpen', function () {
      try { setTab('my'); } catch (e) {}
      try { impTab = 'text'; impSrc = null; } catch (e) {}
      if (typeof openImport === 'function') openImport();
    });
    wizardAction('importWatch', function (a) {
      W.importWatch = !(a && a.on === false);
      if (!W.importWatch) { stopImportTimer(); return; }
      bindImport();
      W.lastImportDone = -1;
      W.lastImportTotal = -1;
      if (W.importTimer) return;
      W.importTimer = setInterval(importTick, 500);
      importTick();
    });
    wizardAction('importPaste', function (a) {
      var ta = document.getElementById('impPaste');
      if (!ta) return;
      ta.value = String((a && a.text) || '');
      // Для окна импорта это такая же вставка, как Ctrl+V: показываем «✓ Вставлено N строк».
      try { impPasted = true; } catch (e) {}
      try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      try { ta.focus(); } catch (e) {}
    });
    wizardAction('importPlay', function () {
      if (stopped() || typeof impIncluded !== 'function') { emit({ type: 'import', stage: 'noplay' }); return; }
      var inc = impIncluded();
      if (!inc.length) { emit({ type: 'import', stage: 'noplay' }); return; }
      var tracks = inc.map(function (i) { return slimTrack(i.track); });
      var title = (imp.title && imp.title !== 'Плейлист из текста') ? imp.title : 'Хиты всех времён';
      var thumb = '';
      for (var k = 0; k < tracks.length; k++) { if (tracks[k].thumb) { thumb = tracks[k].thumb; break; } }
      var meta = {
        src: 'tap', type: 'text', listId: 'tpwiz' + Date.now() + Math.floor(Math.random() * 1000),
        title: title, author: 'Из текста', count: tracks.length, thumb: thumb, tracks: tracks
      };
      if (typeof savedLists !== 'undefined' && Array.isArray(savedLists)) {
        savedLists.unshift(slim(meta));
        meta = savedLists[0];
        if (A.setSetting) A.setSetting('savedLists', savedLists);
      }
      // «Играть» в классике заменяет очередь, «Играть фоном» в живой очереди ставит плейлист фоном.
      if (typeof setBg === 'function') setBg({ kind: 'list', list: meta, shuffle: false }, true);
      emit({ type: 'import', stage: 'playing', count: tracks.length });
    });

    // Переход визарда на другой шаг (кнопка «Вернуться к Входам»). Окно уже открыто —
    // главный процесс пришлёт ему событие open, и оно отрисует нужный шаг.
    wizardAction('wizGoStep', function (a) {
      var step = a && typeof a.step === 'string' ? a.step : '';
      var route = a && (a.route === 'listener' || a.route === 'streamer') ? a.route : undefined;
      if (!step || !A.wizardOpen) return;
      A.wizardOpen({ from: 'first', step: step, route: route }).catch(function () {});
    });

    // Новый шаг визарда: гасим слежение прошлого. Каркас при переходе по событию open
    // не зовёт onLeave, поэтому каждый шаг начинает с этого действия (см. steps/*.js).
    wizardAction('wizReset', function () {
      W.searchWatch = false;
      W.localWatch = false;
      W.importWatch = false;
      W.playedKey = '';
      stopImportTimer();
      clearInterval(W.loginsTimer);
      W.loginsTimer = null;
    });
  })();
