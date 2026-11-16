// Самопроверка сервисов: глубокая (runHealth), быстрая при запуске (quickCheck),
// автопочинка (auto-fix) и их каналы qc-* / autofix-* / health-*.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const {
    app, ipcMain, log, cfg, settingsStore, readSettingsFile, recipes, ytdlpModule, ym, ymweb,
    getYmToken, ymStatus, ytsT, auSearch, auStreamUrl, AU_APP, ytAuthStatus, sbotCheck, sbotStatusNow,
    upd, sendReport, autofixR, autofixModule, lastfm, donations, cloudCheck,
    REPORT_URL, CLOUD_KEY, CLOUD_KEY_HEADER, isPlayerBusy
  } = ctx;
  let healthRunning = null;
  const step = (name, ok, text, details, stage) => ({ name, ok, text, details: details || '', stage: stage || '' });
  async function checkYandex(quiet, prev) {
    const steps = [];
    const tok = getYmToken();
    if (!tok) return { status: 'skip', title: 'Нет входа в Яндекс — проверять нечего', steps };
    const R = recipes.get().yandex || {};
    let tr = null;
    try {
      const r = await ym.search(R.testQuery || 'Кино Группа крови', tok);
      tr = (r.tracks || []).find((x) => x.albumId) || (r.tracks || [])[0];
      steps.push(step('Поиск в Яндексе', !!tr, tr ? 'работает' : 'ничего не нашёл'));
    } catch (e) { steps.push(step('Поиск в Яндексе', false, 'не работает — Яндекс мог поменять своё API', e.message)); }
    if (!tr) { const last = settingsStore.get('healthYmTrack'); if (last) tr = last; }
    let apiOk = false;
    if (tr) {
      try { const s2 = await ym.streamUrl(tr.id, tok); apiOk = !!(s2 && s2.audioUrl); steps.push(step('Воспроизведение (основной способ)', apiOk, apiOk ? (s2.preview ? 'работает, но только отрывки — нет Плюса' : 'работает') : 'поток не получен')); }
      catch (e) { steps.push(step('Воспроизведение (основной способ)', false, 'не работает — Яндекс мог поменять своё API', e.message)); }
      settingsStore.set('healthYmTrack', { id: tr.id, albumId: tr.albumId, title: tr.title, seconds: tr.seconds });
    }
    let siteOk = null;
    if (!cfg('ymWebFallback')) steps.push(step('Запасной способ (сайт Яндекс Музыки)', null, 'выключен в настройках'));
    else if (quiet) {
      // Тихий прогон: музыка играет, сайт трогать нельзя — переносим прошлый вердикт как есть
      const was = prev && prev.services && prev.services.yandex && (prev.services.yandex.steps || []).find((x) => /сайт/i.test(x.name));
      if (was) { siteOk = was.ok; steps.push(step(was.name, was.ok, was.text, was.details, was.stage)); }
      else steps.push(step('Запасной способ (сайт Яндекс Музыки)', null, 'проверю, когда музыка не играет'));
    }
    else if (tr) {
      const r = await ymweb.probe(tr);
      if (r && (r.stage === 'busy' || r.stage === 'cancel')) {
        // Окно занято пробой другой проверки или живой музыкой — прошлый вердикт не трогаем
        const was = prev && prev.services && prev.services.yandex && (prev.services.yandex.steps || []).find((x) => /сайт/i.test(x.name));
        if (was) { siteOk = was.ok; steps.push(step(was.name, was.ok, was.text, was.details, was.stage)); }
        else steps.push(step('Запасной способ (сайт Яндекс Музыки)', null, 'проверю, когда окно сайта освободится'));
      } else {
        siteOk = !!(r && r.ok);
        steps.push(step('Запасной способ (сайт Яндекс Музыки)', siteOk, siteOk ? 'работает' : (r.error || 'не работает'), (r && r.details) || '', (r && r.stage) || ''));
      }
    }
    const status = apiOk && siteOk !== false ? 'ok' : (apiOk || siteOk ? 'warn' : 'fail');
    const title = status === 'ok' ? 'Работает' : (apiOk ? 'Работает, но запасной способ сломан' : (siteOk ? 'Основной способ сломан — играет через сайт' : 'Не работает — слушай во вкладке «Браузер»'));
    return { status, title, steps };
  }
  async function checkYouTube() {
    const steps = [];
    if (cfg('ytEnabled') === false) return { status: 'skip', title: 'YouTube выключен в настройках', steps };
    const R = recipes.get().youtube || {};
    let net1 = true;
    try { const r = await ytsT(R.testQuery || 'Кино Группа крови', 8000); steps.push(step('Поиск на YouTube', !!(r.videos && r.videos.length), (r.videos && r.videos.length) ? 'работает' : 'ничего не нашёл')); }
    catch (e) { net1 = false; steps.push(step('Поиск на YouTube', false, 'YouTube не отвечает — возможно, нужен VPN на весь компьютер', e.message)); }
    const up = await ytdlpModule.ytdlpUpdate();
    const ver = await ytdlpModule.ytdlpVersion(ytdlpModule.ytdlpPath());
    steps.push(step('Движок YouTube', !!ver, ver ? 'версия ' + ver + (up.updated ? ' — только что обновлена' : (up.ok ? ', свежая' : ', обновить не удалось')) : 'не найдена', up.ok ? '' : up.text));
    let dlOk = false;
    if (net1) {
      const r = await ytdlpModule.streamViaYtDlp('https://www.youtube.com/watch?v=' + (R.testVideo || 'jNQXAC9IVRw'));
      dlOk = !!(r && (r.url || r.audioUrl));
      steps.push(step('Воспроизведение (основной способ)', dlOk, dlOk ? 'работает' : 'не работает — включится плеер YouTube', r && r.error ? String(r.error).slice(0, 300) : ''));
    }
    const status = !net1 ? 'fail' : (dlOk ? 'ok' : 'warn');
    const title = status === 'ok' ? 'Работает' : (status === 'warn' ? 'Основной способ сломан — играет через плеер YouTube' : 'YouTube недоступен');
    return { status, title, steps };
  }
  async function checkSoundCloud() {
    if (cfg('scEnabled') === false) return { status: 'skip', title: 'SoundCloud выключен в настройках', steps: [] };
    const steps = [];
    const r = await ytdlpModule.scSearch('Kino Gruppa krovi', 3);
    const ok = Array.isArray(r) && r.length > 0;
    steps.push(step('Поиск на SoundCloud', ok, ok ? 'работает' : 'не работает', r && r.error ? r.error : ''));
    let st = false;
    if (ok) { const s2 = await ytdlpModule.urlStream(r[0].id); st = !!(s2 && s2.audioUrl); steps.push(step('Воспроизведение', st, st ? 'работает' : 'не работает', s2 && s2.error ? s2.error : '')); }
    return { status: ok && st ? 'ok' : (ok ? 'warn' : 'fail'), title: ok && st ? 'Работает' : (ok ? 'Поиск работает, воспроизведение — нет' : 'Не работает'), steps };
  }
  async function checkAudius() {
    if (cfg('auEnabled') === false) return { status: 'skip', title: 'Audius выключен в настройках', steps: [] };
    const r = await auSearch('lofi', 3);
    const ok = Array.isArray(r) && r.length > 0;
    let st = null;
    if (ok) {
      try { const { net } = require('electron'); const s2 = await net.fetch(auStreamUrl(r[0].id), { method: 'GET', headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(10000) }); st = s2.ok || s2.status === 206; }
      catch (e) { st = false; }
    }
    const steps = [step('Поиск на Audius', ok, ok ? 'работает' : ((r && r.error) || 'не работает')), step('Воспроизведение', ok ? st : null, ok ? (st ? 'работает' : 'не работает') : 'не проверялось')];
    return { status: ok && st ? 'ok' : (ok ? 'warn' : 'fail'), title: ok && st ? 'Работает' : (r && r.error ? r.error : 'Не работает'), steps };
  }
  // quiet — прогон во время музыки: всё то же, но без шагов со звуком (сайт Яндекса).
  // Без него у стримера глубокая проверка не запускалась вообще: музыка играет почти всегда,
  // а окно отменяло проверку целиком, и вердикт по сервисам устаревал на недели.
  async function runHealth(opts) {
    if (healthRunning) return healthRunning;
    const quiet = !!(opts && opts.skipAudio);
    healthRunning = (async () => {
      log('самопроверка: начало' + (quiet ? ' (тихий прогон — играет музыка, сайт не трогаю)' : ''));
      await recipes.refresh();
      const prev = settingsStore.get('health');
      const res = { at: Date.now(), services: {}, recipes: recipes.info(), quiet };
      if (quiet) res.siteAt = (prev && (prev.siteAt != null ? prev.siteAt : prev.at)) || 0;  // сайт не проверяли — возраст тянем с прошлого раза
      try { res.services.yandex = await checkYandex(quiet, prev); } catch (e) { res.services.yandex = { status: 'fail', title: 'Проверка не удалась', steps: [step('Проверка', false, e.message)] }; }
      try { res.services.soundcloud = await checkSoundCloud(); } catch (e) { res.services.soundcloud = { status: 'fail', title: 'Проверка не удалась', steps: [step('Проверка', false, e.message)] }; }
      try { res.services.audius = await checkAudius(); } catch (e) { res.services.audius = { status: 'fail', title: 'Проверка не удалась', steps: [step('Проверка', false, e.message)] }; }
      try { res.services.youtube = await checkYouTube(); } catch (e) { res.services.youtube = { status: 'fail', title: 'Проверка не удалась', steps: [step('Проверка', false, e.message)] }; }
      settingsStore.set('health', res);
      // Отчёты: сломанные шаги глубокой проверки (кроме «нет сети / нужен VPN»)
      const SLUG = { 'Поиск': 'search', 'Воспроизведение': 'stream', 'Запасной': 'site', 'Движок': 'ytdlp' };
      for (const [name, sv] of Object.entries(res.services)) {
        (sv.steps || []).filter((st) => st.ok === false && !/VPN|не отвечает/i.test(st.text || '')).forEach((st) => {
          const stage = (Object.keys(SLUG).find((k) => st.name.indexOf(k) === 0) && SLUG[Object.keys(SLUG).find((k) => st.name.indexOf(k) === 0)]) || 'check';
          sendReport({ service: name, stage, code: st.stage || String(st.details || st.text || '').split(/[:\n]/)[0].slice(0, 40) || 'fail', msg: st.name + ': ' + (st.text || ''), details: st.details || '' });
        });
      }
      log('самопроверка: Яндекс — ' + res.services.yandex.status + ', YouTube — ' + res.services.youtube.status + ', SoundCloud — ' + res.services.soundcloud.status);
      for (const [name, sv] of Object.entries(res.services)) {
        log('самопроверка · ' + name + ': ' + sv.status + (sv.title ? ' — ' + sv.title : ''));
        (sv.steps || []).forEach((st) => log('   ' + (st.ok ? '✓' : '✗') + ' ' + st.name + (st.text ? ': ' + st.text : '') + (st.details ? ' [' + String(st.details).slice(0, 300) + ']' : '')));
      }
      if (res.recipes) log('самопроверка · рецепты: ' + JSON.stringify(res.recipes).slice(0, 300));
      return res;
    })();
    try { return await healthRunning; } finally { healthRunning = null; }
  }
  // ===== Быстрая проверка при запуске: всё параллельно, по 6 секунд на пункт, без воспроизведения =====
  // Каждый пункт сразу сообщается окну (qc-item), чтобы лампочки загорались по очереди.
  const QC_T = 6000;
  // Почему сломался запасной путь — коды из ymweb.js (stage), словами для чеклиста
  const YM_SITE_WHY = { open: 'сайт Яндекса не открылся', button: 'сайт изменился — нет кнопки «Слушать»', login: 'на сайте Яндекса нет входа', sound: 'сайт не начал играть', match: 'сайт включил другой трек', notrack: 'нечем проверить — нет трека для пробы' };
  // Код Chromium (ERR_…) показываем прямо в строке: без него «не открылся» ничего не объясняет
  const errCode = (s) => { const m = /ERR_[A-Z0-9_]+/.exec(String(s || '')); return m ? ' (' + m[0] + ')' : ''; };
  async function ping(url, opts) {
    const t0 = Date.now();
    const { net: enet } = require('electron');
    const r = await enet.fetch(url, Object.assign({ method: 'GET', signal: AbortSignal.timeout(QC_T), redirect: 'follow' }, opts || {}));
    try { r.body && r.body.cancel && r.body.cancel(); } catch (e) {}
    return { status: r.status, ms: Date.now() - t0 };
  }
  const verOlder = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; } return false; };
  const ytdlpAgeDays = (v) => { const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(v || ''); return m ? Math.round((Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000) : null; };
  let qcRunning = null;
  async function quickCheck(send) {
    if (qcRunning) return qcRunning;
    qcRunning = (async () => {
      const out = {};
      const put = (id, state, text, extra) => { out[id] = Object.assign({ id, state, text }, extra || {}); try { send && send(out[id]); } catch (e) {} };
      const t0 = Date.now();
      const job = async (id, fn) => { put(id, 'run', 'проверяю…'); try { await fn(); } catch (e) { put(id, 'bad', 'ошибка проверки', { details: String(e.message || e).slice(0, 300) }); } };
      // Интернет — от него зависит всё остальное
      let online = false;
      await job('net', async () => {
        for (const u of ['https://ya.ru/', 'https://www.google.com/generate_204']) { try { const r = await ping(u); online = true; put('net', 'ok', 'есть · ' + r.ms + ' мс'); return; } catch (e) {} }
        put('net', 'bad', 'нет связи', { action: 'retry' });
      });
      if (!online) {
        ['app', 'recipes', 'ym.svc', 'ym.acc', 'ym.play', 'ym.site', 'yt.svc', 'yt.login', 'yt.dlp', 'sc', 'refs', 'tg', 'don', 'cloud'].forEach((id) => put(id, 'off', 'нет интернета'));
      } else {
        await Promise.all([
          job('app', async () => {
            const u = upd.getState() || {};
            if (u.state === 'available' || u.state === 'downloading' || u.state === 'ready') put('app', 'warn', 'вышла ' + (u.version || 'новая версия'), { action: 'update' });
            else put('app', 'ok', app.getVersion() + (u.state === 'latest' ? ' · последняя' : ''));
          }),
          job('recipes', async () => { const r = await recipes.refresh(); const i = recipes.info(); put('recipes', r.ok ? 'ok' : 'warn', 'v' + i.version + (r.ok ? ' · свежие' : ' · GitHub недоступен, работаю на сохранённых')); }),
          job('ym.svc', async () => { const r = await ping('https://api.music.yandex.net/genres'); put('ym.svc', r.status < 500 ? 'ok' : 'bad', r.status < 500 ? 'доступен · ' + r.ms + ' мс' : 'ошибка ' + r.status, r.status < 500 ? {} : { report: { stage: 'service', code: 'HTTP ' + r.status } }); }),
          job('ym.acc', async () => {
            const st = await ymStatus();
            // Вход снова работает — снимаем «войдите заново» у автопочинки.
            if (st.loggedIn) { try { autofixR.success('yandex', 'login'); } catch (e) {} }
            if (!st.loggedIn) put('ym.acc', st.error ? 'bad' : 'off', st.error || 'нет входа', { action: 'ym-login' });
            else put('ym.acc', st.offline ? 'warn' : (st.hasPlus ? 'ok' : 'warn'), (st.name || 'вход есть') + (st.offline ? ' · не проверить' : (st.hasPlus ? ' · Плюс' : ' · без Плюса — отрывки')));
            const tok = getYmToken(), tr = settingsStore.get('healthYmTrack');
            if (!tok) { put('ym.play', 'off', 'нужен вход'); return; }
            if (!tr) { put('ym.play', 'off', 'проверится при глубокой проверке'); return; }
            try { const s2 = await ym.streamUrl(tr.id, tok); const ok = !!(s2 && s2.audioUrl); put('ym.play', ok ? (s2.preview ? 'warn' : 'ok') : 'bad', ok ? (s2.preview ? 'только отрывки' : 'поток получен') : 'поток не получен', ok ? {} : { report: { stage: 'stream', code: 'no-url' } }); }
            catch (e) { put('ym.play', 'bad', 'не работает', { details: e.message, report: { stage: 'stream', code: String(e.status || e.message).slice(0, 40) } }); }
          }),
          job('ym.site', async () => {
            if (!cfg('ymWebFallback')) { put('ym.site', 'off', 'выключен в настройках'); return; }
            const h = settingsStore.get('health'), y = h && h.services && h.services.yandex;
            const st = y && (y.steps || []).find((x) => /сайт/i.test(x.name));
            if (!st || st.ok == null) { put('ym.site', 'off', 'проверяется раз в сутки'); return; }
            // Быстрая проверка сайт не трогает — она пересказывает последнюю глубокую.
            // У стримера музыка играет почти всегда, а глубокая проверка при звуке не
            // запускается, так что вердикт может быть недельной давности: говорим об этом
            // прямо, а не выдаём старое за сегодняшнее.
            const at = h ? (h.siteAt != null ? h.siteAt : h.at) : 0;
            const ageH = at ? (Date.now() - at) / 3600000 : null;
            const old = ageH != null && ageH > 26;
            const when = ageH == null ? '' : ' · проверено ' + (ageH < 48 ? Math.round(ageH) + ' ч назад' : Math.round(ageH / 24) + ' дн. назад');
            if (st.ok) { put('ym.site', 'ok', 'работает' + (old ? when : '')); return; }
            const why = (YM_SITE_WHY[st.stage] || 'не работает') + (st.stage === 'open' ? errCode(st.details) : '');
            put('ym.site', old ? 'warn' : 'bad', why + (old ? when : ''),
              { action: st.stage === 'login' ? 'ym-site-login' : 'fix', report: { stage: 'site', code: st.stage || 'fail' }, details: st.details || st.text });
          }),
          job('yt.svc', async () => {
            if (cfg('ytEnabled') === false) { put('yt.svc', 'off', 'выключен в настройках'); return; }
            try { const r = await ping('https://www.youtube.com/generate_204'); put('yt.svc', r.status < 500 ? 'ok' : 'bad', 'доступен · ' + r.ms + ' мс'); }
            catch (e) { put('yt.svc', 'bad', 'не отвечает', { action: 'vpn' }); }
          }),
          job('yt.login', async () => {
            const a = ytAuthStatus();
            const who = (a.cookies && a.cookies.name) || (a.oauth && a.oauth.account && a.oauth.account.name);
            if (who) { try { autofixR.success('youtube', 'login'); } catch (e) {} }
            put('yt.login', who ? 'ok' : 'off', who ? who : 'нет входа', who ? {} : { action: 'yt-login' });
          }),
          job('yt.dlp', async () => {
            // «Устарел» — только если вышла версия новее (по GitHub); старая дата сама по себе не проблема
            const v = await ytdlpModule.ytdlpVersion(ytdlpModule.ytdlpPath());
            if (!v) { put('yt.dlp', 'bad', 'не найден', { action: 'fix', report: { stage: 'ytdlp', code: 'missing' } }); return; }
            let latest = '';
            try {
              const { net: enet } = require('electron');
              const r = await enet.fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tapyor' }, signal: AbortSignal.timeout(QC_T) });
              if (r.ok) latest = String((await r.json()).tag_name || '').replace(/^v/, '');
            } catch (e) {}
            const older = latest && verOlder(v, latest);
            put('yt.dlp', older ? 'warn' : 'ok', 'версия ' + v + (older ? ' · есть новее' : (latest ? ' · последняя' : '')), older ? { action: 'fix' } : {});
          }),
          job('sc', async () => {
            const res = await Promise.allSettled([ping('https://soundcloud.com/'), ping('https://api.audius.co/v1/tracks/trending?limit=1&app_name=' + AU_APP)]);
            const okN = res.filter((x) => x.status === 'fulfilled' && x.value.status < 500).length;
            put('sc', okN === 2 ? 'ok' : (okN ? 'warn' : 'bad'), okN === 2 ? 'доступны' : (okN ? (res[0].status === 'fulfilled' ? 'Audius не отвечает' : 'SoundCloud не отвечает') : 'не отвечают'));
          }),
          job('refs', async () => {
            const { net: enet } = require('electron');
            const dzP = ping('https://api.deezer.com/genre').then((r) => !!(r && r.status < 500)).catch(() => false);
            const lfP = lastfm.configured()
              ? lastfm.check({ fetch: (u, o) => enet.fetch(u, o) }).catch(() => ({ ok: false, reason: 'Last.fm не отвечает' }))
              : Promise.resolve({ ok: false, reason: 'Last.fm без ключа' });
            const [dz, lf] = await Promise.all([dzP, lfP]);
            if (dz && lf.ok) put('refs', 'ok', 'доступны');
            else if (dz) put('refs', 'warn', lf.reason || 'Last.fm не отвечает');            // Б13: текст про VPN
            else if (lf.ok) put('refs', 'warn', 'Deezer не отвечает');
            else put('refs', 'bad', lf.reason || 'не отвечают');
          }),
          job('don', async () => {
            if (readSettingsFile().streamerMode === false) { put('don', 'off', 'выключено («Стримерам»)'); return; }
            const st = donations.status(); const on = Object.keys(st).filter((k) => st[k].connected);
            if (!on.length) { put('don', 'off', 'не подключены'); return; }
            const r = await donations.check(); const bad = on.filter((k) => !(r[k] && (r[k].ok || r[k].pending)));
            const pend = on.filter((k) => r[k] && r[k].pending);
            const authBad = bad.find((k) => /устарел|401|403|invalid|вход/i.test(String((r[k] && r[k].error) || '')));
            put('don', bad.length ? ((authBad || bad.length === on.length) ? 'bad' : 'warn') : 'ok',
              bad.length ? bad.map((k) => st[k].name + ': ' + ((r[k] && r[k].error) || 'нет связи')).join(' · ')
                : pend.length === on.length ? on.map((k) => st[k].name).join(' · ') + ' — первый опрос идёт'
                : on.map((k) => st[k].name).join(' · ') + ' на связи',
              authBad ? { report: { stage: 'poll', code: 'auth', msg: 'DonationAlerts: вход устарел — нужен повторный вход' }, details: 'DonationAlerts: вход устарел — нужен повторный вход' } : undefined);
          }),
          // Облачные функции Тапёра: при отказе говорим, что случилось и куда смотреть (биллинг, логи, ключ).
          // Отчёт об ошибке здесь не шлём — он сам идёт через облачную функцию.
          job('cloud', async () => {
            const { net: enet } = require('electron');
            const list = await cloudCheck.check([
              { id: 'da', url: cloudCheck.readProxy('da.json') },
              { id: 'google', url: cloudCheck.readProxy('google-oauth.json') },
              { id: 'report', url: REPORT_URL },
            ], { fetch: (u, o) => enet.fetch(u, o), key: CLOUD_KEY, keyHeader: CLOUD_KEY_HEADER, timeoutMs: QC_T });
            const s = cloudCheck.summary(list);
            if (s.state !== 'ok' && s.state !== 'off') log('облако: ' + s.text + (s.details ? ' | ' + s.details.replace(/\n/g, ' | ') : ''));
            put('cloud', s.state, s.text, s.where ? { details: s.details, where: s.where, action: 'cloud' } : {});
          })
        ]);
      }
      // Streamer.bot (0.35, Э4): строки чеклиста — только когда заказы из чата идут через него.
      // sbotEnabled («пульт когда-то включали») здесь не учитываем: иначе ложная ошибка у тех,
      // кто Streamer.bot для заказов не использует (G1, 13.11). Проверка мгновенная, без сети.
      if (sbotCheck.showInChecklist({ chatOrders: cfg('chatOrders'), sbotEnabled: cfg('sbotEnabled') })) {
        const sb = sbotStatusNow();
        await job('sbot.link', async () => {
          if (sb.status === 'ok') put('sbot.link', 'ok', 'связь есть' + (sb.sbVersion ? ' · Streamer.bot ' + sb.sbVersion : ''));
          else if (sb.status === 'off') put('sbot.link', 'bad', 'подключение выключено — нажми «Подключиться»', { action: 'sbot' });
          else put('sbot.link', 'bad', [sb.text || 'Streamer.bot не отвечает', sb.nextRetryMs ? 'повтор через ' + Math.round(sb.nextRetryMs / 1000) + ' с' : ''].filter(Boolean).join(' · '), { action: 'sbot' });
        });
        await job('sbot.tpl', async () => {
          if (sb.status !== 'ok') put('sbot.tpl', 'off', 'проверится при связи');
          else if (!sb.templateFound) put('sbot.tpl', 'bad', 'шаблон не найден — скопируй и импортируй в Streamer.bot', { action: 'sbot' });
          else if (sb.templateVersion < sb.templateCurrent) put('sbot.tpl', 'warn', 'шаблон v' + sb.templateVersion + ' · есть новее v' + sb.templateCurrent, { action: 'sbot' });
          else put('sbot.tpl', 'ok', 'шаблон v' + sb.templateVersion);
        });
      }
      const res = { at: Date.now(), ms: Date.now() - t0, items: out };
      const bad = Object.values(out).filter((x) => x.state === 'bad' || x.state === 'warn').map((x) => x.id + ':' + x.text);
      log('быстрая проверка: ' + Math.round(res.ms / 100) / 10 + ' с' + (bad.length ? ' · внимание: ' + bad.join('; ') : ' · всё работает'));
      // Отчёты об ошибках сервисов (не «нет входа» и не «нет интернета»).
      // Раньше отчёты просто выстреливались в пустоту, а автопочинка всё равно писала
      // «отчёт отправлен разработчику» — даже когда отправка была выключена, отклонена
      // или такой же отчёт уже уходил сегодня. Теперь ждём ответа (но не дольше 4 секунд,
      // чтобы не задерживать чеклист) и запоминаем, чем дело кончилось.
      const bads = Object.values(out).filter((x) => x.report && x.state === 'bad');
      if (bads.length) {
        const all = Promise.all(bads.map((x) => sendReport({ service: x.id.split('.')[0], stage: x.report.stage, code: x.report.code, msg: x.report.msg || x.text, details: x.details || '' }).catch(() => ({ ok: false }))));
        const got = await Promise.race([all, new Promise((r) => setTimeout(() => r(null), 4000))]);
        res.reports = got ? got.map((z) => (z && z.ok ? 'sent' : (z && z.skipped) || 'fail')) : ['slow'];
      }
      settingsStore.set('quickCheck', res);
      // Автопочинка (0.34.0, шаг 5): проблемные строки проверки — повод один раз попробовать.
      // Не ждём её: чеклист должен показаться сразу, починка идёт следом.
      try {
        const extra = [];
        const refs = out.refs;
        if (refs && (refs.state === 'bad' || refs.state === 'warn') && lastfm.configured() && /Last\.fm/i.test(refs.text || '')) {
          extra.push({ service: 'lastfm', kind: 'check', reason: refs.text });
        }
        const don = out.don;
        if (don && (don.state === 'bad' || don.state === 'warn')) {
          const st = donations.status();
          [['da', 'donationalerts'], ['dp', 'donatepay']].forEach((pair) => {
            const x = st[pair[0]] || {};
            if (!x.connected || x.ok !== false) return;
            const err = String(x.error || '');
            if (/устарел|401|403|invalid|вход/i.test(err)) extra.push({ service: pair[1], kind: 'poll', auth: true, reason: err });
            else extra.push({ service: pair[1], kind: 'poll', reason: don.text });
          });
        }
        Promise.resolve(autofixR.check(out, extra)).catch((e) => log('авточинка: проверка не запустилась — ' + ((e && e.message) || e)));
      } catch (e) { log('авточинка: проверка не запустилась — ' + ((e && e.message) || e)); }
      return res;
    })();
    try { return await qcRunning; } finally { qcRunning = null; }
  }
  ipcMain.handle('qc-run', (e) => quickCheck((it) => { try { e.sender.send('qc-item', it); } catch (x) {} }));
  ipcMain.handle('qc-get', () => settingsStore.get('quickCheck') || null);

  // ===== Автопочинка: по шагам, с отчётом что сделано =====
  // Ручной запуск всех починок. Пока он идёт, свои автопопытки не запускаются (beginManual),
  // а в конце отметка «один раз» снимается — ручное нажатие её и так снимает.
  ipcMain.handle('auto-fix', async (e) => {
    autofixR.beginManual();
    try {
    const done = [];
    const say = (t, ok) => { done.push({ t, ok }); try { e.sender.send('fix-step', { t, ok }); } catch (x) {} log('автопочинка: ' + (ok ? '✓ ' : '✗ ') + t); };
    const r1 = await recipes.refresh(); say(r1.ok ? 'Рецепты сайтов обновлены до v' + recipes.info().version : 'Свежие рецепты скачать не удалось — GitHub недоступен', r1.ok);
    const r2 = await ytdlpModule.ytdlpUpdate(); say(r2.updated ? 'Движок YouTube обновлён' + (r2.version ? ' до ' + r2.version : '') : (r2.ok ? 'Движок YouTube уже свежий' : 'Движок YouTube обновить не удалось'), r2.ok);
    const ys = await ymStatus(); say(ys.loggedIn ? 'Вход в Яндекс в порядке' + (ys.offline ? ' (не проверить — Яндекс не отвечает)' : '') : 'Нужно войти в Яндекс заново', ys.loggedIn);
    // Запасной путь быстрая проверка не трогает — она пересказывает последнюю глубокую.
    // Поэтому после свежих рецептов проверяем сайт прямо здесь: иначе лампочка осталась бы
    // красной до следующей глубокой проверки, а у стримера она почти не случается.
    await (async () => {
      if (!cfg('ymWebFallback')) return;
      const hs = settingsStore.get('health');
      const yv = hs && hs.services && hs.services.yandex;
      const st = yv && (yv.steps || []).find((x) => /сайт/i.test(x.name));
      if (!st || st.ok !== false) return;
      if (isPlayerBusy()) { say('Запасной путь не перепроверить — сейчас играет музыка', true); return; }
      const tr = settingsStore.get('healthYmTrack');
      if (!tr) { say('Запасной путь не перепроверить — нет трека для пробы', true); return; }
      try {
        const rr = await ymweb.probe(tr);
        if (rr && (rr.stage === 'busy' || rr.stage === 'cancel')) { say('Запасной путь сейчас проверяет глубокая проверка — вердикт появится через минуту', true); return; }
        st.ok = !!(rr && rr.ok);
        st.text = st.ok ? 'работает' : ((rr && rr.error) || 'не работает');
        st.details = (rr && rr.details) || '';
        st.stage = (rr && rr.stage) || '';
        hs.siteAt = Date.now();
        settingsStore.set('health', hs);
        say(st.ok ? 'Запасной путь Яндекса снова работает' : 'Запасной путь Яндекса: ' + st.text, st.ok);
      } catch (x) { say('Запасной путь проверить не удалось: ' + x.message, false); }
    })();
    { const a = ytAuthStatus(); const who = (a.cookies && a.cookies.name) || (a.oauth && a.oauth.account && a.oauth.account.name); say(who ? 'Вход в YouTube есть: ' + who : 'Вход в YouTube не настроен (не обязателен)', true); }
    try {
      const { session } = require('electron');
      await session.defaultSession.clearCache(); await session.fromPartition('persist:yandex-login').clearCache();
      say('Временные файлы площадок очищены (входы не тронуты)', true);
    } catch (x) { say('Очистить временные файлы не удалось', false); }
    const q = await quickCheck((it) => { try { e.sender.send('qc-item', it); } catch (x) {} });
    const left = Object.values(q.items).filter((x) => x.state === 'bad').length;
    if (!left) say('Проверка заново: всё работает', true);
    else {
      const rp = q.reports || [];
      const tail = !rp.length ? ' — отчёт по ним не предусмотрен'
        : rp.includes('sent') ? ' — отчёт отправлен разработчику'
        : rp.includes('today') ? ' — отчёт разработчику уже уходил сегодня'
        : rp.includes('off') ? ' — отправка отчётов выключена в настройках'
        : rp.includes('slow') ? ' — отчёт отправляется'
        : ' — отчёт отправить не удалось';
      say('Осталось проблем: ' + left + tail, false);
    }
    return { done, left };
    } finally { autofixR.endManual(); }
  });

  // Ручное «Починить» для одного сервиса (кнопка в группе «Автопочинка»).
  // Снимает отметку «один раз» и повторяет починку; аргумент — только из белого списка.
  ipcMain.handle('autofix-get', () => ({ ok: true, services: autofixR.snapshot() }));
  ipcMain.handle('autofix-run', async (e, service) => {
    const svc = String(service == null ? '' : service);
    if (!autofixModule.isService(svc)) return { ok: false, error: 'неизвестный сервис' };
    const r = await autofixR.manual(svc);
    return { ok: true, result: r, services: autofixR.snapshot() };
  });

  // health-get и health-run регистрируются на прежнем месте — после обработчиков отчётов и палитр.
  function registerIpc() {
    ipcMain.handle('health-get', () => settingsStore.get('health') || null);
    ipcMain.handle('health-run', (e, o) => ((o && o.skipAudio) ? runHealth(o) : (isPlayerBusy() ? { busy: true } : runHealth())));
  }

  return { ping, registerIpc };
}
