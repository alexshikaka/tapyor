  // ===== Оболочки в стиле пиксель-арт =====
  // Список оболочек приходит из модуля (src/skins/skins-pack.js). Нет модуля — пустой
  // список: ядро обязано работать и без оболочек, только «Стандарт» с цветовой темой.
  var SKINS = (window.TapSkinPack && Array.isArray(window.TapSkinPack.skins)) ? window.TapSkinPack.skins : [];
  var curSkin = '', skinAdj = { b: 100, s: 100, c: 100 };
  // ── Цветовые схемы оболочек ────────────────────────────────────────────────
  // У каждой оболочки есть «основные цвета» (ядро) и 4 готовые схемы.
  // Меняешь любой основной цвет руками — схема становится «СВОЯ».
  // Из ядра выводятся все CSS-переменные оболочки (см. skinVarsFromCore).
  var SKIN_CORE = [
    { k: 'bg',      n: 'Фон' },
    { k: 'panel',   n: 'Панели' },
    { k: 'surface', n: 'Поверхности' },
    { k: 'line',    n: 'Границы' },
    { k: 'text',    n: 'Текст' },
    { k: 'accent',  n: 'Акцент' },
    { k: 'button',  n: 'Кнопки' }
  ];
  var SKIN_SCHEMES = (window.TapSkinPack && window.TapSkinPack.schemes && typeof window.TapSkinPack.schemes === 'object') ? window.TapSkinPack.schemes : {};
  var curSkinScheme = {};   // id оболочки → id схемы | 'custom'
  var curSkinCore = {};     // id оболочки → свои цвета (когда 'custom')
  function skinSchemeList(id){ return SKIN_SCHEMES[id] || []; }
  function skinSchemeById(id, sid){ var a = skinSchemeList(id); for (var i = 0; i < a.length; i++) if (a[i].id === sid) return a[i]; return null; }
  function skinCoreOf(id){
    if (curSkinCore[id]) return curSkinCore[id];
    var s = skinSchemeById(id, curSkinScheme[id]) || skinSchemeList(id)[0];
    return s ? s.core : null;
  }
  // ── Иконки оформления: одно мини-окно для тем и оболочек (им же пользуется визард) ──
  // По макету: название шрифтом оформления, снизу подвал плеера — назад / «играть» цветом
  // кнопок / вперёд и черта акцентом. Цвета — из палитры темы или оболочки (это данные).
  // Размеры названий на карточках оформления (крупнее с 15.11.2026 — слово владельца)
  var LOOK_FONT_STD = { f: "'Onest', 'Segoe UI', system-ui, sans-serif", s: '16px' };
  var LOOK_FONTS = {
    '': LOOK_FONT_STD,
    dos: { f: "'JetBrains Mono', ui-monospace, monospace", s: '15px' },
    crt: { f: "'Pixelify Sans', 'JetBrains Mono', monospace", s: '14px' },
    retro: { f: "Tahoma, 'Segoe UI', sans-serif", s: '15px' }
  };
  var LOOK_SVG_PREV = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h3v14H6zM20 5v14L9 12z"/></svg>';
  var LOOK_SVG_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 5h3v14h-3zM4 5v14l11-7z"/></svg>';
  var LOOK_SVG_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
  function lookBtnTx(hex){
    if (window.TapTheme && TapTheme.contrast) return TapTheme.contrast('#FFFFFF', hex) >= TapTheme.contrast('#111111', hex) ? '#FFFFFF' : '#111111';
    return '#FFFFFF';
  }
  // Одна разметка иконки для тем и оболочек. o: {cls, attrs, selected, label, name, sub, pal, font, sq, glow}
  function lookIconHtml(o){
    var p = o.pal, sq = o.sq ? ' sq' : '', font = (o.font || LOOK_FONT_STD).f, size = (o.font || LOOK_FONT_STD).s;
    var glow = o.glow ? ';text-shadow:0 0 6px ' + safeColor(p.accent) : '';
    return '<button class="' + o.cls + (o.selected ? ' on' : '') + '"' + (o.attrs || '') +
      ' aria-pressed="' + (o.selected ? 'true' : 'false') + '" title="' + esc(o.label) + '" aria-label="' + esc(o.label) + '">' +
      '<span class="look-win' + sq + '" style="background:' + safeColor(p.bg) + '">' +
        '<span class="look-win-top">' +
          '<span class="look-win-name" style="color:' + safeColor(p.text) + ';font-family:' + font + ' !important;font-size:' + size + glow + '">' + esc(o.name) + '</span>' +
          (o.sub ? '<span class="look-win-sub" style="color:' + safeColor(p.sub || p.text) + '">' + esc(o.sub) + '</span>' : '') +
        '</span>' +
        '<span class="look-win-bar" style="background:' + safeColor(p.panel) + ';color:' + safeColor(p.text) + ';border-top:1px solid ' + safeColor(p.line) + '">' +
          LOOK_SVG_PREV +
          '<span class="look-play' + sq + '" style="background:' + safeColor(p.button) + ';color:' + safeColor(p.btnTx) + '">' + LOOK_SVG_PLAY + '</span>' +
          LOOK_SVG_NEXT +
          '<span class="look-ac" style="background:' + safeColor(p.accent) + '"></span>' +
        '</span>' +
      '</span></button>';
  }
  // Тема, которая сейчас на экране (даже если включена оболочка — берём последнюю выбранную).
  function lookThemeNow(){
    var id = (typeof curThemeId === 'string' && curThemeId) ? curThemeId : '';
    if (!id) { try { id = localStorage.getItem('tapTheme') || ''; } catch (e) { id = ''; } }
    id = (window.TapTheme && TapTheme.migrateThemeId) ? TapTheme.migrateThemeId(id || 'dark') : (id || 'dark');
    if (id && id.indexOf('c:') === 0 && Array.isArray(myThemes) && typeof themeById === 'function') {
      var t = themeById(id); if (t) return t;
    }
    return (window.TapTheme && TapTheme.builtinTheme) ? TapTheme.builtinTheme(id) : null;
  }
  function standardIconPal(){
    var t = lookThemeNow();
    var v = (t && window.TapTheme) ? TapTheme.build(t)
      : { bg1: '#272727', bg2: '#2D2D2D', tx: '#E7F0F5', tx3: '#A5B0B6', ac: '#D17834', pri: '#7180AC', prit: '#111111', ln: '#454545' };
    return { bg: v.bg1, panel: v.bg2, text: v.tx, sub: v.tx3, accent: v.ac, button: v.pri, btnTx: v.prit, line: v.ln };
  }
  function skinIconPal(id){
    var c = skinCoreOf(id);
    if (c) return { bg: c.bg, panel: c.panel, text: c.text, sub: c.text, accent: c.accent, button: c.button, btnTx: lookBtnTx(c.button), line: c.line };
    var s = skinById(id);
    if (!s) return standardIconPal();
    return { bg: s.bg, panel: s.card, text: s.txt, sub: s.txt, accent: s.line, button: s.btn, btnTx: lookBtnTx(s.btn), line: s.line };
  }
  // Иконка оболочки; skin = null — «Стандарт» (текущая цветовая тема). На элементе — data-skin.
  function skinIcon(skin, selected){
    var id = (skin && skin.id) ? skin.id : '';
    var pal = id ? skinIconPal(id) : standardIconPal();
    var name = id ? (skin.name || id) : 'Стандарт';
    return lookIconHtml({ cls: 'skin-c look-ic', attrs: ' data-skin="' + esc(id) + '"', selected: !!selected,
      label: name + (id ? ', оболочка' : ', цветовая тема'), name: name, sub: '',
      pal: pal, font: LOOK_FONTS[id] || LOOK_FONT_STD, sq: !!id, glow: id === 'crt' });
  }
  // Иконка цветовой схемы оболочки — тот же вид, но data-scheme.
  function skinSchemeIcon(skinId, scheme, selected){
    var c = scheme.core || {};
    return lookIconHtml({ cls: 'skin-c look-ic', attrs: ' data-skin="' + esc(skinId) + '" data-scheme="' + esc(scheme.id) + '"',
      selected: !!selected, label: (scheme.name || scheme.id) + ', схема', name: scheme.name || scheme.id, sub: '',
      pal: { bg: c.bg, panel: c.panel, text: c.text, sub: c.text, accent: c.accent, button: c.button, btnTx: lookBtnTx(c.button), line: c.line },
      font: LOOK_FONTS[skinId] || LOOK_FONT_STD, sq: true, glow: skinId === 'crt' });
  }
  // Ядро → все переменные оболочки. Правила: фоновые оттенки смешиваем с фоном,
  // текст — ступени от основного к фону, акцент даёт ac2/acr/acbg.
  function skinVarsFromCore(c){
    if (!c) return null;
    var dark = (function(){
      var r = parseInt(String(c.text).slice(1, 3), 16) || 0;
      var g = parseInt(String(c.text).slice(3, 5), 16) || 0;
      var b = parseInt(String(c.text).slice(5, 7), 16) || 0;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
    })();
    var rgb = wgHex2rgb(c.accent);
    return {
      '--bg00': wgMix(c.bg, '#000000', dark ? 0.32 : 0.10),
      '--bg0': c.bg,
      '--bg1': c.panel,
      '--bg2': c.surface,
      '--bg3': wgMix(c.surface, c.text, 0.07),
      '--bg4': wgMix(c.surface, c.text, 0.14),
      '--ln': c.line,
      '--ln2': wgMix(c.line, c.bg, 0.45),
      '--ln3': wgMix(c.line, c.text, 0.30),
      '--tx': c.text,
      '--tx2': wgMix(c.text, c.bg, 0.12),
      '--tx3': wgMix(c.text, c.bg, 0.24),
      '--tx4': wgMix(c.text, c.bg, 0.36),
      '--tx5': wgMix(c.text, c.bg, 0.48),
      '--ac': c.accent,
      '--ac-tx': (function(){ var b = wgHex2rgb(c.accent); var L = (0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2]) / 255; return L > 0.5 ? '#101013' : '#FFFFFF'; })(),
      '--ac2': wgMix(c.accent, '#FFFFFF', 0.28),
      '--acr': rgb.join(','),
      '--acbg': wgMix(c.panel, c.accent, 0.18),
      '--pri': c.button,
      '--prit': (function(){ var b = wgHex2rgb(c.button); var L = (0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2]) / 255; return L > 0.5 ? '#101013' : '#FFFFFF'; })(),
      '--hov': dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)',
      '--hov2': dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.08)',
      '--hov3': dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.10)'
    };
  }
  var SKIN_VAR_KEYS = ['--bg00','--bg0','--bg1','--bg2','--bg3','--bg4','--ln','--ln2','--ln3','--tx','--tx2','--tx3','--tx4','--tx5','--ac','--ac-tx','--ac2','--acr','--acbg','--pri','--prit','--hov','--hov2','--hov3'];
  function clearSkinVars(){
    var d = document.documentElement;
    SKIN_VAR_KEYS.forEach(function (k){ d.style.removeProperty(k); });
    try { delete d.dataset.sknScheme; } catch (e) {}
  }
  function applySkinVars(id){
    var core = skinCoreOf(id); if (!core) return;
    var v = skinVarsFromCore(core); if (!v) return;
    var d = document.documentElement;
    Object.keys(v).forEach(function (k){ d.style.setProperty(k, v[k]); });
    d.dataset.sknScheme = curSkinScheme[id] || 'original';
  }
  function skinSchemesStore(){
    var out = {};
    Object.keys(curSkinScheme).forEach(function (id){
      if (curSkinScheme[id] === 'custom' && curSkinCore[id]) out[id] = { id: 'custom', core: curSkinCore[id] };
      else if (curSkinScheme[id]) out[id] = { id: curSkinScheme[id] };
    });
    return out;
  }
  var _skinSaveT = null;
  function saveSkinSchemes(){
    clearTimeout(_skinSaveT);
    _skinSaveT = setTimeout(function(){
      var data = skinSchemesStore();
      try { localStorage.setItem('tapSkinSchemes', JSON.stringify(data)); } catch (e) { console.warn('Тапёр: не сохранились схемы оболочки', e); }
      if (A.setSetting) A.setSetting('skinSchemes', data);
    }, 250);
  }
  function loadSkinSchemes(data){
    curSkinScheme = {}; curSkinCore = {};
    if (!data) return;
    Object.keys(data).forEach(function (id){
      var v = data[id] || {};
      if (v.id === 'custom' && v.core) { curSkinScheme[id] = 'custom'; curSkinCore[id] = v.core; }
      else if (v.id && skinSchemeById(id, v.id)) curSkinScheme[id] = v.id;   // неизвестные схемы (например, удалённые) отбрасываем
    });
  }
  function setSkinScheme(id, sid, save){
    if (!id) return;
    curSkinScheme[id] = sid;
    delete curSkinCore[id];
    applySkinVars(id);
    if (save) saveSkinSchemes();
    renderSkinScheme();
  }
  function setSkinCoreColor(id, key, hex){
    if (!id) return;
    var core = Object.assign({}, skinCoreOf(id) || {});
    core[key] = String(hex).toUpperCase();
    curSkinCore[id] = core;
    curSkinScheme[id] = 'custom';
    applySkinVars(id);
    saveSkinSchemes();
    renderSkinScheme();
  }
  function resetSkinScheme(id){
    var first = skinSchemeList(id)[0]; if (!first) return;
    curSkinScheme[id] = first.id;
    delete curSkinCore[id];
    applySkinVars(id);
    saveSkinSchemes();
    renderSkinScheme();
  }
