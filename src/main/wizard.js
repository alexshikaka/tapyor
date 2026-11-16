// Визард первого запуска (14.11.2026): отдельное окно-колонка рядом с главным.
// Здесь — окно, его место рядом с Тапёром, каналы wizard-* и отметка wizardDone.
// Чистые решения (показывать ли визард,какие вкладки можно открыть) вынесены наружу —
// их проверяют tests/unit/wizard.test.mjs без Electron.
'use strict';

const WIZARD_WIDTH = 380;
const MAIN_MIN_WIDTH = 640;   // на тесном экране главное окно можно сжать (обычное — не меньше 900)
const GAP = 8;
// Развилка (15.11.2026, слово владельца): первый вопрос — окно по центру поверх Тапёра, Тапёр недоступен,
// пока не ответили. После ответа окно плавно уезжает в колонку сбоку.
const CENTER_W = 620;
const CENTER_H = 420;
// Последний шаг стримера (два пути и превью оверлеев) — окно по центру побольше
const CENTER_BIG_W = 900;
const CENTER_BIG_H = 860;
const DOCK_MS = 420;

module.exports = { setup, shouldOpenOnStart, allowedTab, WIZARD_WIDTH, centerRect, sideRect, startsCentered, lerpRect };

// Окно по центру главного (не больше рабочей области и самого главного окна).
function centerRect(mb, desk, big) {
  const w = Math.min(big ? CENTER_BIG_W : CENTER_W, desk.width, Math.max(360, mb.width - 40));
  const h = Math.min(big ? CENTER_BIG_H : CENTER_H, desk.height, Math.max(420, mb.height - 40));
  let x = Math.round(mb.x + (mb.width - w) / 2);
  let y = Math.round(mb.y + (mb.height - h) / 2);
  x = Math.max(desk.x, Math.min(x, desk.x + desk.width - w));
  y = Math.max(desk.y, Math.min(y, desk.y + desk.height - h));
  return { x, y, width: w, height: h };
}
// Колонка справа от главного окна (как placeWizard).
function sideRect(mb, desk) {
  let x = mb.x + mb.width + GAP;
  if (x + WIZARD_WIDTH > desk.x + desk.width) x = Math.max(desk.x, desk.x + desk.width - WIZARD_WIDTH);
  const y = Math.max(desk.y, Math.min(mb.y, desk.y + desk.height - 320));
  const h = Math.max(420, Math.min(mb.height, desk.y + desk.height - y));
  return { x: Math.round(x), y: Math.round(y), width: WIZARD_WIDTH, height: Math.round(h) };
}
// Начинать ли с окна по центру: весь маршрут с развилки (первый запуск, «Пройти заново», отладка).
// Один шаг из Настроек или заданный маршрут — сразу сбоку.
function startsCentered(o) {
  const v = o || {};
  return !v.step && !v.route;
}
// Плавный переход: t от 0 до 1, замедление к концу.
function lerpRect(a, b, t) {
  const k = 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  const m = (p, q) => Math.round(p + (q - p) * k);
  return { x: m(a.x, b.x), y: m(a.y, b.y), width: m(a.width, b.width), height: m(a.height, b.height) };
}


// Показывать визард сам при старте? Только новой установке: файла настроек ещё не было
// и отметки «знакомство пройдено» нет. Обновление или повторный запуск — никогда.
function shouldOpenOnStart(o) {
  const v = o || {};
  return !v.hadSettingsFile && v.wizardDone !== true;
}

// Вкладки, которые визарду разрешено открыть. Имена — внутренние (как в src/ui/02-player.js):
// my — «Плейлисты», req — «Заказы». Чужие значения не принимаем.
const TABS = new Set(['search', 'wave', 'my', 'req', 'hist', 'browser', 'settings', 'look', 'books']);
function allowedTab(tab) { return TABS.has(String(tab || '')); }

