'use strict';
// Сколько запросов потока сейчас в работе (0.34.0, аудит A11).
//
// Пока счётчик не ноль, движок YouTube (yt-dlp) не обновляем: подмена exe на лету
// может сломать только что запущенный поток. Счётчик ведёт главный процесс вокруг
// обработчиков yt-stream / ym-stream / url-stream; сам по себе он ничего не делает.
let active = 0;

function begin() { active += 1; return active; }
function end() { if (active > 0) active -= 1; return active; }
function reset() { active = 0; }
function count() { return active; }
function isBusy() { return active > 0; }

module.exports = { begin, end, reset, count, isBusy };
