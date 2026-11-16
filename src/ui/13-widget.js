// ===== Виджет для OBS =====
// Лента заказов и мини-плеер живут в отдельной странице /widget (источник «Браузер» в OBS).
var WG = { look: 'current', scale: 100, url: '', newOnTop: false };
var wgLast = '';
var WG_PALETTES = {
  dark:   { bg: '#222222', card: '#272727', line: '#454545', tx: '#E7F0F5', tx2: '#C7D2D8', tx3: '#A5B0B6', ac: '#D17834', pri: '#7180AC', radius: 12, font: "'Onest','Segoe UI',sans-serif" },
  mono:   { bg: '#0F0F0F', card: '#161616', line: '#2F2F2F', tx: '#EDEDED', tx2: '#CBCBCB', tx3: '#A2A2A2', ac: '#D4D4D4', pri: '#E8E8E8', radius: 12, font: "'Onest','Segoe UI',sans-serif" },
  dos:    { bg: '#007878', card: '#C0C0C0', line: '#808080', tx: '#000000', tx2: '#101010', tx3: '#2A2A2A', ac: '#000080', pri: '#C0C0C0', radius: 0, font: "'JetBrains Mono',Consolas,monospace" },
  crt:    { bg: '#0B0B12', card: '#191527', line: '#3A2F5C', tx: '#F2EEFF', tx2: '#CFC7EA', tx3: '#A89FD0', ac: '#FF2D95', pri: '#00E5FF', radius: 0, font: "'JetBrains Mono',Consolas,monospace" },
  retro:  { bg: '#1B1B1E', card: '#26262A', line: '#5C5C64', tx: '#E9E9EC', tx2: '#C9C9CF', tx3: '#A9A9B1', ac: '#3B5F8A', pri: '#C0C0C0', radius: 0, font: 'Tahoma,sans-serif' }
};
// Встроенные темы (8) — палитры строит тот же theme.js, что и окно: панель OBS не отстаёт от тем.
(function(){
  if (!(window.TapTheme && TapTheme.builtinList && TapTheme.build)) return;
  TapTheme.builtinList().forEach(function (t){
    if (WG_PALETTES[t.id]) return;
    var v = TapTheme.build(t);
    WG_PALETTES[t.id] = { bg: v.bg0, card: v.bg1, line: v.ln, tx: v.tx, tx2: v.tx2, tx3: v.tx3, ac: v.ac, pri: v.pri, radius: 12, font: "'Onest','Segoe UI',sans-serif" };
  });
})();
var WG_LOOK_VARS = ['bg00','bg0','bg1','bg2','bg3','bg4','ln','ln2','ln3','tx','tx2','tx3','tx4','tx5','ac','ac2','acr','acbg','pri','prit'];
function widgetThemeVars(id){
  if (!(window.TapTheme && TapTheme.builtinTheme && TapTheme.build)) return '';
  var t = TapTheme.builtinTheme(id); if (!t) return '';
  var v = TapTheme.build(t);
  return WG_LOOK_VARS.map(function(k){ return '--' + k + ':' + v[k]; }).join(';');
}
// Класс и переменные для панели OBS: «Графит»/«Монохром» — готовыми классами, остальные — как свои темы.
function widgetThemeLook(id){
  if (id === 'dark') return { cls: 'theme-dark', vars: '' };
  if (id === 'mono') return { cls: 'theme-mono', vars: '' };
  var t = (window.TapTheme && TapTheme.builtinTheme) ? TapTheme.builtinTheme(id) : null;
  if (!t) return { cls: '', vars: '' };
  return { cls: 'theme-custom' + (t.mode === 'light' ? ' theme-light' : ''), vars: widgetThemeVars(id) };
}

