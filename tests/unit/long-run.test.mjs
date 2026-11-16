// Инструмент «4 часа»: чистые помощники для замера памяти, ЦП, кучи и DOM.
// Зачем тест: тренд и вердикт решают «течёт / не течёт», а папку данных
// инструмент обязан принимать только внутри sandbox — иначе можно случайно
// запустить Тапёр на настоящем профиле владельца.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MINUTES, DEFAULT_PORT, DEFAULT_SETTINGS, ROLE_LABELS,
  defaultSettings, checkDataDir, parseArgs, helpText,
  parseTargets, pickPage, evalValue, parseProcesses,
  buildProcessTree, classifyRole, cpuPercents,
  secondHalf, linearTrend, buildVerdict, formatMetric, formatVerdict,
} from '../../tools/reliability/long-run-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SANDBOX = path.join(os.tmpdir(), 'sandbox', 'tapyor-longrun-test');

test('long-run: папка данных обязана лежать внутри sandbox', () => {
  assert.equal(checkDataDir(SANDBOX), path.resolve(SANDBOX));
  assert.equal(checkDataDir(path.join(os.tmpdir(), 'SandBox', 'x')), path.resolve(os.tmpdir(), 'SandBox', 'x'));
  for (const bad of ['', '   ', path.join(os.tmpdir(), 'tapyor-longrun-test'),
    path.join(os.tmpdir(), 'sandbox2', 'data'), path.join(os.tmpdir(), 'не-sandbox', 'data')]) {
    assert.throws(() => checkDataDir(bad), /sandbox/, JSON.stringify(bad)); // export-scan:allow — слово «sandbox» здесь условие инструмента, не путь
  }
});

test('long-run: параметры по умолчанию и разбор --minutes/--data/--port/--out', () => {
  const base = parseArgs(['--data', SANDBOX], ROOT);
  assert.equal(base.minutes, DEFAULT_MINUTES);
  assert.equal(base.port, DEFAULT_PORT);
  assert.equal(base.data, path.resolve(SANDBOX));
  assert.equal(base.out, path.resolve(ROOT, 'tools/reliability/long-run-result.jsonl'));
  assert.equal(base.help, false);

  const out = path.join(os.tmpdir(), 'run.jsonl');
  const o = parseArgs(['--minutes', '5', '--data', SANDBOX, '--port', '9336', '--out', out], ROOT);
  assert.equal(o.minutes, 5);
  assert.equal(o.port, 9336);
  assert.equal(o.out, out);
  assert.equal(parseArgs(['--minutes=7', '--data', SANDBOX], ROOT).minutes, 7);
});

test('long-run: --help не требует --data, а ошибки параметров понятны', () => {
  const h = parseArgs(['--help'], ROOT);
  assert.equal(h.help, true);
  assert.equal(h.data, null);
  assert.match(helpText(), /--minutes/);
  assert.match(helpText(), /--data/);
  assert.match(helpText(), /--port/);
  assert.match(helpText(), /--out/);

  assert.throws(() => parseArgs([], ROOT), /--data/);
  assert.throws(() => parseArgs(['--data', path.join(os.tmpdir(), 'без-песочницы')], ROOT), /sandbox/); // export-scan:allow — слово «sandbox» здесь условие инструмента, не путь
  assert.throws(() => parseArgs(['--data', SANDBOX, '--minutes', '0'], ROOT), /--minutes/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--minutes', 'abc'], ROOT), /--minutes/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--port', '0'], ROOT), /--port/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--port', '70000'], ROOT), /--port/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--port', '1.5'], ROOT), /--port/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--чего-то'], ROOT), /Неизвестный параметр/);
  assert.throws(() => parseArgs(['--data'], ROOT), /значение/);
});

test('long-run: настройки для нового профиля', () => {
  assert.deepEqual(defaultSettings(), {
    reportsEnabled: false,
    autoUpdate: false,
    streamerMode: false,
    closeAsked: true,
    closeToTray: false,
    widgetPort: 47997,
  });
  assert.deepEqual(DEFAULT_SETTINGS, defaultSettings());
});

