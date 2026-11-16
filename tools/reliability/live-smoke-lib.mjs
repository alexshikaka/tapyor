// Чистые помощники инструмента живой проверки (tools/reliability/live-smoke.mjs):
// разбор параметров, профиль и очередь, вердикты по ответам сервера/CDP/журналу,
// разбор нарушений CSP и сборка отчёта .md.
//
// Здесь нет запуска Electron, сети и обращений к окну — всё это в live-smoke.mjs,
// а этот файл целиком покрыт unit-тестами (tests/unit/live-smoke.test.mjs).
import path from 'node:path';
import { checkDataDir, parseTargets, pickPage, evalValue } from './long-run-lib.mjs';

// Проверка папки профиля — общая с инструментом «4 часа»: только внутри sandbox.
export { checkDataDir, parseTargets, pickPage, evalValue };

export const DEFAULT_PORT = 9337;
export const DEFAULT_WIDGET_PORT = 47994;
export const DEFAULT_OUT = 'tools/reliability/live-smoke-result.md';
// Имя тестового звука: его создаёт сценарий local в папке профиля (music/).
export const LOCAL_WAV_NAME = 'test-tone.wav';

// Порядок сценариев фиксирован: quit всегда последний, иначе после выхода нечего проверять.
export const SCENARIOS = Object.freeze([
  'start', 'server', 'queue', 'pick', 'guards', 'orders', 'sbot', 'debug', 'ipc',
  'browser', 'youtube', 'soundcloud', 'local', 'viz', 'fullscreen', 'quit',
]);

export const SCENARIO_LABELS = Object.freeze({
  start: 'запуск',
  server: 'локальный сервер',
  queue: 'очередь',
  pick: 'пипетка и окно цвета',
  guards: 'защиты путей',
  orders: 'заказ-донат (тестовый)',
  sbot: 'порт Streamer.bot',
  debug: 'снимок отладки',
  ipc: 'каналы только для чтения',
  browser: 'вкладка «Браузер»',
  youtube: 'плеер YouTube',
  soundcloud: 'SoundCloud',
  local: 'файл с компьютера',
  viz: 'визуализатор',
  fullscreen: 'на весь экран',
  // Не сценарий из --only: общая строка «ошибки страницы» в конце отчёта.
  pageerrors: 'ошибки страницы',
  quit: 'выход',
});

// Сценарии, которым нужен интернет: id → хост, до которого проверяем связь.
export const NETWORK_SCENARIOS = Object.freeze({
  browser: 'www.youtube.com',
  youtube: 'www.youtube.com',
  soundcloud: 'api-v2.soundcloud.com',
  // Поиск трека для тестового заказа идёт в Яндекс (первый источник), потом в YouTube.
  orders: 'api.music.yandex.net',
});

export const DEFAULT_SETTINGS = Object.freeze({
  reportsEnabled: false,
  autoUpdate: false,
  streamerMode: false,
  closeAsked: true,
  closeToTray: false,
});

export function defaultSettings(widgetPort = DEFAULT_WIDGET_PORT) {
  return { ...DEFAULT_SETTINGS, widgetPort };
}

