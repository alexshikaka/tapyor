const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell, nativeTheme, safeStorage, clipboard, globalShortcut, session, webContents, powerMonitor } = require('electron');
const ym = require('./yandex');
const dz = require('./deezer');
const lastfm = require('./lastfm');
const match = require('./match');
const select = require('./select');
const ymweb = require('./ymweb');
const ytauth = require('./ytauth');
const loginNav = require('./login-nav');
const ytoauth = require('./ytoauth');
const recipes = require('./recipes');
const library = require('./library');
const pathGuard = require('./path-guard');
const importers = require('./importers');
const localGuard = require('./localguard');
const mediaCors = require('./media-cors');
const serverErrors = require('./server-errors');
const uiBuild = require('./ui-build');
const reqp = require('./reqparse');
const onlineLookup = require('./online-lookup');
const fx = require('./fx');
const cloudCheck = require('./cloud-check');
const orderReport = require('./order-report');
const { createMediaProxy } = require('./media-proxy');
const { userAgent } = require('./user-agent');
const { CLOUD_KEY, CLOUD_KEY_HEADER } = require('./cloud-key');
const matchScore = require('./match-score');
const { analyzeOrder } = require('./order-analyzer');
const donations = require('./donations');
const requestsStore = require('./requests-store');
const sitepage = require('./sitepage');
const modhost = require('./modhost');
const releaseFeed = require('./release-feed');
const openExternal = require('./open-external');
const buildInfoModule = require('./build-info');
const debugPeaksModule = require('./debug-peaks');
const debugCountersModule = require('./debug-counters');
const debugReport = require('./debug-report');
const reportScrubModule = require('./report-scrub');
const crashGuardModule = require('./crash-guard');
const userData = require('./user-data');
const debugBackup = require('./debug-backup');
const streamBusy = require('./stream-busy');
const debugReset = require('./debug-reset');
const watchdogModule = require('./watchdog');
const childRegistryModule = require('./child-registry');
const windowClosedModule = require('./window-closed');
const wake = require('./wake.js');
const faultSimModule = require('./fault-sim');
const autofixModule = require('./autofix');
const testOrder = require('./test-order');
const browserZoom = require('./browser-zoom');
const brTarget = require('./br-target');
const mojibake = require('./mojibake');
const sbotPort = require('./sbot-port');
const sbotJournalModule = require('./sbot-journal');
const sbotLinkModule = require('./sbot-link');
const sbotMailboxModule = require('./sbot-mailbox');
const sbotSettings = require('./sbot-settings');
const sbotCheck = require('./sbot-check');
const chatorders = require('./chatorders');
const updatePolicy = require('./update-policy');
const updateSign = require('./update-sign');
const { withTimeout } = require('./with-timeout');
const reportThrottle = require('./report-throttle');
const { EventEmitter } = require('events');
const crypto = require('crypto');
// Запуск процесса: по нему уборка отличает заказы прошлого запуска от сегодняшних (0.35, Э2).
const APP_STARTED_AT = Date.now();
nativeTheme.themeSource = 'dark'; // тёмные системные окна и диалоги
const path = require('path');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const yts = require('yt-search');
const http = require('http');
const https = require('https');
const fs = require('fs');

// Папка данных программы (вход в Яндекс, настройки, лог) не должна меняться при переименовании.
// Берём ту, что уже есть от прошлых версий; для новой установки — «Тапёр».
// Отладочный тестовый профиль — временная папка с флагом --tapyor-test-profile=<папка>;
// проверка и правила выбора — в src/user-data.js (покрыто unit-тестами).
(function pinUserData() {
  try {
    const r = userData.chooseUserData({ appData: app.getPath('appData'), tmpdir: os.tmpdir() });
    app.setPath('userData', r.path);
    userData.setTestProfileActive(r.test);
  } catch (e) { userData.setTestProfileActive(false); /* оставим путь по умолчанию */ }
})();
// Автокопии перед отладочными сбросами: <папка данных>\debug-backups (src/debug-backup.js).
debugBackup.setup({ userData: app.getPath('userData'), appVersion: app.getVersion(), log: (m) => log(m) });
// Метка сборки (А12): dev / stable / source + коммит. Читается один раз — она не меняется до перезапуска.
const BUILD = buildInfoModule.buildInfo(app);
// Отладочное меню: пики нагрузки за сессию и счётчики автопочинок.
// Пики считает perfSample (даже когда меню закрыто); счётчики пока только хранятся.
const debugPeaks = debugPeaksModule.create();
const debugCounters = debugCountersModule.create();
let debugVerbose = false; // подробный журнал: только в памяти, после перезапуска выключен сам
// Имитация сбоев сети (0.34.0, шаг 3): состояние только в памяти, после перезапуска выключается само.
// Обёртки fetch ставит installFaultFetches() при старте (до первых запросов сервисов).
const faultSim = faultSimModule.create({ log: (m) => { try { log(m); } catch (e) {} } });
let faultFetchesInstalled = false;
// Автопочинка (0.34.0, шаг 5): создаётся в app.whenReady, когда уже есть все обработчики.
// Диспетчер сам решает, когда вмешаться; здесь только подключение.
let autofixR = null;
// Сторож главного окна (0.34.0, задание 6): создаётся в app.whenReady, события
// подписывает attachWatchdog() при каждом createWindow. watchdogQuitting — чтобы
// обычный выход и перезапуск (app.relaunch) не считались падением окна.
let watchdog = null;
let watchdogQuitting = false;
// Пульс окна: Electron не всегда присылает unresponsive, если окно просто занято
// работой (проверено живьём 12.11: 30 секунд занятости — события нет). Поэтому раз
// в 2 секунды главный процесс шлёт окну «пульс», а preload отвечает. Нет отклика
// дольше 5 секунд — считаем, что окно зависло, и отсчитываем те же 15 секунд.
let watchdogPingTimer = null;
let watchdogLastTick = 0;
let watchdogLastPong = 0;
let watchdogLoopShown = false;
const WATCHDOG_PING_MS = watchdogModule.PING_MS;
function faultSnapshot() { return { modes: faultSim.state(), active: faultSim.active() }; }
// Один раз при старте: обёртка globalThis.fetch (undici) и electron.net.fetch.
// Без включённой имитации обёртка зовёт настоящий fetch с теми же аргументами.
function installFaultFetches() {
  if (faultFetchesInstalled) return;
  faultFetchesInstalled = true;
  globalThis.fetch = faultSim.wrapFetch(globalThis.fetch);
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') net.fetch = faultSim.wrapFetch(net.fetch);
  } catch (e) { log('имитация: не удалось обернуть сеть Electron — ' + (e && e.message || e)); }
}
const { execFile } = require('child_process');

// ── Кто зовёт IPC ───────────────────────────────────────────────────────────
// Обработчиков больше 140, и каждый верит вызывающему на слово. Пока окно своё,
// это глубина обороны; как только внутрь попадёт чужой код (плагины), станет
// несущим. Страницы Тапёра живут на file:// и на своём 127.0.0.1 — всё остальное
// отклоняем. Если origin определить не удалось, пропускаем: ломать рабочее
// приложение ради перестраховки нельзя.
// Сама проверка — в src/ipc-guard.js (там же тесты). Ошибка проверки = отказ.
localGuard.setOwn({ root: __dirname });   // свои файлы — только из папки программы
const ipcHandleRaw = ipcMain.handle.bind(ipcMain);
const ipcOnRaw = ipcMain.on.bind(ipcMain);
const ipcGuard = require('./ipc-guard').create({
  isOwnPage: (url) => localGuard.isOwnPage(url),
  hasWindow: (sender) => !!(sender && BrowserWindow.fromWebContents(sender)),
  ymwebContents: () => { const w = ymweb.window && ymweb.window(); return w ? w.webContents : null; },
  log: (line) => log(line),
});
const ipcSenderOk = (ev, channel) => ipcGuard.senderOk(ev, channel);
ipcMain.handle = (channel, fn) => ipcHandleRaw(channel, (ev, ...args) => {
  if (!ipcSenderOk(ev, channel)) return { error: 'forbidden' };
  return fn(ev, ...args);
});
ipcMain.on = (channel, fn) => ipcOnRaw(channel, (ev, ...args) => {
  if (ipcSenderOk(ev, channel)) fn(ev, ...args);
});

// User-agent окна (B14): версия Chromium у главного процесса настоящая, поэтому
// считаем строку здесь. В песочнице preload не может подключить свой модуль —
// он спрашивает это значение синхронно при загрузке и кладёт в window.app.chromeUA.
ipcMain.on('window-user-agent', (ev) => { ev.returnValue = userAgent(); });

// --- Логирование (для отладки) ---
function logPath() { try { return path.join(app.getPath('userData'), 'log.txt'); } catch (e) { return path.join(__dirname, 'log.txt'); } }
function memService(url){
  try { const h = new URL(url).hostname.toLowerCase();
    if (/(^|\.)music\.yandex\.(ru|com|by|kz)$/.test(h)) return 'Браузер: Яндекс';
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(h)) return 'Браузер: YouTube';
    if (h === 'ya.ru' || h.endsWith('.ya.ru')) return 'Браузер: сайт';
    return 'Браузер: сайт';
  } catch (e) { return 'Браузер: сайт'; }
}
// Чей это процесс, если окна у него нет. «Страница без окна» — тот самый остаток после «Браузера».
const TYPE_RU = { Browser: 'главный процесс', Tab: 'страница без окна', GPU: 'видео (GPU)', Utility: 'служебный', Zygote: 'заготовка' };
// Что происходило в момент замера — без этого замеры не сравнить
function memState(){
  const p = [];
  p.push(playerBusy ? 'играет' : 'тишина');
  if (lastNpInfo && lastNpInfo.source) p.push('площадка ' + lastNpInfo.source);
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) p.push('свёрнуто');
      else if (!mainWindow.isVisible()) p.push('скрыто');
      else p.push(mainWindow.isFocused() ? 'в фокусе' : 'без фокуса');
    }
  } catch (e) {}
  try { if (ymweb.window && ymweb.window()) p.push('сайт Яндекса открыт'); } catch (e) {}
  const sites = [];
  for (const wc of webContents.getAllWebContents()) {
    try { if (wc.getType() === 'webview') sites.push(memService(wc.getURL()).replace('Браузер: ', '')); } catch (e) {}
  }
  p.push(sites.length ? 'Браузер: ' + sites.join('+') : 'Браузер пуст');
  return p.join(', ');
}
// Отчёт о памяти: кто именно занимает память. Без адресов страниц и личных данных.
function memReport(){
  const byPid = new Map();
  for (const wc of webContents.getAllWebContents()) {
    try { byPid.set(wc.getOSProcessId(), wc); } catch (e) {}
  }
  const rows = [];
  for (const m of app.getAppMetrics()) {
    const wc = byPid.get(m.pid);
    let owner = 'служебный';
    if (mainWindow && wc === mainWindow.webContents) owner = 'главное окно';
    else if (zoomWin && wc === zoomWin.webContents) owner = 'окно масштаба';
    else if (ymweb.window && ymweb.window() && wc === ymweb.window().webContents) owner = 'Яндекс (сайт)';
    else if (wc && wc.getType() === 'webview') owner = memService(wc.getURL());
    else if (wc && wc.getType() === 'window') owner = 'окно';
    else if (wc && wc.getURL && /music\.yandex\./.test(wc.getURL())) owner = 'Яндекс (сайт)';
    else if (wc) owner = memService(wc.getURL());
    const mem = m.memory || {};
    if (owner === 'служебный') { const svc = m.name || m.serviceName; owner = svc ? ('служебный: ' + svc) : (TYPE_RU[m.type] || ('служебный ' + m.type)); }
    rows.push({ pid: m.pid, type: m.type, owner, working: Math.round((mem.workingSetSize || 0) / 1024), private: Math.round((mem.privateBytes || 0) / 1024), cpu: Math.round(((m.cpu && m.cpu.percentCPUUsage) || 0) * 10) / 10 });
  }
  const total = rows.reduce((s, r) => s + r.working, 0);
  const priv = rows.reduce((s, r) => s + r.private, 0);
  const state = memState();
  const text = 'Состояние: ' + state + '\n\n' + rows.map((r) => r.owner + ' [' + r.type + ' ' + r.pid + ']: ' + r.working + ' МБ (частная ' + r.private + '), ЦП ' + r.cpu + '%').join('\n');
  return { at: Date.now(), total, private: priv, state, rows, text };
}
let memTimer = null;
function memEveryMin(){ const v = Number(cfg('memEvery')); return (isFinite(v) && v > 0) ? Math.min(60, Math.max(1, v)) : 10; }
function scheduleMemReport(){ clearTimeout(memTimer); memTimer = setTimeout(function(){ if (!perfOn()) logMemReport(); scheduleMemReport(); }, memEveryMin() * 60000); }
function logMemReport(ready){
  try {
    const r = ready || memReport();
    log('память: всего ' + r.total + ' МБ (частная ' + r.private + '); ' + r.state + ' | '
      + r.rows.map((x) => x.owner + ' [' + x.type + ' ' + x.pid + '] ' + x.working + '/' + x.private + ' МБ, ЦП ' + x.cpu + '%').join(' | '));
  } catch (e) { log('память: отчёт не собрался — ' + e.message); }
}

// --- Наблюдение за нагрузкой (настройка «Следить за нагрузкой», perfWatch) ---
// Один опрос кормит и индикатор в окне, и отдельный журнал замеров
// metrics-ГГГГ-ММ-ДД.log рядом с log.txt. Обычный журнал при этом не засоряется.
const PERF_EVERY = 2000;       // как часто опрашиваем, когда окно видно
const PERF_SLOW = 30000;       // и когда не видно
const PERF_NOISE = 20;         // меньше 20 МБ — шум, а не пик
const PERF_COOL = 60000;       // остывание между записями одного вида
const PERF_CPU_HOT = 5;        // процентов одного ядра — с этого считаем всплеском
const PERF_CPU_HOLD = 3;       // столько опросов подряд должен держаться (6 секунд)
const PERF_WARM = 30000;       // первые полминуты программа собирается — это не пики
const PERF_CAP = 500 * 1024;   // потолок журнала за день
const PERF_KEEP = 7;           // столько дней храним

const perf = {
  timer: null, fast: true, day: '', bytes: 0, thrift: false, startedAt: 0, n: 0, statN: 0, warmUntil: 0,
  memStart: 0, memFirst: 0, memLast: 0, memSum: 0, memPeak: 0, memPeakAt: 0,
  cpuSum: 0, cpuPeak: 0, cpuPeakAt: 0, cpuHot: 0, cpuHotFrom: 0, cpuHotMax: 0,
  lastPeak: 0, lastCpu: 0, lastBg: 0, lastBgMem: 0, lastBgKey: '',
  procs: new Map(), owners: new Map(), born: 0, gone: 0,
  sites: '', brOpens: 0, blurs: 0, tracks: 0, bySrc: {},
  queueNow: 0, queuePeak: 0, queueSum: 0, queueN: 0,
  overlayNow: 0, overlayPeak: 0, playState: '', lastNpAt: 0,
  hold: null, holdN: 0,
};

function perfOn(){ try { return cfg('perfWatch') === true; } catch (e) { return false; } }
function perf2(n){ return n < 10 ? '0' + n : String(n); }
function perfDayOf(d){ return d.getFullYear() + '-' + perf2(d.getMonth() + 1) + '-' + perf2(d.getDate()); }
function perfClock(d){ return perf2(d.getHours()) + ':' + perf2(d.getMinutes()) + ':' + perf2(d.getSeconds()); }
function perfPath(day){ try { return path.join(app.getPath('userData'), 'metrics-' + day + '.log'); } catch (e) { return path.join(__dirname, 'metrics-' + day + '.log'); } }
function perfQueue(n) {
  n = Math.max(0, Number(n) || 0);
  perf.queueNow = n;
  perf.queuePeak = Math.max(perf.queuePeak, n);
  perf.queueSum += n; perf.queueN++;
}
// Пика могло не быть — тогда прочерк, а не 1970 год
function perfAt(ts){ return ts ? perfClock(new Date(ts)) : '—'; }
function perfDur(ms){
  const m = Math.round(ms / 60000);
  if (m < 1) return Math.round(ms / 1000) + ' с';
  if (m < 60) return m + ' мин';
  return Math.floor(m / 60) + ' ч ' + perf2(m % 60) + ' мин';
}

// Журналы замеров старше недели не копим
function perfSweep(){
  try {
    const dir = app.getPath('userData');
    const keep = [];
    for (let i = 0; i < PERF_KEEP; i++) keep.push('metrics-' + perfDayOf(new Date(Date.now() - i * 86400000)) + '.log');
    for (const f of fs.readdirSync(dir)) {
      if (/^metrics-\d{4}-\d\d-\d\d\.log$/.test(f) && keep.indexOf(f) < 0) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} }
    }
  } catch (e) {}
}

function perfRaw(text){
  try { fs.appendFileSync(perfPath(perf.day), text + '\n'); perf.bytes += Buffer.byteLength(text, 'utf8') + 1; } catch (e) {}
}

// Одинаковые записи «состав» подряд склеиваем в одну: «… ×3»
function perfFlush(){
  if (!perf.hold) return;
  perfRaw(perf.hold + (perf.holdN > 1 ? ' ×' + perf.holdN : ''));
  perf.hold = null; perf.holdN = 0;
}

function perfLine(kind, body, extra){
  const now = new Date();
  const day = perfDayOf(now);
  if (day !== perf.day) { perfFlush(); perf.day = day; perf.bytes = 0; perf.thrift = false; perfHeader(); }
  if (perf.thrift && kind !== 'фон' && kind !== 'пик') return;
  const text = perfClock(now) + ' ' + (kind + '       ').slice(0, 7) + ' ' + body;
  if (kind === 'состав') {
    if (perf.hold && perf.hold.slice(9) === text.slice(9)) { perf.holdN++; return; }
    perfFlush(); perf.hold = text; perf.holdN = 1; return;
  }
  perfFlush();
  perfRaw(text);
  if (extra) perfRaw('                 ' + extra);
  if (!perf.thrift && perf.bytes > PERF_CAP) { perf.thrift = true; perfRaw('                 журнал дорос до потолка на сегодня — дальше только фон и пики'); }
}

function perfHeader(){
  const os = require('os');
  const tz = -new Date().getTimezoneOffset() / 60;
  let scr = '';
  try { const d = screen.getPrimaryDisplay(); scr = ' · экран ' + d.size.width + '×' + d.size.height + ' @' + Math.round(d.scaleFactor * 100) + '%'; } catch (e) {}
  perfRaw('');
  perfRaw('=== Тапёр ' + app.getVersion() + ' · запуск ' + perf.day + ' ' + perfClock(new Date()) + ' (UTC' + (tz >= 0 ? '+' : '') + tz + ') ===');
  perfRaw('    ' + process.platform + ' ' + os.release() + ' · Electron ' + process.versions.electron + ' · ' + os.cpus().length + ' ядер · ОЗУ ' + Math.round(os.totalmem() / 1073741824) + ' ГБ' + scr);
  try {
    perfRaw('    масштаб ' + Math.round((cfg('uiZoom') || 1) * 100) + '% · тема ' + (cfg('theme') || '—') + ' · оболочка ' + (cfg('skin') || 'нет') + ' · опрос раз в ' + (PERF_EVERY / 1000) + ' с, фон раз в ' + memEveryMin() + ' мин');
  } catch (e) {}
}

// Раскладка по процессам — второй строкой, только когда она что-то добавляет
function perfRows(r){ return r.rows.map((x) => x.owner + ' ' + x.private).join(' · '); }

function perfSample(){
  let r;
  try { r = memReport(); } catch (e) { return; }
  const now = Date.now();
  const mem = r.private;
  const cpu = r.rows.reduce((s, x) => s + x.cpu, 0);
  // Пики для отладочного меню — те же цифры, что в правом нижнем углу.
  // Считаем здесь, поэтому они копятся, даже когда меню закрыто и окно свёрнуто.
  debugPeaksModule.add(debugPeaks, mem, cpu, now);
  const first = perf.n === 0;
  const warm = now < perf.warmUntil;
  perf.n++; perf.memLast = mem;
  if (first) { perf.memFirst = mem; perf.memPeak = mem; perf.memPeakAt = now; }
  // Пока идёт разминка, цифры в статистику не берём: в первую секунду жив один
  // главный процесс, и «старт 59 МБ» из такого замера ничего не значит.
  if (!warm) { perf.statN++; perf.memSum += mem; perf.cpuSum += cpu; if (!perf.memStart) perf.memStart = mem; }

  // Копим пик и дельту по каждому процессу: итог должен отвечать не только
  // «за сеанс +39 МБ», но и кто именно эти 39 набрал. Считаем по имени, а не
  // по pid: pid меняются, а «главное окно» — это всегда главное окно.
  if (!warm) {
    const byOwner = new Map();
    for (const x of r.rows) byOwner.set(x.owner, (byOwner.get(x.owner) || 0) + x.private);
    for (const [name, v] of byOwner) {
      let o = perf.owners.get(name);
      // Появился по ходу сеанса — начальным считаем ноль, чтобы его вес попал в прирост
      if (!o) { o = { first: perf.statN === 1 ? v : 0, peak: v, last: v }; perf.owners.set(name, o); }
      o.last = v;
      if (v > o.peak) o.peak = v;
    }
    // Исчез — значит к концу сеанса он весит ноль, иначе дельта соврёт
    for (const [name, o] of perf.owners) if (!byOwner.has(name)) o.last = 0;
  }

  // Индикатор в окне
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('perf-sample', { cpu: cpu, mem: mem }); } catch (e) {}

  // Состав процессов: появился или исчез — это и есть «страница без окна»
  const seen = new Set();
  for (const x of r.rows) {
    seen.add(x.pid);
    const p = perf.procs.get(x.pid);
    if (p) { p.mem = x.private; }
    else {
      perf.procs.set(x.pid, { owner: x.owner, type: x.type, mem: x.private, since: now });
      if (!first && !warm) { perf.born++; perfLine('состав', '+ ' + x.owner + ' [' + x.type + ' ' + x.pid + '] ' + x.private); }
    }
  }
  for (const [pid, p] of perf.procs) {
    if (seen.has(pid)) continue;
    if (!warm) { perf.gone++; perfLine('состав', '− ' + p.owner + ' [' + p.type + ' ' + pid + '] ' + p.mem + ' · прожил ' + perfDur(now - p.since)); }
    perf.procs.delete(pid);
  }

  // Сайты во вкладке «Браузер»
  const sites = [];
  for (const wc of webContents.getAllWebContents()) {
    try { if (wc.getType() === 'webview') sites.push(memService(wc.getURL()).replace('Браузер: ', '')); } catch (e) {}
  }
  const key = sites.sort().join('+');
  if (key !== perf.sites) {
    if (!perf.sites && key) perf.brOpens++;
    if (!first) perfLine('событие', key ? '«Браузер» → ' + key : 'ушёл из «Браузера», сайты закрыты');
    perf.sites = key;
  }

  // Пик памяти
  if (!warm && mem > perf.memPeak + PERF_NOISE && now - perf.lastPeak > PERF_COOL) {
    perf.lastPeak = now;
    perfLine('пик', 'память ' + mem + ' (+' + (mem - perf.memPeak) + ' за ' + perfDur(now - perf.memPeakAt) + ') · всего ' + r.total + ' · ЦП ' + cpu.toFixed(1) + ' · ' + r.state, perfRows(r));
  }
  if (mem > perf.memPeak) { perf.memPeak = mem; perf.memPeakAt = now; }
  if (!warm && cpu > perf.cpuPeak) { perf.cpuPeak = cpu; perf.cpuPeakAt = now; }

  // Всплеск процессора: одиночный скачок от клика не считается
  if (cpu >= PERF_CPU_HOT) {
    if (!perf.cpuHot) { perf.cpuHotFrom = now; perf.cpuHotMax = 0; }
    perf.cpuHot++;
    if (cpu > perf.cpuHotMax) perf.cpuHotMax = cpu;
  } else {
    if (perf.cpuHot >= PERF_CPU_HOLD && now - perf.lastCpu > PERF_COOL) {
      perf.lastCpu = now;
      perfLine('ЦП', 'всплеск ' + perf.cpuHotMax.toFixed(1) + ' % · держался ' + perfDur(now - perf.cpuHotFrom) + ' · ' + r.state);
    }
    perf.cpuHot = 0;
  }

  // Фон: раскладка по процессам — только если что-то изменилось
  const every = (perf.thrift ? 30 : memEveryMin()) * 60000;
  if (now - perf.lastBg >= every) {
    const rowsKey = r.rows.map((x) => x.owner).join('|');
    const changed = Math.abs(mem - perf.lastBgMem) > PERF_NOISE || rowsKey !== perf.lastBgKey;
    perf.lastBg = now; perf.lastBgMem = mem; perf.lastBgKey = rowsKey;
    perfLine('фон', 'память ' + mem + ' · всего ' + r.total + ' · ЦП ' + cpu.toFixed(1) + ' · ' + r.state
      + ' · очередь ' + perf.queueNow + ' · OBS ' + perf.overlayNow + ' · ошибок ' + diag.errors, changed ? perfRows(r) : null);
  }
}

function perfSummary(){
  if (!perf.startedAt) return;
  perfFlush();
  const start = perf.memStart || perf.memFirst;
  const d = perf.memLast - start;
  const avgN = Math.max(1, perf.statN);
  const srcs = Object.keys(perf.bySrc).map((k) => k + ' ' + perf.bySrc[k]).join(', ');
  perfRaw('');
  perfRaw('=== итог · ' + perf.day + ', работал ' + perfDur(Date.now() - perf.startedAt) + ' ===');
  perfRaw('память: старт ' + start + ' · средняя ' + Math.round(perf.memSum / avgN) + ' · пик ' + perf.memPeak + ' в ' + perfAt(perf.memPeakAt) + ' · конец ' + perf.memLast + ' · за сеанс ' + (d >= 0 ? '+' : '') + d + (perf.statN ? '' : ' (сеанс короче разминки — цифры приблизительные)'));
  perfRaw('ЦП: среднее ' + (perf.cpuSum / avgN).toFixed(1) + ' % · пик ' + perf.cpuPeak.toFixed(1) + ' % в ' + perfAt(perf.cpuPeakAt));
  perfRaw('процессов: появилось ' + perf.born + ', ушло ' + perf.gone + ', осталось ' + perf.procs.size);
  const own = Array.from(perf.owners.entries());
  if (own.length) {
    perfRaw('пики по процессам: ' + own.slice().sort((a, b) => b[1].peak - a[1].peak).slice(0, 6)
      .map((e) => e[0] + ' ' + e[1].peak).join(' · '));
    const moved = own.map((e) => [e[0], e[1].last - e[1].first]).filter((e) => Math.abs(e[1]) >= 5)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6)
      .map((e) => e[0] + ' ' + (e[1] > 0 ? '+' : '') + e[1]).join(' · ');
    perfRaw('за сеанс по процессам: ' + (moved || 'заметных изменений нет'));
  }
  perfRaw('работа: треков ' + perf.tracks + (srcs ? ' (' + srcs + ')' : '') + ' · «Браузер» открывался ' + perf.brOpens + ' раз · окно уходило из фокуса ' + perf.blurs + ' раз');
  const qAvg = perf.queueN ? Math.round(perf.queueSum / perf.queueN) : perf.queueNow;
  perfRaw('очередь: сейчас ' + perf.queueNow + ' · средняя ' + qAvg + ' · пик ' + perf.queuePeak + ' · плеер ' + (perf.playState || '—'));
  perfRaw('OBS: клиентов сейчас ' + perf.overlayNow + ' · пик ' + perf.overlayPeak);
  const errs = Object.entries(diag.byKind).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => k + ' ' + n).join(', ');
  perfRaw('ошибки: всего ' + diag.errors + (errs ? ' · ' + errs : ' · нет'));
  perfRaw('');
  perf.startedAt = 0;
}

