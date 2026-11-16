// Инструмент «4 часа»: запускает Тапёр из текущей папки, раз в минуту снимает
// память и ЦП каждого процесса, кучу окна и DOM, а в конце печатает вердикт.
//
// Запуск: node tools/reliability/long-run.mjs --data <папка внутри sandbox> --minutes 5
// Долгий прогон: npm run reliability:long -- --data <папка внутри sandbox>
//
// Сам инструмент окно не открывает в тестах: unit-тесты проверяют только чистые
// помощники из long-run-lib.mjs, --help и отказ без --data.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  FILE_NAMES, parseArgs, helpText, defaultSettings,
  parseTargets, pickPage, evalValue, parseProcesses, buildProcessTree,
  classifyRole, cpuPercents, buildVerdict, formatVerdict,
} from './long-run-lib.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_EXPR = "(() => ({ heap: (typeof performance !== 'undefined' && performance.memory) ? performance.memory.usedJSHeapSize : null, nodes: document.getElementsByTagName('*').length }))()";

let stopping = false;
let wakeSleep = null;

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wakeSleep = null;
      resolve();
    }
    wakeSleep = done;
  });
}

function wake() {
  const fn = wakeSleep;
  if (fn) fn();
}

function onSignal() {
  if (stopping) return;
  stopping = true;
  console.log('\nОстановка по Ctrl+C: заканчиваю замер и закрываю Тапёр…');
  wake();
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
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    if (stopping) throw new Error('остановлено до открытия порта отладки');
    const spawnError = getError();
    if (spawnError) throw new Error('не удалось запустить Electron: ' + spawnError.message);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Тапёр завершился до открытия порта отладки (код ' + (child.exitCode ?? child.signalCode) + ')');
    }
    try {
      return await fetchTargets(port);
    } catch (e) {
      last = e;
    }
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

function killTree(pid) {
  if (!Number.isFinite(Number(pid))) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } catch (e) { /* уже завершился */ }
  } else {
    try { process.kill(Number(pid), 'SIGKILL'); } catch (e) { /* уже завершился */ }
  }
}

function electronSpawn(root) {
  const win = process.platform === 'win32';
  const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron');
  if (fs.existsSync(exe)) return { cmd: exe, shell: false };
  const bin = path.join(root, 'node_modules', '.bin', win ? 'electron.cmd' : 'electron');
  if (fs.existsSync(bin)) return { cmd: bin, shell: win };
  throw new Error('не найден Electron в node_modules (выполните npm ci)');
}

function prepareProfile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'settings.json');
  if (fs.existsSync(file)) {
    console.log('settings.json: уже есть, не меняю');
    return;
  }
  fs.writeFileSync(file, JSON.stringify(defaultSettings(), null, 2) + '\n', 'utf8');
  console.log('settings.json: создан');
}

async function readProcessTree(rootPid) {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}',
    '$gp = @{}',
    'Get-Process | ForEach-Object { $gp[[string]$_.Id] = $_ }',
    '$rows = foreach ($w in Get-CimInstance Win32_Process) {',
    '  $p = $gp[[string]$w.ProcessId]',
    '  $mem = 0',
    '  $cpu = 0.0',
    '  if ($p) {',
    '    $mem = [long]$p.WorkingSet64',
    '    try { $cpu = [double]$p.TotalProcessorTime.TotalSeconds } catch { $cpu = 0.0 }',
    '  }',
    '  [pscustomobject]@{',
    '    pid = [int]$w.ProcessId',
    '    parentPid = [int]$w.ParentProcessId',
    '    name = [string]$w.Name',
    '    cmd = [string]$w.CommandLine',
    '    memory = [long]$mem',
    '    cpuSec = [double]$cpu',
    '  }',
    '}',
    "Write-Output 'LONGRUN_JSON_BEGIN'",
    'ConvertTo-Json -InputObject @($rows) -Compress -Depth 3',
    "Write-Output 'LONGRUN_JSON_END'",
  ].join('\n');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', script,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const all = parseProcesses(stdout);
  return buildProcessTree(all, rootPid).map((p) => ({ ...p, role: classifyRole(p, rootPid) }));
}

function fileSizes(dataDir) {
  const out = {};
  for (const name of FILE_NAMES) {
    try { out[name] = fs.statSync(path.join(dataDir, name)).size; }
    catch (e) { out[name] = null; }
  }
  return out;
}

function cdpEvaluate(wsUrl, expression, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') {
      reject(new Error('нет глобального WebSocket (нужен Node 22+)'));
      return;
    }
    let done = false;
    let timer = null;
    let ws = null;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try { if (ws) ws.close(); } catch (e) { /* уже закрыт */ }
      if (error) reject(error);
      else resolve(value);
    };
    timer = setTimeout(() => finish(new Error('CDP не ответил за ' + timeoutMs + ' мс')), timeoutMs);
    try { ws = new WebSocket(wsUrl); }
    catch (e) { finish(e); return; }
    ws.addEventListener('open', () => {
      try {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
        }));
      } catch (e) { finish(e); }
    });
    ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch (e) { return; }
      if (!message || message.id !== 1) return;
      try { finish(null, evalValue(message)); } catch (e) { finish(e); }
    });
    ws.addEventListener('error', () => finish(new Error('WebSocket CDP: ошибка соединения')));
    ws.addEventListener('close', () => { if (!done) finish(new Error('WebSocket CDP закрылся до ответа')); });
  });
}

function formatMb(value) {
  return Number.isFinite(value) ? (value / 1048576).toFixed(0) + ' МБ' : '?';
}

