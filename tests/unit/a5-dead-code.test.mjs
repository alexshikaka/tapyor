// Страж STAB-A5: имена, удалённые как брошенный код.
// Проверка писалась ДО удаления и падала на каждом имени — так видно, что удалено именно то,
// что нашёл ESLint (no-unused-vars), а не что-то ещё. Имена, которые могут значить обычное слово
// (`connected`, `journal`, `clone`, `files`, `sgn`), ищутся точным куском объявления, а не словом.
// src/vendor не проверяем; src/ui.js — собранная копия src/ui/*.js (генерируется npm test).
//
// D2 (F1): часть имён — во внутренних инструментах владельца (tools/*), которых в открытом снимке
// нет. Такой файл не «прошёл проверку», а пропущен: причина пишется в выводе как SKIP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Группа 1 — части интерфейса, группа 2 — модули главного процесса (всегда в снимке).
const SRC = [
  { file: 'src/ui/01-skins.js', snippets: ['function skinDefaultCore('] },
  { file: 'src/ui/03-queue.js', snippets: ['function axNode(', 'function axMeasure(', 'function axBroken(', 'function singleOrderActive(', 'function orderActive('] },
  { file: 'src/ui/08-artist.js', snippets: ['var LIST_SVG ='] },
  { file: 'src/ui/12-playlists.js', snippets: ['var tintCache =', 'function avgColorLocal(', 'function tintOf(', 'function anyMediaLoaded('] },
  { file: 'src/ui/16-account.js', snippets: ['var YM_DOT =', 'var YT_DOT ='] },
  { file: 'src/ui/17-viz.js', snippets: ['function vizAccent('] },
  { file: 'src/ui/20-wavepage.js', snippets: ['function wpContextKind('] },
  { file: 'src/ui/27-vpn.js', snippets: ['var vpnNetsState', 'vpnNetsState ='] },
  { file: 'src/ui/30-sbot.js', snippets: ["var connected = st.status === 'ok';"] },
  // Группа 2 — модули главного процесса.
  { file: 'src/sbot-link.js', snippets: ['const journal = d.journal &&'] },
  { file: 'src/sbot-settings.js', snippets: ['function clone(x) {'] },
  { file: 'src/theme.js', snippets: ['sgn = dark ? 1 : -1'] },
];

// Группа 3 — служебные инструменты: внутренние (нет в снимке) пропускаются по одному, с причиной.
const TOOLS = [
  { file: 'tools/benchmark-orders.mjs', snippets: ["import path from 'node:path';"] },
  { file: 'tools/check-asar.mjs', snippets: ["import path from 'node:path';"] },
  { file: 'tools/open-release.mjs', snippets: ["const files = run('git', ['show'"] },
  { file: 'tools/order-selector-replay-771.mjs', snippets: ["const { pick, better, inspect }"] },
  { file: 'tools/release-preflight.mjs', snippets: ["import { fileURLToPath } from 'node:url';"] },
];

function hits(list) {
  const out = [];
  for (const r of list) {
    const text = fs.readFileSync(path.join(ROOT, r.file), 'utf8');
    for (const s of r.snippets) if (text.includes(s)) out.push(r.file + ' — ' + s);
  }
  return out;
}

test('STAB-A5: удалённые имена не вернулись — интерфейс и модули', () => {
  assert.deepEqual(hits(SRC), [], 'вернулись удалённые имена');
});

for (const r of TOOLS) {
  const skip = fs.existsSync(path.join(ROOT, r.file)) ? false : 'нет ' + r.file + ' — он не входит в открытый снимок';
  test('STAB-A5: ' + r.file, { skip }, () => {
    assert.deepEqual(hits([r]), [], 'вернулись удалённые имена');
  });
}
