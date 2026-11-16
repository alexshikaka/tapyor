// ESLint по всему src и tools — тот же список, что в npm test (P5a №19).
// Запуск: npm run lint  (после сборки ui.js)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintTargets } from './lib/lint-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslint = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (!fs.existsSync(eslint)) {
  console.error('ESLint не установлен — выполни npm ci.');
  process.exit(2);
}
const targets = lintTargets(root);
try {
  execFileSync(process.execPath, [eslint].concat(targets), { cwd: root, stdio: 'inherit' });
} catch (e) {
  process.exit(e && e.status != null ? e.status : 1);
}
