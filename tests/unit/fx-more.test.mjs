// T1: дополнение к fx.test.mjs — разбор ответов ЦБ и open.er-api, кэш на 12 часов,
// повторные запросы, округление и мусор во входных данных. Сеть — только подделка.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fx = require('../../src/fx.js');

const dirs = [];
function cacheFile() {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-fx-'));
  dirs.push(dir);
  return join(dir, 'fx.json');
}
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const okJson = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => 'сбой' });

// ---------- разбор источников ----------

test('fx._sources: ЦБ РФ — сколько валюты за 1 рубль, мусорные записи пропускаются', () => {
  const parse = fx._sources[0].parse;
  const rates = parse({ Valute: {
    USD: { Value: 90, Nominal: 1 },
    KZT: { Value: 0.18, Nominal: 100 },
    BAD1: { Value: 0, Nominal: 1 },
    BAD2: { Value: 5, Nominal: 0 },
  } });
  assert.equal(rates.RUB, 1);
  assert.ok(Math.abs(rates.USD - 1 / 90) < 1e-9);
  assert.ok(Math.abs(rates.KZT - 100 / 0.18) < 1e-9);
  assert.equal('BAD1' in rates, false);
  assert.equal('BAD2' in rates, false);
  assert.deepEqual(parse(null), { RUB: 1 });
});

test('fx._sources: open.er-api — только успешный ответ, иначе null', () => {
  const parse = fx._sources[1].parse;
  assert.deepEqual(parse({ result: 'success', rates: { USD: 0.011 } }), { RUB: 1, USD: 0.011 });
  assert.equal(parse({ result: 'error', rates: { USD: 0.011 } }), null);
  assert.equal(parse({ result: 'success' }), null);
  assert.equal(parse(null), null);
});

// ---------- rates / кэш ----------

test('fx.rates: свежий кэш читается с диска без сети', async () => {
  const file = cacheFile();
  writeFileSync(file, JSON.stringify({ at: Date.now(), rates: { RUB: 1, USD: 0.5 } }), 'utf8');
  let calls = 0;
  fx.setup({ cachePath: file, fetch: async () => { calls++; return okJson({}); } });
  assert.deepEqual(await fx.rates(), { RUB: 1, USD: 0.5 });
  assert.equal(calls, 0, 'в сеть не ходили');
});

test('fx.rates: старый кэш обновляется, новый курс пишется на диск', async () => {
  const file = cacheFile();
  writeFileSync(file, JSON.stringify({ at: 1, rates: { RUB: 1, USD: 0.5 } }), 'utf8');
  let calls = 0;
  fx.setup({
    cachePath: file,
    fetch: async (url) => {
      calls++;
      if (String(url).includes('cbr')) return okJson({ Valute: { USD: { Value: 100, Nominal: 1 }, EUR: { Value: 110, Nominal: 1 }, KZT: { Value: 0.2, Nominal: 100 } } });
      return fail(500);
    },
  });
  const r = await fx.rates();
  assert.equal(calls, 1);
  assert.ok(Math.abs(r.USD - 0.01) < 1e-9);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(saved.at > 0);
  assert.ok(Math.abs(saved.rates.USD - 0.01) < 1e-9);
});

test('fx.rates: первый источник упал — берётся второй', async () => {
  const file = cacheFile();
  const urls = [];
  fx.setup({
    cachePath: file,
    fetch: async (url) => {
      urls.push(String(url));
      if (String(url).includes('cbr')) return fail(503);
      return okJson({ result: 'success', rates: { USD: 0.02, EUR: 0.03, KZT: 0.5 } });
    },
  });
  const r = await fx.rates();
  assert.ok(Math.abs(r.USD - 0.02) < 1e-9);
  assert.equal(urls.length, 2);
});

test('fx.rates: оба источника упали и кэша нет — null', async () => {
  const file = cacheFile();
  fx.setup({ cachePath: file, fetch: async () => fail(500) });
  assert.equal(await fx.rates(), null);
});