test('long-run: разбор /json/list и выбор окна программы', () => {
  const list = [
    { type: 'page', title: 'Панель OBS', url: 'http://127.0.0.1:47997/widget', webSocketDebuggerUrl: 'ws://a' },
    { type: 'page', title: 'Тапёр', url: 'http://127.0.0.1:47997/index.html', webSocketDebuggerUrl: 'ws://b' },
    { type: 'service_worker', url: 'file:///sw.js' },
  ];
  const targets = parseTargets(JSON.stringify(list));
  assert.equal(targets.length, 3);
  assert.equal(pickPage(targets).webSocketDebuggerUrl, 'ws://b');
  assert.equal(pickPage([list[0]]).webSocketDebuggerUrl, 'ws://a');
  assert.equal(pickPage([list[2]]), null);
  assert.deepEqual(parseTargets('не json'), []);
  assert.deepEqual(parseTargets('null'), []);
});

test('long-run: ответ CDP и разбор процессов PowerShell', () => {
  assert.deepEqual(evalValue({ result: { result: { value: { heap: 1, nodes: 2 } } } }), { heap: 1, nodes: 2 });
  assert.throws(() => evalValue({ error: { message: 'нет цели' } }), /нет цели/);
  assert.throws(() => evalValue({ result: { exceptionDetails: { text: 'boom' } } }), /boom/);

  const raw = [
    'LONGRUN_JSON_BEGIN',
    '[{"pid":10,"parentPid":1,"name":"electron.exe","cmd":". --remote-debugging-port=9335",',
    '"memory":123456,"cpuSec":4.5},',
    '{"ProcessId":11,"ParentProcessId":10,"Name":"electron.exe","CommandLine":"--type=renderer",',
    '"WorkingSet64":2222,"CpuSec":"1.25"},',
    '{"pid":"плохой"}]',
    'LONGRUN_JSON_END',
  ].join('\n');
  const procs = parseProcesses(raw);
  assert.equal(procs.length, 2);
  assert.deepEqual(procs[0], {
    pid: 10, parentPid: 1, name: 'electron.exe',
    commandLine: '. --remote-debugging-port=9335', memoryBytes: 123456, cpuSec: 4.5,
  });
  assert.equal(procs[1].pid, 11);
  assert.equal(procs[1].memoryBytes, 2222);
  assert.equal(procs[1].cpuSec, 1.25);
  assert.deepEqual(parseProcesses('<ошибка>'), []);
  assert.deepEqual(parseProcesses(''), []);
});

test('long-run: дерево процессов и роли главный/окно/GPU/утилиты', () => {
  const all = [
    { pid: 100, parentPid: 1, name: 'cmd.exe', commandLine: 'electron.cmd .', memoryBytes: 1, cpuSec: 0 },
    { pid: 101, parentPid: 100, name: 'electron.exe', commandLine: '. --remote-debugging-port=9335', memoryBytes: 10, cpuSec: 1 },
    { pid: 102, parentPid: 101, name: 'electron.exe', commandLine: '--type=renderer', memoryBytes: 20, cpuSec: 2 },
    { pid: 103, parentPid: 101, name: 'electron.exe', commandLine: '--type=gpu-process', memoryBytes: 30, cpuSec: 3 },
    { pid: 104, parentPid: 101, name: 'electron.exe', commandLine: '--type=utility --utility-sub-type=audio', memoryBytes: 40, cpuSec: 4 },
    { pid: 999, parentPid: 1, name: 'чужой.exe', commandLine: '', memoryBytes: 50, cpuSec: 5 },
  ];
  const tree = buildProcessTree(all, 100);
  assert.deepEqual(tree.map((p) => p.pid), [100, 101, 102, 103, 104]);
  assert.equal(classifyRole(tree[0], 100), 'other');
  assert.equal(classifyRole(tree[1], 100), 'main');
  assert.equal(classifyRole(tree[2], 100), 'window');
  assert.equal(classifyRole(tree[3], 100), 'gpu');
  assert.equal(classifyRole(tree[4], 100), 'utility');
  assert.deepEqual(buildProcessTree(all, 777), []);
  assert.equal(ROLE_LABELS.window, 'окно');
});

test('long-run: ЦП процесса считается по приросту между замерами', () => {
  const prev = new Map([[100, 10]]);
  const { tree, current } = cpuPercents([
    { pid: 100, cpuSec: 16 }, { pid: 101, cpuSec: 2 },
  ], prev, 60);
  assert.equal(tree[0].cpuPct, 10);
  assert.equal(tree[1].cpuPct, null);
  assert.equal(current.get(100), 16);
  assert.equal(current.get(101), 2);
  assert.equal(cpuPercents([{ pid: 100, cpuSec: 16 }], prev, 0).tree[0].cpuPct, null);
  assert.equal(cpuPercents([{ pid: 100, cpuSec: 5 }], prev, 60).tree[0].cpuPct, null);
});

