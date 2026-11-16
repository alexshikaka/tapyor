import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { analyzeOrder } = require('../../src/order-analyzer.js');

const has = (result, expected) =>
  result.hypotheses.some((h) => Object.entries(expected).every(([key, value]) => h[key] === value));

test('1. «Кино - Группа крови» → music, исполнитель и название определены', () => {
  const r = analyzeOrder('Кино - Группа крови');
  assert.equal(r.intent, 'music');
  assert.ok(r.confidence >= 0.7 && r.confidence <= 1);
  assert.deepEqual({ artist: r.hypotheses[0].artist, title: r.hypotheses[0].title }, { artist: 'Кино', title: 'Группа крови' });
  assert.ok(r.hypotheses[0].queries.includes('Кино Группа крови'));
});

test('2. «Кино Группа крови» без тире → maybe, а не text', () => {
  const r = analyzeOrder('Кино Группа крови');
  assert.equal(r.intent, 'maybe');
  assert.ok(has(r, { artist: 'Кино', title: 'Группа крови' }));
  assert.ok(has(r, { artist: '', title: 'Кино Группа крови' }));
});

test('3. «Выкати Исакова и Москву» → non_music', () => {
  const r = analyzeOrder('Выкати Исакова и Москву');
  assert.equal(r.intent, 'non_music');
  assert.deepEqual(r.hypotheses, []);
  assert.ok(r.reasons.includes('ACTION_COMMAND'));
});

test('4. «поставь лайк» → non_music', () => {
  const r = analyzeOrder('поставь лайк');
  assert.equal(r.intent, 'non_music');
  assert.deepEqual(r.hypotheses, []);
});

test('5. OST с названием слева: «Vigilante - Hotline Miami OST»', () => {
  const r = analyzeOrder('Vigilante - Hotline Miami OST');
  assert.equal(r.intent, 'music');
  assert.ok(r.reasons.includes('OST_MARKER'));
  const h = r.hypotheses[0];
  assert.equal(h.title, 'Vigilante');
  assert.equal(h.context, 'Hotline Miami');
  assert.ok(h.queries.includes('Vigilante Hotline Miami OST'));
});

test('6. OST справа и без тире: «Hotline Miami OST - Vigilante», «Vigilante OST Hotline Miami»', () => {
  for (const text of ['Hotline Miami OST - Vigilante', 'Vigilante OST Hotline Miami']) {
    const r = analyzeOrder(text);
    assert.equal(r.intent, 'music', text);
    assert.ok(has(r, { title: 'Vigilante', context: 'Hotline Miami' }), text);
  }
});

test('7. feat.: гость уходит в запросы, исполнитель остаётся основным', () => {
  const r = analyzeOrder('Eminem feat. Rihanna - Love The Way You Lie');
  assert.equal(r.intent, 'music');
  assert.ok(r.reasons.includes('FEAT_MARKER'));
  const h = r.hypotheses[0];
  assert.equal(h.artist, 'Eminem');
  assert.equal(h.title, 'Love The Way You Lie');
  assert.ok(h.queries.includes('Eminem Love The Way You Lie feat. Rihanna'));
});

test('8. версия в скобках: «Кино - Группа крови (live)»', () => {
  const r = analyzeOrder('Кино - Группа крови (live)');
  assert.equal(r.hypotheses[0].version, 'live');
  assert.equal(r.hypotheses[0].title, 'Группа крови');
  assert.ok(r.hypotheses[0].queries.includes('Кино Группа крови live'));
});

test('9. слово Live в названии не считается версией', () => {
  const r = analyzeOrder('Oasis - Live Forever');
  assert.equal(r.hypotheses[0].version, '');
  assert.equal(r.hypotheses[0].title, 'Live Forever');
});

test('10. версии в конце: sped up, slowed + reverb, ремикс', () => {
  assert.equal(analyzeOrder('Linkin Park - Numb sped up').hypotheses[0].version, 'spedup');
  assert.equal(analyzeOrder('Linkin Park - Numb slowed + reverb').hypotheses[0].version, 'slowed');
  const remix = analyzeOrder('Кино - Звезда по имени Солнце ремикс');
  assert.equal(remix.hypotheses[0].version, 'remix');
  assert.equal(remix.hypotheses[0].title, 'Звезда по имени Солнце');
});