// ===== Палитры Yami для панели OBS =====
// Шесть стилей «стандартного» оформления: не оболочки, а цветовые схемы.
var YAMI = {
  default: { bg: '#1D1F26', panel: '#272A33', surf: '#3C404D', line: '#464B59', tx: '#FFFFFF', tx2: '#969696', ac: '#284CB8', ac2: '#476BD7', ok: '#37D247', err: '#C01C37', light: false },
  acri:    { bg: '#101116', panel: '#191A20', surf: '#25262D', line: '#353640', tx: '#F5F5F7', tx2: '#92939D', ac: '#476BD7', ac2: '#718CDC', ok: '#37D247', err: '#E33B57', light: false },
  classic: { bg: '#202020', panel: '#2A2A2A', surf: '#353535', line: '#484848', tx: '#F2F2F2', tx2: '#A0A0A0', ac: '#3B78C8', ac2: '#5595E8', ok: '#42B85A', err: '#D84040', light: false },
  grey:    { bg: '#272A33', panel: '#323540', surf: '#3C404D', line: '#4E5566', tx: '#FFFFFF', tx2: '#B4B4B4', ac: '#5B6273', ac2: '#718094', ok: '#78B982', err: '#CC727C', light: false },
  light:   { bg: '#F1F1F1', panel: '#FFFFFF', surf: '#E1E1E1', line: '#C6C6C6', tx: '#222222', tx2: '#686868', ac: '#284CB8', ac2: '#476BD7', ok: '#218838', err: '#C01C37', wait: '#A86400', light: true },
  rachni:  { bg: '#171B20', panel: '#20272D', surf: '#2B353D', line: '#3B4B54', tx: '#F5F7F8', tx2: '#9AAAB1', ac: '#16B1F3', ac2: '#3DBEF5', ok: '#37D247', err: '#E33B57', light: false }
};

function wgHex2rgb(h){
  h = String(h || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}
function wgRgb2hex(r){
  return '#' + r.map(function(v){ var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length === 1 ? '0' + s : s; }).join('');
}
function wgMix(a, b, t){
  var x = wgHex2rgb(a), y = wgHex2rgb(b);
  return wgRgb2hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

// Собираем CSS-переменные приложения из палитры Yami
function yamiVars(id){
  var p = YAMI[id] || YAMI.default;
  var dark = !p.light;
  var rgb = wgHex2rgb(p.ac).join(',');
  var vars = {
    '--bg00': wgMix(p.bg, '#000000', dark ? 0.3 : 0.06),
    '--bg0': p.bg,
    '--bg1': p.panel,
    '--bg2': p.surf,
    // Карточки сообщений темнее поверхностей: смешиваем поверхность с фоном палитры
    '--card-bg': dark ? wgMix(p.surf, p.bg, 0.55) : p.surf,
    '--bg3': wgMix(p.surf, p.tx, 0.06),
    '--bg4': wgMix(p.surf, p.tx, 0.12),
    '--ln': p.line,
    '--ln2': wgMix(p.line, p.bg, 0.45),
    '--ln3': wgMix(p.line, p.tx, 0.18),
    '--tx': p.tx,
    '--tx2': wgMix(p.tx, p.tx2, 0.35),
    '--tx3': p.tx2,
    '--tx4': wgMix(p.tx2, p.bg, 0.25),
    '--tx5': wgMix(p.tx2, p.bg, 0.45),
    '--ac': p.ac,
    '--ac2': p.ac2,
    '--acr': rgb,
    '--acbg': wgMix(p.panel, p.ac, dark ? 0.2 : 0.12),
    '--pri': p.ac2,
    '--prit': '#FFFFFF',
    '--hov': dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)',
    '--hov2': dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.07)',
    '--hov3': dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.09)',
    '--ok': p.ok,
    '--err': p.err,
    '--wait': p.wait || '#FFD43B',
    '--wait-bg': 'rgba(' + wgHex2rgb(p.wait || '#FFD43B').join(',') + ',.16)',
    // Скругления и шрифт — как в OBS: прямые панели и системный шрифт
    '--r-panel': '0px',
    '--r-card': '0px',
    '--r-ctl': '0px',
    '--r-tab': '0px',
    '--font': 'Segoe UI, system-ui, -apple-system, Roboto, Arial, sans-serif',
  };
  return Object.keys(vars).map(function(k){ return k + ':' + vars[k]; }).join(';');
}

function widgetTheme(){
  var look = WG.look || 'current';
  if (look.indexOf('theme:') === 0) return WG_PALETTES[look.slice(6)] || WG_PALETTES.dark;
  if (look.indexOf('skin:') === 0) return WG_PALETTES[look.slice(5)] || WG_PALETTES.crt;
  var cs = getComputedStyle(document.documentElement);
  function v(n, d){ var x = (cs.getPropertyValue(n) || '').trim(); return x || d; }
  return {
    bg: v('--bg0', '#222222'), card: v('--bg1', '#272727'), line: v('--ln', '#454545'),
    tx: v('--tx', '#E7F0F5'), tx2: v('--tx2', '#C7D2D8'), tx3: v('--tx3', '#A5B0B6'),
    ac: v('--ac', '#D17834'), pri: v('--pri', '#7180AC'), radius: 12,
    font: "'Onest','Segoe UI',sans-serif"
  };
}

