  // ===== Поиск =====
  var search = $('search'), results = $('results');
  // Подсказки при наборе: сначала Яндекс, если пусто — YouTube
  var sgEl = $('suggest'), sgItems = [], sgIdx = -1, sgTimer = null, sgToken = 0;
  function hideSuggest(){ sgEl.style.display = 'none'; sgItems = []; sgIdx = -1; }
  function highlightSg(){ var els = sgEl.querySelectorAll('.sg-item'); for (var k = 0; k < els.length; k++) els[k].classList.toggle('active', k === sgIdx); }
  function pickSuggest(i){ var s = sgItems[i]; if (s == null) return; search.value = s; hideSuggest(); doSearch(); }
  function isLink(q){ return /^(https?:\/\/)?(www\.|m\.)?(music\.yandex\.[a-z]+|youtube\.com|music\.youtube\.com|youtu\.be)\//i.test(q); }
  var sgLastSearched = null; // после поиска подсказки не показываем, пока строку не изменят
  async function loadSuggest(t){
    var tok = ++sgToken;
    // «tapyor debug» — не поисковый запрос, подсказки по нему не грузим.
    if (isDebugCommand(t)) { hideSuggest(); return; }
    if (!A.suggest || isLink(t) || t === sgLastSearched) return;
    var r = await A.suggest(t);
    if (tok !== sgToken || search.value.trim() !== t || document.activeElement !== search || t === sgLastSearched) return;
    if (!r || !r.items || !r.items.length) { hideSuggest(); return; }
    sgItems = r.items; sgIdx = -1;
    var isYm = r.source === 'ym';
    sgEl.innerHTML = '<div class="sg-label"><span class="dot" style="background:' + (isYm ? '#FFD43B' : '#FF5A52') + '"></span>' + (isYm ? 'Подсказки Яндекс Музыки' : 'Подсказки YouTube') + '</div>' +
      sgItems.map(function (s, i){ return '<div class="sg-item" data-i="' + i + '">' + esc(s) + '</div>'; }).join('');
    sgEl.style.display = 'block';
  }
  search.addEventListener('input', function(){
    clearTimeout(sgTimer);
    var t = search.value.trim();
    if (t !== sgLastSearched) sgLastSearched = null;
    if (t.length < 2) { sgToken++; hideSuggest(); return; }
    sgTimer = setTimeout(function(){ loadSuggest(t); }, 220);
  });
  sgEl.addEventListener('mousedown', function(e){
    var it = e.target.closest('.sg-item'); if (!it) return;
    e.preventDefault(); pickSuggest(parseInt(it.dataset.i, 10));
  });
  search.addEventListener('blur', function(){ setTimeout(hideSuggest, 120); });
  search.addEventListener('keydown', function (e){
    var open = sgEl.style.display === 'block' && sgItems.length;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); sgIdx = Math.min(sgItems.length - 1, sgIdx + 1); highlightSg(); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); sgIdx = Math.max(-1, sgIdx - 1); highlightSg(); }
    else if (e.key === 'Escape') { hideSuggest(); }
    else if (e.key === 'Enter') { if (open && sgIdx >= 0) pickSuggest(sgIdx); else { hideSuggest(); doSearch(); } }
  });

  // Состояние поиска для подгрузки при прокрутке
  var curQuery = '', shownIds = new Set(), loadingMore = false, hasMoreYt = false, hasMoreYm = false, ymPage = 1, searchToken = 0;

  // ===== Варианты выдачи поиска =====
  var SMODES = [
    { id: 'smart', n: 'Умный', d: 'Точные совпадения с площадок, где есть полный доступ' },
    { id: 'exact', n: 'По точности', d: 'Сильнее всего совпадает с запросом — с любой площадки' },
    { id: 'subs', n: 'Сначала мои подписки', d: 'Яндекс с Плюсом, YouTube со входом; отрывки — вниз' },
    { id: 'free', n: 'Сначала бесплатные', d: 'SoundCloud, Audius, YouTube; Яндекс ниже' },
    { id: 'src', n: 'По площадкам', d: 'Разделами, в порядке из Настроек → Поиск' }
  ];
  var searchMode = 'smart', srcOrder = ['lc', 'ym', 'yt', 'sc', 'au'], ymPlus = false;
  if (A.getSetting) {
    A.getSetting('searchMode').then(function (v){ if (SMODES.some(function (m){ return m.id === v; })) { searchMode = v; renderSmode(); } });
    A.getSetting('srcOrder').then(function (v){ if (Array.isArray(v) && v.length) { srcOrder = v.filter(function (x){ return SRC[x]; }); if (srcOrder.indexOf('lc') < 0) srcOrder.unshift('lc'); ['ym', 'yt', 'sc', 'au'].forEach(function (x){ if (srcOrder.indexOf(x) < 0) srcOrder.push(x); }); renderSrcOrder(); } });
  }
  function smodeOf(id){ return SMODES.find(function (m){ return m.id === id; }) || SMODES[0]; }
  function renderSmode(){ renderSmodeSet(); var b = $('smode'); if (b) b.innerHTML = '<b>' + esc(smodeOf(searchMode).n) + '</b> <span aria-hidden="true">▾</span>'; var sb = document.querySelectorAll('#setSmode button'); for (var k = 0; k < sb.length; k++) sb[k].classList.toggle('on', sb[k].dataset.v === searchMode); }
  function setSearchMode(id){
    searchMode = id; renderSmode();
    if (A.setSetting) A.setSetting('searchMode', id);
    if (curQuery && !results.hidden) rerenderTracks(true);
    // Открытая внутри поиска страница (исполнитель, жанр, альбом из справочника) подбирала песни
    // по прежнему варианту — пересобираем её, если она всё ещё та же самая
    var pl = $('searchPl');
    if (pl && !pl.hidden && pl._rr && pl._rr.tok === pl._tok) pl._rr.fn();
  }
  function openSmodeMenu(){
    var pop = $('smodePop'); if (!pop) return;
    if (pop.classList.contains('open')) { pop.classList.remove('open'); return; }
    pop.innerHTML = '<div class="sg-label">Как упорядочивать найденное</div>' + SMODES.map(function (m){
      return '<div class="smp-item' + (m.id === searchMode ? ' on' : '') + '" data-v="' + m.id + '"><span class="n">' + (m.id === searchMode ? '✓ ' : '') + esc(m.n) + '</span><span class="d">' + esc(m.d) + '</span></div>';
    }).join('');
    pop.classList.add('open');
    Array.prototype.forEach.call(pop.querySelectorAll('.smp-item'), function (el){
      el.onclick = function(){ setSearchMode(el.dataset.v); pop.classList.remove('open'); };
    });
  }
  // клик мимо — закрыть список выдачи
  document.addEventListener('mousedown', function(e){
    var pop = $('smodePop'); if (!pop || !pop.classList.contains('open')) return;
    if (pop.contains(e.target) || (e.target.closest && e.target.closest('#smode'))) return;
    pop.classList.remove('open');
  });
  // Esc — тоже закрыть (раньше список оставался открытым и перекрывал выдачу)
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    var pop = $('smodePop'); if (pop && pop.classList.contains('open')) pop.classList.remove('open');
  });
  function renderSmodeSet(){
    var h = $('setSmode'); if (!h) return;
    h.innerHTML = SMODES.map(function (m){ return '<button data-v="' + m.id + '"' + (m.id === searchMode ? ' class="on"' : '') + '>' + esc(m.n) + '<small>' + esc(m.d) + '</small></button>'; }).join('');
  }
  function renderSrcOrder(){
    var h = $('setSrcOrder'); if (!h) return;
    h.innerHTML = srcOrder.map(function (src, i){
      return '<div class="so"><i>' + (i + 1) + '</i>' + srcDot({ src: src }) + '<b>' + esc(srcLabel(src)) + '</b>' +
        '<button data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Выше">↑</button><button data-dn="' + i + '"' + (i === srcOrder.length - 1 ? ' disabled' : '') + ' aria-label="Ниже">↓</button></div>';
    }).join('');
  }
  $('setSmode').addEventListener('click', function(e){ var b = e.target.closest('button[data-v]'); if (!b) return; setSearchMode(b.dataset.v); renderSmodeSet(); });
  $('setSrcOrder').addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var i = parseInt(b.dataset.up != null ? b.dataset.up : b.dataset.dn, 10), j = b.dataset.up != null ? i - 1 : i + 1;
    var t = srcOrder[i]; srcOrder[i] = srcOrder[j]; srcOrder[j] = t;
    if (A.setSetting) A.setSetting('srcOrder', srcOrder);
    renderSrcOrder();
    if (curQuery && !results.hidden) rerenderTracks(true);
  });
  renderSmodeSet(); renderSrcOrder();

  // ===== Стартовый чеклист сервисов (быстрая проверка при каждом запуске) =====
  // Пункты и группы — из общего src/qc-list.js: тем же списком пользуется раздел
  // «Состояние сервисов» в настройках (Ф4). Модули (бот, Streamer.bot) дописывают
  // свои строки в QC_GROUPS при подключении.
  var QC_GROUPS = TapQC.groups();
  var QC_ACT = { 'ym-login': 'войти', 'ym-site-login': 'войти на сайте', 'yt-login': 'войти', update: 'обновить', vpn: 'что делать', fix: 'починить', retry: 'ещё раз', login: 'войти', 'login-broadcaster': 'войти', cloud: 'куда смотреть', sbot: 'открыть' };
  var QC_HELP = {
    net: 'Нет интернета. Проверю ещё раз через 30 секунд.',
    'ym.acc': 'Вход в Яндекс устарел или его нет — нажми «войти». Без входа Яндекс даёт только отрывки.',
    'ym.play': 'Яндекс не отдаёт поток. Нажми «Починить автоматически»; если не поможет — отчёт уже у разработчика, Тапёр пока будет играть через сайт Яндекса или YouTube.',
    'ym.site': 'Запасной путь — сайт Яндекса в скрытом окне. Если нет входа, нажми «войти на сайте»; если сайт поменялся — «Починить автоматически» скачает свежие правила с GitHub. Проверяется не на ходу, а глубокой проверкой, и только когда музыка не играет.',
    'ym.svc': 'Яндекс Музыка не отвечает. Скорее всего, это у них — подожди немного.',
    'yt.svc': 'YouTube не отвечает. Часто так бывает без VPN. Поиск и очередь работают без него: песни с YouTube Тапёр найдёт в Яндексе и SoundCloud.',
    'yt.dlp': 'Вышла новая версия движка для YouTube — «Починить автоматически» обновит его.',
    app: 'Вышла новая версия Тапёра — нажми «обновить».'
  };
  var QC = { items: {}, running: false, t0: 0, open: true, fixing: false, fixLog: [], help: {}, at: 0, view: false };
  var QC_ALL = []; QC_GROUPS.forEach(function (g){ g[1].forEach(function (it){ QC_ALL.push(it[0]); }); });
  function qcVisibleIds(){ return QC_ALL; }
  // ===== Автопочинка (0.34.0, шаг 5) =====
  // Главный процесс сам пробует починить сервис один раз. Здесь показываем, что он делает:
  // «ждёт паузы», «войдите заново» или «не вышло» с кнопкой «Починить» и подсказкой.
  var AUTOFIX = {};
  var AF_HELP = {
    youtube: 'YouTube не отвечает или движок устарел. Нажми «Починить»; если не поможет — проверь VPN: без него YouTube часто недоступен.',
    yandex: 'Яндекс не отвечает. Нажми «Починить»; если не поможет — подожди, скорее всего это у Яндекса.',
    donationalerts: 'DonationAlerts не отвечает. Нажми «Починить»; если не поможет — проверь вход в «Стримерам».',
    donatepay: 'DonatePay не отвечает. Нажми «Починить»; если не поможет — проверь вход в «Стримерам».',
    cloud: 'Облачные функции Тапёра не отвечают: вход и отчёты могут не работать. Нажми «Починить»; если не поможет — смотри подсказку в строке «Облачные функции».',
    lastfm: 'Last.fm не отвечает — из России он обычно работает только через VPN. Описания и похожие могут не грузиться. Нажми «Починить».'
  };
  var AF_ACT = { youtube: 'yt-login', yandex: 'ym-login', donationalerts: 'login', donatepay: 'login' };
  // Какие строки быстрой проверки относятся к тому же сервису: чтобы не считать одну
  // и ту же проблему дважды (и в проверке, и в автопочинке).
  var AF_QC = {
    youtube: ['yt.svc', 'yt.login', 'yt.dlp'],
    yandex: ['ym.svc', 'ym.acc', 'ym.play', 'ym.site'],
    cloud: ['cloud'],
    lastfm: ['refs'],
    donationalerts: ['don'],
    donatepay: ['don']
  };
  function afProblems(){
    var out = [];
    Object.keys(AUTOFIX).forEach(function (s){
      var a = AUTOFIX[s];
      if (a && (a.state === 'не вышло' || a.state === 'нужен вход' || a.state === 'ждёт' || a.state === 'чинит')) out.push(s);
    });
    return out;
  }
  function afBadIds(){
    return afProblems().filter(function (s){ var a = AUTOFIX[s]; return a && (a.state === 'не вышло' || a.state === 'нужен вход'); });
  }
  // «Не вышло» по сервису, которого ещё нет в строках быстрой проверки: чтобы не считать
  // одну и ту же проблему дважды (и в списке, и в автопочинке).
  function afExtraIds(){
    var probs = qcProblems();
    return afBadIds().filter(function (s){
      var mine = AF_QC[s] || [];
      return !mine.some(function (id){ return probs.indexOf(id) >= 0; });
    });
  }
  function afText(a){
    if (!a) return '';
    if (a.state === 'ждёт') return 'ждёт паузы — починю, когда музыка остановится';
    if (a.state === 'чинит') return 'чиню…';
    if (a.state === 'нужен вход') return 'вход отозван — войдите заново';
    return 'починить не вышло — подсказка ниже';
  }
  function qcProblems(){ return qcVisibleIds().filter(function (id){ var x = QC.items[id]; return x && (x.state === 'bad' || x.state === 'warn'); }); }
  // QC.view — проверки показаны вместо выдачи (Ф3): их открыли по «⚠ Проблем»
  // или по свёрнутому списку. Обычный новый поиск возвращает выдачу.
  function qcVisible(){ return QC.view || (!curQuery && !results.hidden); }
  // Показать проверки вместо выдачи: свернуть выданное (и страницу внутри поиска),
  // встать наверх. Возврат — обычным новым поиском.
  function qcShow(){
    QC.view = true;
    if (curQuery) {
      // Гасим запрос и поздние ответы площадок: иначе они дорисуют выдачу под проверками
      curQuery = ''; search.value = ''; S.tracks = []; shownIds = new Set();
      loadingMore = false; hasMoreYt = false; hasMoreYm = false; searchToken++;
    }
    closeSearchList();   // убираем страницу исполнителя/альбома, открытую внутри поиска
    results.hidden = true;
    QC.open = true;
    setTab('search');
    setHint('');
    renderQC();
    var box = $('qcBox');
    if (box) {
      box.hidden = false;
      box.scrollTop = 0;
      if (box.scrollIntoView) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
  // Новый поиск выходит из режима проверок — выдаче снова главное место.
  function qcLeave(){
    QC.view = false;
    results.hidden = false;
    renderQC();
  }
  // Строки быстрой проверки — один и тот же HTML для чеклиста в поиске и для
  // раздела «Состояние сервисов» в настройках (Ф4). Данные — QC_GROUPS + QC.items.
  function qcRowsHtml(){
    var h = '<div class="qc-list">';
    QC_GROUPS.forEach(function (g){
      h += '<div class="ck-g">' + esc(g[0]) + '</div>';
      g[1].forEach(function (it){
        var x = QC.items[it[0]] || { state: QC.running ? 'run' : '', text: 'ждёт' };
        var st = x.state === 'off' ? '' : x.state;
        h += '<div class="ck-r ' + st + '"><i class="lamp ' + st + '"></i><span class="n">' + esc(it[1]) + '</span><span class="v" title="' + esc(noLib(x.details || x.text)) + '">' + esc(noLib(x.text)) + (x.action && QC_ACT[x.action] && (x.state === 'bad' || x.state === 'warn' || x.state === 'off') ? '<button data-qa="' + x.action + '" data-qid="' + it[0] + '">' + QC_ACT[x.action] + '</button>' : '') + '</span></div>';
      });
    });
    return h + '</div>';
  }
  function renderQC(){
    var box = $('qcBox'); if (!box) return;
    if (!qcVisible()) { box.hidden = true; return; }
    box.hidden = false;
    var done = qcVisibleIds().filter(function (id){ var x = QC.items[id]; return x && x.state !== 'run'; }).length;
    var probs = qcProblems(), bad = probs.filter(function (id){ return QC.items[id].state === 'bad'; });
    // Автопочинка: «не вышло» и «нужен вход» — проблемы; плюс те, которых нет в строках проверки.
    var afExtra = afExtraIds();
    var probN = probs.length + afExtra.length;
    var badN = bad.length + afExtra.length;
    var sec = ((QC.running ? Date.now() : (QC.at || Date.now())) - QC.t0) / 1000;
    if (!QC.open && !QC.running && !QC.fixing) {
      box.innerHTML = '<button class="ck-mini" id="qcMini"><i class="lamp ' + (badN ? 'bad' : (probN ? 'warn' : 'ok')) + '"></i>' + (probN ? 'Проблем: ' + probN + ' · подробнее' : 'Все сервисы работают · ' + done + '/' + qcVisibleIds().length) + (QC.at ? ' · проверено в ' + new Date(QC.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '') + '</button>';
      $('qcMini').onclick = qcShow;
      return;
    }
    var title = QC.fixing ? 'Чиню…' : (QC.running ? 'Проверяю сервисы' : (probN ? (badN ? 'Есть ' + probN + ' ' + qcWord(probN) : 'Работает, но есть замечания: ' + probN) : 'Все сервисы работают'));
    var sub = QC.running ? 'Каждый запуск — быстро и тихо. Можно сразу искать музыку.' : (probN ? 'Остальное работает. Слушать можно уже сейчас.' : 'Всё на месте. Тапёр проверяет это при каждом запуске.');
    var h = '<div class="ck"><div class="ck-h"><b>' + esc(title) + '</b><span>' + done + ' из ' + qcVisibleIds().length + ' · ' + sec.toFixed(1).replace('.', ',') + ' с</span></div><div class="ck-sub">' + sub + '</div>';
    // Строки автопочинки — первыми: если Тапёр пробовал и не вышло (или ждёт паузы),
    // это должно быть на виду, а не ниже списка сервисов. Успешную не показываем —
    // о ней сказал тост, а счётчик живёт в «Состоянии».
    var af = afProblems();
    if (af.length) {
      h += '<div class="ck-g">Автопочинка</div>';
      var afNotes = [];
      af.forEach(function (s){
        var a = AUTOFIX[s] || {};
        var st = (a.state === 'не вышло' || a.state === 'нужен вход') ? 'bad' : 'warn';
        var btn = '';
        if (a.state === 'не вышло') btn = '<button data-qa="autofix" data-qid="' + s + '">Починить</button>';
        else if (a.state === 'нужен вход' && AF_ACT[s]) btn = '<button data-qa="' + AF_ACT[s] + '" data-qid="' + s + '">войти</button>';
        var rowText = afText(a);
        var rowTitle = rowText + (a.reason ? ' (' + a.reason + ')' : '');
        h += '<div class="ck-r ' + st + '"><i class="lamp ' + st + '"></i><span class="n">' + esc(a.name || s) + '</span><span class="v" title="' + esc(rowTitle) + '">' + esc(rowText) + btn + '</span></div>';
        if (a.state === 'не вышло') {
          afNotes.push('<p><b>' + esc(a.name || s) + '.</b> ' + esc(AF_HELP[s] || 'Нажми «Починить» ещё раз.') + (a.reason ? ' Причина: ' + esc(a.reason) + '.' : '') + '</p>');
        }
      });
      // «Что делать» — сразу под строками, чтобы не искать ниже всего списка.
      if (afNotes.length) h += '<div class="ck-note">' + afNotes.join('') + '</div>';
    }
    h += qcRowsHtml();
    var notes = [];
    if (QC.fixLog.length) notes.push('<p><b>Автопочинка:</b></p>' + QC.fixLog.map(function (f){ return '<p>' + (f.ok ? '✓ ' : '✗ ') + esc(f.t) + '</p>'; }).join(''));
    probs.forEach(function (id){
      var it = QC.items[id];
      // Облако: подсказка своя для каждой функции — что случилось и куда смотреть
      if (id === 'cloud' && it.where && (it.state === 'bad' || QC.help[id])) { it.where.forEach(function (w){ notes.push('<p><b>' + esc(w.name) + '.</b> ' + esc(w.text) + ' <a href="#" data-qlink="' + esc(w.link) + '">Открыть</a></p>'); }); return; }
      if (QC_HELP[id] && (it.state === 'bad' || QC.help[id])) notes.push('<p>' + esc(QC_HELP[id]) + '</p>');
    });
    if (notes.length) h += '<div class="ck-note">' + notes.join('') + '</div>';
    h += '<div class="ck-f"><button class="pbtn ' + (probN ? 'y' : 'g') + '" id="qcFix"' + (QC.running || QC.fixing || !probN ? ' disabled' : '') + '>Починить автоматически</button><button class="pbtn g" id="qcMore">Подробности</button>' + (!QC.running && !probN ? '<button class="pbtn g" id="qcHide">Свернуть</button>' : '') + '<small>' + (QC.at && !QC.running ? 'проверено в ' + new Date(QC.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'проверка не мешает поиску') + '</small></div></div>';
    box.innerHTML = h;
    $('qcFix').onclick = runFix;
    $('qcMore').onclick = function(){ setTab('settings', 'sHealth'); setTimeout(function(){ if (typeof showSettingsPane === 'function') showSettingsPane('sHealth'); else { var e = $('sHealth'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 50); };
    var hb = $('qcHide'); if (hb) hb.onclick = function(){ QC.open = false; renderQC(); };
    box.querySelectorAll('[data-qa]').forEach(function (b){ b.onclick = function(){ qcAction(b.dataset.qa, b.dataset.qid); }; });
    box.querySelectorAll('[data-qlink]').forEach(function (a){ a.onclick = function(e){ e.preventDefault(); if (A.openExternal) A.openExternal(a.dataset.qlink); }; });
  }
  function qcWord(n){ n = n % 100; if (n >= 11 && n <= 14) return 'проблем'; n = n % 10; if (n === 1) return 'проблема'; if (n >= 2 && n <= 4) return 'проблемы'; return 'проблем'; }
  function qcAction(a, id){
    if (a === 'autofix') {
      // Ручное «Починить» для одного сервиса: снимает отметку «один раз» в главном процессе.
      if (!A.autofixRun) return;
      toast('Чиню…');
      A.autofixRun(id).then(function (r){
        if (r && r.services) { AUTOFIX = r.services; renderQC(); renderHealthWarn(); }
        if (!r || !r.ok) { toast('Не получилось: ' + ((r && r.error) || 'главный процесс не ответил')); return; }
        var res = r.result || {};
        // Тост об успехе/неудаче уже показал главный процесс; здесь только обновляем список.
        if (res.action === 'waiting') { renderQC(); return; }
        qcSoon();
      }).catch(function (e){ toast('Не получилось: ' + ((e && e.message) || e)); });
      return;
    }
    if (a === 'login' || a === 'login-broadcaster') { openBotPanel('conn'); return; } // чат-бот (src/ui/24-bot.js)
    if (a === 'sbot') { if (typeof sbOpen === 'function') sbOpen(); return; }        // Streamer.bot (src/ui/30-sbot.js)
    if (a === 'ym-login') browserLogin();
    else if (a === 'ym-site-login') { if (A.ymwebLogin) A.ymwebLogin().then(function (r){ toast(r && r.ok ? 'Вход на сайте Яндекса выполнен' : 'Вход на сайте не завершён'); if (r && r.ok) qcSoon(); }); }
    else if (a === 'yt-login') openYtDlg();
    else if (a === 'fix' && id === 'yt.dlp') runFix();
    else if (a === 'update') { if (A.updateCheck) A.updateCheck(); toast('Проверяю обновление — кнопка «Обновить» появится в шапке'); }
    else if (a === 'vpn' || a === 'cloud') { QC.help[id] = !QC.help[id]; renderQC(); }
    else if (a === 'fix') runFix();
    else if (a === 'retry') runQC();
  }
  var qcTick = null, qcRetry = null;
  // Перепроверить чуть позже (после входа, починки, глубокой проверки); если проверка идёт — сразу после неё
  var qcSoonT = null;
  function qcSoon(){ clearTimeout(qcSoonT); qcSoonT = setTimeout(function(){ if (QC.running || QC.fixing) { QC.again = true; return; } runQC(); }, 800); }
  // Глубокая проверка по сигналу быстрой — не чаще одного раза в 30 минут на тот же набор проблем.
  // Иначе «быстрая → глубокая → быстрая» крутится каждые ~8 секунд (STAB-R8). Набор изменился
  // (появилась новая проблема) — можно сразу. Состояние живёт в памяти окна, после перезапуска — заново.
  var HEALTH_BY_QC_MS = 30 * 60 * 1000;
  var healthByQcState = { key: '', at: 0 };
  // Чистая проверка «можно ли сейчас»: ничего не меняет, состояние передаёт вызывающий.
  function healthByQcAllowed(now, key, state){
    if (!key) return false;
    var st = state || {};
    if (!st.key || st.key !== key) return true;
    return !(st.at && now - st.at < HEALTH_BY_QC_MS);
  }
  async function runQC(){
    if (!A.qcRun || QC.running) { QC.again = true; return; }
    QC.again = false;
    // Лампочки бота (bot.*) приходят не из этой проверки, а из модуля (src/ui/24-bot.js).
    // Запоминаем их и возвращаем после перепроверки — иначе они гаснут в серое «ждёт».
    var keepBot = {};
    Object.keys(QC.items).forEach(function (k) { if (k.indexOf('bot.') === 0) keepBot[k] = QC.items[k]; });
    QC.running = true; QC.t0 = Date.now(); QC.items = {}; QC.at = 0;
    clearInterval(qcTick); qcTick = setInterval(renderQC, 400);
    renderQC();
    var r = null, qcError = null;
    try { r = await A.qcRun(); } catch (e) { qcError = e; }
    QC.running = false; clearInterval(qcTick);
    if (r && r.items) { QC.items = r.items; QC.at = r.at; }
    Object.keys(keepBot).forEach(function (k) { if (!QC.items[k]) QC.items[k] = keepBot[k]; });
    // Не выдаём «все сервисы работают», если сама проверка не запустилась.
    if (qcError && !Object.keys(QC.items).length) QC.items.net = { state: 'bad', text: 'быстрая проверка не запустилась: ' + (qcError.message || qcError) };
    var probs = qcProblems(), first = false;
    try { first = !localStorage.getItem('qcSeen'); localStorage.setItem('qcSeen', '1'); } catch (e) {}
    if (!probs.length && !first && !QC.fixLog.length) setTimeout(function(){ if (!QC.running && !qcProblems().length) { QC.open = false; renderQC(); } }, 1600);
    else QC.open = true;
    renderQC(); renderHealthWarn();
    // Раздел «Состояние сервисов» в настройках показывает те же лампочки (Ф4)
    if (typeof renderHealth === 'function') renderHealth();
    if (typeof botQcRefresh === 'function') botQcRefresh(); // лампочки бота — по факту
    clearTimeout(qcRetry);
    if (QC.items.net && QC.items.net.state === 'bad') qcRetry = setTimeout(runQC, 30000);
    // Нашли проблему с воспроизведением — глубокая проверка (когда ничего не играет)
    // Не дёргаем глубокую проверку поверх автопочинки: окно сайта Яндекса одно на двоих
    var healthKey = probs.filter(function (id){ return /^(ym\.play|ym\.site|yt\.dlp)$/.test(id); }).sort().join(',');
    if (!healthKey) { healthByQcState = { key: '', at: 0 }; }
    else if (typeof runHealth === 'function' && healthByQcAllowed(Date.now(), healthKey, healthByQcState)) {
      healthByQcState = { key: healthKey, at: Date.now() };
      setTimeout(function(){ if (QC.fixing) return; try { runHealth(false); } catch (e) {} }, 4000);
    }
    if (QC.again) qcSoon();
  }
  async function runFix(){
    if (!A.autoFix || QC.fixing) return;
    QC.fixing = true; QC.open = true; QC.fixLog = []; renderQC();
    var r = null;
    try { r = await A.autoFix(); }
    catch (e) { axLog('автопочинка: ' + (e && e.message || e)); }
    QC.fixing = false;
    var q = A.qcGet ? await A.qcGet() : null;
    var keepBotFix = {};
    Object.keys(QC.items).forEach(function (k) { if (k.indexOf('bot.') === 0) keepBotFix[k] = QC.items[k]; });
    if (q && q.items) { QC.items = q.items; QC.at = q.at; }
    Object.keys(keepBotFix).forEach(function (k) { if (!QC.items[k]) QC.items[k] = keepBotFix[k]; });
    renderQC(); renderHealthWarn();
    runQC(); // контрольная перепроверка после починки — лампочки по факту
    toast(r && !r.left ? 'Починил — всё работает' : 'Сделал, что мог — подробности в списке');
  }
  if (A.onQcItem) A.onQcItem(function (it){
    // Строки чат-бота, когда ботом не пользуются, — серые (src/ui/24-bot.js, botQcItem)
    if (it && typeof botQcItem === 'function' && String(it.id).indexOf('bot.') === 0) it = botQcItem(it);
    QC.items[it.id] = it;
    // health модуля бота приходит именно так — без перерисовки лампочка не меняла цвет
    renderQC();
    // проверка при старте знает про YouTube раньше всех — сообщаем общему состоянию (и заказам)
    if (it.id === 'yt.svc' && SVC.ytOn) { if (it.state === 'bad') markYtDown('проверка: ' + (it.text || 'не отвечает')); else if (it.state === 'ok') markYtOk(); }
    renderHealthWarn();
    if (typeof renderHealth === 'function') renderHealth();
  });
  if (A.onFixStep) A.onFixStep(function (f){ QC.fixLog.push(f); renderQC(); });
  // Автопочинка: главный процесс присылает новое состояние, когда начинает, ждёт паузы,
  // починил или не смог. Список обновляем без перезапуска проверки.
  if (A.onAutofixState) A.onAutofixState(function (s){
    AUTOFIX = (s && s.services) || {};
    renderQC(); renderHealthWarn();
  });
  if (A.autofixGet) A.autofixGet().then(function (r){
    if (r && r.ok && r.services) { AUTOFIX = r.services; renderQC(); renderHealthWarn(); }
  }).catch(function () {});
  // Значок ⚠ в шапке: и быстрая проверка, и глубокая — в одном месте
  function healthWarnList(){
    var ids = [], names = [];
    qcProblems().forEach(function (id){
      // «Нет интернета» раньше не попадало в значок, и он спорил с заголовком списка
      // («Есть 1 проблема» против «Проблем: 0»). Значок говорит «Проблем», значит считаем.
      if (id === 'net') { if (names.indexOf('нет интернета') < 0) names.push('нет интернета'); return; }
      var it = QC.items[id];
      if (!it || (it.state !== 'bad' && it.state !== 'warn')) return;
      ids.push(id);
      var nm = null;
      QC_GROUPS.forEach(function (g){ g[1].forEach(function (x){ if (x[0] === id) nm = g[0] + ' · ' + x[1]; }); });
      names.push(nm || id);
    });
    // Автопочинка не вышла или просит войти — это проблема в шапке, если её ещё нет
    // в строках быстрой проверки (иначе одна причина считалась бы дважды).
    afExtraIds().forEach(function (s){
      var a = AUTOFIX[s] || {};
      names.push((a.name || s) + ' — ' + (a.state === 'нужен вход' ? 'вход отозван, войдите заново' : 'автопочинка не вышла'));
    });
    var hs = (health && health.services) || {};
    // YouTube перестал отвечать по ходу работы (поиск, воспроизведение, заказы) — тоже проблема в шапке
    if (typeof SVC !== 'undefined' && SVC.ytOn && !ytUsable() && ids.indexOf('yt.svc') < 0 && names.indexOf('YouTube не отвечает') < 0) names.push('YouTube не отвечает');
    ['yandex', 'youtube'].forEach(function (k){
      var st = hs[k];
      var mine = { yandex: ['ym.svc', 'ym.acc', 'ym.play', 'ym.site'], youtube: ['yt.svc', 'yt.login', 'yt.dlp'] }[k] || [];
      if (!st || (st.status !== 'fail' && st.status !== 'warn')) return;
      if (mine.some(function (id){ return ids.indexOf(id) >= 0; })) return; // про это уже сказано в списке проверки
      names.push((SVC_NAMES[k] || k) + ' — ' + (st.status === 'fail' ? 'не работает' : 'частично'));
    });
    return names;
  }
  // Показывает значок, когда проблемы есть, и ГАСИТ его, когда всё починилось
  function renderHealthWarn(){
    var w = $('healthWarn'); if (!w) return;
    // Одна и та же причина может прийти и из проверки, и из автопочинки — не считаем дважды.
    var bad = healthWarnList().filter(function (x, i, a){ return a.indexOf(x) === i; });
    if (!bad.length) { w.hidden = true; w.textContent = ''; w.removeAttribute('title'); return; }
    w.hidden = false;
    w.textContent = '⚠ Проблем: ' + bad.length;
    w.title = bad.join(' · ') + ' — нажми, чтобы открыть список проверки';
  }
  setTimeout(runQC, 600);
  // Отчёты: проверка отправки и что отправляется
  if ($('repTest')) $('repTest').onclick = async function(){
    var n = $('repNote'); n.textContent = 'Отправляю тестовый отчёт…';
    var r = A.reportTest ? await A.reportTest() : null;
    n.textContent = r && r.ok ? '✓ Связь есть — тестовый отчёт принят' + (r.issue ? ' (задача #' + r.issue + ' на GitHub)' : '') : '✗ Не отправилось: ' + ((r && (r.error || r.status)) || 'нет ответа') + '. Возможно, мешает VPN или блокировка';
  };
  if ($('repPreview')) $('repPreview').onclick = async function(){
    var r = A.reportPreview ? await A.reportPreview() : null;
    askDlg({ title: 'Что уходит в отчёте', text: '<pre style="white-space:pre-wrap;font:11px JetBrains Mono,monospace;color:var(--tx3);max-height:300px;overflow:auto">' + esc(JSON.stringify(r, null, 2)) + '</pre>', ok: 'Понятно' });
  };
