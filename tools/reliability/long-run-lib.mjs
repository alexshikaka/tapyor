// Чистые помощники инструмента «4 часа» (tools/reliability/long-run.mjs):
// разбор параметров и вывода PowerShell, дерево процессов, тренд и вердикт.
// Здесь нет запуска Electron и обращений к окну — это покрыто unit-тестами.
import path from 'node:path';

export const DEFAULT_MINUTES = 240;
export const DEFAULT_PORT = 9335;
export const DEFAULT_OUT = 'tools/reliability/long-run-result.jsonl';

export const DEFAULT_SETTINGS = Object.freeze({
  reportsEnabled: false,
  autoUpdate: false,
  streamerMode: false,
  closeAsked: true,
  closeToTray: false,
  widgetPort: 47997,
});

export const FILE_NAMES = Object.freeze(['log.txt', 'settings.json', 'today.json']);
export const ROLE_LABELS = Object.freeze({
  main: 'главный',
  window: 'окно',
  gpu: 'GPU',
  utility: 'утилиты',
  other: 'прочее',
});

const ROLES = Object.freeze(['main', 'window', 'gpu', 'utility', 'other']);

export function defaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

// Профиль обязан лежать внутри sandbox: иначе инструмент может открыть настоящий
// профиль владельца (TAPYOR_USER_DATA) и помешать идущему стриму.
export function checkDataDir(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Укажите --data <папка>: профиль обязан лежать внутри sandbox');
  }
  const abs = path.resolve(input.trim());
  const parts = abs.split(/[\\/]+/).filter(Boolean).map((s) => s.toLowerCase());
  if (!parts.includes('sandbox')) {
    throw new Error('Отказ: в пути --data нет части sandbox (например, D:\\work\\sandbox\\long-run-data)'); // export-scan:allow — пример пути в подсказке, выдуманный
  }
  return abs;
}

export function helpText() {
  return [
    'Инструмент «4 часа»: замер памяти, ЦП, кучи и DOM Тапёра.',
    '',
    'Запуск:',
    '  node tools/reliability/long-run.mjs --data <папка внутри sandbox> [параметры]',
    '',
    'Параметры:',
    `  --minutes N     сколько минут работать (по умолчанию ${DEFAULT_MINUTES})`,
    '  --data <папка>  профиль Тапёра; путь обязан содержать часть sandbox (обязательно)',
    `  --port N        порт отладки (по умолчанию ${DEFAULT_PORT})`,
    `  --out <файл>    куда писать строки JSONL (по умолчанию ${DEFAULT_OUT})`,
    '  --help          эта справка',
    '',
    'Раз в минуту пишет память и ЦП каждого процесса программы, число целей отладки,',
    'размеры log.txt/settings.json/today.json, кучу окна и число узлов DOM.',
    'В конце закрывает программу штатно и печатает вердикт по тренду за вторую половину.',
  ].join('\n');
}

export function parseArgs(argv, cwd = process.cwd()) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const opts = { minutes: DEFAULT_MINUTES, port: DEFAULT_PORT, data: null, out: null, help: false };

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
      case '--minutes': opts.minutes = Number(take()); break;
      case '--port': opts.port = Number(take()); break;
      case '--data': opts.data = take(); break;
      case '--out': opts.out = take(); break;
      default: throw new Error('Неизвестный параметр: ' + arg);
    }
  }

  if (opts.help) return opts;
  opts.data = checkDataDir(opts.data);
  if (!Number.isFinite(opts.minutes) || opts.minutes <= 0) {
    throw new Error('--minutes: нужно положительное число минут');
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    throw new Error('--port: нужно целое число от 1 до 65535');
  }
  opts.out = opts.out ? path.resolve(cwd, opts.out) : path.resolve(cwd, DEFAULT_OUT);
  return opts;
}

export function parseTargets(text) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((t) => t && typeof t === 'object') : [];
  } catch (e) {
    return [];
  }
}

export function pickPage(targets) {
  const pages = (Array.isArray(targets) ? targets : []).filter((t) => t && t.type === 'page');
  return pages.find((t) => /index\.html/i.test(String(t.url || '')))
    || pages.find((t) => /Тапёр|Tapyor/i.test(String(t.title || '')))
    || pages[0]
    || null;
}

export function evalValue(message) {
  if (!message || typeof message !== 'object') throw new Error('Пустой ответ CDP');
  if (message.error) throw new Error(String(message.error.message || message.error));
  const details = message.result && message.result.exceptionDetails;
  if (details) {
    const text = (details.exception && (details.exception.description || details.exception.value))
      || details.text || 'Ошибка в окне';
    throw new Error(String(text));
  }
  return message.result && message.result.result ? message.result.result.value : undefined;
}