export function helpText() {
  return [
    'Живая проверка Тапёра: запускает программу с тестовым профилем и проходит ключевые сценарии.',
    '',
    'Запуск:',
    '  node tools/reliability/live-smoke.mjs --data <папка внутри sandbox> [параметры]',
    '  npm run reliability:smoke -- --data <папка внутри sandbox>',
    '',
    'Параметры:',
    '  --data <папка>     профиль Тапёра; путь обязан содержать часть sandbox (обязательно)',
    '  --electron <путь>  путь к electron (по умолчанию node_modules/.bin/electron)',
    `  --port N           порт отладки (по умолчанию ${DEFAULT_PORT})`,
    `  --widget-port N    порт локального сервера и панели OBS (по умолчанию ${DEFAULT_WIDGET_PORT})`,
    '  --only <список>    сценарии через запятую; quit всегда выполняется последним',
    '  --queue <файл>     подложить очередь в today.json: JSON-список треков или { items: [...] }',
    `  --out <файл>       отчёт .md (по умолчанию ${DEFAULT_OUT})`,
    '  --help             эта справка',
    '',
    'Сценарии: ' + SCENARIOS.join(', ') + '.',
    'Сценарии browser, youtube, soundcloud и orders требуют интернета; без сети они пропускаются.',
    'Сценарии local, viz и fullscreen работают с локальным файлом: в папке профиля создаётся music/' + LOCAL_WAV_NAME + '.',
    '  orders — пробный заказ тем же путём, что настоящий донат (мост reqTest → req-test → onDonation → requests.json).',
    '  sbot   — GET /sb/status на локальном сервере без ключа: ждём 401 (до готовности порта — 503, повтор до 10 с).',
    '  debug  — window.app.debugState(): снимок раздела «Отладка» без поля error.',
    '  ipc    — обход только методов моста из белого списка (только чтение, без диалогов и записи); список — в live-smoke-lib.mjs.',
    'Нужен установленный Electron: npm ci без ELECTRON_SKIP_BINARY_DOWNLOAD (или --electron).',
    'Инструмент открывает окно и играет звук — запускать на ПК владельца, когда он не на стриме.',
  ].join('\n');
}

function validatePort(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(name + ': нужно целое число от 1 до 65535');
  }
}

export function parseOnly(value) {
  const list = String(value == null ? '' : value).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new Error('--only: пустой список сценариев');
  const unknown = list.filter((s) => !SCENARIOS.includes(s));
  if (unknown.length) throw new Error('--only: неизвестные сценарии: ' + unknown.join(', '));
  // Возвращаем в общем порядке: quit не должен оказаться раньше остальных.
  return SCENARIOS.filter((s) => list.includes(s));
}

export function parseArgs(argv, cwd = process.cwd()) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const opts = {
    data: null,
    electron: null,
    port: DEFAULT_PORT,
    widgetPort: DEFAULT_WIDGET_PORT,
    only: SCENARIOS.slice(),
    out: null,
    queue: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    let name = arg;
    let inline = null;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) { name = arg.slice(0, eq); inline = arg.slice(eq + 1); }
    const take = () => {
      if (inline !== null) return inline;
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error('Параметр ' + name + ' требует значение');
      return value;
    };
    switch (name) {
      case '--data': opts.data = take(); break;
      case '--electron': opts.electron = take(); break;
      case '--port': opts.port = Number(take()); break;
      case '--widget-port': opts.widgetPort = Number(take()); break;
      case '--only': opts.only = parseOnly(take()); break;
      case '--out': opts.out = take(); break;
      case '--queue': opts.queue = take(); break;
      default: throw new Error('Неизвестный параметр: ' + arg);
    }
  }

  if (opts.help) return opts;
  opts.data = checkDataDir(opts.data);
  validatePort('--port', opts.port);
  validatePort('--widget-port', opts.widgetPort);
  opts.electron = opts.electron ? path.resolve(cwd, opts.electron) : null;
  opts.out = opts.out ? path.resolve(cwd, opts.out) : path.resolve(cwd, DEFAULT_OUT);
  opts.queue = opts.queue ? path.resolve(cwd, opts.queue) : null;
  return opts;
}

// День очереди в интерфейсе начинается в 6 утра (стримы идут за полночь) — та же формула.
export function streamDay(date = new Date()) {
  const d = new Date(date.getTime() - 6 * 3600 * 1000);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

export function normalizeQueueItem(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('--queue: трек ' + (index + 1) + ' — не объект');
  }
  const title = String(raw.title == null ? '' : raw.title).trim();
  if (!title) throw new Error('--queue: у трека ' + (index + 1) + ' нет названия (title)');
  const item = { ...raw, title };
  if (!item.src) item.src = 'ym';
  if (!item.id) item.id = 'live-smoke-' + (index + 1);
  return item;
}

export function queueItemsFromJson(data) {
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object' && Array.isArray(data.items)) list = data.items;
  else throw new Error('--queue: нужен JSON-список треков или объект с полем items');
  if (!list.length) throw new Error('--queue: пустой список треков');
  return list.map(normalizeQueueItem);
}

