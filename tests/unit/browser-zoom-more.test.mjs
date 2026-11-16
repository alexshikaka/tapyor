// T1: дополнение к browser-zoom.test.mjs — границы clamp, проценты, мусор в карте
// масштабов и вытеснение. Чистые расчёты, без Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Z = require('../../src/browser-zoom.js');

test('browser-zoom: пределы и шаг — 50–200 %, шаг 10 %, по умолчанию 100 %', () => {
  assert.equal(Z.MIN, 0.5);
  assert.equal(Z.MAX, 2);
  assert.equal(Z.STEP, 0.1);
  assert.equal(Z.LIMIT, 200);
  assert.equal(Z.DEFAULT, 1);
});

test('browser-zoom.clamp: границы, один знак и мусор', () => {
  assert.equal(Z.clamp(0.1), 0.5);
  assert.equal(Z.clamp(5), 2);
  assert.equal(Z.clamp(1.24), 1.2);
  assert.equal(Z.clamp(1.25), 1.3);
  assert.equal(Z.clamp('1.7'), 1.7);
  assert.equal(Z.clamp(NaN), 1);
  assert.equal(Z.clamp(Infinity), 1);
  assert.equal(Z.clamp('abc'), 1);
});

test('browser-zoom.nextFactor: вверх, вниз, сброс и неизвестное действие', () => {
  assert.equal(Z.nextFactor(1, 'in'), 1.1);
  assert.equal(Z.nextFactor(1, 'out'), 0.9);
  assert.equal(Z.nextFactor(1.7, 'in'), 1.8);
  assert.equal(Z.nextFactor(0.7, 'in'), 0.8, '0,7 + 0,1 без 0,799999');
  assert.equal(Z.nextFactor(2, 'in'), 2);
  assert.equal(Z.nextFactor(0.5, 'out'), 0.5);
  assert.equal(Z.nextFactor(1.3, 'reset'), 1);
  assert.equal(Z.nextFactor(1.3, 'что-то'), 1.3);
  assert.equal(Z.nextFactor('мусор', 'in'), 1.1, 'мусор считается 100 %');
});

test('browser-zoom.percent: округление до целых процентов', () => {
  assert.equal(Z.percent(1), 100);
  assert.equal(Z.percent(0.5), 50);
  assert.equal(Z.percent(2), 200);
  assert.equal(Z.percent(0.555), 60, 'сначала один знак, потом проценты');
  assert.equal(Z.percent(NaN), 100);
});

test('browser-zoom.hostOf: только http(s), без www, порта, пути и точки', () => {
  assert.equal(Z.hostOf('https://WWW.Example.COM:8443/path?q=1'), 'example.com');
  assert.equal(Z.hostOf('http://example.com./'), 'example.com');
  assert.equal(Z.hostOf('https://sub.example.com'), 'sub.example.com');
  assert.equal(Z.hostOf('ftp://example.com'), '');
  assert.equal(Z.hostOf('file:///c:/x'), ''); // export-scan:allow — выдуманный путь для проверки file:///
  assert.equal(Z.hostOf('javascript:alert(1)'), '');
  assert.equal(Z.hostOf(''), '');
  assert.equal(Z.hostOf(null), '');
  assert.equal(Z.hostOf('не ссылка'), '');
});

test('browser-zoom.hostOf: кириллический домен приводится к punycode', () => {
  const h = Z.hostOf('https://Музыка.рф/песни');
  assert.ok(h.startsWith('xn--'), h);
});

test('browser-zoom.get: битая карта, строка и чужие типы — 100 %', () => {
  assert.equal(Z.get(null, 'example.com'), 1);
  assert.equal(Z.get({}, 'example.com'), 1);
  assert.equal(Z.get({ 'example.com': '1.5' }, 'example.com'), 1.5);
  assert.equal(Z.get({ 'example.com': 0 }, 'example.com'), 1, 'ноль — не масштаб');
  assert.equal(Z.get({ 'example.com': 'abc' }, 'example.com'), 1);
  assert.equal(Z.get({ 'example.com': 9 }, 'example.com'), 2, 'сверху ограничено');
  assert.equal(Z.get({ 'example.com': 1 }, ''), 1);
  assert.equal(Z.get('строка', 'example.com'), 1);
});

test('browser-zoom.remember: 100 % не хранится, а старый масштаб сайта убирается', () => {
  const a = Z.remember({ 'a.com': 1.5 }, 'a.com', 1);
  assert.deepEqual(a.map, {}, 'сброс до 100 % удаляет запись');
  const b = Z.remember({ 'a.com': 1.5 }, 'b.com', 1.2);
  assert.deepEqual(b.map, { 'a.com': 1.5, 'b.com': 1.2 });
});

test('browser-zoom.remember: мусор в старой карте отбрасывается, массив не считается картой', () => {
  const r = Z.remember({ 'a.com': 1.5, 'b.com': 'abc', 'c.com': 0, '': 1.4 }, 'd.com', 1.2);
  assert.deepEqual(r.map, { 'a.com': 1.5, 'd.com': 1.2 });
  const arr = Z.remember([1, 2], 'a.com', 1.2);
  assert.deepEqual(arr.map, { 'a.com': 1.2 });
});

test('browser-zoom.remember: предел не меньше одного сайта и вытесняет самые старые', () => {
  const r = Z.remember({ 'a.com': 1.2, 'b.com': 1.3 }, 'c.com', 1.4, 1);
  assert.deepEqual(r.map, { 'c.com': 1.4 });
  assert.deepEqual(r.evicted, ['a.com', 'b.com']);
});

test('browser-zoom.remember: пустой host ничего не добавляет и не удаляет', () => {
  const r = Z.remember({ 'a.com': 1.5 }, '', 1.2);
  assert.deepEqual(r.map, { 'a.com': 1.5 });
});
