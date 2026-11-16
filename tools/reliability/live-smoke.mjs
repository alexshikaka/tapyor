// Живая проверка Тапёра одной командой: запускает программу с тестовым профилем внутри sandbox,
// открывает её через порт отладки (CDP без Playwright) и проходит ключевые сценарии:
// запуск, локальный сервер, очередь, окно цвета и пипетку, защиты путей, «Браузер»,
// встроенный плеер YouTube, SoundCloud и штатный выход.
//
// Запуск:
//   node tools/reliability/live-smoke.mjs --data <папка внутри sandbox>
//   npm run reliability:smoke -- --data <папка внутри sandbox>
//
// Чистые помощники и вердикты — в live-smoke-lib.mjs (покрыты unit-тестами).
// Инструмент не запускается в тестах: проверяются только --help, отказ без --data и чистые функции.
/* global WebSocket */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SCENARIOS, SCENARIO_LABELS, NETWORK_SCENARIOS, LOCAL_WAV_NAME,
  ORDERS_TEST_TEXT, ORDERS_TEST_AMOUNT, ORDERS_TIMEOUT_MS,
  SBOT_PROBE_PATH, SBOT_STARTING_RETRY_MS,
  IPC_READONLY_METHODS, IPC_CALL_TIMEOUT_MS, ipcCallExpression, ipcCallVerdict,
  parseArgs, helpText, defaultSettings, parseQueueFile, buildToday,
  pickPage, parseTargets, evalValue, pickTargets, findWebviewTarget, targetHost,
  httpStatusVerdict, widgetHeadersVerdict, logCrashLines, bridgeVerdict,
  queueRestored, splitCspViolations, pickCancelVerdict, exitVerdict,
  networkSkip, formatDuration, statusText, scrubPaths, formatReport,
  normalizeHex, seekVerdict, wavTone, vizFrameVerdict, pageErrorsVerdict,
  testOrderVerdict, requestsKeyVerdict, sbotStatusVerdict, debugStateVerdict,
  crashDeltaVerdict,
} from './live-smoke-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BRIDGE_EXPR = "(() => { try { var a = window.parent && window.parent.app; return { blocked: false, type: typeof a }; } catch (e) { return { blocked: true, name: (e && e.name) || 'SecurityError' }; } })()";
const YT_ID = 'jNQXAC9IVRw'; // первое видео YouTube, 19 секунд — только для живой пробы плеера

let stopping = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onSignal() {
  if (stopping) return;
  stopping = true;
  console.log('\nОстановка по Ctrl+C: закрываю Тапёр…');
}

// ── CDP ─────────────────────────────────────────────────────────────────────────────────────────
class Cdp {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label || 'CDP';
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Set();
    this.closed = false;
  }

  connect(timeoutMs = 5000) {
    if (typeof WebSocket !== 'function') {
      return Promise.reject(new Error('нет глобального WebSocket (нужен Node 22+)'));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(this);
      };
      const timer = setTimeout(() => {
        finish(new Error(this.label + ': соединение не открылось за ' + timeoutMs + ' мс'));
        try { if (this.ws) this.ws.close(); } catch (e) { /* уже закрыт */ }
      }, timeoutMs);
      try { this.ws = new WebSocket(this.wsUrl); }
      catch (e) { finish(e); return; }
      this.ws.addEventListener('open', () => finish(null));
      this.ws.addEventListener('message', (event) => this.message(event));
      this.ws.addEventListener('error', () => finish(new Error(this.label + ': ошибка соединения WebSocket')));
      this.ws.addEventListener('close', () => {
        this.closed = true;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error(this.label + ': соединение закрылось'));
          this.pending.delete(id);
        }
        finish(new Error(this.label + ': соединение закрылось'));
      });
    });
  }

  message(event) {
    let message;
    try { message = JSON.parse(String(event.data)); } catch (e) { return; }
    if (message && message.id != null) {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.error) p.reject(new Error(String(message.error.message || message.error)));
      else p.resolve(message);
      return;
    }
    for (const fn of this.handlers) {
      try { fn(message); } catch (e) { /* обработчик события не должен ломать связь */ }
    }
  }

  onEvent(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  send(method, params = {}, opts = {}) {
    if (!this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new Error(this.label + ': соединение не открыто'));
    }
    const id = this.nextId++;
    const message = { id, method, params };
    if (opts.sessionId) message.sessionId = opts.sessionId;
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 10000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(this.label + ': ' + method + ' не ответил за ' + timeoutMs + ' мс'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify(message)); }
      catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  close() {
    this.closed = true;
    try { if (this.ws) this.ws.close(); } catch (e) { /* уже закрыт */ }
    this.ws = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(this.label + ': соединение закрыто'));
      this.pending.delete(id);
    }
    this.pending.clear();
  }
}

async function safeEval(cdp, expression, opts = {}) {
  try {
    const params = { expression, returnByValue: true, awaitPromise: true, userGesture: true };
    if (opts.contextId) params.contextId = opts.contextId;
    const message = await cdp.send('Runtime.evaluate', params, opts);
    return { ok: true, value: evalValue(message) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function evaluate(cdp, expression, opts = {}) {
  const result = await safeEval(cdp, expression, opts);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function waitFor(fn, timeoutMs, intervalMs = 300, label = 'условие') {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (stopping) throw new Error('остановлено по Ctrl+C');
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    await sleep(intervalMs);
  }
  throw new Error(label + ' — не дождался за ' + formatDuration(timeoutMs)
    + (last ? ': ' + scrubPaths(last.message || last) : ''));
}

// ── сеть и HTTP ─────────────────────────────────────────────────────────────────────────────────
function httpRequest(url, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 5000;
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (e) { reject(e); return; }
    const headers = { accept: '*/*', ...(opts.headers || {}) };
    if (opts.hostHeader) headers.Host = opts.hostHeader;
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers,
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 20000) body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('тайм-аут HTTP')));
    req.on('error', reject);
    req.end();
  });
}

function tcpReachable(host, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    let socket = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { if (socket) socket.destroy(); } catch (e) { /* уже закрыт */ }
      resolve(value);
    };
    socket = net.connect({ host, port: 443 });
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function checkNetworks() {
  const hosts = Array.from(new Set(Object.values(NETWORK_SCENARIOS)));
  const result = {};
  await Promise.all(hosts.map(async (host) => { result[host] = await tcpReachable(host); }));
  return result;
}

// ── запуск и профиль ────────────────────────────────────────────────────────────────────────────
function electronSpawn(override) {
  const win = process.platform === 'win32';
  if (override) {
    let file = path.resolve(ROOT, override);
    if (!fs.existsSync(file) && win && fs.existsSync(file + '.cmd')) file += '.cmd';
    if (!fs.existsSync(file)) throw new Error('--electron: файл не найден');
    return { cmd: file, shell: win && /\.(?:cmd|bat)$/i.test(file) };
  }
  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron');
  if (fs.existsSync(dist)) return { cmd: dist, shell: false };
  const bin = path.join(ROOT, 'node_modules', '.bin', win ? 'electron.cmd' : 'electron');
  if (fs.existsSync(bin)) {
    // npm ci с ELECTRON_SKIP_BINARY_DOWNLOAD ставит оболочку без самой программы:
    // запуск молча падает, и инструмент 2 минуты ждал бы порт отладки.
    throw new Error('Electron установлен без программы (нет dist/electron.exe). Выполните npm ci без ELECTRON_SKIP_BINARY_DOWNLOAD или укажите --electron');
  }
  throw new Error('не найден Electron в node_modules (выполните npm ci)');
}

function prepareProfile(opts, now) {
  fs.mkdirSync(opts.data, { recursive: true });
  const settingsFile = path.join(opts.data, 'settings.json');
  let current = {};
  if (fs.existsSync(settingsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
    } catch (e) {
      console.log('settings.json: битый — перезаписываю тестовыми настройками');
    }
  }
  const next = { ...current, ...defaultSettings(opts.widgetPort) };
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2) + '\n', 'utf8');

  const todayFile = path.join(opts.data, 'today.json');
  if (!opts.queue) {
    try { fs.unlinkSync(todayFile); } catch (e) { if (e && e.code !== 'ENOENT') throw e; }
    return { queueTitles: [], queueCurrent: null };
  }
  const items = parseQueueFile(fs.readFileSync(opts.queue, 'utf8'));
  const today = buildToday(items, { now });
  fs.writeFileSync(todayFile, JSON.stringify(today, null, 2) + '\n', 'utf8');
  return { queueTitles: items.map((item) => item.title), queueCurrent: today.current };
}

async function fetchTargets(port, timeoutMs = 3000) {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list', {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('порт отладки ответил ' + response.status);
  return parseTargets(await response.text());
}

