// Живая проверка Тапёра: чистые помощники инструмента tools/reliability/live-smoke.mjs.
// Зачем тест: инструмент запускает настоящую программу и решает «прошёл / не прошёл».
// Ошибка в разборе параметров, очереди или вердикте даст ложный результат живой проверки,
// а папка профиля обязана быть только внутри sandbox — иначе можно задеть профиль владельца.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PORT, DEFAULT_WIDGET_PORT, DEFAULT_OUT, SCENARIOS, SCENARIO_LABELS,
  NETWORK_SCENARIOS, LOCAL_WAV_NAME, WAV_HEADER_BYTES, SEEK_SLACK_SEC,
  ORDERS_TEST_TEXT, ORDERS_TEST_AMOUNT, ORDERS_TIMEOUT_MS,
  SBOT_PROBE_PATH, SBOT_STARTING_RETRY_MS, DEBUG_STATE_KEYS,
  IPC_READONLY_METHODS, IPC_CALL_TIMEOUT_MS,
  checkDataDir, parseArgs, helpText, parseOnly, defaultSettings, streamDay,
  normalizeQueueItem, queueItemsFromJson, parseQueueFile, buildToday,
  httpStatusVerdict, widgetHeadersVerdict, logCrashLines, bridgeVerdict,
  queueRestored, splitCspViolations, isKnownWorkerCsp, pickCancelVerdict,
  exitVerdict, networkSkip, targetHost, pickTargets, findWebviewTarget,
  formatDuration, statusText, scenarioTally, scrubPaths, normalizeHex, formatReport,
  seekVerdict, wavTone, vizFrameVerdict, pageErrorsVerdict,
  testOrderVerdict, requestsKeyVerdict, sbotStatusVerdict, debugStateVerdict,
  ipcCallExpression, ipcCallVerdict, crashDeltaVerdict,
} from '../../tools/reliability/live-smoke-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SANDBOX = path.join(os.tmpdir(), 'sandbox', 'tapyor-live-smoke-test');

test('live-smoke: папка профиля обязана лежать внутри sandbox', () => {
  assert.equal(checkDataDir(SANDBOX), path.resolve(SANDBOX));
  assert.equal(checkDataDir(path.join(os.tmpdir(), 'SandBox', 'x')), path.resolve(os.tmpdir(), 'SandBox', 'x'));
  for (const bad of ['', '   ', path.join(os.tmpdir(), 'tapyor-live-smoke-test'),
    path.join(os.tmpdir(), 'sandbox2', 'data'), path.join(os.tmpdir(), 'не-sandbox', 'data')]) {
    assert.throws(() => checkDataDir(bad), /sandbox/); // export-scan:allow — слово «sandbox» здесь условие инструмента, не путь
  }
});

test('live-smoke: параметры по умолчанию и разбор всех ключей', () => {
  const base = parseArgs(['--data', SANDBOX], ROOT);
  assert.equal(base.port, DEFAULT_PORT);
  assert.equal(base.widgetPort, DEFAULT_WIDGET_PORT);
  assert.equal(base.data, path.resolve(SANDBOX));
  assert.equal(base.electron, null);
  assert.equal(base.queue, null);
  assert.equal(base.out, path.resolve(ROOT, DEFAULT_OUT));
  assert.deepEqual(base.only, SCENARIOS.slice());
  assert.equal(base.help, false);

  const opts = parseArgs([
    '--data', SANDBOX, '--electron', 'my-electron', '--port', '9338', '--widget-port', '48000',
    '--out', 'report.md', '--queue', 'queue.json', '--only', 'pick,start',
  ], ROOT);
  assert.equal(opts.electron, path.resolve(ROOT, 'my-electron'));
  assert.equal(opts.port, 9338);
  assert.equal(opts.widgetPort, 48000);
  assert.equal(opts.out, path.resolve(ROOT, 'report.md'));
  assert.equal(opts.queue, path.resolve(ROOT, 'queue.json'));
  assert.deepEqual(opts.only, ['start', 'pick'], 'сценарии идут в общем порядке');

  const inline = parseArgs(['--data=' + SANDBOX, '--port=1', '--widget-port=65535'], ROOT);
  assert.equal(inline.port, 1);
  assert.equal(inline.widgetPort, 65535);
});

test('live-smoke: --only сохраняет quit последним и знает только свои сценарии', () => {
  assert.deepEqual(parseOnly('quit,start'), ['start', 'quit']);
  assert.deepEqual(parseOnly(' soundcloud , youtube '), ['youtube', 'soundcloud']);
  assert.deepEqual(parseOnly('server'), ['server']);
  assert.throws(() => parseOnly(''), /--only/);
  assert.throws(() => parseOnly(' , '), /--only/);
  assert.throws(() => parseOnly('start,нет-такого'), /неизвестные сценарии: нет-такого/);
  assert.ok(SCENARIOS.includes('quit'));
  assert.equal(SCENARIOS[SCENARIOS.length - 1], 'quit');
});

