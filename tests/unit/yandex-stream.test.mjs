// Ф2: без входа Яндекс отдаёт отрывок по тому же адресу, что и полный трек.
// Проверяем обработчик ym-stream: он должен пробовать поток без токена, а не сразу
// отвечать «войди». Иначе ▶ по треку Яндекса без входа ничего не играет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yandexMain = require('../../src/main/yandex.js');

function make(opts) {
  opts = opts || {};
  const calls = [];
  const handlers = new Map();
  const ipcMain = { handle(name, fn) { handlers.set(name, fn); }, on() {} };
  let token = opts.token || '';
  const ym = {
    setLogger() {},
    setHooks() {},
    async streamUrl(id, tok) {
      calls.push({ id, tok: tok || '' });
      if (opts.failStream) throw new Error('no-rights');
      return { audioUrl: 'https://strm.example/preview.mp3', preview: !tok, bitrate: 128 };
    }
  };
  const api = yandexMain.setup({
    ipcMain,
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => Buffer.from(b).toString('utf8')
    },
    clipboard: { writeText() {} },
    shell: { openExternal() {} },
    openExternal: { yandexDeviceUrl: (u) => u, allowed: () => true },
    cfg: () => true,
    settingsStore: { get: () => null, set() {} },
    log() {},
    logDebug() {},
    readSettings: () => (token ? { ymToken: Buffer.from(token, 'utf8').toString('base64') } : {}),
    writeSettings() {},
    yandexLogin: async () => ({ token: '' }),
    autofixR: { note() {}, success() {} },
    ytsT: async () => ({ videos: [] }),
    library: { search: () => [] },
    match: {
      norm: (s) => String(s || ''),
      clean: (s) => ({ query: String(s || '') }),
      exactLocal: () => null,
      decide: () => ({ status: 'none' }),
      decideOnly: () => ({ status: 'none' }),
      preferDuration: (r) => r
    },
    ym,
    streamBusy: { begin() {}, end() {} },
    ytSuggest: async () => []
  });
  api.registerIpc();
  return {
    calls,
    stream: (id) => handlers.get('ym-stream')(null, id),
    setToken: (t) => { token = t; }
  };
}

test('Ф2: без входа ym-stream сам берёт отрывок, токен не нужен', async () => {
  const s = make();
  const r = await s.stream('145486974');
  assert.equal(s.calls.length, 1, 'поток надо запросить, а не отвечать «войди» сразу');
  assert.equal(s.calls[0].id, '145486974');
  assert.equal(s.calls[0].tok, '', 'без входа запрос идёт без токена');
  assert.equal(r.audioUrl, 'https://strm.example/preview.mp3');
  assert.equal(r.preview, true, 'плеер должен знать, что это отрывок');
});

test('Ф2: без входа отрывок не выдался — честная просьба войти', async () => {
  const s = make({ failStream: true });
  const r = await s.stream('145486974');
  assert.match(r.error, /войди/i, 'без отрывка остаётся понятная причина');
});

test('Ф2: со входом токен уходит в Яндекс', async () => {
  const s = make({ token: 'tok-1' });
  await s.stream('145486974');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].tok, 'tok-1');
});

test('Ф2: отрывок без входа не подменяет полный поток после входа', async () => {
  const s = make();
  await s.stream('145486974');
  s.setToken('tok-2');
  await s.stream('145486974');
  assert.equal(s.calls.length, 2, 'после входа нужен новый запрос, а не отрывок из кэша');
  assert.equal(s.calls[1].tok, 'tok-2');
});
