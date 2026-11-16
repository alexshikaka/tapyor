'use strict';
// R3: когда ставить скачанное обновление, чтобы не перезапускать программу посреди стрима.
// Здесь только решение — без Electron, чтобы проверялось unit-тестами.
// Решает main.js: на 'update-downloaded', по кнопке и при обычном выходе.

// decide({ sessionActive, playerBusy, installRequested }) → 'install-now' | 'wait-quit'
//   installRequested — стример сам нажал «Обновить» / «Перезапустить сейчас»: ставим всегда;
//   сессии нет и музыка не играет — только что запустили программу, ничего не делали: ставим;
//   иначе — ждём обычного выхода (программу посреди стрима не закрываем).
function decide(o) {
  const s = o || {};
  if (s.installRequested) return 'install-now';
  if (s.sessionActive === false && !s.playerBusy) return 'install-now';
  return 'wait-quit';
}

// Счётчик этого запуска: активна, если хоть раз что-то играло или пришёл хоть один заказ
// (донат, чат, Streamer.bot, тестовый заказ из отладки).
function createSession() {
  let played = false;
  let ordered = false;
  return {
    markPlayed() { played = true; },
    markOrder() { ordered = true; },
    active() { return played || ordered; },
  };
}

module.exports = { decide, createSession };