test('live-smoke: local, viz и fullscreen идут перед quit и не требуют сети', () => {
  assert.deepEqual(parseOnly('fullscreen,local,viz'), ['local', 'viz', 'fullscreen']);
  const local = SCENARIOS.indexOf('local');
  const viz = SCENARIOS.indexOf('viz');
  const fullscreen = SCENARIOS.indexOf('fullscreen');
  assert.ok(local > SCENARIOS.indexOf('soundcloud'), 'local после звуковых сценариев');
  assert.ok(local < viz && viz < fullscreen, 'порядок local → viz → fullscreen');
  assert.equal(fullscreen + 1, SCENARIOS.indexOf('quit'), 'fullscreen прямо перед выходом');
  assert.equal(NETWORK_SCENARIOS.local, undefined);
  assert.equal(NETWORK_SCENARIOS.viz, undefined);
  assert.equal(NETWORK_SCENARIOS.fullscreen, undefined);
  assert.equal(SCENARIO_LABELS.local, 'файл с компьютера');
  assert.equal(SCENARIO_LABELS.viz, 'визуализатор');
  assert.equal(SCENARIO_LABELS.fullscreen, 'на весь экран');
  assert.equal(SCENARIO_LABELS.pageerrors, 'ошибки страницы');
  assert.equal(LOCAL_WAV_NAME, 'test-tone.wav');
  assert.equal(SEEK_SLACK_SEC, 2);
});

test('live-smoke: --help не требует --data, а ошибки параметров понятны', () => {
  const help = parseArgs(['--help'], ROOT);
  assert.equal(help.help, true);
  assert.equal(help.data, null);
  const text = helpText();
  for (const key of ['--data', '--electron', '--port', '--widget-port', '--only', '--queue', '--out', '--help']) {
    assert.match(text, new RegExp(key));
  }
  assert.match(text, /sandbox/); // export-scan:allow — слово «sandbox» здесь условие инструмента, не путь
  for (const id of ['local', 'viz', 'fullscreen']) {
    assert.match(text, new RegExp('\\b' + id + '\\b'), 'справка перечисляет сценарий ' + id);
  }

  assert.throws(() => parseArgs([], ROOT), /--data/);
  assert.throws(() => parseArgs(['--data'], ROOT), /значение/);
  assert.throws(() => parseArgs(['--data', path.join(os.tmpdir(), 'без-песочницы')], ROOT), /sandbox/); // export-scan:allow — слово «sandbox» здесь условие инструмента, не путь
  assert.throws(() => parseArgs(['--data', SANDBOX, '--port', '0'], ROOT), /--port/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--port', '70000'], ROOT), /--port/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--port', '1.5'], ROOT), /--port/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--widget-port', '0'], ROOT), /--widget-port/);
  assert.throws(() => parseArgs(['--data', SANDBOX, '--чего-то'], ROOT), /Неизвестный параметр/);
});

test('live-smoke: тестовые настройки профиля', () => {
  assert.deepEqual(defaultSettings(48000), {
    reportsEnabled: false,
    autoUpdate: false,
    streamerMode: false,
    closeAsked: true,
    closeToTray: false,
    widgetPort: 48000,
  });
  assert.equal(defaultSettings().widgetPort, DEFAULT_WIDGET_PORT);
});

test('live-smoke: день очереди начинается в 6 утра', () => {
  assert.equal(streamDay(new Date(2026, 0, 15, 5, 59)), '2026-1-14');
  assert.equal(streamDay(new Date(2026, 0, 15, 6, 1)), '2026-1-15');
  assert.equal(streamDay(new Date(2026, 0, 15, 12, 0)), '2026-1-15');
});

test('live-smoke: разбор подложенной очереди', () => {
  const item = normalizeQueueItem({ title: '  Проверка  ' });
  assert.equal(item.title, 'Проверка');
  assert.equal(item.src, 'ym');
  assert.equal(item.id, 'live-smoke-1');

  const items = queueItemsFromJson([{ title: 'A' }, { title: 'B', src: 'sc', id: 'b' }]);
  assert.deepEqual(items.map((x) => x.id), ['live-smoke-1', 'b']);
  assert.deepEqual(queueItemsFromJson({ items: [{ title: 'C' }] }).map((x) => x.title), ['C']);

  assert.throws(() => normalizeQueueItem(null), /не объект/);
  assert.throws(() => normalizeQueueItem({ title: '   ' }), /нет названия/);
  assert.throws(() => queueItemsFromJson({}), /items/);
  assert.throws(() => queueItemsFromJson([]), /пустой/);
  assert.throws(() => parseQueueFile('не json'), /JSON/);
  assert.deepEqual(parseQueueFile('\uFEFF[{"title":"BOM"}]').map((x) => x.title), ['BOM']);
});

