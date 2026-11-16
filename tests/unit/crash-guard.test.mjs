// R1: общая ловушка ошибок главного процесса.
// Проверяем чистую логику без Electron: журнал, отчёт, повторы, предел, установка обработчиков.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cg = require('../../src/crash-guard.js');

// Подставные журнал и отчёт. Время под контролем, чтобы проверять «раз в минуту».
function make(extra) {
  const logs = [], reports = [];
  let t = 1000000;
  const guard = cg.create(Object.assign({
    log: (m) => { logs.push(String(m)); },
    report: (fp, text) => { reports.push({ fp, text }); },
    now: () => t,
    root: 'C:\\app'
  }, extra || {}));
  return {
    guard, logs, reports,
    now: () => t,
    at: (v) => { t = v; },
    plus: (ms) => { t += ms; }
  };
}

const fullEntries = (logs) => logs.filter((m) => m.includes('\n'));

test('ошибка пишется в журнал: фраза, сообщение и стек; stats считает', () => {
  const h = make();
  h.guard.onException(new Error('бум'));
  const text = h.logs.join('\n');
  assert.match(text, /главный процесс: необработанная ошибка — бум/);
  assert.match(text, /Error: бум/);
  assert.match(text, /\n\s+at /);
  assert.equal(h.guard.stats().exceptions, 1);
  assert.equal(h.guard.stats().rejections, 0);
  assert.equal(h.guard.stats().lastAt, h.now());
  assert.deepEqual(Object.keys(h.guard.stats()).sort(), ['exceptions', 'lastAt', 'rejections']);
});

test('отклонённое обещание пишется как «необработанное отклонение»', () => {
  const h = make();
  h.guard.onRejection(new Error('отклонено'));
  assert.match(h.logs.join('\n'), /главный процесс: необработанное отклонение — отклонено/);
  assert.equal(h.guard.stats().rejections, 1);
  assert.equal(h.guard.stats().exceptions, 0);
});

test('не бросает, даже если журнал и отчёт сами падают', () => {
  const reports = [];
  const guard = cg.create({
    log: () => { throw new Error('журнал сломан'); },
    report: (fp, text) => { reports.push(text); throw new Error('отчёт сломан'); },
    now: () => 1
  });
  assert.doesNotThrow(() => guard.onException(new Error('первая')));
  assert.doesNotThrow(() => guard.onRejection('вторая'));
  assert.equal(reports.length, 2, 'отчёт всё равно попробовали отправить');
  assert.equal(guard.stats().exceptions, 1);
  assert.equal(guard.stats().rejections, 1);
});

test('повтор той же ошибки не шлёт второй отчёт, полная запись — раз в минуту', () => {
  const h = make();
  const err = new Error('одна и та же');
  h.guard.onException(err);
  h.guard.onException(err);
  assert.equal(h.reports.length, 1, 'второй отчёт по тому же отпечатку не нужен');
  assert.equal(fullEntries(h.logs).length, 1, 'полностью — только первая запись');
  assert.match(h.logs.join('\n'), /повторилась 1 раз/);

  h.plus(61 * 1000);
  h.guard.onException(err);
  assert.equal(fullEntries(h.logs).length, 2, 'через минуту снова пишем полностью');
  assert.equal(h.reports.length, 1, 'отчёт по-прежнему один за запуск');
});

test('предел — не больше 5 отчётов за запуск, журнал пишется дальше', () => {
  const h = make();
  for (let i = 0; i < 6; i++) h.guard.onException(new Error('разная ошибка ' + i));
  assert.equal(h.reports.length, 5);
  assert.equal(h.guard.stats().exceptions, 6);
  assert.equal(fullEntries(h.logs).length, 6);
});

test('install вешает ровно два обработчика и передаёт им ошибки', () => {
  const events = [], handlers = {};
  const proc = { on(ev, fn) { events.push(ev); handlers[ev] = fn; } };
  const h = make();
  cg.install(proc, h.guard);
  assert.deepEqual(events, ['uncaughtException', 'unhandledRejection']);
  handlers.uncaughtException(new Error('из процесса'));
  handlers.unhandledRejection('из обещания');
  assert.equal(h.guard.stats().exceptions, 1);
  assert.equal(h.guard.stats().rejections, 1);
});

test('обработчик из install не бросает, даже если guard сломан', () => {
  const handlers = {};
  const proc = { on(ev, fn) { handlers[ev] = fn; } };
  cg.install(proc, {
    onException: () => { throw new Error('нет'); },
    onRejection: () => { throw new Error('нет'); }
  });
  assert.doesNotThrow(() => handlers.uncaughtException(new Error('x')));
  assert.doesNotThrow(() => handlers.unhandledRejection('y'));
});

test('ошибка-не-Error: строка, null, объект, undefined', () => {
  const h = make();
  h.guard.onException('просто строка');
  h.guard.onException(null);
  h.guard.onException({ code: 42, message: 'объект с сообщением' });
  h.guard.onRejection(undefined);
  const text = h.logs.join('\n');
  assert.match(text, /необработанная ошибка — просто строка/);
  assert.match(text, /необработанная ошибка — null/);
  assert.match(text, /необработанная ошибка — объект с сообщением/);
  assert.match(text, /необработанное отклонение — undefined/);
  assert.equal(h.guard.stats().exceptions, 3);
  assert.equal(h.guard.stats().rejections, 1);
});

test('стек в журнале не длиннее 2 000 символов', () => {
  const h = make();
  const err = new Error('длинный стек');
  err.stack = 'Error: длинный стек\n' + '    at foo (C:\\work\\src\\main.js:1:1)\n'.repeat(200);
  h.guard.onException(err);
  const entry = h.logs[0];
  const stackPart = entry.slice(entry.indexOf('\n') + 1);
  assert.ok(stackPart.length <= 2000, 'стек обрезан до 2000 символов');
  assert.ok(stackPart.length > 500, 'стек не потерян целиком');
});

test('секреты и пути ПК не попадают ни в журнал, ни в отчёт', () => {
  const h = make();
  // Токен собираем из частей: проверка репозитория на ключи не должна принимать
  // учебную строку за настоящий секрет.
  const fakeToken = 'abcdefgh' + 'ijklmnop';
  h.guard.onException(new Error('ключ Bearer ' + fakeToken + ' и путь C:\\Users\\tester\\Music'));
  const text = h.logs.join('\n') + '\n' + h.reports.map((r) => r.text).join('\n');
  assert.ok(!text.includes('tester'), 'имя в пути вырезано');
  assert.ok(!text.includes(fakeToken), 'токен вырезан');
  assert.ok(text.includes('<путь>'), 'путь заменён отметкой');
  assert.ok(text.includes('[скрыто]'), 'секрет заменён отметкой');
});

test('свой отчёт: отпечаток и текст без выброшенного исключения', () => {
  const h = make();
  h.guard.onException(new Error('для отчёта'));
  assert.equal(h.reports.length, 1);
  assert.equal(typeof h.reports[0].fp, 'string');
  assert.ok(h.reports[0].fp.length > 0);
  assert.match(h.reports[0].text, /необработанная ошибка — для отчёта/);
});
