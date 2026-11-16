// TH-1: восемь встроенных тем (четыре основы × «тёмная/светлая») и миграция старых id.
// Чистая математика theme.js: без окна, Electron и сети.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../../src/theme.js');

const IDS = ['dark', 'dark-l', 'mono', 'mono-l', 'winter', 'winter-l', 'magenta', 'magenta-l'];

test('встроенные темы: ровно 8 нужных id, парами «тёмная — светлая»', () => {
  const list = T.builtinList();
  assert.equal(list.length, 8, 'встроенных тем: ' + list.length);
  assert.deepEqual(list.map((t) => t.id), IDS);
  for (let i = 0; i < list.length; i += 2) {
    assert.equal(list[i].name, list[i + 1].name, 'в паре ' + list[i].id + ' разные названия');
    assert.equal(list[i].sub, 'тёмная', list[i].id + ': подпись');
    assert.equal(list[i + 1].sub, 'светлая', list[i + 1].id + ': подпись');
    assert.equal(list[i].mode, 'dark', list[i].id + ': основа');
    assert.equal(list[i + 1].mode, 'light', list[i + 1].id + ': основа');
  }
});

test('встроенные темы: цвета владельца у «Зимы близко» и «Мадженты»', () => {
  const winter = T.builtinTheme('winter');
  assert.equal(winter.bg, '#0E121A');
  assert.equal(winter.text, '#222831');
  assert.equal(winter.accent, '#343433');
  assert.equal(winter.primary, '#B2CAFF');
  assert.equal(winter.contrast, 50);
  // Текст #222831 на фоне «Зимы» тёмный-на-тёмном — build обязан осветлить до читаемого.
  const wv = T.build(winter);
  assert.ok(T.contrast(wv.tx, wv.bg1) >= 4.5, 'Зима, основной текст: ' + T.contrast(wv.tx, wv.bg1).toFixed(2));
  assert.ok(T.contrast(wv.tx3, wv.bg1) >= 4.5, 'Зима, --tx3: ' + T.contrast(wv.tx3, wv.bg1).toFixed(2));

  const magenta = T.builtinTheme('magenta');
  assert.equal(magenta.bg, '#272727');
  assert.equal(magenta.text, '#E7F0F5');
  assert.equal(magenta.accent, '#C7296B');
  assert.equal(magenta.primary, '#7A7A7A');
  assert.equal(magenta.contrast, 54);
  const mv = T.build(magenta);
  assert.ok(T.contrast(mv.tx, mv.bg1) >= 4.5, 'Маджента, основной текст: ' + T.contrast(mv.tx, mv.bg1).toFixed(2));
});

test('встроенные темы: светлая версия — тем же алгоритмом flipMode, текст читается', () => {
  for (const id of ['dark', 'mono', 'winter', 'magenta']) {
    const dark = T.builtinTheme(id);
    const light = T.builtinTheme(id + '-l');
    const flipped = T.flipMode(dark, 'light');
    assert.equal(light.mode, 'light', id + '-l: основа');
    for (const k of ['bg', 'text', 'accent', 'primary']) {
      assert.equal(light[k], flipped[k], id + '-l: ' + k + ' не по flipMode');
    }
    const v = T.build(light);
    assert.ok(T.contrast(v.tx, v.bg1) >= 4.5, id + '-l, текст: ' + T.contrast(v.tx, v.bg1).toFixed(2));
  }
});

test('встроенные темы: неизвестный id — null (вызывающий решает, что включить)', () => {
  assert.equal(T.builtinTheme('violet'), null);
  assert.equal(T.builtinTheme('light'), null);
  assert.equal(T.builtinTheme('нет такой'), null);
});

test('миграция: violet → Графит, light → светлый Графит, свои темы не трогаем', () => {
  assert.equal(T.migrateThemeId('violet'), 'dark');
  assert.equal(T.migrateThemeId('light'), 'dark-l');
  for (const id of IDS.concat(['c:abc123', '', null, undefined])) {
    assert.equal(T.migrateThemeId(id), id, 'id ' + String(id) + ' изменился');
  }
});
