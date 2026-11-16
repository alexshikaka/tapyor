import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const journal = require('../../src/sbot-journal.js');

const DAY = 86400000;
const FIXED = new Date(2026, 10, 12, 15, 30).getTime(); // 12.11.2026 15:30 по местным часам

function dayName(ms) {
  const d = new Date(ms);
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

test('sbot-journal: папка в данных, файл по дням, чтение', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-sbot-journal-'));
  try {
    const j = journal.setup(dir, { now: () => FIXED });
    assert.equal(j.dir, join(dir, 'sbot-journal'));
    assert.ok(existsSync(j.dir), 'папка журнала создана');
    j.append({ ev: 'order', nick: 'test_viewer', text: 'кино кукушка', status: 'queued' });
    const file = join(j.dir, dayName(FIXED) + '.jsonl');
    assert.ok(existsSync(file), 'файл за сегодня: ' + file);
    const line = readFileSync(file, 'utf8').trim();
    const e = JSON.parse(line);
    assert.equal(e.nick, 'test_viewer', 'ник только в журнале');
    assert.equal(e.text, 'кино кукушка');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(e.at), 'время в ISO');
    const loaded = j.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].nick, 'test_viewer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sbot-journal: хранение 7 дней, старое удаляется при запуске', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-sbot-journal-'));
  try {
    const jdir = join(dir, 'sbot-journal');
    mkdirSync(jdir, { recursive: true });
    const today = dayName(FIXED);
    writeFileSync(join(jdir, today + '.jsonl'), '', 'utf8');
    writeFileSync(join(jdir, dayName(FIXED - 6 * DAY) + '.jsonl'), '', 'utf8');  // ещё хранится
    writeFileSync(join(jdir, dayName(FIXED - 7 * DAY) + '.jsonl'), '', 'utf8');  // седьмой день назад — уже нет
    writeFileSync(join(jdir, dayName(FIXED - 30 * DAY) + '.jsonl'), '', 'utf8');
    writeFileSync(join(jdir, 'заметка.txt'), 'не трогать', 'utf8');
    const j = journal.setup(dir, { now: () => FIXED });
    const names = readdirSync(j.dir).sort();
    assert.ok(names.indexOf(today + '.jsonl') >= 0, 'сегодня остался');
    assert.ok(names.indexOf(dayName(FIXED - 6 * DAY) + '.jsonl') >= 0, '6 дней назад остался');
    assert.ok(names.indexOf(dayName(FIXED - 7 * DAY) + '.jsonl') < 0, '7 дней назад удалён');
    assert.ok(names.indexOf(dayName(FIXED - 30 * DAY) + '.jsonl') < 0, '30 дней назад удалён');
    assert.ok(existsSync(join(j.dir, 'заметка.txt')), 'чужие файлы не трогаем');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sbot-journal: битые строки не ломают чтение, at принимает ISO', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-sbot-journal-'));
  try {
    const jdir = join(dir, 'sbot-journal');
    mkdirSync(jdir, { recursive: true });
    const file = join(jdir, dayName(FIXED) + '.jsonl');
    writeFileSync(file, 'не json\n' + JSON.stringify({ ev: 'order', nick: 'x' }) + '\n', 'utf8');
    const j = journal.setup(dir, { now: () => FIXED });
    j.append({ at: new Date(FIXED).toISOString(), ev: 'late', nick: 'test_viewer' });
    assert.equal(j.load().length, 2, 'битая строка пропущена');
    assert.equal(j.load()[1].nick, 'test_viewer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
