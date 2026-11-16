// Темы оформления: из 5 основных цветов (режим, фон, текст, акцент, главная кнопка) строим все ~20 оттенков интерфейса.
// Считаем в OKLCH — там «светлее/темнее» выглядит для глаза ровно. Следим за контрастом текста.
// Работает в окне Тапёра (window.TapTheme) и в Node (для проверок).
(function (root) {
  // ---- цвет: hex ↔ OKLCH ----
  function hex2rgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h, 16); if (isNaN(n) || h.length !== 6) return null; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  // Цвет в формате #RRGGBB или #RGB → #RRGGBB (верхний регистр); всё остальное — null.
  function normHex(x) {
    var s = String(x == null ? '' : x).trim().replace(/^#/, '');
    if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return null;
    if (s.length === 3) s = s.split('').map(function (c) { return c + c; }).join('');
    return '#' + s.toUpperCase();
  }
  function rgb2hex(r) { return '#' + r.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); }
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function unlin(c) { return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }
  function rgb2oklch(rgb) {
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    var C = Math.sqrt(A * A + B * B), H = Math.atan2(B, A) * 180 / Math.PI; if (H < 0) H += 360;
    return { l: L, c: C, h: H };
  }
  function oklch2rgbRaw(o) {
    var a = o.c * Math.cos(o.h * Math.PI / 180), b = o.c * Math.sin(o.h * Math.PI / 180);
    var l = Math.pow(o.l + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(o.l - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(o.l - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  function inGamut(o) { var r = oklch2rgbRaw(o); return r.every(function (v) { return v >= -0.0005 && v <= 1.0005; }); }
  // Если цвет не помещается в экран — уменьшаем насыщенность, сохраняя яркость и тон
  function oklch2hex(o) {
    o = { l: Math.max(0, Math.min(1, o.l)), c: Math.max(0, o.c), h: o.h };
    if (!inGamut(o)) { var lo = 0, hi = o.c; for (var i = 0; i < 18; i++) { var mid = (lo + hi) / 2; if (inGamut({ l: o.l, c: mid, h: o.h })) lo = mid; else hi = mid; } o.c = lo; }
    return rgb2hex(oklch2rgbRaw(o).map(unlin));
  }
  function ok(hex) { return rgb2oklch(hex2rgb(hex) || [0, 0, 0]); }
  function lum(hex) { var r = hex2rgb(hex) || [0, 0, 0]; return 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) { var x = ok(a), y = ok(b); var hx = x.c < 0.02 ? y.h : x.h, hy = y.c < 0.02 ? x.h : y.h; var dh = ((hy - hx + 540) % 360) - 180; return oklch2hex({ l: x.l + (y.l - x.l) * t, c: x.c + (y.c - x.c) * t, h: hx + dh * t }); }
  function shift(hex, dl, cmul) { var o = ok(hex); return oklch2hex({ l: o.l + dl, c: o.c * (cmul == null ? 1 : cmul), h: o.h }); }
  // Подвинуть яркость, пока контраст с фоном не станет нужным
  function ensure(fg, bg, need, dark) {
    var o = ok(fg), k = 0;
    while (contrast(oklch2hex(o), bg) < need && k++ < 60) o.l += dark ? 0.012 : -0.012;
    return oklch2hex(o);
  }

  // ---- из основных цветов — все переменные интерфейса ----
  // t: { mode:'dark'|'light', bg, text, accent, primary, contrast:0..100 }
  function build(t) {
    var dark = t.mode !== 'light', k = 0.55 + (Math.max(0, Math.min(100, t.contrast == null ? 50 : t.contrast)) / 100) * 0.9; // шаги между уровнями
    // Битый или пустой цвет заменяем запасным, а не отдаём в CSS как есть.
    var bgHex = normHex(t.bg) || (dark ? '#15161C' : '#F5F5F7');
    var textHex = normHex(t.text) || (dark ? '#ECEDF2' : '#15161C');
    var accentHex = normHex(t.accent) || (dark ? '#9B87FF' : '#476BD7');
    var primaryHex = normHex(t.primary) || accentHex;
    var b = ok(bgHex);
    var L = function (d, cm) { return oklch2hex({ l: b.l + d * k, c: b.c * (cm == null ? 1 : cm), h: b.h }); };
    var v = {};
    if (dark) {
      v.bg00 = L(-0.045, 0.9); v.bg0 = L(-0.028, 0.95); v.bg1 = bgHex; v.bg2 = L(0.016); v.bg3 = L(0.04, 1.05); v.bg4 = L(0.085, 1.05);
      v.ln = L(0.1, 1.05); v.ln2 = L(0.055); v.ln3 = L(0.16, 1.05);
    } else {
      v.bg00 = L(-0.075); v.bg0 = L(-0.035); v.bg1 = bgHex; v.bg2 = oklch2hex({ l: Math.min(0.995, b.l + 0.02), c: b.c * 0.6, h: b.h }); v.bg3 = L(-0.05); v.bg4 = L(-0.1);
      v.ln = L(-0.13); v.ln2 = L(-0.075); v.ln3 = L(-0.22);
    }
    var tx = ensure(textHex, v.bg1, 4.5 + 3 * (k - 0.55) / 0.9 + 3, dark);
    v.tx = tx;
    v.tx2 = ensure(mix(tx, v.bg1, 0.16 / k), v.bg1, 7, dark);
    v.tx3 = ensure(mix(tx, v.bg1, 0.34 / k), v.bg1, 4.6, dark);
    v.tx4 = ensure(mix(tx, v.bg1, 0.44 / k), v.bg1, 3.4, dark);
    v.tx5 = ensure(mix(tx, v.bg1, 0.52 / k), v.bg1, 2.8, dark);
    var ac = ensure(accentHex, v.bg1, 3, dark);
    v.ac = ac; v.ac2 = shift(ac, dark ? 0.09 : -0.08, 0.85);
    var r = hex2rgb(ac); v.acr = r.join(',');
    v.acbg = mix(v.bg1, ac, dark ? 0.16 : 0.12);
    v.pri = primaryHex; v.prit = contrast('#FFFFFF', primaryHex) >= contrast('#111111', primaryHex) ? '#FFFFFF' : '#111111';
    return v;
  }

  // ---- встроенные темы: четыре основы, каждая тёмная и светлая (всего 8) ----
  // Цвета заданы так же, как пользователь задаёт свою тему: фон, текст, акцент, главная кнопка.
  // Светлую версию строит тот же flipMode, что и переключатель «Светлая» в редакторе.
  var BUILTIN_BASE = [
    { id: 'dark', name: 'Графит', bg: '#272727', text: '#E7F0F5', accent: '#D17834', primary: '#7180AC', contrast: 50 },
    { id: 'mono', name: 'Монохром', bg: '#161616', text: '#EDEDED', accent: '#D4D4D4', primary: '#E8E8E8', contrast: 50 },
    { id: 'winter', name: 'Зима близко', bg: '#0E121A', text: '#222831', accent: '#343433', primary: '#B2CAFF', contrast: 50 },
    { id: 'magenta', name: 'Маджента', bg: '#272727', text: '#E7F0F5', accent: '#C7296B', primary: '#7A7A7A', contrast: 54 }
  ];
  // Тёмная ↔ светлая: тон и характер цветов те же, яркость — наоборот
  function flipMode(t, mode) {
    var light = mode === 'light', o = ok, mk = oklch2hex;
    var b = o(t.bg), x = o(t.text), a = o(t.accent), p = o(t.primary);
    return { mode: mode,
      bg: mk({ l: light ? 0.965 : 0.175, c: Math.min(b.c, light ? 0.014 : 0.03), h: b.h }),
      text: mk({ l: light ? 0.22 : 0.95, c: Math.min(x.c, 0.02), h: x.h }),
      accent: mk({ l: light ? Math.min(0.55, a.l) : Math.max(0.66, a.l), c: a.c, h: a.h }),
      primary: mk({ l: light ? Math.min(0.5, p.l) : Math.max(0.8, p.l), c: p.c, h: p.h }) };
  }
  function builtinThemeFrom(b, mode) {
    var f = mode === 'light' ? flipMode(b, 'light') : b;
    return { id: b.id + (mode === 'light' ? '-l' : ''), baseId: b.id, name: b.name, sub: mode === 'light' ? 'светлая' : 'тёмная',
      mode: mode === 'light' ? 'light' : 'dark', bg: f.bg, text: f.text, accent: f.accent, primary: f.primary, contrast: b.contrast };
  }
  // Список встроенных: парами «тёмная — светлая»
  function builtinList() {
    var out = [];
    BUILTIN_BASE.forEach(function (b) { out.push(builtinThemeFrom(b, 'dark'), builtinThemeFrom(b, 'light')); });
    return out;
  }
  // Встроенная тема по id (dark, dark-l, winter…); чужая/удалённая — null.
  function builtinTheme(id) {
    for (var i = 0; i < BUILTIN_BASE.length; i++) {
      var b = BUILTIN_BASE[i];
      if (id === b.id) return builtinThemeFrom(b, 'dark');
      if (id === b.id + '-l') return builtinThemeFrom(b, 'light');
    }
    return null;
  }
  // Старые встроенные темы: «Фиолетовая» стала «Графитом», «Светлая» — светлым «Графитом».
  function migrateThemeId(id) {
    if (id === 'violet') return 'dark';
    if (id === 'light') return 'dark-l';
    return id;
  }

  // ---- направления для «Подобрать палитру» (свой генератор, без интернета) ----
  var TONES = {
    red: { h: 25, n: 'Красная' }, orange: { h: 55, n: 'Оранжевая' }, yellow: { h: 92, n: 'Жёлтая' }, green: { h: 150, n: 'Зелёная' },
    teal: { h: 190, n: 'Бирюзовая' }, blue: { h: 262, n: 'Синяя' }, violet: { h: 300, n: 'Фиолетовая' }, pink: { h: 350, n: 'Розовая' },
    warm: { h: 60, n: 'Тёплая', soft: true }, cold: { h: 235, n: 'Холодная', soft: true }, mono: { h: 0, n: 'Монохром', mono: true }
  };
  var CHARS = { tone: 'В тон', contrast: 'Контрастные', triad: 'Три цвета', near: 'Соседние' };
  function suggest(opt, seed) {
    var dark = opt.mode !== 'light', T = TONES[opt.tone] || TONES.violet, h = T.h, mono = !!T.mono;
    var ch = opt.chars || 'tone';
    var acH = h + ({ tone: 0, contrast: 180, triad: 120, near: 32 }[ch] || 0);
    var prH = h + ({ tone: 0, contrast: 0, triad: 240, near: -32 }[ch] || 0);
    var rnd = (function (x) { return function () { x = (x * 9301 + 49297) % 233280; return x / 233280; }; })(seed || 1);
    var out = [];
    // Каждый набор — свой: шесть вариантов расходятся веером по тону (в пределах выбранного характера),
    // а начало веера, насыщенность фона, яркость и сочность акцента — случайные от seed.
    var spread = { tone: 36, contrast: 50, triad: 44, near: 40 }[ch] || 36, phase = rnd();
    for (var i = 0; i < 6; i++) {
      var off = ((i + phase) / 6 - 0.5) * spread;                       // равномерно по вееру, со сдвигом
      var bc = (0.3 + rnd() * 1.3) * (T.soft ? 0.7 : 1) * (mono ? 0 : 1);
      var al = 0.62 + rnd() * 0.16, ac = (T.soft ? 0.07 : 0.12) + rnd() * (T.soft ? 0.05 : 0.08);
      var bgH = h + off * 0.6 + (rnd() - 0.5) * 20;
      var bg = dark ? oklch2hex({ l: 0.15 + rnd() * 0.06, c: 0.022 * bc, h: bgH }) : oklch2hex({ l: 0.95 + rnd() * 0.03, c: 0.012 * bc, h: bgH });
      var text = dark ? oklch2hex({ l: 0.95, c: mono ? 0 : 0.012, h: bgH }) : oklch2hex({ l: 0.22, c: mono ? 0 : 0.02, h: bgH });
      var accent = mono ? oklch2hex({ l: dark ? 0.7 + rnd() * 0.2 : 0.28 + rnd() * 0.15, c: 0, h: 0 }) : oklch2hex({ l: dark ? al : al - 0.16, c: ac, h: acH + off });
      var prJ = (rnd() - 0.5) * spread * 0.8;
      var primary = mono ? oklch2hex({ l: dark ? 0.86 + rnd() * 0.1 : 0.2 + rnd() * 0.12, c: 0, h: 0 })
        : (ch === 'tone' ? oklch2hex({ l: dark ? 0.8 + rnd() * 0.1 : 0.42 + rnd() * 0.08, c: (T.soft ? 0.06 : 0.09) + rnd() * 0.05, h: h + off + prJ })
          : oklch2hex({ l: dark ? 0.8 + rnd() * 0.08 : 0.46 + rnd() * 0.08, c: (T.soft ? 0.08 : 0.12) + rnd() * 0.05, h: prH + off + prJ }));
      out.push({ mode: dark ? 'dark' : 'light', bg: bg, text: text, accent: accent, primary: primary, contrast: 50, src: 'local' });
    }
    return out;
  }
  // Палитра из внешнего сервиса (The Color API): из 5 цветов — наши 4 основных
  function fromScheme(hexes, mode) {
    var dark = mode !== 'light';
    var list = (Array.isArray(hexes) ? hexes : []).map(function (x) {
      var h = normHex(x); return h ? { hex: h, o: ok(h) } : null;
    }).filter(Boolean);
    // Пустой или целиком битый ответ сервиса — запасная тема, а не падение.
    if (!list.length) {
      return dark
        ? { mode: 'dark', bg: '#15161C', text: '#ECEDF2', accent: '#9B87FF', primary: '#FFD43B', contrast: 50, src: 'api' }
        : { mode: 'light', bg: '#F5F5F7', text: '#15161C', accent: '#476BD7', primary: '#8B7CF6', contrast: 50, src: 'api' };
    }
    var bySat = list.slice().sort(function (a, b) { return b.o.c - a.o.c; });
    var acc = bySat[0], pri = bySat[1] || bySat[0];
    var base = list.slice().sort(function (a, b) { return dark ? a.o.l - b.o.l : b.o.l - a.o.l; })[0];
    var bg = oklch2hex({ l: dark ? 0.175 : 0.965, c: Math.min(base.o.c, dark ? 0.03 : 0.014), h: base.o.h });
    var text = oklch2hex({ l: dark ? 0.95 : 0.22, c: Math.min(0.015, base.o.c), h: base.o.h });
    var accent = oklch2hex({ l: dark ? Math.max(0.62, Math.min(0.78, acc.o.l)) : Math.min(0.55, acc.o.l), c: acc.o.c, h: acc.o.h });
    var primary = oklch2hex({ l: dark ? Math.max(0.78, pri.o.l) : Math.min(0.5, pri.o.l), c: pri.o.c, h: pri.o.h });
    return { mode: dark ? 'dark' : 'light', bg: bg, text: text, accent: accent, primary: primary, contrast: 50, src: 'api' };
  }

  // ---- код темы, чтобы делиться ----
  function encode(t) { return ['TAPYOR1', t.mode === 'light' ? 'l' : 'd', t.bg, t.text, t.accent, t.primary, t.contrast == null ? 50 : t.contrast, encodeURIComponent(t.name || '')].join(':').replace(/#/g, ''); }
  function decode(s) {
    var p = String(s || '').trim().split(':');
    if (p[0] !== 'TAPYOR1' || p.length < 7) return null;
    var hx = function (x) { return /^[0-9a-f]{6}$/i.test(x) ? '#' + x.toUpperCase() : null; };
    var t = { mode: p[1] === 'l' ? 'light' : 'dark', bg: hx(p[2]), text: hx(p[3]), accent: hx(p[4]), primary: hx(p[5]), contrast: Math.max(0, Math.min(100, parseInt(p[6], 10) || 50)), name: p[7] ? decodeURIComponent(p[7]).slice(0, 40) : '' };
    return t.bg && t.text && t.accent && t.primary ? t : null;
  }

  var api = { build: build, flipMode: flipMode, builtinList: builtinList, builtinTheme: builtinTheme, migrateThemeId: migrateThemeId,
    suggest: suggest, fromScheme: fromScheme, encode: encode, decode: decode, contrast: contrast, mix: mix, ok: ok, oklch2hex: oklch2hex, TONES: TONES, CHARS: CHARS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TapTheme = api;
})(this);
