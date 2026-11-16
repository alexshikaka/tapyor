// Свои плейлисты на площадках: Яндекс Музыка (ym-pl-*) и YouTube (yt-pl-*, pl-remote).
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { ipcMain, log, getYmToken, ymUidGet, ym, ytoauth, libSend } = ctx;

  // --- Свои плейлисты на площадках: Яндекс ---
  const ymNeed = async () => { const tok = getYmToken(); if (!tok) throw new Error('нет входа в Яндекс'); return { tok, uid: await ymUidGet() }; };
  const ymWrap = (name, fn) => async (...a) => { try { return Object.assign({ ok: true }, await fn(...a)); } catch (err) { log('Яндекс: ' + name + ' — ' + err.message); return { error: err.message }; } };
  ipcMain.handle('ym-pl-rename', ymWrap('переименование плейлиста', async (e, kind, title) => { const { tok, uid } = await ymNeed(); await ym.renamePlaylist(tok, uid, kind, title); log('Яндекс: плейлист переименован'); return {}; }));
  ipcMain.handle('ym-pl-delete', ymWrap('удаление плейлиста', async (e, kind) => { const { tok, uid } = await ymNeed(); await ym.deletePlaylist(tok, uid, kind); log('Яндекс: плейлист удалён'); return {}; }));
  ipcMain.handle('ym-pl-remove', ymWrap('удаление треков', async (e, kind, ids) => { const { tok, uid } = await ymNeed(); return ym.removeTracks(tok, uid, kind, ids); }));
  ipcMain.handle('ym-pl-add', ymWrap('добавление треков', async (e, kind, tracks) => { const { tok, uid } = await ymNeed(); return ym.appendTracks(tok, uid, kind, tracks || []); }));
  ipcMain.handle('ym-pl-create', ymWrap('создание плейлиста', async (e, title, tracks) => {
    const { tok, uid } = await ymNeed();
    const pl = await ym.createPlaylist(tok, uid, String(title || 'Плейлист из Тапёра').slice(0, 100));
    const r = (tracks && tracks.length) ? await ym.addToPlaylist(tok, uid, pl.kind, pl.revision, tracks) : { count: 0 };
    log('Яндекс: создан плейлист, треков ' + r.count);
    return { uid, kind: String(pl.kind), count: r.count };
  }));
  // Содержимое для синхронизации: id треков на площадке
  ipcMain.handle('pl-remote', async (e, target, link) => {
    try {
      if (target === 'ym') { const { tok, uid } = await ymNeed(); const i = await ym.playlistInfo(tok, link.uid || uid, link.kind); return { ok: true, ids: i.items.map((x) => x.id), title: i.title }; }
      if (target === 'yt') { const items = await ytoauth.playlistItems(link.listId); return { ok: true, items }; }
    } catch (err) { log('синхронизация: ' + err.message); return { error: err.message, gone: /404|not ?found|playlistNotFound/i.test(err.message) }; }
    return { error: 'нет такой площадки' };
  });
  // --- YouTube (официальный API, вход через браузер с разрешением на изменения) ---
  const ytWrap = (name, fn) => async (...a) => {
    if (!ytoauth.loggedIn()) return { error: 'нужен вход в YouTube через браузер', needLogin: true };
    if (!ytoauth.canWrite()) return { error: 'нужен повторный вход в YouTube — разрешить Тапёру менять плейлисты', needLogin: true };
    try { return Object.assign({ ok: true }, await fn(...a)); } catch (err) { log('YouTube API: ' + name + ' — ' + err.message); return { error: err.message, added: err.added, needLogin: /повторный вход/.test(err.message), quota: err.reason === 'quotaExceeded' }; }
  };
  ipcMain.handle('yt-pl-create', ytWrap('создание плейлиста', async (e, title, ids) => {
    const pl = await ytoauth.createPlaylist(title);
    let n = 0;
    try { n = (await ytoauth.addVideos(pl.listId, ids || [], (k) => libSend('push-progress', { done: k, total: (ids || []).length }))).count; }
    catch (err) { err.listId = pl.listId; return { listId: pl.listId, count: err.added || 0, partial: true, error: err.message, quota: err.reason === 'quotaExceeded' }; }
    log('YouTube API: создан плейлист, видео ' + n);
    return { listId: pl.listId, count: n };
  }));
  ipcMain.handle('yt-pl-add', ytWrap('добавление видео', async (e, listId, ids) => {
    try { return await ytoauth.addVideos(listId, ids || [], (k) => libSend('push-progress', { done: k, total: (ids || []).length })); }
    catch (err) { return { count: err.added || 0, partial: true, error: err.message, quota: err.reason === 'quotaExceeded' }; }
  }));
  ipcMain.handle('yt-pl-rename', ytWrap('переименование', async (e, listId, title) => { await ytoauth.renamePlaylist(listId, title); return {}; }));
  ipcMain.handle('yt-pl-delete', ytWrap('удаление', async (e, listId) => { await ytoauth.deletePlaylist(listId); return {}; }));
  ipcMain.handle('yt-pl-remove', ytWrap('удаление видео', async (e, listId, videoIds) => {
    const want = new Set(videoIds || []);
    const items = (await ytoauth.playlistItems(listId)).filter((x) => want.has(x.videoId));
    return ytoauth.removeItems(items.map((x) => x.itemId));
  }));

  return {};
}