function perfStart(){
  if (perf.timer) return;
  perf.day = perfDayOf(new Date());
  perf.startedAt = Date.now();
  perf.warmUntil = Date.now() + PERF_WARM;
  perf.lastBg = Date.now();
  perfSweep();
  perfHeader();
  perf.fast = true;
  perf.timer = setInterval(perfSample, PERF_EVERY);
  perfSample();
}

function perfStop(){
  if (!perf.timer) return;
  clearInterval(perf.timer); perf.timer = null;
  perfSummary();
}

// Окно не видно — опрашиваем редко, но не бросаем: именно в фоне появляются
// лишние процессы, и бросив опрос, мы их прозеваем (так и вышло 27.10).
function perfRate(fast){
  if (!perf.timer || perf.fast === fast) return;
  perf.fast = fast;
  clearInterval(perf.timer);
  perf.timer = setInterval(perfSample, fast ? PERF_EVERY : PERF_SLOW);
  if (!fast) perfFlush();
}

const mediaProxy = createMediaProxy(function (m) { try { log(m); } catch (e) {} }, { fault: faultSim });

let logChecked = false;
// Счётчики для метрик: ошибки по категориям, чтобы после стрима видеть,
// что именно сыпалось, а не искать по 5 МБ текста.
const diag = { errors: 0, byKind: {}, lastError: '' };
function diagKind(msg) {
  const s = String(msg || '');
  if (/DonatePay/i.test(s)) return 'DonatePay';
  if (/DonationAlerts|DA:/i.test(s)) return 'DonationAlerts';
  if (/Twitch/i.test(s)) return 'Twitch';
  if (/YouTube|yt-dlp|ytdl|youtube/i.test(s)) return 'YouTube';
  if (/Яндекс|Yandex/i.test(s)) return 'Яндекс';
  if (/Волна|wave/i.test(s)) return 'Волна';
  if (/OBS|оверлей|widget/i.test(s)) return 'OBS';
  if (/очеред|queue/i.test(s)) return 'Очередь';
  return 'Другое';
}
function logTail(maxBytes) {
  try {
    const p = logPath(), st = fs.statSync(p), len = Math.min(st.size, maxBytes);
    if (!len) return '';
    const fd = fs.openSync(p, 'r'), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) { return ''; }
}
function log(msg) {
  try {
    const s = String(msg == null ? '' : msg);
    if (/ошиб|ERROR|error|fail|HTTP [45]\d\d|не удалось/i.test(s)) {
      diag.errors++;
      const k = diagKind(s); diag.byKind[k] = (diag.byKind[k] || 0) + 1;
      diag.lastError = s.slice(0, 300);
    }
    if (!logChecked) {
      logChecked = true;
      const p = logPath();
      if (fs.existsSync(p) && fs.statSync(p).size > 10 * 1024 * 1024) {
        try { fs.unlinkSync(p + '.1'); } catch (e) {}
        fs.renameSync(p, p + '.1');
      }
    }
    fs.appendFileSync(logPath(), new Date().toISOString() + '  ' + String(msg) + '\n');
  } catch (e) {}
}
// ── Общая ловушка ошибок главного процесса (R1) ──────────────────────────────
// Ошибка в любом месте — в main.js, в модулях, в паке бота — попадает в журнал
// и не показывает системное окно Electron. Отчёт отправляем существующей sendReport;
// вызов отложен, чтобы на самом раннем старте не зависеть от готовности её окружения.
const crashGuard = crashGuardModule.create({
  log: (m) => { try { log(m); } catch (e) {} },
  report: (fp, text) => {
    const send = () => {
      try {
        const code = crypto.createHash('sha1').update(String(fp)).digest('hex').slice(0, 12);
        const p = sendReport({ service: 'main', stage: 'crash', code, msg: text, details: text }, false);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
    };
    try {
      if (typeof setImmediate === 'function') setImmediate(send);
      else setTimeout(send, 0);
    } catch (e) {}
  }
});
crashGuardModule.install(process, crashGuard);

// Подробный журнал на эту сессию: пишем, только если включён флаг в отладочном меню.
// Ничего не запоминаем на диск — после перезапуска флаг снова выключен.
function logDebug(msg) {
  if (!debugVerbose) return;
  try { log('[подробно] ' + String(msg == null ? '' : msg)); } catch (e) {}
}

// --- Настройки и файл «сейчас играет» для OBS ---
function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
// Была ли это новая установка: файла настроек на старте ещё нет. Снимаем отметку
// до первого чтения настроек (оно может создать файл) — по ней решается, открывать ли визард.
const SETTINGS_EXISTED_AT_START = (() => { try { return fs.existsSync(settingsFile()); } catch (e) { return true; } })();
// Настройки держим в памяти и пишем безопасно (см. src/settings-store.js)
const settingsDisk = require('./settings-store');
// Очередь с позицией («лента за сегодня») — отдельный маленький файл today.json (R2, src/today-store.js).
// Интерфейс не меняется: окно по-прежнему зовёт A.getSetting('today') / A.setSetting('today', …).
const todayStore = require('./today-store');
let settingsReady = false;
function readSettingsFile() { if (!settingsReady) { settingsDisk.setup({ file: settingsFile(), log: (m) => log(m) }); settingsReady = true; } return settingsDisk.all(); }
function writeSettingsFile(s) { readSettingsFile(); settingsDisk.replace(s); }
function todayFile() { return path.join(app.getPath('userData'), 'today.json'); }
let todayReady = false;
function ensureTodayStore() {
  if (!todayReady) { todayStore.setup({ file: todayFile(), log: (m) => log(m) }); todayReady = true; }
  return todayStore;
}
function readToday() { return ensureTodayStore().get(); }
// A3: один раз при запуске переносим очередь из старого settings.json в today.json.
// Если today.json уже есть — он главнее, а старый ключ из настроек просто убираем.
function migrateToday() {
  ensureTodayStore();
  const s = readSettingsFile();
  const r = todayStore.takeFromSettings(s);
  if (!r.moved) return false;
  writeSettingsFile(s);
  try { settingsDisk.flush(); } catch (e) {}
  try { todayStore.flush(); } catch (e) {}
  log('настройки: очередь перенесена из settings.json в today.json');
  return true;
}
const DEFAULTS = {
  npEnabled: true, nowPlayingFormat: '{artist} — {title}', npIdle: '',
  videoQuality: '720', startVolume: 80, prefetch: true,
  autoUpdate: true, updChannel: 'stable', autoStart: false, closeToTray: true, memEvery: 10, perfWatch: true, // нагрузка: графики и журнал замеров включены сразу
  closeAsked: false, // спросили ли уже, что делает крестик (свернуть или закрыть)
  theme: 'dark', reportsEnabled: true,
  normalize: true, crossfade: 6,
  ytEnabled: true, ymEnabled: true, ymWebFallback: true, ytUseCookies: false, scEnabled: true, auEnabled: true,
  preferLocal: true, libInSearch: true,
  reqPrice: 100, reqCurrency: 'RUB', reqAuto: false, reqTiers: 'default',
  queueMode: 'classic', // очередь: classic — «Классический плейлист» (по умолчанию), live — «Живая очередь»
  vizColor: 'grad', // цвет визуализации: cover | accent | grad (по умолчанию — градиент, решение владельца)
  lookTab: true, // вкладка «Оформление» в верхнем меню
  settingsLayout: 'tabs', // настройки: tabs — по вкладкам; sheet — старая общая простыня (невидимый переключатель)
  streamerMode: true, // группа «Стримерам»: вкладка «Заказы», донаты, OBS
  wizardDone: false, // знакомство первого запуска пройдено (визард сам больше не открывается)
  wizardOrdersTested: false, // шаг «Заказы в деле»: тестовые заказы прошли оба пути (чек-лист финала, WZ5)
  liveHelpSeen: false, // справку «Живая очередь» уже показывали (WZ3): второй раз — только по «?»
  mediaKeys: true,
  widgetPort: 47654, widgetLook: 'current', widgetScale: 100, dock2Ban: false,
  // «Видео для OBS» (VO1): обводка, её цвет и толщина, скрывать музыкальные треки без картинки.
  voBorder: false, voColor: '', voWidth: 4, voHideAudio: true,
  // Streamer.bot (0.35): кто принимает заказы из чата и открыт ли приём.
  // chatOrders: none | pack | sbot. При первом запуске 0.35 вычисляется один раз (main.js) и сохраняется.
  chatOrders: 'none', sbotAccepting: true,
  // Пульт к Streamer.bot (0.35, Э2): адрес только своего компьютера, пароль — отдельно и зашифрованно.
  sbotHost: '127.0.0.1', sbotPort: 8080, sbotEndpoint: '/', sbotEnabled: false,
  hotkeys: { playPause: 'Ctrl+Alt+P', next: 'Ctrl+Alt+Right', prev: 'Ctrl+Alt+Left', like: 'Ctrl+Alt+L', shake: 'Ctrl+Alt+S', volUp: 'Ctrl+Alt+Up', volDown: 'Ctrl+Alt+Down', show: 'Ctrl+Alt+T' }
};
function cfg(key) { const s = readSettingsFile(); return s[key] !== undefined ? s[key] : DEFAULTS[key]; }
// Простое хранилище для модулей входа (ключи шифруются внутри модулей)
const settingsStore = {
  get: (k) => readSettingsFile()[k],
  set: (k, v) => { const s = readSettingsFile(); if (v == null) delete s[k]; else s[k] = v; writeSettingsFile(s); }
};
function ytCookieFile() { return path.join(app.getPath('userData'), 'yt-cookies.txt'); }
// ===== Streamer.bot (0.35): ключ порта /sb/* и пароль пульта =====
// Ключ вида tp_ + 32 символа base64url, пароль — строка до 200 символов. Оба хранятся
// зашифрованными (safeStorage), как ключи донатов и модулей: в settings.json открытым текстом
// не лежат, get-setting их не отдаёт. Значения нигде не печатаем — только длины.
const SBOT_KEY_SETTING = 'sbotSecure.key';
const SBOT_PASSWORD_SETTING = 'sbotSecure.password';
const sbotEvents = new EventEmitter(); // события заказов sb-* (Э1; в Э2 — пульт Streamer.bot)
let sbotLink = null;                    // пульт к Streamer.bot — создаётся в app.whenReady (Э2)
let sbotStatePush = null;               // отправить окну полное состояние sbot — там же (0.35+)
let sbotMailbox = null;                 // почтовый ящик событий — там же
let sbotGlobals = {};                   // tapyor-переменные из Streamer.bot (без ключа)
let modHostRef = null;                  // хозяин модулей пака — для общего выключателя приёма (Э4)
// Строка импорта шаблона (Э3): файл кладёт Claude после экспорта из настоящего Streamer.bot.
// Пока файла нет — кнопка «Скопировать шаблон» честно говорит, что шаблон появится позже.
function sbotTemplateFile() {
  const names = ['streamerbot/tapyor-template.txt', 'resources/streamerbot/tapyor-template.txt'];
  const bases = [app.getAppPath(), process.resourcesPath || '', path.join(__dirname, '..')].filter(Boolean);
  for (const b of bases) for (const n of names) { const f = path.join(b, n); if (fs.existsSync(f)) return f; }
  return '';
}
function sbotSecretRead(name) {
  const saved = readSettingsFile()[name];
  if (typeof saved !== 'string' || !saved) return '';
  try {
    const buf = Buffer.from(saved, 'base64');
    const v = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return typeof v === 'string' ? v : '';
  } catch (e) { return ''; }
}
function sbotSecretWrite(name, value) {
  try {
    const v = String(value == null ? '' : value);
    const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v) : Buffer.from(v, 'utf8');
    const s = readSettingsFile(); s[name] = enc.toString('base64'); writeSettingsFile(s);
    if (!safeStorage.isEncryptionAvailable()) log('Streamer.bot: шифрование в системе недоступно — секрет хранится в base64');
    return true;
  } catch (e) { log('Streamer.bot: секрет не сохранён — ' + (e && e.message || e)); return false; }
}
function sbotPortKey() {
  const k = sbotSecretRead(SBOT_KEY_SETTING);
  // Ключ — только печатные символы: битые байты (например, шифрование стало недоступно)
  // за ключ не принимаем, иначе все запросы молча получат 401.
  if (k && k.length >= 8 && /^[\x21-\x7e]+$/.test(k)) return k;
  const fresh = 'tp_' + crypto.randomBytes(24).toString('base64url');
  if (sbotSecretWrite(SBOT_KEY_SETTING, fresh)) log('Streamer.bot: ключ порта создан (длина ' + fresh.length + ')');
  return fresh;
}
function sbotPortKeyNew() {
  const fresh = 'tp_' + crypto.randomBytes(24).toString('base64url');
  if (sbotSecretWrite(SBOT_KEY_SETTING, fresh)) log('Streamer.bot: ключ порта сменён (длина ' + fresh.length + ')');
  return fresh;
}
function sbotPasswordGet() { return sbotSecretRead(SBOT_PASSWORD_SETTING); }
function sbotPasswordSet(pw) { return sbotSecretWrite(SBOT_PASSWORD_SETTING, String(pw == null ? '' : pw).slice(0, 200)); }
// Кто принимает заказы из чата: никто / бот пака / Streamer.bot. Одна настройка на всю программу.
// При переключении пульт открывает или закрывает приём (шаблон ставит награду на паузу).
function setChatOrders(v) {
  const val = v === 'sbot' || v === 'pack' ? v : 'none';
  const s = readSettingsFile();
  const prev = s.chatOrders || 'none';
  // Включили Streamer.bot — приём открывается (A35-2). В уже включённом режиме
  // не трогаем: его могли закрыть командой /sb/accept?on=0.
  s.sbotAccepting = sbotLinkModule.nextAccepting(prev, val, s.sbotAccepting !== false);
  s.chatOrders = val; writeSettingsFile(s);
  // Бот пака и Streamer.bot не принимают заказы одновременно (раздел 9 плана).
  // Пак о Streamer.bot не знает — ему просто выключают приём (modhost.setAccepting).
  try {
    if (modHostRef) modHostRef.setAccepting(val === 'pack').catch((e) => log('Streamer.bot: бот пака не переключился — ' + ((e && e.message) || e)));
  } catch (e) { log('Streamer.bot: бот пака не переключился — ' + ((e && e.message) || e)); }
  if (prev !== val) {
    if (val === 'sbot') uiToast('Чат-бот пака выключен: заказы из чата теперь через Streamer.bot');
    else if (val === 'pack') uiToast('Streamer.bot выключен: заказы из чата теперь принимает чат-бот пака');
    else uiToast('Приём заказов из чата выключен');
  }
  if (sbotLink) {
    sbotLink.setOrderMode(val === 'sbot');
    const change = sbotLinkModule.chatOrdersChange(prev, val);
    if (change === 'open') sbotLink.accept(true);
    else if (change === 'close') sbotLink.accept(false);
  }
  if (sbotStatePush) { try { sbotStatePush(); } catch (e) {} }
  return val;
}
// Приём заказов открыт/закрыт: та же настройка, что у бота пака. Шаблону — событие «приём».
function setSbotAccepting(on) {
  const s = readSettingsFile();
  const prev = s.sbotAccepting !== false;
  s.sbotAccepting = !!on; writeSettingsFile(s);
  if (sbotLink && prev !== !!on) sbotLink.accept(!!on);
  if (sbotStatePush) { try { sbotStatePush(); } catch (e) {} }
  return !!on;
}

// M-01: на каждый вызов yt-dlp — временный файл cookies, после вызова done() удаляет его.
function ytCookies(forStream, o) {
  const none = { args: [], done() {} };
  // Запрет куки целиком (правила заказов не разрешают 18+): иначе возрастной ролик
  // мог бы заиграть «через вход», обойдя правило. Без куки он честно откажет по возрасту.
  if (o && o.deny) return none;
  if (!ytauth.hasCookies()) return none;
  // Возрастное видео (18+): без входа YouTube не отдаёт поток вовсе, поэтому здесь решает
  // не тумблер «использовать вход для воспроизведения», а сам факт входа. Куки идут только
  // на такие ролики (минимум использования) и только если вход сохранён.
  if (forStream && !cfg('ytUseCookies') && !(o && o.age)) return none;
  const t = ytauth.tempCookieFile();
  return t ? { args: ['--cookies', t.file], done: t.done } : none;
}
function npFilePath() {
  const s = readSettingsFile();
  return s.nowPlayingPath || path.join(app.getPath('documents'), 'Тапёр', 'now_playing.txt');
}
function formatNowPlaying(info, fmt) {
  if (!info || !info.title) return '';
  return String(fmt || '{artist} — {title}')
    .replace(/\{artist\}/g, info.artist || '')
    .replace(/\{title\}/g, info.title || '')
    .replace(/\{album\}/g, info.album || '')
    .replace(/\{source\}/g, info.source || '')
    .replace(/^[\s—–-]+|[\s—–-]+$/g, '') // если исполнителя нет — без висящего тире
    .trim();
}
let lastNpText = null;
let lastNpInfo = null;
function writeNowPlaying(info, force) {
  let text = '';
  if (cfg('npEnabled')) {
    text = formatNowPlaying(info, cfg('nowPlayingFormat'));
    if (!text) text = String(cfg('npIdle') || ''); // ничего не играет — текст «на паузе» (или пусто)
  }
  if (text === lastNpText && !force) return;
  const p = npFilePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    try { fs.renameSync(tmp, p); } // целиком за раз — OBS не прочитает полфайла
    catch (e) { fs.writeFileSync(p, text, 'utf8'); try { fs.unlinkSync(tmp); } catch (e2) {} }
    lastNpText = text;
  } catch (e) { log('now_playing.txt: ошибка записи ' + e.message); }
}

// yt-dlp: перенос без изменения поведения (A1) — сам код в src/main/ytdlp.js.
// R12: дочерние yt-dlp берутся на учёт при запуске; killAll() в will-quit гасит их.
const childRegistry = childRegistryModule.create({ log: (m) => { try { log(m); } catch (e) {} } });
const ytdlpModule = require('./main/ytdlp').setup({
  app, fs, path, execFile, crypto, https, log, cfg, faultSim, ytCookies, ytHasCookies: () => ytauth.hasCookies(), fmtDur, streamBusy, srcDir: __dirname, childRegistry
});

// Окно входа в Яндекс: перенос без изменения поведения (A1) — сам код в src/main/login-yandex.js.
const { yandexLogin } = require('./main/login-yandex').setup({ BrowserWindow, ym, loginNav, log, getMainWindow: () => mainWindow });

// Вход по коду через браузер (официальный способ Яндекс OAuth) — перенос без изменения поведения (A1):
// сам код — в src/main/yandex.js; setup вызывается в app.whenReady, на месте блока «Яндекс Музыка».

// Подсказки YouTube (запасной вариант, если у Яндекса пусто)
async function ytSuggest(q) {
  const res = await fetch('https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=ru&oe=utf-8&q=' + encodeURIComponent(q), { signal: AbortSignal.timeout(5000) });
  const buf = Buffer.from(await res.arrayBuffer());
  let txt;
  try {
    const m = /charset=([^;]+)/i.exec(res.headers.get('content-type') || '');
    txt = new TextDecoder(m ? m[1].trim() : 'utf-8').decode(buf);
  } catch (e) { txt = buf.toString('utf8'); }
  const j = JSON.parse(txt);
  return (Array.isArray(j) && Array.isArray(j[1]) ? j[1] : []).filter((s) => typeof s === 'string').slice(0, 8);
}

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}


// --- Audius: открытая площадка независимых артистов (свой API) ---
const AUDIUS = 'https://api.audius.co/v1';
const AU_APP = 'Tapyor';
async function auSearch(q, n) {
  const { net } = require('electron');
  try {
    const r = await net.fetch(AUDIUS + '/tracks/search?query=' + encodeURIComponent(q) + '&app_name=' + AU_APP + '&limit=' + (n || 10), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) { const err = r.status === 401 || r.status === 403 ? 'Audius просит ключ разработчика' : 'HTTP ' + r.status; log('Audius: поиск — ' + err); return { error: err }; }
    const j = await r.json();
    return (j.data || []).filter((t) => t && t.id && t.is_streamable !== false).slice(0, n || 10).map((t) => ({
      src: 'au', id: String(t.id), title: t.title || 'Без названия', author: (t.user && t.user.name) || '',
      seconds: t.duration || 0, duration: fmtDur(t.duration), link: t.permalink ? 'https://audius.co' + t.permalink : '',
      thumb: (t.artwork && (t.artwork['480x480'] || t.artwork['150x150'])) || ''
    }));
  } catch (e) { log('Audius: поиск — ' + e.message); return { error: e.message }; }
}
function auStreamUrl(id) { return AUDIUS + '/tracks/' + encodeURIComponent(id) + '/stream?app_name=' + AU_APP; }



// --- Глобальные горячие клавиши: работают, даже когда в фокусе игра ---
const HOTKEY_ACTIONS = ['playPause', 'next', 'prev', 'like', 'shake', 'volUp', 'volDown', 'show'];
function sendHotkey(action) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotkey', action); } catch (e) {}
}
function applyHotkeys() {
  const failed = [];
  try { globalShortcut.unregisterAll(); } catch (e) {}
  const reg = (acc, action) => {
    if (!acc) return;
    let ok = false;
    // «show» (16.11): окно Тапёра — на передний план поверх других окон (из трея, свёрнутое, за игрой).
    // Делает сам главный процесс: окно может быть скрыто и ничего не получить.
    try { ok = globalShortcut.register(acc, () => (action === 'show' ? showMainWindow() : sendHotkey(action))); } catch (e) { ok = false; }
    if (!ok) { failed.push(acc); log('горячие клавиши: занято или неверно — ' + acc); }
  };
  if (cfg('mediaKeys')) {
    reg('MediaPlayPause', 'playPause');
    reg('MediaNextTrack', 'next');
    reg('MediaPreviousTrack', 'prev');
  }
  const hk = Object.assign({}, DEFAULTS.hotkeys, cfg('hotkeys') || {});
  HOTKEY_ACTIONS.forEach((a) => reg(hk[a], a));
  return { failed };
}

// Ровная громкость: окну нужно «видеть» звук, а потоки Яндекса и YouTube приходят с чужих сайтов.
// Разрешаем окну программы анализировать звук (добавляем заголовок CORS к медиа-ответам).
function allowMediaAnalysis() {
  try {
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (d, cb) => {
      const cdn = /^https:\/\/[^/]*(sndcdn\.com|soundcloud\.cloud|bcbits\.com)\//i.test(d.url || '');
      if (d.resourceType !== 'media' && !(cdn && (d.resourceType === 'xhr' || d.resourceType === 'fetch'))) { cb({}); return; }
      // B7b (P5c №6): только запросам страницы самого Тапёра. Вкладка «Браузер» (webview) и её
      // сайты живут в этой же сессии, но заголовок им не даём — иначе снимается CORS у медиа.
      const mid = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : 0;
      if (!mediaCors.isOwn(d, { mainWebContentsId: mid, origins: localGuard.ownOrigins(srv.getPort()) })) { cb({}); return; }
      const h = Object.assign({}, d.responseHeaders);
      const has = Object.keys(h).some((k) => k.toLowerCase() === 'access-control-allow-origin');
      if (!has) h['Access-Control-Allow-Origin'] = ['*'];
      cb({ responseHeaders: h });
    });
  } catch (e) { log('ровная громкость: не удалось разрешить анализ звука ' + e.message); }
}

let mainWindow = null;
let zoomWin = null;   // отдельное окно масштаба — не связано с zoom главного окна
let zoomTheme = null;   // цвета темы для окна масштаба
let zoomAnchor = null, zoomPending = false, zoomShowTimer = null;
let zoomThemeKeyCur = '';
let zoomHidden = true;
let zoomGen = 0;   // поколение окна: защита от старых таймеров
const ZOOM_W = 300, ZOOM_H = 208;
let tray = null;
const startHidden = process.argv.includes('--hidden'); // запуск вместе с Windows — сразу в трей
let appUrl = null;

// Музыка с компьютера через тот же сервер: перемотка (Range), обложки. Чужие сайты из вкладки «Браузер»
// не получат файлы: нужна метка из cookie окна Тапёра (SameSite=Strict) и id файла из списка.
const LOCAL_KEY = crypto.randomBytes(18).toString('hex');
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', mov: 'video/quicktime', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'video/webm', weba: 'audio/webm' };
// Обложка для файла без своей: квадрат с расширением (MP3, FLAC, MKV…). Цвет — по типу: звук / видео
function extBadgeSvg(file) {
  const ext = (path.extname(file || '').slice(1) || '?').toUpperCase().slice(0, 4);
  const vid = library.isVideo(file || '');
  const [a, b] = vid ? ['#2B3A67', '#1B2240'] : ['#3A2D66', '#1E1A33'];
  const icon = vid
    ? '<rect x="44" y="30" width="32" height="22" rx="4" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3"/><path d="M55 36v10l8-5z" fill="#fff" fill-opacity=".55"/>'
    : '<path d="M66 28v20.5a6 6 0 1 1-3-5.2V33l-10 2.4v15.6a6 6 0 1 1-3-5.2V32.6z" fill="#fff" fill-opacity=".55"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>' +
    '<rect width="120" height="120" fill="url(#g)"/>' + icon +
    '<text x="60" y="92" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="' + (ext.length > 3 ? 20 : 24) + '" font-weight="700" letter-spacing="1" fill="#fff" fill-opacity=".9">' + ext.replace(/[^A-Z0-9?]/g, '') + '</text></svg>';
}
function cookieKey(req) { const m = /(?:^|;\s*)tapk=([0-9a-f]+)/.exec(req.headers.cookie || ''); return m ? m[1] : ''; }
// Кэш уменьшенных обложек локальных файлов: 200 штук, старые вытесняются
const LCOVER_MAX = 200;
const lcoverCache = new Map();
function lcoverSmall(c){
  try {
    const img = nativeImage.createFromBuffer(c.data);
    if (img.isEmpty()) return c; // WebP/битая — отдаём как было
    const sz = img.getSize();
    if (sz.width <= 300 && sz.height <= 300) return c;
    const out = sz.width >= sz.height
      ? img.resize({ width: 300, quality: 'good' })
      : img.resize({ height: 300, quality: 'good' });
    return { data: out.toJPEG(82), mime: 'image/jpeg' };
  } catch (e) { return c; }
}