function markedJson(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const begin = s.indexOf('LONGRUN_JSON_BEGIN');
  const end = s.indexOf('LONGRUN_JSON_END');
  if (begin >= 0 && end > begin) return s.slice(begin + 'LONGRUN_JSON_BEGIN'.length, end).trim();
  return s.trim();
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseProcesses(text) {
  const raw = markedJson(text);
  if (!raw) return [];
  let data;
  try { data = JSON.parse(raw); } catch (e) { return []; }
  const list = Array.isArray(data) ? data : [data];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const pid = num(item.pid ?? item.ProcessId);
    if (pid === null) continue;
    const parentPid = num(item.parentPid ?? item.ParentProcessId) ?? 0;
    const memory = num(item.memory ?? item.WorkingSet64 ?? item.WorkingSetSize);
    const cpuSec = num(item.cpuSec ?? item.CpuSec);
    out.push({
      pid,
      parentPid,
      name: String(item.name ?? item.Name ?? ''),
      commandLine: String(item.cmd ?? item.CommandLine ?? ''),
      memoryBytes: Math.max(0, memory ?? 0),
      cpuSec: Math.max(0, cpuSec ?? 0),
    });
  }
  return out;
}

export function buildProcessTree(all, rootPid) {
  const list = (Array.isArray(all) ? all : []).filter((p) => p && Number.isFinite(p.pid));
  const byParent = new Map();
  const byPid = new Map();
  for (const p of list) {
    byPid.set(p.pid, p);
    const parent = Number.isFinite(p.parentPid) ? p.parentPid : 0;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(p);
  }
  const out = [];
  const seen = new Set();
  const queue = [Number(rootPid)];
  while (queue.length) {
    const pid = queue.shift();
    if (!Number.isFinite(pid) || seen.has(pid)) continue;
    seen.add(pid);
    const p = byPid.get(pid);
    if (p) out.push(p);
    for (const child of byParent.get(pid) || []) {
      if (!seen.has(child.pid)) queue.push(child.pid);
    }
  }
  return out;
}

export function classifyRole(proc, rootPid) {
  const cmd = String(proc && proc.commandLine || '').toLowerCase();
  const name = String(proc && proc.name || '').toLowerCase();
  if (cmd.includes('--type=renderer')) return 'window';
  if (cmd.includes('--type=gpu-process')) return 'gpu';
  if (cmd.includes('--type=utility')) return 'utility';
  if (Number(proc && proc.pid) === Number(rootPid) && /electron/.test(name)) return 'main';
  if (/electron/.test(name) && !cmd.includes('--type=')) return 'main';
  return 'other';
}

// previous — Map(pid → суммарные секунды ЦП на прошлом замере).
export function cpuPercents(tree, previous, dtSec) {
  const prev = previous instanceof Map
    ? previous
    : new Map(Object.entries(previous || {}).map(([k, v]) => [Number(k), Number(v)]));
  const current = new Map();
  const out = (Array.isArray(tree) ? tree : []).map((p) => {
    const before = prev.get(Number(p.pid));
    const now = Number(p.cpuSec);
    let cpuPct = null;
    if (Number.isFinite(before) && Number.isFinite(now) && now >= before && dtSec > 0) {
      cpuPct = (now - before) / dtSec * 100;
    }
    current.set(Number(p.pid), now);
    return { ...p, cpuPct };
  });
  return { tree: out, current };
}

export function secondHalf(samples) {
  const valid = (Array.isArray(samples) ? samples : []).filter((s) => s && Number.isFinite(s.elapsedSec));
  if (!valid.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const s of valid) { if (s.elapsedSec < min) min = s.elapsedSec; if (s.elapsedSec > max) max = s.elapsedSec; }
  const mid = min + (max - min) / 2;
  return valid.filter((s) => s.elapsedSec >= mid);
}

// x — секунды, y — значение. growthPerHour — прирост в час (y * 3600 / x).
export function linearTrend(points) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) {
    return { n: pts.length, enough: false, mean: null, growthPerHour: null, growthPct: null, growing: false };
  }
  let sumX = 0;
  let sumY = 0;
  for (const p of pts) { sumX += p.x; sumY += p.y; }
  const meanX = sumX / pts.length;
  const meanY = sumY / pts.length;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    const dx = p.x - meanX;
    num += dx * (p.y - meanY);
    den += dx * dx;
  }
  if (den === 0) {
    return { n: pts.length, enough: false, mean: meanY, growthPerHour: null, growthPct: null, growing: false };
  }
  const slope = num / den;
  const growthPerHour = slope * 3600;
  const threshold = Math.abs(meanY) * 0.1;
  const growing = growthPerHour > threshold;
  return {
    n: pts.length,
    enough: true,
    mean: meanY,
    slopePerHour: slope,
    growthPerHour,
    growthPct: meanY === 0 ? (growthPerHour === 0 ? 0 : null) : growthPerHour / meanY * 100,
    threshold,
    growing,
  };
}

