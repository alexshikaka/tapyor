// Журнал чужих PR (docs/PR-LOG.md): строка после переноса, версия после «открой X.Y.Z».
// Ошибка здесь теряет решение по PR или перезаписывает чужую строку — поэтому проверяем отдельно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addPrLogRow, readPrLog, setPrLogVersion, ensurePrLog, prLogFile } from '../../tools/lib/pr-log.mjs';

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-prlog-'));

test('журнал: создаётся с шапкой и строкой', () => {
  const root = tempRoot();
  assert.equal(readPrLog(root).length, 0);
  addPrLogRow(root, { number: 12, author: '@ivan', date: '2026-11-11', decision: 'перенесён', commit: 'abc1234', decidedBy: 'модель', version: '' });
  const rows = readPrLog(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].number, 12);
  assert.equal(rows[0].author, '@ivan');
  assert.equal(rows[0].decision, 'перенесён');
  assert.equal(rows[0].commit, 'abc1234');
  assert.equal(rows[0].version, '—');
  const text = fs.readFileSync(prLogFile(root), 'utf8');
  assert.match(text, /# Журнал чужих PR/);
  assert.match(text, /^\| PR \| Автор \| Дата \| Решение \| Коммит \| Решил \| Версия \|$/m);
});

test('журнал: версия ставится в нужную строку, остальные не меняются', () => {
  const root = tempRoot();
  ensurePrLog(root);
  addPrLogRow(root, { number: 12, author: '@ivan', date: '2026-11-11', decision: 'перенесён', commit: 'aaa', decidedBy: 'модель' });
  addPrLogRow(root, { number: 13, author: '@petr', date: '2026-11-11', decision: 'отклонён', commit: '—', decidedBy: 'владелец' });
  assert.equal(setPrLogVersion(root, 13, '0.34.0'), true);
  const rows = readPrLog(root);
  const r12 = rows.find((r) => r.number === 12);
  const r13 = rows.find((r) => r.number === 13);
  assert.equal(r12.version, '—');
  assert.equal(r13.version, '0.34.0');
  assert.equal(setPrLogVersion(root, 99, '0.34.0'), false, 'чужого номера нет — честный false');
});

test('журнал: повторная запись того же PR заменяет строку, а не плодит', () => {
  const root = tempRoot();
  addPrLogRow(root, { number: 12, author: '@ivan', date: '2026-11-11', decision: 'доработать', decidedBy: 'модель' });
  addPrLogRow(root, { number: 12, author: '@ivan', date: '2026-11-12', decision: 'перенесён', commit: 'bbb', decidedBy: 'владелец' });
  const rows = readPrLog(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'перенесён');
  assert.equal(rows[0].commit, 'bbb');
});

test('журнал: вертикальная черта в имени не ломает таблицу', () => {
  const root = tempRoot();
  addPrLogRow(root, { number: 7, author: '@a|b', date: '2026-11-11', decision: 'перенесён', decidedBy: 'модель' });
  const rows = readPrLog(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].author, '@a b');
});
