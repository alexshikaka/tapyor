// Каналы визарда: send доходит только до ipcMain.on, invoke — только до ipcMain.handle.
// 14.11: «Закрыть» в визарде слал send на handle-канал и молча ничего не делал.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../../src/main/wizard.js', import.meta.url), 'utf8');
const preloads = ['../../src/wizard/preload.js', '../../src/preload.js']
  .map((p) => readFileSync(new URL(p, import.meta.url), 'utf8'));

function kinds(src, re) { const m = {}; for (const x of src.matchAll(re)) m[x[2]] = x[1]; return m; }

test('каналы wizard-*: send ↔ on, invoke ↔ handle', () => {
  const reg = kinds(main, /ipcMain\.(on|handle)\(\s*'(wizard-[a-z-]+)'/g);
  let checked = 0;
  for (const src of preloads) {
    for (const x of src.matchAll(/ipcRenderer\.(send|invoke)\(\s*'(wizard-[a-z-]+)'/g)) {
      const want = x[1] === 'send' ? 'on' : 'handle';
      if (reg[x[2]]) { assert.equal(reg[x[2]], want, x[2] + ': окно шлёт ' + x[1] + ', а главный процесс ждёт ' + reg[x[2]]); checked++; }
    }
  }
  assert.ok(checked >= 3, 'проверено каналов: ' + checked);
});