export function parseQueueFile(text) {
  let data;
  try { data = JSON.parse(String(text == null ? '' : text).replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error('--queue: файл не разобрать как JSON (' + (e.message || e) + ')'); }
  return queueItemsFromJson(data);
}

export function buildToday(items, opts = {}) {
  const list = (Array.isArray(items) ? items : []).map(normalizeQueueItem);
  if (!list.length) throw new Error('--queue: пустой список треков');
  const current = Number.isInteger(opts.current)
    ? Math.max(0, Math.min(list.length - 1, opts.current))
    : 0;
  const pos = Number(opts.pos);
  return {
    day: typeof opts.day === 'string' && opts.day ? opts.day : streamDay(opts.now || new Date()),
    items: list,
    current,
    pos: Number.isFinite(pos) && pos > 0 ? pos : 0,
    playing: opts.playing === true,
  };
}

// ── вердикты по ответам ─────────────────────────────────────────────────────────────────────────
export function httpStatusVerdict(expected, res) {
  const status = res && Number(res.status);
  if (!Number.isFinite(status)) return { ok: false, reason: 'нет ответа' };
  return status === expected
    ? { ok: true, reason: 'код ' + status }
    : { ok: false, reason: 'код ' + status + ' вместо ' + expected };
}

export function widgetHeadersVerdict(headers) {
  const h = headers || {};
  const csp = String(h['content-security-policy'] || '');
  const xfo = String(h['x-frame-options'] || '');
  const frameAncestors = /frame-ancestors\b/i.test(csp);
  const xFrameOptions = /(?:^|\s)(?:SAMEORIGIN|DENY)(?:\s|$)/i.test(xfo);
  return {
    ok: frameAncestors && xFrameOptions,
    frameAncestors,
    xFrameOptions,
    reason: 'frame-ancestors: ' + (frameAncestors ? 'есть' : 'нет')
      + ', X-Frame-Options: ' + (xFrameOptions ? xfo.trim() : 'нет'),
  };
}

export function logCrashLines(text) {
  return String(text == null ? '' : text).split(/\r?\n/).filter((line) =>
    /главный процесс:\s*(?:необработанная ошибка|необработанное отклонение)/i.test(line));
}

// Новые «необработанные ошибки» главного процесса за время сценария: сравниваем журнал
// до и после, чтобы чужой старый сбой не валил проверку каналов.
export function crashDeltaVerdict(beforeText, afterText) {
  const before = logCrashLines(beforeText).length;
  const after = logCrashLines(afterText).length;
  if (after > before) {
    return { ok: false, before, after, added: after - before, reason: 'в журнале появилось «необработанная ошибка»: ' + (after - before) };
  }
  return {
    ok: true,
    before,
    after,
    added: 0,
    reason: before ? 'новых нет (в журнале уже было ' + before + ')' : 'необработанных ошибок нет',
  };
}

// Ответ из кадра плеера: { blocked, type, name } — доступ к parent.app должен быть закрыт.
export function bridgeVerdict(value) {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: 'не удалось проверить: ' + String(value) };
  }
  if (value.blocked === true) {
    return { ok: true, reason: 'доступ закрыт (' + String(value.name || 'SecurityError') + ')' };
  }
  const type = String(value.type || 'undefined');
  if (type === 'undefined') return { ok: true, reason: 'window.app в кадре нет' };
  return { ok: false, reason: 'из кадра доступен window.app (' + type + ')' };
}

export function queueRestored(actualTitles, expectedTitles) {
  const actual = (Array.isArray(actualTitles) ? actualTitles : []).map(String);
  const expected = (Array.isArray(expectedTitles) ? expectedTitles : []).map(String);
  const missing = expected.filter((t) => !actual.includes(t));
  return {
    ok: expected.length > 0 && missing.length === 0,
    missing,
    expected: expected.length,
    actual: actual.length,
  };
}

// ── тестовый заказ (orders) ─────────────────────────────────────────────────────────────────────
// Текст и сумма как у кнопки «Пробный заказ» (src/ui/29-debug.js: «Кино — Кукушка»), но другая
// песня: живая проверка не должна путать свой заказ с ручным.
export const ORDERS_TEST_TEXT = 'Кино — Группа крови';
export const ORDERS_TEST_AMOUNT = 100;
export const ORDERS_TIMEOUT_MS = 60000;

