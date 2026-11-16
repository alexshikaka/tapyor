// Правила интерфейса для оболочек (docs/UI-RULES.md): новые цвета — только через переменные.
// Считает «зашитые» цвета (#hex, rgb()) в коде окна и в общих правилах app.css и сравнивает с базой
// tests/ui-rules-baseline.json. Стало больше — проверка падает: новый элемент не перекрасится в оболочке.
// Палитры (оболочки, темы, панель OBS) — разрешены, их файлы и правила не считаются.
// Запуск: node tools/ui-rules.mjs            — проверить
//         node tools/ui-rules.mjs --update   — записать новую базу (только осознанно, когда цвета убрали или это палитра)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseFile = path.join(root, 'tests', 'ui-rules-baseline.json');
const COLOR = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\(\s*\d/gi;
// Файлы-палитры: здесь цвета — это и есть данные
// 25-overlay.js — цвета оверлея OBS на выбор (янтарь, зелёный…): это данные, а не оформление окна
const PALETTE_FILES = new Set(['01-skins.js', '06-themes.js', '13-widget.js', '25-overlay.js']);

function countJs() {
  const dir = path.join(root, 'src', 'ui'); const out = {};
  for (const f of fs.readdirSync(dir).filter((x) => /\.js$/.test(x)).sort()) {
    if (PALETTE_FILES.has(f)) continue;
    const s = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\/[^\n]*/g, '');
    out['ui/' + f] = (s.match(COLOR) || []).length;
  }
  return out;
}
// app.css: цвета вне :root, тем (theme-), оболочек (skin-) и ключевых кадров
function countCss() {
  const s = fs.readFileSync(path.join(root, 'src', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let n = 0; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(s))) {
    const sel = m[1].trim();
    if (/:root|theme-|skin-|pixel-skin|@keyframes|^\s*(from|to|\d+%)/.test(sel)) continue;
    n += (m[2].match(COLOR) || []).length;
  }
  return { 'app.css (общие правила)': n };
}
function countHtml() {
  const s = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const styles = s.match(/style="[^"]*"/g) || [];
  return { 'index.html (style="…")': styles.join(' ').match(COLOR)?.length || 0 };
}

const now = Object.assign({}, countJs(), countCss(), countHtml());
if (process.argv.includes('--update')) {
  fs.writeFileSync(baseFile, JSON.stringify(now, null, 2) + '\n');
  console.log('база правил интерфейса записана: ' + baseFile);
  process.exit(0);
}
const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : {};
let bad = 0;
for (const [k, v] of Object.entries(now)) {
  const b = base[k] ?? 0;
  if (v > b) { console.log(`✗ ${k}: зашитых цветов ${v}, было ${b} — используй переменные (--bg*, --tx*, --ac, --pri…), см. docs/UI-RULES.md`); bad++; }
}
if (bad) process.exit(1);
console.log('правила интерфейса: новых зашитых цветов нет');
