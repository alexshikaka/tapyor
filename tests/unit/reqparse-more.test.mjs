// T1: unit-тесты reqparse.js — подготовка текста, слова, сравнение с опечатками,
// время, оплаченные треки и пометки спорного трека. Сам разбор заказов уже покрыт
// tests/reqparse/*.js, здесь — то, что те не трогали.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../src/reqparse.js');

// ---------- prep / tokens / tokEq ----------

test('reqparse.prep: склейки «СловоСлово» разделяются, эмодзи убираются', () => {
  assert.equal(R.prep('ШутКороль'), 'Шут Король');
  assert.equal(R.prep('helloWorld'), 'hello World');
  assert.equal(R.prep('🎵🎶 Кино — Группа крови'), 'Кино — Группа крови');
  assert.equal(R.prep('  много   пробелов  '), 'много пробелов');
  assert.equal(R.prep(null), '');
});

test('reqparse.prep: смешанные латиница/кириллица чинятся в одну азбуку', () => {
  // «Erа» с русской «а» на конце должна стать латинской «Era»
  assert.equal(R.prep('Erа'), 'Era');
  // «Cлайд» с латинской C в начале — кириллицей
  assert.equal(R.prep('Cлайд'), 'Слайд');
});

test('reqparse.tokens: служебные слова, союзы и псевдонимы', () => {
  assert.deepEqual(R.tokens('The Beatles — Let It Be'), ['beatles', 'let', 'it', 'be']);
  assert.deepEqual(R.tokens('Кино и Шут'), ['кино', 'шут']);
  assert.deepEqual(R.tokens('Эминем feat. Rihanna'), ['eminem', 'rihanna']);
  assert.deepEqual(R.tokens('Рамштайн — Sonne'), ['rammstein', 'sonne']);
  assert.deepEqual(R.tokens(null), []);
});

test('reqparse.tokEq: окончания, опечатка и транслитерация', () => {
  assert.equal(R.tokEq('кукушку', 'кукушка'), true);
  assert.equal(R.tokEq('nautilus', 'nautiluss'), true, 'одна лишняя буква в длинном слове');
  assert.equal(R.tokEq('nautilus', 'Наутилус'), true, 'транслитерация');
  assert.equal(R.tokEq('эминем', 'eminem'), true, 'псевдоним');
  assert.equal(R.tokEq('кино', 'кино'), true);
  assert.equal(R.tokEq('кино', 'театр'), false);
  assert.equal(R.tokEq('кот', 'кит'), false, 'в коротких словах опечатка не прощается');
  assert.equal(R.tokEq('', ''), true);
});

// ---------- fmt / paidCount ----------

test('reqparse.fmt: время от секунд до часов', () => {
  assert.equal(R.fmt(0), '0:00');
  assert.equal(R.fmt(59), '0:59');
  assert.equal(R.fmt(60), '1:00');
  assert.equal(R.fmt(3599), '59:59');
  assert.equal(R.fmt(3600), '1:00:00');
  assert.equal(R.fmt(3661), '1:01:01');
});

test('reqparse.paidCount: сколько треков оплачено', () => {
  assert.equal(R.paidCount(100, 50), 2);
  assert.equal(R.paidCount(99, 50), 1);
  assert.equal(R.paidCount(50, 50), 1);
  assert.equal(R.paidCount(0, 50), 0);
  assert.equal(R.paidCount(100, 0), Infinity, 'цена не задана — не ограничиваем');
  assert.equal(R.paidCount(null, 50), Infinity, 'сумма неизвестна — не ограничиваем');
});

// ---------- flags ----------

test('reqparse.flags: длинный трек, 18+, стоп-лист и троллинг', () => {
  assert.deepEqual(R.flags({ title: 'Песня', author: 'A', seconds: 500 }, '').map((x) => x.k), ['long']);
  assert.deepEqual(R.flags({ title: 'Песня', author: 'A', seconds: 300 }, '').map((x) => x.k), []);
  assert.deepEqual(R.flags({ title: 'Песня', explicit: true }, '').map((x) => x.k), ['explicit']);
  assert.deepEqual(R.flags({ title: 'Песня', explicit: true }, '', { explicitOk: true }).map((x) => x.k), []);
  assert.deepEqual(R.flags({ title: 'Песня', author: 'A' }, '', { stopWords: ['песня'] }).map((x) => x.k), ['stop']);
  assert.deepEqual(R.flags({ title: 'Earrape remix', author: 'A' }, '').map((x) => x.k).sort(), ['troll', 'version']);
});

test('reqparse.flags: не-музыка помечается, если в сообщении о ней не просили', () => {
  assert.ok(R.flags({ title: 'Обзор игры', author: 'A' }, '').some((x) => x.k === 'nonmusic'));
  assert.ok(!R.flags({ title: 'Обзор игры', author: 'A' }, 'посмотри обзор игры').some((x) => x.k === 'nonmusic'));
});

test('reqparse.flags: версия в названии — пометка, если её не просили', () => {
  assert.ok(R.flags({ title: 'Песня (remix)', author: 'A' }, 'поставь песню').some((x) => x.k === 'version'));
  assert.ok(!R.flags({ title: 'Песня (remix)', author: 'A' }, 'поставь песню remix').some((x) => x.k === 'version'));
});

// VERSION в reqparse (src/reqparse.js:272) написан с явными границами \p{L}/\p{N},
// потому что \b не считает кириллицу словом. Русские «ремикс», «кавер», «лайв» — версии.
test('reqparse.flags: русская пометка версии распознаётся',
  () => {
    assert.ok(R.flags({ title: 'Песня (ремикс)', author: 'A' }, 'поставь песню').some((x) => x.k === 'version'));
    assert.ok(R.flags({ title: 'Песня (кавер)', author: 'A' }, 'поставь песню').some((x) => x.k === 'version'));
  });

// ---------- MUSIC_RX / DEFAULT_STOP ----------

test('reqparse.MUSIC_RX: слова про музыку и команды узнаются', () => {
  for (const s of ['поставь песню', 'включи трек', '!sr Кино', 'sr Кино', '🎵 Кино', 'music please']) {
    assert.equal(R.MUSIC_RX.test(s), true, s);
  }
  for (const s of ['привет', 'как дела', 'выкати Варяг', '']) {
    assert.equal(R.MUSIC_RX.test(s), false, s);
  }
});

test('reqparse.DEFAULT_STOP: запрещённые темы на месте', () => {
  for (const w of ['лгбт', 'nazi', 'расист', 'white power']) assert.ok(R.DEFAULT_STOP.includes(w), w);
});
