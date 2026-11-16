// Ищет ключи в файлах, которые лежат в git (репозиторий публичный!).
// Запуск: node tools/scan-secrets.mjs   — код выхода 1, если что-то нашлось.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SECRET_PATTERNS, ALLOWED_SECRET_HASHES } from './secret-patterns.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let files;
try { files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean); }
catch { console.log('нет git — пропуск'); process.exit(0); }
// tools/secret-patterns.mjs — обёртка, src/secret-patterns.js — сам список шаблонов: в них
// встречаются образцы вида «GOCSPX-…», это не ключи. Остальные файлы проверяем как раньше.
const skip = /\.(png|jpe?g|gif|ico|wav|mp3|exe|zip|woff2?|ttf)$|package-lock\.json$|tools\/secret-patterns\.mjs$|src\/secret-patterns\.js$|tests\/security\//i;
let found = 0;
for (const f of files) {
  if (skip.test(f)) continue;
  let s; try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
  for (const [re] of SECRET_PATTERNS) {
    for (const m of s.matchAll(new RegExp(re.source, re.flags))) {
      if (/REDACTED/.test(m[0])) continue;
      const line = s.slice(0, m.index).split('\n').length;
      // Разрешение — только по хешу самого значения; строковая пометка больше не действует.
      const value = (m[0].match(/[0-9a-f]{32}/i) || [m[0]])[0];
      const hash = createHash('sha256').update(value).digest('hex');
      if (ALLOWED_SECRET_HASHES.has(hash)) continue;
      console.log(`${f}:${line}: похоже на ключ — ${m[0].slice(0, 12)}…`);
      found++;
    }
  }
}
if (found) { console.log(`\nНайдено: ${found}. Вычистить и сменить ключ у сервиса.`); process.exit(1); }
console.log('ключей не найдено');
