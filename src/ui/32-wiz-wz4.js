// Шаги визарда WZ4 (14.11.2026): «Донаты», «Правила заказов», «Заказы в деле».
// Окно визарда шлёт команду {op:'do', name, args}; здесь — её исполнение в главном окне
// и ответ обратно событиями wizardEmit. Шаги и их тексты — src/wizard/steps/<id>.js.
// Действия используют существующие функции Тапёра (вход в донаты, настройки, тестовый заказ),
// ничего не дублируют. Цветов здесь нет — только классы и переменные темы в CSS визарда.

var WZ4 = {
  keys: [],        // ключи наших пробных заказов в «Заказах»
  waitKey: '',     // заказ, который ждёт решения (на нём ждут «＋ В очередь»)
  tagTimer: null,  // отложенная разметка строк очереди и карточки для подсветки
  observer: null,  // следит за перерисовкой «Заказов» и очереди
  busy: false,
  cancelled: false,
  revealed: false
};

function wz4Text(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

function wz4Get(key) {
  try {
    if (!A.getSetting) return Promise.resolve(null);
    return Promise.resolve(A.getSetting(key)).catch(function () { return null; });
  } catch (e) { return Promise.resolve(null); }
}

function wz4Emit(evt) {
  try { wizardEmit(evt || {}); } catch (e) {}
}

// ── Донаты ──────────────────────────────────────────────────────────────────
// Одна форма состояния для ответа и для события: шаг «Донаты» отмечает подключённое
// по состоянию, а не по нажатию кнопки (вход мог не получиться).
function wz4DonPart(s) {
  var d = s && typeof s === 'object' ? s : {};
  var da = d.da || {};
  var dp = d.dp || {};
  return {
    da: {
      connected: !!da.connected,
      ok: da.ok !== false,
      name: (da.account && da.account.name) || '',
      error: da.error ? wz4Text(da.error, 120) : ''
    },
    dp: {
      connected: !!dp.connected,
      ok: dp.ok !== false,
      name: (dp.account && dp.account.name) || '',
      error: dp.error ? wz4Text(dp.error, 120) : ''
    }
  };
}

function wz4DonState() {
  var don = Promise.resolve(null);
  try {
    if (A.donStatus) don = Promise.resolve(A.donStatus()).catch(function () { return null; });
  } catch (e) { don = Promise.resolve(null); }
  Promise.all([don, wz4Get('reqPrice'), wz4Get('reqCurrency')]).then(function (r) {
    var part = wz4DonPart(r[0] || {});
    wz4Emit(Object.assign({ type: 'donState' }, part, {
      price: Number(r[1]) || 0,
      currency: String(r[2] || 'RUB')
    }));
  }).catch(function (e) {
    wz4Emit({ type: 'donError', what: 'state', code: wz4Text(e && e.message, 120) });
  });
}
wizardAction('wz4DonState', wz4DonState);

// Пока визард ждёт вход в DonationAlerts, donStatus по кругу не опрашиваем: главное окно
// само присылает событие при изменении (A.onDonStatus). Шлём не чаще раза в 2 секунды
// и только когда состояние правда поменялось — последнее изменение не теряется, а ждёт.
var WZ4_DON_PUSH_MS = 2000;
WZ4.donLast = 0;
WZ4.donTimer = null;
WZ4.donNext = null;
WZ4.donSig = '';
function wz4DonSig(part) {
  return [part.da.connected, part.da.ok, part.da.name, part.dp.connected, part.dp.ok, part.dp.name].join('|');
}
function wz4DonSend(part) {
  WZ4.donLast = Date.now();
  WZ4.donNext = null;
  WZ4.donSig = wz4DonSig(part);
  wz4Emit(Object.assign({ type: 'donState' }, part));
}
function wz4DonPush(s) {
  var part = wz4DonPart(s);
  var sig = wz4DonSig(part);
  var cur = WZ4.donNext ? wz4DonSig(WZ4.donNext) : WZ4.donSig;
  if (sig === cur) return;
  WZ4.donNext = part;
  var left = WZ4_DON_PUSH_MS - (Date.now() - WZ4.donLast);
  if (left <= 0) { wz4DonSend(part); return; }
  if (!WZ4.donTimer) {
    WZ4.donTimer = setTimeout(function () {
      WZ4.donTimer = null;
      if (WZ4.donNext) wz4DonSend(WZ4.donNext);
    }, left);
  }
}
try {
  if (A.onDonStatus) A.onDonStatus(function (s) { wz4DonPush(s); });
} catch (e) {}

// ── Правила заказов ─────────────────────────────────────────────────────────
function wz4RulesState() {
  Promise.all([wz4Get('reqRules'), wz4Get('reqAuto'), wz4Get('wizardDone')]).then(function (r) {
    var rules = r[0] && typeof r[0] === 'object' ? r[0] : {};
    var stop = Array.isArray(rules.stopWords) ? rules.stopWords : ((window.TapReq && TapReq.DEFAULT_STOP) || []);
    wz4Emit({
      type: 'rulesState',
      auto: r[1] === true,
      done: r[2] === true,
      rules: rules,
      stopText: stop.join(', ')
    });
  }).catch(function (e) {
    wz4Emit({ type: 'rulesError', code: wz4Text(e && e.message, 120) });
  });
}
wizardAction('wz4RulesGet', wz4RulesState);

// Совместимость с уже стоящими переключателями и полями в Настройках → Заказы:
// если раздел открыт, он не должен показывать старые значения после набора из визарда.
function wz4SyncRules(rules, auto) {
  var r = rules || {};
  var max = $('stMax');
  if (max) max.value = String(Math.round((r.maxSec == null ? 420 : Number(r.maxSec) || 0) / 60));
  var stop = $('stStop');
  if (stop && document.activeElement !== stop) {
    var words = Array.isArray(r.stopWords) ? r.stopWords : ((window.TapReq && TapReq.DEFAULT_STOP) || []);
    stop.value = words.join(', ');
  }
  if (typeof setTg === 'function') {
    var map = { stExplicit: 'explicitOk', stRepeat: 'repeatOk', stVersion: 'versionOk', stLookup: 'lookupOk' };
    for (var id in map) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
      var el = $(id);
      if (el) setTg(el, r[map[id]] !== false);
    }
  }
  // «Точные — сразу в очередь» есть в двух местах (шапка «Заказов» и Настройки → Заказы):
  // штатная syncReqAuto обновляет оба, чтобы после набора не осталось старого вида.
  RQ.auto = auto === true;
  if (typeof syncReqAuto === 'function') syncReqAuto();
  else if (typeof setTg === 'function') {
    var tg = document.querySelector('[data-set-tg="reqAuto"]');
    if (tg) setTg(tg, auto === true);
  }
}

