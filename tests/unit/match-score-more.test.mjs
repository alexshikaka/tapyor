// T1: тесты чистого ранжирования кандидатов заказа (match-score.js).
// Без сети, диска и Electron: проверяем оценку, бонусы источников, штрафы и сравнение строк.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ms = require('../../src/match-score.js');

const track = (title, author, src) => ({ title, author, src });

// ---------- scoreCandidate ----------

test('match-score: точное совпадение названия и исполнителя даёт высокую оценку', () => {
  const r = ms.scoreCandidate({
    message: 'Кино Группа крови', query: 'Кино Группа крови',
    track: track('Группа крови', 'Кино', 'ym'),
  });
  assert.ok(r.score > 0.7, 'оценка ' + r.score);
  assert.ok(r.score <= 1);
  assert.equal(r.parts.title, 1, 'название целиком есть в сообщении');
  assert.equal(r.parts.artist, 1, 'исполнитель есть в сообщении');
  assert.equal(r.parts.source, 0.03, 'бонус Яндекса');
  assert.equal(r.titleWords, 2);
  assert.equal(r.artistWords, 1);
});

test('match-score: «с ютуба» в сообщении даёт YouTube-бонус, без него — нет', () => {
  const base = { query: 'Кино Группа крови', track: track('Группа крови', 'Кино', 'yt') };
  const withYt = ms.scoreCandidate({ ...base, message: 'поставь с ютуба Кино Группа крови' });
  const without = ms.scoreCandidate({ ...base, message: 'поставь Кино Группа крови' });
  assert.equal(withYt.parts.source, 0.08);
  assert.equal(without.parts.source, 0);
  assert.ok(withYt.score > without.score);
});

test('match-score: у Яндекса и своих файлов бонус, у SoundCloud и Audius — маленький минус', () => {
  const o = (src) => ms.scoreCandidate({ message: 'Кино Группа крови', track: track('Группа крови', 'Кино', src) });
  assert.equal(o('ym').parts.source, 0.03);
  assert.equal(o('local').parts.source, 0.02);
  assert.equal(o('sc').parts.source, -0.01);
  assert.equal(o('au').parts.source, -0.01);
});

test('match-score: слишком короткое название без исполнителя получает штраф', () => {
  const r = ms.scoreCandidate({ message: 'да', track: track('Да', '', 'yt') });
  assert.equal(r.parts.shortPenalty, -0.12);
  assert.equal(r.parts.artist, 0);
});

test('match-score: запрет версий штрафует ремикс, разрешение — нет', () => {
  const args = { message: 'поставь песню', query: 'песня', track: track('Песня (remix)', 'Кто-то', 'yt') };
  const no = ms.scoreCandidate({ ...args, allowVersions: false });
  const yes = ms.scoreCandidate({ ...args, allowVersions: true });
  assert.equal(no.parts.version, true);
  assert.equal(no.parts.versionPenalty, -0.25);
  assert.equal(yes.parts.versionPenalty, 0);
  assert.ok(no.score < yes.score);
});

test('match-score: кириллица, «ё» и регистр сравниваются без ложного промаха', () => {
  const r = ms.scoreCandidate({ message: 'Ёлка Всё будет хорошо', track: track('Всё будет хорошо', 'Ёлка', 'ym') });
  assert.equal(r.parts.title, 1);
  assert.equal(r.parts.artist, 1);
});

test('match-score: пустой трек и мусор не бросают, оценка в границах 0…1', () => {
  for (const o of [{}, { message: null, query: null, track: null }, { message: 123, track: { title: 42 } }]) {
    const r = ms.scoreCandidate(o);
    assert.ok(Number.isFinite(r.score));
    assert.ok(r.score >= 0 && r.score <= 1, 'оценка ' + r.score);
  }
});

test('match-score: оценка не превышает 1 даже при всех совпадениях', () => {
  const r = ms.scoreCandidate({
    message: 'youtube Кино Группа крови', query: 'Кино Группа крови',
    track: track('Кино Группа крови', 'Кино', 'yt'),
  });
  assert.ok(r.score <= 1);
  assert.equal(r.score, 1, 'оценка обрезается до 1');
});

// ---------- rankCandidates / margin ----------

test('match-score.rankCandidates: сортирует по оценке и не меняет исходный список', () => {
  const list = [{ id: 'a', score: 0.2 }, { id: 'b', score: 0.9 }, { id: 'c' }];
  const sorted = ms.rankCandidates(list);
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(list.map((x) => x.id), ['a', 'b', 'c'], 'исходный массив не отсортирован');
});

test('match-score.rankCandidates: null и пусто — пустой список', () => {
  assert.deepEqual(ms.rankCandidates(null), []);
  assert.deepEqual(ms.rankCandidates([]), []);
});

test('match-score.margin: один кандидат — запас 1, два — разница оценок', () => {
  assert.equal(ms.margin([]), 1);
  assert.equal(ms.margin([{ score: 0.5 }]), 1);
  assert.ok(Math.abs(ms.margin([{ score: 0.9 }, { score: 0.7 }]) - 0.2) < 1e-9);
});

// ---------- stringSim / phraseCover ----------

test('match-score.stringSim: равные строки — 1, пустые — 0, опечатка снижает сходство', () => {
  assert.equal(ms.stringSim('песня', 'песня'), 1);
  assert.equal(ms.stringSim('', 'песня'), 0);
  assert.equal(ms.stringSim('песня', ''), 0);
  assert.ok(Math.abs(ms.stringSim('kitten', 'sitting') - (1 - 3 / 7)) < 1e-9);
  assert.equal(ms.stringSim('аб', 'аб'), 1);
});

test('match-score.phraseCover: общие пары слов считаются, короткая строка — 0', () => {
  assert.equal(ms.phraseCover(['a', 'b', 'c'], ['a', 'b', 'd']), 0.5);
  assert.equal(ms.phraseCover(['a'], ['a', 'b']), 0);
  assert.equal(ms.phraseCover([], ['a', 'b']), 0);
  assert.equal(ms.phraseCover(['a', 'b'], ['a', 'b']), 1);
});

test('match-score.tokens: служебные слова и псевдонимы обрабатываются как в reqparse', () => {
  assert.deepEqual(ms.tokens('The Beatles — Let It Be'), ['beatles', 'let', 'it', 'be']);
  assert.deepEqual(ms.tokens('Эминем — Lose Yourself'), ['eminem', 'lose', 'yourself']);
  assert.deepEqual(ms.tokens(null), []);
});

test('match-score.isVersion: ремикс, лайв и кавер латиницей — версии; обычное слово — нет', () => {
  for (const s of ['Песня (remix)', 'Песня live', 'Song SPED UP', 'Song nightcore']) {
    assert.equal(ms.isVersion(s), true, s);
  }
  for (const s of ['Delivery', 'Песня', '', null, 'Livehouse']) {
    assert.equal(ms.isVersion(s), false, String(s));
  }
});

// В VERSION_RX (src/match-score.js:5, src/select.js:9, src/reqparse.js:272) границы слова
// заданы явно через \p{L}/\p{N}: \b в JavaScript не считает кириллицу словом.
test('match-score.isVersion: русские «ремикс», «кавер» и «минус» распознаются как версия',
  () => {
    assert.equal(ms.isVersion('Песня ремикс'), true);
    assert.equal(ms.isVersion('Песня кавер'), true);
    assert.equal(ms.isVersion('Песня минус'), true);
  });
