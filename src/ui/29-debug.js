/* global module */
// ===== Отладочное меню (0.34.0) =====
// Вход — «tapyor debug» в строке поиска. Меню доступно всем и целиком, в stable-сборке тоже:
// «секрет» знают все, поэтому защита — переспрос на опасные действия и автокопии, а не тайна.
// Пункт левого меню появляется после входа и живёт до перезапуска; раздел в index.html скрыт.
//
// Разделы лежат в DBG_TABS: новое задание добавляет сюда строку и свою функцию отрисовки.
// Сейчас: «Состояние», «Нагрузка», «Журнал», «Сбросы», «Имитация сбоев», «Падения»,
// «Тестовый заказ», «Собрать отчёт». Сторож окна подключён в «Падениях»; автопочинка
// появится следующим заданием.
//
// 0.34.0, задание 4: тестовый профиль (вход/выход, плашка вверху окна) и три сброса
// с автокопией. Каждое опасное действие переспрашивает словами, что произойдёт.
// 0.34.0, задание 5: имитация сбоев по сервисам (плашка, пока включено) и тестовый донат.
// 0.34.0, задание 6: раздел «Падения» (живёт только в тестовом профиле) и сторож окна.

var DBG = {
  open: false,
  tab: 'state',
  state: null,
  loading: false,
  busy: false,
  savedLog: '',
  savedReport: '',
  profile: null,      // { test, dir } — ответ главного процесса
  backups: [],        // список копий, новые сверху
  backupsLoaded: false,
  autoOpened: false,  // в этой сессии уже показали «Вернуть как было» после сброса
  fault: null,        // { modes, active } — имитация сбоев из главного процесса
  faultLoaded: false,
  faultAsked: false,  // переспрос включения имитации — один раз за сессию
  test: { name: 'Тестовый зритель', amount: 100, service: 'da', text: 'Кино — Кукушка' },
  testBusy: false,
  lastTest: null
};

var DBG_TABS = [
  { id: 'state', n: 'Состояние' },
  { id: 'load', n: 'Нагрузка' },
  { id: 'log', n: 'Журнал' },
  { id: 'resets', n: 'Сбросы' },
  { id: 'fault', n: 'Имитация сбоев' },
  { id: 'crashes', n: 'Падения' },
  { id: 'testorder', n: 'Тестовый заказ' },
  { id: 'report', n: 'Собрать отчёт' }
];

// Названия те же, что в главном процессе (src/debug-counters.js), порядок — как в задании.
var DBG_SERVICES = [
  { id: 'youtube', n: 'YouTube' },
  { id: 'yandex', n: 'Яндекс Музыка' },
  { id: 'donationalerts', n: 'DonationAlerts' },
  { id: 'donatepay', n: 'DonatePay' },
  { id: 'twitch', n: 'Twitch' },
  { id: 'lastfm', n: 'Last.fm' },
  { id: 'github', n: 'GitHub' }
];
// Автопочинка умеет и облачные функции — отдельная строка счётчиков, чтобы не
// путать её со списком «Входы в сервисы» (там облака нет).
var DBG_AUTOFIX = DBG_SERVICES.concat([{ id: 'cloud', n: 'Облачные функции' }]);

// Имитация сбоев (0.34.0, задание 5). Порядок и названия — как в src/fault-sim.js.
var DBG_FAULT = [
  { id: 'all', n: 'Вся сеть' },
  { id: 'yt', n: 'YouTube' },
  { id: 'ym', n: 'Яндекс Музыка' },
  { id: 'da', n: 'DonationAlerts' },
  { id: 'dp', n: 'DonatePay' },
  { id: 'twitch', n: 'Twitch' },
  { id: 'lastfm', n: 'Last.fm' },
  { id: 'cloud', n: 'Облако Тапёра' }
];
var DBG_FAULT_MODES = [
  { id: '', n: 'нет' },
  { id: 'down', n: 'недоступен' },
  { id: 'offline', n: 'нет сети' },
  { id: 'slow', n: 'медленно' },
  { id: 'auth', n: 'вход отозван' }
];

// Маленькая чистая проверка: запрос без учёта регистра и лишних пробелов равен «tapyor debug».
// Вынесена отдельно, чтобы покрыть unit-тестом; в index.html скрипт не пишется.
function isDebugCommand(q) {
  if (typeof q !== 'string') return false;
  var s = q.trim().toLowerCase().replace(/\s+/g, ' ');
  return s === 'tapyor debug';
}

function dbgTwo(n) { return n < 10 ? '0' + n : String(n); }
function dbgClock(ts) {
  var n = Number(ts);
  if (!isFinite(n) || n <= 0) return '—';
  var d = new Date(n);
  return dbgTwo(d.getHours()) + ':' + dbgTwo(d.getMinutes()) + ':' + dbgTwo(d.getSeconds());
}
function dbgMem(v) { return v == null ? '—' : Math.round(v) + ' МБ'; }
function dbgCpu(v) { return v == null ? '—' : Number(v).toFixed(1).replace('.', ',') + ' %'; }

function dbgRow(label, valueHtml, note) {
  return '<div class="srow"><div class="sl"><div class="st">' + esc(label) + '</div>'
    + (note ? '<div class="sd">' + esc(note) + '</div>' : '')
    + '</div><div class="sd">' + valueHtml + '</div></div>';
}
function dbgRowV(label, value, note) { return dbgRow(label, esc(value == null || value === '' ? '—' : String(value)), note); }
function dbgRowAction(label, note, actionHtml) {
  return '<div class="srow"><div class="sl"><div class="st">' + esc(label) + '</div>'
    + (note ? '<div class="sd">' + esc(note) + '</div>' : '')
    + '</div>' + actionHtml + '</div>';
}
function dbgYes(v) {
  return '<span class="pill' + (v ? ' ok' : '') + '">' + (v ? 'есть' : 'нет') + '</span>';
}

// Необязательные сайд-эффекты не должны ронять меню: интерфейс должен открыться даже,
// если какая-то часть моста ещё не готова (например, при поддельном window.app в тестах).
function dbgToast(text) {
  if (typeof toast === 'function') { try { toast(text); return; } catch (e) {} }
}

// Переспрос: свой диалог (askDlg из 09-taplists.js), запасной — окно браузера.
function dbgConfirm(o) {
  if (typeof askDlg === 'function') return askDlg(o);
  try {
    var s = (o.title ? o.title + '\n\n' : '') + String(o.text || '').replace(/<br\s*\/?>/gi, '\n');
    return Promise.resolve(confirm(s) ? { value: '', checked: false } : null);
  } catch (e) { return Promise.resolve(null); }
}

