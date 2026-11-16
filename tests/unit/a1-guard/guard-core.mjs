// Общий разбор для стража STAB-GD1 (tests/unit/a1-guard.test.mjs) и сборщика снимка.
// Только чтение исходников: ничего не подключает и не запускает.
// Разбор — espree, области видимости — eslint-scope (обе есть в зависимостях ESLint).
import fs from 'node:fs';
import path from 'node:path';

// Пакеты берём у ESLint, своих зависимостей не заводим. Если их нет (не выполнен npm ci),
// страж падает с понятным сообщением, а не пропускает проверку.
let espree;
let eslintScope;
try {
  [espree, eslintScope] = await Promise.all([import('espree'), import('eslint-scope')]);
} catch (e) {
  throw new Error('Страж STAB-GD1: не удалось подключить espree и eslint-scope. Выполните npm ci. Ошибка: ' + e.message);
}

export const CHANNEL_KINDS = ['ipcMain.handle', 'ipcMain.on', 'app.on', 'powerMonitor.on'];
// Имена «фабрик» модулей: исторически setup(ctx), у новых самостоятельных узлов — create(ctx)
// (например src/main/dock2-hub.js: docs/DOCK2.md). Проверки одинаковые.
const FACTORY_NAMES = new Set(['setup', 'create']);

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const parseCache = new WeakMap();
const scopeCache = new WeakMap();

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Обход AST. parent в узлы не пишем: eslint-scope и espree не должны видеть лишних связей.
function walkAst(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'tokens' || key === 'comments') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visit);
    } else if (value && typeof value.type === 'string') {
      walkAst(value, visit);
    }
  }
}

function indexParents(node, parents) {
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'tokens' || key === 'comments') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') {
          parents.set(child, node);
          indexParents(child, parents);
        }
      }
    } else if (value && typeof value.type === 'string') {
      parents.set(value, node);
      indexParents(value, parents);
    }
  }
}

// Разбирает файл как script, при необходимости — как module (в src есть и CommonJS, и ESM).
// Ошибка разбора не проглатывается: страж должен падать с понятным сообщением, а не пропускаться.
export function parseEntry(entry) {
  const cached = parseCache.get(entry);
  if (cached) return cached;
  const errors = [];
  for (const sourceType of ['script', 'module']) {
    try {
      const ast = espree.parse(entry.source, {
        ecmaVersion: 'latest',
        sourceType,
        range: true,
        loc: true,
        allowHashBang: true,
      });
      const parents = new WeakMap();
      indexParents(ast, parents);
      const parsed = { ast, parents, sourceType, path: entry.path };
      parseCache.set(entry, parsed);
      return parsed;
    } catch (e) {
      errors.push(sourceType + ': ' + e.message);
    }
  }
  throw new Error('Не удалось разобрать ' + entry.path + ' через espree — ' + errors.join('; '));
}

function scopeManagerFor(parsed) {
  let manager = scopeCache.get(parsed);
  if (manager) return manager;
  manager = eslintScope.analyze(parsed.ast, {
    ecmaVersion: 2022,
    sourceType: parsed.sourceType,
    optimistic: true,
    directive: true,
    ignoreEval: true,
    nodejsScope: parsed.sourceType === 'script',
    impliedStrict: false,
  });
  scopeCache.set(parsed, manager);
  return manager;
}

function staticName(keyNode, computed) {
  if (!keyNode) return null;
  if (!computed && keyNode.type === 'Identifier') return keyNode.name;
  if (computed && keyNode.type === 'Literal' && typeof keyNode.value === 'string') return keyNode.value;
  if (keyNode.type === 'Literal' && typeof keyNode.value === 'string') return keyNode.value;
  return null;
}

function requireLiteral(node) {
  if (!node || node.type !== 'CallExpression') return null;
  if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return null;
  const arg = node.arguments[0];
  if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return null;
  return arg.value;
}

