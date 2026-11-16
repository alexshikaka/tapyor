// Яндекс Музыка: вход (окно и код в браузере), токен, статус аккаунта, поиск,
// плейлисты, лайки, книги и подкасты, «Моя волна», поток и подсказки.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

const rank = require('../rank.js');

module.exports = { setup };

function setup(ctx) {
  const {
    ipcMain, safeStorage, clipboard, shell, openExternal, cfg, settingsStore, log, logDebug,
    readSettings, writeSettings, yandexLogin, autofixR, ytsT, library, match, ym, streamBusy, ytSuggest
  } = ctx;

  const YM_CLIENT_SECRET = '53bc75238f0c4d08a118e51fe9203300'; // публичный секрет того же клиента Яндекс Музыки (scan-secrets:allow)
  let deviceLogin = null;
  async function ymDeviceStart() {
    const body = new URLSearchParams({ client_id: ym.CLIENT_ID, device_name: 'Тапёр' });
    const res = await fetch('https://oauth.yandex.ru/device/code', { method: 'POST', body, signal: AbortSignal.timeout(10000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.device_code) throw new Error(j.error_description || j.error || ('HTTP ' + res.status));
    deviceLogin = { code: j.device_code, interval: Math.max(2, j.interval || 5), expiresAt: Date.now() + (j.expires_in || 600) * 1000, cancelled: false };
    return { user_code: j.user_code, verification_url: j.verification_url || 'https://oauth.yandex.ru/device', expires_in: j.expires_in || 600 };
  }
  async function ymDeviceWait() {
    const d = deviceLogin;
    if (!d) return { error: 'вход не начат' };
    while (!d.cancelled && Date.now() < d.expiresAt) {
      await new Promise((r) => setTimeout(r, d.interval * 1000));
      if (d.cancelled) break;
      try {
        const body = new URLSearchParams({ grant_type: 'device_code', code: d.code, client_id: ym.CLIENT_ID, client_secret: YM_CLIENT_SECRET });
        const res = await fetch('https://oauth.yandex.ru/token', { method: 'POST', body, signal: AbortSignal.timeout(10000) });
        const j = await res.json().catch(() => ({}));
        if (j.access_token) return { token: j.access_token };
        if (j.error === 'authorization_pending') continue;
        if (j.error === 'slow_down') { d.interval += 2; continue; }
        return { error: j.error_description || j.error || ('HTTP ' + res.status) };
      } catch (e) { log('Яндекс: опрос входа — ' + e.message); }
    }
    return { error: d.cancelled ? 'вход отменён' : 'время ожидания истекло, попробуй ещё раз' };
  }

  // --- Яндекс Музыка ---
  ym.setLogger(log);
  // Сетевые ошибки api() подряд считает автопочинка (порог 3 — в src/autofix.js).
  ym.setHooks({
    fail: () => { try { autofixR.note('yandex', 'api', { reason: 'сервис не отвечает' }); } catch (e) {} },
    ok: () => { try { autofixR.success('yandex', 'api'); } catch (e) {} }
  });
  let ymUid = '';
  function getYmToken() {
    const v = readSettings().ymToken;
    if (!v) return '';
    try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString('utf8'); }
    catch (e) { log('Яндекс: не удалось прочитать токен ' + e.message); return ''; }
  }
  // safeStorage недоступен (нет ключницы ОС) — base64 это не шифрование, а кодировка.
// Пишем в лог один раз за запуск, чтобы обещание «хранится зашифрованно» не расходилось с делом.
let plainWarned = false;
function warnPlainStorage(what) {
  if (plainWarned) return;
  plainWarned = true;
  log('ВНИМАНИЕ: системное шифрование недоступно, ' + what + ' сохраняется в открытом виде (base64). Данные лежат в папке программы и доступны другим программам на этом компьютере.');
}
function setYmToken(tok) {
    const s = readSettings();
    if (!tok) delete s.ymToken;
    else {
      const enc = safeStorage.isEncryptionAvailable();
      if (!enc) warnPlainStorage('вход в Яндекс Музыку');
      s.ymToken = (enc ? safeStorage.encryptString(tok) : Buffer.from(tok, 'utf8')).toString('base64');
    }
    writeSettings(s);
  }
  async function ymStatus() {
    const tok = getYmToken();
    if (!tok) return { loggedIn: false };
    try { const a = await ym.accountStatus(tok); return Object.assign({ loggedIn: true }, a); }
    catch (e) {
      log('Яндекс: статус аккаунта — ошибка ' + e.message);
      if (e.status === 401 || e.status === 403) { setYmToken(''); return { loggedIn: false, error: 'вход устарел, войди заново' }; }
      return { loggedIn: true, name: 'Яндекс', hasPlus: false, offline: true };
    }
  }
  ipcMain.handle('ym-status', () => ymStatus());
  ipcMain.handle('ym-login', async () => {
    const r = await yandexLogin();
    if (r.error) { log('Яндекс: ' + r.error); return r; }
    setYmToken(r.token);
    log('Яндекс: вход выполнен');
    return ymStatus();
  });
  ipcMain.handle('ym-login-browser-start', async () => {
    try {
      const d = await ymDeviceStart();
      try { clipboard.writeText(d.user_code); } catch (e) {}
      // Адрес подтверждения пришёл от сервера — открываем только ya.ru/yandex.ru/yandex.com (B5-2).
      const openUrl = openExternal.yandexDeviceUrl(d.verification_url);
      if (openUrl !== d.verification_url) log('Яндекс: вход через браузер — адрес подтверждения не с домена Яндекса, открываю ya.ru/device');
      // Браузер не открываем сразу (замечание владельца 15.11): окно с кодом считает 10 с или ждёт
      // нажатия «Перейти в браузер» — человек успевает прочитать код. Открывает окно по open_url.
      log('Яндекс: вход через браузер — код выдан');
      return Object.assign({}, d, { open_url: openUrl });
    } catch (e) { log('Яндекс: вход через браузер недоступен — ' + e.message); return { error: e.message }; }
  });
  ipcMain.handle('ym-login-browser-wait', async () => {
    const r = await ymDeviceWait();
    if (r.error) { log('Яндекс: вход через браузер — ' + r.error); return r; }
    setYmToken(r.token);
    log('Яндекс: вход через браузер выполнен');
    return ymStatus();
  });
  ipcMain.handle('ym-login-browser-cancel', () => { if (deviceLogin) deviceLogin.cancelled = true; return true; });
  // Куда вообще можно открыть браузер из окна — список в src/open-external.js (точный, не «любой https»).
  // Отказ пишется в журнал: иначе кнопка «молча не работает», и причину не найти (баг 0.33.0).
  ipcMain.handle('open-external', (e, url) => {
    const u = String(url || '');
    if (openExternal.allowed(u)) { shell.openExternal(u); return true; }
    log('открыть ссылку нельзя — адрес не из списка: ' + u.slice(0, 140));
    return false;
  });
  ipcMain.handle('ym-logout', () => { setYmToken(''); ymUid = ''; log('Яндекс: выход'); return true; });
  ipcMain.handle('ym-search', async (e, q) => {
    if (cfg('ymEnabled') === false) return { tracks: [], playlists: [], artists: [] };
    try {
      const r = await ym.search(q, getYmToken());
      log('Яндекс: поиск «' + q + '» → треков ' + r.tracks.length + ', плейлистов ' + r.playlists.length);
      logDebug('поиск Яндекс: «' + String(q || '').slice(0, 120) + '» → треков ' + r.tracks.length + ', исполнителей ' + ((r.artists || []).length));
      return r;
    }
    catch (err) { log('Яндекс: поиск — ошибка ' + err.message); return { tracks: [], playlists: [], artists: [] }; }
  });
  ipcMain.handle('ym-search-page', async (e, q, page) => {
    if (cfg('ymEnabled') === false) return { error: 'Яндекс выключен в настройках', tracks: [] };
    try { return await ym.searchTracksPage(q, page, getYmToken()); }
    catch (err) { log('Яндекс: страница поиска — ошибка ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-search-pls', async (e, q, page) => {
    if (cfg('ymEnabled') === false) return [];
    try { return await ym.searchPlaylistsPage(String(q || '').slice(0, 200), Number(page) || 0, getYmToken()); }
    catch (err) { log('Яндекс: плейлисты поиска — ошибка ' + err.message); return []; }
  });
  let stationsCache = null;
  ipcMain.handle('ym-stations', async () => {
    if (stationsCache && Date.now() - stationsCache.at < 6 * 3600 * 1000) return stationsCache.list;
    try { const list = await ym.stationsList(getYmToken()); stationsCache = { at: Date.now(), list }; log('Яндекс: станций ' + list.length); return list; }
    catch (err) { log('Яндекс: список станций — ошибка ' + err.message); return []; }
  });
  ipcMain.handle('ym-wave-contexts', async (_e, seeds) => {
    const tok = getYmToken();
    if (!tok) return { contexts: [], defaultStation: null };
    try { return await ym.waveContexts(tok, seeds); }
    catch (err) { log('Волна: контексты — ' + err.message); return { contexts: [], defaultStation: null, error: err.message }; }
  });
  async function ymUidGet() {
    if (ymUid) return ymUid;
    const a = await ym.accountStatus(getYmToken());
    ymUid = a.uid || a.login;
    return ymUid;
  }
  ipcMain.handle('ym-my', async () => {
    const tok = getYmToken();
    if (!tok) return { error: 'войди в Яндекс' };
    try { return { playlists: await ym.userPlaylists(tok, await ymUidGet()) }; }
    catch (err) { log('Яндекс: мои плейлисты — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-liked', async () => {
    const tok = getYmToken();
    if (!tok) return { error: 'войди в Яндекс' };
    try { return Object.assign({ src: 'ym', type: 'liked' }, await ym.likedTracks(tok, await ymUidGet(), 1000)); }
    catch (err) { log('Яндекс: «Мне нравится» — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-playlist', async (e, pl) => {
    try { return await ym.playlistTracks(getYmToken(), pl || {}); }
    catch (err) { log('Яндекс: плейлист — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-like-ids', async () => {
    const tok = getYmToken();
    if (!tok) return [];
    try { return await ym.likedIds(tok, await ymUidGet()); }
    catch (err) { log('Яндекс: список лайков — ' + err.message); return []; }
  });
  ipcMain.handle('ym-like', async (e, trackKey, on) => {
    const tok = getYmToken();
    if (!tok) return { error: 'войди в Яндекс' };
    try { await ym.setLike(tok, await ymUidGet(), trackKey, !!on); log('Яндекс: ' + (on ? 'лайк ' : 'снят лайк ') + trackKey); return { ok: true }; }
    catch (err) { log('Яндекс: лайк — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-speech-search', async (e, q) => {
    try { return await ym.searchSpeech(String(q || ''), getYmToken()); }
    catch (err) { log('Яндекс: поиск книг и подкастов — ' + err.message); return []; }
  });
  ipcMain.handle('ym-speech', async (e, albumId, kind) => {
    try { return await ym.speechTracks(getYmToken(), albumId, kind); }
    catch (err) { log('Яндекс: книга/подкаст — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-disliked', async () => {
    const tok = getYmToken();
    if (!tok) return { error: 'войди в Яндекс' };
    try { return Object.assign({ src: 'ym', type: 'disliked' }, await ym.dislikedTracks(tok, await ymUidGet(), 1000)); }
    catch (err) { log('Яндекс: «Не нравится» — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-dislike-ids', async () => {
    const tok = getYmToken();
    if (!tok) return [];
    try { return await ym.dislikedIds(tok, await ymUidGet()); }
    catch (err) { log('Яндекс: список «Не нравится» — ' + err.message); return []; }
  });
  ipcMain.handle('ym-dislike', async (e, trackKey, on) => {
    const tok = getYmToken();
    if (!tok) return { error: 'войди в Яндекс' };
    try { await ym.setDislike(tok, await ymUidGet(), trackKey, !!on); log('Яндекс: ' + (on ? 'дизлайк ' : 'снят дизлайк ') + trackKey); return { ok: true }; }
    catch (err) { log('Яндекс: дизлайк — ' + err.message); return { error: err.message }; }
  });
  // Поиск одной песни по строке «Исполнитель — Название» (Плейлист из текста, импорт, перенос).
  // opts: { seconds — длительность-подсказка, only: 'ym'|'yt' — искать только там, noLocal }
  const MEM_MAX = 3000;
  const memKey = (line, only) => (only ? only + ':' : '') + match.norm(match.clean(line).query || line);
  function memGet(line, only) { const m = settingsStore.get('matchMemory') || {}; return m[memKey(line, only)] || null; }
  function memSet(line, only, track) {
    const m = settingsStore.get('matchMemory') || {};
    const k = memKey(line, only); if (!k) return;
    delete m[k]; m[k] = track;
    const keys = Object.keys(m); if (keys.length > MEM_MAX) keys.slice(0, keys.length - MEM_MAX).forEach((x) => delete m[x]);
    settingsStore.set('matchMemory', m);
  }
  // Книги и подкасты — не кандидаты для заказов и поиска песни «Исполнитель — Название».
  // Одна строка в лог на вызов, если что-то действительно отброшено.
  function dropSpeechCandidates(list) {
    const n = list.length;
    const out = list.filter((v) => !(v && v.speech));
    if (out.length !== n) log('заказ: отброшено ' + (n - out.length) + ' книг/подкастов');
    return out;
  }
  // Ф1 (14.11): «полный доступ» Яндекса — вход и Плюс. Без него Яндекс отдаёт отрывки по 30 с,
  // поэтому его ответ не окончательный: спрашиваем YouTube и выбираем лучший умным поиском.
  // Статус спрашиваем один раз на токен: импорт идёт тремя строками сразу.
  let ymFullCache = { token: '', at: 0, value: false };
  let ymFullPending = null;
  function ymFullAccess() {
    const tok = getYmToken();
    if (!tok) return Promise.resolve(false);
    if (ymFullCache.token === tok && Date.now() - ymFullCache.at < 10 * 60 * 1000) return Promise.resolve(ymFullCache.value);
    if (ymFullPending && ymFullPending.token === tok) return ymFullPending.promise;
    const entry = { token: tok, promise: null };
    entry.promise = ym.accountStatus(tok)
      .then((a) => { const value = !!(a && a.hasPlus); ymFullCache = { token: tok, at: Date.now(), value }; return value; })
      .catch((err) => { log('поиск песни: доступ Яндекса не проверить — ' + err.message); ymFullCache = { token: tok, at: Date.now(), value: false }; return false; })
      .then((value) => { if (ymFullPending === entry) ymFullPending = null; return value; });
    ymFullPending = entry;
    return entry.promise;
  }
  // Лучший из двух ответов (Яндекс и YouTube) — правилом умного поиска:
  // отрывок получает −30, полная площадка — свой бонус (rank.js).
  function pickBest(q, ymList, ytList, ctx) {
    const parts = [];
    const dYm = match.decideOnly(q, ymList, 'ym');
    if (dYm.track) parts.push(dYm);
    const dYt = match.decideOnly(q, ytList, 'yt');
    if (dYt.track) parts.push(dYt);
    if (!parts.length) {
      // Ни одна не «та», но варианты для кнопки «Найти» показать всё равно надо
      const alts = (dYm.alts || []).concat(dYt.alts || []).filter((t, i, all) => t && all.indexOf(t) === i);
      return { status: 'none', track: null, alts };
    }
    if (parts.length === 1) return parts[0];
    let best = parts[0];
    let bestScore = rank.score(q.query, best.track, 'smart', ctx);
    for (let i = 1; i < parts.length; i++) {
      const s = rank.score(q.query, parts[i].track, 'smart', ctx);
      if (s > bestScore) { best = parts[i]; bestScore = s; }
    }
    const other = parts.find((p) => p !== best);
    const alts = (best.alts || []).concat(other && other.track ? [other.track] : []).concat(other ? other.alts || [] : [])
      .filter((t, i, all) => t && t !== best.track && all.indexOf(t) === i);
    return { status: best.status, track: best.track, alts };
  }
  async function matchOne(line, opts) {
    opts = opts || {};
    const q = match.clean(line);
    if (!q.query) return { status: 'skip' };
    const only = opts.only || '';
    const ymOn = cfg('ymEnabled') !== false;
    const ytOn = cfg('ytEnabled') !== false;
    const remembered = memGet(line, only);
    if (remembered && remembered.src && remembered.id && (!only || remembered.src === only)) {
      const r = { query: q.query, status: 'exact', track: remembered, alts: [], remembered: true };
      if (remembered.src === 'ym' && !(await ymFullAccess())) r.preview = true;
      return r;
    }
    // Свои файлы: если песня есть на компьютере — она и играет
    let local = null;
    if (!only && !opts.noLocal && cfg('preferLocal') !== false) { try { local = match.exactLocal(q, library.search(q.query, 6)); } catch (e) {} }
    if (local) return { query: q.query, status: 'exact', track: local, alts: [], local: true };
    let ymList = [], ytList = [];
    const getYt = async () => {
      try {
        const y = await ytsT(q.query, 8000);
        return (y.videos || []).slice(0, 6).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail, live: !((v.duration && v.duration.seconds) > 0) || undefined }));
      } catch (err) { log('поиск песни: YouTube — ' + err.message); return []; }
    };
    if (only !== 'yt' && ymOn) { try { ymList = dropSpeechCandidates((await ym.searchTracksPage(q.query, 0, getYmToken())).slice(0, 6)); } catch (err) { log('поиск песни: Яндекс — ' + err.message); } }
    let r;
    if (only === 'ym') r = match.decideOnly(q, ymList, 'ym');
    else if (only === 'yt') { if (ytOn) ytList = await getYt(); r = match.decideOnly(q, ytList, 'yt'); }
    else {
      const ymFull = ymOn ? await ymFullAccess() : false;
      if (ymOn && ymFull) {
        // Яндекс играет целиком — его «точно» и есть окончательный ответ
        r = match.decide(q, ymList, []);
        if (r.status !== 'exact' && ytOn) { ytList = await getYt(); r = match.decide(q, ymList, ytList); }
      } else {
        // Нет входа/Плюса или Яндекс выключен: спрашиваем обе площадки и выбираем лучший
        if (ytOn) ytList = await getYt();
        r = pickBest(q, ymList, ytList, { lcOn: false, ymFull: !!ymFull, ymOn, ytOn, ytLogged: !!getYmToken(), scOn: false, auOn: false, order: ['ym', 'yt'] });
      }
    }
    r = match.preferDuration(r, opts.seconds || 0);
    const out = Object.assign({ query: q.query }, r);
    if (out.track && out.track.src === 'ym' && !(await ymFullAccess())) out.preview = true;
    return out;
  }
  ipcMain.handle('match-line', (e, line, opts) => matchOne(line, opts));
  ipcMain.handle('match-remember', (e, line, only, track) => { if (track && track.id) memSet(line, only || '', track); return true; });

  function registerIpc() {
    const ymCache = new Map();
    ipcMain.handle('ym-stream', async (e, id) => {
      streamBusy.begin();
      try {
        const tok = getYmToken();
        // Без входа Яндекс отдаёт 30-секундный отрывок без токена (download-info → preview.mp3).
        // Поэтому не отвечаем «войди» сразу: сначала пробуем отрывок, иначе человек видит только
        // мелкую строку в подвале. Полный трек по-прежнему только со входом.
        const cacheKey = (tok ? 'in:' : 'out:') + id;
        const c = ymCache.get(cacheKey);
        if (c && Date.now() - c.at < 20 * 60 * 1000) return c.value;
        try {
          const r = await ym.streamUrl(id, tok);
          ymCache.set(cacheKey, { at: Date.now(), value: r });
          while (ymCache.size > 500) ymCache.delete(ymCache.keys().next().value);
          return r;
        }
        catch (err) {
          log('Яндекс: поток — ошибка ' + err.message + (tok ? '' : ' (без входа, отрывок не выдан)'));
          if (!tok) return { error: 'чтобы слушать Яндекс, войди в аккаунт (кнопка вверху)' };
          return { error: 'Яндекс: ' + err.message };
        }
      } finally { streamBusy.end(); }
    });
    // «Моя волна»
    ipcMain.handle('ym-wave-start', async (e, s) => {
      const tok = getYmToken();
      if (!tok) return { error: 'для волны войди в Яндекс' };
      try {
        const tracks = await ym.waveStart(tok, s || {});
        log('Волна: старт ' + ((s && (s.station || (s.seeds || []).join(','))) || 'user:onyourwave') + ' (характер ' + (s && s.diversity) + ', настроение ' + (s && s.mood) + ', язык ' + (s && s.language) + ')');
        return { tracks };
      } catch (err) { log('Волна: ошибка старта ' + err.message); return { error: 'Волна: ' + err.message }; }
    });
    ipcMain.handle('ym-wave-more', async (e, lastId) => {
      const tok = getYmToken();
      if (!tok) return { error: 'нет входа в Яндекс' };
      try { return { tracks: await ym.waveTracks(tok, lastId) }; }
      catch (err) { log('Волна: ошибка подгрузки ' + err.message); return { error: 'Волна: ' + err.message }; }
    });
    ipcMain.on('ym-wave-feedback', (e, type, trackKey, played) => {
      const tok = getYmToken();
      if (tok) ym.waveFeedback(tok, type, trackKey, played);
    });

    ipcMain.handle('suggest', async (e, part) => {
      if (cfg('ymEnabled') !== false) { try { const a = await ym.suggest(part, getYmToken()); if (a.length) return { source: 'ym', items: a }; } catch (err) { log('Яндекс: подсказки — ошибка ' + err.message); } }
      try { const b = await ytSuggest(part); if (b.length) return { source: 'yt', items: b }; }
      catch (err) { log('YouTube: подсказки — ошибка ' + err.message); }
      return { source: '', items: [] };
    });
  }

  return { registerIpc, getYmToken, ymStatus, ymUidGet, dropSpeechCandidates, memSet };
}
