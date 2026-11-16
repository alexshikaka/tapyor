// Soak без Electron: короткий прогон должен запускаться и завершаться сам.
// Зачем тест: с 05.11 (bf6621a) soak падал сразу (`realStart is not defined`), но ни одна
// проверка его не запускала — ошибку нашли только руками 11.11.
// D2 (F2): soak проверяет Pipeline из пака стримера, а папки modules/streamer-pack/ в открытом
// снимке нет. Тогда тест пропускается с причиной, а не падает на отсутствующем файле.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK_PIPELINE = path.join(ROOT, 'modules/streamer-pack/bot/src/logic/pipeline.js');
const NO_PACK = fs.existsSync(PACK_PIPELINE) ? false : 'нет modules/streamer-pack/ — пак не входит в открытый снимок';

// Отчёт всегда во временную папку: тест не должен трогать репозиторий.
function runSoak(t, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-soak-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'soak-result.json');
  const r = spawnSync(process.execPath, ['tools/reliability/soak.mjs', ...args, '--out', out], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000
  });
  const why = r.error ? r.error.message : (r.stderr || r.stdout || '');
  assert.equal(r.status, 0, 'soak завершился с ошибкой: ' + why);
  const stdout = String(r.stdout || '');
  assert.doesNotMatch(stdout, /realStart is not defined/);
  assert.doesNotMatch(String(r.stderr || ''), /realStart is not defined/);
  assert.match(stdout, /SOAK_RESULT /, 'итог напечатан');
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

test('soak: --minutes с --virtual проходит и пишет отчёт', { skip: NO_PACK }, (t) => {
  const res = runSoak(t, ['--minutes', '0.05', '--virtual', '--hours', '0.01']);
  assert.equal(res.virtual, true);
  assert.equal(res.minutes, 0.05);
  assert.equal(res.durationMs, 3000, '--minutes важнее --hours');
  assert.ok(res.commands > 0, 'команды обработаны');
  assert.equal(res.unhandled, 0, 'необработанных отказов нет');
  assert.equal(typeof res.queue, 'number');
  assert.equal(typeof res.outcomes, 'object');
});

test('soak: --minutes без --virtual завершается по реальным часам', { skip: NO_PACK }, (t) => {
  const res = runSoak(t, ['--minutes', '0.01']);
  assert.equal(res.virtual, false);
  assert.equal(res.durationMs, 600);
  assert.ok(res.commands > 0, 'команды обработаны');
  assert.equal(res.unhandled, 0, 'необработанных отказов нет');
});
