'use strict';
// L11 (аудит 0.32.0): когда пересчитывать лицензию и как часто ходить на сервер лицензий за временем.
// Чистые функции без Electron — чтобы покрыть unit-тестом.

// Как часто пересчитывать состояние лицензии, пока программа работает (триал может кончиться «на ходу»).
const LICENSE_RECHECK_MS = 60 * 60 * 1000;
// Как часто спрашивать сервер лицензий о времени (защита часов, M3). Не чаще раза в сутки (L11).
const SERVER_TIME_MS = 24 * 60 * 60 * 1000;

// prev — когда считали в прошлый раз (0 — ещё не считали), now — сейчас, every — период.
// Если часы перевели назад (now < prev), пересчитываем сразу: пусть clockCheck сам разберётся.
function licenseRecheckDue(prev, now, every) {
  const p = Number(prev) || 0, t = Number(now) || 0, e = Number(every) > 0 ? Number(every) : LICENSE_RECHECK_MS;
  if (!p) return true;
  if (t < p) return true; // часы перевели назад — не ждём час
  return t - p >= e;
}

// Кэш значения с загрузкой не чаще ttl. Одна загрузка на всех, кто спросил одновременно.
// Ошибка загрузки тоже кэшируется (0), чтобы сбой сети не превращался в запрос каждый час.
// o: { ttl, now(), load() } — все необязательные: по умолчанию сутки, Date.now и «0».
function createTimeCache(o) {
  const opts = o || {};
  const ttl = Number(opts.ttl) > 0 ? Number(opts.ttl) : SERVER_TIME_MS;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const load = typeof opts.load === 'function' ? opts.load : () => Promise.resolve(0);
  let at = 0, val = 0, pending = null;
  return {
    get() {
      if (at && now() - at < ttl) return Promise.resolve(val);
      if (!pending) {
        pending = Promise.resolve()
          .then(load)
          .catch(() => 0)
          .then((v) => { at = now(); val = Number(v) || 0; pending = null; return val; });
      }
      return pending;
    },
    reset() { at = 0; val = 0; pending = null; },
  };
}

module.exports = { LICENSE_RECHECK_MS, SERVER_TIME_MS, licenseRecheckDue, createTimeCache };