function resolveModulePath(fromPath, spec) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return null;
  let target = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), spec));
  if (!target.endsWith('.js')) target += '.js';
  return target;
}

// Все .js под src (пути — от корня, через /). Нужны и снимку, и тесту.
export function walkJsEntries(root, relDir = 'src') {
  const out = [];
  const base = path.join(root, relDir);
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) walk(abs);
      else if (item.name.endsWith('.js')) {
        out.push({ path: toPosix(path.relative(root, abs)), source: fs.readFileSync(abs, 'utf8') });
      }
    }
  }
  walk(base);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// Ровно те файлы, где ищем каналы и подписки: всё src, кроме vendor, собранного ui.js и частей src/ui.
export function readChannelEntries(root) {
  return walkJsEntries(root).filter((e) => {
    if (e.path.startsWith('src/vendor/')) return false;
    if (e.path === 'src/ui.js' || e.path.startsWith('src/ui/')) return false;
    return true;
  });
}

// ---- 1. Каналы IPC и подписки -------------------------------------------------

function channelKind(node) {
  if (!node || node.type !== 'CallExpression') return null;
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression') return null;
  if (callee.object.type !== 'Identifier') return null;
  const method = staticName(callee.property, callee.computed);
  const kind = callee.object.name + '.' + method;
  return CHANNEL_KINDS.includes(kind) ? kind : null;
}

export function collectIpcChannels(entries) {
  const channels = {};
  for (const kind of CHANNEL_KINDS) channels[kind] = {};
  const dynamic = [];
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    walkAst(parsed.ast, (node) => {
      const kind = channelKind(node);
      if (!kind) return;
      const arg = node.arguments[0];
      if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') {
        dynamic.push({ file: entry.path, line: node.loc.start.line, kind, reason: 'имя канала не строковый литерал' });
        return;
      }
      channels[kind][arg.value] = (channels[kind][arg.value] || 0) + 1;
    });
  }
  const sorted = {};
  for (const kind of CHANNEL_KINDS) {
    const names = Object.keys(channels[kind]).sort();
    sorted[kind] = {};
    for (const name of names) sorted[kind][name] = channels[kind][name];
  }
  return { channels: sorted, dynamic };
}

// Сравнение снимка с кодом: возвращает список отличий, чтобы тест объяснил, что именно не так.
export function diffChannels(actual, expected) {
  const diffs = [];
  const kinds = new Set([...Object.keys(actual || {}), ...Object.keys(expected || {})]);
  for (const kind of [...kinds].sort()) {
    const a = (actual && actual[kind]) || {};
    const e = (expected && expected[kind]) || {};
    for (const name of Object.keys(e).sort()) {
      if (!(name in a)) diffs.push({ kind, type: 'missing', name, expected: e[name], actual: 0 });
      else if (a[name] !== e[name]) diffs.push({ kind, type: 'count', name, expected: e[name], actual: a[name] });
    }
    for (const name of Object.keys(a).sort()) {
      if (!(name in e)) diffs.push({ kind, type: 'added', name, expected: 0, actual: a[name] });
    }
  }
  return diffs;
}

export function formatChannelDiff(diffs) {
  const lines = [];
  for (const d of diffs) {
    if (d.type === 'missing') lines.push('пропал канал ' + d.kind + ' «' + d.name + '» (в снимке ' + d.expected + ', в коде 0)');
    else if (d.type === 'added') lines.push('появился канал ' + d.kind + ' «' + d.name + '» (в коде ' + d.actual + ', в снимке 0)');
    else lines.push('изменилось число повторов ' + d.kind + ' «' + d.name + '»: в снимке ' + d.expected + ', в коде ' + d.actual);
  }
  return lines.join('\n');
}

// ---- 2. Граф require ----------------------------------------------------------

