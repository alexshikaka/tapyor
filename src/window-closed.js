'use strict';
// R12, п. 3: страховка окна.
//
// Если главное окно закрылось не через штатный путь (например, window.close() из
// страницы), главный процесс раньше оставался без окна и не выходил: программа жила
// в трее, но открыть её было нечем. Штатные пути (крестик → трей или выход, трей,
// «Выход») не трогаем.
//
// Решение — чистая функция: состояние не читает, только говорит, что делать.
// unit-тесты: tests/unit/window-closed.test.mjs; main.js только зовёт её в обработчике
// closed главного окна и пишет в журнал.
//
//   quitting     — уже идёт выход (app.isQuitting или выход сторожа);
//   hiddenToTray — окно спрятано в трей и не закрыто;
//   recovering   — сторож уже поднимает окно после падения (новое окно создано).

function closedDecision(state) {
  const s = state || {};
  if (s.quitting) return { action: 'none', why: 'идёт выход' };
  if (s.hiddenToTray) return { action: 'none', why: 'окно спрятано в трей' };
  if (s.recovering) return { action: 'none', why: 'сторож поднимает окно' };
  return { action: 'quit', why: 'закрыто вне выхода' };
}

module.exports = { closedDecision };
