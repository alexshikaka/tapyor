// Формат сообщений между окном Тапёра и страницей плеера YouTube (P5c №1, B11).
// Чистые функции без DOM: их используют обе стороны, а tests/unit/yt-msg.test.mjs проверяет
// границы. Всё, что не совпало по виду, отбрасывается — сообщению из чужого окна верить нельзя.
'use strict';
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TapYtMsg = api;
})(typeof window !== 'undefined' ? window : null, function () {
  var TAG = 1;              // метка наших сообщений: чужие postMessage не разбираем
  var MAX_ID = 64;          // id ролика YouTube — 11 знаков; с запасом
  var MAX_SEC = 1000000;    // ~11,5 суток: больше ни один ролик не идёт
  var CMD = { load: 1, play: 1, pause: 1, seek: 1, volume: 1 };
  var EVT = { ready: 1, state: 1, time: 1, duration: 1, error: 1 };
  var STATES = { '-1': 1, '0': 1, '1': 1, '2': 1, '3': 1, '5': 1 };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v, min, max) { return isNum(v) && Math.floor(v) === v && v >= min && v <= max; }
  function isSec(v) { return isNum(v) && v >= 0 && v <= MAX_SEC; }
  function isId(v) { return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID && /^[A-Za-z0-9_-]+$/.test(v); }

  function base(data, dir, list) {
    if (!isObj(data)) return null;
    if (data.t !== TAG || data.dir !== dir) return null;
    if (typeof data.type !== 'string' || !list[data.type]) return null;
    return data;
  }

  // Команда окно → страница плеера. null — не наша или неправильная.
  function parseCmd(data) {
    var m = base(data, 'cmd', CMD);
    if (!m) return null;
    if (m.type === 'load') return isId(m.id) ? { type: 'load', id: m.id } : null;
    if (m.type === 'seek') return isSec(m.value) ? { type: 'seek', value: m.value } : null;
    if (m.type === 'volume') return isNum(m.value) && m.value >= 0 && m.value <= 100 ? { type: 'volume', value: m.value } : null;
    return { type: m.type };
  }

  // Событие страница плеера → окно. null — не наше или неправильное.
  function parseEvt(data) {
    var m = base(data, 'evt', EVT);
    if (!m) return null;
    if (m.type === 'ready') return { type: 'ready' };
    if (m.type === 'state') return isNum(m.value) && STATES[String(m.value)] ? { type: 'state', value: m.value } : null;
    if (m.type === 'time' || m.type === 'duration') return isSec(m.value) ? { type: m.type, value: m.value } : null;
    if (m.type === 'error') return isInt(m.value, -32768, 32767) ? { type: 'error', value: m.value } : null;
    return null;
  }

  // Адрес петли: только http, только 127.0.0.1/localhost, только настоящий порт.
  // Возвращает приведённый к нижнему регистру origin или '' — им же сравниваем event.origin.
  function parseLoopbackOrigin(value) {
    var s = typeof value === 'string' ? value : '';
    var m = /^http:\/\/(127\.0\.0\.1|localhost):([0-9]{1,5})$/i.exec(s);
    if (!m) return '';
    var port = Number(m[2]);
    if (port < 1 || port > 65535) return '';
    return 'http://' + m[1].toLowerCase() + ':' + port;
  }
  function isLoopbackOrigin(value) { return !!parseLoopbackOrigin(value); }

  return { TAG: TAG, MAX_SEC: MAX_SEC, parseCmd: parseCmd, parseEvt: parseEvt, parseLoopbackOrigin: parseLoopbackOrigin, isLoopbackOrigin: isLoopbackOrigin, isId: isId };
});
