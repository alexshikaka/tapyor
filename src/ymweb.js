// Запасной способ для Яндекс Музыки: официальный сайт music.yandex.ru в скрытом окне.
// Сайт сам играет трек со входом пользователя, а Тапёр нажимает «Слушать» и управляет звуком страницы.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const recipes = require('./recipes');

const PARTITION = 'persist:yandex-login'; // те же cookies, что после входа через окно Яндекса
let win = null;
let log = () => {};
let toRenderer = () => {};
let fault = null; // имитация сбоя Яндекс Музыки (0.34.0): проверка перед загрузкой страницы
let lastState = null;
let replySeq = 0;
const replies = new Map();
let wired = false;

function setup(opts) {
  log = opts.log || log;
  toRenderer = opts.send || toRenderer;
  fault = opts.fault || fault;
  if (wired) return;
  wired = true;
  // Отвечать нам может только само окно сайта — ни вкладка «Браузера», ни кто-то ещё.
  const fromWin = (e) => { try { return !!(win && !win.isDestroyed() && e.sender === win.webContents); } catch (x) { return false; } };
  ipcMain.on('ymweb-state', (e, d) => { if (fromWin(e)) { lastState = d; toRenderer('ymweb-state', d); if (d && d.paused === false) noIdle(); else idleLater(3 * 60 * 1000); } });
  ipcMain.on('ymweb-reply', (e, id, d) => { if (!fromWin(e)) return; const r = replies.get(id); if (r) { replies.delete(id); r(d); } });
}

