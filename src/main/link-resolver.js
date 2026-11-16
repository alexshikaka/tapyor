// Разбор ссылок: Яндекс Музыка, YouTube, SoundCloud, Bandcamp — и в строке поиска, и в заказах.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { ipcMain, log, getYmToken, ym, ytdlpModule, withTimeout, yts } = ctx;

  // Ссылка в строке поиска: Яндекс Музыка или YouTube
  ipcMain.handle('resolve-link', (e, text) => resolveLinkFn(text));
  async function resolveLinkFn(text) {
    const t = String(text || '').trim();
    let u;
    try { u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t); } catch (err) { return null; }
    const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
    const p = u.pathname;
    const tok = getYmToken();
    try {
      if (/^music\.yandex\.(ru|com|by|kz|uz)$/.test(host)) {
        let m;
        if ((m = /\/track\/(\d+)/.exec(p))) { const tr = await ym.trackById(tok, m[1]); return tr ? { tracks: [tr] } : { error: 'трек не найден' }; }
        if ((m = /^\/album\/(\d+)/.exec(p))) return { list: await ym.albumTracks(tok, m[1]) };
        if ((m = /^\/users\/([^/]+)\/playlists\/(\d+)/.exec(p))) return { list: await ym.playlistTracks(tok, { uid: decodeURIComponent(m[1]), kind: m[2] }) };
        if ((m = /^\/playlists\/([^/?#]+)/.exec(p))) return { list: await ym.playlistTracks(tok, { uuid: m[1] }) };
        if ((m = /^\/artist\/(\d+)/.exec(p))) return { list: await ym.artistTracks(tok, m[1]) };
        return { error: 'такую ссылку Яндекса пока не понимаю' };
      }
      if (/^(soundcloud\.com|on\.soundcloud\.com)$/.test(host) || /(^|\.)bandcamp\.com$/.test(host)) {
        const r = await ytdlpModule.urlList(u.toString());
        return r.error ? { error: (/bandcamp/.test(host) ? 'Bandcamp' : 'SoundCloud') + ': ' + r.error } : r;
      }
      if (/^(youtube\.com|music\.youtube\.com|youtu\.be)$/.test(host)) {
        const vid = host === 'youtu.be' ? p.slice(1).split('/')[0] : (u.searchParams.get('v') || ((/^\/(shorts|live|embed)\/([\w-]{6,})/.exec(p) || [])[2]));
        const list = u.searchParams.get('list');
        const out = {};
        if (vid) {
          try {
            const v = await withTimeout(yts({ videoId: vid }), 10000, 'YouTube: название по ссылке');
            out.tracks = [{ src: 'yt', id: vid, title: v.title || '', author: (v.author && v.author.name) || '', duration: v.timestamp || (v.duration && v.duration.timestamp) || '', seconds: v.seconds || 0, thumb: v.thumbnail || ('https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg'), live: !((v.seconds || 0) > 0) || undefined }];
          } catch (err) {
            out.tracks = [{ src: 'yt', id: vid, title: 'Видео YouTube', author: '', duration: '', seconds: 0, thumb: 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg' }];
          }
        }
        if (list && !/^(RD|UL|LL|WL)/.test(list)) { // миксы и «Смотреть позже» — не настоящие плейлисты
          const pl = await ytdlpModule.ytdlpPlaylist(list);
          if (!pl.error) out.list = pl; else if (!vid) return { error: pl.error };
        }
        return (out.tracks || out.list) ? out : { error: 'не нашёл видео по ссылке' };
      }
    } catch (err) { log('ссылка: ошибка ' + err.message); return { error: err.message }; }
    return null; // не ссылка на музыку — обычный поиск
  }

  return { resolveLinkFn };
}