async function waitForPort(port, child, getError, timeoutMs = 120000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (stopping) throw new Error('остановлено до открытия порта отладки');
    const spawnError = getError();
    if (spawnError) throw new Error('не удалось запустить Electron: ' + spawnError.message);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Тапёр завершился до открытия порта отладки (код ' + (child.exitCode ?? child.signalCode) + ')');
    }
    try { return await fetchTargets(port); }
    catch (e) { last = e; }
    await sleep(500);
  }
  throw new Error('порт отладки ' + port + ' не ответил за ' + Math.round(timeoutMs / 1000) + ' с'
    + (last ? ': ' + last.message : ''));
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) { resolve(true); return; }
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('close', onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

// Завершаем только свои процессы: командная строка содержит наш порт отладки.
function killByDebugPort(port) {
  if (process.platform !== 'win32') return;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'electron*' -and $_.CommandLine -match 'remote-debugging-port=" + String(port) + "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
  ].join('\n');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore', windowsHide: true, timeout: 15000,
    });
  } catch (e) { /* процессов уже нет */ }
}

// ── пипетка ────────────────────────────────────────────────────────────────────────────────────
async function withPickCdp(target, fn) {
  const cdp = new Cdp(target.webSocketDebuggerUrl, 'окно пипетки');
  await cdp.connect(4000);
  try { return await fn(cdp); }
  finally { cdp.close(); }
}

async function sendPickKey(target) {
  await withPickCdp(target, async (cdp) => {
    const params = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params }, { timeoutMs: 3000 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params }, { timeoutMs: 3000 });
  });
}

// Признак готовности окна пипетки: src/pick.html вешает mousedown (и Esc) только после того,
// как получил снимок экрана (api.init) и нарисовал его на холст #screen. До этого щелчок
// уходит в пустоту — отсюда был ложный провал «выбор цвета», хотя щелчок был отправлен.
const PICK_READY_EXPR = "(() => { try { var c = document.getElementById('screen'); return !!(window.pickApi && c && c.width > 0 && c.height > 0); } catch (e) { return false; } })()";

async function waitPickReady(target, label) {
  await withPickCdp(target, async (cdp) => {
    await waitFor(async () => {
      const result = await safeEval(cdp, PICK_READY_EXPR, { timeoutMs: 3000 });
      return result.ok && result.value === true;
    }, 10000, 200, label + ' — не дождался готовности за 10 с');
  });
}

async function pickWindowOpen(ctx) {
  try { return (await pickWindowTargets(ctx)).length > 0; }
  catch (e) { return true; } // порт не ответил — считаем, что окно ещё живо
}

async function waitPickClosed(ctx, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await pickWindowOpen(ctx))) return true;
    await sleep(150);
  }
  return !(await pickWindowOpen(ctx));
}

// Щелчок по окну пипетки: если окно не закрылось за 2 с — повторяем, всего до 3 попыток.
// Число попыток попадает в подробности сценария.
async function pickClickWithRetry(ctx, target, maxAttempts = 3) {
  let attempts = 0;
  let closed = false;
  for (let i = 0; i < maxAttempts; i++) {
    if (!(await pickWindowOpen(ctx))) { closed = true; break; }
    attempts++;
    try { await sendPickClick(target); }
    catch (e) { /* окно закрылось до щелчка — проверим, закрыто ли оно */ }
    closed = await waitPickClosed(ctx, 2000);
    if (closed) break;
  }
  return { attempts, closed };
}

async function sendKey(cdp, key, code, keyCode) {
  const params = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params }, { timeoutMs: 3000 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params }, { timeoutMs: 3000 });
}

async function sendPickClick(target) {
  await withPickCdp(target, async (cdp) => {
    const point = { x: 400, y: 300, button: 'left', clickCount: 1 };
    try { await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, ...point }, { timeoutMs: 3000 }); }
    catch (e) { /* окно закрылось сразу после нажатия — это норма */ }
    try { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, ...point }, { timeoutMs: 1000 }); }
    catch (e) { /* окно уже закрыто */ }
  });
}

async function closePickTarget(target) {
  try {
    await withPickCdp(target, (cdp) => cdp.send('Runtime.evaluate', {
      expression: 'window.close()', returnByValue: true,
    }, { timeoutMs: 2000 }));
  } catch (e) { /* уже закрыто */ }
}

async function pickWindowTargets(ctx) {
  return pickTargets(await fetchTargets(ctx.opts.port));
}

// ── кадр плеера YouTube ────────────────────────────────────────────────────────────────────────
async function bridgeViaTarget(ctx, cdp) {
  const targets = await fetchTargets(ctx.opts.port).catch(() => []);
  const target = targets.find((t) => /ytplayer\.html/i.test(String(t.url || '')));
  if (target && target.webSocketDebuggerUrl) {
    const direct = new Cdp(target.webSocketDebuggerUrl, 'кадр плеера');
    try {
      await direct.connect(4000);
      const result = await safeEval(direct, BRIDGE_EXPR);
      if (result.ok) return result.value;
    } catch (e) { /* пробуем другие способы */ }
    finally { direct.close(); }
  }

  const contexts = [];
  const off = cdp.onEvent((message) => {
    if (message.method === 'Runtime.executionContextCreated' && message.params && message.params.context) {
      contexts.push(message.params.context);
    }
  });
  try {
    try { await cdp.send('Runtime.enable'); } catch (e) { /* домен уже включён */ }
    await sleep(300);
    let rootId = '';
    try { rootId = (await cdp.send('Page.getFrameTree')).result.frameTree.frame.id; } catch (e) { /* нет дерева кадров */ }
    const wantOrigin = 'http://localhost:' + ctx.serverPort;
    const candidates = contexts.filter((c) => String(c.origin || '') === wantOrigin
      && (!rootId || !c.auxData || !c.auxData.frameId || c.auxData.frameId !== rootId));
    const context = candidates.find((c) => c.auxData && c.auxData.isDefault) || candidates[0];
    if (context) {
      const result = await safeEval(cdp, BRIDGE_EXPR, { contextId: context.id });
      if (result.ok) return result.value;
    }
  } finally { off(); }

  try {
    const infos = (await cdp.send('Target.getTargets')).result.targetInfos || [];
    const target = infos.find((t) => /ytplayer\.html/i.test(String(t.url || '')));
    if (target) {
      const sessionId = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).result.sessionId;
      if (sessionId) {
        try {
          const result = await safeEval(cdp, BRIDGE_EXPR, { sessionId });
          if (result.ok) return result.value;
        } finally {
          try { await cdp.send('Target.detachFromTarget', { sessionId }); } catch (e) { /* уже отключён */ }
        }
      }
    }
  } catch (e) { /* кадра нет — вернём null */ }
  return null;
}

// ── сценарии ───────────────────────────────────────────────────────────────────────────────────
function checksToResult(checks) {
  const failed = checks.filter((c) => !c.ok);
  return {
    status: failed.length ? 'failed' : 'passed',
    details: checks.map((c) => c.name + ': ' + c.detail),
  };
}

async function scStart(ctx) {
  let logText = null;
  try { logText = fs.readFileSync(path.join(ctx.dataDir, 'log.txt'), 'utf8'); }
  catch (e) { logText = null; }
  if (logText === null) {
    await sleep(1000);
    try { logText = fs.readFileSync(path.join(ctx.dataDir, 'log.txt'), 'utf8'); }
    catch (e) { logText = null; }
  }
  const crashes = logText === null ? null : logCrashLines(logText);
  const page = ctx.pageTarget;
  const server = await httpRequest(ctx.base + '/widget', { hostHeader: ctx.hostHeader, timeoutMs: 4000 });
  const serverVerdict = httpStatusVerdict(200, server);
  return checksToResult([
    { name: 'окно', ok: !!page, detail: page ? 'открылось' : 'не найдено в целях отладки' },
    { name: 'сервер', ok: serverVerdict.ok, detail: serverVerdict.ok ? 'слушает порт ' + ctx.serverPort : serverVerdict.reason },
    {
      name: 'журнал',
      ok: crashes !== null && crashes.length === 0,
      detail: crashes === null ? 'log.txt не найден' : (crashes.length ? 'необработанных ошибок: ' + crashes.length : 'без «главный процесс: необработанная ошибка»'),
    },
  ]);
}

