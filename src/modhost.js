'use strict';
// Хозяин модулей: подключает пак стримера (modules/streamer-pack) и даёт ему мост ядра.
// Модули пака — из манифеста: чат-бот Twitch (bot), оверлей-плейлист для OBS (overlay).
// Как устроен мост — tapyor-modules/docs/ARCHITECTURE.md. План по платным модулям — docs/MODULES-LICENSING.md.
// Правила: модуль не лезет во внутренности ядра — только через мост; токены не пишутся в лог.

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const packs = require('./packs');
const license = require('./license');
const licClient = require('./license-client');
const schedule = require('./license-schedule');
const userData = require('./user-data');
const { CLOUD_KEY, CLOUD_KEY_HEADER } = require('./cloud-key');

const PACK_ID = 'streamer-pack';
const TRIAL_DAYS = 30;
const DAY = 86400000;
const TWITCH_HOST = /^https:\/\/([a-z0-9-]+\.)*twitch\.tv(\/|$)/i;

// Где лежит пак (docs/PLAN-MODULES-SPLIT.md, этап 2):
// - собранный Тапёр — только установленный кнопкой: <папка данных>/modules/streamer-pack/<версия>/ (подпись проверена при установке);
// - запуск из исходников (режим разработки) — соседняя папка Tapyor-modules/streamer-pack, иначе копия modules/streamer-pack.
let packRoot = '';
function devPackDir() {
  for (const d of [path.join(__dirname, '..', '..', 'Tapyor-modules', PACK_ID), path.join(__dirname, '..', 'modules', PACK_ID)]) {
    if (fs.existsSync(path.join(d, 'manifest.json'))) return d;
  }
  return '';
}
function isDev() { try { return !require('electron').app.isPackaged; } catch (e) { return true; } }
let legacyLogged = false;   // B10: строку о старой установке пака пишем один раз за запуск
let legacyLog = null;        // журнал хозяина модулей: resolvePack вызывается и до setup — тогда молчим
function resolvePack() {
  if (isDev()) {
    const d = devPackDir();
    if (d) { try { return { dir: d, manifest: JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')), dev: true }; } catch (e) {} }
  }
  if (!packRoot) { try { packRoot = path.join(require('electron').app.getPath('userData'), 'modules'); } catch (e) { return null; } }
  // M6 (P5b): при каждом запуске перепроверяем подпись установленной версии и хеши её файлов.
  // Папка данных доступна на запись пользователю — без проверки подменённый файл модуля исполнялся бы.
  const v = packs.verifyInstalled(packRoot, PACK_ID, license.PACK_PUBKEYS);
  if (v.ok) {
    if (v.legacy && !legacyLogged && legacyLog) { legacyLogged = true; legacyLog('модули: пак поставлен старой версией Тапёра, подпись при запуске не проверяется — переустановите пак'); }
    return { dir: v.dir, manifest: v.manifest, prev: v.prev, dev: false, legacy: !!v.legacy };
  }
  if (v.notInstalled) return null;
  const c = packs.current(packRoot, PACK_ID);
  return { broken: true, error: v.error || packs.BROKEN, dir: (c && c.dir) || '', manifest: (c && c.manifest) || null, prev: (c && c.prev) || null, dev: false };
}
// Есть ли пак стримера: пункт трея «Показать журнал чат-бота» — только тогда.
function packInstalled() { const p = resolvePack(); return !!(p && !p.broken); }
function verCmp(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }

// Самый свежий НЕПУСТОЙ файл журнала бота — для пункта в трее «Показать журнал чат-бота».
// Пустой файл открывать незачем: смотреть в нём нечего. null — журнала ещё нет.
function latestJournal(dir) {
  try {
    const jdir = path.join(dir, 'bot-journal');
    let best = null, bestT = -1;
    for (const f of fs.readdirSync(jdir)) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(jdir, f);
      let st; try { st = fs.statSync(p); } catch (e) { continue; }
      if (!st.size) continue;
      if (st.mtimeMs >= bestT) { bestT = st.mtimeMs; best = p; }
    }
    return best;
  } catch (e) { return null; }
}

// Журнал бота — файлы по дням в папке данных, хранится 7 дней. Тексты чата — только здесь.
function makeJournal(dir, log) {
  const jdir = path.join(dir, 'bot-journal');
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  try { fs.mkdirSync(jdir, { recursive: true }); } catch (e) { log('бот: папка журнала не создана — ' + e.message); }
  try {
    const keep = new Set([0, 1, 2, 3, 4, 5, 6].map((d) => day(Date.now() - d * DAY) + '.jsonl'));
    for (const f of fs.readdirSync(jdir)) if (!keep.has(f)) fs.rmSync(path.join(jdir, f), { force: true });
  } catch (e) { log('бот: журнал — ' + e.message); }
  return {
    load() {
      try {
        const files = fs.readdirSync(jdir).sort().slice(-2);
        const out = [];
        for (const f of files) for (const line of fs.readFileSync(path.join(jdir, f), 'utf8').split('\n')) { if (line) try { out.push(JSON.parse(line)); } catch (e) {} }
        return out.slice(-300);
      } catch (e) { return []; }
    },
    append(entry) { try { fs.appendFileSync(path.join(jdir, day(entry.at) + '.jsonl'), JSON.stringify(entry) + '\n'); } catch (e) { log('бот: запись журнала не удалась — ' + ((e && e.message) || e)); } }
  };
}

// Секреты модулей: у каждого модуля своя «полка» modSecure.<пак>.<модуль>.<ключ> (TAP-19/BOT-19) —
// один модуль не читает и не перезаписывает секреты другого. До 0.32.0 полка была общая (modSecure.<ключ>),
// там лежат входы бота в Twitch: при первом чтении бот получает их копией на свою полку.
// Старую запись не стираем — чтобы откат на старую версию не разлогинил бота; новое ядро её никому не отдаёт.
const LEGACY_SECURE_OWNER = 'bot';

// ---------- защита часов: записи вне settings.json (M3, аудит 0.32.0) ----------
// Самая поздняя виденная дата пишется ещё в два места: файл в папке данных и реестр HKCU. Действует самая поздняя.
// Подменить settings.json или его копию .bak теперь мало. Ошибки чтения/записи — молча 0: это не повод ломать запуск.
const REG_KEY = 'HKCU\\Software\\Tapyor', REG_VAL = 'lcm';
function clockFile() { try { return path.join(require('electron').app.getPath('userData'), 'lic-clock.dat'); } catch (e) { return ''; } }
function clockFileRead() { try { return Number(fs.readFileSync(clockFile(), 'utf8').trim()) || 0; } catch (e) { return 0; } }
function clockFileWrite(v) { try { const f = clockFile(); if (f && v > clockFileRead()) fs.writeFileSync(f, String(Math.floor(v))); } catch (e) { /* нет прав — не страшно */ } }
function regRun(args) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(''); return; }
    require('child_process').execFile('reg.exe', args, { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out || '')));
  });
}
async function clockRegRead() { const m = /lcm\s+REG_SZ\s+(\d+)/i.exec(await regRun(['query', REG_KEY, '/v', REG_VAL])); return m ? Number(m[1]) || 0 : 0; }
async function clockRegWrite(v) { if (v > await clockRegRead()) await regRun(['add', REG_KEY, '/v', REG_VAL, '/t', 'REG_SZ', '/d', String(Math.floor(v)), '/f']); }
// L6 (аудит 0.32.0): секрет модуля хранится только в зашифрованном виде (safeStorage → хранилище Windows).
// Раньше без шифрования писали base64 — это не шифрование, токены Twitch читались бы кем угодно.
// Теперь: шифрования нет — не сохраняем (возвращаем ошибку в журнал), старые незашифрованные записи
// не считаем действующими и удаляем: иначе после «входа» ими можно было бы пользоваться.
const NO_CRYPTO = 'шифрование Windows недоступно — вход не сохранён, войдите заново при следующем запуске';
function makeSecure(store, safeStorage, id, log) {
  const say = typeof log === 'function' ? log : () => {};
  const key = (k) => 'modSecure.' + PACK_ID + '.' + id + '.' + String(k);
  const enc = () => !!(safeStorage && safeStorage.isEncryptionAvailable());
  // Убрать запись и её старый общий дубль (только у бота: до 0.32.0 секреты лежали на общей полке)
  const drop = (k) => {
    if (store.get(key(k))) store.set(key(k), '');
    if (id === LEGACY_SECURE_OWNER && store.get('modSecure.' + String(k))) store.set('modSecure.' + String(k), '');
  };
  return {
    get: async (k) => {
      let v = store.get(key(k));
      if (v === undefined && id === LEGACY_SECURE_OWNER) {
        const old = store.get('modSecure.' + String(k));
        if (typeof old === 'string' && old) { store.set(key(k), old); v = old; }
      }
      if (!v) return null;
      if (!enc()) {
        drop(k);
        say('модули: секрет «' + id + '» не прочитан — ' + NO_CRYPTO + '; старая запись удалена');
        return null;
      }
      try { return safeStorage.decryptString(Buffer.from(v, 'base64')); }
      catch (e) {
        // Запись не расшифровалась — скорее всего это старый base64 без шифрования. Не действует.
        drop(k);
        say('модули: секрет «' + id + '» не расшифрован — старая незашифрованная запись удалена (' + ((e && e.message) || e) + ')');
        return null;
      }
    },
    set: async (k, v) => {
      if (!v) { store.set(key(k), ''); return { ok: true }; } // выход: стирать можно и без шифрования
      if (!enc()) { say('модули: секрет «' + id + '» не сохранён — ' + NO_CRYPTO); return { ok: false, error: NO_CRYPTO }; }
      try { store.set(key(k), safeStorage.encryptString(String(v)).toString('base64')); return { ok: true }; }
      catch (e) {
        const msg = 'не удалось зашифровать — вход не сохранён: ' + ((e && e.message) || e);
        say('модули: секрет «' + id + '» ' + msg);
        return { ok: false, error: msg };
      }
    }
  };
}

