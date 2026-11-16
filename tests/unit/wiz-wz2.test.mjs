// Шаги визарда WZ2: Оформление, Входы, Музыка с компьютера, Поиск, Плейлисты.
// Проверяем маршруты (порядок из плана) и чистую логику шагов — без окна и Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const W = require('../../src/wizard/steps.js');
const look = require('../../src/wizard/steps/look.js');
const logins = require('../../src/wizard/steps/logins.js');
const local = require('../../src/wizard/steps/local.js');
const search = require('../../src/wizard/steps/search.js');
const playlists = require('../../src/wizard/steps/playlists.js');

for (const m of [look, logins, local, search, playlists]) W.register(m.step);

test('WZ2: пять шагов встают в обе ветки в порядке плана', () => {
  assert.deepEqual(W.routeFor('listener').map((s) => s.id),
    ['fork', 'look', 'logins', 'local', 'search', 'playlists', 'listener-final']);
  assert.deepEqual(W.routeFor('streamer').map((s) => s.id),
    ['fork', 'look', 'logins', 'local', 'search', 'playlists', 'streamer-final']);
  assert.deepEqual(W.routeFor(null).map((s) => s.id), ['fork']);
});

test('WZ2: шаги — объекты одного вида и с нужными подписями', () => {
  const want = {
    look: 'Оформление',
    logins: 'Входы',
    local: 'Музыка с компьютера',
    search: 'Поиск',
    playlists: 'Плейлисты'
  };
  for (const [id, label] of Object.entries(want)) {
    const s = W.stepById(id);
    assert.ok(s, id);
    assert.deepEqual(s.routes, ['listener', 'streamer'], id);
    assert.equal(s.label, label, id);
    assert.equal(typeof s.title, 'string', id);
    assert.equal(typeof s.lead, 'string', id);
    assert.equal(typeof s.render, 'function', id);
    assert.equal(typeof s.skippable, 'boolean', id);
  }
  // У поиска свой подвал — «Дальше» появляется только после трека.
  assert.equal(W.stepById('search').footer, false);
});

test('WZ2 Оформление: одна задача «Выбери тему» на настоящую карточку оформления', () => {
  const tasks = look.tasks();
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.id, 'theme');
  assert.equal(t.text, 'Выбери тему');
  assert.equal(t.tab, 'settings');
  assert.equal(t.pane, 'sLook');
  assert.equal(t.on, 'click');
  // Карточка оформления переезжает во вкладку «Оформление» — селектор знает оба места.
  assert.match(t.sel, /#sLook \.card/);
  assert.match(t.sel, /#lookSlot \.card/);
  assert.ok(!t.optional, 'выбор темы — обычная задача шага, не «по желанию»');
});


test('WZ2 Входы: лампочки площадок из быстрой проверки', () => {
  const list = logins.lamps({
    ymSvc: { state: 'ok', text: 'доступен' },
    ytSvc: { state: 'bad', text: 'не отвечает' },
    sc: { state: 'bad', text: 'не отвечают' }
  }, { ym: true, yt: true });
  const by = Object.fromEntries(list.map((l) => [l.id, l]));
  assert.equal(by.ym.state, 'ok');
  assert.equal(by.ym.text, 'работает');
  assert.equal(by.yt.state, 'warn');
  assert.equal(by.yt.text, 'не отвечает — нужен VPN');
  assert.equal(by.sc.state, 'warn');
  assert.equal(by.au.state, 'warn');

  // выключенная площадка говорит «выключено», а не «не отвечает»
  const off = logins.lamps({ ymSvc: { state: 'ok' }, ytSvc: { state: 'ok' }, sc: { state: 'ok' } }, { ym: false, yt: false });
  assert.equal(off.find((l) => l.id === 'ym').text, 'выключено');
  assert.equal(off.find((l) => l.id === 'yt').text, 'выключено');
  // проверка ещё идёт — серые лампочки
  const run = logins.lamps({ ymSvc: { state: 'run' } }, {});
  assert.equal(run.find((l) => l.id === 'ym').text, 'проверяю…');
});

test('WZ2 Входы: SoundCloud и Audius делят одну строку проверки', () => {
  assert.deepEqual(logins.splitSc({ state: 'ok' }), { sc: 'ok', au: 'ok' });
  assert.deepEqual(logins.splitSc({ state: 'warn', text: 'Audius не отвечает' }), { sc: 'ok', au: 'warn' });
  assert.deepEqual(logins.splitSc({ state: 'warn', text: 'SoundCloud не отвечает' }), { sc: 'warn', au: 'ok' });
  assert.deepEqual(logins.splitSc({ state: 'bad', text: 'не отвечают' }), { sc: 'bad', au: 'bad' });
});

test('WZ2 Входы: две задачи на настоящие кнопки «Аккаунтов», обе по желанию', () => {
  const tasks = logins.tasks();
  assert.deepEqual(tasks.map((t) => t.id), ['ym', 'yt']);
  for (const t of tasks) {
    assert.equal(t.tab, 'settings');
    assert.equal(t.pane, 'sAcc');
    assert.equal(t.on, 'none', 'отмечаем по состоянию входа, а не по клику');
    assert.equal(t.optional, true, 'можно без входа');
  }
  assert.equal(tasks[0].sel, '#setYmBtn');
  assert.equal(tasks[1].sel, '#setYtLogin');
  assert.match(tasks[0].sub, /Можно без входа/);
});

test('WZ2 Входы: «доступен только Яндекс»', () => {
  const only = logins.lamps({ ymSvc: { state: 'ok' }, ytSvc: { state: 'bad' }, sc: { state: 'bad' } }, {});
  assert.equal(logins.onlyYandex(only), true);
  const all = logins.lamps({ ymSvc: { state: 'ok' }, ytSvc: { state: 'ok' }, sc: { state: 'ok' } }, {});
  assert.equal(logins.onlyYandex(all), false);
  const noYm = logins.lamps({ ymSvc: { state: 'bad' }, ytSvc: { state: 'ok' }, sc: { state: 'ok' } }, {});
  assert.equal(logins.onlyYandex(noYm), false);
});


test('WZ2 Музыка с компьютера: прогресс и итог', () => {
  // toLocaleString('ru-RU') разделяет тысячи неразрывным пробелом — в проверке это не важно.
  const flat = (s) => String(s).replace(/\u00a0/g, ' ');
  assert.equal(flat(local.progressText({ done: 412, total: 1380 })), 'Читаю файлы… 412 из 1 380 · можно идти дальше');
  assert.equal(local.progressText({ done: 5, total: 5, finished: true }), '');
  assert.equal(local.progressText({ done: 0, total: 0 }), 'Читаю файлы…');
  assert.equal(local.progressText(null), '');
  assert.match(flat(local.foundText({ count: 1 })), /1 песня/);
  assert.match(flat(local.foundText({ count: 1380 })), /1 380 песен/);
  assert.match(local.foundText({ count: 0 }), /пока нет/);
});

test('WZ2 Музыка с компьютера: задача на настоящую кнопку добавления папки', () => {
  const tasks = local.tasks();
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.id, 'folder');
  assert.equal(t.pane, 'sLocal');
  assert.equal(t.sel, '#setLibAdd');
  assert.equal(t.on, 'none', 'отмечаем, когда главное окно сообщило про папки');
  assert.equal(t.optional, true);
});

