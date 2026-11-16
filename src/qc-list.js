// Единый список пунктов быстрой проверки сервисов (Ф4).
// Им пользуются оба места: чеклист в поиске (src/ui/05-search.js) и раздел
// «Состояние сервисов» в настройках (src/ui/14-settings.js). Так набор пунктов
// и лампочки не расходятся. Работает и в окне (window.TapQC), и в Node (тесты).
(function (root) {
  'use strict';
  var GROUPS = [
    ['Основа', [['net', 'Интернет'], ['app', 'Тапёр'], ['recipes', 'Рецепты сайтов']]],
    ['Яндекс Музыка', [['ym.svc', 'Сервис'], ['ym.acc', 'Аккаунт'], ['ym.play', 'Воспроизведение'], ['ym.site', 'Запасной путь (сайт)']]],
    ['YouTube', [['yt.svc', 'Сервис'], ['yt.login', 'Вход'], ['yt.dlp', 'Движок']]],
    ['Другие площадки', [['sc', 'SoundCloud · Audius'], ['refs', 'Справочники · Deezer · Last.fm']]],
    ['Стрим', [['don', 'Сервисы донатов'], ['cloud', 'Облачные функции Тапёра']]]
  ];
  function groups() { return GROUPS; }
  // Плоский список [{ id, label, group }] — для проверок и настроек.
  function list() {
    var out = [];
    GROUPS.forEach(function (g) {
      g[1].forEach(function (it) { out.push({ id: it[0], label: it[1], group: g[0] }); });
    });
    return out;
  }
  function item(id) {
    var all = list();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  var api = { groups: groups, list: list, item: item };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TapQC = api;
})(this);