// deps: { app, ipcMain, shell, safeStorage, store, log, send(ch, data), findOrder(text, opts), checkTrack(track, opts), addRequest(record),
//         mount(prefix, fn), unmount(prefix), pageUrl(path), localCover(url) }
function setup(deps) {
  const { app, ipcMain, shell, safeStorage, store, log, send } = deps;
  legacyLog = typeof log === 'function' ? log : null;
  packRoot = path.join(app.getPath('userData'), 'modules');
  const state = { pack: null, manifest: null, bot: null, error: null, license: null, pending: new Map(), orders: new Map(), queueLeft: 0, queueKeys: null, mods: {}, busy: false, keyMask: '' };
  // M4 (аудит 0.32.0): ключ покупки — не в открытом settings.json, а на зашифрованной полке ядра
  // (modSecure.streamer-pack.core.licenseKey: get-setting её не отдаёт). Старая запись modLicenseKey переносится и стирается.
  const coreSecure = makeSecure(store, safeStorage, 'core', log);
  // Маска ключа: первые 9 знаков и «-••••». Обрезаем хвостовой дефис — иначе выходило «TPR-AB12--••••»
  const maskKey = (k) => (k ? String(k).slice(0, 9).replace(/-+$/, '') + '-••••' : '');
  async function licKey() {
    let k = await coreSecure.get('licenseKey');
    const old = store.get('modLicenseKey');
    if (!k && old) {
      // Перенос только при успешной записи: без шифрования ключ не сохранится, и старую запись не теряем зря.
      const r = await coreSecure.set('licenseKey', old);
      if (r && r.ok !== false) { k = old; store.set('modLicenseKey', ''); log('модули: ключ перенесён в зашифрованное хранилище'); }
    }
    state.keyMask = maskKey(k);
    return k || '';
  }
  async function setLicKey(k) {
    const r = await coreSecure.set('licenseKey', k || '');
    if (r && r.ok === false) log('модули: ключ покупки не сохранён — ' + r.error);
    else store.set('modLicenseKey', '');
    state.keyMask = maskKey(k);
  }
  state.pack = resolvePack(); state.manifest = state.pack && state.pack.manifest;
  const em = new EventEmitter();
  const status = () => ({
    installed: !!state.manifest, manifest: state.manifest, running: !!state.bot, error: state.error,
    broken: !!(state.pack && state.pack.broken),
    legacy: !!(state.pack && state.pack.legacy),   // B10: пак без signature.json — работает, просим переустановить
    license: state.license, dev: !!(state.pack && state.pack.dev), prev: (state.pack && state.pack.prev) || null,
    server: !!licClient.serverUrl(store), busy: state.busy, keyMask: state.keyMask,
    modules: Object.fromEntries(((state.manifest && state.manifest.modules) || []).map((m) => [m.id, { name: m.name, running: !!(state.mods[m.id] && state.mods[m.id].inst), error: (state.mods[m.id] && state.mods[m.id].error) || null }]))
  });

  // ---------- плеер для страниц модулей (оверлей) ----------
  // Окно шлёт снимок «что играет» (mod-player) и уровень звука (mod-level), только пока модуль просит (mod-player-want):
  // никто не смотрит оверлей — окно ничего не собирает и не шлёт.
  const playerEm = new EventEmitter();
  let lastSnap = null;
  const wants = {};
  let wantSent = '';
  function sendWant() {
    const w = { state: false, levels: false };
    for (const k in wants) { if (wants[k].state) w.state = true; if (wants[k].levels) w.levels = true; }
    const sig = JSON.stringify(w);
    if (sig === wantSent) return;
    wantSent = sig;
    send('mod-player-want', w);
  }
  function playerFor(id) {
    return {
      on: (ev, fn) => { playerEm.on(ev, fn); if (ev === 'state' && lastSnap) fn(lastSnap); return () => playerEm.off(ev, fn); },
      get: () => lastSnap,
      want: (w) => { wants[id] = { state: !!(w && w.state), levels: !!(w && w.levels) }; sendWant(); },
      // обложка своего файла с компьютера (/lcover/…): страница OBS её сама не получит — отдаёт модуль
      coverImage: (u) => (deps.localCover ? deps.localCover(u) : Promise.resolve(null)),
      skip: () => send('bot-skip')
    };
  }
  // Страницы модулей на локальном сервере ядра: только GET, префикс — одно слово (/overlay)
  const http = {
    mount: (prefix, fn) => {
      if (!/^\/[a-z0-9-]{2,32}$/.test(String(prefix)) || ['/widget', '/lfile', '/lcover', '/assets', '/ui.js'].includes(prefix)) throw new Error('модули: недопустимый адрес страницы ' + prefix);
      if (!deps.mount) throw new Error('модули: сервер страниц недоступен');
      deps.mount(prefix, fn);
    },
    unmount: (prefix) => { if (deps.unmount) deps.unmount(prefix); },
    url: (p) => (deps.pageUrl ? deps.pageUrl(p) : '')
  };

  const secureFor = (id) => makeSecure(store, safeStorage, id, log);
  const core = {
    version: app.getVersion(),
    log: (t) => log(String(t)),
    settings: { get: (k) => store.get('mod.' + k), set: (k, v) => store.set('mod.' + k, v) },
    openExternal: (url) => { if (TWITCH_HOST.test(String(url))) shell.openExternal(url); else log('бот: ссылка не Twitch — не открываю'); },
    findOrder: (text, opts) => deps.findOrder(text, opts || {}),
    checkTrack: (track, opts) => deps.checkTrack(track, opts || {}),
    orders: {
      // Заказ бота = карточка во вкладке «Заказы» (как донат). Автоматические сразу встают в очередь —
      // окно подтверждает место (bot-placed). Ждём подтверждение не дольше 3 с.
      add: (o) => new Promise((resolve) => {
        const id = (o.prov === 'twitch-points' ? 'tp' : 'tc') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const key = o.prov + ':' + id;
        const auto = !o.needsApproval && !o.doubt;
        const rec = {
          prov: o.prov, id, key, name: (o.user && o.user.login) || 'зритель', text: o.text || '', amount: null, currency: '',
          items: [{ level: o.doubt ? 'doubt' : 'exact', track: o.track, alts: o.alts || [], flags: [], paid: true }],
          level: o.doubt ? 'doubt' : 'exact', state: 'new', got: Date.now(), bot: true, botAuto: auto
        };
        state.orders.set(key, { prov: o.prov, st: 'pending', user: o.user, auto });
        const done = (r) => { if (state.pending.has(key)) { state.pending.delete(key); resolve({ id: key, place: r.place, etaSec: r.etaSec }); } };
        state.pending.set(key, done);
        deps.addRequest(rec);
        setTimeout(() => done({ place: null, etaSec: null }), 3000);
      }),
      remove: (id) => send('bot-remove', id),
      has: (id) => {
        const x = state.orders.get(id);
        // Ручное подтверждение и «сомнение» ещё не в очереди, но уже занимают лимит.
        // Фильтр по ключам очереди — только для автоматически поставленных заказов.
        return !!(x && x.st === 'pending' && (!x.auto || !state.queueKeys || state.queueKeys.has(id)));
      },
      count: (prov) => {
        if (prov === 'any') return state.queueLeft;
        let n = 0;
        for (const [key, x] of state.orders) {
          if (x.st === 'pending' && x.prov === prov && (!x.auto || !state.queueKeys || state.queueKeys.has(key))) n++;
        }
        return n;
      }
    },
    health: { set: (id, st, text, action) => send('qc-item', { id, state: st, text, action }) },
    journal: makeJournal(app.getPath('userData'), log),
    on: (ev, fn) => em.on(ev, fn),
    http
  };
  // Каждому модулю — тот же мост, но свой «плеер» (у каждого своя просьба want)
  // и свой «пульт с телефона» (dock2 + лента первой панели + QR, docs/REMOTE.md).
  const coreFor = (id) => Object.assign(Object.create(core), { player: playerFor(id), secure: secureFor(id), remote: deps.remote ? deps.remote.forModule(id) : undefined });

  // ---------- события от окна ----------
  ipcMain.on('bot-placed', (e, key, place, etaSec) => { const f = state.pending.get(key); if (f) f({ place, etaSec }); });
  ipcMain.on('bot-order', (e, type, key, extra) => {
    const o = state.orders.get(key); if (!o) return;
    if (type === 'played' && o.st === 'pending') { o.st = 'played'; em.emit('order:played', key); }
    else if (type === 'dropped' && o.st === 'pending') { o.st = 'dropped'; em.emit('order:dropped', key, extra || 'removed'); }
    else if (type === 'ban' && o.st === 'pending') { o.st = 'dropped'; em.emit('order:ban', key, Number(extra) || 10); }
    if (state.orders.size > 500) for (const [k, x] of state.orders) { if (x.st !== 'pending') state.orders.delete(k); if (state.orders.size <= 300) break; }
  });
  ipcMain.on('bot-queue', (e, left, keys) => {
    state.queueLeft = Number(left) || 0;
    if (Array.isArray(keys)) state.queueKeys = new Set(keys);
    if (state.bot && typeof state.bot.reconcileOrders === 'function') state.bot.reconcileOrders();
  });
  ipcMain.handle('mod-status', () => status());
  ipcMain.handle('bot-cmd', async (e, cmd, data) => {
    if (!state.bot) throw new Error(state.error || 'Чат-бот не запущен');
    return state.bot.command(cmd, data);
  });
  // Окно настроек модуля ↔ его половина в главном процессе (оверлей и следующие модули)
  ipcMain.handle('mod-cmd', async (e, id, cmd, data) => {
    const m = state.mods[String(id)];
    if (!m || !m.inst) throw new Error((m && m.error) || 'Модуль не запущен');
    return m.inst.command(cmd, data);
  });
  ipcMain.on('mod-player', (e, snap) => { lastSnap = snap && typeof snap === 'object' ? snap : null; playerEm.emit('state', lastSnap); });
  ipcMain.on('mod-level', (e, x) => { playerEm.emit('level', Number(x) || 0); });
  ipcMain.on('mod-spectrum', (e, a) => {
    if (!Array.isArray(a)) return;
    const arr = a.slice(0, 32).map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
    playerEm.emit('spectrum', arr);
  });

  // ---------- лицензия (этап 1–2: настоящий привратник вместо заглушки) ----------
  // Время сервера для защиты часов (M3): не чаще раза в сутки (L11), остальные пересчёты идут по локальным
  // записям. Неудачный запрос кэшируется так же — не долбим сервер каждый час.
  const serverTime = schedule.createTimeCache({ load: () => licClient.serverTime(licOpts()) });
  // Отпечаток читается ~1 с (PowerShell) — только здесь, в фоне после запуска, и кэшируется до выхода.
  async function licenseState() {
    if (state.pack && state.pack.dev) return { enabled: true, state: 'dev', daysLeft: null, trialDays: TRIAL_DAYS };
    const fp = await license.fingerprint();
    const tokens = licClient.tokens(store, PACK_ID);
    await licKey(); // перенос старого ключа (M4) и маска для экрана
    // M3: самая поздняя дата из всех мест + время сервера (если есть сеть)
    const [reg, net] = await Promise.all([clockRegRead(), serverTime.get()]);
    const extra = Math.max(clockFileRead(), reg, license.latestIat(tokens), net);
    const now = Date.now();
    const clock = license.clockCheck(store, now, extra);
    if (clock.ok) {
      const mx = Math.max(now, extra, Number(store.get('licClockMax')) || 0);
      clockFileWrite(mx);
      // Реестр HKCU\Software\Tapyor общий для всех профилей: из тестового профиля
      // часы лицензий не пишем, иначе он сдвинет защиту настоящего профиля.
      if (!userData.isTestProfileActive()) clockRegWrite(mx).catch(() => {});
    }
    else log('модули: часы компьютера отстают от самой поздней виденной даты — пробный период на паузе');
    const mods = (state.manifest && state.manifest.modules) || [];
    const minEd = mods.reduce((m, x) => Math.min(m, Number(x.sinceEdition) || 1), 99) || 1;
    const g = license.gate({ tokens, pack: PACK_ID, fp: fp.parts, sinceEdition: minEd, clockOk: clock.ok });
    return Object.assign({ trialDays: TRIAL_DAYS, fpOk: fp.ok, fpCode: license.fpCode(fp.parts) }, g);
  }
  const LIC_TEXT = { full: 'куплен', trial: 'пробный', 'trial-ended': 'пробный период закончился', none: 'не активирован',
    'other-pc': 'лицензия от другого компьютера', clock: 'часы компьютера переведены назад', edition: 'нужна новая редакция пака', dev: 'режим разработки' };

  // Строка лицензии в чеклисте — одинаково при запуске и при часовом пересчёте
  // Пак не включён (пробного нет, закончился, ключа нет) — это не ошибка Тапёра: серая строка, не «проблема»
  // (16.11.2026, замечание владельца). Жёлтым — только пробный на исходе и переведённые назад часы.
  function sendLicenseLine(L) {
    send('qc-item', { id: 'bot.license', state: L.enabled ? (L.state === 'trial' && L.daysLeft <= 3 ? 'warn' : 'ok') : (L.state === 'clock' ? 'warn' : 'off'),
      text: (LIC_TEXT[L.state] || L.state) + (L.state === 'trial' ? ' · ' + L.daysLeft + ' дн.' : '') });
  }
  // Модули на паузу тем же путём, что при запуске без лицензии: остановить их и снять награду за баллы.
  async function pauseModules() {
    await stop();
    const bm = ((state.manifest && state.manifest.modules) || []).find((m) => m.id === 'bot');
    if (bm) {
      try {
        const file = path.resolve(state.pack.dir, String(bm.main || ''));
        const mod = require(file);
        if (typeof mod.licenseOff === 'function') await mod.licenseOff(coreFor('bot'));
      } catch (e) { log('модули: пауза награды — ' + e.message); }
    }
    send('mod-status', status());
  }
  // L11: раз в час пересчитываем состояние лицензии; сработавший таймер сам себя снимает,
  // когда лицензия кончилась. unref — таймер не держит программу открытой.
  let licTimer = null, licCheckAt = 0;
  function stopLicTimer() { if (licTimer) { clearInterval(licTimer); licTimer = null; } }
  function startLicTimer() {
    stopLicTimer();
    licTimer = setInterval(() => { licTick().catch(() => {}); }, schedule.LICENSE_RECHECK_MS);
    if (licTimer && typeof licTimer.unref === 'function') licTimer.unref();
  }
  async function licTick() {
    if (!state.manifest || (state.pack && state.pack.dev)) return;
    const now = Date.now();
    if (!schedule.licenseRecheckDue(licCheckAt, now)) return;
    licCheckAt = now;
    try {
      const L = await licenseState();
      state.license = L;
      sendLicenseLine(L);
      send('mod-status', status());
      if (!L.enabled) {
        log('модули: лицензия перестала действовать (' + (LIC_TEXT[L.state] || L.state) + ') — модули на паузе');
        stopLicTimer();
        await pauseModules();
      }
    } catch (e) { log('модули: пересчёт лицензии — ' + ((e && e.message) || e)); }
  }

  async function start() {
    stopLicTimer();
    state.pack = resolvePack(); state.manifest = state.pack && state.pack.manifest; state.error = null;
    // M6: подпись/файлы установленного пака не совпали — модули не запускаем, честно говорим почему.
    if (state.pack && state.pack.broken) {
      state.error = state.pack.error || packs.BROKEN;
      state.license = { enabled: false, state: 'broken' };
      log('модули: ' + state.error);
      send('mod-status', status());
      return;
    }
    if (!state.manifest) { state.license = { enabled: false, state: 'not-installed' }; send('mod-status', status()); return; }
    if (verCmp(app.getVersion(), state.manifest.minCore || '0.0.0') < 0) { state.error = 'нужен Тапёр ' + state.manifest.minCore + ' или новее'; send('mod-status', status()); return; }
    try { state.license = await licenseState(); } catch (e) { state.license = { enabled: false, state: 'none', error: e.message }; log('модули: лицензия — ' + e.message); }
    const L = state.license;
    sendLicenseLine(L);
    log('модули: пак ' + state.manifest.version + (state.pack.dev ? ' (разработка)' : '') + ' — лицензия: ' + (LIC_TEXT[L.state] || L.state));
    if (!L.enabled) {
      // Модули не запускаются; награда за баллы на Twitch — на паузу (настройки и вход сохраняются)
      await pauseModules();
      return;
    }
    for (const m of state.manifest.modules || []) {
      try {
        const file = path.resolve(state.pack.dir, String(m.main || ''));
        if (!file.startsWith(path.resolve(state.pack.dir) + path.sep)) throw new Error('путь модуля вне пака');
        const inst = await require(file).activate(coreFor(m.id));
        state.mods[m.id] = { inst, error: null };
        if (m.id === 'bot') state.bot = inst;
        log('модули: ' + (m.name || m.id) + ' — запущен (пак ' + state.manifest.version + ')');
      } catch (e) {
        state.mods[m.id] = { inst: null, error: e.message };
        if (m.id === 'bot') state.error = e.message;
        log('модули: ' + (m.name || m.id) + ' — не запустился: ' + e.message);
      }
    }
    send('mod-status', status());
    // L11: пока лицензия действует — раз в час пересчитываем (триал может кончиться во время работы).
    // В режиме разработки лицензии нет — таймер не нужен.
    if (!(state.pack && state.pack.dev)) { licCheckAt = Date.now(); startLicTimer(); }
  }
  async function stop() {
    stopLicTimer();
    for (const id in state.mods) { const m = state.mods[id]; if (m.inst && m.inst.stop) { try { await m.inst.stop(); } catch (e) {} } }
    state.mods = {}; state.bot = null;
  }
  async function restart() { await stop(); await start(); return status(); }

  // «Кто принимает заказы из чата» (0.35, Э4): пак про Streamer.bot не знает, он понимает
  // только своё accepting. Всегда пишем mod.bot.accepting — при следующем запуске бот
  // прочитает это сам (modules/streamer-pack/bot/src/bot.js:76,131). Если бот уже работает,
  // зовём его же команду save: он замолчит, а награда за баллы встанет на паузу
  // (saveSettings, bot.js:77–91). Правки пака не нужны — это его публичная команда.
  // Вызовы save идут строго по очереди: он ходит на Twitch за наградой, и два быстрых
  // переключения иначе могли прийти в обратном порядке (проверено вживую 12.11).
  let acceptChain = Promise.resolve();
  function setAccepting(on) {
    const val = !!on;
    const cur = store.get('mod.bot');
    const s = Object.assign({}, cur && typeof cur === 'object' ? cur : {}, { accepting: val });
    store.set('mod.bot', s);
    const step = () => {
      if (!state.bot || typeof state.bot.command !== 'function') return Promise.resolve();
      // Берём значение из настроек В МОМЕНТ выполнения, а не то, что было при вызове: пока
      // идёт медленный save (поход на Twitch за наградой), человек мог переключить ещё раз.
      const now = store.get('mod.bot');
      const latest = !(now && now.accepting === false);
      return Promise.resolve(state.bot.command('save', { accepting: latest }))
        .catch((e) => log('бот: приём переключён в настройках, но модуль не ответил — ' + ((e && e.message) || e)));
    };
    acceptChain = acceptChain.then(step, step);
    return acceptChain.then(() => ({ ok: true, accepting: val }));
  }

  // ---------- установка пака и лицензии (экран «Модули», этап 3) ----------
  const netFetch = (u, o) => require('electron').net.fetch(u, o);
  const PACKS_INDEX = 'https://alexshikaka.github.io/tapyor-web/packs.json';
  const busy = async (fn) => { if (state.busy) return { ok: false, error: 'уже выполняется — подожди' }; state.busy = true; send('mod-status', status()); try { return await fn(); } finally { state.busy = false; send('mod-status', status()); } };
  function installBuf(buf) {
    const r = packs.install(buf, { root: packRoot, pubkeys: license.PACK_PUBKEYS, coreVersion: app.getVersion(), expectId: PACK_ID });
    log('модули: установка пака — ' + (r.ok ? r.manifest.id + ' ' + r.manifest.version + (r.from ? ' (было ' + r.from + ')' : '') : r.error));
    return r;
  }
  async function packIndex() {
    const url = String(store.get('packsIndexUrl') || PACKS_INDEX);
    const r = await netFetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('список паков: HTTP ' + r.status);
    return packs.parseIndex(await r.text());
  }
  ipcMain.handle('pack-check', async () => {
    try {
      const list = await packIndex();
      const p = list.find((x) => x.id === PACK_ID);
      const cur = state.manifest && !state.pack.dev ? state.manifest.version : null;
      return { ok: true, latest: p || null, installed: cur, update: !!(p && (!cur || verCmp(p.version, cur) > 0)), coreOk: !p || verCmp(app.getVersion(), p.minCore || '0.0.0') >= 0 };
    } catch (e) { return { ok: false, error: 'не удалось узнать о паке: ' + e.message }; }
  });
  ipcMain.handle('pack-install', () => busy(async () => {
    let p;
    try { p = (await packIndex()).find((x) => x.id === PACK_ID); } catch (e) { return { ok: false, error: 'не удалось получить список паков: ' + e.message }; }
    if (!p) return { ok: false, error: 'пак пока не опубликован' };
    let buf;
    try {
      const r = await netFetch(p.url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) { return { ok: false, error: 'не удалось скачать пак: ' + e.message }; }
    const res = installBuf(buf);
    if (res.ok) await restart();
    return res.ok ? { ok: true, version: res.manifest.version } : res;
  }));
  ipcMain.handle('pack-rollback', () => busy(async () => { const r = packs.rollback(packRoot, PACK_ID); if (r.ok) await restart(); return r; }));
  ipcMain.handle('pack-remove', () => busy(async () => { await stop(); const r = packs.remove(packRoot, PACK_ID); await start(); return r; }));

  const licOpts = () => ({ fetch: netFetch, store, cloudKey: CLOUD_KEY, keyHeader: CLOUD_KEY_HEADER });
  ipcMain.handle('lic-trial', () => busy(async () => {
    const fp = await license.fingerprint();
    if (!fp.ok) return { ok: false, error: licClient.ERRORS['bad-fp'] };
    const r = await licClient.call('trial', { pack: PACK_ID, fp: fp.parts }, licOpts());
    log('модули: пробный период — ' + (r.ok ? 'выдан' : r.code));
    if (!r.ok) return r;
    licClient.saveToken(store, PACK_ID, r.token);
    await restart();
    return { ok: true };
  }));
  ipcMain.handle('lic-activate', (e, key) => busy(async () => {
    const k = licClient.normKey(key);
    if (!k) return { ok: false, error: 'ключ выглядит не так: TPR-XXXX-XXXX-XXXX' };
    const fp = await license.fingerprint();
    if (!fp.ok) return { ok: false, error: licClient.ERRORS['bad-fp'] };
    const r = await licClient.call('activate', { pack: PACK_ID, fp: fp.parts, key: k }, licOpts());
    log('модули: активация — ' + (r.ok ? 'успешно' : r.code));
    if (!r.ok) return r;
    licClient.saveToken(store, PACK_ID, r.token);
    await setLicKey(k);
    await restart();
    return { ok: true };
  }));
  // M7 (аудит 0.32.0): лицензия здесь удаляется только после ответа сервера «готово». Любая ошибка — лицензия
  // остаётся, человек видит причину. Ключа нет (лицензия вставлена вручную) — место на сервере освобождает автор.
  ipcMain.handle('lic-deactivate', () => busy(async () => {
    const k = await licKey();
    if (!k) return { ok: false, manual: true, error: 'эта лицензия вставлена вручную — место на сервере освобождает автор Тапёра. Напиши ему код этого компьютера; лицензия здесь пока остаётся' };
    const fp = await license.fingerprint();
    const r = await licClient.call('deactivate', { pack: PACK_ID, fp: fp.parts, key: k }, Object.assign(licOpts(), { plain: true }));
    log('модули: отвязка — ' + (r.ok ? (r.body && r.body.released ? 'место освобождено' : 'этого компьютера на ключе не было') : r.code));
    if (!r.ok) return r;
    licClient.dropFull(store, PACK_ID); await setLicKey('');
    await restart();
    return { ok: true, released: !!(r.body && r.body.released) };
  }));
  // Ручная выдача (аварийный путь): вставить строку лицензии tpl1.… от автора
  ipcMain.handle('lic-paste', (e, token) => busy(async () => {
    const t = String(token || '').trim();
    const lic = license.verify(t);
    if (!lic || lic.pack !== PACK_ID) return { ok: false, error: 'это не лицензия пака стримера' };
    const fp = await license.fingerprint();
    if (!license.fpMatch(lic.fp, fp.parts)) return { ok: false, error: 'лицензия выдана для другого компьютера' };
    licClient.saveToken(store, PACK_ID, t);
    await restart();
    return { ok: true };
  }));
  // Код компьютера для ручной выдачи: автор вставит его в «Выдать лицензию.cmd»
  ipcMain.handle('lic-request', async () => { const fp = await license.fingerprint(); return { ok: fp.ok, code: fp.parts.map((p) => p || '-').join(','), short: license.fpCode(fp.parts) }; });

  // Для отладочного меню: есть ли сохранённый вход в Twitch — ТОЛЬКО «да/нет», без ников и токенов.
  // Читаем зашифрованную полку бота, поэтому ответ верен и когда модуль остановлен (нет лицензии).
  async function twitchLogins() {
    const sec = makeSecure(store, safeStorage, 'bot', log);
    const read = async (name) => {
      try {
        const raw = await sec.get('twitch.' + name);
        if (!raw) return false;
        const j = JSON.parse(raw);
        return !!(j && j.tokens && j.user);
      } catch (e) { return false; }
    };
    return { chat: await read('chat'), broadcaster: await read('broadcaster') };
  }

  return { start, stop, status, restart, twitchLogins, setAccepting };
}

module.exports = { setup, makeSecure, verCmp, latestJournal, packInstalled, resolvePack, PACK_ID, clockRegWrite };