export function collectRequireGraph(entries) {
  const nodes = new Set(entries.map((e) => e.path));
  const edges = new Map(entries.map((e) => [e.path, []]));
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    walkAst(parsed.ast, (node) => {
      const spec = requireLiteral(node);
      if (!spec) return;
      const target = resolveModulePath(entry.path, spec);
      if (!target || !nodes.has(target)) return;
      edges.get(entry.path).push({ target, line: node.loc.start.line, spec });
    });
  }

  const mainRequires = [];
  for (const [from, list] of edges) {
    if (!from.startsWith('src/main/')) continue;
    for (const edge of list) {
      if (edge.target === 'src/main.js') mainRequires.push({ from, ...edge });
    }
  }

  // Все циклы (не только первый). Циклы, найденные с разных начал, схлопываем по канонической записи.
  const color = new Map();
  const stack = [];
  const seen = new Set();
  const cycles = [];
  function canonical(seq) {
    const body = seq.slice(0, -1);
    let best = 0;
    for (let i = 1; i < body.length; i++) {
      if (body[i] < body[best]) best = i;
    }
    const rotated = body.slice(best).concat(body.slice(0, best));
    return rotated.concat(rotated[0]);
  }
  function dfs(node) {
    color.set(node, 1);
    stack.push(node);
    for (const edge of edges.get(node) || []) {
      const target = edge.target;
      const c = color.get(target) || 0;
      if (c === 1) {
        const start = stack.indexOf(target);
        const cycle = canonical(stack.slice(start).concat(target));
        const text = cycle.join(' -> ');
        if (!seen.has(text)) {
          seen.add(text);
          cycles.push({ nodes: cycle, text });
        }
      } else if (c === 0) {
        dfs(target);
      }
    }
    stack.pop();
    color.set(node, 2);
  }
  for (const node of nodes) {
    if (!color.get(node)) dfs(node);
  }
  return { nodes, edges, cycles, mainRequires };
}

// ---- 3. Что модуль берёт из ctx и что ему передали ----------------------------

function addPatternKeys(pattern, taken, issues, file, line) {
  for (const prop of pattern.properties) {
    if (prop.type === 'Property') {
      const name = staticName(prop.key, prop.computed);
      if (name == null) issues.push(file + ':' + line + ': не удалось прочитать имя свойства в destructuring ctx');
      else taken.add(name);
    } else if (prop.type === 'RestElement') {
      issues.push(file + ':' + line + ': rest-элемент в destructuring ctx — перечислите имена явно');
    } else {
      issues.push(file + ':' + line + ': непонятный элемент destructuring ctx (' + prop.type + ')');
    }
  }
}

export function collectCtxUsage(entries) {
  const usage = new Map();
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    const taken = new Set();
    const issues = [];
    walkAst(parsed.ast, (node) => {
      if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern'
        && node.init && node.init.type === 'Identifier' && node.init.name === 'ctx') {
        addPatternKeys(node.id, taken, issues, entry.path, node.loc.start.line);
      }
      if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'ctx') {
        const name = staticName(node.property, node.computed);
        if (name == null) issues.push(entry.path + ':' + node.loc.start.line + ': динамическое обращение ctx[...] — страж не может проверить имя');
        else taken.add(name);
      }
    });
    usage.set(entry.path, { taken, issues });
  }
  return usage;
}

