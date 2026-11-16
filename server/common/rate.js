// G-07 / G-05: лимит частоты — один на все функции, с настройками на функцию.
//
// Честный Тапёр обращается к облаку редко (обновить вход — раз в час), поэтому лимиты щедрые:
// по умолчанию не больше RATE_PER_IP запросов за 10 минут с одного адреса и RATE_GLOBAL_PER_MIN
// в минуту всего. Счётчики живут в памяти экземпляра функции; у функции в консоли задан предел
// экземпляров (docs/CLOUD-LIMITS.md), поэтому экземпляров мало и лимит почти общий.
//
// Ответ на превышение — 429 с Retry-After (через сколько секунд можно снова), его собирает reply.js.
'use strict';
const { ipOf } = require('./ip');

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_PER_IP = 30;
const RATE_GLOBAL_PER_MIN = 120;

// Свой счётчик на каждую функцию: у них разные адреса и разные профили нагрузки.
function createRate(opts) {
  const o = opts || {};
  const windowMs = o.windowMs || RATE_WINDOW_MS;
  const perIp = o.perIp || RATE_PER_IP;
  const globalPerMin = o.globalPerMin || RATE_GLOBAL_PER_MIN;
  const state = { ips: new Map(), min: 0, n: 0 };

  // 0 — можно; иначе — через сколько секунд
  function wait(event, now) {
    const t = now == null ? Date.now() : now;
    const m = Math.floor(t / 60000);
    if (m !== state.min) { state.min = m; state.n = 0; }
    if (++state.n > globalPerMin) return 60 - Math.floor((t % 60000) / 1000);
    const ip = ipOf(event);
    if (!ip) return 0;
    const a = (state.ips.get(ip) || []).filter((x) => x > t - windowMs);
    if (a.length >= perIp) {
      state.ips.set(ip, a);
      return Math.max(1, Math.ceil((a[0] + windowMs - t) / 1000));
    }
    a.push(t);
    state.ips.set(ip, a);
    // Изредка подчищаем память: иначе она растёт от чужих адресов
    if (state.ips.size > 5000) {
      for (const [k, v] of state.ips) if (!v.length || v[v.length - 1] <= t - windowMs) state.ips.delete(k);
    }
    return 0;
  }

  function reset() { state.ips.clear(); state.min = 0; state.n = 0; }

  return { wait, reset, windowMs, perIp, globalPerMin };
}

module.exports = { createRate, RATE_WINDOW_MS, RATE_PER_IP, RATE_GLOBAL_PER_MIN };