// Ответ моста reqTest: запись из requests.json (main.js: req-test) либо null, если текст пустой.
export function testOrderVerdict(value) {
  if (value === null || value === undefined) {
    return { ok: false, key: '', reason: 'ответ пустой — заказ не создался (пустой текст?)' };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, key: '', reason: 'ответ не объект: ' + typeof value };
  }
  const key = String(value.key == null ? '' : value.key);
  if (!key.startsWith('test:')) {
    return { ok: false, key, reason: 'ключ не начинается с test: (' + (key.slice(0, 40) || 'пусто') + ')' };
  }
  return { ok: true, key, reason: 'ключ ' + key.slice(0, 40) };
}

// Запись о заказе в requests.json профиля: файл — JSON-список, ищем по ключу.
export function requestsKeyVerdict(text, key) {
  let list;
  try { list = JSON.parse(String(text == null ? '' : text).replace(/^\uFEFF/, '')); }
  catch (e) { return { ok: false, count: 0, reason: 'requests.json не разобрать как JSON' }; }
  if (!Array.isArray(list)) return { ok: false, count: 0, reason: 'requests.json — не список' };
  const want = String(key == null ? '' : key);
  const hit = list.find((x) => x && String(x.key || '') === want);
  return {
    ok: !!hit,
    count: list.length,
    reason: hit
      ? 'запись ' + want.slice(0, 40) + ' на месте (всего ' + list.length + ')'
      : 'записи ' + (want ? want.slice(0, 40) : '?') + ' нет (всего ' + list.length + ')',
  };
}

// ── порт Streamer.bot (sbot) ────────────────────────────────────────────────────────────────────
// Адрес — src/main/local-server.js: префикс /sb/* отдаёт src/sbot-port.js. Без ключа — 401,
// а до создания порта — 503 starting (src/sbot-port.js: startingReply).
export const SBOT_PROBE_PATH = '/sb/status';
export const SBOT_STARTING_RETRY_MS = 10000;

export function sbotStatusVerdict(status) {
  const code = Number(status);
  if (!Number.isFinite(code)) return { ok: false, retry: false, reason: 'нет ответа' };
  if (code === 401) return { ok: true, retry: false, reason: 'без ключа — код 401' };
  if (code === 503) return { ok: false, retry: true, reason: 'порт ещё не готов — код 503, повтор' };
  return { ok: false, retry: false, reason: 'код ' + code + ' вместо 401' };
}

// ── снимок отладки (debug) ──────────────────────────────────────────────────────────────────────
// Ключи верхнего уровня, которые читает окно (src/ui/29-debug.js: s.version, s.build, s.commit,
// s.channel, s.license, s.pack, s.modules, s.logins, s.autofix, s.autofixDetail, s.watchdog,
// s.dataDir, s.testProfile, s.fault, s.load, s.verbose). Их отдаёт debugGather в main.js.
export const DEBUG_STATE_KEYS = Object.freeze([
  'version', 'build', 'buildText', 'commit', 'channel', 'channelText', 'license', 'pack',
  'modules', 'logins', 'autofix', 'autofixDetail', 'testProfile', 'watchdog', 'dataDir',
  'fault', 'load', 'verbose',
]);

// Ответ моста debugState: { ok: true, state } либо { ok: false, error }.
// Провал — не объект, ошибка главного процесса, поле error в состоянии или нехватка ключей.
export function debugStateVerdict(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, missing: [], reason: 'ответ не объект' };
  }
  if (value.ok !== true) {
    return { ok: false, missing: [], reason: 'главный процесс ответил ошибкой: ' + String(value.error || 'без текста').slice(0, 120) };
  }
  const state = value.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, missing: [], reason: 'в ответе нет объекта state' };
  }
  if (Object.prototype.hasOwnProperty.call(state, 'error')) {
    return { ok: false, missing: [], reason: 'в состоянии есть поле error' };
  }
  const missing = DEBUG_STATE_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(state, k));
  if (missing.length) return { ok: false, missing, reason: 'нет ключей: ' + missing.join(', ') };
  return { ok: true, missing: [], reason: 'ключей ' + DEBUG_STATE_KEYS.length + ', поля error нет' };
}