function renderSkinScheme(){
  var row = $('skinSchemeRow');
  var icons = $('skinSchemeIcons');
  var box = $('skinCoreRow');
  if (!row || !icons || !box) return;
  var active = !!curSkin;
  row.hidden = !active;
  if (!active) { icons.innerHTML = ''; box.innerHTML = ''; return; }
  var list = skinSchemeList(curSkin);
  var custom = curSkinScheme[curSkin] === 'custom';
  var curId = custom ? 'custom' : (curSkinScheme[curSkin] || (list[0] && list[0].id) || '');
  // Схемы оболочки — теми же иконками, что и темы: щёлкнул — оболочка перекрасилась.
  icons.innerHTML = list.map(function (s){ return skinSchemeIcon(curSkin, s, !custom && curId === s.id); }).join('');
  var descEl = $('skinSchemeDesc');
  if (descEl) {
    var cur = custom ? null : (skinSchemeById(curSkin, curId) || list[0]);
    descEl.textContent = custom ? 'СВОЯ — цвета изменены вручную' : (cur && cur.desc ? cur.desc : '');
  }
  var core = skinCoreOf(curSkin) || {};
  // Строки как в редакторе темы: подпись, кружок цвета и HEX (пипетка — в окне цвета)
  box.innerHTML = SKIN_CORE.map(function (c){
    var hex = (core[c.k] || '#000000').toUpperCase();
    return '<div class="te-row"><span>' + c.n + '</span>' +
      '<button class="te-sw" type="button" data-sc="' + c.k + '" style="background:' + hex + '" title="' + c.n + '"></button>' +
      '<input class="te-hex" data-sch="' + c.k + '" value="' + hex + '" maxlength="7" spellcheck="false" aria-label="' + c.n + '">' +
      '</div>';
  }).join('') +
    '<div class="te-row" style="margin-top:12px"><span></span><button class="btn ghost" type="button" id="skinSchemeReset">↺ Сбросить к первой схеме</button></div>';

  icons.onclick = function(e){
    var b = e.target.closest('[data-scheme]'); if (!b) return;
    if (b.dataset.scheme === curSkinScheme[curSkin]) return;
    setSkinScheme(curSkin, b.dataset.scheme, true);
    toast('Схема: ' + ((skinSchemeById(curSkin, b.dataset.scheme) || {}).name || ''));
  };

  box.onclick = function(e){
    var sw = e.target.closest('[data-sc]');
    if (sw) {
      var key = sw.dataset.sc;
      var name = (SKIN_CORE.filter(function (x){ return x.k === key; })[0] || {}).n || key;
      var skin = skinById(curSkin);
      colOpenFor((skin ? skin.name + ' · ' : '') + name, (core[key] || '#000000'), function (hex){
        setSkinCoreColor(curSkin, key, hex);
      }, function(){ renderSkinScheme(); });
      return;
    }
    if (e.target.id === 'skinSchemeReset') resetSkinScheme(curSkin);
  };

  box.onchange = function(e){
    if (!e.target.dataset.sch) return;
    var v = e.target.value.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(v)) { renderSkinScheme(); return; }
    setSkinCoreColor(curSkin, e.target.dataset.sch, v);
  };
}
  // Набор шрифтов: '' — как в оболочке, иначе один из наборов
  var SKIN_FONTS = [
    { id: '', name: 'Как в оболочке' },
    { id: 'mono', name: 'VGA / DOS' },
    { id: 'pixel', name: 'Неон-скан' },
    { id: 'retro', name: 'Ретро-десктоп' }
  ];
  var curFont = '';
  function applySkinFont(id, save){
    if (id === 'onest') id = ''; // пункт убран: старое сохранённое значение сбрасываем на «как в оболочке»
    curFont = id || '';
    var d = document.documentElement;
    ['onest', 'mono', 'pixel', 'retro'].forEach(function (k){ d.classList.remove('font-' + k); });
    if (curFont && curSkin) d.classList.add('font-' + curFont);
    try { localStorage.setItem('tapSkinFont', curFont); } catch (e) { console.warn('Тапёр: не сохранился шрифт оболочки', e); }
    if (save && A.setSetting) A.setSetting('skinFont', curFont);
    syncLookClasses();
    renderFontSeg();
  }
  function renderFontSeg(){
    var sel = $('skinFontSel'); if (!sel) return;
    sel.innerHTML = SKIN_FONTS.map(function (f){
      return '<option value="' + f.id + '">' + esc(f.name) + '</option>';
    }).join('');
    sel.value = curFont;
  }
  // Ручки оболочки: яркость, насыщенность, контраст — независимо друг от друга
  function applySkinAdj(next, save){
    if (next) { if (next.b != null) skinAdj.b = next.b; if (next.s != null) skinAdj.s = next.s; if (next.c != null) skinAdj.c = next.c; }
    skinAdj.b = Math.max(20, Math.min(100, Math.round(skinAdj.b)));
    skinAdj.s = Math.max(0, Math.min(100, Math.round(skinAdj.s)));
    skinAdj.c = Math.max(0, Math.min(100, Math.round(skinAdj.c)));
    var d = document.documentElement;
    d.style.setProperty('--sk-b', (skinAdj.b / 100).toFixed(2));
    d.style.setProperty('--sk-s', (skinAdj.s / 100).toFixed(2));
    d.style.setProperty('--sk-c', (0.62 + 0.38 * (skinAdj.c / 100)).toFixed(3));
    ['b', 's', 'c'].forEach(function (k){
      var inp = document.querySelector('[data-adj="' + k + '"]');
      var val = document.querySelector('[data-adjv="' + k + '"]');
      if (inp) inp.value = skinAdj[k];
      if (val) val.textContent = skinAdj[k] + '%';
    });
    try { localStorage.setItem('tapSkinAdj', JSON.stringify(skinAdj)); } catch (e) { console.warn('Тапёр: не сохранились настройки оболочки', e); }
    if (save && A.setSetting) A.setSetting('skinAdj', skinAdj);
  }
  function skinById(id){ for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i]; return null; }
  function clearSkinFontClass(){
    var d = document.documentElement;
    ['onest', 'mono', 'pixel', 'retro'].forEach(function (k){ d.classList.remove('font-' + k); });
  }
  function clearSkinClass(){
    var d = document.documentElement;
    clearSkinFontClass();
    // Снимаем любые классы skin-* — даже от удалённых оболочек
    Array.prototype.slice.call(d.classList).forEach(function (c){ if (c.indexOf('skin-') === 0) d.classList.remove(c); });
    d.classList.remove('pixel-skin');
    if (typeof clearSkinVars === 'function') clearSkinVars();
    curSkin = '';
  }
  // ── Единое состояние вида (функц. аудит 01.11, F1) ─────────────────────────
  // Классы вида на <html> вычисляются ЗАНОВО из трёх переменных: curSkin, curFont,
  // curThemeId. Всё с известными префиксами снимается, нужное ставится. Раньше каждый
  // переход сам помнил, что снять, — и однажды забыл (хотфикс 0.27.2: шрифт оболочки
  // «тёк» в стандарт). Теперь забыть невозможно: какие бы частичные правки ни сделали
  // applySkin / applyTheme / applySkinFont, в конце итог приводится к состоянию.
  // Inline-стили переменных (--bg и т.п.) этим не управляются — у них свои функции.
  function syncLookClasses(){
    var d = document.documentElement;
    Array.prototype.slice.call(d.classList).forEach(function (c){
      if (c === 'pixel-skin' || /^(skin-|font-|theme-)/.test(c)) d.classList.remove(c);
    });
    var s = curSkin ? skinById(curSkin) : null;
    if (s) {
      d.classList.add('skin-' + s.id);
      if (s.pixel !== false) d.classList.add('pixel-skin');
      if (curFont) d.classList.add('font-' + curFont);
      return;
    }
    var id = (typeof curThemeId === 'string' && curThemeId) || 'dark';
    if (id === 'dark') d.classList.add('theme-dark');
    else if (id === 'mono') d.classList.add('theme-mono');
    else {
      // Светлые встроенные и свои темы живут на переменных: класс theme-custom + theme-light.
      var t = (id.indexOf('c:') === 0 && Array.isArray(myThemes) && typeof themeById === 'function') ? themeById(id) : null;
      var bt = (!t && window.TapTheme && TapTheme.builtinTheme) ? TapTheme.builtinTheme(id) : null;
      var light = !!(t ? t.mode === 'light' : (bt && bt.mode === 'light'));
      if (t || bt) { d.classList.add('theme-custom'); if (light) d.classList.add('theme-light'); }
    }
  }
  // Применить оболочку; '' — выключить и вернуться к теме
  function applySkin(id, save){
    var d = document.documentElement, s = skinById(id);
    clearSkinClass();
    if (s) {
      if (typeof clearCustomVars === 'function') clearCustomVars();
      d.classList.remove('theme-dark', 'theme-mono', 'theme-light');
      curSkin = s.id;
      d.classList.add('skin-' + s.id);
      if (s.pixel !== false) d.classList.add('pixel-skin');
      if (typeof applySkinVars === 'function') applySkinVars(s.id);
      curThemeId = '';
    }
    try { localStorage.setItem('tapSkin', curSkin); } catch (e) { console.warn('Тапёр: не сохранилась оболочка', e); }
    if (save && A.setSetting) A.setSetting('skin', curSkin);
    // Без оболочки возвращаем выбранную тему
    if (!s && typeof clearSkinVars === 'function') clearSkinVars();
    if (!s) applyTheme(themeLocal() || 'dark', false);
    if (s && curFont) applySkinFont(curFont, false);
    syncLookClasses();
    renderSkinList();
    renderThemeList();
  }
  function renderSkinList(){
    var box = $('skinGrid'); if (!box) return;
    box.hidden = !SKINS.length;   // модуля оболочек нет — выбирать не из чего
    // «Стандарт» — всегда первый: это режим с цветовой темой. Иконки — мини-окна по макету.
    box.innerHTML = skinIcon(null, !curSkin) + SKINS.map(function (s){ return skinIcon(s, curSkin === s.id); }).join('');
    var row = $('skinAdjRow'); if (row) row.hidden = !curSkin;
    var themes = $('lookThemes'); if (themes) themes.hidden = !!curSkin;
    if (typeof renderSkinScheme === 'function') renderSkinScheme();
    renderFontSeg();
    applySkinAdj(null, false);
  }
  function bindSkins(){
    var grid = $('skinGrid');
    if (grid) grid.addEventListener('click', function (e){
      var b = e.target.closest('[data-skin]'); if (!b) return;
      applySkin(b.dataset.skin || '', true);
      toast(b.dataset.skin ? 'Оболочка включена' : 'Оболочка выключена');
    });
    var box = $('skinAdjRow');
    if (box) {
      box.addEventListener('input', function (e){
        var k = e.target && e.target.dataset && e.target.dataset.adj; if (!k) return;
        var patch = {}; patch[k] = +e.target.value;
        applySkinAdj(patch, true);
      });
      box.addEventListener('change', function (e){
        if (!e.target || e.target.id !== 'skinFontSel') return;
        applySkinFont(e.target.value || '', true);
      });
    }
    renderSkinList();
  }
  bindSkins();