// Короткое сообщение внизу окна (тост). Одна точка для главного процесса.
function uiToast(msg) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ui-toast', String(msg || '')); } catch (e) {}
}
// Состояние автопочинки → окну (группа «Автопочинка» в быстрой проверке).
function autofixSend(services) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('autofix-state', { ok: true, services: services || {} }); } catch (e) {}
}
// Вторая док-панель OBS (DOCK2): узел «снимок — команды — зрители» (docs/DOCK2.md).
// Создаётся до локального сервера, чтобы тот отдал ему маршруты /dock2*.
const dock2Hub = require('./main/dock2-hub').create({
  ipcMain, getMainWindow: () => mainWindow, showMainWindow, localGuard, log, fs, path, srcDir: __dirname,
  senderOk: ipcSenderOk,
  getPort: () => srv.getPort(),
  openUrl: (u) => shell.openExternal(u)
});
// Локальный сервер: перенос без изменения поведения (A1) — сам код в src/main/local-server.js.
let restartServer = null;   // назначается внутри app.whenReady
let sbotHandle = null;      // порт /sb/* для Streamer.bot (0.35) — создаётся в app.whenReady
const srv = require('./main/local-server').setup({
  http, fs, path, dialog, log, crypto, library, localGuard, serverErrors, uiBuild, sbotPort, perf, uiToast,
  LOCAL_KEY, MIME, extBadgeSvg, cookieKey, lcoverCache, lcoverSmall, LCOVER_MAX,
  getMainWindow: () => mainWindow, showMainWindow, getSbotHandle: () => sbotHandle,
  getAppUrl: () => appUrl, setAppUrl: (u) => { appUrl = u; },
  readSettingsFile, writeSettingsFile, srcDir: __dirname,
  dock2Hub
});
// Мост модуля «Пульт с телефона»: dock2 + лента первой панели + QR (docs/REMOTE.md).
// Адреса облака пульта — src/remote-server.json ядра (как license-server.json), модулю пака — через мост.
const remoteRelays = (() => { try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'remote-server.json'), 'utf8')); return Array.isArray(j.relays) ? j.relays : []; } catch (e) { return []; } })();
const remoteBridge = require('./main/remote-bridge').create({ hub: dock2Hub, widget: srv, log, relays: remoteRelays });

// Пипетка по всему экрану: перенос без изменения поведения (A1) — сам код в src/main/pipette.js.
// Подключение screen/desktopCapturer осталось здесь и в тот же момент; вызовы — внутри модуля.
const { screen, desktopCapturer } = require('electron');
const pipette = require('./main/pipette').setup({ ipcMain, BrowserWindow, path, log, srcDir: __dirname, screen, desktopCapturer });

// Масштаб интерфейса: zoomFactor + пропорциональный минимум окна,
// чтобы при уменьшении масштаба окно можно было сжимать дальше.
const UI_MIN_W = 900, UI_MIN_H = 600;
let uiZoomCur = 1;   // последний масштаб главного окна: по нему возвращаем его, если что-то сбило
function applyUiZoom(win, f) {
  if (!win) return 1;
  const z = Math.min(1.4, Math.max(0.6, Number(f) || 1));
  if (win === mainWindow) uiZoomCur = z;
  win.webContents.setZoomFactor(z);
  try { win.setMinimumSize(Math.max(420, Math.round(UI_MIN_W * z)), Math.max(300, Math.round(UI_MIN_H * z))); } catch (e) {}
  try { if (win && win.webContents) win.webContents.send('ui-zoom-changed', z); } catch (e) {}
  try { if (zoomWin && !zoomWin.isDestroyed()) zoomWin.webContents.send('ui-zoom-changed', z); } catch (e) {}
  return win.webContents.getZoomFactor();
}

// Отдельное окно масштаба: живёт независимо от zoom главного окна
function zoomThemeKey(t) { try { return JSON.stringify(t || {}); } catch (e) { return ''; } }
function loadZoomPage(theme) {
  const q = Buffer.from(JSON.stringify(theme || {}), 'utf8').toString('base64');
  // Через свой сервер, а не file://: по file:// Chromium запрещает странице подгружать шрифты (@font-face)
  if (appUrl) zoomWin.loadURL(appUrl.replace(/index\.html$/, 'zoom.html') + '?t=' + encodeURIComponent(q));
  else zoomWin.loadFile(path.join(__dirname, 'zoom.html'), { query: { t: q } });
}
function createZoomWindow(theme, gen) {
  zoomWin = new BrowserWindow({
    width: ZOOM_W, height: ZOOM_H, frame: false, resizable: false, show: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    backgroundColor: (theme && theme.bg0) || '#0E0F13',
    parent: mainWindow || undefined,
    // Своя сессия: Chromium хранит масштаб по адресу, а окно масштаба живёт на том же адресе,
    // что и главное. Без отдельной сессии его setZoomFactor(1) сбрасывал масштаб главного окна
    webPreferences: { preload: path.join(__dirname, 'zoom-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'zoomwin' }
  });
  zoomWin.setMenuBarVisibility(false);
  zoomThemeKeyCur = zoomThemeKey(theme);
  loadZoomPage(theme);
  // окно масштаба всегда 100%: сбрасываем возможный унаследованный zoom для file://
  try { zoomWin.webContents.setZoomFactor(1); } catch (e) {}
  zoomWin.webContents.on('did-finish-load', () => { try { zoomWin.webContents.setZoomFactor(1); } catch (e) {} });
  zoomWin.on('blur', () => { const w = zoomWin; setTimeout(() => { try { if (w && w === zoomWin && !w.isDestroyed() && !w.isFocused()) { zoomHidden = true; w.destroy(); zoomWin = null; } } catch (e) {} }, 140); });
  zoomWin.once('ready-to-show', () => { if (zoomPending && gen === zoomGen) revealZoomWindow(gen); });
  zoomWin.on('closed', () => { zoomWin = null; });
}
function showZoomWindow(anchor) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Запоминаем масштаб до того, как появится окно масштаба: по нему потом сверяемся
  try { uiZoomCur = mainWindow.webContents.getZoomFactor() || uiZoomCur; } catch (e) {}
  if (anchor && anchor.theme) zoomTheme = anchor.theme;
  if (zoomWin && !zoomWin.isDestroyed() && !zoomHidden) { zoomHidden = true; zoomWin.destroy(); zoomWin = null; return; }
  // каждый показ — свежее окно: не может показать старый кадр или чужую тему
  zoomPending = true; zoomAnchor = anchor;
  const gen = ++zoomGen;
  if (zoomWin && !zoomWin.isDestroyed()) { try { zoomWin.destroy(); } catch (e) {} zoomWin = null; }
  createZoomWindow(zoomTheme, gen);
  const send = () => { try { zoomWin.webContents.send('zoom-theme', zoomTheme); } catch (e) {} };
  if (zoomWin.webContents.isLoading()) zoomWin.webContents.once('did-finish-load', send);
  else send();
  clearTimeout(zoomShowTimer);
  zoomShowTimer = setTimeout(() => { if (zoomPending && gen === zoomGen) revealZoomWindow(gen); }, 1500);
}
async function revealZoomWindow(gen) {
  if (gen && gen !== zoomGen) return;
  if (!zoomWin || zoomWin.isDestroyed() || !zoomAnchor) { zoomPending = false; return; }
  zoomPending = false; clearTimeout(zoomShowTimer);
  const b = mainWindow.getContentBounds();
  const z = mainWindow.webContents.getZoomFactor();
  const ax = Number(zoomAnchor.right) || 0;
  const ay = Number(zoomAnchor.bottom) || 0;
  let x = b.x + Math.round(ax * z) - ZOOM_W;
  let y = b.y + Math.round(ay * z) + 8;
  try {
    const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
    x = Math.min(Math.max(wa.x + 6, x), wa.x + wa.width - ZOOM_W - 6);
    y = Math.min(Math.max(wa.y + 6, y), wa.y + wa.height - ZOOM_H - 6);
  } catch (e) {}
  zoomWin.setBounds({ x, y, width: ZOOM_W, height: ZOOM_H });
  try { zoomWin.setOpacity(0); } catch (e) {}
  zoomWin.show(); zoomWin.focus();
  setTimeout(() => { try { if (gen === zoomGen && zoomWin && !zoomWin.isDestroyed()) zoomWin.setOpacity(1); } catch (e) {} }, 80);
  zoomHidden = false;
  // Подстраховка: если масштаб главного окна всё-таки сбился, возвращаем его перед показом
  try { if (Math.abs(mainWindow.webContents.getZoomFactor() - uiZoomCur) > 0.001) applyUiZoom(mainWindow, uiZoomCur); } catch (e) {}
  try { zoomWin.webContents.send('ui-zoom-changed', mainWindow.webContents.getZoomFactor()); } catch (e) {}
}


// Сторож окна (0.34.0, задание 6): подписываем события главного окна один раз
// на каждое создание. Скрытого окна Яндекса и вкладки «Браузер» это не касается —
// у них свои обработчики. Решения и счёт — в src/watchdog.js (покрыто тестами).
function attachWatchdog(win) {
  if (!watchdog || !win || win.isDestroyed()) return;
  const wc = win.webContents;
  // Новое окно — новый пульс с нуля: не считаем его зависшим, пока не спросили.
  watchdogLastPong = Date.now();
  try { watchdog.resetHang(); } catch (e) {}
  wc.on('render-process-gone', (e, details) => {
    const reason = details && details.reason;
    // Падение — не зависание: снимаем пульс и таймер зависания.
    watchdogLastPong = Date.now();
    try { watchdog.resetHang(); } catch (err0) {}
    try {
      watchdog.onGone(reason, { quitting: watchdogQuitting || !!app.isQuitting });
    } catch (err) { log('сторож: обработчик падения — ' + (err && err.message ? err.message : err)); }
  });
  wc.on('unresponsive', () => {
    try {
      const r = watchdog.onUnresponsive();
      if (r && r.action === 'wait' && !r.already) log('сторож: окно не отвечает — жду ' + Math.round(r.ms / 1000) + ' с');
    } catch (err) { log('сторож: обработчик зависания — ' + (err && err.message ? err.message : err)); }
  });
  wc.on('responsive', () => {
    try { watchdog.onResponsive(); }
    catch (err) { log('сторож: обработчик отклика — ' + (err && err.message ? err.message : err)); }
  });
}

// Пульс окна: см. комментарий у WATCHDOG_PING_MS. Пропускаем, пока идёт выход,
// пока показано сообщение о петле и пока окна нет (тогда просто ждём новое).
// Если между тиками прошло больше трёх периодов — это был сон ПК или главный
// процесс был занят: окно не виновато, сбрасываем отсчёт и не перезапускаем.
// Сброс пульса после сна/разблокировки: окно живое, просто пульс не шёл.
// Отдельная функция, чтобы одно и то же делали powerMonitor и пропуск тика.
function resetWatchdogPulse(reason) {
  watchdogLastPong = Date.now();
  watchdogLastTick = Date.now();
  try { if (watchdog) watchdog.resetHang(); } catch (e) {}
  log('сторож: пульс сброшен — ' + reason);
}

function startWatchdogHeartbeat() {
  if (watchdogPingTimer) return;
  watchdogLastTick = Date.now();
  watchdogPingTimer = setInterval(() => {
    const now = Date.now();
    const prevTick = watchdogLastTick;
    watchdogLastTick = now;
    if (watchdogQuitting || watchdogLoopShown || !watchdog) return;
    const d = watchdogModule.heartbeatDecision({ now: now, lastTick: prevTick, lastPong: watchdogLastPong });
    if (d.action === 'skip') {
      watchdogLastPong = now;
      try { watchdog.resetHang(); } catch (e) {}
      log('сторож: пропуск пульса после паузы ' + Math.round(d.pausedMs / 1000) + ' с');
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      watchdogLastPong = now;
      try { watchdog.resetHang(); } catch (e) {}
      return;
    }
    try { mainWindow.webContents.send('watchdog-ping'); } catch (e) { return; }
    if (d.action === 'hung') {
      const r = watchdog.onUnresponsive(d.startedAt);
      if (r && r.action === 'wait' && !r.already) {
        log('сторож: окно не отвечает (нет отклика) — жду ' + Math.round(r.ms / 1000) + ' с');
      }
    }
  }, WATCHDOG_PING_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: themeColors().bg,
    title: 'Тапёр',
    show: !startHidden,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    // Тёмная верхняя полоса в цвет оформления; системные кнопки остаются
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: themeColors().sym, height: 36 }, // прозрачная панель кнопок окна
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // вкладка «Браузер»: сайты сервисов
    }
  });


  mainWindow.loadURL(appUrl || ('file://' + path.join(__dirname, 'index.html')));
  attachWatchdog(mainWindow);

  // Наблюдение за нагрузкой: окно видно — опрос частый, не видно — редкий
  mainWindow.on('focus', () => perfRate(true));
  mainWindow.on('blur', () => { perf.blurs++; perfRate(false); });
  mainWindow.on('minimize', () => perfRate(false));
  mainWindow.on('restore', () => perfRate(true));

  // Масштаб интерфейса из настроек — применяем до первой отрисовки, без «прыжка»
  mainWindow.webContents.on('did-finish-load', () => {
    applyUiZoom(mainWindow, cfg('uiZoom') || 1);
    srv.widgetCount(); // окно знает с самого начала: панелей OBS пока нет — не тратит процессор на них
    // Пульт мог подключиться раньше окна — отдаём полное состояние, чтобы экран не ждал опроса.
    try {
      if (sbotStatePush) sbotStatePush();
      else if (sbotLink) mainWindow.webContents.send('sbot-state', sbotLink.getState());
    } catch (e) {}
  });
  // Видео на весь экран: разворачиваем само окно, а не элемент страницы.
  // Полный экран через requestFullscreen оставлял страницу прежнего размера посреди экрана (чёрные поля по бокам).
  mainWindow.on('enter-full-screen', () => { try { mainWindow.webContents.send('win-fullscreen', true); } catch (e) {} });
  mainWindow.on('leave-full-screen', () => { try { mainWindow.webContents.send('win-fullscreen', false); } catch (e) {} });
  // Окно свернули/развернули: по этому сигналу вкладка «Браузер» закрывает сайты (а не по потере фокуса —
  // иначе сайты закрывались, когда стример просто переключился в OBS).
  mainWindow.on('minimize', () => { try { mainWindow.webContents.send('win-minimized', true); } catch (e) {} });
  mainWindow.on('restore', () => { try { mainWindow.webContents.send('win-minimized', false); } catch (e) {} });
  // Не открывать новые окна (ссылки и т.п.) — всё остаётся в программе
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // В этом окне живёт мост window.app со всеми возможностями программы. Если его увести
  // на внешний адрес, мост достанется чужой странице. Окна входа (Яндекс, YouTube) здесь
  // ни при чём — они отдельные, без нашего preload, и ходят куда надо по своей работе.
  // will-redirect — тот же запрет для перенаправлений (ревью 01.11: 302 обходил will-navigate)
  const guardNav = (kind) => (ev, url) => {
    if (localGuard.isOwnPage(url)) return;
    ev.preventDefault();
    log('окно: ' + kind + ' на ' + String(url).slice(0, 120) + ' заблокирован');
  };
  mainWindow.webContents.on('will-navigate', guardNav('переход'));
  mainWindow.webContents.on('will-redirect', guardNav('перенаправление'));

  // Крестик: пока выбор не запомнен — спрашиваем «свернуть или закрыть» в самом окне;
  // дальше — как в настройке «Крестик сворачивает в трей»
  mainWindow.on('close', (e) => {
    if (app.isQuitting) return;
    const wc = mainWindow.webContents;
    const canAsk = !cfg('closeAsked') && wc && !wc.isDestroyed() && !wc.isLoading() && !wc.isCrashed() && mainWindow.isVisible();
    if (canAsk) {
      e.preventDefault();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      try { wc.send('ask-close'); return; } catch (err) { /* не достучались до окна — поступаем по настройке */ }
    }
    if (cfg('closeToTray')) {
      e.preventDefault();
      mainWindow.hide();
    } else {
      app.isQuitting = true; // крестик = выход (так выбрано в настройках)
      app.quit();
    }
  });

  // R12 (п. 3): страховка от окна, закрытого не через штатный путь (window.close()
  // из страницы и подобное). Если это не выход и сторож уже не поднимает окно —
  // пишем в журнал и выходим штатно, а не остаёмся без окна. Решение «что делать» —
  // в src/window-closed.js (покрыто unit-тестами), здесь только окно и журнал.
  const win = mainWindow;
  win.on('closed', () => {
    const decision = windowClosedModule.closedDecision({
      quitting: !!app.isQuitting || watchdogQuitting,
      hiddenToTray: false, // closed бывает у закрытого окна; спрятанное в трей его не шлёт
      recovering: mainWindow !== win // сторож уже создал новое окно — это его работа
    });
    if (decision.action !== 'quit') return;
    log('окно закрыто вне выхода — выходим штатно');
    app.isQuitting = true;
    app.quit();
  });
}

// Цвета системной полосы окна под тему оформления
function themeColors() { const t = cfg('theme'); if (t === 'dark') return { bg: '#272727', sym: '#C7D2D8' }; if (t === 'mono') return { bg: '#161616', sym: '#CBCBCB' }; const b = cfg('themeBar'); if (b && /^#[0-9a-f]{6}$/i.test(b.bg) && /^#[0-9a-f]{6}$/i.test(b.sym)) return b; return { bg: '#272727', sym: '#C7D2D8' }; }
let winBgCur = '';   // цвет подвала, присланный окном; пока его нет — цвет шапки, как раньше
function cssColorHex(v) {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(String(v || '').trim());
  if (!m) return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : '';
  return '#' + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, +x)).toString(16).padStart(2, '0')).join('');
}
function applyThemeWindow() {
  try { if (mainWindow && !mainWindow.isDestroyed()) { const c = themeColors(); mainWindow.setBackgroundColor(winBgCur || c.bg); mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: c.sym, height: 36 }); } } catch (e) { log('тема: ' + e.message); }
}
// ===== Отчёты об ошибках: анонимно, без личного, один и тот же «отпечаток» не чаще раза в сутки =====
const REPORT_URL = 'https://functions.yandexcloud.net/d4ehsmee0l5joni3fbkf';
// Сама вычистка путей и адресов — в src/report-scrub.js (общая с отчётом для проверки).
function reportScrub(s) { return reportScrubModule.scrub(s); }
function installId() { let id = settingsStore.get('installId'); if (!id) { id = require('crypto').randomUUID(); settingsStore.set('installId', id); } return id; }
let lastReport = null;
// Попытки отправки за время работы программы: [отпечаток] → время. Ограничивает повторы
// даже при 429, когда reportsSent не обновляется (STAB-R8).
const reportAttempts = Object.create(null);
async function sendReport(r, force) {
  try {
    if (!force && cfg('reportsEnabled') === false) return { skipped: 'off' };
    const code = String(r.code || '').replace(/\d{4,}/g, '#').slice(0, 40);
    const fp = require('crypto').createHash('sha1').update([r.service, r.stage, code].join('|')).digest('hex').slice(0, 10);
    const sent = settingsStore.get('reportsSent') || {};
    if (!force && sent[fp] && Date.now() - sent[fp] < 24 * 3600 * 1000) return { skipped: 'today' };
    // Один и тот же отчёт — не чаще одной попытки в 10 минут, каким бы ни был ответ сервера.
    // force (проверка отправки) не ограничиваем.
    if (!force) {
      const now = Date.now();
      if (!reportThrottle.attemptAllowed(now, fp, reportAttempts)) return { skipped: 'recent' };
      reportAttempts[fp] = now;
    }
    const body = { fp, service: r.service, stage: r.stage, code, msg: reportScrub(r.msg).slice(0, 600), details: reportScrub(r.details).slice(0, 1500),
      app: app.getVersion(), build: BUILD.build, commit: BUILD.commit,
      recipes: String((recipes.info() || {}).version || ''), os: process.platform + ' ' + require('os').release(), iid: installId() };
    lastReport = body;
    const { net: enet } = require('electron');
    const res = await enet.fetch(REPORT_URL, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', [CLOUD_KEY_HEADER]: CLOUD_KEY }, signal: AbortSignal.timeout(10000) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) settingsStore.set('reportsSent', Object.assign({}, sent, { [fp]: Date.now() }));
    log('отчёт об ошибке ' + r.service + '/' + r.stage + ': ' + (res.ok ? 'отправлен' + (j.issue ? ' (задача #' + j.issue + ', пользователей ' + j.users + ')' : '') : 'не отправлен, ' + res.status + ' ' + (j.error || '')));
    return Object.assign({ ok: res.ok, status: res.status }, j);
  } catch (e) { log('отчёт об ошибке: не отправлен — ' + e.message); return { ok: false, error: e.message }; }
}

// --- Автообновление (всё показывается в шапке программы, без всплывающих окон) ---
// Перенос без изменения поведения (A1): код обновлений — в src/main/updater.js.
let playerBusy = false;      // играет ли сейчас музыка (сообщает окно)
// R3: активность этого запуска. Пока в программе что-то играло или приходил заказ,
// скачанное обновление не перезапускает её само — ждёт кнопки «Перезапустить сейчас»
// или обычного выхода (см. src/update-policy.js, там же решение и тесты).
const updSession = updatePolicy.createSession();
const upd = require('./main/updater').setup({
  app, fs, path, ipcMain, autoUpdater, log, cfg, settingsDisk, ensureTodayStore,
  readSettingsFile, writeSettingsFile, BUILD, updatePolicy, updateSign, releaseFeed,
  session: updSession, getMainWindow: () => mainWindow, isPlayerBusy: () => playerBusy,
  showMainWindow, srcDir: __dirname
});
// Windows не даёт фоновому процессу забрать фокус. Обходим через AttachThreadInput:
// цепляемся к потоку активного окна и уже оттуда поднимаем своё.
function forceForeground(win) {
  try {
    const buf = win.getNativeWindowHandle();
    const hwnd = buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
    const ps = [
      "$sig = '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int c);",
      "[DllImport(\"user32.dll\")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);",
      "[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);'",
      'Add-Type -Namespace Wf -Name Fg -MemberDefinition $sig',
      '$h = [IntPtr]' + hwnd,
      '[Wf.Fg]::ShowWindow($h, 9) | Out-Null',
      '[Wf.Fg]::SwitchToThisWindow($h, $true)',
      '[Wf.Fg]::SetForegroundWindow($h) | Out-Null'
    ].join('; ');
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }, () => {});
  } catch (e) {}
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  try {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop();
    mainWindow.focus();
    mainWindow.flashFrame(true);
    mainWindow.once('focus', () => { try { mainWindow.flashFrame(false); } catch (e) {} });
    // Раньше forceForeground звался трижды — каждый раз это отдельный powershell.exe
    // с Add-Type, то есть компиляция C# на лету: сотни миллисекунд, три процесса и повод
    // для эвристик антивируса. Обычно хватает штатных show/focus выше, поэтому запускаем
    // обходной путь один раз и только если через 350 мс окно так и не вышло вперёд.
    setTimeout(() => {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isFocused()) return;   // всё получилось без PowerShell
        forceForeground(mainWindow);
      } catch (e) {}
    }, 350);
    clearTimeout(global.__topTimer);
    global.__topTimer = setTimeout(() => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); } catch (e) {}
    }, 2600);
  } catch (e) {
    try { mainWindow.show(); mainWindow.focus(); } catch (err) {}
  }
}


// Только один экземпляр приложения
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Запустили ещё раз — показываем уже открытое окно
    // повторный запуск — тот же путь, что из трея: show/focus и обходной путь, если окно не вышло вперёд
    if (mainWindow) showMainWindow();
  });
}

