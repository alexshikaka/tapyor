// Проверка установщика: в пакете не должно быть секретов, лишних файлов и двойных копий.
// Запуск: node tools/check-asar.mjs [путь к app.asar] [--allow-missing]
// Выход 1 — сборку публиковать нельзя.
//
// Зачем отдельно от scan-secrets.mjs: тот сканирует только файлы под git, а ключи сборки
// лежат в .gitignore и попадают в пакет мимо него. Именно так утёк da.json.
//
// Что проверяем (P5a №4, №5):
//  - все текстовые файлы app.asar, кроме чужих пакетов node_modules, — шаблонами из
//    src/secret-patterns.js (значения, разрешённые по хешу, не считаются находкой);
//  - все текстовые файлы extraResources (yt-dlp — двоичный, поэтому не сканируется;
//    lastfm.json и строка шаблона Streamer.bot — сканируются);
//  - один и тот же файл и в app.asar, и в extraResources (раньше так лежал yt-dlp);
//  - лишние файлы: docs/, tests/, tools/, server/, .github/, public/, package-lock.json,
//    корневые .md/.cmd/.mjs.
// Для проверки без сборки (нет app.asar) — --allow-missing.
import fs from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findSecrets, findJunk, findDuplicates, isProbableText, isDependencyPath, isPublicLastfmKey, isPublicGoogleOauth } from './lib/asar-scan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowMissing = process.argv.includes('--allow-missing');
const file = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'dist/win-unpacked/resources/app.asar';
if (!fs.existsSync(file)) {
  if (allowMissing) { console.log('app.asar не найден: ' + file + ' — пропущено по --allow-missing'); process.exit(0); }
  console.error('app.asar не найден: ' + file + '. Собери пробную упаковку или укажи путь; для ручного запуска без сборки — --allow-missing.');
  process.exit(2);
}

let asar;
try { asar = await import('@electron/asar'); }
catch {
  if (allowMissing) { console.log('@electron/asar недоступен — пропущено по --allow-missing'); process.exit(0); }
  console.error('@electron/asar недоступен — установи зависимости (npm ci). Проверка не выполнена.');
  process.exit(2);
}

const hashOf = (buf) => createHash('sha256').update(buf).digest('hex');
const relName = (p) => String(p).replace(/^[\\/]/, '');
const linesOf = (hits) => [...new Set(hits.map((h) => h.line))].sort((a, b) => a - b);

function walkFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// ── 1. app.asar: все файлы (каталоги пропускаем) ───────────────────────────────────────────────
const list = asar.listPackage(file);
const asarEntries = [];
const asarBad = [];
let asarText = 0;
for (const p of list) {
  const name = relName(p);
  let st;
  try { st = asar.statFile(file, name); } catch { continue; }
  if (!st || st.files) continue;   // st.files — это каталог
  let buf;
  try { buf = asar.extractFile(file, name); } catch { continue; }
  asarEntries.push({ path: p, size: buf.length, sha256: hashOf(buf) });
  if (isDependencyPath(name) || !isProbableText(name, buf)) continue;
  asarText++;
  const text = buf.toString('utf8');
  if (isPublicGoogleOauth(p, text)) { console.log('  ' + name + ' — открытый clientId Google и адрес посредника, по замыслу'); continue; }
  const hits = findSecrets(text);
  if (hits.length) asarBad.push({ path: p, lines: linesOf(hits) });
}

// ── 2. extraResources: список из package.json → build.extraResources ───────────────────────────
const resourcesDir = dirname(resolve(file));
const extraEntries = [];
const extraBad = [];
let extraText = 0;
let extraList = [];
try { extraList = (JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).build || {}).extraResources || []; } catch { /* без списка проверяем хотя бы asar */ }
for (const item of extraList) {
  const to = typeof item === 'string' ? item : item && item.to;
  if (!to) continue;
  const dest = join(resourcesDir, to);
  if (!fs.existsSync(dest)) continue;
  const files = fs.statSync(dest).isDirectory() ? walkFiles(dest) : [dest];
  for (const f of files) {
    const shown = 'extraResources/' + relative(resourcesDir, f).replace(/\\/g, '/');
    const buf = fs.readFileSync(f);
    extraEntries.push({ path: shown, size: buf.length, sha256: hashOf(buf) });
    if (!isProbableText(f, buf)) continue;
    extraText++;
    const text = buf.toString('utf8');
    if (isPublicLastfmKey(shown, text)) { console.log('  ' + shown + ' — публичный ключ чтения Last.fm, по замыслу'); continue; }
    const hits = findSecrets(text);
    if (hits.length) extraBad.push({ path: shown, lines: linesOf(hits) });
  }
}

// ── 3. итоги ────────────────────────────────────────────────────────────────────────────────────
const secrets = asarBad.concat(extraBad);
const junk = findJunk(list);
const dups = findDuplicates(asarEntries, extraEntries);

if (secrets.length) {
  console.log('В установщике найдены файлы с секретом:');
  secrets.forEach((x) => console.log('  ' + x.path + ' (строки: ' + x.lines.join(', ') + ')'));   // значения не печатаем
  console.log('\nСекрет из установщика достаётся за минуту. Вынеси обмен на сервер (server/yc-da) или добавь значение в белый список по хешу.');
  process.exit(1);
}
if (junk.length) {
  console.log('В пакете лежат файлы, которые программе не нужны: ' + junk.length + ' шт.');
  junk.slice(0, 10).forEach((p) => console.log('  ' + p));
  if (junk.length > 10) console.log('  … и ещё ' + (junk.length - 10));
  console.log('\nСреди них docs/audits — список незакрытых дыр, и витрина public/. Проверь build.files в package.json.');
  process.exit(1);
}
if (dups.length) {
  console.log('Один и тот же файл лежит и в app.asar, и в extraResources:');
  dups.forEach((d) => console.log('  ' + d.extra + ' = ' + d.asar.join(', ')));
  console.log('\nЭто лишняя копия в установщике. Убери её из build.files в package.json.');
  process.exit(1);
}
console.log('app.asar: секретов нет (текстовых файлов: ' + asarText + ', extraResources: ' + extraText +
  '), лишних файлов нет, двойных копий нет');
