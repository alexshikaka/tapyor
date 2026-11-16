// «Что играет» и «Для вас»: один и тот же список вариантов волны.
// Работает и в окне Тапёра (window.TapWaveVariants), и в Node (для проверок).
(function (root) {
  var MY = { name: 'Моя волна — как обычно', station: 'user:onyourwave', color: '#FFD43B' };
  var MAX_CONTEXTS = 12;

  function seedsOf(v) {
    return Array.isArray(v && v.seeds) ? v.seeds.filter(function (s) { return typeof s === 'string' && s; }) : [];
  }
  // id строки: по семенам, если они есть, иначе по станции. Одинаков и для правой панели, и для «Для вас».
  function key(v) {
    if (!v) return '';
    var seeds = seedsOf(v);
    return 'wave:' + (seeds.length ? seeds.join(',') : String(v.station || ''));
  }
  // Вариант ведёт на ту же «Мою волну»: станция user:onyourwave или семена только из неё.
  function leadsToMyWave(v) {
    if (!v) return false;
    if (v.station === 'user:onyourwave') return true;
    var seeds = seedsOf(v);
    return seeds.length > 0 && seeds.every(function (s) { return s === 'user:onyourwave'; });
  }
  // Варианты «Для вас»: без «Моей волны», без повторов id. Первый по порядку важнее.
  function pick(contexts) {
    var out = [], seen = {};
    (Array.isArray(contexts) ? contexts : []).forEach(function (c) {
      if (!c || typeof c !== 'object' || !c.name || leadsToMyWave(c)) return;
      var id = key(c);
      if (!id || id === 'wave:' || seen[id]) return;
      seen[id] = 1;
      out.push(c);
    });
    return out;
  }
  // Строки для панели «Что играет»: сначала «Моя волна — как обычно», затем варианты «Для вас».
  function list(contexts) {
    var out = [{ name: MY.name, station: MY.station, seeds: [], color: MY.color }];
    pick(contexts).slice(0, MAX_CONTEXTS).forEach(function (c) {
      out.push({ name: String(c.name), station: String(c.station || ''), seeds: seedsOf(c), color: String(c.color || '') });
    });
    return out;
  }
  // id выбранной сейчас волны — тот же, что у строки списка и у карточки «Для вас».
  function activeId(bg) {
    if (!bg || bg.kind !== 'wave') return '';
    return key(bg);
  }

  var api = { MY_WAVE: MY, MAX_CONTEXTS: MAX_CONTEXTS, key: key, leadsToMyWave: leadsToMyWave, pick: pick, list: list, activeId: activeId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TapWaveVariants = api;
})(this);