if (gotTheLock) app.whenReady().then(async () => {
  // Имитация сбоев: обернуть сеть до первых запросов сервисов (Яндекс, Last.fm, донаты, облако).
  installFaultFetches();

  // A3 (R2): очередь из старого settings.json — в отдельный today.json. Делаем до окна,
  // чтобы оно сразу читало очередь из нового места и ничего не потерялось.
  try { migrateToday(); } catch (e) { log('настройки: перенос очереди не удался — ' + (e && e.message ? e.message : e)); }

  // ===== Автопочинка (0.34.0, шаг 5) =====
  // Диспетчер (src/autofix.js) решает, когда и что починить. Здесь — только сами починки:
  // сеть, кэш, обновление движка, переподключение донатов. Всё внешнее приходит обработчиками,
  // чтобы модуль оставался без Electron и проверялся unit-тестами.
  const autofixWait = (ms) => new Promise((r) => setTimeout(r, ms));
  const autofixHandlers = {
    clearCache: async () => {
      await session.defaultSession.clearCache();
      try { await session.fromPartition('persist:yandex-login').clearCache(); } catch (e) {}
      return true;
    },
    ytServiceFix: async () => {
      try { await autofixHandlers.clearCache(); } catch (e) {}
      const r = await ping('https://www.youtube.com/generate_204', { timeout: 6000 });
      return { ok: r.status < 500, reason: r.status < 500 ? '' : 'YouTube не отвечает' };
    },
    ytCheck: async () => {
      try {
        const r = await ping('https://www.youtube.com/generate_204', { timeout: 6000 });
        return { ok: r.status < 500, reason: r.status < 500 ? '' : 'YouTube не отвечает' };
      } catch (e) { return { ok: false, reason: 'YouTube не отвечает' }; }
    },
    ytLoginCheck: async () => { const a = ytAuthStatus(); return !!(a.cookies || (a.oauth && a.oauth.account)); },
    ytLoginVerify: async () => {
      const a = ytAuthStatus();
      const who = !!(a.cookies || (a.oauth && a.oauth.account));
      return { ok: who, reason: who ? '' : 'вход в YouTube не найден' };
    },
    ytdlpUpdate: async () => { const r = await ytdlpModule.ytdlpUpdate(); return { ok: !!r.ok, reason: r.text || '' }; },
    ytdlpVerify: async () => {
      const v = await ytdlpModule.ytdlpVersion(ytdlpModule.ytdlpPath());
      return { ok: !!v, reason: v ? '' : 'движок YouTube не запускается' };
    },
    // Для отказа потока мало «движок на месте»: проверяем, что поток действительно получается.
    // Иначе «починено» показывалось бы даже когда YouTube недоступен.
    ytStreamVerify: async () => {
      try {
        const r = await ytdlpModule.streamViaYtDlp('https://www.youtube.com/watch?v=jNQXAC9IVRw');
        const ok = !!(r && (r.url || r.audioUrl));
        return { ok, reason: ok ? '' : 'поток YouTube не получен' };
      } catch (e) { return { ok: false, reason: 'поток YouTube не получен' }; }
    },
    ymServiceFix: async () => {
      try { await autofixHandlers.clearCache(); } catch (e) {}
      const r = await ping('https://api.music.yandex.net/genres', { timeout: 6000 });
      return { ok: r.status < 500, reason: r.status < 500 ? '' : 'Яндекс не отвечает' };
    },
    ymCheck: async () => {
      try {
        const r = await ping('https://api.music.yandex.net/genres', { timeout: 6000 });
        return { ok: r.status < 500, reason: r.status < 500 ? '' : 'Яндекс не отвечает' };
      } catch (e) { return { ok: false, reason: 'Яндекс не отвечает' }; }
    },
    ymLoginCheck: async () => { const st = await ymStatus(); return !!st.loggedIn; },
    ymLoginVerify: async () => {
      const st = await ymStatus();
      return { ok: !!st.loggedIn, reason: st.loggedIn ? '' : 'вход в Яндекс не найден' };
    },
    ymSiteFix: async () => {
      if (!cfg('ymWebFallback')) return { ok: false, reason: 'запасной путь выключен в настройках' };
      const tr = settingsStore.get('healthYmTrack');
      if (!tr) return { ok: false, reason: 'нечем проверить — нет трека для пробы' };
      const before = recipes.info().version;
      const rr = await recipes.refresh();
      let pr;
      try { pr = await ymweb.probe(tr); } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
      if (pr && (pr.stage === 'busy' || pr.stage === 'cancel')) return { ok: false, reason: 'окно сайта занято другой проверкой' };
      const ok = !!(pr && pr.ok);
      // Вердикт глубокой проверки обновляем сразу: иначе лампочка сайта осталась бы красной до следующей.
      try {
        const hs = settingsStore.get('health');
        if (hs && hs.services && hs.services.yandex) {
          const st = (hs.services.yandex.steps || []).find((x) => /сайт/i.test(x.name));
          if (st) {
            st.ok = ok;
            st.text = ok ? 'работает' : ((pr && pr.error) || 'не работает');
            st.details = (pr && pr.details) || '';
            st.stage = (pr && pr.stage) || '';
            hs.siteAt = Date.now();
            settingsStore.set('health', hs);
          }
        }
      } catch (e) {}
      return {
        ok,
        reason: ok ? '' : ((pr && (pr.error || pr.text)) || 'сайт не заработал'),
        text: ok && rr.ok && recipes.info().version > before ? 'Правила Яндекса устарели — Тапёр скачал новые' : ''
      };
    },
    recipesRefresh: async () => { const r = await recipes.refresh(); return { ok: !!r.ok, reason: r.ok ? '' : 'GitHub недоступен' }; },
    recipesVerify: async () => {
      const ok = recipes.info().version > 0;
      return { ok, reason: ok ? '' : 'правила не загрузились' };
    },
    donReconnect: async (service) => {
      const p = service === 'donationalerts' ? 'da' : 'dp';
      if (!donations.reconnect(p)) return { ok: false, reason: 'вход в сервис не настроен' };
      // Ждём один свежий опрос: DonationAlerts — 1,5 с, DonatePay — 15 с (он не любит частые запросы).
      const waitMs = p === 'da' ? 8000 : 20000;
      const t0 = Date.now();
      let st = {};
      while (Date.now() - t0 < waitMs) {
        await autofixWait(400);
        st = donations.status()[p] || {};
        if (st.at && st.at > t0) break;
      }
      return { ok: !!st.ok, reason: st.ok ? '' : (st.error || 'сервис не ответил') };
    },
    cloudRetry: async () => {
      const { net: enet } = require('electron');
      const list = await cloudCheck.check([
        { id: 'da', url: cloudCheck.readProxy('da.json') },
        { id: 'google', url: cloudCheck.readProxy('google-oauth.json') },
        { id: 'report', url: REPORT_URL }
      ], { fetch: (u, o) => enet.fetch(u, o), key: CLOUD_KEY, keyHeader: CLOUD_KEY_HEADER, timeoutMs: 6000 });
      const s = cloudCheck.summary(list);
      return { ok: s.state === 'ok', reason: s.state === 'ok' ? '' : 'облачные функции не отвечают' };
    },
    lastfmRetry: async () => {
      if (!lastfm.configured()) return { ok: false, reason: 'нет ключа Last.fm' };
      const { net: enet } = require('electron');
      // A8: «починено» — только настоящий ответ API (2xx + JSON без error). 401/403
      // и прочие ошибки возвращают ok:false, и автопочинка честно пишет «не вышло».
      const r = await lastfm.check({ fetch: (u, o) => enet.fetch(u, o) });
      return { ok: !!r.ok, reason: r.ok ? '' : (r.reason || 'Last.fm не отвечает') };
    }
  };
  autofixR = autofixModule.create({
    isBusy: () => playerBusy,
    log: (m) => { try { log(m); } catch (e) {} },
    toast: (m) => uiToast(m),
    record: (svc, ok) => debugCountersModule.record(debugCounters, svc, ok),
    onChange: (services) => autofixSend(services),
    handlers: autofixHandlers
  });

  setTimeout(function(){ if (!perfOn()) logMemReport(); }, 60 * 1000);
  scheduleMemReport();
  if (perfOn()) perfStart();
  ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('build-info', () => BUILD);

  // Сети Яндекса для исключения из VPN-туннеля (настройки → «VPN и Яндекс»).
  // Живой список из RIPE с кэшем в userData; запасной — вшитый в src/vpn-nets.js
  const vpnNetsOut = (r) => ({ nets: r.nets, line: r.nets.join(', '), at: r.at, source: r.source, error: r.error || null });
  ipcMain.handle('vpn-nets', async () => vpnNetsOut(await require('./vpn-nets-live').load(app.getPath('userData'))));
  ipcMain.handle('vpn-nets-refresh', async () => vpnNetsOut(await require('./vpn-nets-live').refresh(app.getPath('userData'))));

  // Масштаб интерфейса: колесо/ползунок в шапке меняет zoomFactor окна
  ipcMain.handle('ui-zoom', (e, f) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    // из окна масштаба всегда управляем главным окном, а не самим окном масштаба
    const target = (zoomWin && w === zoomWin) ? mainWindow : (w || mainWindow);
    if (!target) return 1;
    return applyUiZoom(target, f);
  });
  ipcMain.handle('ui-zoom-get', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const target = (zoomWin && w === zoomWin) ? mainWindow : w;
    return target ? target.webContents.getZoomFactor() : 1;
  });
  ipcMain.handle('zoom-popup', (e, anchor) => { showZoomWindow(anchor); return true; });
  ipcMain.on('zoom-popup-close', () => { try { zoomHidden = true; if (zoomWin && !zoomWin.isDestroyed()) { zoomWin.destroy(); zoomWin = null; } } catch (e) {} });
  ipcMain.on('zoom-theme-sync', (e, theme) => {
    if (!theme) return;
    zoomTheme = theme;
    // Фон самого окна — цвет подвала текущей темы и оболочки: при дробном масштабе крайний пиксель
    // страницы не закрашивается, и раньше там просвечивал фон шапки (светлая полоска по периметру)
    try { const hx = cssColorHex(theme.winBg); if (hx && mainWindow && !mainWindow.isDestroyed()) { winBgCur = hx; mainWindow.setBackgroundColor(hx); } } catch (err) {}
    try {
      if (zoomWin && !zoomWin.isDestroyed()) {
        zoomWin.webContents.send('zoom-theme', theme);
        const key = zoomThemeKey(theme);
        // скрытое окно перезагружаем в новой теме — при открытии не будет вспышки
        if (zoomHidden && key !== zoomThemeKeyCur) {
          zoomThemeKeyCur = key;
          loadZoomPage(theme);
        }
      }
    } catch (e2) {}
  });
  ipcMain.handle('zoom-theme-get', () => zoomTheme);
  ipcMain.on('zoom-ready', () => { if (zoomPending) revealZoomWindow(); });

  const port = await srv.start(Number(cfg('widgetPort')) || 0);
  log('панель для OBS: http://127.0.0.1:' + port + '/widget');
  appUrl = 'http://127.0.0.1:' + port + '/index.html';

  // Поиск по YouTube (без ключа и входа)
  // YouTube в России часто открывается только через VPN — не ждём его дольше 8 секунд
  // TAPYOR_TEST_YT_DOWN=1 — проверочный режим: поиск в YouTube «висит» и отваливается по таймауту,
  // как при недоступном YouTube. Сеть и системные настройки не трогаются.
  const YT_TEST_DOWN = process.env.TAPYOR_TEST_YT_DOWN === '1';
  if (YT_TEST_DOWN) log('проверочный режим: YouTube «не отвечает» (TAPYOR_TEST_YT_DOWN=1)');
  const ytsT = (q, ms) => {
    const base = () => {
      const call = YT_TEST_DOWN ? new Promise(() => {}) : yts(q);
      // Проигравший поиск (yt-search) может отклониться уже после тайм-аута.
      // Без .catch это необработанная ошибка процесса — помечаем её обработанной,
      // сама гонка ниже по-прежнему видит отказ.
      call.catch(() => {});
      let timer;
      const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('YouTube не отвечает')), ms || 8000); });
      return Promise.race([call, late]).finally(() => clearTimeout(timer));
    };
    // Имитация сбоя YouTube: свои ошибки до вызова yt-search, задержка — до его тайм-аута.
    return faultSim.applyCall('yt', base, { url: 'https://www.youtube.com/', timeoutMs: ms || 8000 });
  };
  // ── Одно состояние «YouTube не отвечает» на всю программу ──────────────────
  // Узнаём о нём из поиска, воспроизведения, проверки при старте и разбора заказов; окно получает
  // 'yt-state' и показывает «⚠ Проблем», заказы в это время в YouTube не ходят. Через 10 минут — снова пробуем.
  const YT_DOWN_MS = 10 * 60 * 1000;
  let ytDownAt = 0, ytDownWhy = '';
  const ytIsDown = () => !!ytDownAt && Date.now() - ytDownAt < YT_DOWN_MS;
  const ytNetErr = (e) => /не отвечает|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network|fetch failed|timed out|socket hang up|unable to connect|Connection/i.test(String((e && e.message) || e || ''));
  function ytSendState() { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('yt-state', { down: ytIsDown(), why: ytDownWhy, at: ytDownAt }); } catch (e) {} }
  function ytMarkDown(why, from) {
    const was = ytIsDown();
    ytDownAt = Date.now(); ytDownWhy = String(why || 'не отвечает').slice(0, 120);
    if (!was) log('YouTube не отвечает (' + (from || '?') + ': ' + ytDownWhy + ') — 10 минут ищу без него, заказы тоже');
    ytSendState();
  }
  function ytMarkOk(from) { if (!ytDownAt) return; ytDownAt = 0; ytDownWhy = ''; log('YouTube снова доступен (' + (from || '?') + ')'); ytSendState(); }
  ipcMain.handle('yt-state', () => ({ down: ytIsDown(), why: ytDownWhy, at: ytDownAt }));
  ipcMain.handle('yt-mark', (e, down, why) => { if (down) ytMarkDown(why, 'окно'); else ytMarkOk('окно'); return true; });
  ipcMain.handle('yt-search', async (event, query) => {
    try {
      const r = await ytsT(query);
      const videos = (r.videos || []).slice(0, 20).map((v) => ({
        id: v.videoId,
        title: v.title,
        author: (v.author && v.author.name) || '',
        duration: (v.duration && v.duration.timestamp) || '',
        seconds: (v.duration && v.duration.seconds) || 0,
        thumb: v.thumbnail,
        live: !((v.duration && v.duration.seconds) > 0) || undefined
      }));
      const playlists = (r.playlists || r.lists || []).slice(0, 6).map((p) => ({
        src: 'yt', type: 'playlist', listId: p.listId, title: p.title || '',
        author: (p.author && p.author.name) || '', count: p.videoCount || 0, thumb: p.thumbnail || p.image || ''
      })).filter((p) => p.listId);
      logDebug('поиск YouTube: «' + String(query || '').slice(0, 120) + '» → видео ' + videos.length + ', плейлистов ' + playlists.length);
      return { videos, playlists };
    } catch (e) {
      return { error: (e && e.message) ? e.message : String(e) };
    }
  });
  ipcMain.handle('yt-playlist', async (e, listId, title) => {
    if (ytoauth.loggedIn()) {
      try { return await ytoauth.playlistTracks(listId, title); }
      catch (err) { log('YouTube API: плейлист — ' + err.message + ' (пробую yt-dlp)'); }
    }
    const r = await ytdlpModule.ytdlpPlaylist(listId);
    if (!r.error) return r;
    try { // запасной способ
      const p = await withTimeout(yts({ listId: listId }), 10000, 'плейлист YouTube (запасной)');
      const tracks = (p.videos || []).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail || ('https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg'), live: !((v.duration && v.duration.seconds) > 0) || undefined }));
      return { src: 'yt', type: 'playlist', listId, title: p.title || 'Плейлист YouTube', author: (p.author && p.author.name) || '', count: tracks.length, thumb: p.thumbnail || p.image || '', tracks };
    } catch (err) { log('плейлист YouTube (запасной): ' + err.message); return r; }
  });

  // Получить прямой поток видео/аудио по id ролика (для встроенного плеера)
  async function resolveStream(id) {
    const videoUrl = 'https://www.youtube.com/watch?v=' + id;
    // 1) основной способ — yt-dlp; поток отдаём через локальный IPv4/IPv6-прокси,
    // чтобы Chromium не выбирал мёртвый маршрут и не ждал media-таймаут.
    const viaDlp = await ytdlpModule.streamViaYtDlp(videoUrl);
    // Автопочинка (0.34.0, шаг 5): отказ yt-dlp подряд 2 раза — повод обновить движок
    // на паузе. Успех сбрасывает счётчик. Запасного потока внутри программы больше нет
    // (решение владельца 13.11): отказ yt-dlp — это отказ источника `yt`, окно уходит
    // во встроенный плеер YouTube.
    try {
      if (viaDlp && !viaDlp.error) autofixR.success('youtube', 'stream');
      else if (viaDlp && viaDlp.error) autofixR.note('youtube', 'stream', { reason: viaDlp.error });
    } catch (e) {}
    if (viaDlp && (viaDlp.url || viaDlp.audioUrl)) {
      try {
        const tp = Date.now();
        const proxied = await mediaProxy.wrap(viaDlp);
        if (proxied && !proxied.error) { log('media-proxy: готово, ' + (Date.now() - tp) + ' мс'); return proxied; }
        if (proxied && proxied.error) log('media-proxy: ' + proxied.error + ', ' + (Date.now() - tp) + ' мс');
      } catch (e) {
        log('media-proxy: исключение ' + (e && e.message));
      }
      return { error: 'media-proxy: поток не удалось подготовить' };
    }
    return { error: (viaDlp && viaDlp.error) ? viaDlp.error : 'не удалось получить поток' };
  }

  // Кэш ссылок (живут ~4 часа) + общий запрос, если тот же трек уже грузится
  const streamCache = new Map();
  const inflight = new Map();
  const CACHE_TTL = 4 * 60 * 60 * 1000;
  async function getStream(rawId) {
    const id = rawId;
    const key = id + '@' + cfg('videoQuality');
    const started = Date.now();
    log('поток: старт id=' + id + ' качество=' + cfg('videoQuality'));
    logDebug('поток: запрос id=' + id + ', качество ' + cfg('videoQuality'));
    const c = streamCache.get(key);
    if (c && Date.now() - c.at < CACHE_TTL) { log('кэш: ' + id); logDebug('поток: ответ из кэша id=' + id); return c.value; }
    if (inflight.has(key)) return inflight.get(key);
    const p = resolveStream(id);
    inflight.set(key, p);
    try {
      const r = await p;
      log('поток: готово id=' + id + ' за ' + (Date.now() - started) + ' мс' + (r && r.error ? ' · ' + r.error : ''));
      logDebug('поток: ответ id=' + id + ' — поля ' + Object.keys(r || {}).join(',') + (r && r.error ? ', ошибка' : ''));
      if (r && (r.url || r.audioUrl)) {
      streamCache.set(key, { at: Date.now(), value: r });
      while (streamCache.size > 500) streamCache.delete(streamCache.keys().next().value);
    }
      return r;
    } finally { inflight.delete(key); }
  }
  // Переключили трек — гасим прежнее получение потока, чтобы не копить процессы yt-dlp
  // и не блокировать обновление движка (аудит 20.11.2026).
  ipcMain.handle('yt-cancel', () => ytdlpModule.cancelStream());
  ipcMain.handle('yt-stream', (event, id) => {
    streamBusy.begin();
    return getStream(id).finally(() => { streamBusy.end(); });
  });
  const urlCache = new Map();
  ipcMain.handle('url-stream', async (e, url) => {
    streamBusy.begin();
    try {
      const c = urlCache.get(url); if (c && Date.now() - c.at < 30 * 60 * 1000) return c.value;
      const r = await ytdlpModule.urlStream(url);
      if (r && r.audioUrl) {
        urlCache.set(url, { at: Date.now(), value: r });
        while (urlCache.size > 500) urlCache.delete(urlCache.keys().next().value);
      }
      return r;
    } finally { streamBusy.end(); }
  });
  ipcMain.handle('sc-search', (e, q, n) => (cfg('scEnabled') === false ? [] : ytdlpModule.scSearch(q, n)));
  ipcMain.handle('au-search', (e, q, n) => (cfg('auEnabled') === false ? [] : auSearch(q, n)));
  ipcMain.handle('au-stream', (e, id) => ({ audioUrl: auStreamUrl(id) }));
  ipcMain.handle('url-list', async (e, url) => { const r = await ytdlpModule.urlList(url); return r.list || r; });
  ipcMain.handle('yt-search-more', (event, query, count) => ytdlpModule.ytdlpSearch(query, Math.min(Math.max(count || 40, 20), 300)));

  // Настройки (запоминаются между запусками)
  const readSettings = () => readSettingsFile();
  // Виджет OBS: адрес страницы и поток состояния из окна приложения
// Пипетка: каналы pick-color / pick-init — в src/main/pipette.js; регистрируются здесь, порядок прежний
pipette.registerIpc();
ipcMain.handle('widget-url', () => (srv.getPort() ? 'http://127.0.0.1:' + srv.getPort() + '/widget' : ''));
ipcMain.on('widget-state', (e, st) => {
  if (st && typeof st === 'object') {
    srv.setWidgetState(st);
    perfQueue(Array.isArray(st.orders) ? st.orders.length : 0);
    srv.widgetBroadcast();
  }
});

// «Видео для OBS» (VO1): адрес страницы, сколько её смотрит OBS, и состояние из окна.
// Пока счётчик 0 и превью в настройках закрыто, окно ничего не шлёт (энергосбережение).
ipcMain.handle('video-url', () => (srv.getPort() ? 'http://127.0.0.1:' + srv.getPort() + '/video' : ''));
ipcMain.handle('video-clients', () => srv.videoClients());
ipcMain.on('video-state', (e, st) => {
  if (st && typeof st === 'object') {
    srv.setVideoState(st);
    srv.videoBroadcast();
  }
});