wizardAction('wz4RulesApply', function (args) {
  var a = args || {};
  // Текущие правила читаем с диска: REQ_RULES в окне мог ещё не загрузиться или устареть.
  Promise.all([wz4Get('reqRules'), wz4Get('reqAuto')]).then(function (r) {
    var rules = Object.assign({}, (r[0] && typeof r[0] === 'object') ? r[0] : {});
    var auto = typeof a.reqAuto === 'boolean' ? a.reqAuto : (r[1] === true);
    if (typeof a.explicitOk === 'boolean') rules.explicitOk = a.explicitOk;
    if (typeof a.repeatOk === 'boolean') rules.repeatOk = a.repeatOk;
    if (typeof a.versionOk === 'boolean') rules.versionOk = a.versionOk;
    if (a.maxSec != null) {
      var sec = Math.round(Number(a.maxSec));
      rules.maxSec = isFinite(sec) && sec >= 0 ? Math.min(sec, 86400) : 0;
    }
    try {
      if (A.setSetting) {
        Promise.resolve(A.setSetting('reqRules', rules)).catch(function () {});
        if (typeof a.reqAuto === 'boolean') Promise.resolve(A.setSetting('reqAuto', auto)).catch(function () {});
      }
    } catch (e) {}
    REQ_RULES = rules;
    RQ.auto = auto;
    wz4SyncRules(rules, auto);
    wz4RulesState();
  }).catch(function (e) {
    wz4Emit({ type: 'rulesError', code: wz4Text(e && e.message, 120) });
  });
});

// Свой стоп-лист из визарда убран (WC2): поле #stStop правится в Настройках → Заказы,
// а шаг только подсвечивает его по желанию — отдельного действия не нужно.

// ── Заказы в деле ───────────────────────────────────────────────────────────
function wz4HasQueueKey(key) {
  if (!key) return false;
  for (var i = 0; i < queue.length; i++) {
    var v = queue[i];
    if (v && v.req && v.req.key === key) return true;
  }
  return false;
}

