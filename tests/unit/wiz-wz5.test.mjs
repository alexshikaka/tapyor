// WZ5: шаги визарда «OBS» и «Заказы из чата» — чистая логика без окна.
// Что показать (карточка оверлеев и путь «наш бот» только при доступном паке), чек-лист финала
// из настоящих фактов и порядке шагов в ветке стримера.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const W = require('../../src/wizard/steps.js');
const obs = require('../../src/wizard/steps/obs.js');

test('WZ5: шаг OBS в ветке стримера; «Заказов из чата» в визарде нет (снят 16.11)', () => {
  assert.equal(W.stepById('obs'), obs.step);
  assert.deepEqual(obs.step.routes, ['streamer']);
  assert.equal(obs.step.label, 'OBS');
  assert.equal(obs.step.title, 'Что есть для OBS');
  assert.equal(obs.step.skippable, true);
  const order = W.routeFor('streamer').map((s) => s.id);
  assert.ok(order.indexOf('obs') >= 0, 'OBS не попал в маршрут: ' + order.join(','));
  assert.equal(order.indexOf('chat'), -1, 'шага «Заказы из чата» быть не должно');
  assert.equal(order[order.length - 1], 'streamer-final');
});

test('WZ5: карточка оверлеев — только при установленном паке с пробным периодом', () => {
  assert.equal(obs.overlayCardVisible({ pack: { installed: true, trialAvailable: true, state: 'none' } }), true);
  assert.equal(obs.overlayCardVisible({ pack: { installed: true, trialAvailable: true, state: 'other-pc' } }), true);
  assert.equal(obs.overlayCardVisible({ pack: { installed: false, trialAvailable: false } }), false, 'нет пака — нет карточки');
  assert.equal(obs.overlayCardVisible({ pack: { installed: true, trialAvailable: false, state: 'trial' } }), false, 'пробный период уже идёт');
  assert.equal(obs.overlayCardVisible({ pack: { installed: true, trialAvailable: false, state: 'full' } }), false);
  assert.equal(obs.overlayCardVisible({}), false);
  assert.equal(obs.overlayCardVisible(null), false);
});

test('WZ5: финал — «наш бот» без рабочего пака и Streamer.bot без связи отмечены оранжевым', () => {
  const packTrialNotStarted = W.checklistRows({
    chat: { mode: 'pack' },
    pack: { installed: true, enabled: false, state: 'none' }
  });
  const chatRow = packTrialNotStarted.find((r) => r.name === 'Заказы из чата');
  assert.equal(chatRow.state, 'warn');
  assert.equal(chatRow.fix, '', 'шага чата нет — «Настроить» не показываем (16.11)');

  const sbotNoLink = W.checklistRows({ chat: { mode: 'sbot' }, sbot: { status: 'needPassword' } });
  const s = sbotNoLink.find((r) => r.name === 'Заказы из чата');
  assert.equal(s.state, 'warn');
  assert.match(s.value, /нет связи/);

  const sbotOk = W.checklistRows({ chat: { mode: 'sbot' }, sbot: { status: 'ok' } });
  assert.equal(sbotOk.find((r) => r.name === 'Заказы из чата').state, 'ok');

  const noChoice = W.checklistRows({ chat: { mode: 'none' } });
  const n = noChoice.find((r) => r.name === 'Заказы из чата');
  assert.equal(n.value, 'не нужны');
  assert.equal(n.state, 'off');
  assert.equal(n.fix, '', 'осознанный выбор — не оранжевый и без «Настроить»');
});

test('WZ5: финал — правила, сайт-визитка и заказы проверены из настоящих фактов', () => {
  const rows = W.checklistRows({
    rules: { tier: 'money', auto: false },
    orders: { tested: true },
    site: { url: '', connected: true }
  });
  assert.equal(rows.find((r) => r.name === 'Правила').value, 'Всё сразу в эфир');
  assert.equal(rows.find((r) => r.name === 'Заказы проверены').state, 'ok');
  assert.equal(rows.find((r) => r.name === 'Сайт-визитка').value, 'не выложена');
  assert.equal(rows.find((r) => r.name === 'Сайт-визитка').fix, 'donations');
  const obsRow = rows.find((r) => r.name === 'OBS');
  assert.equal(obsRow.value, 'Настройки → OBS и стрим');
  assert.equal(obsRow.lamp, false);
});
