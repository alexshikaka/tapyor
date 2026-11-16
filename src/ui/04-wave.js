  // ===== Фон: «Моя волна», другая волна или плейлист =====
  var waveCfg = { on: true, mood: 'all', diversity: 'default', language: 'any', plsShuffle: true };
  var MY_WAVE = { kind: 'wave', station: 'user:onyourwave', name: 'Моя волна' };
  var bgSel = MY_WAVE;
  var bgOn = false;        // фон сейчас идёт (или шёл до заказов) — продолжить после них
  var bgPending = false;   // фон выбрали, пока играл заказ — включить, когда заказы доиграют
  var waveBuf = [], waveStarting = false, bgToken = 0, ymLoggedIn = false, bgNeedStart = true;
  var stations = [], variants = { loaded: false }, genresOpen = false;
  var MOOD_NAMES = { all: 'любое настроение', active: 'бодрое', fun: 'весёлое', calm: 'спокойное', sad: 'грустное' };
  var DIV_NAMES = { 'default': 'любой характер', favorite: 'любимое', discover: 'незнакомое', popular: 'популярное' };
  var LANG_NAMES = { any: '', russian: 'на русском', 'not-russian': 'иностранное', 'without-words': 'без слов' };
  var TYPE_NAMES = { genre: 'жанр', mood: 'настроение', activity: 'занятие', epoch: 'эпоха', local: 'местное', personal: 'для вас', author: 'артист', editorial: 'подборка' };
  // Последний полученный список станций: при обрыве сети теги не должны исчезать.
  function cachedStations(){
    try { var a = JSON.parse(localStorage.getItem('tapWaveStations') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveCachedStations(list){
    try { if (list && list.length) localStorage.setItem('tapWaveStations', JSON.stringify(list)); } catch (e) { console.warn('Тапёр: не сохранились станции волны', e); }
  }
  function useCachedStations(){
    if (stations.length) return;
    var a = cachedStations();
    if (!a.length) return;
    stations = a;
    if (typeof renderGenres === 'function') renderGenres();
    if (typeof renderWavePage === 'function') renderWavePage();
  }
  var PALETTE = ['#C23A5C', '#C46A20', '#A03A94', '#3D55C4', '#2E8C6A', '#8C6A2E', '#5A4AC4', '#B04848'];
  function colorFor(name, c){ if (c && /^#?[0-9a-f]{6}$/i.test(c)) return c[0] === '#' ? c : '#' + c; var h = 0; String(name).split('').forEach(function (ch){ h = (h * 31 + ch.charCodeAt(0)) | 0; }); return PALETTE[Math.abs(h) % PALETTE.length]; }

  function bgId(b){ return b.kind === 'list' ? 'list:' + listId(b.list) : 'wave:' + (b.seeds ? b.seeds.join(',') : b.station); }
  function isMyWave(){ return bgSel.kind === 'wave' && !bgSel.seeds && bgSel.station === 'user:onyourwave'; }
  function bgTitle(){
    if (bgSel.kind === 'list') return 'Фон: ' + bgSel.list.title;
    if (isMyWave()) return 'Моя волна';
    return 'Волна: ' + bgSel.name;
  }
  function bgLabel(){ return bgSel.kind === 'list' ? 'Фон' : (isMyWave() ? 'Моя волна' : 'Волна «' + bgSel.name + '»'); }
  function waveOpts(){ return { station: bgSel.station, seeds: bgSel.seeds, mood: waveCfg.mood, diversity: waveCfg.diversity, language: waveCfg.language }; }
  function saveWaveCfg(){
    if (!A.setSetting) return;
    A.setSetting('wave', waveCfg);
    if (bgSel.kind === 'wave') A.setSetting('bgWave', { station: bgSel.station, seeds: bgSel.seeds || null, name: bgSel.name });
  }
  function shuffled(a){ a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function listOrder(){ var t = (bgSel.list && bgSel.list.tracks) || []; return bgSel.shuffle ? shuffled(t) : t.slice(); }

  // Выбрать фон. now=true — включить сразу, если не играет заказ (иначе — после заказов)
  var lastWave = MY_WAVE; // какая волна была до плейлиста — к ней вернёмся, если трогают настройки волны
  function setBg(b, now){
    if (b.kind === 'wave') lastWave = b;
    var changed = bgId(b) !== bgId(bgSel) || (b.kind === 'list' && b.shuffle !== bgSel.shuffle);
    bgSel = b;
    if (changed) { waveBuf = []; bgToken++; bgNeedStart = true; }
    saveWaveCfg(); renderWaveUi(); renderVariants(); if (changed) renderQueue();
    if (!now) return;
    startBg(); // выбрал — играет сразу; несыгранные заказы встанут под него
  }
  async function fillBg(){
    if (bgSel.kind === 'list') { waveBuf = listOrder(); return waveBuf.length ? null : 'плейлист пуст'; }
    if (!ymLoggedIn) return 'для волны войди в Яндекс (кнопка вверху)';
    var tok = ++bgToken;
    var last = null;
    for (var k = queue.length - 1; k >= 0; k--) if (queue[k].bg) { last = queue[k]; break; }
    var fresh = bgNeedStart || !last;
    bgNeedStart = false;
    var r = fresh ? await A.ymWaveStart(waveOpts()) : await A.ymWaveMore(ymKey(last));
    if (tok !== bgToken) return 'отменено';
    if ((!r || !r.tracks || !r.tracks.length) && !fresh) r = await A.ymWaveStart(waveOpts()); // сессия устарела — начнём заново
    if (tok !== bgToken) return 'отменено';
    if (!r || r.error) return (r && r.error) || 'волна не запустилась';
    waveBuf = r.tracks || [];
    return waveBuf.length ? null : 'волна не прислала треков';
  }
  async function startBg(){
    if (waveStarting) return;
    waveStarting = true; setSub('Включаю «' + bgTitle() + '»…');
    waveBuf = [];
    var err = bgSel.kind === 'wave' ? await (async function(){ if (!ymLoggedIn) return 'для волны войди в Яндекс (кнопка вверху)'; var tok = ++bgToken; bgNeedStart = false; var r = await A.ymWaveStart(waveOpts()); if (tok !== bgToken) return 'отменено'; if (!r || r.error) return (r && r.error) || 'волна не запустилась'; waveBuf = r.tracks || []; return waveBuf.length ? null : 'волна не прислала треков'; })() : await fillBg();
    waveStarting = false;
    if (err) { if (err !== 'отменено') setErr('⚠ ' + err); return; }
    bgOn = true; bgPending = false;
    placeBgNow(waveBuf.shift());
  }
  // Включаем фон сейчас: все активные треки очереди становятся сыгранными,
  // трек фона встаёт после них и играет; очередь не оставляет «ждущих» под фоном
  function placeBgNow(t){
    if (!t) return;
    if (isClassic()) { classicReplace(t); return; }
    var item = copyTrack(t); item.bg = true;
    var cut = afterCur(); // играет книга — она остаётся целиком в отыгравшем
    var head = queue.slice(0, cut), tail = queue.slice(cut);
    tail.forEach(function (v){ v.played = true; });
    queue = head.concat(tail, [item]);
    playIndex(head.length + tail.length);
  }
  // Классика: «Волна» / «Играть» заменяют плейлист. Играющий обрывается, первый трек нового
  // плейлиста играет сразу, ждущие заказы встают сразу под ним, дальше — остальное.
  // Сыгранное из очереди уходит (оно уже записано во вкладке «История»).
  function classicReplace(t){
    var greens = queue.filter(function (v, idx){ return idx > current && v.req && !v.played; });
    var first = copyTrack(t); first.bg = true;
    queue = [first].concat(greens); current = -1;
    classicDrain(true);
    playIndex(0);
  }
  // Переносим треки фона из буфера в конец плейлиста. Плейлист — целиком; волна — так,
  // чтобы впереди было около 10 треков (она бесконечна). Видимые строки не трогаем: после
  // пропуска Яндекс пересобирает только буфер, новое дописывается в конец.
  function classicDrain(force){
    if (!isClassic() || !waveBuf.length) return;
    if (!force && !(bgOn && queue[current] && queue[current].bg)) return;
    if (bgSel.kind === 'list') { waveBuf.forEach(function (x){ var c = copyTrack(x); c.bg = true; queue.push(c); }); waveBuf = []; }
    else while (waveBuf.length && queue.length - 1 - current < WAVE_AHEAD) { var c = copyTrack(waveBuf.shift()); c.bg = true; queue.push(c); }
    renderQueue(); saveToday();
  }
  async function playBgNext(){
    if (waveStarting) return;
    if (!waveBuf.length) {
      waveStarting = true;
      var err = await fillBg();
      waveStarting = false;
      if (err) { if (err !== 'отменено') { setErr('⚠ ' + err); bgOn = false; renderWaveUi(); } return; }
    }
    bgOn = true; bgPending = false;
    playBgTrack(waveBuf.shift(), false);
  }
  function playBgTrack(t, insertNow){
    if (!t) return;
    var item = copyTrack(t); item.bg = true;
    var at = afterCur(); // за всей книгой, если играет книга
    queue.splice(at, 0, item);
    playIndex(at);
  }
  async function refreshWave(){
    if (bgSel.kind !== 'wave') return;
    var tok = ++bgToken;
    var r = await A.ymWaveStart(waveOpts());
    if (tok === bgToken && r && r.tracks && r.tracks.length) { waveBuf = r.tracks; renderQueue(); topUpWave(); }
  }

  // «Волна по треку»: похожее на этот трек (трек не из Яндекса Тапёр сначала находит в Яндексе)
  async function waveByTrack(v){
    if (!v) return;
    if (!ymLoggedIn) { toast('Для волны нужен вход в Яндекс', 'Войти', browserLogin); return; }
    var id = srcOf(v) === 'ym' ? v.id : '';
    if (!id && A.findAlt) {
      toast('Ищу «' + v.title + '» в Яндексе…');
      var r = await A.findAlt(slimForWeb(v), 'ym').catch(function(){ return null; });
      if (r && r.track && (r.status === 'exact' || r.status === 'close')) id = r.track.id;
    }
    if (!id) { toast('Этого трека нет в Яндексе — волну по нему не запустить'); return; }
    var w = { kind: 'wave', station: 'track:' + id, seeds: ['track:' + id], name: 'по треку «' + v.title + '»' };
    var busy = !isClassic() && !isIdle() && !(queue[current] && queue[current].bg);
    if (busy) { setBg(w, false); bgPending = true; renderWaveUi(); toast('Волна по треку «' + v.title + '» — после того, что сейчас играет'); }
    else { setBg(w, true); toast('Волна по треку «' + v.title + '»'); }
  }
  $('waveTrackBtn').onclick = function(){ waveByTrack(curTrack); };
  // «Волна по плейлисту»: плейлист Яндекса — сам плейлист семенем; свой или с YouTube —
  // до пяти песен из него, которые есть в Яндексе. Подчиняется общим настройкам волны.
  function waveByList(L){
    if (!L) return;
    if (!ymLoggedIn) { toast('Для волны нужен вход в Яндекс', 'Войти', browserLogin); return; }
    var seeds = [];
    if (L.src === 'ym' && L.type === 'playlist' && L.uid && L.kind) seeds.push('playlist:' + L.uid + '_' + L.kind);
    else {
      var ym = (L.tracks || []).filter(function (t){ return srcOf(t) === 'ym' && t.id; });
      var step = Math.max(1, Math.floor(ym.length / 5)); // берём песни по всему плейлисту, а не только первые
      for (var k = 0; k < ym.length && seeds.length < 5; k += step) seeds.push('track:' + ym[k].id);
    }
    if (!seeds.length) { toast('В плейлисте нет песен из Яндекса — волну по нему не запустить'); return; }
    var w = { kind: 'wave', station: seeds[0], seeds: seeds, name: 'по плейлисту «' + (L.title || 'плейлист') + '»' };
    var busy = !isClassic() && !isIdle() && !(queue[current] && queue[current].bg);
    if (busy) { setBg(w, false); bgPending = true; renderWaveUi(); toast('Волна по плейлисту «' + (L.title || '') + '» — после того, что сейчас играет'); }
    else { setBg(w, true); toast('Волна по плейлисту «' + (L.title || '') + '»'); }
  }

  // ===== Что сыграет фон: показываем в очереди =====
  // Волна: ~10 треков вперёд; после пропуска или лайка первые 3 остаются, остальное Яндекс подбирает заново.
  // Плейлист фоном: весь оставшийся список.
  var WAVE_AHEAD = 10, WAVE_KEEP = 3, qNextOpen = true, waveTopping = false;
  function bgPreview(){ return (bgSel.kind === 'wave' || bgSel.kind === 'list') ? waveBuf : []; }
  function lastBgTrack(){ if (waveBuf.length) return waveBuf[waveBuf.length - 1]; for (var q = queue.length - 1; q >= 0; q--) if (queue[q].bg) return queue[q]; return null; }
  async function topUpWave(){
    if (waveTopping || bgSel.kind !== 'wave' || !ymLoggedIn || !A.ymWaveMore) return;
    waveTopping = true; var tok = bgToken, added = 0;
    try {
      for (var k = 0; k < 4 && waveBuf.length < WAVE_AHEAD; k++) {
        var last = lastBgTrack(); if (!last) break;
        var r = await A.ymWaveMore(ymKey(last)).catch(function(){ return null; });
        if (tok !== bgToken || bgSel.kind !== 'wave') return;
        var have = {}; waveBuf.concat(queue).forEach(function (t){ have[String(t.id)] = 1; });
        var add = ((r && r.tracks) || []).filter(function (t){ return !have[String(t.id)]; });
        if (!add.length) break;
        waveBuf = waveBuf.concat(add); added += add.length;
      }
    } finally { waveTopping = false; }
    if (added) { renderQueue(); classicDrain(false); }
  }
  var wavePreviewBusy = false;
  // Всегда держим «Дальше в волне» заполненным: неважно, играет фон или нет
  async function ensureWavePreview(){
    if (wavePreviewBusy) return;
    if (bgSel.kind === 'list') { if (!waveBuf.length) { waveBuf = listOrder(); renderQueue(); } return; }
    if (bgSel.kind !== 'wave' || !ymLoggedIn) return;
    wavePreviewBusy = true;
    try {
      if (!waveBuf.length) {
        if (!A.ymWaveStart) return;
        var tok = ++bgToken;
        var r = await A.ymWaveStart(waveOpts());
        if (tok !== bgToken) return;
        if (r && r.tracks) { waveBuf = r.tracks; renderQueue(); }
      }
      if (waveBuf.length < WAVE_AHEAD) topUpWave();
    } finally { wavePreviewBusy = false; }
  }
  function trimWaveTail(){
    if (bgSel.kind !== 'wave') return;
    if (waveBuf.length > WAVE_KEEP) { waveBuf = waveBuf.slice(0, WAVE_KEEP); renderQueue(); }
    topUpWave();
  }
  function playWaveAt(j){
    var t = waveBuf.splice(j, 1)[0];
    if (t) { bgOn = true; bgPending = false; playBgTrack(t); }
  }
  function renderBgPreview(box){
    var list = bgPreview(); if (!list.length) return;
    var isList = bgSel.kind === 'list';
    var wrap = document.createElement('div'); wrap.className = 'qnext';
    var hd = document.createElement('button'); hd.className = 'qn-h'; hd.setAttribute('aria-expanded', qNextOpen ? 'true' : 'false');
    var bgLive = bgOn || bgPending;
    var nowTxt = isList
      ? (bgLive ? 'играет фоном «' : 'выбран фоном «') + (bgSel.list.title || 'плейлист') + '»' + (bgSel.shuffle ? ', вперемешку' : '')
      : (bgLive ? 'играет волна «' : 'выбрана волна «') + (isMyWave() ? 'Моя волна' : bgSel.name) + '»';
    hd.innerHTML = '<span style="flex:0 0 auto">' + (qNextOpen ? '▾ ' : '▸ ') + (isList ? 'Дальше в плейлисте' : 'Дальше в волне') + ' · ' + list.length + '</span><span class="qn-now">— ' + esc(nowTxt) + '</span>';
    hd.title = isList ? 'Весь оставшийся список' : 'Около 10 треков вперёд; после пропуска или лайка Яндекс подбирает их заново';
    hd.onclick = function(){ qNextOpen = !qNextOpen; renderQueue(); };
    wrap.appendChild(hd);
    if (qNextOpen) {
      var max = isList ? 200 : list.length;
      list.slice(0, max).forEach(function (t, j){
        var r = document.createElement('div'); r.className = 'qn-row'; r.dataset.w = j;
        r.draggable = true; r.title = 'Перетащи в очередь или нажми, чтобы включить';
        r.innerHTML = '<div class="qn-c">' + (t.thumb ? '<img src="' + esc(t.thumb) + '" alt="" loading="lazy">' : '') +
          '<span class="qn-ov"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg></span></div>' +
          '<div class="qn-m"><div class="qn-t">' + esc(t.title) + '</div><div class="qn-s">' + esc(t.author || '') + ' · ' + esc(srcName(t)) + '</div></div>';
        r.ondragstart = function(e){ dragWave = j; r.classList.add('dragging'); closeCtx(); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'wave:' + j); } catch (err) {} };
        r.ondragend = function(){ dragWave = -1; r.classList.remove('dragging'); clearDrop(); };
        r.onclick = function(e){ if (e.target.closest('.x')) return; playWaveAt(j); };
        // Кнопки и длина трека — как в самой очереди: блок в конце строки, кнопки по наведению
        var acts = document.createElement('div'); acts.className = 'qact';
        var up = document.createElement('button'); up.className = 'x'; up.title = stOn() ? 'Играть следующим (как заказ)' : 'Играть следующим'; up.setAttribute('aria-label', up.title);
        up.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14M12 20V9M7 13l5-5 5 5"></path></svg>';
        up.onclick = function(e){ e.stopPropagation(); var t2 = waveBuf.splice(j, 1)[0]; if (t2) addNext(t2); topUpWave(); };
        var x = document.createElement('button'); x.className = 'x'; x.title = 'Не играть'; x.setAttribute('aria-label', 'Не играть');
        x.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
        x.onclick = function(e){ e.stopPropagation(); waveBuf.splice(j, 1); renderQueue(); topUpWave(); };
        acts.appendChild(up); acts.appendChild(x);
        var tm = document.createElement('span'); tm.className = 'qtime mono'; tm.textContent = t.duration || '';
        acts.appendChild(tm);
        r.appendChild(acts);
        wrap.appendChild(r);
      });
      if (list.length > max) { var mo = document.createElement('div'); mo.className = 'qn-more'; mo.textContent = '… и ещё ' + (list.length - max); wrap.appendChild(mo); }
    }
    box.appendChild(wrap);
  }

  function showWaveSettings(open){
    var ws = $('waveSettings'), g = $('waveGear');
    ws.hidden = !open;
    g.classList.toggle('open', open);
    g.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) waveTab(bgSel.kind === 'list' ? 'pls' : 'wave');
    if (open && ymLoggedIn && !variants.loaded) loadVariants();
    if (open) renderWavePls();
  }
  // Вкладки панели: «Волна Яндекса» / «Плейлисты фоном»
  function waveTab(t){
    var bs = document.querySelectorAll('#waveSeg [data-wt]');
    for (var k = 0; k < bs.length; k++) { var on = bs[k].dataset.wt === t; bs[k].classList.toggle('on', on); bs[k].setAttribute('aria-selected', on ? 'true' : 'false'); }
    var ps = document.querySelectorAll('#waveSettings [data-wp]');
    for (var j = 0; j < ps.length; j++) ps[j].hidden = ps[j].dataset.wp !== t;
    $('waveScroll').scrollTop = 0;
  }
  $('waveSeg').addEventListener('click', function(e){ var b = e.target.closest('[data-wt]'); if (b) waveTab(b.dataset.wt); });
  function renderPlsShuf(){ setTgEl($('wavePlsShuf'), waveCfg.plsShuffle !== false); }
  function setTgEl(el, on){ el.classList.toggle('on', !!on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  $('wavePlsShuf').onclick = function(){
    waveCfg.plsShuffle = waveCfg.plsShuffle === false; saveWaveCfg(); renderPlsShuf();
    // уже играет плейлист фоном — порядок меняется со следующего трека
    if (bgSel.kind === 'list') {
      bgSel.shuffle = waveCfg.plsShuffle !== false;
      if (!isIdle() || loadingIdx >= 0) { waveBuf = listOrder(); renderQueue(); prefetchNext(); }
      renderWaveUi();
    }
  };
  // «Перемешать заново» — значит, вперемешку
  $('wavePlsShake').onclick = function(){ if (waveCfg.plsShuffle === false) { waveCfg.plsShuffle = true; saveWaveCfg(); renderPlsShuf(); } $('waveShake').onclick(); };
  // Нажатие на строку волны (кроме кнопок ▶ и переключателя) раскрывает/сворачивает настройки
  document.querySelector('#wavecard .whead').addEventListener('click', function(e){
    if (e.target.closest('#wavePlay, #waveToggle')) return;
    showWaveSettings($('waveSettings').hidden);
  });
  // Нажатие мимо карточки волны — настройки сворачиваются
  document.addEventListener('mousedown', function(e){
    if ($('waveSettings').hidden || e.target.closest('#wavecard')) return;
    showWaveSettings(false);
  });
  function renderWaveUi(){
    var tg = $('waveToggle');
    tg.classList.toggle('on', !!waveCfg.on); tg.setAttribute('aria-pressed', waveCfg.on ? 'true' : 'false');
    var st = $('setWaveAuto'); st.classList.toggle('on', !!waveCfg.on); st.setAttribute('aria-pressed', waveCfg.on ? 'true' : 'false');
    [['waveDiv', 'diversity'], ['waveMood', 'mood'], ['waveLang', 'language']].forEach(function (p){
      var bs = document.querySelectorAll('#' + p[0] + ' .wchip');
      for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('active', bs[k].dataset.v === waveCfg[p[1]]);
    });
    var onAir = !!(queue[current] && queue[current].bg && !isIdle()) || !!(loadingIdx >= 0 && queue[loadingIdx] && queue[loadingIdx].bg);
    $('wavecard').classList.toggle('on-air', onAir);
    $('waveTitle').textContent = bgTitle();
    var sub = $('waveSub'), cfgText;
    if (bgSel.kind === 'list') cfgText = (bgSel.shuffle ? 'вперемешку' : 'по порядку') + ' · ' + ((bgSel.list.tracks || []).length) + ' ' + plural((bgSel.list.tracks || []).length);
    else cfgText = DIV_NAMES[waveCfg.diversity] + ', ' + MOOD_NAMES[waveCfg.mood] + (LANG_NAMES[waveCfg.language] ? ', ' + LANG_NAMES[waveCfg.language] : '');
    if (bgSel.kind === 'wave' && !ymLoggedIn) sub.textContent = 'Нужен вход в Яндекс';
    else if (onAir) sub.textContent = 'В эфире · ' + cfgText;
    else if (bgPending) sub.textContent = (stOn() ? 'После заказов · ' : 'После текущего · ') + cfgText;
    else sub.textContent = (waveCfg.on ? (stOn() ? 'После заказов · ' : 'Авто вкл. · ') : 'Авто выкл. · ') + cfgText;
    sub.title = sub.textContent;
    $('wavePlay').textContent = onAir ? '■ Стоп' : '▶ ' + (bgSel.kind === 'list' ? 'Фон' : 'Волна');
    var sk = $('waveShakeT'); if (sk) sk.textContent = bgSel.kind === 'list' ? 'Перемешать плейлист заново (со следующего трека)' : 'Встряхнуть волну (со следующего трека)';
    if (!$('waveSettings').hidden) renderWavePls();
    $('nplabel').textContent = (queue[current] && queue[current].bg) ? bgLabel() : 'Сейчас играет';
    var gb = document.querySelectorAll('#waveGenres .wchip[data-st]');
    for (var k = 0; k < gb.length; k++) gb[k].classList.toggle('on-bg', bgSel.kind === 'wave' && !bgSel.seeds && bgSel.station === gb[k].dataset.st);
  if (typeof renderWavePage === 'function') renderWavePage();
  }
  if (A.getSetting) {
    A.getSetting('wave').then(function (c){ if (c) waveCfg = Object.assign(waveCfg, c); renderWaveUi(); renderPlsShuf(); });
    setTimeout(ensureWavePreview, 800);
  }
  function toggleAuto(){ waveCfg.on = !waveCfg.on; saveWaveCfg(); renderWaveUi(); }
  $('waveToggle').onclick = toggleAuto;
  $('setWaveAuto').onclick = toggleAuto;
  function bindWaveChips(id, key){
    $(id).addEventListener('click', function(e){
      var b = e.target.closest('.wchip'); if (!b) return;
      waveCfg[key] = b.dataset.v; saveWaveCfg();
      // фоном шёл плейлист — настройки волны значат «хочу волну»: переключаемся на неё
      if (bgSel.kind === 'list') { var air = !!(queue[current] && queue[current].bg); setBg(lastWave, air); return; }
      renderWaveUi();
      if (bgOn) refreshWave(); // следующий трек — уже по новым настройкам
    });
  }
  bindWaveChips('waveDiv', 'diversity'); bindWaveChips('waveMood', 'mood'); bindWaveChips('waveLang', 'language');
  $('wavePlay').onclick = function(){
    var onAir = !!(queue[current] && queue[current].bg && (!isIdle() || loadingIdx >= 0));
    if (!onAir) { startBg(); return; } // волна — сразу, что бы ни играло
    stopVideo();
  };
  // «Встряхнуть»: волна берёт новое направление, плейлист перемешивается заново
  // Текущий трек доигрывает, «встряхнутая» волна (или заново перемешанный плейлист) идёт со следующего
  $('waveShake').onclick = async function(){
    var playing = !isIdle() || loadingIdx >= 0;
    if (!playing) { startBg(); return; }
    if (bgSel.kind === 'list') { bgSel.shuffle = true; waveBuf = listOrder(); renderWaveUi(); renderQueue(); }
    else {
      waveBuf = []; await refreshWave();
    }
    setSub('Встряхнул — новое пойдёт со следующего трека');
    prefetchNext();
  };

  // Плейлисты фоном (вперемешку): свои, с компьютера, Яндекс, YouTube
  function wavePlsList(){
    var out = [];
    if (typeof LIB !== 'undefined' && LIB.count) out.push({ m: LIBALL, n: 'Вся музыка с компьютера', c: '#4ADE9A', g: 'Мои' });
    localLists().forEach(function (m){ out.push({ m: m, n: m.title, c: '#9B87FF', g: 'Мои' }); });
    if (ymLoggedIn) { out.push({ m: LIKED, n: 'Мне нравится', c: '#FF3D6E', g: 'Яндекс' }); (myPls || []).filter(function (p){ return p.own; }).forEach(function (p){ out.push({ m: p, n: p.title, c: '#FFD43B', g: 'Яндекс' }); }); }
    if (typeof ytLogged === 'function' && ytLogged()) { out.push({ m: YT_LIKED, n: 'Понравившиеся на YouTube', c: '#FF5A52', g: 'YouTube' }); (ytPls || []).forEach(function (p){ out.push({ m: p, n: p.title, c: '#FF5A52', g: 'YouTube' }); }); }
    return out.slice(0, 80);
  }
  function renderWavePls(){
    var box = $('wavePls'); if (!box) return;
    var list = wavePlsList(), cur = bgSel.kind === 'list' ? listId(bgSel.list) : '';
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<span class="s" style="font-size:12px;color:var(--tx4)">Пока нет плейлистов — создай во вкладке «Плейлисты»</span>'; return; }
    if (!myLoaded && (ymLoggedIn || (typeof ytLogged === 'function' && ytLogged()))) loadMy(false).then(function(){ if (!$('waveSettings').hidden) renderWavePls(); }).catch(noop);
    // Своя прокрутка у панели — показываем все, по группам
    var lastG = '';
    list.forEach(function (x){
      if (x.g !== lastG) { lastG = x.g; var h = document.createElement('div'); h.className = 'wsub wsub-g'; h.textContent = x.g; box.appendChild(h); }
      var b = document.createElement('button'); b.className = 'wv' + (listId(x.m) === cur ? ' on' : '');
      b.innerHTML = '<i style="background:' + x.c + '"></i>' + esc(x.n);
      b.title = BGL();
      b.onclick = async function(){
        var m = x.m, L;
        b.disabled = true;
        if (m.src === 'lc') { var all = await libTracks(); L = { src: 'tap', type: 'tap', listId: 'lib-play', title: 'Вся музыка с компьютера', tracks: all }; }
        else if (m.src === 'tap') L = m;
        else { var r = await loadList(m).catch(function(){ return null; }); if (!r || r.error) { b.disabled = false; setErr('⚠ не удалось загрузить «' + m.title + '»'); return; } L = Object.assign({}, m, r, { title: m.title }); }
        b.disabled = false;
        if (!L.tracks || !L.tracks.length) { setErr('⚠ «' + m.title + '» пустой'); return; }
        setBg({ kind: 'list', list: L, shuffle: waveCfg.plsShuffle !== false }, true);
      };
      box.appendChild(b);
    });
    var on = box.querySelector('.wv.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  // Варианты от Яндекса и волны по жанрам.
  // «Что играет» берёт тот же список, что и блок «Для вас» на вкладке «Волна»: общий кэш wpCtxData.
  async function loadVariants(){
    variants.loaded = true;
    if (!ymLoggedIn) { renderVariants(); return; }
    var box = $('waveVariants');
    if (box && !(typeof wpCtxData !== 'undefined' && wpCtxData && wpCtxData.length)) {
      box.innerHTML = '<span class="s" style="font-size:12px;color:var(--tx4)">Загружаю…</span>';
    }
    try { if (typeof wpEnsureContexts === 'function') await wpEnsureContexts(false); } catch (e) {}
    if (typeof wpRenderContexts === 'function') wpRenderContexts();
    renderVariants();
  }
  function variantList(){
    var contexts = (typeof wpCtxData !== 'undefined' && wpCtxData) || [];
    if (window.TapWaveVariants) return window.TapWaveVariants.list(contexts);
    return [{ name: 'Моя волна — как обычно', station: 'user:onyourwave', color: '#FFD43B' }];
  }
  // Кружок как в «Для вас»: цвет варианта, а без цвета — тот же --ac, что у карточки слева.
  function variantColor(w){
    var c = w && w.color;
    if (c && /^#?[0-9a-f]{6}$/i.test(c)) return c[0] === '#' ? c : '#' + c;
    return 'var(--ac)';
  }
  function renderVariants(){
    var box = $('waveVariants');
    if (!box) return;
    if (!ymLoggedIn) { box.innerHTML = '<span class="s" style="font-size:12px;color:var(--tx4)">Нужен вход в Яндекс</span>'; return; }
    var list = variantList();
    var cur = bgSel.kind === 'wave' ? (window.TapWaveVariants ? window.TapWaveVariants.activeId(bgSel) : bgId(bgSel)) : '';
    box.innerHTML = '';
    var onSet = false;
    list.forEach(function (w){
      // Хотфикс 0.36.3: та же «таблетка», что у блока «Для вас» (wave-cat/wave-ctx-chip),
      // а не вертикальная строка — по виду оба места должны быть одинаковыми.
      var b = document.createElement('button'); b.className = 'wave-cat wave-ctx-chip wv';
      var id = window.TapWaveVariants ? window.TapWaveVariants.key(w) : 'wave:' + (w.seeds && w.seeds.length ? w.seeds.join(',') : w.station);
      if (id === cur && !onSet) { b.classList.add('on', 'active'); onSet = true; }
      b.innerHTML = '<span class="wave-ctx-mini" style="background:' + variantColor(w) + '"></span>' + esc(w.name);
      b.onclick = function(){
        var seeds = w.seeds && w.seeds.length ? w.seeds : undefined;
        setBg({ kind: 'wave', station: w.station || (seeds && seeds[0]), seeds: seeds, name: w.station === 'user:onyourwave' ? 'Моя волна' : w.name }, true);
      };
      box.appendChild(b);
    });
  }
  function renderGenres(){
    var box = $('waveGenres');
    if (!stations.length) { box.innerHTML = '<span class="s" style="font-size:12px;color:var(--tx4)">' + (ymLoggedIn ? 'Загружаю…' : 'Появится после входа в Яндекс') + '</span>'; return; }
    var top = stations.filter(function (s){ return s.type === 'genre' && !s.parent; });
    var html = '';
    function chip(s){ return '<button class="wchip" data-st="' + esc(s.id) + '" data-name="' + esc(s.name) + '">' + esc(s.name) + '</button>'; }
    if (!genresOpen) {
      html = top.slice(0, 10).map(chip).join('') + '<button class="wchip wmore" data-more="1">Ещё…</button>';
    } else {
      [['genre', 'Жанры'], ['epoch', 'Эпохи'], ['activity', 'Занятия'], ['mood', 'Настроение']].forEach(function (g){
        var list = stations.filter(function (s){ return s.type === g[0] && (g[0] !== 'genre' || !s.parent); });
        if (list.length) html += '<span class="wlabel">' + g[1] + '</span>' + list.map(chip).join('');
      });
      html += '<button class="wchip wmore" data-more="0">Свернуть</button>';
    }
    box.innerHTML = html;
    renderWaveUi();
  }
  $('waveGenres').addEventListener('click', function(e){
    var b = e.target.closest('.wchip'); if (!b) return;
    if (b.dataset.more) { genresOpen = b.dataset.more === '1'; renderGenres(); return; }
    setBg({ kind: 'wave', station: b.dataset.st, name: b.dataset.name }, true);
  });

