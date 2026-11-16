// Чистая часть входа YouTube: обмен кода и обновление доступа Google.
// fetch передаётся снаружи (в программе — electron.net.fetch, в тестах — подделка):
// так у запроса есть тайм-аут, и его можно проверить без Electron и без сети.
// Тайм-аут двойной: signal обрывает сам запрос, withTimeout гарантирует, что вызывающий
// всё равно получит обычную ошибку, даже если реализация fetch signal не слушает.
const { CLOUD_KEY, CLOUD_KEY_HEADER } = require('./cloud-key');
const { withTimeout } = require('./with-timeout');

const TIMEOUT_MS = 15000;

async function tokenRequest(fetchImpl, cfg, params, ms) {
  const limit = ms || TIMEOUT_MS;
  const go = (async () => {
    if (cfg && cfg.proxyUrl) {
      const r = await fetchImpl(cfg.proxyUrl, { method: 'POST', body: JSON.stringify(params), headers: { 'Content-Type': 'application/json', [CLOUD_KEY_HEADER]: CLOUD_KEY }, signal: AbortSignal.timeout(limit) });
      return r.json().catch(() => ({}));
    }
    const body = new URLSearchParams(Object.assign({ client_id: cfg.clientId }, params));
    if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
    const r = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(limit) });
    return r.json().catch(() => ({}));
  })();
  return withTimeout(go, limit, 'Вход YouTube');
}

module.exports = { tokenRequest, TIMEOUT_MS };