// ── каналы «только чтение» (ipc) ────────────────────────────────────────────────────────────────
// Явный белый список методов window.app (src/preload.js). Каждый проверен по главному процессу:
// возвращает уже прочитанное состояние, ничего не меняет, не открывает окон и диалогов,
// не запускает воспроизведение, не пишет файлов и не ходит в сеть. Новый метод сюда — только
// после такой же проверки и с причиной в поле reason.
export const IPC_READONLY_METHODS = Object.freeze([
  { name: 'getVersion', args: [], reason: 'только app.getVersion()' },
  { name: 'buildInfo', args: [], reason: 'только константа BUILD (dev/stable и коммит)' },
  { name: 'updateGetState', args: [], reason: 'состояние обновления из памяти главного процесса' },
  { name: 'updateChannelGet', args: [], reason: 'чтение выбранного канала обновлений' },
  { name: 'updateChannelOffer', args: [], reason: 'ранее полученное предложение другого канала из памяти' },
  { name: 'ytState', args: [], reason: 'флаги «YouTube не отвечает» из памяти' },
  { name: 'qcGet', args: [], reason: 'сохранённый результат быстрой проверки' },
  { name: 'healthGet', args: [], reason: 'сохранённый результат глубокой проверки' },
  { name: 'autofixGet', args: [], reason: 'снимок счётчиков автопочинки' },
  { name: 'storageEncrypted', args: [], reason: 'проверка доступности шифрования (safeStorage, только чтение)' },
  { name: 'reportPreview', args: [], reason: 'последний отчёт об ошибке из памяти' },
  { name: 'libStatus', args: [], reason: 'состояние библиотеки из памяти' },
  { name: 'libAll', args: [], reason: 'список уже прочитанных треков библиотеки' },
  { name: 'libSearch', args: ['', 1], reason: 'поиск по уже прочитанной библиотеке в памяти' },
  { name: 'libFolderTracks', args: ['live-smoke-no-such-folder'], reason: 'список файлов только своей папки библиотеки; чужой путь — пусто' },
  { name: 'debugState', args: [], reason: 'снимок раздела «Отладка»: чтение состояния, без сбросов' },
  { name: 'debugProfile', args: [], reason: 'признак тестового профиля и папка данных' },
  { name: 'debugBackups', args: [], reason: 'список автокопий из папки профиля (только чтение)' },
  { name: 'faultGet', args: [], reason: 'состояние имитации сбоев из памяти' },
  { name: 'brZoom', args: ['live-smoke-none'], reason: 'масштаб сайта вкладки «Браузер» (чтение; нет вкладки — отказ)' },
  { name: 'brAudible', args: ['live-smoke-none'], reason: 'звучит ли сайт вкладки «Браузер» (чтение; нет вкладки — false)' },
  { name: 'ytAuthStatus', args: [], reason: 'признаки входа в YouTube без значений ключей' },
  { name: 'widgetUrl', args: [], reason: 'адрес локального сервера' },
  { name: 'getSetting', args: ['theme'], reason: 'чтение настройки; скрытые ключи главный процесс не отдаёт' },
  { name: 'mojibakeCheck', args: [], reason: 'проверка кракозябр в своих плейлистах без исправления' },
  { name: 'uiZoomGet', args: [], reason: 'текущий масштаб окна' },
  { name: 'reqList', args: [], reason: 'список заказов из памяти' },
  { name: 'modStatus', args: [], reason: 'состояние модулей из памяти' },
  { name: 'sbotStatus', args: [], reason: 'состояние пульта Streamer.bot из памяти' },
  { name: 'sbotGlobals', args: [], reason: 'tapyor-переменные из Streamer.bot (копия, без записи)' },
  { name: 'donStatus', args: [], reason: 'состояния донат-сервисов без ключей' },
  { name: 'siteStatus', args: [], reason: 'состояние сайта-визитки' },
  { name: 'npPath', args: [], reason: 'путь файла «сейчас играет» (чтение; не печатается)' },
]);

