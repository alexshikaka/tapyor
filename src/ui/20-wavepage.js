// ===== Вкладка «Волна»: полная версия панели из очереди =====
var wpCtxData = null, wpCtxLoading = false, wpCtxSig = '', wpCtxPromise = null;

function wpOnAir(){
  return !!(queue[current] && queue[current].bg && !isIdle()) || !!(loadingIdx >= 0 && queue[loadingIdx] && queue[loadingIdx].bg);
}
function wpCfgText(){
  var d = (typeof DIV_NAMES !== 'undefined' && DIV_NAMES[waveCfg.diversity]) || '';
  var m = (typeof MOOD_NAMES !== 'undefined' && MOOD_NAMES[waveCfg.mood]) || '';
  var l = (typeof LANG_NAMES !== 'undefined' && LANG_NAMES[waveCfg.language]) || '';
  return [d, m, l].filter(Boolean).join(' · ');
}
function renderWavePage(){
  if (!document.getElementById('viewWave')) return;
  var on = wpOnAir();
  var play = document.getElementById('wpPlay');
  if (play) play.textContent = on ? '■ Стоп' : '▶ Включить выбранное';
  var st = document.getElementById('wpState');
  if (st) st.textContent = (on ? 'В эфире · ' : (waveCfg.on ? 'Авто вкл. · ' : 'Авто выкл. · ')) + wpCfgText();
  if (ymLoggedIn && wpCtxData === null && !wpCtxLoading) setTimeout(wpLoadContexts, 0);
  wpRenderCats();
  [['wpDiv','diversity'],['wpMood','mood'],['wpLang','language']].forEach(function(pair){
    var root = document.getElementById(pair[0]); if (!root) return;
    var bs = root.querySelectorAll('.wchip');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].dataset.v === waveCfg[pair[1]]);
  });
}
function wpEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
function wpPlural(n, one, few, many){ n = Math.abs(n) % 100; var n1 = n % 10; if (n > 10 && n < 20) return many; if (n1 === 1) return one; if (n1 >= 2 && n1 <= 4) return few; return many; }
function wpIconUrl(c){
  var u = c && c.icon && (c.icon.imageUrl || c.icon.url);
  if (!u) return '';
  u = String(u).replace(/%%$/, '200x200');
  return /^https?:/i.test(u) ? u : 'https://' + u.replace(/^\/+/, '');
}
// Один и тот же список вариантов, что и в панели «Что играет»: без «Моей волны» и повторов id.
function wpContextsPick(list){
  if (window.TapWaveVariants) return window.TapWaveVariants.pick(list || []);
  return Array.isArray(list) ? list : [];
}
function wpContextActive(c){
  if (!bgSel || bgSel.kind !== 'wave') return false;
  if (window.TapWaveVariants) return window.TapWaveVariants.key(c) === window.TapWaveVariants.activeId(bgSel);
  if (c.station && bgSel.station === c.station) return true;
  if (c.seeds && c.seeds.length && bgSel.seeds && bgSel.seeds.length === c.seeds.length) {
    return bgSel.seeds.join(',') === c.seeds.join(',');
  }
  return false;
}
function wpContextCard(c, i){
  var color = /^#?[0-9a-f]{6}$/i.test(c.color || '') ? (c.color[0] === '#' ? c.color : '#' + c.color) : '';
  var ico = wpEsc((c.name || '?').slice(0, 1).toUpperCase());
  var img = wpIconUrl(c);
  var on = wpContextActive(c) ? ' active' : '';
  return '<button class="wave-cat wave-ctx-chip' + on + '" data-wpctx="' + i + '" title="' + wpEsc(c.name) + '"><span class="wave-ctx-mini"' + (color ? ' style="background:' + color + '"' : '') + '>' + (img ? '<img src="' + wpEsc(img) + '" alt="" loading="lazy">' : ico) + '</span>' + wpEsc(c.name) + '</button>';
}
function wpCachedContexts(){
  try { var a = JSON.parse(localStorage.getItem('tapWaveContexts') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function wpSaveContexts(list){ try { if (list && list.length) localStorage.setItem('tapWaveContexts', JSON.stringify(list)); } catch (e) { console.warn('Тапёр: не сохранились контексты волны', e); } }
function wpMyWaveCard(){
  var on = (typeof isMyWave === 'function' && isMyWave()) ? ' active' : '';
  return '<button class="wave-cat wave-ctx-chip wave-my' + on + '" data-wpmy="1" title="Моя волна Яндекса">' +
    '<span class="wave-ctx-mini" style="background:var(--pri)">М</span>Моя волна</button>';
}
function wpRenderContexts(){
  var box = document.getElementById('wpCtx'); if (!box) return;
  var my = wpMyWaveCard();
  if (!ymLoggedIn) { box.innerHTML = my + '<div class="wave-empty">Войди в Яндекс — и здесь появятся варианты.</div>'; return; }
  if (!wpCtxData || !wpCtxData.length) { box.innerHTML = my + '<div class="wave-empty">Яндекс пока не прислал варианты. Нажми «Обновить».</div>'; return; }
  box.innerHTML = my + wpCtxData.slice(0, 12).map(wpContextCard).join('');
}
// Общая загрузка вариантов для «Для вас» и «Что играет»: один запрос на всех, один кэш.
function wpEnsureContexts(force){
  if (wpCtxPromise) return wpCtxPromise;
  if (!force && wpCtxData && wpCtxData.length) return Promise.resolve({ list: wpCtxData, changed: false });
  if (!force && !wpCtxData) {
    var cached = wpCachedContexts();
    if (cached.length) { wpCtxData = wpContextsPick(cached); wpRenderContexts(); }
  }
  if (!A.ymWaveContexts) { wpCtxData = wpCtxData || []; return Promise.resolve({ list: wpCtxData, changed: false }); }
  wpCtxLoading = true;
  wpCtxPromise = (async function(){
    try {
      var seeds = (bgSel && bgSel.kind === 'wave' && bgSel.seeds && bgSel.seeds.length) ? bgSel.seeds : undefined;
      var r = await A.ymWaveContexts(seeds);
      var list = wpContextsPick((r && r.contexts) || []);
      var sig = JSON.stringify(list.map(function(x){ return x.name + '|' + x.station; }));
      if (force && list.length && sig === wpCtxSig) list = list.slice().sort(function(){ return Math.random() - .5; });
      var changed = sig !== wpCtxSig;
      wpCtxData = list; wpCtxSig = sig;
      wpSaveContexts(list);
      return { list: list, changed: changed };
    } catch (e) {
      if (!wpCtxData || !wpCtxData.length) wpCtxData = wpContextsPick(wpCachedContexts());
      return { list: wpCtxData || [], changed: false, error: true };
    } finally { wpCtxLoading = false; wpCtxPromise = null; }
  })();
  return wpCtxPromise;
}
async function wpLoadContexts(force){
  if (!force && wpCtxData && wpCtxData.length) { wpRenderContexts(); return; }
  var box = document.getElementById('wpCtx'); if (box) box.innerHTML = '<div class="wave-empty">Загружаю варианты…</div>';
  var res = await wpEnsureContexts(force);
  wpRenderContexts();
  if (typeof renderVariants === 'function') renderVariants();
  if (force) toast(res && res.changed ? 'Варианты обновлены' : 'Яндекс не прислал новые варианты');
}
function wpStartContext(c){
  if (!c) return;
  setBg({ kind: 'wave', station: c.station || (c.seeds && c.seeds[0]) || 'user:onyourwave', seeds: c.seeds && c.seeds.length ? c.seeds : undefined, name: c.name || 'Волна' }, true);
  renderWavePage();
}
var wpExpanded = {};
function wpStationId(name){
  var s = (stations || []).find(function(x){ return x.name === name; });
  return s ? s.id : '';
}
function wpCatBtn(name, cls){
  var id = wpStationId(name);
  if (!id) return '';
  var on = !!(bgSel && bgSel.kind === 'wave' && !bgSel.seeds && bgSel.station === id);
  return '<button class="wave-cat ' + (cls || '') + (on ? ' active' : '') + '" data-wpst="' + wpEsc(id) + '" data-wpn="' + wpEsc(name) + '">' + wpEsc(name) + '</button>';
}
function wpAxisBlock(title, names){
  var chips = names.map(function(n){ return wpCatBtn(n); }).join('');
  if (!chips) return '';
  return '<div class="wave-dir"><div class="wave-group-h"><b>' + title + '</b><span>' + names.length + '</span></div><div class="wave-genres">' + chips + '</div></div>';
}
function wpDirBlock(d){
  var genres = (d.genres || []).map(function(n){ return wpCatBtn(n); }).join('');
  var subs = (d.subs || []).map(function(n){ return wpCatBtn(n, 'sub'); }).join('');
  if (!genres && !subs) return '';
  var expanded = !!wpExpanded[d.id];
  var out = '<div class="wave-dir"><div class="wave-group-h"><b>' + wpEsc(d.title) + '</b><span>' +
    (d.genres || []).length + ' ' + wpPlural((d.genres || []).length, 'жанр', 'жанра', 'жанров') + ((d.subs || []).length ? ' · ' + d.subs.length + ' ' + wpPlural(d.subs.length, 'поджанр', 'поджанра', 'поджанров') : '') + '</span></div>' +
    '<div class="wave-genres">' + genres + '</div>';
  if ((d.subs || []).length) {
    out += '<button class="wave-more" data-wpm="' + wpEsc(d.id) + '">' + (expanded ? 'Свернуть поджанры' : 'Ещё ' + d.subs.length + ' ' + wpPlural(d.subs.length, 'поджанр', 'поджанра', 'поджанров')) + '</button>' +
      '<div class="wave-subs"' + (expanded ? '' : ' hidden') + '>' + subs + '</div>';
  }
  return out + '</div>';
}
function wpRenderCats(){
  var box = document.getElementById('wpCats'); if (!box) return;
  if (!ymLoggedIn) {
    box.innerHTML = '<div class="wave-dir wave-foryou"><div class="wave-group-h"><b>Для вас</b><span>персональные варианты</span></div><div id="wpCtx" class="wave-genres">' +
      wpMyWaveCard() + '<div class="wave-empty">Войди в Яндекс — появятся варианты.</div></div></div>';
    return;
  }
  var html = '<div class="wave-dir wave-foryou"><div class="wave-group-h"><b>Для вас</b><span>персональные варианты</span></div><div id="wpCtx" class="wave-genres"><div class="wave-empty">Загружаю варианты…</div></div><button class="wave-more" id="wpRefresh">Обновить</button></div>';
  var axes = [
    ['mood', 'Настроение'],
    ['activity', 'Занятия'],
    ['epoch', 'Эпохи'],
    ['tempo', 'Темп']
  ];
  axes.forEach(function(a){
    var names = (stations || []).filter(function(s){ return s.type === a[0]; }).map(function(s){ return s.name; });
    html += wpAxisBlock(a[1], names);
  });
  var dirs = (typeof WP_TAXONOMY !== 'undefined') ? WP_TAXONOMY : [];
  dirs.forEach(function(d){ html += wpDirBlock(d); });
  box.innerHTML = html || '<span class="wave-empty">Станции пока не загрузились.</span>';
  wpRenderContexts();
}
function wavePageOpen(){
  renderWavePage();
  wpRenderCats();
  if (ymLoggedIn) wpLoadContexts(false); else wpRenderContexts();
}
function wavePageInit(){
  var v = document.getElementById('viewWave'); if (!v) return;
  var play = document.getElementById('wpPlay');
  if (play) play.onclick = function(){ var b = document.getElementById('wavePlay'); if (b) b.click(); };
  var shake = document.getElementById('wpShake');
  if (shake) shake.onclick = function(){ startBg(); };
  [['wpDiv','diversity','waveDiv'],['wpMood','mood','waveMood'],['wpLang','language','waveLang']].forEach(function(pair){
    var root = document.getElementById(pair[0]); if (!root) return;
    root.addEventListener('click', function(e){
      var b = e.target.closest('.wchip'); if (!b) return;
      var src = document.querySelector('#' + pair[2] + ' .wchip[data-v="' + b.dataset.v + '"]');
      if (src) src.click();
    });
  });
  var ctx = document.getElementById('wpCtx');
  if (ctx) ctx.addEventListener('click', function(e){
    var b = e.target.closest('[data-wpctx]'); if (!b) return;
    var i = +b.dataset.wpctx; if (wpCtxData && wpCtxData[i]) wpStartContext(wpCtxData[i]);
  });
  var cats = document.getElementById('wpCats');
  if (cats) cats.addEventListener('click', function(e){
    var my = e.target.closest('[data-wpmy]');
    if (my) {
      if (!ymLoggedIn) { toast('Для волны нужен вход в Яндекс', 'Войти', browserLogin); return; }
      setBg({ kind: 'wave', station: 'user:onyourwave', name: 'Моя волна' }, true);
      renderWavePage();
      return;
    }
    var ref = e.target.closest('#wpRefresh');
    if (ref) { wpLoadContexts(true); return; }
    var ctx = e.target.closest('[data-wpctx]');
    if (ctx) {
      var ci = +ctx.dataset.wpctx;
      if (wpCtxData && wpCtxData[ci]) wpStartContext(wpCtxData[ci]);
      return;
    }
    var more = e.target.closest('[data-wpm]');
    if (more) {
      var id = more.dataset.wpm; wpExpanded[id] = !wpExpanded[id]; wpRenderCats(); return;
    }
    var b = e.target.closest('[data-wpst]'); if (!b) return;
    setBg({ kind: 'wave', station: b.dataset.wpst, name: b.dataset.wpn }, true);
    renderWavePage();
  });
  var go = document.getElementById('wpSeedGo');
  if (go) go.onclick = async function(){
    var q = (document.getElementById('wpSeed') || {}).value || '';
    q = q.trim(); if (!q) return;
    if (!ymLoggedIn) { toast('Для волны нужен вход в Яндекс', 'Войти', browserLogin); return; }
    try {
      var r = await A.ymSearch(q); var tr = ((r && r.tracks) || []).filter(function(x){ return x.albumId; })[0];
      if (!tr) { toast('Ничего не нашлось в Яндексе'); return; }
      waveByTrack(tr);
    } catch (e) { toast('Не удалось найти трек'); }
  };
  renderWavePage();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wavePageInit);
else wavePageInit();
