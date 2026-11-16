import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const wizard = require('../../src/main/wizard.js');
const W = require('../../src/wizard/steps.js');

test('визард: сам открывается только на новой установке', () => {
  assert.equal(wizard.shouldOpenOnStart({ hadSettingsFile: false, wizardDone: false }), true);
  assert.equal(wizard.shouldOpenOnStart({ hadSettingsFile: false }), true);
  assert.equal(wizard.shouldOpenOnStart({ hadSettingsFile: true, wizardDone: false }), false);
  assert.equal(wizard.shouldOpenOnStart({ hadSettingsFile: true }), false);
  assert.equal(wizard.shouldOpenOnStart({ hadSettingsFile: false, wizardDone: true }), false);
  assert.equal(wizard.shouldOpenOnStart({ hadSettingsFile: true, wizardDone: true }), false);
  assert.equal(wizard.shouldOpenOnStart(), true);
});

test('визард: маршрут по ветке — развилка и финал', () => {
  assert.deepEqual(W.routeFor(null).map((s) => s.id), ['fork']);
  assert.deepEqual(W.routeFor('').map((s) => s.id), ['fork']);
  assert.deepEqual(W.routeFor('listener').map((s) => s.id), ['fork', 'listener-final']);
  assert.deepEqual(W.routeFor('streamer').map((s) => s.id), ['fork', 'streamer-final']);
  assert.deepEqual(W.routeFor('unknown').map((s) => s.id), ['fork'], 'неизвестная ветка — только развилка');
});

test('визард: шаги — объекты одного вида', () => {
  assert.ok(Array.isArray(W.steps) && W.steps.length >= 3);
  for (const s of W.steps) {
    assert.equal(typeof s.id, 'string');
    assert.ok(Array.isArray(s.routes) && s.routes.length > 0);
    assert.equal(typeof s.label, 'string');
    assert.equal(typeof s.title, 'string');
    assert.equal(typeof s.lead, 'string');
    assert.equal(typeof s.render, 'function');
    assert.equal(typeof s.skippable, 'boolean');
  }
  assert.equal(W.stepById('fork').skippable, false);
  assert.equal(W.stepById('listener-final').final, true);
});

test('визард: развилка и финалы — по одному шагу на ветку', () => {
  const listener = W.routeFor('listener');
  const streamer = W.routeFor('streamer');
  assert.equal(listener.filter((s) => s.final).length, 1);
  assert.equal(streamer.filter((s) => s.final).length, 1);
  assert.equal(listener[listener.length - 1].id, 'listener-final');
  assert.equal(streamer[streamer.length - 1].id, 'streamer-final');
});

test('визард: чек-лист «Готов к эфиру» строится из фактов настроек', () => {
  // WZ5: финал стримера расширен до семи пунктов плана (музыка, донаты, правила,
  // заказы проверены, OBS, заказы из чата, сайт-визитка).
  const rows = W.checklistRows({
    music: { ym: true, yt: false, ymEnabled: true, ytEnabled: true },
    donations: { da: true, dp: false },
    rules: { tier: 'default', auto: false },
    chat: { mode: 'pack' },
    pack: { installed: true, enabled: true, state: 'trial', daysLeft: 25 },
    orders: { tested: true },
    sbot: { status: 'off' },
    site: { url: 'https://example.test/', connected: true }
  });
  assert.deepEqual(rows.map((r) => r.name), ['Музыка', 'Донаты', 'Правила', 'Заказы проверены', 'OBS', 'Заказы из чата', 'Сайт-визитка']);
  assert.equal(rows[0].state, 'ok');
  assert.match(rows[0].value, /Яндекс/);
  assert.equal(rows[1].value, 'DonationAlerts на связи');
  assert.equal(rows[2].value, 'Сбалансированно');
  assert.equal(rows[3].value, 'оба пути ✓');
  assert.equal(rows[3].state, 'ok');
  assert.equal(rows[4].lamp, false, 'у OBS лампочки нет — это подсказка, а не состояние');
  assert.equal(rows[5].value, 'наш бот · пробный, 25 дн.');
  assert.equal(rows[6].value, 'готова');

  const empty = W.checklistRows({ music: { ym: false, yt: false, ymEnabled: true, ytEnabled: true }, donations: {}, rules: {}, chat: {} });
  assert.equal(empty[0].state, 'warn');
  assert.equal(empty[0].fix, 'logins');
  assert.equal(empty[1].value, 'не подключены');
  assert.equal(empty[1].fix, 'donations');
  assert.equal(empty[2].value, 'Сбалансированно');
  assert.equal(empty[3].value, 'не проверяли');
  assert.equal(empty[3].fix, 'orders');
  assert.equal(empty[5].value, 'не нужны');
  assert.equal(empty[5].state, 'off');
  assert.equal(empty[5].fix, '');
  assert.equal(empty[6].value, 'по желанию');
  assert.equal(empty[6].fix, 'donations');
});