async function scServer(ctx) {
  const checks = [];
  for (const page of ['/widget', '/widget/state', '/widget.js', '/ui.js']) {
    const response = await httpRequest(ctx.base + page, { hostHeader: ctx.hostHeader, timeoutMs: 4000 });
    const verdict = httpStatusVerdict(200, response);
    checks.push({ name: page, ok: verdict.ok, detail: verdict.reason });
  }
  const foreign = await httpRequest(ctx.base + '/widget', { hostHeader: 'evil.example:' + ctx.serverPort, timeoutMs: 4000 });
  const foreignVerdict = httpStatusVerdict(403, foreign);
  checks.push({ name: 'чужой Host', ok: foreignVerdict.ok, detail: foreignVerdict.reason });
  const widget = await httpRequest(ctx.base + '/widget', { hostHeader: ctx.hostHeader, timeoutMs: 4000 });
  const headers = widgetHeadersVerdict(widget.headers);
  checks.push({ name: 'заголовки /widget', ok: headers.ok, detail: headers.reason });
  return checksToResult(checks);
}

async function scQueue(ctx) {
  if (!ctx.queueTitles.length) return { skip: 'очередь не подложена (--queue не задан)' };
  const expression = "(() => { try { if (typeof queue !== 'undefined' && Array.isArray(queue)) return queue.map(function (v) { return v && v.title; }); } catch (e) {} return Array.prototype.map.call(document.querySelectorAll('#queue .qrow .qt'), function (e) { return e.textContent; }); })()";
  let titles = [];
  try {
    titles = await waitFor(async () => {
      const value = await evaluate(ctx.cdp, expression);
      return queueRestored(value, ctx.queueTitles).ok ? value : null;
    }, 15000, 500, 'подложенная очередь');
  } catch (e) {
    const last = await safeEval(ctx.cdp, expression);
    titles = last.ok ? last.value : [];
  }
  const restored = queueRestored(titles, ctx.queueTitles);
  const checks = [{
    name: 'очередь',
    ok: restored.ok,
    detail: restored.ok ? 'восстановлено треков: ' + restored.actual : 'не найдены: ' + restored.missing.join(', '),
  }];
  if (ctx.queueCurrent !== null) {
    const current = await safeEval(ctx.cdp, "typeof current === 'number' ? current : null");
    if (current.ok && Number.isFinite(current.value)) {
      checks.push({ name: 'место', ok: Number(current.value) === ctx.queueCurrent, detail: 'current=' + current.value });
    }
  }
  return checksToResult(checks);
}

async function scPick(ctx) {
  try {
    return await scPickInner(ctx);
  } finally {
    for (const target of await pickWindowTargets(ctx).catch(() => [])) {
      await closePickTarget(target);
    }
    await safeEval(ctx.cdp, "try { var b = document.getElementById('colv'); if (b && !b.hidden) colCancel(); } catch (e) {}; true");
  }
}

async function scPickInner(ctx) {
  const cdp = ctx.cdp;
  const checks = [];
  await evaluate(cdp, "setTab('search'); window.__livePicked=[]; colOpenFor('Проба', '#3366cc', function (h) { window.__livePicked.push(h); }); true");
  await waitFor(async () => (await evaluate(cdp, "!!(document.getElementById('colv') && !document.getElementById('colv').hidden)")) === true,
    5000, 200, 'окно цвета не открылось');

  for (let i = 1; i <= 3; i++) {
    await evaluate(cdp, "document.getElementById('colPip').click(); true");
    const target = await waitFor(async () => (await pickWindowTargets(ctx))[0] || null,
      10000, 200, 'окно пипетки №' + i + ' не появилось');
    // Ждём, пока окно пипетки нарисует снимок и повесит обработчики: иначе Esc тоже уйдёт в пустоту.
    await waitPickReady(target, 'окно пипетки №' + i);
    const busy = await evaluate(cdp, "(() => { var b = document.getElementById('colPip'); return { disabled: !!b.disabled, busy: b.getAttribute('aria-busy') === 'true' }; })()");
    await evaluate(cdp, "document.getElementById('colPip').click(); true");
    await sleep(600);
    const count = (await pickWindowTargets(ctx)).length;
    try { await sendPickKey(target); } catch (e) { /* окно могло закрыться прямо в момент нажатия */ }
    let closed = false;
    try {
      await waitFor(async () => (await pickWindowTargets(ctx)).length === 0, 6000, 200, 'окно пипетки');
      closed = true;
    } catch (e) {
      await closePickTarget(target);
    }
    const after = await safeEval(cdp, "(() => { var b = document.getElementById('colPip'); return { idle: !b.disabled && !b.getAttribute('aria-busy'), picked: window.__livePicked.length }; })()");
    const picked = after.ok ? after.value.picked : -1;
    const idle = after.ok ? after.value.idle === true : false;
    checks.push({
      name: 'запуск ' + i,
      ok: !!target && busy.disabled && busy.busy && count === 1 && closed && idle && picked === 0,
      detail: 'окно появилось; кнопка занята: ' + (busy.disabled && busy.busy ? 'да' : 'нет')
        + '; окон после второго клика: ' + count
        + '; Esc закрыл: ' + (closed ? 'да' : 'нет')
        + '; кнопка освободилась: ' + (idle ? 'да' : 'нет')
        + '; цвет не менялся: ' + (picked === 0 ? 'да' : 'нет'),
    });
    if (picked !== 0) {
      await safeEval(cdp, "window.__livePicked=[]; true");
    }
    await sleep(300);
  }

  await evaluate(cdp, "document.getElementById('colPip').click(); true");
  const pick = await waitFor(async () => (await pickWindowTargets(ctx))[0] || null,
    10000, 200, 'окно пипетки для выбора цвета');
  // Щелчок — только после готовности окна (иначе mousedown ещё не повешен), с повторами.
  await waitPickReady(pick, 'окно пипетки для выбора цвета');
  const click = await pickClickWithRetry(ctx, pick, 3);
  if (!click.closed) { try { await closePickTarget(pick); } catch (e) { /* уже закрыто */ } }
  await sleep(600);
  const selected = await safeEval(cdp, "({ hex: document.getElementById('colHex').value, picked: window.__livePicked.slice() })");
  const selectedHex = normalizeHex(selected.ok && selected.value ? selected.value.hex : '');
  const pickedList = selected.ok && selected.value && Array.isArray(selected.value.picked) ? selected.value.picked : [];
  const hexChanged = !!selectedHex && selectedHex !== '#3366CC';
  const callbackGot = pickedList.length > 0;
  checks.push({
    name: 'выбор цвета',
    ok: click.closed && (hexChanged || callbackGot),
    detail: 'окно закрылось: ' + (click.closed ? 'да' : 'нет')
      + '; попыток щелчка: ' + click.attempts
      + '; в #colHex: ' + (selectedHex || '?')
      + (hexChanged ? '' : ' (совпал с исходным — не провал, если обработчик получил цвет)')
      + '; обработчик получил: ' + (callbackGot ? pickedList.join(', ') : 'ничего'),
  });
  await evaluate(cdp, "document.getElementById('colCancel').click(); true");
  await sleep(400);
  const after = await safeEval(cdp, "({ hex: document.getElementById('colHex').value, hidden: !!(document.getElementById('colv') || {}).hidden, picked: window.__livePicked.slice() })");
  const verdict = pickCancelVerdict({
    start: '#3366cc',
    after: after.ok ? after.value.hex : '',
    picked: after.ok ? after.value.picked : [],
  });
  checks.push({
    name: 'Отмена',
    ok: verdict.ok && after.ok && after.value.hidden === true,
    detail: 'выбран ' + (selectedHex || '?')
      + '; «Отмена» вернула ' + (verdict.after || '?') + ' (ждали ' + verdict.start + ')'
      + '; обработчик получил ' + (verdict.last || 'ничего'),
  });
  return checksToResult(checks);
}

function describeShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'массив';
  if (typeof value === 'object') return 'объект (' + Object.keys(value).slice(0, 5).join(', ') + ')';
  return typeof value;
}

async function guardResult(ctx, call) {
  const wrapped = call + '.then(function (v) { return { ok: true, value: v }; }, function (e) { return { ok: false, error: true }; })';
  const result = await safeEval(ctx.cdp, wrapped);
  if (!result.ok) return { passed: true, detail: 'вызов отклонён' };
  const outer = result.value;
  if (!outer || outer.ok !== true) return { passed: true, detail: 'вызов вернул ошибку' };
  const value = outer.value;
  if (value && typeof value === 'object' && value.error) return { passed: true, detail: 'ответ с полем error' };
  if (value === false || value == null) return { passed: true, detail: 'ответ без доступа' };
  return { passed: false, detail: 'отказа нет: ' + describeShape(value) };
}

async function scGuards(ctx) {
  const winIni = 'C:\\Windows\\win.ini';
  const winDir = 'C:\\Windows';
  const imported = await guardResult(ctx, 'window.app.importFile(' + JSON.stringify(winIni) + ')');
  const folder = await guardResult(ctx, 'window.app.libAddFolder(' + JSON.stringify(winDir) + ')');
  return checksToResult([
    { name: 'importFile(системный файл)', ok: imported.passed, detail: imported.detail },
    { name: 'libAddFolder(системная папка)', ok: folder.passed, detail: folder.detail },
  ]);
}

