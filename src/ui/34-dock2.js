// ===== Вторая док-панель OBS — «Пульт плейлиста» (DK1) =====
// Окно собирает снимок очереди (формат docs/DOCK2.md), шлёт его узлу и выполняет команды
// пульта существующими функциями очереди и поиска. Вкладку «Поиск» и её выдачу не трогаем.
var D2 = { viewers: 0, timer: null, sig: '', lastAt: 0, res: {} /* r → трек */, resOrder: [] };
D2.ban = false;
D2.seq = 0;
D2.rseq = 0;
D2.url = '';

var D2_THEME_VARS = ['bg00', 'bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'ln', 'ln2', 'ln3', 'tx', 'tx2', 'tx3', 'tx4', 'tx5',
  'ac', 'ac2', 'acr', 'acbg', 'pri', 'prit', 'hov', 'req', 'req-cmd', 'req-pts', 'ok', 'warn'];
var D2_YT_GRACE = 1200, D2_SRC_MAX = 8000;

function d2Thumb(u){
  u = String(u || '');
  return /^https?:\/\//i.test(u) || u.indexOf('/lcover/') === 0 ? u : '';
}
function d2Key(v){ return srcOf(v) + ':' + v.id; }

// Оформление — теми же функциями, что у первой панели (13-widget.js не меняем)
function d2Look(){
  var lk = WG.look || 'current';
  var DOCK_LOOK = {
    'skin:dos': 'pixel-skin skin-dos', 'skin:crt': 'pixel-skin skin-crt', 'skin:retro': 'pixel-skin skin-retro'
  };
  var look = lk.indexOf('theme:') === 0 ? widgetThemeLook(lk.slice(6)) : null;
  var yamiId = lk.indexOf('yami:') === 0 ? lk.slice(5) : '';
  var htmlClass = document.documentElement.className;
  var htmlStyle = document.documentElement.getAttribute('style') || '';
  return {
    cls: yamiId ? ('yami yami-' + yamiId) : (lk === 'current' ? (htmlClass || '') : (look ? look.cls : (DOCK_LOOK[lk] || ''))),
    style: yamiId ? yamiVars(yamiId) : (lk === 'current' ? (htmlStyle || '') : (look ? look.vars : ''))
  };
}
// theme.vars — готовые цвета: из объявлений в look.style (тема/Yami), иначе из вычисленных переменных
function d2Theme(look){
  var vars = {}, i, k, x, m, re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g;
  if (look.style && look.style.indexOf('--') >= 0) {
    while ((m = re.exec(look.style))) vars[m[1]] = m[2].trim();
  }
  var cs = getComputedStyle(document.documentElement);
  for (i = 0; i < D2_THEME_VARS.length; i++) {
    k = '--' + D2_THEME_VARS[i];
    if (vars[k]) continue;
    x = (cs.getPropertyValue(k) || '').trim();
    if (x) vars[k] = x;
  }
  return { vars: vars, light: document.documentElement.classList.contains('theme-light') };
}

function dock2Snapshot(){
  try {
    var items = [], pending = 0, played = 0, i, v, wid, cls, pend, isCur, nxAt;
    for (i = 0; i < queue.length; i++) {
      v = queue[i] || {};
      isCur = i === current;
      wid = spKeyOf(v);
      cls = isClassic() || !!wid;
      pend = cls ? i > current : i > current && !v.played;
      if (i > current && !v.played) pending++;
      else if (v.played && i !== current) played++;
      nxAt = v.req ? afterCur() : reqInsertAt('next');
      items.push({
        i: i,
        key: d2Key(v),
        title: v.title || '',
        artist: v.author || v.artist || '',
        src: srcOf(v),
        srcName: srcName(v),
        dur: v.duration || '',
        thumb: d2Thumb(v.thumb),
        st: isCur ? 'playing' : (v.played && !cls ? 'done' : (pend ? 'pend' : '')),
        bg: !!v.bg,
        req: v.req ? { kind: reqKind(v), who: v.req.who, sb: isSbReq(v) } : null,
        ban: !!(D2.ban && isBotReq(v) && (pend || isCur)),
        canNext: !!(pend && i !== afterCur() && !(i < nxAt && !v.req)),
        book: wid || null
      });
    }
    var m = master();
    var pos = m ? Number(m.currentTime) : 0, dur = m ? Number(m.duration) : 0;
    if (!isFinite(pos)) pos = 0;
    if (!isFinite(dur)) dur = 0;
    var nowV = queue[current];
    var look = d2Look();
    var theme = d2Theme(look);
    var after = isClassic() ? [] : (typeof bgPreview === 'function' ? (bgPreview() || []) : []).slice(0, 10).map(function(t){
      return { key: d2Key(t), title: t.title || '', artist: t.author || t.artist || '', thumb: d2Thumb(t.thumb) };
    });
    var wt = $('waveTitle'), ws = $('waveSub'), wtg = $('waveToggle');
    return {
      v: 1,
      at: Date.now(),
      mode: isClassic() ? 'classic' : 'live',
      cur: current,
      np: {
        title: nowV ? (nowV.title || '') : '',
        artist: nowV ? (nowV.author || nowV.artist || '') : '',
        playing: !!nowV && !document.body.classList.contains('is-paused'),
        pos: pos,
        dur: dur
      },
      items: items,
      after: after,
      wave: {
        title: wt ? (wt.textContent || '') : '',
        sub: ws ? (ws.textContent || '') : '',
        auto: !!(wtg && wtg.classList.contains('on'))
      },
      counts: { pending: pending, played: played },
      opts: { ban: !!D2.ban, banMin: (typeof BOT_BAN_MIN !== 'undefined' && BOT_BAN_MIN) || 10 },
      look: { cls: look.cls, style: look.style, scale: WG.scale || 100 },
      theme: theme
    };
  } catch (e) {
    if (typeof axLog === 'function') axLog('док2: ' + (e && e.message));
    return null;
  }
}

