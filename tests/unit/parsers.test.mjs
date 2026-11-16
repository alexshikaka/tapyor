import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const y = require('../../src/yandex.js');
const req = require('../../src/reqparse.js');
const { mapTrack, mapStation, cover, fmt } = y._test;

test('yandex: mapTrack разбирает трек', () => {
  const t = mapTrack({
    id: 123, title: 'Группа крови', version: 'Remaster',
    artists: [{ name: 'Кино' }, { name: 'Виктор Цой' }],
    albums: [{ id: 7, title: 'Группа крови', coverUri: 'avatars.yandex.net/cover/%%' }],
    durationMs: 225000, contentWarning: 'explicit', r128: { i: -9 }
  });
  assert.equal(t.id, '123');
  assert.equal(t.albumId, '7');
  assert.equal(t.title, 'Группа крови (Remaster)');
  assert.equal(t.author, 'Кино, Виктор Цой');
  assert.equal(t.duration, '3:45');
  assert.equal(t.seconds, 225);
  assert.equal(t.thumb, 'https://avatars.yandex.net/cover/200x200');
  assert.equal(t.cover, 'https://avatars.yandex.net/cover/600x600');
  assert.equal(t.explicit, true);
  assert.equal(t.lufs, -9);
});

test('yandex: mapTrack не падает на пустом ответе', () => {
  const t = mapTrack({});
  assert.equal(t.title, '');
  assert.equal(t.author, '');
  assert.equal(t.duration, '');
  assert.equal(t.seconds, 0);
  assert.equal(t.available, true);
});

test('yandex: mapStation собирает id/type/parent', () => {
  const s = mapStation({ station: { id: { type: 'genre', tag: 'rock' }, name: 'Рок', parentId: { type: 'genre', tag: 'allrock' }, icon: { backgroundColor: '#123456' } } });
  assert.deepEqual(s, { id: 'genre:rock', type: 'genre', name: 'Рок', color: '#123456', parent: 'genre:allrock' });
});

test('yandex: cover/fmt', () => {
  assert.equal(cover('', '200x200'), '');
  assert.equal(cover('a/%%', '100x100'), 'https://a/100x100');
  assert.equal(fmt(0), '');
  assert.equal(fmt(61000), '1:01');
  assert.equal(fmt(3600000), '60:00');
});

test('reqparse: цена и защита от пустой суммы', () => {
  assert.equal(req.paidCount(300, 100), 3);
  assert.equal(req.paidCount(299, 100), 2);
  assert.equal(req.paidCount(null, 100), Infinity);
  assert.equal(req.paidCount(300, 0), Infinity);
});

test('reqparse: план находит заказ', () => {
  const p = req.plan('поставь Кино - Группа крови');
  assert.ok(Array.isArray(p.queries));
  assert.ok(p.queries.length > 0);
  assert.equal(p.queries[0].query, 'Кино Группа крови');
});
test('reqparse: составной OST-заказ с несколькими тире', () => {
  const msg = 'Vigilante (feat. mpi & Gemie) - Gundam Narrative OST - Hiroyuki Sawano';
  const p = req.plan(msg);
  const queries = p.queries.map((q) => q.query);
  assert.ok(queries.includes('Vigilante Hiroyuki Sawano'));
  assert.ok(queries.filter((q) => q !== msg && q !== p.queries[0].query).every((q) => !q.includes('Gemie)')));
  const t = { src: 'yt', title: 'Gundam Narrative OST - Hiroyuki Sawano / Vigilante (feat. mpi & Gemie)', author: 'Skai' };
  assert.equal(req.judge(msg, t).level, 'exact');
});
test('reqparse: вся фраза без тире', () => {
  const p = req.plan('поставь песню Кино Группа крови');
  assert.equal(p.signal, 'music');
  assert.ok(p.queries.some((q) => q.query === 'Кино Группа крови' && q.kind === 'music'));
});

test('reqparse: несколько фраз в одном заказе', () => {
  const p = req.plan('Кино - Кукушка; Пилот - Осень');
  const qs = p.queries.map((q) => q.query);
  assert.ok(qs.includes('Кино Кукушка'));
  assert.ok(qs.includes('Пилот Осень'));
  assert.equal(new Set(p.queries.map((q) => q.chunk)).size, 2);
});

test('reqparse: сочетания слов без тире', () => {
  const p = req.plan('кино печаль');
  assert.equal(p.signal, 'combo');
  assert.ok(p.queries.some((q) => q.query === 'кино печаль' && q.kind === 'combo'));
});
test('reqparse: заказ без пунктуации', () => {
  const msg = 'Кино Группа крови';
  const p = req.plan(msg);
  assert.equal(p.signal, 'combo');
  assert.ok(p.queries.some((q) => q.query === 'Кино Группа крови'));
  const t = { src: 'ym', title: 'Группа крови', author: 'Кино' };
  assert.equal(req.judge(msg, t).level, 'exact');
});

