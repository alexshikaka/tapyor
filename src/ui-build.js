// Склейка скрипта окна: src/ui/*.js (по порядку имён) → один скрипт ui.js.
// Части написаны как единый скрипт (общие имена, функции видны друг другу до объявления),
// поэтому склеиваем их в ОДИН <script> — поведение то же, что было в index.html, а править удобно по частям.
// Главный процесс отдаёт /ui.js из этой склейки (с кэшем по времени изменения файлов).
// К склейке приложена карта (source map): ошибка в DevTools показывает настоящий файл и строку.
'use strict';
const fs = require('fs');
const path = require('path');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(n) { let v = n < 0 ? ((-n) << 1) | 1 : n << 1, s = ''; do { let d = v & 31; v >>>= 5; if (v) d |= 32; s += B64[d]; } while (v); return s; }

function uiFiles(srcDir) {
  const dir = path.join(srcDir, 'ui');
  return fs.readdirSync(dir).filter((f) => /^\d\d-[\w-]+\.js$/.test(f)).sort().map((f) => path.join(dir, f));
}
function uiParts(srcDir) {
  return uiFiles(srcDir).map((f) => ({ name: 'ui/' + path.basename(f), text: fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '') }));
}
function buildUi(srcDir) {
  const parts = uiParts(srcDir);
  const code = parts.map((p) => p.text).join('\n');
  const mappings = []; let prevSrc = 0, prevLine = 0;
  parts.forEach((p, si) => {
    const n = p.text.split('\n').length;
    for (let ln = 0; ln < n; ln++) { mappings.push('A' + vlq(si - prevSrc) + vlq(ln - prevLine) + 'A'); prevSrc = si; prevLine = ln; }
  });
  const map = { version: 3, file: 'ui.js', sources: parts.map((p) => p.name), names: [], mappings: mappings.join(';') };
  return code + '\n//# sourceURL=ui.js\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify(map), 'utf8').toString('base64') + '\n';
}
// С кэшем: пересобираем, только если какая-то часть изменилась
let cache = { key: '', text: '' };
function buildUiCached(srcDir) {
  const key = uiFiles(srcDir).map((f) => { try { const s = fs.statSync(f); return f + ':' + s.mtimeMs + ':' + s.size; } catch (e) { return f; } }).join('|');
  if (key !== cache.key) cache = { key, text: buildUi(srcDir) };
  return cache.text;
}
module.exports = { uiParts, buildUi, buildUiCached };
