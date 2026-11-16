'use strict';
// Счётчики автопочинок за сессию — по сервисам. Хранилище живёт в главном процессе,
// при перезапуске обнуляется («за сессию»). Успешные и неуспешные попытки считаются
// отдельно: в «Состоянии» показываем «2 (1 не вышла)».
// «Облачные функции» добавлены в 0.34.0 (шаг 5): автопочинка умеет их перепроверять.

const SERVICES = ['youtube', 'yandex', 'donationalerts', 'donatepay', 'twitch', 'lastfm', 'github', 'cloud'];

function create() {
  const out = {};
  SERVICES.forEach(function (s) { out[s] = { ok: 0, fail: 0 }; });
  return out;
}

// ok=true — починка удалась, ok=false — не вышла.
function record(state, service, ok) {
  const s = String(service);
  if (!state || SERVICES.indexOf(s) < 0) return state;
  const cell = state[s] || (state[s] = { ok: 0, fail: 0 });
  if (ok) cell.ok = (Number(cell.ok) || 0) + 1;
  else cell.fail = (Number(cell.fail) || 0) + 1;
  return state;
}

// Совместимость с шагом 1: bump считает успешную попытку.
function bump(state, service) { return record(state, service, true); }

// Всего попыток по сервису — как раньше, числом.
function snapshot(state) {
  const out = {};
  SERVICES.forEach(function (s) {
    const cell = state && state[s];
    out[s] = cell ? (Number(cell.ok) || 0) + (Number(cell.fail) || 0) : 0;
  });
  return out;
}

// Подробно: { сервис: { ok, fail, total } } — для строки «2 (1 не вышла)».
function detail(state) {
  const out = {};
  SERVICES.forEach(function (s) {
    const cell = (state && state[s]) || {};
    const ok = Number(cell.ok) || 0, fail = Number(cell.fail) || 0;
    out[s] = { ok, fail, total: ok + fail };
  });
  return out;
}

module.exports = { SERVICES, create, record, bump, snapshot, detail };
