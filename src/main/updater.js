// Обновления: каналы, проверка подписи, скачивание, тихая установка, сборка другого канала.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

const updateKeysConfig = require('../update-keys');

// B7b (P5a №16): установщик другого канала запускаем один раз — только из состояния
// 'downloaded'. Перед spawn ставим 'installing', поэтому повторное нажатие «Поставить»
// и второй вызов при выходе уже ничего не делают.
function canRunOtherInstaller(job) { return !!(job && job.file && job.state === 'downloaded'); }

module.exports = { setup, canRunOtherInstaller };

function setup(ctx) {
  const {
    app, fs, path, ipcMain, autoUpdater, releaseFeed, updatePolicy, updateSign,
    log, cfg, settingsDisk, ensureTodayStore, readSettingsFile, writeSettingsFile, BUILD,
    session, getMainWindow, isPlayerBusy, showMainWindow, srcDir
  } = ctx;

  let manualCheck = false;
  let updaterReady = false;
  let installRequested = false; // пользователь сам нажал «Обновить» — ставим сразу
  let updateState = { state: 'idle' };
  let downloadedVersion = '';        // обновление скачано и ещё не поставлено
  let updateInstallStarted = false;  // установку уже запускали — второй раз не зовём
  let otherWaitingQuit = false;      // сборка другого канала скачана и ждёт выхода

  // Каналы обновлений (docs/PLAN-OPEN-BETA.md, А4; решения 08.11 и 10.11). Один установщик, канал выбирается при запуске:
  //   stable — релизы открытого alexshikaka/tapyor (по умолчанию у всех);
  //   debug  — релизы tapyor-releases (отладочный, только владелец; при выборе — предупреждение и копия настроек).
  // Пока в стабильном нет ни одного релиза, проверка честно отвечает «обновлений нет» — без подмены на отладочный.
  // Откат версии не делаем: перешёл с отладочного на стабильный — стабильный «догонит».
  const UPD_FEEDS = {
    stable: { provider: 'github', owner: 'alexshikaka', repo: 'tapyor', releaseType: 'release' },
    debug: { provider: 'github', owner: 'alexshikaka', repo: 'tapyor-releases', releaseType: 'release' },
  };
  function updChannel() { return cfg('updChannel') === 'debug' ? 'debug' : 'stable'; }
  function applyUpdChannel() {
    const ch = updChannel();
    try { autoUpdater.setFeedURL(UPD_FEEDS[ch]); } catch (e) { log('обновление: канал ' + ch + ' — ' + (e && e.message)); }
    return ch;
  }
  // «В репозитории нет ни одного релиза» — для пустого стабильного канала это норма, а не ошибка
  function updEmptyFeed(err) {
    const s = String((err && (err.code + ' ' + err.message)) || err);
    return /ERR_UPDATER_NO_PUBLISHED_VERSIONS|No published versions|Unable to find latest version|ERR_UPDATER_LATEST_VERSION_NOT_FOUND/i.test(s);
  }

  // ===== B4: подпись обновлений своим ключом (решение 12.11, раздел 7 STABILIZATION.md) =====
  // Рядом с установщиком в релизе лежит <имя установщика>.sig. Программа ставит обновление, только
  // если подпись верна ключом из src/update-keys.json. Пустой список ключей — проверка выключена
  // (программа работает как раньше). Подписи нет — молча ждём («обновлений нет»); не прошла — не качаем.
  let updKeysCache = null;    // { keys, error, disabled } — разбор src/update-keys.json
  let updCheck = null;        // { version, file, sha512, mode: 'signed' | 'disabled' } — для какой версии подпись прошла
  let updVerifySeq = 0;       // номер проверки: ответ устаревшей проверки не применяем

  // B7b (P5a №3): битый файл ключей — это ошибка, а не «проверка выключена».
  // Пустой список — по-прежнему выключенная проверка (как выпущено сейчас).
  function updateKeysInfo() {
    if (updKeysCache) return updKeysCache;
    let text = null;
    try { text = fs.readFileSync(path.join(srcDir, 'update-keys.json'), 'utf8'); }
    catch (e) {
      log('обновление: ключи подписи не прочитаны — ' + (e && e.message));
      updKeysCache = { keys: [], error: updateKeysConfig.BROKEN_TEXT, disabled: false };
      return updKeysCache;
    }
    updKeysCache = updateKeysConfig.parseUpdateKeys(text);
    if (updKeysCache.error) log('обновление: ключи подписи — ' + updKeysCache.error);
    else if (!updKeysCache.keys.length) log('обновление: ключей подписи нет — проверка выключена');
    return updKeysCache;
  }
  function updateKeys() { return updateKeysInfo().keys; }
  function updateKeysBroken() { return !!updateKeysInfo().error; }

  // Ответ не длиннее max байт: подпись — маленький файл, чужой огромный ответ целиком не читаем.
  async function readTextLimited(res, max) {
    if (res && res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        const value = step.value;
        total += value ? value.length : 0;
        if (total > max) { try { await reader.cancel(); } catch (e) {} throw new Error('файл подписи слишком большой'); }
        if (value) chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    }
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > max) throw new Error('файл подписи слишком большой');
    return text;
  }

  // Файл подписи из того же релиза, что и установщик, и обязательно из релиза этой версии
  // (тег vX.Y.Z): после выхода новой версии старый .sig в latest/download пропадает.
  // Хост — releaseFeed.hostAllowed, тайм-аут 8 с, ответ не больше 4 КБ.
  // → { text } | { missing: true } (404 — подписи ещё нет); сеть или размер — исключение.
  async function fetchUpdateSig(channel, version, file) {
    const { net: enet } = require('electron');
    const url = releaseFeed.assetUrlAtVersion(channel, version, file + '.sig');
    if (!url || !releaseFeed.hostAllowed(url)) throw new Error('адрес подписи не наш');
    const res = await enet.fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return { missing: true };
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const size = Number(res.headers.get('content-length') || 0);
    if (size > updateSign.MAX_SIG_FILE) throw new Error('файл подписи слишком большой');
    return { text: await readTextLimited(res, updateSign.MAX_SIG_FILE) };
  }

  // Проверка подписи для latest.yml (обычное обновление и сборка другого канала).
  // → { ok: true, mode: 'signed' | 'disabled' } | { ok: false, reason, missing? }; сеть — исключение.
  async function verifyUpdateSignature(channel, expected) {
    const info = updateKeysInfo();
    if (info.error) throw new Error(info.error);
    if (!info.keys.length) return { ok: true, mode: 'disabled' };
    const got = await fetchUpdateSig(channel, expected.version, expected.file);
    if (got.missing) return { ok: false, missing: true, reason: 'unsigned' };
    const parsed = updateSign.parseSig(got.text);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, error: parsed.error };
    const v = updateSign.verify(parsed.sig, expected, info.keys);
    return v.ok ? { ok: true, mode: 'signed' } : { ok: false, reason: v.reason };
  }

  // Скачивать можно только версию, для которой подпись уже прошла (или проверка выключена).
  // Состояние тоже важно: после неудачной проверки состояние «latest»/«error», и качать там нечего.
  function updSignatureAllowed() {
    if (!updCheck || !updCheck.version) return false;
    const st = updateState || {};
    if (!['available', 'downloading', 'ready', 'installing'].includes(st.state)) return false;
    return !st.version || st.version === updCheck.version;
  }

  // update-available: сначала подпись, потом состояние окну и скачивание.
  async function onUpdateAvailable(info) {
    const seq = updVerifySeq;
    const mine = manualCheck;
    const expected = updateSign.fromInfo(info);
    const version = expected ? expected.version : ((info && info.version) || '');
    log('обновление: доступна ' + version);
    // B7b (P5a №3): ключи подписи сломаны — обновления не ставим и говорим об этом в окне.
    if (updateKeysBroken()) {
      log('обновление: проверка подписи сломана — обновление не предлагаю');
      manualCheck = false;
      sendUpdateState({ state: 'error', message: updateKeysConfig.BROKEN_TEXT, manual: mine });
      return;
    }
    // Ключей нет — проверка выключена: ведём себя как до B4, даже если ответ разобрать не удалось.
    if (!expected && !updateKeys().length) {
      updCheck = { version: version, file: '', sha512: '', mode: 'disabled' };
      manualCheck = false;
      sendUpdateState({ state: 'available', version: version, manual: mine, auto: !!cfg('autoUpdate') });
      if (cfg('autoUpdate')) autoUpdater.downloadUpdate().catch((e) => log('обновление: автозагрузка — ' + (e && e.message)));
      return;
    }
    if (!expected) {
      log('обновление: в ответе нет версии, файла или sha512 — не предлагаю');
      manualCheck = false;
      sendUpdateState(mine
        ? { state: 'error', message: 'Сервер обновлений ответил непонятно — обновление не предлагаю.', manual: true }
        : { state: 'latest' });
      return;
    }
    let check;
    try {
      check = await verifyUpdateSignature(updChannel(), expected);
    } catch (e) {
      if (seq !== updVerifySeq) return;
      const msg = (e && e.message) ? String(e.message).slice(0, 300) : String(e);
      log('обновление: подпись не скачалась — ' + msg);
      manualCheck = false;
      sendUpdateState({ state: 'error', message: msg, manual: mine });
      return;
    }
    if (seq !== updVerifySeq) return;   // пока ждали сеть, проверку начали заново
    if (!check.ok && check.missing) {
      log('обновление ' + version + ' ещё не подписано — жду');
      updCheck = null;
      manualCheck = false;
      sendUpdateState({ state: 'latest', manual: mine });
      return;
    }
    if (!check.ok) {
      log('обновление ' + version + ': подпись не прошла (' + check.reason + ') — не ставлю');
      updCheck = null;
      manualCheck = false;
      sendUpdateState(mine
        ? { state: 'error', message: 'Обновление ' + version + ' не прошло проверку подписи — не ставлю.', manual: true }
        : { state: 'latest' });
      return;
    }
    updCheck = { version: expected.version, file: expected.file, sha512: expected.sha512, mode: check.mode };
    manualCheck = false;
    sendUpdateState({ state: 'available', version: expected.version, manual: mine, auto: !!cfg('autoUpdate') });
    if (cfg('autoUpdate')) autoUpdater.downloadUpdate().catch((e) => log('обновление: автозагрузка — ' + (e && e.message)));
  }

  // Копия настроек и заказов перед сменой канала — userData/backups/channel-<дата>
  function backupBeforeChannel(to) {
    try {
      try { settingsDisk.flush(); } catch (e) {}
      try { ensureTodayStore().flush(); } catch (e) {}
      const ud = app.getPath('userData');
      const dir = path.join(ud, 'backups', 'channel-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + to);
      fs.mkdirSync(dir, { recursive: true });
      // today.json — очередь с позицией (с 0.36/R2 живёт отдельно от settings.json).
      for (const f of ['settings.json', 'requests.json', 'today.json']) { const src = path.join(ud, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f)); }
      log('обновление: копия настроек и заказов перед сменой канала — ' + dir);
      return dir;
    } catch (e) { log('обновление: копия перед сменой канала не удалась — ' + (e && e.message)); return ''; }
  }

  function sendUpdateState(st) {
    // Предложение сборки другого канала (А12) живёт рядом с состоянием и переживает обычные его смены.
    const keepOther = updateState && updateState.other ? { other: updateState.other } : {};
    st = Object.assign({ channel: updChannel() }, keepOther, st);
    updateState = st;
    try { if (getMainWindow() && !getMainWindow().isDestroyed()) getMainWindow().webContents.send('update-state', st); } catch (e) {}
  }


  // Установка скачанного обновления по кнопке стримера: тихо и с перезапуском на новую версию.
  function startUpdateInstall(v) {
    if (updateInstallStarted) return;
    updateInstallStarted = true;
    log('обновление: тихая установка ' + v + ' и перезапуск');
    sendUpdateState({ state: 'installing', version: v });
    // Тихая установка без «Далее-Далее» и автоматический перезапуск программы
    setTimeout(() => {
      // Перед установкой сохраняем всё сразу: настройки и очередь (R2).
      try { settingsDisk.flush(); } catch (e) {}
      try { ensureTodayStore().flush(); } catch (e) {}
      app.isQuitting = true;
      autoUpdater.quitAndInstall(true, true);
    }, 1500);
  }

  // Обычный выход: скачанное обновление ставим тихо и БЕЗ перезапуска (второй аргумент false) —
  // стример закрыл Тапёр сам, значит, программа после установки сама не откроется.
  function installUpdateOnQuit() {
    if (!downloadedVersion || updateInstallStarted) return;
    updateInstallStarted = true;
    log('обновление: ставлю ' + downloadedVersion + ' при выходе, без перезапуска');
    try { autoUpdater.quitAndInstall(true, false); }
    catch (e) { log('обновление: установка при выходе не запустилась — ' + (e && e.message)); }
  }

  function initUpdater() {
    if (updaterReady) return;
    updaterReady = true;
    autoUpdater.autoDownload = false;       // качаем только по кнопке «Обновить»
    autoUpdater.autoInstallOnAppQuit = false;
    // В несобранной копии electron-updater молча пропускает проверку («application is not packed»):
    // ни событий, ни лога — кнопка «Проверить сейчас» выглядела мёртвой. С этим флагом проверка
    // идёт по-настоящему (фид задан setFeedURL), включая «в канале пока нет релизов». На сборку не влияет.
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;
    log('обновление: канал ' + applyUpdChannel());

    autoUpdater.on('checking-for-update', () => { updVerifySeq++; sendUpdateState({ state: 'checking', manual: manualCheck }); });
    autoUpdater.on('update-available', (info) => {
      // B4: доступность обновления объявляем окну и начинаем качать только после проверки подписи
      onUpdateAvailable(info).catch((e) => log('обновление: проверка подписи — ' + (e && e.message)));
    });
    autoUpdater.on('update-not-available', () => {
      sendUpdateState({ state: 'latest', manual: manualCheck });
      manualCheck = false;
    });
    autoUpdater.on('error', (err) => {
      if (updEmptyFeed(err)) { // пустой канал (стабильный до открытия) — «обновлений нет»
        log('обновление: в канале ' + updChannel() + ' пока нет релизов');
        sendUpdateState({ state: 'latest', manual: manualCheck, empty: true });
        manualCheck = false;
        return;
      }
      log('обновление: ошибка ' + (err && err.message));
      sendUpdateState({ state: 'error', message: (err && err.message) ? String(err.message).slice(0, 300) : String(err), manual: manualCheck });
      manualCheck = false;
    });
    autoUpdater.on('download-progress', (p) => {
      sendUpdateState({ state: 'downloading', percent: Math.round(p.percent || 0), transferred: p.transferred, total: p.total, bps: p.bytesPerSecond });
    });
    autoUpdater.on('update-downloaded', (info) => {
      const v = info && info.version;
      // B7b (P5a №13): ставим только ту версию И тот файл (sha512), для которого прошла подпись.
      const cmp = updateSign.downloadedMatches(updCheck, info);
      if (!cmp.ok) {
        log('обновление: скачано ' + v + ' без проверенной подписи (' + cmp.reason + ') — не ставлю');
        sendUpdateState({ state: 'error', message: 'Скачанное обновление не прошло проверку подписи — не устанавливаю.', manual: true });
        try { autoUpdater.autoInstallOnAppQuit = false; } catch (e) {}
        return;
      }
      downloadedVersion = v || '';
      // R3: пауза между песнями или разговор со зрителями — не повод закрыть программу.
      // Сразу ставим только по кнопке стримера или если в этом запуске вообще ничего не было.
      const decision = updatePolicy.decide({ sessionActive: session.active(), playerBusy: isPlayerBusy(), installRequested });
      if (decision === 'install-now') { startUpdateInstall(v); return; }
      log('обновление: скачано ' + v + ' — поставлю при выходе или по кнопке, посреди стрима не перезапускаю');
      // На выходе electron-updater поставит скачанное сам: install(true, false) — тихо, без перезапуска.
      // Обработчик выхода добавляется сразу после этого события (BaseUpdater.addQuitHandler), поэтому
      // флаг включаем здесь. Свой вызов на before-quit ниже — чтобы это не зависело от порядка в библиотеке.
      try { autoUpdater.autoInstallOnAppQuit = true; } catch (e) {}
      sendUpdateState({ state: 'ready', version: v, onQuit: true });
    });
  }

  function checkForUpdates(manual) {
    manualCheck = !!manual;
    if (manual) showMainWindow();
    // B7b (P5a №3): битые ключи подписи — не начинаем проверку, показываем ошибку в окне.
    if (updateKeysBroken()) {
      log('обновление: проверка подписи сломана — проверку не начинаю');
      sendUpdateState({ state: 'error', message: updateKeysConfig.BROKEN_TEXT, manual: manualCheck });
      manualCheck = false;
      return;
    }
    // Обычные сбои приходят событием 'error' (оно сбрасывает manualCheck). Но проверка может
    // не запуститься вовсе — например, в несобранной копии нет app-update.yml, и обещание
    // отклоняется молча. Тогда по кнопке «Проверить сейчас» не было ни лога, ни состояния.
    const failed = (e) => {
      if (!manualCheck) return;
      const msg = (e && e.message) ? String(e.message).slice(0, 300) : String(e);
      log('обновление: проверить не удалось — ' + msg);
      sendUpdateState({ state: 'error', message: msg, manual: true });
      manualCheck = false;
    };
    try {
      const r = autoUpdater.checkForUpdates();
      if (r && typeof r.catch === 'function') r.catch(failed);
    } catch (e) {
      failed(e);
    }
  }

  // ===== Сборка другого канала того же номера (А12) =====
  // update-channel-set вызывает refreshChannelOffer(): читаем latest.yml целевого канала и решаем,
  // что предложить. Качаем сами (electron net), сверяем sha512 из latest.yml; не совпало — удаляем.
  let channelProbe = 0;      // номер последней проверки: ответы старых проверок не применяем
  let otherJob = null;       // { channel, version, file, state } — идущая загрузка/установка

  async function fetchChannelLatest(channel) {
    const { net: enet } = require('electron');
    const res = await enet.fetch(releaseFeed.feedReleaseUrl(channel), {
      headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8000)
    });
    if (res.status === 404) return null;                     // релизов нет вовсе — это не ошибка
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    return releaseFeed.parseLatestYml(await res.text());
  }

  async function refreshChannelOffer(channel) {
    const target = channel === 'debug' ? 'debug' : 'stable';
    const mine = ++channelProbe;
    let latest;
    try { latest = await fetchChannelLatest(target); }
    catch (e) { latest = { ok: false, error: (e && e.message ? String(e.message) : 'нет ответа').slice(0, 120) }; }
    if (mine !== channelProbe) return updateState.other || null; // пока ждали сеть, канал сменили ещё раз
    const offer = Object.assign({ channel: target, at: Date.now() },
      releaseFeed.decideChannelOffer(app.getVersion(), BUILD.build, target, latest));
    sendUpdateState({ other: offer });
    log('обновление: в канале ' + target + ' — ' + offer.verdict + (offer.version ? ' ' + offer.version : '') + (offer.error ? ' (' + offer.error + ')' : ''));
    return offer;
  }

  function sendOther(patch) {
    const off = Object.assign({}, updateState.other || {}, patch);
    sendUpdateState({ other: off });
    return off;
  }

  // Скачивание и тихая установка сборки другого канала. Возвращает { ok } сразу — дальше состояние в 'other'.
  async function installOtherBuild() {
    const off = updateState.other || {};
    if (off.verdict !== 'same') return { ok: false, error: 'предложения нет' };
    // Сборка уже скачана и ждёт выхода — кнопка «Перезапустить сейчас» ставит её сразу.
    if (otherJob) {
      if (otherJob.state === 'downloaded') { runOtherInstaller(); return { ok: true, version: otherJob.version }; }
      return { ok: false, error: 'busy' };
    }
    if (['downloading', 'ready', 'installing'].includes(updateState.state)) return { ok: false, error: 'busy' };
    const target = off.channel === 'debug' ? 'debug' : 'stable';
    otherJob = { channel: target, version: off.version || '', file: '', state: 'downloading' };
    sendOther({ state: 'downloading', percent: 0, error: '' });
    try {
      const { net: enet } = require('electron');
      const latest = await fetchChannelLatest(target);
      if (!latest) throw new Error('в целевом канале нет релизов');
      if (latest.ok === false) throw new Error(latest.error || 'latest.yml не прочитан');
      // B7b (P5a №12): номер версии — строгий, он попадает в имя файла на диске.
      if (!releaseFeed.safeVersion(latest.version)) throw new Error('в latest.yml непонятный номер версии');
      // B4: та же строгая проверка подписи, что и у обычного обновления — до скачивания установщика
      const sig = await verifyUpdateSignature(target, { version: latest.version, file: latest.file, sha512: latest.sha512 });
      if (!sig.ok) {
        const build = (releaseFeed.FEEDS[target] || {}).build || target;
        if (sig.missing) {
          log('обновление: сборка другого канала ' + latest.version + ' (' + build + ') ещё не подписана — жду');
          throw new Error('Сборка ' + latest.version + ' ещё не подписана — обновление придёт после подписи.');
        }
        log('обновление: сборка другого канала ' + latest.version + ' (' + build + ') не прошла подпись (' + sig.reason + ') — не ставлю');
        throw new Error('Сборка не прошла проверку подписи — не ставлю.');
      }
      const url = releaseFeed.assetUrl(target, latest.file);
      if (!releaseFeed.hostAllowed(url)) throw new Error('адрес загрузки не наш');
      const res = await enet.fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error('установщик не скачался: HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 200 * 1024 * 1024) throw new Error('файл слишком большой — не похоже на установщик');
      if (!releaseFeed.checkSha512(buf, latest.sha512)) throw new Error('sha512 не совпал — файл не тот, удалён');
      const dir = path.join(app.getPath('userData'), 'updates');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'tapyor-' + latest.version + '-' + (releaseFeed.FEEDS[target] || {}).build + '.exe');
      fs.writeFileSync(file, buf);
      otherJob = { channel: target, version: latest.version, file, state: 'downloaded' };
      log('обновление: сборка другого канала скачана — ' + latest.version + ' (' + releaseFeed.FEEDS[target].build + '), sha512 совпал');
      // R3: то же правило, что у обычного обновления — посреди стрима не перезапускаемся.
      // Нажатие «Поставить» означало «скачать», а не «закрыть программу сейчас».
      const decision = updatePolicy.decide({ sessionActive: session.active(), playerBusy: isPlayerBusy(), installRequested: false });
      if (decision === 'install-now') {
        runOtherInstaller();
      } else {
        otherWaitingQuit = true;
        sendOther({ state: 'waiting', version: latest.version });
        log('обновление: сборка другого канала ждёт выхода или кнопки, таймера паузы больше нет');
      }
      return { ok: true, version: latest.version };
    } catch (e) {
      const msg = (e && e.message) ? String(e.message).slice(0, 300) : String(e);
      if (otherJob && otherJob.file) { try { fs.unlinkSync(otherJob.file); } catch (err) {} }
      otherJob = null;
      sendOther({ state: 'error', error: msg, percent: 0 });
      log('обновление: сборка другого канала не поставлена — ' + msg);
      return { ok: false, error: msg };
    }
  }

  // B7b (P5a №16): см. canRunOtherInstaller выше.
  function runOtherInstaller(opts) {
    if (!canRunOtherInstaller(otherJob)) return;
    otherJob.state = 'installing';
    const o = opts || {};
    const forceRun = o.forceRun !== false;   // при выходе — без --force-run: программа сама не откроется
    const file = otherJob.file, ver = otherJob.version;
    log('обновление: тихая установка сборки другого канала ' + ver + (o.quit === false ? ' при выходе, без перезапуска' : ' и выход'));
    sendOther({ state: 'installing', version: ver });
    try {
      const { spawn } = require('child_process');
      const args = ['/S', '--updated'].concat(forceRun ? ['--force-run'] : []);
      spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (e) {
      sendOther({ state: 'error', error: 'не удалось запустить установщик: ' + (e && e.message) });
      otherJob = null;
      return;
    }
    otherWaitingQuit = false;
    if (o.quit === false) return;
    setTimeout(() => {
      // Перед установкой сборки другого канала — настройки и очередь на диск (R2).
      try { settingsDisk.flush(); } catch (e) {}
      try { ensureTodayStore().flush(); } catch (e) {}
      app.isQuitting = true;
      app.quit();
    }, 1500);
  }

  // Обычный выход: скачанную сборку другого канала ставим без --force-run.
  function installOtherOnQuit() {
    if (!otherWaitingQuit || !otherJob || otherJob.state !== 'downloaded') return;
    runOtherInstaller({ forceRun: false, quit: false });
  }

  // Обработчики каналов update-* (перенесено из main.js без изменения поведения).
  // Регистрируются на том же месте запуска, что и раньше.
  function registerIpc() {
    ipcMain.handle('update-get-state', () => updateState);
    ipcMain.handle('update-check', () => { checkForUpdates(true); return true; });
    ipcMain.handle('update-channel-get', () => updChannel());
    // Смена канала: только 'stable' | 'debug'; перед сменой — копия настроек и заказов; затем сразу проверка в новом канале
    ipcMain.handle('update-channel-set', (e, ch) => {
      if (ch !== 'stable' && ch !== 'debug') return { ok: false };
      if (ch === updChannel()) return { ok: true, channel: ch };
      if (['downloading', 'ready', 'installing'].includes(updateState.state)) return { ok: false, error: 'busy' };
      // B7b (P5a №13): подпись, прошедшая для старого канала, не должна разрешать скачивание в новом.
      updCheck = null;
      const backup = backupBeforeChannel(ch);
      const s = readSettingsFile(); s.updChannel = ch; writeSettingsFile(s);
      log('обновление: канал → ' + ch);
      applyUpdChannel();
      checkForUpdates(true);
      // и отдельно — что в целевом канале: тот же номер другой сборки обычный autoUpdater не поставит
      refreshChannelOffer(ch).catch(() => {});
      return { ok: true, channel: ch, backup: !!backup };
    });
    ipcMain.handle('update-download', () => {
      // B7b (P5a №3): сломанная проверка подписи — не качаем ничего.
      if (updateKeysBroken()) {
        log('обновление: скачивание — проверка подписи сломана, отказ');
        sendUpdateState({ state: 'error', message: updateKeysConfig.BROKEN_TEXT, manual: true });
        return false;
      }
      // B4: скачать неподписанное нельзя никаким путём — пускаем только проверенную версию
      if (!updSignatureAllowed()) {
        log('обновление: скачивание без проверенной подписи — отказ');
        sendUpdateState({ state: 'error', message: 'Обновление не проверено по подписи — не скачиваю.', manual: true });
        return false;
      }
      installRequested = true;
      // Уже скачано и ждёт выхода — кнопка «Перезапустить сейчас» ставит сразу.
      if (updateState.state === 'ready') { startUpdateInstall(downloadedVersion || updateState.version || ''); return true; }
      if (updateState.state === 'downloading') return true; // уже качается
      sendUpdateState({ state: 'downloading', percent: 0 });
      autoUpdater.downloadUpdate().catch((e) => sendUpdateState({ state: 'error', message: String(e && e.message || e).slice(0, 300) }));
      return true;
    });

    // ===== Честное предложение сборки другого канала (А12) =====
    // Обычный autoUpdater не ставит сборку того же номера, поэтому номер и файл целевого канала
    // читаем сами из latest.yml релиза и, если номер совпал, предлагаем кнопку «Поставить …».
    ipcMain.handle('update-channel-offer', () => updateState.other || null);
    ipcMain.handle('update-channel-probe', (e, ch) => refreshChannelOffer(ch === 'debug' ? 'debug' : 'stable'));
    ipcMain.handle('update-install-other', () => installOtherBuild());
  }
  return {
    registerIpc,
    initUpdater,
    checkForUpdates,
    installUpdateOnQuit,
    installOtherOnQuit,
    getState: () => updateState,
    channel: updChannel
  };
}
