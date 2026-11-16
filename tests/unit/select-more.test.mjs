// T1: тесты единого выбора трека (select.js) — то, чего не было в select.test.mjs:
// уровни inspect, фильтрация и порядок rank, hasSeq, better и таблица источников.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../src/select.js');

const c = (title, author, extra) => Object.assign({ title, author, src: 'ym' }, extra || {});

// ---------- inspect ----------

test('select.inspect: полная фраза и точный исполнитель — tier 5', () => {
  const i = S.inspect(c('Группа крови', 'Кино'), 'Кино Группа крови');
  assert.equal(i.tier, 5);
  assert.equal(i.phraseExact, true);
  assert.equal(i.titleCover, 1);
  assert.equal(i.artistCover, 1);
  assert.equal(i.src, 'ym');
});

test('select.inspect: фраза есть, исполнитель с опечаткой/частично — tier 4', () => {
  // исполнитель из двух слов, в сообщении только одно — покрытие 0.5
  const i = S.inspect(c('Группа крови', 'Кино Театр'), 'Кино Группа крови');
  assert.equal(i.tier, 4);
  assert.equal(i.artistCover, 0.5);
});

test('select.inspect: фраза без исполнителя — tier 3', () => {
  const i = S.inspect(c('Группа крови', 'Кино'), 'Группа крови');
  assert.equal(i.tier, 3);
  assert.equal(i.artistCover, 0);
});

test('select.inspect: все слова названия есть, но не подряд — tier 2', () => {
  const i = S.inspect(c('Группа крови', 'Кино'), 'крови Группа');
  assert.equal(i.tier, 2);
  assert.equal(i.phraseExact, false);
  assert.equal(i.titleCover, 1);
});

test('select.inspect: покрыто больше половины названия — tier 1', () => {
  const i = S.inspect(c('Группа крови солнце', 'Кино'), 'Группа крови');
  assert.equal(i.tier, 1);
  assert.equal(i.titleCover, 0.667);
});

test('select.inspect: чужая песня — tier 0', () => {
  const i = S.inspect(c('Звезда по имени Солнце', 'Кино'), 'Группа крови');
  assert.equal(i.tier, 0);
});

test('select.inspect: сообщение из одного исполнителя не подтверждает одноимённое название', () => {
  // «поставь Кино»: в сообщении, кроме исполнителя, есть слово «поставь»,
  // а название трека целиком состоит из слов исполнителя.
  const i = S.inspect(c('Кино', 'Кино'), 'поставь Кино');
  assert.equal(i.titleOnlyArtist, true);
  assert.equal(i.tier, 0);
});

test('select.inspect: слишком длинный трек опускается максимум до tier 3', () => {
  const i = S.inspect(c('Группа крови', 'Кино', { seconds: 500 }), 'Кино Группа крови', { maxSec: 300 });
  assert.equal(i.long, true);
  assert.equal(i.tier, 3);
  assert.equal(i.seconds, 500);
});

test('select.inspect: версия без просьбы о версии опускается до tier 2', () => {
  // «(remix)» в скобках не входит в слова названия, но версия распознаётся по сырому заголовку.
  const i = S.inspect(c('Группа крови (remix)', 'Кино'), 'Группа крови', {});
  assert.equal(i.version, true);
  assert.equal(i.wantsVersion, false);
  assert.equal(i.tier, 2);
});

test('select.inspect: версию попросили — ограничение не срабатывает', () => {
  const i = S.inspect(c('Группа крови (remix)', 'Кино'), 'Группа крови remix', {});
  assert.equal(i.wantsVersion, true);
  assert.equal(i.tier, 3);
});

test('select.inspect: пустой и мусорный кандидат не бросает', () => {
  for (const cand of [null, {}, { title: null, author: null }]) {
    const i = S.inspect(cand, '');
    assert.equal(i.tier, 0);
    assert.equal(i.titleCover, 0);
    assert.equal(i.artistCover, 0);
  }
});

// ---------- rank / pick ----------

test('select.rank: пустые и без названия отбрасываются, порядок — по tier', () => {
  const list = [
    c('Группа крови', 'Кино', { id: 'exact' }),
    c('Группа крови', 'Кто-то', { id: 'noArtist' }),
    c('', 'Кино', { id: 'empty' }),
    null,
  ];
  const r = S.rank(list, 'Кино Группа крови');
  assert.deepEqual(r.map((x) => x.track.id), ['exact', 'noArtist']);
  assert.equal(r[0].info.tier, 5);
  assert.equal(r[1].info.tier, 3);
});

