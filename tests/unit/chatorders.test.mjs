import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ch = require('../../src/chatorders.js');

const trackA = { src: 'ym', id: '1', title: 'Кукушка', author: 'Кино', seconds: 160 };
const trackB = { src: 'ym', id: '2', title: 'Мама', author: 'Кино', seconds: 200 };

function rec(key, extra) {
  return Object.assign({
    key,
    uid: '1',
    platform: 'twitch',
    name: 'test_viewer',
    items: [{ level: 'exact', track: trackA, paid: true }],
  }, extra || {});
}

test('chatorders: безопасные значения и верхние пределы', () => {
  assert.deepEqual(ch.safeLimits({}), { perUser: 1, chatCap: 10, doubt: 'wait' });
  assert.deepEqual(ch.safeLimits({ perUser: '5', chatCap: '25', doubt: 'ask' }), { perUser: 5, chatCap: 25, doubt: 'ask' });
  // мусор, ноль и минус — не «без ограничений», а значение по умолчанию
  for (const bad of ['x', '', null, undefined, 0, -3, NaN, 1.9]) {
    assert.equal(ch.safeLimits({ perUser: bad }).perUser, bad === 1.9 ? 1 : 1, 'perUser: ' + String(bad));
  }
  assert.equal(ch.safeLimits({ doubt: 'что-то' }).doubt, 'wait');
  // верхние пределы
  assert.equal(ch.safeLimits({ perUser: 999 }).perUser, 20);
  assert.equal(ch.safeLimits({ chatCap: 999 }).chatCap, 200);
  // строки с пробелами — число
  assert.equal(ch.safeLimits({ perUser: ' 7 ' }).perUser, 7);
});

test('chatorders: ключи заказов Streamer.bot', () => {
  assert.ok(ch.isSbKey('sb-cmd:scabc123'));
  assert.ok(ch.isSbKey('sb-points:spabc123'));
  for (const k of ['twitch-cmd:tc1', 'da:1', 'sb-cmd:', 'sb-x:1', '', null, 7]) assert.ok(!ch.isSbKey(k), String(k));
});

test('chatorders: что ждёт, что играет, что уже не считается', () => {
  const list = [
    rec('sb-cmd:sc1', { items: [{ level: 'exact', track: trackA, state: 'added', paid: true }] }),
    rec('sb-cmd:sc2', { items: [{ level: 'exact', track: trackB }] }),
    rec('sb-points:sp1', { items: [{ level: 'exact', track: trackA, state: 'added', paid: true }] }),
    rec('sb-cmd:sc3', { items: [{ level: 'exact', track: trackA, state: 'skip' }] }),
    rec('twitch-cmd:tc1', { items: [{ level: 'exact', track: trackA, state: 'added', paid: true }] }),
  ];
  const queue = { keys: ['sb-cmd:sc1', 'sb-points:sp1'], playing: '' };
  const active = ch.activeOrders(list, queue);
  assert.deepEqual(active.map((o) => o.key).sort(), ['sb-cmd:sc1', 'sb-cmd:sc2', 'sb-points:sp1']);
  // sc2 — карточка «ждёт стримера», занимает лимит
  assert.equal(active.find((o) => o.key === 'sb-cmd:sc2').pending, true);
  // заказ, который добавили и убрали, больше не считается
  assert.equal(ch.activeOrders([rec('sb-cmd:sc9', { items: [{ level: 'exact', track: trackA, state: 'added' }] })], { keys: [], playing: '' }).length, 0);
});

test('chatorders: играющий заказ числится, но не занимает очередь', () => {
  const list = [rec('sb-cmd:sc1', { items: [{ level: 'exact', track: trackA, state: 'added' }] })];
  const queue = { keys: ['sb-cmd:sc1'], playing: 'sb-cmd:sc1' };
  const active = ch.activeOrders(list, queue);
  assert.equal(active.length, 1);
  assert.equal(active[0].playing, true);
  assert.equal(ch.chatWaiting(list, queue), 0, 'играющий не считается «в ожидании»');
});

test('chatorders: окно ещё не прислало очередь — заказ считаем ждущим', () => {
  const list = [rec('sb-cmd:sc1', { items: [{ level: 'exact', track: trackA, state: 'added' }] })];
  assert.equal(ch.activeOrders(list, { keys: null, playing: '' }).length, 1);
});

