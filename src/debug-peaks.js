'use strict';
// Пики нагрузки за сессию. Считает главный процесс на каждом замере (perf-sample),
// чтобы цифры копились, даже когда отладочное меню закрыто и окно свёрнуто.
// Здесь только числа и время — ни Electron, ни DOM, поэтому покрывается unit-тестами.
//
// Смысл: «пик» — самое высокое значение с начала сессии (или с последнего сброса).
// «Последнее» — текущий замер; после «Сбросить пики» текущее значение становится новым пиком.

function create() {
  return {
    mem: null, memAt: 0,
    cpu: null, cpuAt: 0,
    lastMem: null, lastCpu: null, lastAt: 0
  };
}

function add(state, mem, cpu, at) {
  if (!state) return state;
  const t = Number(at) || Date.now();
  const m = Number(mem);
  const c = Number(cpu);
  if (isFinite(m)) {
    state.lastMem = m;
    if (state.mem == null || m > state.mem) { state.mem = m; state.memAt = t; }
  }
  if (isFinite(c)) {
    state.lastCpu = c;
    if (state.cpu == null || c > state.cpu) { state.cpu = c; state.cpuAt = t; }
  }
  state.lastAt = t;
  return state;
}

// Сброс: новые пики — то, что было в последнем замере. Если замеров ещё не было — пусто.
function reset(state, at) {
  if (!state) return state;
  const t = Number(at) || Date.now();
  state.mem = isFinite(state.lastMem) ? state.lastMem : null;
  state.memAt = state.mem == null ? 0 : t;
  state.cpu = isFinite(state.lastCpu) ? state.lastCpu : null;
  state.cpuAt = state.cpu == null ? 0 : t;
  return state;
}

function snapshot(state) {
  const s = state || create();
  return {
    mem: s.mem, memAt: s.memAt || 0,
    cpu: s.cpu, cpuAt: s.cpuAt || 0,
    lastMem: s.lastMem, lastCpu: s.lastCpu, lastAt: s.lastAt || 0
  };
}

module.exports = { create, add, reset, snapshot };
