// Список файлов для ESLint: один на npm test и npm run lint (P5a №19).
// Раньше список был переписан руками в двух местах, и десятки модулей src/*.js не проверялись.
import fs from 'node:fs';
import path from 'node:path';

// Временно исключённые файлы: в них уже есть ошибки no-undef/no-redeclare, но чинить код
// в этой задаче нельзя. Убирать по одному после починки.
export const LINT_SKIP = [
  // preload окна Яндекс.Музыки: обращается к window/document, а ESLint считает src/**/*.js
  // кодом главного процесса. Нужна отдельная конфигурация для preload — тогда убрать отсюда.
  'src/ymweb-preload.js',
];

function pick(root, dir, ext) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, dir)); } catch { return []; }
  return names.filter((n) => n.endsWith(ext) && fs.statSync(path.join(root, dir, n)).isFile()).map((n) => dir + '/' + n);
}

function walk(root, dir) {
  let out = [];
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) out = out.concat(walk(root, rel));
    else if (e.isFile() && e.name.endsWith('.mjs')) out.push(rel);
  }
  return out;
}

export function lintTargets(root) {
  const list = []
    .concat(pick(root, 'src', '.js'))          // включая собранный ui.js — весь интерфейс одним скриптом
    .concat(pick(root, 'src/main', '.js'))
    .concat(pick(root, 'src/skins', '.js'))
    .concat(walk(root, 'tools'));
  return list
    .filter((f) => !LINT_SKIP.includes(f))
    .filter((f) => fs.existsSync(path.join(root, f)))
    .sort();
}
