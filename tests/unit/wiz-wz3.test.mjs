// WZ3: справка «Живая очередь», шаг очереди слушателя и одна главная кнопка в финале.
// Чистая логика шагов: какие пункты показать, какие команды послать, что выбрать в финале.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../../src/wizard/steps.js');
const live = require('../../src/wizard/steps/livehelp.js');
const queue = require('../../src/wizard/steps/queue.js');

test('справка «Живая очередь»: пять пунктов у стримера, четыре у слушателя', () => {
  const listener = live.items(false);
  const streamer = live.items(true);
  assert.equal(listener.length, 4);
  assert.equal(streamer.length, 5);
  assert.deepEqual(listener.map((x) => x.n), [1, 2, 3, 4]);
  assert.deepEqual(streamer.map((x) => x.n), [1, 2, 3, 4, 5]);
  assert.equal(streamer[4].streamer, true, 'пятый пункт — только у стримера');
  assert.match(streamer[4].text, /заказы зрителей/i);
  assert.equal(listener.some((x) => x.streamer), false);
  assert.equal(live.items()[0].n, 1, 'без аргумента — как у слушателя');
  for (const it of listener) {
    assert.equal(typeof it.title, 'string');
    assert.ok(it.title.length > 0);
    assert.equal(typeof it.text, 'string');
    assert.ok(it.text.length > 0);
    assert.ok(['layers', 'order', 'after', 'bg'].includes(it.kind), 'вид схемы: ' + it.kind);
  }
  assert.equal(streamer[4].kind, 'streamer');
  assert.match(listener[0].title, /слоя/i);
  assert.match(listener[1].title, /доигрывает/i);
  assert.match(listener[2].title, /фон/i);
  assert.match(listener[3].title, /Играть фоном/);
});

test('шаг livehelp: только стример, открывает справку и засчитывается по закрытию', () => {
  const step = live.step;
  assert.equal(step.id, 'livehelp');
  assert.deepEqual(step.routes, ['streamer']);
  assert.equal(step.skippable, true);
  const cmds = [];
  let handler = null;
  let advanced = 0;
  let unsubscribed = 0;
  const api = {
    cmd: (c) => cmds.push(c),
    on: (evt, fn) => { assert.equal(evt, 'livehelp'); handler = fn; return () => { unsubscribed += 1; }; },
    next: () => { advanced += 1; },
    facts: null
  };
  step.onEnter(api);
  assert.deepEqual(cmds, [{ op: 'highlight', tab: 'search', sel: '#qMode' }, { op: 'do', name: 'openLiveHelp', args: { anchor: true } }],
    'шаг подсвечивает переключатель режима и открывает справку у очереди (15.11)');
  assert.equal(advanced, 0, 'до закрытия справки шаг не засчитан');
  handler({ type: 'livehelp', closed: false });
  assert.equal(advanced, 0, 'чужое событие шаг не двигает');
  handler({ type: 'livehelp', closed: true });
  assert.equal(advanced, 1, 'закрыли справку — шаг засчитан');
  step.onLeave(api);
  assert.equal(unsubscribed, 1, 'при выходе обработчик снимается');
});

test('шаг очереди: подсветка колонки, «Моя волна» только после входа в Яндекс', () => {
  const step = queue.step;
  assert.equal(step.id, 'queue');
  assert.deepEqual(step.routes, ['listener']);
  assert.equal(step.skippable, true);
  const cmds = [];
  let handler = null;
  const card = { hidden: true };
  const el = {
    innerHTML: '',
    querySelector: (sel) => (sel === '#wizQueueWave' ? card : null)
  };
  const api = {
    cmd: (c) => cmds.push(c),
    on: (evt, fn) => { assert.equal(evt, 'listenerstate'); handler = fn; return () => {}; },
    next: () => {},
    facts: { music: { ym: false } }
  };
  step.render(el, api);
  assert.match(el.innerHTML, /Нажми любой трек/);
  assert.match(el.innerHTML, /Перетаскивай как хочешь/);
  assert.match(el.innerHTML, /Моя волна/);
  assert.equal(card.hidden, true, 'без входа волну не показываем');

  step.onEnter(api);
  assert.ok(cmds.some((c) => c.op === 'highlight' && c.sel === '.queue-col'), 'подсвечена колонка очереди');
  assert.ok(cmds.some((c) => c.op === 'do' && c.name === 'listenerState'), 'спросили вход в Яндекс');
  handler({ type: 'listenerstate', ym: true });
  assert.equal(card.hidden, false, 'вошёл в Яндекс — показываем «Мою волну»');

  step.onLeave(api);
  assert.ok(cmds.some((c) => c.op === 'clear'), 'выход со шага снимает подсветку');
});

test('финал слушателя: одна главная кнопка по ситуации', () => {
  assert.equal(W.listenerFinalChoice({ music: { ym: true } }), 'wave', 'вошёл в Яндекс');
  assert.equal(W.listenerFinalChoice({ music: { ym: false }, demo: true }), 'list', 'собрал демо-плейлист');
  assert.equal(W.listenerFinalChoice({ music: { ym: false }, demoPlaylist: true }), 'list');
  assert.equal(W.listenerFinalChoice({ music: { ym: false }, queue: 3 }), 'list', 'в очереди есть треки');
  assert.equal(W.listenerFinalChoice({ music: { ym: false } }), 'search', 'иначе — найти песню');
  assert.equal(W.listenerFinalChoice({}), 'search');
  assert.equal(W.listenerFinalChoice(null), 'search');
  assert.equal(W.listenerFinalChoice({ music: { ym: true }, demo: true }), 'wave', 'вход в Яндекс главнее');
});

test('шаги из своих файлов встают в маршруты по плану', () => {
  W.register(live.step);
  W.register(queue.step);
  const listener = W.routeFor('listener').map((s) => s.id);
  const streamer = W.routeFor('streamer').map((s) => s.id);
  assert.ok(listener.includes('queue'), 'очередь — у слушателя');
  assert.equal(listener.includes('livehelp'), false, 'справка слушателю шагом не показывается');
  assert.ok(streamer.includes('livehelp'), 'справка — у стримера');
  assert.ok(listener.indexOf('queue') < listener.indexOf('listener-final'), 'очередь перед финалом');
  assert.ok(streamer.indexOf('livehelp') < streamer.indexOf('streamer-final'), 'справка перед финалом');
});
