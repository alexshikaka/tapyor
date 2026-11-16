// R4: после сна ПК связи (донаты, Streamer.bot) должны восстанавливаться сразу,
// а не ждать свою паузу до 5 минут / до 60 секунд. Здесь проверяется только
// «будильник»: кого позвать, как часто и что ошибка одного не мешает другим.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wake = require('../../src/wake.js');

function harness(opts) {
  const o = opts || {};
  let t = o.start || 1000000;
  const calls = [];
  const logs = [];
  const actions = o.actions || [
    { name: 'донаты', run: () => calls.push('донаты') },
    { name: 'Streamer.bot', run: () => calls.push('Streamer.bot') },
  ];
  const w = wake.create({
    now: () => t,
    minGapMs: o.minGapMs,
    actions,
    log: (m) => logs.push(String(m)),
  });
  return {
    w, calls, logs,
    at: (ms) => { t = ms; },
    advance: (ms) => { t += ms; },
  };
}

const LINE = 'после сна: донаты, Streamer.bot — проверяю связь';

test('wake: после сна вызываются все действия и пишется одна строка в журнал', () => {
  const h = harness();
  assert.equal(h.w.onResume('пробуждение ПК'), true);
  assert.deepEqual(h.calls, ['донаты', 'Streamer.bot']);
  assert.deepEqual(h.logs, [LINE]);
});

test('wake: чаще раза в 30 секунд не срабатывает', () => {
  const h = harness();
  h.w.onResume('пробуждение ПК');
  h.advance(5000);
  assert.equal(h.w.onResume('пробуждение ПК'), false, 'через 5 с — пропущено');
  assert.deepEqual(h.calls, ['донаты', 'Streamer.bot']);
  assert.equal(h.logs.length, 1);
  h.advance(26000); // всего 31 с
  assert.equal(h.w.onResume('пробуждение ПК'), true, 'через 31 с — снова вызвано');
  assert.deepEqual(h.calls, ['донаты', 'Streamer.bot', 'донаты', 'Streamer.bot']);
  assert.equal(h.logs.length, 2);
});

test('wake: свой промежуток и первый вызов всегда проходит', () => {
  const h = harness({ minGapMs: 5000 });
  h.at(0);
  assert.equal(h.w.onResume('x'), true, 'самый первый — всегда');
  h.advance(4999);
  assert.equal(h.w.onResume('x'), false);
  h.advance(1);
  assert.equal(h.w.onResume('x'), true);
});

test('wake: ошибка одного действия не мешает другому (и в ответе, и в броске)', async () => {
  const calls = [];
  const logs = [];
  const actions = [
    { name: 'плохое', run: () => { throw new Error('сломалось'); } },
    { name: 'обещание', run: () => Promise.reject(new Error('не ответило')) },
    { name: 'донаты', run: () => calls.push('донаты') },
    { name: 'Streamer.bot', run: () => calls.push('Streamer.bot') },
  ];
  const w = wake.create({ now: () => 1000, actions, log: (m) => logs.push(String(m)) });
  assert.equal(w.onResume('пробуждение ПК'), true);
  assert.deepEqual(calls, ['донаты', 'Streamer.bot'], 'остальные действия вызваны');
  await new Promise((r) => setImmediate(r));
  assert.equal(logs[0], LINE, 'строка о пробуждении — первая');
  assert.equal(logs.length, 3, 'ошибки попали в журнал отдельными строками');
  assert.match(logs.join('\n'), /сломалось/);
  assert.match(logs.join('\n'), /не ответило/);
});

test('wake: без log и без действий не падает', () => {
  const w = wake.create({ now: () => 1, actions: [] });
  assert.equal(w.onResume('x'), true);
  assert.equal(w.onResume('x'), false);
});