function formatPercent(value) {
  return Number.isFinite(value) ? value.toFixed(1) + ' %' : '?';
}

function printSample(sample) {
  const procs = Array.isArray(sample.processes) ? sample.processes : [];
  let memory = 0;
  let cpu = 0;
  let cpuSeen = false;
  for (const p of procs) {
    if (Number.isFinite(p.memoryBytes)) memory += p.memoryBytes;
    if (Number.isFinite(p.cpuPct)) { cpu += p.cpuPct; cpuSeen = true; }
  }
  console.log('[' + (sample.elapsedSec / 60).toFixed(1) + ' мин]'
    + ' процессов ' + procs.length
    + ' · память ' + (procs.length ? formatMb(memory) : '?')
    + ' · ЦП ' + (cpuSeen ? formatPercent(cpu) : '?')
    + ' · куча ' + formatMb(sample.heapUsedBytes)
    + ' · DOM ' + (Number.isFinite(sample.domNodes) ? sample.domNodes : '?')
    + ' · целей ' + (Number.isFinite(sample.targets) ? sample.targets : '?'));
}

async function shutdown(child, port) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  console.log('Закрываю Тапёр штатно…');
  let page = null;
  try { page = pickPage(await fetchTargets(port, 2000)); }
  catch (e) { /* окно уже могло закрыться */ }
  if (page && page.webSocketDebuggerUrl) {
    try {
      await cdpEvaluate(page.webSocketDebuggerUrl, 'window.app.closeChoice({tray:false})', 5000);
    } catch (e) {
      console.log('Штатное закрытие не ответило: ' + e.message);
    }
  }
  if (await waitForExit(child, 15000)) return;
  console.log('За 15 с не закрылся — завершаю дерево процессов');
  killTree(child.pid);
  await waitForExit(child, 3000);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('Ошибка: ' + e.message);
    console.error('Справка: node tools/reliability/long-run.mjs --help');
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    console.log(helpText());
    return;
  }
  if (process.platform !== 'win32') {
    console.error('Ошибка: инструмент рассчитан на Windows (PowerShell)');
    process.exitCode = 2;
    return;
  }

  prepareProfile(opts.data);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, '', 'utf8');

  const { cmd, shell } = electronSpawn(ROOT);
  console.log('Запускаю Тапёр: ' + path.relative(ROOT, cmd));
  const child = spawn(cmd, ['.', '--remote-debugging-port=' + opts.port], {
    cwd: ROOT,
    env: { ...process.env, TAPYOR_USER_DATA: opts.data },
    stdio: 'ignore',
    windowsHide: false,
    shell,
  });
  let spawnError = null;
  child.once('error', (e) => { spawnError = e; });
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const startedAt = Date.now();
  let prevCpu = new Map();
  let prevAtMs = null;
  const samples = [];
  let runError = null;

  const takeSample = async () => {
    const atMs = Date.now();
    let processes = [];
    let processesError = null;
    try {
      processes = await readProcessTree(child.pid);
      if (!processes.length) processesError = 'процессы программы не найдены';
    } catch (e) {
      processesError = String(e.message || e).slice(0, 300);
    }
    const dt = prevAtMs === null ? 0 : (atMs - prevAtMs) / 1000;
    const cpuTree = cpuPercents(processes, prevCpu, dt);
    processes = cpuTree.tree;
    if (!processesError) { prevCpu = cpuTree.current; prevAtMs = atMs; }

    let targets = null;
    let page = null;
    let listError = null;
    try {
      const list = await fetchTargets(opts.port);
      targets = list.length;
      page = pickPage(list);
    } catch (e) {
      listError = String(e.message || e).slice(0, 300);
    }

    let heapUsedBytes = null;
    let domNodes = null;
    let cdpError = null;
    if (page && page.webSocketDebuggerUrl) {
      try {
        const value = await cdpEvaluate(page.webSocketDebuggerUrl, SAMPLE_EXPR, 5000);
        if (value && typeof value === 'object') {
          if (Number.isFinite(value.heap)) heapUsedBytes = value.heap;
          if (Number.isFinite(value.nodes)) domNodes = value.nodes;
        }
      } catch (e) {
        cdpError = String(e.message || e).slice(0, 300);
      }
    } else if (targets !== null) {
      cdpError = 'в /json/list нет окна программы';
    }

    const sample = {
      time: new Date(atMs).toISOString(),
      elapsedSec: Number(((atMs - startedAt) / 1000).toFixed(3)),
      targets,
      processes,
      heapUsedBytes,
      domNodes,
      files: fileSizes(opts.data),
    };
    if (processesError) sample.processesError = processesError;
    if (listError) sample.listError = listError;
    if (cdpError) sample.cdpError = cdpError;
    fs.appendFileSync(opts.out, JSON.stringify(sample) + '\n', 'utf8');
    samples.push(sample);
    printSample(sample);
    return sample;
  };

  try {
    await waitForPort(opts.port, child, () => spawnError);
    const endAt = Date.now() + opts.minutes * 60000;
    while (true) {
      await takeSample();
      if (stopping || Date.now() >= endAt) break;
      await sleep(Math.min(60000, endAt - Date.now()));
    }
  } catch (e) {
    runError = e;
    console.error('Ошибка замера: ' + (e.message || e));
  } finally {
    await shutdown(child, opts.port);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (samples.length) console.log('\n' + formatVerdict(buildVerdict(samples)));
    else console.log('Замеров нет — вердикт не построен.');
    if (runError) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Ошибка: ' + (e && e.stack || e));
  process.exitCode = 1;
});