// ── заказы, Streamer.bot, отладка и каналы «только чтение» ─────────────────────────────────────
function readProfileLog(ctx) {
  try { return fs.readFileSync(path.join(ctx.dataDir, 'log.txt'), 'utf8'); }
  catch (e) { return null; }
}

// Тестовый заказ идёт тем же путём, что настоящий донат: reqTest → req-test в главном процессе
// (main.js) → onDonation → processDonation → requests.json → «Заказы». Сеть нужна поиску трека.
async function scOrders(ctx) {
  // Ошибку моста (старая сборка, отказ) заворачиваем в объект: иначе исключение страницы
  // попадёт в общую строку «ошибки страницы» и запутает причину.
  await evaluate(ctx.cdp, '(function () { try { window.__liveOrder = null;'
    + ' window.app.reqTest(' + JSON.stringify(ORDERS_TEST_TEXT) + ', ' + Number(ORDERS_TEST_AMOUNT) + ').then('
    + 'function (v) { window.__liveOrder = { ok: true, value: v }; },'
    + ' function (e) { window.__liveOrder = { ok: false, error: String((e && e.message) || e) }; });'
    + ' } catch (e) { window.__liveOrder = { ok: false, error: String((e && e.message) || e) }; }'
    + ' return true; })()');
  const found = await waitFor(async () => {
    const result = await safeEval(ctx.cdp, "typeof window.__liveOrder === 'undefined' ? null : window.__liveOrder");
    return result.ok && result.value !== null ? result.value : null;
  }, ORDERS_TIMEOUT_MS, 500, 'тестовый заказ не ответил за ' + formatDuration(ORDERS_TIMEOUT_MS));
  if (!found || found.ok !== true) {
    throw new Error('req-test: ' + scrubPaths((found && found.error) || 'окно вернуло ошибку'));
  }

  const verdict = testOrderVerdict(found.value);
  const checks = [{ name: 'ответ', ok: verdict.ok, detail: verdict.reason }];

  let requestsText = null;
  try { requestsText = fs.readFileSync(path.join(ctx.dataDir, 'requests.json'), 'utf8'); }
  catch (e) { requestsText = null; }
  const fileVerdict = !verdict.ok
    ? { ok: false, reason: 'ответ без ключа test: — запись в requests.json не ищем' }
    : requestsText === null
      ? { ok: false, reason: 'requests.json в профиле не найден' }
      : requestsKeyVerdict(requestsText, verdict.key);
  checks.push({ name: 'requests.json', ok: fileVerdict.ok, detail: fileVerdict.reason });

  const logText = readProfileLog(ctx);
  const crashes = logText === null ? null : logCrashLines(logText);
  checks.push({
    name: 'журнал',
    ok: crashes !== null && crashes.length === 0,
    detail: crashes === null
      ? 'log.txt не найден'
      : (crashes.length ? 'необработанных ошибок: ' + crashes.length : 'без «главный процесс: необработанная ошибка»'),
  });
  return checksToResult(checks);
}

// Порт /sb/* на локальном сервере: без ключа — 401. Пока порт не создан (окно ещё стартует),
// сервер честно отвечает 503 starting — тогда повторяем до 10 с (src/main/local-server.js).
async function scSbot(ctx) {
  const startedAt = Date.now();
  let verdict = null;
  for (;;) {
    try {
      const response = await httpRequest(ctx.base + SBOT_PROBE_PATH, {
        hostHeader: ctx.hostHeader, timeoutMs: 4000,
      });
      // Тело намеренно не читаем и не печатаем: в нём бывает состояние приёма заказов.
      verdict = sbotStatusVerdict(response.status);
    } catch (e) {
      verdict = { ok: false, retry: true, reason: 'локальный сервер не ответил' };
    }
    if (verdict.ok || !verdict.retry) break;
    if (Date.now() - startedAt >= SBOT_STARTING_RETRY_MS) break;
    await sleep(500);
  }
  return checksToResult([{
    name: SBOT_PROBE_PATH + ' без ключа',
    ok: !!verdict && verdict.ok === true,
    detail: (verdict ? verdict.reason : 'нет ответа') + '; тело ответа не печатаю',
  }]);
}

// Снимок раздела «Отладка»: мост debugState → канал debug-state (main.js: debugGather).
// Только чтение: ни сбросов, ни записи файлов.
async function scDebug(ctx) {
  const result = await safeEval(ctx.cdp, 'window.app.debugState()', { timeoutMs: IPC_CALL_TIMEOUT_MS });
  if (!result.ok) {
    return checksToResult([{ name: 'ответ', ok: false, detail: 'вызов не ответил: ' + scrubPaths(result.error) }]);
  }
  const verdict = debugStateVerdict(result.value);
  return checksToResult([{ name: 'снимок', ok: verdict.ok, detail: verdict.reason }]);
}

// Обход белого списка методов window.app (IPC_READONLY_METHODS в live-smoke-lib.mjs):
// у каждого вызова тайм-аут 20 с, ответ должен прийти без исключения в окне.
// Ошибки главного процесса сравниваем до и после — чужой старый сбой не должен валить сценарий.
async function scIpc(ctx) {
  const logBefore = readProfileLog(ctx);
  const checks = [];
  for (const method of IPC_READONLY_METHODS) {
    const result = await safeEval(ctx.cdp, ipcCallExpression(method.name, method.args), {
      timeoutMs: IPC_CALL_TIMEOUT_MS,
    });
    const outcome = result.ok
      ? ipcCallVerdict(result.value)
      : { ok: false, reason: 'окно не ответило за ' + formatDuration(IPC_CALL_TIMEOUT_MS) };
    checks.push({ name: method.name, ok: outcome.ok, detail: outcome.reason });
  }
  const logAfter = readProfileLog(ctx);
  const crashes = logAfter === null
    ? { ok: false, reason: 'log.txt не найден — журнал не проверить' }
    : crashDeltaVerdict(logBefore, logAfter);
  checks.push({ name: 'журнал', ok: crashes.ok, detail: crashes.reason });
  return checksToResult(checks);
}

async function scBrowser(ctx) {
  await evaluate(ctx.cdp, "setTab('browser'); brShow('yt'); true");
  const target = await waitFor(async () => findWebviewTarget(await fetchTargets(ctx.opts.port), 'youtube.com'),
    30000, 500, 'webview YouTube не открылся');
  return checksToResult([
    { name: 'webview', ok: !!target, detail: 'YouTube: ' + (target ? 'открыт (' + targetHost(target.url) + ')' : 'не открыт') },
  ]);
}

// Перемотка встроенного плеера YouTube. Страница присылает время окну только пока видео играет
// (src/ytplayer.js: startTick при состоянии 1), поэтому после seekTo на паузе старое время
// не обновляется — сначала «играть», потом ждём время в пределах цели и прошедших секунд.
async function seekStep(ctx, opts) {
  const beforeState = await safeEval(ctx.cdp, "({ t: ytx.currentTime, paused: ytx.paused })");
  const before = beforeState.ok ? Number(beforeState.value.t) : NaN;
  // Счётчик сообщений времени от страницы плеера: присвоение ytx.currentTime сразу меняет
  // зеркало в окне, поэтому «прошло» верим только времени, которое прислала сама страница.
  // Счётчик растёт на каждое сообщение времени от страницы плеера (src/ui/02-player.js: ev.type 'time'
  // → ytxEmit('timeupdate')). 13.11: раньше счётчик только обнулялся, и шаг проваливался всегда.
  await evaluate(ctx.cdp, "if (!window.__liveSeekHooked) { window.__liveSeekHooked = true;"
    + " ytx.addEventListener('timeupdate', function () { window.__liveSeekTicks = (window.__liveSeekTicks | 0) + 1; }); } true");
  await evaluate(ctx.cdp, "window.__liveSeekTicks=0; ytx.currentTime = " + Number(opts.target) + ';'
    + (opts.play ? ' ytx.play();' : '') + ' true');
  const startedAt = Date.now();
  let last = null;
  let verdict = null;
  try {
    await waitFor(async () => {
      const state = await safeEval(ctx.cdp, "({ t: ytx.currentTime, paused: ytx.paused, ticks: window.__liveSeekTicks | 0 })");
      if (!state.ok || !state.value) return null;
      last = state.value;
      if (!(Number(state.value.ticks) > 0)) return null;
      const check = seekVerdict({
        before,
        target: opts.target,
        after: Number(state.value.t),
        elapsedSec: (Date.now() - startedAt) / 1000,
      });
      if (!check.ok) return null;
      verdict = check;
      return check;
    }, 10000, 250, opts.label);
  } catch (e) {
    // Не дождались: последнее прочитанное время всё равно показываем в подробностях.
    verdict = seekVerdict({
      before,
      target: opts.target,
      after: Number(last && last.t),
      elapsedSec: (Date.now() - startedAt) / 1000,
    });
    if (verdict.ok && !(last && Number(last.ticks) > 0)) {
      verdict = { ...verdict, ok: false, reason: 'время после перемотки не обновила страница плеера' };
    }
  }
  return { verdict, last, before, paused: !!(last && last.paused) };
}

