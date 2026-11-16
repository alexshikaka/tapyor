  // ===== Темы оформления: 8 встроенных (парами «тёмная — светлая») и свои (редактор) =====
  var THEME_KEYS = ['bg00','bg0','bg1','bg2','bg3','bg4','ln','ln2','ln3','tx','tx2','tx3','tx4','tx5','ac','ac2','acr','acbg','pri','prit'];
  // P5c №9: цвета темы из настроек попадают в style="background:…" и data-col="…". Без проверки
  // строка вида `#fff" onmouseover="…` становится атрибутом — это DOM-XSS. Пропускаем только
  // реальные форматы (Тапёр строит темы в hex; rgb/oklch — на случай ручной темы), иначе — чёрный.
  // Регулярка внутри функции: иконки оболочки рисуются раньше, чем выполнится этот файл (одна склейка).
  function safeColor(c){
    var s = String(c == null ? '' : c).trim();
    return /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|oklch\(\s*[\d.]+%?\s+[\d.]+%?\s+[\d.]+(?:deg)?(?:\s*\/\s*[\d.]+%?)?\s*\))$/i.test(s) ? s : '#000000';
  }
  var myThemes = [], curThemeId = 'dark';
  var TE = { open: false, tone: 'violet', chars: 'tone', pmode: 'dark', variants: [], loading: false, saveT: null };
  // Встроенные темы — данные и алгоритм «Светлая» живут в theme.js (ими же пользуется визард).
  var BUILTIN = (window.TapTheme && TapTheme.builtinList) ? TapTheme.builtinList() : [];
  var flipMode = TapTheme.flipMode;
  var THEME_LABEL_SUB = function (mode){ return mode === 'light' ? 'светлая' : 'тёмная'; };
  function clearCustomVars(){ var d = document.documentElement; THEME_KEYS.forEach(function (k){ d.style.removeProperty('--' + k); }); d.classList.remove('theme-custom', 'theme-light', 'theme-light-default'); }
  function themeById(id){ return myThemes.find(function (t){ return 'c:' + t.id === id; }) || null; }
  // Применить тему; save — запомнить выбор
  function applyTheme(id, save){
    // Тема и оболочка взаимоисключающие. Если тему включают поверх оболочки, оболочка
    // снимается — и это надо СОХРАНИТЬ, иначе после перезапуска она вернётся, хотя на экране
    // её уже не было (функц. аудит 01.11). Через интерфейс это сейчас недостижимо — список
    // тем при оболочке спрятан, — но держаться только на спрятанной кнопке нельзя.
    var hadSkin = (typeof curSkin === 'string') ? curSkin : '';
    clearSkinClass();
    var d = document.documentElement, t = id && id.indexOf('c:') === 0 ? themeById(id) : null;
    if (id && id.indexOf('c:') === 0 && !t) id = 'dark';
    // Миграция старых встроенных: «Фиолетовая» → «Графит», «Светлая» → светлый «Графит».
    var raw = id, mig = TapTheme.migrateThemeId(id);
    if (mig !== raw) id = mig;
    var bt = !t ? TapTheme.builtinTheme(id) : null;
    if (!t && !bt) { id = 'dark'; bt = TapTheme.builtinTheme('dark'); }
    curThemeId = id;
    clearCustomVars();
    d.classList.toggle('theme-dark', id === 'dark');
    d.classList.toggle('theme-mono', id === 'mono');
    var v = t ? TapTheme.build(t) : (bt && id !== 'dark' && id !== 'mono' ? TapTheme.build(bt) : null);
    var light = !!(t ? t.mode === 'light' : (bt && bt.mode === 'light'));
    var bar = null;
    if (v) {
      d.classList.add('theme-custom'); d.classList.toggle('theme-light', light);
      THEME_KEYS.forEach(function (k){ d.style.setProperty('--' + k, v[k]); });
      try { localStorage.setItem('tapThemeVars', JSON.stringify(Object.assign({ _light: light }, v))); } catch (e) { console.warn('Тапёр: не сохранились переменные темы', e); }
      bar = { bg: v.bg1, sym: v.tx2 };
    }
    try { localStorage.setItem('tapTheme', id); } catch (e) { console.warn('Тапёр: не сохранилась тема', e); }
    // Миграцию тоже запоминаем: иначе при каждом запуске старый id пришлось бы переводить заново.
    if (A.setSetting && (save || mig !== raw)) { if (bar) A.setSetting('themeBar', bar); A.setSetting('theme', id); }
    if (hadSkin && save) {
      try { localStorage.setItem('tapSkin', ''); } catch (e) { console.warn('Тапёр: не сохранилась оболочка', e); }
      if (A.setSetting) A.setSetting('skin', '');
    }
    if (typeof syncLookClasses === 'function') syncLookClasses();
    // Иконка «Стандарт» показывает цвета текущей темы — обновляем и её.
    if (typeof renderSkinList === 'function') renderSkinList();
    renderThemeList();
  }
  // Иконка темы — мини-окно по макету: название, подпись «тёмная/светлая» и подвал плеера.
  // Функция одна для Настроек и визарда; на элементе — data-theme.
  function themeIcon(t, selected){
    var v = TapTheme.build(t), sub = t.sub || THEME_LABEL_SUB(t.mode);
    return lookIconHtml({
      cls: 'te-c', selected: !!selected,
      attrs: ' data-th="' + esc(t.id) + '" data-theme="' + esc(t.id) + '"',
      label: (t.name || 'Моя тема') + ', ' + sub,
      name: t.name || 'Моя тема', sub: sub,
      pal: { bg: v.bg1, panel: v.bg2, text: v.tx, sub: v.tx3, accent: v.ac, button: v.pri, btnTx: v.prit, line: v.ln },
      font: LOOK_FONT_STD, sq: false
    });
  }
  function renderThemeList(){
    var box = $('teList'); if (!box) return;
    var h = BUILTIN.map(function (x){ return themeIcon(x, curThemeId === x.id); }).join('');
    h += myThemes.map(function (t){
      // Сначала данные темы, потом наши id/подписи: иначе t.id («evil») затрёт «c:evil».
      var o = Object.assign({}, t, { id: 'c:' + t.id, name: t.name || 'Моя тема', sub: 'моя · ' + THEME_LABEL_SUB(t.mode) });
      return themeIcon(o, curThemeId === 'c:' + t.id);
    }).join('');
    // Своих тем нет — кнопка мягко пульсирует акцентом, зовёт попробовать (15.11.2026, слово владельца)
    h += '<button class="te-c add' + (myThemes.length ? '' : ' te-pulse') + '" data-th-new="1"' + (myThemes.length ? '' : ' data-anim') + '>＋ Создать тему</button>';  // код темы убран 26.10 (решение владельца)
    box.innerHTML = h;
    var t = themeById(curThemeId);
    if (t) renderEditor(t); else { var ed = $('teEd'); if (ed) { ed.hidden = true; ed.innerHTML = ''; } }
  }
  function saveThemes(){ clearTimeout(TE.saveT); TE.saveT = setTimeout(function(){ if (A.setSetting) A.setSetting('themes', myThemes); }, 300); }
  function newTheme(base, name){
    var t = Object.assign({ id: Date.now().toString(36) + Math.floor(Math.random() * 1000), name: name || ('Моя тема ' + (myThemes.length + 1)) }, base);
    myThemes.push(t); saveThemes(); applyTheme('c:' + t.id, true);
    setTimeout(function(){ var e = $('teEd'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    return t;
  }
  function currentBase(){
    var t = themeById(curThemeId);
    if (t) return { mode: t.mode, bg: t.bg, text: t.text, accent: t.accent, primary: t.primary, contrast: t.contrast };
    var b = TapTheme.builtinTheme(curThemeId) || TapTheme.builtinTheme('dark');
    return { mode: b.mode, bg: b.bg, text: b.text, accent: b.accent, primary: b.primary, contrast: b.contrast };
  }
  function updTheme(t, patch){ Object.assign(t, patch); saveThemes(); applyTheme('c:' + t.id, true); }
  var TE_COLORS = [['bg', 'Фон'], ['text', 'Текст'], ['accent', 'Акцент'], ['primary', 'Главная кнопка']];
  function renderEditor(t){
    var ed = $('teEd'); if (!ed) return;
    ed.hidden = false;
    var keepScroll = ed.contains(document.activeElement) ? document.activeElement.id : '';
    var h = '<div><h4>Основные цвета</h4>' +
      '<div class="te-row"><span>Название</span><input class="te-name" id="teName" maxlength="40" value="' + esc(t.name || '') + '"></div>' +
      '<div class="te-row"><span>Основа</span><div class="te-seg" id="teMode"><button data-v="dark"' + (t.mode !== 'light' ? ' class="on"' : '') + '>Тёмная</button><button data-v="light"' + (t.mode === 'light' ? ' class="on"' : '') + '>Светлая</button></div></div>';
    TE_COLORS.forEach(function (c){
      h += '<div class="te-row"><span>' + c[1] + '</span>' +
        '<button class="te-sw" type="button" data-tcopen="' + c[0] + '" style="background:' + safeColor(t[c[0]]) + '" title="Выбрать цвет" aria-label="' + c[1] + '"></button>' +
        '<input type="color" data-tc="' + c[0] + '" value="' + safeColor(t[c[0]]) + '" hidden>' +
        '<input class="te-hex" data-th="' + c[0] + '" id="teHex_' + c[0] + '" value="' + safeColor(t[c[0]]) + '" maxlength="7" spellcheck="false"></div>';
    });
    h += '<div class="te-row"><span>Контраст</span><input class="te-rng" id="teContrast" type="range" min="0" max="100" value="' + (t.contrast == null ? 50 : t.contrast) + '"><span id="teCv" style="width:70px;color:var(--tx4)">' + contrastWord(t.contrast) + '</span></div>' +
      '<div class="te-note">Остальные ~20 оттенков (колонки, рамки, подсказки, наведение) Тапёр строит сам и следит, чтобы текст читался.</div>' +
      '<h4 style="margin-top:18px">Подобрать палитру</h4>' +
      '<div class="te-row"><span>Основа</span><div class="te-seg" id="tePMode"><button data-v="dark"' + (TE.pmode === 'dark' ? ' class="on"' : '') + '>Тёмная</button><button data-v="light"' + (TE.pmode === 'light' ? ' class="on"' : '') + '>Светлая</button></div></div>' +
      '<div style="font-size:12px;color:var(--tx3)">Тон</div><div class="tones" id="teTones">' + Object.keys(TapTheme.TONES).map(function (k){
        var T = TapTheme.TONES[k], col = T.mono ? '#9A9A9A' : TapTheme.oklch2hex({ l: 0.65, c: T.soft ? 0.08 : 0.16, h: T.h });
        return '<button class="tone' + (TE.tone === k ? ' on' : '') + '" data-tone="' + k + '"><i style="background:' + col + '"></i>' + T.n + '</button>';
      }).join('') + '</div>' +
      '<div class="te-row"><span>Акценты</span><div class="te-seg" id="teChars">' + Object.keys(TapTheme.CHARS).map(function (k){ return '<button data-v="' + k + '"' + (TE.chars === k ? ' class="on"' : '') + '>' + TapTheme.CHARS[k] + '</button>'; }).join('') + '</div></div>' +
      '<div class="tvars" id="teVars">' + (TE.variants.length ? TE.variants.map(function (v, i){ return '<button class="tvar" data-var="' + i + '"><div class="p">' + [v.bg, TapTheme.build(v).bg3, v.accent, v.primary].map(function (c){ return '<i style="background:' + safeColor(c) + '"></i>'; }).join('') + '</div><small>' + (v.src === 'api' ? 'The Color API' : 'свой генератор') + '</small></button>'; }).join('') : '') + '</div>' +
      (TE.loading ? '<div class="te-note">Подбираю варианты…</div>' : (!TE.variants.length ? '<div class="te-note">Выбери тон — сразу появятся 6 вариантов; «Ещё варианты» — новый набор. Нажми на вариант — он применится к этой теме.</div>' : '')) +
      '<div class="te-f"><button class="pbtn y" id="tePick">' + (TE.variants.length ? 'Ещё варианты' : 'Подобрать') + '</button></div>' +
      '</div><div class="te-side"><h4>Как будет выглядеть</h4>' +  // во вкладке «Оформление» сверху скрыт (app.css)
      '<div class="pv"><div class="hd"><b style="font-size:12px">Тапёр</b><span>версия 0.15</span></div><div class="bd">' +
        '<div class="rw on"><i class="cv"></i><div><div class="t">Группа крови</div><div class="s">Кино · Яндекс</div></div><span class="q">+ В очередь</span></div>' +
        '<div class="rw"><i class="cv"></i><div><div class="t">Кукушка</div><div class="s">Кино · YouTube</div></div></div>' +
        '<div class="bt"><span style="background:var(--pri);color:var(--prit)">▶ Играть фоном</span><span style="border:1px solid var(--ln);color:var(--tx2)">Фоном вперемешку</span><i class="tg"></i></div>' +
        '<div style="font-size:10.5px;color:var(--tx4);margin-top:4px">Сейчас играет · <span style="color:var(--ac2)">в эфире</span></div></div></div>' +
      '<div class="te-note">Всё приложение перекрашивается сразу и тема сохраняется сама.</div>' +
      '<div class="te-f"><button class="pbtn g" id="teDup">Копия</button><button class="pbtn g danger" id="teDel">Удалить</button></div>' +
      '</div>';
    ed.innerHTML = h;
    if (keepScroll && $(keepScroll)) { var f = $(keepScroll); f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) {} }
  }
  function contrastWord(c){ c = c == null ? 50 : c; return c < 30 ? 'мягкий' : (c < 70 ? 'средний' : 'высокий'); }
  async function pickVariants(t){
    var my = TE.req = (TE.req || 0) + 1;                       // нажали быстрее, чем ответил сервис — берём последний
    TE.loading = true; TE.variants = []; renderEditor(t);
    var seed = Math.floor(Math.random() * 100000);
    var local = TapTheme.suggest({ mode: TE.pmode, tone: TE.tone, chars: TE.chars }, seed);
    var T = TapTheme.TONES[TE.tone], api = [];
    if (A.paletteApi) {
      // каждый раз — другая отправная точка: сдвиг тона и яркости, иначе сервис отвечает одно и то же
      var hex = T.mono ? TapTheme.oklch2hex({ l: 0.4 + Math.random() * 0.3, c: 0, h: 0 }) : TapTheme.oklch2hex({ l: 0.5 + Math.random() * 0.22, c: (T.soft ? 0.06 : 0.12) + Math.random() * 0.06, h: T.h + (Math.random() - 0.5) * 50 });
      var modes = T.mono ? ['monochrome', 'monochrome-dark', 'monochrome-light'] : ({ tone: [TE.pmode === 'light' ? 'monochrome-light' : 'monochrome-dark', 'monochrome', 'analogic'], contrast: ['complement', 'analogic-complement', 'complement'], triad: ['triad', 'triad', 'quad'], near: ['analogic', 'analogic', 'monochrome'] }[TE.chars]);
      var res = await Promise.all(modes.map(function (m){ return A.paletteApi(hex.replace('#', ''), m).catch(function(){ return null; }); }));
      res.forEach(function (r){ if (r && r.colors && r.colors.length >= 3) api.push(TapTheme.fromScheme(r.colors, TE.pmode)); });
    }
    if (my !== TE.req) return;
    TE.variants = local.slice(0, api.length ? 3 : 6).concat(api.slice(0, 3));
    TE.loading = false;
    if (themeById(curThemeId) === t) renderEditor(t);
  }
  // События списка тем
  $('teList').addEventListener('click', async function(e){
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.th) { applyTheme(b.dataset.th, true); return; }
    if (b.dataset.thNew) { newTheme(currentBase()); return; }
  });
  // События редактора
// ===== Современное окно выбора цвета =====
// Системный диалог Electron рисует лупу только внутри окна, поэтому цвета выбираем своим окном.
// COL.start — цвет на момент открытия: по «Отмене» и Esc возвращаем именно его.
var COL = { key: null, h: 0, s: 0, v: 0, drag: false, onPick: null, onClose: null, start: null };
var COL_PIP = false;   // пипетка уже работает — второй запуск не нужен

function colRgb(hex){
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function colHex(r, g, b){
  return '#' + [r, g, b].map(function(v){ var s = Math.max(0, Math.min(255, Math.round(v))).toString(16).toUpperCase(); return s.length === 1 ? '0' + s : s; }).join('');
}
function rgb2hsv(r, g, b){
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h: h, s: mx ? d / mx : 0, v: mx };
}
function hsv2rgb(h, s, v){
  h = ((h % 360) + 360) % 360;
  var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function colDrawSV(){
  var cv = $('colSV'); if (!cv) return;
  var g = cv.getContext('2d'), w = cv.width, hh = cv.height;
  var base = hsv2rgb(COL.h, 1, 1);
  g.fillStyle = colHex(base.r, base.g, base.b); g.fillRect(0, 0, w, hh);
  var gx = g.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gx; g.fillRect(0, 0, w, hh);
  var gy = g.createLinearGradient(0, 0, 0, hh);
  gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gy; g.fillRect(0, 0, w, hh);
  var mk = $('colMark');
  if (mk) { mk.style.left = (COL.s * w) + 'px'; mk.style.top = ((1 - COL.v) * hh) + 'px'; }
}

function colSet(hex, silent, init){
  var rgb = colRgb(hex);
  COL.h = COL.v === 0 || COL.s === 0 ? COL.h : rgb2hsv(rgb.r, rgb.g, rgb.b).h;
  var hsv = rgb2hsv(rgb.r, rgb.g, rgb.b);
  COL.h = hsv.h; COL.s = hsv.s; COL.v = hsv.v;
  var hx = colHex(rgb.r, rgb.g, rgb.b);
  if ($('colHex')) $('colHex').value = hx;
  if ($('colR')) $('colR').value = Math.round(rgb.r);
  if ($('colG')) $('colG').value = Math.round(rgb.g);
  if ($('colB')) $('colB').value = Math.round(rgb.b);
  if ($('colHue')) $('colHue').value = Math.round(COL.h);
  colDrawSV();
  if (!init) { if (COL.onPick) COL.onPick(hx); else if (COL.key) colApply(hx, silent); }
}

function colApply(hex, silent){
  if (COL.onPick) { if ($('colHex')) $('colHex').value = hex; COL.onPick(hex); return; }
  if (!COL.key) return;
  var inp = document.querySelector('[data-tc="' + COL.key + '"]');
  if (inp.value.toUpperCase() !== hex.toUpperCase()) {
    inp.value = hex;
    if (!silent) inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  var sw = document.querySelector('[data-tcopen="' + COL.key + '"]');
  if (sw) sw.style.background = hex;
}

function colOpen(key){
  var inp = document.querySelector('[data-tc="' + key + '"]');
  if (!inp) return;
  var label = { bg: 'Фон', text: 'Текст', accent: 'Акцент', primary: 'Главная кнопка' };
  colOpenFor('Цвет: ' + (label[key] || key), inp.value || '#000000', function (hex){
    if (inp.value.toUpperCase() !== hex.toUpperCase()) {
      inp.value = hex;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var sw = document.querySelector('[data-tcopen="' + key + '"]');
    if (sw) sw.style.background = hex;
  });
}

// Универсальное открытие окна цвета: заголовок, начальный цвет и обработчик выбора
function colOpenFor(title, hex, onPick, onClose){
  colBind();
  COL.key = null;
  COL.onPick = onPick || null;
  COL.onClose = onClose || null;
  COL.start = null;
  if ($('colTitle')) $('colTitle').textContent = title || 'Цвет';
  var box = $('colv');
  if (!box) return;
  box.hidden = false;
  colSet(hex || '#000000', true, true);
  COL.start = ($('colHex') && $('colHex').value) || '';   // к чему вернуться по «Отмене»
  var inp = $('colHex'); if (inp) setTimeout(function(){ inp.focus(); inp.select(); }, 60);
  colPresets();
}

function colClose(){
  var box = $('colv'); if (box) box.hidden = true;
  COL.key = null; COL.start = null;
  var cb = COL.onClose; COL.onPick = null; COL.onClose = null;
  if (typeof cb === 'function') try { cb(); } catch (e) {}
}

// «Отмена» и Esc: возвращаем цвет, который был при открытии, и закрываем окно
function colCancel(){
  var pick = COL.onPick, start = COL.start;
  if (start) colSet(start, true, true);   // окно снова показывает прежний цвет
  if (typeof pick === 'function' && start) { try { pick(start); } catch (e) {} }
  colClose();
}

// Пипетка — одна на весь интерфейс. Пока она работает, повторный вызов ничего не делает,
// а кнопка выглядит нажатой и недоступной. Ошибка или null — цвет не меняется.
function colPipette(){
  if (COL_PIP || !A.pickColor) return Promise.resolve(null);
  COL_PIP = true;
  var btn = $('colPip');
  if (btn) { btn.disabled = true; btn.classList.add('on'); btn.setAttribute('aria-busy', 'true'); }
  var done = function (col){
    COL_PIP = false;
    var b = $('colPip');
    if (b) { b.disabled = false; b.classList.remove('on'); b.removeAttribute('aria-busy'); }
    return col || null;
  };
  return Promise.resolve().then(function (){ return A.pickColor(); }).then(function (col){
    if (col) colSet(col);
    return done(col);
  }, function (){ return done(null); });
}

function colPresets(){
  var box = $('colPresets'); if (!box) return;
  var t = curThemeId ? themeById(curThemeId) : null;
  var list = [];
  if (t) list = list.concat([t.bg, t.text, t.accent, t.primary].filter(Boolean));
  list = list.concat(['#0E0F13', '#15161C', '#1D1F26', '#272A33', '#FFFFFF', '#ECEDF2', '#9B87FF', '#284CB8', '#FFD43B', '#4ADE9A', '#FF5A52', '#16B1F3']);
  list = list.filter(function(v, i){ return v && list.indexOf(v) === i; }).slice(0, 16);
  box.innerHTML = list.map(function(c){ var col = safeColor(c); return '<button type="button" data-col="' + col + '" style="background:' + col + '" title="' + col + '"></button>'; }).join('');
}

function colBind(){ if (COL.bound) return; COL.bound = true;
$('colv') && ($('colv').onclick = function(e){ if (e.target === $('colv')) colClose(); });
$('colClose') && ($('colClose').onclick = colClose);
$('colDone') && ($('colDone').onclick = colClose);
$('colCancel') && ($('colCancel').onclick = colCancel);
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && $('colv') && !$('colv').hidden) colCancel(); });

$('colHue') && ($('colHue').oninput = function(){
  COL.h = +this.value; colDrawSV();
  var rgb = hsv2rgb(COL.h, COL.s, COL.v); colApply(colHex(rgb.r, rgb.g, rgb.b));
});

$('colHex') && ($('colHex').onchange = function(){
  var v = this.value.trim(); if (!/^#?[0-9a-f]{6}$/i.test(v)) { var rgb0 = hsv2rgb(COL.h, COL.s, COL.v); this.value = colHex(rgb0.r, rgb0.g, rgb0.b); return; }
  v = '#' + v.replace('#', '').toUpperCase(); colSet(v);
});
['colR', 'colG', 'colB'].forEach(function(id){
  var el = $(id); if (!el) return;
  el.oninput = function(){
    var hex = colHex(+$('colR').value || 0, +$('colG').value || 0, +$('colB').value || 0);
    COL.h = rgb2hsv(+$('colR').value || 0, +$('colG').value || 0, +$('colB').value || 0).h;
    $('colHex').value = hex; colApply(hex);
  };
});

$('colPresets') && ($('colPresets').onclick = function(e){
  var b = e.target.closest('[data-col]'); if (!b) return;
  colSet(b.dataset.col);
});

$('colPip') && ($('colPip').onclick = function(){ colPipette(); });

(function(){
  var cv = $('colSV'); if (!cv) return;
  function pick(e){
    var r = cv.getBoundingClientRect();
    COL.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    COL.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    colDrawSV();
    var rgb = hsv2rgb(COL.h, COL.s, COL.v);
    var hex = colHex(rgb.r, rgb.g, rgb.b);
    $('colHex').value = hex; $('colR').value = Math.round(rgb.r); $('colG').value = Math.round(rgb.g); $('colB').value = Math.round(rgb.b);
    colApply(hex);
  }
  cv.addEventListener('pointerdown', function(e){ COL.drag = true; try { cv.setPointerCapture(e.pointerId); } catch (err) {} pick(e); });
  cv.addEventListener('pointermove', function(e){ if (COL.drag) pick(e); });
  cv.addEventListener('pointerup', function(e){ COL.drag = false; });
  cv.addEventListener('pointercancel', function(){ COL.drag = false; });
})();
}

// Клик по кружку открывает наше окно
$('teEd').addEventListener('click', function(e){
  var sw = e.target.closest('[data-tcopen]');
  if (!sw) return;
  e.preventDefault();
  colOpen(sw.dataset.tcopen);
});
// Пипетка в строках редактора убрана: она одна — в окне цвета (#colPip, colPipette).
document.addEventListener('DOMContentLoaded', colBind);
  $('teEd').addEventListener('input', function(e){
    var t = themeById(curThemeId); if (!t) return;
    var el = e.target;
    if (el.id === 'teName') { t.name = el.value.slice(0, 40); saveThemes(); var c = document.querySelector('#teList .te-c.on .look-win-name'); if (c) c.textContent = t.name || 'Моя тема'; return; }
    if (el.dataset.tc) { var p = {}; p[el.dataset.tc] = el.value.toUpperCase(); var hx = $('teHex_' + el.dataset.tc); if (hx) hx.value = p[el.dataset.tc]; liveTheme(t, p); return; }
    if (el.dataset.th) { var v = el.value.trim(); if (!/^#?[0-9a-f]{6}$/i.test(v)) return; v = '#' + v.replace('#', '').toUpperCase(); var p2 = {}; p2[el.dataset.th] = v; var cp = document.querySelector('#teEd [data-tc="' + el.dataset.th + '"]'); if (cp) cp.value = v; liveTheme(t, p2); return; }
    if (el.id === 'teContrast') { $('teCv').textContent = contrastWord(+el.value); liveTheme(t, { contrast: +el.value }); }
  });
  // Пока тянут ползунок или выбирают цвет — перекрашиваем без перерисовки редактора
  var liveT = null;
  function liveTheme(t, patch){
    Object.assign(t, patch);
    var d = document.documentElement, v = TapTheme.build(t);
    d.classList.add('theme-custom'); d.classList.toggle('theme-light', t.mode === 'light');
    THEME_KEYS.forEach(function (k){ d.style.setProperty('--' + k, v[k]); });
    clearTimeout(liveT); liveT = setTimeout(function(){ saveThemes(); applyThemeQuiet(t); }, 350);
  }
  function applyThemeQuiet(t){
    var v = TapTheme.build(t);
    try { localStorage.setItem('tapThemeVars', JSON.stringify(Object.assign({ _light: t.mode === 'light' }, v))); } catch (e) { console.warn('Тапёр: не сохранились переменные темы', e); }
    if (A.setSetting) { A.setSetting('themeBar', { bg: v.bg1, sym: v.tx2 }); A.setSetting('theme', 'c:' + t.id); }
    // Иконку текущей темы перекрашиваем на месте: перерисовка списка сбила бы фокус в редакторе.
    var cur = document.querySelector('#teList .te-c.on');
    var o = Object.assign({}, t, { id: 'c:' + t.id, name: t.name || 'Моя тема', sub: 'моя · ' + THEME_LABEL_SUB(t.mode) });
    if (cur) { var tmp = document.createElement('div'); tmp.innerHTML = themeIcon(o, true); if (tmp.firstChild) cur.parentNode.replaceChild(tmp.firstChild, cur); }
  }
  $('teEd').addEventListener('click', function(e){
    var t = themeById(curThemeId); if (!t) return;
    var b = e.target.closest('button'); if (!b) return;
    if (b.parentNode.id === 'teMode') { if (b.dataset.v !== (t.mode === 'light' ? 'light' : 'dark')) { TE.pmode = b.dataset.v; TE.variants = []; updTheme(t, flipMode(t, b.dataset.v)); } return; }
    // смена основы, тона или акцентов — сразу новые варианты
    if (b.parentNode.id === 'tePMode') { TE.pmode = b.dataset.v; pickVariants(t); return; }
    if (b.parentNode.id === 'teChars') { TE.chars = b.dataset.v; pickVariants(t); return; }
    if (b.dataset.tone) { TE.tone = b.dataset.tone; pickVariants(t); return; }
    if (b.dataset.var != null) { var v = TE.variants[+b.dataset.var]; if (v) updTheme(t, { mode: v.mode, bg: v.bg, text: v.text, accent: v.accent, primary: v.primary, contrast: v.contrast }); return; }
    if (b.id === 'tePick') { pickVariants(t); return; }
    if (b.id === 'teDup') { newTheme({ mode: t.mode, bg: t.bg, text: t.text, accent: t.accent, primary: t.primary, contrast: t.contrast }, (t.name || 'Тема') + ' (копия)'); return; }
    if (b.id === 'teDel') {
      var i = myThemes.indexOf(t); if (i < 0) return;
      myThemes.splice(i, 1); saveThemes(); applyTheme('dark', true);
      toast('Тема «' + (t.name || '') + '» удалена', 'Вернуть', function(){ myThemes.splice(i, 0, t); saveThemes(); applyTheme('c:' + t.id, true); });
    }
  });
  function themeLocal(){ try { return localStorage.getItem('tapTheme'); } catch (e) { return null; } }
  (async function(){
    var list = A.getSetting ? await A.getSetting('themes') : null;
    myThemes = Array.isArray(list) ? list.filter(function (t){ return t && t.id && t.bg; }) : [];
    var id = A.getSetting ? await A.getSetting('theme') : null;
    // Уже выбранная тема (localStorage) важнее новой темы по умолчанию: у старых профилей
    // настройка theme могла не сохраниться, если тему ни разу не переключали. Новый профиль
    // localStorage не имеет — ему достаётся «Графит».
    applyTheme(themeLocal() || id || 'dark', false);
    var sk = (A.getSetting ? await A.getSetting('skin') : '') || (function (){ try { return localStorage.getItem('tapSkin') || ''; } catch (e) { return ''; } })();
  var schemesRaw = (A.getSetting ? await A.getSetting('skinSchemes') : null) || (function (){ try { return JSON.parse(localStorage.getItem('tapSkinSchemes') || 'null'); } catch (e) { return null; } })();
  if (schemesRaw) loadSkinSchemes(schemesRaw);
    if (sk) applySkin(sk, false);
    var adj = (A.getSetting ? await A.getSetting('skinAdj') : null);
    if (!adj || typeof adj !== 'object') { try { adj = JSON.parse(localStorage.getItem('tapSkinAdj') || 'null'); } catch (e) { adj = null; } }
    applySkinAdj(adj || { b: 100, s: 100, c: 100 }, false);
    var fnt = (A.getSetting ? await A.getSetting('skinFont') : '') || (function (){ try { return localStorage.getItem('tapSkinFont') || ''; } catch (e) { return ''; } })();
    applySkinFont(fnt, false);
  })();
  function rankCtx(){ return { lcOn: true, ymFull: ymLoggedIn && ymPlus, ymOn: true, ytOn: ytUsable(), ytLogged: typeof ytLogged === 'function' && ytLogged(), scOn: SVC.scOn, auOn: SVC.auOn, order: srcOrder }; }