export function collectSetupCalls(mainEntry, modulePaths) {
  const parsed = parseEntry(mainEntry);
  const moduleSet = new Set(modulePaths);
  const requireVars = new Map();
  const factoryFns = new Map();
  walkAst(parsed.ast, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    const spec = requireLiteral(node.init);
    if (!spec) return;
    const target = resolveModulePath(mainEntry.path, spec);
    if (!target || !target.startsWith('src/main/')) return;
    if (node.id.type === 'Identifier') requireVars.set(node.id.name, target);
    if (node.id.type === 'ObjectPattern') {
      for (const prop of node.id.properties) {
        if (prop.type !== 'Property') continue;
        if (!FACTORY_NAMES.has(staticName(prop.key, prop.computed))) continue;
        if (prop.value.type === 'Identifier') factoryFns.set(prop.value.name, target);
      }
    }
  });

  function moduleForCall(node) {
    const callee = node.callee;
    if (callee.type === 'MemberExpression' && FACTORY_NAMES.has(staticName(callee.property, callee.computed))) {
      const obj = callee.object;
      if (obj.type === 'Identifier') {
        if (requireVars.has(obj.name)) return requireVars.get(obj.name);
        return null;
      }
      const spec = requireLiteral(obj);
      if (spec) {
        const target = resolveModulePath(mainEntry.path, spec);
        return target && target.startsWith('src/main/') ? target : null;
      }
      return null;
    }
    if (callee.type === 'Identifier' && factoryFns.has(callee.name)) return factoryFns.get(callee.name);
    return null;
  }

  const calls = new Map();
  const allCalls = [];
  const issues = [];

  function isSetupCall(node) {
    const callee = node.callee;
    if (callee.type === 'MemberExpression' && FACTORY_NAMES.has(staticName(callee.property, callee.computed))) return true;
    return callee.type === 'Identifier' && (callee.name === 'setup' || factoryFns.has(callee.name));
  }

  function callLabel(node) {
    const callee = node.callee;
    if (callee.type === 'MemberExpression') {
      const method = staticName(callee.property, callee.computed) || 'setup';
      if (callee.object.type === 'Identifier') return callee.object.name + '.' + method;
      const spec = requireLiteral(callee.object);
      return spec ? spec + '.' + method : method;
    }
    return callee.name + '(…)';
  }

  walkAst(parsed.ast, (node) => {
    if (node.type !== 'CallExpression' || !isSetupCall(node)) return;
    const module = moduleForCall(node);
    const line = node.loc.start.line;
    const arg = node.arguments[0];
    const call = { module, label: module || callLabel(node), node, arg, keys: new Set(), literal: false, line };
    allCalls.push(call);
    if (!module) return; // setup не из src/main/* — для требования 4 проверяем, для требования 3 нет
    if (!moduleSet.has(module)) {
      issues.push(mainEntry.path + ':' + line + ': setup/create вызван для ' + module + ', которого нет среди src/main/*.js');
      return;
    }
    if (!arg || arg.type !== 'ObjectExpression') {
      issues.push(mainEntry.path + ':' + line + ': фабрика (' + call.label + ') вызвана не объектом-литералом — передавайте { … } явно');
      if (!calls.has(module)) calls.set(module, []);
      calls.get(module).push(call);
      return;
    }
    call.literal = true;
    for (const prop of arg.properties) {
      if (prop.type !== 'Property') {
        issues.push(mainEntry.path + ':' + line + ': в объекте фабрики ' + module + ' есть ' + prop.type + ' — ключи должны быть перечислены явно');
        continue;
      }
      if (prop.kind && prop.kind !== 'init') {
        issues.push(mainEntry.path + ':' + line + ': в объекте фабрики ' + module + ' свойство ' + prop.kind + ' — передавайте обычное значение');
        continue;
      }
      const name = staticName(prop.key, prop.computed);
      if (name == null) {
        issues.push(mainEntry.path + ':' + line + ': не удалось прочитать ключ в объекте фабрики ' + module);
        continue;
      }
      call.keys.add(name);
    }
    if (!calls.has(module)) calls.set(module, []);
    calls.get(module).push(call);
  });

  for (const module of modulePaths) {
    if (!calls.has(module)) issues.push(mainEntry.path + ': для ' + module + ' не найден вызов setup/create({ … })');
  }
  return { calls, allCalls, issues, parsed };
}