function d2Sig(snap){
  return JSON.stringify({
    v: snap.v, mode: snap.mode, cur: snap.cur,
    np: { title: snap.np.title, artist: snap.np.artist, playing: snap.np.playing, dur: snap.np.dur },
    items: snap.items, after: snap.after, wave: snap.wave, counts: snap.counts,
    opts: snap.opts, look: snap.look, theme: snap.theme
  });
}

function d2StopTimer(){ if (D2.timer) { clearInterval(D2.timer); D2.timer = null; } }
function d2StartTimer(){
  d2StopTimer();
  D2.timer = setInterval(function(){ dock2Push(false); }, 600);
}

function dock2Push(force){
  if (!D2.viewers) return;
  if (!A.dock2Push) return;
  try {
    var snap = dock2Snapshot();
    if (!snap) return;
    var sig = d2Sig(snap), t = Date.now();
    if (!force && sig === D2.sig && (t - D2.lastAt) < 5000) return;
    D2.sig = sig;
    D2.lastAt = t;
    A.dock2Push(snap);
  } catch (e) {
    if (typeof axLog === 'function') axLog('док2: ' + (e && e.message));
  }
}

// ===== Поиск для панели: только треки, без вмешательства во вкладку «Поиск» =====
function d2Cap(p, ms){
  return new Promise(function(res){
    var done = false;
    var t = setTimeout(function(){ if (done) return; done = true; res(null); }, ms);
    Promise.resolve(p).then(function(v){ if (done) return; done = true; clearTimeout(t); res(v); },
      function(){ if (done) return; done = true; clearTimeout(t); res(null); });
  });
}
function d2Rank(q, lists){
  var list = [], seen = {}, i, j, arr, v, k, out;
  for (i = 0; i < lists.length; i++) {
    arr = lists[i] || [];
    for (j = 0; j < arr.length; j++) {
      v = arr[j];
      if (!v || v.speech) continue;
      k = srcOf(v) + ':' + v.id;
      if (seen[k]) continue;
      seen[k] = 1;
      list.push(v);
    }
  }
  out = list;
  if (window.TapRank && TapRank.rank) {
    try { out = TapRank.rank(q, list, searchMode, rankCtx()); } catch (e) { out = list; }
  }
  return out;   // вся выдача; страницами по 15 её отдаёт d2SearchSend / команда more (16.11)
}
var D2_PAGE = 15;
function d2Send(evt){
  try { if (A.dock2Event) A.dock2Event(evt); } catch (e) {}
}
function d2SearchSend(id, q, done, list, from){
  from = from || 0;
  list = list || [];
  if (!from) D2.full = { id: id, q: q, done: !!done, list: list };   // для «ещё» при прокрутке
  var page = list.slice(from, from + D2_PAGE);
  var items = page.map(function(v){
    D2.rseq++;
    var r = 'r' + D2.rseq.toString(36) + Math.random().toString(36).slice(2, 10);
    D2.res[r] = v;
    return { r: r, title: v.title || '', artist: v.author || v.artist || '', src: srcOf(v), srcName: srcName(v), dur: v.duration || '', thumb: d2Thumb(v.thumb) };
  });
  D2.resOrder.push(items.map(function(x){ return x.r; }));
  while (D2.resOrder.length > 16) {     // ~ несколько выдач с подгрузкой: «+ В очередь» работает и на первых страницах
    (D2.resOrder.shift() || []).forEach(function(k){ delete D2.res[k]; });
  }
  d2Send({ ev: 'search', id: id, q: q, done: !!done, items: items, more: from > 0, from: from, total: list.length });
}
// Следующая страница выдачи (прокрутка до конца на телефоне / в панели)
function d2SearchMore(id, n){
  var f = D2.full;
  if (!f || f.id !== String(id == null ? '' : id)) return;
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n >= f.list.length) return;
  d2SearchSend(f.id, f.q, f.done, f.list, n);
}
function dock2Search(q, id){
  q = String(q == null ? '' : q).trim().slice(0, 200);
  id = String(id == null ? '' : id).slice(0, 40);
  var seq = ++D2.seq;
  if (!q || isLink(q) || isDebugCommand(q)) { d2SearchSend(id, q, true, []); return; }
  var st = { ym: [], yt: [], sc: [], au: [], lc: [] }, got = {};
  function src(k, p, pick){
    return d2Cap(Promise.resolve(p).then(function(r){ return pick ? pick(r) : r; }), D2_SRC_MAX).then(function(r){
      got[k] = 1;
      st[k] = Array.isArray(r) ? r : [];
      return st[k];
    });
  }
  function joined(){
    var out = [];
    ['ym', 'yt', 'sc', 'au', 'lc'].forEach(function(k){ if (got[k]) out = out.concat(st[k]); });
    return out;
  }
  var ymP = src('ym', (SVC.ymOn !== false && A.ymSearch) ? A.ymSearch(q) : null, function(r){ return (r && r.tracks) || []; });
  var ytP = src('yt', (ytUsable() && SVC.ytOn && A.ytSearch) ? A.ytSearch(q) : null, function(r){
    return ((r && r.videos) || []).map(function(v){ v.src = 'yt'; return v; });
  });
  var scP = src('sc', (SVC.scOn && A.scSearch) ? A.scSearch(q, 15) : null);
  var auP = src('au', (SVC.auOn && A.auSearch) ? A.auSearch(q, 10) : null);
  var lcP = src('lc', (A.libSearch && LIB.count) ? A.libSearch(q, 30) : null);
  // Первое событие — как только ответили Яндекс и YouTube (YouTube ждём не дольше 1,2 с).
  // Второе ждёт первое: порядок событий для панели важен (done:false, затем done:true).
  var ytQuick = Promise.race([ytP, new Promise(function(r){ setTimeout(function(){ r('late'); }, D2_YT_GRACE); })]);
  Promise.all([ymP, ytQuick]).then(function(){
    if (seq !== D2.seq) return;
    d2SearchSend(id, q, false, d2Rank(q, [joined()]));
    return Promise.all([ymP, ytP, scP, auP, lcP]);
  }).then(function(){
    if (seq !== D2.seq) return;
    // Второе — когда ответили все (каждый источник — не дольше 8 с)
    d2SearchSend(id, q, true, d2Rank(q, [joined()]));
  });
}

