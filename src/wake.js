'use strict';
// После сна ПК связи (донаты, Streamer.bot) восстанавливаются сами, но ждут свою паузу:
// опрос донатов — до 5 минут, пульт Streamer.bot — до 60 секунд. Здесь одна точка
// «разбудить сейчас»: действия вызываются сразу, каждое в своём try, ошибка одного
// не мешает другим. Слишком частые пробуждения (например, экран несколько раз
// выключили и включили) гасятся промежутком minGapMs.
// Без Electron — чтобы покрыть unit-тестами (tests/unit/wake.test.mjs).
function create(o) {
  const opts = o || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const rawGap = Number(opts.minGapMs);
  const minGapMs = isFinite(rawGap) && rawGap >= 0 ? rawGap : 30000;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const actions = (Array.isArray(opts.actions) ? opts.actions : [])
    .filter((a) => a && typeof a.run === 'function');
  let lastAt = null;

  function onResume(reason) {
    const t = now();
    if (lastAt != null && t - lastAt < minGapMs) return false;
    lastAt = t;
    try { log('после сна: донаты, Streamer.bot — проверяю связь'); } catch (e) {}
    for (const a of actions) {
      try {
        const r = a.run(reason);
        // Действие может быть обещанием: его ошибка не должна стать необработанной.
        if (r && typeof r.catch === 'function') {
          r.catch((e) => {
            try { log('после сна: ' + a.name + ' — ' + ((e && e.message) || e)); } catch (x) {}
          });
        }
      } catch (e) {
        try { log('после сна: ' + a.name + ' — ' + ((e && e.message) || e)); } catch (x) {}
      }
    }
    return true;
  }

  return { onResume };
}

module.exports = { create };
