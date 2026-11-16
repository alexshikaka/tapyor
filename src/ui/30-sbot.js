  // ===== Streamer.bot (0.35, Э4): Настройки → Стримерам → Streamer.bot =====
  // Экран только показывает и настраивает. Порт /sb/* и пульт к Streamer.bot уже работают
  // без него (Э1/Э2). Здесь: подключение (адрес, порт, пароль, шаблон, награда, проверка),
  // конструктор (tapyor-переменные, раздел 7.4 плана), справка для умельцев.
  // Цвета — только классами (docs/UI-RULES.md). Логика конструктора — src/sbot-settings.js
  // (window.TapSBS), чтобы окно и проверки считали одинаково.
  var SBS = typeof window !== 'undefined' ? window.TapSBS : null;
  // Решение «показывать ли строки Streamer.bot в чеклисте» — общее с главным процессом (G1).
  var SBC = typeof window !== 'undefined' ? window.TapSBCheck : null;

  var SB = {
    st: null,            // sbot-status главного процесса
    chatOrders: 'none',  // кто принимает заказы из чата: none | pack | sbot
    sbotEnabled: false,
    tab: 'conn',
    draft: null,
    written: null,
    dirty: false,
    remoteKeys: [],
    conn: { host: '127.0.0.1', port: 8080 },
    keyText: '',
    showKey: false,
    addFor: '',
    busy: false,
    badSince: 0,
    badTimer: 0,
    freshTimer: 0,
    loaded: false
  };
  var SB_DEFAULTS = { host: '127.0.0.1', port: 8080 };
  // Ссылки порта — раздел 3.1 плана. Ключ в ссылку не вставляем: он идёт заголовком.
  var SB_LINKS = [
    ['/sb/order', 'Заказ: найти, проверить, поставить'],
    ['/sb/cancel', 'Отменить ожидающий заказ зрителя'],
    ['/sb/now', 'Что играет и кто заказал'],
    ['/sb/place', 'Место зрителя и время до трека'],
    ['/sb/next', 'Ближайшие треки'],
    ['/sb/control', 'Пропуск, пауза, громкость'],
    ['/sb/accept', 'Открыть или закрыть приём'],
    ['/sb/status', 'Жив ли Тапёр, открыт ли приём']
  ];
  var SB_TRIGGERS = [
    ['tapyor_order_queued', 'Тапёр → Заказ принят', 'user track place eta'],
    ['tapyor_order_pending', 'Тапёр → Заказ ждёт стримера', 'user track'],
    ['tapyor_order_played', 'Тапёр → Заказ заиграл', 'user track kind'],
    ['tapyor_order_dropped', 'Тапёр → Заказ снят', 'user track reason'],
    ['tapyor_track_started', 'Тапёр → Заиграл трек', 'track user'],
    ['tapyor_queue_empty', 'Тапёр → Очередь пуста', '—'],
    ['tapyor_accept_changed', 'Тапёр → Приём открыт/закрыт', 'open']
  ];
  var SB_EXAMPLES = [
    ['Кнопка «пропустить» на Stream Deck', '/sb/control?do=skip'],
    ['«Сейчас играет» в чат раз в 10 минут', 'Fetch URL → /sb/now'],
    ['Алерт в OBS, когда заиграл заказ', 'Триггер «Тапёр → Заказ заиграл»'],
    ['Сменить сцену, когда заказы кончились', 'Триггер «Тапёр → Очередь пуста»'],
    ['Подключить другую площадку (YouTube, Kick)', 'на свой страх: Тапёр это официально пока не поддерживает']
  ];

  function sbSt() { return SB.st || {}; }
  // Приём заказов на самом деле открыт: режим Streamer.bot И sbotAccepting (A35-2).
  // sbotAccepting закрывается командой /sb/accept?on=0 из Streamer.bot — тогда тумблер выключен.
  function sbAccepted() { return SB.chatOrders === 'sbot' && sbSt().accepting !== false; }
  // Строки чеклиста «Streamer.bot · связь/шаблон» — только когда заказы из чата идут через него.
  // sbotEnabled («пульт когда-то включали») здесь не учитываем: точка связи в шапке, пункт меню и
  // вкладка «Streamer.bot» по-прежнему показывают состояние, но ложной ошибки в чеклисте нет (G1).
  function sbActive() {
    if (SBC) return SBC.showInChecklist({ chatOrders: SB.chatOrders, sbotEnabled: SB.sbotEnabled });
    return SB.chatOrders === 'sbot';
  }
  function sbShown() { var p = $('sSbot'); return !!(p && !p.hidden && p.classList.contains('on') && curTab === 'settings'); }

  function sbAgo(ts) {
    var n = Number(ts) || 0;
    if (!n) return '';
    var s = Math.max(0, Math.round((Date.now() - n) / 1000));
    if (s < 60) return 'только что';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' мин назад';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' ч назад';
    return Math.round(h / 24) + ' дн. назад';
  }

  // ── статус ────────────────────────────────────────────────────────────────
  function sbStatusInfo() {
    var st = sbSt(), s = String(st.status || 'off');
    if (s === 'ok') return { cls: 'ok', text: '● связь есть', title: st.text || '' };
    if (s === 'connecting') return { cls: '', text: '● подключаюсь…', title: st.text || '' };
    if (s === 'auth') return { cls: '', text: '● не принят пароль', title: st.text || '' };
    if (s === 'needPassword') return { cls: '', text: '● нужен пароль', title: st.text || '' };
    if (s === 'error') return { cls: '', text: '● не отвечает', title: st.text || '' };
    return { cls: '', text: '● подключение выключено', title: st.text || '' };
  }

  function sbHeadLine() {
    var st = sbSt();
    if (!SB.loaded && !SB.st) return 'Проверяю состояние…';
    if (!SB.st) return 'Состояние не получено — открой ещё раз';
    if (st.status !== 'ok') {
      var why = st.text || 'Streamer.bot не отвечает';
      if (st.nextRetryMs) why += ' · повтор через ' + Math.round(st.nextRetryMs / 1000) + ' с';
      return why;
    }
    var bits = [];
    bits.push(st.sbVersion ? 'Streamer.bot ' + st.sbVersion : 'Streamer.bot');
    if (st.templateFound) bits.push('шаблон v' + st.templateVersion);
    else bits.push('шаблон не найден');
    bits.push(st.lastOrderAt ? 'последний заказ ' + sbAgo(st.lastOrderAt) : 'заказов ещё не было');
    return bits.join(' · ');
  }

  function sbSetPill(id, ok, text, title) {
    var el = $(id); if (!el) return;
    el.className = 'pill' + (ok ? ' ok' : '');
    el.textContent = text;
    el.title = title || '';
  }

  function sbConnPillText() {
    var st = sbSt();
    if (st.status === 'ok') return 'подключено';
    if (st.status === 'connecting') return 'подключаюсь…';
    if (st.status === 'needPassword') return 'нужен пароль';
    if (st.status === 'auth') return 'пароль не принят';
    if (st.status === 'error') return 'не отвечает';
    return 'не подключено';
  }

  // ── загрузка состояния ────────────────────────────────────────────────────
  async function sbLoad(resetDraft) {
    if (SB.busy || !SBS) return;
    SB.busy = true;
    try {
      var st = null, g = null, chat, enabled;
      if (A.sbotStatus) { try { st = await A.sbotStatus(); } catch (e) { st = null; } }
      if (A.getSetting) {
        try { chat = await A.getSetting('chatOrders'); } catch (e) {}
        try { enabled = await A.getSetting('sbotEnabled'); } catch (e) {}
      }
      if (A.sbotGlobals) { try { g = await A.sbotGlobals(); } catch (e) { g = null; } }
      if (st) SB.st = st;
      if (g && SB.st) SB.st.globals = g;
      if (chat === 'sbot' || chat === 'pack' || chat === 'none') SB.chatOrders = chat;
      else if (chat === undefined && !SB.loaded) SB.chatOrders = (SB.st && SB.st.chatOrders) || 'none';
      if (enabled !== undefined) SB.sbotEnabled = enabled === true;
      else if (SB.st && SB.st.status && SB.st.status !== 'off') SB.sbotEnabled = true;
      SB.conn = {
        host: (SB.st && SB.st.host) || SB_DEFAULTS.host,
        port: Number(SB.st && SB.st.port) || SB_DEFAULTS.port
      };
      SB.written = SB.st && SB.st.written && typeof SB.st.written === 'object' ? SB.st.written : null;
      if (!SB.draft || resetDraft) {
        SB.draft = SBS.fromGlobals((SB.st && SB.st.globals) || {}, SB.draft || SBS.defaultDraft());
        SB.dirty = false;
      }
      SB.remoteKeys = SBS.diffValues((SB.st && SB.st.globals) || {}, SB.written);
      SB.loaded = true;
    } finally {
      SB.busy = false;
    }
    sbQcRows(sbActive());
    sbQcUpdate();
    sbRenderHead();
    if (SB.tab === 'conn') sbRenderConn();
    else if (SB.tab === 'kit') sbRenderKit();
    else sbRenderApi();
    sbWarnTick();
    sbKeepFresh();
  }

  // Состояние пульта пришло само (подключились, отключились, сменился шаблон).
  // Черновик конструктора не трогаем: человек мог что-то печатать.
  function sbApplyState(st) {
    if (!st) return;
    // Объединяем, а не заменяем: событие может принести только часть полей (A35-7).
    SB.st = Object.assign({}, SB.st || {}, st);
    if (st.chatOrders === 'sbot' || st.chatOrders === 'pack' || st.chatOrders === 'none') SB.chatOrders = st.chatOrders;
    if (SB.st.globals && SB.draft && !SB.dirty) SB.draft = SBS.fromGlobals(SB.st.globals, SB.draft);
    SB.remoteKeys = SBS.diffValues(SB.st.globals || {}, SB.written);
    SB.sbotEnabled = st.status !== 'off';
    sbRenderHead();
    if (SB.tab === 'conn') {
      var box = $('sbConn');
      var ae = typeof document !== 'undefined' ? document.activeElement : null;
      if (!box || !ae || !box.contains(ae)) sbRenderConn();
      else sbUpdateConnLive();
    }
    sbQcRows(sbActive());
    sbQcUpdate();
    sbWarnTick();
  }

  // ── шапка, меню, предупреждение ──────────────────────────────────────────
  function sbRenderHead() {
    var info = sbStatusInfo();
    var pill = $('sbHeadPill');
    if (pill) { pill.className = 'pill' + (info.cls ? ' ' + info.cls : ''); pill.textContent = info.text; pill.title = info.title; }
    var text = $('sbHeadText');
    if (text) text.textContent = sbHeadLine();
    var tg = $('sbAcceptTg');
    if (tg) {
      var on = sbAccepted();
      tg.classList.toggle('on', on);
      tg.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    sbRenderSummary();
    var dot = $('sbDot');
    if (dot) {
      var ok = sbSt().status === 'ok';
      dot.hidden = !ok;
      dot.title = ok ? 'Связь со Streamer.bot есть' : 'Связи со Streamer.bot нет';
    }
  }

  function sbRenderSummary() {
    var box = $('sbSummary'); if (!box || !SBS || !SB.draft) return;
    var text = SBS.summary(SB.draft);
    var lead = 'Сейчас так:';
    var html = text.indexOf(lead) === 0 ? '<b>' + lead + '</b>' + esc(text.slice(lead.length)) : esc(text);
    // На выключенной странице — строка «сейчас принимает … — включить здесь?»
    if (SB.chatOrders !== 'sbot') {
      var who = SB.chatOrders === 'pack' ? 'Сейчас заказы из чата принимает чат-бот пака.' : 'Сейчас заказы из чата не принимает никто.';
      html += '<div class="sd" style="margin-top:8px">' + who + ' <button class="btn ghost" id="sbTakeHere" type="button">Включить здесь</button></div>';
    }
    // Приём закрыли командой /sb/accept?on=0 из Streamer.bot — режим включён, а заказы не идут.
    if (SB.chatOrders === 'sbot' && sbSt().accepting === false) {
      html += '<div class="sd" style="margin-top:8px">Приём закрыт из Streamer.bot — <button class="btn ghost" id="sbAcceptOpen" type="button">открыть</button></div>';
    }
    box.innerHTML = html;
  }

  function sbWarnTick() {
    if (SB.badTimer) { clearTimeout(SB.badTimer); SB.badTimer = 0; }
    var warn = $('sbotWarn'); if (!warn) return;
    var hide = function () { warn.hidden = true; warn.textContent = ''; };
    if (SB.chatOrders !== 'sbot' || document.body.classList.contains('no-streamer')) { SB.badSince = 0; hide(); return; }
    if (sbSt().status === 'ok') { SB.badSince = 0; hide(); return; }
    if (!SB.badSince) SB.badSince = Date.now();
    var left = 30000 - (Date.now() - SB.badSince);
    if (left <= 0) { warn.hidden = false; warn.textContent = 'Streamer.bot не отвечает'; return; }
    hide();
    SB.badTimer = setTimeout(sbWarnTick, left + 50);
  }

  // Пока экран открыт, раз в 20 секунд обновляем «последний заказ … назад».
  // Таймер живёт только пока виден раздел (docs/UI-RULES.md).
  function sbKeepFresh() {
    if (SB.freshTimer) return;
    SB.freshTimer = setInterval(function () {
      if (!sbShown()) { clearInterval(SB.freshTimer); SB.freshTimer = 0; return; }
      sbRenderHead();
    }, 20000);
  }

  // ── вкладка «Подключение» ─────────────────────────────────────────────────
  function sbConnHtml() {
    var st = sbSt(), d = SB.draft || {};
    var head = sbStatusInfo();
    var tw = st.twitch || {};
    var bot = st.bot || {};
    var hasPw = !!st.hasPassword;
    var host = SB.conn.host || SB_DEFAULTS.host;
    var port = SB.conn.port || SB_DEFAULTS.port;

    var h = '';
    h += sbSec('Шаг 1. Включи пульт в Streamer.bot', 'один раз',
      sbRow('Где включить', 'В Streamer.bot: <b>Servers/Clients → WebSocket Server</b>. Отметь <b>Auto Start</b>, <b>Authentication</b> и <b>Enforce</b>, придумай пароль, нажми <b>Start Server</b>. Enforce закрывает пульт от других программ на компьютере', '<button class="btn ghost" type="button" data-sbtoast="shot">Показать на скриншоте</button>') +
      sbRow('Адрес и порт', 'Как в Streamer.bot. Обычно менять не нужно',
        '<div class="bot-pair"><input id="sbHost" class="field mono" style="width:130px" value="' + esc(host) + '" aria-label="Адрес Streamer.bot" spellcheck="false"><span class="sd">:</span><input id="sbPort" class="field mono" style="width:80px" type="number" min="1" max="65535" value="' + port + '" aria-label="Порт Streamer.bot"></div>') +
      sbRow('Пароль', hasPw ? 'Пароль сохранён — поле пустое, новый не нужен' : 'Тот же, что в Streamer.bot. Хранится зашифрованно',
        '<div class="bot-pair"><input id="sbPassword" class="field" style="width:200px" type="password" value="" autocomplete="off" placeholder="' + (hasPw ? 'пароль сохранён' : 'пароль') + '" aria-label="Пароль Streamer.bot"><button class="btn" id="sbConnect" type="button">Подключиться</button>' + (st.status !== 'off' ? '<button class="btn ghost" id="sbDisconnect" type="button">Отключиться</button>' : '') + '<span class="pill' + (head.cls === 'ok' ? ' ok' : '') + '" id="sbConnPill">' + esc(sbConnPillText()) + '</span></div>') +
      sbRow('Twitch в Streamer.bot', 'Чьи команды слушает шаблон',
        '<div class="bot-pair"><span class="pill' + (tw.connected === true ? ' ok' : '') + '" id="sbTwitchPill">' + esc(sbTwitchText(tw)) + '</span><span class="pill' + (bot.connected === true ? ' ok' : '') + '" id="sbBotPill">' + esc(sbBotText(bot)) + '</span></div>'));

    var tplOk = st.status === 'ok' && st.templateFound;
    var newer = st.templateFound && st.templateCurrent && st.templateVersion < st.templateCurrent;
    var tplText = st.status !== 'ok' ? 'проверится при связи'
      : !st.templateFound ? 'не найден'
      : newer ? 'найден · v' + st.templateVersion + ' · есть новее v' + st.templateCurrent
      : 'найден · v' + st.templateVersion;
    h += sbSec('Шаг 2. Добавь шаблон Тапёра', 'готовые действия для заказов',
      sbRow('Скопируй шаблон и вставь в Streamer.bot', 'В Streamer.bot: кнопка <b>Import</b> вверху → вставь строку → <b>Import</b>. Появится группа действий «Тапёр». Адрес и ключ Тапёр передаст сам',
        '<div class="bot-pair"><button class="btn" id="sbCopyTemplate" type="button">Скопировать шаблон</button><button class="btn ghost" type="button" data-sbtoast="guide">Инструкция</button></div>') +
      sbRow('Шаблон в Streamer.bot', 'Действия «Тапёр: …» и триггеры «Тапёр → …» на месте',
        '<span class="pill' + (tplOk && !newer ? ' ok' : '') + '" id="sbTplPill">' + esc(tplText) + '</span>'));

    var rewardName = String((SB.st && SB.st.globals && SB.st.globals.tapyorRewardName) || d.tapyorRewardName || SBS.DEFAULT_REWARD);
    var rewardId = String((SB.st && SB.st.globals && SB.st.globals.tapyorRewardId) || '');
    h += sbSec('Шаг 3. Награда за баллы', 'если на канале есть баллы',
      sbRow('Создай награду в Streamer.bot, а не на сайте Twitch', '<b>Platforms → Twitch → Channel Point Rewards → Add</b>, название «' + esc(rewardName) + '», включи «User Input Required». Иначе Twitch не даст вернуть баллы',
        '<button class="btn ghost" type="button" data-sbtoast="shot">Показать на скриншоте</button>') +
      sbRow('Награда', 'Тапёр ищет награду по названию из «Конструктора»',
        '<div class="bot-pair"><span class="pill' + (rewardId ? ' ok' : '') + '" id="sbRewardPill">' + (rewardId ? '«' + esc(rewardName) + '» · найдена' : 'не найдена') + '</span>' +
        (st.status === 'ok' ? '<button class="btn" id="sbFindReward" type="button">Найти награду</button>' : '<span class="sd">сначала подключись</span>') + '</div>'));

    var step1 = st.status === 'ok' && st.actionsFound && st.actionsFound.setup;
    var step2 = st.status === 'ok' && st.templateFound && SB.chatOrders === 'sbot';
    h += sbSec('Шаг 4. Проверь', 'напиши в свой чат <span class="mono">!sr кино кукушка</span>',
      sbRow('Тапёр → Streamer.bot', 'Пульт подключён, настройки записываются',
        '<span class="pill' + (step1 ? ' ok' : '') + '" id="sbStepTapyor">' + (step1 ? 'работает' : (st.status === 'ok' ? 'шаблон без действия «Тапёр: настройка»' : 'ждёт связи')) + '</span>') +
      sbRow('Streamer.bot → Тапёр', 'Команды из чата доходят до Тапёра',
        '<span class="pill' + (step2 ? ' ok' : '') + '" id="sbStepSbot">' + (step2 ? 'работает' : (SB.chatOrders !== 'sbot' ? 'принимает ' + (SB.chatOrders === 'pack' ? 'чат-бот пака' : 'никто — включи приём сверху') : 'ждёт связи')) + '</span>') +
      sbRow('Ответ в чат', st.lastOrderAt ? 'Последний ответ ушёл ' + sbAgo(st.lastOrderAt) : 'Ещё не было заказов',
        '<span class="pill' + (st.lastOrderAt ? ' ok' : '') + '" id="sbStepReply">' + (st.lastOrderAt ? 'работает' : 'проверится на заказе') + '</span>'));

    h += '<div class="bot-note warn"><b>Если у тебя Nightbot или другой бот с командой !sr</b> — выключи у него заказы песен или поменяй команду Тапёра в «Конструкторе». Иначе на !sr ответят двое и песня встанет дважды.</div>';
    return h;
  }

  function sbTwitchText(tw) {
    if (!tw || tw.connected === null || tw.connected === undefined) return 'Twitch: не проверить';
    if (tw.connected) return 'Twitch: ' + (tw.name || 'подключён');
    return 'Twitch не подключён в Streamer.bot';
  }
  function sbBotText(bot) {
    if (!bot || bot.connected === null || bot.connected === undefined) return 'бот-аккаунт: не проверить';
    if (bot.connected) return 'бот-аккаунт: ' + (bot.name || 'есть');
    return 'бот-аккаунт не подключён — ответы будут от тебя';
  }

  function sbUpdateConnLive() {
    var st = sbSt();
    var head = sbStatusInfo();
    sbSetPill('sbConnPill', head.cls === 'ok', sbConnPillText(), head.title);
    sbSetPill('sbTplPill', st.status === 'ok' && st.templateFound && !(st.templateVersion < st.templateCurrent),
      st.status !== 'ok' ? 'проверится при связи' : !st.templateFound ? 'не найден'
        : st.templateVersion < st.templateCurrent ? 'найден · v' + st.templateVersion + ' · есть новее v' + st.templateCurrent
        : 'найден · v' + st.templateVersion);
    sbSetPill('sbTwitchPill', st.twitch && st.twitch.connected === true, sbTwitchText(st.twitch || {}));
    sbSetPill('sbBotPill', st.bot && st.bot.connected === true, sbBotText(st.bot || {}));
    var rewardId = String((st.globals && st.globals.tapyorRewardId) || '');
    var rewardName = String((st.globals && st.globals.tapyorRewardName) || (SB.draft && SB.draft.tapyorRewardName) || SBS.DEFAULT_REWARD);
    sbSetPill('sbRewardPill', !!rewardId, rewardId ? '«' + rewardName + '» · найдена' : 'не найдена');
    var step1 = st.status === 'ok' && st.actionsFound && st.actionsFound.setup;
    var step2 = st.status === 'ok' && st.templateFound && SB.chatOrders === 'sbot';
    sbSetPill('sbStepTapyor', !!step1, step1 ? 'работает' : (st.status === 'ok' ? 'шаблон без действия «Тапёр: настройка»' : 'ждёт связи'));
    sbSetPill('sbStepSbot', !!step2, step2 ? 'работает' : (SB.chatOrders !== 'sbot' ? 'принимает ' + (SB.chatOrders === 'pack' ? 'чат-бот пака' : 'никто — включи приём сверху') : 'ждёт связи'));
    sbSetPill('sbStepReply', !!st.lastOrderAt, st.lastOrderAt ? 'работает' : 'проверится на заказе');
  }

  // ── вкладка «Конструктор» ─────────────────────────────────────────────────
  function sbRow(title, desc, ctl) {
    return '<div class="srow"><div class="sl"><div class="st">' + title + '</div>' + (desc ? '<div class="sd">' + desc + '</div>' : '') + '</div>' + (ctl || '') + '</div>';
  }
  function sbSec(title, sub, body) {
    return '<div class="bot-sec"><div class="sec-h"><h2 style="font-size:16px">' + title + '</h2>' + (sub ? '<span>' + sub + '</span>' : '') + '</div><div class="card">' + body + '</div></div>';
  }
  function sbTg(key, on, label) {
    return '<button class="toggle' + (on ? ' on' : '') + '" type="button" data-sbtg="' + key + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(label) + '"><span></span></button>';
  }
  function sbSeg(key, cur, opts, label) {
    return '<div class="seg" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button type="button" class="' + (String(cur) === String(o[0]) ? 'on' : '') + '" data-sbseg="' + key + '" data-val="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function sbNum(key, val, w, label, min, max) {
    return '<input class="field" type="number" data-sbnum="' + key + '" value="' + esc(val) + '" min="' + min + '" max="' + max + '" style="width:' + w + 'px" aria-label="' + esc(label) + '">';
  }
  function sbVarTitle(k) {
    for (var i = 0; i < SBS.CMD_DEFS.length; i++) {
      if (SBS.CMD_DEFS[i].cmd === k) return SBS.CMD_DEFS[i].title;
      if (SBS.CMD_DEFS[i].on === k) return SBS.CMD_DEFS[i].title + ' — включено';
    }
    var r = SBS.REPLY_DEFS.filter(function (x) { return x.key === k; })[0];
    if (r) return 'Текст «' + r.title + '»';
    var names = {
      tapyorWho: 'Кто может заказывать', tapyorFollowDays: 'Фолловеры — дней', tapyorPerUser: 'Заказов на зрителя',
      tapyorPauseMin: 'Пауза', tapyorChatCap: 'Потолок очереди', tapyorVipFree: 'VIP без ограничений',
      tapyorDoubt: 'Сомнительный заказ', tapyorPoints: 'Заказ за баллы', tapyorRewardName: 'Название награды',
      tapyorPauseReward: 'Пауза награды', tapyorReplyAs: 'От чьего имени', tapyorReplyMode: 'Как отвечать'
    };
    return names[k] || k;
  }

  function sbKitHtml() {
    var d = SB.draft || SBS.defaultDraft();
    var h = '';
    if (SB.remoteKeys.length) {
      h += '<div class="bot-note warn" id="sbRemote"><b>В Streamer.bot настройки изменены вручную.</b> Разошлось: ' +
        esc(SB.remoteKeys.map(sbVarTitle).join(', ')) +
        '. <button class="btn" type="button" data-sbremote="take">Взять оттуда</button> <button class="btn ghost" type="button" data-sbremote="push">Перезаписать</button></div>';
    }

    // Команды
    var cmds = '';
    SBS.CMD_DEFS.forEach(function (c) {
      var list = d[c.cmd] || [];
      var chips = list.map(function (x) {
        return '<span class="bot-chip">' + esc(x) + '<button type="button" data-sbcmddel="' + c.cmd + '" data-cmd="' + esc(x) + '" aria-label="Убрать ' + esc(x) + '">×</button></span>';
      }).join('');
      if (SB.addFor === c.cmd) {
        chips += '<input class="field" id="sbNewCmd" style="width:140px" placeholder="!команда" aria-label="Новая команда" spellcheck="false"> <button class="btn" type="button" data-sbcmdadd="' + c.cmd + '">Добавить</button> <button class="btn ghost" type="button" data-sbcmdcancel="1">Отмена</button>';
      } else {
        chips += '<button class="btn ghost" type="button" data-sbcmdnew="' + c.cmd + '" aria-label="Добавить команду">＋</button>';
      }
      cmds += '<div class="srow"><div class="sl"><div class="st">' + esc(c.title) + '</div>' + (c.hint ? '<div class="sd">' + c.hint.replace(/^!play/, '<span class="mono">!play</span>') + '</div>' : '') + '</div><div class="bot-chips">' + chips + '</div>' + sbTg(c.on, d[c.on] !== false, c.title) + '</div>';
    });
    h += sbSec('Команды', 'несколько названий — через «＋»', cmds);

    // Кто и сколько
    h += sbSec('Кто и сколько', 'ты сам всегда без ограничений',
      sbRow('Кто может заказывать', '', sbSeg('tapyorWho', d.tapyorWho, [['all', 'Все'], ['follower', 'Фолловеры'], ['sub', 'Подписчики'], ['vip', 'VIP и модераторы']], 'Кто может заказывать')) +
      sbRow('Фолловеры — не меньше', '0 — любой фолловер', '<div class="bot-pair">' + sbNum('tapyorFollowDays', d.tapyorFollowDays, 80, 'Дней фолловинга', 0, 3650) + '<span class="sd">дней</span></div>') +
      sbRow('Заказов на зрителя одновременно', 'Пока его трек ждёт — новый не примется: «у тебя уже ждёт трек»', sbNum('tapyorPerUser', d.tapyorPerUser, 80, 'Заказов на зрителя', 1, 20)) +
      sbRow('Пауза между заказами зрителя', '0 — без паузы', '<div class="bot-pair">' + sbNum('tapyorPauseMin', d.tapyorPauseMin, 80, 'Пауза', 0, 1440) + '<span class="sd">мин</span></div>') +
      sbRow('Не больше заказов из чата в очереди', 'Дальше — «очередь полна». Донаты и баллы не считаются', sbNum('tapyorChatCap', d.tapyorChatCap, 80, 'Потолок очереди', 1, 200)) +
      sbRow('VIP и модераторы — без ограничений', '', sbTg('tapyorVipFree', d.tapyorVipFree !== false, 'VIP без ограничений')));

    // Сомнительный заказ
    h += sbSec('Если Тапёр не уверен', 'нашёл похожее, но не точно',
      sbRow('Сомнительный заказ', 'За баллы при «попросить уточнить» баллы вернутся',
        sbSeg('tapyorDoubt', d.tapyorDoubt, [['wait', 'Ждёт меня в «Заказах»'], ['ask', 'Попросить зрителя уточнить']], 'Сомнительный заказ')));

    // Баллы
    h += sbSec('Баллы канала', 'цена и лимиты — в самой награде',
      sbRow('Заказ за баллы', 'Баллы висят, пока трек не заиграл. Не нашёл, не по правилам, убран — баллы возвращаются', sbTg('tapyorPoints', d.tapyorPoints !== false, 'Заказ за баллы')) +
      sbRow('Название награды', 'Так же назови награду в Streamer.bot, чтобы Тапёр её нашёл',
        '<input class="field" data-sbtext="tapyorRewardName" value="' + esc(d.tapyorRewardName) + '" maxlength="100" style="width:240px" aria-label="Название награды">') +
      sbRow('Пауза награды, когда приём закрыт', 'Чтобы зрители не тратили баллы, пока Тапёр не принимает заказы', sbTg('tapyorPauseReward', d.tapyorPauseReward !== false, 'Пауза награды')));

    // Ответы
    var replies = '';
    SBS.REPLY_DEFS.forEach(function (r) {
      replies += '<div class="srow bot-rep"><span class="bot-rep-n">' + esc(r.title) + '</span><input class="field" type="text" data-sbtext="' + r.key + '" value="' + esc(d[r.key] || '') + '" maxlength="300" placeholder="' + esc(r.sample) + '" aria-label="Текст: ' + esc(r.title) + '"></div>';
    });
    h += sbSec('Ответы в чат', '{user} {track} {place} {eta} {reason} {min} {who} · пусто — фраза Тапёра',
      sbRow('От чьего имени', 'От бота — если бот-аккаунт подключён в Streamer.bot → Platforms; иначе ответит от тебя',
        sbSeg('tapyorReplyAs', d.tapyorReplyAs, [['broadcaster', 'От моего имени'], ['bot', 'От бота']], 'От чьего имени')) +
      sbRow('Как отвечать', '', sbSeg('tapyorReplyMode', d.tapyorReplyMode, [['reply', 'Веткой на сообщение'], ['msg', 'Обычным сообщением']], 'Как отвечать')) +
      replies +
      '<div class="srow"><div class="sl"><div class="sd">Правила трека (длина, 18+, стоп-лист, повторы, каверы) — в <a href="#" data-sbgopane="sOrders">«Стримерам → Заказы»</a>. Они работают в Тапёре</div></div></div>');

    // Закреплённая панель записи
    h += '<div class="sb-save"><span class="pill sb-dirty" id="sbDirty"' + (SB.dirty ? '' : ' hidden') + '>изменено, не записано</span>' +
      '<span class="sd">Настройки хранятся в Streamer.bot — их можно поменять и там, в Global Variables</span>' +
      '<button class="btn" id="sbSave" type="button">Записать в Streamer.bot</button></div>';
    return h;
  }

  // ── вкладка «Для умельцев» ────────────────────────────────────────────────
  function sbApiHtml() {
    var st = sbSt();
    var port = Number(st.tapyorPort) || 0;
    var base = 'http://127.0.0.1:' + (port || '<порт>');
    var mask = SB.showKey && SB.keyText ? SB.keyText : 'tp_••••••••••••';
    var h = '<div class="bot-note">Шаблон — только начало. <b>Своё не добавляй в наши действия «Тапёр: …»</b> — обновление шаблона их перезапишет. Делай свои действия: они могут обращаться к Тапёру по ссылкам ниже (шаг <b>Fetch URL</b> с галочкой <b>Parse result as JSON</b>) и запускаться на триггерах <b>Custom → Тапёр</b>.</div>';
    h += sbSec('Адрес и ключ', 'лежат в Streamer.bot как <span class="mono">~tapyorUrl~</span> и <span class="mono">~tapyorKey~</span>',
      sbRow('Адрес Тапёра', port ? '' : 'Порт ещё не получен — открой экран после подключения',
        '<div class="sb-addr"><span class="mono">' + esc(base) + '</span><button class="btn ghost" type="button" data-sbcopy="' + esc(base) + '" data-sbcopymsg="Адрес Тапёра скопирован">Скопировать</button></div>') +
      sbRow('Ключ', 'Без ключа Тапёр не ответит. Сменил — Тапёр сам обновит его в Streamer.bot',
        '<div class="sb-addr"><span class="mono">' + esc(mask) + '</span><button class="btn ghost" id="sbShowKey" type="button">' + (SB.showKey ? 'Скрыть' : 'Показать') + '</button><button class="btn ghost" id="sbResetKey" type="button">Сменить</button></div>'));

    var rows = SB_LINKS.map(function (l) {
      var url = base + l[0];
      return '<tr><td class="mono">' + esc(l[0]) + '</td><td>' + esc(l[1]) + '</td><td><button class="btn ghost" type="button" data-sbcopy="' + esc(url) + '" data-sbcopymsg="Ссылка скопирована: ' + esc(l[0]) + '">Скопировать</button></td></tr>';
    }).join('');
    h += sbSec('Ссылки — Streamer.bot спрашивает Тапёр', 'ответ плоский: <span class="mono">%res.status%</span>, <span class="mono">%res.reply%</span>, <span class="mono">%res.track%</span>…',
      '<table class="bot-tbl"><thead><tr><th>Ссылка</th><th>Что делает</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="srow"><div class="sl"><div class="sd">Ключ передаётся заголовком <span class="mono">X-Tapyor-Key</span> (или <span class="mono">key=</span> в ссылке). Статусы ответа: <span class="mono">queued</span> — поставил, <span class="mono">pending</span> — ждёт стримера, <span class="mono">ask</span> — просим уточнить, <span class="mono">notfound</span>, <span class="mono">rule</span>, <span class="mono">limit</span>, <span class="mono">closed</span>, <span class="mono">off</span>, <span class="mono">old</span>, <span class="mono">error</span>. «Тапёр не ответил» — <span class="mono">%res.status%</span> пустой</div></div></div>');

    var trs = SB_TRIGGERS.map(function (t) {
      return '<tr><td>' + esc(t[1]) + '</td><td class="mono">' + esc(t[2]) + '</td><td><button class="btn ghost" type="button" data-sbtrig="' + t[0] + '">Нажать</button></td></tr>';
    }).join('');
    h += sbSec('Триггеры — Тапёр сообщает Streamer.bot', 'в своём действии: Triggers → Custom → Тапёр',
      '<table class="bot-tbl"><thead><tr><th>Триггер</th><th>Данные</th><th></th></tr></thead><tbody>' + trs + '</tbody></table>' +
      '<div class="srow"><div class="sl"><div class="sd">«Нажать» — Тапёр запустит триггер с тестовыми данными, чтобы проверить твоё действие. В очередь ничего не попадает</div></div></div>');

    var ex = SB_EXAMPLES.map(function (x, i) {
      return '<div class="srow"><div class="sl"><div class="st">' + esc(x[0]) + '</div><div class="sd">' + esc(x[1]) + '</div></div><button class="btn ghost" type="button" data-sbexample="' + i + '">Открыть</button></div>';
    }).join('');
    h += sbSec('Примеры по шагам', 'открываются в справке', ex);
    h += '<div class="bot-pair"><button class="btn" type="button" data-sbtoast="fullguide">Полная справка</button></div>';
    return h;
  }

  // ── показ вкладок ─────────────────────────────────────────────────────────
  function sbRenderConn() { var box = $('sbConn'); if (box) box.innerHTML = sbConnHtml(); }
  function sbRenderKit() { var box = $('sbKit'); if (box) box.innerHTML = sbKitHtml(); }
  function sbRenderApi() { var box = $('sbApi'); if (box) box.innerHTML = sbApiHtml(); }

  function sbSetTab(tab) {
    SB.tab = tab === 'kit' || tab === 'api' ? tab : 'conn';
    var nav = $('sbTabs');
    if (nav) Array.prototype.forEach.call(nav.querySelectorAll('[data-sbtab]'), function (b) {
      b.classList.toggle('on', b.dataset.sbtab === SB.tab);
    });
    [['conn', 'sbConn'], ['kit', 'sbKit'], ['api', 'sbApi']].forEach(function (p) {
      var el = $(p[1]); if (el) el.hidden = p[0] !== SB.tab;
    });
    if (SB.tab === 'conn') sbRenderConn();
    else if (SB.tab === 'kit') sbRenderKit();
    else sbRenderApi();
  }

  function sbOpen() {
    setTab('settings', 'sSbot');
    if (typeof showSettingsPane === 'function') showSettingsPane('sSbot');
    sbLoad(!SB.dirty);
  }

  // ── отметка «изменено, не записано» ──────────────────────────────────────
  function sbDirty(on) {
    SB.dirty = !!on;
    var pill = $('sbDirty');
    if (pill) pill.hidden = !SB.dirty;
    sbRenderSummary();
  }

  // ── запись и сверка с Streamer.bot ───────────────────────────────────────
  async function sbPersist(silent) {
    if (!A.sbotWriteSettings) return false;
    var vals = SBS.toValues(SB.draft);
    var r = null;
    try { r = await A.sbotWriteSettings(vals); }
    catch (e) { r = { ok: false, message: (e && e.message) || String(e) }; }
    if (!r || !r.ok) {
      toast('Не записано: ' + ((r && r.message) || 'Streamer.bot не ответил'));
      return false;
    }
    SB.dirty = false;
    SB.written = vals;
    SB.remoteKeys = [];
    if (!silent) toast('Записано в Streamer.bot · настроек: ' + (r.count || Object.keys(vals).length));
    return true;
  }

  async function sbSave() {
    if (await sbPersist(false)) {
      await sbLoad(false);
      sbRenderKit();
    }
  }

  async function sbRemote(action) {
    if (action === 'take') {
      SB.draft = SBS.fromGlobals((sbSt().globals) || {}, SB.draft);
      SB.dirty = true;
      if (await sbPersist(true)) {
        toast('Взято из Streamer.bot — эти же значения записаны обратно');
        await sbLoad(false);
        sbRenderKit();
      }
      return;
    }
    await sbSave();
  }

  // ── действия шапки и подключения ─────────────────────────────────────────
  async function sbToggleAccept(on) {
    var ok = false;
    if (on && SB.chatOrders === 'sbot') {
      // Режим уже Streamer.bot, но приём закрыли командой /sb/accept?on=0 — просто открываем.
      try { ok = await A.setSetting('sbotAccepting', true); } catch (e) { ok = false; }
      if (ok && SB.st) SB.st.accepting = true;
    } else {
      var target = on ? 'sbot' : 'none';
      try { ok = await A.setSetting('chatOrders', target); } catch (e) { ok = false; }
      if (ok) {
        SB.chatOrders = target;
        if (on && SB.st) SB.st.accepting = true;
      }
    }
    if (!ok) { toast('Не получилось переключить приём — попробуй ещё раз'); return; }
    if (on && sbSt().status !== 'ok') toast('Заказы включены. Подключись на вкладке «Подключение» — иначе Streamer.bot не достучится до Тапёра');
    sbRenderHead();
    sbQcRows(true);
    sbQcUpdate();
    sbWarnTick();
  }

  async function sbTestConn() {
    if (!A.sbotTest) return;
    toast('Проверяю связь со Streamer.bot…');
    var r = null;
    try { r = await A.sbotTest(); } catch (e) { r = { ok: false, message: (e && e.message) || String(e) }; }
    toast(r && r.ok
      ? 'Связь есть, обе стороны работают' + (r.version ? ' · Streamer.bot ' + r.version : '')
      : 'Проверка не прошла: ' + ((r && r.message) || 'Streamer.bot не ответил'));
    await sbLoad(false);
  }

  async function sbConnect() {
    if (!A.sbotSetConn || !A.sbotConnect) return;
    var host = (($('sbHost') || {}).value || SB.conn.host || '').trim();
    var port = Number((($('sbPort') || {}).value || SB.conn.port));
    var pw = ($('sbPassword') || {}).value || '';
    if (!Number.isInteger(port) || port < 1 || port > 65535) { toast('Порт — целое число от 1 до 65535'); return; }
    var o = { host: host, port: port };
    if (pw) o.password = pw;
    var r = null;
    try { r = await A.sbotSetConn(o); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    if (!r || !r.ok) { toast((r && (r.error || r.message)) || 'Не получилось сохранить адрес и порт'); return; }
    SB.conn = { host: r.host || host, port: Number(r.port) || port };
    try { await A.sbotConnect(); } catch (e) {}
    toast('Подключаюсь к Streamer.bot…');
    await sbLoad(false);
    sbRenderConn();
  }

  async function sbDisconnect() {
    if (!A.sbotDisconnect) return;
    try { await A.sbotDisconnect(); } catch (e) {}
    toast('Подключение к Streamer.bot выключено');
    await sbLoad(false);
    sbRenderConn();
  }

  async function sbCopyTemplate() {
    if (!A.sbotCopyTemplate) { toast('Шаблон появится в следующей сборке'); return; }
    var r = null;
    try { r = await A.sbotCopyTemplate(); } catch (e) { r = { ok: false }; }
    if (r && r.ok) toast('Шаблон скопирован — вставь его в Streamer.bot кнопкой Import');
    else toast((r && r.message) || 'Шаблон появится в следующей сборке');
  }

  async function sbFindReward() {
    if (!A.sbotFindReward) return;
    toast('Ищу награду в Streamer.bot…');
    var r = null;
    try { r = await A.sbotFindReward(); } catch (e) { r = { ok: false, message: (e && e.message) || String(e) }; }
    toast((r && r.message) || 'Streamer.bot не ответил');
    await sbLoad(false);
    if (SB.tab === 'conn') sbRenderConn();
  }

  async function sbShowKey() {
    if (SB.showKey) { SB.showKey = false; sbRenderApi(); return; }
    if (!A.sbotPortKey) return;
    try { SB.keyText = String(await A.sbotPortKey() || ''); } catch (e) { SB.keyText = ''; }
    SB.showKey = !!SB.keyText;
    if (!SB.showKey) toast('Ключ не получен — открой экран ещё раз');
    sbRenderApi();
  }

  async function sbResetKey() {
    if (!A.sbotPortKeyReset) return;
    if (!confirm('Сменить ключ порта? Старый сразу перестанет работать, а новый Тапёр сам передаст в Streamer.bot при подключении.')) return;
    var r = null;
    try { r = await A.sbotPortKeyReset(); } catch (e) { r = { ok: false }; }
    if (!r || !r.ok) { toast('Не получилось сменить ключ'); return; }
    SB.showKey = false; SB.keyText = '';
    toast('Ключ сменён — Тапёр передаст новый в Streamer.bot при подключении');
    await sbLoad(false);
    sbRenderApi();
  }

  async function sbTestTrigger(name) {
    if (!A.sbotTrigger) return;
    var r = null;
    try { r = await A.sbotTrigger(name); } catch (e) { r = { ok: false, message: (e && e.message) || String(e) }; }
    toast((r && r.message) || 'Триггер отправлен');
  }

  function sbCopy(text, msg) {
    var done = function () { toast(msg || 'Скопировано'); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
      } catch (e) { toast('Не вышло скопировать — выдели и нажми Ctrl+C'); }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; }
    } catch (e) {}
    fallback();
  }

  // ── чеклист запуска: «Streamer.bot · связь» и «· шаблон» ─────────────────
  function sbQcRows(active) {
    var g = QC_GROUPS.filter(function (x) { return x[0] === 'Стрим'; })[0];
    if (!g) return;
    var ids = ['sbot.link', 'sbot.tpl'];
    var have = false;
    g[1].forEach(function (it) { if (it[0] === 'sbot.link') have = true; });
    if (active && !have) {
      g[1].push(['sbot.link', 'Streamer.bot · связь']);
      g[1].push(['sbot.tpl', 'Streamer.bot · шаблон']);
      ids.forEach(function (id) { if (QC_ALL.indexOf(id) < 0) QC_ALL.push(id); });
    } else if (!active && have) {
      g[1] = g[1].filter(function (it) { return ids.indexOf(it[0]) < 0; });
      for (var i = QC_ALL.length - 1; i >= 0; i--) if (ids.indexOf(QC_ALL[i]) >= 0) QC_ALL.splice(i, 1);
      ids.forEach(function (id) { delete QC.items[id]; });
      renderQC(); renderHealthWarn();
    }
  }

  function sbQcUpdate() {
    if (!sbActive()) return;
    var st = sbSt();
    var link, tpl;
    if (!SB.st) { link = { state: 'off', text: 'состояние не получено' }; }
    else if (st.status === 'ok') link = { state: 'ok', text: 'связь есть' + (st.sbVersion ? ' · Streamer.bot ' + st.sbVersion : '') };
    else if (st.status === 'off') link = { state: 'bad', text: 'подключение выключено — нажми «Подключиться»', action: 'sbot' };
    else link = { state: 'bad', text: st.text || 'Streamer.bot не отвечает', action: 'sbot' };
    if (SB.st && st.status === 'ok') {
      if (!st.templateFound) tpl = { state: 'bad', text: 'шаблон не найден — скопируй и импортируй в Streamer.bot', action: 'sbot' };
      else if (st.templateVersion < st.templateCurrent) tpl = { state: 'warn', text: 'шаблон v' + st.templateVersion + ' · есть новее v' + st.templateCurrent, action: 'sbot' };
      else tpl = { state: 'ok', text: 'шаблон v' + st.templateVersion };
    } else tpl = { state: 'off', text: 'проверится при связи' };
    QC.items['sbot.link'] = Object.assign({ id: 'sbot.link' }, link);
    QC.items['sbot.tpl'] = Object.assign({ id: 'sbot.tpl' }, tpl);
    renderQC(); renderHealthWarn();
  }

  // ── события экрана ───────────────────────────────────────────────────────
  function sbBind() {
    var pane = $('sSbot');
    if (pane) {
      pane.addEventListener('click', function (e) {
        var t = e.target;
        var tabBtn = t.closest('[data-sbtab]');
        if (tabBtn) { sbSetTab(tabBtn.dataset.sbtab); return; }
        if (t.closest('#sbTest')) { sbTestConn(); return; }
        if (t.closest('#sbConnect')) { sbConnect(); return; }
        if (t.closest('#sbDisconnect')) { sbDisconnect(); return; }
        if (t.closest('#sbCopyTemplate')) { sbCopyTemplate(); return; }
        if (t.closest('#sbFindReward')) { sbFindReward(); return; }
        if (t.closest('#sbSave')) { sbSave(); return; }
        if (t.closest('#sbTakeHere')) { sbToggleAccept(true); return; }
        if (t.closest('#sbAcceptOpen')) { sbToggleAccept(true); return; }
        if (t.closest('[data-sbtoast]')) {
          var what = t.closest('[data-sbtoast]').dataset.sbtoast;
          if (what === 'guide') toast('Инструкция будет в следующей версии — сейчас она готовится');
          else if (what === 'fullguide') toast('Полная справка для умельцев будет в следующей версии');
          else toast('Скриншоты будут в справке в следующей версии');
          return;
        }
        var remote = t.closest('[data-sbremote]');
        if (remote) { sbRemote(remote.dataset.sbremote); return; }
        var del = t.closest('[data-sbcmddel]');
        if (del) {
          var dk = del.dataset.sbcmddel, dc = del.dataset.cmd;
          SB.draft[dk] = (SB.draft[dk] || []).filter(function (x) { return x !== dc; });
          sbDirty(true); sbRenderKit(); return;
        }
        var addNew = t.closest('[data-sbcmdnew]');
        if (addNew) { SB.addFor = addNew.dataset.sbcmdnew; sbRenderKit(); var inp = $('sbNewCmd'); if (inp) inp.focus(); return; }
        if (t.closest('[data-sbcmdcancel]')) { SB.addFor = ''; sbRenderKit(); return; }
        var add = t.closest('[data-sbcmdadd]');
        if (add) {
          var key = add.dataset.sbcmdadd;
          var val = String((($('sbNewCmd') || {}).value || '')).trim().toLowerCase();
          if (!val) { toast('Напиши команду, например !sr'); return; }
          if (/\s/.test(val)) { toast('Команда — одно слово без пробелов'); return; }
          if (val.length > 40) { toast('Команда слишком длинная'); return; }
          if ((SB.draft[key] || []).indexOf(val) >= 0) { toast('Такая команда уже есть'); return; }
          SB.draft[key] = (SB.draft[key] || []).concat([val]);
          SB.addFor = '';
          sbDirty(true); sbRenderKit(); return;
        }
        var tg = t.closest('[data-sbtg]');
        if (tg) { var tk = tg.dataset.sbtg; SB.draft[tk] = !(SB.draft[tk] !== false); sbDirty(true); sbRenderKit(); return; }
        var seg = t.closest('[data-sbseg]');
        if (seg) { SB.draft[seg.dataset.sbseg] = seg.dataset.val; sbDirty(true); sbRenderKit(); return; }
        var copyBtn = t.closest('[data-sbcopy]');
        if (copyBtn) { sbCopy(copyBtn.dataset.sbcopy, copyBtn.dataset.sbcopymsg || 'Скопировано'); return; }
        if (t.closest('#sbShowKey')) { sbShowKey(); return; }
        if (t.closest('#sbResetKey')) { sbResetKey(); return; }
        var trig = t.closest('[data-sbtrig]');
        if (trig) { sbTestTrigger(trig.dataset.sbtrig); return; }
        var ex = t.closest('[data-sbexample]');
        if (ex) { toast('Примеры по шагам появятся в справке в следующей версии'); return; }
        var go = t.closest('[data-sbgopane]');
        if (go) { e.preventDefault(); if (typeof showSettingsPane === 'function') showSettingsPane(go.dataset.sbgopane); return; }
      });
      pane.addEventListener('input', function (e) {
        var t = e.target;
        if (t.id === 'sbHost') { SB.conn.host = t.value; return; }
        if (t.id === 'sbPort') { SB.conn.port = Number(t.value) || SB_DEFAULTS.port; return; }
        if (t.id === 'sbPassword') return;
        if (t.dataset && t.dataset.sbtext) { SB.draft[t.dataset.sbtext] = t.value; sbDirty(true); }
      });
      pane.addEventListener('change', function (e) {
        var t = e.target;
        if (t.dataset && t.dataset.sbnum) {
          // Не перерисовываем вкладку: щелчок по «Записать» сначала снимает фокус с поля,
          // и перерисовка подменила бы кнопку между нажатием и отпусканием — клик бы потерялся.
          var n = Number(String(t.value).replace(',', '.'));
          if (!isFinite(n)) { toast('Нужно число'); return; }
          SB.draft[t.dataset.sbnum] = Math.round(n);
          sbDirty(true);
        }
      });
    }

    var accept = $('sbAcceptTg');
    if (accept) accept.addEventListener('click', function () { sbToggleAccept(!sbAccepted()); });

    var warn = $('sbotWarn');
    if (warn) warn.addEventListener('click', function () { sbOpen(); });

    document.addEventListener('click', function (e) {
      var go = e.target.closest ? e.target.closest('[data-go="sSbot"]') : null;
      if (go) sbOpen();
    });
  }

  sbBind();
  if (A.onSbotState) A.onSbotState(sbApplyState);
  // Первый проход: точка в меню, строки чеклиста и шапка должны быть верными
  // ещё до открытия раздела.
  sbLoad(true);
