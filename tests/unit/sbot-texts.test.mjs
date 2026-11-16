// T1: тесты sbot-texts.js — фразы ответов Streamer.bot: подстановки, ник, обрезка,
// аккуратный вид и отключение/правка текста стримером. Без сети и Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../../src/sbot-texts.js');

// ---------- DEFAULTS / REASONS ----------

test('sbot-texts: наборы фраз и причин отказа не пустые', () => {
  assert.ok(Object.keys(T.DEFAULTS).length > 20);
  assert.ok(Object.keys(T.REASONS).length > 10);
  for (const [k, v] of Object.entries(T.DEFAULTS)) assert.equal(typeof v, 'string', k);
  for (const [k, v] of Object.entries(T.REASONS)) assert.ok(v.trim(), k);
  assert.equal(T.REPLY_MAX, 480);
});

test('sbot-texts: фразы с ником начинаются с {ник}, а «ничьи» — нет', () => {
  for (const k of ['queued', 'awaiting', 'notFound', 'cancelled', 'placeWaiting']) {
    assert.ok(T.DEFAULTS[k].startsWith('{ник}'), k);
  }
  for (const k of ['nowPlaying', 'nowNothing', 'skipNothing', 'nextEmpty', 'overload']) {
    assert.ok(!T.DEFAULTS[k].startsWith('{ник}'), k);
  }
});

// ---------- fmtTime ----------

test('sbot-texts.fmtTime: минуты, не меньше одной, мусор — «скоро»', () => {
  assert.equal(T.fmtTime(0), '1 мин');
  assert.equal(T.fmtTime(30), '1 мин');
  assert.equal(T.fmtTime(60), '1 мин');
  assert.equal(T.fmtTime(90), '2 мин');
  assert.equal(T.fmtTime(600), '10 мин');
  assert.equal(T.fmtTime(null), 'скоро');
  assert.equal(T.fmtTime(undefined), 'скоро');
  assert.equal(T.fmtTime(NaN), 'скоро');
  assert.equal(T.fmtTime(Infinity), 'скоро');
});

test('sbot-texts.fmtTime: отрицательное и огромное число не бросают', () => {
  assert.equal(T.fmtTime(-100), '1 мин');
  assert.match(T.fmtTime(1e12), /^\d+ мин$/);
});

// ---------- render / nick / tidy ----------

test('sbot-texts.render: подставляет известные ключи, неизвестные оставляет', () => {
  assert.equal(T.render('{ник} поставил: {трек}', { 'ник': '@Вася', 'трек': 'Песня' }), '@Вася поставил: Песня');
  assert.equal(T.render('{ник} и {нет}', { 'ник': '@Вася' }), '@Вася и {нет}');
  assert.equal(T.render('{ник}', { 'ник': '' }), '');
  assert.equal(T.render('{a}', null), '{a}');
});

test('sbot-texts.nick: «@» добавляется один раз, пустое — пусто', () => {
  assert.equal(T.nick('Вася'), '@Вася');
  assert.equal(T.nick('@Вася'), '@Вася');
  assert.equal(T.nick('  @@Вася  '), '@Вася');
  assert.equal(T.nick(''), '');
  assert.equal(T.nick(null), '');
  assert.equal(T.nick(undefined), '');
  assert.equal(T.nick(123), '@123');
});

test('sbot-texts.tidy: лишние пробелы и знак в начале убираются, буква поднимается', () => {
  assert.equal(T.tidy('  @Вася,  твой   трек  '), '@Вася, твой трек');
  assert.equal(T.tidy('— твой трек уже играет'), 'твой трек уже играет');
  assert.equal(T.tidy(', твой трек уже играет', true), 'Твой трек уже играет');
  assert.equal(T.tidy('', true), '');
  assert.equal(T.tidy(null), '');
  assert.equal(T.tidy('уже с большой', true), 'Уже с большой');
});

// ---------- clip ----------