// Энергосбережение: скрытый сайт Яндекса — полноценная страница, которой запрещено «засыпать».
// Не играет — через 3 минуты (и на паузе — тоже 3) окно закрывается; вход на сайте сохраняется (своя постоянная сессия).
let idleT = null;
function noIdle() { clearTimeout(idleT); idleT = null; }
function idleLater(ms) {
  clearTimeout(idleT);
  idleT = setTimeout(() => {
    idleT = null;
    if (!win || win.isDestroyed() || win.isVisible()) return;
    if (lastState && lastState.paused === false) return;
    log('Яндекс (сайт): без дела — закрываю скрытое окно, чтобы не тратить процессор');
    destroy(); lastState = null;
  }, ms || 3 * 60 * 1000);
}
// Имя сайта проверяется целиком: «yandex.ru.evil.com» — не Яндекс (старая проверка 0.31.4 это пропускала).
const YA_HOST = /(^|\.)(yandex\.(ru|com|by|kz|ua|uz|az|net|ee|lv|lt|md|tj|tm|fr|eu|com\.tr|com\.am|com\.ge|co\.il)|ya\.ru)$/i;
function navAllowed(u) {
  let x; try { x = new URL(String(u || '')); } catch (e) { return false; }
  return x.protocol === 'https:' && YA_HOST.test(x.hostname);
}
function ensureWin() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false, width: 1280, height: 860, title: 'Яндекс Музыка (Тапёр)',
    autoHideMenuBar: true, backgroundColor: '#ffffff',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'ymweb-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, // в фоне не засыпать — иначе звук будет запинаться
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // TAP-08: скрытое окно воспроизведения ходит только по сайтам Яндекса — чужие переходы блокируем
  // (по логу 05–08.11 их не было ни одного). Пока окно показано для входа, переходы разрешены:
  // вход через VK ID, Госуслуги и др. уводит на чужие сайты. Не-https адреса блокируются всегда.
  const navCheck = (e, u) => {
    const url = String(u || '');
    if (navAllowed(url)) return;
    const shown = !!(win && !win.isDestroyed() && win.isVisible());
    if (!shown || !/^https:\/\//i.test(url)) { e.preventDefault(); log('Яндекс (сайт): заблокирован переход на ' + url.slice(0, 120)); }
    else log('Яндекс (сайт): переход при входе на ' + url.slice(0, 120));
  };
  win.webContents.on('will-navigate', navCheck);
  win.webContents.on('will-redirect', navCheck);
  win.on('close', (e) => { if (!win.__quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', (e, d) => { log('Яндекс (сайт): страница упала — ' + (d && d.reason)); toRenderer('ymweb-state', { ev: 'error', error: 'страница Яндекса закрылась' }); });
  return win;
}

function cmd(name, value, timeoutMs) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve({ ok: false, error: 'окно не открыто' }); return; }
    const id = ++replySeq;
    const t = setTimeout(() => { if (replies.has(id)) { replies.delete(id); resolve({ ok: false, error: 'нет ответа' }); } }, timeoutMs || 5000);
    replies.set(id, (d) => { clearTimeout(t); resolve(d || { ok: false }); });
    win.webContents.send('ymweb-cmd', name, value, id);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
let playToken = 0;

// Включить трек на сайте. Возвращает { ok } или { error, stage, details } — этап, на котором сломалось:
// open — сайт не открылся, button — не нашлась кнопка «Слушать», sound — звук не пошёл,
// match — заиграл другой трек, preview — только отрывок (нет входа/подписки на сайте)
async function play(t, volume) {
  noIdle();
  const r = await play0(t, volume);
  if (!r || !r.ok) idleLater(); // не заиграло — окно закроется само через 3 минуты
  return r;
}
async function play0(t, volume) {
  const token = ++playToken;
  const R = (recipes.get().yandex) || {};
  if (!t || !t.id) return { error: 'нет трека для пробы', stage: 'notrack' };
  const url = (t.albumId ? (R.trackUrl || 'https://music.yandex.ru/album/{albumId}/track/{id}') : (R.trackUrlNoAlbum || 'https://music.yandex.ru/track/{id}'))
    .replace('{albumId}', encodeURIComponent(t.albumId || '')).replace('{id}', encodeURIComponent(t.id));
  // Имитация сбоя Яндекса: до загрузки страницы. «Медленно» — подождать и продолжить,
  // остальные режимы — честная ошибка этапа «сайт не открылся». Окно сайта не открываем:
  // при имитации оно не нужно.
  if (fault) {
    const mode = fault.modeForUrl(url);
    if (mode) {
      try { await fault.applyCall('ym', () => {}, { url: url }); }
      catch (e) {
        log('Яндекс (сайт): имитация сбоя — ' + e.message);
        return { error: 'сайт Яндекс Музыки не открылся (имитация сбоя)', stage: 'open', details: e.message };
      }
    }
  }
  const w = ensureWin();
  log('Яндекс (сайт): открываю ' + url);
  await cmd('hold', null, 2000);
  lastState = null;
  try {
    await w.loadURL(url);
  } catch (e) {
    log('Яндекс (сайт): страница не открылась — ' + e.message);
    return { error: 'сайт Яндекс Музыки не открылся', stage: 'open', details: e.message };
  }
  if (token !== playToken) return { error: 'отменено', stage: 'cancel' };
  await cmd('volume', volume == null ? 1 : volume, 2000);
  // Сайт дорисовывается скриптами — ищем кнопку «Слушать» до 15 секунд
  let clicked = null, seen = null;
  for (let k = 0; k < 30 && token === playToken; k++) {
    const r = await cmd('start', Object.assign({}, R.play || {}, { title: t.title || '', artist: t.author || '' }), 3000);
    if (r && r.ok) { clicked = r; break; }
    if (r && r.seen) seen = r.seen;
    await sleep(500);
  }
  if (token !== playToken) return { error: 'отменено', stage: 'cancel' };
  if (!clicked) {
    log('Яндекс (сайт): не нашёл кнопку «Слушать»; кнопок на странице: ' + ((seen && seen.length) || 0));
    return { error: 'на сайте Яндекса не нашлась кнопка «Слушать» — похоже, сайт изменился', stage: 'button', details: 'кнопки на странице: ' + (seen || []).join(' | ') };
  }
  log('Яндекс (сайт): нажал кнопку (вариантов: ' + (1 + ((clicked.others && clicked.others.length) || 0)) + ')');
  // Ждём, что звук пошёл
  for (let k = 0; k < 40 && token === playToken; k++) {
    if (lastState && !lastState.paused && lastState.time > 0.2) break;
    await sleep(250);
  }
  if (token !== playToken) return { error: 'отменено', stage: 'cancel' };
  const info = await cmd('info', R.loggedInSelector || null, 2000);
  const det = 'нажата кнопка: «' + clicked.clicked + '»; страница: ' + (info && info.url || url);
  if (!lastState || lastState.paused) {
    log('Яндекс (сайт): звук не пошёл; состояние: ' + (info ? 'ключей ' + Object.keys(info).length : 'нет данных'));
    await cmd('hold', null, 2000);
    const noLogin = info && info.loggedIn === false;
    return { error: noLogin ? 'сайт Яндекса не начал играть — похоже, нет входа на сайте' : 'кнопка нажалась, но сайт Яндекса не начал играть — похоже, сайт изменился', stage: noLogin ? 'login' : 'sound', details: det };
  }
  // Проверяем, что играет именно наш трек (по названию в системной карточке «сейчас играет»)
  const got = norm(info && info.title), want = norm(t.title);
  if (got && want && !(got.includes(want.slice(0, 12)) || want.includes(got.slice(0, 12)))) {
    log('Яндекс (сайт): заиграло не то — «' + (info.artist || '') + ' — ' + info.title + '» вместо «' + t.title + '»');
    await cmd('hold', null, 2000);
    return { error: 'сайт включил другой трек («' + info.title + '») — похоже, Тапёр нажал не ту кнопку', stage: 'match', details: det };
  }
  const dur = lastState.dur || 0;
  if (t.seconds > 60 && dur > 0 && dur < 35) {
    log('Яндекс (сайт): только отрывок 30 с — нет входа или подписки на сайте');
    await cmd('hold', null, 2000);
    return { error: 'сайт даёт только отрывок 30 секунд — нужен вход на сайте и подписка Плюс', stage: 'login', details: det };
  }
  log('Яндекс (сайт): играет «' + (info.title || t.title) + '», длина ' + Math.round(dur) + ' с');
  return { ok: true, dur, details: det };
}

function stop() { playToken++; idleLater(); return cmd('hold', null, 2000); }

// Показать окно входа на сайте (для тех, кто входил через браузер — у окна сайта своих cookies нет)
function login() {
  return new Promise((resolve) => {
    const w = ensureWin();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      w.webContents.removeListener('did-navigate', onNav);
      w.removeListener('hide', onHide);
      w.hide();
      resolve({ ok });
    };
    const onNav = (e, u) => { if (/^https:\/\/music\.yandex\.(ru|com|by|kz)\//.test(u) && !/passport|auth/.test(u)) setTimeout(() => finish(true), 1500); };
    const onHide = () => finish(false);
    w.webContents.on('did-navigate', onNav);
    w.on('hide', onHide);
    w.show();
    w.loadURL('https://passport.yandex.ru/auth?retpath=' + encodeURIComponent('https://music.yandex.ru/')).catch(() => {});
  });
}

// Проба для проверок: включить и сразу выключить. Окно сайта одно на всю программу,
// поэтому две проверки разом (глубокая и автопочинка) перебивали друг другу загрузку —
// loadURL падал с ERR_ABORTED за десяток миллисекунд, и это выглядело как «сайт не открылся».
// Вторая проба теперь не лезет в окно, а честно отвечает «занято»; живое воспроизведение
// по-прежнему главнее пробы — если оно началось, проба вернёт stage «cancel».
let probing = false;
async function probe(t) {
  if (probing) return { error: 'окно сайта занято другой проверкой', stage: 'busy' };
  probing = true;
  try {
    const r = await play(t, 0);
    await stop();
    return r;
  } finally { probing = false; }
}

function destroy() { if (win && !win.isDestroyed()) { win.__quitting = true; win.destroy(); } }

module.exports = { setup, play, stop, probe, cmd, login, destroy, window: () => win, probing: () => probing, _navAllowed: navAllowed };
