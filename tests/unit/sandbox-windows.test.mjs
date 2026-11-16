// STAB-B2: окно-пипетка и скрытое окно сайта Яндекса работают в песочнице Electron.
// Два условия песочницы, которые можно проверить по тексту исходника:
//  1) в самом окне (webPreferences) стоит sandbox: true;
//  2) preload подключает только 'electron' (остальное в песочнице недоступно).
// Живой запуск окон этой проверкой не заменяется — он в приёмке отдельно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Окна могут переехать (блок A1 уже разложил часть main.js по src/main/*.js) —
// ищем окно по имени preload, а не по номеру строки или файлу.
function windowSources() {
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f);
  const dir = path.join(ROOT, 'src', 'main');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) files.push('src/main/' + f);
  }
  return files;
}

// Кусок кода от `new BrowserWindow(` до конца объекта — в нём и настройки окна.
function windowBlock(text, marker) {
  const at = text.indexOf(marker);
  assert.notEqual(at, -1, 'не найдено место создания окна по ' + marker);
  const start = text.lastIndexOf('new BrowserWindow(', at);
  assert.notEqual(start, -1, 'не найден new BrowserWindow( перед ' + marker);
  const end = text.indexOf('});', at);
  assert.notEqual(end, -1, 'не найден конец настроек окна после ' + marker);
  return text.slice(start, end);
}

function findWindowBlock(marker) {
  const hits = [];
  for (const rel of windowSources()) {
    const text = read(rel);
    if (text.includes(marker)) hits.push({ rel, text });
  }
  assert.equal(hits.length, 1, 'место создания окна должно быть ровно одно: ' + marker);
  return { rel: hits[0].rel, block: windowBlock(hits[0].text, marker) };
}

test('STAB-B2: окно-пипетка создаётся с sandbox: true', () => {
  const { rel, block } = findWindowBlock('pick-preload.js');
  assert.match(block, /sandbox:\s*true/, rel + ': у окна пипетки нет sandbox: true');
});

test('STAB-B2: скрытое окно сайта Яндекса создаётся с sandbox: true', () => {
  const { rel, block } = findWindowBlock('ymweb-preload.js');
  assert.match(block, /sandbox:\s*true/, rel + ': у окна сайта Яндекса нет sandbox: true');
});

// В песочнице preload может подключить только 'electron' (и то не все его части).
const PRELOADS = [
  { file: 'src/pick-preload.js', allowed: ['contextBridge', 'ipcRenderer'] },
  { file: 'src/ymweb-preload.js', allowed: ['contextBridge', 'ipcRenderer', 'webFrame'] },
];

for (const p of PRELOADS) {
  test('STAB-B2: ' + p.file + ' подключает только electron', () => {
    const text = read(p.file);
    const calls = [...text.matchAll(/require\s*\(/g)].length;
    const mods = [...text.matchAll(/require\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]);
    assert.equal(mods.length, calls, p.file + ': есть require с непостоянным именем');
    for (const m of mods) {
      assert.equal(m, 'electron', p.file + ': подключает «' + m + '», а в песочнице можно только «electron»');
    }
    // Что именно берётся из electron: только то, что доступно в песочнице.
    const names = [...text.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\(\s*['"]electron['"]\s*\)/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of names) assert.ok(p.allowed.includes(n), p.file + ': из electron берётся «' + n + '» — в песочнице этого нет');
  });
}