test('11. несколько песен: с тире и без тире', () => {
  const withDash = analyzeOrder('Кино - Группа крови и Сплин - Выхода нет');
  assert.ok(withDash.reasons.includes('MULTIPLE_SONGS'));
  assert.ok(has(withDash, { artist: 'Кино', title: 'Группа крови', songIndex: 0 }));
  assert.ok(has(withDash, { artist: 'Сплин', title: 'Выхода нет', songIndex: 1 }));

  const noDash = analyzeOrder('Кино Группа крови, Сплин Выхода нет');
  assert.notEqual(noDash.intent, 'non_music');
  assert.ok(has(noDash, { artist: 'Сплин', title: 'Выхода нет', songIndex: 1 }));
});

test('12. команда и вежливость отбрасываются: «Поставь пожалуйста Linkin Park - Numb»', () => {
  const r = analyzeOrder('Поставь пожалуйста Linkin Park - Numb');
  assert.equal(r.intent, 'music');
  assert.ok(r.reasons.includes('MUSIC_VERB'));
  assert.deepEqual({ artist: r.hypotheses[0].artist, title: r.hypotheses[0].title }, { artist: 'Linkin Park', title: 'Numb' });
});

test('13. «Группа крови от Кино» → название и исполнитель', () => {
  const r = analyzeOrder('Группа крови от Кино');
  assert.equal(r.intent, 'music');
  assert.deepEqual({ artist: r.hypotheses[0].artist, title: r.hypotheses[0].title }, { artist: 'Кино', title: 'Группа крови' });
});

test('14. обычный текст, рекомендации, вопросы и игры — не заказ', () => {
  const samples = [
    'Всем привет, классный стрим, удачи!',
    'я сегодня ходил в магазин и купил хлеб а потом пошёл домой и сделал чай',
    'Посоветуйте Numb',
    'Как дела у тебя?',
    'Сыграй в доту',
    'спасибо',
    'ахахах',
  ];
  for (const text of samples) {
    const r = analyzeOrder(text);
    assert.equal(r.intent, 'non_music', text);
    assert.deepEqual(r.hypotheses, [], text);
  }
});

test('15. пустой и нестроковый ввод не падают; формат результата стабилен', () => {
  for (const value of [undefined, null, 42, '', '   ', '🔥🔥🔥', 'https://example.com/track']) {
    const r = analyzeOrder(value);
    assert.equal(r.intent, 'non_music');
    assert.ok(Array.isArray(r.hypotheses) && Array.isArray(r.reasons));
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  }
  const r = analyzeOrder('Кино - Группа крови (live)');
  assert.deepEqual(Object.keys(r.hypotheses[0]).sort(), ['artist', 'context', 'queries', 'songIndex', 'title', 'version']);
  assert.equal(new Set(r.reasons).size, r.reasons.length);
});
test('16. реальный Vigilante: три дефиса, feat. и OST', () => {
  const r = analyzeOrder('Vigilante (feat. mpi & Gemie) - Gundam Narrative OST - Hiroyuki Sawano');
  assert.equal(r.intent, 'music');
  assert.ok(r.hypotheses.some((h) => h.title === 'Vigilante' && h.artist === 'Hiroyuki Sawano'));
  const h = r.hypotheses.find((x) => x.title === 'Vigilante' && x.artist === 'Hiroyuki Sawano');
  assert.equal(h.context, 'Gundam Narrative');
  assert.ok(h.queries.includes('Hiroyuki Sawano Vigilante'));
});
test('17. тире без пробела после: Би-2 -плывет корабль', () => {
  const r = analyzeOrder('Отличного настроения!!! Би-2 -плывет корабль.');
  assert.notEqual(r.intent, 'non_music');
  assert.ok(r.hypotheses.some((h) => h.artist === 'Би-2' && /плывет корабль/i.test(h.title)));
});

test('18. тире без пробела перед: Twenty One Pilots -Drum show', () => {
  const r = analyzeOrder('Twenty One Pilots -Drum show');
  assert.equal(r.intent, 'music');
  assert.ok(r.hypotheses.some((h) => h.artist === 'Twenty One Pilots' && h.title === 'Drum show'));
});
test('19. короткий бытовой текст без музыки — non_music', () => {
  for (const text of ['На чай!!!', 'Кошечке!!!', 'петр', 'Поддержка стрима', 'Го в 2 на Ямато']) {
    assert.equal(analyzeOrder(text).intent, 'non_music', text);
  }
});

test('20. музыкальное слово Music делает текст заказом', () => {
  const r = analyzeOrder('в поддержку сильвера Заря Императора (Объединительные войны Терры) / Warhammer 40k Music');
  assert.notEqual(r.intent, 'non_music');
  assert.ok(r.reasons.includes('MUSIC_MARKER'));
});