// Размечаем строку нашего заказа в очереди и карточку ждущего заказа атрибутами:
// окно визарда подсвечивает их обычной командой highlight по CSS-селектору.
function wz4TagMarks() {
  var rows = document.querySelectorAll('#queue .qrow');
  for (var i = 0; i < rows.length; i++) {
    var v = rows[i]._q;
    var hit = !!(v && v.req && v.req.key && WZ4.keys.indexOf(v.req.key) >= 0);
    if (hit) rows[i].setAttribute('data-wz4q', '1');
    else if (rows[i].hasAttribute('data-wz4q')) rows[i].removeAttribute('data-wz4q');
  }
  var old = document.querySelectorAll('#rqList [data-wz4wait]');
  for (var j = 0; j < old.length; j++) old[j].removeAttribute('data-wz4wait');
  if (!WZ4.waitKey) return;
  var ri = -1;
  for (var k = 0; k < RQ.list.length; k++) if (RQ.list[k] && RQ.list[k].key === WZ4.waitKey) { ri = k; break; }
  if (ri < 0) return;
  var btn = document.querySelector('#rqList [data-id^="' + ri + ':"]');
  var card = btn && btn.closest ? btn.closest('.rq') : null;
  if (!card) return;
  card.setAttribute('data-wz4wait', '1');
  if (!WZ4.revealed) {
    WZ4.revealed = true;
    try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
  }
}

function wz4WatchMarks(on) {
  if (WZ4.observer) { try { WZ4.observer.disconnect(); } catch (e) {} WZ4.observer = null; }
  if (WZ4.tagTimer) { clearTimeout(WZ4.tagTimer); WZ4.tagTimer = null; }
  if (!on || typeof MutationObserver === 'undefined') return;
  WZ4.observer = new MutationObserver(function () {
    if (WZ4.tagTimer) clearTimeout(WZ4.tagTimer);
    WZ4.tagTimer = setTimeout(wz4TagMarks, 30);
  });
  WZ4.observer.observe(document.body, { childList: true, subtree: true });
}

function wz4CreateOrder(o) {
  if (WZ4.cancelled) return Promise.resolve(null);
  if (!A.reqTest) return Promise.resolve(null);
  return Promise.resolve(A.reqTest(o)).then(function (r) {
    if (r && r.key) {
      r.wz4 = true;
      WZ4.keys.push(r.key);
      // Пометка переживает перезапуск: неубранный пробный заказ уберётся при следующем запуске.
      try { if (A.reqUpdate) Promise.resolve(A.reqUpdate(r.key, { wz4: true })).catch(function () {}); } catch (e) {}
    }
    return r || null;
  }).catch(function () { return null; });
}

// Убрать пробные заказы из очереди и из «Заказов». Список для req-clear берём свежий,
// чтобы не удалить чужие заказы, пришедшие за это время.
function wz4RemoveOrders(keys) {
  var set = Object.create(null);
  (keys || []).forEach(function (k) { if (k) set[k] = 1; });
  RQ.list.forEach(function (r) { if (r && r.wz4 === true && r.key) set[r.key] = 1; });
  var list = Object.keys(set);
  if (!list.length) return;
  for (var i = queue.length - 1; i >= 0; i--) {
    var v = queue[i];
    if (v && v.req && v.req.key && set[v.req.key]) {
      try { removeAt(i); } catch (e) {}
    }
  }
  RQ.list = RQ.list.filter(function (r) { return !(r && r.key && set[r.key]); });
  try { rqRender(); } catch (e) {}
  var marks = document.querySelectorAll('[data-wz4q],[data-wz4wait]');
  for (var m = 0; m < marks.length; m++) {
    marks[m].removeAttribute('data-wz4q');
    marks[m].removeAttribute('data-wz4wait');
  }
  if (A.reqList && A.reqClear) {
    Promise.resolve(A.reqList()).then(function (all) {
      var keep = (all || []).filter(function (r) { return r && !set[r.key]; }).map(function (r) { return r.key; });
      try { A.reqClear(keep); } catch (e) {}
    }).catch(function () {});
  } else if (A.reqUpdate) {
    list.forEach(function (k) { try { A.reqUpdate(k, { state: 'dismissed' }); } catch (e) {} });
  }
}

