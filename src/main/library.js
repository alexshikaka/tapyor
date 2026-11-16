// Музыка с компьютера: папки библиотеки, файлы с тегами, поиск, файлы и обложки через
// локальный сервер, плейлисты M3U. Каналы lib-* и m3u-export.
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { app, ipcMain, dialog, shell, fs, path, log, cfg, library, pathGuard, getMainWindow } = ctx;

  // --- Музыка с компьютера ---
  // Настройка библиотеки и первый скан — на прежнем месте (в начале app.whenReady);
  // каналы lib-* регистрируются ниже, там же, где стояли обработчики.
  library.setup({ log, dataDir: app.getPath('userData') });
  const libSend = (ch, d) => { try { const win = getMainWindow(); if (win && !win.isDestroyed()) win.webContents.send(ch, d); } catch (e) {} };
  const libScan = () => library.scan((pr) => libSend('lib-progress', pr)).then((r) => { libSend('lib-changed', library.status()); return r; });
  setTimeout(() => { if (library.status().folders.length || library.status().extras) libScan().catch((e) => log('музыка с компьютера: ' + e.message)); }, 4000);

  function registerIpc() {
    ipcMain.handle('lib-status', () => library.status());
    ipcMain.handle('lib-all', () => library.all());
    ipcMain.handle('lib-search', (e, q, n) => (cfg('libInSearch') === false ? [] : library.search(q, n || 30)));
    // Видеофайл — в окно видео (url → режим «single»), звук — как раньше (audioUrl → плавные переходы)
    ipcMain.handle('lib-stream', (e, id) => { const f = library.pathOf(id); if (!f) return { error: 'файл не найден на компьютере (переместили или удалили?)' }; return library.isVideo(f) ? { url: '/lfile/' + id, video: true } : { audioUrl: '/lfile/' + id }; });
    ipcMain.handle('lib-add-folder', async (e, dir) => {
      if (!dir) {
        const r = await dialog.showOpenDialog(getMainWindow(), { title: 'Папка с музыкой', properties: ['openDirectory', 'multiSelections'] });
        if (r.canceled || !r.filePaths.length) return { cancelled: true };
        for (const d of r.filePaths) {
          const chk = pathGuard.libraryFolder(d);
          if (!chk.ok) { log('библиотека: папка отклонена — ' + chk.error); return { error: chk.error }; }
          library.addFolder(chk.path);
        }
      } else {
        // Путь пришёл из окна (перетаскивание папки): не принимаем на слово — только обычная
        // существующая папка, не ссылка, не системная и не корень диска (B7b, P5c №3).
        const chk = pathGuard.libraryFolder(dir);
        if (!chk.ok) { log('библиотека: путь из окна отклонён — ' + chk.error); return { error: chk.error }; }
        library.addFolder(chk.path);
      }
      const s0 = await libScan();
      return Object.assign({ ok: true }, s0, { status: library.status() });
    });
    ipcMain.handle('lib-remove-folder', (e, dir) => {
      // Убрать можно только папку, которая уже есть в библиотеке (сравнение без учёта регистра).
      const folders = library.status().folders.map((f) => f.path);
      if (!pathGuard.libraryFolderExact(dir, folders)) { log('библиотека: убрать можно только папку из библиотеки'); return library.status(); }
      const hit = folders.find((f) => pathGuard.folderKey(f) === pathGuard.folderKey(dir)) || dir;
      library.removeFolder(hit); libSend('lib-changed', library.status()); return library.status();
    });
    ipcMain.handle('lib-rescan', async () => { await libScan(); return library.status(); });
    ipcMain.handle('lib-reveal', (e, id) => { const f = library.pathOf(id); if (f) shell.showItemInFolder(f); return !!f; });
    ipcMain.handle('lib-open-files', async () => {
      const r = await dialog.showOpenDialog(getMainWindow(), { title: 'Музыка или плейлист', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Музыка и плейлисты', extensions: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav', 'webm', 'mp4', 'm4v', 'mkv', 'mov', 'm3u', 'm3u8', 'pls'] }] });
      if (r.canceled) return { cancelled: true };
      return dropPaths(r.filePaths);
    });
    // Папки, пришедшие из проверенного перетаскивания: их можно «только сыграть сейчас»,
    // не добавляя в библиотеку (lib-folder-tracks). Больше 200 не держим.
    const recentDropFolders = new Set();
    async function dropPaths(paths) {
      const list = [];
      let rejected = 0;
      for (const p0 of Array.isArray(paths) ? paths : []) {
        const chk = pathGuard.dropPath(p0);
        if (!chk.ok) { rejected++; continue; }
        list.push(p0);
        if (chk.folder) {
          recentDropFolders.add(pathGuard.folderKey(p0));
          if (recentDropFolders.size > 200) recentDropFolders.delete(recentDropFolders.values().next().value);
        }
      }
      const c = await library.classify(list);
      c.other += rejected;
      const tracks = await library.addFiles(c.audio);
      const playlists = [];
      for (const p0 of c.playlists) { try { playlists.push(await library.readPlaylistFile(p0)); } catch (err) { log('плейлист ' + path.basename(p0) + ': ' + err.message); } }
      return { tracks, folders: c.folders, playlists, other: c.other };
    }
    ipcMain.handle('lib-drop', (e, paths) => dropPaths(paths));
    ipcMain.handle('lib-folder-tracks', (e, dir) => {
      // Файлы папки — только из библиотеки или из только что проверенного перетаскивания.
      const folders = library.status().folders.map((f) => f.path);
      if (!pathGuard.inLibraryFolder(dir, folders) && !recentDropFolders.has(pathGuard.folderKey(dir))) {
        log('библиотека: список файлов — только для своей папки');
        return [];
      }
      return library.folderTracks(dir);
    });
    ipcMain.handle('m3u-export', async (e, title, tracks) => {
      const safe = String(title || 'Плейлист').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Плейлист';
      const r = await dialog.showSaveDialog(getMainWindow(), { title: 'Сохранить плейлист', defaultPath: path.join(app.getPath('music'), safe + '.m3u8'), filters: [{ name: 'Плейлист M3U', extensions: ['m3u8', 'm3u'] }] });
      if (r.canceled || !r.filePath) return { cancelled: true };
      try { fs.writeFileSync(r.filePath, '﻿' + library.m3uText(title, tracks), 'utf8'); log('плейлист сохранён в файл ' + path.basename(r.filePath)); return { ok: true, file: path.basename(r.filePath) }; }
      catch (err) { return { error: err.message }; }
    });
  }

  return { libSend, registerIpc };
}
