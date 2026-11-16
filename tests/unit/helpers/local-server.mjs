// Помощник тестов: поднимает НАСТОЯЩИЙ локальный сервер ядра (src/main/local-server.js) без Electron.
// Нужен, чтобы проверять выдачу заголовков страниц модулей и файлов панели OBS (L7, L9 аудита 0.32.0).
// ctx собран минимальный: только то, что нужно этим адресам; окно и база лицензий не трогаются.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const SRC_DIR = path.join(ROOT, 'src');

export async function startLocalServer(opts = {}) {
  const localGuard = require(path.join(ROOT, 'src', 'localguard.js'));
  const serverErrors = require(path.join(ROOT, 'src', 'server-errors.js'));
  const server = require(path.join(ROOT, 'src', 'main', 'local-server.js'));
  const srcDir = opts.srcDir || SRC_DIR;

  // Ловим созданный http-сервер, чтобы потом закрыть его: сам модуль закрывать не умеет.
  let created = null;
  const httpShim = { createServer: (...args) => { created = http.createServer(...args); return created; } };
  const host = server.setup({
    http: httpShim, fs, path, log: () => {}, localGuard, serverErrors,
    perf: {}, uiToast: () => {}, srcDir,
    getMainWindow: () => null, getSbotHandle: () => null,
    readSettingsFile: () => ({}), writeSettingsFile: () => {}, setAppUrl: () => {},
  });
  const port = await host.start(opts.port || 0);
  const close = () => new Promise((resolve) => {
    try {
      if (created && created.closeAllConnections) created.closeAllConnections();
      if (created) created.close(() => resolve()); else resolve();
    } catch (e) { resolve(); }
  });
  return { port, base: 'http://127.0.0.1:' + port, host, close };
}