test('chatorders: старый «ждущий стримера» заказ лимит не занимает', () => {
  const old = rec('sb-cmd:sc1', { items: [{ level: 'doubt', track: trackA }], got: Date.now() - 25 * 3600 * 1000 });
  const fresh = rec('sb-cmd:sc2', { items: [{ level: 'doubt', track: trackB }], got: Date.now() - 3600 * 1000 });
  const active = ch.activeOrders([old, fresh], { keys: [], playing: '' });
  assert.deepEqual(active.map((o) => o.key), ['sb-cmd:sc2']);
});

test('chatorders: ошибка построения списка — null, а не пустая строка', () => {
  const bad = [{ key: 'sb-points:sp1', get items() { throw new Error('неожиданные данные'); } }];
  assert.equal(ch.pendingRedemptionsSafe(bad, { keys: [], playing: '' }), null, 'на ошибке — null: сверку пропускаем');
  assert.equal(ch.pendingRedemptionsSafe([], { keys: [], playing: '' }), '', 'доказанно пустой список — пустая строка');
});

test('chatorders: снятый заказ (droppedAt) не считается ждущим и не занимает лимит', () => {
  const rec1 = rec('sb-cmd:sc1', { items: [{ level: 'exact', track: trackA, state: 'added' }], droppedAt: Date.now() });
  const rec2 = rec('sb-points:sp1', { items: [{ level: 'doubt', track: trackB }], droppedAt: Date.now() });
  const active = ch.activeOrders([rec1, rec2], { keys: ['sb-cmd:sc1'], playing: '' });
  assert.equal(active.length, 0, 'уборка при запуске закрыла заказ — он больше не ждёт');
  assert.equal(ch.pendingRedemptions([rec2], { keys: [], playing: '' }), '', 'и в сверку не попадает');
});

test('chatorders: зритель — по площадке и uid, ник не важен', () => {
  const list = [
    rec('sb-cmd:sc1', { uid: '7', platform: 'twitch' }),
    rec('sb-cmd:sc2', { uid: '7', platform: 'youtube' }),
    rec('sb-cmd:sc3', { uid: '8', platform: 'twitch' }),
  ];
  const q = { keys: ['sb-cmd:sc1', 'sb-cmd:sc2', 'sb-cmd:sc3'], playing: '' };
  const mine = ch.viewerActive(list, q, { uid: '7', platform: 'twitch' });
  assert.deepEqual(mine.map((o) => o.key), ['sb-cmd:sc1']);
  assert.equal(ch.viewerActive(list, q, { uid: 7, platform: 'youtube' }).length, 1);
  assert.equal(ch.viewerActive(list, q, { uid: '7', platform: 'kick' }).length, 0);
});

test('chatorders: подпись трека', () => {
  assert.equal(ch.trackLabel(trackA), 'Кино — Кукушка');
  assert.equal(ch.trackLabel({ title: 'Без исполнителя' }), 'Без исполнителя');
  assert.equal(ch.trackLabel(null), '');
});

test('chatorders: pendingRedemptions — только баллы, которые ждут или играют', () => {
  const list = [
    rec('sb-points:sp1', { redemption: 'r1', got: Date.now() }),
    rec('sb-points:sp2', { redemption: 'r2', items: [{ level: 'exact', track: trackA, state: 'skip' }] }),
    rec('sb-points:sp3', { redemption: 'r3', items: [{ level: 'exact', track: trackA, state: 'added' }] }),
    rec('sb-points:sp4', { redemption: 'r4', items: [{ level: 'exact', track: trackA, state: 'added' }] }),
    rec('sb-cmd:sc1', { redemption: 'r5' }),
    rec('sb-points:sp5', { redemption: '' }),
  ];
  const q = { keys: ['sb-points:sp1', 'sb-points:sp3', 'sb-cmd:sc1'], playing: '' };
  assert.equal(ch.pendingRedemptions(list, q), 'r1,r3', 'skip, убранный и команда — не в списке');
  assert.equal(ch.pendingRedemptions([], q), '');
  const playing = { keys: [], playing: 'sb-points:sp4' };
  assert.equal(ch.pendingRedemptions([list[3]], playing), 'r4', 'играющий заказ тоже в списке');
});