// ===== Команды пульта =====
function d2Miss(){
  d2Send({ ev: 'toast', text: 'Очередь изменилась — повтори' });
  dock2Push(true);
}
function d2Check(cmd){
  var i = Number(cmd && cmd.i);
  if (!isFinite(i) || Math.floor(i) !== i || i < 0 || i >= queue.length) return null;
  if (d2Key(queue[i]) !== String(cmd.key == null ? '' : cmd.key)) return null;
  return queue[i];
}
function d2Run(cmd){
  var c = String(cmd.c || ''), v, i, j, to, min, wasCur;
  if (c === 'play') {
    v = d2Check(cmd); if (!v) { d2Miss(); return; }
    playQueueItem(Number(cmd.i));
  } else if (c === 'remove') {
    v = d2Check(cmd); if (!v) { d2Miss(); return; }
    removeAt(Number(cmd.i));
  } else if (c === 'ban') {
    v = d2Check(cmd); if (!v) { d2Miss(); return; }
    if (!D2.ban || !isBotReq(v)) return;
    i = Number(cmd.i);
    min = (typeof BOT_BAN_MIN !== 'undefined' && BOT_BAN_MIN) || 10;
    wasCur = i === current;
    botBan(v, min);
    j = queue.indexOf(v); if (j >= 0) removeAt(j);
    toast((wasCur ? 'Пропустил' : 'Убрал') + '. ' + (v.req.who || '') + ' — тайм-аут на заказы');
  } else if (c === 'next') {
    v = d2Check(cmd); if (!v) { d2Miss(); return; }
    i = Number(cmd.i);
    to = v.req ? afterCur() : reqInsertAt('next');
    if (i > current && !v.played && i !== afterCur() && !(i < to && !v.req)) moveItem(i, to);
  } else if (c === 'move') {
    v = d2Check(cmd); if (!v) { d2Miss(); return; }
    to = Number(cmd.to);
    if (!isFinite(to) || Math.floor(to) !== to || to < 0 || to > queue.length) return;
    moveItem(Number(cmd.i), to);
  } else if (c === 'mode') {
    if (cmd.m === 'classic' || cmd.m === 'live') setQueueMode(cmd.m);
  } else if (c === 'wave') {
    var wb = cmd.a === 'play' ? $('wavePlay') : (cmd.a === 'auto' ? $('waveToggle') : null);
    if (wb) wb.click();
  } else if (c === 'waveat') {
    // «Дальше в волне»: включить трек из волны — как нажатие на строку в окне (playWaveAt). Проверка ключа:
    // волна могла обновиться, пока нажимали.
    var wl = isClassic() || typeof bgPreview !== 'function' ? [] : (bgPreview() || []);
    var wj = Number(cmd.j);
    if (!wl[wj] || d2Key(wl[wj]) !== String(cmd.key == null ? '' : cmd.key)) { d2Miss(); return; }
    if (typeof playWaveAt === 'function') playWaveAt(wj);
  } else if (c === 'tr') {
    var tb = cmd.a === 'prev' ? $('prev') : (cmd.a === 'next' ? $('next') : (cmd.a === 'playpause' ? $('playpause') : null));
    if (tb) tb.click();
  } else if (c === 'search') {
    dock2Search(cmd.q, cmd.id);
  } else if (c === 'more') {
    d2SearchMore(cmd.id, cmd.from);
  } else if (c === 'add' || c === 'playnow') {
    v = D2.res[String(cmd.r == null ? '' : cmd.r)];
    if (!v) return;
    if (c === 'add') addToQueue(v); else playNow(v);
  }
}

