'use strict';
// Учёт дочерних процессов (R12): yt-dlp запускается через execFile и живёт своей жизнью.
// Если Тапёр закрывают посреди поиска, плейлиста или потока, процесс остаётся висеть
// до своего тайм-аута (до 60 с) в диспетчере задач. Здесь — маленькое хозяйство:
// поставить на учёт при запуске, снять при завершении, убить всех живых при выходе.
//
// Модуль без require('electron') на верхнем уровне: проверяется unit-тестами
// (tests/unit/child-registry.test.mjs) на подделках, а main.js только создаёт его
// и зовёт killAll() в will-quit.

// Живой ли ещё процесс. У завершённого exitCode — число, у убитого killed = true.
// Подделки в тестах могут не иметь этих полей — тогда считаем живым.
function isAlive(child) {
  if (!child || typeof child !== 'object') return false;
  if (child.killed) return false;
  if (typeof child.exitCode === 'number') return false;
  return true;
}

function create(opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : function () {};
  const live = new Set();

  // Поставить процесс на учёт. Снятие — по событию завершения, чтобы не копить
  // ссылки за долгую сессию. track возвращает того же ребёнка (удобно в обёртке).
  function track(child) {
    if (!child || typeof child !== 'object') return child;
    live.add(child);
    try {
      if (typeof child.once === 'function') {
        child.once('close', () => { live.delete(child); });
        child.once('error', () => { live.delete(child); });
      }
    } catch (e) { /* без событий снимется при killAll */ }
    return child;
  }

  function untrack(child) {
    live.delete(child);
  }

  // Погасить все живые. Ошибки не бросаем: выход не должен падать из-за одного
  // упрямого процесса. В журнал — сколько убито и сколько не поддалось.
  function killAll() {
    let killed = 0;
    let failed = 0;
    for (const child of Array.from(live)) {
      live.delete(child); // повторно не убиваем, даже если kill() бросил
      if (!isAlive(child)) continue;
      try {
        if (child.kill() === false) failed++;
        else killed++;
      } catch (e) {
        failed++;
      }
    }
    log('дочерние процессы: убито ' + killed + (failed ? ', не удалось ' + failed : ''));
    return { killed, failed };
  }

  function size() { return live.size; }

  return { track, untrack, killAll, size };
}

module.exports = { create, isAlive };
