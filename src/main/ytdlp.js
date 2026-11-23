// yt-dlp: поиск пути и рабочей копии, версия, обновление движка, запуск и разборы его вывода.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const {
    app, fs, path, execFile, crypto, https, log, cfg, faultSim, ytCookies, fmtDur, streamBusy, srcDir, childRegistry, ytHasCookies
  } = ctx;

  // Есть ли сохранённый вход в YouTube: без него возрастной ролик не отдадут,
  // и повторять запрос с куки бессмысленно (только тянет время).
  // Спрашиваем при каждом обращении: вход может появиться уже после запуска программы,
  // и тогда повтор с куки должен заработать сразу, а не после перезапуска.
  const loginNow = () => (typeof ytHasCookies === 'function' ? !!ytHasCookies() : null);

  // YR1: сколько запусков yt-dlp сейчас живо. Пока счётчик не ноль, движок не обновляем:
  // подмена exe на лету ломает поиск, плейлист или поток, который уже стартовал.
  // Учёт child-registry — отдельный (он про убийство при выходе), его не трогаем.
  let ytdlpRuns = 0;

  // Текущий процесс получения потока: при переключении трека его гасим, иначе быстрые клики
  // копят параллельные yt-dlp и блокируют обновление движка (аудит 20.11.2026).
  let streamChild = null;

  // R12: каждый запущенный yt-dlp встаёт на учёт. При выходе Тапёра учёт убивает
  // живые процессы, иначе они висят до своего тайм-аута (до 60 с) в диспетчере задач.
  // Само хозяйство — в src/child-registry.js; здесь только обёртка над execFile.
  // YR1: заодно считаем живой запуск и ждём конца обновления (internal — запуск самого обновления).
  function execTracked(bin, args, opts, cb, internal) {
    if (!internal && ytdlpUpdating) {
      // Движок как раз заменяется: ждём конца, иначе стартуем на полузаменённом файле.
      // Повторяем проверку после ожидания: за это время обновление могло начаться снова.
      const wait = ytdlpUpdating;
      return wait.then(
        () => execTracked(bin, args, opts, cb, internal),
        () => execTracked(bin, args, opts, cb, internal)
      );
    }
    ytdlpRuns += 1;
    let released = false;
    let replied = false;
    const release = () => {
      if (released) return;
      released = true;
      if (ytdlpRuns > 0) ytdlpRuns -= 1;
    };
    const reply = (err, stdout, stderr) => {
      if (replied) return;
      replied = true;
      if (typeof cb === 'function') cb(err, stdout, stderr);
    };
    const done = (err, stdout, stderr) => { release(); reply(err, stdout, stderr); };
    try {
      const child = execFile(bin, args, opts, done);
      try {
        if (childRegistry && typeof childRegistry.track === 'function') childRegistry.track(child);
      } catch (e) { log('yt-dlp: не встал на учёт дочерних процессов — ' + ((e && e.message) || e)); }
      // Завершение процесса тоже освобождает счётчик: release() сам не даст уменьшить дважды.
      try {
        if (child && typeof child.once === 'function') {
          child.once('exit', release);
          child.once('close', release);
          child.once('error', release);
        }
      } catch (e) { /* без событий уменьшит колбэк */ }
      return child;
    } catch (e) {
      // Ошибка запуска: счётчик не должен «застрять», а колбэк — не потеряться.
      done(e);
      return null;
    }
  }

  // Путь к yt-dlp (кладётся в ресурсы приложения при сборке)
  function ytdlpBundled() {
    if (app.isPackaged) return path.join(process.resourcesPath, 'yt-dlp.exe');
    return path.join(srcDir, '..', 'resources', 'yt-dlp.exe');
  }
  // Рабочая копия yt-dlp лежит в папке данных — её можно обновлять, не дожидаясь новой версии Тапёра
  function ytdlpUserPath() { return path.join(app.getPath('userData'), 'bin', 'yt-dlp.exe'); }
  function ytdlpPath() { const u = ytdlpUserPath(); return fs.existsSync(u) ? u : ytdlpBundled(); }
  function ytdlpVersion(bin) { return ytdlpVersionRun(bin, false); }
  // internal=true — проверка версии внутри самого обновления: она не ждёт промиса обновления.
  function ytdlpVersionRun(bin, internal) {
    return new Promise((resolve) => {
      if (!fs.existsSync(bin)) { resolve(''); return; }
      execTracked(bin, ['--version'], { timeout: 20000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out || '').trim()), internal);
    });
  }
  async function ensureYtdlp() {
    const b = ytdlpBundled(), u = ytdlpUserPath();
    if (!fs.existsSync(b)) return;
    try {
      let copy = !fs.existsSync(u);
      if (!copy) { const [vb, vu] = await Promise.all([ytdlpVersion(b), ytdlpVersion(u)]); copy = !vu || (vb && vb > vu); }
      if (copy) { fs.mkdirSync(path.dirname(u), { recursive: true }); fs.copyFileSync(b, u); log('yt-dlp: рабочая копия обновлена из установки'); }
    } catch (e) { log('yt-dlp: не удалось сделать рабочую копию — ' + e.message); }
  }
  // yt-dlp: официальный бинарник, SHA-256, атомарная замена и запасная копия.
  const YTDLP_SUMS = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';
  const YTDLP_EXE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  const YTDLP_CHECK_MS = 24 * 60 * 60 * 1000;
  let ytdlpUpdating = null;

  function ytdlpCheckFile() { return path.join(app.getPath('userData'), 'bin', '.ytdlp-check.json'); }
  function ytdlpReadCheck() {
    try { return JSON.parse(fs.readFileSync(ytdlpCheckFile(), 'utf8')); } catch (e) { return null; }
  }
  function ytdlpWriteCheck(ver) {
    try {
      const f = ytdlpCheckFile();
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ at: Date.now(), version: ver || '' }), 'utf8');
    } catch (e) { log('yt-dlp: не записалось время проверки — ' + e.message); }
  }
  function ytdlpHashFile(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const s = fs.createReadStream(file);
      s.on('data', (d) => h.update(d));
      s.on('end', () => resolve(h.digest('hex')));
      s.on('error', reject);
    });
  }
  function ytdlpFetchText(url, redirects) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Tapyor/' + app.getVersion() } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && (!redirects || redirects < 5)) {
          res.resume();
          resolve(ytdlpFetchText(new URL(res.headers.location, url).toString(), (redirects || 0) + 1));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { if (out.length < 1024 * 1024) out += d; });
        res.on('end', () => resolve(out));
        res.on('error', reject);
      }).on('error', reject).setTimeout(30000, function () { this.destroy(new Error('таймаут')); });
    });
  }
  function ytdlpDownload(url, dest, redirects) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'Tapyor/' + app.getVersion() } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && (!redirects || redirects < 5)) {
          res.resume();
          resolve(ytdlpDownload(new URL(res.headers.location, url).toString(), dest, (redirects || 0) + 1));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
        const h = crypto.createHash('sha256');
        // Первое скачивание: папки <данные>\bin может ещё не быть — без этого createWriteStream
        // падает с ENOENT ...bin\yt-dlp.exe.new.exe (STAB-R8).
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const ws = fs.createWriteStream(dest);
        res.on('data', (d) => h.update(d));
        res.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', () => resolve(h.digest('hex')));
        res.pipe(ws);
      });
      req.on('error', reject);
      req.setTimeout(180000, function () { this.destroy(new Error('таймаут загрузки')); });
    });
  }
  function ytdlpExpectedHash(sums) {
    const line = String(sums || '').split(/\r?\n/).find((s) => /(^|\s)yt-dlp\.exe$/.test(s.trim()));
    return line ? line.trim().split(/\s+/)[0].toLowerCase() : '';
  }
  async function ytdlpReplace(tmp, target) {
    const bak = target + '.bak.exe';
    let moved = false;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) { try { fs.rmSync(bak, { force: true }); } catch (e) {}; fs.renameSync(target, bak); moved = true; }
      fs.renameSync(tmp, target);
      const v = await ytdlpVersionRun(target, true);
      if (!v) throw new Error('новая версия не запускается');
      return v;
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true }); } catch (e2) {}
      try { if (fs.existsSync(target)) fs.rmSync(target, { force: true }); } catch (e2) {}
      try { if (moved && fs.existsSync(bak)) fs.renameSync(bak, target); } catch (e2) { log('yt-dlp: прежний файл не вернулся после сбоя обновления — ' + ((e2 && e2.message) || e2)); }
      throw e;
    }
  }
  async function ytdlpDoUpdate() {
    const target = ytdlpUserPath();
    try {
      const sums = await ytdlpFetchText(YTDLP_SUMS);
      const expected = ytdlpExpectedHash(sums);
      if (!expected) throw new Error('в SHA2-256SUMS нет yt-dlp.exe');
      if (fs.existsSync(target)) {
        const current = await ytdlpHashFile(target);
        const ver = await ytdlpVersionRun(target, true);
        if (current === expected && ver) {
          ytdlpWriteCheck(ver);
          log('yt-dlp: уже свежий ' + ver);
          return { ok: true, updated: false, version: ver };
        }
      }
      const tmp = target + '.new.exe';
      try { fs.rmSync(tmp, { force: true }); } catch (e) {}
      const got = await ytdlpDownload(YTDLP_EXE, tmp);
      if (got.toLowerCase() !== expected) throw new Error('SHA-256 не совпал');
      const tv = await ytdlpVersionRun(tmp, true);
      if (!tv) throw new Error('скачанный yt-dlp не запускается');
      const v = await ytdlpReplace(tmp, target);
      ytdlpWriteCheck(v);
      log('yt-dlp: обновлён до ' + v);
      return { ok: true, updated: true, version: v };
    } catch (e) {
      try { fs.rmSync(target + '.new.exe', { force: true }); } catch (e2) {}
      log('yt-dlp: обновление не удалось — ' + e.message);
      return { ok: false, text: String(e.message || e).slice(0, 300) };
    }
  }
  function ytdlpUpdate() {
    // A11: пока окно получает поток, движок не трогаем — подмена exe ломает запуск.
    if (streamBusy.isBusy()) {
      log('yt-dlp: сейчас идёт получение потока — обновление движка отложено');
      return Promise.resolve({ ok: false, busy: true, text: 'сейчас идёт получение потока — обновлю движок позже' });
    }
    if (ytdlpUpdating) return ytdlpUpdating;
    // YR1: поиск, плейлисты, ydlJson и прочие запуски тоже ломаются от подмены exe на лету.
    if (ytdlpRuns > 0) {
      log('yt-dlp: движок сейчас запущен — обновление отложено');
      return Promise.resolve({ ok: false, busy: true, text: 'движок сейчас запущен — обновлю позже' });
    }
    ytdlpUpdating = ytdlpDoUpdate().finally(() => { ytdlpUpdating = null; });
    return ytdlpUpdating;
  }
  function ytdlpUpdateIfDue() {
    const c = ytdlpReadCheck();
    if (c && c.at && Date.now() - c.at < YTDLP_CHECK_MS) return;
    ytdlpUpdate().then((r) => { if (!r.ok) log('yt-dlp: ежедневная проверка не удалась — ' + (r.text || '?')); });
  }

  // Поиск через yt-dlp (для подгрузки следующих страниц результатов).
  // Имитация сбоя YouTube проверяется здесь же: down/auth/offline — ошибка процесса, slow — задержка.
  function ytdlpSearch(query, count) {
    return faultSim.applyCall('yt', () => new Promise((resolve) => {
      const bin = ytdlpPath();
      if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
      execTracked(bin, ['ytsearch' + count + ':' + query, '--flat-playlist', '--dump-single-json', '--no-warnings'],
        { timeout: 45000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) { log('поиск (ещё): ошибка ' + (stderr || err.message)); resolve({ error: 'не удалось загрузить ещё' }); return; }
          try {
            const j = JSON.parse(stdout);
            const list = (j.entries || []).filter((x) => x && x.id).map((x) => ({
              id: x.id,
              title: x.title || '',
              author: x.channel || x.uploader || '',
              duration: fmtDur(x.duration),
              seconds: x.duration || 0,
              thumb: 'https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg'
            }));
            log('поиск (ещё): «' + query + '» запрошено ' + count + ', получено ' + list.length);
            resolve(list);
          } catch (e) { log('поиск (ещё): ошибка разбора ' + e.message); resolve({ error: 'ошибка разбора' }); }
        });
    }), { url: 'https://www.youtube.com/', timeoutMs: 45000 }).catch((e) => ({ error: e && e.message ? e.message : String(e) }));
  }

  // Содержимое плейлиста YouTube (yt-dlp, без загрузки видео)
  function ytdlpPlaylist(listId) {
    return faultSim.applyCall('yt', () => new Promise((resolve) => {
      const bin = ytdlpPath();
      if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
      const ck = ytCookies(false);
      execTracked(bin, ['https://www.youtube.com/playlist?list=' + listId, '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '500', ...ck.args],
        { timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
          ck.done();
          if (err) { log('плейлист YouTube: ошибка ' + (stderr || err.message)); resolve({ error: 'не удалось открыть плейлист' }); return; }
          try {
            const j = JSON.parse(stdout);
            const tracks = (j.entries || []).filter((x) => x && x.id && x.title && !/^\[(deleted|private)/i.test(x.title)).map((x) => ({
              src: 'yt', id: x.id, title: x.title || '', author: x.channel || x.uploader || '',
              duration: fmtDur(x.duration), seconds: x.duration || 0,
              thumb: 'https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg'
            }));
            resolve({ src: 'yt', type: 'playlist', listId: listId, title: j.title || 'Плейлист YouTube', author: j.channel || j.uploader || '', count: tracks.length, thumb: tracks[0] ? tracks[0].thumb : '', tracks: tracks });
          } catch (e) { resolve({ error: 'ошибка разбора плейлиста' }); }
        });
    }), { url: 'https://www.youtube.com/', timeoutMs: 60000 }).catch((e) => ({ error: e && e.message ? e.message : String(e) }));
  }

  // --- SoundCloud, Bandcamp и другие сайты через yt-dlp ---
  function bestThumb(e) {
    const t = (e.thumbnails || []).filter((x) => x && x.url);
    const mid = t.find((x) => /t300x300|t500x500|_7\.|_16\./.test(x.url)) || t.find((x) => (x.width || 0) >= 200) || t[t.length - 1];
    return (mid && mid.url) || e.thumbnail || '';
  }
  function srcOfUrl(u) { return /bandcamp\.com/i.test(u || '') ? 'bc' : 'sc'; }
  function mapYdl(e, src) {
    const url = e.webpage_url || (/^https?:/.test(e.url || '') ? e.url : '') || e.original_url || '';
    const seconds = Math.round(e.duration || 0);
    const ageLimit = Number(e.age_limit || 0) || 0;   // 18+ у ролика (0 — обычный)
    return { src: src || srcOfUrl(url), id: url, title: e.track || e.title || 'Без названия', author: e.artist || e.uploader || e.channel || '', seconds, ageLimit, explicit: ageLimit >= 18 || undefined, duration: fmtDur(e.duration), thumb: bestThumb(e), live: !(seconds > 0) || e.is_live === true || e.live_status === 'is_live' || undefined };
  }
  function ydlJson(args, timeout, o = {}) {
    return new Promise((resolve) => {
      const bin = ytdlpPath();
      if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
      const ck = o.ytCookies ? ytCookies(false) : { args: [], done() {} };
      execTracked(bin, [...args, ...ck.args, '--dump-single-json', '--no-warnings'], { timeout: timeout || 45000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        ck.done();
        if (err) { resolve({ error: String(stderr || err.message).trim().split('\n').pop().slice(0, 300) }); return; }
        try { resolve(JSON.parse(stdout)); } catch (e) { resolve({ error: 'ошибка разбора' }); }
      });
    });
  }
  async function scSearch(q, n) {
    const j = await ydlJson(['scsearch' + (n || 15) + ':' + q, '--flat-playlist'], 30000);
    if (j.error) { log('SoundCloud: поиск — ' + j.error); return { error: j.error }; }
    return (j.entries || []).filter((e) => e && (e.webpage_url || e.url)).map((e) => mapYdl(e, 'sc'));
  }
  async function urlList(url) {
    const j = await ydlJson([url, '--flat-playlist', '--playlist-end', '500'], 60000);
    if (j.error) { log('список по ссылке: ' + j.error); return { error: j.error }; }
    const src = srcOfUrl(url);
    if (!j.entries) return { tracks: [mapYdl(j, src)] };
    const tracks = j.entries.filter((e) => e && (e.webpage_url || e.url)).map((e) => mapYdl(e, src));
    return { list: { src, type: 'playlist', listId: url, title: j.title || 'Плейлист', author: j.uploader || j.artist || '', count: tracks.length, thumb: bestThumb(j) || (tracks[0] && tracks[0].thumb) || '', tracks } };
  }
  // Поток звука по ссылке: обычный файл или HLS (тогда окно играет его через hls.js)
  function urlStream(url) {
    return new Promise((resolve) => {
      const bin = ytdlpPath();
      if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
      execTracked(bin, ['-f', 'ba[protocol^=http]/ba/b', '--print', '%(protocol)s|%(url)s', '--no-playlist', '--no-warnings', url], { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) { const m = String(stderr || err.message).trim().split('\n').pop(); log('поток по ссылке: ' + m); resolve({ error: m.slice(0, 300) }); return; }
        const line = String(stdout || '').trim().split(/\r?\n/).pop() || '';
        const i = line.indexOf('|'); const proto = line.slice(0, i), u = line.slice(i + 1);
        if (!/^https?:/.test(u)) { resolve({ error: 'поток не получен' }); return; }
        resolve({ audioUrl: u, hls: /m3u8/.test(proto) || /\.m3u8/.test(u) });
      });
    });
  }

  // Достать прямую ссылку на поток через yt-dlp (надёжный способ)
  // Причина отказа человеческим языком: на карточке заказа и в чате нужен смысл, а не stderr.
  // Сырой текст по-прежнему уходит в журнал.
  function humanYtError(why) {
    const s = String(why || '');
    if (/confirm your age/i.test(s)) return 'возрастное видео (18+): нужен вход в YouTube';
    if (/not made this video available in your country/i.test(s)) return 'ролик недоступен в стране стримера';
    if (/blocked (it )?(due to|on) .*claim|claimed content|claims? by/i.test(s)) return 'ролик заблокирован по жалобе правообладателя';
    if (/Requested format is not available/i.test(s)) return 'у ролика нет доступного формата';
    if (/not a bot/i.test(s)) return 'YouTube требует вход: проверка «не робот»';
    if (/Private video|members-only|join this channel/i.test(s)) return 'ролик закрыт: приватный или для участников';
    if (/Video unavailable|This video is not available|unavailable in your/i.test(s)) return 'ролик недоступен';
    const one = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || 'не удалось получить поток';
    return ('движок YouTube: ' + one.replace(/^ERROR:\s*/i, '')).slice(0, 140);
  }
  function streamViaYtDlp(videoUrl) {
    return faultSim.applyCall('yt', () => new Promise(async (resolve) => {
      try {
      const bin = ytdlpPath();
      const exists = fs.existsSync(bin);
      const t0 = Date.now();
      log('yt-dlp: запуск. bin=' + bin + ' | файл есть=' + exists + ' | url=' + videoUrl);
      if (!exists) { resolve({ error: 'движок YouTube не найден' }); return; }
      const q = String(cfg('videoQuality'));
      // Только прямые https-потоки. HLS (m3u8_native) <video> не умеет:
      // иначе 1080/1440 дают звук без картинки. Если прямого видео нет — ошибка,
      // чтобы UI ушёл на iframe, а не играл один звук.
      const qh = q === '1440' ? 1440 : (q === '1080' ? 1080 : (q === '480' ? 480 : 720));
      // Только прямые https-потоки. HLS (m3u8_native) <video> не умеет:
      // иначе 1080/1440 дают звук без картинки. Если прямого видео нет — ошибка,
      // чтобы UI ушёл на iframe, а не играл один звук.
      const direct = '[height<=' + qh + '][protocol^=http]';
      const strict = q === 'audio' ? 'ba[ext=m4a]/ba/b'
        : 'bv*' + direct + '[ext=mp4]+ba[ext=m4a]/bv*' + direct + '+ba/b' + direct;
      // Запасные варианты (19.11): у части роликов строгий набор не подходит — YouTube отдаёт
      // только HLS или другие контейнеры, и yt-dlp отвечает «Requested format is not available».
      // Тогда пробуем мягче: без фильтра по https и по контейнеру. Возраст, блокировку и сеть
      // НЕ повторяем: там второй заход бессмыслен и только тянет время.
      // Фильтр по https сохраняем и здесь: HLS (m3u8) <video> не проигрывает, и мягкий
      // вариант без этого фильтра уводил в iframe (проверено живьём 20.11.2026).
      // Ослабляем только контейнер: у части роликов нет mp4/m4a, но прямые потоки есть.
      const soft = q === 'audio'
        ? 'ba[protocol^=http]/b[protocol^=http]'
        : 'bv*[height<=' + qh + '][protocol^=http]+ba/b[height<=' + qh + '][protocol^=http]/b[protocol^=http]';
      const tries = [strict, soft, 'b[protocol^=http]'];

      // Одна попытка: адреса потоков для одного набора форматов. Свои куки — на каждую попытку,
      // потому что временный файл удаляется сразу после вызова.
      const once = (fmt, ms, opts) => new Promise((resolve) => {
        const ck = ytCookies(true, { age: !!(opts && opts.age), deny: rulesNow.explicitOk === false });
        const child = execTracked(bin, [
          '-f', fmt,
          '-g', '--no-playlist', '--no-warnings',
          ...ck.args,
          videoUrl
        ], { timeout: ms, windowsHide: true }, (err, stdout, stderr) => {
          ck.done();
          if (streamChild === child) streamChild = null;
          if (err) {
            const why = String(stderr || err.message || '');
            log('yt-dlp: ОШИБКА code=' + (err.code) + ' fmt=' + fmt.slice(0, 40) + ' msg=' + (err.message || '') + ' | stderr=' + why);
            resolve({ ok: false, error: humanYtError(why), usedCookies: !!(ck.args && ck.args.length), age: /confirm your age/i.test(why), retry: /Requested format is not available/i.test(why) });
            return;
          }
          const lines = (stdout || '').trim().split(/\r?\n/).filter(Boolean).filter((u) => !/\.m3u8(\?|$)/i.test(u));
          // HLS-адрес плеер не проигрывает: считаем это неудачей и пробуем следующий набор,
          // иначе трек «получен», а на деле уходит в iframe с потерей времени (аудит 20.11.2026).
          if (!lines.length) { log('yt-dlp: пустой вывод'); resolve({ ok: false, error: 'yt-dlp: пустой ответ', retry: false }); return; }
          resolve({ ok: true, lines });
        });
        // execTracked при ожидании обновления движка возвращает обещание, а не процесс —
        // тогда запоминать нечего: гасить нечего.
        if (child && typeof child.kill === 'function') streamChild = child;
      });

      let last = { ok: false, error: 'движок YouTube: не удалось получить поток' };
      let ageTried = false;
      const rulesNow = cfg('reqRules') || {};
      for (let k = 0; k < tries.length; k++) {
        last = await once(tries[k], k === 0 ? 15000 : 12000, {});
        if (last.ok) break;
        // Возрастное видео. Правило 18+ решает, можно ли вообще пытаться: выключено — сразу отказ,
        // даже вход не используем (куки — минимум, только там, где без них никак).
        if (last.age) {
          if (rulesNow.explicitOk === false) {
            last = { ok: false, code: 'age-rule', error: 'возрастное видео (18+), а в правилах заказов 18+ запрещены' };
            break;
          }
          // Входа не было — пробуем один раз с ним: без входа возрастной поток не отдают вовсе.
          if (!ageTried && !last.usedCookies && loginNow() !== false) {
            ageTried = true;
            log('yt-dlp: ролик 18+ — пробую со входом');
            last = await once(tries[0], 12000, { age: true });
            if (last.ok) break;
            if (!last.age) break;
          }
          log(last.usedCookies ? 'yt-dlp: ролик 18+ — вход не помог' : 'yt-dlp: ролик 18+ — нужен вход в YouTube');
          last = last.usedCookies
            ? { ok: false, code: 'age-cookie-fail', error: 'возрастное видео (18+): вход есть, но YouTube всё равно не отдал поток' }
            : { ok: false, code: 'age-no-login', error: 'нужен вход в YouTube: ролик с возрастным ограничением' };
          break;
        }
        if (!last.retry) break;   // дело не в формате — второй заход не поможет
        if (k + 1 < tries.length) log('yt-dlp: формат не подошёл, пробую проще (попытка ' + (k + 2) + ' из ' + tries.length + ')');
      }
      if (!last.ok) { resolve({ error: last.error, code: last.code }); return; }
      const lines = last.lines;
      if (lines.length >= 2) {
        log('yt-dlp: успех, раздельные потоки (видео + звук), ' + (Date.now() - t0) + ' мс');
        resolve({ videoUrl: lines[0], audioUrl: lines[1] });
      } else if (q === 'audio') {
        log('yt-dlp: успех, только звук, ' + (Date.now() - t0) + ' мс');
        resolve({ audioUrl: lines[0] });
      } else {
        log('yt-dlp: успех, единый поток, ' + (Date.now() - t0) + ' мс');
        resolve({ url: lines[0] });
      }
      } catch (e) {
        // Любое исключение внутри попытки должно давать ответ, а не оставлять вызов висеть:
        // иначе окно остаётся на «Загружаю…» навсегда (аудит 20.11.2026).
        resolve({ error: 'движок YouTube: ' + ((e && e.message) || String(e)).slice(0, 200) });
      }
    }), { url: videoUrl, timeoutMs: 15000 }).catch((e) => ({ error: e && e.message ? e.message : String(e) }));
  }
  // Погасить текущее получение потока (переключение трека, отмена). Возвращает true,
  // если что-то действительно остановили. Процесс снимается с учёта сам, в своём колбэке.
  function cancelStream() {
    const c = streamChild;
    streamChild = null;
    if (!c) return false;
    try { c.kill(); return true; } catch (e) { return false; }
  }

  return {
    ytdlpBundled, ytdlpUserPath, ytdlpPath, ytdlpVersion, ensureYtdlp,
    ytdlpUpdate, ytdlpUpdateIfDue, ytdlpSearch, ytdlpPlaylist,
    bestThumb, srcOfUrl, mapYdl, ydlJson, scSearch, urlList, urlStream, streamViaYtDlp,
    cancelStream,
    execTracked
  };
}