test('визард: названия наборов правил', () => {
  assert.equal(W.tierLabel('default', false), 'Сбалансированно');
  assert.equal(W.tierLabel('default', true), 'Всё сразу в эфир');
  assert.equal(W.tierLabel('money', false), 'Всё сразу в эфир');
  assert.equal(W.tierLabel('equal', false), 'Всё через меня');
  assert.equal(W.tierLabel('all', false), 'Всё сразу в эфир');
  assert.equal(W.tierLabel('manual', false), 'Всё через меня');
});

test('визард: разрешённые вкладки', () => {
  for (const t of ['search', 'wave', 'my', 'req', 'hist', 'browser', 'settings', 'look', 'books']) assert.equal(wizard.allowedTab(t), true, t);
  for (const t of ['', 'no', 'tab; rm', null, 42]) assert.equal(wizard.allowedTab(t), false, String(t));
});

test('шаги из своих файлов встают в маршрут по порядку плана', () => {
  const W = require('../../src/wizard/steps.js');
  const mk = (id, routes) => ({ id, routes, label: id, title: id, render() {} });
  W.register(mk('search', ['listener', 'streamer']));
  W.register(mk('look', ['listener', 'streamer']));
  W.register(mk('donations', ['streamer']));
  assert.deepEqual(W.routeFor('listener').map((s) => s.id), ['fork', 'look', 'search', 'listener-final']);
  assert.deepEqual(W.routeFor('streamer').map((s) => s.id), ['fork', 'look', 'search', 'donations', 'streamer-final']);
  assert.deepEqual(W.routeFor(null).map((s) => s.id), ['fork']);
});

// 15.11.2026: развилка — окно по центру поверх Тапёра, после ответа уезжает в колонку сбоку.
test('развилка: с центра начинается только весь маршрут', () => {
  assert.equal(wizard.startsCentered({ from: 'first' }), true);
  assert.equal(wizard.startsCentered({ from: 'settings' }), true);       // «Пройти знакомство заново»
  assert.equal(wizard.startsCentered({ from: 'settings', step: 'donations' }), false); // «?» у раздела
  assert.equal(wizard.startsCentered({ route: 'streamer' }), false);
});

test('развилка: окно по центру главного и внутри рабочей области', () => {
  const desk = { x: 0, y: 0, width: 1920, height: 1040 };
  const mb = { x: 200, y: 100, width: 1400, height: 900 };
  const r = wizard.centerRect(mb, desk);
  assert.equal(r.x + r.width / 2, mb.x + mb.width / 2);
  assert.equal(r.y + r.height / 2, mb.y + mb.height / 2);
  const small = wizard.centerRect({ x: -50, y: 0, width: 500, height: 450 }, desk);
  assert.ok(small.x >= 0 && small.width <= 500 && small.height >= 420);
});

test('развилка: колонка сбоку справа от главного, переход плавный и кончается точно на месте', () => {
  const desk = { x: 0, y: 0, width: 1920, height: 1040 };
  const side = wizard.sideRect({ x: 0, y: 0, width: 1400, height: 1000 }, desk);
  assert.equal(side.x, 1408);
  assert.equal(side.width, wizard.WIZARD_WIDTH);
  const a = { x: 0, y: 0, width: 600, height: 400 }, b = { x: 1000, y: 100, width: 380, height: 900 };
  assert.deepEqual(wizard.lerpRect(a, b, 0), a);
  assert.deepEqual(wizard.lerpRect(a, b, 1), b);
  const mid = wizard.lerpRect(a, b, 0.5);
  assert.ok(mid.x > 500, 'замедление к концу: к середине пройдено больше половины');
});

test('последний шаг стримера: окно по центру побольше, перед итогом — «Взаимодействие со зрителями»', () => {
  const desk = { x: 0, y: 0, width: 1920, height: 1040 };
  const mb = { x: 100, y: 50, width: 1500, height: 950 };
  const small = wizard.centerRect(mb, desk), big = wizard.centerRect(mb, desk, true);
  assert.ok(big.width > small.width && big.height > small.height);
  assert.equal(big.x + big.width / 2, mb.x + mb.width / 2);
  const W2 = require('../../src/wizard/steps.js');
  require('../../src/wizard/steps/viewers.js');
  const order = W2.routeFor('streamer').map((s) => s.id);
  assert.equal(order[order.length - 1], 'streamer-final');   // 16.11: итог — последний
  assert.equal(order[order.length - 2], 'viewers');
});
