// latestJournal() — пункт трея «Показать журнал чат-бота» должен открывать последний заполненный файл.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { latestJournal } = require('../../src/modhost.js');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-bj-'));
  const jdir = path.join(dir, 'bot-journal');
  fs.mkdirSync(jdir);
  for (const [name, body, ageMin] of files) {
    const p = path.join(jdir, name);
    fs.writeFileSync(p, body);
    const t = new Date(Date.now() - ageMin * 60000);
    fs.utimesSync(p, t, t);
  }
  return dir;
}

test('latestJournal: берёт самый свежий непустой файл', () => {
  const dir = fixture([
    ['2026-11-01.jsonl', '{"a":1}\n', 120],
    ['2026-11-03.jsonl', '{"a":2}\n', 5],
    ['2026-11-02.jsonl', '{"a":3}\n', 60]
  ]);
  assert.equal(latestJournal(dir), path.join(dir, 'bot-journal', '2026-11-03.jsonl'));
});

test('latestJournal: пустой свежий файл не выбирает', () => {
  const dir = fixture([
    ['2026-11-02.jsonl', '{"a":1}\n', 60],
    ['2026-11-03.jsonl', '', 1]
  ]);
  assert.equal(latestJournal(dir), path.join(dir, 'bot-journal', '2026-11-02.jsonl'));
});

test('latestJournal: журнала ещё нет — null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-bj-'));
  assert.equal(latestJournal(dir), null);
  fs.mkdirSync(path.join(dir, 'bot-journal'));
  assert.equal(latestJournal(dir), null); // папка есть, файлов нет
});

test('latestJournal: только пустые файлы — null (откроем папку)', () => {
  const dir = fixture([['2026-11-03.jsonl', '', 1]]);
  assert.equal(latestJournal(dir), null);
});
