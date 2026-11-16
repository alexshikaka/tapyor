// Мастер «Импорт»: файл со списком песен и ссылки площадок (Telegram, Spotify, Deezer,
// Apple Music, YouTube, VK). Каналы import-file и import-url.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { ipcMain, dialog, path, fs, log, library, pathGuard, importers, ytdlpModule, fmtDur, userAgent, getMainWindow, resolveLinkFn } = ctx;

  // --- Мастер «Импорт»: откуда взять список песен ---
  const UA = { 'User-Agent': userAgent(), 'Accept-Language': 'ru,en;q=0.8' };
  async function fetchText(u, ms) { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(ms || 15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }
  async function importFile(f) {
    const ext = path.extname(f).toLowerCase();
    if (library.isPlaylistFile(f)) { const pl = await library.readPlaylistFile(f); return { title: pl.title, source: 'm3u', items: pl.items.map((x) => ({ line: x.line, seconds: x.seconds, url: x.track ? '' : x.url, track: x.track || null })) }; }
    const buf = fs.readFileSync(f);
    let text = buf.toString('utf8');
    if (text.includes('�')) { try { text = new TextDecoder('windows-1251').decode(buf); } catch (e) {} }
    let r = null, source = 'text';
    if (ext === '.json') {
      r = importers.fromTelegramJson(text);
      if (!r) return { title: '', source: 'telegram', items: [], error: '«' + path.basename(f) + '» — это не экспорт Telegram' };
      source = 'telegram';
    }
    else if (ext === '.html' || ext === '.htm') { r = importers.fromTelegramHtml(text); source = 'telegram'; }
    else if (ext === '.csv' || ext === '.tsv') { r = importers.fromCsv(text); source = 'csv'; }
    if (!r) { r = importers.fromText(text); source = 'text'; }
    return { title: r.title || path.basename(f, ext), source, items: r.items };
  }
  ipcMain.handle('import-file', async (e, f) => {
    // Путь из окна (перетаскивание файла) не принимаем на слово: только обычный файл
    // понятного импорту расширения и не больше 5 МБ (B7b, P5c №2). Кнопка «Выбрать файл…»
    // показывает диалог здесь же — путь в нём выбирает человек, поэтому предел размера
    // для выбранного в диалоге не ставим (выгрузка Telegram бывает большой).
    let files0 = null, fromDialog = false;
    if (f != null) {
      const chk = pathGuard.importFile(f);
      if (!chk.ok) { log('импорт: путь из окна отклонён — ' + chk.error); return { error: chk.error }; }
      files0 = [chk.path];
    } else {
      fromDialog = true;
      const d = await dialog.showOpenDialog(getMainWindow(), { title: 'Файл со списком песен', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Списки песен', extensions: ['json', 'html', 'htm', 'csv', 'tsv', 'txt', 'm3u', 'm3u8', 'pls'] }] });
      if (d.canceled || !d.filePaths.length) return { cancelled: true };
      files0 = d.filePaths;
    }
    const out = { title: '', source: '', items: [] };
    for (const x0 of files0) {
      const chk = pathGuard.importFile(x0, { maxBytes: fromDialog ? 0 : undefined });
      if (!chk.ok) { log('импорт: файл отклонён — ' + chk.error); out.error = 'Не удалось прочитать «' + path.basename(String(x0)) + '»: ' + chk.error; continue; }
      const x = chk.path;
      try { const r = await importFile(x); if (r.error) { out.error = r.error; continue; } out.title = out.title || r.title; out.source = out.source || r.source; out.items = out.items.concat(r.items); }
      catch (err) { log('импорт файла ' + path.basename(x) + ': ' + err.message); out.error = 'не удалось прочитать «' + path.basename(x) + '»'; }
    }
    out.items = importers.dedupeItems(out.items);
    log('импорт: файл, строк ' + out.items.length + ' (' + out.source + ')');
    return out;
  });
  ipcMain.handle('import-url', async (e, raw, opts) => {
    opts = opts || {};
    const t = String(raw || '').trim();
    let u; try { u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t); } catch (err) { return { error: 'это не ссылка' }; }
    const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase(), p = u.pathname;
    try {
      // Видео YouTube: главы и описание (список песен в длинных видео и миксах)
      if (/^(youtube\.com|music\.youtube\.com|youtu\.be)$/.test(host)) {
        const vid = host === 'youtu.be' ? p.slice(1).split('/')[0] : (u.searchParams.get('v') || ((/^\/(shorts|live|embed)\/([\w-]{6,})/.exec(p) || [])[2]));
        const list = u.searchParams.get('list');
        if (vid && !(list && opts.preferList)) {
          const j = await ytdlpModule.ydlJson(['https://www.youtube.com/watch?v=' + vid, '--no-playlist', '--skip-download'], 60000, { ytCookies: true });
          if (j.error) return { error: 'YouTube: ' + j.error };
          const r = importers.fromYoutubeInfo(j);
          const self = { src: 'yt', id: vid, title: j.title || '', author: j.channel || j.uploader || '', seconds: j.duration || 0, duration: fmtDur(j.duration), thumb: 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg' };
          log('импорт: видео YouTube, ' + r.kind + ', строк ' + r.items.length);
          return { title: r.title, source: 'youtube-' + r.kind, items: r.items, video: self, hasList: !!list, note: r.note };
        }
      }
      // Ссылки площадок, которые Тапёр открывает сам: треки уже найдены
      if (/^music\.yandex\./.test(host) || /^(youtube\.com|music\.youtube\.com|youtu\.be|soundcloud\.com|on\.soundcloud\.com)$/.test(host) || /(^|\.)bandcamp\.com$/.test(host)) {
        const r = await resolveLinkFn(u.toString());
        if (!r || r.error) return { error: (r && r.error) || 'не понял ссылку' };
        const L = r.list || { title: (r.tracks && r.tracks[0] && r.tracks[0].title) || 'По ссылке', tracks: r.tracks || [] };
        return { title: L.title, source: 'platform', items: (L.tracks || []).map((tr) => ({ line: (tr.author ? tr.author + ' — ' : '') + tr.title, seconds: tr.seconds || 0, track: tr })) };
      }
      if (host === 'open.spotify.com') {
        const m = /\/(playlist|album|track)\/([A-Za-z0-9]+)/.exec(p);
        if (!m) return { error: 'такую ссылку Spotify не понимаю' };
        const r = importers.fromSpotifyEmbed(await fetchText('https://open.spotify.com/embed/' + m[1] + '/' + m[2]));
        if (!r || !r.items.length) return { error: 'Spotify не отдал список — скопируй названия текстом' };
        log('импорт: Spotify ' + m[1] + ', строк ' + r.items.length);
        return { title: r.title, source: 'spotify', items: r.items, note: r.items.length >= 100 && m[1] === 'playlist' ? 'Spotify показывает без входа только первые 100 песен — для больших плейлистов лучше выгрузка CSV (Exportify).' : '' };
      }
      if (/^deezer\.com$/.test(host) || host === 'deezer.page.link' || host === 'link.deezer.com') {
        let m = /\/(playlist|album)\/(\d+)/.exec(p);
        if (!m) { try { const r0 = await fetch(u.toString(), { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(12000) }); m = /\/(playlist|album)\/(\d+)/.exec(r0.url); } catch (err) {} }
        if (!m) return { error: 'такую ссылку Deezer не понимаю' };
        const j = await (await fetch('https://api.deezer.com/' + m[1] + '/' + m[2] + '?limit=2000', { signal: AbortSignal.timeout(15000) })).json();
        if (j.error) return { error: 'Deezer: ' + (j.error.message || 'ошибка') };
        const r = importers.fromDeezerJson(j);
        return { title: r.title, source: 'deezer', items: r.items };
      }
      if (host === 'music.apple.com') {
        const r = importers.fromAppleHtml(await fetchText(u.toString()));
        if (!r.items.length) return { error: 'Apple Music не отдал список — скопируй названия текстом' };
        return { title: r.title, source: 'apple', items: r.items };
      }
      if (host === 't.me' || host === 'telegram.me') {
        const parts = p.split('/').filter(Boolean);
        if (!parts.length || /^(\+|joinchat)/.test(parts[0])) return { error: 'это закрытый чат — сделай «Экспорт истории» в Telegram Desktop и выбери файл' };
        const chan = parts[0] === 's' ? parts[1] : parts[0];
        let before = 0, items = [], title = '';
        const pages = Math.max(1, Math.min(30, opts.pages || 8));
        for (let k = 0; k < pages; k++) {
          const html = await fetchText('https://t.me/s/' + encodeURIComponent(chan) + (before ? '?before=' + before : ''));
          const r = importers.fromTmeChannel(html);
          title = title || r.title; items = items.concat(r.items);
          if (!r.oldest || r.oldest <= 1 || r.oldest === before) break;
          before = r.oldest;
        }
        if (!items.length) return { error: 'в открытой части канала не нашлось песен (закрытый канал? — тогда «Экспорт истории» в Telegram Desktop)' };
        log('импорт: канал Telegram ' + chan + ', строк ' + items.length);
        return { title, source: 'telegram', items: importers.dedupeItems(items) };
      }
      if (/^(vk\.com|vk\.ru|m\.vk\.com)$/.test(host)) return { error: 'ВКонтакте не даёт программам свою музыку. Открой страницу с аудио во вкладке «Браузер» и нажми «Собрать песни»', vk: true };
      return { error: 'с этого сайта пока не умею — скопируй список текстом' };
    } catch (err) { log('импорт по ссылке: ' + err.message); return { error: err.message }; }
  });

  return {};
}