// Проверка «взятое ⊆ переданное». Для каждого вызова setup все имена, которые модуль
// берёт из ctx, должны быть среди ключей этого вызова.
export function checkCtxCoverage(mainEntry, modulePaths, usage, setup) {
  const result = setup || collectSetupCalls(mainEntry, modulePaths);
  const issues = result.issues.slice();
  for (const module of modulePaths) {
    const moduleUsage = usage.get(module);
    if (!moduleUsage) continue;
    for (const issue of moduleUsage.issues) issues.push(issue);
    const callsForModule = result.calls.get(module) || [];
    for (const call of callsForModule) {
      if (!call.literal) continue;
      const missing = [...moduleUsage.taken].filter((name) => !call.keys.has(name)).sort();
      if (missing.length) {
        issues.push(mainEntry.path + ':' + call.line + ': ' + module + ' берёт из ctx ' + missing.join(', ')
          + ', но setup/create({ … }) это не передаёт');
      }
    }
  }
  return issues;
}

// ---- 4. Изменяемое не передаётся значением -----------------------------------

function nearestFunction(node, parents) {
  let cur = node;
  while (cur && cur.type !== 'Program') {
    if (FUNCTION_TYPES.has(cur.type)) return cur;
    cur = parents.get(cur);
  }
  return cur;
}

function resolveVariable(manager, name, pos) {
  let best = null;
  for (const scope of manager.scopes) {
    const block = scope.block;
    if (!block || !block.range) continue;
    if (pos < block.range[0] || pos >= block.range[1]) continue;
    const size = block.range[1] - block.range[0];
    if (!best || size < best.size || (size === best.size && best.scope.type === 'global' && scope.type !== 'global')) {
      best = { scope, size };
    }
  }
  let scope = best ? best.scope : manager.globalScope;
  while (scope) {
    if (scope.set.has(name)) return scope.set.get(name);
    scope = scope.upper;
  }
  return null;
}

function isWrite(reference) {
  return typeof reference.isWrite === 'function' ? reference.isWrite() : !!reference.write;
}

function getterName(key) {
  const clean = key === 'default' ? 'value' : key;
  return 'get' + clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function findMutableByValueIssues(mainEntry, setup) {
  if (!setup || !setup.parsed || !Array.isArray(setup.allCalls)) {
    throw new Error('findMutableByValueIssues: передайте результат collectSetupCalls');
  }
  const parsed = setup.parsed;
  const manager = scopeManagerFor(parsed);
  const issues = [];
  for (const call of setup.allCalls) {
    if (!call.literal || !call.arg || call.arg.type !== 'ObjectExpression') continue;
    const callFn = nearestFunction(call.node, parsed.parents);
    for (const prop of call.arg.properties) {
      if (prop.type !== 'Property' || prop.kind !== 'init') continue;
      const value = prop.value;
      if (!value || value.type !== 'Identifier') continue;
      const key = staticName(prop.key, prop.computed);
      const variable = resolveVariable(manager, value.name, value.range[0]);
      if (!variable) continue;
      const declaration = variable.defs.find((d) => d.type === 'Variable' && (d.kind === 'let' || d.kind === 'var'));
      if (!declaration) continue;
      const badWrites = [];
      for (const ref of variable.references) {
        if (!isWrite(ref) || ref.init === true) continue;
        const sameBody = nearestFunction(ref.identifier, parsed.parents) === callFn;
        if (sameBody && ref.identifier.range[0] < call.node.range[0]) continue;
        badWrites.push(ref);
      }
      if (!badWrites.length) continue;
      const lines = badWrites.map((r) => r.identifier.loc.start.line).join(', ');
      issues.push(mainEntry.path + ':' + call.line + ': в setup/create(' + call.label + ') свойство «' + key + '» передаёт «'
        + value.name + '» значением, а переменная объявлена через ' + declaration.kind
        + ' и переприсваивается позже (строка ' + lines + '). Передайте функцией-доступа: '
        + getterName(key || 'value') + ': () => ' + value.name);
    }
  }
  return issues;
}
