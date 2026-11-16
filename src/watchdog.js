'use strict';
// Сторож окна (0.34.0, задание 6).
//
// Упало или зависло окно Тапёра — программа сама поднимает его. Очередь и текущий
// трек уже сохраняются в настройке today (src/ui/03-queue.js; с R2 — файл today.json), поэтому после
// поднятия окно получает признак «поднято после сбоя» (IPC recover-take) и
// продолжает играть с того же места.
//
// Защита от петли: не больше 3 поднятий за 10 минут (скользящее окно). На 4-й раз
// окно не поднимается молча — главный процесс показывает сообщение владельцу.
//
// Модуль без require('electron') на верхнем уровне: решения и счёт проверяются
// unit-тестами (tests/unit/watchdog.test.mjs), а main.js только подписывает
// события окна и делает reload/createWindow/диалог.
//
// Правила:
//  • render-process-gone с reason 'clean-exit' — штатное закрытие окна, не трогаем;
//  • выход из программы (app.isQuitting, app.relaunch из отладки) — не трогаем;
//  • остальные причины (crashed, oom, killed, abnormal-exit, launch-failed,
//    integrity-failure) — поднимаем окно;
//  • unresponsive — ждём 15 секунд; пришло responsive раньше — только запись в
//    журнал «окно ожило через N с»; не пришло — окно принудительно роняется,
//    дальше обычное поднятие (счётчик тот же).
//
// Имитации падений из отладочного меню тоже живут здесь: проверка «только тестовый
// профиль», разбор секунд зависания (5–60) и порча settings.json без .bak.

const fs = require('fs');

const MAX_RESTARTS = 3;
const WINDOW_MS = 10 * 60 * 1000;
const HANG_MS = 15 * 1000;
const RECOVER_TTL_MS = 2 * 60 * 1000;
// Пульс окна: период и порог «нет отклика». Те же числа использует main.js.
// MISS_MS — ещё и минимальная задержка перед перезапуском: после долгого сна
// окно должно успеть ответить на первый же пульс.
const PING_MS = 2000;
const MISS_MS = 5000;
const HANG_MIN_S = 5;
const HANG_MAX_S = 60;
const HANG_DEFAULT_S = 30;
// Заведомо битый JSON: store отложит копию .broken-* и поднимет настройки из .bak.
const GARBAGE = '{"повреждено": ';

// Причина падения окна → что делать. Чистая функция: состояние не читает.
function goneDecision(reason, opts) {
  const o = opts || {};
  const r = String(reason == null ? '' : reason);
  if (o.quitting) return { action: 'ignore', why: 'выход из программы' };
  if (r === 'clean-exit') return { action: 'ignore', why: 'окно закрылось само' };
  return { action: 'restart', why: r || 'причина неизвестна' };
}

// Сколько поднятий было за последние windowMs и можно ли ещё одно.
// times — времена поднятий (мс), now — текущее время. Чистая функция.
function loopDecision(times, now, opts) {
  const o = opts || {};
  const max = Number(o.max) > 0 ? Number(o.max) : MAX_RESTARTS;
  const windowMs = Number(o.windowMs) > 0 ? Number(o.windowMs) : WINDOW_MS;
  const t = Number(now) || 0;
  const list = (Array.isArray(times) ? times : [])
    .map(Number)
    .filter((x) => isFinite(x) && x <= t && t - x < windowMs)
    .sort((a, b) => a - b);
  if (list.length < max) return { allowed: true, count: list.length, recent: list, waitMs: 0 };
  // Ждать, пока из окна уйдёт столько старых поднятий, чтобы осталось max - 1.
  const need = Math.max(0, list.length - max);
  const edge = list[need];
  return { allowed: false, count: list.length, recent: list, waitMs: Math.max(0, edge + windowMs - t) };
}