// ---- тестовый профиль (0.34.0, задание 4) ----
function dbgProfileTest() {
  if (DBG.profile) return !!DBG.profile.test;
  return !!(DBG.state && DBG.state.testProfile);
}
function dbgApplyBanner() {
  var bar = $('testProfileBar');
  if (bar) bar.hidden = !dbgProfileTest();
}
function dbgLoadProfile() {
  if (!A.debugProfile) return;
  A.debugProfile().then(function (r) {
    if (!r) return;
    DBG.profile = { test: !!r.test, dir: r.dir || '' };
    dbgApplyBanner();
    if (DBG.open) dbgRenderBody();
  }).catch(function () {});
}
function dbgStartTestProfile() {
  dbgConfirm({
    title: 'Перезапустить в тестовом профиле?',
    text: 'Тапёр перезапустится с чистыми настройками во временной папке. Ваши входы, ключи, плейлисты и очередь не тронутся.<br><br>Сессии входа в браузерной вкладке (YouTube, Telegram) в тестовом профиле будут пустыми — это нормально.',
    ok: 'Перезапустить'
  }).then(function (r) {
    if (!r) return;
    if (!A.debugTestProfileStart) { dbgToast('В этой сборке нет тестового профиля'); return; }
    A.debugTestProfileStart().then(function (res) {
      if (res && res.ok === false) dbgToast('Не получилось: ' + (res.error || 'неизвестная ошибка'));
      else dbgToast('Перезапускаю в тестовом профиле…');
    }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
  });
}
function dbgReturnNormal() {
  dbgConfirm({
    title: 'Вернуться в мой профиль?',
    text: 'Тестовый профиль будет удалён. Тапёр перезапустится в вашем обычном профиле.<br><br>Сессии входа в браузерной вкладке (YouTube, Telegram) в тестовом профиле были пустыми — это нормально.',
    ok: 'Вернуться'
  }).then(function (r) {
    if (!r) return;
    if (!A.debugTestProfileReturn) { dbgToast('В этой сборке нет возврата'); return; }
    A.debugTestProfileReturn().then(function (res) {
      if (res && res.ok === false) dbgToast('Не получилось: ' + (res.error || 'неизвестная ошибка'));
      else dbgToast('Возвращаюсь в обычный профиль…');
    }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
  });
}
// Первая карточка меню в обычном профиле. В тестовом её нет — там сверху плашка.
function dbgTopHtml() {
  if (dbgProfileTest()) return '';
  return '<div class="card"><div class="srow"><div class="sl">'
    + '<div class="st">Тестовый профиль</div>'
    + '<div class="sd">Тапёр перезапустится с чистыми настройками во временной папке. Ваши входы, ключи, плейлисты и очередь не тронутся.</div>'
    + '</div><button class="btn" data-dbg-act="test-profile">Перезапустить в тестовом профиле</button></div></div>';
}
function dbgRenderTop() { var top = $('dbgTop'); if (top) top.innerHTML = dbgTopHtml(); }

// ---- сбросы и автокопии (0.34.0, задание 4) ----
function dbgBackupDate(at) {
  var n = Number(at);
  if (!isFinite(n) || n <= 0) return 'дата неизвестна';
  var d = new Date(n);
  return dbgTwo(d.getDate()) + '.' + dbgTwo(d.getMonth() + 1) + '.' + d.getFullYear()
    + ' ' + dbgTwo(d.getHours()) + ':' + dbgTwo(d.getMinutes()) + ':' + dbgTwo(d.getSeconds());
}
function dbgKindText(k) {
  if (k === 'settings') return 'настройки';
  if (k === 'license') return 'лицензия';
  if (k === 'trial') return 'триал';
  if (k === 'encoding') return 'кодировка';
  return String(k || 'копия');
}
function dbgResetsHtml() {
  var items = DBG.backups || [];
  var latest = items[0];
  var h = '<div class="disc"><div><b>Сбросы с автокопией.</b> Перед каждым сбросом Тапёр сделает копию настроек. Хранятся 5 последних, любую можно вернуть.</div></div>';
  if (latest) {
    h += '<div class="card">' + dbgRowAction('Вернуть как было',
      'Последняя копия: ' + dbgKindText(latest.kind) + ' от ' + dbgBackupDate(latest.at) + '. Тапёр перезапустится.',
      '<button class="btn" data-dbg-act="restore" data-id="' + esc(latest.id) + '"' + (DBG.busy ? ' disabled' : '') + '>Вернуть как было</button>') + '</div>';
    h += '<div style="height:12px"></div>';
  } else if (DBG.backupsLoaded) {
    h += '<div class="disc"><div>Резервных копий пока нет — они появятся перед первым сбросом.</div></div>';
  }
  h += '<div class="card">';
  h += dbgRowAction('Сбросить настройки', 'Заводские настройки. Останутся: входы и ключи, лицензии, плейлисты, темы (выбранная тема тоже). Перед сбросом — копия.', '<button class="btn" data-dbg-act="reset" data-kind="settings"' + (DBG.busy ? ' disabled' : '') + '>Сбросить настройки</button>');
  h += dbgRowAction('Сбросить лицензию', 'Лицензия и ключ удалятся только на этом ПК. Место на сервере не освобождается. Вернуть — кнопкой «Вернуть как было» или ввести ключ заново.', '<button class="btn" data-dbg-act="reset" data-kind="license"' + (DBG.busy ? ' disabled' : '') + '>Сбросить лицензию</button>');
  h += dbgRowAction('Сбросить триал', 'Пробный период учитывается на сервере: повторно взять его на этом ПК нельзя. Сброс только убирает его отметку в Тапёре — так можно проверить, как Тапёр выглядит без пробного периода.', '<button class="btn" data-dbg-act="reset" data-kind="trial"' + (DBG.busy ? ' disabled' : '') + '>Сбросить триал</button>');
  h += dbgRowAction('Визард: открыть с начала', 'Окно знакомства с первого экрана. Настройки, которые уже стоят, не меняются, пока не выберешь ветку.', '<button class="btn" data-dbg-act="wizard-open">Визард: открыть с начала</button>');
  h += dbgRowAction('Визард: сбросить отметку первого запуска', 'После перезапуска визард снова откроется сам — как при новой установке. Настройки не трогаются.', '<button class="btn ghost" data-dbg-act="wizard-reset">Сбросить отметку</button>');
  h += '</div>';
  h += '<div class="sec-h" style="margin-top:18px"><h2>Резервные копии</h2><span>Хранятся 5 последних</span></div>';
  if (!items.length) h += '<div class="sd">' + (DBG.backupsLoaded ? 'Копий пока нет.' : 'Загружаю список копий…') + '</div>';
  else {
    h += '<div class="card">';
    items.forEach(function (it) {
      h += dbgRowAction(dbgBackupDate(it.at), dbgKindText(it.kind) + (it.version ? ' · версия ' + it.version : ''),
        '<button class="btn ghost" data-dbg-act="restore" data-id="' + esc(it.id) + '"' + (DBG.busy ? ' disabled' : '') + '>Вернуть</button>');
    });
    h += '</div>';
  }
  return h;
}
function dbgLoadBackups() {
  if (!A.debugBackups) { DBG.backupsLoaded = true; if (DBG.open) dbgRenderBody(); return; }
  A.debugBackups().then(function (r) {
    DBG.backupsLoaded = true;
    DBG.backups = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
    if (DBG.open) { dbgRenderNav(); dbgRenderBody(); }
    dbgMaybeShowResets();
  }).catch(function () { DBG.backupsLoaded = true; });
}
// После сброса и перезапуска сразу показываем «Вернуть как было»: если последняя
// копия свежая (полчаса), открываем раздел «Сбросы» сам.
function dbgMaybeShowResets() {
  if (!DBG.open || DBG.autoOpened) return;
  var latest = DBG.backups && DBG.backups[0];
  if (!latest || !latest.at) return;
  if (Date.now() - Number(latest.at) > 30 * 60 * 1000) return;
  DBG.autoOpened = true;
  dbgSelect('resets');
}
function dbgReset(kind) {
  if (DBG.busy) return;
  var texts = {
    settings: { t: 'Сбросить настройки?', x: 'Вернутся заводские настройки. Останутся: входы и ключи, лицензии, плейлисты, темы (выбранная тема тоже). Сейчас Тапёр сделает копию, затем перезапустится.' },
    license: { t: 'Сбросить лицензию?', x: 'Лицензия и ключ удалятся только на этом ПК. Место на сервере не освобождается. Вернуть — кнопкой «Вернуть как было» или ввести ключ заново. Сейчас Тапёр сделает копию, затем перезапустится.' },
    trial: { t: 'Сбросить триал?', x: 'Пробный период учитывается на сервере: повторно взять его на этом ПК нельзя. Сброс только убирает его отметку в Тапёре — так можно проверить, как Тапёр выглядит без пробного периода. Сейчас Тапёр сделает копию, затем перезапустится.' }
  };
  var c = texts[kind];
  if (!c) return;
  dbgConfirm({ title: c.t, text: c.x, ok: 'Сбросить' }).then(function (r) {
    if (!r) return;
    if (!A.debugReset) { dbgToast('В этой сборке нет сбросов'); return; }
    DBG.busy = true; dbgRenderBody();
    A.debugReset(kind).then(function (res) {
      if (!res || !res.ok) { DBG.busy = false; dbgToast('Не получилось: ' + ((res && res.error) || 'неизвестная ошибка')); dbgRenderBody(); return; }
      dbgToast('Копия сделана, Тапёр перезапускается…');
    }).catch(function (e) { DBG.busy = false; dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); dbgRenderBody(); });
  });
}
function dbgRestore(id) {
  if (DBG.busy) return;
  var it = (DBG.backups || []).find(function (x) { return x.id === id; });
  dbgConfirm({
    title: 'Вернуть эту копию?',
    text: 'Текущие настройки будут заменены копией' + (it ? ' (' + dbgKindText(it.kind) + ' от ' + dbgBackupDate(it.at) + ')' : '') + '. Тапёр перезапустится.',
    ok: 'Вернуть'
  }).then(function (r) {
    if (!r) return;
    if (!A.debugRestore) { dbgToast('В этой сборке нет восстановления'); return; }
    DBG.busy = true; dbgRenderBody();
    A.debugRestore(id).then(function (res) {
      if (!res || !res.ok) { DBG.busy = false; dbgToast('Не получилось: ' + ((res && res.error) || 'неизвестная ошибка')); dbgRenderBody(); return; }
      dbgToast('Восстанавливаю копию, Тапёр перезапускается…');
    }).catch(function (e) { DBG.busy = false; dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); dbgRenderBody(); });
  });
}

