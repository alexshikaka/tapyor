// T1: тесты чистых частей rank.js — точность, доступ к площадке, «для эфира»,
// ключ «та же песня» и разбор «Исполнитель - Название». Сеть не нужна.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../src/rank.js');

const CTX = { ymOn: true, ymFull: true, ytOn: true, ytLogged: false, scOn: true, auOn: true, lcOn: true };
const v = (src, title, author, extra) => Object.assign({ src, id: title, title, author, seconds: 210 }, extra || {});

// ---------- cleanChannel / parse ----------

test('rank.cleanChannel: «- Topic», VEVO, Official и Music уходят из имени канала', () => {
  assert.equal(R.cleanChannel('Кино - Topic'), 'Кино');
  assert.equal(R.cleanChannel('KinoVEVO'), 'Kino');
  assert.equal(R.cleanChannel('Kino Official'), 'Kino');
  assert.equal(R.cleanChannel('Kino Music'), 'Kino');
  assert.equal(R.cleanChannel('Кино официальный канал'), 'Кино');
  assert.equal(R.cleanChannel(''), '');
  assert.equal(R.cleanChannel(null), '');
});

test('rank.parse: YouTube «Исполнитель - Название» делится по первому тире', () => {
  const p = R.parse({ src: 'yt', title: 'Кино - Группа крови', author: 'Кино - Topic' });
  assert.equal(p.artist, 'Кино');
  assert.equal(p.title, 'Группа крови');
  assert.equal(p.channel, 'Кино - Topic');
});

test('rank.parse: без тире исполнитель берётся из канала и чистится', () => {
  const p = R.parse({ src: 'yt', title: 'Группа крови', author: 'KinoVEVO' });
  assert.equal(p.artist, 'Kino');
  assert.equal(p.title, 'Группа крови');
});

test('rank.parse: у Яндекса исполнитель — author, название не режется по тире', () => {
  const p = R.parse({ src: 'ym', title: 'Группа крови - live', author: 'Кино' });
  assert.equal(p.artist, 'Кино');
  assert.equal(p.title, 'Группа крови - live');
});

test('rank.parse: пустой объект не бросает', () => {
  const p = R.parse({});
  assert.equal(p.title, '');
  assert.equal(p.artist, '');
  assert.equal(p.channel, '');
});

// ---------- relevance ----------

test('rank.relevance: точное название и исполнитель — высокий балл, чужая песня — низкий', () => {
  const exact = R.relevance('кино группа крови', v('ym', 'Группа крови', 'Кино'));
  const other = R.relevance('кино группа крови', v('ym', 'Звезда по имени Солнце', 'Кино'));
  assert.ok(exact > other + 20, 'точное ' + exact + ', чужое ' + other);
});

test('rank.relevance: пустой запрос — 0', () => {
  assert.equal(R.relevance('', v('yt', 'Песня', 'Кто-то')), 0);
  assert.equal(R.relevance('   ', v('yt', 'Песня', 'Кто-то')), 0);
});

test('rank.relevance: кавер и ремикс штрафуются, если о них не просили', () => {
  const original = R.relevance('кино группа крови', v('yt', 'Кино - Группа крови', 'Кино'));
  const cover = R.relevance('кино группа крови', v('yt', 'Кино - Группа крови (cover)', 'Кто-то'));
  assert.ok(original > cover, 'оригинал ' + original + ' должен быть выше кавера ' + cover);
});

// Поведение «попросили ремикс — он не штрафуется» уже проверено в rank.test.mjs;
// здесь не дублируем, чтобы не подгонять ожидание под внутренние веса.

test('rank.relevance: официальный канал получает небольшой плюс', () => {
  const topic = R.relevance('кино группа крови', v('yt', 'Группа крови', 'Кино - Topic'));
  const random = R.relevance('кино группа крови', v('yt', 'Группа крови', 'Случайный канал'));
  assert.ok(topic > random);
});

// ---------- access / score ----------

test('rank.access: Яндекс без Плюса — отрывок, выключенный — off, с Плюсом — full', () => {
  const ym = v('ym', 'Песня', 'Кто-то');
  assert.equal(R.access(ym, { ...CTX, ymFull: false }), 'preview');
  assert.equal(R.access(ym, { ...CTX, ymOn: false }), 'off');
  assert.equal(R.access(ym, CTX), 'full');
  assert.equal(R.access({ ...ym, preview: true }, CTX), 'preview');
});

test('rank.access: YouTube, SoundCloud, Audius и свой файл учитывают свои выключатели', () => {
  assert.equal(R.access(v('yt', 'A', 'B'), { ...CTX, ytOn: false }), 'off');
  assert.equal(R.access(v('sc', 'A', 'B'), { ...CTX, scOn: false }), 'off');
  assert.equal(R.access(v('sc', 'A', 'B'), CTX), 'full');
  assert.equal(R.access(v('au', 'A', 'B'), { ...CTX, auOn: false }), 'off');
  assert.equal(R.access(v('lc', 'A', 'B'), { ...CTX, lcOn: false }), 'off');
  assert.equal(R.access(v('lc', 'A', 'B'), CTX), 'full');
});