test('live-smoke: today.json собирается как у окна (day/items/current/pos)', () => {
  const items = [{ title: 'A' }, { title: 'B' }];
  const today = buildToday(items, { now: new Date(2026, 0, 15, 12), current: 9, pos: -5, playing: true });
  assert.equal(today.day, '2026-1-15');
  assert.equal(today.items.length, 2);
  assert.equal(today.current, 1, 'место не выходит за список');
  assert.equal(today.pos, 0);
  assert.equal(today.playing, true);

  const plain = buildToday(items, { day: '2026-2-1' });
  assert.equal(plain.day, '2026-2-1');
  assert.equal(plain.current, 0);
  assert.equal(plain.playing, false);
  assert.throws(() => buildToday([], {}), /пустой/);
});

test('live-smoke: вердикты по кодам и заголовкам сервера', () => {
  assert.equal(httpStatusVerdict(200, { status: 200 }).ok, true);
  assert.equal(httpStatusVerdict(403, { status: 403 }).ok, true);
  assert.equal(httpStatusVerdict(200, { status: 403 }).ok, false);
  assert.match(httpStatusVerdict(200, { status: 403 }).reason, /403/);
  assert.equal(httpStatusVerdict(200, {}).ok, false);

  const good = widgetHeadersVerdict({
    'content-security-policy': "frame-ancestors 'self' http://127.0.0.1:47994 http://localhost:47994",
    'x-frame-options': 'SAMEORIGIN',
  });
  assert.equal(good.ok, true);
  assert.match(good.reason, /frame-ancestors: есть/);
  assert.equal(widgetHeadersVerdict({ 'content-security-policy': "default-src 'self'" }).ok, false);
  assert.equal(widgetHeadersVerdict({ 'x-frame-options': 'SAMEORIGIN' }).ok, false);
  assert.equal(widgetHeadersVerdict({
    'content-security-policy': "frame-ancestors 'self'", 'x-frame-options': 'DENY',
  }).ok, true);
  assert.equal(widgetHeadersVerdict({
    'content-security-policy': "frame-ancestors 'self'", 'x-frame-options': 'ALLOW-FROM http://x',
  }).ok, false);
});

test('live-smoke: журнал и доступ к parent.app из кадра', () => {
  const log = [
    'сервер на порту 47994',
    'главный процесс: необработанная ошибка — boom',
    'главный процесс: необработанное отклонение — boom',
    'обычная ошибка сети',
  ].join('\n');
  const crash = logCrashLines(log);
  assert.equal(crash.length, 2);
  assert.deepEqual(logCrashLines(''), []);
  assert.deepEqual(logCrashLines(null), []);

  assert.equal(bridgeVerdict({ blocked: true, name: 'SecurityError' }).ok, true);
  assert.match(bridgeVerdict({ blocked: true, name: 'SecurityError' }).reason, /SecurityError/);
  assert.equal(bridgeVerdict({ blocked: false, type: 'undefined' }).ok, true);
  assert.equal(bridgeVerdict({ blocked: false, type: 'object' }).ok, false);
  assert.match(bridgeVerdict({ blocked: false, type: 'object' }).reason, /window\.app/);
  assert.equal(bridgeVerdict(null).ok, false);
});

test('live-smoke: восстановление очереди проверяется по названиям', () => {
  const ok = queueRestored(['A', 'B', 'C'], ['A', 'C']);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.missing, []);
  const bad = queueRestored(['A'], ['A', 'B']);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing, ['B']);
  assert.equal(queueRestored([], []).ok, false, 'пустое ожидание — не успех');
  assert.equal(queueRestored(null, ['A']).ok, false);
});

test('live-smoke: новые сценарии orders, sbot, debug и ipc', () => {
  for (const id of ['orders', 'sbot', 'debug', 'ipc']) {
    assert.ok(SCENARIOS.includes(id), 'сценарий ' + id + ' есть в общем списке');
    assert.ok(SCENARIO_LABELS[id], 'у сценария ' + id + ' есть название');
  }
  assert.deepEqual(parseOnly('ipc,orders,sbot,debug'), ['orders', 'sbot', 'debug', 'ipc']);
  assert.equal(SCENARIOS[SCENARIOS.length - 1], 'quit', 'quit по-прежнему последний');
  assert.ok(SCENARIOS.indexOf('orders') > SCENARIOS.indexOf('guards'));
  assert.ok(SCENARIOS.indexOf('orders') < SCENARIOS.indexOf('browser'));

  // orders ищет трек в сети, как youtube и soundcloud, и без сети пропускается.
  assert.equal(NETWORK_SCENARIOS.orders, 'api.music.yandex.net');
  assert.match(networkSkip('orders', false), /интернет/);
  assert.equal(networkSkip('orders', true), null);
  assert.equal(NETWORK_SCENARIOS.sbot, undefined);
  assert.equal(NETWORK_SCENARIOS.debug, undefined);
  assert.equal(NETWORK_SCENARIOS.ipc, undefined);

  const text = helpText();
  for (const id of ['orders', 'sbot', 'debug', 'ipc']) {
    assert.match(text, new RegExp('\\b' + id + '\\b'), 'справка перечисляет сценарий ' + id);
  }
  assert.match(text, /orders требуют интернета|orders — пробный заказ/);
});

