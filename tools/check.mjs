// Проверки проекта без внешних зависимостей.
// Запуск: npm test  (или node tools/check.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintTargets } from './lib/lint-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const run = (name, args, opts = {}) => {
  try { execFileSync(process.execPath, args, { cwd: root, stdio: 'pipe', ...opts }); results.push({ ok: true, name }); }
  catch (e) { results.push({ ok: false, name, err: String(e.stderr || e.message).slice(0, 500) }); }
};

run('node --check src/main.js', ['--check', 'src/main.js']);
// В склейке все части — один скрипт. Две функции с одним именем на верхнем уровне
// молча затирают друг друга (так busy из 03-queue терялся из-за busy из 07-results).
try {
  const seen = new Map(), dup = [];
  for (const f of fs.readdirSync(path.join(root, 'src/ui')).filter((x) => x.endsWith('.js')).sort()) {
    const src = fs.readFileSync(path.join(root, 'src/ui', f), 'utf8');
    for (const m of src.matchAll(/^  function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const name = m[1];
      if (seen.has(name) && seen.get(name) !== f) dup.push(name + ' (' + seen.get(name) + ', ' + f + ')');
      else seen.set(name, f);
    }
  }
  results.push(dup.length ? { ok: false, name: 'части ui: нет дублей функций', err: dup.join('; ') } : { ok: true, name: 'части ui: нет дублей функций' });
} catch (e) { results.push({ ok: false, name: 'части ui: нет дублей функций', err: e.message }); }
// Скрипт окна: части src/ui/*.js склеиваются в src/ui.js (как в программе) и проверяются целиком
run('сборка ui.js из src/ui/', ['tools/build-ui.mjs']);
run('node --check ui.js (весь интерфейс)', ['--check', 'src/ui.js']);

const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
// С 01.11 CSP окна запрещает встроенные скрипты (аудит M2). Встроенный <script> в index.html
// не выполнится МОЛЧА — ни ошибки сборки, ни предупреждения. Поэтому их быть не должно вовсе:
// ранний код — в src/boot.js, остальное — в src/ui/*.js.
results.push(scripts.length
  ? { ok: false, name: 'index.html без встроенных скриптов (CSP)', err: 'найдено ' + scripts.length + ' — под CSP они не выполнятся. Вынеси в файл (src/boot.js или src/ui/).' }
  : { ok: true, name: 'index.html без встроенных скриптов (CSP)' });
run('node --check boot.js (ранний запуск окна)', ['--check', path.join(root, 'src/boot.js')]);

const zoom = fs.readFileSync(path.join(root, 'src/zoom.html'), 'utf8');
const zscripts = [...zoom.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const tmpZoom = path.join(os.tmpdir(), 'tapyor-zoom-check.js');
fs.writeFileSync(tmpZoom, zscripts[zscripts.length - 1][1], 'utf8');
run('node --check zoom.html', ['--check', tmpZoom]);

const eslint = path.join(root, 'node_modules/eslint/bin/eslint.js');
if (!fs.existsSync(eslint)) {
  results.push({ ok: true, name: 'eslint — пропущен (нет node_modules, выполни npm install)', skip: true });
} else {
  // Список файлов — общий с npm run lint: весь src и все tools/*.mjs (P5a №19).
  // Части src/ui/*.js по отдельности не линтуем: это один скрипт, он проверяется склейкой src/ui.js.
  // LINT_SKIP — файлы с уже существующими no-undef, их чинят отдельно (см. tools/lib/lint-targets.mjs).
  const targets = lintTargets(root);
  run('eslint (no-undef, включая весь интерфейс)', ['node_modules/eslint/bin/eslint.js'].concat(targets));
}

// Юнит-тесты — по одному файлу, а не каталогом: на Node 22 `node --test tests/unit/` падает.
// D2: пропуск внутри файла (нет внутреннего файла в открытом снимке) — это не «пройдено».
// Считаем SKIP из вывода и показываем число рядом с именем файла.
try {
  const unitDir = path.join(root, 'tests/unit');
  for (const f of fs.readdirSync(unitDir).filter((x) => x.endsWith('.test.mjs')).sort()) {
    const name = 'unit: ' + f;
    try {
      // TAP-репортёр печатает «# SKIP» одинаково на всех версиях Node; обычный на Node 24
      // пишет только «﹣ … # причина», и пропуск терялся бы в счётчике.
      const out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', path.join('tests/unit', f)], { cwd: root, encoding: 'utf8' });
      const skips = (String(out).match(/# SKIP\b/g) || []).length;
      results.push({ ok: true, name, skips });
    } catch (e) {
      results.push({ ok: false, name, err: String(e.stdout || e.stderr || e.message).slice(0, 800) });
    }
  }
} catch (e) { results.push({ ok: false, name: 'unit: список тестов', err: e.message }); }

run('library: smoke', ['tests/library/smoke.js']);
run('settings: память и безопасная запись', ['tests/settings/store.js']);
run('security: локальный сервер', ['tests/security/localguard.js']);
run('security: нет ключей в репозитории', ['tools/scan-secrets.mjs']);
run('правила интерфейса: цвета только через переменные', ['tools/ui-rules.mjs']);
run('оболочки: только покраска, в ядре их нет', ['tools/check-skins-contract.mjs']);
run('reqparse: judge', ['tests/reqparse/judge.js']);
// tests/reqparse/plan.js — демонстрация вывода, не тест; в npm test не входит.

// инструменты проверок (Playwright) — в папке verify рядом с проектом или по PLAYWRIGHT_PATH
const pw = [process.env.PLAYWRIGHT_PATH || ''].concat(['verify', 'tapyor-verify'].map((d) => path.join(path.dirname(root), d, 'node_modules', 'playwright-core'))).find((p) => p && fs.existsSync(p)) || '';
if (pw) {
  process.env.PLAYWRIGHT_PATH = pw;
  run('skins audit', ['tests/skins/audit.js']);
} else {
  results.push({ ok: true, name: 'skins audit — пропущен (нет playwright)', skip: true });
}

// Пропуск — это не «пройдено»: считаем отдельно, чтобы отчёт не выглядел лучше, чем есть
let bad = 0, skipped = 0, innerSkips = 0;
for (const r of results) {
  console.log((r.skip ? '– ' : r.ok ? '✓ ' : '✗ ') + r.name + (r.skip ? ' [пропуск]' : '') + (r.skips ? ' [пропусков: ' + r.skips + ']' : ''));
  if (r.skip) skipped++;
  else if (!r.ok) { bad++; console.log('  ' + r.err); }
  if (r.skips) innerSkips += r.skips;
}
const ran = results.length - skipped;
console.log(`\nИтого: пройдено ${ran - bad}/${ran}` + (skipped ? `, пропущено ${skipped} (не считать проверенными)` : '') + (innerSkips ? `, пропусков внутри тестов: ${innerSkips}` : ''));
console.log('Интерфейс (Playwright) сюда не входит: sh tests/ui/run.sh');
process.exit(bad ? 1 : 0);