async function scYoutube(ctx) {
  try {
    return await scYoutubeInner(ctx);
  } finally {
    await safeEval(ctx.cdp, "try { ytxStop(); } catch (e) {}; true");
  }
}

async function scYoutubeInner(ctx) {
  const checks = [];
  await evaluate(ctx.cdp, "window.__liveYtErr=null; ytxLoad(" + JSON.stringify(YT_ID)
    + ").then(function () {}, function (e) { window.__liveYtErr=String((e && e.message) || e); }); true");
  const playing = await waitFor(async () => {
    const state = await safeEval(ctx.cdp, "({ t: ytx.currentTime, paused: ytx.paused, err: window.__liveYtErr })");
    if (!state.ok || !state.value) return null;
    if (state.value.err) return { error: state.value.err };
    return Number(state.value.t) > 1.5 ? state.value : null;
  }, 45000, 1000, 'видео YouTube не заиграло');
  if (playing.error) throw new Error('ytxLoad: ' + scrubPaths(playing.error));
  checks.push({ name: 'играет', ok: true, detail: 'время ' + Number(playing.t).toFixed(1) + ' с' });

  await evaluate(ctx.cdp, "ytx.pause(); true");
  await sleep(2500);
  const paused = await safeEval(ctx.cdp, "({ paused: ytx.paused, t: ytx.currentTime })");
  checks.push({
    name: 'пауза',
    ok: !!paused.ok && paused.value.paused === true,
    detail: 'paused=' + (paused.ok ? String(paused.value.paused) : '?'),
  });

  // Шаг 1: перемотка на паузе, затем «играть» — время должно догнать 8 с.
  const onPause = await seekStep(ctx, { target: 8, play: true, label: 'время на паузе не догнало 8 с' });
  checks.push({
    name: 'перемотка на паузе',
    ok: !!onPause.verdict && onPause.verdict.ok,
    detail: (Number.isFinite(onPause.before) ? 'было ' + onPause.before.toFixed(1) + ' с; ' : '')
      + (onPause.verdict ? onPause.verdict.reason : 'нет вердикта'),
  });

  // Шаг 2: перемотка во время игры — время должно оказаться у 3 с.
  const duringPlay = await seekStep(ctx, { target: 3, play: false, label: 'перемотка во время игры не сработала' });
  checks.push({
    name: 'перемотка во время игры',
    ok: !!duringPlay.verdict && duringPlay.verdict.ok,
    detail: (Number.isFinite(duringPlay.before) ? 'было ' + duringPlay.before.toFixed(1) + ' с; ' : '')
      + (duringPlay.verdict ? duringPlay.verdict.reason : 'нет вердикта'),
  });

  const bridge = await bridgeViaTarget(ctx, ctx.cdp);
  checks.push({ name: 'кадр плеера', ok: bridgeVerdict(bridge).ok, detail: bridgeVerdict(bridge).reason });
  return checksToResult(checks);
}

async function scSoundcloud(ctx) {
  try {
    return await scSoundcloudInner(ctx);
  } finally {
    await safeEval(ctx.cdp, "try { master().pause(); } catch (e) {}; true");
  }
}

async function scSoundcloudInner(ctx) {
  ctx.consoleEntries.length = 0;
  const checks = [];
  // Пустой профиль: движок yt-dlp скачивается при запуске программы, поиску SoundCloud он нужен.
  const engine = path.join(ctx.dataDir, 'bin', 'yt-dlp.exe');
  if (!fs.existsSync(engine)) {
    await waitFor(async () => fs.existsSync(engine), 90000, 1000, 'движок yt-dlp не появился в профиле');
  }
  await evaluate(ctx.cdp, "window.__liveSc=null; window.app.scSearch('lofi hip hop', 5).then(function (v) { window.__liveSc=v; }, function (e) { window.__liveSc={ error: String((e && e.message) || e) }; }); true");
  const found = await waitFor(async () => {
    const result = await safeEval(ctx.cdp, "(typeof window.__liveSc === 'undefined' || window.__liveSc === null) ? null : window.__liveSc");
    return result.ok && result.value !== null ? { value: result.value } : null;
  }, 60000, 500, 'поиск SoundCloud не ответил');
  const value = found.value;
  if (value && value.error) throw new Error('поиск SoundCloud: ' + scrubPaths(value.error));
  const items = Array.isArray(value) ? value : (value && Array.isArray(value.items) ? value.items : null);
  if (!items || !items.length) {
    checks.push({ name: 'поиск', ok: false, detail: 'пустой ответ SoundCloud' });
    return checksToResult(checks);
  }
  checks.push({ name: 'поиск', ok: true, detail: 'результатов: ' + items.length });

  await evaluate(ctx.cdp, "playNow(" + JSON.stringify(items[0]) + "); true");
  const playing = await waitFor(async () => {
    const state = await safeEval(ctx.cdp, "(() => { var m = master(); var src = String(m.getAttribute('src') || ''); return { t: Number(m.currentTime) || 0, src: src.slice(0, 5), err: String((document.getElementById('err') || {}).textContent || '').slice(0, 120) }; })()");
    if (!state.ok || !state.value) return null;
    if (state.value.err) return { error: state.value.err };
    return Number(state.value.t) > 3 ? state.value : null;
  }, 60000, 1000, 'SoundCloud не заиграл');
  if (playing.error) throw new Error('SoundCloud: ' + scrubPaths(playing.error));
  checks.push({ name: 'играет', ok: true, detail: 'время ' + Number(playing.t).toFixed(1) + ' с' });
  checks.push({ name: 'источник', ok: playing.src === 'blob:', detail: 'blob: ' + (playing.src === 'blob:' ? 'да' : 'нет (' + (playing.src || '—') + ')') });

  const csp = splitCspViolations(ctx.consoleEntries);
  checks.push({
    name: 'CSP',
    ok: csp.unexpected.length === 0,
    detail: csp.unexpected.length
      ? 'нарушений: ' + csp.unexpected.length + ' — ' + scrubPaths(csp.unexpected[0]).slice(0, 160)
      : 'нарушений нет' + (csp.known.length ? ' (известное worker hls.js: ' + csp.known.length + ')' : ''),
  });
  return checksToResult(checks);
}

// ── файл с компьютера, визуализатор, «на весь экран» ───────────────────────────────────────────
// Тестовый тон создаём сами: папка music внутри профиля --data, системный диалог не нужен.
function makeLocalTone(ctx) {
  const dir = path.join(ctx.dataDir, 'music');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LOCAL_WAV_NAME);
  const data = wavTone({ seconds: 4, freq: 440, sampleRate: 44100, bits: 16, channels: 1 });
  // Не перезаписываем файл, который уже играет: дописывание поверх может испортить чтение.
  let current = null;
  try { current = fs.statSync(file); } catch (e) { current = null; }
  if (!current || current.size !== data.length) fs.writeFileSync(file, data);
  return { dir, file, bytes: data.length };
}

async function localLibTracks(ctx) {
  const result = await safeEval(ctx.cdp, 'window.app.libAll()', { timeoutMs: 15000 });
  return result.ok && Array.isArray(result.value) ? result.value : null;
}

function findLocalTrack(tracks) {
  return (Array.isArray(tracks) ? tracks : []).find((t) => t && typeof t.path === 'string'
    && path.basename(t.path).toLowerCase() === LOCAL_WAV_NAME) || null;
}

const LOCAL_STATE_EXPR = '(() => { var m = master(); var v = queue[current] || {};'
  + ' return { t: Number(m && m.currentTime) || 0, dur: Number(m && m.duration) || 0,'
  + ' paused: !!(m && m.paused), src: srcOf(v), id: v.id || \'\', ended: !!(m && m.ended),'
  + ' fsub: String((document.getElementById(\'f-sub\') || {}).textContent || \'\'),'
  + ' card: String((document.getElementById(\'card-sub\') || {}).textContent || \'\') }; })()';

async function localPlaybackState(ctx) {
  const result = await safeEval(ctx.cdp, LOCAL_STATE_EXPR);
  return result.ok ? result.value : null;
}

function localErrText(state) {
  const text = [state && state.fsub, state && state.card].filter(Boolean).join(' ');
  return /⚠|ошибк|не играет|не удалось/i.test(text) ? text.trim().slice(0, 160) : '';
}

