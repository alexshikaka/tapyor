// Пипетка: одна сессия за раз, обработчик ответа один на всю программу.
// Ни Electron, ни настоящих окон: поддельные окно и ipc. Поддельный ipc.on
// нарочно оборачивает функцию, как это делает страж IPC в main.js: именно
// из-за этой обёртки старый removeListener не снимал обработчик.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pick = require('../../src/pick-session.js');

// ── Подделки ────────────────────────────────────────────────────────────────
function fakeWindow() {
  const ls = {};
  const list = (ev) => (ls[ev] || (ls[ev] = []));
  const win = {
    destroyed: false,
    closeCount: 0,
    _wc: {},
    on(ev, fn) { list(ev).push(fn); return win; },
    removeListener(ev, fn) { const a = list(ev); const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); return win; },
    emit(ev, arg) { list(ev).slice().forEach((fn) => fn(arg)); },
    isDestroyed() { return win.destroyed; },
    close() { win.closeCount++; win.destroyed = true; win.emit('closed'); }
  };
  Object.defineProperty(win, 'webContents', {
    get() { if (win.destroyed) throw new Error('Object has been destroyed'); return win._wc; }
  });
  return win;
}

function fakeIpc() {
  const raw = new EventEmitter();
  return {
    raw: raw,
    // как страж IPC: в списке слушателей оказывается обёртка, а не fn
    on(ch, fn) {
      raw.on(ch, (ev, ...args) => fn(ev, ...args));
      return this;
    },
    // removeListener не обёрнут — ищет исходную функцию и не находит обёртку
    removeListener(ch, fn) { raw.removeListener(ch, fn); return this; },
    handle() {},
    listenerCount(ch) { return raw.listenerCount(ch); }
  };
}

async function waitFor(cond, what) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > 2000) throw new Error('не дождались: ' + what);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Обычный запуск: prepare отдаёт «снимок», window создаёт поддельное окно
function harness(extra) {
  const ipc = fakeIpc();
  const wins = [];
  const calls = { prepare: 0, window: 0 };
  const session = pick.create(Object.assign({ ipc: ipc, log: () => {} }, extra || {}));
  const start = () => session.start({
    prepare: () => { calls.prepare++; return { data: 1 }; },
    window: () => { calls.window++; const w = fakeWindow(); wins.push(w); return w; }
  });
  return { ipc, wins, calls, session, start: start };
}

// ── Обработчик один на всю программу ────────────────────────────────────────
test('pick-done: обработчик регистрируется один раз, сколько бы раз ни запускали', async () => {
  const h = harness();
  assert.equal(h.ipc.listenerCount('pick-done'), 1, 'сразу после создания — один');
  for (let i = 0; i < 3; i++) {
    const p = h.start();
    await waitFor(() => h.wins.length === i + 1, 'окно ' + (i + 1));
    h.ipc.raw.emit('pick-done', { sender: h.wins[i]._wc }, '#00FF00');
    assert.equal(await p, '#00FF00');
  }
  assert.equal(h.ipc.listenerCount('pick-done'), 1, 'и после трёх запусков — один');
});

// ── Два раза подряд: старое окно закрыто и бросает на webContents ───────────
test('два раза подряд: второй выбор работает, хотя первое окно уже уничтожено', async () => {
  const h = harness();
  const p1 = h.start();
  await waitFor(() => h.wins.length === 1, 'первое окно');
  assert.doesNotThrow(() => h.ipc.raw.emit('pick-done', { sender: h.wins[0]._wc }, '#111111'));
  assert.equal(await p1, '#111111');
  assert.equal(h.wins[0].destroyed, true, 'первое окно закрыто');

  // второе окно: старый обработчик (в старой логике) упал бы здесь на webContents
  const p2 = h.start();
  await waitFor(() => h.wins.length === 2, 'второе окно');
  assert.doesNotThrow(() => h.ipc.raw.emit('pick-done', { sender: h.wins[1]._wc }, '#222222'));
  assert.equal(await p2, '#222222', 'второй запуск завершился, экран не завис');
});

test('второй вызов во время первого: одного окна достаточно, обещание — то же', async () => {
  const h = harness();
  const p1 = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  const p2 = h.start();
  const p3 = h.start();
  assert.equal(p2, p1, 'второй вызов вернул то же обещание');
  assert.equal(p3, p1, 'и третий');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.wins.length, 1, 'второе окно не создавалось');
  assert.equal(h.calls.window, 1);
  h.ipc.raw.emit('pick-done', { sender: h.wins[0]._wc }, '#ABCDEF');
  assert.equal(await p1, '#ABCDEF');
  assert.equal(await p2, '#ABCDEF');
});

// ── Отмена ──────────────────────────────────────────────────────────────────
test('Esc приходит как done(null): цвет не выбран, окно закрыто', async () => {
  const h = harness();
  const p = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  h.ipc.raw.emit('pick-done', { sender: h.wins[0]._wc }, null);
  assert.equal(await p, null);
  assert.equal(h.wins[0].closeCount, 1, 'окно закрыли один раз');
  assert.equal(h.session.busy(), false, 'после отмены можно запускать снова');
});

test('потеря фокуса (blur) отменяет выбор и закрывает окно', async () => {
  const h = harness();
  const p = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  h.wins[0].emit('focus');           // окно показали и оно получило фокус
  h.wins[0].emit('blur');
  assert.equal(await p, null);
  assert.equal(h.wins[0].closeCount, 1);
});

