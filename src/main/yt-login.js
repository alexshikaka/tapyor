// Вход в YouTube: через браузер (OAuth), окном внутри Тапёра, ключом из браузера.
// Каналы yt-auth-status, yt-login-*, yt-oauth-*, yt-logout. Экспорт ytAuthStatus —
// им пользуются автопочинка, отладка и самопроверка (src/main/health.js).
// Перенесено из src/main.js без изменения поведения (A1). Все внешние вещи приходят через ctx.
'use strict';

module.exports = { setup };

function setup(ctx) {
  const { ipcMain, log, cfg, settingsStore, clipboard, fs, ytCookieFile, ytauth, ytoauth, getMainWindow } = ctx;

  // --- Вход в YouTube: через браузер (OAuth), окном внутри Тапёра, ключом из браузера ---
  try { if (fs.existsSync(ytCookieFile())) fs.unlinkSync(ytCookieFile()); } catch (e) { log('YouTube: не удалил старый файл cookies — ' + e.message); }
  ytauth.setup({ log, store: settingsStore, cookieFile: ytCookieFile() });
  ytoauth.setup({ log, store: settingsStore });
  ytauth.restore().catch((e) => log('YouTube: восстановление входа — ' + e.message));
  const ytAuthStatus = () => ({
    cookies: settingsStore.get('ytAccount') || null,
    oauth: { configured: ytoauth.configured(), account: ytoauth.loggedIn() ? (settingsStore.get('ytOauthAccount') || { name: 'аккаунт Google' }) : null, canWrite: ytoauth.canWrite() },
    useCookies: !!cfg('ytUseCookies')
  });
  ipcMain.handle('yt-auth-status', () => ytAuthStatus());
  ipcMain.handle('yt-login-paste', async (e, text) => {
    const t = text != null && String(text).trim() ? String(text) : clipboard.readText();
    let kind = '';
    try { kind = ytauth.parse(t).kind || ''; } catch (e2) {}
    const pasted = { kind, len: String(t || '').length }; // что вставили — без самого ключа
    try { return Object.assign(await ytauth.loginWithText(t), { pasted }); } catch (err) { log('YouTube: ключ — ' + err.message); return { error: 'failed', message: err.message, pasted }; }
  });
  ipcMain.handle('yt-login-window', () => ytauth.loginWindow(getMainWindow()));
  ipcMain.handle('yt-oauth-login', () => ytoauth.login());
  ipcMain.handle('yt-oauth-cancel', () => { ytoauth.cancel(); return true; });
  ipcMain.handle('yt-logout', async (e, kind) => { if (kind === 'oauth') ytoauth.logout(); else await ytauth.logout(); return ytAuthStatus(); });

  return { ytAuthStatus };
}
