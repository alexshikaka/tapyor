// B7b (P5b L1): отчёт об ошибке уходил в облако с путями ПК и адресами с параметрами.
// reportScrub раньше вырезал только C:\Users\<имя>, почту и token=…, а D:\Music, UNC-пути
// и ссылки с query оставались. Теперь — те же вычистки, что в отчёте для проверки
// (debug-report): любой абсолютный путь → <путь>, у адреса с параметрами — только хост.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RS = require('../../src/report-scrub.js');

test('report-scrub: любой абсолютный путь Windows и UNC скрывается', () => {
  assert.equal(RS.scrub('D:\\Music\\track.mp3'), '<путь>');
  assert.equal(RS.scrub('\\\\server\\share\\music'), '<путь>');
  const t = RS.scrub('не открылся D:\\Music\\Альбом\\track.mp3');
  assert.ok(!t.includes('Music'), t);
  assert.ok(!t.includes('Альбом'), t);
  assert.ok(!t.includes('server'), RS.scrub('\\\\server\\share'));
});

test('report-scrub: имя пользователя в пути не остаётся', () => {
  const t = RS.scrub('C:\\Users\\test\\AppData\\Roaming');
  assert.ok(!t.includes('test'), t);
  assert.ok(!t.includes('AppData'), t);
});

test('report-scrub: у адреса с параметрами остаётся только хост', () => {
  assert.equal(RS.scrub('https://x.com/?token=secretvalue'), 'https://x.com');
  assert.equal(RS.scrub('https://x.com/a/b?x=1&y=2#frag'), 'https://x.com');
  assert.equal(RS.scrub('http://127.0.0.1:47654/a?x=1'), 'http://127.0.0.1:47654');
  assert.equal(RS.scrub('https://example.invalid/cover.jpg'), 'https://example.invalid/cover.jpg', 'без параметров не трогаем');
});

test('report-scrub: почта, длинные токены и token=… по-прежнему скрыты', () => {
  assert.ok(!RS.scrub('пишите на user@example.com').includes('user@'));
  assert.ok(!RS.scrub('ключ abcdefghijklmnopqrstuvwxyz0123456789').includes('abcdefghijkl'));
  assert.ok(!RS.scrub('https://x.com/?token=abcdef123456').includes('abcdef123456'));
});

test('report-scrub: пустое и мусор не ломают', () => {
  assert.equal(RS.scrub(''), '');
  assert.equal(RS.scrub(null), '');
  assert.equal(RS.scrub(undefined), '');
  assert.equal(RS.scrub('обычная ошибка без путей'), 'обычная ошибка без путей');
});
