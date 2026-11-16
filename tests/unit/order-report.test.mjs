import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const report = require('../../src/order-report.js');

test('order report: пишет полную цепочку в JSONL', () => {
  const file = path.join(os.tmpdir(), 'tapyor-order-report-' + process.pid + '.jsonl');
  try { fs.unlinkSync(file); } catch {}
  report.setup({ file });
  const t = report.begin({ prov: 'test', id: '42', text: 'Кино - Группа крови', amount: 100, currency: 'RUB' });
  t.plan = { signal: 'dash', queries: [{ query: 'Кино Группа крови', kind: 'dash' }] };
  t.analyzer = { intent: 'music' };
  report.step(t, 'test-step', { ok: true });
  report.finish(t, { level: 'exact', signal: 'dash', items: [{ level: 'exact', track: { src: 'ym', title: 'Группа крови', author: 'Кино' }, flags: [], paid: true }] });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const j = JSON.parse(lines[0]);
  assert.equal(j.key, 'test:42');
  assert.equal(j.plan.signal, 'dash');
  assert.equal(j.result.level, 'exact');
  assert.equal(j.result.items[0].track.author, 'Кино');
  assert.ok(j.steps.some((s) => s.name === 'test-step'));
});

test('order report: текст заказа из Streamer.bot не пишется — только длина', () => {
  const trace = report.begin({ prov: 'sbot', id: '1', text: '@ник, поставь кино кукушка' });
  assert.equal(trace.text, '', 'текста зрителя в файле нет');
  assert.equal(trace.textLen, '@ник, поставь кино кукушка'.length, 'длина — чтобы видеть размер заказа');
  const donat = report.begin({ prov: 'da', id: '2', text: 'Кино — Кукушка' });
  assert.equal(donat.text, 'Кино — Кукушка', 'у донатов текст остаётся как был');
  assert.equal('textLen' in donat, false);
});

test('order report: ошибка пишется отдельной строкой', () => {
  const file = path.join(os.tmpdir(), 'tapyor-order-report-fail-' + process.pid + '.jsonl');
  try { fs.unlinkSync(file); } catch {}
  report.setup({ file });
  report.fail({ prov: 'test', id: '43', text: 'x' }, new Error('boom'));
  const j = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.equal(j.error, 'boom');
  assert.equal(j.key, 'test:43');
});
