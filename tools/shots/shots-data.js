// Подставные данные для снимков сайта и README (tools/shots/make-shots.py).
// Загружается ПОСЛЕ tests/ui/mock5.js и mock_req.js: те не меняем, здесь только подменяем
// ответы моста window.app на выдуманные, но правдоподобные. Ничего не ходит в сеть:
// обложки — градиенты data-URI, тексты и ники придуманы.
(function () {
  'use strict';
  var A = window.app;
  if (!A) return;
  var P = function (v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 15); }); };

  // ── Обложки: цветные градиенты прямо в data-URI (без скачивания картинок) ─────────
  var COVER_COLORS = {};
  function svgUri(svg) { return 'data:image/svg+xml;base64,' + btoa(svg); }
  function cover(a, b) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/>'
      + '</linearGradient></defs>'
      + '<rect width="180" height="180" fill="url(#g)"/>'
      + '<circle cx="132" cy="48" r="36" fill="#ffffff" opacity="0.16"/>'
      + '<circle cx="46" cy="138" r="48" fill="#000000" opacity="0.16"/>'
      + '<path d="M0 148 L180 96 L180 180 L0 180 Z" fill="#000000" opacity="0.12"/>'
      + '</svg>';
    var u = svgUri(svg);
    COVER_COLORS[u] = a;
    return u;
  }
  function artist(a, b) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">'
      + '<defs><radialGradient id="g" cx="0.35" cy="0.3" r="0.9">'
      + '<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/>'
      + '</radialGradient></defs>'
      + '<rect width="120" height="120" fill="url(#g)"/>'
      + '<circle cx="60" cy="46" r="20" fill="#ffffff" opacity="0.22"/>'
      + '<path d="M22 120 Q60 76 98 120 Z" fill="#ffffff" opacity="0.16"/>'
      + '</svg>';
    return svgUri(svg);
  }

  var CB = {
    blood: cover('#C05A38', '#4A1A18'),
    kuk: cover('#2F6D8C', '#102B3D'),
    star: cover('#C9A227', '#4A3410'),
    cig: cover('#8C7A6B', '#2A2420'),
    school: cover('#7A4FC4', '#241A46'),
    change: cover('#B23A6A', '#3A1230'),
    zem: cover('#3D6BD2', '#16224A'),
    mum: cover('#2E8C6A', '#0F3A2A'),
    splin: cover('#2F8FB0', '#113240'),
    daft: cover('#D6B44A', '#3A2A08'),
    fleet: cover('#C4503A', '#3E1A14'),
    rom: cover('#C46A90', '#3A1424'),
    orbit: cover('#6A4FC4', '#231A4A'),
    live: cover('#8A3B2E', '#2A0F0C'),
    acoust: cover('#4A7C59', '#15291C'),
    sc: cover('#E07A2F', '#4A2508'),
    au: cover('#9B4FBF', '#2E133A')
  };
  var AR = {
    kino: artist('#D46A45', '#3A1210'),
    coi: artist('#4A6FA5', '#141F35'),
    kino2: artist('#8A4F9E', '#241030')
  };

  // ── Треки ─────────────────────────────────────────────────────────────────────────
  var SECS = {};
  function dur(sec) { var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function T(src, id, title, author, sec, o) {
    o = o || {};
    SECS[String(id)] = sec;
    var v = { src: src, id: String(id), title: title, author: author, seconds: sec, duration: dur(sec), thumb: o.thumb || '' };
    if (o.album) v.album = o.album;
    if (o.albumId) v.albumId = o.albumId;
    return v;
  }
  function req(v, who, key) { v.req = { who: who, key: key, amt: 100, cur: 'RUB' }; return v; }

  // Поиск «Кино»: исполнители, плейлисты и треки с четырёх площадок.
  // Первым исполнителем — Виктор Цой: иначе выдача добавляет блок «Волны» («В стиле Кино»)
  // и он съедает место, на котором должны быть видны треки разных площадок.
  var SEARCH = {
    ym: {
      artists: [
        { id: '78', name: 'Виктор Цой', thumb: AR.coi },
        { id: '77', name: 'Кино', thumb: AR.kino },
        { id: '79', name: 'Kino', thumb: AR.kino2 }
      ],
      playlists: [
        { src: 'ym', type: 'playlist', uid: '1041', kind: '3', title: 'Кино: лучшее', count: 42, thumb: CB.blood },
        { src: 'ym', type: 'playlist', uid: '2044', kind: '3', title: 'Русский рок 80-х', count: 64, thumb: CB.school },
        { src: 'yt', type: 'playlist', listId: 'PLKINO', title: 'Кино — клипы', count: 128, thumb: CB.live }
      ],
      tracks: [
        T('ym', 'ym-gk', 'Группа крови', 'Кино', 238, { thumb: CB.blood, album: 'Группа крови', albumId: '20377' })
      ]
    },
    yt: {
      videos: [
        T('yt', 'yt-ps', 'Пачка сигарет (концерт, 1990)', 'Кино · архив', 274, { thumb: CB.cig })
      ],
      playlists: []
    },
    sc: [
      T('sc', 'sc-vos', 'Восьмиклассница (cover)', 'Starlight Covers', 235, { thumb: CB.sc })
    ],
    au: []
  };

  // ── Заказы со стрима ──────────────────────────────────────────────────────────────
  function order(key, name, text, amount, level, track, alts) {
    return {
      key: key, prov: 'da', name: name, text: text, amount: amount, currency: 'RUB',
      at: Date.now(), got: Date.now(), level: level, state: 'new',
      items: [{ level: level, track: track, alts: alts || [], flags: [], paid: true, query: text }]
    };
  }
  var NOW = Date.now();
  var REQUESTS = [
    order('rq-gk', 'lera_k', 'Поставь, пожалуйста, Кино — Группа крови', 300, 'exact',
      T('ym', 'rq-gk-t', 'Группа крови', 'Кино', 238, { thumb: CB.blood })),
    order('rq-vyhod', 'dimon_play', 'Сплин — Выхода нет, спасибо за стрим!', 150, 'exact',
      T('ym', 'rq-vyhod-t', 'Выхода нет', 'Сплин', 210, { thumb: CB.splin })),
    order('rq-kuk', 'kot_v_sapogah', 'Хочу песню про кукушку, любую', 500, 'doubt',
      T('ym', 'rq-kuk-t', 'Кукушка', 'Земфира', 230, { thumb: CB.zem }),
      [T('ym', 'rq-kuk-a', 'Кукушка', 'Полина Гагарина', 260, { thumb: CB.kuk }),
       T('ym', 'rq-kuk-b', 'Кукушка', 'Кино', 278, { thumb: CB.kuk })])
  ];
  // «Активные» сортируются по времени (старые выше), лента — наоборот, новые сверху:
  // так на снимке видно и точные заказы, и спорный (он самый свежий).
  REQUESTS.forEach(function (r, i) {
    var min = [8, 5, 1][i];
    r.at = r.got = NOW - min * 60000;
  });

  // ── Очереди ───────────────────────────────────────────────────────────────────────
  // Первый трек — та же песня, что первая в выдаче (id ym-gk): строка поиска подсветится как играющая.
  var QUEUE_SEARCH = [
    T('ym', 'ym-gk', 'Группа крови', 'Кино', 238, { thumb: CB.blood }),
    T('yt', 'qc-lucky', 'Get Lucky', 'Daft Punk', 248, { thumb: CB.daft }),
    T('sc', 'qc-dreams', 'Dreams (remaster)', 'Fleetwood Mac', 257, { thumb: CB.fleet }),
    req(T('ym', 'qc-vyhod', 'Выхода нет', 'Сплин', 210, { thumb: CB.splin }), 'dimon_play', 'q-2'),
    T('ym', 'qc-zv', 'Звезда по имени Солнце', 'Кино', 226, { thumb: CB.star })
  ];
  var QUEUE_ORDERS = [
    T('ym', 'qo-hochesh', 'Хочешь?', 'Земфира', 215, { thumb: CB.zem }),
    T('yt', 'qo-lucky', 'Get Lucky', 'Daft Punk', 248, { thumb: CB.daft }),
    T('sc', 'qo-dreams', 'Dreams (remaster)', 'Fleetwood Mac', 257, { thumb: CB.fleet }),
    T('ym', 'qo-zv', 'Звезда по имени Солнце', 'Кино', 226, { thumb: CB.star }),
    T('ym', 'qo-vlad', 'Владивосток 2000', 'Мумий Тролль', 222, { thumb: CB.mum })
  ];
  var QUEUE_LONG = [
    T('ym', 'ql-gk', 'Группа крови', 'Кино', 238, { thumb: CB.blood }),
    T('ym', 'ql-hochesh', 'Хочешь?', 'Земфира', 215, { thumb: CB.zem }),
    T('ym', 'ql-vlad', 'Владивосток 2000', 'Мумий Тролль', 222, { thumb: CB.mum }),
    req(T('ym', 'ql-vyhod', 'Выхода нет', 'Сплин', 210, { thumb: CB.splin }), 'lera_k', 'q-l1'),
    req(T('yt', 'ql-lucky', 'Get Lucky', 'Daft Punk', 248, { thumb: CB.daft }), 'dimon_play', 'q-l2'),
    T('sc', 'ql-dreams', 'Dreams (remaster)', 'Fleetwood Mac', 257, { thumb: CB.fleet }),
    req(T('ym', 'ql-kuk', 'Кукушка', 'Кино', 278, { thumb: CB.kuk }), 'kot_v_sapogah', 'q-l3'),
    T('au', 'ql-rom', 'Ромашки', 'Земфира', 197, { thumb: CB.rom }),
    req(T('ym', 'ql-orbit', 'Орбит без сахара', 'Сплин', 199, { thumb: CB.orbit }), 'nastya_s', 'q-l4'),
    T('ym', 'ql-zv', 'Звезда по имени Солнце', 'Кино', 226, { thumb: CB.star }),
    req(T('ym', 'ql-ps', 'Пачка сигарет', 'Кино', 274, { thumb: CB.cig }), 'DemoViewer', 'q-l5'),
    T('yt', 'ql-instant', 'Instant Crush', 'Daft Punk', 337, { thumb: CB.daft })
  ];
  // Заказ из чата Twitch через Streamer.bot — для снимка главного окна (sb-07).
  var QUEUE_SBOT = [
    req(T('ym', 'sb-kuk', 'Кукушка', 'Кино', 278, { thumb: CB.kuk }), 'lera_k', 'sb-cmd:q-lera'),
    T('ym', 'sb-vyhod', 'Выхода нет', 'Сплин', 210, { thumb: CB.splin }),
    req(T('ym', 'sb-vlad', 'Владивосток 2000', 'Мумий Тролль', 222, { thumb: CB.mum }), 'dimon_play', 'sb-points:q-dimon'),
    T('yt', 'sb-lucky', 'Get Lucky', 'Daft Punk', 248, { thumb: CB.daft }),
    T('sc', 'sb-dreams', 'Dreams (remaster)', 'Fleetwood Mac', 257, { thumb: CB.fleet })
  ];

  // ── Streamer.bot: выдуманное состояние связи и конструктора (снимки sb-*) ───────
  var SB_GLOBALS = {
    tapyorCmdOrder: '!sr, !play', tapyorOnOrder: '1', tapyorCmdSong: '!song', tapyorOnSong: '1',
    tapyorCmdPlace: '!place', tapyorOnPlace: '1', tapyorCmdCancel: '!cancel', tapyorOnCancel: '1',
    tapyorCmdSkip: '!skip', tapyorOnSkip: '1', tapyorWho: 'all', tapyorFollowDays: '0',
    tapyorPerUser: '1', tapyorPauseMin: '30', tapyorChatCap: '10', tapyorVipFree: '1',
    tapyorDoubt: 'wait', tapyorPoints: '1', tapyorRewardName: 'Заказать песню',
    tapyorRewardId: 'demo-reward-1', tapyorPauseReward: '1', tapyorReplyAs: 'bot',
    tapyorReplyMode: 'reply', tapyorUrl: 'http://127.0.0.1:47654',
    tapyorKey: 'tp_demo_only_for_shots'
  };
  var SB_STATE = {
    status: 'ok', text: 'Связь со Streamer.bot есть', host: '127.0.0.1', port: 8080,
    endpoint: '/', hasPassword: true, sbVersion: '1.0.7',
    twitch: { connected: true, name: 'demo_streamer' },
    bot: { connected: true, name: 'demo_bot' },
    templateFound: true, templateVersion: 1, templateCurrent: 1,
    actionsFound: { setup: true, findReward: true, played: true, dropped: true },
    triggersFound: ['tapyor_order_queued', 'tapyor_order_pending', 'tapyor_order_played',
      'tapyor_order_dropped', 'tapyor_track_started', 'tapyor_queue_empty',
      'tapyor_accept_changed'],
    lastOrderAt: 0, tapyorPort: 47654, chatOrders: 'sbot', accepting: true, mailbox: 0,
    globals: SB_GLOBALS,
    written: JSON.parse(JSON.stringify(SB_GLOBALS))
  };

  // ── Мост window.app: подменяем ответы ────────────────────────────────────────────
  A.getVersion = function () { return P('0.37.0'); };
  A.buildInfo = function () { return P({ build: 'stable', commit: '', version: '0.37.0' }); };
  A.ymStatus = function () { return P({ loggedIn: true, name: 'Демо', hasPlus: true }); };
  A.ytAuthStatus = function () {
    return P({ cookies: { name: 'DemoViewer', photo: '' }, oauth: { configured: true, account: null }, useCookies: false });
  };
  A.ymSearch = function () { return P(SEARCH.ym); };
  A.ytSearch = function () { return P(SEARCH.yt); };
  A.scSearch = function () { return P(SEARCH.sc); };
  A.auSearch = function () { return P(SEARCH.au); };
  A.ymSearchPage = function () { return P([]); };
  A.ytSearchMore = function () { return P([]); };
  A.ymSearchPls = function () { return P([]); };

  function streamFor(id) {
    var sec = SECS[String(id)] || 230;
    return P({ audioUrl: '/__shots/audio?sec=' + sec });
  }
  A.ymStream = streamFor;
  A.ytStream = streamFor;
  A.urlStream = streamFor;
  A.auStream = streamFor;

  A.coverColor = function (u) { return P(COVER_COLORS[u] || '#D17834'); };

  // Streamer.bot: экран настроек получает состояние и globals тем же мостом, что и в программе.
  A.sbotStatus = function () { return P(JSON.parse(JSON.stringify(SB_STATE))); };
  A.sbotGlobals = function () { return P(JSON.parse(JSON.stringify(SB_GLOBALS))); };
  A.sbotPortKey = function () { return P('tp_demo_only_for_shots'); };
  A.sbotSetConn = function (o) { return P({ ok: true, host: o.host, port: o.port, endpoint: '/', hasPassword: true, changed: true }); };
  A.sbotConnect = function () { return P({ ok: true }); };
  A.sbotDisconnect = function () { return P({ ok: true }); };
  A.sbotCopyTemplate = function () { return P({ ok: true }); };
  A.sbotFindReward = function () { return P({ ok: true, rewardId: 'demo-reward-1', message: 'награда найдена' }); };
  A.sbotTest = function () { return P({ ok: true, version: '1.0.7' }); };
  A.sbotTrigger = function () { return P({ ok: true, message: 'триггер отправлен — проверь своё действие в Streamer.bot' }); };
  A.sbotPortKeyReset = function () { return P({ ok: true }); };
  A.sbotWriteSettings = function (v) {
    SB_STATE.written = JSON.parse(JSON.stringify(v));
    SB_GLOBALS = Object.assign(SB_GLOBALS, v);
    SB_STATE.globals = SB_GLOBALS;
    return P({ ok: true, count: Object.keys(v).length });
  };
  A.onSbotState = function () {};

  // Пак стримера — для снимков «Модули → Чат-бот» (sb-08, sb-09). Имена выдуманы.
  A.modStatus = function () {
    return P({
      installed: true, running: true, error: null,
      manifest: { id: 'streamer-pack', version: '0.5.0', minCore: '0.36.0', modules: [{ id: 'bot', name: 'Чат-бот Twitch' }] },
      dev: false, prev: null, server: false, keyMask: '',
      license: { enabled: true, state: 'full' },
      modules: { bot: { name: 'Чат-бот Twitch', running: true, error: null } }
    });
  };
  A.botCmd = function (cmd) {
    if (cmd === 'settings') {
      return P({
        accepting: window.__store.chatOrders === 'pack', onlyLive: true, identity: 'bot',
        commandsOn: true, pointsOn: true, triggers: ['!play'], approval: 'auto', sharedChat: 'own',
        channelLogin: 'demo_streamer',
        access: { viewer: { access: 'event' }, follower: { access: 'event', minDays: 7 },
          sub: { access: 'event' }, vip: { access: 'event' } },
        reward: { title: 'Заказать песню', cost: 1000 }
      });
    }
    if (cmd === 'status') {
      return P({ channel: { login: 'demo_streamer' }, online: true,
        broadcaster: { login: 'demo_streamer' }, chat: { login: 'demo_bot' } });
    }
    if (cmd === 'replyDefaults') return P({});
    return P([]);
  };
  A.onModStatus = function () {};

  // Общий выключатель заказов: главный процесс в жизни присылает тост. Здесь — то же
  // событие, чтобы на снимке sb-09 был настоящий текст переключения.
  var oldSetSetting = A.setSetting;
  A.onUiToast = function (cb) { window.__shotToast = cb; };
  A.setSetting = function (k, v) {
    var r = oldSetSetting(k, v);
    if (k === 'chatOrders' && window.__shotToast) {
      window.__shotToast(v === 'sbot' ? 'Чат-бот пака выключен: заказы из чата теперь через Streamer.bot'
        : v === 'pack' ? 'Streamer.bot выключен: заказы из чата теперь принимает чат-бот пака'
        : 'Приём заказов из чата выключен');
    }
    return r;
  };
  window.__store.chatOrders = 'sbot';
  window.__store.sbotEnabled = true;
  window.__store.streamerMode = true;

  // ── Помощники для make-shots.py ─────────────────────────────────────────────────
  window.SHOTS = {
    queueSearch: QUEUE_SEARCH,
    queueOrders: QUEUE_ORDERS,
    queueLong: QUEUE_LONG,
    queueSbot: QUEUE_SBOT,
    requests: REQUESTS,
    // Живая очередь: сначала в конец, потом включаем выбранный трек (как это делает окно).
    seed: function (list, at) {
      setQueueMode('live');
      queue.length = 0; current = -1; playingId = null;
      addMany(list);
      var p = (at > 0) ? playIndex(at) : null;
      return Promise.resolve(p).then(function () { return queue.length; });
    },
    // 「Играет» по-настоящему: перематываем звук, чтобы на снимке был виден прогресс.
    seek: function (frac) {
      return new Promise(function (res) {
        var t0 = Date.now();
        (function poll() {
          var m = master();
          if (m && m.readyState >= 1 && isFinite(m.duration) && m.duration > 0) {
            try { m.currentTime = Math.max(1, m.duration * frac); } catch (e) { /* не перемоталось */ }
            res(true); return;
          }
          if (Date.now() - t0 > 6000) { res(false); return; }
          setTimeout(poll, 60);
        })();
      });
    },
    // Заказы приходят тем же событием, что и настоящие донаты.
    feedRequests: function () {
      if (!window.__reqCb) return 0;
      REQUESTS.forEach(function (r) { window.__reqCb(r); });
      return REQUESTS.length;
    }
  };
})();
