// T1: дополнение к chatorders.test.mjs — прямой разбор activeOrder, пределы лимитов
// и защита сверки от неожиданных данных.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../src/chatorders.js');

const rec = (extra) => Object.assign({ key: 'sb-cmd:abc', uid: '1', platform: 'twitch' }, extra || {});

test('chatorders: умолчания и верхние пределы объявлены', () => {
  assert.deepEqual(C.DEFAULTS, { perUser: 1, chatCap: 10, doubt: 'wait' });
  assert.deepEqual(C.MAX, { perUser: 20, chatCap: 200 });
});

test('chatorders.safeLimits: строки, дроби, минусы и переполнение', () => {
  assert.deepEqual(C.safeLimits({ perUser: '3', chatCap: '7', doubt: 'ask' }), { perUser: 3, chatCap: 7, doubt: 'ask' });
  assert.deepEqual(C.safeLimits({ perUser: 2.9, chatCap: 3.1 }), { perUser: 2, chatCap: 3, doubt: 'wait' });
  assert.deepEqual(C.safeLimits({ perUser: 0, chatCap: -5 }), { perUser: 1, chatCap: 10, doubt: 'wait' });
  assert.deepEqual(C.safeLimits({ perUser: 999, chatCap: 999 }), { perUser: 20, chatCap: 200, doubt: 'wait' });
  assert.deepEqual(C.safeLimits({ perUser: 'abc', chatCap: null }), { perUser: 1, chatCap: 10, doubt: 'wait' });
  assert.deepEqual(C.safeLimits(null), { perUser: 1, chatCap: 10, doubt: 'wait' });
  assert.deepEqual(C.safeLimits('строка'), { perUser: 1, chatCap: 10, doubt: 'wait' });
});

test('chatorders.isSbKey: только ключи порта с латиницей, цифрами, _ и -', () => {
  for (const k of ['sb-cmd:abc', 'sb-points:x_y-1', 'sb-cmd:A']) assert.equal(C.isSbKey(k), true, k);
  for (const k of ['', null, undefined, 'sb-cmd:', 'sb-other:x', 'sb-cmd:abc!', 'sb-cmd:кириллица', 'sb-cmd:abc def', 123]) {
    assert.equal(C.isSbKey(k), false, String(k));
  }
});

test('chatorders.activeOrder: чужие, снятые и пропущенные заказы не считаются', () => {
  assert.equal(C.activeOrder(null), null);
  assert.equal(C.activeOrder({ key: 'sb-other:x' }), null);
  assert.equal(C.activeOrder(rec({ state: 'dismissed' })), null);
  assert.equal(C.activeOrder(rec({ droppedAt: 1 })), null);
  assert.equal(C.activeOrder(rec({ items: [{ state: 'skip', track: { title: 'X' } }] })), null);
});

test('chatorders.activeOrder: добавленный заказ — ждёт, играет или уже ушёл', () => {
  const added = rec({ items: [{ state: 'added', track: { title: 'Песня' } }] });
  assert.equal(C.activeOrder(added, { keys: null }).pending, false, 'окно ещё не прислало очередь — ждёт');
  assert.equal(C.activeOrder(added, { keys: new Set(['sb-cmd:abc']) }).playing, false);
  assert.equal(C.activeOrder(added, { keys: ['sb-cmd:abc'] }).playing, false);
  assert.equal(C.activeOrder(added, { keys: [] }), null, 'добавили и уже убрали — не считается');
  assert.equal(C.activeOrder(added, { playing: 'sb-cmd:abc' }).playing, true);
});

test('chatorders.activeOrder: заказ без added ждёт стримера, но не дольше суток', () => {
  const fresh = rec({ got: Date.now() - 1000, items: [] });
  assert.equal(C.activeOrder(fresh, {}).pending, true);
  const old = rec({ got: Date.now() - 25 * 3600 * 1000, items: [] });
  assert.equal(C.activeOrder(old, {}), null);
  const noGot = rec({ items: [] });
  assert.equal(C.activeOrder(noGot, {}).pending, true, 'без времени считаем свежим');
});

test('chatorders.viewerActive: совпадение по площадке и uid, а не по нику', () => {
  const list = [
    rec({ uid: 7, platform: 'twitch', items: [] }),
    rec({ key: 'sb-cmd:def', uid: '7', platform: 'youtube', items: [] }),
  ];
  const twitch = C.viewerActive(list, {}, { uid: 7, platform: 'twitch' });
  assert.equal(twitch.length, 1);
  assert.equal(twitch[0].rec.platform, 'twitch');
  assert.equal(C.viewerActive(list, {}, { uid: '7', platform: 'twitch' }).length, 1, 'uid числом и строкой — одно');
  assert.equal(C.viewerActive(list, {}, { uid: '7', platform: 'нет' }).length, 0);
});

test('chatorders.chatWaiting: играющий заказ не занимает очередь', () => {
  const list = [
    rec({ key: 'sb-cmd:a', items: [{ state: 'added' }] }),
    rec({ key: 'sb-cmd:b', items: [] }),
  ];
  assert.equal(C.chatWaiting(list, { playing: 'sb-cmd:a', keys: new Set(['sb-cmd:a']) }), 1);
  assert.equal(C.chatWaiting(list, {}), 2);
});

test('chatorders.trackLabel: исполнитель из author или artist, пустой трек — пусто', () => {
  assert.equal(C.trackLabel({ author: 'Кино', title: 'Группа крови' }), 'Кино — Группа крови');
  assert.equal(C.trackLabel({ artist: 'Кино', title: 'Группа крови' }), 'Кино — Группа крови');
  assert.equal(C.trackLabel({ title: 'Песня' }), 'Песня');
  assert.equal(C.trackLabel(null), '');
});

test('chatorders.pendingRedemptionsSafe: неожиданные данные — null, а не «всё отменено»', () => {
  const bad = {};
  Object.defineProperty(bad, 'key', { get() { throw new Error('порча'); } });
  assert.equal(C.pendingRedemptionsSafe([bad], {}), null);
  assert.equal(C.pendingRedemptionsSafe([], {}), '');
  assert.equal(C.pendingRedemptionsSafe(null, null), '');
});
