// Подставной «Пак стримера» с оверлеем — только для снимка настроек оверлея.
// Загружается после mock5.js и shots-data.js. Список стилей — тот же, что отдаёт модуль
// (test/ui/tOVC2a.py); страницы /overlay/* подменяет make-shots.py через page.route.
(function () {
  'use strict';
  var A = window.app;
  if (!A) return;
  var P = function (v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 10); }); };

  var STYLES = [
    ['card', 1, 'Карточка', 'Manrope'], ['vinyl', 2, 'Винил', 'Lora'],
    ['bigtype', 3, 'Крупный шрифт', 'Unbounded'], ['column', 4, 'Колонка', 'Tektur'],
    ['typography', 5, 'Типографика', 'Manrope'], ['tilt', 6, 'Наклонённая обложка', 'Manrope'],
    ['ribbon', 7, 'Нижняя лента', 'Fira Sans Condensed'], ['vtitle', 8, 'Вертикальный заголовок', 'Oswald'],
    ['win95', 9, 'Windows 95', 'Pixelify Sans'], ['sys7', 10, 'Mac System 7', 'Pixelify Sans'],
    ['winamp', 11, 'Winamp', 'Pixelify Sans'], ['dos', 12, 'DOS-терминал', 'Pixelify Sans'],
    ['swiss', 13, 'Швейцарский стиль', 'Golos Text'], ['hud8', 14, '8-бит HUD', 'Tiny5'],
    ['synth', 15, 'Синтвейв', 'Russo One'], ['paper', 16, 'Газета', 'Playfair Display'],
    ['polaroid', 17, 'Полароид', 'Caveat'], ['code', 18, 'Код (JSON)', 'JetBrains Mono'],
    ['cassette', 19, 'Кассета', 'PT Mono'], ['vu', 20, 'VU-метр', 'IBM Plex Mono'],
    ['neon', 21, 'Неоновая вывеска', 'Pacifico'], ['film', 22, 'Киноплёнка', 'Oswald'],
    ['citypop', 23, 'Сити-поп', 'Noto Serif JP'], ['popart', 25, 'Поп-арт комикс', 'Dela Gothic One'],
    ['blueprint', 26, 'Чертёж', 'IBM Plex Mono'], ['radar', 27, 'Радар HUD', 'Tektur']
  ].map(function (s) {
    var feat = s[0] === 'code'
      ? ['cover', 'prog', 'marq']
      : ['cover', 'time', 'prog', 'osc', 'marq', 'lang', 'count', 'fade', 'fill', 'nums'];
    return { id: s[0], num: s[1], name: s[2], font: s[3], color: '#FFFFFF', vizColor: '#C8F542',
      features: feat, vizKind: s[0] === 'code' ? null : 'spectrum' };
  });

  var CFG = {
    style: 'dos', pos: 'br', dx: 0, dy: 0, size: 100, color: '#FFFFFF', vizColor: '#C8F542',
    outline: true, nick: true, count: 3, fade: true, fadePct: 100, fill: true, nums: true,
    cover: true, time: true, spin: true, osc: true, prog: true, marq: true, lang: 'en',
    viz: 'wave', smooth: 'mid', swap: true,
    motion: {
      style: 'dos', pos: 'bc', dx: 0, dy: 0, size: 100, color: '#FFFFFF', vizColor: '#C8F542',
      outline: true, nick: true, scene: 'brand', hold: 5, cover: true, time: true, spin: true,
      prog: true, osc: true, marq: true, lang: 'en', viz: 'wave', smooth: 'mid'
    }
  };
  function base() { return location.protocol === 'http:' && location.port ? 'http://localhost:' + location.port : ''; }

  A.modStatus = function () {
    return P({
      installed: true, running: true, error: null,
      manifest: { id: 'streamer-pack', version: '0.5.0', minCore: '0.36.0', modules: [{ id: 'overlay', name: 'Оверлей-плейлист' }] },
      dev: false, prev: null, server: false, keyMask: '',
      license: { enabled: true, state: 'full' },
      modules: { overlay: { name: 'Оверлей-плейлист', running: true, error: null } }
    });
  };
  A.onModStatus = function () {};
  A.modCmd = function (mod, cmd, arg) {
    if (mod !== 'overlay') return P({});
    if (cmd === 'settings') return P(JSON.parse(JSON.stringify(CFG)));
    if (cmd === 'status') {
      return P({ obs: 2, clients: 2, url: base() + '/overlay/playlist',
        motionUrl: base() + '/overlay/motion', motionObs: 1 });
    }
    if (cmd === 'styles') return P(JSON.parse(JSON.stringify(STYLES)));
    if (cmd === 'save') {
      Object.keys(arg || {}).forEach(function (k) {
        if (k === 'motion') CFG.motion = Object.assign({}, CFG.motion, arg.motion);
        else CFG[k] = arg[k];
      });
      return P(JSON.parse(JSON.stringify(CFG)));
    }
    if (cmd === 'preview-motion') return P({ ok: true });
    return P({});
  };
  A.onModPlayerWant = function () {};
  A.modPlayer = function () {};
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: function () { return Promise.resolve(); } }
    });
  } catch (e) { /* не критично */ }
})();