// Добавляем папку тем же путём, что и кнопка «＋ Папка»: libAddFolder(dir) из 11-local.js,
// с готовым путём она не открывает системный диалог (main.js: lib-add-folder).
async function addLocalFolder(ctx, dir) {
  return safeEval(ctx.cdp, 'libAddFolder(' + JSON.stringify(dir) + ')', { timeoutMs: 90000 });
}

async function ensureLocalTrack(ctx) {
  const tone = makeLocalTone(ctx);
  const added = await addLocalFolder(ctx, tone.dir);
  if (!added.ok) throw new Error('добавить папку музыки не удалось: ' + added.error);
  const track = await waitFor(async () => findLocalTrack(await localLibTracks(ctx)),
    30000, 500, 'тестовый WAV не появился в библиотеке');
  return { tone, track };
}

async function ensureLocalPlaying(ctx) {
  const { tone, track } = await ensureLocalTrack(ctx);
  const current = await localPlaybackState(ctx);
  const same = !!current && current.src === 'lc' && current.id === track.id && !localErrText(current);
  // Короткий тон (4 с): если он уже почти кончился, начинаем заново, иначе проверка
  // визуализатора оборвётся на «трек закончился».
  const remaining = same ? Math.max(0, Number(current.dur) - Number(current.t)) : 0;
  const playing = same && !current.paused && !current.ended && Number(current.t) > 0.5 && remaining > 2.5;
  if (!playing) {
    if (same) {
      await evaluate(ctx.cdp, 'try { var m = master(); m.currentTime = 0; m.play(); } catch (e) {}; true');
    } else {
      await evaluate(ctx.cdp, 'playNow(' + JSON.stringify(track) + '); true');
    }
  }
  return { tone, track, already: playing };
}

async function waitLocalPlaying(ctx, label) {
  const found = await waitFor(async () => {
    const state = await localPlaybackState(ctx);
    if (!state) return null;
    const err = localErrText(state);
    if (err) return { error: err };
    return state.src === 'lc' && !state.paused && !state.ended && Number(state.t) > 0.8 ? state : null;
  }, 15000, 250, label);
  if (found.error) throw new Error('ошибка воспроизведения: ' + found.error);
  return found;
}

// Если файл не играет — записываем код ответа сервера на его адрес (проверка cookie tapk, B7b).
// Значение метки не печатаем: только есть она или нет и какой код ответа.
async function localFileDiagnostics(ctx, track) {
  const url = ctx.base + '/lfile/' + encodeURIComponent(track.id);
  const parts = [];
  try {
    const plain = await httpRequest(url, { hostHeader: ctx.hostHeader, timeoutMs: 4000 });
    parts.push('адрес файла без метки tapk: код ' + plain.status);
  } catch (e) {
    parts.push('адрес файла: нет ответа');
  }
  try {
    const cookies = await ctx.cdp.send('Network.getCookies', { urls: [url] }, { timeoutMs: 3000 });
    const list = (cookies.result && cookies.result.cookies) || [];
    const tapk = list.find((c) => c && c.name === 'tapk');
    if (!tapk) {
      parts.push('метки tapk в cookie нет');
    } else {
      const withCookie = await httpRequest(url, {
        hostHeader: ctx.hostHeader,
        headers: { cookie: 'tapk=' + tapk.value, range: 'bytes=0-1' },
        timeoutMs: 4000,
      });
      parts.push('адрес файла с меткой tapk: код ' + withCookie.status);
    }
  } catch (e) {
    parts.push('cookie проверить не вышло');
  }
  return parts.join('; ');
}

async function scLocal(ctx) {
  const checks = [];
  const { tone, track } = await ensureLocalTrack(ctx);
  checks.push({
    name: 'папка и файл',
    ok: !!track,
    detail: 'создан music/' + LOCAL_WAV_NAME + ' (' + tone.bytes + ' байт, 4 с, 440 Гц, 16 бит, моно),'
      + ' папка добавлена через libAddFolder; трек в библиотеке: ' + (track ? 'да' : 'нет'),
  });
  if (!track) return checksToResult(checks);

  await evaluate(ctx.cdp, 'playNow(' + JSON.stringify(track) + '); true');
  let started = null;
  let failure = '';
  try {
    started = await waitLocalPlaying(ctx, 'локальный файл не заиграл');
  } catch (e) {
    failure = String((e && e.message) || e);
  }
  if (failure) {
    const diag = await localFileDiagnostics(ctx, track).catch(() => 'не проверить');
    checks.push({ name: 'играет', ok: false, detail: failure + '; ' + diag });
    return checksToResult(checks);
  }

  await sleep(1200);
  const grown = await localPlaybackState(ctx);
  const t0 = Number(started.t);
  const t1 = grown ? Number(grown.t) : NaN;
  const err = grown ? localErrText(grown) : '';
  let detail = 'время ' + t0.toFixed(1) + ' → ' + (Number.isFinite(t1) ? t1.toFixed(1) : '?') + ' с'
    + '; ошибок воспроизведения: ' + (err ? 'есть — ' + err : 'нет');
  if (err || !(Number.isFinite(t1) && t1 > t0 + 0.3)) {
    detail += '; ' + await localFileDiagnostics(ctx, track);
  }
  checks.push({
    name: 'играет',
    ok: Number.isFinite(t1) && t1 > t0 + 0.3 && !err,
    detail,
  });
  return checksToResult(checks);
}

const VIZ_STATE_EXPR = '(() => { var v = document.getElementById(\'viz\'); var c = document.getElementById(\'vizCv\');'
  + ' var r = v ? v.getBoundingClientRect() : { width: 0, height: 0 };'
  + ' return { visible: !!v && !v.hidden && r.width > 0 && r.height > 0,'
  + ' w: c ? c.width : 0, h: c ? c.height : 0,'
  + ' calm: document.body.classList.contains(\'calm\'), focus: document.hasFocus(),'
  + ' on: (typeof VZ !== \'undefined\') && VZ.on === true,'
  + ' bars: (typeof VZ !== \'undefined\' && VZ.bars) ? VZ.bars.length : 0,'
  + ' raf: (typeof VZ !== \'undefined\') ? VZ.raf : 0,'
  + ' cap: (typeof VZ !== \'undefined\') && !!VZ.cap,'
  + ' capFailed: (typeof VZ !== \'undefined\') && VZ.capFailed === true,'
  + ' playing: (typeof vizPlaying === \'function\') ? vizPlaying() : false }; })()';

const VIZ_SHOT_EXPR = '(() => { var c = document.getElementById(\'vizCv\');'
  + ' if (!c || !c.width || !c.height) return { w: 0, h: 0, sum: 0 };'
  + ' var g = c.getContext(\'2d\'); if (!g) return { w: 0, h: 0, sum: 0 };'
  + ' var d = g.getImageData(0, 0, c.width, c.height).data, s = 0;'
  + ' for (var i = 0; i < d.length; i += 97) s = (s + d[i] * ((i % 7) + 1)) % 1000003;'
  + ' return { w: c.width, h: c.height, sum: s }; })()';

async function vizState(ctx) {
  const result = await safeEval(ctx.cdp, VIZ_STATE_EXPR);
  return result.ok ? result.value : null;
}

