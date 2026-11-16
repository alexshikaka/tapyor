import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const z = require('../../src/browser-zoom.js');

test('browser-zoom: шаг 10 % и границы 50–200 %', () => {
  assert.equal(z.nextFactor(1, 'in'), 1.1);
  assert.equal(z.nextFactor(1, 'out'), 0.9);
  assert.equal(z.nextFactor(0.7, 'in'), 0.8, '0,7 + 0,1 без 0,799999');
  assert.equal(z.nextFactor(1.9, 'in'), 2);
  assert.equal(z.nextFactor(2, 'in'), 2, 'выше 200 % не поднимаемся');
  assert.equal(z.nextFactor(0.6, 'out'), 0.5);
  assert.equal(z.nextFactor(0.5, 'out'), 0.5, 'ниже 50 % не опускаемся');
  assert.equal(z.nextFactor(1.7, 'reset'), 1);
  assert.equal(z.nextFactor(1.3, 'nope'), 1.3, 'неизвестное действие ничего не меняет');
  assert.equal(z.percent(1.1), 110);
});

test('browser-zoom: ключ хоста', () => {
  assert.equal(z.hostOf('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(z.hostOf('http://music.yandex.ru/'), 'music.yandex.ru');
  assert.equal(z.hostOf('https://Example.COM:8443/a'), 'example.com');
  assert.equal(z.hostOf('https://example.com./a'), 'example.com');
  assert.equal(z.hostOf('about:blank'), '');
  assert.equal(z.hostOf('не адрес'), '');
  assert.equal(z.hostOf(''), '');
});

test('browser-zoom: чтение масштаба сайта', () => {
  const map = { 'youtube.com': 1.4, 'example.com': 0.5 };
  assert.equal(z.get(map, 'youtube.com'), 1.4);
  assert.equal(z.get(map, 'unknown.ru'), 1);
  assert.equal(z.get({ 'x.ru': 99 }, 'x.ru'), 2, 'сохранённое значение поджимается к 200 %');
  assert.equal(z.get(null, 'x.ru'), 1);
});

test('browser-zoom: до 200 сайтов, старые вытесняются, изменённый уходит в конец', () => {
  let map = {};
  for (let i = 0; i < 200; i++) map = z.remember(map, 'site' + i + '.ru', 1.2).map;
  assert.equal(Object.keys(map).length, 200);
  assert.equal(map['site0.ru'], 1.2);
  // трогаем старый сайт — он становится новым и не вытесняется
  map = z.remember(map, 'site0.ru', 1.3).map;
  const r = z.remember(map, 'new.ru', 1.1);
  assert.equal(Object.keys(r.map).length, 200);
  assert.deepEqual(r.evicted, ['site1.ru'], 'вытесняется самый старый после site0');
  assert.equal(r.map['site0.ru'], 1.3);
  assert.equal(r.map['new.ru'], 1.1);
  assert.equal(r.map['site1.ru'], undefined);
  // сброс на 100 % убирает сайт из настроек
  const reset = z.remember(r.map, 'new.ru', 1);
  assert.equal(reset.map['new.ru'], undefined);
  assert.equal(Object.keys(reset.map).length, 199);
});