wizardAction('wz4OrdersStart', function () {
  if (WZ4.busy) return;
  WZ4.busy = true;
  WZ4.cancelled = false;
  WZ4.keys = [];
  WZ4.waitKey = '';
  WZ4.revealed = false;
  wz4Emit({ type: 'wz4OrdersLoading' });
  Promise.all([wz4Get('reqAuto'), wz4Get('reqPrice'), wz4Get('reqCurrency')]).then(function (r) {
    if (WZ4.cancelled) return null;
    var auto = r[0] === true;
    var price = Math.max(0, Math.round(Number(r[1]) || 0));
    var cur = String(r[2] || 'RUB');
    RQ.auto = auto;
    // С достаточной суммой — цена за трек, с недостаточной — половина (как в макете 100 и 50).
    var a1 = price > 0 ? price : 100;
    var a2 = price > 1 ? Math.max(1, Math.round(price / 2)) : (price > 0 ? 0 : 50);
    try { setTab('req'); } catch (e) {}
    return wz4CreateOrder({ name: 'Зритель_тест', amount: a1, service: 'da', text: 'Кино — Кукушка' })
      .then(function (first) {
        return wz4CreateOrder({ name: 'Зритель_тест', amount: a2, service: 'da', text: 'Кино — Группа крови' })
          .then(function (second) {
            return { first: first, second: second, auto: auto, price: price, currency: cur };
          });
      });
  }).then(function (res) {
    if (WZ4.cancelled || !res) { var gone = WZ4.keys.slice(); WZ4.keys = []; wz4RemoveOrders(gone); WZ4.busy = false; return; }
    var first = res.first, second = res.second;
    WZ4.waitKey = second && second.key ? second.key : '';
    [first, second].forEach(function (r) {
      if (!r || !r.key) return;
      for (var i = 0; i < RQ.list.length; i++) {
        if (RQ.list[i] && RQ.list[i].key === r.key) { RQ.list[i].wz4 = true; if (r === second) RQ.list[i].wz4wait = true; }
      }
    });
    wz4WatchMarks(true);
    wz4TagMarks();
    var f = first || {};
    var s = second || {};
    var sItem = s.items && s.items[0] ? s.items[0] : null;
    wz4Emit({
      type: 'wz4OrdersReady',
      auto: res.auto,
      currency: res.currency,
      first: {
        key: f.key || '',
        found: f.level === 'exact',
        queued: wz4HasQueueKey(f.key),
        amount: Number(f.amount) || 0,
        title: 'Кино — Кукушка'
      },
      second: {
        key: s.key || '',
        found: s.level === 'exact',
        queued: wz4HasQueueKey(s.key),
        paid: !!(sItem && sItem.paid !== false),
        amount: Number(s.amount) || 0,
        title: 'Кино — Группа крови'
      }
    });
    WZ4.busy = false;
  }).catch(function (e) {
    WZ4.busy = false;
    wz4Emit({ type: 'wz4OrdersError', code: wz4Text(e && e.message, 120) });
  });
});

wizardAction('wz4OrdersCleanup', function () {
  WZ4.cancelled = true;
  var keys = WZ4.keys.slice();
  WZ4.keys = [];
  WZ4.waitKey = '';
  wz4WatchMarks(false);
  wz4RemoveOrders(keys);
  WZ4.busy = false;
});

// Щелчок «＋ В очередь» (или «▶ Сейчас») по карточке нашего ждущего заказа — шаг засчитан.
// Обработчик стоит на уже существующем контейнере «Заказов», соседний код не трогаем.
(function () {
  var box = $('viewReq');
  if (!box) return;
  box.addEventListener('click', function (e) {
    if (!WZ4.waitKey) return;
    var b = e.target && e.target.closest ? e.target.closest('[data-rq="add"], [data-rq="now"]') : null;
    if (!b) return;
    var p = String(b.dataset.id || '').split(':');
    var r = RQ.list[parseInt(p[0], 10)];
    if (!r || r.key !== WZ4.waitKey) return;
    wizardEmit({ type: 'wz4OrderAdded', key: r.key });
  });
})();

// Хвост от прошлого запуска: пробный заказ визарда помечен wz4 и убирается при запуске.
// Ждём загрузку очереди; чужие заказы не трогаем — список для req-clear берётся свежий.
setTimeout(function () {
  if (!A.reqList) return;
  Promise.resolve(A.reqList()).then(function (list) {
    var stale = (list || []).filter(function (r) { return r && r.wz4 === true; }).map(function (r) { return r.key; });
    if (!stale.length) return;
    WZ4.keys = stale;
    wz4RemoveOrders(stale);
    WZ4.keys = [];
  }).catch(function () {});
}, 3200);