// Один тик пульса: что делать. Чистая функция — ничего не читает и не меняет.
//   skip — между тиками прошло больше трёх периодов: это сон ПК или главный
//          процесс был занят; окно не виновато, отсчёт надо сбросить;
//   hung — окно молчит дольше missMs: начинаем отсчёт зависания (startedAt —
//          время последнего отклика);
//   wait — окно отвечает, всё обычно.
function heartbeatDecision(o) {
  const opts = o || {};
  const now = Number(opts.now) || 0;
  const lastTick = Number(opts.lastTick) || 0;
  const lastPong = Number(opts.lastPong) || 0;
  const pingMs = Number(opts.pingMs) > 0 ? Number(opts.pingMs) : PING_MS;
  const missMs = Number(opts.missMs) > 0 ? Number(opts.missMs) : MISS_MS;
  const gap = lastTick > 0 ? now - lastTick : 0;
  if (gap > 3 * pingMs) return { action: 'skip', pausedMs: Math.max(0, gap) };
  if (lastPong > 0 && now - lastPong >= missMs) return { action: 'hung', startedAt: lastPong, silentMs: now - lastPong };
  return { action: 'wait' };
}

// Секунды зависания из отладочного меню: целое 5–60, иначе null.
// Строка принимается (её присылает поле ввода), «30 секунд» и 30.5 — нет.
function parseHangSeconds(v) {
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim()) n = Number(v.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < HANG_MIN_S || n > HANG_MAX_S) return null;
  return n;
}

// Имитации падений — только в тестовом профиле. Проверяется и в окне, и здесь.
function imitationGuard(isTestProfile) {
  if (isTestProfile) return { ok: true };
  return { ok: false, error: 'только в тестовом профиле' };
}

// Испортить settings.json, не трогая .bak. Если .bak ещё нет — кладём туда
// текущий исправный файл, иначе восстанавливать будет нечего (первый запуск).
// Возвращает число записанных байт.
function corruptSettings(file, opts) {
  const o = opts || {};
  const f = o.fs || fs;
  const p = String(file || '');
  if (!p) return 0;
  if (o.backup !== false) {
    try {
      if (!f.existsSync(p + '.bak') && f.existsSync(p)) f.copyFileSync(p, p + '.bak');
    } catch (e) { /* нет .bak — store начнёт с пустых; это видно в журнале */ }
  }
  f.writeFileSync(p, GARBAGE, 'utf8');
  return Buffer.byteLength(GARBAGE, 'utf8');
}