test('live-smoke: тестовый заказ — ответ моста, requests.json и новый сбой журнала', () => {
  assert.equal(ORDERS_TEST_TEXT.includes('Кино'), true);
  assert.equal(ORDERS_TEST_AMOUNT, 100);
  assert.equal(ORDERS_TIMEOUT_MS, 60000);

  assert.equal(testOrderVerdict(null).ok, false);
  assert.match(testOrderVerdict(null).reason, /пустой/);
  assert.equal(testOrderVerdict('test:1').ok, false, 'строка — не запись заказа');
  assert.equal(testOrderVerdict([]).ok, false);
  const ok = testOrderVerdict({ key: 'test:t1abc', level: 'exact' });
  assert.equal(ok.ok, true);
  assert.equal(ok.key, 'test:t1abc');
  const other = testOrderVerdict({ key: 'da:123' });
  assert.equal(other.ok, false);
  assert.match(other.reason, /test:/);
  assert.equal(testOrderVerdict({}).ok, false);

  const list = JSON.stringify([{ key: 'da:1' }, { key: 'test:t1abc', text: 'Кино — Группа крови' }]);
  assert.equal(requestsKeyVerdict(list, 'test:t1abc').ok, true);
  assert.equal(requestsKeyVerdict('\uFEFF' + list, 'test:t1abc').ok, true, 'BOM не мешает');
  assert.equal(requestsKeyVerdict(list, 'test:nope').ok, false);
  assert.match(requestsKeyVerdict(list, 'test:nope').reason, /test:nope/);
  assert.equal(requestsKeyVerdict('не json', 'test:t1abc').ok, false);
  assert.match(requestsKeyVerdict('не json', 'test:t1abc').reason, /JSON/);
  assert.equal(requestsKeyVerdict('{"a":1}', 'test:t1abc').ok, false, 'объект — не список');
  assert.equal(requestsKeyVerdict(null, 'test:t1abc').ok, false);

  const clean = crashDeltaVerdict('сервер на порту\nобычная строка', 'сервер на порту\nобычная строка\nещё строка');
  assert.equal(clean.ok, true);
  assert.match(clean.reason, /нет/);
  const crashed = crashDeltaVerdict('a', 'a\nглавный процесс: необработанная ошибка — boom');
  assert.equal(crashed.ok, false);
  assert.equal(crashed.added, 1);
  assert.match(crashed.reason, /необработанная ошибка/);
  const old = crashDeltaVerdict('главный процесс: необработанное отклонение — было',
    'главный процесс: необработанное отклонение — было\nновая строка');
  assert.equal(old.ok, true, 'старый сбой в журнале не валит сценарий');
  assert.match(old.reason, /уже было/);
});

test('live-smoke: порт Streamer.bot без ключа и снимок отладки', () => {
  assert.equal(SBOT_PROBE_PATH, '/sb/status');
  assert.equal(SBOT_STARTING_RETRY_MS, 10000);
  assert.equal(sbotStatusVerdict(401).ok, true);
  assert.match(sbotStatusVerdict(401).reason, /401/);
  const starting = sbotStatusVerdict(503);
  assert.equal(starting.ok, false);
  assert.equal(starting.retry, true, '503 — ещё не готов, повторяем');
  assert.equal(sbotStatusVerdict(200).ok, false);
  assert.match(sbotStatusVerdict(200).reason, /вместо 401/);
  assert.equal(sbotStatusVerdict(403).ok, false);
  assert.equal(sbotStatusVerdict(NaN).ok, false);
  assert.equal(sbotStatusVerdict(undefined).ok, false);

  assert.ok(DEBUG_STATE_KEYS.includes('load'));
  assert.ok(DEBUG_STATE_KEYS.includes('version'));
  assert.ok(DEBUG_STATE_KEYS.includes('watchdog'));
  assert.ok(DEBUG_STATE_KEYS.includes('logins'));

  const state = {};
  for (const k of DEBUG_STATE_KEYS) state[k] = null;
  const ok = debugStateVerdict({ ok: true, state });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.missing, []);
  assert.match(ok.reason, /error/);

  const noLoad = { ...state };
  delete noLoad.load;
  const missing = debugStateVerdict({ ok: true, state: noLoad });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['load']);
  assert.match(missing.reason, /load/);

  const withError = { ...state, error: 'boom' };
  assert.equal(debugStateVerdict({ ok: true, state: withError }).ok, false);
  assert.match(debugStateVerdict({ ok: true, state: withError }).reason, /error/);

  const failed = debugStateVerdict({ ok: false, error: 'главный процесс упал' });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /упал/);
  assert.equal(debugStateVerdict(null).ok, false);
  assert.equal(debugStateVerdict({ ok: true }).ok, false);
  assert.equal(debugStateVerdict({ ok: true, state: [] }).ok, false);
});