// Визард (14.11.2026): открыть с начала и сбросить отметку первого запуска.
function dbgWizardOpen() {
  if (!A.wizardOpen) { dbgToast('В этой сборке нет визарда'); return; }
  A.wizardOpen({ from: 'debug' }).then(function (r) {
    if (r && r.ok === false) dbgToast('Не получилось: ' + (r.error || 'неизвестная ошибка'));
  }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
}
function dbgWizardReset() {
  if (!A.setSetting) { dbgToast('В этой сборке нельзя записать настройку'); return; }
  A.setSetting('wizardDone', false).then(function (ok) {
    if (ok === false) { dbgToast('Настройка не сохранилась'); return; }
    dbgToast('Отметка сброшена — при следующем запуске визард откроется сам');
  }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
}

// ---- имитация сбоев сети (0.34.0, задание 5) ----
function dbgFaultName(id) {
  var x = DBG_FAULT.find(function (v) { return v.id === id; });
  return x ? x.n : String(id || '');
}
function dbgFaultModeName(id) {
  var x = DBG_FAULT_MODES.find(function (v) { return v.id === id; });
  return x ? x.n : String(id || '');
}
function dbgFaultActive() { return (DBG.fault && DBG.fault.active) || []; }
function dbgFaultModeOf(id) { return (DBG.fault && DBG.fault.modes && DBG.fault.modes[id]) || ''; }
function dbgFaultText() {
  return dbgFaultActive().map(function (x) { return dbgFaultName(x.service) + ' — ' + dbgFaultModeName(x.mode); }).join(', ');
}
// Плашка вверху окна: пока включён хоть один режим. Крестика нет — только «Выключить» (всё).
function dbgApplyFaultBar() {
  var bar = $('faultBar'), txt = $('faultBarText');
  if (!bar) return;
  var list = dbgFaultActive();
  bar.hidden = !list.length;
  if (txt) txt.textContent = list.length ? ('Включена имитация сбоя: ' + dbgFaultText()) : '';
}
function dbgLoadFault() {
  if (!A.faultGet) { DBG.faultLoaded = true; dbgApplyFaultBar(); return; }
  A.faultGet().then(function (r) {
    DBG.faultLoaded = true;
    if (r && r.ok) DBG.fault = { modes: r.modes || {}, active: r.active || [] };
    dbgApplyFaultBar();
    if (DBG.open && DBG.tab === 'fault') dbgRenderBody();
  }).catch(function () { DBG.faultLoaded = true; dbgApplyFaultBar(); });
}
function dbgFaultHtml() {
  var h = '<div class="disc"><div><b>Имитация сбоя.</b> Тапёр будет вести себя, как будто сервис сломан: '
    + '«недоступен» — ответ 503, «нет сети» — как при пропавшем интернете, «медленно» — задержка 8 секунд, '
    + '«вход отозван» — ответ 401. Включённое выключится само после перезапуска.</div></div>';
  var list = dbgFaultActive();
  h += '<div class="card"><div class="srow"><div class="sl"><div class="st">Выключить всё</div>'
    + '<div class="sd">' + (list.length ? 'Сейчас включено: ' + esc(dbgFaultText()) : 'Сейчас ничего не включено') + '</div></div>'
    + '<button class="btn" data-dbg-act="fault-clear"' + (list.length ? '' : ' disabled') + '>Выключить всё</button></div></div>';
  h += '<div style="height:12px"></div>';
  h += '<div class="dbg-fault-wrap"><table class="dbg-fault"><thead><tr><th>Сервис</th>';
  DBG_FAULT_MODES.forEach(function (m) { h += '<th>' + esc(m.n) + '</th>'; });
  h += '</tr></thead><tbody>';
  DBG_FAULT.forEach(function (sv) {
    var cur = dbgFaultModeOf(sv.id);
    h += '<tr><td>' + esc(sv.n) + '</td>';
    DBG_FAULT_MODES.forEach(function (m) {
      h += '<td><input type="radio" name="fault-' + sv.id + '" value="' + m.id + '" data-fault-service="' + sv.id + '"'
        + (cur === m.id ? ' checked' : '') + ' aria-label="' + esc(sv.n + ': ' + m.n) + '"></td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  if (!DBG.faultLoaded) h += '<div class="sd">Загружаю состояние имитации…</div>';
  if (dbgFaultModeOf('twitch')) {
    h += '<div class="disc" style="margin-top:12px"><div>У Twitch имитируются только запросы API (вход, награды, отправка сообщений). '
      + 'Живое подключение чата идёт по WebSocket и имитацией не покрывается.</div></div>';
  }
  return h;
}
function dbgFaultSet(service, mode) {
  if (!A.faultSet) { dbgToast('В этой сборке нет имитации сбоев'); return; }
  A.faultSet(service, mode).then(function (r) {
    if (!r || !r.ok) { dbgToast('Не получилось: ' + ((r && r.error) || 'неизвестная ошибка')); dbgLoadFault(); return; }
    DBG.fault = { modes: r.modes || {}, active: r.active || [] };
    dbgApplyFaultBar();
    dbgRenderBody();
    dbgToast(mode ? ('Имитация включена: ' + dbgFaultName(service)) : ('Имитация выключена: ' + dbgFaultName(service)));
  }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); dbgLoadFault(); });
}
function dbgFaultPick(service, mode) {
  if (mode === dbgFaultModeOf(service)) return;
  var apply = function () { dbgFaultSet(service, mode); };
  // Включение переспрашиваем один раз за сессию: дальше владелец уже знает, что к чему.
  if (mode && !DBG.faultAsked) {
    dbgConfirm({
      title: 'Включить имитацию сбоя?',
      text: 'Тапёр будет вести себя, как будто ' + (service === 'all' ? 'вся сеть сломана' : ('«' + dbgFaultName(service) + '» сломан')) + '. Выключится само после перезапуска.',
      ok: 'Включить'
    }).then(function (r) {
      if (!r) { dbgLoadFault(); return; }
      DBG.faultAsked = true;
      apply();
    });
    return;
  }
  apply();
}
function dbgFaultClear() {
  if (!A.faultClear) { dbgToast('В этой сборке нет имитации сбоев'); return; }
  A.faultClear().then(function (r) {
    DBG.fault = (r && r.ok) ? { modes: r.modes || {}, active: r.active || [] } : { modes: {}, active: [] };
    dbgApplyFaultBar();
    dbgRenderBody();
    dbgToast('Имитация выключена');
  }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
}

// ---- падения окна (0.34.0, задание 6) ----
// Кнопки работают только в тестовом профиле: главный процесс тоже проверяет это
// сам, окну здесь не доверяют. Сторож — src/watchdog.js.
function dbgGoneReason(r) {
  var map = {
    crashed: 'сбой', oom: 'нехватка памяти', killed: 'принудительно',
    'abnormal-exit': 'нештатный выход', 'launch-failed': 'не запустилось',
    'integrity-failure': 'повреждены файлы', 'clean-exit': 'штатное закрытие'
  };
  return map[r] || String(r || 'причина неизвестна');
}
function dbgWatchdogText(w) {
  if (!w) return '—';
  var max = Number(w.max) || 3, mins = Math.round((Number(w.windowMs) || 0) / 60000);
  var t = 'поднятий ' + (Number(w.restarts) || 0) + ' из ' + max + (mins ? ' за ' + mins + ' мин' : '');
  if (w.lastReason) t += ' · последнее ' + dbgClock(w.lastAt) + ' (' + dbgGoneReason(w.lastReason) + ')';
  return t;
}
function dbgCrashesHtml() {
  var test = dbgProfileTest();
  var note = test ? '' : ' Только в тестовом профиле.';
  var dis = test ? '' : ' disabled';
  var h = '<div class="disc"><div><b>Имитация падений.</b> Проверка сторожа: уронили окно — Тапёр сам поднял его, '
    + 'очередь и заказы остались, музыка продолжилась с того же места. Всё, что здесь нажимается, '
    + 'работает только в тестовом профиле.</div></div>';
  h += '<div class="card">';
  h += dbgRowAction('Окно упало',
    'Окно закроется как при сбое. Сторож поднимет его сам и продолжит с того же места (потеряется не больше 5 секунд).' + note,
    '<button class="btn" data-dbg-act="crash-window"' + dis + '>Уронить окно</button>');
  h += dbgRowAction('Окно зависло',
    'Окно займёт себя работой на N секунд (5–60, по умолчанию 30) и отпустит само. Если дольше 15 секунд — сторож перезапустит окно.' + note,
    '<button class="btn" data-dbg-act="hang-window"' + dis + '>Зависнуть</button>');
  h += dbgRowAction('Повреждён файл настроек',
    'Тапёр запишет мусор в settings.json (запасную копию .bak не трогает) и перезапустится. Настройки поднимутся из .bak, очередь и заказы должны остаться.' + note,
    '<button class="btn" data-dbg-act="corrupt-settings"' + dis + '>Повредить файл</button>');
  h += '</div>';
  h += '<div class="disc" style="margin-top:12px"><div>Защита от петли: не больше 3 поднятий за 10 минут. '
    + 'На 4-й раз Тапёр покажет сообщение и не будет поднимать окно молча.</div></div>';
  return h;
}
function dbgCrashWindow() {
  if (!dbgProfileTest()) { dbgToast('Только в тестовом профиле'); return; }
  if (typeof A.debugCrashWindow !== 'function') { dbgToast('В этой сборке нет имитации падения'); return; }
  dbgConfirm({
    title: 'Уронить окно?',
    text: 'Окно закроется как при сбое. Тапёр сам поднимет его и, если играла музыка, продолжит с того же места. Очередь и заказы сохранятся.',
    ok: 'Уронить'
  }).then(function (r) {
    if (!r) return;
    A.debugCrashWindow().then(function (res) {
      if (res && res.ok === false) dbgToast('Не получилось: ' + (res.error || 'неизвестная ошибка'));
    }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
  });
}
function dbgHangWindow() {
  if (!dbgProfileTest()) { dbgToast('Только в тестовом профиле'); return; }
  if (typeof A.debugHangWindow !== 'function') { dbgToast('В этой сборке нет имитации зависания'); return; }
  dbgConfirm({
    title: 'Зависнуть?',
    text: 'Окно займёт себя работой на несколько секунд и отпустит само. Если дольше 15 секунд — сторож перезапустит окно. Введи целое число от 5 до 60.',
    label: 'Секунды',
    value: '30',
    ok: 'Зависнуть'
  }).then(function (r) {
    if (!r) return;
    var sec = Number(String(r.value || '').trim());
    if (!isFinite(sec) || Math.floor(sec) !== sec || sec < 5 || sec > 60) { dbgToast('Нужно целое число секунд от 5 до 60'); return; }
    A.debugHangWindow(sec).then(function (res) {
      if (!res || !res.ok) { dbgToast('Не получилось: ' + ((res && res.error) || 'неизвестная ошибка')); return; }
      var until = Date.now() + (Number(res.seconds) || sec) * 1000;
      // Окно занято нарочно — это и есть имитация зависания; отпустит само.
      while (Date.now() < until) { /* ждём */ }
      dbgToast('Окно отпустило само');
    }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
  });
}
function dbgCorruptSettings() {
  if (!dbgProfileTest()) { dbgToast('Только в тестовом профиле'); return; }
  if (typeof A.debugCorruptSettings !== 'function') { dbgToast('В этой сборке нет имитации повреждения'); return; }
  dbgConfirm({
    title: 'Повредить файл настроек?',
    text: 'Тапёр запишет мусор в settings.json и сразу перезапустится. Настройки поднимутся из запасной копии .bak; очередь и заказы должны остаться. Делать только в тестовом профиле — это имитация для проверки.',
    ok: 'Повредить'
  }).then(function (r) {
    if (!r) return;
    A.debugCorruptSettings().then(function (res) {
      if (res && res.ok === false) dbgToast('Не получилось: ' + (res.error || 'неизвестная ошибка'));
      else dbgToast('Файл повреждён, перезапускаюсь…');
    }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
  });
}

// ---- тестовый заказ (0.34.0, задание 5) ----
// Донат-путь: форма → req-test → onDonation → processDonation → requests.json → «Заказы».
// Ответ в чат здесь не отправляется: тестовый донат ничем не отличается от обычного доната,
// а донат в Twitch не пишет. Команда из чата в 0.34.0 не делается — см. TODO.
function dbgTestOrderHtml() {
  var t = DBG.test;
  var h = '<div class="disc"><div><b>Тестовый заказ.</b> Выдуманный донат проходит тот же путь, что настоящий: '
    + 'поиск, карточка заказа, очередь. Деньги нигде не двигаются, к сервисам донатов запросов нет. '
    + 'В журнале и в списке заказов будет пометка «тест».</div></div>';
  h += '<div class="card">';
  h += '<div class="srow"><div class="sl"><div class="st">Имя зрителя</div><div class="sd">Так заказ будет подписан.</div></div>'
    + '<input class="field" id="dbgTestName" value="' + esc(t.name) + '" style="max-width:260px"></div>';
  h += '<div class="srow"><div class="sl"><div class="st">Сумма</div><div class="sd">Сколько «заплатил» выдуманный зритель. По умолчанию 100.</div></div>'
    + '<input class="field" id="dbgTestSum" type="number" min="1" step="1" value="' + esc(t.amount) + '" style="max-width:120px"></div>';
  h += '<div class="srow"><div class="sl"><div class="st">Сервис</div><div class="sd">Только пометка в заказе — запросов к сервису нет.</div></div>'
    + '<select class="field" id="dbgTestService" style="max-width:200px">'
    + '<option value="da"' + (t.service === 'da' ? ' selected' : '') + '>DonationAlerts</option>'
    + '<option value="dp"' + (t.service === 'dp' ? ' selected' : '') + '>DonatePay</option></select></div>';
  h += '<div class="srow"><div class="sl"><div class="st">Текст заказа</div><div class="sd">Например: «Кино — Кукушка».</div></div>'
    + '<input class="field" id="dbgTestText" value="' + esc(t.text) + '" style="max-width:360px"></div>';
  h += '</div>';
  h += '<div class="card"><div class="srow"><div class="sl"><div class="st">Создать тестовый заказ</div>'
    + '<div class="sd">Перед созданием Тапёр переспросит. Заказ появится во вкладке «Заказы».</div></div>'
    + '<button class="btn" data-dbg-act="test-order"' + (DBG.testBusy ? ' disabled' : '') + '>Создать заказ</button></div></div>';
  if (DBG.lastTest) {
    var lvl = DBG.lastTest.level === 'exact' ? 'точно нашёл' : (DBG.lastTest.level === 'doubt' ? 'есть сомнение' : 'трек не найден');
    h += '<div class="card"><div class="srow"><div class="sl"><div class="st">Последний тестовый заказ</div>'
      + '<div class="sd">' + esc(lvl) + ' · вариантов ' + ((DBG.lastTest.items || []).length) + '</div></div>'
      + '<button class="btn ghost" data-dbg-act="test-goto">Открыть «Заказы»</button></div></div>';
  }
  h += '<div class="disc" style="margin-top:12px"><div>Ответ в чат Twitch из тестового заказа в этой версии не отправляется: '
    + 'пак не умеет принять выдуманное сообщение чата через мост ядра. Это записано в TODO на 0.34.1.</div></div>';
  return h;
}
function dbgCreateTest() {
  if (DBG.testBusy) return;
  var text = String(DBG.test.text || '').trim();
  var amount = Number(DBG.test.amount) || 0;
  if (!text) { dbgToast('Напиши текст заказа'); return; }
  if (amount <= 0) { dbgToast('Сумма должна быть больше нуля'); return; }
  dbgConfirm({
    title: 'Создать тестовый заказ?',
    text: 'Заказ появится в «Заказах» и может встать в очередь как настоящий. Деньги не двигаются, к сервисам донатов запросов нет. В журнале будет пометка «тест».',
    ok: 'Создать'
  }).then(function (r) {
    if (!r) return;
    if (!A.reqTest) { dbgToast('В этой сборке нет тестовых заказов'); return; }
    DBG.testBusy = true;
    dbgRenderBody();
    A.reqTest({ name: DBG.test.name, amount: amount, service: DBG.test.service, text: text }).then(function (res) {
      DBG.testBusy = false;
      DBG.lastTest = res || null;
      dbgRenderBody();
      dbgToast(res ? 'Тестовый заказ создан' : 'Тестовый заказ не разобрался');
    }).catch(function (e) {
      DBG.testBusy = false;
      dbgRenderBody();
      dbgToast('Не получилось: ' + (e && e.message ? e.message : e));
    });
  });
}

function dbgRenderNav() {
  var nav = $('dbgNav');
  if (!nav) return;
  nav.innerHTML = DBG_TABS.map(function (t) {
    return '<button type="button" role="tab" data-dbg-tab="' + t.id + '" aria-selected="' + (DBG.tab === t.id ? 'true' : 'false')
      + '" class="' + (DBG.tab === t.id ? 'on' : '') + '">' + esc(t.n) + '</button>';
  }).join('');
}

function dbgModuleText(s) {
  var m = s.modules || {};
  if (/^не установлен/.test(String(s.pack || ''))) return 'пак не установлен — модулей нет';
  return 'Чат-бот — ' + (m.bot ? 'запущен' : 'не запущен') + '; Оверлей-плейлист — ' + (m.overlay ? 'запущен' : 'не запущен');
}

function dbgStateHtml() {
  var s = DBG.state || {};
  if (s.error) return '<div class="disc"><div>Не удалось собрать состояние: ' + esc(s.error) + '</div></div>';
  var h = '';
  h += '<div class="card">';
  h += dbgRowAction('Состояние', 'Обновляется при открытии меню и кнопкой ниже.', '<button class="btn" data-dbg-act="refresh">Обновить</button>');
  h += dbgRowV('Версия', s.version);
  h += dbgRowV('Сборка', s.buildText || s.build);
  h += dbgRowV('Коммит', s.commit);
  h += dbgRowV('Канал обновлений', s.channelText || s.channel);
  h += dbgRowV('Лицензия пака', s.license);
  h += dbgRowV('Пак стримера', s.pack);
  h += dbgRowV('Модули', dbgModuleText(s));
  h += dbgRowV('Имитация сбоев', (s.fault && s.fault.length)
    ? s.fault.map(function (x) { return dbgFaultName(x.service) + ' — ' + dbgFaultModeName(x.mode); }).join(', ')
    : 'выключена');
  h += dbgRowV('Поднятий окна за сессию', dbgWatchdogText(s.watchdog));
  h += dbgRowV('Папка данных', s.dataDir);
  h += dbgRowV('Профиль', s.testProfile ? 'тестовый (временная папка)' : 'обычный');
  h += '</div>';

  h += '<div style="height:12px"></div><div class="card">';
  h += dbgRowV('Входы в сервисы', 'Только «есть / нет» — без ников и значений.', '');
  DBG_SERVICES.forEach(function (sv) {
    h += dbgRow(sv.n, dbgYes(s.logins && s.logins[sv.id]));
  });
  h += '</div>';

  h += '<div style="height:12px"></div><div class="card">';
  h += dbgRowV('Автопочинок за сессию', 'Сколько раз Тапёр пробовал починить сам. В скобках — сколько попыток не вышло.', '');
  DBG_AUTOFIX.forEach(function (sv) {
    var d = (s.autofixDetail && s.autofixDetail[sv.id]) || { total: Number(s.autofix && s.autofix[sv.id]) || 0, fail: 0 };
    h += dbgRow(sv.n, dbgAutofixText(d));
  });
  h += '</div>';
  return h;
}

// «2 (1 не вышла)» — всего попыток и из них неудачных. Старые сборки присылают только число.
function dbgAutofixText(d) {
  var total = Number(d && d.total) || 0, fail = Number(d && d.fail) || 0;
  return String(total) + (fail ? ' (' + fail + ' не вышла)' : '');
}

function dbgPaintLoad() {
  var s = DBG.state;
  if (!s || !s.load) return;
  var l = s.load, c = l.current || {};
  var now = $('dbgNow');
  if (now) now.textContent = 'память ' + dbgMem(c.mem) + ' · ЦП ' + dbgCpu(c.cpu) + (c.at ? ' · ' + dbgClock(c.at) : '');
  var mp = $('dbgMemPeak'), cp = $('dbgCpuPeak');
  var p = l.peaks || {};
  if (mp) mp.textContent = dbgMem(p.mem) + (p.memAt ? ' · ' + dbgClock(p.memAt) : '');
  if (cp) cp.textContent = dbgCpu(p.cpu) + (p.cpuAt ? ' · ' + dbgClock(p.cpuAt) : '');
}

function dbgLoadHtml() {
  var s = DBG.state || {};
  if (s.error) return '<div class="disc"><div>Не удалось собрать состояние: ' + esc(s.error) + '</div></div>';
  var l = s.load || {};
  var h = '';
  if (!l.watch) {
    h += '<div class="disc"><div><b>Замер выключен в настройках.</b> Цифры памяти и ЦП сейчас не собираются. '
      + 'Включи замер — Тапёр начнёт показывать их здесь и в правом нижнем углу.</div></div>';
    h += '<div class="card">' + dbgRowAction('Замер нагрузки', 'Включить можно здесь или в Настройках → Программа.', '<button class="btn" data-dbg-act="enable-perf">Включить</button>') + '</div>';
    return h;
  }
  h += '<div class="card">';
  h += dbgRowAction('Сейчас', 'Те же цифры, что в правом нижнем углу — второго счётчика нет.', '<button class="btn ghost" data-dbg-act="refresh">Обновить</button>');
  h += '<div class="srow"><div class="sl"><div class="st">Память и ЦП</div><div class="sd" id="dbgNow">…</div></div></div>';
  h += '<div class="srow"><div class="sl"><div class="st">Пик памяти за сессию</div><div class="sd" id="dbgMemPeak">…</div></div></div>';
  h += '<div class="srow"><div class="sl"><div class="st">Пик ЦП за сессию</div><div class="sd" id="dbgCpuPeak">…</div></div></div>';
  h += dbgRowAction('Сбросить пики', 'Пики начнутся заново с текущего замера. На работу плеера не влияет.', '<button class="btn ghost" data-dbg-act="reset-peaks">Сбросить пики</button>');
  h += '</div>';
  return h;
}

function dbgLogHtml() {
  var s = DBG.state || {};
  var h = '<div class="card">';
  h += dbgRowAction('Сохранить журнал', 'Весь журнал работы и прошлый файл (если есть) — одним текстовым файлом. Ничего не удаляется.',
    '<button class="btn" data-dbg-act="save-log"' + (DBG.busy ? ' disabled' : '') + '>Сохранить…</button>');
  h += '<div class="srow"><div class="sl"><div class="st">Подробный журнал на эту сессию</div>'
    + '<div class="sd">Пишет больше строк о поиске, потоке, заказах и донатах. После перезапуска выключается сам.</div></div>'
    + '<button class="toggle' + (s.verbose ? ' on' : '') + '" data-dbg-act="verbose" aria-pressed="' + (s.verbose ? 'true' : 'false') + '" aria-label="Подробный журнал на эту сессию"><span></span></button></div>';
  h += dbgRowAction('Открыть файл журнала', 'Откроется в блокноте или другой программе по умолчанию.', '<button class="btn ghost" data-dbg-act="open-log">Открыть</button>');
  h += '</div>';
  if (DBG.savedLog) {
    h += '<div style="height:12px"></div><div class="card">';
    h += dbgRowAction('Журнал сохранён', DBG.savedLog, '<button class="btn ghost" data-dbg-act="reveal-log">Открыть папку</button>');
    h += '</div>';
  }
  return h;
}

function dbgReportHtml() {
  var h = '<div class="disc"><div><b>Что попадёт в файл:</b> состояние, настройки без ключей и весь журнал. '
    + 'Ники зрителей и тексты заказов — как есть. Ключей, токенов, cookies и паролей не будет: они вычищаются и проверяются шаблонами. '
    + 'Файл никуда не отправляется сам — его сохраняешь ты и можешь отправить сам.</div></div>';
  h += '<div class="card">';
  h += dbgRowAction('Собрать отчёт', 'Откроется окно «Сохранить как». Имя по умолчанию — tapyor-report-ГГГГ-ММ-ДД-ЧЧММ.txt.',
    '<button class="btn" data-dbg-act="save-report"' + (DBG.busy ? ' disabled' : '') + '>Собрать…</button>');
  h += '</div>';
  if (DBG.savedReport) {
    h += '<div style="height:12px"></div><div class="card">';
    h += dbgRowAction('Отчёт сохранён', DBG.savedReport, '<button class="btn ghost" data-dbg-act="reveal-report">Открыть папку</button>');
    h += '</div>';
  }
  return h;
}

function dbgRenderBody() {
  var body = $('dbgBody');
  if (!body) return;
  dbgRenderTop();
  if (DBG.tab === 'resets') { body.innerHTML = dbgResetsHtml(); return; }
  if (DBG.tab === 'fault') { body.innerHTML = dbgFaultHtml(); return; }
  if (DBG.tab === 'crashes') { body.innerHTML = dbgCrashesHtml(); return; }
  if (DBG.tab === 'testorder') { body.innerHTML = dbgTestOrderHtml(); return; }
  if (DBG.loading) { body.innerHTML = '<div class="sd">Собираю состояние…</div>'; return; }
  if (!DBG.state) { body.innerHTML = '<div class="sd">Состояние ещё не загружено.</div>'; return; }
  if (DBG.tab === 'load') { body.innerHTML = dbgLoadHtml(); dbgPaintLoad(); return; }
  if (DBG.tab === 'log') { body.innerHTML = dbgLogHtml(); return; }
  if (DBG.tab === 'report') { body.innerHTML = dbgReportHtml(); return; }
  body.innerHTML = dbgStateHtml();
}

function dbgSelect(id) {
  if (!DBG_TABS.some(function (t) { return t.id === id; })) id = 'state';
  DBG.tab = id;
  dbgRenderNav();
  dbgRenderBody();
  // «Нагрузка» показывает, включён ли замер. Переключатель живёт в другом разделе
  // настроек, поэтому при входе в вкладку перечитываем состояние тихо (без «Собираю…»),
  // иначе после выключения замера тут остались бы старые цифры.
  if (id === 'load') dbgLoadState(true);
  // «Имитация сбоев» перечитывает режимы: состояние могло измениться из другого окна/события.
  if (id === 'fault') dbgLoadFault();
}

function dbgLoadState(quiet) {
  if (!A.debugState) {
    DBG.state = { error: 'мост отладки недоступен (старая сборка?)' };
    DBG.loading = false;
    dbgRenderBody();
    return;
  }
  // Тихий режим: уже показанное не заменяем надписью «Собираю состояние…».
  var keep = !!(quiet && DBG.state && !DBG.state.error);
  DBG.loading = !keep;
  if (!keep) dbgRenderBody();
  A.debugState().then(function (r) {
    DBG.loading = false;
    DBG.state = (r && r.ok && r.state) ? r.state : { error: (r && r.error) || 'главный процесс не ответил' };
    dbgApplyBanner();
    dbgRenderBody();
  }).catch(function (e) {
    DBG.loading = false;
    DBG.state = { error: e && e.message ? e.message : String(e) };
    dbgRenderBody();
  });
}

function dbgOnPerf(d) {
  if (!DBG.open || !d || !DBG.state || DBG.state.error) return;
  var l = DBG.state.load;
  if (!l) return;
  var at = Date.now();
  l.current = { mem: d.mem, cpu: d.cpu, at: at };
  if (l.peaks) {
    if (l.peaks.mem == null || d.mem > l.peaks.mem) { l.peaks.mem = d.mem; l.peaks.memAt = at; }
    if (l.peaks.cpu == null || d.cpu > l.peaks.cpu) { l.peaks.cpu = d.cpu; l.peaks.cpuAt = at; }
  }
  if (DBG.tab === 'load') dbgPaintLoad();
}

function dbgSave(kind) {
  if (DBG.busy) return;
  var fn = kind === 'log' ? A.debugSaveLog : A.debugSaveReport;
  if (!fn) { dbgToast('Сохранение недоступно в этой сборке'); return; }
  DBG.busy = true;
  dbgRenderBody();
  Promise.resolve(fn()).then(function (r) {
    DBG.busy = false;
    if (!r || r.canceled) { dbgRenderBody(); return; }
    if (!r.ok) { dbgToast('Не получилось: ' + (r.error || 'неизвестная ошибка')); dbgRenderBody(); return; }
    if (kind === 'log') DBG.savedLog = r.path || ''; else DBG.savedReport = r.path || '';
    dbgToast(kind === 'log' ? 'Журнал сохранён' : 'Отчёт сохранён');
    dbgRenderBody();
  }).catch(function (e) {
    DBG.busy = false;
    dbgToast('Не получилось: ' + (e && e.message ? e.message : e));
    dbgRenderBody();
  });
}

function dbgReveal(kind) {
  if (!A.debugReveal) return;
  A.debugReveal(kind).then(function (ok) { if (!ok) dbgToast('Файл ещё не сохранён'); }).catch(function () {});
}

function dbgOnAction(e) {
  var b = e.target && e.target.closest ? e.target.closest('[data-dbg-act]') : null;
  if (!b) return;
  var act = b.dataset.dbgAct;
  if (act === 'test-profile') { dbgStartTestProfile(); return; }
  if (act === 'reset') { dbgReset(b.dataset.kind); return; }
  if (act === 'restore') { dbgRestore(b.dataset.id); return; }
  if (act === 'wizard-open') { dbgWizardOpen(); return; }
  if (act === 'wizard-reset') { dbgWizardReset(); return; }
  if (act === 'refresh') { dbgLoadState(); return; }
  if (act === 'fault-clear') { dbgFaultClear(); return; }
  if (act === 'crash-window') { dbgCrashWindow(); return; }
  if (act === 'hang-window') { dbgHangWindow(); return; }
  if (act === 'corrupt-settings') { dbgCorruptSettings(); return; }
  if (act === 'test-order') { dbgCreateTest(); return; }
  if (act === 'test-goto') { if (typeof setTab === 'function') setTab('req'); return; }
  if (act === 'save-log') { dbgSave('log'); return; }
  if (act === 'save-report') { dbgSave('report'); return; }
  if (act === 'reveal-log') { dbgReveal('log'); return; }
  if (act === 'reveal-report') { dbgReveal('report'); return; }
  if (act === 'open-log') { if (A.logOpen) A.logOpen(); return; }
  if (act === 'verbose') {
    var next = !(DBG.state && DBG.state.verbose);
    if (!A.debugVerboseSet) return;
    A.debugVerboseSet(next).then(function (r) {
      if (r && r.ok) { if (DBG.state) DBG.state.verbose = !!r.on; dbgRenderBody(); }
      else dbgToast('Не получилось переключить подробный журнал');
    }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
    return;
  }
  if (act === 'reset-peaks') {
    if (!A.debugPeaksReset) return;
    A.debugPeaksReset().then(function (r) {
      if (!r || !r.ok) { dbgToast('Не получилось сбросить пики'); return; }
      if (DBG.state && DBG.state.load) {
        var p = r.peaks || {};
        DBG.state.load.peaks = { mem: p.mem, memAt: p.memAt, cpu: p.cpu, cpuAt: p.cpuAt };
        DBG.state.load.current = { mem: p.lastMem, cpu: p.lastCpu, at: p.lastAt };
      }
      dbgRenderBody();
    }).catch(function (e) { dbgToast('Не получилось: ' + (e && e.message ? e.message : e)); });
    return;
  }
  if (act === 'enable-perf') {
    if (!A.setSetting) return;
    A.setSetting('perfWatch', true).then(function () {
      var tg = document.querySelector('[data-set-tg="perfWatch"]');
      if (tg) { tg.classList.add('on'); tg.setAttribute('aria-pressed', 'true'); }
      dbgToast('Замер нагрузки включён');
      dbgLoadState();
    }).catch(function (e) { dbgToast('Не получилось включить замер: ' + (e && e.message ? e.message : e)); });
  }
}

function dbgOnChange(e) {
  var el = e.target;
  if (!el) return;
  if (el.dataset && el.dataset.faultService) { dbgFaultPick(el.dataset.faultService, el.value || ''); return; }
  if (el.id === 'dbgTestService') DBG.test.service = el.value === 'dp' ? 'dp' : 'da';
}
function dbgOnInput(e) {
  var el = e.target;
  if (!el || !el.id) return;
  if (el.id === 'dbgTestName') DBG.test.name = el.value;
  else if (el.id === 'dbgTestSum') DBG.test.amount = Number(el.value) || 0;
  else if (el.id === 'dbgTestText') DBG.test.text = el.value;
}

function dbgInit() {
  var nav = $('dbgNav'), body = $('dbgBody');
  if (!nav || !body) return;
  nav.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-dbg-tab]') : null;
    if (b) dbgSelect(b.dataset.dbgTab);
  });
  body.addEventListener('click', dbgOnAction);
  body.addEventListener('change', dbgOnChange);
  body.addEventListener('input', dbgOnInput);
  var top = $('dbgTop');
  if (top) top.addEventListener('click', dbgOnAction);
  var back = $('testProfileBack');
  if (back) back.addEventListener('click', dbgReturnNormal);
  var off = $('faultBarOff');
  if (off) off.addEventListener('click', dbgFaultClear);
  if (A.onPerfSample) A.onPerfSample(dbgOnPerf);
  // Плашка имитации должна работать и без открытого меню: спрашиваем состояние сразу
  // и обновляемся, когда главный процесс пришлёт изменение.
  if (A.onFaultChanged) A.onFaultChanged(function (s) {
    if (!s) return;
    DBG.fault = { modes: s.modes || {}, active: s.active || [] };
    dbgApplyFaultBar();
    if (DBG.open && DBG.tab === 'fault') dbgRenderBody();
  });
  dbgLoadFault();
  dbgLoadProfile();
}

// Открыть меню: создать пункт левого меню, показать раздел и перейти в настройки.
function openDebugMenu() {
  var side = document.querySelector('.set-side');
  if (side && !$('goDebug')) {
    var b = document.createElement('button');
    b.id = 'goDebug';
    b.dataset.go = 'sDebug';
    b.textContent = 'Отладка';
    // Возврат в меню после других разделов настроек — перечитываем состояние и копии:
    // настройки могли измениться (например, «Следить за нагрузкой»).
    b.addEventListener('click', function () {
      DBG.open = true;
      dbgLoadState(true);
      dbgLoadBackups();
      dbgLoadFault();
    });
    var about = side.querySelector('[data-go="sAbout"]');
    side.insertBefore(b, about || null);
  }
  var sec = $('sDebug');
  if (sec) { if (sec.dataset) delete sec.dataset.dbgClosed; sec.hidden = false; }
  DBG.open = true;
  if (typeof setTab === 'function') setTab('settings', 'sDebug');
  if (typeof window.showSettingsPane === 'function') window.showSettingsPane('sDebug');
  dbgSelect(DBG.tab || 'state');
  dbgLoadState();
  dbgLoadBackups();
  dbgLoadFault();
}

if (typeof document !== 'undefined') dbgInit();
if (typeof module !== 'undefined' && module.exports) module.exports = { isDebugCommand: isDebugCommand };