function widgetMessages(){
  var out = [];
  var now = queue[current];
  (RQ.list || []).forEach(function(r){
    if (r.state === 'dismissed') return;
    var at = r.got || r.at || 0;
    var who = r.name || '';
    var amt = r.amount != null ? (Math.round(r.amount * 100) / 100) : null;
    var cur = (CURSYM && CURSYM[r.currency]) || r.currency || '';
    var text = r.text || '';
    var items = r.items || [];
    if (!items.length) {
      out.push({ at: at, who: who, amt: amt, cur: cur, text: text, title: '', status: 'look' });
      return;
    }
    items.forEach(function(it){
      var t = it.track;
      var title = t ? ((t.author ? t.author + ' — ' : '') + t.title) : (it.query || '');
      var status = 'look';
      if (it.state === 'added') status = 'queued';
      else if (t && now && now.title === t.title) status = 'playing';
      else if (rqExact(it)) status = 'waiting';
      out.push({ at: at, who: who, amt: amt, cur: cur, text: text, title: title, status: status });
    });
  });
  out.sort(function(a, b){ return a.at - b.at; });
  return out.slice(0, 80);
}

// Та же лента сообщений, что во вкладке «Заказы»: общий HTML и общие обработчики
function widgetFeedHtml(){
  var t0 = Date.now() - RQ_DAY;
  var vis = (RQ.list || []).filter(function(r){
    return r.state !== 'dismissed' && (r.got || r.at || 0) > t0;
  });
  vis.sort(function(a, b){ var ta = a.got || a.at || 0, tb = b.got || b.at || 0; return WG.newOnTop ? (tb - ta) : (ta - tb); });
  return vis.map(function(r){ return rqCardHtml(r, r._ri, null, 'dock-card', { dock: true }); }).join('');
}

// Панель OBS открыта? Пока нет — состояние не собираем и не шлём (раньше каждые 1,5 с, ~8% процессора при игре).
// Неизвестно (старый главный процесс без счётчика) — шлём как раньше.
var wgClients = null;
if (A.onWidgetClients) A.onWidgetClients(function (n){ var was = wgClients; wgClients = n; if (n > 0 && !(was > 0)) setTimeout(function(){ pushWidget(true); }, 50); });
function pushWidget(force){
  if (wgClients === 0) return;
  if (!A.widgetPush) return;
  if (typeof RQ === 'undefined' || !RQ || typeof queue === 'undefined' || typeof current === 'undefined') return;
  try {
    var playing = !!queue[current] && !document.body.classList.contains('is-paused');
    var st = {
      messages: widgetMessages(),
      np: {
        title: queue[current] ? (queue[current].title || '') : '',
        artist: queue[current] ? (queue[current].author || queue[current].artist || '') : '',
        playing: playing,
        pos: (typeof master === "function" && master() && master().currentTime) || 0
      },
      reqAuto: !!RQ.auto,
      scale: WG.scale || 100,
      theme: widgetTheme()
    };
    var sig = JSON.stringify(st);
    if (!force && sig === wgLast) return;
    wgLast = sig;
    st.feedHtml = widgetFeedHtml();
    st.newOnTop = !!WG.newOnTop;
    var t0w = Date.now() - RQ_DAY;
    st.msgCount = (RQ.list || []).filter(function(r){ return r.state !== 'dismissed' && (r.got || r.at || 0) > t0w; }).length;
    st.htmlClass = document.documentElement.className;
    st.htmlStyle = document.documentElement.getAttribute('style') || '';
    st.bodyClass = document.body.className;
    // Оформление панели: либо как в приложении, либо заданная тема/оболочка — теми же классами
    var lk = WG.look || 'current';
    var DOCK_LOOK = {
      'skin:dos': 'pixel-skin skin-dos', 'skin:crt': 'pixel-skin skin-crt', 'skin:retro': 'pixel-skin skin-retro'
    };
    var look = lk.indexOf('theme:') === 0 ? widgetThemeLook(lk.slice(6)) : null;
    var yamiId = lk.indexOf('yami:') === 0 ? lk.slice(5) : '';
    st.dockClass = yamiId ? ('yami yami-' + yamiId) : (lk === 'current' ? (st.htmlClass || '') : (look ? look.cls : (DOCK_LOOK[lk] || '')));
    st.dockStyle = yamiId ? yamiVars(yamiId) : (lk === 'current' ? (st.htmlStyle || '') : (look ? look.vars : ''));
    A.widgetPush(st);
  } catch (err) {
    try { A.widgetPush({ orders: [], np: { title: 'ERR ' + (err && err.message), artist: '', playing: false }, reqAuto: false, scale: 100, theme: null }); } catch (e) {}
  }
}