export const IPC_CALL_TIMEOUT_MS = 20000;

// Выражение окна для одного вызова: нет метода или отказ промиса — это { ok: false },
// а не исключение страницы (иначе прогон упадёт на строке «ошибки страницы»).
export function ipcCallExpression(name, args) {
  const method = JSON.stringify(String(name == null ? '' : name));
  const list = JSON.stringify(Array.isArray(args) ? args : []);
  return '(function () { try {'
    + ' if (!window.app || typeof window.app[' + method + '] !== \'function\')'
    + ' return Promise.resolve({ ok: false, error: true });'
    + ' return Promise.resolve(window.app[' + method + '].apply(window.app, ' + list + '))'
    + '.then(function (v) { return { ok: true, value: v }; }, function (e) { return { ok: false, error: true }; });'
    + ' } catch (e) { return Promise.resolve({ ok: false, error: true }); } })()';
}

// Итог вызова: «ответ получен без исключения» = промис разрешился (outer.ok === true),
// даже если сам метод вернул null или { error }.
export function ipcCallVerdict(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'ответ не получен' };
  if (value.ok !== true) return { ok: false, reason: 'вызов завершился ошибкой в окне' };
  return { ok: true, reason: 'ответ получен' };
}


// ── консоль и CSP ───────────────────────────────────────────────────────────────────────────────
const CSP_TEXT = /content security policy|refused to/i;

function entryText(entry) {
  if (typeof entry === 'string') return entry;
  return String(entry && entry.text || '');
}

// Известное нарушение: hls.js создаёт работника из blob:, а в CSP окна worker-src нет.
export function isKnownWorkerCsp(text) {
  const s = String(text || '');
  return CSP_TEXT.test(s) && /worker/i.test(s) && /blob:/i.test(s);
}

export function splitCspViolations(entries) {
  const unexpected = [];
  const known = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const text = entryText(entry);
    if (!CSP_TEXT.test(text)) continue;
    const key = text.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    (isKnownWorkerCsp(text) ? known : unexpected).push(text);
  }
  return { unexpected, known };
}