async function scViz(ctx) {
  const checks = [];
  try {
    await ensureLocalPlaying(ctx);
  } catch (e) {
    return { skip: 'локальный файл не заиграл — визуализатор проверять не на чем: ' + scrubPaths((e && e.message) || e) };
  }
  try {
    await waitLocalPlaying(ctx, 'локальный файл для визуализатора не заиграл');
  } catch (e) {
    return { skip: 'локальный файл не заиграл — визуализатор проверять не на чем: ' + scrubPaths((e && e.message) || e) };
  }
  // Окно в фоне (body.calm) по задумке не рисует — поднимаем его на передний план.
  try { await ctx.cdp.send('Page.bringToFront', {}, { timeoutMs: 3000 }); } catch (e) { /* не вышло — проверим calm */ }
  try {
    await waitFor(async () => {
      const state = await vizState(ctx);
      return state && !state.calm && state.focus ? state : null;
    }, 3000, 200, 'окно не вышло из энергосбережения');
  } catch (e) {
    return { skip: 'окно не получило фокус (body.calm) — визуализатор в фоне не рисует по задумке, живьём не проверить' };
  }
  // Отдельной кнопки визуализатора в окне нет: он сам включается, когда играет трек без картинки.
  // Вызываем ту же функцию окна, которую зовут события play/pause (17-viz.js: vizUpdate).
  await evaluate(ctx.cdp, 'try { vizUpdate(); } catch (e) {}; true');
  let shown = null;
  try {
    shown = await waitFor(async () => {
      const state = await vizState(ctx);
      return state && state.visible && state.on && state.w > 0 && state.h > 0 ? state : null;
    }, 5000, 200, 'визуализатор не показался в окне');
  } catch (e) {
    shown = null;
  }

  let first = null;
  let second = null;
  if (shown) {
    first = await evaluate(ctx.cdp, VIZ_SHOT_EXPR);
    try {
      second = await waitFor(async () => {
        const shot = await safeEval(ctx.cdp, VIZ_SHOT_EXPR);
        if (!shot.ok || !shot.value) return null;
        return shot.value.sum !== first.sum ? shot.value : null;
      }, 2500, 200, 'кадр визуализатора не изменился за 2 с');
    } catch (e) {
      second = null;
    }
  }
  const verdict = vizFrameVerdict({
    visible: !!shown,
    canvasWidth: shown ? shown.w : 0,
    canvasHeight: shown ? shown.h : 0,
    changed: !!second,
    capture: !!(shown && shown.cap),
    captureFailed: !!(shown && shown.capFailed),
  });
  checks.push({
    name: 'визуализатор',
    ok: verdict.ok,
    detail: verdict.reason + (shown ? '; столбиков: ' + (shown.bars || '?') : '')
      + (verdict.ok ? '' : '; сдвиг кадра: ' + (first ? first.sum : '?') + ' → ' + (second ? second.sum : '?'))
      + ' (сам включается, отдельной кнопки нет)',
  });

  // «Выключить»: пауза останавливает рисование, vizRelease отпускает захват звука окна.
  await evaluate(ctx.cdp, 'try { master().pause(); } catch (e) {}; true');
  let stopped = null;
  try {
    stopped = await waitFor(async () => {
      const state = await vizState(ctx);
      if (!state) return null;
      return (!state.raf && !state.playing) ? state : null;
    }, 6000, 250, 'пауза не остановила рисование визуализатора');
  } catch (e) {
    stopped = null;
  }
  await evaluate(ctx.cdp, 'try { vizRelease(); } catch (e) {}; true');
  const released = await safeEval(ctx.cdp, "({ cap: !!(typeof VZ !== 'undefined' && VZ.cap), raf: (typeof VZ !== 'undefined') ? VZ.raf : 0 })");
  checks.push({
    name: 'выключен',
    ok: !!stopped && released.ok && released.value.cap === false,
    detail: 'после паузы рисование остановлено: ' + (stopped ? 'да' : 'нет')
      + '; захват звука окна отпущен: ' + (released.ok ? (released.value.cap ? 'нет' : 'да') : '?')
      + ' (окно визуализатора остаётся, пока загружен трек, — это его обычное поведение)',
  });
  return checksToResult(checks);
}

const VFS_STATE_EXPR = '(() => { var box = document.getElementById(\'vidBox\');'
  + ' return { vfs: !!(box && box.classList.contains(\'vfs\')),'
  + ' body: document.body.classList.contains(\'vfs-mode\'),'
  + ' dom: document.fullscreenElement ? (document.fullscreenElement.id || \'да\') : \'\' }; })()';

async function vfsState(ctx) {
  const result = await safeEval(ctx.cdp, VFS_STATE_EXPR);
  return result.ok ? result.value : null;
}

// Выход из режима в любом случае: сначала своим путём окна, потом — прямо через главный процесс.
async function exitFullscreen(ctx) {
  if (!ctx.cdp || ctx.cdp.closed) return;
  await safeEval(ctx.cdp, '(function(){ try { if (typeof vfsOn === \'function\' && vfsOn()) vfsSet(false); }'
    + ' catch (e) {} try { if (document.fullscreenElement) document.exitFullscreen(); }'
    + ' catch (e) {} return true; })()', { timeoutMs: 3000 });
  await safeEval(ctx.cdp, 'window.app.winFullscreen(false)', { timeoutMs: 4000 });
  await sleep(400);
}

async function scFullscreen(ctx) {
  try {
    return await scFullscreenInner(ctx);
  } finally {
    await exitFullscreen(ctx);
  }
}

async function scFullscreenInner(ctx) {
  const checks = [];
  const before = await vfsState(ctx);
  if (before && (before.vfs || before.dom)) await exitFullscreen(ctx);

  await evaluate(ctx.cdp, "document.getElementById('vidFs').click(); true");
  let on = null;
  try {
    on = await waitFor(async () => {
      const state = await vfsState(ctx);
      return state && (state.vfs || state.dom) ? state : null;
    }, 5000, 200, 'режим «на весь экран» не включился');
  } catch (e) {
    on = null;
  }
  checks.push({
    name: 'включение',
    ok: !!(on && on.vfs && on.body),
    detail: on
      ? 'класс vfs: ' + (on.vfs ? 'да' : 'нет') + '; body.vfs-mode: ' + (on.body ? 'да' : 'нет')
        + (on.dom ? '; полноэкранный элемент: ' + on.dom : '')
      : 'режим не включился за 5 с',
  });
  if (!on || !on.vfs) return checksToResult(checks);

  // Обработчик Esc в 17-viz.js пропускает нажатия, когда цель — кнопка или поле ввода.
  // Кнопку мы нажали программно, но фокус на всякий случай снимаем.
  const focus = await safeEval(ctx.cdp, "({ tag: (document.activeElement && document.activeElement.tagName) || '' })");
  const focusTag = focus.ok ? String(focus.value.tag || '') : '';
  if (/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(focusTag)) {
    await safeEval(ctx.cdp, "try { document.activeElement.blur(); } catch (e) {}; true");
  }
  const escStarted = Date.now();
  await sendKey(ctx.cdp, 'Escape', 'Escape', 27);
  let off = null;
  try {
    off = await waitFor(async () => {
      const state = await vfsState(ctx);
      return state && !state.vfs && !state.body && !state.dom ? state : null;
    }, 5000, 200, 'Esc не снял режим «на весь экран»');
  } catch (e) {
    off = null;
  }
  checks.push({
    name: 'Esc',
    ok: !!off,
    detail: off
      ? 'режим снят за ' + formatDuration(Date.now() - escStarted) + '; фокус до Esc: ' + (focusTag.toLowerCase() || 'нет')
      : 'режим остался (фокус до Esc: ' + (focusTag.toLowerCase() || 'нет') + ')',
  });

  const alive = await safeEval(ctx.cdp, "({ ok: document.readyState === 'complete' && 2 + 2 === 4, title: !!document.getElementById('card-title') })");
  checks.push({
    name: 'окно',
    ok: !!(alive.ok && alive.value && alive.value.ok && alive.value.title),
    detail: alive.ok ? 'отвечает, разметка на месте' : 'окно не ответило',
  });
  return checksToResult(checks);
}

async function scQuit(ctx) {
  const startedAt = Date.now();
  await safeEval(ctx.cdp, "window.app.closeChoice({tray:false}); true", { timeoutMs: 4000 });
  let exited = await waitForExit(ctx.child, 15000);
  let forced = false;
  if (!exited) {
    console.log('Тапёр не вышел за 15 с — завершаю только свой процесс (порт отладки ' + ctx.opts.port + ')');
    killByDebugPort(ctx.opts.port);
    forced = true;
    await waitForExit(ctx.child, 5000);
  }
  const elapsedMs = Date.now() - startedAt;
  ctx.exit = { exited, forced, elapsedMs, verdict: exitVerdict(exited, forced) };
  return {
    status: exited ? 'passed' : 'failed',
    details: ['выход: ' + (exited ? 'штатный за ' + formatDuration(elapsedMs) : 'не вышел штатно — процесс завершён принудительно')],
  };
}

const IMPL = {
  start: scStart,
  server: scServer,
  queue: scQueue,
  pick: scPick,
  guards: scGuards,
  orders: scOrders,
  sbot: scSbot,
  debug: scDebug,
  ipc: scIpc,
  browser: scBrowser,
  youtube: scYoutube,
  soundcloud: scSoundcloud,
  local: scLocal,
  viz: scViz,
  fullscreen: scFullscreen,
  quit: scQuit,
};

function makeResult(id, status, details, startedAt) {
  return {
    id,
    label: SCENARIO_LABELS[id] || id,
    network: !!NETWORK_SCENARIOS[id],
    status,
    details: (details || []).map((line) => scrubPaths(line)),
    elapsedMs: Date.now() - startedAt,
  };
}

async function runScenario(id, ctx) {
  const startedAt = Date.now();
  const host = NETWORK_SCENARIOS[id];
  const skip = host ? networkSkip(id, ctx.network[host]) : null;
  if (skip) return makeResult(id, 'skipped', [skip], startedAt);
  try {
    const out = await IMPL[id](ctx);
    if (out && out.skip) return makeResult(id, 'skipped', [out.skip], startedAt);
    return makeResult(id, out.status, out.details, startedAt);
  } catch (e) {
    return makeResult(id, 'failed', ['ошибка проверки: ' + String((e && e.message) || e)], startedAt);
  }
}