// команды из виджета
if (A.onWidgetRq) A.onWidgetRq(function(d){
  if (!d || !d.dataset) return;
  var want = d.dataset;
  var all = document.querySelectorAll('[data-rq]');
  for (var i = 0; i < all.length; i++) {
    var el = all[i], ok = true;
    for (var k in want) {
      if (k === 'rq' || k === 'ri' || k === 'id' || k === 'act' || k === 'ix') {
        if (String(el.dataset[k] || '') !== String(want[k] || '')) { ok = false; break; }
      }
    }
    if (ok) { el.click(); setTimeout(function(){ pushWidget(true); }, 150); return; }
  }
});

if (A.onWidgetCmd) A.onWidgetCmd(function(action){
  if (action === 'search') { setTab('search'); var si = $('search'); if (si) { si.focus(); try { si.select(); } catch (e) {} } return; }
  if (action === 'playpause') { var b = $('playpause'); if (b) b.click(); }
  else if (action === 'next') { var n = $('next'); if (n) n.click(); }
  else if (action === 'prev') { var p = $('prev'); if (p) p.click(); }
  else if (action === 'like') { var l = $('likeBtn'); if (l && !l.hidden) l.click(); }
  // Streamer.bot (0.35): не переключение, а точное состояние — пауза, играть, громкость 0–100.
  else if (action === 'pause') { if (!document.body.classList.contains('is-paused')) { var bp = $('playpause'); if (bp) bp.click(); } }
  else if (action === 'play') { if (document.body.classList.contains('is-paused')) { var bpl = $('playpause'); if (bpl) bpl.click(); } }
  else if (action.indexOf('vol:') === 0) {
    var vv = $('vol');
    if (vv) {
      var nv = Math.max(0, Math.min(100, Math.round(parseFloat(action.slice(4)) || 0)));
      vv.value = nv;
      vv.dispatchEvent(new Event('input'));
    }
  }
  setTimeout(function(){ pushWidget(true); }, 120);
});

// настройка из виджета (тумблер «Точные»)
if (A.onWidgetSetting) A.onWidgetSetting(function(s){
  if (!s || !s.key) return;
  if (s.key === 'reqAuto') {
    RQ.auto = !!s.value;
    syncReqAuto();
  } else if (s.key === 'widgetLook') {
    WG.look = s.value || 'current';
    var sel = $('wgLook'); if (sel) sel.value = WG.look;
    renderLookPrev(WG.look);
  } else if (s.key === 'widgetScale') {
    WG.scale = Number(s.value) || 100;
    var sl = $('wgScale'); if (sl) sl.value = WG.scale;
    var sv = $('wgScaleVal'); if (sv) sv.textContent = WG.scale + '%';
  } else if (s.key === 'widgetNewOnTop') {
    WG.newOnTop = !!s.value;
    var seg = document.getElementById('wgOrder');
    if (seg) {
      var bs = seg.querySelectorAll('button');
      for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', (bs[k].dataset.v === 'top') === WG.newOnTop);
    }
  }
  pushWidget(true);
});

function syncReqAuto(){
  var els = document.querySelectorAll('[data-set-tg="reqAuto"]');
  Array.prototype.forEach.call(els, function(el){ setTg(el, RQ.auto); });
}