test('blur до первого фокуса не отменяет: показ окна не должен закрывать пипетку', async () => {
  const h = harness();
  const p = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  h.wins[0].emit('blur');            // окно ещё не получало фокус
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.session.busy(), true, 'пипетка продолжает ждать');
  h.wins[0].emit('focus');
  h.wins[0].emit('blur');
  assert.equal(await p, null, 'а после фокуса потеря фокуса отменяет');
});

test('закрытие окна отменяет выбор', async () => {
  const h = harness();
  const p = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  h.wins[0].close();
  assert.equal(await p, null, 'закрыли окно — обещание завершилось, а не повисло');
});

// ── Тайм-аут ────────────────────────────────────────────────────────────────
test('тайм-аут 60 с по умолчанию: по истечении — отмена и закрытое окно', async () => {
  assert.equal(pick.TIMEOUT_MS, 60000);
  const h = harness({ timeoutMs: 25 });
  const p = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  assert.equal(await p, null);
  assert.equal(h.wins[0].closeCount, 1, 'окно пипетки закрыто');
  assert.equal(h.session.busy(), false);
});

test('тайм-аут не срабатывает после нормального завершения', async () => {
  const h = harness({ timeoutMs: 25 });
  const p = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  h.ipc.raw.emit('pick-done', { sender: h.wins[0]._wc }, '#010203');
  assert.equal(await p, '#010203');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(h.wins[0].closeCount, 1, 'второй раз окно не закрывали');
  assert.equal(h.session.busy(), false);
});

// ── Чужой отправитель и закрытое окно ───────────────────────────────────────
test('ответ от чужого отправителя не принимается', async () => {
  const h = harness();
  const p = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  let done = false;
  p.then(() => { done = true; });
  h.ipc.raw.emit('pick-done', { sender: {} }, '#FF0000');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done, false, 'чужой ответ ничего не завершил');
  assert.equal(h.session.busy(), true);
  h.ipc.raw.emit('pick-done', { sender: h.wins[0]._wc }, '#00FF00');
  assert.equal(await p, '#00FF00');
});

test('ответ из уже закрытого окна не бросает и ничего не ломает', async () => {
  const h = harness();
  const p = h.start();
  await waitFor(() => h.wins.length === 1, 'окно');
  const dead = h.wins[0];
  h.ipc.raw.emit('pick-done', { sender: dead._wc }, '#000000');
  assert.equal(await p, '#000000');
  assert.equal(dead.destroyed, true);
  // событие от закрытого окна приходит ещё раз: webContents бросает, но обработчик это глотает
  assert.doesNotThrow(() => h.ipc.raw.emit('pick-done', { sender: dead._wc }, '#FFFFFF'));
  // и следующая пипетка всё равно работает
  const p2 = h.start();
  await waitFor(() => h.wins.length === 2, 'второе окно');
  h.ipc.raw.emit('pick-done', { sender: h.wins[1]._wc }, '#123456');
  assert.equal(await p2, '#123456');
});

// ── Завершение ровно один раз, повторные запуски ─────────────────────────────
test('завершение ровно один раз: повторный ответ и закрытие ничего не меняют', async () => {
  let finished = 0;
  const ipc = fakeIpc();
  const wins = [];
  const s = pick.create({
    ipc: ipc,
    log: () => {},
    onFinish: () => { finished++; }
  });
  const p = s.start({ prepare: () => ({}), window: () => { const w = fakeWindow(); wins.push(w); return w; } });
  await waitFor(() => wins.length === 1, 'окно');
  ipc.raw.emit('pick-done', { sender: wins[0]._wc }, '#AABBCC');
  ipc.raw.emit('pick-done', { sender: wins[0]._wc }, '#DDEEFF');
  assert.equal(await p, '#AABBCC', 'первый ответ победил');
  assert.equal(wins[0].closeCount, 1, 'окно закрывалось один раз');
  assert.equal(finished, 1, 'onFinish — один раз');
});

test('после завершения пипетку можно запускать сколько угодно раз', async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) {
    const p = h.start();
    await waitFor(() => h.wins.length === i + 1, 'окно ' + (i + 1));
    h.ipc.raw.emit('pick-done', { sender: h.wins[i]._wc }, null);
    assert.equal(await p, null);
    assert.equal(h.wins[i].closeCount, 1);
  }
  assert.equal(h.ipc.listenerCount('pick-done'), 1, 'обработчиков по-прежнему один');
});

// ── Снимок экрана не удался ────────────────────────────────────────────────
test('prepare вернул null (пустой снимок): отмена без окна', async () => {
  const ipc = fakeIpc();
  let opened = 0;
  const s = pick.create({
    ipc,
    log: () => {},
    prepare: () => null,
    window: () => { opened++; return fakeWindow(); }
  });
  const p = s.start({ prepare: () => null, window: () => { opened++; return fakeWindow(); } });
  assert.equal(await p, null);
  assert.equal(opened, 0, 'окно не создавали');
  assert.equal(s.busy(), false);
});

test('ошибка при снимке или создании окна: отмена, а не зависание', async () => {
  const ipc = fakeIpc();
  const logs = [];
  const s = pick.create({
    ipc,
    log: (m) => logs.push(m),
    prepare: () => { throw new Error('снимок не вышел'); },
    window: () => fakeWindow()
  });
  assert.equal(await s.start({ prepare: () => { throw new Error('снимок не вышел'); }, window: () => fakeWindow() }), null);
  assert.equal(s.busy(), false);
  assert.ok(logs.some((m) => m.indexOf('снимок не вышел') >= 0), 'ошибка попала в лог');
});
