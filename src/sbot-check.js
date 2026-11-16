// G1 (13.11): показывать ли строки Streamer.bot в чеклисте запуска.
// Работает и в окне Тапёра (window.TapSBCheck), и в Node (для проверок) — как src/rank.js.
//
// Решает только chatOrders — переключатель «кто принимает заказы из чата»
// (none | pack | sbot). Это единственный признак, что Streamer.bot вообще нужен для заказов.
//
// sbotEnabled сюда НЕ входит: это «пульт к Streamer.bot был включён» (владелец когда-то
// подключался, например, только ради триггеров). Такой пульт продолжает жить своей жизнью —
// точка связи в шапке, пункт меню и вкладка «Streamer.bot» показывают состояние, — но
// ошибку в чеклисте тем, кто заказы через него не принимает, не показываем.
(function (root) {
  'use strict';

  function showInChecklist(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    return s.chatOrders === 'sbot';
  }

  const api = { showInChecklist };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TapSBCheck = api;
})(this);