test('live-smoke: белый список каналов только для чтения — имена, причины, аргументы', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))
    .join('\n');
  const seen = new Set();
  assert.ok(IPC_READONLY_METHODS.length >= 20, 'список не пустой');
  for (const method of IPC_READONLY_METHODS) {
    assert.ok(method && typeof method.name === 'string' && method.name, 'у метода есть имя');
    assert.ok(!seen.has(method.name), 'без повторов: ' + method.name);
    seen.add(method.name);
    const line = preload.split(/\r?\n/).find((l) => new RegExp('^\\s*' + method.name + '\\s*:').test(l)) || '';
    assert.match(line, /ipcRenderer\.invoke\(/, 'метод ' + method.name + ' в preload.js зовёт invoke');
    const channel = (/'([^']+)'/.exec(line) || [])[1] || '';
    assert.ok(channel, 'у метода ' + method.name + ' есть имя канала');
    assert.ok(srcFiles.includes("ipcMain.handle('" + channel + "'") || srcFiles.includes("ipcMain.on('" + channel + "'"),
      'канал ' + channel + ' зарегистрирован в главном процессе');
    assert.equal(typeof method.reason, 'string', 'у ' + method.name + ' есть причина');
    assert.ok(method.reason.length >= 10, 'причина ' + method.name + ' объясняет, почему это чтение');
    assert.ok(Array.isArray(method.args), 'аргументы ' + method.name + ' — массив');
    assert.deepEqual(JSON.parse(JSON.stringify(method.args)), method.args, 'аргументы ' + method.name + ' сериализуются');
  }

  // Заведомо не «только чтение»: меняет настройки, пишет файлы, открывает окна, играет или шлёт данные.
  for (const bad of ['setSetting', 'reqTest', 'reqUpdate', 'reqClear', 'libAddFolder', 'libRemoveFolder',
    'libDrop', 'importFile', 'm3uExport', 'closeChoice', 'uiZoom', 'debugReset', 'debugRestore',
    'debugSaveLog', 'debugSaveReport', 'sbotPortKey', 'sbotConnect', 'sbotWriteSettings', 'ymStatus',
    'ymLogin', 'packCheck', 'packInstall', 'vpnNets', 'vpnNetsRefresh', 'hotkeysStatus', 'memReport',
    'logCopy', 'openExternal', 'winFullscreen', 'qcRun', 'healthRun', 'autoFix']) {
    assert.ok(!seen.has(bad), 'опасный метод не должен быть в белом списке: ' + bad);
  }
  assert.equal(IPC_CALL_TIMEOUT_MS, 20000);
});

test('live-smoke: вызов метода моста не роняет страницу', async () => {
  const expr = ipcCallExpression('getSetting', ['theme']);
  assert.match(expr, /window\.app\["getSetting"\]/);
  assert.match(expr, /\["theme"\]/);
  assert.match(expr, /catch/);
  assert.match(expr, /typeof window\.app\["getSetting"\] !== 'function'/);
  assert.equal(ipcCallExpression("a'b", []).includes('"a\'b"'), true, 'имя идёт строкой, а не кодом');
  assert.match(ipcCallExpression('x', [{ a: 1 }]), /\[\{"a":1\}\]/);

  // Выражение и правда не бросает: нет метода, отказ промиса и обычный ответ — это объект.
  const run = (name, args, app) => new Function('window', 'return ' + ipcCallExpression(name, args))({ app });
  assert.deepEqual(await run('x', [], { x: () => Promise.resolve(1) }), { ok: true, value: 1 });
  assert.deepEqual(await run('x', [], {}), { ok: false, error: true });
  assert.deepEqual(await run('x', [], { x: () => { throw new Error('boom'); } }), { ok: false, error: true });
  assert.deepEqual(await run('x', [], { x: () => Promise.reject(new Error('нет')) }), { ok: false, error: true });
  assert.deepEqual(await run('x', [], null), { ok: false, error: true });

  assert.equal(ipcCallVerdict({ ok: true, value: null }).ok, true, 'null — тоже полученный ответ');
  assert.equal(ipcCallVerdict({ ok: true, value: { error: 'нет окна' } }).ok, true);
  assert.equal(ipcCallVerdict({ ok: false, error: true }).ok, false);
  assert.match(ipcCallVerdict({ ok: false, error: true }).reason, /ошибкой/);
  assert.equal(ipcCallVerdict(null).ok, false);
});