function sumField(list, pick) {
  let sum = 0;
  let n = 0;
  for (const item of Array.isArray(list) ? list : []) {
    const value = pick(item);
    if (Number.isFinite(value)) { sum += value; n++; }
  }
  return n ? sum : null;
}

const procsOf = (sample) => Array.isArray(sample.processes) ? sample.processes : [];
const roleOf = (sample, role) => procsOf(sample).filter((p) => p.role === role);

function metricDefs() {
  const defs = [
    { key: 'memory_total', label: 'память: всего', unit: 'bytes', get: (s) => sumField(procsOf(s), (p) => p.memoryBytes) },
  ];
  for (const role of ROLES) {
    defs.push({
      key: 'memory_' + role,
      label: 'память: ' + ROLE_LABELS[role],
      unit: 'bytes',
      get: (s) => sumField(roleOf(s, role), (p) => p.memoryBytes),
    });
  }
  defs.push({ key: 'cpu_total', label: 'ЦП: всего', unit: 'percent', get: (s) => sumField(procsOf(s), (p) => p.cpuPct) });
  for (const role of ROLES) {
    defs.push({
      key: 'cpu_' + role,
      label: 'ЦП: ' + ROLE_LABELS[role],
      unit: 'percent',
      get: (s) => sumField(roleOf(s, role), (p) => p.cpuPct),
    });
  }
  defs.push(
    { key: 'processes', label: 'процессов', unit: 'count', get: (s) => procsOf(s).length },
    { key: 'heap', label: 'куча окна', unit: 'bytes', get: (s) => s.heapUsedBytes },
    { key: 'dom', label: 'узлы DOM', unit: 'count', get: (s) => s.domNodes },
    { key: 'targets', label: 'целей отладки', unit: 'count', get: (s) => s.targets },
  );
  for (const name of FILE_NAMES) {
    defs.push({
      key: 'file_' + name.replace(/\W/g, '_'),
      label: 'файл ' + name,
      unit: 'bytes',
      get: (s) => s.files && s.files[name],
    });
  }
  return defs;
}

export function buildVerdict(samples) {
  const list = (Array.isArray(samples) ? samples : []).filter((s) => s && Number.isFinite(s.elapsedSec));
  const half = secondHalf(list);
  const metrics = metricDefs().map((def) => {
    const points = half
      .map((s) => ({ x: s.elapsedSec, y: def.get(s) }))
      .filter((p) => Number.isFinite(p.y));
    return { key: def.key, label: def.label, unit: def.unit, ...linearTrend(points) };
  });
  return { samples: list.length, secondHalf: half.length, metrics, growing: metrics.filter((m) => m.growing) };
}

function formatGrowth(value, unit) {
  if (!Number.isFinite(value)) return 'нет данных';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (unit === 'percent') return sign + abs.toFixed(2) + ' %/ч';
  if (unit === 'bytes') {
    if (abs >= 1048576) return sign + (abs / 1048576).toFixed(1) + ' МБ/ч';
    if (abs >= 1024) return sign + (abs / 1024).toFixed(1) + ' КБ/ч';
    return sign + Math.round(abs) + ' Б/ч';
  }
  return sign + Math.round(abs) + '/ч';
}

export function formatMetric(metric) {
  const label = metric && metric.label || 'показатель';
  if (!metric || !metric.enough) return label + ': мало данных (' + ((metric && metric.n) || 0) + ' точ.)';
  const growth = formatGrowth(metric.growthPerHour, metric.unit);
  const pct = metric.mean === 0
    ? (metric.growthPerHour === 0 ? '0 %' : 'среднее 0')
    : (metric.growthPct === null ? 'среднее 0' : metric.growthPct.toFixed(1) + ' %');
  return label + ': ' + growth + ' (' + pct + ' от среднего) — ' + (metric.growing ? 'растёт' : 'не растёт');
}

export function formatVerdict(summary) {
  if (!summary || !Array.isArray(summary.metrics)) return 'Вердикт: нет данных.';
  const lines = ['Вердикт (вторая половина прогона, точек: ' + summary.secondHalf + ' из ' + summary.samples + '):'];
  for (const metric of summary.metrics) lines.push('  ' + formatMetric(metric));
  const growing = summary.metrics.filter((m) => m.growing);
  lines.push('');
  lines.push(growing.length
    ? 'Растут: ' + growing.map((m) => m.label).join(', ')
    : 'Ни один показатель не растёт.');
  return lines.join('\n');
}