function printResult(result) {
  const mark = result.status === 'passed' ? '✓' : result.status === 'skipped' ? '–' : '✗';
  console.log(mark + ' ' + result.id + ' (' + result.label + '): ' + statusText(result.status)
    + ' — ' + (result.details.join('; ') || '—'));
}

// ── запуск ─────────────────────────────────────────────────────────────────────────────────────
function electronVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8'));
    if (pkg && pkg.version) return String(pkg.version);
  } catch (e) { /* Electron ещё не установлен */ }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return String((pkg.devDependencies && pkg.devDependencies.electron) || '?');
  } catch (e) { return '?'; }
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim() || '?';
  } catch (e) { return '?'; }
}

function commandLine(opts) {
  const parts = ['node tools/reliability/live-smoke.mjs', '--data', '<папка внутри sandbox>'];
  if (opts.queue) parts.push('--queue', '<файл>');
  if (opts.only.length !== SCENARIOS.length) parts.push('--only', opts.only.join(','));
  parts.push('--port', String(opts.port), '--widget-port', String(opts.widgetPort));
  return parts.join(' ');
}

function relativeForPrint(file) {
  const rel = path.relative(ROOT, file);
  return rel && !rel.startsWith('..') ? rel : path.basename(file);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('Ошибка: ' + e.message);
    console.error('Справка: node tools/reliability/live-smoke.mjs --help');
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    console.log(helpText());
    return;
  }
  if (process.platform !== 'win32') {
    console.error('Ошибка: инструмент рассчитан на Windows');
    process.exitCode = 2;
    return;
  }

  const startedAt = new Date();
  let profile;
  try {
    profile = prepareProfile(opts, startedAt);
  } catch (e) {
    console.error('Ошибка профиля: ' + scrubPaths((e && e.message) || e));
    process.exitCode = 2;
    return;
  }

  let electron;
  try {
    electron = electronSpawn(opts.electron);
  } catch (e) {
    console.error('Ошибка: ' + e.message);
    process.exitCode = 2;
    return;
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  console.log('Запускаю Тапёр: ' + relativeForPrint(electron.cmd) + ' (профиль внутри sandbox)');
  const child = spawn(electron.cmd, ['.', '--remote-debugging-port=' + opts.port], {
    cwd: ROOT,
    env: { ...process.env, TAPYOR_USER_DATA: opts.data },
    stdio: 'ignore',
    windowsHide: false,
    shell: electron.shell,
  });
  let spawnError = null;
  child.once('error', (e) => { spawnError = e; });
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const ctx = {
    opts,
    dataDir: opts.data,
    child,
    cdp: null,
    pageTarget: null,
    serverPort: 0,
    base: '',
    hostHeader: '',
    queueTitles: profile.queueTitles,
    queueCurrent: profile.queueCurrent,
    consoleEntries: [],
    exceptionEntries: [],
    network: {},
    exit: null,
  };
  const results = [];
  let runError = null;

  try {
    await waitForPort(opts.port, child, () => spawnError);
    const page = await waitFor(async () => pickPage(await fetchTargets(opts.port)),
      30000, 500, 'окно программы не открылось');
    if (!page || !page.webSocketDebuggerUrl) throw new Error('в целях отладки нет окна программы');
    ctx.pageTarget = page;

    const cdp = new Cdp(page.webSocketDebuggerUrl, 'окно');
    await cdp.connect(5000);
    ctx.cdp = cdp;
    cdp.onEvent((message) => {
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || [])
          .map((arg) => String(arg && arg.value != null ? arg.value : (arg && arg.description) || ''))
          .join(' ');
        if (/content security policy|refused to/i.test(text)) ctx.consoleEntries.push(text);
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry || {};
        const text = String(entry.text || '');
        if (entry.source === 'security' || /content security policy|refused to/i.test(text)) {
          ctx.consoleEntries.push(text);
        }
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = (message.params && message.params.exceptionDetails) || {};
        const exception = details.exception || {};
        const text = exception.description || exception.value || details.text || 'неизвестная ошибка страницы';
        ctx.exceptionEntries.push(String(text));
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    const serverPort = await waitFor(async () => {
      const result = await safeEval(cdp, 'window.app.widgetUrl()');
      if (!result.ok || typeof result.value !== 'string' || !result.value) return null;
      try {
        const url = new URL(result.value);
        return url.port ? Number(url.port) : null;
      } catch (e) { return null; }
    }, 90000, 500, 'адрес локального сервера не появился');
    ctx.serverPort = serverPort;
    ctx.base = 'http://127.0.0.1:' + serverPort;
    ctx.hostHeader = '127.0.0.1:' + serverPort;
    await waitFor(async () => {
      try {
        const response = await httpRequest(ctx.base + '/widget', { hostHeader: ctx.hostHeader, timeoutMs: 3000 });
        return httpStatusVerdict(200, response).ok;
      } catch (e) { return false; }
    }, 30000, 500, '/widget не отвечает 200');
    // Мост window.app появляется раньше скрипта окна (ui.js): без этого ожидания первые сценарии
    // ловят «setTab is not defined» (живая проверка 13.11).
    await waitFor(async () => {
      const ready = await safeEval(cdp, "typeof setTab === 'function' && typeof ytxLoad === 'function' && typeof colOpenFor === 'function'");
      return ready.ok && ready.value === true;
    }, 30000, 300, 'скрипт окна (ui.js) не загрузился');

    ctx.network = {};
    if (opts.only.some((id) => !!NETWORK_SCENARIOS[id])) {
      ctx.network = await checkNetworks();
      console.log('Сеть: YouTube ' + (ctx.network['www.youtube.com'] ? 'есть' : 'нет')
        + ', SoundCloud ' + (ctx.network['api-v2.soundcloud.com'] ? 'есть' : 'нет')
        + ', Яндекс ' + (ctx.network['api.music.yandex.net'] ? 'есть' : 'нет'));
    }

    for (const id of opts.only) {
      if (id === 'quit') continue;
      const result = await runScenario(id, ctx);
      results.push(result);
      printResult(result);
    }
    // Ошибки страницы за прогон — отдельной строкой в конце. Снимаем список до выхода:
    // ошибки самого закрытия окна к делу не относятся.
    const pageErrors = pageErrorsVerdict(ctx.exceptionEntries.slice());
    if (opts.only.includes('quit')) {
      const result = await runScenario('quit', ctx);
      results.push(result);
      printResult(result);
    }
    const pageResult = makeResult('pageerrors', pageErrors.ok ? 'passed' : 'failed', pageErrors.details, Date.now());
    results.push(pageResult);
    printResult(pageResult);
  } catch (e) {
    runError = e;
    console.error('Ошибка проверки: ' + scrubPaths((e && e.message) || e));
  } finally {
    if (!ctx.exit && spawnError) {
      ctx.exit = {
        exited: false,
        forced: false,
        elapsedMs: 0,
        verdict: { ok: false, reason: 'программа не запустилась: ' + scrubPaths(spawnError.message) },
      };
    }
    if (!ctx.exit) {
      const startedExit = Date.now();
      if (ctx.cdp && !ctx.cdp.closed) {
        await safeEval(ctx.cdp, 'window.app.closeChoice({tray:false}); true', { timeoutMs: 4000 });
      }
      let exited = await waitForExit(child, 15000);
      let forced = false;
      if (!exited) {
        console.log('Тапёр не вышел за 15 с — завершаю только свой процесс (порт отладки ' + opts.port + ')');
        killByDebugPort(opts.port);
        forced = true;
        await waitForExit(child, 5000);
      }
      ctx.exit = { exited, forced, elapsedMs: Date.now() - startedExit, verdict: exitVerdict(exited, forced) };
    }
    if (ctx.cdp) ctx.cdp.close();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  const meta = {
    startedAt: startedAt.toLocaleString('ru-RU'),
    elapsedMs: Date.now() - startedAt.getTime(),
    electronVersion: electronVersion(),
    commit: gitCommit(),
    command: commandLine(opts),
    exit: ctx.exit,
    error: runError ? String((runError && runError.message) || runError) : '',
  };
  const report = formatReport(meta, results);
  try {
    fs.writeFileSync(opts.out, report, 'utf8');
    console.log('Отчёт: ' + relativeForPrint(opts.out));
  } catch (e) {
    console.error('Не удалось записать отчёт: ' + scrubPaths((e && e.message) || e));
    process.exitCode = 1;
  }
  const failed = results.some((r) => r.status === 'failed');
  const exitBad = !!ctx.exit && (ctx.exit.forced || !ctx.exit.exited);
  if (runError || failed || exitBad) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Ошибка: ' + (e && e.stack || e));
  process.exitCode = 1;
});
