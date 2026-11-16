// TAP-19/BOT-19: у каждого модуля своя полка секретов; старый вход бота переезжает без потери.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeSecure } = require('../../src/modhost.js');

const mkStore = (init = {}) => { const d = { ...init }; return { d, get: (k) => d[k], set: (k, v) => { if (v == null) delete d[k]; else d[k] = v; } }; };
// «шифрование» для теста: обратимое, но не base64 исходника
const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('E:' + s), decryptString: (b) => { const t = b.toString(); if (!t.startsWith('E:')) throw new Error('bad'); return t.slice(2); } };
const encOld = (s) => Buffer.from('E:' + s).toString('base64');

test('модули не видят секреты друг друга', async () => {
  const st = mkStore();
  const bot = makeSecure(st, ss, 'bot'), ov = makeSecure(st, ss, 'overlay');
  await bot.set('twitch.bot', 'TOKEN-1');
  assert.equal(await bot.get('twitch.bot'), 'TOKEN-1');
  assert.equal(await ov.get('twitch.bot'), null);
  await ov.set('twitch.bot', 'X');
  assert.equal(await bot.get('twitch.bot'), 'TOKEN-1');
  assert.ok(st.d['modSecure.streamer-pack.bot.twitch.bot']);
  assert.ok(!st.d['modSecure.twitch.bot'], 'на общую полку больше не пишем');
});

test('старый вход бота (общая полка) переезжает на полку бота и сохраняется для отката', async () => {
  const st = mkStore({ 'modSecure.twitch.broadcaster': encOld('{"tokens":1}') });
  const bot = makeSecure(st, ss, 'bot');
  assert.equal(await bot.get('twitch.broadcaster'), '{"tokens":1}');
  assert.equal(st.d['modSecure.streamer-pack.bot.twitch.broadcaster'], st.d['modSecure.twitch.broadcaster']);
  // новый вход пишется только на свою полку, старая запись не трогается
  await bot.set('twitch.broadcaster', '{"tokens":2}');
  assert.equal(await bot.get('twitch.broadcaster'), '{"tokens":2}');
  assert.equal(ss.decryptString(Buffer.from(st.d['modSecure.twitch.broadcaster'], 'base64')), '{"tokens":1}');
});

test('другой модуль старую общую полку не получает', async () => {
  const st = mkStore({ 'modSecure.twitch.broadcaster': encOld('secret') });
  assert.equal(await makeSecure(st, ss, 'overlay').get('twitch.broadcaster'), null);
});

test('выход (пустое значение) не возвращает старый вход обратно', async () => {
  const st = mkStore({ 'modSecure.twitch.bot': encOld('old') });
  const bot = makeSecure(st, ss, 'bot');
  assert.equal(await bot.get('twitch.bot'), 'old');
  await bot.set('twitch.bot', '');
  assert.equal(await bot.get('twitch.bot'), null);
});

// L6 (аудит 0.32.0, намеренная смена поведения): без шифрования Windows секрет НЕ сохраняется,
// а старые незашифрованные (base64) записи не считаются действующими и удаляются с записью в журнал.
// Раньше этот тест закреплял base64 — это больше не допустимо: base64 не шифрование.
test('без шифрования секрет не сохраняется, старые незашифрованные записи удаляются', async () => {
  const old = Buffer.from('{"tokens":1}', 'utf8').toString('base64');
  const st = mkStore({ 'modSecure.streamer-pack.bot.twitch.b': old, 'modSecure.twitch.b': old });
  const logs = [];
  const plain = makeSecure(st, { isEncryptionAvailable: () => false }, 'bot', (m) => logs.push(String(m)));
  const r = await plain.set('twitch.c', 'секрет');
  assert.equal(r.ok, false);
  assert.match(r.error, /шифрование Windows недоступно — вход не сохранён, войдите заново/);
  assert.ok(!st.d['modSecure.streamer-pack.bot.twitch.c'], 'новый секрет не записан');
  assert.equal(await plain.get('twitch.b'), null, 'старая запись не действует');
  assert.ok(!st.d['modSecure.streamer-pack.bot.twitch.b'] && !st.d['modSecure.twitch.b'], 'старые записи удалены');
  assert.ok(logs.some((m) => /не сохранён/.test(m)), 'журнал: ' + JSON.stringify(logs));
  // выход (пустое значение) без шифрования стирает запись — не ошибка
  assert.deepEqual(await plain.set('b', ''), { ok: true });
});

test('битая запись не роняет: не расшифровалась — null, удалена, строка в журнале', async () => {
  const st = mkStore({ 'modSecure.streamer-pack.bot.a': '%%%' });
  const logs = [];
  const sec = makeSecure(st, ss, 'bot', (m) => logs.push(String(m)));
  assert.equal(await sec.get('a'), null);
  assert.ok(!st.d['modSecure.streamer-pack.bot.a'], 'нечитаемая запись удалена');
  assert.ok(logs.some((m) => /не расшифрован/.test(m)), 'журнал: ' + JSON.stringify(logs));
});