test('select.rank: выключенный источник не попадает в выдачу', () => {
  const list = [c('Группа крови', 'Кино', { id: 'ym' }), c('Группа крови', 'Кино', { id: 'yt', src: 'yt' })];
  const r = S.rank(list, 'Кино Группа крови', { enabled: { ym: false } });
  assert.deepEqual(r.map((x) => x.track.id), ['yt']);
});

test('select.rank: при равном tier и исполнителе свой файл выше Яндекса, Яндекс выше YouTube', () => {
  const list = [
    c('Группа крови', 'Кино', { id: 'yt', src: 'yt' }),
    c('Группа крови', 'Кино', { id: 'ym', src: 'ym' }),
    c('Группа крови', 'Кино', { id: 'local', src: 'local' }),
  ];
  const r = S.rank(list, 'Кино Группа крови');
  assert.deepEqual(r.map((x) => x.track.id), ['local', 'ym', 'yt']);
});

test('select.rank: при равном источнике выигрывает большая оценка', () => {
  const list = [
    c('Группа крови', 'Кино', { id: 'low', score: 0.2 }),
    c('Группа крови', 'Кино', { id: 'high', score: 0.9 }),
  ];
  assert.equal(S.rank(list, 'Кино Группа крови')[0].track.id, 'high');
});

test('select.pick: пустой список — null', () => {
  assert.equal(S.pick([], 'Кино'), null);
  assert.equal(S.pick(null, 'Кино'), null);
});

test('select.choose: на точном tier 4+ не переспрашивает match.decide', () => {
  const list = [c('Группа крови', 'Кино', { id: 'a' }), c('Звезда', 'Кино', { id: 'b' })];
  const top = S.choose(list, 'Кино Группа крови');
  assert.equal(top.track.id, 'a');
  assert.equal(top.info.tier, 5);
});

// ---------- hasSeq ----------

test('select.hasSeq: подряд идущая фраза находится, разрозненные слова — нет', () => {
  assert.equal(S.hasSeq(['a', 'b', 'c'], ['b', 'c']), true);
  assert.equal(S.hasSeq(['a', 'b', 'c'], ['a', 'c']), false);
  assert.equal(S.hasSeq(['a'], []), false, 'пустой запрос не считается фразой');
  assert.equal(S.hasSeq(['a'], ['a', 'b']), false, 'запрос длиннее текста');
  assert.equal(S.hasSeq([], ['a']), false);
});

test('select.hasSeq: сравнение слов с окончаниями (tokEq), а не посимвольно', () => {
  assert.equal(S.hasSeq(['кукушку', 'зовёт'], ['кукушка', 'зовет']), true);
});

// ---------- better ----------

test('select.better: без второго кандидата решает включённость источника', () => {
  assert.equal(S.better({ candidate: c('A', 'B') }, null), true);
  assert.equal(S.better({ candidate: c('A', 'B') }, null, '', { enabled: { ym: false } }), false);
});

test('select.better: подтверждённый exact важнее сомнительного с большей оценкой', () => {
  const a = { candidate: c('Группа крови', 'Кино'), score: 0.1, good: true };
  const b = { candidate: c('Группа крови', 'Кино'), score: 0.9, good: false };
  assert.equal(S.better(a, b, 'Кино Группа крови'), true);
  assert.equal(S.better(b, a, 'Кино Группа крови'), false);
});

test('select.better: при равных условиях выигрывает tier, затем покрытие исполнителя', () => {
  const exact = { candidate: c('Группа крови', 'Кино', { id: 'exact' }), score: 0.5 };
  const phrase = { candidate: c('Группа крови', 'Кто-то', { id: 'phrase' }), score: 0.9 };
  assert.equal(S.better(exact, phrase, 'Кино Группа крови'), true);
  assert.equal(S.better(phrase, exact, 'Кино Группа крови'), false);
});

test('select.better: выключенный первый кандидат всегда проигрывает', () => {
  const off = { candidate: c('Группа крови', 'Кино', { src: 'ym' }), score: 1 };
  const on = { candidate: c('Группа крови', 'Кино', { src: 'yt' }), score: 0.1 };
  assert.equal(S.better(off, on, 'Кино Группа крови', { enabled: { ym: false } }), false);
});

test('select.SOURCE_RANK: свой файл важнее Яндекса, Яндекс важнее YouTube', () => {
  assert.ok(S.SOURCE_RANK.local > S.SOURCE_RANK.ym);
  assert.ok(S.SOURCE_RANK.ym > S.SOURCE_RANK.yt);
  assert.equal(S.SOURCE_RANK.sc, S.SOURCE_RANK.au);
});
