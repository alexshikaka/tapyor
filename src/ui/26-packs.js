  // ===== Пак стримера: установка, пробный период, ключ (docs/PLAN-MODULES-SPLIT.md, этап 3) =====
  // Раздел «Модули → Пак стримера». Бот и оверлей (24-bot.js, 25-overlay.js) показывают короткую строку
  // о лицензии (packLicStrip) и ведут сюда кнопкой.
  // Где купить ключ пака (решено 15.11.2026: продаём через GGSel). Адрес пропускает open-external.js.
  var PACK_BUY_URL = 'https://ggsel.net/catalog/product/104388863';
  function packBuy(){ if (A.openExternal) A.openExternal(PACK_BUY_URL).catch(function(){}); }
  var PK = { st: null, check: null, busy: false, keyOpen: false, manualOpen: false, req: null, msg: '' };

  function packDays(n){ return n + ' ' + (typeof botDays === 'function' ? botDays(n) : 'дн.'); }
  // Текст состояния лицензии — общий для пака, бота и оверлея
  function packLicText(L){
    if (!L) return '';
    switch (L.state) {
      case 'dev': return 'Режим разработки: пак из папки Tapyor-modules, лицензия не проверяется';
      case 'full': return 'Пак куплен — работает на этом компьютере';
      case 'trial': return 'Пробный период: осталось ' + packDays(L.daysLeft);
      case 'trial-ended': return 'Пробный период закончился — модули выключены, плеер работает как обычно';
      case 'none': return 'Пак установлен, но не включён: попробуй 30 дней бесплатно или введи ключ';
      case 'other-pc': return 'Лицензия выдана для другого компьютера — введи ключ на этом';
      case 'clock': return 'Часы компьютера переведены назад — поправь время, и пробный период вернётся';
      case 'edition': return 'Этот модуль входит в новую редакцию пака';
      case 'broken': return 'Пак повреждён — переустановите';
      case 'not-installed': return 'Пак стримера не установлен';
      default: return '';
    }
  }
  function packPillText(L){
    if (!L) return '';
    if (L.state === 'trial') return 'пробный · ' + L.daysLeft + ' дн.';
    if (L.state === 'full') return '';
    if (L.state === 'dev') return 'разработка';
    if (L.state === 'not-installed') return '';
    if (L.state === 'broken') return 'повреждён';
    return 'выключен';
  }
  // Строка вверху бота и оверлея
  function packLicStrip(L){
    if (!L || L.state === 'full' || L.state === 'not-installed') return '';
    return '<div class="bot-lic"><span class="pill bot-pill">Пак стримера</span><span class="bot-lic-t">' + esc(packLicText(L)) + '</span>' +
      (L.state === 'dev' ? '' : '<button class="btn" data-pack-open="1">Ключ и пробный период</button>' + (L.state === 'trial' || L.state === 'trial-ended' ? '<button class="btn acc" data-pack-buy="1">Купить ключ</button>' : '')) + '</div>';
  }
  // Подсказка внутри «Чат-бота» и «Оверлея», когда функция недоступна (0.34.0, Б10).
  // Пункты меню теперь видны всегда; здесь объясняем, чего не хватает, и даём готовые действия.
  function packModuleHint(title, st, modId){
    var inst = !!(st && st.installed);
    if (!inst) {
      return '<div class="bot-note"><b>' + esc(title) + ' входит в пак стримера.</b> Пак — это чат-бот Twitch и оверлей для OBS; ставится одной кнопкой.' +
        '<div class="bot-pair" style="margin-top:10px"><button class="btn" data-pack-open="1">Установить пак</button></div></div>';
    }
    var mod = st.modules && st.modules[modId];
    if (!mod) {
      return '<div class="bot-note"><b>' + esc(title) + ' входит в пак стримера,</b> но в установленной версии пака его нет. Обнови пак — модуль появится.' +
        '<div class="bot-pair" style="margin-top:10px"><button class="btn" data-pack-open="1">Обновить пак</button></div></div>';
    }
    var L = st.license || {};
    if (L.enabled) return '';
    var txt = packLicText(L) || 'Пак установлен, но не включён.';
    var btns = '';
    if (L.state === 'none') btns = '<button class="btn" data-pack-trial="1">Начать пробный период</button><button class="btn ghost" data-pack-key="1">Ввести ключ</button>';
    else if (L.state === 'edition') btns = '<button class="btn" data-pack-open="1">Обновить пак</button>';
    else if (L.state === 'broken') btns = '<button class="btn" data-pack-open="1">Переустановить пак</button>';
    else if (L.state === 'clock') btns = '<button class="btn ghost" data-pack-open="1">Пак стримера</button>';
    else btns = '<button class="btn ghost" data-pack-key="1">Ввести ключ</button>';
    if (L.state === 'none' || L.state === 'trial-ended' || L.state === 'other-pc') btns += '<button class="btn acc" data-pack-buy="1">Купить ключ</button>';
    return '<div class="bot-note"><b>' + esc(title) + ' входит в пак стримера.</b> ' + esc(txt) +
      '<div class="bot-pair" style="margin-top:10px">' + btns + '</div></div>';
  }
  function openPackPane(){ setTab('settings', 'sPack'); packLoad(true).then(function(){ if (typeof showSettingsPane === 'function') showSettingsPane('sPack'); }); }

  function pkRow(title, desc, ctl){ return '<div class="srow"><div class="sl"><div class="st">' + title + '</div>' + (desc ? '<div class="sd">' + desc + '</div>' : '') + '</div>' + (ctl || '') + '</div>'; }
  function pkBtn(act, text, ghost, dis){ return '<button class="btn' + (ghost === 'acc' ? ' acc' : ghost ? ' ghost' : '') + '" data-pk="' + act + '"' + (dis || PK.busy ? ' disabled' : '') + '>' + esc(text) + '</button>'; }

  function packRender(){
    var box = $('packPanel'); if (!box) return;
    var st = PK.st || {}, L = st.license || {}, m = st.manifest, c = PK.check || {};
    var inst = !!st.installed, dev = !!st.dev, broken = !!st.broken;
    var h = '';
    if (PK.msg) h += '<div class="pk-msg">' + esc(PK.msg) + '</div>';
    // 1. Что это
    var mods = (m && m.modules) ? m.modules.map(function (x){ return x.name || x.id; }).join(', ') : 'чат-бот Twitch, оверлей-плейлист для OBS';
    var ver = inst ? 'версия ' + m.version + (dev ? ' (разработка)' : '') : (c.latest ? 'доступна версия ' + c.latest.version + (c.latest.size ? ' · ' + Math.max(1, Math.round(c.latest.size / 1024)) + ' КБ' : '') : '');
    h += '<div class="card">' + pkRow('Пак стримера', esc(mods) + (ver ? ' · ' + esc(ver) : ''),
      !inst ? pkBtn('install', 'Установить', false, c.ok === false || (c.latest && c.coreOk === false))
        : broken ? pkBtn('install', 'Переустановить', false, c.ok === false || (c.latest && c.coreOk === false))
        : (c.update ? pkBtn('install', 'Обновить до ' + c.latest.version) : '<span class="pill ok">установлен</span>'));
    if (st.legacy && !broken) h += '<div class="pk-msg">Пак поставлен прошлой версией Тапёра. Он работает, но защита от подмены файлов включится после переустановки пака (кнопка «Переустановить» или обновление пака).</div>';
    if (broken) h += '<div class="pk-msg">Пак повреждён — переустановите. Модули не запускаются, пока файлы пака не совпадут с подписью.</div>';
    if (!inst && c.ok === false) h += pkRow('', esc(c.error || 'список паков недоступен'), pkBtn('recheck', 'Проверить ещё раз', true));
    if (c.latest && c.coreOk === false) h += pkRow('', 'Нужна новая версия Тапёра: ' + esc(c.latest.minCore) + ' или новее', '');
    if (!inst && c.ok && !c.latest) h += pkRow('', 'Пак ещё не опубликован — загляни позже', '');
    h += '</div>';

    if (inst && !dev && !broken) {
      // 2. Лицензия
      var lic = '<div class="card">' + pkRow('Состояние', esc(packLicText(L)), L.state === 'trial' ? '<span class="pill bot-pill">' + esc(packPillText(L)) + '</span>' : (L.state === 'full' ? '<span class="pill ok">куплен</span>' : ''));
      if (L.state !== 'full') {
        if (L.state === 'none' || L.state === 'other-pc') lic += pkRow('Попробовать бесплатно', '30 дней, один раз на компьютер. Нужен интернет, чтобы получить пробный период', pkBtn('trial', 'Попробовать 30 дней'));
        lic += pkRow('Купить ключ', 'На GGSel: ключ приходит сразу после оплаты. Вставь его в строку «Ключ» ниже', pkBtn('buy', 'Купить ключ', 'acc'));
        lic += pkRow('Ключ', 'Ключ вида TPR-XXXX-XXXX-XXXX — после покупки. Один ключ — до 3 компьютеров. Сюда же можно вставить строку лицензии tpl1.… от автора',
          PK.keyOpen ? '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="field mono" id="pkKey" placeholder="TPR-XXXX-XXXX-XXXX или tpl1.…" style="width:220px" autocomplete="off" spellcheck="false">' + pkBtn('activate', 'Активировать') + '</div>'
            : pkBtn('key', 'Ввести ключ'));
      } else {
        // M7: без ключа (лицензия вставлена вручную) отвязать с сервера нельзя — честно говорим, кто освобождает место
        if (st.keyMask) lic += pkRow('Перенести на другой компьютер', 'Ключ ' + esc(st.keyMask) + '. Освобождает место этого компьютера на ключе. Модули здесь выключатся', pkBtn('deactivate', 'Отвязать этот компьютер', true));
        else lic += pkRow('Перенести на другой компьютер', 'Лицензия вставлена вручную — место на сервере освобождает автор Тапёра. Напиши ему код этого компьютера (блок ниже)', '');
      }
      // ручная активация — аварийный путь
      lic += '<details class="pk-man"' + (PK.manualOpen ? ' open' : '') + '><summary data-pk="manual">Нет интернета или сервер не отвечает</summary>' +
        '<div class="sd">1. Отправь автору Тапёра код этого компьютера и ключ. 2. Вставь строку лицензии, которую он пришлёт.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' + (PK.req ? '<input class="field mono" readonly value="' + esc(PK.req.code) + '" style="flex:1 1 300px">' + pkBtn('copy-req', 'Скопировать код', true) : pkBtn('req', 'Показать код компьютера', true)) + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><input class="field mono" id="pkTok" placeholder="tpl1.…" style="flex:1 1 300px" autocomplete="off" spellcheck="false">' + pkBtn('paste', 'Вставить лицензию') + '</div></details>';
      h += lic + '</div>';
    }
    // 3. Обслуживание — доступно и когда пак повреждён (откат/удаление), и в обычном состоянии
    if (inst && !dev) {
      h += '<div class="card">' +
        (st.prev ? pkRow('Вернуть прошлую версию', 'Если после обновления что-то сломалось: ' + esc(st.prev), pkBtn('rollback', 'Откатить', true)) : '') +
        pkRow('Удалить пак', 'Настройки бота, вход Twitch и оверлея останутся — поставишь снова, всё вернётся', pkBtn('remove', 'Удалить', true)) + '</div>';
    }
    if (dev) h += '<div class="card">' + pkRow('Режим разработки', 'Тапёр запущен из исходников: пак берётся из Tapyor-modules без подписи. В собранном Тапёре пак ставится кнопкой «Установить»', '') + '</div>';
    box.innerHTML = h;
  }

  function packMenu(){
    var st = PK.st || {};
    var g = $('setGrpMods'); if (g) g.hidden = false;
    var sec = $('sPack'); if (sec) sec.hidden = false;
    var p = $('packPill'); if (p) p.textContent = packPillText(st.license);
  }
  async function packLoad(withCheck){
    if (!A.modStatus) return;
    try { PK.st = await A.modStatus(); } catch (e) {}
    if ((withCheck || !PK.check) && A.packCheck && !(PK.st && PK.st.dev)) { try { PK.check = await A.packCheck(); } catch (e) { PK.check = { ok: false, error: e.message || String(e) }; } }
    packMenu(); packRender();
  }
  async function pkDo(fn, okText){
    if (PK.busy) return;
    PK.busy = true; PK.msg = ''; packRender();
    var r; try { r = await fn(); } catch (e) { r = { ok: false, error: e.message || String(e) }; }
    PK.busy = false;
    if (r && r.ok) { toast(okText); PK.keyOpen = false; } else PK.msg = (r && r.error) || 'не получилось';
    await packLoad(true);
    if (typeof botLoad === 'function') botLoad(true);
    if (typeof ovLoad === 'function') ovLoad();
  }
  var packPanelEl = $('packPanel');
  if (packPanelEl) packPanelEl.addEventListener('click', function (e){
    var b = e.target.closest('[data-pk]'); if (!b || b.disabled) return;
    var act = b.dataset.pk;
    if (act === 'manual') { PK.manualOpen = !PK.manualOpen; return; }
    if (act === 'buy') { packBuy(); return; }
    if (act === 'install') pkDo(function(){ return A.packInstall(); }, 'Пак стримера установлен');
    else if (act === 'recheck') packLoad(true);
    else if (act === 'trial') pkDo(function(){ return A.licTrial(); }, 'Пробный период включён: 30 дней');
    else if (act === 'key') { PK.keyOpen = true; packRender(); var k = $('pkKey'); if (k) k.focus(); }
    else if (act === 'activate') {
      var v = ($('pkKey') || {}).value || '';
      // Б9: вставили в поле «Ключ» готовую строку лицензии tpl1.… — принимаем её как ручную, без сервера
      if (/^\s*tpl1\./.test(v)) pkDo(function(){ return A.licPaste(v.trim()); }, 'Лицензия принята');
      else pkDo(function(){ return A.licActivate(v); }, 'Ключ активирован — пак работает');
    }
    else if (act === 'deactivate') pkDo(function(){ return A.licDeactivate(); }, 'Компьютер отвязан от ключа');
    else if (act === 'rollback') pkDo(function(){ return A.packRollback(); }, 'Вернул прошлую версию пака');
    else if (act === 'remove') pkDo(function(){ return A.packRemove(); }, 'Пак удалён');
    else if (act === 'req') { A.licRequest().then(function (r){ PK.req = r; PK.manualOpen = true; packRender(); }); }
    else if (act === 'copy-req') { if (PK.req) navigator.clipboard.writeText(PK.req.code).then(function(){ toast('Код компьютера скопирован'); }); }
    else if (act === 'paste') { var t = ($('pkTok') || {}).value || ''; pkDo(function(){ return A.licPaste(t); }, 'Лицензия принята'); }
  });
  if (packPanelEl) packPanelEl.addEventListener('keydown', function (e){ if (e.key === 'Enter' && e.target.id === 'pkKey') { var b = packPanelEl.querySelector('[data-pk="activate"]'); if (b) b.click(); } });
  // кнопка «Ключ и пробный период» в боте и оверлее
  document.addEventListener('click', function (e){
    if (e.target.closest('[data-pack-trial]')) { pkDo(function(){ return A.licTrial(); }, 'Пробный период включён: 30 дней'); return; }
    if (e.target.closest('[data-pack-buy]')) { packBuy(); return; }
    if (e.target.closest('[data-pack-key]')) { PK.keyOpen = true; openPackPane(); return; }
    if (e.target.closest('[data-pack-open]')) { e.preventDefault(); openPackPane(); return; }
    if (e.target.closest('[data-go="sPack"]')) packLoad(true);
  });
  if (A.onModStatus) A.onModStatus(function (st){ PK.st = st; packMenu(); packRender(); });
  if (A.modStatus) setTimeout(function(){ packLoad(false); }, 3800);
