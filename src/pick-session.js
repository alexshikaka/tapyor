// Пипетка по всему экрану: одна сессия за раз.
//
// Здесь только «когда закрыть и что вернуть». Снимок экрана и само окно создаёт
// главный процесс (main.js) и передаёт сюда готовыми функциями — поэтому модуль
// не требует electron и проверяется обычными unit-тестами.
//
// Почему отдельный модуль: в main.js обработчик pick-done навешивался на каждый
// запуск, а removeListener его не снимал — ipcMain.on подменён стражем IPC и в
// списке слушателей лежит обёртка, а не исходная функция. На втором запуске
// старый обработчик обращался к webContents закрытого окна, бросал исключение
// «Object has been destroyed», и свежий обработчик не получал pick-done — окно
// на весь экран оставалось навсегда. Теперь обработчик один на всю программу.

const TIMEOUT_MS = 60 * 1000;

// opts.ipc          — ipcMain (или подделка с .on)
// opts.log          — куда писать строку (необязательно)
// opts.onFinish     — что сделать после завершения (например, забыть снимок)
// opts.timeoutMs    — сколько ждать ответа (по умолчанию 60 с)
// opts.setTimeout / opts.clearTimeout — таймеры (для тестов)
function create(opts) {
  const o = opts || {};
  const ipc = o.ipc;
  if (!ipc || typeof ipc.on !== 'function') throw new Error('pick-session: нужен ipc');
  const log = typeof o.log === 'function' ? o.log : function () {};
  const onFinish = typeof o.onFinish === 'function' ? o.onFinish : function () {};
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : TIMEOUT_MS;
  const startTimer = typeof o.setTimeout === 'function' ? o.setTimeout : setTimeout;
  const stopTimer = typeof o.clearTimeout === 'function' ? o.clearTimeout : clearTimeout;

  let current = null;   // { win, finished, timer, handlers, promise, resolve }

  // Единственный обработчик ответа пипетки на всю программу: он не снимается,
  // поэтому ему нельзя хранить состояние ни одного запуска, кроме текущего.
  function onDone(ev, val) {
    const s = current;
    if (!s || s.finished || !s.win) return;
    try {
      // К закрытому окну не обращаемся: webContents бросает «Object has been destroyed».
      if (typeof s.win.isDestroyed === 'function' && s.win.isDestroyed()) return;
      const wc = s.win.webContents;
      if (!wc || !ev || ev.sender !== wc) return;   // ответ не от окна текущего запуска
    } catch (e) {
      return;
    }
    finish(val);
  }
  ipc.on('pick-done', onDone);

  // Снять слушатели с окна, чтобы закрытое окно не держало сессию.
  function unbind(s) {
    const h = s && s.handlers;
    const win = s && s.win;
    s.handlers = null;
    if (!h || !win || typeof win.removeListener !== 'function') return;
    try { win.removeListener('focus', h.focus); } catch (e) {}
    try { win.removeListener('blur', h.blur); } catch (e) {}
    try { win.removeListener('closed', h.closed); } catch (e) {}
  }

  // Завершение ровно один раз: ответ, отмена, blur, закрытие, тайм-аут.
  function finish(val) {
    const s = current;
    if (!s || s.finished) return;
    s.finished = true;
    current = null;
    if (s.timer) { try { stopTimer(s.timer); } catch (e) {} s.timer = null; }
    unbind(s);
    try { if (s.win && !(typeof s.win.isDestroyed === 'function' && s.win.isDestroyed())) s.win.close(); } catch (e) {}
    try { onFinish(); } catch (e) {}
    const out = (val === undefined) ? null : val;
    try { s.resolve(out); } catch (e) {}
  }

  // start({ prepare, window }) → Promise<string|null>
  //   prepare — async: снять экран, вернуть данные для окна (или null — отмена);
  //   window(data) — создать и показать окно, вернуть его.
  // Второй вызов, пока идёт первый, окно не создаёт и возвращает то же обещание.
  function start(step) {
    if (current) return current.promise;
    const st = step || {};
    const s = { win: null, finished: false, timer: null, handlers: null, promise: null, resolve: null };
    s.promise = new Promise(function (resolve) { s.resolve = resolve; });
    current = s;

    (async function () {
      let win = null;
      try {
        const data = (typeof st.prepare === 'function') ? await st.prepare() : true;
        if (s.finished) return;
        if (!data) { finish(null); return; }
        win = (typeof st.window === 'function') ? st.window(data) : null;
        if (!win) { finish(null); return; }
        if (s.finished) return;   // отменили, пока окно открывалось
        s.win = win;
        const h = s.handlers = {
          focused: false,
          focus: function () {
            // blur навешиваем только после первого фокуса: иначе показ окна на Windows
            // может дать ложный blur и пипетка закроется, не успев открыться.
            if (h.focused) return;
            h.focused = true;
            try { win.on('blur', h.blur); } catch (e) {}
          },
          blur: function () { finish(null); },       // фокус ушёл — отмена
          closed: function () { finish(null); }      // окно закрыли — отмена
        };
        if (typeof win.on === 'function') {
          win.on('focus', h.focus);
          win.on('closed', h.closed);
        }
        s.timer = startTimer(function () {
          log('пипетка: время вышло, отменяю');
          finish(null);
        }, timeoutMs);
      } catch (e) {
        log('пипетка: ' + (e && e.message ? e.message : e));
        finish(null);
      }
    })();

    return s.promise;
  }

  return { start: start, busy: function () { return !!current; } };
}

module.exports = { create: create, TIMEOUT_MS: TIMEOUT_MS };
