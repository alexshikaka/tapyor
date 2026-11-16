  var A = window.app || {};
  // Энергосбережение: окно не в фокусе или скрыто — body.calm, украшения на паузе (см. app.css «Энергосбережение»)
  (function(){
    function upd(){ document.body && document.body.classList.toggle('calm', document.hidden || !document.hasFocus()); }
    window.addEventListener('focus', upd); window.addEventListener('blur', upd);
    document.addEventListener('visibilitychange', upd);
    if (document.body) upd(); else document.addEventListener('DOMContentLoaded', upd);
  })();

// Ошибку страницы не глотаем: пишем в консоль и заново отправляем виджету настоящее состояние
window.onerror = function(msg, src, line){
  try { console.error('Тапёр: ' + msg + ' (' + (src || '') + ':' + line + ')'); } catch (e) {}
  setTimeout(function(){ try { if (typeof pushWidget === 'function') pushWidget(true); } catch (e) {} }, 400);
  return false;
};
  function $(id){ return document.getElementById(id); }
  function setHint(t){ var h = $('hint'); if (h) h.textContent = t; } // подсказки поиска необязательны
  function noop(){}

  if (A.getVersion) A.getVersion().then(function (v) { $('ver').textContent = 'версия ' + v; $('setVer').textContent = 'Тапёр ' + v; });

  // ===== Обновления — в шапке и в настройках =====
  var updArea = $('updArea'), updCheckBtn = $('updCheck'), updOkTimer = null;
  function fmtMB(b){ return b ? (b / 1048576).toFixed(1) + ' МБ' : ''; }
  function renderUpdate(st){
    clearTimeout(updOkTimer);
    st = st || { state: 'idle' };
    var busy = st.state === 'checking' || st.state === 'downloading' || st.state === 'installing';
    updCheckBtn.disabled = busy; $('setUpdBtn').disabled = busy;
    var setTxt = 'Проверяются при запуске';
    if (st.state === 'checking') {
      updArea.innerHTML = st.manual ? '<span>Проверяю обновления…</span>' : '';
      setTxt = 'Проверяю…';
    } else if (st.state === 'available') {
      updArea.innerHTML = '<button class="upd-go" id="updGo">⬆ Обновить до ' + esc(st.version || 'новой версии') + '</button>';
      $('updGo').onclick = function(){ A.updateDownload(); };
      setTxt = 'Есть новая версия ' + (st.version || '');
    } else if (st.state === 'downloading') {
      var pc = Math.max(0, Math.min(100, st.percent || 0));
      updArea.innerHTML = '<span>Загрузка обновления ' + pc + '%</span><span class="upd-bar"><i style="width:' + pc + '%"></i></span>' +
        (st.total ? '<span style="color:var(--tx4)">' + fmtMB(st.transferred) + ' / ' + fmtMB(st.total) + '</span>' : '');
      setTxt = 'Скачиваю обновление… ' + pc + '%';
    } else if (st.state === 'ready') {
      // R3: посреди стрима программа сама не перезапускается — обновление поставится при выходе.
      var readyTxt = st.onQuit
        ? 'Обновление ' + esc(st.version || '') + ' готово — поставится, когда закроете Тапёр'
        : 'Обновление ' + esc(st.version || '') + ' скачано — поставлю, когда музыка остановится';
      updArea.innerHTML = '<span>' + readyTxt + '</span><button class="upd-go" id="updGo">' +
        (st.onQuit ? 'Перезапустить сейчас' : 'Обновить сейчас') + '</button>';
      $('updGo').onclick = function(){ A.updateDownload(); };
      setTxt = st.onQuit
        ? 'Обновление ' + (st.version || '') + ' готово — поставится, когда закроете Тапёр'
        : 'Версия ' + (st.version || '') + ' скачана — установится, когда музыка остановится';
    } else if (st.state === 'installing') {
      updArea.innerHTML = '<span>Устанавливаю ' + esc(st.version || '') + '… программа перезапустится</span>';
      setTxt = 'Устанавливаю…';
    } else if (st.state === 'latest') {
      // empty — в канале ещё нет ни одного релиза (стабильный до открытия): для человека это то же «обновлений нет»
      var okTxt = st.empty ? '✓ Обновлений нет' : '✓ У тебя последняя версия';
      if (st.manual) { updArea.innerHTML = '<span class="upd-ok">' + okTxt + '</span>'; updOkTimer = setTimeout(function(){ updArea.innerHTML = ''; }, 5000); }
      else updArea.innerHTML = '';
      setTxt = st.empty ? '✓ Обновлений нет — в стабильном канале пока нет новых версий' : okTxt;
    } else if (st.state === 'error') {
      updArea.innerHTML = st.manual ? '<span class="upd-err" title="' + esc(st.message || '') + '">⚠ Не удалось проверить — наведи для подробностей</span>' : '';
      setTxt = '⚠ Не удалось проверить: ' + (st.message || '');
    } else updArea.innerHTML = '';
    $('setUpdText').textContent = setTxt;
    if (st.channel) showChannel(st.channel);
    renderChanOffer(st.other);
  }

  // ===== Что лежит в целевом канале (А12) =====
  // autoUpdater не ставит сборку того же номера, поэтому при совпадении номеров показываем
  // кнопку «Поставить стабильную X.Y.Z» / «Поставить dev X.Y.Z» — со своей загрузкой и сверкой sha512.
  var chOfferRow = $('setChanOffer'), chOfferBtn = $('setChanOfferBtn');
  var OFFER_BUILD = { stable: 'стабильную', dev: 'dev' };
  function renderChanOffer(off){
    if (!chOfferRow) return;
    if (!off || !off.verdict) { chOfferRow.hidden = true; return; }
    var title = $('setChanOfferTitle'), text = $('setChanOfferText');
    var offBuild = off.build || (off.channel === 'debug' ? 'dev' : 'stable');
    var what = OFFER_BUILD[offBuild] || 'другую';
    var ver = off.version || '';
    var state = off.state || '';
    chOfferRow.hidden = false;
    chOfferBtn.hidden = true;
    if (state === 'downloading') {
      title.textContent = 'Скачиваю сборку ' + ver + '…';
      text.textContent = 'Файл сверяется по sha512 из latest.yml. Пока качается, музыку можно не останавливать.';
      return;
    }
    if (state === 'waiting') {
      // R3: не перезапускаемся в паузе — ждём кнопки или обычного выхода
      title.textContent = 'Сборка ' + ver + ' скачана';
      text.textContent = 'Поставится, когда закроете Тапёр. Посреди стрима программу не перезапускаю.';
      chOfferBtn.hidden = false;
      chOfferBtn.textContent = 'Перезапустить сейчас';
      return;
    }
    if (state === 'installing') {
      title.textContent = 'Устанавливаю сборку ' + ver + '…';
      text.textContent = 'Программа закроется и откроется снова уже на другом канале.';
      return;
    }
    if (state === 'error') {
      title.textContent = 'Не удалось поставить сборку ' + ver;
      text.textContent = off.error || 'Файл не скачался или не совпал по sha512 — ничего не установлено.';
      return;
    }
    if (off.verdict === 'same') {
      if (off.sameBuild) {
        title.textContent = 'В этом канале та же сборка ' + ver;
        text.textContent = 'Ставить нечего: номер и сборка совпадают с установленной.';
        return;
      }
      title.textContent = 'В канале та же версия ' + ver + ', но сборка другая';
      text.textContent = 'Обычное обновление такую не поставит. Тапёр скачает установщик, сверит его по sha512 и тихо поставит, когда закроете программу (или по кнопке).';
      chOfferBtn.hidden = false;
      chOfferBtn.textContent = 'Поставить ' + what + ' ' + ver;
      return;
    }
    if (off.verdict === 'older') {
      title.textContent = 'В целевом канале версия ' + ver + ' — старше установленной';
      text.textContent = 'Откатывать не будем: ' + (offBuild === 'stable' ? 'стабильная' : 'отладочная') +
        ' догонит сама — перейдёшь, когда выйдет ' + ver + ' или новее.';
      return;
    }
    if (off.verdict === 'newer') {
      title.textContent = 'В целевом канале есть ' + ver;
      text.textContent = 'Она новее установленной — поставится обычным обновлением, кнопка не нужна.';
      return;
    }
    if (off.verdict === 'empty') {
      title.textContent = offBuild === 'stable' ? 'В стабильном канале пока нет версий' : 'В отладочном канале пока нет версий';
      text.textContent = 'Канал пуст: как только владелец выложит релиз, Тапёр его увидит сам.';
      return;
    }
    title.textContent = 'Не удалось узнать, что в целевом канале';
    text.textContent = off.error || 'latest.yml не прочитан — проверь связь и попробуй ещё раз.';
  }

  // ===== Канал обновлений: Стабильная / Отладочная (А4) =====
  var chSeg = $('setChannel'), chWarn = $('setChanWarn'), chNow = 'stable';
  var CH_TXT = { stable: 'Стабильная — проверенные версии из открытого репозитория', debug: 'Отладочная — новые версии раньше всех, без проверки; может сломаться' };
  function showChannel(ch){
    chNow = ch === 'debug' ? 'debug' : 'stable';
    var bs = chSeg.querySelectorAll('button');
    for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', bs[k].dataset.v === chNow);
    $('setChanText').textContent = CH_TXT[chNow];
  }
  function setChannel(ch){
    chWarn.hidden = true;
    if (!A.updateChannelSet) return;
    A.updateChannelSet(ch).then(function(r){
      if (r && r.ok) { showChannel(r.channel); return; }
      showChannel(chNow);
      if (r && r.error === 'busy') $('setChanText').textContent = 'Сейчас идёт загрузка обновления — смени канал, когда она закончится';
    });
  }
  chSeg.onclick = function(e){
    var b = e.target.closest('button'); if (!b || b.dataset.v === chNow) return;
    if (b.dataset.v === 'debug') { chWarn.hidden = false; $('setChanStay').focus(); return; } // сначала предупреждение
    setChannel('stable');
  };
  $('setChanStay').onclick = function(){ chWarn.hidden = true; };
  $('setChanGo').onclick = function(){ setChannel('debug'); };
  if (chOfferBtn) chOfferBtn.onclick = function(){
    if (!A.updateInstallOther) return;
    chOfferBtn.disabled = true;
    A.updateInstallOther().then(function(r){
      chOfferBtn.disabled = false;
      if (r && r.ok === false && r.error === 'busy') $('setChanOfferText').textContent = 'Сейчас идёт другая загрузка — попробуй, когда она закончится.';
    }).catch(function(){ chOfferBtn.disabled = false; });
  };
  // при открытии настроек спрашиваем, что уже известно про целевой канал
  document.addEventListener('click', function(e){
    if (!e.target.closest('[data-go="sApp"]')) return;
    if (!A.updateChannelOffer) return;
    A.updateChannelOffer().then(function(off){ if (off) renderChanOffer(off); }).catch(function(){});
  });
  if (A.updateChannelGet) A.updateChannelGet().then(showChannel);
  updCheckBtn.onclick = function(){ if (A.updateCheck) A.updateCheck(); };
  $('setUpdBtn').onclick = function(){ if (A.updateCheck) A.updateCheck(); };
  if (A.onUpdateState) { A.onUpdateState(renderUpdate); A.updateGetState().then(renderUpdate); }

  // Своя полоса прокрутки настроек: живёт снаружи скруглённого контейнера
  (function(){
    var box = document.querySelector('.set-main'), bar = document.getElementById('setBar');
    if (!box || !bar) return;
    var thumb = bar.firstElementChild;
    function upd(){
      var view = box.clientHeight, total = box.scrollHeight;
      var on = total - view > 2;
      bar.classList.toggle('on', on);
      if (!on) return;
      var h = Math.max(28, Math.round(view * view / total));
      var y = total > view ? Math.round(box.scrollTop / (total - view) * (view - h)) : 0;
      thumb.style.height = h + 'px';
      thumb.style.transform = 'translateY(' + y + 'px)';
    }
    box.addEventListener('scroll', upd);
    window.addEventListener('resize', upd);
    setInterval(function(){ if (typeof curTab === 'undefined' || curTab === 'settings') upd(); }, 500); // только когда настройки открыты
    // перетаскивание ползунка и клик по дорожке
    bar.addEventListener('mousedown', function(e){
      var view = box.clientHeight, total = box.scrollHeight;
      if (total - view <= 2) return;
      e.preventDefault();
      var h = Math.max(28, Math.round(view * view / total));
      var rect = bar.getBoundingClientRect();
      var y = e.clientY - rect.top;
      var top = parseFloat((thumb.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
      var track = Math.max(1, view - h - 16);
      if (y < top || y > top + h) {
        var pos = Math.min(Math.max(0, (y - h / 2) / track), 1);
        box.scrollTop = pos * (total - view);
        return;
      }
      thumb.classList.add('drag');
      var startY = e.clientY, startTop = box.scrollTop, k = (total - view) / track;
      function move(ev){ box.scrollTop = startTop + (ev.clientY - startY) * k; }
      function up(){ thumb.classList.remove('drag'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    setTimeout(upd, 300);
  })();