function d2Viewers(n){
  n = Number(n) || 0;
  var was = D2.viewers;
  D2.viewers = n;
  if (n > 0 && !(was > 0)) { dock2Push(true); d2StartTimer(); }
  else if (!n) d2StopTimer();
}
if (A.onDock2Clients) A.onDock2Clients(d2Viewers);
// A38 H1: после перезагрузки окна (сторож) или раннего подключения OBS событие «изменилось» уже прошло — спросить самим
if (A.dock2Viewers) A.dock2Viewers().then(d2Viewers).catch(function(){});
if (A.onDock2Cmd) A.onDock2Cmd(function(cmd){
  if (!cmd || typeof cmd !== 'object') return;
  try { d2Run(cmd); } catch (e) { if (typeof axLog === 'function') axLog('док2: ' + (e && e.message)); }
  setTimeout(function(){ dock2Push(true); }, 120);
});

// ===== Карточка в «Настройки → OBS и стрим» =====
(function d2InitCard(){
  var urlEl = $('d2Url'), copyBtn = $('d2Copy'), openBtn = $('d2Open'), banBtn = $('d2Ban');
  if (A.dock2Url) A.dock2Url().then(function(u){ D2.url = u || ''; if (urlEl) urlEl.textContent = D2.url || 'нет адреса'; });
  if (A.getSetting) A.getSetting('dock2Ban').then(function(v){ D2.ban = !!v; if (banBtn) setTg(banBtn, D2.ban); });
  if (banBtn) banBtn.onclick = function(){
    D2.ban = !D2.ban;
    setTg(banBtn, D2.ban);
    if (A.setSetting) A.setSetting('dock2Ban', D2.ban);
    dock2Push(true);
  };
  if (copyBtn) copyBtn.onclick = function(){
    if (!D2.url) return;
    navigator.clipboard.writeText(D2.url).then(function(){ toast('Адрес пульта скопирован'); })
      .catch(function(){ prompt('Скопируй адрес:', D2.url); });
  };
  // A38 M2: общий openExternal пропускает только https — свою страницу открывает главный процесс
  if (openBtn) openBtn.onclick = function(){
    if (!D2.url) return;
    var p = A.dock2Open ? A.dock2Open() : Promise.resolve(false);
    p.then(function(ok){ if (!ok) toast('Не удалось открыть — скопируй адрес и открой в браузере'); }).catch(function(){});
  };
})();
