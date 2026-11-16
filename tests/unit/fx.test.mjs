// B-05: донат в другой валюте — по курсу; нет курса — null (заказ уходит стримеру).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const fx = require('../../src/fx.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fx-')), 'fx.json');
// ЦБ: 1 USD = 90 RUB, 100 KZT = 18 RUB
const CBR = { Valute: { USD: { Nominal: 1, Value: 90 }, KZT: { Nominal: 100, Value: 18 }, EUR: { Nominal: 1, Value: 100 }, TRY: { Nominal: 10, Value: 25 } } };
const ok = (j) => async () => ({ ok: true, status: 200, json: async () => j });

test('та же валюта — без сети', async () => {
  let calls = 0;
  fx.setup({ cachePath: tmp(), fetch: async () => { calls++; throw new Error('нет сети'); } });
  assert.equal(await fx.convert(150, 'rub', 'RUB'), 150);
  assert.equal(calls, 0);
});

test('USD и KZT → RUB по курсу ЦБ', async () => {
  fx.setup({ cachePath: tmp(), fetch: ok(CBR) });
  assert.equal(await fx.convert(2, 'USD', 'RUB'), 180);
  assert.equal(await fx.convert(1000, 'KZT', 'RUB'), 180);
  assert.equal(await fx.convert(180, 'RUB', 'USD'), 2);
});

test('ЦБ недоступен — запасной источник', async () => {
  let n = 0;
  fx.setup({ cachePath: tmp(), fetch: async (u) => { n++; if (u.includes('cbr')) throw new Error('502'); return { ok: true, status: 200, json: async () => ({ result: 'success', rates: { USD: 1 / 90, EUR: 0.01, KZT: 5.55, TRY: 0.4 } }) }; } });
  assert.equal(await fx.convert(1, 'USD', 'RUB'), 90);
  assert.equal(n, 2);
});

test('нет курса — null, а не «оплачено»', async () => {
  fx.setup({ cachePath: tmp(), fetch: async () => { throw new Error('нет сети'); } });
  assert.equal(await fx.convert(5, 'USD', 'RUB'), null);
  fx.setup({ cachePath: tmp(), fetch: ok(CBR) });
  assert.equal(await fx.convert(5, 'XYZ', 'RUB'), null);
  assert.equal(await fx.convert('abc', 'USD', 'RUB'), null);
});

test('кэш: второй запрос без сети, старый курс выручает при сбое', async () => {
  const file = tmp();
  fx.setup({ cachePath: file, fetch: ok(CBR) });
  assert.equal(await fx.convert(1, 'USD', 'RUB'), 90);
  fx.setup({ cachePath: file, fetch: async () => { throw new Error('нет сети'); } });
  assert.equal(await fx.convert(1, 'USD', 'RUB'), 90); // свежий кэш с диска
  const j = JSON.parse(fs.readFileSync(file, 'utf8')); j.at = Date.now() - 13 * 3600 * 1000; fs.writeFileSync(file, JSON.stringify(j));
  fx.setup({ cachePath: file, fetch: async () => { throw new Error('нет сети'); } });
  assert.equal(await fx.convert(1, 'USD', 'RUB'), 90); // устарел, сети нет — берём старый
});
