import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const m = require('../../src/mojibake.js');

// Строки-примеры — как в расследовании MOJIBAKE-034 (UTF-8, прочитанный как cp1251).
const BROKEN = {
  monya: 'РњРѕРЅСЊСЏ',
  vsyo: 'Р’СЃС‘ С‡С‚Рѕ РЅСЂР°РІРёС‚СЃСЏ',
  korol: 'РљРѕСЂРѕР»СЊ Рё РЁСѓС‚ вЂ” РљСѓРєР»Р° РєРѕР»РґСѓРЅР°',
};

test('mojibake: «Монья», «Всё что нравится», «Король и Шут» восстанавливаются', () => {
  assert.equal(m.fix(BROKEN.monya), 'Монья');
  assert.equal(m.fix(BROKEN.vsyo), 'Всё что нравится');
  assert.equal(m.fix(BROKEN.korol), 'Король и Шут — Кукла колдуна');
  assert.ok(m.looksBroken(BROKEN.monya));
  assert.ok(m.looksBroken(BROKEN.vsyo));
});

test('mojibake: нормальный русский, латиница, эмодзи и «РСФСР/Россия/СССР» не трогаем', () => {
  const normal = [
    'Монья', 'Всё что нравится', 'Король и Шут — Кукла колдуна',
    'РСФСР', 'Россия', 'СССР', 'Рок и Сон', 'С. Р. Р.',
    'Sovietwave Mix', 'hello world', 'Привет 🎵', 'Р',
  ];
  for (const s of normal) {
    assert.equal(m.looksBroken(s), false, 'ложное срабатывание на «' + s + '»');
    assert.equal(m.fix(s), s, 'нормальная строка изменилась: ' + s);
  }
});

test('mojibake: без потерь — иначе строка как есть, повторное исправление ничего не меняет', () => {
  // эмодзи нет в cp1251 — обратное преобразование было бы с потерей
  const withEmoji = 'РџСЂРёРІРµС‚ 🎵';
  assert.equal(m.fix(withEmoji), withEmoji);
  const once = m.fix(BROKEN.vsyo);
  assert.equal(once, 'Всё что нравится');
  assert.equal(m.fix(once), once, 'повторное исправление изменило нормальную строку');
  assert.equal(m.fix(''), '');
  assert.equal(m.fix(null), null);
});

test('mojibake: правятся только свои плейлисты, счётчики строк верные', () => {
  const lists = [
    { src: 'tap', title: BROKEN.monya, author: 'Тапёр', tracks: [
      { src: 'ym', title: BROKEN.korol, author: 'РљРѕСЂРѕР»СЊ Рё РЁСѓС‚', album: BROKEN.vsyo },
      { src: 'yt', title: 'Обычная песня', author: 'Кто-то', album: 'Альбом' },
    ] },
    { src: 'ym', title: BROKEN.monya, tracks: [{ title: BROKEN.vsyo }] },
  ];
  assert.equal(m.countBroken(lists), 4, 'title + 3 поля трека; чужой плейлист не считаем');
  const r = m.fixLists(lists);
  assert.equal(r.fixed, 4);
  assert.equal(r.failed, 0);
  assert.equal(r.lists[0].title, 'Монья');
  assert.equal(r.lists[0].tracks[0].title, 'Король и Шут — Кукла колдуна');
  assert.equal(r.lists[0].tracks[0].author, 'Король и Шут');
  assert.equal(r.lists[0].tracks[0].album, 'Всё что нравится');
  assert.equal(r.lists[1].title, BROKEN.monya, 'чужой плейлист не тронут');
  assert.equal(r.lists[0].tracks[1].title, 'Обычная песня');
  const again = m.fixLists(r.lists);
  assert.equal(again.fixed, 0, 'повторное исправление ничего не меняет');
  assert.equal(again.failed, 0);
  assert.equal(m.countBroken(r.lists), 0);
});

// G2: «Исправить» чинит только свои плейлисты, и после частичной починки должно быть
// понятно: сколько починено, сколько не вышло и сколько осталось чужим (его не трогаем).
test('mojibake: частичная починка — result говорит, что починено, что не вышло и что не наше', () => {
  const EMOJI = 'РџСЂРёРІРµС‚ 🎵'; // испорчено, но в cp1251 эмодзи нет — без потерь не восстановить
  const lists = [
    { src: 'tap', type: 'tap', title: BROKEN.monya, tracks: [
      { src: 'ym', title: BROKEN.korol, author: 'Обычный автор', album: 'Альбом' },
      { src: 'yt', title: EMOJI, author: 'Кто-то' },
      { src: 'yt', title: BROKEN.vsyo },
    ] },
    { src: 'ym', type: 'playlist', title: BROKEN.monya, tracks: [{ title: BROKEN.vsyo }] },
    { src: 'tap', type: 'tap', title: 'Нормальный плейлист', tracks: [] },
  ];
  const s = m.scan(lists);
  assert.equal(s.own, 4, 'в своих плейлистах испорчено 4 строки');
  assert.equal(s.fixable, 3, 'из них 3 восстановятся без потерь');
  assert.equal(s.unfixable, 1, '1 восстановить нельзя (эмодзи нет в старой кодировке)');
  assert.equal(s.foreign, 2, '2 испорченные строки — в чужом плейлисте');
  assert.equal(s.total, 6);

  const r = m.fixLists(lists);
  assert.equal(r.fixed, 3, 'починено 3 строки');
  assert.equal(r.failed, 1, '1 строку починить не вышло');
  assert.equal(r.skipped, 2, '2 строки в чужом плейлисте не трогали');
  assert.equal(r.lists[0].title, 'Монья');
  assert.equal(r.lists[0].tracks[0].title, 'Король и Шут — Кукла колдуна');
  assert.equal(r.lists[0].tracks[1].title, EMOJI, 'неисправимая строка осталась как была');
  assert.equal(r.lists[1].title, BROKEN.monya, 'чужой плейлист не тронут');
  assert.equal(r.lists[1].tracks[0].title, BROKEN.vsyo, 'чужие треки не тронуты');

  // Повторная проверка не должна видеть уже починенное как «ещё сломано».
  const after = m.scan(r.lists);
  assert.equal(after.own, 1, 'осталась только неисправимая строка');
  assert.equal(after.fixable, 0);
  assert.equal(after.unfixable, 1);
  assert.equal(after.foreign, 2);
  assert.equal(m.countBroken(r.lists), 1, 'countBroken видит только оставшееся');

  const again = m.fixLists(r.lists);
  assert.equal(again.fixed, 0, 'повторная починка ничего не меняет');
  assert.equal(again.failed, 1);
  assert.equal(again.skipped, 2);
});

test('mojibake: если испорчено только чужое — чинить нечего, но видно, что и почему', () => {
  const lists = [
    { src: 'tap', title: 'Мой нормальный', tracks: [] },
    { src: 'ym', type: 'playlist', title: BROKEN.vsyo, tracks: [{ title: BROKEN.monya }] },
    null,
    { src: 'tap', title: 42 },
  ];
  const s = m.scan(lists);
  assert.equal(s.own, 0);
  assert.equal(s.fixable, 0);
  assert.equal(s.foreign, 2);
  const r = m.fixLists(lists);
  assert.equal(r.fixed, 0);
  assert.equal(r.failed, 0);
  assert.equal(r.skipped, 2);
  assert.equal(m.countBroken(r.lists), 0);
});