test('rank.score: выключенная площадка уходит в самый низ при любом режиме', () => {
  const off = R.score('кино группа крови', v('ym', 'Группа крови', 'Кино'), 'smart', { ...CTX, ymOn: false });
  const on = R.score('кино группа крови', v('yt', 'Группа крови', 'Кино'), 'smart', CTX);
  assert.ok(off < -500, 'off = ' + off);
  assert.ok(on > 0, 'on = ' + on);
});

test('rank.score: режим «free» поднимает бесплатные площадки выше Яндекса', () => {
  const ym = R.score('кино группа крови', v('ym', 'Группа крови', 'Кино'), 'free', CTX);
  const yt = R.score('кино группа крови', v('yt', 'Кино - Группа крови', 'Кино'), 'free', CTX);
  assert.ok(yt > ym, 'YouTube ' + yt + ' должен быть выше Яндекса ' + ym);
});

test('rank.score: режим «subs» поднимает платные площадки', () => {
  const ym = R.score('кино группа крови', v('ym', 'Группа крови', 'Кино'), 'subs', CTX);
  const yt = R.score('кино группа крови', v('yt', 'Кино - Группа крови', 'Кино'), 'subs', CTX);
  assert.ok(ym > yt, 'Яндекс ' + ym + ' должен быть выше YouTube ' + yt);
});

test('rank.score: «для эфира» опускает часовые записи и концерты', () => {
  const long = v('yt', 'Кино - Группа крови', 'Кино', { seconds: 3600 });
  const normal = v('yt', 'Кино - Группа крови', 'Кино', { seconds: 210 });
  const live = v('yt', 'Кино - Группа крови live', 'Кино');
  assert.ok(R.score('кино группа крови', long, 'air', CTX) < R.score('кино группа крови', normal, 'air', CTX));
  assert.ok(R.score('кино группа крови', live, 'air', CTX) < R.score('кино группа крови', normal, 'air', CTX));
});

// ---------- songKey ----------

test('rank.songKey: одна песня с разных площадок даёт один ключ', () => {
  const a = R.songKey(v('ym', 'Группа крови', 'Кино'));
  const b = R.songKey(v('yt', 'Кино - Группа крови', 'Кино - Topic'));
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test('rank.songKey: ремикс — другая песня, пустое название — пустой ключ', () => {
  const original = R.songKey(v('yt', 'Кино - Группа крови', 'Кино'));
  const remix = R.songKey(v('yt', 'Кино - Группа крови (remix)', 'Кто-то'));
  assert.notEqual(original, remix);
  assert.equal(R.songKey(v('yt', '', 'Кино')), '');
});

test('rank.songKey: несколько исполнителей — ключ по первому', () => {
  const one = R.songKey(v('ym', 'Песня', 'Баста'));
  const many = R.songKey(v('ym', 'Песня', 'Баста, Скриптонит feat. Мот'));
  assert.equal(one, many);
});

// ---------- rank ----------

test('rank.rank: одинаковые песни склеиваются, остальные уходят в alts лучшей', () => {
  const list = [
    v('ym', 'Группа крови', 'Кино', { id: 'ym' }),
    v('yt', 'Кино - Группа крови', 'Кино - Topic', { id: 'yt' }),
    v('yt', 'Кино - Звезда по имени Солнце', 'Кино', { id: 'other' }),
  ];
  const out = R.rank('кино группа крови', list, 'smart', CTX);
  assert.equal(out.length, 2, 'две разные песни');
  const blood = out.find((x) => /крови/i.test(x.title));
  assert.ok(Array.isArray(blood.alts));
  assert.equal(blood.alts.length, 1, 'вторая версия — в alts');
  assert.ok(blood._acc, 'доступ записан');
});

test('rank.rank: пустой список — пустой результат, исходный массив не портится', () => {
  assert.deepEqual(R.rank('кино', [], 'smart', CTX), []);
  const list = [v('ym', 'Группа крови', 'Кино')];
  R.rank('кино группа крови', list, 'smart', CTX);
  assert.equal(list.length, 1);
});

// ---------- splitArtists ----------

test('rank.splitArtists: запятая, амперсанд и feat. разделяют соавторов', () => {
  const parts = R.splitArtists('Баста, Скриптонит & Мот feat. Кто-то');
  const names = parts.filter((x) => x.name).map((x) => x.name);
  assert.deepEqual(names, ['Баста', 'Скриптонит', 'Мот', 'Кто-то']);
  assert.ok(parts.some((x) => x.sep && x.sep.includes(',')));
});

test('rank.splitArtists: пустая строка и мусор не бросают', () => {
  assert.deepEqual(R.splitArtists(''), []);
  assert.deepEqual(R.splitArtists(null), []);
  assert.deepEqual(R.splitArtists('   '), []);
});