test('live-smoke: CSP — известное worker hls.js не считается провалом', () => {
  const worker = "Refused to create a worker from 'blob:http://127.0.0.1:47994/abc' because it violates the following Content Security Policy directive";
  assert.equal(isKnownWorkerCsp(worker), true);
  assert.equal(isKnownWorkerCsp('Refused to load the script because Content Security Policy'), false);

  const { unexpected, known } = splitCspViolations([
    worker,
    worker,
    "Refused to load the script 'https://evil.example/x.js' because it violates the following Content Security Policy directive",
    'обычная ошибка консоли',
    "Refused to load the script 'https://evil.example/x.js' because it violates the following Content Security Policy directive",
  ]);
  assert.equal(known.length, 1);
  assert.equal(unexpected.length, 1);
  assert.match(unexpected[0], /evil\.example/);
  assert.deepEqual(splitCspViolations(null), { unexpected: [], known: [] });
});

test('live-smoke: «Отмена» возвращает исходный цвет', () => {
  assert.equal(normalizeHex('#3366cc'), '#3366CC');
  const ok = pickCancelVerdict({ start: '#3366cc', after: '#3366CC', picked: ['#FF0000', '#3366cc'] });
  assert.equal(ok.ok, true);
  assert.equal(ok.colorBack, true);
  assert.equal(ok.callbackBack, true);

  const wrongColor = pickCancelVerdict({ start: '#3366cc', after: '#000000', picked: ['#3366cc'] });
  assert.equal(wrongColor.ok, false);
  assert.equal(wrongColor.colorBack, false);

  const wrongCallback = pickCancelVerdict({ start: '#3366cc', after: '#3366CC', picked: ['#FF0000'] });
  assert.equal(wrongCallback.ok, false);
  assert.equal(wrongCallback.callbackBack, false);

  assert.equal(pickCancelVerdict({}).ok, false);
});

test('live-smoke: решение о перемотке — цель, прошедшее время и старый кадр', () => {
  const ok = seekVerdict({ before: 2.6, target: 8, after: 8.3, elapsedSec: 0.5 });
  assert.equal(ok.ok, true);
  assert.equal(ok.min, 8);
  assert.equal(ok.max, 10.5);
  assert.match(ok.reason, /8\.3/);

  const stale = seekVerdict({ before: 2.6, target: 8, after: 2.6, elapsedSec: 1 });
  assert.equal(stale.ok, false, 'старое время после seekTo на паузе — не прошло');
  assert.match(stale.reason, /меньше цели/);

  // Ровно цель и верхняя граница допуска — прошло; на 0,1 с дальше — уже нет.
  assert.equal(seekVerdict({ before: 0, target: 8, after: 8, elapsedSec: 0 }).ok, true);
  assert.equal(seekVerdict({ before: 0, target: 8, after: 10, elapsedSec: 0 }).ok, true);
  assert.equal(seekVerdict({ before: 0, target: 8, after: 10.1, elapsedSec: 0 }).ok, false);
  assert.match(seekVerdict({ before: 0, target: 8, after: 10.1, elapsedSec: 0 }).reason, /больше/);

  // Битое или отрицательное прошедшее время считаем нулём, а не «минус».
  assert.equal(seekVerdict({ before: 0, target: 3, after: 5, elapsedSec: -10 }).ok, true);
  assert.equal(seekVerdict({ before: 0, target: 3, after: 5.1, elapsedSec: -10 }).ok, false);
  assert.equal(seekVerdict({ before: 0, target: 3, after: 5, elapsedSec: NaN }).ok, true);

  // «Во время игры»: перемотка назад с 12 с к 3 с — старые 12 с не засчитываются.
  assert.equal(seekVerdict({ before: 12, target: 3, after: 12, elapsedSec: 0.2 }).ok, false);

  assert.equal(seekVerdict({ target: 8, after: NaN, elapsedSec: 1 }).ok, false);
  assert.equal(seekVerdict({ target: -1, after: 8, elapsedSec: 1 }).ok, false);
  assert.equal(seekVerdict({}).ok, false);
});

