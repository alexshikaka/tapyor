  // ===== Модуль «Оверлей-плейлист» (пак стримера) — docs/OVERLAY.md =====
  // 1) Данные плеера для страницы OBS: что играет, позиция, пауза, следующие песни, хвост из волны.
  //    Шлём, только пока модуль просит (кто-то смотрит оверлей: OBS или превью) — иначе ничего не собираем.
  // 2) Уровень звука для осциллограммы («Настоящий звук»): тот же захват звука окна, что у визуализатора (17-viz.js).
  // 3) Окно настроек «Модули → Оверлей-плейлист» и «Модули → Моушн-оверлей» с превью.
  //    Это два разных оверлея с разными настройками; вся логика — в модуле (A.modCmd('overlay', …)).

  var OVW = { state: false, levels: false }, ovSent = '', ovSentAt = 0, ovSentNp = null, ovLvT = 0;
  function ovWantsLevels(){ return !!OVW.levels; }

  // Ник заказавшего для оверлея: v.req.who (донат — имя донатера, чат — логин зрителя).
  // Суммы и валюты не отдаём никогда. «Аноним» и пусто — ника нет.
  function ovWho(v){
    var w = v && v.req && v.req.who;
    w = String(w == null ? '' : w).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!w || w.toLowerCase() === 'аноним') return '';
    return w;
  }
  // noWho — для строк волны/фона (after): это не заказ, ника там быть не должно
  function ovTrack(v, noWho){
    var t = v && v.sp === 'book' && v.workTitle ? v.workTitle : (v && v.title);
    var o = { title: String(t || ''), artist: String((v && (v.author || v.artist)) || '') };
    var w = noWho ? '' : ovWho(v);
    if (w) o.who = w;
    return o;
  }
  // Следующие в очереди; книга (много глав) — одной строкой, как в самой очереди
  function ovNextList(){
    var out = [], last = spKeyOf(queue[current]);
    for (var i = current + 1; i < queue.length && out.length < 12; i++) {
      var v = queue[i]; if (!v || v.played) continue;
      var k = spKeyOf(v); if (k && k === last) continue;
      last = k;
      out.push(ovTrack(v));
    }
    return out;
  }
  // Что сыграет фон после очереди (волна / фоновый плейлист) — для «добирать из волны».
  // Ник сюда не идёт: волна — не заказ (см. ovTrack(v, true)).
  function ovAfterList(){ return (bgOn || waveCfg.on) ? bgPreview().slice(0, 12).map(function (v){ return ovTrack(v, true); }) : []; }

  function ovSnap(){
    var v = queue[current];
    if (!v || isIdle()) return { np: null, next: [], after: [] };
    var m = master(), pos = 0, dur = 0;
    try { pos = Number(m && m.currentTime) || 0; dur = Number(m && m.duration) || 0; } catch (e) {}
    if (!isFinite(dur) || dur <= 0) dur = Number(v.seconds || v.durSec || 0) || 0;
    var t = ovTrack(v), np = { title: t.title, artist: t.artist, cover: v.cover || v.thumb || '', pos: pos, dur: dur, playing: !document.body.classList.contains('is-paused'), at: Date.now() };
    if (t.who) np.who = t.who;
    return {
      np: np,
      next: ovNextList(), after: ovAfterList()
    };
  }
  // Шлём при изменениях и при перемотке; секунды страница досчитывает сама
  function ovFeed(force){
    if (!OVW.state || !A.modPlayer) return;
    var s; try { s = ovSnap(); } catch (e) { return; }
    var np = s.np;
    // who играющего трека — в подписи: смена заказчика без смены трека тоже уходит странице
    var sig = JSON.stringify([np && [np.title, np.artist, np.who, np.cover, np.playing, Math.round(np.dur)], s.next, s.after]);
    var drift = false;
    if (np && ovSentNp) {
      var exp = ovSentNp.pos + (ovSentNp.playing ? (np.at - ovSentNp.at) / 1000 : 0);
      drift = Math.abs(exp - np.pos) > 1.5;
    }
    if (!force && sig === ovSent && !drift && Date.now() - ovSentAt < 15000) return;
    ovSent = sig; ovSentAt = Date.now(); ovSentNp = np;
    A.modPlayer(s);
  }
  setInterval(function(){ ovFeed(false); }, 1000);

  function ovLevels(){
    clearInterval(ovLvT); ovLvT = 0;
    if (!OVW.levels || (!A.modLevel && !A.modSpectrum)) return;
    ovLvT = setInterval(function(){
      if (A.modSpectrum && typeof vizOvSpectrum === 'function') {
        var sp = vizOvSpectrum(); if (sp) A.modSpectrum(sp);
      }
      if (A.modLevel) {
        var x = vizOvLevel();
        if (x != null) A.modLevel(Math.round(x * 1000) / 1000);
      }
    }, 90);
  }
  if (A.onModPlayerWant) A.onModPlayerWant(function (w){
    var was = OVW;
    OVW = { state: !!(w && w.state), levels: !!(w && w.levels) };
    if (OVW.state && !was.state) { ovSent = ''; setTimeout(function(){ ovFeed(true); }, 0); }
    ovLevels();
    vizUpdate();                                                   // захват звука: включить или отпустить
  });

  // ---------- окно настроек: две вкладки, «Оверлей-плейлист» и «Моушн-оверлей» ----------
  var OV = { st: null, cfg: null, status: null, styles: null, stylesOk: false, bg: 'check', demo: false, paused: false, shot: '', seen: false, mseen: false, poll: 0, built: false, mbuilt: false, saveT: 0, zoom: 'big', box: {} };
  // Старый пак не знает команды styles: показываем то, что было зашито раньше
  var OV_STYLE_OLD = [['dos', 'DOS-терминал', 'DOS'], ['typography', 'Типографика', 'TYPE']];
  var OV_SW = [['#FFB000', 'Янтарный'], ['#33FF66', 'Зелёный'], ['#E8E8E8', 'Белый'], ['#4FD8FF', 'Голубой'], ['#FF5FA2', 'Розовый']];
  var OV_POS = [['tl', 'сверху слева'], ['tc', 'сверху по центру'], ['tr', 'сверху справа'], ['bl', 'снизу слева'], ['bc', 'снизу по центру'], ['br', 'снизу справа']];
  var OV_SCREEN_W = 540;                             // ширина превью в окне (экран 1920×1080 уменьшен)

  function ovInstalled(){ return !!(OV.st && OV.st.modules && OV.st.modules.overlay); }
  function ovRunning(){ return ovInstalled() && !!OV.st.modules.overlay.running; }

  function ovMenu(){
    // Пункты видны всегда — подсказка внутри объяснит, чего не хватает.
    // Разделы не трогаем: их показывает showSettingsPane (иначе одна вкладка снимает скрытие другой).
    ['goOverlay', 'goMotion'].forEach(function (id){ var e = $(id); if (e) e.hidden = false; });
    var d = $('ovDot'); if (d) d.hidden = !(OV.status && OV.status.obs > 0);
  }

  function oTg(key, on, label, pref){ return '<button class="toggle' + (on ? ' on' : '') + '" data-' + (pref || 'ovt') + '="' + key + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(label) + '"><span></span></button>'; }
  function oSeg(key, cur, opts, label, attr){ return '<div class="seg" role="group" aria-label="' + esc(label) + '" style="flex-wrap:wrap">' + opts.map(function (o){ return '<button class="' + (String(cur) === String(o[0]) ? 'on' : '') + '" ' + (attr || 'data-ovv') + '="' + key + '" data-val="' + esc(o[0]) + '" aria-pressed="' + (String(cur) === String(o[0]) ? 'true' : 'false') + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; }
  function oRow(title, desc, ctl, last){ return '<div class="srow"' + (last ? ' style="border-bottom:0"' : '') + '><div class="sl"><div class="st">' + title + '</div>' + (desc ? '<div class="sd">' + desc + '</div>' : '') + '</div>' + (ctl || '') + '</div>'; }
  function oSec(title, sub, body){ return '<div class="bot-sec"><div class="sec-h"><h2 style="font-size:16px">' + title + '</h2>' + (sub ? '<span>' + sub + '</span>' : '') + '</div><div class="card">' + body + '</div></div>'; }
  function oRows(rows){ return rows.map(function (r, i){ return oRow(r[0], r[1], r[2], i === rows.length - 1); }).join(''); }

  // Стили приходят от модуля (команда styles), в ядре их списка больше нет.
  // Нет команды (старый пак) — два стиля, как раньше, без ошибок в журнале.
  function ovStyleList(){ return (OV.stylesOk && OV.styles && OV.styles.length) ? OV.styles : null; }
  function ovStyleById(id){ var l = ovStyleList() || []; return l.filter(function (s){ return s && s.id === id; })[0] || null; }
  function ovPlayStyle(){ return ovStyleById(OV.cfg && OV.cfg.style); }
  function ovStyleGrid(cur, attr){
    var list = ovStyleList();
    var items = list ? list.map(function (s){ return { id: s.id, label: (s.num != null ? s.num + ' · ' : '') + s.name, sub: s.font || '' }; })
      : OV_STYLE_OLD.map(function (t){ return { id: t[0], label: t[1], sub: t[2] }; });
    return '<div class="ov-styles">' + items.map(function (t){
      var on = String(cur) === String(t.id);
      return '<button class="ov-style' + (on ? ' on' : '') + '" data-' + attr + '="' + esc(t.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '"><b>' + esc(t.label) + '</b>' + (t.sub ? '<span>' + esc(t.sub) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function ovPosGrid(cur, attr){
    return '<div class="ov-pos" role="group" aria-label="Угол экрана">' + OV_POS.map(function (p){
      var v = p[0][0], h = p[0][1];
      return '<button class="' + (cur === p[0] ? 'on' : '') + '" data-' + attr + '="' + p[0] + '" aria-label="' + p[1] + '" aria-pressed="' + (cur === p[0] ? 'true' : 'false') + '" style="justify-content:' + (h === 'l' ? 'flex-start' : h === 'c' ? 'center' : 'flex-end') + ';align-items:' + (v === 't' ? 'flex-start' : 'flex-end') + '"><i></i></button>';
    }).join('') + '</div>';
  }
  // Готовые цвета + свой (пипетка). pickAttr/pickVal — какая кнопка откроет выбор цвета.
  function ovSwatches(attr, val, pickAttr, pickVal, title){
    return '<div class="bot-pair">' + OV_SW.map(function (w){ return '<button class="ov-sw' + (val === w[0] ? ' on' : '') + '" ' + attr + '="' + w[0] + '" style="background:' + w[0] + '" aria-label="' + w[1] + '" aria-pressed="' + (val === w[0] ? 'true' : 'false') + '"></button>'; }).join('') +
      '<button class="te-sw" data-' + pickAttr + '="' + pickVal + '" title="' + esc(title) + '" aria-label="' + esc(title) + '" style="background:' + esc(val) + '"></button>' +
      '<span class="sd" style="font-size:12px">Свой цвет</span></div>';
  }

  // ---- Что умеет выбранный стиль (договор OVERLAYS-FEATURES.md) ----
  // Поля нет (старый или промежуточный пак) — считаем, что у стиля есть всё, как раньше.
  function ovHas(st, key){
    if (!st || !Array.isArray(st.features)) return true;
    return st.features.indexOf(key) >= 0;
  }
  function ovVizKind(st){
    if (!st || st.vizKind === undefined) return 'spectrum';
    return st.vizKind;                                  // 'spectrum' | 'level' | null
  }
  function ovHasViz(st){ return ovVizKind(st) !== null; }
  // Два вида визуализатора — у всех стилей, где он есть (OVERLAYS-VIZ.md).
  // Новый пак присылает ключ viz в features; промежуточный пак его ещё не знает,
  // поэтому смотрим ещё и на vizKind: null — визуализатора у стиля нет.
  // Совсем старый пак (ни features, ни vizKind) — показываем, как раньше.
  function ovViewSwitch(st){
    if (!st) return true;
    if (Array.isArray(st.features) && st.features.indexOf('viz') >= 0) return true;
    return ovHasViz(st);
  }
  function ovIsDos(st){ return !!(st && st.id === 'dos'); }
  function ovDescCover(st){
    return ovIsDos(st) ? 'Обложка играющего трека — пикселизованная под DOS.' : 'Обложка играющего трека; если её нет, стиль покажет свою заглушку.';
  }
  function ovDescViz(st){
    return ovVizKind(st) === 'level' ? 'Лента или стрелки показывают общий уровень громкости.' : 'Полосы, волна или кольцо рисуются по частотам звука.';
  }
  function ovDescProg(st){
    return ovIsDos(st) ? '32 ячейки, заполняются слева направо — и у правого края экрана тоже.' : 'Полоска прогресса трека, заполняется слева направо.';
  }

  // Моушн-настройки: недостающие поля — из значений по умолчанию модуля, чтобы окно
  // показывало рабочие кнопки даже у пака, который сохранил моушн частично.
  var OV_MOTION_DEF = { style: 'dos', pos: 'bc', dx: 0, dy: 0, size: 100, color: '#FFFFFF', vizColor: '#C8F542', outline: true, nick: true, scene: 'brand', hold: 5,
    cover: true, time: true, spin: true, prog: true, osc: true, marq: true, lang: 'en', viz: 'wave', smooth: 'mid' };
  var OV_SCENES = [['brand', 'Фирменный'], ['rush', 'Выезд с акцентом'], ['mask', 'Маска и штрих'], ['plate', 'Полупрозрачная подводка']];
  function ovMotion(){
    var d = {}, m = (OV.cfg && OV.cfg.motion) || {}, k;
    for (k in OV_MOTION_DEF) if (Object.prototype.hasOwnProperty.call(OV_MOTION_DEF, k)) d[k] = OV_MOTION_DEF[k];
    if (OV.cfg) { if (OV.cfg.style) d.style = OV.cfg.style; if (OV.cfg.color) d.color = OV.cfg.color; if (OV.cfg.vizColor) d.vizColor = OV.cfg.vizColor; }
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k) && m[k] != null) d[k] = m[k];
    return d;
  }
  function ovMvStyle(){ return ovStyleById(ovMotion().style); }
  function ovMotionSet(patch, quiet){
    var mv = ovMotion(), k;
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) mv[k] = patch[k];
    return ovSave({ motion: mv }, quiet, 'motion');
  }

  // Строка лицензии пака (общая с ботом) — src/ui/26-packs.js
  function ovTopHtml(kind){
    var s = OV.status || {}, motion = kind === 'motion';
    var lic = packLicStrip(OV.st && OV.st.license);
    var pill = motion
      ? (s.motionObs > 0 ? '<span class="pill ok">OBS видит · ' + s.motionObs + '</span>' : '<span class="pill">OBS пока не подключён</span>')
      : (s.obs > 0 ? '<span class="pill ok">OBS видит оверлей · ' + s.obs + '</span>' : '<span class="pill">OBS пока не подключён</span>');
    var url = motion ? (s.motionUrl || '') : (s.url || '');
    var desc = motion
      ? 'В OBS: Источники → ＋ → Браузер, вставь ссылку, ширина 1920, высота 1080. Это отдельный источник — он появляется при смене трека.'
      : 'В OBS: Источники → ＋ → Браузер, вставь ссылку, ширина 1920, высота 1080. Цвет, место и список настраиваются тут — ссылку в OBS менять не придётся.';
    return lic + oSec('Подключение к OBS', motion ? 'отдельный источник — всплывашка при смене трека, очереди нет' : 'один раз — дальше всё меняется здесь',
      oRow('Ссылка для источника «Браузер»', desc + '<div class="path" style="margin-top:8px">' + esc(url || 'сервер ещё не запущен') + '</div>',
        '<div class="bot-pair">' + pill + '<button class="btn" data-ova="' + (motion ? 'copy-motion' : 'copy') + '"' + (url ? '' : ' disabled') + '>Скопировать</button></div>', true));
  }

  // Экран и положение одним блоком: превью слева, компактная колонка справа (узко — под экраном).
  function ovScreenHtml(kind){
    var motion = kind === 'motion';
    var cur = motion ? ovMotion() : OV.cfg;
    var p = motion ? 'ovM' : 'ov';
    var attr = motion ? 'ovmpos' : 'ovpos';
    var reset = motion ? 'reset-mpos' : 'reset-pos';
    var bar = motion ? '' : '<div class="ov-bar" id="ovBar"></div>';
    var foot = motion
      ? '<div class="ov-foot"><div class="sd" id="ovMCap"></div></div>'
      : '<div class="ov-foot"><div class="sd" id="ovCap"></div><button class="btn" data-ova="shot">Загрузить скриншот игры</button><input type="file" id="ovShotFile" accept="image/*" hidden></div>';
    var zb = function (v, t){ var on = OV.zoom === v; return '<button class="ov-zoom-b' + (on ? ' on' : '') + '" data-ovz="' + v + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + t + '</button>'; };
    return bar +
      '<div class="ov-sticky" id="' + p + 'Screen"><div class="ov-zoom" role="group" aria-label="Вид превью">' + zb('big', 'Крупно') + zb('fit', 'В масштабе') + '</div><div class="ov-screen-row">' +
        '<div class="ov-stage bg-check" id="' + p + 'Stage"><div class="ov-scale" id="' + p + 'Scale"><iframe id="' + p + 'Frame" title="' + (motion ? 'Превью моушн-оверлея' : 'Превью оверлея') + '" tabindex="-1" aria-hidden="true"></iframe><div class="ov-safe"></div></div></div>' +
        '<div class="ov-side">' +
          '<div class="ov-side-h"><span>Положение</span><button class="btn ghost" data-ova="' + reset + '">Сбросить</button></div>' +
          ovPosGrid(cur.pos, attr) +
          '<div class="ov-xy"><label for="' + p + 'Dx">X</label><input class="field" id="' + p + 'Dx" type="number" step="4" value="' + cur.dx + '"><label for="' + p + 'Dy">Y</label><input class="field" id="' + p + 'Dy" type="number" step="4" value="' + cur.dy + '"></div>' +
          '<div class="ov-size"><span class="ov-size-l">Размер</span><input type="range" id="' + p + 'Size" min="80" max="250" step="5" value="' + cur.size + '" aria-label="Размер оверлея"><span class="mono" id="' + p + 'SizeV">' + cur.size + ' %</span></div>' +
        '</div>' +
      '</div></div>' + foot;
  }
  function ovSyncScreen(kind){
    var motion = kind === 'motion';
    var cfg = motion ? ovMotion() : OV.cfg;
    var wrap = $(motion ? 'ovMScreen' : 'ovScreen'); if (!wrap || !cfg) return;
    var attr = motion ? 'ovmpos' : 'ovpos';
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-' + attr + ']'), function (b){
      var on = b.getAttribute('data-' + attr) === cfg.pos;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var dx = $(motion ? 'ovMDx' : 'ovDx'); if (dx && document.activeElement !== dx) dx.value = cfg.dx;
    var dy = $(motion ? 'ovMDy' : 'ovDy'); if (dy && document.activeElement !== dy) dy.value = cfg.dy;
    var size = $(motion ? 'ovMSize' : 'ovSize');
    if (size && document.activeElement !== size) size.value = cfg.size;
    var sv = $(motion ? 'ovMSizeV' : 'ovSizeV'); if (sv) sv.textContent = cfg.size + ' %';
  }

  function ovBarHtml(){
    // Превью всегда показывает то, что играет; ничего не играет — пак сам показывает «Джон Кейдж — Пьеса 4′33″» (15.11)
    return oSeg('bg', OV.bg, [['check', 'Шахматка'], ['dark', 'Тёмный'], ['light', 'Светлый'], ['shot', 'Скриншот']], 'Фон превью', 'data-ovp');
  }

  function ovCtlHtml(){
    var c = OV.cfg, st = ovPlayStyle(), cur = String(c.color).toUpperCase();
    var styles = ovStyleGrid(c.style, 'ovstyle');
    var viz = String(c.vizColor || c.color).toUpperCase();
    var hasViz = ovHasViz(st);
    var sw = ovSwatches('data-ovc', cur, 'ovpick', 'color', 'Выбрать цвет текста');
    var vsw = ovSwatches('data-ovvc', viz, 'ovpick', 'vizColor', 'Выбрать цвет визуализатора');
    var colorName = (OV_SW.filter(function (w){ return w[0] === cur; })[0] || [0, 'Свой'])[1] + ' · ' + cur + (hasViz ? ' / ' + viz : '');
    var counts = []; for (var n = 0; n <= 10; n++) counts.push([n, String(n)]);

    // «Что показывать» — только то, что есть в выбранном стиле (features).
    var show = [];
    if (ovHas(st, 'cover')) show.push(['Обложка', ovDescCover(st), oTg('cover', c.cover, 'Обложка')]);
    if (ovHas(st, 'time')) show.push(['Время', 'Сколько уже играет и сколько всего: «01:32/04:03».', oTg('time', c.time, 'Время')]);
    if (ovHas(st, 'spin')) show.push(['Курсор-вертушка', 'Крутящийся «| / - \\» перед временем.', oTg('spin', c.spin, 'Курсор-вертушка')]);
    if (ovHas(st, 'osc') && hasViz) show.push(['Визуализатор', ovDescViz(st), oTg('osc', c.osc, 'Визуализатор')]);
    if (ovHas(st, 'prog')) show.push(['Шкала прогресса', ovDescProg(st), oTg('prog', c.prog, 'Шкала прогресса')]);
    if (ovHas(st, 'marq')) show.push(['Бегущая строка', 'Длинное название медленно прокручивается. Выкл — обрезается по краю.', oTg('marq', c.marq, 'Бегущая строка')]);
    if (ovHas(st, 'lang')) show.push(['Подписи', 'Язык подписей в стиле: TRACK / ARTIST или ТРЕК / АРТИСТ.', oSeg('lang', c.lang, [['en', 'TRACK / ARTIST'], ['ru', 'ТРЕК / АРТИСТ']], 'Подписи')]);
    if (OV.stylesOk) show.push(['Показать ник заказавшего', 'Ник зрителя, заказавшего трек: у играющего трека и в очереди. Для донатов и заказов из чата. Суммы не показываются.', oTg('nick', !!c.nick, 'Показать ник заказавшего')]);
    // 15.11: смена трека — облегчённая «фирменная» анимация стиля (пак с настройкой swap)
    if (OV.stylesOk && 'swap' in c) show.push(['Анимация смены трека', 'Новый трек появляется фирменным движением стиля — коротко и спокойно, меньше секунды. Очередь мягко сдвигается на строку.', oTg('swap', c.swap !== false, 'Анимация смены трека')]);

    // «Список» (очередь) — только у плейлиста. Пустой раздел не показываем.
    var queue = [];
    if (ovHas(st, 'count')) queue.push(['Сколько песен показывать', 'Сколько строк после играющего трека. 0 — только текущий трек.', oSeg('count', c.count, counts, 'Сколько песен')]);
    if (ovHas(st, 'fade')) queue.push(['Затухание строк', 'Насколько строки списка бледнеют к последней. 0 % — без затухания; тумблер отключает совсем.', oTg('fade', c.fade, 'Затухание строк') +
      '<input type="range" id="ovFade" min="0" max="100" step="5" value="' + c.fadePct + '" aria-label="Сила затухания" style="width:180px;accent-color:var(--ac)"><span class="mono" id="ovFadeV" style="width:48px;text-align:right;color:var(--tx2)">' + c.fadePct + ' %</span>']);
    if (ovHas(st, 'fill')) queue.push(['Добирать из волны и фонового плейлиста', 'Если в очереди меньше песен, чем выбрано, хвост берётся из того, что заиграет после очереди.', oTg('fill', c.fill, 'Добирать из волны')]);
    if (ovHas(st, 'nums')) queue.push(['Номера строк', '«1. Хочешь? - Земфира»', oTg('nums', c.nums, 'Номера строк')]);

    // «Визуализатор»: вид — только там, где его переключают; плавность — у любого визуализатора.
    var vizRows = [];
    if (ovViewSwitch(st)) vizRows.push(['Вид визуализатора', 'Волна — одна плавная форма дышит под общую громкость. Спектр — низы, середина и верх двигаются каждый сам по себе.', oSeg('viz', c.viz, [['wave', 'Волна'], ['spectrum', 'Спектр']], 'Вид визуализатора')]);
    vizRows.push(['Плавность', 'Резко — быстрее реакция на удар, плавно — спокойнее движение.', oSeg('smooth', c.smooth, [['fast', 'Резко'], ['mid', 'Средне'], ['slow', 'Плавно']], 'Плавность')]);

    var colorRows = [['Цвет текста', 'Название, исполнитель и строки списка. Можно выбрать готовый, задать свой или взять пипеткой.', sw]];
    if (hasViz) colorRows.push(['Цвет визуализатора', 'Настраивается отдельно от текста; пипетка и свой цвет тоже здесь.', vsw]);
    colorRows.push(['Чёрная обводка', 'Тень вокруг букв и блоков, чтобы текст читался на светлых и пёстрых сценах.', oTg('outline', c.outline, 'Чёрная обводка')]);

    return oSec('Стиль', OV.stylesOk ? 'список стилей — у модуля, новые приходят с обновлением пака' : 'новые стили будут приходить с обновлениями пака', styles) +
      oSec('Цвет', esc(colorName), oRows(colorRows)) +
      (queue.length ? oSec('Список', 'что будет дальше', oRows(queue)) : '') +
      (show.length ? oSec('Что показывать', 'только то, что есть в выбранном стиле', oRows(show)) : '') +
      (hasViz ? oSec('Визуализатор', 'как выглядит звук на экране', oRows(vizRows)) : '');
  }

  // ---- Моушн-оверлей: отдельная вкладка со своим источником OBS ----
  function ovMCtlHtml(){
    var mv = ovMotion(), st = ovMvStyle(), hasViz = ovHasViz(st);
    var mcolor = String(mv.color || '#FFFFFF').toUpperCase(), mviz = String(mv.vizColor || mv.color || '#FFFFFF').toUpperCase();
    var colorName = (OV_SW.filter(function (w){ return w[0] === mcolor; })[0] || [0, 'Свой'])[1] + ' · ' + mcolor + (hasViz ? ' / ' + mviz : '');
    var hold = '<div class="bot-pair"><input type="range" id="ovMHold" min="3" max="15" step="1" value="' + mv.hold + '" aria-label="Сколько держать моушн" style="width:180px;accent-color:var(--ac)"><span class="mono" id="ovMHoldV" style="width:48px;text-align:right;color:var(--tx2)">' + mv.hold + ' с</span></div>';

    var show = [];
    if (ovHas(st, 'cover')) show.push(['Обложка', ovDescCover(st), oTg('cover', !!mv.cover, 'Обложка', 'ovmt')]);
    if (ovHas(st, 'time')) show.push(['Время', 'Сколько уже играет и сколько всего: «01:32/04:03».', oTg('time', !!mv.time, 'Время', 'ovmt')]);
    if (ovHas(st, 'spin')) show.push(['Курсор-вертушка', 'Крутящийся «| / - \\» перед временем.', oTg('spin', !!mv.spin, 'Курсор-вертушка', 'ovmt')]);
    if (ovHas(st, 'osc') && hasViz) show.push(['Визуализатор', ovDescViz(st), oTg('osc', !!mv.osc, 'Визуализатор', 'ovmt')]);
    if (ovHas(st, 'prog')) show.push(['Шкала прогресса', ovDescProg(st), oTg('prog', !!mv.prog, 'Шкала прогресса', 'ovmt')]);
    if (ovHas(st, 'marq')) show.push(['Бегущая строка', 'Длинное название медленно прокручивается. Выкл — обрезается по краю.', oTg('marq', !!mv.marq, 'Бегущая строка', 'ovmt')]);
    if (ovHas(st, 'lang')) show.push(['Подписи', 'Язык подписей в стиле: TRACK / ARTIST или ТРЕК / АРТИСТ.', oSeg('lang', mv.lang, [['en', 'TRACK / ARTIST'], ['ru', 'ТРЕК / АРТИСТ']], 'Подписи', 'data-ovmv')]);
    show.push(['Показать ник заказавшего', 'Ник зрителя, заказавшего трек. Суммы не показываются.', oTg('nick', !!mv.nick, 'Показать ник заказавшего', 'ovmt')]);

    var colorRows = [['Цвет текста', 'Название, исполнитель и ник. Можно выбрать готовый, задать свой или взять пипеткой.', ovSwatches('data-ovmc', mcolor, 'ovmpick', 'color', 'Выбрать цвет текста моушна')]];
    if (hasViz) colorRows.push(['Цвет визуализатора', 'Настраивается отдельно от текста; пипетка и свой цвет тоже здесь.', ovSwatches('data-ovmvc', mviz, 'ovmpick', 'vizColor', 'Выбрать цвет визуализатора моушна')]);
    colorRows.push(['Чёрная обводка', 'Тень вокруг букв и блоков, чтобы текст читался на светлых и пёстрых сценах.', oTg('outline', !!mv.outline, 'Чёрная обводка', 'ovmt')]);

    var vizRows = [];
    if (ovViewSwitch(st)) vizRows.push(['Вид визуализатора', 'Волна — одна плавная форма дышит под общую громкость. Спектр — низы, середина и верх двигаются каждый сам по себе.', oSeg('viz', mv.viz, [['wave', 'Волна'], ['spectrum', 'Спектр']], 'Вид визуализатора', 'data-ovmv')]);
    vizRows.push(['Плавность', 'Резко — быстрее реакция на удар, плавно — спокойнее движение.', oSeg('smooth', mv.smooth, [['fast', 'Резко'], ['mid', 'Средне'], ['slow', 'Плавно']], 'Плавность', 'data-ovmv')]);

    return oSec('Стиль', 'тот же набор, что у плейлиста; моушн может быть в другом стиле', ovStyleGrid(mv.style, 'ovmstyle')) +
      oSec('Появление', 'всплывашка при смене трека', oRows([
        ['Сценарий появления', '«Фирменный» — родная анимация стиля, остальные сценарии общие для всех стилей.', oSeg('scene', mv.scene, OV_SCENES, 'Сценарий появления', 'data-ovmscene')],
        ['Сколько держать <span id="ovMHoldT" class="mono">· ' + mv.hold + ' с</span>', 'От 3 до 15 секунд. После этого всплывашка плавно уходит.', hold],
        ['Проверить', 'Покажет моушн во всех открытых источниках OBS и в превью.', '<button class="btn" data-ova="preview-motion">Показать сейчас</button>']
      ])) +
      oSec('Цвет', esc(colorName), oRows(colorRows)) +
      (show.length ? oSec('Что показывать', 'только то, что есть в стиле моушна', oRows(show)) : '') +
      (hasViz ? oSec('Визуализатор', 'как выглядит звук на экране', oRows(vizRows)) : '');
  }

  // Вид «Крупно» (16.11): показываем кусок экрана 16:9, в который оверлей влезает целиком.
  // Рамку оверлея присылает страница пака (postMessage tapyorOvBox); старый пак — прикидка по углу и размеру.
  function ovCropRect(kind){
    var cfg = kind === 'motion' ? ovMotion() : (OV.cfg || {});
    var b = OV.box[kind], r;
    if (b && b.w > 0 && b.h > 0) r = { x: b.x, y: b.y, w: b.w, h: b.h };
    else {
      var sz = Math.max(80, Math.min(250, Number(cfg.size) || 100)) / 100;
      var w = Math.min(1920, 760 * sz), h = Math.min(1080, 420 * sz);
      var pos = cfg.pos || (kind === 'motion' ? 'bc' : 'br'), v = pos[0], hh = pos[1];
      var x = hh === 'l' ? 96 : hh === 'c' ? (1920 - w) / 2 : 1920 - 96 - w;
      var y = v === 't' ? 54 : 1080 - 54 - h;
      r = { x: x + (Number(cfg.dx) || 0), y: y + (Number(cfg.dy) || 0), w: w, h: h };
    }
    var m = 48;                                         // поле вокруг, чтобы тени и обводка не обрезались
    var cw = Math.max(r.w + m * 2, (r.h + m * 2) * 16 / 9, 480);
    cw = Math.min(1920, cw);
    var ch = cw * 9 / 16;
    var cx = r.x + r.w / 2 - cw / 2, cy = r.y + r.h / 2 - ch / 2;
    cx = Math.max(0, Math.min(1920 - cw, cx)); cy = Math.max(0, Math.min(1080 - ch, cy));
    return { x: Math.round(cx), y: Math.round(cy), w: Math.round(cw) };
  }
  function ovApplyView(stage, scale, kind){
    var W = OV_SCREEN_W, H = Math.round(1080 * W / 1920);
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    var c = OV.zoom === 'big' ? ovCropRect(kind) : { x: 0, y: 0, w: 1920 };
    var k = W / c.w;
    scale.style.transform = 'translate(' + (-c.x * k).toFixed(1) + 'px,' + (-c.y * k).toFixed(1) + 'px) scale(' + k.toFixed(4) + ')';
    if (kind === 'playlist' && OV.bg === 'shot' && OV.shot) {
      stage.style.backgroundSize = (1920 * k).toFixed(1) + 'px ' + (1080 * k).toFixed(1) + 'px';
      stage.style.backgroundPosition = (-c.x * k).toFixed(1) + 'px ' + (-c.y * k).toFixed(1) + 'px';
    } else { stage.style.backgroundSize = ''; stage.style.backgroundPosition = ''; }
    var wrap = $(kind === 'motion' ? 'ovMScreen' : 'ovScreen');
    if (wrap) Array.prototype.forEach.call(wrap.querySelectorAll('[data-ovz]'), function (b){
      var on = b.getAttribute('data-ovz') === OV.zoom; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    return W;
  }
  function ovZoomCap(W){
    return OV.zoom === 'big' ? 'Крупно: кусок экрана стрима вокруг оверлея, чтобы разглядеть детали. «В масштабе» — весь экран 1920×1080.'
      : 'Экран стрима 1920×1080, уменьшен до ' + W + ' px.';
  }
  window.addEventListener('message', function (e){
    var d = e.data && e.data.tapyorOvBox; if (!d) return;
    var kind = d.page === 'motion' ? 'motion' : 'playlist';
    var fr = $(kind === 'motion' ? 'ovMFrame' : 'ovFrame');
    if (!fr || e.source !== fr.contentWindow) return;
    var n = { x: +d.x || 0, y: +d.y || 0, w: +d.w || 0, h: +d.h || 0 }, o = OV.box[kind];
    if (!(n.w > 0 && n.h > 0 && n.w <= 4000 && n.h <= 4000)) return;
    if (o && Math.abs(o.x - n.x) < 6 && Math.abs(o.y - n.y) < 6 && Math.abs(o.w - n.w) < 6 && Math.abs(o.h - n.h) < 6) return;
    OV.box[kind] = n;
    if (OV.zoom === 'big') { if (kind === 'motion') ovMotionPreview(); else ovPreview(); }
  });

  // Превью: iframe 1920×1080, уменьшенный под ширину; грузится, только пока раздел виден (экономия)
  function ovPreview(){
    var stage = $('ovStage'), scale = $('ovScale'), fr = $('ovFrame'); if (!stage || !fr) return;
    stage.className = 'ov-stage bg-' + OV.bg;
    stage.style.backgroundImage = OV.bg === 'shot' && OV.shot ? 'url("' + OV.shot + '")' : '';
    var W = ovApplyView(stage, scale, 'playlist');
    // M5: превью — с http://localhost:<порт>, другого origin, чем окно (127.0.0.1): странице модуля не виден parent.app
    var ovBase = (location.protocol === 'http:' && location.port) ? 'http://localhost:' + location.port : '';
    var src = OV.seen ? ovBase + '/overlay/playlist?preview=1' : 'about:blank';
    if (fr.getAttribute('src') !== src) fr.setAttribute('src', src);
    var cap = $('ovCap');
    if (cap) cap.textContent = ovZoomCap(W) + ' Пунктир — безопасная зона: 96 px по бокам, 54 px сверху и снизу.' + (OV.bg === 'shot' && !OV.shot ? ' Загрузи скриншот игры — увидишь, не закрывает ли оверлей интерфейс.' : '');
    var bar = $('ovBar'); if (bar) bar.innerHTML = ovBarHtml();
  }
  function ovMotionPreview(){
    var stage = $('ovMStage'), scale = $('ovMScale'), fr = $('ovMFrame'); if (!stage || !fr) return;
    var W = ovApplyView(stage, scale, 'motion');
    // M5: как у плейлиста — с http://localhost:<порт>, другого origin, чем окно (127.0.0.1)
    var base = (location.protocol === 'http:' && location.port) ? 'http://localhost:' + location.port : '';
    var src = OV.mseen ? base + '/overlay/motion?preview=1' : 'about:blank';
    if (fr.getAttribute('src') !== src) fr.setAttribute('src', src);
    var cap = $('ovMCap');
    if (cap) cap.textContent = ovZoomCap(W) + ' Пунктир — безопасная зона: 96 px по бокам, 54 px сверху и снизу.';
  }

  // Раздел на экране — превью подключено и статус OBS обновляется; ушли — превью отключено
  var ovObs = null, ovMObs = null;
  function ovWatchSeen(){
    var stage = $('sOverlay');
    if (!stage || !window.IntersectionObserver) { OV.seen = true; ovPreview(); ovPollSync(); return; }
    if (ovObs) ovObs.disconnect();
    ovObs = new IntersectionObserver(function (es){
      var vis = es.some(function (e){ return e.isIntersecting; });
      if (vis === OV.seen) return;
      OV.seen = vis; ovPreview(); ovPollSync();
    });
    ovObs.observe(stage);
  }
  function ovWatchMotionSeen(){
    var stage = $('sMotion');
    if (!stage || !window.IntersectionObserver) { OV.mseen = true; ovMotionPreview(); ovPollSync(); return; }
    if (ovMObs) ovMObs.disconnect();
    ovMObs = new IntersectionObserver(function (es){
      var vis = es.some(function (e){ return e.isIntersecting; });
      if (vis === OV.mseen) return;
      OV.mseen = vis; ovMotionPreview(); ovPollSync();
    });
    ovMObs.observe(stage);
  }
  function ovPollSync(){
    clearInterval(OV.poll); OV.poll = 0;
    if (OV.seen || OV.mseen) OV.poll = setInterval(ovStatus, 3000);
  }
  async function ovStatus(){
    if (!ovRunning()) return;
    try {
      var s = await A.modCmd('overlay', 'status'), was = OV.status;
      OV.status = s; ovMenu();
      if (!was || was.obs !== s.obs || was.url !== s.url) { var t = $('ovTop'); if (t) t.innerHTML = ovTopHtml('playlist'); }
      if (OV.stylesOk && (!was || was.motionObs !== s.motionObs || was.motionUrl !== s.motionUrl)) {
        var m = $('ovMTop'); if (m) m.innerHTML = ovTopHtml('motion');
      }
    } catch (e) { /* модуль перезапускается */ }
  }

  async function ovLoad(){
    try { OV.st = await A.modStatus(); } catch (e) { OV.st = null; }
    OV.styles = null; OV.stylesOk = false;
    ovMenu();
    if (ovRunning() && A.modCmd) {
      try { OV.cfg = await A.modCmd('overlay', 'settings'); OV.status = await A.modCmd('overlay', 'status'); } catch (e) { OV.cfg = null; }
      if (OV.cfg) {
        // Список стилей — у модуля. Старый пак команду не знает: остаются два стиля, как раньше.
        try { var list = await A.modCmd('overlay', 'styles'); if (Array.isArray(list)) { OV.styles = list; OV.stylesOk = true; } } catch (e) { /* старый пак */ }
      }
    } else OV.cfg = null;
    ovMenu(); ovRender();
  }

  // Сохранение общее, а перерисовка — своя у каждой вкладки: раньше настройки моушна
  // сохранялись через ovSet и перерисовывали только плейлист, поэтому кнопки моушна
  // («Стиль», «Что показывать», тумблеры) не переключались, пока не переоткроешь вкладку.
  async function ovSave(patch, quiet, kind){
    try { OV.cfg = await A.modCmd('overlay', 'save', patch); } catch (e) { toast('Не сохранил: ' + (e.message || e)); return; }
    if (kind === 'motion') {
      if (!quiet) { var mctl = $('ovMCtl'); if (mctl) mctl.innerHTML = ovMCtlHtml(); }
      ovSyncScreen('motion');
      ovMotionPreview();
    } else {
      if (!quiet) { var ctl = $('ovCtl'); if (ctl) ctl.innerHTML = ovCtlHtml(); }
      ovSyncScreen('playlist');
      ovPreview();
    }
  }
  function ovSet(patch, quiet){ return ovSave(patch, quiet, 'playlist'); }

  function ovRenderPlaylist(){
    var box = $('ovPanel'); if (!box) return;
    // Пункт меню виден всегда. Нет пака / модуля / лицензии — подсказка с кнопками.
    var hint = typeof packModuleHint === 'function' ? packModuleHint('Оверлей-плейлист', OV.st, 'overlay') : '';
    if (hint) { box.innerHTML = hint; OV.built = false; return; }
    var err = OV.st.modules.overlay.error;
    if (!OV.cfg) { box.innerHTML = '<div class="bot-note">' + esc(err ? 'Оверлей не запустился: ' + err : 'Оверлей запускается…') + '</div>'; OV.built = false; return; }
    if (!OV.built) {
      box.innerHTML = '<div id="ovTop" class="bot-body"></div>' + ovScreenHtml('playlist') + '<div id="ovCtl" class="bot-body"></div>';
      OV.built = true;
      ovWatchSeen();
    }
    $('ovTop').innerHTML = ovTopHtml('playlist');
    $('ovCtl').innerHTML = ovCtlHtml();
    ovSyncScreen('playlist');
    ovPreview();
  }

  function ovRenderMotion(){
    var box = $('motionPanel'); if (!box) return;
    var hint = typeof packModuleHint === 'function' ? packModuleHint('Моушн-оверлей', OV.st, 'overlay') : '';
    if (hint) { box.innerHTML = hint; OV.mbuilt = false; return; }
    if (!OV.cfg) { box.innerHTML = '<div class="bot-note">' + esc(OV.st.modules.overlay.error ? 'Оверлей не запустился: ' + OV.st.modules.overlay.error : 'Оверлей запускается…') + '</div>'; OV.mbuilt = false; return; }
    if (!OV.stylesOk) {
      box.innerHTML = '<div class="bot-note"><b>Моушн-оверлей.</b> Его ещё нет в установленном паке — обнови Пак стримера, и он появится.' +
        '<div class="bot-pair" style="margin-top:10px"><button class="btn" data-pack-open="1">Обновить пак</button></div></div>';
      OV.mbuilt = false; return;
    }
    if (!OV.mbuilt) {
      box.innerHTML = '<div id="ovMTop" class="bot-body"></div>' + ovScreenHtml('motion') + '<div id="ovMCtl" class="bot-body"></div>';
      OV.mbuilt = true;
      ovWatchMotionSeen();
    }
    $('ovMTop').innerHTML = ovTopHtml('motion');
    $('ovMCtl').innerHTML = ovMCtlHtml();
    ovSyncScreen('motion');
    ovMotionPreview();
  }
  function ovRender(){ ovRenderPlaylist(); ovRenderMotion(); }

  function ovOnClick(e){
    var zb = e.target.closest('[data-ovz]');
    if (zb) { OV.zoom = zb.getAttribute('data-ovz') === 'fit' ? 'fit' : 'big'; ovPreview(); ovMotionPreview(); return; }
    var b = e.target.closest('[data-ovt],[data-ovv],[data-ovmv],[data-ovstyle],[data-ovpos],[data-ovc],[data-ovvc],[data-ovpick],[data-ovp],[data-ova],[data-ovmstyle],[data-ovmpos],[data-ovmscene],[data-ovmt],[data-ovmc],[data-ovmvc],[data-ovmpick]'); if (!b || !OV.cfg) return;
    var ds = b.dataset;
    if (ds.ovstyle) {
      // Выбор стиля несёт и его цвета: модуль хранит их вместе со стилем
      var sp = { style: ds.ovstyle }, sst = ovStyleById(ds.ovstyle);
      if (sst) { if (sst.color) sp.color = sst.color; if (sst.vizColor) sp.vizColor = sst.vizColor; }
      ovSet(sp); return;
    }
    if (ds.ovmstyle) {
      var mp = { style: ds.ovmstyle }, mst = ovStyleById(ds.ovmstyle);
      if (mst) { if (mst.color) mp.color = mst.color; if (mst.vizColor) mp.vizColor = mst.vizColor; }
      ovMotionSet(mp); return;
    }
    if (ds.ovmpos) { ovMotionSet({ pos: ds.ovmpos }, true); return; }
    if (ds.ovmscene) { ovMotionSet({ scene: ds.val }); return; }
    if (ds.ovmv) { var rawm = ds.val, qm = {}; qm[ds.ovmv] = /^\d+$/.test(rawm) ? Number(rawm) : rawm; ovMotionSet(qm); return; }
    if (ds.ovmt) { var mq = {}; mq[ds.ovmt] = !ovMotion()[ds.ovmt]; ovMotionSet(mq); return; }
    if (ds.ovmc) { ovMotionSet({ color: ds.ovmc }); return; }
    if (ds.ovmvc) { ovMotionSet({ vizColor: ds.ovmvc }); return; }
    if (ds.ovmpick) {
      var mk = ds.ovmpick, mm = ovMotion(), mpv = mk === 'color' ? mm.color : mm.vizColor;
      colOpenFor(mk === 'color' ? 'Цвет текста моушна' : 'Цвет визуализатора моушна', mpv || mm.color, function (hex){ var q = {}; q[mk] = hex; ovMotionSet(q); });
      return;
    }
    if (ds.ovpick) {
      var pk = ds.ovpick, pv = pk === 'color' ? OV.cfg.color : OV.cfg.vizColor;
      colOpenFor(pk === 'color' ? 'Цвет текста' : 'Цвет визуализатора', pv || OV.cfg.color, function (hex){ var q = {}; q[pk] = hex; ovSet(q); });
      return;
    }
    if (ds.ovvc) { ovSet({ vizColor: ds.ovvc }); return; }
    if (ds.ovt) { var p = {}; p[ds.ovt] = !OV.cfg[ds.ovt]; ovSet(p); return; }
    if (ds.ovv) { var raw = ds.val, q2 = {}; q2[ds.ovv] = /^\d+$/.test(raw) ? Number(raw) : raw; ovSet(q2); return; }
    if (ds.ovpos) { ovSet({ pos: ds.ovpos }, true); return; }
    if (ds.ovc) { ovSet({ color: ds.ovc }); return; }
    if (ds.ovp) {
      var k = ds.ovp;
      if (k === 'paused') OV.paused = !OV.paused;
      else if (k === 'demo') { OV.demo = ds.val === '1'; if (!OV.demo) OV.paused = false; }
      else OV[k] = ds.val;
      ovPreview(); return;
    }
    var act = ds.ova;
    if (act === 'copy') { var u = OV.status && OV.status.url; if (u) navigator.clipboard.writeText(u).then(function(){ toast('Ссылка для OBS скопирована'); }).catch(function(){ prompt('Скопируй ссылку:', u); }); return; }
    if (act === 'copy-motion') { var mu = OV.status && OV.status.motionUrl; if (mu) navigator.clipboard.writeText(mu).then(function(){ toast('Ссылка моушн-оверлея скопирована'); }).catch(function(){ prompt('Скопируй ссылку:', mu); }); return; }
    if (act === 'preview-motion') {
      try {
        var pm = A.modCmd('overlay', 'preview-motion');
        if (pm && pm.catch) pm.catch(function(){ toast('Моушн не показался — проверь пак'); });
        toast('Моушн-оверлей показан');
      } catch (e) { toast('Моушн не показался — проверь пак'); }
      return;
    }
    if (act === 'reset-pos') { ovSet({ pos: 'br', dx: 0, dy: 0, size: 100 }, true); return; }
    if (act === 'reset-mpos') { ovMotionSet({ pos: 'bc', dx: 0, dy: 0, size: 100 }, true); return; }
    if (act === 'shot') { var f = $('ovShotFile'); if (f) f.click(); return; }
  }
  function ovOnInput(e){
    var t = e.target;
    if (t.id === 'ovSize') {
      var v = Number(t.value) || 100, sv = $('ovSizeV'); if (sv) sv.textContent = v + ' %';
      clearTimeout(OV.saveT); OV.saveT = setTimeout(function(){ ovSet({ size: v }, true); }, 150);
    }
    if (t.id === 'ovMSize') {
      var mv = Number(t.value) || 100, msv = $('ovMSizeV'); if (msv) msv.textContent = mv + ' %';
      clearTimeout(OV.saveT); OV.saveT = setTimeout(function(){ ovMotionSet({ size: mv }, true); }, 150);
    }
    if (t.id === 'ovFade') {
      var fv = Math.max(0, Math.min(100, Number(t.value) || 0)), fsv = $('ovFadeV'); if (fsv) fsv.textContent = fv + ' %';
      clearTimeout(OV.saveT); OV.saveT = setTimeout(function(){ ovSet({ fadePct: fv }, true); }, 150);
    }
    if (t.id === 'ovMHold') {
      var hv = Math.max(3, Math.min(15, Number(t.value) || 3)), hsv = $('ovMHoldV'); if (hsv) hsv.textContent = hv + ' с';
      var hst = $('ovMHoldT'); if (hst) hst.textContent = '· ' + hv + ' с';
      clearTimeout(OV.saveT); OV.saveT = setTimeout(function(){ ovMotionSet({ hold: hv }, true); }, 150);
    }
  }
  function ovOnChange(e){
    var t = e.target;
    if (t.id === 'ovDx' || t.id === 'ovDy') { var p = {}; p[t.id === 'ovDx' ? 'dx' : 'dy'] = Number(t.value) || 0; ovSet(p, true); }
    else if (t.id === 'ovMDx' || t.id === 'ovMDy') { var q = {}; q[t.id === 'ovMDx' ? 'dx' : 'dy'] = Number(t.value) || 0; ovMotionSet(q, true); }
    else if (t.id === 'ovShotFile' && t.files && t.files[0]) {
      // Скриншот — только для превью в этом окне: никуда не сохраняется и не отправляется
      if (OV.shot) { try { URL.revokeObjectURL(OV.shot); } catch (x) {} }
      OV.shot = URL.createObjectURL(t.files[0]); OV.bg = 'shot'; t.value = ''; ovPreview();
    }
  }

  var ovPanelEl = $('ovPanel'), motionPanelEl = $('motionPanel');
  [ovPanelEl, motionPanelEl].forEach(function (el){
    if (!el) return;
    el.addEventListener('click', ovOnClick);
    el.addEventListener('input', ovOnInput);
    el.addEventListener('change', ovOnChange);
  });

  if (A.onModStatus) A.onModStatus(function (st){ OV.st = st; ovLoad(); });
  if (A.modStatus) setTimeout(ovLoad, 3600);
  ovMenu(); // пункт виден сразу, не ждём ответа о паке
  document.addEventListener('click', function (e){
    if (e.target.closest('[data-go="sOverlay"]')) { var so = $('sOverlay'); if (so) so.hidden = false; ovLoad(); if (typeof showSettingsPane === 'function') showSettingsPane('sOverlay'); }
    else if (e.target.closest('[data-go="sMotion"]')) { var sm = $('sMotion'); if (sm) sm.hidden = false; ovLoad(); if (typeof showSettingsPane === 'function') showSettingsPane('sMotion'); }
  });