// интерфейс в «Настройки → OBS и стрим»
// Образцы цветов выбранной схемы: подписи в title, клик копирует HEX
function renderLookPrev(look){
  var box = document.getElementById('wgPrev');
  if (!box) return;
  var cols = [];
  var yid = look && look.indexOf('yami:') === 0 ? look.slice(5) : '';
  if (yid && YAMI[yid]) {
    var p = YAMI[yid];
    cols = [
      ['Фон', p.bg], ['Панели', p.panel], ['Поверхности', p.surf], ['Границы', p.line],
      ['Текст', p.tx], ['Вторичный', p.tx2], ['Акцент', p.ac], ['Акцент (наведение)', p.ac2],
      ['Успех', p.ok], ['Ошибка', p.err]
    ];
  } else {
    var cs = getComputedStyle(document.documentElement);
    var v = function(n, d){ var x = (cs.getPropertyValue(n) || '').trim(); return x || d; };
    cols = [
      ['Фон', v('--bg0', '#0E0F13')], ['Панели', v('--bg1', '#15161C')], ['Поверхности', v('--bg2', '#181A21')],
      ['Границы', v('--ln', '#2C2F3A')], ['Текст', v('--tx', '#ECEDF2')], ['Акцент', v('--ac', '#9B87FF')]
    ];
  }
  box.innerHTML = cols.map(function(c){
    return '<div class="wg-chip" title="' + c[0] + ': ' + c[1] + '" data-hex="' + c[1] + '" style="background:' + c[1] + '"></div>';
  }).join('');
  box.onclick = function(e){
    var chip = e.target.closest('.wg-chip'); if (!chip) return;
    var hex = chip.dataset.hex;
    var done = function(){ toast('Скопировано: ' + hex); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(hex).then(done).catch(function(){ prompt('Цвет:', hex); });
    else prompt('Цвет:', hex);
  };
}

function initWidgetUi(){
  var urlEl = $('wgUrl'), copyBtn = $('wgCopy'), openBtn = $('wgOpen');
  var lookSel = $('wgLook'), scaleEl = $('wgScale'), scaleVal = $('wgScaleVal');
  if (A.widgetUrl) A.widgetUrl().then(function(u){ WG.url = u || ''; if (urlEl) urlEl.textContent = WG.url || 'нет адреса'; });
  var orderSeg = document.getElementById('wgOrder');
  if (orderSeg) {
    if (A.getSetting) A.getSetting('widgetNewOnTop').then(function(v){
      WG.newOnTop = !!v;
      var bs = orderSeg.querySelectorAll('button');
      for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', (bs[k].dataset.v === 'top') === WG.newOnTop);
      pushWidget(true);
    });
    orderSeg.onclick = function(e){
      var b = e.target.closest('button'); if (!b) return;
      var bs = orderSeg.querySelectorAll('button');
      for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', bs[k] === b);
      WG.newOnTop = b.dataset.v === 'top';
      if (A.setSetting) A.setSetting('widgetNewOnTop', WG.newOnTop);
      pushWidget(true);
    };
  }
  var portEl = $('wgPort'), portBtn = $('wgPortApply');
  // Проверка: не занял ли постоянный порт кто-то другой — тогда адрес в OBS не совпадёт
  function checkPortWarn(want){
    var warn = $('wgWarn');
    if (!warn) return;
    var real = Number((WG.url.match(/:(\d+)\/widget/) || [])[1] || 0);
    if (want && real && Number(want) !== real) {
      warn.hidden = false;
      warn.textContent = 'Порт ' + want + ' занят другой программой — панель сейчас на ' + real + '. Адрес в OBS: ' + WG.url;
    } else {
      warn.hidden = true;
    }
  }
  var wantPort = null;
  if (A.getSetting) A.getSetting('widgetPort').then(function(v){ wantPort = Number(v) || null; checkPortWarn(wantPort); if (portEl && v) portEl.value = v; });
  if (A.widgetUrl) setTimeout(function(){ checkPortWarn(wantPort); }, 1500);
  if (portBtn) portBtn.onclick = function(){
    var v = Number(portEl.value);
    if (!v || v < 1024 || v > 65535) { toast('Порт должен быть от 1024 до 65535'); return; }
    if (A.setSetting) A.setSetting('widgetPort', v);
    toast('Порт ' + v + ': страница перезапустится, адрес в OBS — http://127.0.0.1:' + v + '/widget');
  };
  if (A.getSetting) {
    A.getSetting('widgetLook').then(function(v){ WG.look = v || 'current'; if (lookSel) lookSel.value = WG.look; renderLookPrev(WG.look); pushWidget(true); });
    A.getSetting('widgetScale').then(function(v){ WG.scale = Number(v) || 100; if (scaleEl) scaleEl.value = WG.scale; if (scaleVal) scaleVal.textContent = WG.scale + '%'; pushWidget(true); });
    A.getSetting('reqAuto').then(function(v){ RQ.auto = !!v; syncReqAuto(); pushWidget(true); });
  }
  if (copyBtn) copyBtn.onclick = function(){ if (!WG.url) return; navigator.clipboard.writeText(WG.url).then(function(){ toast('Адрес виджета скопирован'); }).catch(function(){ prompt('Скопируй адрес:', WG.url); }); };
  if (openBtn) openBtn.onclick = function(){ if (WG.url) A.openExternal(WG.url); };
  if (lookSel) lookSel.onchange = function(){ WG.look = lookSel.value; if (A.setSetting) A.setSetting('widgetLook', WG.look); renderLookPrev(WG.look); pushWidget(true); };
  if (scaleEl) {
    scaleEl.oninput = function(){ WG.scale = Number(scaleEl.value); if (scaleVal) scaleVal.textContent = WG.scale + '%'; pushWidget(true); };
    scaleEl.onchange = function(){ if (A.setSetting) A.setSetting('widgetScale', WG.scale); };
  }
}