function setup(ctx) {
  const {
    BrowserWindow, ipcMain, path, screen, log, cfg,
    readSettingsFile, writeSettingsFile, getFacts, themeBg,
    getMainWindow, isQuitting, srcDir
  } = ctx;

  let win = null;
  let savedMain = null;       // прежнее место/размер главного окна
  let lastTheme = null;       // последняя тема от главного окна — отдаём визарду при загрузке
  let currentFrom = 'first';
  let currentStep = '';
  let currentRoute = null;
  let followTimer = null;
  let showTimer = null;
  let autoTried = false;
  let loaded = false;
  let stage = 'side';         // 'center' — развилка поверх Тапёра; 'side' — колонка сбоку
  let animTimer = null;
  let centerBig = false;      // окно по центру — большое (последний шаг)
  let forkLock = false;       // идёт развилка: закрыть окно нельзя, пока не ответили

  const mainWin = () => {
    const w = getMainWindow();
    return w && !w.isDestroyed() ? w : null;
  };
  const sendMain = (ch, data) => {
    const m = mainWin();
    if (!m) return;
    try { m.webContents.send(ch, data); } catch (e) {}
  };
  const sendEvt = (data) => {
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('wizard-evt', data || {}); } catch (e) {}
  };
  function sendFacts() {
    if (typeof getFacts !== 'function') return;
    Promise.resolve().then(() => getFacts()).then((facts) => {
      if (facts) sendEvt({ type: 'facts', facts });
    }).catch((e) => log('визард: состояние для чек-листа не собрано — ' + ((e && e.message) || e)));
  }
  function markDone() {
    try {
      const s = readSettingsFile();
      if (s.wizardDone !== true) { s.wizardDone = true; writeSettingsFile(s); }
    } catch (e) { log('визард: отметка первого запуска не записана — ' + ((e && e.message) || e)); }
  }

  // ── Место рядом с главным окном ───────────────────────────────────────────
  // Запоминаем прежнее место. Если справа не помещаемся — сжимаем и сдвигаем
  // главное окно влево, чтобы оба были видны. При закрытии возвращаем как было.
  function prepareMain(noApply) {
    const m = mainWin();
    if (!m) return null;
    const wasMax = m.isMaximized();
    const wasFull = m.isFullScreen();
    const bounds = m.getBounds();
    const normal = m.getNormalBounds ? m.getNormalBounds() : bounds;
    // Запоминаем только первый раз: повторный переезд вбок («← Назад» с последнего шага) не должен
    // перезаписать исходный размер уже суженным — иначе после закрытия Тапёр останется узким (16.11).
    if (!savedMain) savedMain = { bounds, min: m.getMinimumSize(), maximized: wasMax, fullScreen: wasFull };
    let b = (wasMax || wasFull) ? normal : bounds;
    if (wasMax) { try { m.unmaximize(); } catch (e) {} }
    if (wasFull) { try { m.setFullScreen(false); } catch (e) {} }
    const desk = screen.getDisplayMatching((wasMax || wasFull) ? bounds : b).workArea;
    // Было развёрнуто на весь экран — занимаем весь экран, кроме колонки визарда, а не прежнее
    // маленькое окно (16.11: на 2560 px Тапёр сжимался до 1296 px).
    if (wasMax || wasFull) b = { x: desk.x, y: desk.y, width: desk.width, height: desk.height };
    const need = GAP + WIZARD_WIDTH;
    const out = { x: b.x, y: b.y, width: b.width, height: b.height };
    if (out.x + out.width + need > desk.x + desk.width) {
      const maxW = desk.x + desk.width - need - desk.x;
      if (out.width > maxW) out.width = Math.max(MAIN_MIN_WIDTH, maxW);
      out.x = desk.x + desk.width - need - out.width;
      if (out.x < desk.x) out.x = desk.x;
    }
    if (out.x < desk.x) out.x = desk.x;
    if (out.y < desk.y) out.y = desk.y;
    if (out.height > desk.height) out.height = desk.height;
    try {
      m.setMinimumSize(Math.min(savedMain.min[0] || MAIN_MIN_WIDTH, out.width), savedMain.min[1] || 480);
      if (!noApply && (wasMax || wasFull || out.x !== b.x || out.y !== b.y || out.width !== b.width || out.height !== b.height)) m.setBounds(out);
    } catch (e) { log('визард: главное окно не подвинулось — ' + ((e && e.message) || e)); }
    return { bounds: out, desk };
  }

  function placeWizard(fit) {
    if (!win || win.isDestroyed()) return;
    const m = mainWin();
    if (!m) return;
    const mb = fit || m.getBounds();
    const desk = screen.getDisplayMatching(mb).workArea;
    const r = stage === 'center' ? centerRect(mb, desk, centerBig) : sideRect(mb, desk);
    try { win.setBounds(r); } catch (e) {}
  }

  // Пока идёт развилка, Тапёр недоступен: окно выключено (ни мышь, ни клавиши), сверху — затемнение.
  function blockMain(on) {
    const m = mainWin();
    if (!m) return;
    try { m.setEnabled(!on); } catch (e) {}
    sendMain('wizard-cmd', { op: 'block', on: !!on });
  }

  // Ответ на развилке: главное окно освобождается, визард уезжает в колонку сбоку,
  // главное при необходимости плавно сжимается/сдвигается одновременно с ним.
  // Обратно на центр поверх Тапёра (последний шаг стримера «Взаимодействие со зрителями»).
  function recenter(big) {
    if (!win || win.isDestroyed() || stage === 'center') return;
    const m = mainWin();
    if (!m) return;
    detachMain();
    stage = 'center';
    centerBig = !!big;
    blockMain(true);
    const mb = m.getBounds();
    const desk = screen.getDisplayMatching(mb).workArea;
    const from = win.getBounds();
    const to = centerRect(mb, desk, centerBig);
    const t0 = Date.now();
    clearInterval(animTimer);
    animTimer = setInterval(() => {
      const t = (Date.now() - t0) / DOCK_MS;
      const done = t >= 1;
      try { if (win && !win.isDestroyed()) win.setBounds(done ? to : lerpRect(from, to, t)); } catch (e) {}
      if (done) { clearInterval(animTimer); animTimer = null; try { if (win && !win.isDestroyed()) win.focus(); } catch (e) {} }
    }, 16);
  }

  function dock() {
    if (stage !== 'center' || !win || win.isDestroyed()) return;
    stage = 'side';
    forkLock = false;
    blockMain(false);
    const m = mainWin();
    if (!m) return;
    const fromMain = m.getBounds();
    const placed = prepareMain(true);
    const toMain = placed ? placed.bounds : m.getBounds();
    const desk = placed ? placed.desk : screen.getDisplayMatching(toMain).workArea;
    const fromWiz = win.getBounds();
    const toWiz = sideRect(toMain, desk);
    const moveMain = fromMain.x !== toMain.x || fromMain.y !== toMain.y || fromMain.width !== toMain.width || fromMain.height !== toMain.height;
    const t0 = Date.now();
    clearInterval(animTimer);
    animTimer = setInterval(() => {
      const t = (Date.now() - t0) / DOCK_MS;
      const done = t >= 1;
      try {
        if (win && !win.isDestroyed()) win.setBounds(done ? toWiz : lerpRect(fromWiz, toWiz, t));
        if (moveMain && mainWin()) m.setBounds(done ? toMain : lerpRect(fromMain, toMain, t));
      } catch (e) {}
      if (done) {
        clearInterval(animTimer);
        animTimer = null;
        attachMain();
        try { if (win && !win.isDestroyed()) win.focus(); } catch (e) {}
      }
    }, 16);
  }

  function followMain() {
    if (!win || win.isDestroyed()) return;
    clearTimeout(followTimer);
    followTimer = setTimeout(() => placeWizard(null), 40);
  }

  function restoreMain() {
    const m = mainWin();
    const s = savedMain;
    savedMain = null;
    if (!m || !s) return;
    try {
      m.setMinimumSize(s.min[0] || 900, s.min[1] || 600);
      m.setBounds(s.bounds);
      if (s.fullScreen) m.setFullScreen(true);
      else if (s.maximized) m.maximize();
    } catch (e) { log('визард: главное окно не вернулось — ' + ((e && e.message) || e)); }
  }

  function showWizard() {
    if (!win || win.isDestroyed() || !loaded) return;
    clearTimeout(showTimer);
    try { if (!win.isVisible()) win.show(); } catch (e) {}
    try { win.focus(); } catch (e) {}
  }

  function attachMain() {
    const m = mainWin();
    if (!m) return;
    try {
      m.on('move', followMain);
      m.on('resize', followMain);
      m.on('maximize', followMain);
      m.on('unmaximize', followMain);
    } catch (e) {}
  }
  function detachMain() {
    const m = mainWin();
    if (!m) return;
    for (const ev of ['move', 'resize', 'maximize', 'unmaximize']) {
      try { m.removeListener(ev, followMain); } catch (e) {}
    }
  }

  // ── Окно визарда ──────────────────────────────────────────────────────────
  function openWizard(opts) {
    const o = opts || {};
    currentFrom = o.from === 'settings' || o.from === 'debug' ? o.from : 'first';
    currentStep = typeof o.step === 'string' ? o.step.slice(0, 40) : '';
    currentRoute = o.route === 'listener' || o.route === 'streamer' ? o.route : null;
    const m = mainWin();
    if (!m) return { ok: false, error: 'нет главного окна' };
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) { try { win.restore(); } catch (e) {} }
      try { win.show(); win.focus(); } catch (e) {}
      sendEvt({ type: 'open', from: currentFrom, step: currentStep, route: currentRoute });
      sendFacts();
      return { ok: true, reopened: true };
    }
    stage = startsCentered(o) ? 'center' : 'side';
    forkLock = stage === 'center';
    centerBig = false;
    const placed = stage === 'center' ? null : prepareMain();
    const bounds = placed ? placed.bounds : m.getBounds();
    const dark = typeof themeBg === 'function' ? themeBg() : '';
    win = new BrowserWindow({
      width: WIZARD_WIDTH,
      height: Math.max(420, Math.min(bounds.height, 800)),
      minWidth: 320,
      minHeight: 420,
      parent: m,
      modal: false,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      autoHideMenuBar: true,
      title: 'Знакомство — Тапёр',
      backgroundColor: /^#[0-9a-f]{6}$/i.test(dark) ? dark : undefined,
      webPreferences: {
        preload: path.join(srcDir, 'wizard', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    loaded = false;
    placeWizard(bounds);
    if (stage === 'center') blockMain(true);
    else attachMain();
    sendMain('wizard-opened');

    win.webContents.on('did-finish-load', () => {
      loaded = true;
      // Тема могла уже прийти — отдаём сразу; иначе главное окно пришлёт её на wizard-opened.
      if (lastTheme) sendEvt({ type: 'theme', theme: lastTheme });
      sendEvt({ type: 'init', from: currentFrom, step: currentStep, route: currentRoute, facts: null });
      sendFacts();
      clearTimeout(showTimer);
      // Не показываем голое окно до темы: даём главному окну 350 мс, затем показываем как есть.
      showTimer = setTimeout(showWizard, 350);
    });
    win.once('ready-to-show', () => { placeWizard(bounds); });
    // На развилке окно не закрыть (Alt+F4): сначала ответ. При выходе из программы — можно.
    win.on('close', (e) => {
      if (forkLock && (typeof isQuitting !== 'function' || !isQuitting())) e.preventDefault();
    });
    win.on('closed', () => {
      clearInterval(animTimer);
      animTimer = null;
      if (stage === 'center') blockMain(false);
      stage = 'side';
      detachMain();
      clearTimeout(followTimer);
      clearTimeout(showTimer);
      win = null;
      loaded = false;
      restoreMain();
      sendMain('wizard-cmd', { op: 'clear' });
      sendMain('wizard-closed');
      if (typeof isQuitting !== 'function' || !isQuitting()) markDone();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadFile(path.join(srcDir, 'wizard', 'index.html'));
    return { ok: true };
  }

  // ── Каналы ────────────────────────────────────────────────────────────────
  // Раздел Настроек (id секции вида sStream, sOrders) — для подсветки кнопок прямо в Настройках.
  function cleanPane(p) { return typeof p === 'string' && /^s[A-Z][A-Za-z]{1,20}$/.test(p) ? p : ''; }
  function sanitizeCmd(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const op = String(c.op || '');
    if (op === 'highlight') {
      const tab = allowedTab(c.tab) ? String(c.tab) : '';
      const sel = typeof c.sel === 'string' ? c.sel.slice(0, 240) : '';
      if (!tab && !sel) return null;
      const pane = cleanPane(c.pane);
      return pane ? { op, tab, sel, pane } : { op, tab, sel };
    }
    if (op === 'tab') {
      if (!allowedTab(c.tab)) return null;
      const pane = cleanPane(c.pane);
      return pane ? { op, tab: String(c.tab), pane } : { op, tab: String(c.tab) };
    }
    if (op === 'clear' || op === 'bg' || op === 'dock') return { op };
    if (op === 'center') return { op, big: c.big === true };
    if (op === 'set') {
      const key = typeof c.key === 'string' ? c.key.slice(0, 60) : '';
      if (!key) return null;
      let value = c.value;
      try { value = JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
      return { op, key, value };
    }
    // Действие шага: главное окно выполняет его, только если шаг зарегистрировал такое имя
    // (wizardAction в src/ui/31-wizard.js). Имя — короткое слово, аргументы — небольшие данные.
    if (op === 'do') {
      const name = typeof c.name === 'string' && /^[a-z][a-zA-Z0-9]{0,39}$/.test(c.name) ? c.name : '';
      if (!name) return null;
      let args = c.args == null ? null : c.args;
      try { args = JSON.parse(JSON.stringify(args)); } catch (e) { return null; }
      if (args != null && JSON.stringify(args).length > 20000) return null;
      return { op, name, args };
    }
    return null;
  }

  ipcMain.handle('wizard-open', (e, opts) => {
    const m = mainWin();
    if (!m || e.sender !== m.webContents) return { ok: false, error: 'forbidden' };
    return openWizard(opts || {});
  });
  ipcMain.handle('wizard-close', (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return { ok: false };
    try { win.close(); } catch (err) {}
    return { ok: true };
  });
  ipcMain.on('wizard-cmd', (e, raw) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    const cmd = sanitizeCmd(raw);
    if (!cmd) return;
    if (cmd.op === 'dock') { dock(); return; }
    if (cmd.op === 'center') { recenter(cmd.big); return; }
    sendMain('wizard-cmd', cmd);
  });
  ipcMain.on('wizard-event', (e, evt) => {
    const m = mainWin();
    if (!m || e.sender !== m.webContents) return;
    if (!evt || typeof evt !== 'object') return;
    let safe;
    try { safe = JSON.parse(JSON.stringify(evt)); } catch (err) { return; }
    sendEvt(safe);
  });
  ipcMain.on('wizard-theme', (e, theme) => {
    const m = mainWin();
    if (!m || e.sender !== m.webContents) return;
    if (!theme || typeof theme !== 'object') return;
    lastTheme = theme;
    sendEvt({ type: 'theme', theme });
    showWizard();
  });

  // Первый запуск: открываем сами после загрузки главного окна. Повторно — никогда.
  function maybeOpenOnFirstRun(opts) {
    if (autoTried || !shouldOpenOnStart(opts || {})) return false;
    autoTried = true;
    const m = mainWin();
    if (!m) return false;
    const go = () => openWizard({ from: 'first' });
    try {
      if (m.webContents.isLoading()) m.webContents.once('did-finish-load', go);
      else go();
    } catch (e) { log('визард: первый запуск — ' + ((e && e.message) || e)); }
    return true;
  }

  return { maybeOpenOnFirstRun, openWizard };
}