test('reqparse: обратный порядок без пунктуации', () => {
  const msg = 'Группа крови Кино';
  const p = req.plan(msg);
  assert.equal(p.signal, 'combo');
  const t = { src: 'ym', title: 'Группа крови', author: 'Кино' };
  assert.equal(req.judge(msg, t).level, 'exact');
});
test('reqparse: прямые ссылки вынимаются из сообщения', () => {
  const p = req.plan('заказ https://youtu.be/abc123 и https://music.yandex.ru/track/42');
  assert.deepEqual(p.links, ['https://youtu.be/abc123', 'https://music.yandex.ru/track/42']);
});
test('reqparse: полное название ролика — первым запросом', () => {
  const msg = 'Vigilante (feat. mpi & Gemie) - Gundam Narrative OST - Hiroyuki Sawano';
  const p = req.plan(msg);
  assert.equal(p.queries[0].kind, 'raw');
  assert.equal(p.queries[0].query, msg);
});
test('reqparse: лишние теги в названии YouTube не мешают exact', () => {
  const msg = 'Владимир Ждамиров -Чифирок';
  const track = { src: 'yt', title: 'Владимир Ждамиров - Чифирок (Official Video, 2025) @MELOMAN-HIT', author: 'MELOMAN HIT' };
  assert.equal(req.judge(msg, track).level, 'exact');
});
test('reqparse: транслитерация и расширение файла не мешают exact', () => {
  const msg = 'Прогулки по воде - Nautilus Pompilius';
  const track = { src: 'yt', title: 'НАУТИЛУС ПОМПИЛИУС- Прогулки по воде.wmv', author: 'Георгий Каргин' };
  assert.equal(req.judge(msg, track).level, 'exact');
});
test('reqparse: лишние слова ролика не мешают exact', () => {
  assert.equal(req.judge('Включи пожалуйста император защищает', { src: 'yt', title: '⚠ Warhammer 40K - ИМПЕРАТОР ЗАЩИЩАЕТ! - Nottoys', author: 'Nottoys' }).level, 'exact');
  assert.equal(req.judge('Le professionnel-Ennio Morricone', { src: 'yt', title: 'Ennio Morricone - Chi Mai (Who, Me?) - "Le Professionnel" OST - 1981', author: 'Ennio Morricone' }).level, 'exact');
});
test('reqparse: полное название с / и feat. ищется целиком', () => {
  const msg = 'L.E.I / Enter и CHANSUNG(2PM) & AK-69 feat. CHANGMIN(2AM) / Into the Fire';
  const p = req.plan(msg);
  assert.equal(p.queries[0].kind, 'raw');
  assert.equal(p.queries[0].query, msg);
});
test('reqparse: judge сравнивает с поисковым запросом', () => {
  const track = { src: 'yt', title: 'ГОЛОС ОМЕРИКИ — ТЁПЛАЯ КИТАЙСКАЯ КУРТКА (Official Video)', author: '' };
  assert.equal(req.judge('Можно песню заказать? Тёплая китайская куртка.', track, 'Тёплая китайская куртка').level, 'exact');
  const track2 = { src: 'yt', title: '"Моряк с Ордынки" поёт Сергей Мазуренко', author: '' };
  // В запросе — слово-просьба (filler), а в сообщении ещё и обращение: judge смотрит на запрос
  // без слов-просьб, обращение в сообщении точному совпадению не мешает.
  assert.equal(req.judge('Привет Мурзик, поставь песню "моряк с Ордынки" Сергей Мазуренко', track2, 'поставь, моряк с Ордынки Сергей Мазуренко').level, 'exact');
});
test('reqparse: название в кавычках — отдельный запрос', () => {
  const p = req.plan('Ну раз можно песню заказать, то пора. "Терентий" от группы Электрослабость');
  assert.ok(p.queries.some((q) => q.query === 'Терентий' && q.kind === 'quote'));
  const p2 = req.plan('Привет Мурзик, поставь песню "моряк с Ордынки" Сергей Мазуренко');
  assert.ok(p2.queries.some((q) => q.query === 'моряк с Ордынки' && q.kind === 'quote'));
});
test('reqparse: транслит-алиасы Рамштайн/Rammstein и Император', () => {
  assert.equal(req.judge('Песня Рамштайн Пусси', { src: 'yt', title: 'Rammstein - Pussy', author: 'Rammstein' }, 'Рамштайн Пусси').level, 'exact');
  assert.equal(req.judge('Император защищает вархамер это музыка', { src: 'yt', title: '⚠ Warhammer 40K - ИМПЕРАТОР ЗАЩИЩАЕТ! - Nottoys', author: 'Nottoys' }, 'Император защищает вархамер').level, 'exact');
});
test('reqparse: соседние фразы «Инстасамка. За деньги да»', () => {
  const p = req.plan('Сколько там человек? Нормально, да? Значит можно и песню заказать... Инстасамка. За деньги да 😈');
  assert.ok(p.queries.some((q) => q.query.replace(/\./g, '') === 'Инстасамка За деньги да'));
});
test('reqparse: explicit разрешён по умолчанию, но выключается', () => {
  const track = { src: 'ym', title: 'Song', author: 'Artist', explicit: true, seconds: 200 };
  assert.equal(req.flags(track, 'Song', { explicitOk: true }).some((f) => f.k === 'explicit'), false);
  assert.equal(req.flags(track, 'Song', { explicitOk: false }).some((f) => f.k === 'explicit'), true);
});
