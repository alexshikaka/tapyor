import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const to = require('../../src/test-order.js');

const NOW = 1700000000000;
const at = () => NOW;

test('тестовый донат: поля как у настоящего, пометка test', () => {
  const d = to.buildDonation({ name: 'Тестовый зритель', amount: 100, service: 'dp', text: 'Кино — Кукушка' }, { now: at, currency: 'RUB' });
  // Те же поля, что заполняют daList/dpList в src/donations.js.
  for (const k of ['prov', 'id', 'name', 'text', 'amount', 'currency', 'amountMain', 'at']) assert.ok(k in d, 'нет поля ' + k);
  assert.equal(d.prov, 'test');
  assert.equal(d.test, true);
  assert.equal(d.name, 'Тестовый зритель');
  assert.equal(d.text, 'Кино — Кукушка');
  assert.equal(d.amount, 100);
  assert.equal(d.amountMain, 100);
  assert.equal(d.currency, 'RUB');
  assert.equal(d.service, 'dp');
  assert.equal(d.at, NOW);
});

test('имя по умолчанию и пустой текст не выдумываются', () => {
  const d = to.buildDonation({ text: '   ' }, { now: at });
  assert.equal(d.name, 'Тестовый зритель');
  assert.equal(d.text, '');
  assert.equal(to.DEFAULT_TEXT, 'Кино — Кукушка');
});

test('сумма: строка, отрицательное и мусор', () => {
  assert.equal(to.buildDonation({ amount: '250.5' }, { now: at }).amount, 250.5);
  assert.equal(to.buildDonation({ amount: -5 }, { now: at }).amount, 0);
  assert.equal(to.buildDonation({ amount: 'abc' }, { now: at }).amount, 0);
  assert.equal(to.buildDonation({ amount: Infinity }, { now: at }).amount, 0);
});

test('валюта приводится к верхнему регистру, service — только da/dp', () => {
  assert.equal(to.buildDonation({}, { now: at, currency: 'rub' }).currency, 'RUB');
  assert.equal(to.buildDonation({ service: 'twitch' }, { now: at }).service, 'da');
  assert.equal(to.buildDonation({ service: 'dp' }, { now: at }).service, 'dp');
});

test('id уникален даже при одном времени', () => {
  const a = to.buildDonation({ text: 'x' }, { now: at });
  const b = to.buildDonation({ text: 'x' }, { now: at });
  assert.notEqual(a.id, b.id);
});

test('длинные имя и текст обрезаются', () => {
  const d = to.buildDonation({ name: 'я'.repeat(200), text: 'т'.repeat(900) }, { now: at });
  assert.equal(d.name.length, 80);
  assert.equal(d.text.length, 500);
});