test('long-run: линейный тренд и порог 10 % от среднего', () => {
  const flat = linearTrend([{ x: 0, y: 100 }, { x: 3600, y: 100 }]);
  assert.equal(flat.enough, true);
  assert.equal(flat.growthPerHour, 0);
  assert.equal(flat.growing, false);

  // 10 единиц за час при среднем 105 — ровно на границе, «не растёт» (нужно больше 10 %).
  const edge = linearTrend([{ x: 0, y: 100 }, { x: 3600, y: 110 }]);
  assert.ok(Math.abs(edge.growthPerHour - 10) < 1e-9);
  assert.equal(edge.growing, false);

  const grow = linearTrend([{ x: 0, y: 100 }, { x: 3600, y: 111 }]);
  assert.ok(grow.growthPerHour > 10);
  assert.equal(grow.growing, true);

  assert.equal(linearTrend([{ x: 0, y: 1 }]).enough, false);
  assert.equal(linearTrend([{ x: 5, y: 1 }, { x: 5, y: 2 }]).enough, false);
  assert.equal(linearTrend([{ x: 0, y: NaN }, { x: 60, y: 2 }]).enough, false);
});

test('long-run: вторая половина прогона — только поздние точки', () => {
  const samples = [0, 10, 20, 30, 40].map((elapsedSec) => ({ elapsedSec }));
  assert.deepEqual(secondHalf(samples).map((s) => s.elapsedSec), [20, 30, 40]);
  assert.deepEqual(secondHalf([]), []);
});

function sampleAt(elapsedSec, memoryBytes, extra = {}) {
  return {
    time: new Date(1700000000000 + elapsedSec * 1000).toISOString(),
    elapsedSec,
    targets: 2,
    processes: [
      { pid: 100, role: 'main', memoryBytes, cpuPct: 2 },
      { pid: 101, role: 'window', memoryBytes: memoryBytes / 2, cpuPct: 3 },
    ],
    heapUsedBytes: extra.heap ?? 50_000_000,
    domNodes: extra.dom ?? 10_000,
    files: { 'log.txt': extra.log ?? 1000, 'settings.json': 2000, 'today.json': null },
  };
}

test('long-run: вердикт «растёт» по памяти и «не растёт» по ровной куче', () => {
  const times = [0, 1800, 3600, 5400, 7200];
  const growing = buildVerdict(times.map((t, i) => sampleAt(t, 100_000_000 + i * 10_000_000)));
  const mem = growing.metrics.find((m) => m.key === 'memory_total');
  assert.ok(mem);
  assert.equal(mem.growing, true);
  assert.match(formatMetric(mem), /растёт/);
  assert.doesNotMatch(formatMetric(mem), /не растёт/);
  assert.match(formatVerdict(growing), /Растут:/);

  const flat = buildVerdict(times.map((t) => sampleAt(t, 100_000_000)));
  const memFlat = flat.metrics.find((m) => m.key === 'memory_total');
  assert.equal(memFlat.growing, false);
  assert.match(formatMetric(memFlat), /не растёт/);
  assert.match(formatVerdict(flat), /Ни один показатель не растёт/);
});

test('long-run: вердикт не падает на пустых и коротких данных', () => {
  const empty = buildVerdict([]);
  assert.equal(empty.samples, 0);
  assert.equal(empty.secondHalf, 0);
  assert.ok(Array.isArray(empty.metrics));
  const one = buildVerdict([sampleAt(0, 100_000_000)]);
  const mem = one.metrics.find((m) => m.key === 'memory_total');
  assert.equal(mem.enough, false);
  assert.match(formatMetric(mem), /мало данных/);
  assert.match(formatVerdict(one), /мало данных/);
});

test('long-run: --help и отказ без --data не запускают программу', () => {
  const help = spawnSync(process.execPath, ['tools/reliability/long-run.mjs', '--help'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /--data/);

  const noData = spawnSync(process.execPath, ['tools/reliability/long-run.mjs'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(noData.status, 2, noData.stderr || noData.stdout);
  assert.match(noData.stderr, /--data/);

  const noSandbox = spawnSync(process.execPath, [
    'tools/reliability/long-run.mjs', '--data', path.join(os.tmpdir(), 'tapyor-longrun-test'),
  ], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(noSandbox.status, 2, noSandbox.stderr || noSandbox.stdout);
  assert.match(noSandbox.stderr, /sandbox/); // export-scan:allow — слово «sandbox» здесь условие инструмента, не путь
});