test('WZ2 Поиск: когда появляется «Дальше» и что на карточке', () => {
  assert.equal(search.nextVisible({}), false);
  assert.equal(search.nextVisible({ state: 'ready' }), false);
  assert.equal(search.nextVisible({ state: 'no-full' }), false);
  assert.equal(search.nextVisible({ state: 'empty' }), true);
  assert.equal(search.nextVisible({ state: 'offline' }), true);
  assert.equal(search.nextVisible({ state: 'error' }), true);
  assert.equal(search.nextVisible({ played: { title: 'Кино — Кукушка' } }), true);
  assert.equal(search.bigText({ state: 'ready' }), 'Выбери песню и нажми ▶');
  assert.equal(search.bigText({ state: 'no-full' }), 'Чтобы слушать, войди в Яндекс');
  assert.match(search.bigText({ played: { title: 'Кукушка' } }), /Играет: Кукушка/);
  assert.match(search.noteText({ state: 'empty' }), /когда появится/);
});

test('WZ2 Плейлисты: демо-список — ровно 30 песен владельца', () => {
  const lines = playlists.demoLines();
  assert.equal(lines.length, 30);
  assert.equal(lines[0], 'Queen — Bohemian Rhapsody (1975)');
  assert.equal(lines[29], "29. Modern Talking — You're My Heart, You're My Soul (1984)");
  assert.ok(lines[12].includes('(I Can\'t Get No) Satisfaction'), 'скобки в названии остаются как есть');
  const pv = playlists.preview(3);
  assert.equal(pv.lines.length, 3);
  assert.equal(pv.rest, 27);
  assert.equal(pv.total, 30);
});

test('WZ2 Плейлисты: итог сборки и отрывки', () => {
  assert.match(playlists.importDoneText(30, 0), /Собрано 30 песен/);
  assert.match(playlists.importDoneText(30, 0), /Номера и годы Тапёр убрал сам/);
  assert.match(playlists.importDoneText(1, 0), /1 песня/);
  assert.match(playlists.importDoneText(2, 0), /2 песни/);
  assert.match(playlists.importDoneText(5, 3), /Только отрывки: 3/);
});