// ── пипетка и «Отмена» ──────────────────────────────────────────────────────────────────────────
export function normalizeHex(value) {
  const s = String(value == null ? '' : value).trim().replace(/^#/, '').toUpperCase();
  return s ? '#' + s : '';
}

export function pickCancelVerdict(o) {
  const start = normalizeHex(o && o.start);
  const after = normalizeHex(o && o.after);
  const picked = Array.isArray(o && o.picked) ? o.picked : [];
  const last = picked.length ? normalizeHex(picked[picked.length - 1]) : '';
  const colorBack = !!start && after === start;
  const callbackBack = !!start && last === start;
  return { ok: colorBack && callbackBack, colorBack, callbackBack, start, after, last };
}

// ── перемотка YouTube ──────────────────────────────────────────────────────────────────────────
// Запас: страница плеера присылает время раз в 250 мс, плюс время на сам seekTo.
export const SEEK_SLACK_SEC = 2;

// Решение «перемотка прошла»: после перемотки время должно догнать цель и не убежать
// дальше, чем позволяет прошедшее время (цель + сколько ждали + запас).
// before — время до перемотки (для подробностей), target — куда перематывали,
// after — прочитанное время, elapsedSec — сколько секунд прошло с команды перемотки.
export function seekVerdict(o) {
  const before = Number(o && o.before);
  const target = Number(o && o.target);
  const after = Number(o && o.after);
  const rawElapsed = Number(o && o.elapsedSec);
  if (!Number.isFinite(target) || target < 0) return { ok: false, reason: 'нет цели перемотки' };
  if (!Number.isFinite(after) || after < 0) return { ok: false, reason: 'нет времени плеера' };
  const elapsedSec = Number.isFinite(rawElapsed) && rawElapsed > 0 ? rawElapsed : 0;
  const max = target + elapsedSec + SEEK_SLACK_SEC;
  const out = { before, target, after, elapsedSec, min: target, max };
  if (after < target) {
    return {
      ...out,
      ok: false,
      reason: 'время ' + after.toFixed(1) + ' с меньше цели ' + target + ' с',
    };
  }
  if (after > max) {
    return {
      ...out,
      ok: false,
      reason: 'время ' + after.toFixed(1) + ' с больше ' + max.toFixed(1)
        + ' с — не сходится с прошедшим временем',
    };
  }
  return {
    ...out,
    ok: true,
    reason: 'время ' + after.toFixed(1) + ' с (цель ' + target + ' с, прошло '
      + elapsedSec.toFixed(1) + ' с, допуск до ' + max.toFixed(1) + ' с)',
  };
}

// ── тестовый WAV и визуализатор ────────────────────────────────────────────────────────────────
export const WAV_HEADER_BYTES = 44;

// Короткий тон для проверки «файл с компьютера»: PCM WAV без ffmpeg.
// По умолчанию — 4 с, 440 Гц, 16 бит, моно, 44 100 Гц.
export function wavTone(opts = {}) {
  const seconds = Number(opts.seconds) > 0 ? Number(opts.seconds) : 4;
  const freq = Number(opts.freq) > 0 ? Number(opts.freq) : 440;
  const sampleRate = Number.isInteger(opts.sampleRate) && opts.sampleRate > 0 ? opts.sampleRate : 44100;
  const channels = Number(opts.channels) === 2 ? 2 : 1;
  const bits = Number(opts.bits) === 8 ? 8 : 16;
  const bytesPerSample = bits / 8;
  const blockAlign = channels * bytesPerSample;
  const frames = Math.max(1, Math.round(seconds * sampleRate));
  const dataSize = frames * blockAlign;
  const buf = Buffer.alloc(WAV_HEADER_BYTES + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);            // размер блока fmt
  buf.writeUInt16LE(1, 20);             // PCM без сжатия
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28); // байт в секунду
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  const amplitude = bits === 8 ? 100 : 12000;
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * amplitude);
    const at = WAV_HEADER_BYTES + i * blockAlign;
    if (bits === 8) {
      const u = Math.max(0, Math.min(255, v + 128));
      buf.writeUInt8(u, at);
      if (channels === 2) buf.writeUInt8(u, at + 1);
    } else {
      buf.writeInt16LE(v, at);
      if (channels === 2) buf.writeInt16LE(v, at + 2);
    }
  }
  return buf;
}

// Решение «визуализатор работает»: холст виден, у него есть размер и кадр за 2 с изменился.
// capture / captureFailed — только для подробностей: без захвата окно рисует запасную волну.
export function vizFrameVerdict(o) {
  const visible = !!(o && o.visible === true);
  const width = Number(o && o.canvasWidth);
  const height = Number(o && o.canvasHeight);
  const changed = !!(o && o.changed === true);
  const capture = !!(o && o.capture === true);
  const captureFailed = !!(o && o.captureFailed === true);
  const captureText = capture ? 'есть' : (captureFailed ? 'не вышел — запасная волна' : 'нет');
  const base = { visible, width, height, changed, capture, captureFailed };
  if (!visible) return { ...base, ok: false, reason: 'визуализатор не виден в окне' };
  if (!(width > 0) || !(height > 0)) {
    return { ...base, ok: false, reason: 'холст визуализатора нулевого размера' };
  }
  if (!changed) return { ...base, ok: false, reason: 'кадр за 2 с не изменился' };
  return {
    ...base,
    ok: true,
    reason: 'холст ' + width + '×' + height + ', кадр меняется; захват звука окна: ' + captureText,
  };
}

// Общая строка «ошибки страницы» в конце прогона: пустой список — прошёл,
// непустой — «не прошёл» и первые три текста (пути вычищены).
export function pageErrorsVerdict(entries) {
  const list = (Array.isArray(entries) ? entries : [])
    .map((e) => scrubPaths(String(e == null ? '' : e)).split(/\r?\n/)[0].trim().slice(0, 200))
    .filter(Boolean);
  if (!list.length) return { ok: true, count: 0, details: ['необработанных ошибок страницы нет'] };
  return {
    ok: false,
    count: list.length,
    details: ['необработанных ошибок страницы: ' + list.length + ' — ' + list.slice(0, 3).join(' | ')],
  };
}

