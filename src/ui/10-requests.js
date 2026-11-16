  // ===== Заказы со стрима: донаты с песнями =====
  // Фильтр ленты сообщений (15.11.2026, слово владельца): Все · Донаты · Твич чат · Баллы канала.
  // Вид сообщения: заказ бота пака или Streamer.bot — чат или баллы (prov *-points), остальное — донат.
  var RQ_KINDS = [['all', 'Все'], ['don', 'Донаты'], ['chat', 'Твич чат'], ['pts', 'Баллы канала']];
  function rqKind(r){ return r && r.bot ? (/-points$/.test(String(r.prov || '')) ? 'pts' : 'chat') : 'don'; }
  // Кнопки фильтра с числом сообщений каждого вида; attr — data-атрибут кнопок (окно и док-панель — свои)
  function rqFilterHtml(list, cur, attr){
    var n = { all: list.length, don: 0, chat: 0, pts: 0 };
    list.forEach(function (r){ n[rqKind(r)]++; });
    return '<div class="rq-flt" role="group" aria-label="Какие сообщения показывать">' + RQ_KINDS.map(function (k){
      return '<button type="button" class="' + (cur === k[0] ? 'on' : '') + '" ' + attr + '="' + k[0] + '" aria-pressed="' + (cur === k[0]) + '">' + k[1] + ' <span>' + n[k[0]] + '</span></button>';
    }).join('') + '</div>';
  }
  var RQ_FEED_SRC = (function (){ try { var v = localStorage.getItem('tapRqFeedSrc'); return /^(all|don|chat|pts)$/.test(v || '') ? v : 'all'; } catch (e) { return 'all'; } })();
  var RQ = { list: [], don: null, testOpen: false, altOpen: {}, pick: {}, testText: '', testAmt: 100, feedOpen: true, doneOpen: false };
  var RQ_REJECT = { long: 1, stop: 1, nonmusic: 1 };
  var CURSYM = { RUB: '₽', UAH: '₴', KZT: '₸', USD: '$', EUR: '€' };
  var DON_NAMES = { da: 'DonationAlerts', dp: 'DonatePay', test: 'пробный', 'twitch-cmd': 'Twitch · команда', 'twitch-points': 'Twitch · баллы', 'sb-cmd': 'Streamer.bot · команда', 'sb-points': 'Streamer.bot · баллы' };
  // Включённые сервисы донатов (вернуть: добавить сюда и в PROVIDERS в donations.js)
  var DON_ON = ['da', 'dp'];
  function rqSame(v, t){ return v && t && String(v.id) === String(t.id) && srcOf(v) === srcOf(t); }
  // Трек мог замениться на другой источник при сбое воспроизведения — тогда сравниваем по «исполнитель — название»
  function rqName(t){ return t ? String((t.author || '') + ' ' + (t.title || '')).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : ''; }
  function rqMatch(v, t){ if (rqSame(v, t)) return true; var a = rqName(v), b = rqName(t); return !!a && a === b; }
  function rqFlags(it){
    var f = (it.flags || []).slice();
    if (it.failed && !it.state) f.push({ k: 'failed', t: 'не включился: ' + it.failed });
    else if (it.track && it.state !== 'added') {
      var cur = queue[current];
      // по «исполнитель — название»: одна песня в разных альбомах Яндекса имеет разные id
      if (queue.some(function (v, i){ return i > current && !v.played && rqMatch(v, it.track); }) || (cur && rqMatch(cur, it.track))) f.push({ k: 'repeat', t: 'уже в очереди' });
      else if (queue.some(function (v){ return v.played && rqMatch(v, it.track); })) f.push({ k: 'repeat', t: 'уже играла сегодня' });
    }
    return f;
  }
  function rqCls(it){ if (it.state === 'added') return 'added'; var f = rqFlags(it); if (f.some(function (x){ return RQ_REJECT[x.k]; })) return 'rj'; return it.level === 'exact' && it.track ? 'ex' : 'db'; }
  function rqAutoOk(it){
    if (!(it.level === 'exact' && it.track && !it.state && it.paid !== false)) return false;
    var rules = REQ_RULES || {};
    return !rqFlags(it).some(function (x){
      if (RQ_REJECT[x.k]) return true;
      if (x.k === 'explicit' && rules.explicitOk === false) return true;
      if (x.k === 'repeat' && rules.repeatOk === false) return true;
      if (x.k === 'version' && rules.versionOk === false) return true;
      return false;
    });
  }
  function rqPending(r){ return r.state === 'dismissed' || r.droppedAt ? [] : (r.items || []).filter(function (it){ return !it.state; }); }
  // Лента сообщений хранится сутки
  var RQ_DAY = 24 * 3600 * 1000;
  // Заказ выполнен, как только попал в треклист (очередь)
  function rqDoneIt(it){ return it.state === 'added' && !!it.track; }
  // Заказ определился точно (независимо от того, встал он уже в очередь или нет)
  function rqExact(it){
    if (!it.track || it.state === 'skip' || it.paid === false) return false;
    if (rqFlags(it).some(function (x){ return RQ_REJECT[x.k]; })) return false;
    return it.level === 'exact';
  }
  // Активные заказы: точно определились и ещё НЕ попали в треклист
  function rqActive(it){ return rqExact(it) && !it.state; }
  function rqMoney(r){ if (r.bot) return /-points$/.test(r.prov) ? 'баллы' : 'чат'; return (r.amount != null ? (Math.round(r.amount * 100) / 100) : '?') + ' ' + (CURSYM[r.currency] || r.currency || ''); }
  function rqAgo(t){ var m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'только что'; if (m < 60) return m + ' мин назад'; var h = Math.round(m / 60); if (h < 24) return h + ' ч назад'; return Math.round(h / 24) + ' дн назад'; }
  function rqSave(r){ A.reqUpdate && A.reqUpdate(r.key, { items: r.items, state: r.state }); }
  // Трек заказа не включился (неполадка) — заказ снова активный, с пометкой; авторежим его не повторяет
  function rqFailed(v, why){
    var q = v.req; if (!q) return;
    var r = null; for (var k = 0; k < RQ.list.length; k++) if (RQ.list[k].key === q.key) { r = RQ.list[k]; break; }
    if (!r || !r.items) return;
    var it = r.items[q.ii];
    if (!it || !it.track || !rqMatch(it.track, v)) it = r.items.filter(function (x){ return x.state === 'added' && x.track && rqMatch(x.track, v); })[0];
    if (!it) return;
    delete it.state; it.failed = String(why || 'неполадка').replace(/^⚠\s*/, '').slice(0, 80);
    if (r.state === 'done') r.state = 'new';
    botNotify(v, 'dropped', 'failed');
    axLog('заказ не включился: «' + (v.author || '') + ' — ' + v.title + '» (' + (q.who || '') + ') — вернул в «Заказы»');
    rqSave(r); rqRender();
  }
  // Заказ из чата: паку — bot-placed/bot-order, Streamer.bot (0.35) — свои sbot-*.
  function rqIsSb(r){ return !!(r && /^sb-/.test(r.key || '')); }
  function rqBotPlaced(r, place, eta){
    if (!r || !r.bot) return;
    if (rqIsSb(r)) { if (A.sbotPlaced) A.sbotPlaced(r.key, place, eta); }
    else if (A.botPlaced) A.botPlaced(r.key, place, eta);
  }
  function rqBotDrop(r, type, extra){
    if (!r || !r.bot) return;
    if (rqIsSb(r)) { if (A.sbotOrder) A.sbotOrder(type, r.key, extra); }
    else if (A.botOrder) A.botOrder(type, r.key, extra);
  }
  function rqAdd(r, it, track, now){
    var t = track || it.track; if (!t) return;
    var c = copyTrack(t); c.req = { who: r.name || 'Аноним', amt: r.amount, cur: r.currency, key: r.key, ii: (r.items || []).indexOf(it) };
    var placed = now ? playNow(c) : addReq(c);
    // заказ чат-бота: сообщить боту место и примерное время — он ответит зрителю «через ~N мин»
    if (r.bot && (A.botPlaced || A.sbotPlaced)) {
      var qi = queue.indexOf(placed || c), eta = 0, m0 = master();
      if (m0 && m0.duration && isFinite(m0.duration)) eta += Math.max(0, m0.duration - (m0.currentTime || 0));
      for (var q2 = current + 1; q2 < qi; q2++) eta += (queue[q2] && queue[q2].seconds) || 210;
      rqBotPlaced(r, qi > current ? qi - current : 1, Math.round(eta));
    }
    it.state = 'added'; delete it.failed; if (track && track !== it.track) { it.alts = [it.track].concat((it.alts || []).filter(function (x){ return x !== track; })).filter(Boolean); it.track = track; }
    if (it.query && it.level !== 'exact' && A.reqRemember) A.reqRemember(it.query, t);
    if (rqPending(r).length === 0 && r.state !== 'dismissed') r.state = 'done';
    rqSave(r); rqRender();
  }
  function rqItemHtml(r, ri, it, ii, opts){
    var cls = rqCls(it), f = rqFlags(it), id = ri + ':' + ii;
    var lv = it.state === 'added' ? '✓ ДОБАВЛЕНО' : it.state === 'skip' ? 'ПРОПУЩЕНО' : cls === 'rj' ? '⛔ НЕ ПРИНИМАЕТСЯ' : cls === 'ex' ? '✔ ТОЧНО' : '? ПОД СОМНЕНИЕМ';
    var showLv = !(opts && opts.dock && cls === 'db');
    var h = '<div class="rq-it ' + cls + '">' + (showLv ? '<span class="rq-lv">' + lv + '</span>' : '');
    if (it.track) {
      var t = it.track;
      h += '<div class="rq-tr">' + (t.thumb ? '<img src="' + esc(t.thumb) + '" alt="" loading="lazy">' : '<span class="ph"></span>') + '<div class="tm"><div class="tt">' + esc(t.author ? t.author + ' — ' + t.title : t.title) + '</div><div class="ts">' + esc(srcName(t) + (t.duration ? ' · ' + t.duration : '') + (t.album ? ' · ' + t.album : '')) + '</div></div></div>';
    } else if (it.note && !(opts && opts.dock && cls === 'db')) h += '<div class="rq-note">' + esc(it.note) + (it.query ? ' · «' + esc(it.query) + '»' : '') + '</div>';
    var chips = f.map(function (x){ return '<span class="' + (RQ_REJECT[x.k] ? 'rj' : '') + '">' + esc(x.t) + '</span>'; });
    if (it.paid === false) chips.push('<span class="pay">не хватает суммы</span>');
    if (chips.length) h += '<div class="rq-fl">' + chips.join('') + '</div>';
    if (!it.state) {
      var alts = [it.track].concat(it.alts || []).filter(Boolean);
      if (RQ.altOpen[id] && alts.length > 1) {
        h += '<div class="rq-alt">' + alts.map(function (t, k){ return '<label><input type="radio" name="rqa' + id + '" value="' + k + '"' + ((RQ.pick[id] == null ? 0 : +RQ.pick[id]) === k ? ' checked' : '') + '>' + esc((t.author ? t.author + ' — ' : '') + t.title) + ' <span style="color:var(--tx4)">' + esc(srcName(t) + (t.duration ? ' · ' + t.duration : '')) + '</span></label>'; }).join('') + '</div>';
      }
      h += '<div class="rq-b">';
      if (it.track) h += '<button class="pbtn qadd" data-rq="add" data-id="' + id + '">＋ В очередь</button><button class="rq-sm" data-rq="now" data-id="' + id + '">▶ Сейчас</button>';
      if (alts.length > 1) h += '<button class="rq-sm" data-rq="alts" data-id="' + id + '">' + (RQ.altOpen[id] ? 'Скрыть варианты' : 'Другие варианты (' + (alts.length - 1) + ')') + '</button>';
      if (it.link) h += '<button class="rq-sm" data-rq="link" data-id="' + id + '">Открыть ссылку</button>';
      h += '<button class="rq-sm" data-rq="find" data-id="' + id + '">Искать сам</button><button class="rq-sm" data-rq="skip" data-id="' + id + '">Не то</button></div>';
    }
    return h + '</div>';
  }
  // YouTube был нужен для заказа, но не отвечал: мелкая пометка, где искали на самом деле,
  // и «Искать снова», если песня не нашлась точно. Выключенный пользователем YouTube — не поломка, молчим.
  var SRC_WHERE = { ym: 'в Яндексе', lc: 'в своих файлах', sc: 'на SoundCloud', au: 'в Audius' };
  function rqYtNote(r, ri, only){
    if (!r.ytDown) return '';
    var w = (r.srcUsed || []).map(function (k){ return SRC_WHERE[k]; }).filter(Boolean);
    var where = w.length ? 'искал ' + (w.length > 1 ? w.slice(0, -1).join(', ') + ' и ' + w[w.length - 1] : w[0]) : 'открывал только ссылки';
    var exact = only ? only.level === 'exact' : r.level === 'exact';
    return '<div class="rq-srcnote">YouTube не отвечал — ' + where + (exact ? '' : '<button class="rq-sm" data-rq="reparse" data-ri="' + ri + '">↻ Искать снова</button>') + '</div>';
  }
  function rqCardHtml(r, ri, only, cls, opts){
    var items = only ? [only] : (r.items || []);
    var isDoubt = !!(opts && opts.dock && items.some(function(it){ return rqCls(it) === 'db'; }));
    // Тестовый заказ (0.34.0): сервис — только пометка, рядом значок «тест».
    var srcName = r.test ? (r.service === 'dp' ? 'DonatePay' : 'DonationAlerts') : (DON_NAMES[r.prov] || r.prov);
    var h = '<div class="rq' + (r.state === 'done' ? ' done' : '') + (cls ? ' ' + cls : '') + (isDoubt ? ' doubt' : '') + '" data-kind="' + rqKind(r) + '"><div class="rq-h"><b>' + esc(r.name || 'Аноним') + '</b><span class="amt">' + esc(rqMoney(r)) + '</span><span>' + esc(srcName) + ' · ' + rqAgo(r.at || r.got) + '</span>' + (r.test ? '<span class="pill">тест</span>' : '') + (r.missed ? '<span class="miss">пришёл, пока Тапёр был закрыт</span>' : '') + '</div>' +
      (r.text ? '<div class="rq-m">«' + esc(r.text) + '»</div>' : '');
    items.forEach(function (it){ h += rqItemHtml(r, ri, it, (r.items || []).indexOf(it), opts); });
    h += rqYtNote(r, ri, only);
    if (!only && r.level === 'text') h += '<div class="rq-b"><button class="rq-sm" data-rq="textfind" data-ri="' + ri + '">Это заказ — искать</button></div>';
    return h + '</div>';
  }
  // Карточка выполненного заказа: трек затемнён, есть «вернуть в заказы»
  function rqDoneHtml(r, it){
    var t = it.track || {};
    return '<div class="rq-it added rq-done-it"><div class="rq-tr">' + (t.thumb ? '<img src="' + esc(t.thumb) + '" alt="" loading="lazy">' : '<span class="ph"></span>') +
      '<div class="tm"><div class="tt">' + esc(t.author ? t.author + ' — ' + t.title : t.title) + '</div><div class="ts">' + esc((r.name || 'Аноним') + ' · ' + rqMoney(r) + ' · ' + srcName(t)) + '</div></div></div>' +
      rqYtNote(r, r._ri, it) +   // и у уже добавленного заказа видно, что YouTube не спрашивали (run-7, W3)
      '<div class="rq-b"><button class="rq-sm" data-rq="return" data-id="' + it._id + '">↩ Вернуть в заказы</button></div></div>';
  }
  // Перерисовать вкладку заказов сразу, если она открыта (трек заиграл или доиграл)
  function rqSync(){ if (curTab === 'req') rqRender(); }
  function rqRender(){
    var list = $('rqList'); if (!list) return;
    // В ленте живут только сообщения за последние сутки
    var t0 = Date.now() - RQ_DAY;
    RQ.list = RQ.list.filter(function (r){ return (r.got || r.at || 0) > t0; });
    RQ.list.forEach(function (r, i){ r._ri = i; });
    var vis = RQ.list.filter(function (r){ return r.state !== 'dismissed'; });
    vis.sort(function (a, b){ return (b.got || 0) - (a.got || 0); });

    // Раскладываем песни из сообщений: активные наверх, отыгранные — в «выполненные»
    var act = [], done = [];
    vis.forEach(function (r){
      (r.items || []).forEach(function (it, ii){
        it._id = r._ri + ':' + ii;
        if (rqDoneIt(it)) done.push({ r: r, it: it });      // попал в треклист — сразу выполнен
        else if (rqActive(it)) act.push({ r: r, it: it });  // точно определился и ждёт решения
      });
    });
    act.sort(function (a, b){ return (a.r.got || 0) - (b.r.got || 0); }); // кто раньше заказал — тот выше
    var nPend = act.filter(function (x){ return !x.it.state; }).length; // ждут решения
    $('rqAddAll').hidden = !nPend; $('rqAddAll').textContent = '+ Все точные в очередь (' + nPend + ')';

    var h = '';
    if (RQ.testOpen) h += '<div class="rq-test"><input id="rqtText" style="flex:1 1 280px" placeholder="Текст доната, например: Привет! Кино — Кукушка" value="' + esc(RQ.testText || '') + '"><input id="rqtAmt" type="number" style="width:100px" value="' + esc(RQ.testAmt || 100) + '" aria-label="Сумма"><button class="pbtn qadd" id="rqtGo">Разобрать</button><span class="sd" style="color:var(--tx4);font-size:12px">Пробный заказ не уходит никуда — только сюда</span></div>';
    if (!vis.length) h += '<div class="rq-empty">Пока заказов нет.<br>Подключи сервис донатов в <a href="#" data-rq="settings" style="color:var(--ac2)">Настройках → Донаты</a> — и донаты появятся здесь общей лентой за сутки: что нашлось точно, что под сомнением, а что просто текст.<br>Проверить разбор можно кнопкой «Пробный заказ».</div>';

    // 1. Активные заказы — то, что точно определилось и ещё не в очереди
    if (act.length) {
      h += '<div class="rq-sec">Активные заказы · ' + act.length + '</div>';
      // здесь только те, что ещё ждут решения — все на зелёной подложке
      act.forEach(function (x){ h += rqCardHtml(x.r, x.r._ri, x.it, 'rq-act'); });
    }

    // 2. Общая лента сообщений за сутки
    if (vis.length) {
      var shown = RQ_FEED_SRC === 'all' ? vis : vis.filter(function (r){ return rqKind(r) === RQ_FEED_SRC; });
      h += '<details class="rq-feed"' + (RQ.feedOpen === false ? '' : ' open') + '><summary>Лента сообщений · ' + vis.length + '</summary>' +
        rqFilterHtml(vis, RQ_FEED_SRC, 'data-rqf') +
        (shown.length ? shown.map(function (r){ return rqCardHtml(r, r._ri); }).join('') : '<div class="rq-flt-empty">Таких сообщений за сутки нет</div>') + '</details>';
    }

    // 3. Выполненные заказы — уже в треклисте
    if (done.length) h += '<details class="rq-done"' + (RQ.doneOpen ? ' open' : '') + '><summary>Выполненные заказы · ' + done.length + '</summary>' + done.map(function (x){ return rqDoneHtml(x.r, x.it); }).join('') + '</details>';

    list.innerHTML = h;
    var fb = list.querySelector('.rq-feed'); if (fb) fb.ontoggle = function(){ RQ.feedOpen = fb.open; };
    var db = list.querySelector('.rq-done'); if (db) db.ontoggle = function(){ RQ.doneOpen = db.open; };
    var go = $('rqtGo'); if (go) { go.onclick = rqRunTest; $('rqtText').onkeydown = function(e){ if (e.key === 'Enter') rqRunTest(); }; }
    rqBadge();
  }
    if (typeof pushWidget === "function") pushWidget();
  function rqBadge(){
    var b = $('reqBadge'); if (!b) return;
    // Счётчик — сколько заказов ждут решения (ещё не встали в очередь)
    var n = 0;
    RQ.list.forEach(function (r){ if (r.state === 'dismissed') return; (r.items || []).forEach(function (it){ if (rqExact(it) && !it.state) n++; }); });
    b.hidden = !n; b.textContent = n ? n : '';
    var tab = $('tabReq'); if (tab) tab.classList.toggle('has-req', !!n); // вкладка плавно загорается, пока есть заказы
  }
  async function rqRunTest(){
    var t = $('rqtText').value.trim(); if (!t) return;
    RQ.testText = t; RQ.testAmt = Number($('rqtAmt').value) || 0;
    var b = $('rqtGo'); b.disabled = true; b.textContent = 'Ищу…';
    var r = await A.reqTest(t, RQ.testAmt).catch(function(){ return null; });
    if (r) rqIncoming(r);
    RQ.testText = ''; rqRender();
  }
  function rqIncoming(r){
    if (RQ.list.some(function (x){ return x.key === r.key; })) return;
    RQ.list.push(r);
    // Заказ чат-бота: бот уже всё проверил. Сразу в очередь, если бот так решил (botAuto), — не зависит от авторежима донатов
    if (r.bot) { if (r.botAuto) (r.items || []).forEach(function (it){ if (it.track && !it.state) rqAdd(r, it, null, false); }); else rqBotPlaced(r, null, null); rqRender(); return; }
    var auto = RQ.auto;
    if (auto) (r.items || []).forEach(function (it){ if (rqAutoOk(it)) rqAdd(r, it, null, false); });
    rqRender();
  }
  function rqOpen(){ rqRender(); rqSvcLine(); }
  function rqSvcLine(){
    var s = RQ.don, box = $('rqSvc'); if (!box) return;
    if (!s) { box.innerHTML = ''; return; }
    var on = DON_ON.filter(function (k){ return s[k] && s[k].connected; });
    box.innerHTML = on.length ? on.map(function (k){ var x = s[k]; return '<span title="' + esc(x.error || 'на связи') + '"><i class="' + (x.ok === false ? 'bad' : x.ok ? 'ok' : '') + '"></i>' + esc(x.name) + '</span>'; }).join('') : '<a href="#" data-rq="settings" style="color:var(--ac2)">Подключить сервис донатов</a>';
  }
  $('viewReq').addEventListener('change', function(e){
    var t = e.target;
    if (t && t.name && t.name.indexOf('rqa') === 0) RQ.pick[t.name.slice(3)] = +t.value || 0;
  });
  $('viewReq').addEventListener('input', function(e){
    var t = e.target;
    if (t && t.id === 'rqtText') RQ.testText = t.value;
    else if (t && t.id === 'rqtAmt') RQ.testAmt = Number(t.value) || 0;
  });
  $('viewReq').addEventListener('click', function(e){
    var fb = e.target.closest('[data-rqf]');
    if (fb) {
      RQ_FEED_SRC = fb.getAttribute('data-rqf');
      try { localStorage.setItem('tapRqFeedSrc', RQ_FEED_SRC); } catch (er) {}
      rqRender();
      return;
    }
    var b = e.target.closest('[data-rq]'); if (!b) return;
    e.preventDefault();
    var a = b.dataset.rq;
    if (a === 'settings') { setTab('settings', 'sStream'); setTimeout(function(){ if (typeof showSettingsPane === 'function') showSettingsPane('sStream'); else $('sStream').scrollIntoView({ block: 'start' }); }, 50); return; }
    var r, it;
    if (b.dataset.id) { var p = b.dataset.id.split(':'); r = RQ.list[+p[0]]; it = r && r.items[+p[1]]; if (!it) return; }
    if (b.dataset.ri != null) r = RQ.list[+b.dataset.ri];
    if (a === 'add' || a === 'now') {
      var pick = null;
      if (RQ.altOpen[b.dataset.id]) {
        var alts = [it.track].concat(it.alts || []).filter(Boolean);
        pick = alts[+(RQ.pick[b.dataset.id] || 0)];
      }
      delete RQ.altOpen[b.dataset.id]; delete RQ.pick[b.dataset.id];
      rqAdd(r, it, pick, a === 'now');
    } else if (a === 'alts') { RQ.altOpen[b.dataset.id] = !RQ.altOpen[b.dataset.id]; rqRender(); }
    else if (a === 'skip') { rqBotDrop(r, 'dropped', 'removed'); it.state = 'skip'; if (!rqPending(r).length) r.state = 'done'; rqSave(r); rqRender(); }
    else if (a === 'link') { A.openLink(it.link); }
    else if (a === 'find' || a === 'textfind') {
      var q = (it && (it.query || (it.track && ((it.track.author || '') + ' ' + it.track.title)))) || (r && r.text) || '';
      setTab('search'); search.value = q.trim(); doSearch({ nav: true });
    } else if (a === 'reparse') {
      if (!r || !A.reqReparse) return;
      b.disabled = true; b.textContent = 'Ищу…';
      A.reqReparse(r.key).then(function (nr){
        if (!nr) { toast('Заказ не найден'); return; }
        for (var k = 0; k < RQ.list.length; k++) if (RQ.list[k].key === nr.key) { RQ.list[k] = nr; break; }
        rqRender();
        toast(nr.ytDown ? 'YouTube всё ещё не отвечает — искал без него' : (nr.level === 'exact' ? 'Нашёл' : 'Поискал заново'));
      }).catch(function(){ b.disabled = false; b.textContent = '↻ Искать снова'; });
    } else if (a === 'return') { it.state = undefined; if (r.state === 'done') r.state = undefined; rqSave(r); rqRender(); }
  });
  $('rqAddAll').onclick = function(){
    var list = [];
    RQ.list.forEach(function (r){ if (r.state === 'dismissed') return; (r.items || []).forEach(function (it){ if (!it.state && rqCls(it) === 'ex' && it.paid !== false) list.push([r, it]); }); });
    list.sort(function (x, y){ return (x[0].got || 0) - (y[0].got || 0); }).forEach(function (p){ rqAdd(p[0], p[1], null, false); });
    toast('В очередь: ' + list.length);
  };
  $('rqTest').onclick = function(){ RQ.testOpen = !RQ.testOpen; rqRender(); if (RQ.testOpen) setTimeout(function(){ var i = $('rqtText'); if (i) i.focus(); }, 30); };
  // Очистить всю историю заказов: сообщения, активные и выполненные (очередь не трогаем)
  $('rqClear').onclick = async function(){
    if (!RQ.list.length) { toast('История заказов уже пуста'); return; }
    var ok = await askDlg({ title: 'Очистить историю заказов?', text: 'Удалятся все сообщения, активные заказы и выполненные. Музыка в очереди и лента прослушивания останутся.', ok: 'Очистить' });
    if (!ok) return;
    var keep = queue.filter(function (v){ return v && v.req && v.req.key; }).map(function (v){ return v.req.key; });
    RQ.list = [];
    if (A.reqClear) A.reqClear(keep);
    rqRender();
    toast('История заказов очищена');
  };
  if (A.reqList) A.reqList().then(function (l){ RQ.list = l || []; rqRender(); });
  if (A.onReqNew) A.onReqNew(rqIncoming);
  if (A.getSetting) A.getSetting('reqAuto').then(function (v){ RQ.auto = !!v; });
  document.addEventListener('click', function(e){ var t = e.target.closest('[data-set-tg="reqAuto"]'); if (t) setTimeout(function(){ RQ.auto = t.classList.contains('on'); }, 0); });
  setInterval(function(){ if (curTab === 'req') rqRender(); }, 60000);

  // ===== Настройки «Донаты» (группа «Стримерам»): сервисы донатов, правила, сайт-визитка =====
  var DON = { links: {}, keyBusy: {}, daWait: false };
  var LINK_PH = { da: 'https://www.donationalerts.com/r/твой_ник', dp: 'https://new.donatepay.ru/@твой_ник', boosty: 'https://boosty.to/твой_ник', other: 'любая другая ссылка на донат' };
  var KEY_HELP = { dp: ['https://donatepay.ru/page/api', 'На сайте DonatePay: «Настройки» → «API» → скопируй ключ'] };
  function donLinkRow(k, label){ return '<div class="rowi"><span class="lab">' + label + '</span><input class="field" data-dl="' + k + '" placeholder="' + esc(LINK_PH[k]) + '" value="' + esc(DON.links[k] || '') + '" spellcheck="false"></div>'; }
  // Последний заказ по сервису: видно не только «связь есть», но и что сообщения доходят
  function lastRow(k){
    var last = null;
    RQ.list.forEach(function (r){ if (r.prov === k && (!last || (r.got || r.at || 0) > (last.got || last.at || 0))) last = r; });
    if (!last) return '';
    return '<div class="rowi"><span class="lab">Последний заказ</span><span class="st-last">' + esc(rqMoney(last)) +
      (last.text ? ' · «' + esc(last.text) + '»' : '') + ' · ' + rqAgo(last.at || last.got) + '</span></div>';
  }
  function renderStDon(){
    var box = $('stDon'); if (!box) return;
    var s = RQ.don || {}; var h = '';
    DON_ON.forEach(function (k){
      var x = s[k] || { name: DON_NAMES[k] };
      var state = x.connected ? (x.ok === false ? '<span class="st-bad">⚠ ' + esc(x.error || 'нет связи') + '</span>' : '<span class="st-ok">✓ Подключён' + (x.account && x.account.name ? ' как ' + esc(x.account.name) : '') + (x.ok ? ' · на связи' : '') + '</span>') : 'Не подключён';
      var btn = '';
      if (k === 'da') {
        if (x.connected) btn = '<button class="btn ghost" data-don="off" data-k="da">Отключить</button>';
        else if (s.da && s.da.configured === false) state = 'Не подключён · вход в DonationAlerts в этой сборке не настроен';
        else btn = DON.daWait ? '<button class="btn ghost" data-don="dacancel">Отмена (жду входа в браузере…)</button>' : '<button class="btn" data-don="da">Подключить</button>';
      } else btn = x.connected ? '<button class="btn ghost" data-don="off" data-k="' + k + '">Отключить</button>' : '';
      h += '<div class="srow" style="align-items:flex-start"><div class="sl"><div class="st">' + esc(x.name || DON_NAMES[k]) + '</div><div class="sd">' + state + '</div><div class="st-dn">' + donLinkRow(k, 'Ссылка на донат') +
        (k !== 'da' && !x.connected ? '<div class="rowi"><span class="lab">API-ключ</span><input class="field" type="password" data-dk="' + k + '" placeholder="' + esc(KEY_HELP[k][1]) + '" spellcheck="false" autocomplete="off"><button class="btn" data-don="key" data-k="' + k + '">' + (DON.keyBusy[k] ? 'Проверяю…' : 'Подключить') + '</button></div><div class="sd"><a href="#" data-don="help" data-k="' + k + '" style="color:var(--ac2)">Где взять?</a> <span class="enc-note">Ключ хранится зашифрованно на этом компьютере.</span> Тапёр только читает донаты — вывести деньги им нельзя</div>' : '') +
        (x.connected ? lastRow(k) : '') + '</div></div>' + (btn ? '<div style="display:flex;gap:8px">' + btn + '</div>' : '') + '</div>';
    });
    box.innerHTML = h;
  }
  $('stDon').addEventListener('input', function(e){ var i = e.target.closest('[data-dl]'); if (!i) return; DON.links[i.dataset.dl] = i.value.trim(); clearTimeout(DON.lt); DON.lt = setTimeout(function(){ A.setSetting('donLinks', DON.links); }, 400); });
  $('stDon').addEventListener('click', async function(e){
    var b = e.target.closest('[data-don]'); if (!b) return; e.preventDefault();
    var a = b.dataset.don, k = b.dataset.k;
    if (a === 'help') { A.openLink(KEY_HELP[k][0]); return; }
    if (a === 'off') { await A.donDisconnect(k); RQ.don = await A.donStatus(); renderStDon(); rqSvcLine(); return; }
    if (a === 'dacancel') { A.donDaCancel(); return; }
    if (a === 'da') {
      DON.daWait = true; renderStDon();
      var r = await A.donDaLogin(); DON.daWait = false;
      if (r && r.error && r.error !== 'cancelled') toast(r.error === 'not-configured' ? 'Вход в DonationAlerts в этой сборке не настроен' : 'DonationAlerts: ' + r.error);
      if (r && r.ok) toast('DonationAlerts подключён');
      RQ.don = await A.donStatus(); renderStDon(); rqSvcLine(); return;
    }
    if (a === 'key') {
      var inp = document.querySelector('[data-dk="' + k + '"]'); var v = inp && inp.value.trim(); if (!v) { inp && inp.focus(); return; }
      DON.keyBusy[k] = true; renderStDon();
      var r2 = await A.donSetKey(k, v); DON.keyBusy[k] = false;
      if (r2 && r2.error) toast(DON_NAMES[k] + ': ' + r2.error); else toast(DON_NAMES[k] + ' подключён');
      RQ.don = await A.donStatus(); renderStDon(); rqSvcLine();
    }
  });
  if (A.onDonStatus) A.onDonStatus(function (s){ RQ.don = s; rqSvcLine(); if (!$('viewSettings').hidden && !document.activeElement.closest('#stDon')) renderStDon(); });
  // Правила заказов
  var REQ_RULES = {};
  function saveRules(){ A.setSetting('reqRules', REQ_RULES); }
  function stopToText(a){ return (a || []).join(', '); }
  function textToStop(t){ return String(t || '').split(/[,\n;]+/).map(function (x){ return x.trim(); }).filter(Boolean); }
  async function initStream(){
    if (!A.getSetting) return;
    DON.links = (await A.getSetting('donLinks')) || {};
    REQ_RULES = (await A.getSetting('reqRules')) || {};
    var defStop = (window.TapReq && TapReq.DEFAULT_STOP) || [];
    $('stPrice').value = (await A.getSetting('reqPrice')) || 100;
    $('stCur').value = (await A.getSetting('reqCurrency')) || 'RUB';
    $('stMax').value = REQ_RULES.maxSec == null ? 7 : Math.round(REQ_RULES.maxSec / 60);
    $('stStop').value = stopToText(Array.isArray(REQ_RULES.stopWords) ? REQ_RULES.stopWords : defStop);
    setTg($('stExplicit'), REQ_RULES.explicitOk !== false);
    setTg($('stRepeat'), REQ_RULES.repeatOk !== false);
    setTg($('stVersion'), REQ_RULES.versionOk !== false);
    if ($('stLookup')) setTg($('stLookup'), REQ_RULES.lookupOk !== false);
    renderSrcPick();
    if (A.donStatus) RQ.don = await A.donStatus();
    renderStDon(); rqSvcLine(); await siteInit();
  }
  // «Где искать заказы»: площадка ищется, если включена в «Площадках» и не снята здесь. По умолчанию — все.
  var SRC_PICK = [['ym', 'Яндекс', 'ymEnabled'], ['lc', 'Свои файлы', 'preferLocal'], ['sc', 'SoundCloud', 'scEnabled'], ['au', 'Audius', 'auEnabled'], ['yt', 'YouTube', 'ytEnabled']];
  async function renderSrcPick(){
    var box = $('stSrc'); if (!box || !A.getSetting) return;
    var src = REQ_RULES.src || {}, h = '', live = 0;
    for (var i = 0; i < SRC_PICK.length; i++) {
      var k = SRC_PICK[i][0], glob = (await A.getSetting(SRC_PICK[i][2])) !== false, on = glob && src[k] !== false;
      if (on) live++;
      h += '<button class="srcp' + (on ? ' on' : '') + '" data-src="' + k + '" aria-pressed="' + on + '"' + (glob ? '' : ' disabled title="Выключено в настройках площадок"') + '>' + (on ? '✓ ' : '') + esc(SRC_PICK[i][1]) + '</button>';
    }
    box.innerHTML = h;
    var n = $('stSrcNote');
    if (n) { n.classList.toggle('warn', !live); n.textContent = live ? 'Ссылки из сообщения открываются всегда. Порядок поиска не меняется: Яндекс → свои файлы → SoundCloud и Audius → YouTube' : 'Заказы искать негде — включи хотя бы одну площадку. Открываться будут только ссылки'; }
  }
  if ($('stSrc')) $('stSrc').onclick = function(e){
    var b = e.target.closest('.srcp'); if (!b || b.disabled) return;
    REQ_RULES.src = Object.assign({}, REQ_RULES.src || {}); REQ_RULES.src[b.dataset.src] = !b.classList.contains('on');
    saveRules(); renderSrcPick();
  };
  // переключили площадку в «Входах и площадках» — строка заказов пересобирается
  document.addEventListener('click', function(e){ var t = e.target.closest('[data-set-tg]'); if (t && /^(ymEnabled|preferLocal|scEnabled|auEnabled|ytEnabled)$/.test(t.dataset.setTg)) setTimeout(renderSrcPick, 50); });
  $('stPrice').onchange = function(){ A.setSetting('reqPrice', Math.max(0, Number(this.value) || 0)); siteDirty(); };
  $('stCur').onchange = function(){ A.setSetting('reqCurrency', this.value); siteDirty(); };
  $('stMax').onchange = function(){ REQ_RULES.maxSec = Math.max(0, Number(this.value) || 0) * 60; saveRules(); };
  $('stStop').onchange = function(){ REQ_RULES.stopWords = textToStop(this.value); saveRules(); };
  $('stStopReset').onclick = function(){ delete REQ_RULES.stopWords; saveRules(); $('stStop').value = stopToText((window.TapReq && TapReq.DEFAULT_STOP) || []); };
  $('stExplicit').onclick = function(){ REQ_RULES.explicitOk = !this.classList.contains('on'); setTg(this, REQ_RULES.explicitOk); saveRules(); };
  $('stRepeat').onclick = function(){ REQ_RULES.repeatOk = !this.classList.contains('on'); setTg(this, REQ_RULES.repeatOk); saveRules(); };
  $('stVersion').onclick = function(){ REQ_RULES.versionOk = !this.classList.contains('on'); setTg(this, REQ_RULES.versionOk); saveRules(); };
  if ($('stLookup')) $('stLookup').onclick = function(){ REQ_RULES.lookupOk = !this.classList.contains('on'); setTg(this, REQ_RULES.lookupOk); saveRules(); };

  // Сайт-визитка
  var SITE = { d: {}, st: null, busy: false, dev: null, tokOpen: false };
  var SITE_DEF_INSTR = 'Нажми любую кнопку доната выше.\n\nЕсли хочешь заказать песню, в сообщении напиши песню: `Исполнитель — Название` или ссылку (YouTube, Яндекс Музыка, SoundCloud).\n\nНесколько песен — через запятую или с новой строки. Цена — за каждую.\n\nПривет и пожелания пиши там же: песню программа найдёт сама.';
  var SITE_FIELDS = [['nick', 'Ник'], ['about', 'О себе'], ['avatar', 'Аватарка (ссылка)'], ['ch_twitch', 'Twitch'], ['ch_youtube', 'YouTube'], ['ch_vk', 'VK Видео'], ['ch_kick', 'Kick'], ['ch_telegram', 'Telegram']];
  function siteDirty(){ SITE.dirty = true; renderStSite(); }
  function siteColors(){ var cs = getComputedStyle(document.documentElement); var g = function (n){ return toHex(cs.getPropertyValue(n).trim()); }; return { bg: g('--bg1'), card: g('--bg3'), tx: g('--tx'), tx2: g('--tx3'), ac: g('--ac'), pri: g('--pri') }; }
  function toHex(c){ if (/^#[0-9a-f]{6}$/i.test(c)) return c; var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); if (m) return '#' + [m[1], m[2], m[3]].map(function (x){ return ('0' + (+x).toString(16)).slice(-2); }).join(''); var d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); var r = getComputedStyle(d).color; d.remove(); m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(r); return m ? '#' + [m[1], m[2], m[3]].map(function (x){ return ('0' + (+x).toString(16)).slice(-2); }).join('') : ''; }
  function siteParams(){
    var d = SITE.d, ch = {};
    ['twitch', 'youtube', 'vk', 'kick', 'telegram'].forEach(function (k){ ch[k] = d['ch_' + k] || ''; });
    return { nick: d.nick || '', about: d.about || '', avatar: d.avatar || '', channels: ch, donate: DON.links, price: Number($('stPrice').value) || 0, currency: $('stCur').value, showPrice: d.showPrice !== false, instr: d.instr || SITE_DEF_INSTR, qrCaption: d.qrCaption || 'Заказать песню', colors: siteColors() };
  }
  function renderStSite(){
    var box = $('stSite'); if (!box) return;
    var st = SITE.st || {}, d = SITE.d, h = '';
    var showPrice = d.showPrice !== false;
    h += '<div class="srow"><div class="sl"><div class="st">Показывать цену за трек на сайте</div><div class="sd">Выключи — на странице не будет надписи «… за трек». На подсчёт оплаченных треков по донату это не влияет</div></div><button class="toggle' + (showPrice ? ' on' : '') + '" data-site-tg="showPrice" aria-pressed="' + (showPrice ? 'true' : 'false') + '" aria-label="Показывать цену за трек на сайте"><span></span></button></div>';
    h += '<div class="srow" style="align-items:flex-start"><div class="sl"><div class="st">Что на странице</div><div class="sd">Кнопки доната берутся из ссылок выше. Цвета — из твоей темы Тапёра</div><div class="st-grid" style="margin-top:10px">' +
      SITE_FIELDS.map(function (f){ return '<span class="lab">' + f[1] + '</span><input class="field" data-sf="' + f[0] + '" value="' + esc(d[f[0]] || '') + '" spellcheck="false">'; }).join('') +
      '<span class="lab">Как заказать</span><textarea class="field st-ta" data-sf="instr" rows="5">' + esc(d.instr || SITE_DEF_INSTR) + '</textarea>' +
      '<span class="lab">Подпись под QR</span><input class="field" data-sf="qrCaption" value="' + esc(d.qrCaption || 'Заказать песню') + '"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" data-site="preview">Посмотреть</button><button class="btn ghost" data-site="save">Сохранить как файл…</button></div></div></div>';
    // GitHub
    var gh = '';
    if (st.connected) gh = '<span class="st-ok">✓ GitHub: ' + esc((st.account && st.account.login) || 'подключён') + '</span>';
    else if (SITE.dev) gh = 'Открылась страница GitHub — введи там код <b style="font:700 18px \'JetBrains Mono\',monospace;color:var(--tx);letter-spacing:.1em">' + esc(SITE.dev.user_code) + '</b> и нажми «Authorize». Тапёр ждёт…';
    else gh = 'Сайт лежит в твоём аккаунте GitHub (бесплатно, адрес вида <code>ник.github.io/tapyor-page</code>). Нет аккаунта — зарегистрируйся на github.com за минуту.';
    var btns = '';
    if (!st.connected) {
      if (SITE.dev) btns = '<button class="btn ghost" data-site="devcopy">Скопировать код</button><button class="btn ghost" data-site="devcancel">Отмена</button>';
      else if (st.configured) btns = '<button class="btn" data-site="dev">Войти в GitHub</button>';
      else btns = '<button class="btn" data-site="tok">' + (SITE.tokOpen ? 'Скрыть' : 'Подключить GitHub') + '</button>';
    } else btns = '<button class="btn" data-site="publish"' + (SITE.busy ? ' disabled' : '') + '>' + (SITE.busy ? 'Выкладываю…' : (st.url ? 'Обновить сайт' : 'Выложить сайт')) + '</button><button class="btn ghost" data-site="ghoff">Отключить GitHub</button>';
    h += '<div class="srow" style="align-items:flex-start"><div class="sl"><div class="st">Выложить в интернет</div><div class="sd">' + gh + '</div>' +
      (!st.connected && !st.configured && SITE.tokOpen ? '<div class="sd" style="margin-top:8px">1. Нажми «Открыть GitHub» — откроется страница нового ключа, всё уже заполнено.<br>2. Внизу нажми «Generate token» и скопируй ключ (начинается на ghp_).<br>3. Вставь его сюда. <span class="enc-note">Ключ хранится зашифрованно</span> и даёт Тапёру доступ только к публичным репозиториям.</div><div class="st-dn" style="margin-top:8px"><div class="rowi"><button class="btn ghost" data-site="tokopen">Открыть GitHub</button><input class="field" type="password" id="siteTok" placeholder="ghp_…" spellcheck="false" autocomplete="off"><button class="btn" data-site="tokset">Подключить</button></div></div>' : '') +
      (st.url ? '<div class="sd" style="margin-top:10px">Адрес сайта — для описания канала и чат-бота:</div><div class="path">' + esc(st.url) + '</div><div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn ghost" data-site="copy">Скопировать</button><button class="btn ghost" data-site="open">Открыть</button></div>' +
        '<div class="sd" style="margin-top:10px">QR-код для OBS: источник «Браузер», ширина 260, высота 300, адрес:</div><div class="path">' + esc(st.url + 'qr.html') + '</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn ghost" data-site="copyqr">Скопировать</button><button class="btn ghost" data-site="openqr">Открыть</button></div>' +
        (SITE.dirty ? '<div class="sd" style="margin-top:8px;color:#FFD43B">Есть изменения — нажми «Обновить сайт». Страница обновится через 1–2 минуты</div>' : '') : '') +
      '</div><div style="display:flex;gap:8px;flex-wrap:wrap">' + btns + '</div></div>';
    box.innerHTML = h;
  }
  async function siteInit(){ SITE.d = (await A.getSetting('site')) || {}; SITE.st = A.siteStatus ? await A.siteStatus() : {}; renderStSite(); }
  $('stSite').addEventListener('input', function(e){ var i = e.target.closest('[data-sf]'); if (!i) return; SITE.d[i.dataset.sf] = i.value; SITE.dirty = true; clearTimeout(SITE.t); SITE.t = setTimeout(function(){ A.setSetting('site', SITE.d); }, 400); });
  $('stSite').addEventListener('click', async function(e){
    var tg = e.target.closest('[data-site-tg=showPrice]');
    if (tg) { e.preventDefault(); SITE.d.showPrice = SITE.d.showPrice === false; if (A.setSetting) A.setSetting('site', SITE.d); siteDirty(); return; }
    var b = e.target.closest('[data-site]'); if (!b) return; e.preventDefault();
    var a = b.dataset.site, st = SITE.st || {};
    if (a === 'preview') { var html = await A.sitePreview(siteParams()); var ov = document.createElement('div'); ov.className = 'site-ov'; ov.innerHTML = '<div class="box"><div class="bar">Так увидят зрители<button class="btn ghost" data-x>Закрыть</button></div><iframe sandbox="" title="Предпросмотр сайта"></iframe></div>'; ov.querySelector('iframe').srcdoc = html; ov.onclick = function(ev){ if (ev.target === ov || ev.target.closest('[data-x]')) ov.remove(); }; document.body.appendChild(ov); return; }
    if (a === 'save') { await A.siteSave(siteParams()); return; }
    if (a === 'tok') { SITE.tokOpen = !SITE.tokOpen; renderStSite(); return; }
    if (a === 'tokopen') { A.openLink('https://github.com/settings/tokens/new?scopes=public_repo&description=Tapyor%20page'); return; }
    if (a === 'tokset') { var v = $('siteTok').value.trim(); if (!v) return; var r = await A.siteGhToken(v); if (r && r.error) toast('GitHub: ' + r.error); SITE.st = await A.siteStatus(); SITE.tokOpen = false; renderStSite(); return; }
    if (a === 'dev') { var d = await A.siteGhDeviceStart(); if (!d || d.error) { toast('GitHub: ' + ((d && d.error) || 'не получилось')); return; } SITE.dev = d; copyText(d.user_code); renderStSite(); var w = await A.siteGhDeviceWait(); SITE.dev = null; if (w && w.error && w.error !== 'cancelled') toast('GitHub: ' + w.error); SITE.st = await A.siteStatus(); renderStSite(); return; }
    if (a === 'devcopy') { copyText(SITE.dev && SITE.dev.user_code); toast('Код скопирован'); return; }
    if (a === 'devcancel') { A.siteGhDeviceCancel(); return; }
    if (a === 'ghoff') { await A.siteGhToken(''); SITE.st = await A.siteStatus(); renderStSite(); return; }
    if (a === 'publish') { SITE.busy = true; renderStSite(); var p = await A.sitePublish(siteParams()); SITE.busy = false; if (p && p.error) toast('Сайт: ' + p.error); else { SITE.dirty = false; toast('Сайт выложен — откроется через 1–2 минуты'); } SITE.st = await A.siteStatus(); renderStSite(); return; }
    if (a === 'copy') { copyText(st.url); toast('Ссылка скопирована'); return; }
    if (a === 'copyqr') { copyText(st.url + 'qr.html'); toast('Адрес скопирован'); return; }
    if (a === 'open') { A.openLink(st.url); return; }
    if (a === 'openqr') { A.openLink(st.url + 'qr.html'); return; }
  });
  initStream();

  // Фразу «хранится зашифрованно» показываем, только если система действительно шифрует.
  // Без ключницы ОС ключ пишется в base64, а это кодировка, не шифрование (аудит 01.11, M6).
  var encKnown = null;
  function fixEncNotes(){
    function apply(ok){
      document.querySelectorAll('.enc-note').forEach(function (el){
        if (ok || el.dataset.encFixed) return;   // уже исправлена — не трогаем, иначе наблюдатель зациклится (ревью 01.11)
        el.dataset.encFixed = '1';
        el.textContent = 'Внимание: шифрование в системе недоступно, ключ хранится в открытом виде на этом компьютере.';
        el.style.color = 'var(--warn, var(--ac2))';
      });
    }
    if (encKnown !== null) { apply(encKnown); return; }
    if (!A.storageEncrypted) return;
    A.storageEncrypted().then(function (ok){
      encKnown = !!ok; apply(encKnown);
      // шифрование есть (обычный случай) — фраза верна, следить за страницей незачем
      if (encKnown && encObs) { encObs.disconnect(); encObs = null; }
    }).catch(function(){});
  }
  var encObs = new MutationObserver(function (){ if (document.querySelector('.enc-note')) fixEncNotes(); });
  encObs.observe(document.body, { childList: true, subtree: true });
  fixEncNotes();


  // Команды чат-бота: !skip (мод) и !cancel (автор заказа).
  if (A.onBotSkip) A.onBotSkip(function(){
    if (typeof next === 'function') next();
  });
  // «Убрать заказ» от главного процесса: одинаково для пака (bot-remove) и Streamer.bot (sbot-remove).
  function rqRemoveByKey(key){
    var removedCurrent = false;
    for (var i = queue.length - 1; i >= 0; i--) {
      if (!queue[i] || !queue[i].req || queue[i].req.key !== key) continue;
      if (i === current) removedCurrent = true;
      else if (i < current) current--;
      queue.splice(i, 1);
    }
    for (var j = 0; j < RQ.list.length; j++) {
      var r = RQ.list[j];
      if (!r || r.key !== key) continue;
      (r.items || []).forEach(function(it){ if (!it.state || it.state === 'added') it.state = 'skip'; });
      if (!rqPending(r).length) r.state = 'done';
      rqSave(r);
    }
    renderQueue(); saveToday(); rqRender();
    if (removedCurrent && typeof next === 'function') next();
  }
  if (A.onBotRemove) A.onBotRemove(rqRemoveByKey);
  if (A.onSbotRemove) A.onSbotRemove(rqRemoveByKey);