test('sbot-texts.clip: длинная фраза обрезается с многоточием, короткая — как есть', () => {
  const long = 'а'.repeat(600);
  const out = T.clip(long);
  assert.equal(out.length, T.REPLY_MAX);
  assert.ok(out.endsWith('…'));
  assert.equal(T.clip('коротко'), 'коротко');
  assert.equal(T.clip(null), '');
  assert.equal(T.clip(undefined), '');
});

test('sbot-texts.clip: свой предел и мусор вместо предела', () => {
  assert.equal(T.clip('abcdef', 4), 'abc…');
  assert.equal(T.clip('abcdef', 0), 'abcdef', 'ноль — не предел, берём 480');
  assert.equal(T.clip('abcdef', -5), 'abcdef');
  assert.equal(T.clip('abcdef', 'x'), 'abcdef');
});

// ---------- make ----------

test('sbot-texts.make: обычная фраза подставляет ник и трек', () => {
  const s = T.make('queued', { 'ник': T.nick('Вася'), 'трек': 'Кино — Группа крови', 'время': '3' });
  assert.equal(s, '@Вася поставил: Кино — Группа крови, через ~3. Если песня не та — !cancel');
});

test('sbot-texts.make: пустой ник не оставляет «@ ,» и поднимает первую букву', () => {
  const s = T.make('cancelPlaying', { 'ник': '', 'трек': 'Песня' });
  assert.equal(s, 'Твой трек уже играет — отменить нельзя');
});

test('sbot-texts.make: неизвестный ключ — понятная ошибка', () => {
  assert.throws(() => T.make('нет-такого', {}), /нет ответа/);
});

test('sbot-texts.make: стример выключил фразу — пустая строка', () => {
  assert.equal(T.make('queued', {}, { queued: { on: false } }), '');
  assert.equal(T.make('queued', {}, { queued: { on: 0 } }), '');
});

test('sbot-texts.make: своя фраза стримера важнее встроенной, пустая — встроенная', () => {
  const custom = { queued: { on: true, text: '{ник} заказал {трек}' } };
  assert.equal(T.make('queued', { 'ник': '@Вася', 'трек': 'Песня' }, custom), '@Вася заказал Песня');
  assert.equal(T.make('queued', { 'ник': '@Вася', 'трек': 'Песня' }, { queued: { text: '' } }).includes('поставил'), true);
});

test('sbot-texts.make: чужие подстановки остаются как есть, мусор в custom не бросает', () => {
  assert.equal(T.make('queued', { 'ник': '@Вася' }, null).includes('{трек}'), true);
  assert.equal(T.make('queued', {}, { queued: null }), T.DEFAULTS.queued);
  assert.equal(T.make('queued', {}, { queued: { text: 123 } }).startsWith('123'), true);
});

test('sbot-texts.make: кириллица, эмодзи и длинный ник не ломаются', () => {
  const nick = T.nick('Стример_🎵');
  const s = T.make('queued', { 'ник': nick, 'трек': 'Песня 🎶', 'время': '5' });
  assert.ok(s.startsWith('@Стример_🎵'));
  assert.ok(s.includes('Песня 🎶'));
});

test('sbot-texts.make: все встроенные фразы собираются с пустым и полным набором', () => {
  for (const k of Object.keys(T.DEFAULTS)) {
    const withVars = T.make(k, { 'ник': '@Вася', 'трек': 'Песня', 'время': '3', 'место': '2', 'причина': 'нельзя', 'мин': '5', 'варианты': '1) A 2) B', 'список': 'A, B', 'громкость': '50' });
    assert.equal(typeof withVars, 'string', k);
    assert.ok(!/\{(?:ник|трек|время|место|причина|мин)\}/.test(withVars), k + ': ' + withVars);
    const noNick = T.make(k, { 'ник': '' });
    assert.equal(typeof noNick, 'string', k);
    assert.ok(!noNick.startsWith(','), k + ': ' + noNick);
    assert.ok(!noNick.startsWith('—'), k + ': ' + noNick);
  }
});
