// Шаг CI: читает resources/yt-dlp.version.json и отдаёт адрес и ожидаемый sha256 (P5a №7).
// Запуск: node tools/ytdlp-pin.mjs   (в Actions пишет в GITHUB_OUTPUT).
// Пустая version — качаем latest и предупреждаем, что версия не закреплена.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPin, releaseBase } from './lib/ytdlp-pin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'resources', 'yt-dlp.version.json');
let raw = '';
try { raw = fs.readFileSync(file, 'utf8'); } catch { /* ниже — понятная ошибка */ }

const pin = checkPin(raw);
if (!pin.ok) {
  console.error('⛔ ' + pin.error);
  console.error('   Исправь resources/yt-dlp.version.json: {"version":"","sha256":""} — «latest», или версия и её sha256.');
  process.exit(1);
}

const base = releaseBase(pin.version, pin.pinned);
const lines = ['pinned=' + pin.pinned, 'version=' + pin.version, 'sha256=' + pin.sha256, 'base=' + base];
const out = process.env.GITHUB_OUTPUT;
if (out) fs.appendFileSync(out, lines.join('\n') + '\n');
else console.log(lines.join('\n'));

if (!pin.pinned) {
  console.log('::warning::Версия yt-dlp не закреплена (resources/yt-dlp.version.json: version пусто) — качаю latest.');
} else {
  console.log('yt-dlp закреплён: версия ' + pin.version + ', sha256 ' + pin.sha256.slice(0, 8) + '…');
}