// Ответ на «свернуть или закрыть»: tray — свернуть, remember — больше не спрашивать
  ipcMain.on('close-choice', (e, c) => {
    if (!c || !mainWindow || mainWindow.isDestroyed()) return;
    const tray = !!c.tray;
    if (c.remember) { const s = readSettings(); s.closeToTray = tray; s.closeAsked = true; writeSettingsFile(s); }
    if (tray) mainWindow.hide();
    else { app.isQuitting = true; app.quit(); }
  });
  ipcMain.handle('get-setting', (e, key) => {
  const k = String(key || '');
  // Список скрытых ключей — в src/localguard.js (B5-3), чтобы проверялся тестом.
  if (localGuard.uiSettingHidden(k)) {
    log('настройка «' + k + '» не отдаётся в интерфейс');
    return undefined;
  }
  // Очередь с позицией живёт в своём файле, а не в settings.json (R2).
  if (k === 'today') return readToday();
  const v = readSettings()[k];
  return v !== undefined ? v : DEFAULTS[k];
});
  ipcMain.handle('set-setting', (e, key, value) => {
    // только известные ключи — см. UI_SETTINGS в src/localguard.js (функц. аудит 01.11, F3)
    if (!localGuard.uiSettingOk(key)) { log('настройка «' + String(key).slice(0, 40) + '» из интерфейса отклонена'); return false; }
    // Очередь с позицией пишется в today.json маленьким файлом, без .bak и без записи
    // всех настроек с плейлистами (R2). Ключ из интерфейса тот же — 'today'.
    if (key === 'today') { ensureTodayStore().set(value); return true; }
    if (key === 'reqTiers' && !['default', 'money', 'equal'].includes(value)) return false; // ярусы заказов (docs/BOT.md)
    // Streamer.bot (0.35): кто принимает заказы из чата. Пока только настройка и сеттер;
    // переключение бота пака и экран — в Э4. Значение — белый список, мусор не сохраняем.
    if (key === 'chatOrders') { setChatOrders(value); return true; }
    if (key === 'sbotAccepting') { setSbotAccepting(!!value); return true; }
    const s = readSettings(); s[key] = value;
    writeSettingsFile(s);
    if (key === 'autoStart') applyAutoStart();
    if (key === 'streamerMode') { if (value === false) donations.stop(); else donations.start(); }
  if (key === 'widgetPort') { restartServer(Number(value) || 0).then(() => { try { if (sbotLink) sbotLink.refreshSettings(); } catch (e) {} }); return true; }
    if (key === 'theme' || key === 'themeBar') applyThemeWindow();
    if (key === 'mediaKeys' || key === 'hotkeys') return applyHotkeys();
    if (key === 'npEnabled' || key === 'nowPlayingFormat' || key === 'npIdle' || key === 'nowPlayingPath') writeNowPlaying(lastNpInfo, true);
    if (key === 'perfWatch') { if (perfOn()) perfStart(); else perfStop(); }
    return true;
  });
  // Кракозябры в своих плейлистах (0.34.0). Проверка — только чтение; исправление —
  // по кнопке, с копией настроек видом «кодировка» (src/debug-backup.js).
  ipcMain.handle('mojibake-check', () => {
    try {
      const s = mojibake.scan(readSettingsFile().savedLists);
      return { ok: true, broken: s.own, fixable: s.fixable, unfixable: s.unfixable, foreign: s.foreign, total: s.total };
    }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  ipcMain.handle('mojibake-fix', async () => {
    try {
      const before = readSettingsFile().savedLists;
      const s = mojibake.scan(before);
      // Чинить нечего (испорчено только чужое) — копию настроек не делаем.
      if (!s.own) return { ok: true, broken: 0, fixed: 0, failed: 0, skipped: s.foreign };
      let snap = null;
      try {
        settingsDisk.flush();
        // Автокопия должна включать today.json — иначе после «Вернуть» очередь не вернётся (R2).
        try { ensureTodayStore().flush(); } catch (e) {}
        snap = await debugBackup.snapshot('encoding');
      } catch (e) {
        log('кодировка: копия настроек не удалась — ' + ((e && e.message) || e));
        return { ok: false, error: 'не удалось сделать копию настроек: ' + ((e && e.message) || e) };
      }
      const r = mojibake.fixLists(before);
      if (r.fixed) { settingsDisk.set('savedLists', r.lists); settingsDisk.flush(); }
      log('исправлено ' + r.fixed + ' строк' + (r.failed ? ' (не вышло: ' + r.failed + ')' : '') + (r.skipped ? ' (чужих не трогали: ' + r.skipped + ')' : '') + ' — кодировка плейлистов' + (snap ? ', копия ' + snap.id : ''));
      return { ok: true, broken: s.own, fixed: r.fixed, failed: r.failed, skipped: r.skipped, snapshot: snap && snap.id };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  // Перезапуск локального сервера на другом порту (нужно только для смены адреса панели)
  restartServer = srv.restart;

function applyAutoStart() {
    try { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!cfg('autoStart'), args: ['--hidden'] }); }
    catch (err) { log('автозапуск: ' + err.message); }
  }
  applyAutoStart();
  ipcMain.handle('np-choose-folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Папка для now_playing.txt', properties: ['openDirectory', 'createDirectory'], defaultPath: path.dirname(npFilePath()) });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return null;
    const p = path.join(r.filePaths[0], 'now_playing.txt');
    const s = readSettings(); s.nowPlayingPath = p; writeSettings(s);
    writeNowPlaying(lastNpInfo, true);
    return p;
  });
  ipcMain.handle('np-open-folder', () => {
    try {
      const p = npFilePath();
      if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '', 'utf8'); }
      shell.showItemInFolder(p);
    } catch (err) { log('now_playing.txt: не открыть папку ' + err.message); }
    return true;
  });
  // Чистим только партиции сайтов вкладки «Браузер».
  // Партицию скрытого окна Яндекса (persist:yandex-login) и сессию по умолчанию (сам Тапёр и встроенный
  // плеер YouTube) не трогаем: очистка идёт в момент, когда музыка может играть.
  ipcMain.handle('browser-sw-clear', async () => {
    try { await session.fromPartition('persist:browser').clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }); } catch (e) { log('браузер: service worker не очистился (persist:browser) — ' + e.message); }
    return true;
  });
  // Закрываем только сайты вкладки «Браузер» — по ошибке сюда мог прийти id любого окна
  ipcMain.handle('webview-close', (e, id) => { try { const wc = webContents.fromId(Number(id)); if (wc && !wc.isDestroyed() && wc.getType() === 'webview') wc.close(); return true; } catch (err) { log('браузер: не закрыл webview ' + id + ' — ' + err.message); return false; } });
  ipcMain.handle('mem-report', () => { try { const r = memReport(); logMemReport(r); return r; } catch (e) { return { error: e.message }; } });
  ipcMain.handle('win-fullscreen', (e, on) => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      mainWindow.setFullScreen(!!on);
      return mainWindow.isFullScreen();
    } catch (err) { log('весь экран: окно не развернулось — ' + err.message); return false; }
  });
  ipcMain.handle('log-copy', () => { try { clipboard.writeText(logTail(20000)); return true; } catch (err) { return false; } });
  ipcMain.handle('log-open', () => { try { shell.openPath(logPath()); } catch (err) {} return true; });

  // --- Яндекс Музыка ---
  // Перенос без изменения поведения (A1): сам код — в src/main/yandex.js.
  // writeSettings остаётся здесь: им пользуется и код выше (np-choose-folder), и Яндекс.
  const writeSettings = (s) => writeSettingsFile(s);
  const ymModule = require('./main/yandex').setup({
    ipcMain, safeStorage, clipboard, shell, openExternal, cfg, settingsStore, log, logDebug,
    readSettings, writeSettings, yandexLogin, autofixR, ytsT, library, match, ym, streamBusy, ytSuggest
  });
  // Имена остаются прежними: ими пользуются заказы, мастер «Импорт», плейлисты площадок и
  // самопроверка. Обёртки — function-объявления: их зовут и выше по тексту (поднятие сохраняется).
  function getYmToken() { return ymModule.getYmToken(); }
  async function ymStatus() { return ymModule.ymStatus(); }
  async function ymUidGet() { return ymModule.ymUidGet(); }
  function dropSpeechCandidates(list) { return ymModule.dropSpeechCandidates(list); }
  function memSet(line, only, track) { return ymModule.memSet(line, only, track); }

  // --- Музыка с компьютера ---
  // Перенос без изменения поведения (A1): сам код — в src/main/library.js.
  // Настройка библиотеки и первый скан — на прежнем месте, каналы lib-* — ниже (registerIpc).
  const libModule = require('./main/library').setup({ app, ipcMain, dialog, shell, fs, path, log, cfg, library, pathGuard, getMainWindow: () => mainWindow });
  const { libSend } = libModule;

  // ===== Заказы со стрима: донаты → поиск песен в сообщении → вкладка «Заказы» =====
  // Чтение/запись — src/requests-store.js (R5): проверка «это список», .bak и .broken,
  // запись через временный файл с fsync. Здесь только путь и вызовы.
  const reqFile = () => path.join(app.getPath('userData'), 'requests.json');
  let requests = requestsStore.read(reqFile(), { log });
  const saveReq = () => {
    requests = requests.slice(-requestsStore.MAX);
    requestsStore.save(reqFile(), requests, { log });
  };

  // ===== Streamer.bot: порт /sb/* (0.35, Э1) — docs/PLAN-STREAMERBOT.md =====
  // Проверки и разбор — src/sbot-port.js (без Electron, покрыт unit-тестами).
  // Здесь: ключ, настройка «кто принимает», мост к поиску/очереди/окну, журнал и заглушка событий.
  const sbotJournal = sbotJournalModule.setup(app.getPath('userData'), { log });
  let sbotKey = sbotPortKey();
  let sbotQueueSnap = null;                 // последний снимок живой очереди из окна
  const sbotPlacedWait = new Map();         // key → finish(место/время) — как bot-placed у пака
  // Почтовый ящик событий переживает перезапуск: события за баллы удаляются только по /sb/ack.
  sbotMailbox = sbotMailboxModule.createMailbox({
    file: path.join(app.getPath('userData'), 'sbot-mailbox.json'),
    now: () => Date.now(),
    log,
    journal: sbotJournal,
  });
  try { sbotMailbox.sweep(Date.now()); } catch (e) { log('Streamer.bot: ящик не проверен — ' + (e && e.message || e)); }
  function sbotOrderTrack(rec) {
    const items = rec && Array.isArray(rec.items) ? rec.items : [];
    const it = items.find((x) => x && x.track) || null;
    return it ? it.track : null;
  }
  function sbotTrackLabel(rec) {
    const tr = sbotOrderTrack(rec);
    if (!tr) return '';
    const a = tr.author || tr.artist || '';
    return (a ? a + ' — ' : '') + (tr.title || '');
  }
  // Список номеров списаний для «Тапёр: сверка»: заказы за баллы, которые реально ждут/играют.
  // Список не построился — null: пульт пропустит сверку, а не отменит всё подряд (A35-3).
  function sbotPendingList() {
    return chatorders.pendingRedemptionsSafe(requests || [], sbotQueueSnap || { keys: null, playing: '', items: [] });
  }

  // Один раз при первом запуске 0.35: если бот пака сейчас принимает заказы — 'pack', иначе 'none'.
  // Сохраняем — дальше значение меняет только человек (в Э4 — экран).
  (function initChatOrders() {
    const cur = readSettingsFile().chatOrders;
    if (cur === 'none' || cur === 'pack' || cur === 'sbot') return;
    const botCfg = settingsStore.get('mod.bot') || {};
    const packOn = modhost.packInstalled() && botCfg.accepting !== false;
    const val = packOn ? 'pack' : 'none';
    const s = readSettingsFile(); s.chatOrders = val; writeSettingsFile(s);
    log('Streamer.bot: заказы из чата принимает ' + (packOn ? 'бот пака' : 'никто') + ' — выбрано один раз по умолчанию');
  })();

  // Уборка при запуске (0.35, Э2): заказы за баллы из прошлого запуска, которые так и не заиграли,
  // отдаются шаблону событием «заказ снят» с причиной «Тапёр был закрыт» — баллы возвращаются.
  (function sbotStartupCleanup() {
    try {
      // today — лента за сегодня из today.json (до R2 лежала в settings.json): если трек заказа уже в восстановленной
      // очереди (тот же день), заказ не снимаем — он сыграет и придёт played (A35-1).
      const drops = sbotLinkModule.startupDrops(requests || [], APP_STARTED_AT, readToday());
      if (!drops.length) return;
      const now = Date.now();
      for (const d of drops) {
        try { sbotMailbox.enqueue(d.action, d.args, sbotLinkModule.MAILBOX_TTL_MS); } catch (e) {}
        // Снятый заказ закрываем и в карточке «Заказов»: state dismissed, варианты skip.
        sbotLinkModule.markStartupDrop(d.rec, now);
        try { sbotJournal.append({ at: now, ev: 'cleanup', type: 'dropped', key: d.args.orderId, reason: 'closed', nick: d.args.user, track: d.args.track }); } catch (e) {}
      }
      saveReq();
      log('Streamer.bot: заказы за баллы из прошлого запуска — ' + drops.length + ' в ящик «снят» (Тапёр был закрыт)');
    } catch (e) { log('Streamer.bot: уборка при запуске — ' + (e && e.message || e)); }
  })();

  // События заказа sb-*: журнал (ники — только там) и пульт Streamer.bot (Э2).
  // played/dropped за баллы идут через почтовый ящик, за команды — одной попыткой (решение 5).
  function sbotEmit(type, key, extra) {
    const rec = (requests || []).find((x) => x && x.key === key) || null;
    const tr = sbotOrderTrack(rec);
    const label = sbotTrackLabel(rec);
    const evType = type === 'ban' ? 'dropped' : type;
    const reason = evType === 'dropped' ? (type === 'ban' ? 'ban' : String(extra || 'removed').slice(0, 40)) : '';
    try { log('Streamer.bot: событие «' + String(type).slice(0, 20) + '»' + (extra ? ' (' + String(extra).slice(0, 40) + ')' : '') + (label ? ' — заказ найден' : '')); } catch (e) {}
    try { sbotJournal.append({ at: Date.now(), ev: 'event', type: String(type), key, extra: extra == null ? '' : String(extra), nick: rec ? rec.name : '', track: label }); } catch (e) {}
    try { sbotEvents.emit(type, { key, extra, track: tr || null, nick: rec ? rec.name : '' }); } catch (e) {}
    // Отметки в requests.json: по ним уборка при запуске понимает, что заказ уже заиграл/закрыт.
    if (rec && evType === 'played' && !rec.playedAt) { rec.playedAt = Date.now(); saveReq(); }
    if (rec && evType === 'dropped' && !rec.droppedAt) { rec.droppedAt = Date.now(); rec.droppedReason = reason; saveReq(); }
    if (!sbotLink || (evType !== 'played' && evType !== 'dropped')) return;
    const isPts = /^sb-points:/.test(key);
    try {
      sbotLink.notify(evType, {
        orderId: key,
        user: rec ? (rec.name || '') : '',
        uid: rec && rec.uid != null ? String(rec.uid) : '',
        platform: rec ? (rec.platform || '') : '',
        kind: isPts ? 'points' : 'cmd',
        track: label,
        artist: tr ? (tr.author || tr.artist || '') : '',
        title: tr ? (tr.title || '') : '',
        reward: rec ? (rec.reward || '') : '',
        redemption: rec ? (rec.redemption || '') : '',
        reason,
      }, { durable: isPts });
    } catch (e) { log('Streamer.bot: событие не отправлено — ' + (e && e.message || e)); }
  }
  function sbotLate(ctx, result) {
    const st = String((result && result.status) || 'error').slice(0, 20);
    try { log('Streamer.bot: поздний ответ — ' + st); } catch (e) {} // без ника и текста
    try {
      sbotJournal.append({
        at: Date.now(), ev: 'late', status: st, key: (result && result.orderId) || (ctx && ctx.key) || '',
        nick: (ctx && ctx.user) || '', uid: (ctx && ctx.uid) || '', platform: (ctx && ctx.platform) || '',
        kind: (ctx && ctx.kind) || '', text: (ctx && ctx.text) || '',
        track: (result && result.track) || '', reason: (result && result.reason) || '',
      });
    } catch (e) {}
    try { sbotEvents.emit('late', { status: st, key: (result && result.orderId) || '', nick: (ctx && ctx.user) || '', track: (result && result.track) || '' }); } catch (e) {}
    // Поздний ответ зрителю: действие «Тапёр: ответ» с ящиком, но не дольше двух минут.
    if (sbotLink && ctx) {
      try {
        sbotLink.reply({
          reply: String((result && result.reply) || '').slice(0, 500),
          msgId: ctx.msg || '',
          user: ctx.user || '',
          platform: ctx.platform || '',
          kind: ctx.kind === 'points' ? 'points' : 'cmd',
          reward: ctx.reward || '',
          redemption: ctx.redemption || '',
          refund: !!(result && result.refund),
        });
      } catch (e) { log('Streamer.bot: поздний ответ не отправлен — ' + (e && e.message || e)); }
    }
  }
  // Управление плеером: шаблон проверяет права, Тапёр только выполняет (решение 14).
  function sbotControl(what, value) {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    let cmd = '';
    if (what === 'skip') cmd = 'next';
    else if (what === 'pause') cmd = 'pause';
    else if (what === 'play') cmd = 'play';
    else if (what === 'vol') {
      const n = Math.max(0, Math.min(100, Math.round(Number(value))));
      if (!isFinite(n)) return { ok: false };
      cmd = 'vol:' + n;
      try { mainWindow.webContents.send('widget-cmd', cmd); return { ok: true, volume: n }; } catch (e) { return { ok: false }; }
    }
    if (!cmd) return { ok: false };
    try { mainWindow.webContents.send('widget-cmd', cmd); return { ok: true }; } catch (e) { return { ok: false }; }
  }
  // Место заказа в очереди окно подтверждает, как bot-placed у пака. Ждём не дольше 3 с.
  function sbotCreated(rec, isPending, placed) {
    if (!sbotLink || !rec) return;
    try { sbotLink.noteOrder(); } catch (e) {}
    const label = sbotTrackLabel(rec);
    const base = {
      orderId: rec.key, user: rec.name || '', uid: rec.uid != null ? String(rec.uid) : '',
      kind: rec.prov === 'sb-points' ? 'points' : 'cmd', track: label,
    };
    try {
      if (isPending) sbotLink.trigger(sbotLinkModule.TRIGGERS.pending, base);
      else {
        const p = placed && placed.place;
        const eta = placed && placed.etaSec != null ? Math.max(1, Math.round(placed.etaSec / 60)) : '';
        sbotLink.trigger(sbotLinkModule.TRIGGERS.queued, Object.assign(base, { place: p || '', etaMin: eta }));
      }
    } catch (e) { log('Streamer.bot: событие о новом заказе — ' + (e && e.message || e)); }
  }
  function sbotAddOrder(rec, opts) {
    updSession.markOrder(); // R3: заказ пришёл — сессия стримера активна
    return new Promise((resolve) => {
      const isPending = !!(rec && rec.level === 'doubt');
      let done = false;
      const finish = (placed) => {
        if (done) return;
        done = true;
        if (sbotPlacedWait.get(rec.key) === finish) sbotPlacedWait.delete(rec.key);
        resolve(placed);
        sbotCreated(rec, isPending, placed);
      };
      if (opts && opts.wait) {
        sbotPlacedWait.set(rec.key, finish);
        setTimeout(() => {
          const f = sbotPlacedWait.get(rec.key);
          if (f) { sbotPlacedWait.delete(rec.key); f({ place: null, etaSec: null }); }
        }, 3000);
      }
      requests.push(rec); saveReq(); libSend('req-new', rec);
      if (!opts || !opts.wait) finish({ place: null, etaSec: null });
    });
  }
  ipcMain.on('sbot-placed', (e, key, place, etaSec) => {
    const f = sbotPlacedWait.get(String(key || ''));
    if (!f) return;
    sbotPlacedWait.delete(String(key || ''));
    const p = Number(place), t = Number(etaSec);
    f({ place: isFinite(p) && p > 0 ? Math.round(p) : null, etaSec: isFinite(t) && t >= 0 ? Math.round(t) : null });
  });
  // Снимок очереди из окна: проверяем типы и обрезаем — из окна приходит что угодно.
  ipcMain.on('sbot-queue', (e, snap) => {
    if (!snap || typeof snap !== 'object') return;
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    const num = (v) => (isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
    const items = Array.isArray(snap.items) ? snap.items.slice(0, 200).map((x) => ({
      key: str(x && x.key, 80), seconds: num(x && x.seconds), artist: str(x && x.artist, 200), title: str(x && x.title, 300),
    })) : [];
    const now = snap.now && typeof snap.now === 'object' ? {
      orderId: str(snap.now.orderId, 80), track: str(snap.now.track, 500),
      artist: str(snap.now.artist, 200), title: str(snap.now.title, 300),
      who: str(snap.now.who, 60), seconds: num(snap.now.seconds),
    } : null;
    const nextSnap = {
      keys: items.map((x) => x.key), playing: str(snap.playing, 80), items, now,
      curLeft: num(snap.curLeft),
      next: Array.isArray(snap.next) ? snap.next.slice(0, 5).map((x) => ({ artist: str(x && x.artist, 200), title: str(x && x.title, 300), seconds: num(x && x.seconds) })) : [],
    };
    const prevSnap = sbotQueueSnap;
    sbotQueueSnap = nextSnap;
    sbotQueueEvents(prevSnap, nextSnap);
  });
  // Триггеры для умельцев по живой очереди: начался любой трек и очередь заказов опустела.
  // Один и тот же трек не объявляем дважды подряд (окно присылает снимок и до, и после отрисовки).
  let sbotLastTrack = { sig: '', at: 0 };
  function sbotQueueEvents(prev, next) {
    if (!sbotLink || !next) return;
    const sig = (n) => (n ? [n.orderId || '', n.artist || '', n.title || ''].join('|') : '');
    const nowSig = sig(next.now);
    if (nowSig && nowSig !== sig(prev && prev.now)) {
      const t = Date.now();
      if (nowSig !== sbotLastTrack.sig || t - sbotLastTrack.at > 3000) {
        sbotLastTrack = { sig: nowSig, at: t };
        try { sbotLink.trigger(sbotLinkModule.TRIGGERS.track, { track: next.now.track, user: next.now.orderId ? (next.now.who || '') : '' }); }
        catch (e) {}
      }
    }
    const active = (s) => (s ? ((Array.isArray(s.keys) ? s.keys.length : 0) + (s.playing ? 1 : 0)) : 0);
    if (prev && active(prev) > 0 && active(next) === 0) {
      try { sbotLink.trigger(sbotLinkModule.TRIGGERS.empty, {}); } catch (e) {}
    }
  }
  // Уведомления окна о судьбе заказа sb-*: played / dropped / ban (мост A.sbotOrder).
  ipcMain.on('sbot-order', (e, type, key, extra) => {
    const t = String(type || '');
    if (['played', 'dropped', 'ban'].indexOf(t) < 0) return;
    const k = String(key || '');
    if (!/^sb-(cmd|points):[A-Za-z0-9]+$/.test(k)) return;
    sbotEmit(t, k, extra == null ? '' : String(extra).slice(0, 40));
  });
  sbotHandle = sbotPort.createPort({
    version: app.getVersion(),
    key: sbotKey,
    getKey: () => sbotKey,          // ключ можно сменить без пересоздания порта
    log,
    journal: sbotJournal,
    getChatOrders: () => cfg('chatOrders'),
    getAccepting: () => cfg('sbotAccepting') !== false,
    findOrder: (text, o) => processDonation({
      prov: 'sbot', id: 'sb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: 'Streamer.bot', text, amount: null, currency: '', at: Date.now(),
    }, o || {}),
    // Общие правила «Заказов» (как botCheckTrack), но без правил пака minTrackSec/minViews.
    checkTrack: (t) => botCheckTrack(t, { commonOnly: true }),
    addOrder: (rec, o) => sbotAddOrder(rec, o),
    removeOrder: (key) => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sbot-remove', key); }
      catch (e) { log('Streamer.bot: окно не ответило — ' + (e && e.message || e)); }
    },
    queueState: () => sbotQueueSnap || { keys: null, playing: '', items: [], now: null, curLeft: 0, next: [] },
    listOrders: () => requests,
    emitEvent: (type, key, extra) => sbotEmit(type, key, extra),
    onLateResult: (ctx, result) => sbotLate(ctx, result),
    control: (what, value) => sbotControl(what, value),
    setAccepting: (on) => setSbotAccepting(on),
    onAck: (id) => (sbotLink ? sbotLink.ack(id) : false),
  });
  // Окно — только своё: ключ порта и статус не отдаём чужим страницам даже на нашем сервере.
  function sbotOwnSender(e) {
    try {
      const u = (e && e.senderFrame && e.senderFrame.url) || (e && e.sender && e.sender.getURL && e.sender.getURL()) || '';
      return localGuard.isOwnPage(u);
    } catch (err) { return false; }
  }

  // ===== Пульт к Streamer.bot (0.35, Э2) =====
  // Вход, состояние шаблона, события заказов и почтовый ящик — в src/sbot-link.js (без Electron).
  // Здесь только: настройки, расшифровка пароля, адрес и ключ порта, окно и IPC.
  sbotLink = sbotLinkModule.createLink({
    log,
    journal: sbotJournal,
    mailbox: sbotMailbox,
    getConfig: () => ({
      enabled: cfg('sbotEnabled') === true,
      host: cfg('sbotHost'),
      port: cfg('sbotPort'),
      endpoint: cfg('sbotEndpoint'),
    }),
    getPassword: () => sbotPasswordGet(),
    // Для глобальной переменной tapyorOn: 1 — заказы из чата принимает Streamer.bot.
    getOrderMode: () => (readSettingsFile().chatOrders || 'none') === 'sbot',
    tapyorUrl: () => srv.originUrl(),
    tapyorKey: () => sbotKey,
    pendingList: () => sbotPendingList(),
    onGlobals: (g) => { sbotGlobals = g && typeof g === 'object' ? g : {}; },
    onState: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // Полное состояние, а не только пульт: иначе любое событие (заказ, переподключение)
      // стирало в окне globals, порт Тапёра, версию шаблона и «что записали» (A35-7).
      try { mainWindow.webContents.send('sbot-state', sbotStatusNow()); } catch (e) {}
    },
  });
  sbotLink.setOrderMode((readSettingsFile().chatOrders || 'none') === 'sbot');
  try {
    if (cfg('sbotEnabled') === true) {
      log('Streamer.bot: пульт включён — подключаюсь к ' + cfg('sbotHost') + ':' + cfg('sbotPort'));
      sbotLink.start();
    }
  } catch (e) { log('Streamer.bot: пульт не запущен — ' + (e && e.message || e)); }

  // Полное состояние для окна: пульт + настройки + ключ/порт Тапёра (без значений секретов).
  function sbotStatusNow() {
    const ls = sbotLink ? sbotLink.getState() : { status: 'off', text: sbotLinkModule.TEXTS.off, host: cfg('sbotHost'), port: cfg('sbotPort'), endpoint: cfg('sbotEndpoint') };
    const s = readSettingsFile();
    const out = Object.assign({}, ls, {
      chatOrders: s.chatOrders || 'none',
      accepting: s.sbotAccepting !== false,
      keyLength: sbotKey.length,
      hasPassword: !!sbotPasswordGet(),
      tapyorPort: srv.getPort(),      // порт Тапёра (/sb/*), не путать с портом Streamer.bot
      sbotPort: ls.port,           // порт WebSocket-сервера Streamer.bot
      version: app.getVersion(),
      templateCurrent: sbotPort.TEMPLATE_CURRENT,
      templateMin: sbotPort.TEMPLATE_MIN,
      globals: Object.assign({}, sbotGlobals),
      mailbox: sbotMailbox ? sbotMailbox.count() : 0,
      // Что конструктор записал последним: окно сравнивает с ним и показывает полосу
      // «в Streamer.bot изменили вручную». Пишет только главный процесс.
      written: s.sbotWritten && typeof s.sbotWritten === 'object' ? Object.assign({}, s.sbotWritten) : null,
    });
    // Порт Streamer.bot теперь называется sbotPort; старое имя port убираем, чтобы не было двух.
    delete out.port;
    return out;
  }
  // Полное состояние — окну по любому поводу (переключили приём, ответили на /sb/accept).
  sbotStatePush = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try { mainWindow.webContents.send('sbot-state', sbotStatusNow()); } catch (e) {}
  };
  ipcMain.handle('sbot-port-key', (e) => (sbotOwnSender(e) ? sbotKey : ''));
  ipcMain.handle('sbot-port-key-reset', (e) => {
    if (!sbotOwnSender(e)) return { ok: false };
    sbotKey = sbotPortKeyNew();
    try { if (sbotLink) sbotLink.refreshSettings(); } catch (e2) {}
    return { ok: true, keyLength: sbotKey.length };
  });
  ipcMain.handle('sbot-status', (e) => (sbotOwnSender(e) ? sbotStatusNow() : null));
  ipcMain.handle('sbot-globals', (e) => (sbotOwnSender(e) ? Object.assign({}, sbotGlobals) : null));
  ipcMain.handle('sbot-connect', (e) => {
    if (!sbotOwnSender(e)) return { ok: false };
    const s = readSettingsFile(); s.sbotEnabled = true; writeSettingsFile(s);
    try { if (sbotLink) sbotLink.start(); } catch (e2) { log('Streamer.bot: подключение — ' + (e2 && e2.message || e2)); }
    return { ok: true, status: sbotStatusNow() };
  });
  ipcMain.handle('sbot-disconnect', (e) => {
    if (!sbotOwnSender(e)) return { ok: false };
    const s = readSettingsFile(); s.sbotEnabled = false; writeSettingsFile(s);
    try { if (sbotLink) sbotLink.stop(); } catch (e2) {}
    return { ok: true, status: sbotStatusNow() };
  });
  // Адрес, порт, путь и пароль пульта. Пароль только записывается и никогда не отдаётся обратно.
  ipcMain.handle('sbot-set-conn', (e, o) => {
    if (!sbotOwnSender(e)) return { ok: false, error: 'чужая страница' };
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'неверные настройки' };
    const s = readSettingsFile();
    const prev = { host: s.sbotHost, port: s.sbotPort, endpoint: s.sbotEndpoint, password: sbotPasswordGet() };
    let changed = false;
    if (o.host !== undefined) {
      const host = String(o.host == null ? '' : o.host).trim().toLowerCase();
      if (['127.0.0.1', 'localhost', '::1'].indexOf(host) < 0) return { ok: false, error: 'Подключаться можно только к своему компьютеру: 127.0.0.1, localhost или ::1' };
      if (host !== prev.host) changed = true;
      s.sbotHost = host;
    }
    if (o.port !== undefined && o.port !== null) {
      const port = Number(o.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Порт — целое число от 1 до 65535' };
      if (port !== Number(prev.port)) changed = true;
      s.sbotPort = port;
    }
    if (o.endpoint !== undefined) {
      const endpoint = String(o.endpoint == null ? '' : o.endpoint).trim();
      if (!/^\/[A-Za-z0-9/_.-]{0,99}$/.test(endpoint)) return { ok: false, error: 'Путь — до 100 символов: латиница, цифры, / _ . - и обязательно с «/»' };
      if (endpoint !== prev.endpoint) changed = true;
      s.sbotEndpoint = endpoint;
    }
    if (o.password !== undefined && typeof o.password !== 'string') return { ok: false, error: 'Пароль — строка' };
    if (typeof o.password === 'string' && o.password.length > 200) return { ok: false, error: 'Пароль — не длиннее 200 символов' };
    if (typeof o.password === 'string' && o.password !== '' && o.password !== prev.password) changed = true;
    writeSettingsFile(s);
    if (typeof o.password === 'string' && o.password !== '') sbotPasswordSet(o.password);
    if (changed && sbotLink) {
      try { sbotLink.applyConfig(); } catch (e2) {}
    }
    return {
      ok: true,
      host: s.sbotHost || cfg('sbotHost'), port: s.sbotPort || cfg('sbotPort'),
      endpoint: s.sbotEndpoint || cfg('sbotEndpoint'), hasPassword: !!sbotPasswordGet(), changed,
    };
  });
  // Настройки конструктора → «Тапёр: настройка». Только переменные конструктора (+ tapyorOn):
  // служебные (сверка, номер награды, последний заказ, адрес, ключ) окно записать не может (A35-11).
  ipcMain.handle('sbot-write-settings', async (e, o) => {
    if (!sbotOwnSender(e)) return { ok: false, message: 'чужая страница' };
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, message: 'неверные настройки' };
    const keys = Object.keys(o);
    if (keys.length > 100) return { ok: false, message: 'слишком много настроек' };
    const allowed = sbotSettings.CONSTRUCTOR_VARS.concat(['tapyorOn']);
    const clean = {};
    for (const k of keys) {
      if (allowed.indexOf(k) < 0) return { ok: false, message: 'можно записывать только переменные конструктора' };
      const v = o[k];
      if (typeof v === 'number') { if (!isFinite(v)) return { ok: false, message: 'число не подходит: ' + k }; clean[k] = v; }
      else if (typeof v === 'string') { if (v.length > 500) return { ok: false, message: 'слишком длинное значение: ' + k }; clean[k] = v; }
      else return { ok: false, message: 'значение должно быть строкой или числом: ' + k };
    }
    if (!sbotLink) return { ok: false, message: 'пульт не создан' };
    const res = await sbotLink.writeSettings(clean);
    // Запомнили, что именно записали: по этому снимку окно увидит ручные правки в Streamer.bot.
    if (res && res.ok) {
      // Выключили «Заказ за баллы» — ставим награду на паузу; включили при открытом приёме — снимаем (A35-9).
      if (Object.prototype.hasOwnProperty.call(clean, 'tapyorPoints')) {
        const act = sbotSettings.pointsPauseAction(sbotGlobals.tapyorPoints, clean.tapyorPoints, cfg('sbotAccepting') !== false);
        if (act === 'close') { try { sbotLink.accept(false); } catch (e) {} }
        else if (act === 'open') { try { sbotLink.accept(true); } catch (e) {} }
      }
      const st = readSettingsFile();
      st.sbotWritten = Object.assign({}, clean);
      writeSettingsFile(st);
      // Streamer.bot записал переменные действием. Оно выполняется не мгновенно: читаем
      // несколько раз, пока в Streamer.bot не окажется то, что мы записали. Иначе окно увидит
      // старые значения и покажет «изменено в Streamer.bot» сразу после своей же записи.
      try {
        for (let i = 0; i < 6; i++) {
          await sbotLink.refreshGlobals();
          if (sbotSettings.valuesMatch(sbotGlobals, clean)) break;
          if (i < 5) await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e3) {}
    }
    return res;
  });
  ipcMain.handle('sbot-test', async (e) => {
    if (!sbotOwnSender(e)) return { ok: false, message: 'чужая страница' };
    if (!sbotLink) return { ok: false, message: 'пульт не создан' };
    try { return await sbotLink.testConnection(); }
    catch (e2) { return { ok: false, message: 'проверка не удалась: ' + (e2 && e2.message || e2) }; }
  });
  // «Найти награду» (0.35, Э4): DoAction «Тапёр: найти награду», затем номер из глобальных.
  ipcMain.handle('sbot-find-reward', async (e) => {
    if (!sbotOwnSender(e)) return { ok: false, message: 'чужая страница' };
    if (!sbotLink) return { ok: false, message: 'пульт не создан' };
    try { return await sbotLink.findReward(); }
    catch (e2) { return { ok: false, message: 'награда не найдена: ' + (e2 && e2.message || e2) }; }
  });
  // «Нажать» на вкладке «Для умельцев»: только известные триггеры Тапёра.
  ipcMain.handle('sbot-trigger', async (e, name) => {
    if (!sbotOwnSender(e)) return { ok: false, message: 'чужая страница' };
    if (!sbotLink) return { ok: false, message: 'пульт не создан' };
    const id = String(name == null ? '' : name).slice(0, 80);
    if (Object.values(sbotLinkModule.TRIGGERS).indexOf(id) < 0) return { ok: false, message: 'неизвестный триггер' };
    try { return await sbotLink.testTrigger(id); }
    catch (e2) { return { ok: false, message: 'триггер не отправлен: ' + (e2 && e2.message || e2) }; }
  });
  // Строка импорта шаблона в буфер обмена. Файла нет (Э3 ещё не выложил) — честный отказ,
  // без падения: кнопка покажет «шаблон появится в следующей сборке».
  ipcMain.handle('sbot-copy-template', (e) => {
    if (!sbotOwnSender(e)) return { ok: false, message: 'чужая страница' };
    const file = sbotTemplateFile();
    if (!file) return { ok: false, missing: true, message: 'шаблон появится в следующей сборке' };
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      if (!text.trim()) return { ok: false, missing: true, message: 'шаблон появится в следующей сборке' };
      clipboard.writeText(text);
      log('Streamer.bot: строка шаблона скопирована (длина ' + text.length + ')');
      return { ok: true, length: text.length };
    } catch (e2) {
      return { ok: false, missing: true, message: 'шаблон появится в следующей сборке' };
    }
  });
  function reqRules() { const r = cfg('reqRules') || {}; return { maxSec: r.maxSec == null ? 420 : Number(r.maxSec) || 0, stopWords: Array.isArray(r.stopWords) ? r.stopWords : reqp.DEFAULT_STOP, explicitOk: r.explicitOk !== false, repeatOk: r.repeatOk !== false, versionOk: r.versionOk !== false, lookupOk: r.lookupOk !== false }; }
  // Где искать заказы: площадка включена в «Площадках» И не снята в «Настройки → Заказы → Где искать».
  // По умолчанию — везде. Ссылки из сообщения открываются всегда.
  function reqSrc() {
    const s = (cfg('reqRules') || {}).src || {};
    return {
      ym: cfg('ymEnabled') !== false && s.ym !== false,
      lc: cfg('preferLocal') !== false && s.lc !== false,
      sc: cfg('scEnabled') !== false && s.sc !== false,
      au: cfg('auEnabled') !== false && s.au !== false,
      yt: cfg('ytEnabled') !== false && s.yt !== false,
    };
  }
  async function reqSearch(q) {
    const out = [], src = reqSrc();
    if (src.lc) { try { out.push.apply(out, library.search(q, 4)); } catch (e) {} }
    if (src.ym) {
      try { out.push.apply(out, (await ym.searchTracksPage(q, 0, getYmToken())).slice(0, 6)); } catch (e) { log('заказ: поиск в Яндексе — ' + e.message); }
    }
    return dropSpeechCandidates(out);
  }
  // ctx — состояние одного заказа: YouTube не ответил один раз — остальные запросы этого заказа туда не шлём
  async function reqSearchYt(q, ctx) {
    if (!reqSrc().yt) return [];
    if (ytIsDown() || (ctx && ctx.ytDown)) { if (ctx) ctx.ytDown = true; return []; }
    try { const y = await ytsT(q, 8000); if (ctx) ctx.ytUsed = true; return (y.videos || []).slice(0, 5).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail, live: !((v.duration && v.duration.seconds) > 0) || undefined })); }
    catch (e) {
      if (ytNetErr(e)) { if (ctx) ctx.ytDown = true; ytMarkDown(e.message, 'заказ'); }
      return [];
    }
  }
  // Нормализация для сравнения слов в заказах: нижний регистр, ё→е, без знаков
  const rqNorm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // o.noYt — не искать текстом на YouTube (событие заказов чат-бота: только официальные каталоги; ссылки — всегда)
  // o.fromCommand — это заказ командой в чате (!play): сама команда уже доказывает, что человек просит песню,
  // поэтому «слабый сигнал без названия» не понижает точно найденный трек до «сомнения».
  async function processDonation(d, o = {}) {
    const CAPTURE = process.env.TAPYOR_ORDER_CAPTURE === '1';
    // Текст заказа из Streamer.bot в подробный журнал не пишем — только факт разбора (A35-8).
    logDebug('заказ: разбираю ' + (d && d.prov === 'sbot' ? '(текст из Streamer.bot скрыт)' : '«' + String(d && d.text || '').slice(0, 200) + '»'));
    const p = reqp.plan(d.text);
    const trace = orderReport.begin(d);
    let analysis = null;
    const getAnalysis = () => { if (!analysis) analysis = analyzeOrder(d.text); return analysis; };
    trace.capture = CAPTURE;
    trace.plan = { signal: p.signal, text: p.text, links: p.links, queries: (p.queries || []).map((q) => ({ query: q.query, kind: q.kind, chunk: q.chunk })) };
    try { const a = getAnalysis(); trace.analyzer = { intent: a.intent, confidence: a.confidence, hypotheses: (a.hypotheses || []).slice(0, 6) }; } catch (e) { trace.analyzer = { error: e.message }; }
    orderReport.step(trace, 'plan', { signal: p.signal, queries: (p.queries || []).length, links: p.links.length });
    const items = [];
    const ytCtx = { ytDown: !!o.noYt, ytUsed: false };
    const srcOn = reqSrc();
    for (const u of p.links.slice(0, 3)) {
      let r = null; try { r = await withTimeout(resolveLinkFn(u), 12000, 'link'); } catch (e) { log('заказы: ссылка — ' + e.message); }
      const tr = r && r.tracks && r.tracks[0];
      trace.links.push({ url: u, ok: !!tr, track: tr ? { src: tr.src, id: tr.id, title: tr.title, author: tr.author } : null });
      if (tr) items.push({ level: 'exact', track: tr, alts: [], link: u });
      else items.push({ level: 'doubt', track: null, alts: [], link: u, note: /t\.me\//i.test(u) ? 'ссылка на Telegram — открой и найди песню сам' : 'ссылку не удалось открыть' });
    }
    const groups = {};
    p.queries.forEach((q) => { const g = q.kind === 'dash' ? 'c' + q.chunk : q.kind; (groups[g] = groups[g] || []).push(q); });
    // Два прохода: сначала только Яндекс/локальные, потом YouTube.
    // Так Яндекс Музыка всегда имеет приоритет перед YouTube.
    const groupKeys = Object.keys(groups).slice(0, 3);
    const states = [];
    const wantsYouTube = /(?:ютуб|youtube|youtu\.be|с ютуба|на ютубе)/iu.test(d.text);
    const msgWords = rqNorm(d.text).split(' ').filter(Boolean);
    const frac = (a, b) => { if (!a.length) return 0; return a.filter((w) => b.includes(w)).length / a.length; };
    const maxSec = reqRules().maxSec || 0;
    const consider = (st, list, query) => {
      for (const t of (list || [])) {
        try {
          const k = (t.src || '') + ':' + t.id; if (st.seenK.has(k)) continue; st.seenK.add(k);
          const j = reqp.judge(d.text, t, query);
          const allowVersions = reqRules().versionOk !== false;
          const versionBad = !allowVersions && matchScore.isVersion(t.title);
          const ms = matchScore.scoreCandidate({ message: d.text, query, track: t, wantsYouTube, allowVersions });
          let score = ms.score;
          if (versionBad) score = 0;
          const info = select.inspect(t, d.text, { maxSec, enabled: srcOn });
          const accepted = j.level === 'exact' && !versionBad && (!st.combo || info.tier >= 3);
          const viableNow = j.level === 'exact' && (!st.combo || info.tier >= 3);
          const strongNow = viableNow;
          st.gt.candidates.push({ query, src: t.src || '', id: t.id || '', title: t.title || '', author: t.author || '', seconds: t.seconds || 0, level: j.level, t: j.t, a: j.a, score, scoreParts: ms.parts, tier: info.tier, accepted, strong: strongNow, rejected: versionBad ? 'version' : '' });
          if (versionBad) continue;
          const better = !st.best || select.better(
            { candidate: t, score, good: viableNow },
            { candidate: st.best.t, score: st.best.score, good: st.best.strong },
            d.text, { maxSec, enabled: srcOn }
          );
          if ((j.level === 'exact' || j.level === 'doubt') && better) st.best = { t, j, score, query, strong: strongNow, tier: info.tier };
          if (j.level === 'doubt' && !st.latin && !st.combo) st.doubts.push({ t, s: score });
        } catch (e) { log('заказы: кандидат — ' + e.message); }
      }
    };
    for (const g of groupKeys) {
      const qs = groups[g];
      const st = { g, qs, latin: qs[0].kind === 'latin', combo: qs[0].kind === 'combo', best: null, doubts: [], seenK: new Set(), qWords: [], gt: { group: g, queries: qs.map((q) => q.query), candidates: [] } };
      st.covered = (t) => { const words = rqNorm((t.author || '') + ' ' + (t.title || '')).split(' ').filter(Boolean); return st.qWords.length > 0 && st.qWords.every((w) => words.indexOf(w) >= 0); };
      trace.groups.push(st.gt);
      states.push(st);
      for (const q of qs.slice(0, st.combo ? 3 : 8)) {
        st.qWords = rqNorm(q.query).split(' ').filter(Boolean);
        consider(st, await reqSearch(q.query), q.query);
      }
    }
    // Есть ли уже сильный exact в Яндексе/локальных? Тогда YouTube и SoundCloud не нужны.
    const hasStrong = states.some((st) => st.best && select.inspect(st.best.t, d.text, { maxSec, enabled: srcOn }).tier >= 4);
    // Последний запасной уровень: SoundCloud/Audius, если включены в настройках.
    // Они не заменяют Яндекс/YouTube, а спасают редкие треки, которых там нет.
    if ((CAPTURE || !hasStrong) && (CAPTURE || !states.some((st) => st.best))) {
      try {
        const h = (getAnalysis().hypotheses || []).find((x) => x.title);
        const q = h ? [h.artist, h.title].filter(Boolean).join(' ').trim() : ((p.queries[0] && p.queries[0].query) || '');
        if (q) {
          for (const [kind, fn, enabled] of [['sc', ytdlpModule.scSearch, srcOn.sc], ['au', auSearch, srcOn.au]]) {
            if (!enabled) continue;
            let list = null;
            trace.steps.push({ name: 'extra-source', source: kind, query: q });
            try { list = await withTimeout(fn(q, 5), 12000, kind + '-search'); } catch (e) { log('заказы: ' + kind + ' — ' + e.message); continue; }
            if (!Array.isArray(list)) continue;
            for (const t of list) {
              try {
                const j = reqp.judge(d.text, t, q);
                if (j.level === 'exact') { items.push({ level: 'exact', track: t, alts: [], query: q, via: kind }); break; }
              } catch (e) { log('заказы: ' + kind + '-кандидат — ' + e.message); }
            }
            if (items.some((it) => it.level === 'exact')) break;
          }
        }
      } catch (e) { log('заказы: запасные источники — ' + e.message); }
    }
    // YouTube — только если ни одна группа не дала сильного точного результата в Яндексе/локально.
    if ((CAPTURE || !hasStrong) && srcOn.yt) {
      for (const st of states) {
        for (const q of st.qs.slice(0, st.combo ? 3 : 8)) {
          if (ytCtx.ytDown) break;
          st.qWords = rqNorm(q.query).split(' ').filter(Boolean);
          consider(st, await reqSearchYt(q.query, ytCtx), q.query);
          }
      }
    }
    for (const st of states) {
      st.doubts.sort((a, b) => b.s - a.s);
      // Если consider не выбрал ничего, добираем лучший кандидат селектором.
      // Уже выбранный кандидат не перетираем: иначе случайный дубль с +0.01
      // снова ломает выдачу.
      if (!st.best) {
        const chosen = select.choose(st.gt.candidates, d.text, { maxSec, enabled: srcOn });
        if (chosen) {
          const q = (chosen.candidate && chosen.candidate.query) || st.qs[0].query;
          const j = reqp.judge(d.text, chosen.track, q);
          st.best = { t: chosen.track, j, score: chosen.score || 0, query: q, strong: chosen.info.tier >= 3 };
        }
      }
      if (st.best) {
        const b = st.best;
        st.gt.margin = matchScore.margin(st.gt.candidates.filter((c) => !c.rejected));
        const bi = select.inspect(b.t, d.text, { maxSec, enabled: srcOn });
        const strong = b.j.level === 'exact' && (!st.combo || bi.tier >= 3);
        items.push({ level: strong ? 'exact' : 'doubt', track: b.t, score: b.score, alts: st.doubts.slice(0, 3).map((x) => x.t), query: b.query || st.qs[0].query, note: strong ? '' : 'похоже на заказ, но совпадение слабое', margin: st.gt.margin });
      }
      else if (st.combo) items.push({ level: 'doubt', track: null, alts: [], query: st.qs[0].query, note: 'похоже на заказ, но трек не найден' });
      else if (st.doubts.length) items.push({ level: 'doubt', track: st.doubts[0].t, alts: st.doubts.slice(1, 3).map((x) => x.t), query: st.qs[0].query });
      else if (!st.latin && p.signal !== 'latin') items.push({ level: 'doubt', track: null, alts: [], query: st.qs[0].query, note: 'похоже на заказ, но песня не нашлась' });
    }
    // Если точный трек уже найден, не тащим в очередь шумные doubt-группы
    // и не дублируем один и тот же трек из Яндекса/YouTube.
    if (items.some((it) => it.level === 'exact')) {
      const exacts = [];
      const seenExact = new Set();
      for (const it of items) {
        if (it.level !== 'exact') continue;
        const key = rqNorm(((it.track && it.track.author) || '') + '|' + ((it.track && it.track.title) || ''));
        if (seenExact.has(key)) continue;
        seenExact.add(key); exacts.push(it);
      }
      items.length = 0;
      items.push(...exacts);
    }
    // Канонический слой: не только когда exact не найден, но и когда в запросе
    // нет исполнителя — иначе кавер с точным названием обходит оригинал.
    // Внешние справочники необязательны: короткий таймаут, при ошибке идём дальше.
    try {
      const a = getAnalysis();
      const hs = a.hypotheses || [];
      const titleHyp = hs.find((x) => x.title && !String(x.artist || '').trim());
      const h = hs.find((x) => x.title && (x.artist || x.title.split(' ').length >= 2));
      const titleOnly = !!(h && !String(h.artist || '').trim());
      const shortNoArtist = !p.links.length && p.signal !== 'dash' && String(p.query || d.text || '').trim().split(/\s+/).filter(Boolean).length <= 4;
      const hasExact = items.some((it) => it.level === 'exact');
      // Внешние справочники (Deezer/iTunes/Last.fm/MusicBrainz) — только если стример их не выключил.
      const lookupOk = reqRules().lookupOk !== false;
      if (!lookupOk) trace.lookup = { off: true };
      if (lookupOk && (h || shortNoArtist) && (CAPTURE || !hasExact || titleOnly || shortNoArtist)) {
        const lookupTitle = shortNoArtist ? String((titleHyp && titleHyp.title) || p.query || d.text || '').trim() : (h.title || '');
        const lookupArtist = shortNoArtist ? '' : (h.artist || '');
        trace.lookup = { artist: lookupArtist, title: lookupTitle, score: 0, cand: null, queries: [], hit: null, titleOnly, shortNoArtist };
        const found = await onlineLookup.findCanonical(lookupArtist, lookupTitle, d.text, { timeoutMs: 1200 });
        trace.lookup.score = found && found.s || 0;
        trace.lookup.cand = found && found.cand || null;
        const candSim = found && found.cand ? matchScore.stringSim(String(found.cand.title || '').toLowerCase(), String(d.text || '').toLowerCase()) : 0;
        const qWords = match.tokens(String(d.text || '').replace(/^!play\s+/i, ''));
        const cWords = match.tokens(String((found && found.cand && found.cand.title) || ''));
        const queryCover = qWords.length ? qWords.filter((q) => cWords.some((t) => reqp.tokEq(q, t))).length / qWords.length : 0;
        if (found && found.cand && found.s >= 0.8 && (candSim >= 0.72 || queryCover >= 0.99)) {
          const ca = String(found.cand.artist || '').trim();
          const ct = String(found.cand.title || '').trim();
          const cqs = Array.from(new Set([
            (ca + ' ' + ct).trim(),
            (ct + ' ' + ca).trim(),
            ct,
          ].filter(Boolean)));
          let lookupTrack = null, lookupQuery = '';
          const exacts = [];
          for (const cq of cqs.slice(0, 3)) {
            trace.lookup.queries.push(cq);
            const lists = [];
            if (srcOn.ym || srcOn.lc) lists.push(await reqSearch(cq));
            if (srcOn.yt) lists.push(await reqSearchYt(cq, ytCtx));
            for (const list of lists) {
              for (const t of (list || [])) {
                const j = reqp.judge(d.text, t, cq);
                if (j.level !== 'exact') continue;
                const caWords = String(found.cand.artist || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
                const auWords = String(t.author || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
                if (caWords.length && !caWords.some((x) => auWords.some((y) => reqp.tokEq(x, y)))) continue;
                exacts.push({ ...t, query: cq, score: 0 });
              }
            }
            if (exacts.length) break;
          }
          if (exacts.length) {
            const ranked = select.rank(exacts, d.text, { maxSec, enabled: srcOn });
            if (ranked[0]) {
              lookupTrack = ranked[0].track;
              lookupQuery = (ranked[0].candidate && ranked[0].candidate.query) || '';
            }
          }
          trace.lookup.hit = lookupTrack ? { title: lookupTrack.title, author: lookupTrack.author, query: lookupQuery } : null;
          if (lookupTrack) {
            // Платный заказ (донат, баллы канала) с неуверенным каноном — решает стример.
            // Уверенный канон: справочник уверен (s >= 0.9) и все слова запроса есть в названии.
            // Бесплатный !play из чата ставится сразу, как раньше.
            const sure = found.s >= 0.9 && queryCover >= 0.99;
            const paidOrder = sbotLinkModule.isPaidOrder(d.prov, !!o.paid);
            const unsure = paidOrder && !sure;
            const prevAlts = items.map((it) => it.track).filter((t) => t && t.id !== lookupTrack.id).slice(0, 4);
            const lookupItem = unsure
              ? { level: 'doubt', track: lookupTrack, alts: prevAlts, query: lookupQuery, via: 'lookup', note: 'оригинал по справочнику — проверь' }
              : { level: 'exact', track: lookupTrack, alts: [], query: lookupQuery, via: 'lookup' };
            trace.lookup.sure = sure; trace.lookup.paid = paidOrder;
            if (titleOnly || shortNoArtist) { items.length = 0; items.push(lookupItem); }
            else items.push(lookupItem);
          }
        }
      }
    } catch (e) { log('заказы: канонический поиск — ' + e.message); }
    // Precision gate: не превращаем игровые/чат-фразы с тире в exact.
    // Явное музыкальное доказательство — ссылка, кавычки, «песня/трек/OST/feat».
    try {
      const a = getAnalysis();
      const SUSPICIOUS = /(?<![\p{L}\p{N}])(?:комнат[а-яё]*|крокодил[а-яё]*|стабильност[а-яё]*|залог[а-яё]*|успех[а-яё]*|чай|авианос[а-яё]*|рандом[а-яё]*|альфа|тестер[а-яё]*|hide|roks|kddx|дно|эпик[а-яё]*|сборк[а-яё]*|пво|лешего|лыжи|сезон[а-яё]*|закрыли|насладиться|фигня|турнир[а-яё]*|обновлен[а-яё]*|баг[а-яё]*|сервер[а-яё]*|патч[а-яё]*|дропс[а-яё]*|главное|шедевр[а-яё]*|линкор[а-яё]*|сыграй[а-яё]*|театр[а-яё]*|теней|тень|черно-бел[а-яё]*|вернусь|возвращайся|истинный|герой)/iu;
      const EVIDENCE = /(?<![\p{L}\p{N}])(?:песн[а-яё]*|трек[а-яё]*|музык[а-яё]*|композиц[а-яё]*|song|track|music|feat|ft|ost|саундтрек[а-яё]*)(?![\p{L}\p{N}])|https?:\/\/|[«"“]/iu;
      const noEvidence = !EVIDENCE.test(d.text) && !p.links.length;
      const weakCombo = !o.fromCommand && p.signal === 'combo' && a.intent !== 'music' && !/(?<![\p{L}\p{N}])(?:песн|трек|музык|композиц|song|track|music)(?![\p{L}\p{N}])/iu.test(d.text) && !p.links.length;
      const suspicious = noEvidence && SUSPICIOUS.test(d.text);
      const lowIntent = a.intent === 'non_music' && !/(?<![\p{L}\p{N}])(?:feat|ft)(?![\p{L}\p{N}])/iu.test(d.text) && !p.links.length;
      trace.gate = { noEvidence, suspicious, weakCombo, lowIntent, downgraded: [] };
      if (suspicious || weakCombo || lowIntent) {
        items.forEach((it) => {
          const lowEvidence = lowIntent && it.score != null && it.score < 0.5;
          // Если название покрыто целой фразой, combo-гейт не должен
          // превращать его в «слабый сигнал» только из-за отсутствия слова «песня».
          const strongTitle = !!(it.track && select.inspect(it.track, d.text, { maxSec, enabled: srcOn }).tier >= 3);
          if (it.level === 'exact' && !it.link && (suspicious || lowEvidence || (weakCombo && !strongTitle))) {
            trace.gate.downgraded.push({ title: it.track && it.track.title || '', query: it.query || '', reason: suspicious ? 'suspicious' : weakCombo ? 'weakCombo' : 'lowIntent' });
            it.level = 'doubt';
            it.note = suspicious ? 'похоже на обычный текст, не заказ' : 'слабый сигнал без названия';
          }
        });
      }
    } catch (e) { log('заказы: precision gate — ' + e.message); }
    const rules = reqRules();
    // Возраст у YouTube-заказов иначе известен только в момент воспроизведения: поиск отдаёт
    // ролики без возраста, и правило «18+ запрещены» срабатывало бы уже после попытки играть.
    // Когда правило выключено, спрашиваем движок при приёме заказа — один раз на ролик
    // (кеша нет только у свежих: ответ движка на 9 секунд, дальше результат уже в треке).
    if (rules.explicitOk === false) {
      await Promise.all(items.map(async (it) => {
        const t = it.track;
        if (!t || t.src !== 'yt' || t.explicit != null || !t.id) return;
        try {
          const j = await ytdlpModule.ydlJson(['https://www.youtube.com/watch?v=' + t.id, '--no-playlist'], 9000, { ytCookies: true });
          if (!j) return;
          if (j.error) {
            // Без входа движок метаданные возрастного ролика не отдаёт, но сам отказ —
            // уже достоверный признак: значит возраст есть, и правило должно сработать.
            if (/confirm your age/i.test(String(j.error))) t.explicit = true;
            return;
          }
          const age = Number(j.age_limit || 0) || 0;
          t.ageLimit = age;
          if (age >= 18) t.explicit = true;
        } catch (e) { log('заказы: возраст ролика не узнал — ' + ((e && e.message) || e)); }
      }));
    }
    items.forEach((it) => {
      try { it.flags = it.track ? reqp.flags(it.track, d.text, rules) : []; }
      catch (e) { it.flags = [{ k: 'error', t: 'проверка не удалась' }]; log('заказы: flags — ' + e.message); }
    });
    trace.flags = items.map((it) => ({ level: it.level, flags: it.flags || [], track: it.track ? it.track.title : '' }));
    const price = Number(cfg('reqPrice')) || 0, cur = cfg('reqCurrency') || 'RUB';
    let amt = d.amountMain != null ? d.amountMain : (String(d.currency || '').toUpperCase() === cur ? d.amount : null);
    // B-05: донат в другой валюте пересчитываем по курсу. Не вышло — заказ ждёт решения стримера
    // (раньше такой донат молча считался оплаченным при любой сумме).
    let fxFail = false;
    if (amt == null && price && d.amount != null && String(d.currency || '').trim()) {
      const conv = await fx.convert(d.amount, d.currency, cur, 3000).catch(() => null);
      if (conv != null) { amt = conv; trace.fx = { from: String(d.currency).toUpperCase(), amount: d.amount, to: cur, value: conv }; }
      else { fxFail = true; trace.fx = { from: String(d.currency).toUpperCase(), amount: d.amount, to: cur, fail: true }; log('заказы: не смог пересчитать ' + d.amount + ' ' + d.currency + ' в ' + cur); }
    }
    const paid = reqp.paidCount(amt, price);
    items.forEach((it, i) => {
      it.paid = i < paid;
      if (fxFail && it.level === 'exact') { it.level = 'doubt'; it.note = 'донат в ' + String(d.currency).toUpperCase() + ' — курс не получен, проверь сумму'; }
    });
    trace.paid = { amount: amt, price, count: paid === Infinity ? null : paid };
    if (!items.length && (p.signal === 'music' || p.signal === 'combo' || p.signal === 'dash' || (p.queries || []).length)) {
      items.push({ level: 'doubt', track: null, alts: [], query: (p.queries && p.queries[0] && p.queries[0].query) || '', note: 'похоже на заказ, но трек не найден' });
    }
    const level = items.some((i) => i.level === 'exact') ? 'exact' : items.length ? 'doubt' : 'text';
    // Где на самом деле искали — для пометки в карточке: «YouTube не отвечал — искал в …»
    const srcUsed = ['ym', 'lc', 'sc', 'au'].filter((k) => srcOn[k]);
    const result = Object.assign({}, d, { key: d.prov + ':' + d.id, items, level, signal: p.signal, amtMain: amt, paidN: paid === Infinity ? null : paid, state: 'new', got: Date.now(), ytDown: srcOn.yt && ytCtx.ytDown, srcUsed });
    trace.yt = { on: srcOn.yt, down: ytCtx.ytDown, used: ytCtx.ytUsed };
    orderReport.finish(trace, result);
    logDebug('заказ: ' + String(d && d.prov || '') + ' → ' + level + ', вариантов ' + items.length);
    return result;
  }
  let reqChain = Promise.resolve();
  function onDonation(d) {
    reqChain = reqChain.then(async () => {
      updSession.markOrder(); // R3: заказ (в том числе тестовый из отладки) — сессия активна
      let r;
      try { r = await withTimeout(processDonation(d), 45000, 'order'); } catch (e) {
        log('заказы: ошибка разбора ' + e.message);
        orderReport.fail(d, e);
        r = Object.assign({}, d, { key: d.prov + ':' + d.id, items: [{ level: 'doubt', track: null, alts: [], note: 'не удалось разобрать заказ' }], level: 'doubt', state: 'new', got: Date.now() });
      }
      if (requests.some((x) => x.key === r.key)) return;
      requests.push(r); saveReq();
      const who = d.test ? 'тест (тестовый заказ)' : ('донат ' + (donations.NAMES[d.prov] || d.prov));
      log('заказы: ' + who + ' → ' + r.level + (r.items.length ? ' (' + r.items.map((i) => i.level + (i.track ? ' ' + i.track.author + ' — ' + i.track.title : '')).join('; ') + ')' : ''));
      logDebug((d.test ? 'тест: ' : 'донат: ') + (donations.NAMES[d.prov] || d.prov) + ' → заказ ' + r.level + ', вариантов ' + r.items.length);
      libSend('req-new', r);
    });
    return reqChain;
  }
  donations.setup({
    log, store: settingsStore, onDonation, onStatus: () => libSend('don-status', donations.status()),
    // Автопочинка (0.34.0, шаг 5): успешный опрос сбрасывает счётчик ошибок подряд;
    // сбой опроса — повод переподключить сервис (порог 2). 429 не трогаем: станет хуже.
    onPollOk: (a) => { try { autofixR.success(a.prov === 'da' ? 'donationalerts' : 'donatepay', 'poll'); } catch (e) {} },
    onPollFail: (a) => {
      try {
        if (a && a.status === 429) return;
        autofixR.note(a.prov === 'da' ? 'donationalerts' : 'donatepay', 'poll', { reason: a && a.error });
      } catch (e) {}
    },
    // 401/403: вход отозван — сами не чиним (автопочинка показывает «войдите заново»),
    // один раз сообщаем в GitHub, чтобы сбой не остался только в локальном логе.
    onAuthError: (a) => {
      try { autofixR.auth(a.prov === 'da' ? 'donationalerts' : 'donatepay', 'вход отозван — войдите заново'); } catch (e) {}
      sendReport({ service: 'don', stage: 'poll', code: 'auth', msg: (a.prov === 'da' ? 'DonationAlerts' : 'Донат-сервис') + ': вход устарел — нужен повторный вход', details: 'provider ' + String(a.prov || '') }).catch(() => {});
    }
  });
  onlineLookup.setup({ cachePath: path.join(app.getPath('userData'), 'lookup-cache.json'), log });
  fx.setup({ cachePath: path.join(app.getPath('userData'), 'fx-cache.json'), log });
  orderReport.setup({ file: path.join(app.getPath('userData'), 'orders-report.jsonl'), log });
  if (readSettingsFile().streamerMode !== false) {
    try { donations.start(); } catch (e) { log('Донаты: не удалось запустить — ' + (e && e.message || e)); }
  }
  sitepage.setup({ log, store: settingsStore });
  ipcMain.handle('req-list', () => requests);
  ipcMain.handle('req-update', (e, key, patch) => { const r = requests.find((x) => x.key === key); if (r && patch) { Object.assign(r, patch); saveReq(); } return !!r; });
  ipcMain.handle('req-clear', (e, keep) => {
    const set = new Set(Array.isArray(keep) ? keep : []);
    requests = requests.filter((x) => set.has(x.key));
    saveReq();
    return requests;
  });
  ipcMain.handle('req-test', async (e, arg, amount) => {
    // Новый вызов — объект из отладочного меню; старый (кнопка «Пробный заказ») — текст и сумма.
    const o = (arg && typeof arg === 'object') ? arg : { text: arg, amount: amount };
    const raw = String(o.text == null ? '' : o.text).trim();
    if (!raw || /^!play$/i.test(raw)) return null; // пустой тестовый !play — не заказ
    // Тот же путь, что настоящий донат: buildDonation → onDonation → processDonation → requests.json.
    const d = testOrder.buildDonation({ name: o.name, amount: o.amount, service: o.service, text: raw }, { currency: cfg('reqCurrency') || 'RUB' });
    await onDonation(d);
    return requests.find((x) => x.key === 'test:' + d.id) || null;
  });
  ipcMain.handle('req-reparse', async (e, key) => { const i = requests.findIndex((x) => x.key === key); if (i < 0) return null; const prev = requests[i]; const r = await processDonation(prev, { paid: /-points$/.test(String(prev.prov || '')) }); r.state = prev.state; requests[i] = r; saveReq(); return r; });
  ipcMain.handle('req-remember', (e, line, track) => { if (track && track.id) memSet(line, '', track); return true; });

  // ===== Модули: пак стримера (чат-бот Twitch) — src/modhost.js, docs/BOT.md =====
  // Поиск заказа бота — тот же путь, что у доната (план → поиск → ранкер → правила), без суммы.
  async function botFindOrder(text, o) {
    const d = { prov: 'bot', id: 'q' + Date.now().toString(36), name: 'чат-бот', text: String(text || ''), amount: null, currency: '', at: Date.now() };
    const r = await withTimeout(processDonation(d, { noYt: !!(o && o.catalogsOnly), fromCommand: true, paid: !!(o && o.paid) }), 20000, 'bot');
    const items = (r.items || []).filter((i) => i.track);
    const ex = items.find((i) => i.level === 'exact');
    if (ex) return { level: 'exact', track: ex.track, alts: ex.alts || [] };
    if (items[0]) return { level: 'doubt', track: items[0].track, alts: items[0].alts || [] };
    return { level: 'none' };
  }
  // Общие правила «Заказов» + правила бота (минимальная длина, ссылки YouTube: просмотры, не трансляция).
  // o.commonOnly — только общие правила, без правил пака (так проверяет заказ Streamer.bot, Э1).
  function botCheckTrack(t, o) {
    if (!t) return { ok: false, reason: 'notFound' };
    // Трансляция проверяется первой: у неё нет нормальной длины, и «слишком длинный» было бы неправдой.
    if (t.live || t.isLive) return { ok: false, reason: 'live' };
    const f = reqp.flags(t, '', reqRules()).map((x) => x.k);
    if (f.includes('long')) return { ok: false, reason: 'tooLong' };
    if (f.includes('stop')) return { ok: false, reason: 'stopList' };
    if (f.includes('explicit')) return { ok: false, reason: 'explicit' };
    if (f.includes('nonmusic')) return { ok: false, reason: 'nonmusic' };
    if (o && o.commonOnly) return { ok: true };
    const b = settingsStore.get('mod.bot') || {};
    const minSec = b.minTrackSec == null ? 60 : Number(b.minTrackSec) || 0;
    if (minSec && t.seconds && t.seconds < minSec) return { ok: false, reason: 'tooShort' };
    if (t.src === 'yt') {
      const minViews = b.minViews == null ? 5000 : Number(b.minViews) || 0;
      const views = Number(t.views != null ? t.views : t.viewCount);
      if (minViews && isFinite(views) && views < minViews) return { ok: false, reason: 'fewViews' };
    }
    return { ok: true };
  }
  const modHost = modhost.setup({
    app, ipcMain, shell, safeStorage, store: settingsStore, log, send: libSend,
    findOrder: botFindOrder, checkTrack: botCheckTrack,
    addRequest: (rec) => { updSession.markOrder(); requests.push(rec); saveReq(); libSend('req-new', rec); },
    // оверлей и другие страницы модулей — на сервере панели OBS
    mount: (pre, fn) => { srv.mount(pre, fn); },
    unmount: (pre) => { srv.unmount(pre); },
    pageUrl: (p) => srv.pageUrl(p),
    remote: remoteBridge,
    localCover: async (u) => {
      const id = String(u || '').split('/')[2] || '';
      if (!id) return null;
      let c = lcoverCache.get(id);
      if (!c) { c = await library.cover(id).catch(() => null); if (!c) return null; c = lcoverSmall(c); lcoverCache.set(id, c); if (lcoverCache.size > LCOVER_MAX) lcoverCache.delete(lcoverCache.keys().next().value); }
      return { mime: c.mime, data: c.data };
    }
  });
  if (readSettingsFile().streamerMode !== false) setTimeout(() => modHost.start().catch((e) => log('модули: ' + e.message)), 2500);
  // Общий выключатель приёма: приводим бота пака к выбранному режиму сразу, не дожидаясь
  // смены настроек. Если заказы через Streamer.bot — бот пака молчит и награда на паузе.
  modHostRef = modHost;
  try { modHost.setAccepting(cfg('chatOrders') === 'pack').catch((e) => log('бот: приём не применён — ' + ((e && e.message) || e))); } catch (e) {}
  app.on('before-quit', () => { modHost.stop(); });

  // ---------- Отладочное меню (0.34.0) ----------
  // Вход — «tapyor debug» в строке поиска. Здесь только сбор данных и сохранение файлов;
  // сам интерфейс — src/ui/29-debug.js. Опасных действий в этом шаге нет, сбросы будут дальше.
  const debugSaved = { log: '', report: '' };
  function debugPad2(n) { return n < 10 ? '0' + n : String(n); }
  function debugStamp(d) {
    return d.getFullYear() + '-' + debugPad2(d.getMonth() + 1) + '-' + debugPad2(d.getDate())
      + '-' + debugPad2(d.getHours()) + debugPad2(d.getMinutes());
  }
  function debugDateShort(ts) {
    const d = new Date(Number(ts) || Date.now());
    return debugPad2(d.getDate()) + '.' + debugPad2(d.getMonth() + 1);
  }
  function debugBuildText(b) {
    if (b === 'stable') return 'стабильная';
    if (b === 'source') return 'из исходников';
    return 'отладочная (dev)';
  }
  function debugChannelText(ch) { return ch === 'debug' ? 'отладочная (debug)' : 'стабильная'; }
  function debugLicenseText(L) {
    if (!L) return 'проверяется';
    const st = L.state ? String(L.state) : 'none';
    if (st === 'full') return 'полная';
    if (st === 'trial') {
      const until = L && L.exp ? new Date(Number(L.exp)) : new Date(Date.now() + (Number(L && L.daysLeft) || 0) * 86400000);
      return 'пробная до ' + debugDateShort(until.getTime());
    }
    if (st === 'trial-ended') return 'закончилась';
    if (st === 'none') return 'нет';
    if (st === 'other-pc') return 'от другого компьютера';
    if (st === 'clock') return 'часы компьютера переведены назад — проверка на паузе';
    if (st === 'edition') return 'нужна новая редакция пака';
    if (st === 'dev') return 'полная (режим разработки)';
    if (st === 'not-installed') return 'пак не установлен';
    return st;
  }
  function debugReadWholeLog() {
    let old = '', cur = '';
    try { old = fs.readFileSync(logPath() + '.1', 'utf8'); } catch (e) {}
    try { cur = fs.readFileSync(logPath(), 'utf8'); } catch (e) {}
    if (old && cur && !/\n$/.test(old)) old += '\n';
    return old + cur;
  }
  async function debugGather() {
    const st = modHost.status();
    const yt = ytAuthStatus();
    const don = donations.status();
    const gh = sitepage.status();
    const tl = await modHost.twitchLogins();
    const mods = st.modules || {};
    const p = debugPeaksModule.snapshot(debugPeaks);
    return {
      version: app.getVersion(),
      build: BUILD.build,
      buildText: debugBuildText(BUILD.build),
      commit: BUILD.commit || 'неизвестен',
      channel: upd.channel(),
      channelText: debugChannelText(upd.channel()),
      license: debugLicenseText(st.license),
      pack: st.installed ? ('установлен, ' + ((st.manifest && st.manifest.version) || 'версия неизвестна')) : 'не установлен',
      modules: {
        bot: !!(mods.bot && mods.bot.running),
        overlay: !!(mods.overlay && mods.overlay.running)
      },
      logins: {
        youtube: !!(yt && (yt.cookies || (yt.oauth && yt.oauth.account))),
        yandex: !!getYmToken(),
        donationalerts: !!(don.da && don.da.connected),
        donatepay: !!(don.dp && don.dp.connected),
        twitch: !!(tl && (tl.chat || tl.broadcaster)),
        lastfm: !!lastfm.configured(),
        github: !!(gh && gh.connected)
      },
      autofix: debugCountersModule.snapshot(debugCounters),
      autofixDetail: debugCountersModule.detail(debugCounters),
      testProfile: userData.isTestProfileActive(),
      watchdog: watchdog ? watchdog.state() : null,
      dataDir: app.getPath('userData'),
      fault: faultSim.active(),
      load: {
        watch: perfOn(),
        current: { mem: p.lastMem, cpu: p.lastCpu, at: p.lastAt },
        peaks: { mem: p.mem, memAt: p.memAt, cpu: p.cpu, cpuAt: p.cpuAt }
      },
      verbose: debugVerbose
    };
  }
  function debugSaveDialog(title, name) {
    const opts = {
      title: title,
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'Текстовый файл', extensions: ['txt'] }]
    };
    try {
      if (mainWindow && !mainWindow.isDestroyed()) return dialog.showSaveDialog(mainWindow, opts);
      return dialog.showSaveDialog(opts);
    } catch (e) { return Promise.reject(e); }
  }
  ipcMain.handle('debug-state', async () => {
    try { return { ok: true, state: await debugGather() }; }
    catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
  ipcMain.handle('debug-peaks-reset', () => {
    debugPeaksModule.reset(debugPeaks);
    return { ok: true, peaks: debugPeaksModule.snapshot(debugPeaks) };
  });
  ipcMain.handle('debug-verbose-set', (e, on) => {
    if (typeof on !== 'boolean') return { ok: false, error: 'нужно да или нет' };
    debugVerbose = on;
    log('отладка: подробный журнал ' + (debugVerbose ? 'включён' : 'выключен'));
    return { ok: true, on: debugVerbose };
  });
  ipcMain.handle('debug-save-log', async () => {
    try {
      const name = 'tapyor-log-' + debugStamp(new Date()) + '.txt';
      const r = await debugSaveDialog('Сохранить журнал', name);
      if (!r || r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, debugReadWholeLog(), 'utf8');
      debugSaved.log = r.filePath;
      return { ok: true, path: r.filePath };
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
  ipcMain.handle('debug-save-report', async () => {
    try {
      const name = 'tapyor-report-' + debugStamp(new Date()) + '.txt';
      const r = await debugSaveDialog('Сохранить отчёт', name);
      if (!r || r.canceled || !r.filePath) return { ok: false, canceled: true };
      const state = await debugGather();
      // Настройки для отчёта + очередь из своего файла (R2): раньше today лежал в settings.json.
      const t = readToday();
      const repSettings = Object.assign({}, readSettings(), t == null ? {} : { today: t });
      const text = debugReport.buildReport({ log: debugReadWholeLog(), state: state, settings: repSettings });
      fs.writeFileSync(r.filePath, text, 'utf8');
      debugSaved.report = r.filePath;
      log('отладка: отчёт сохранён (' + Buffer.byteLength(text, 'utf8') + ' байт)');
      return { ok: true, path: r.filePath, bytes: Buffer.byteLength(text, 'utf8') };
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
  // Открыть папку последнего сохранённого файла. Путь приходит не из окна — только вид файла.
  ipcMain.handle('debug-reveal', (e, kind) => {
    const k = String(kind || '');
    if (k !== 'log' && k !== 'report') return false;
    const p = debugSaved[k];
    if (!p) return false;
    try { shell.showItemInFolder(p); return true; } catch (err) { return false; }
  });

  // ── Тестовый профиль и сбросы (0.34.0, задание 4) ─────────────────────────
  // Перезапуск: убираем старый флаг тестового профиля, при входе добавляем новый.
  // app.relaunch запускает новый процесс после выхода этого — лок single-instance
  // к тому моменту свободен, второй экземпляр не упирается в лок старого.
  function debugRelaunchArgs(testDir) {
    const out = process.argv.slice(1).filter((a) => typeof a === 'string' && a.indexOf(userData.TEST_FLAG) !== 0);
    if (testDir) out.push(userData.TEST_FLAG + testDir);
    return out;
  }
  function debugRelaunch(testDir) {
    try {
      // Это наш собственный перезапуск, а не сбой окна: сторож не должен считать его падением.
      watchdogQuitting = true;
      app.relaunch({ args: debugRelaunchArgs(testDir) });
      log('отладка: перезапуск ' + (testDir ? 'в тестовом профиле' : 'в обычном профиле'));
    } catch (e) {
      watchdogQuitting = false;
      log('отладка: перезапуск не удался — ' + (e && e.message));
      return false;                      // не закрываем Тапёр, если новый процесс не запустился
    }
    app.exit(0);
    return true;
  }
  // Сброс и возврат копии перезапускают в том же профиле: тестовый остаётся тестовым.
  function debugRelaunchSame() {
    debugRelaunch(userData.isTestProfileActive() ? app.getPath('userData') : '');
  }
  ipcMain.handle('debug-profile', () => ({ test: userData.isTestProfileActive(), dir: app.getPath('userData') }));
  ipcMain.handle('debug-test-profile-start', () => {
    if (userData.isTestProfileActive()) return { ok: false, error: 'уже в тестовом профиле' };
    try {
      const dir = userData.makeTestProfileDir(os.tmpdir(), new Date());
      fs.mkdirSync(dir, { recursive: true });
      settingsDisk.flush();                   // не терять только что изменённые настройки
      try { ensureTodayStore().flush(); } catch (e) {}   // и очередь с позицией (R2)
      log('отладка: вход в тестовый профиль');
      setTimeout(() => debugRelaunch(dir), 200);
      return { ok: true };
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
  ipcMain.handle('debug-test-profile-return', () => {
    if (!userData.isTestProfileActive()) return { ok: false, error: 'уже в обычном профиле' };
    log('отладка: возврат в обычный профиль');
    // Папку удалит следующий обычный запуск: процесс ещё держит свои файлы.
    setTimeout(() => debugRelaunch(''), 200);
    return { ok: true };
  });
  // Сброс: переспрос делает окно; здесь — автокопия, сброс, перезапуск.
  ipcMain.handle('debug-reset', async (e, kind) => {
    const k = String(kind || '');
    const names = { settings: 'настроек', license: 'лицензии', trial: 'триала' };
    if (!names[k]) return { ok: false, error: 'неизвестный вид сброса' };
    try {
      // Копия должна видеть settings.json, даже если его ещё не было (первый запуск):
      // иначе восстановить такую копию будет нечем. Пишем текущее состояние и сбрасываем на диск.
      const cur = readSettings();
      writeSettingsFile(cur);
      settingsDisk.flush();
      // Очередь — тоже на диск: автокопия включает today.json (R2), иначе после «Вернуть» её не будет.
      try { ensureTodayStore().flush(); } catch (e) {}
      const snap = await debugBackup.snapshot(k);
      // Без целой копии сброс не делаем: иначе «Вернуть как было» некуда возвращаться (A5).
      if (!debugBackup.snapshotReady(snap)) {
        throw new Error('резервная копия не создалась целиком — сброс отменён, ничего не изменено');
      }
      const next = k === 'settings' ? debugReset.resetSettings(cur, DEFAULTS)
        : k === 'license' ? debugReset.resetLicense(cur) : debugReset.resetTrial(cur);
      writeSettingsFile(next);
      settingsDisk.flush();
      // Сброс настроек убирает и очередь — как было, когда она лежала в settings.json (R2).
      // Копия уже снята выше, поэтому «Вернуть» её восстановит.
      if (k === 'settings') { try { ensureTodayStore().set(null); ensureTodayStore().flush(); } catch (e) {} }
      // .bak тоже переписываем: иначе store поднимет старое, если основного файла не будет.
      debugReset.rewriteBackups(settingsFile(), next, (m) => log(m));
      log('отладка: сброс ' + names[k] + ', копия ' + snap.id);
      setTimeout(() => debugRelaunchSame(), 400);
      return { ok: true, id: snap.id };
    } catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  });
  ipcMain.handle('debug-backups', () => {
    try { return { ok: true, items: debugBackup.list() }; }
    catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
  ipcMain.handle('debug-restore', async (e, id) => {
    if (typeof id !== 'string' || !id) return { ok: false, error: 'нужно имя копии' };
    try {
      const r = debugBackup.restore(id);
      // В памяти остались сброшенные настройки — перечитываем с диска и запрещаем
      // записывать их обратно при выходе (setup сбрасывает очередь записи).
      settingsDisk.setup({ file: settingsFile(), log: (m) => log(m) });
      settingsReady = true;
      // Восстановленная копия могла вернуть today.json — перечитываем его с диска,
      // а несохранённую старую очередь из памяти забываем (R2).
      todayStore.setup({ file: todayFile(), log: (m) => log(m) });
      todayReady = true;
      // Реестр — только в обычном профиле и только повышение: защиту часов не ослабляем.
      if (r.registry != null && !userData.isTestProfileActive()) {
        try { await modhost.clockRegWrite(r.registry); } catch (e) {}
      }
      log('отладка: восстановление копии ' + r.id + ', перезапуск');
      setTimeout(() => debugRelaunchSame(), 300);
      return { ok: true, id: r.id };
    } catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  });

  // ── Сторож окна и имитации падений (0.34.0, задание 6) ─────────────────────
  // Счёт и решения — в src/watchdog.js (покрыто unit-тестами). Здесь только окно,
  // журнал и сообщение владельцу. Сторож создаётся до первого createWindow ниже.
  async function watchdogSaveLog() {
    try {
      const name = 'tapyor-log-' + debugStamp(new Date()) + '.txt';
      const r = await debugSaveDialog('Сохранить журнал', name);
      if (!r || r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, debugReadWholeLog(), 'utf8');
      log('сторож: журнал сохранён (' + Buffer.byteLength(debugReadWholeLog(), 'utf8') + ' байт)');
      return { ok: true, path: r.filePath };
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  }
  // 4-е падение за 10 минут: окно больше не поднимаем молча — говорим владельцу.
  function watchdogShowLoopDialog(info) {
    const opts = {
      type: 'error',
      title: 'Тапёр',
      message: 'Окно Тапёра падает снова и снова',
      detail: 'Музыка остановлена, очередь сохранена. Автоматически поднимать окно больше не буду.'
        + (info && info.count ? (' Поднятий: ' + info.count + ' за ' + Math.round((info.windowMs || 0) / 60000) + ' мин.') : ''),
      buttons: ['Перезапустить Тапёр', 'Сохранить журнал', 'Закрыть'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    };
    const show = () => {
      const p = (mainWindow && !mainWindow.isDestroyed())
        ? dialog.showMessageBox(mainWindow, opts)
        : dialog.showMessageBox(opts);
      Promise.resolve(p).then((r) => {
        const idx = r && typeof r.response === 'number' ? r.response : 2;
        if (idx === 0) {
          watchdogQuitting = true;
          try { settingsDisk.flush(); } catch (e) {}
          try { ensureTodayStore().flush(); } catch (e) {}
          try {
            app.relaunch({ args: debugRelaunchArgs(userData.isTestProfileActive() ? app.getPath('userData') : '') });
            log('сторож: перезапуск программы по кнопке «Перезапустить Тапёр»');
            app.exit(0);
          } catch (e) { log('сторож: перезапуск программы не удался — ' + (e && e.message)); }
          return;
        }
        if (idx === 1) {
          watchdogSaveLog().then((res) => {
            if (res && res.ok) {
              dialog.showMessageBox({ type: 'info', title: 'Тапёр', message: 'Журнал сохранён', detail: res.path, buttons: ['Хорошо'], noLink: true })
                .then(show).catch(show);
            } else if (res && res.canceled) {
              show();
            } else {
              dialog.showMessageBox({ type: 'warning', title: 'Тапёр', message: 'Журнал сохранить не удалось', detail: (res && res.error) || 'неизвестная ошибка', buttons: ['Хорошо'], noLink: true })
                .then(show).catch(show);
            }
          }).catch(show);
          return;
        }
        watchdogQuitting = true;
        log('сторож: окно не поднято — выход по кнопке «Закрыть»');
        try { app.quit(); } catch (e) {}
      }).catch((e) => { log('сторож: сообщение о петле не показано — ' + (e && e.message)); });
    };
    show();
  }

  watchdog = watchdogModule.create({
    log: (m) => log(m),
    onRecover: () => {
      // Окно поднимается заново: старый пульс и таймер зависания больше не в счёт.
      watchdogLastPong = Date.now();
      try { watchdog.resetHang(); } catch (e) {}
      try {
        if (!mainWindow || mainWindow.isDestroyed()) {
          log('сторож: окно было закрыто — создаю новое');
          createWindow();
        } else {
          mainWindow.webContents.reload();
        }
      } catch (e) {
        log('сторож: окно не поднялось — ' + (e && e.message));
        try { createWindow(); } catch (e2) { log('сторож: окно не создано — ' + (e2 && e2.message)); }
      }
    },
    onHang: () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.forcefullyCrashRenderer(); return; }
        log('сторож: окна уже нет — перезапускать нечего');
      } catch (e) {
        log('сторож: окно не удалось принудительно перезапустить — ' + (e && e.message));
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); } catch (e2) {}
      }
    },
    onLoop: (info) => {
      // Дальше пульс не шлём: окно не поднимаем, а сообщение уже показано.
      watchdogLoopShown = true;
      watchdogShowLoopDialog(info);
    }
  });
  // Ответ на пульс. Принимаем только от главного окна: чужие страницы не должны
  // притворяться, что окно живо.
  ipcMain.on('watchdog-pong', (e) => {
    if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) return;
    watchdogLastPong = Date.now();
    if (watchdog) watchdog.onResponsive();
  });
  startWatchdogHeartbeat();
  // Сон/пробуждение ПК и разблокировка экрана: пульс в это время не идёт, окно
  // не виновато. Сбрасываем отсчёт, чтобы после пробуждения не перезапустить
  // здоровое окно (ошибка, найденная на приёмке 12.11).
  // После сна (R4) сразу будим связи: донаты не должны ждать паузу ошибок до 5 минут,
  // а Streamer.bot — повтор до 60 секунд. Живые соединения не рвутся (src/wake.js).
  try {
    const wakeUp = wake.create({
      log,
      actions: [
        { name: 'донаты', run: () => donations.pokeNow() },
        { name: 'Streamer.bot', run: () => (sbotLink ? sbotLink.pokeNow() : false) },
      ],
    });
    powerMonitor.on('resume', () => {
      resetWatchdogPulse('пробуждение ПК');
      wakeUp.onResume('пробуждение ПК');
    });
    powerMonitor.on('unlock-screen', () => resetWatchdogPulse('разблокировка экрана'));
  } catch (e) { log('сторож: powerMonitor — ' + (e && e.message ? e.message : e)); }

  // Окно спрашивает при загрузке: поднято ли оно сторожем после сбоя. Признак
  // выдаётся один раз и только свежий — обычный запуск музыку сам не включает.
  ipcMain.handle('recover-take', () => {
    let recovered = false;
    try { recovered = !!(watchdog && watchdog.takeRecover()); } catch (e) {}
    if (recovered) log('сторож: окно поднято после сбоя — очередь и место переданы окну');
    return { recovered: recovered };
  });

  // Имитации падений. Разрешены только в тестовом профиле: проверка и в окне,
  // и здесь (окно лишь прячет кнопки — доверять ему нельзя).
  ipcMain.handle('debug-crash-window', () => {
    const g = watchdogModule.imitationGuard(userData.isTestProfileActive());
    if (!g.ok) return g;
    log('отладка: имитация падения окна (сторож должен поднять)');
    try {
      mainWindow.webContents.forcefullyCrashRenderer();
      return { ok: true };
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
  ipcMain.handle('debug-hang-window', (e, seconds) => {
    const g = watchdogModule.imitationGuard(userData.isTestProfileActive());
    if (!g.ok) return g;
    const sec = watchdogModule.parseHangSeconds(seconds);
    if (sec == null) {
      return { ok: false, error: 'нужно целое число секунд от ' + watchdogModule.HANG_MIN_S + ' до ' + watchdogModule.HANG_MAX_S };
    }
    log('отладка: имитация зависания окна на ' + sec + ' с (свыше 15 с сторож перезапустит)');
    return { ok: true, seconds: sec };
  });
  ipcMain.handle('debug-corrupt-settings', () => {
    const g = watchdogModule.imitationGuard(userData.isTestProfileActive());
    if (!g.ok) return g;
    try {
      settingsDisk.flush();
      try { ensureTodayStore().flush(); } catch (e) {}   // очередь не портим вместе с настройками
      const bytes = watchdogModule.corruptSettings(settingsFile());
      log('отладка: имитация повреждения settings.json (' + bytes + ' байт, .bak не трогали) — перезапуск');
      setTimeout(() => debugRelaunchSame(), 200);
      return { ok: true };
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });

  // ── Имитация сбоев сети (0.34.0, шаг 3) ────────────────────────────────────
  // Перенос без изменения поведения (A1): каналы имитации сбоев — в src/main/fault.js.
  require('./main/fault').setup({ ipcMain, log, faultSim, faultSimModule, faultSnapshot, libSend });

  ipcMain.handle('don-status', () => donations.status());
  ipcMain.handle('don-da-login', () => donations.daLogin());
  ipcMain.handle('don-da-cancel', () => { donations.daCancel(); return true; });
  ipcMain.handle('don-set-key', (e, p, key) => donations.setKey(p, key));
  ipcMain.handle('don-disconnect', (e, p) => donations.disconnect(p));
  ipcMain.handle('don-redirect', () => donations.DA_REDIRECT);
  // Сайт-визитка и визуализатор: перенос без изменения поведения (A1) — сам код в src/main/site.js.
  // setup регистрирует каналы сайта; viz-arm — в registerIpc ниже, на прежнем месте.
  const siteModule = require('./main/site').setup({
    ipcMain, dialog, session, shell, fs, sitepage, log, getMainWindow: () => mainWindow
  });
  // Ссылки для стримерской части: сервисы донатов, GitHub, своя страница.
  // Белый список — в src/open-external.js (B5-1), здесь только вызов.
  ipcMain.handle('open-link', (e, url) => {
    const u = String(url || '');
    if (openExternal.allowedLink(u)) shell.openExternal(u);
    return true;
  });
  // Вкладка «Браузер»: назад / вперёд / обновить.
  // Делаем в главном процессе: у <webview> в Electron 33 методов canGoBack/goBack уже нет,
  // поэтому кнопки в окне молча ничего не делали.
  // Вкладка «Браузер»: правда ли сайт сейчас звучит (немое автовидео и превью — нет)
  // Визуализатор: перенос без изменения поведения (A1) — сам код в src/main/site.js.
  siteModule.registerIpc();
  // Каналы вкладки «Браузер» (br-*): перенос без изменения поведения (A1) — сам код в
  // src/main/browser.js. Порядок регистрации прежний: после viz-arm, до lib-*.
  browserModule.registerIpc();
  // Библиотека: перенос без изменения поведения (A1) — каналы lib-* и m3u-export
  // регистрируются здесь и в прежнем порядке; сам код — в src/main/library.js.
  libModule.registerIpc();

  // --- Мастер «Импорт»: откуда взять список песен ---
  // Перенос без изменения поведения (A1): сам код — в src/main/import-wizard.js.
  // resolveLinkFn появляется ниже (src/main/link-resolver.js): import-url зовут из окна,
  // а окно создаётся позже этого места — передаём обёртку, а не значение сейчас.
  require('./main/import-wizard').setup({
    ipcMain, dialog, path, fs, log, library, pathGuard, importers, ytdlpModule, fmtDur, userAgent,
    getMainWindow: () => mainWindow,
    resolveLinkFn: (text) => resolveLinkFn(text)
  });

  // --- Свои плейлисты на площадках: Яндекс и YouTube ---
  // Перенос без изменения поведения (A1): сам код — в src/main/platform-playlists.js.
  require('./main/platform-playlists').setup({ ipcMain, log, getYmToken, ymUidGet, ym, ytoauth, libSend });
  // Цвет обложки для «сцены»: уменьшаем картинку и берём средний цвет с упором на насыщенные пиксели
  const coverColors = new Map();
  ipcMain.handle('cover-color', async (e, url) => {
    if (!url || !/^https:\/\//i.test(url)) return null;
    if (coverColors.has(url)) return coverColors.get(url);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const img0 = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
      if (img0.isEmpty()) return null;
      const px = img0.resize({ width: 24, height: 24 }).toBitmap(); // BGRA
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i + 3 < px.length; i += 4) {
        const B = px[i], G = px[i + 1], R = px[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const sat = mx ? (mx - mn) / mx : 0;
        const w = sat * sat * (mx / 255) + 0.02;
        r += R * w; g += G * w; b += B * w; n += w;
      }
      r /= n; g /= n; b /= n;
      const k = 210 / Math.max(r, g, b, 1); // ровная яркость свечения
      const hex = '#' + [r, g, b].map((x) => Math.round(Math.min(255, x * k)).toString(16).padStart(2, '0')).join('');
      if (coverColors.size > 300) coverColors.clear();
      coverColors.set(url, hex);
      return hex;
    } catch (err) { return null; }
  });
  ipcMain.handle('ym-artist', async (e, id) => {
    try { return await ym.artistTracks(getYmToken(), id); }
    catch (err) { log('Яндекс: исполнитель — ' + err.message); return { error: err.message }; }
  });

  ipcMain.handle('ym-album', async (e, id) => {
    try { return await ym.albumTracks(getYmToken(), id); }
    catch (err) { log('Яндекс: альбом — ' + err.message); return { error: err.message }; }
  });
  // Страница исполнителя: Яндекс (играет сразу) + Deezer (полная дискография, без ключа)
  ipcMain.handle('artist-page', async (e, name, ymId) => {
    const tok = getYmToken();
    const out = { name: name || '', errors: [] };
    const nn = dz.norm(name);
    const ymP = (async () => {
      let id = ymId;
      if (!id && name) {
        const r = await ym.search(name, tok);
        const a = (r.artists || []).find((x) => dz.norm(x.name) === nn) || null;
        id = a && a.id;
      }
      return id ? ym.artistInfo(tok, id) : null;
    })().catch((err) => { out.errors.push('Яндекс: ' + err.message); log('исполнитель: Яндекс — ' + err.message); return null; });
    const dzP = dz.artistPage(name).catch((err) => { out.errors.push('Deezer: ' + err.message); log('исполнитель: Deezer — ' + err.message); return null; });
    const lfP = lastfm.configured() ? lastfm.artist(name).catch((err) => { out.errors.push(err.message); log('исполнитель: ' + err.message); return null; }) : Promise.resolve(null);
    const [y, d, lf] = await Promise.all([ymP, dzP, lfP]);
    out.ym = y; out.dz = d; out.lf = lf;
    log('исполнитель «' + name + '»: Яндекс ' + (y ? y.albums.length + ' альб.' : 'нет') + ', Deezer ' + (d ? d.albums.length + ' альб.' : 'нет') + ', Last.fm ' + (lf ? 'есть' : (lastfm.configured() ? 'нет' : 'без ключа')));
    return out;
  });
  ipcMain.handle('lf-tag-top', async (e, tag) => {
    if (!lastfm.configured()) return { error: 'нет ключа Last.fm' };
    try { return await lastfm.tagTop(tag); }
    catch (err) { log('Last.fm: тег «' + tag + '» — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('dz-album', async (e, id) => {
    try { return await dz.album(id); }
    catch (err) { log('Deezer: альбом — ' + err.message); return { error: err.message }; }
  });

  // Ссылка в строке поиска: Яндекс Музыка или YouTube.
  // Перенос без изменения поведения (A1): сам разбор — в src/main/link-resolver.js.
  // resolveLinkFn зовут заказы (processDonation) и мастер «Импорт» (import-url): оба —
  // только после окна и старта опросов, а между этим местом и стартом нет ни одного await.
  const { resolveLinkFn } = require('./main/link-resolver').setup({ ipcMain, log, getYmToken, ym, ytdlpModule, withTimeout, yts });
  // Каналы ym-stream / ym-wave-* / suggest — перенос без изменения поведения (A1):
  // сам код — в src/main/yandex.js (registerIpc), порядок регистрации прежний.
  ymModule.registerIpc();

  // --- Вход в YouTube: через браузер (OAuth), окном внутри Тапёра, ключом из браузера ---
  // Перенос без изменения поведения (A1): сам код — в src/main/yt-login.js.
  // ytAuthStatus отдаём под прежним именем: им пользуются автопочинка, отладка и
  // самопроверка ниже (health получает его через ctx).
  const { ytAuthStatus } = require('./main/yt-login').setup({
    ipcMain, log, cfg, settingsStore, clipboard, fs, ytCookieFile, ytauth, ytoauth,
    getMainWindow: () => mainWindow
  });
  // Мои плейлисты и лайки YouTube: через API (вход через браузер) или через yt-dlp с ключом
  function ytdlpFeed(url, end) {
    return new Promise((resolve) => {
      const bin = ytdlpModule.ytdlpPath();
      if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
      const ck = ytCookies(false);
      ytdlpModule.execTracked(bin, [url, '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', String(end || 300), ...ck.args],
        { timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
          ck.done();
          if (err) {
            const why = String(stderr || err.message);
            log('YouTube: ' + url + ' — ' + why.slice(0, 300));
            // 401/403 — ключ входа устарел: говорим прямо, а не «не удалось загрузить»
            if (/HTTP Error 40[13]|Unauthorized|Sign in to confirm/i.test(why)) resolve({ error: 'вход в YouTube устарел — войди заново (Настройки → YouTube)', expired: true });
            else resolve({ error: 'не удалось загрузить' });
            return;
          }
          try { resolve(JSON.parse(stdout)); } catch (e2) { resolve({ error: 'ошибка разбора' }); }
        });
    });
  }
  ipcMain.handle('yt-my', async () => {
    if (ytoauth.loggedIn()) {
      try { return { via: 'api', playlists: await ytoauth.myPlaylists(), liked: { src: 'yt', type: 'liked', title: 'Понравившиеся на YouTube', listId: 'LL' } }; }
      catch (err) { log('YouTube API: мои плейлисты — ' + err.message); }
    }
    if (!ytauth.hasCookies()) return { error: 'нет входа' };
    const j = await ytdlpFeed('https://www.youtube.com/feed/playlists', 200);
    if (j.error) return j;
    const playlists = (j.entries || []).filter((x) => x && (x.id || x.url)).map((x) => {
      const id = x.id && !/^https?:/.test(x.id) ? x.id : ((/[?&]list=([\w-]+)/.exec(x.url || '') || [])[1]);
      return { src: 'yt', type: 'playlist', listId: id, title: x.title || 'Плейлист', author: x.channel || x.uploader || '', count: x.playlist_count || 0, thumb: (x.thumbnails && x.thumbnails.length ? x.thumbnails[x.thumbnails.length - 1].url : ''), mine: true };
    }).filter((p) => p.listId && p.listId !== 'LL' && p.listId !== 'WL');
    return { via: 'cookies', playlists, liked: { src: 'yt', type: 'liked', title: 'Понравившиеся на YouTube', listId: 'LL' } };
  });
  ipcMain.handle('yt-liked', async () => {
    if (ytoauth.loggedIn()) { try { return await ytoauth.liked(); } catch (err) { log('YouTube API: лайки — ' + err.message); } }
    const r = await ytdlpModule.ytdlpPlaylist('LL');
    if (r && !r.error) { r.type = 'liked'; r.title = 'Понравившиеся на YouTube'; }
    return r;
  });

  // --- Запасной способ для Яндекса: официальный сайт в скрытом окне ---
  ymweb.setup({ log, fault: faultSim, send: (ch, d) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, d); } catch (e) {} } });
  // --- Самопроверка сервисов ---
  recipes.setup({ log, cacheFile: path.join(app.getPath('userData'), 'recipes.json'), appVersion: app.getVersion() });
  recipes.refresh();
  ytdlpModule.ensureYtdlp().then(function(){ setTimeout(function(){ try { ytdlpModule.ytdlpUpdateIfDue(); } catch (e) { log('yt-dlp: автопроверка — ' + e.message); } }, 45000); }).catch(function(e){ log('yt-dlp: стартовая копия — ' + e.message); });
  // Перенос без изменения поведения (A1): код самопроверки — в src/main/health.js.
  const health = require('./main/health').setup({
    app, ipcMain, log, cfg, settingsStore, readSettingsFile, recipes, ytdlpModule, ym, ymweb,
    getYmToken, ymStatus, ytsT, auSearch, auStreamUrl, AU_APP, ytAuthStatus, sbotCheck, sbotStatusNow,
    upd, sendReport, autofixR, autofixModule, lastfm, donations, cloudCheck,
    REPORT_URL, CLOUD_KEY, CLOUD_KEY_HEADER, isPlayerBusy: () => playerBusy
  });
  // ping нужен и автопочинке (обработчики выше): берём его из модуля под прежним именем.
  const ping = health.ping;

  // Шифрует ли система сохранённые ключи на самом деле — интерфейс не должен обещать больше (аудит 01.11, M6)
  ipcMain.handle('storage-encrypted', () => { try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; } });
  ipcMain.handle('report-test', () => sendReport({ service: 'test', stage: 'setup', code: 'check', msg: 'Проверка связи из Тапёра', details: '' }, true));
  ipcMain.handle('report-preview', () => lastReport || { пример: 'отчёта ещё не было', поля: 'площадка, этап, код ошибки, текст без личного, версия Тапёра и рецептов, Windows, случайный номер установки' });
  // Палитры из The Color API (https, без ключа): режимы monochrome, monochrome-dark, monochrome-light, analogic, complement, analogic-complement, triad, quad
  ipcMain.handle('palette-api', async (e, hex, mode) => {
    try {
      const h = String(hex || '').replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(h)) return { error: 'цвет' };
      const m = /^(monochrome|monochrome-dark|monochrome-light|analogic|complement|analogic-complement|triad|quad)$/.test(mode) ? mode : 'analogic';
      const { net: enet } = require('electron');
      const r = await enet.fetch('https://www.thecolorapi.com/scheme?format=json&count=5&hex=' + h + '&mode=' + m, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      return { colors: ((j && j.colors) || []).map((c) => c && c.hex && c.hex.value).filter(Boolean) };
    } catch (err) { log('палитры: The Color API — ' + err.message); return { error: err.message }; }
  });
  health.registerIpc();

  ipcMain.handle('ymweb-play', (e, t, vol) => ymweb.play(t, vol).catch((err) => { log('Яндекс (сайт): ' + err.message); return { error: err.message }; }));
  ipcMain.handle('ymweb-cmd', (e, name, value) => ymweb.cmd(name, value));
  ipcMain.handle('ymweb-stop', () => ymweb.stop());
  ipcMain.handle('ymweb-login', () => ymweb.login());
  app.on('before-quit', () => ymweb.destroy());

  // Тот же трек в другом сервисе (если в своём он не играет)
  ipcMain.handle('find-alt', async (e, t, target) => {
    if (!t || !t.title) return null;
    let line;
    if (t.src === 'yt' || t.src === 'sc' || t.src === 'bc') {
      const ch = String(t.author || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '');
      line = /\s[-–—]\s/.test(t.title) ? t.title : (ch ? ch + ' - ' + t.title : t.title);
    } else line = (t.author ? t.author + ' - ' : '') + t.title;
    const q = match.clean(line);
    if (!q.query) return null;
    let ymList = [], ytList = [];
    try {
      if (target === 'ym') ymList = dropSpeechCandidates((await ym.searchTracksPage(q.query, 0, getYmToken())).slice(0, 6));
      else {
        const y = await ytsT(q.query, 8000);
        ytList = (y.videos || []).slice(0, 5).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail, live: !((v.duration && v.duration.seconds) > 0) || undefined }));
      }
    } catch (err) { log('замена трека: поиск — ' + err.message); return { error: err.message }; }
    const r = match.decide(q, ymList, ytList);
    log('замена трека: «' + line + '» → ' + (target === 'ym' ? 'Яндекс' : 'YouTube') + ': ' + r.status + (r.track ? ' «' + (r.track.author || '') + ' — ' + r.track.title + '»' : ''));
    return r.status === 'none' ? null : { status: r.status, track: r.track };
  });

  // «Сейчас играет» — подсказка на значке в трее
  ipcMain.on('now-playing', (e, info) => {
    lastNpInfo = info;
    if (info && info.title) {
      perf.tracks++; const sname = info.source || '—'; perf.bySrc[sname] = (perf.bySrc[sname] || 0) + 1;
      perf.playState = info.playing === false ? 'пауза' : 'играет';
      perf.lastNpAt = Date.now();
    }
    const line = formatNowPlaying(info, '{artist} — {title}');
    try { if (tray) tray.setToolTip(line ? '♪ ' + line.slice(0, 110) : 'Тапёр'); } catch (err) {}
    writeNowPlaying(info);
  });
  ipcMain.handle('np-path', () => npFilePath());
  writeNowPlaying(null); // при запуске ничего не играет
  app.on('before-quit', () => writeNowPlaying(null));

  // Обновления из шапки (каналы, проверка подписи, скачивание, сборка другого канала).
  // Перенос без изменения поведения (A1): сами обработчики — в src/main/updater.js.
  upd.registerIpc();
  ipcMain.on('log', (e, msg) => log('окно: ' + String(msg).slice(0, 500)));
  ipcMain.on('player-busy', (e, busy) => {
    const was = playerBusy;
    playerBusy = !!busy;
    // R3: музыка заиграла в этом запуске — сессия стримера активна, самообновление ждёт выхода
    if (playerBusy && !was) updSession.markPlayed();
    // Наступила пауза — запускаем отложенные тяжёлые автопочинки.
    if (!playerBusy && autofixR) { try { autofixR.tick(); } catch (err) { log('авточинка: пауза — ' + err.message); } }
  });
  ipcMain.handle('hotkeys-pause', (e, paused) => { // пока назначаем новое сочетание — старые не мешают
    if (paused) { try { globalShortcut.unregisterAll(); } catch (err) {} return { failed: [] }; }
    return applyHotkeys();
  });
  ipcMain.handle('hotkeys-status', () => applyHotkeys());

  log('=== приложение запущено, версия ' + app.getVersion() + ' ===');
  log('сборка: ' + buildInfoModule.buildLabel(BUILD) + (BUILD.commit ? '' : ' (коммит неизвестен)'));

  // Визард первого запуска (14.11.2026): окно-колонка рядом с главным, каналы wizard-*.
  // Решение «показывать ли сам» — по отсутствию файла настроек на старте и отметке wizardDone.
  const wizardModule = require('./main/wizard').setup({
    BrowserWindow, ipcMain, path, screen, log, cfg,
    readSettingsFile, writeSettingsFile,
    getMainWindow: () => mainWindow,
    isQuitting: () => !!app.isQuitting,
    srcDir: __dirname,
    themeBg: () => themeColors().bg,
    getFacts: async () => {
      let ymAcc = { loggedIn: false };
      try { ymAcc = await ymStatus(); } catch (e) {}
      let yta = {};
      try { yta = ytAuthStatus() || {}; } catch (e) {}
      let don = {};
      try { don = donations.status() || {}; } catch (e) {}
      // WZ5: чек-лист «Готов к эфиру» — настоящие состояния пака, Streamer.bot и сайта-визитки.
      let pk = {};
      try { pk = modHost.status() || {}; } catch (e) {}
      let sb = {};
      try { sb = sbotStatusNow() || {}; } catch (e) {}
      let site = {};
      try { site = sitepage.status() || {}; } catch (e) {}
      const lic = pk.license || {};
      const licState = typeof lic.state === 'string' ? lic.state : 'not-installed';
      return {
        music: {
          ym: !!(ymAcc && ymAcc.loggedIn),
          ymPlus: !!(ymAcc && ymAcc.hasPlus),
          yt: !!(yta.cookies || (yta.oauth && yta.oauth.account)),
          ymEnabled: cfg('ymEnabled') !== false,
          ytEnabled: cfg('ytEnabled') !== false
        },
        donations: { da: !!(don.da && don.da.connected), dp: !!(don.dp && don.dp.connected) },
        rules: {
          tier: cfg('reqTiers') || 'default', auto: cfg('reqAuto') === true,
          // Набор из шага «Правила заказов» (all | balanced | manual; '' — правили вручную).
          preset: (() => { try { return require('./wizard/steps/rules.js').settingsToPreset(Object.assign({}, cfg('reqRules') || {}, { reqAuto: cfg('reqAuto') })); } catch (e) { return ''; } })()
        },
        chat: { mode: cfg('chatOrders') || 'none' },
        // Пак стримера: карточка оверлеев и путь «наш бот» видны, только если пак есть
        // и у него доступен пробный период (как кнопка «Попробовать 30 дней» в 26-packs).
        pack: {
          installed: !!pk.installed,
          enabled: !!lic.enabled,
          state: licState,
          daysLeft: Number(lic.daysLeft) || 0,
          trialAvailable: !!pk.installed && (licState === 'none' || licState === 'other-pc')
        },
        // Отметку «тестовые заказы прошли оба пути» ставит шаг «Заказы в деле» (WZ4).
        orders: { tested: cfg('wizardOrdersTested') === true },
        sbot: {
          status: typeof sb.status === 'string' ? sb.status : 'off',
          hasPassword: !!sb.hasPassword,
          templateFound: !!sb.templateFound
        },
        site: { url: typeof site.url === 'string' ? site.url : '', connected: !!site.connected }
      };
    }
  });

  allowMediaAnalysis();
  // Новая установка: окно видео — минимальной высоты (16.11.2026, слово владельца), больше места очереди.
  // Обновлению не трогаем: у кого высота не задана, остаётся как было. 80 — нижний предел setVH.
  if (!SETTINGS_EXISTED_AT_START) {
    try { if (settingsStore.get('videoHeight') == null) settingsStore.set('videoHeight', 80); } catch (e) { log('первый запуск: высота видео не записана — ' + e.message); }
  }
  createWindow();
  // Новая установка — знакомство само; обновление или повторный запуск — никогда.
  try {
    wizardModule.maybeOpenOnFirstRun({
      hadSettingsFile: SETTINGS_EXISTED_AT_START,
      wizardDone: cfg('wizardDone') === true
    });
  } catch (e) { log('визард: первый запуск — ' + ((e && e.message) || e)); }
  // Трей: значок, меню и подсказка «сейчас играет».
  // Перенос без изменения поведения (A1): сам код — в src/main/tray.js.
  // setup стоит перед первым (и единственным) вызовом createTray(): внутри нужен upd,
  // который создаётся ниже определения бывшей функции.
  const trayModule = require('./main/tray').setup({
    app, Tray, Menu, nativeImage, shell, path, fs, srcDir: __dirname,
    log: (...a) => log(...a),
    modhost, orderReport, perf,
    getUpd: () => upd,
    getMainWindow: () => mainWindow,
    getTray: () => tray,
    setTray: (v) => { tray = v; },
    npFilePath: (...a) => npFilePath(...a),
    logPath: (...a) => logPath(...a),
    perfFlush: (...a) => perfFlush(...a),
    perfPath: (...a) => perfPath(...a),
    perfDayOf: (...a) => perfDayOf(...a),
    showMainWindow: (...a) => showMainWindow(...a)
  });
  trayModule.createTray();
  applyHotkeys();

  // Уборка старых тестовых профилей — только в обычном профиле и в фоне после окна.
  // Только папки %TEMP%\tapyor-test-*, только внутри os.tmpdir(); чужие файлы не трогаем.
  // Текущую папку данных и профили с lock-файлом работающего Тапёра уборка не удаляет (A7).
  if (!userData.isTestProfileActive()) {
    setTimeout(() => {
      try {
        const removed = userData.cleanupOldTestProfiles(os.tmpdir(), { keep: [app.getPath('userData')] });
        if (removed.length) log('отладка: удалены старые тестовые профили (' + removed.length + ')');
      } catch (e) { log('отладка: уборка тестовых профилей — ' + (e && e.message)); }
    }, 3000);
  } else {
    log('отладка: запуск в тестовом профиле, папка данных — временная');
  }

  // Проверяем обновления при запуске (тихо)
  upd.initUpdater();
  upd.checkForUpdates(false);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => {
  log('запуск: ' + (e && e.stack || e));
  try { if (!mainWindow) createWindow(); } catch (e2) { log('запуск: окно не создано — ' + e2.message); }
  try { dialog.showErrorBox('Тапёр не смог запуститься', String((e && e.message) || e)); } catch (e3) {}
});

// Не выходим при закрытии всех окон — живём в трее
// Вкладка «Браузер»: разрешения сайтов, масштаб сайтов (brZoom*), каналы br-*.
// Перенос без изменения поведения (A1): сам код — в src/main/browser.js.
// setup вызывается здесь же (уровень модуля после whenReady): подписки
// app.on('session-created') и app.on('web-contents-created') — в прежний момент.
const browserModule = require('./main/browser').setup({
  app, webContents, ipcMain, browserZoom, brTarget, localGuard, log, cfg, settingsDisk,
  getMainWindow: () => mainWindow
});
app.on('will-quit', () => {
  try { perfStop(); } catch (e) {}
  try { globalShortcut.unregisterAll(); } catch (e) {}
  try { if (sbotLink) sbotLink.stop(); } catch (e) {}
  try { donations.stop(); } catch (e) { log('донаты: остановка при выходе — ' + ((e && e.message) || e)); } // R12: опрос донатов не живёт после выхода
  try { childRegistry.killAll(); } catch (e) { log('дочерние процессы: ' + ((e && e.message) || e)); } // R12: yt-dlp не должен висеть после выхода
  try { settingsDisk.flush(); } catch (e) {}
  try { todayStore.flush(); } catch (e) {}   // очередь с позицией — свой файл (R2)
  try { if (fs.existsSync(ytCookieFile())) fs.unlinkSync(ytCookieFile()); } catch (e) {}
  try { ytauth.sweepTemp(); } catch (e) {}
});
// настройки и очередь пишутся с задержкой — при выходе (и перед установкой обновления) сохраняем сразу
app.on('before-quit', () => {
  // Обычный выход — не падение окна: сторож больше не поднимает окно.
  watchdogQuitting = true;
  if (watchdogPingTimer) { clearInterval(watchdogPingTimer); watchdogPingTimer = null; }
  try { if (watchdog) watchdog.stop(); } catch (e) {}
  try { settingsDisk.flush(); } catch (e) {}
  try { todayStore.flush(); } catch (e) {}
  // R3: скачанное обновление ставим при выходе — тихо и без перезапуска программы.
  try { upd.installUpdateOnQuit(); } catch (e) { log('обновление: установка при выходе — ' + (e && e.message)); }
  try { upd.installOtherOnQuit(); } catch (e) { log('обновление: сборка другого канала при выходе — ' + (e && e.message)); }
});
process.on('exit', () => {
  try { settingsDisk.flush(); } catch (e) {}
  try { todayStore.flush(); } catch (e) {}
});
app.on('window-all-closed', (e) => {
  // на Windows держим процесс ради трея
});

