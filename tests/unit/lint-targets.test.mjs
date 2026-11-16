// Список файлов ESLint (P5a №19): весь src и все tools/*.mjs, а не 31 файл вручную.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintTargets, LINT_SKIP } from '../../tools/lib/lint-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('все src/*.js, src/main/*.js и оболочки — в списке', () => {
  const t = lintTargets(root);
  for (const f of ['src/main.js', 'src/preload.js', 'src/main/updater.js', 'src/main/ytdlp.js', 'src/skins/skins-pack.js', 'src/ui.js']) {
    assert.ok(t.includes(f), 'нет в списке: ' + f);
  }
});

test('tools/**/*.mjs — рекурсивно', () => {
  const t = lintTargets(root);
  for (const f of ['tools/check.mjs', 'tools/lib/asar-scan.mjs', 'tools/lib/lint-targets.mjs']) {
    assert.ok(t.includes(f), 'нет в списке: ' + f);
  }
});

test('части интерфейса и vendor не проверяются по отдельности', () => {
  const t = lintTargets(root);
  assert.ok(!t.some((f) => f.startsWith('src/ui/')));
  assert.ok(!t.includes('src/vendor/hls.min.js'));
});

test('временный пропуск исключён, все файлы существуют', () => {
  const t = lintTargets(root);
  for (const f of LINT_SKIP) assert.ok(!t.includes(f), 'не исключён: ' + f);
  for (const f of t) assert.ok(fs.existsSync(path.join(root, f)), 'файла нет: ' + f);
});
