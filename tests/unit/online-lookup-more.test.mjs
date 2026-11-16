// T1: дополнение к online-lookup.test.mjs — bestMatch, youtubeTitle, сравнение строк,
// кэш ответов и «предохранитель» после трёх ошибок. Сеть — только подделка.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lookup = require('../../src/online-lookup.js');

const dirs = [];
function cachePath() {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-lookup-more-'));
  dirs.push(dir);
  return join(dir, 'cache.json');
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function withFetch(fake, fn) {
  const old = globalThis.fetch;
  globalThis.fetch = fake;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = old; });
}

// ---------- разбор и оценка ----------

test('online-lookup._test.tokens: регистр, скобки, feat и пунктуация', () => {
  const t = lookup._test.tokens;
  assert.deepEqual([...t('Bad Liar')], ['bad', 'liar']);
  assert.deepEqual([...t('Song (Live) [Remastered]')], ['song']);
  assert.deepEqual([...t('Кино — Группа крови feat. X')], ['кино', 'группа', 'крови', 'x'], 'слово feat убрано, имя исполнителя осталось');
  assert.deepEqual([...t('')], []);
});

test('online-lookup._test.score: точное название выше чужого, пустое — 0', () => {
  const s = lookup._test.score;
  const exact = s({ artist: 'Кино', title: 'Группа крови' }, 'Кино Группа крови');
  const other = s({ artist: 'Кино', title: 'Звезда по имени Солнце' }, 'Кино Группа крови');
  assert.ok(exact > other);
  assert.equal(s({ title: '' }, 'что угодно'), 0);
});

// ---------- bestMatch ----------

test('online-lookup.bestMatch: пустой запрос не ходит в сеть', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error('нельзя'); }, async () => {
    lookup.setup({ cachePath: cachePath() });
    const r = await lookup.bestMatch('', '', '');
    assert.deepEqual(r, { cand: null, s: 0 });
    assert.equal(calls, 0);
  });
});

test('online-lookup.bestMatch: Deezer находит канон, дальше источники не дёргаются', async () => {
  const urls = [];
  await withFetch(async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ data: [{ artist: { name: 'Кино' }, title: 'Группа крови' }] }) };
  }, async () => {
    lookup.setup({ cachePath: cachePath() });
    const r = await lookup.bestMatch('Кино', 'Группа крови', 'Группа крови');
    assert.equal(r.cand.title, 'Группа крови');
    assert.ok(r.s >= 0.85);
    assert.equal(urls.length, 1, 'уверенный ответ — один источник');
    assert.match(urls[0], /api\.deezer\.com\/search/);
  });
});

test('online-lookup.bestMatch: Deezer молчит — берётся iTunes', async () => {
  const urls = [];
  await withFetch(async (url) => {
    urls.push(String(url));
    if (String(url).includes('deezer')) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ results: [{ artistName: 'Кино', trackName: 'Группа крови' }] }) };
  }, async () => {
    lookup.setup({ cachePath: cachePath() });
    const r = await lookup.bestMatch('Кино', 'Группа крови', 'Кино - Группа крови');
    assert.equal(r.cand.title, 'Группа крови');
    assert.ok(urls.some((u) => u.includes('itunes.apple.com')));
  });
});

// ---------- youtubeTitle ----------

test('online-lookup.youtubeTitle: oEmbed отдаёт автора и название', async () => {
  let asked = '';
  await withFetch(async (url) => {
    asked = String(url);
    return { ok: true, json: async () => ({ author_name: 'Кино', title: 'Группа крови' }) };
  }, async () => {
    lookup.setup({ cachePath: cachePath() });
    const r = await lookup.youtubeTitle('https://youtu.be/abc');
    assert.deepEqual(r, { artist: 'Кино', title: 'Группа крови' });
    assert.match(asked, /youtube\.com\/oembed/);
    assert.ok(asked.includes(encodeURIComponent('https://youtu.be/abc')));
  });
});

test('online-lookup.youtubeTitle: ошибка сети — пустые поля, без исключения', async () => {
  await withFetch(async () => { throw new Error('нет сети'); }, async () => {
    lookup.setup({ cachePath: cachePath() });
    assert.deepEqual(await lookup.youtubeTitle('https://youtu.be/abc'), { artist: '', title: '' });
  });
});

// ---------- кэш ----------

test('online-lookup: повторный запрос берётся из кэша, а не из сети', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return { ok: true, json: async () => ({ data: [{ artist: { name: 'Кино' }, title: 'Группа крови' }] }) };
  }, async () => {
    lookup.setup({ cachePath: cachePath() });
    await lookup.bestMatch('Кино', 'Группа крови', 'Группа крови');
    await lookup.bestMatch('Кино', 'Группа крови', 'Группа крови');
    assert.equal(calls, 1, 'второй раз — из памяти');
  });
});

// ---------- предохранитель ----------

test('online-lookup: после трёх ошибок хост временно не дёргается', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => ({ author_name: 'A', title: 'B' }) };
    throw new Error('сервис лежит');
  }, async () => {
    lookup.setup({ cachePath: cachePath() });
    // Успешный ответ сбрасывает счётчик ошибок, накопленный прошлыми тестами.
    await lookup.youtubeTitle('https://youtu.be/reset');
    for (let i = 0; i < 3; i++) assert.deepEqual(await lookup.youtubeTitle('https://youtu.be/x' + i), { artist: '', title: '' });
    assert.equal(calls, 4);
    assert.deepEqual(await lookup.youtubeTitle('https://youtu.be/x9'), { artist: '', title: '' });
    assert.equal(calls, 4, 'четвёртый раз — без запроса, предохранитель');
  });
});