test('live-smoke: тестовый WAV — заголовок, длина, 16 бит моно', () => {
  const seconds = 4, rate = 44100;
  const buf = wavTone({ seconds, freq: 440, sampleRate: rate, bits: 16, channels: 1 });
  assert.equal(buf.length, WAV_HEADER_BYTES + seconds * rate * 2);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.readUInt32LE(4), buf.length - 8, 'размер RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.toString('ascii', 12, 16), 'fmt ');
  assert.equal(buf.readUInt32LE(16), 16, 'размер блока fmt');
  assert.equal(buf.readUInt16LE(20), 1, 'PCM без сжатия');
  assert.equal(buf.readUInt16LE(22), 1, 'моно');
  assert.equal(buf.readUInt32LE(24), rate, 'частота дискретизации');
  assert.equal(buf.readUInt32LE(28), rate * 2, 'байт в секунду');
  assert.equal(buf.readUInt16LE(32), 2, 'выравнивание блока');
  assert.equal(buf.readUInt16LE(34), 16, '16 бит');
  assert.equal(buf.toString('ascii', 36, 40), 'data');
  assert.equal(buf.readUInt32LE(40), seconds * rate * 2, 'размер данных');
  assert.equal(WAV_HEADER_BYTES, 44);

  let max = 0, min = 0;
  for (let i = WAV_HEADER_BYTES; i < buf.length; i += 2) {
    const v = buf.readInt16LE(i);
    if (v > max) max = v;
    if (v < min) min = v;
  }
  assert.ok(max > 5000 && min < -5000, 'тон звучит, а не тишина');

  const short = wavTone({ seconds: 3, sampleRate: 8000 });
  assert.equal(short.length, WAV_HEADER_BYTES + 3 * 8000 * 2);
  assert.equal(wavTone({}).length, WAV_HEADER_BYTES + 4 * 44100 * 2, 'по умолчанию 4 с');
  assert.equal(wavTone({ channels: 2 }).readUInt16LE(22), 2);
  assert.equal(wavTone({ seconds: 0 }).length, WAV_HEADER_BYTES + 4 * 44100 * 2, 'негодная длина — 4 с по умолчанию');
});

test('live-smoke: решение по визуализатору — виден, размер холста, кадр', () => {
  const ok = vizFrameVerdict({ visible: true, canvasWidth: 600, canvasHeight: 340, changed: true, capture: true });
  assert.equal(ok.ok, true);
  assert.match(ok.reason, /600×340/);
  assert.match(ok.reason, /есть/);

  const hidden = vizFrameVerdict({ visible: false, canvasWidth: 600, canvasHeight: 340, changed: true });
  assert.equal(hidden.ok, false);
  assert.match(hidden.reason, /не виден/);

  assert.equal(vizFrameVerdict({ visible: true, canvasWidth: 0, canvasHeight: 340, changed: true }).ok, false);
  assert.match(vizFrameVerdict({ visible: true, canvasWidth: 600, canvasHeight: 0, changed: true }).reason, /размер/);
  assert.equal(vizFrameVerdict({ visible: true, canvasWidth: 600, canvasHeight: 340, changed: false }).ok, false);
  assert.match(vizFrameVerdict({ visible: true, canvasWidth: 600, canvasHeight: 340, changed: false }).reason, /не изменился/);

  // Захват звука не вышел — это не провал: окно рисует запасную волну.
  const fallback = vizFrameVerdict({
    visible: true, canvasWidth: 300, canvasHeight: 200, changed: true, capture: false, captureFailed: true,
  });
  assert.equal(fallback.ok, true);
  assert.match(fallback.reason, /запасная волна/);
  assert.match(vizFrameVerdict({ visible: true, canvasWidth: 300, canvasHeight: 200, changed: true }).reason, /нет/);
});

test('live-smoke: ошибки страницы — непустой список провал, пути вычищены', () => {
  const clean = pageErrorsVerdict([]);
  assert.equal(clean.ok, true);
  assert.match(clean.details[0], /нет/);
  assert.equal(pageErrorsVerdict(null).ok, true);

  const one = pageErrorsVerdict(['TypeError: x is undefined\n    at C:\\app\\ui.js:10:5']);
  assert.equal(one.ok, false);
  assert.equal(one.count, 1);
  assert.match(one.details[0], /TypeError/);
  assert.doesNotMatch(one.details[0], /C:\\app/, 'путь ПК в отчёт не попадает');

  const many = pageErrorsVerdict(['a', 'b', 'c', 'd']);
  assert.equal(many.ok, false);
  assert.equal(many.count, 4);
  assert.match(many.details[0], /a \| b \| c/);
  assert.doesNotMatch(many.details[0], /\| d/, 'показываем только первые три');
});

test('live-smoke: выход и пропуск сетевых сценариев', () => {
  assert.equal(exitVerdict(true, false).ok, true);
  assert.match(exitVerdict(false, true).reason, /не вышел штатно/);
  assert.match(exitVerdict(false, false).reason, /не вышел/);

  assert.equal(networkSkip('youtube', true), null);
  assert.match(networkSkip('youtube', false), /нужен интернет/);
  assert.match(networkSkip('soundcloud', false), /api-v2\.soundcloud\.com/);
  assert.equal(networkSkip('start', false), null, 'обычные сценарии без сети не пропускаются');
  assert.equal(NETWORK_SCENARIOS.browser, 'www.youtube.com');
});

