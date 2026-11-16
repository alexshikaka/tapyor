
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const lookup = require('../../src/online-lookup.js');

test('online lookup: канонические метаданные из Deezer', async () => {
  const old = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.deezer.com/search')) {
      return { ok: true, json: async () => ({ data: [{ artist: { name: 'Кино' }, title: 'Группа крови' }] }) };
    }
    throw new Error('unexpected URL ' + url);
  };
  try {
    lookup.setup({ cachePath: path.join(os.tmpdir(), 'tapyor-lookup-test-' + process.pid + '.json') });
    const r = await lookup.findCanonical('Кино', 'Группа крови', 'Кино - Группа крови');
    assert.ok(r.s >= 0.75);
    assert.equal(r.cand.artist, 'Кино');
    assert.equal(r.cand.title, 'Группа крови');
  } finally {
    global.fetch = old;
  }
});

test('online lookup: пустой запрос не ходит в сеть', async () => {
  const old = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('network'); };
  try {
    const r = await lookup.findCanonical('', '', '');
    assert.equal(r.cand, null);
    assert.equal(calls, 0);
  } finally {
    global.fetch = old;
  }
});
test('online lookup: падение источников не роняет заказ', async () => {
  const old = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  try {
    lookup.setup({ cachePath: path.join(os.tmpdir(), 'tapyor-lookup-fail-' + process.pid + '.json') });
    const r = await lookup.findCanonical('Кино', 'Группа крови', 'Кино - Группа крови');
    assert.equal(r.cand, null);
    assert.equal(r.s, 0);
  } finally {
    global.fetch = old;
  }
});

test('online lookup: для названия без исполнителя берёт первый канон', async () => {
  const old = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.deezer.com/search')) {
      return { ok: true, json: async () => ({ data: [
        { artist: { name: 'Imagine Dragons' }, title: 'Bad Liar' },
        { artist: { name: 'The Instrumental' }, title: 'Bad Lair' }
      ] }) };
    }
    throw new Error('unexpected URL ' + url);
  };
  try {
    lookup.setup({ cachePath: path.join(os.tmpdir(), 'tapyor-lookup-title-' + process.pid + '.json') });
    const r = await lookup.findCanonical('', 'bad lair', 'bad lair');
    assert.equal(r.cand.artist, 'Imagine Dragons');
    assert.equal(r.cand.title, 'Bad Liar');
  } finally {
    global.fetch = old;
  }
});

test('online lookup: не берёт первый короткий BAD вместо Bad Liar', async () => {
  const old = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.deezer.com/search')) {
      return { ok: true, json: async () => ({ data: [
        { artist: { name: 'ATEEZ' }, title: 'BAD' },
        { artist: { name: 'Imagine Dragons' }, title: 'Bad Liar' }
      ] }) };
    }
    throw new Error('unexpected URL ' + url);
  };
  try {
    lookup.setup({ cachePath: path.join(os.tmpdir(), 'tapyor-lookup-first-' + process.pid + '.json') });
    const r = await lookup.findCanonical('', 'bad lair', 'bad lair');
    assert.equal(r.cand.artist, 'Imagine Dragons');
    assert.equal(r.cand.title, 'Bad Liar');
  } finally {
    global.fetch = old;
  }
});

test('online lookup: Pt. II не проигрывает каверу с точным названием', async () => {
  const old = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.deezer.com/search')) {
      return { ok: true, json: async () => ({ data: [
        { artist: { name: 'Chris Rea' }, title: 'The Road to Hell, Pt. II (2019 Remaster)' },
        { artist: { name: 'Joe Carran' }, title: 'The Road To Hell' }
      ] }) };
    }
    throw new Error('unexpected URL ' + url);
  };
  try {
    lookup.setup({ cachePath: path.join(os.tmpdir(), 'tapyor-lookup-road-' + process.pid + '.json') });
    const r = await lookup.findCanonical('', 'the road to hell', 'the road to hell');
    assert.equal(r.cand.artist, 'Chris Rea');
  } finally {
    global.fetch = old;
  }
});

test('online lookup: не больше двух одновременных справочников', async () => {
  const old = global.fetch;
  let active = 0, max = 0;
  global.fetch = async (url) => {
    if (!String(url).includes('api.deezer.com/search')) throw new Error('unexpected URL ' + url);
    active++; max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 40));
    active--;
    return { ok: true, json: async () => ({ data: [{ artist: { name: 'Test' }, title: 'Song' }] }) };
  };
  try {
    lookup.setup({ cachePath: path.join(os.tmpdir(), 'tapyor-lookup-limit-' + process.pid + '.json') });
    await Promise.all([1, 2, 3, 4, 5].map((i) => lookup.findCanonical('Test', 'Song ' + i, 'Test Song ' + i)));
    assert.ok(max <= 2, 'одновременно не больше двух, было ' + max);
  } finally {
    global.fetch = old;
  }
});

test('online lookup: angrier/acoustic не заменяют оригинал', async () => {
  const old = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.deezer.com/search')) {
      return { ok: true, json: async () => ({ data: [
        { artist: { name: 'GAYLE' }, title: 'abcdefu (angrier)' },
        { artist: { name: 'GAYLE' }, title: 'abcdefu' }
      ] }) };
    }
    throw new Error('unexpected URL ' + url);
  };
  try {
    lookup.setup({ cachePath: path.join(os.tmpdir(), 'tapyor-lookup-version-' + process.pid + '.json') });
    const r = await lookup.findCanonical('', 'abcdefu', 'abcdefu');
    assert.equal(r.cand.title, 'abcdefu');
  } finally {
    global.fetch = old;
  }
});
