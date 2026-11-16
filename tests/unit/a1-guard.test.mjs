// Страж STAB-GD1: механический разнос src/main.js по src/main/*.js.
// Проверяет четыре типичные ошибки переноса и сам проверен на «плохих» примерах:
//   1) пропали/появились каналы IPC или подписки app.on / powerMonitor.on;
//   2) появился цикл require (в том числе src/main/*.js → ../main.js);
//   3) модуль берёт из ctx больше, чем ему передали в setup({ … });
//   4) изменяемое значение (let/var) передали значением, а не функцией-доступа.
// Разбор — espree + eslint-scope; снимок каналов — tests/unit/a1-guard/ipc-snapshot.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readChannelEntries,
  collectIpcChannels,
  diffChannels,
  formatChannelDiff,
  walkJsEntries,
  collectRequireGraph,
  collectCtxUsage,
  collectSetupCalls,
  checkCtxCoverage,
  findMutableByValueIssues,
} from './a1-guard/guard-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOT = path.join(ROOT, 'tests', 'unit', 'a1-guard', 'ipc-snapshot.json');
const MAIN_ENTRY = { path: 'src/main.js', source: fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8') };
const MODULE_PATHS = fs.readdirSync(path.join(ROOT, 'src', 'main'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => 'src/main/' + name)
  .sort();
const MODULE_ENTRIES = MODULE_PATHS.map((p) => ({ path: p, source: fs.readFileSync(path.join(ROOT, p), 'utf8') }));

function message(lines) {
  return lines.join('\n');
}

// ---- 1. Каналы IPC и подписки ------------------------------------------------

test('A1-страж: каналы IPC и подписки совпадают со снимком', () => {
  const { channels, dynamic } = collectIpcChannels(readChannelEntries(ROOT));
  assert.deepEqual(dynamic, [], 'есть каналы с нестроковым именем — страж не может их проверить:\n'
    + message(dynamic.map((d) => d.file + ':' + d.line + ' — ' + d.kind + ' (' + d.reason + ')')));
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const diffs = diffChannels(channels, snapshot);
  assert.equal(diffs.length, 0, 'Каналы IPC и подписки разошлись со снимком:\n'
    + formatChannelDiff(diffs)
    + '\nЕсли изменение намеренное — обнови снимок: node tests/unit/a1-guard/make-snapshot.mjs');
});

test('A1-страж: проверка каналов ловит пропажу, появление и смену числа повторов', () => {
  const entries = [{
    path: 'src/main/bad.js',
    source: [
      "ipcMain.handle('keep', () => 1);",
      "ipcMain.handle('new-channel', () => 2);",
      "ipcMain.on('dup', () => 1);",
      "ipcMain.on('dup', () => 2);",
      "app.on('ready', () => 1);",
      "powerMonitor.on('resume', () => 1);",
    ].join('\n'),
  }];
  const { channels, dynamic } = collectIpcChannels(entries);
  const expected = {
    'ipcMain.handle': { keep: 1, gone: 1 },
    'ipcMain.on': { dup: 1 },
    'app.on': { ready: 1 },
    'powerMonitor.on': { resume: 1 },
  };
  const diffs = diffChannels(channels, expected);
  assert.equal(dynamic.length, 0, 'плохой пример не должен содержать динамических имён');
  assert.ok(diffs.some((d) => d.type === 'missing' && d.name === 'gone'), 'страж обязан заметить пропавший канал');
  assert.ok(diffs.some((d) => d.type === 'added' && d.name === 'new-channel'), 'страж обязан заметить новый канал');
  assert.ok(diffs.some((d) => d.type === 'count' && d.name === 'dup' && d.expected === 1 && d.actual === 2),
    'страж обязан заметить смену числа повторов');
});

// ---- 2. Нет циклов подключений ------------------------------------------------

function graphEntries() {
  return walkJsEntries(ROOT)
    .filter((e) => e.path !== 'src/ui.js')
    .filter((e) => e.path.startsWith('src/main/') || /^src\/[^/]+\.js$/.test(e.path));
}

test('A1-страж: граф require без циклов, src/main/*.js не подключает ../main.js', () => {
  const graph = collectRequireGraph(graphEntries());
  assert.equal(graph.mainRequires.length, 0, 'src/main/*.js подключает ../main.js — это цикл и хрупкость:\n'
    + message(graph.mainRequires.map((e) => e.from + ':' + e.line + ' — ' + e.spec)));
  assert.equal(graph.cycles.length, 0, 'в графе require появились циклы:\n'
    + message(graph.cycles.map((c) => c.text)));
});

test('A1-страж: проверка графа ловит цикл и подключение ../main.js', () => {
  const entries = [
    { path: 'src/a.js', source: "require('./b');" },
    { path: 'src/b.js', source: "require('./a');" },
    { path: 'src/main/x.js', source: "require('../main.js');" },
    { path: 'src/main.js', source: '' },
  ];
  const graph = collectRequireGraph(entries);
  assert.ok(graph.cycles.length > 0, 'страж обязан найти цикл a → b → a');
  assert.ok(graph.cycles.some((c) => c.text.includes('src/a.js') && c.text.includes('src/b.js')),
    'в найденном цикле должны быть оба файла: ' + graph.cycles.map((c) => c.text).join('; '));
  assert.equal(graph.mainRequires.length, 1, 'страж обязан найти подключение ../main.js из src/main/*.js');
  assert.equal(graph.mainRequires[0].from, 'src/main/x.js');
});

// ---- 3. Всё, что модуль берёт из ctx, передано --------------------------------

test('A1-страж: всё, что модули берут из ctx, передано в setup({ … })', () => {
  const usage = collectCtxUsage(MODULE_ENTRIES);
  const setup = collectSetupCalls(MAIN_ENTRY, MODULE_PATHS);
  const issues = checkCtxCoverage(MAIN_ENTRY, MODULE_PATHS, usage, setup);
  assert.deepEqual(issues, [], 'модули просят из ctx то, чего им не передали (или setup вызван не литералом):\n'
    + message(issues));
});

test('A1-страж: проверка ctx ловит недостающий ключ и вызов setup не литералом', () => {
  const modulePath = 'src/main/foo.js';
  const moduleEntry = {
    path: modulePath,
    source: [
      'module.exports = { setup };',
      'function setup(ctx) {',
      '  const { a, b } = ctx;',
      '  ctx.c;',
      '  const d = ctx[\'d\'];',
      '}',
    ].join('\n'),
  };
  const goodMain = {
    path: 'src/main.js',
    source: "const m = require('./main/foo');\nm.setup({ a: 1 });",
  };
  const usage = collectCtxUsage([moduleEntry]);
  const setup = collectSetupCalls(goodMain, [modulePath]);
  const issues = checkCtxCoverage(goodMain, [modulePath], usage, setup);
  assert.ok(issues.some((x) => x.includes('берёт из ctx b, c, d')), 'страж обязан заметить b, c и d:\n' + message(issues));

  const badMain = {
    path: 'src/main.js',
    source: "const m = require('./main/foo');\nconst ctx = { a: 1, b: 2, c: 3, d: 4 };\nm.setup(ctx);",
  };
  const badSetup = collectSetupCalls(badMain, [modulePath]);
  assert.ok(badSetup.issues.some((x) => x.includes('не объектом-литералом')),
    'страж обязан потребовать объект-литерал в setup:\n' + message(badSetup.issues));

  // Новая самостоятельная фабрика create(ctx) проверяется так же, как setup(ctx).
  const createMain = {
    path: 'src/main.js',
    source: "const foo = require('./main/foo');\nconst made = foo.create({ a: 1, getB: () => 2 });",
  };
  const createSetup = collectSetupCalls(createMain, [modulePath]);
  assert.deepEqual(createSetup.issues, [], 'фабрика create тоже должна проверяться:\n' + message(createSetup.issues));
  assert.deepEqual([...createSetup.calls.get(modulePath)[0].keys].sort(), ['a', 'getB']);
});

// ---- 4. Изменяемое не передаётся значением -----------------------------------

test('A1-страж: изменяемое не передаётся в setup значением', () => {
  const setup = collectSetupCalls(MAIN_ENTRY, MODULE_PATHS);
  const issues = findMutableByValueIssues(MAIN_ENTRY, setup);
  assert.deepEqual(issues, [], 'в setup передали изменяемое значение, а не функцию-доступа:\n' + message(issues));
});

test('A1-страж: проверка изменяемого ловит let после setup и внутри функции, пропускает присваивание до setup', () => {
  const modulePath = 'src/main/foo.js';
  const mainEntry = {
    path: 'src/main.js',
    source: [
      'let before = 0;',
      'before = 1;',
      'let after = 0;',
      'let inFn = 0;',
      'let safe = 0;',
      "require('./main/foo').setup({ before, after, inFn, getSafe: () => safe });",
      'after = 2;',
      'safe = 3;',
      'function later() { inFn = 4; }',
    ].join('\n'),
  };
  const setup = collectSetupCalls(mainEntry, [modulePath]);
  const issues = findMutableByValueIssues(mainEntry, setup);
  const text = message(issues);
  assert.match(text, /свойство «after»/, 'страж обязан заметить переприсваивание after после setup:\n' + text);
  assert.match(text, /getAfter: \(\) => after/, 'в сообщении должна быть подсказка про функцию-доступа');
  assert.match(text, /свойство «inFn»/, 'страж обязан заметить переприсваивание inFn внутри вложенной функции:\n' + text);
  assert.doesNotMatch(text, /свойство «before»/, 'присваивание before выше setup допустимо');
  assert.doesNotMatch(text, /getSafe/, 'функция-доступа getSafe допустима');
});
