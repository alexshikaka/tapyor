  // ===== Модуль «Пульт с телефона» (пак стримера) — docs/REMOTE.md =====
  // Окно настроек: QR, состояние связи, кнопки start/renew/stop и режим Wi-Fi.
  // Вся логика сессии — в модуле пака, здесь только команды A.modCmd('remote', …).
  // Опрос status — раз в 2 с и только пока раздел правда открыт (иначе — ни одного запроса).
  var RM = { st: null, status: null, busy: false, timer: 0 };

  function rmModule(){ return RM.st && RM.st.modules && RM.st.modules.remote; }
  function rmVisible(){ return !!(RM.st && RM.st.installed && rmModule()); }
  function rmRunning(){ var m = rmModule(); return !!(m && m.running); }
  function rmPanel(){ return $('rmPanel'); }
  function rmPane(){ return $('sRemote'); }

  function rmSleep(){ if (RM.timer) { clearInterval(RM.timer); RM.timer = 0; } }
  function rmOpen(){
    var sec = rmPane();
    if (!sec || sec.hidden || !rmVisible() || !rmRunning()) return false;
    if (document.body.classList.contains('no-streamer')) return false;   // A38 M1: «Стримерам» выключено — не опрашиваем
    return window.curTab === 'settings';
  }
  function rmWake(){
    if (RM.timer) return;
    RM.timer = setInterval(function(){
      if (!rmOpen()) { rmSleep(); return; }
      rmPoll();
    }, 2000);
  }

  function rmMenu(){
    var b = $('goRemote');
    if (b) {
      b.hidden = !rmVisible();
      var off = rmVisible() && !rmRunning();
      b.classList.toggle('off', off);
      b.title = off ? ((rmModule() && rmModule().error) || 'Модуль не запущен') : '';
    }
    if (!rmVisible()) rmSleep();
  }

  function rmStateText(s, mod){
    var state = String((s && s.state) || ((s && s.qrSvg) ? 'waiting' : 'idle'));
    if (state === 'connected') {
      var ago = s && s.phoneAgo;
      if (ago == null) return 'Телефон подключён';
      return 'Телефон подключён · ' + Math.max(0, Math.round(Number(ago) / 1000)) + ' с назад';
    }
    if (state === 'waiting') return 'Жду телефон — наведи камеру на код';
    if (state === 'lost') return 'Связь потеряна…';
    if (state === 'starting') return 'Подключаю…';
    if (state === 'error') return 'Ошибка модуля: ' + ((s && s.error) || (mod && mod.error) || 'неизвестная');
    return 'Не подключён';
  }
  function rmDotCls(s){
    var state = String((s && s.state) || ((s && s.qrSvg) ? 'waiting' : 'idle'));
    if (state === 'connected') return 'on';
    if (state === 'waiting' || state === 'starting' || state === 'lost') return 'wait';
    return '';
  }

  function rmCopy(text, msg){
    if (!text) return;
    var done = function(){ toast(msg); };
    var fallback = function(){
      try {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove(); done();
      } catch (e) { prompt('Скопируй:', text); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function rmLanAddr(lan){
    if (lan && lan.url) return String(lan.url);
    if (lan && lan.ip) return 'http://' + lan.ip + (lan.port ? ':' + lan.port : '');
    return '';
  }

  // Режим Wi-Fi: переключатель, адрес ПК, сеть, выбор адреса и подсказки по docs/REMOTE.md.
  function rmLanHtml(s, lan){
    var lanOn = !!(lan && lan.on);
    var h = '<div class="srow">' +
      '<div class="sl"><div class="st">Как подключать телефон</div><div class="sd">Через облако Тапёра или напрямую по домашнему Wi-Fi</div></div>' +
      '<div class="seg" id="rmMode" role="group" aria-label="Способ подключения телефона">' +
        '<button data-rm-mode="cloud"' + (lanOn ? '' : ' class="on"') + ' aria-pressed="' + (lanOn ? 'false' : 'true') + '">Через интернет</button>' +
        '<button data-rm-mode="lan"' + (lanOn ? ' class="on"' : '') + ' aria-pressed="' + (lanOn ? 'true' : 'false') + '">По Wi-Fi</button>' +
      '</div></div>';
    if (!lanOn) {
      h += '<div class="bot-note">Облако не требует общей сети — телефон может быть где угодно. Ссылка и QR шифруются ключом, который знает только этот ПК и телефон.</div>';
      return h;
    }
    var addr = rmLanAddr(lan), net = String((lan && lan.net) || ''), ip = String((lan && lan.ip) || '');
    h += '<div class="rm-lan">';
    h += '<div class="rm-row"><div class="rm-grow"><div class="sd">Адрес ПК в домашней сети</div><div class="rm-big mono">' + esc(addr || 'не найден') + '</div></div>' +
      (addr ? '<button class="btn ghost" data-rm-copy="url">Скопировать</button>' : '') + '</div>';
    h += '<div class="rm-row"><div class="rm-grow"><div class="sd">Сеть для исключений</div><div class="rm-net mono">' + esc(net || 'не найдена') + '</div></div>' +
      (net ? '<button class="btn ghost" data-rm-copy="net">Скопировать</button>' : '') + '</div>';
    var addrs = (lan && Array.isArray(lan.addrs)) ? lan.addrs.filter(function(a){ return a && a.ip; }) : [];
    if (addrs.length > 1) {
      h += '<div class="srow"><div class="sl"><div class="st">Адрес</div><div class="sd">У ПК несколько сетей — выбери ту, в которой телефон</div></div>' +
        '<div class="seg" id="rmAddrs" role="group" aria-label="Адрес ПК в домашней сети">' +
        addrs.map(function(a){
          var on = String(a.ip) === ip;
          return '<button data-rm-ip="' + esc(a.ip) + '"' + (on ? ' class="on"' : '') + ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
            esc(a.ip) + (a.name ? ' · ' + esc(a.name) : '') + '</button>';
        }).join('') + '</div></div>';
    }
    h += '</div>';

    // Подсказки — только те, что относятся к делу (пункты 2–5 раздела «Режим Wi-Fi»).
    var vpn = (lan && lan.vpn) || {};
    // VPN — главная причина «телефон не подключается» по Wi-Fi: заметной плашкой акцентом (16.11, владелец)
    h += '<div class="bot-note rm-vpn"><b>VPN на телефоне и на ПК может блокировать прямое подключение.</b> ' +
      (vpn.pc ? 'На этом ПК сейчас включён VPN' + (vpn.names && vpn.names.length ? ' (' + esc(vpn.names.join(', ')) + ')' : '') + '. ' : '') +
      'Если телефон не подключается: на ПК — добавь в исключения VPN (split tunneling) программу Тапёр или сеть ' +
      (net ? '<span class="mono">' + esc(net) + '</span>' : 'домашней сети') + ', либо включи в VPN «Разрешить локальную сеть»; ' +
      'на телефоне — включи в VPN «Разрешить локальную сеть» или добавь в исключения адрес ' +
      (ip ? '<span class="mono">' + esc(ip) + '</span>' : 'ПК') + '. Или просто выключи VPN на время, либо подключись «Через интернет».' +
      (net ? '<div class="bot-pair" style="margin-top:8px"><button class="btn ghost" data-rm-copy="net">Скопировать сеть</button></div>' : '') + '</div>';
    if (lan && lan.selfOk === false) {
      h += '<div class="bot-note warn"><b>Сервер не отвечает по домашнему адресу:</b> мешает VPN на ПК или брандмауэр. Проверь подсказки ниже.</div>';
    }
    h += '<div class="bot-note">При первом включении Windows спросит разрешение на доступ к сети — нажми «Разрешить» для частных сетей.</div>';
    if (lan && lan.publicNet === true) {
      h += '<div class="bot-note warn">Сеть в Windows помечена «Общедоступная» — смени её на «Частная»: Параметры → Сеть и Интернет → Wi-Fi → Свойства → Частная сеть.</div>';
    }
    return h;
  }

  function rmRender(){
    var box = rmPanel(); if (!box) return;
    rmMenu();
    if (!RM.st) { box.className = 'bot-body'; box.innerHTML = '<div class="bot-note">Проверяю модуль…</div>'; return; }
    var mod = rmModule();
    var hint = typeof packModuleHint === 'function' ? packModuleHint('Пульт с телефона', RM.st, 'remote') : '';
    if (hint) { box.className = 'bot-body'; box.innerHTML = hint; return; }
    if (!mod) { box.className = 'bot-body'; box.innerHTML = '<div class="bot-note">Пульт с телефона входит в пак стримера, но в установленной версии пака его нет.</div>'; return; }
    var running = rmRunning();
    box.className = 'bot-body' + (running ? '' : ' off');
    if (!running) {
      box.innerHTML = '<div class="bot-note"><b>Пульт не запустился.</b> ' +
        esc((mod.error || 'Модуль пака не работает — перезапусти Тапёр или обнови пак.')) + '</div>';
      return;
    }
    var s = RM.status || {};
    var state = String(s.state || (s.qrSvg ? 'waiting' : 'idle'));
    var qr = String(s.qrSvg || '');
    var lan = s.lan;

    var h = '<div class="rm-qr">';
    if (qr && qr.indexOf('<svg') === 0) h += '<div class="rm-qr-box" id="rmQr">' + qr + '</div>';
    else h += '<div class="rm-qr-box rm-qr-ph" id="rmQr"><span class="sd">QR-код появится, когда модуль будет ждать телефон</span></div>';
    h += '<div class="rm-qr-side">';
    h += '<div class="rm-state"><span class="rm-dot ' + rmDotCls(s) + '"></span>' + esc(rmStateText(s, mod)) + '</div>';
    h += '<div class="sd">Наведи камеру телефона на код. Откроется страница пульта, ставить ничего не нужно.</div>';
    // Ссылка — та же, что в QR: её можно отправить себе на телефон (16.11, владелец)
    if (s.url) {
      h += '<div class="rm-link"><div class="sd">Или открой эту ссылку на телефоне — например, отправь её себе в мессенджер:</div>' +
        '<div class="rm-row"><span class="path mono rm-grow" id="rmLink">' + esc(s.url) + '</span>' +
        '<button class="btn ghost" data-rm-copy="link">Скопировать ссылку</button></div></div>';
    }
    if (state === 'error') h += '<div class="bot-note warn">' + esc((s.error || (mod && mod.error) || 'Модуль не смог создать сессию.')) + '</div>';
    h += '<div class="bot-note warn">Не показывай этот код и ссылку на стриме: кто их получит, тот сможет управлять плеером.</div>';
    h += '<div class="bot-pair">' +
      '<button class="btn" id="rmStart" data-rm="start">Подключить телефон</button>' +
      '<button class="btn ghost" id="rmRenew" data-rm="renew">Новая ссылка</button>' +
      '<button class="btn ghost" id="rmStop" data-rm="stop">Отключить телефон</button>' +
      '</div>';
    h += '</div></div>';

    if (lan && typeof lan === 'object') h += rmLanHtml(s, lan);
    box.innerHTML = h;
  }

  async function rmPoll(force){
    if (!rmRunning()) { RM.status = null; rmRender(); return; }
    if (RM.busy && !force) return;
    RM.busy = true;
    try {
      RM.status = await A.modCmd('remote', 'status');
    } catch (e) {
      RM.status = { state: 'error', error: (e && e.message) || String(e) };
    } finally {
      RM.busy = false;
    }
    rmRender();
  }

  async function rmLoad(){
    try { RM.st = await A.modStatus(); } catch (e) { RM.st = null; }
    rmMenu();
    if (!rmVisible()) { rmSleep(); rmRender(); return; }
    // Закрыт — не опрашиваем модуль: состояние спросим при открытии раздела.
    if (rmOpen()) { await rmPoll(true); rmWake(); }
    else { rmSleep(); rmRender(); }
  }

  async function rmCmd(name, data){
    if (!A.modCmd) return;
    try { await A.modCmd('remote', name, data); }
    catch (e) { toast('Пульт: ' + ((e && e.message) || e)); }
    await rmPoll(true);
  }

  document.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('[data-go]') : null;
    if (!b || !b.dataset) return;
    if (b.dataset.go === 'sRemote') { rmWake(); rmLoad(); }
    else rmSleep();
  });

  (function(){
    var box = rmPanel();
    if (!box) return;
    box.addEventListener('click', function(e){
      var t = e.target;
      var copy = t.closest ? t.closest('[data-rm-copy]') : null;
      if (copy) {
        var lan = (RM.status && RM.status.lan) || {};
        if (copy.dataset.rmCopy === 'link') rmCopy(String((RM.status && RM.status.url) || ''), 'Ссылка пульта скопирована');
        else if (copy.dataset.rmCopy === 'url') rmCopy(rmLanAddr(lan), 'Адрес ПК скопирован');
        else if (copy.dataset.rmCopy === 'net') rmCopy(String(lan.net || ''), 'Сеть скопирована');
        return;
      }
      var mode = t.closest ? t.closest('[data-rm-mode]') : null;
      if (mode) { rmCmd('mode', { mode: mode.dataset.rmMode }); return; }
      var ip = t.closest ? t.closest('[data-rm-ip]') : null;
      if (ip) { rmCmd('lan-ip', { ip: ip.dataset.rmIp }); return; }
      var act = t.closest ? t.closest('[data-rm]') : null;
      if (act) { rmCmd(act.dataset.rm); }
    });
  })();

  if (A.onModStatus) A.onModStatus(function (st){ RM.st = st; rmLoad(); });
  if (A.modStatus) setTimeout(rmLoad, 3600);