function create(opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : function () {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const setT = typeof o.setTimeout === 'function' ? o.setTimeout : setTimeout;
  const clearT = typeof o.clearTimeout === 'function' ? o.clearTimeout : clearTimeout;
  const max = Number(o.maxRestarts) > 0 ? Number(o.maxRestarts) : MAX_RESTARTS;
  const windowMs = Number(o.windowMs) > 0 ? Number(o.windowMs) : WINDOW_MS;
  const hangMs = Number(o.hangMs) > 0 ? Number(o.hangMs) : HANG_MS;
  const recoverTtl = Number(o.recoverTtl) > 0 ? Number(o.recoverTtl) : RECOVER_TTL_MS;

  let lifts = [];            // времена поднятий за сессию (для скользящего окна)
  let total = 0;             // всего поднятий за сессию
  let lastReason = '';       // причина последнего падения
  let lastAt = 0;            // когда было последнее поднятие
  let recoverAt = 0;         // окно ждёт признак «поднято после сбоя»
  let hang = { at: 0, handle: null };
  let stopped = false;

  function safe(fn, arg) {
    if (typeof fn !== 'function') return;
    try { fn(arg); } catch (e) { try { log('сторож: обработчик — ' + (e && e.message ? e.message : e)); } catch (e2) {} }
  }
  function prune(t) { lifts = lifts.filter((x) => t - x < windowMs); }

  // Падение окна. Возвращает { action: 'ignore' | 'restart' | 'loop', ... }.
  // 'restart' — окно надо поднять (onRecover), 'loop' — показать сообщение (onLoop).
  function onGone(reason, opt) {
    if (stopped) return { action: 'ignore', why: 'сторож остановлен' };
    const d = goneDecision(reason, opt);
    if (d.action === 'ignore') {
      log('сторож: падение окна не считаем — ' + d.why + ' (' + String(reason) + ')');
      return d;
    }
    const t = now();
    prune(t);
    const l = loopDecision(lifts, t, { max, windowMs });
    if (!l.allowed) {
      const res = { action: 'loop', why: d.why, count: l.count, waitMs: l.waitMs };
      log('сторож: окно падает снова и снова — поднятий ' + l.count + ' за ' + Math.round(windowMs / 60000) + ' мин, больше не поднимаю');
      safe(o.onLoop, res);
      return res;
    }
    lifts.push(t); total++; lastReason = d.why; lastAt = t; recoverAt = t;
    const res = { action: 'restart', why: d.why, count: l.count + 1, max: max, windowMs: windowMs };
    log('сторож: окно упало (' + d.why + ') — поднимаю (' + res.count + ' из ' + max + ' за ' + Math.round(windowMs / 60000) + ' мин)');
    safe(o.onRecover, res);
    return res;
  }

  // Окно не отвечает: ждём 15 секунд. Повторное событие, пока ждём, ничего не меняет.
  // startedAt — когда окно перестало отвечать (по пульсу), чтобы 15 секунд считались
  // от начала зависания, а не от момента, когда мы это заметили. Но не меньше MISS_MS
  // от момента вызова: после долгого сна окну нужно успеть ответить на первый пульс,
  // иначе живое окно перезапускалось бы сразу после пробуждения ПК.
  function onUnresponsive(startedAt) {
    if (stopped) return { action: 'ignore' };
    if (hang.handle || hang.at) return { action: 'wait', ms: hangMs, already: true };
    const t = now();
    const at = Number(startedAt) > 0 ? Math.min(t, Number(startedAt)) : t;
    const delay = Math.max(MISS_MS, hangMs - (t - at));
    hang.at = at;
    hang.handle = setT(function () {
      const sec = Math.max(0, Math.round((now() - hang.at) / 1000));
      hang.handle = null; hang.at = 0;
      if (stopped) return;
      log('сторож: окно не отвечало ' + sec + ' с — перезапускаю');
      safe(o.onHang, { seconds: sec });
    }, delay);
    return { action: 'wait', ms: delay, already: false };
  }

  // Окно ответило до срока: снимаем таймер и пишем, через сколько ожило.
  function onResponsive() {
    if (!hang.at) return { action: 'none' };
    const sec = Math.max(0, Math.round((now() - hang.at) / 1000));
    if (hang.handle) { try { clearT(hang.handle); } catch (e) {} }
    hang.handle = null; hang.at = 0;
    log('сторож: окно ожило через ' + sec + ' с');
    return { action: 'alive', seconds: sec };
  }

  // Забрать признак «поднято после сбоя». Один раз и только свежий: обычный
  // запуск (и ручная перезагрузка через час) музыку сам не включает.
  function takeRecover() {
    if (!recoverAt) return false;
    const fresh = now() - recoverAt <= recoverTtl;
    recoverAt = 0;
    return fresh;
  }

  // Снять ожидание зависания без записи «ожило»: окно поднимается после падения,
  // старый таймер зависания больше не нужен.
  function resetHang() {
    if (hang.handle) { try { clearT(hang.handle); } catch (e) {} }
    hang.handle = null; hang.at = 0;
  }

  function stop() {
    stopped = true;
    resetHang();
  }

  function state() {
    const t = now();
    prune(t);
    return {
      restarts: total, recent: lifts.length, max: max, windowMs: windowMs,
      hangMs: hangMs, lastReason: lastReason, lastAt: lastAt,
      pendingRecover: !!recoverAt
    };
  }

  return { onGone, onUnresponsive, onResponsive, resetHang, takeRecover, stop, state };
}

module.exports = {
  MAX_RESTARTS, WINDOW_MS, HANG_MS, RECOVER_TTL_MS, PING_MS, MISS_MS,
  HANG_MIN_S, HANG_MAX_S, HANG_DEFAULT_S, GARBAGE,
  goneDecision, loopDecision, heartbeatDecision, parseHangSeconds, imitationGuard, corruptSettings, create
};
