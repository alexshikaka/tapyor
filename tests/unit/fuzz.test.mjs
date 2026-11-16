import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const req = require('../../src/reqparse.js');
const store = require('../../src/settings-store.js');

function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-fuzz-')); }

test('fuzz: reqparse.plan не падает на случайных строках', () => {
  const rnd = prng(123);
  const parts = ['Кино', 'Группа крови', '—', '-', '!play', 'поставь', ' ', '\n', '"', '«', '»', '🎵', 'https://youtu.be/x', 'feat.', 'OST', '1)', ';', '/', '+', 'а', 'ß', '漢', '🙂'];
  for (let i = 0; i < 1500; i++) {
    let s = '';
    const n = Math.floor(rnd() * 25);
    for (let j = 0; j < n; j++) s += parts[Math.floor(rnd() * parts.length)];
    const p = req.plan(s);
    assert.ok(p && Array.isArray(p.queries), 'plan должен вернуть queries[]');
    for (const q of p.queries) {
      assert.equal(typeof q.query, 'string');
      assert.ok(q.query.length >= 0);
    }
  }
});

test('fuzz: reqparse.judge не падает и возвращает допустимый уровень', () => {
  const rnd = prng(456);
  const levels = new Set(['exact', 'doubt', 'none']);
  const words = ['Кино', 'Группа', 'крови', 'Кукушка', 'Пилот', 'Осень', 'Song', 'Artist', 'Live', 'Remix', 'OST', 'feat', 'x', '—', '-', '🎵'];
  for (let i = 0; i < 1000; i++) {
    let title = '', author = '';
    for (let j = 0, n = 1 + Math.floor(rnd() * 5); j < n; j++) title += ' ' + words[Math.floor(rnd() * words.length)];
    for (let j = 0, n = Math.floor(rnd() * 3); j < n; j++) author += ' ' + words[Math.floor(rnd() * words.length)];
    const t = { src: 'ym', id: 't' + i, title: title.trim(), author: author.trim(), seconds: 200 };
    const r = req.judge(title + ' ' + author, t);
    assert.ok(r && levels.has(r.level), 'level должен быть exact/doubt/none: ' + JSON.stringify(r));
  }
});

test('fuzz: settings-store выдерживает случайный JSON и восстанавливается', () => {
  const rnd = prng(789);
  const dir = tmp(), file = path.join(dir, 'settings.json');
  const samples = ['{broken', '', 'null', '[]', '42', '"x"', '{"a":1}', '{"a":', '{"a":1,"b":[1,2,3]}', '{"__proto__":{"x":1}}'];
  for (const sample of samples) {
    fs.writeFileSync(file, sample, 'utf8');
    try { fs.unlinkSync(file + '.bak'); } catch (e) {}
    store.setup({ file });
    const all = store.all();
    assert.ok(all && typeof all === 'object' && !Array.isArray(all), 'all() должен вернуть объект для ' + JSON.stringify(sample));
    assert.doesNotThrow(() => store.get('volume'), 'get не должен падать для ' + JSON.stringify(sample));
    store.flush();
  }
  // случайные валидные объекты не должны теряться
  for (let i = 0; i < 50; i++) {
    const obj = { n: i, s: 'x'.repeat(Math.floor(rnd() * 20)), arr: [i, i + 1] };
    fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
    store.setup({ file });
    const all = store.all();
    assert.equal(all.n, i);
    assert.equal(all.arr[0], i);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
