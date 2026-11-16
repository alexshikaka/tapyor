import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const W = require('../../src/wizard/steps.js');
const rules = require('../../src/wizard/steps/rules.js');
const donations = require('../../src/wizard/steps/donations.js');
const orders = require('../../src/wizard/steps/orders.js');

test('WZ4: три шага стримера встают в маршрут по плану', () => {
  assert.deepEqual(W.routeFor('streamer').map((s) => s.id), [
    'fork', 'donations', 'rules', 'orders', 'streamer-final'
  ]);
  for (const s of [donations.step, rules.step, orders.step]) {
    assert.deepEqual(s.routes, ['streamer'], s.id);
    assert.equal(typeof s.render, 'function', s.id);
    assert.equal(s.skippable, true, s.id);
    assert.equal(typeof s.title, 'string', s.id);
  }
});

test('WZ4: таблица наборов «Правил заказов» — ровно как в плане 5.2', () => {
  assert.deepEqual(rules.presetToSettings('all'), {
    reqAuto: true, explicitOk: true, repeatOk: true, versionOk: true, maxSec: 600
  });
  assert.deepEqual(rules.presetToSettings('balanced'), {
    reqAuto: true, explicitOk: false, repeatOk: false, versionOk: true, maxSec: 420
  });
  assert.deepEqual(rules.presetToSettings('manual'), {
    reqAuto: false, explicitOk: false, repeatOk: false, versionOk: false, maxSec: 0
  });
  assert.equal(rules.presetToSettings('unknown'), null);
  assert.equal(rules.presetToSettings(), null);
});

test('WZ4: набор не портит общий объект настроек', () => {
  const a = rules.presetToSettings('all');
  a.reqAuto = false;
  a.maxSec = 1;
  assert.deepEqual(rules.presetToSettings('all'), {
    reqAuto: true, explicitOk: true, repeatOk: true, versionOk: true, maxSec: 600
  });
});

test('WZ4: текущие настройки узнают свой набор, ручная правка — нет', () => {
  assert.equal(rules.settingsToPreset({ reqAuto: true, explicitOk: false, repeatOk: false, versionOk: true, maxSec: 420 }), 'balanced');
  assert.equal(rules.settingsToPreset({ reqAuto: true, explicitOk: true, repeatOk: true, versionOk: true, maxSec: 600 }), 'all');
  assert.equal(rules.settingsToPreset({ reqAuto: false, explicitOk: false, repeatOk: false, versionOk: false, maxSec: 0 }), 'manual');
  // maxSec не задан — как в программе, 7 минут
  assert.equal(rules.settingsToPreset({ reqAuto: true, explicitOk: false, repeatOk: false, versionOk: true }), 'balanced');
  // лишние ключи (стоп-лист, площадки) набор не ломают
  assert.equal(rules.settingsToPreset({ reqAuto: true, explicitOk: false, repeatOk: false, versionOk: true, maxSec: 420, stopWords: ['x'], src: { ym: false } }), 'balanced');
  // заводские настройки программы (reqAuto выкл, мат/повторы включены) не совпадают ни с одним
  assert.equal(rules.settingsToPreset({ reqAuto: false, explicitOk: true, repeatOk: true, versionOk: true, maxSec: 420 }), '');
  assert.equal(rules.settingsToPreset(), '');
});

test('WZ4: в шаге «Донаты» нет слова GitHub', () => {
  const src = fs.readFileSync(path.join(here, '..', '..', 'src', 'wizard', 'steps', 'donations.js'), 'utf8');
  assert.ok(!/github/i.test(src), 'страница сайта-визитки — без GitHub');
});

// WC2: шаги-подсказчики. «Донаты» не повторяют кнопки и поля Тапёра, а «Правила»
// показывают, какие переключатели поменял набор.
test('WC2: «Правила» знают, какие переключатели поменял набор', () => {
  const balanced = rules.presetToSettings('balanced');
  const all = rules.presetToSettings('all');
  assert.deepEqual(rules.changedToggles(balanced, all), ['explicitOk', 'repeatOk']);
  assert.deepEqual(rules.changedToggles(all, all), []);
  assert.deepEqual(rules.changedToggles({}, rules.presetToSettings('manual')), ['explicitOk', 'repeatOk', 'versionOk']);
  assert.deepEqual(rules.changedToggles(null, null), []);
});

test('WC2: задачи «Правил» — «точные» всегда и только изменённые переключатели', () => {
  const balanced = rules.presetToSettings('balanced');
  const all = rules.presetToSettings('all');
  const tasks = rules.presetTasks('all', balanced);
  assert.deepEqual(tasks.map((t) => t.id), ['reqAuto', 'explicitOk', 'repeatOk', 'stop']);
  const by = Object.fromEntries(tasks.map((t) => [t.id, t]));
  assert.equal(by.reqAuto.tab, 'settings');
  assert.equal(by.reqAuto.pane, 'sOrders');
  assert.equal(by.reqAuto.on, 'none');
  assert.equal(by.reqAuto.sel, '#sOrders [data-set-tg="reqAuto"]');
  assert.equal(by.explicitOk.sel, '#stExplicit');
  assert.equal(by.repeatOk.sel, '#stRepeat');
  assert.equal(by.stop.sel, '#stStop');
  assert.equal(by.stop.optional, true);
  const same = rules.presetTasks('all', all);
  assert.deepEqual(same.map((t) => t.id), ['reqAuto', 'stop'], 'неизменённые переключатели не показываем');
});

// WC2: шаг «Донаты» не повторяет кнопки и поля Тапёра — задачи указывают
// на настоящие элементы Настроек.
test('WC2: задачи шага «Донаты» указывают на настоящие элементы Настроек', () => {
  assert.equal(typeof donations.donationTasks, 'function');
  const tasks = donations.donationTasks();
  assert.deepEqual(tasks.map((t) => t.id), ['da', 'dp', 'price', 'site']);
  const by = Object.fromEntries(tasks.map((t) => [t.id, t]));
  assert.equal(by.da.tab, 'settings');
  assert.equal(by.da.pane, 'sStream');
  assert.equal(by.da.on, 'none', 'отмечается по состоянию, а не по клику');
  assert.match(by.da.sel, /#stDon.*data-don="da"/);
  assert.equal(by.dp.pane, 'sStream');
  assert.equal(by.dp.optional, true);
  assert.match(by.dp.sel, /#stDon.*data-dk="dp"/);
  assert.equal(by.price.sel, '#stPrice');
  assert.equal(by.price.on, 'fill');
  assert.equal(by.site.sel, '#stSite');
  assert.equal(by.site.optional, true);
});