// ── выход и сеть ────────────────────────────────────────────────────────────────────────────────
export function exitVerdict(exited, forced) {
  if (exited) return { ok: true, reason: 'процесс вышел штатно' };
  if (forced) return { ok: false, reason: 'не вышел штатно — процесс завершён принудительно' };
  return { ok: false, reason: 'не вышел за отведённое время' };
}

export function networkSkip(id, available) {
  const host = NETWORK_SCENARIOS[id];
  if (!host || available === true) return null;
  return 'нужен интернет — нет связи с ' + host;
}

// ── цели CDP ────────────────────────────────────────────────────────────────────────────────────
export function targetHost(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase(); }
  catch (e) { return ''; }
}

export function pickTargets(targets) {
  return (Array.isArray(targets) ? targets : [])
    .filter((t) => t && /pick\.html/i.test(String(t.url || '')));
}

export function findWebviewTarget(targets, host) {
  const want = String(host || '').toLowerCase();
  if (!want) return null;
  return (Array.isArray(targets) ? targets : []).find((t) => {
    if (String(t && t.type).toLowerCase() !== 'webview') return false;
    const h = targetHost(t.url);
    return h === want || h.endsWith('.' + want);
  }) || null;
}

// ── текст отчёта ────────────────────────────────────────────────────────────────────────────────
export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1000) return Math.round(n) + ' мс';
  if (n < 60000) return (n / 1000).toFixed(1) + ' с';
  const min = Math.floor(n / 60000);
  const sec = Math.round((n % 60000) / 1000);
  return min + ' мин ' + sec + ' с';
}

export function statusText(status) {
  return status === 'passed' ? 'прошёл' : status === 'skipped' ? 'пропущен' : 'не прошёл';
}

export function scenarioTally(results) {
  const out = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const r of Array.isArray(results) ? results : []) {
    out.total++;
    if (r && r.status === 'passed') out.passed++;
    else if (r && r.status === 'skipped') out.skipped++;
    else out.failed++;
  }
  return out;
}

export function scrubPaths(text) {
  return String(text == null ? '' : text).replace(/[A-Za-z]:[\\/][^\s"'<>|)]*/g, '<путь>');
}

function cell(text) {
  return String(text == null ? '' : text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export function formatReport(meta, results) {
  const m = meta || {};
  const list = Array.isArray(results) ? results : [];
  const tally = scenarioTally(list);
  const lines = [];
  lines.push('# Живая проверка Тапёра');
  lines.push('');
  lines.push('- Время: ' + (m.startedAt || '?'));
  lines.push('- Длительность: ' + formatDuration(m.elapsedMs));
  lines.push('- Electron: ' + (m.electronVersion || '?'));
  lines.push('- Коммит: ' + (m.commit || '?'));
  if (m.command) lines.push('- Запуск: `' + m.command + '`');
  if (m.exit) lines.push('- Выход: ' + (m.exit.verdict ? m.exit.verdict.reason : exitVerdict(m.exit.exited, m.exit.forced).reason));
  if (m.error) lines.push('- Ошибка проверки: ' + scrubPaths(m.error));
  lines.push('');
  lines.push('Итог: ' + tally.passed + ' прошло, ' + tally.failed + ' не прошло, '
    + tally.skipped + ' пропущено (всего ' + tally.total + ').');
  lines.push('');
  lines.push('| Сценарий | Итог | Время | Что проверено |');
  lines.push('|---|---|---|---|');
  if (!list.length) {
    lines.push('| — | — | — | сценарии не выполнялись |');
  }
  for (const r of list) {
    const id = String(r && r.id || '?');
    const label = SCENARIO_LABELS[id] || id;
    const net = r && r.network ? ' (нужен интернет)' : '';
    const details = (Array.isArray(r && r.details) ? r.details : []).map(scrubPaths).join('; ');
    lines.push('| ' + cell(id + ' — ' + label + net) + ' | ' + statusText(r && r.status)
      + ' | ' + formatDuration(r && r.elapsedMs) + ' | ' + cell(details || '—') + ' |');
  }
  lines.push('');
  return lines.join('\n');
}