test('fx.rates: оба источника упали, но старый курс есть — отдаём его', async () => {
  const file = cacheFile();
  writeFileSync(file, JSON.stringify({ at: 1, rates: { RUB: 1, USD: 0.7 } }), 'utf8');
  fx.setup({ cachePath: file, fetch: async () => fail(500) });
  assert.deepEqual(await fx.rates(), { RUB: 1, USD: 0.7 });
});

test('fx.rates: два одновременных запроса не дублируют поход в сеть', async () => {
  const file = cacheFile();
  let calls = 0;
  let release;
  fx.setup({
    cachePath: file,
    fetch: (url) => {
      calls++;
      if (String(url).includes('cbr')) {
        return new Promise((res) => { release = () => res(okJson({ Valute: { USD: { Value: 100, Nominal: 1 }, EUR: { Value: 110, Nominal: 1 }, KZT: { Value: 0.2, Nominal: 100 } } })); });
      }
      return Promise.resolve(fail(500));
    },
  });
  const a = fx.rates();
  const b = fx.rates();
  await new Promise((r) => setImmediate(r));
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1, 'второй запрос ждёт первый');
  assert.deepEqual(ra, rb);
});

test('fx.rates: битый файл кэша не мешает запросу', async () => {
  const file = cacheFile();
  writeFileSync(file, '{битый', 'utf8');
  fx.setup({ cachePath: file, fetch: async () => okJson({ result: 'success', rates: { USD: 0.02, EUR: 0.03, KZT: 0.5 } }) });
  const r = await fx.rates();
  assert.ok(Math.abs(r.USD - 0.02) < 1e-9);
});

// ---------- convert ----------

test('fx.convert: та же валюта — без сети и без курса', async () => {
  fx.setup({ fetch: async () => { throw new Error('нельзя ходить в сеть'); } });
  assert.equal(await fx.convert(100, 'usd', ' USD '), 100);
  assert.equal(await fx.convert(-5, 'RUB', 'RUB'), -5);
});

test('fx.convert: мусор во входных данных — null', async () => {
  fx.setup({ cachePath: cacheFile(), fetch: async () => { throw new Error('нельзя ходить в сеть'); } });
  for (const [amount, from, to] of [['abc', 'USD', 'RUB'], [NaN, 'USD', 'RUB'], [Infinity, 'USD', 'RUB'], [100, '', 'RUB'], [100, 'USD', '']]) {
    assert.equal(await fx.convert(amount, from, to), null, String(amount) + ' ' + from + '→' + to);
  }
});

test('fx.convert: неизвестная валюта — null, а не ноль', async () => {
  const file = cacheFile();
  fx.setup({ cachePath: file, fetch: async () => okJson({ result: 'success', rates: { USD: 0.02, EUR: 0.03, KZT: 0.5 } }) });
  assert.equal(await fx.convert(100, 'XXX', 'RUB'), null);
  assert.equal(await fx.convert(100, 'USD', 'XXX'), null);
});

test('fx.convert: округление до копеек', async () => {
  const file = cacheFile();
  writeFileSync(file, JSON.stringify({ at: Date.now(), rates: { RUB: 1, USD: 0.3 } }), 'utf8');
  fx.setup({ cachePath: file, fetch: async () => { throw new Error('нельзя'); } });
  assert.equal(await fx.convert(10, 'USD', 'RUB'), 33.33);
  assert.equal(await fx.convert(3, 'RUB', 'USD'), 0.9);
});

test('fx.convert: огромная сумма остаётся конечным числом', async () => {
  const file = cacheFile();
  writeFileSync(file, JSON.stringify({ at: Date.now(), rates: { RUB: 1, USD: 0.5 } }), 'utf8');
  fx.setup({ cachePath: file, fetch: async () => { throw new Error('нельзя'); } });
  const r = await fx.convert(1e15, 'USD', 'RUB');
  assert.ok(Number.isFinite(r));
});