test('live-smoke: цели CDP — окно пипетки и webview YouTube', () => {
  assert.equal(targetHost('https://www.youtube.com/feed'), 'www.youtube.com');
  assert.equal(targetHost('не url'), '');

  const picks = pickTargets([
    { type: 'page', url: 'http://127.0.0.1:1/index.html' },
    { type: 'page', url: 'file:///app/pick.html' },
  ]);
  assert.equal(picks.length, 1);
  assert.match(picks[0].url, /pick\.html/);

  const targets = [
    { type: 'page', url: 'https://www.youtube.com/' },
    { type: 'webview', url: 'https://www.youtube.com/feed' },
    { type: 'webview', url: 'https://music.yandex.ru/' },
    { type: 'webview', url: 'мусор' },
  ];
  assert.equal(findWebviewTarget(targets, 'youtube.com').url, 'https://www.youtube.com/feed');
  assert.equal(findWebviewTarget(targets, 'www.youtube.com').url, 'https://www.youtube.com/feed');
  assert.equal(findWebviewTarget(targets, 'yandex.ru').url, 'https://music.yandex.ru/');
  assert.equal(findWebviewTarget(targets, 'twitch.tv'), null);
  assert.equal(findWebviewTarget(targets, ''), null);
});

test('live-smoke: длительность, итоги и очистка путей', () => {
  assert.equal(formatDuration(250), '250 мс');
  assert.equal(formatDuration(1500), '1.5 с');
  assert.equal(formatDuration(65000), '1 мин 5 с');
  assert.equal(formatDuration(NaN), '?');

  assert.equal(statusText('passed'), 'прошёл');
  assert.equal(statusText('failed'), 'не прошёл');
  assert.equal(statusText('skipped'), 'пропущен');

  assert.deepEqual(scenarioTally([
    { status: 'passed' }, { status: 'failed' }, { status: 'skipped' }, {},
  ]), { total: 4, passed: 1, failed: 2, skipped: 1 });

  const scrubbed = scrubPaths('файл C:\\Windows\\win.ini и E:\\data\\x.json');
  assert.doesNotMatch(scrubbed, /[A-Za-z]:[\\/]/);
  assert.equal(scrubbed, 'файл <путь> и <путь>');
});

test('live-smoke: отчёт .md — таблица сценариев, время, Electron, коммит', () => {
  const report = formatReport({
    startedAt: '13.11.2026, 12:00:00',
    elapsedMs: 65000,
    electronVersion: '44.11.3',
    commit: 'b328344',
    command: 'node tools/reliability/live-smoke.mjs --data <папка внутри sandbox>',
    exit: { exited: false, forced: true, verdict: exitVerdict(false, true) },
    error: 'не открылось окно C:\\Windows\\x',
  }, [
    { id: 'start', status: 'passed', network: false, elapsedMs: 1200, details: ['окно: открылось', 'сервер: код 200'] },
    { id: 'youtube', status: 'skipped', network: true, elapsedMs: 10, details: ['нужен интернет — нет связи'] },
    { id: 'quit', status: 'failed', network: false, elapsedMs: 15000, details: ['выход: не вышел штатно'] },
  ]);
  assert.match(report, /^# Живая проверка Тапёра/);
  assert.match(report, /- Electron: 44\.11\.3/);
  assert.match(report, /- Коммит: b328344/);
  assert.match(report, /- Длительность: 1 мин 5 с/);
  assert.match(report, /Итог: 1 прошло, 1 не прошло, 1 пропущено \(всего 3\)/);
  assert.match(report, /\| start — запуск \| прошёл \| 1\.2 с \|/);
  assert.match(report, /\| youtube — плеер YouTube \(нужен интернет\) \| пропущен \| 10 мс \|/);
  assert.match(report, /\| quit — выход \| не прошёл \| 15\.0 с \|/);
  assert.match(report, /не вышел штатно/);
  assert.match(report, /<путь>/);
  assert.doesNotMatch(report, /C:\\Windows/);
  assert.match(report, /\| Сценарий \| Итог \| Время \| Что проверено \|/);
  assert.ok(report.endsWith('\n'));
});

test('live-smoke: package.json содержит команду reliability:smoke', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['reliability:smoke'], 'node tools/reliability/live-smoke.mjs');
});

test('live-smoke: --help и отказ без --data не запускают программу', () => {
  const help = spawnSync(process.execPath, ['tools/reliability/live-smoke.mjs', '--help'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /--data/);
  assert.match(help.stdout, /--only/);

  const noData = spawnSync(process.execPath, ['tools/reliability/live-smoke.mjs'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(noData.status, 2, noData.stderr || noData.stdout);
  assert.match(noData.stderr, /--data/);

  const noSandbox = spawnSync(process.execPath, [
    'tools/reliability/live-smoke.mjs', '--data', path.join(os.tmpdir(), 'tapyor-live-smoke-test'),
  ], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  assert.equal(noSandbox.status, 2, noSandbox.stderr || noSandbox.stdout);
  assert.match(noSandbox.stderr, /sandbox/); // export-scan:allow — слово «sandbox» здесь условие инструмента, не путь
});
