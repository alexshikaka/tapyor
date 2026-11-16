import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mb = require('../../src/sbot-mailbox.js');

function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-sbot-mb-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} });
  return path.join(dir, 'sbot-mailbox.json');
}

function make(file, opts) {
  const journal = [];
  let clock = 1000000;
  const box = mb.createMailbox(Object.assign({
    file,
    now: () => clock,
    journal: { append: (e) => journal.push(e) },
    uuid: (() => { let n = 0; return () => 'ev-' + (++n); })(),
  }, opts || {}));
  return { box, journal, tick: (ms) => { clock += ms; }, at: () => clock };
}

test('sbot-mailbox: события плоские, eventId и файл на диске', (t) => {
  const file = tmpFile(t);
  const { box } = make(file);
  const e = box.enqueue('Тапёр: заказ выполнен', {
    orderId: 'sb-points:1', user: 'зритель', track: 'Кино — Кукушка',
    reward: 'Награда', redemption: 'red-1', nested: { a: 1 }, list: [1, 2],
    n: 7, flag: true, empty: null,
  }, 60000);
  assert.equal(e.eventId, 'ev-1');
  assert.equal(e.args.nested, undefined, 'объекты не попадают в плоские args');
  assert.equal(e.args.list, undefined, 'массивы не попадают в плоские args');
  assert.equal(e.args.n, 7);
  assert.equal(e.args.flag, 1);
  assert.equal(e.args.empty, '');
  assert.equal(box.count(), 1);
  assert.ok(fs.existsSync(file), 'файл записан');
  assert.equal(fs.existsSync(file + '.tmp'), false, 'временный файл после записи убран');

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.v, 1);
  assert.equal(onDisk.items.length, 1);
  assert.equal(onDisk.items[0].action, 'Тапёр: заказ выполнен');
});

test('sbot-mailbox: переживает перезапуск и удаляется только по ack', (t) => {
  const file = tmpFile(t);
  const a = make(file);
  a.box.enqueue('Тапёр: заказ снят', { orderId: 'sb-points:2', reason: 'closed' }, 60000);
  a.box.enqueue('Тапёр: приём', { open: 0 }, 60000);
  assert.equal(a.box.count(), 2);

  const b = make(file);
  assert.equal(b.box.count(), 2, 'новый экземпляр видит те же события');
  const ids = b.box.all().map((e) => e.eventId);
  assert.equal(b.box.ack(ids[0]), true);
  assert.equal(b.box.ack(ids[0]), false, 'повторный ack ничего не делает');
  assert.equal(b.box.count(), 1);
  assert.equal(b.box.get(ids[0]), null);

  const c = make(file);
  assert.equal(c.box.count(), 1, 'ack сохранён на диск');
  assert.equal(c.box.all()[0].eventId, ids[1]);
});

test('sbot-mailbox: повтор 10 → 30 → 60 → 60 секунд', (t) => {
  const file = tmpFile(t);
  const { box, tick, at } = make(file);
  const e = box.enqueue('Тапёр: заказ выполнен', { orderId: 'x' }, mb.DEFAULT_TTL_MS);
  assert.equal(mb.retryDelay(0), 0);
  assert.equal(mb.retryDelay(1), 10000);
  assert.equal(mb.retryDelay(2), 30000);
  assert.equal(mb.retryDelay(3), 60000);
  assert.equal(mb.retryDelay(9), 60000);

  assert.equal(box.due(at()).length, 1, 'первая отправка сразу');
  box.markAttempt(e.eventId, at());
  const a1 = box.get(e.eventId);
  assert.equal(a1.attempts, 1);
  assert.equal(box.due(at()).length, 0, 'через 0 с повторять нельзя');
  tick(10000);
  assert.equal(box.due(at()).length, 1, 'через 10 с — пора');
  box.markAttempt(e.eventId, at());
  tick(30000);
  assert.equal(box.due(at()).length, 1, 'через 30 с — пора');
  box.markAttempt(e.eventId, at());
  tick(60000);
  assert.equal(box.due(at()).length, 1, 'через 60 с — пора');
  box.markAttempt(e.eventId, at());
  tick(60000);
  assert.equal(box.due(at()).length, 1, 'и дальше каждые 60 с');
});

test('sbot-mailbox: просрочка 24 ч — в журнал «не доставлено» и удаление', (t) => {
  const file = tmpFile(t);
  const { box, journal, tick, at } = make(file);
  box.enqueue('Тапёр: заказ выполнен', { orderId: 'sb-points:9' }, mb.DEFAULT_TTL_MS);
  tick(mb.DEFAULT_TTL_MS - 1);
  assert.equal(box.sweep(at()), 0, 'чуть раньше суток ещё живой');
  tick(1);
  assert.equal(box.sweep(at()), 1);
  assert.equal(box.count(), 0);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].ev, 'undelivered');
  assert.equal(journal[0].eventId, 'ev-1');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).items.length, 0, 'на диске тоже пусто');
});

test('sbot-mailbox: поздний ответ живёт не дольше 2 минут', (t) => {
  const file = tmpFile(t);
  const { box, journal, tick, at } = make(file);
  box.enqueue('Тапёр: ответ', { reply: 'поставил' }, 120000);
  box.enqueue('Тапёр: заказ выполнен', { orderId: 'sb-points:1' }, mb.DEFAULT_TTL_MS);
  tick(120000);
  assert.equal(box.due(at()).length, 1, 'ответ уже просрочен и не отправляется');
  assert.equal(box.sweep(at()), 1);
  assert.equal(box.count(), 1, 'обычное событие осталось');
  assert.equal(journal[0].action, 'Тапёр: ответ');
});

test('sbot-mailbox: при переподключении всё недоставленное отправляется сразу', (t) => {
  const file = tmpFile(t);
  const { box, tick, at } = make(file);
  const a = box.enqueue('A', { x: 1 }, 60000);
  const b = box.enqueue('B', { x: 2 }, 60000);
  box.markAttempt(a.eventId, at());
  box.markAttempt(b.eventId, at());
  tick(5000);
  assert.equal(box.due(at()).length, 0);
  assert.equal(box.rescheduleAll(), 2);
  assert.equal(box.due(at()).length, 2);
});

test('sbot-mailbox: битый файл не стирается молча и не ломает запуск', (t) => {
  const file = tmpFile(t);
  fs.writeFileSync(file, '{не json', 'utf8');
  const { box } = make(file);
  assert.equal(box.count(), 0);
  assert.equal(fs.existsSync(file), false, 'битый файл отложен в сторону');
  const broken = fs.readdirSync(path.dirname(file)).filter((f) => f.indexOf('sbot-mailbox.json.broken-') === 0);
  assert.equal(broken.length, 1, 'рядом лежит копия битого файла');
  box.enqueue('Тапёр: приём', { open: 1 }, 60000);
  assert.equal(box.count(), 1, 'после битого файла ящик снова работает');
});

test('sbot-mailbox: мусорные записи в файле отбрасываются', (t) => {
  const file = tmpFile(t);
  fs.writeFileSync(file, JSON.stringify({ v: 1, items: [
    { action: 'ok', eventId: 'e1', args: { a: 'b' }, createdAt: 1000000, ttlMs: 60000 },
    { action: '', eventId: 'e2' },
    { action: 'bad', eventId: '' },
    'строка',
    null,
    { action: 'also', eventId: 'e3', args: { n: 2 }, createdAt: 1000000 },
  ] }), 'utf8');
  const { box } = make(file);
  assert.equal(box.count(), 2);
  assert.deepEqual(box.all().map((e) => e.eventId), ['e1', 'e3']);
});
