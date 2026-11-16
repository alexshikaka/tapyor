// «О программе» (А12): версия, сборка (dev / stable / из исходников), коммит, канал обновлений и ссылки.
// Метку сборки вшивает electron-builder (-c.extraMetadata.tapyorBuild), читает src/build-info.js.
// Ссылки до появления у владельца сайта и Telegram — заглушки «Скоро», кнопки выключены.
(function(){
  var BUILD_NOTE = {
    dev: 'отладочная (dev) — новые версии раньше всех, без проверки; может сломаться',
    stable: 'стабильная — проверенная версия из открытого репозитория',
    source: 'из исходников — собрана на этом компьютере, обновления не ставятся'
  };
  var LINKS = {
    repo: 'https://github.com/alexshikaka/tapyor',
    issues: 'https://github.com/alexshikaka/tapyor/issues/new/choose',
    privacy: 'https://github.com/alexshikaka/tapyor/blob/main/PRIVACY.md',
    tg: 'https://t.me/tapyor',        // канал: новости и версии (решение владельца 11.11)
    tgchat: 'https://t.me/tapyorchat', // привязанный чат: вопросы и ошибки
    da: 'https://www.donationalerts.com/r/alexshikaka', // поддержка автора (G4)
    yoomoney: 'https://yoomoney.ru/to/410011529262377',  // поддержка автора (G4)
    site: ''                          // сайт tapyor-web — после решения владельца (А13)
  };
  var info = null;
  var version = '';

  function fill(){
    var t = $('aboutVer'), b = $('aboutBuild'), c = $('aboutCommit');
    if (t) t.textContent = version || (info && info.version) || '…';
    if (!info) return;
    if (b) b.textContent = BUILD_NOTE[info.build] || BUILD_NOTE.dev;
    if (c) c.textContent = info.commit || 'неизвестен';

    // метка в шапке: «dev» только у отладочной сборки и у запуска из исходников
    var tag = $('buildTag');
    if (tag) {
      var label = info.build === 'stable' ? '' : 'dev';
      tag.hidden = !label;
      if (label) {
        tag.textContent = label;
        tag.title = info.build === 'source'
          ? 'Запуск из исходников: сборка не подписана, обновления не ставятся'
          : 'Отладочная сборка: версии приходят раньше, но могут сломаться';
      }
    }
    // бейдж рядом с версией в этом же разделе — та же метка
    var bb = $('aboutBuildBadge');
    if (bb) {
      bb.hidden = !label;
      if (label) { bb.textContent = label; bb.title = tag ? tag.title : ''; }
    }
  }

  function fillChannel(){
    var el = $('aboutChannel');
    if (!el) return;
    if (!A.updateChannelGet) { el.textContent = 'стабильная'; return; }
    A.updateChannelGet().then(function (ch){
      el.textContent = ch === 'debug'
        ? 'отладочная — релизы alexshikaka/tapyor-releases'
        : 'стабильная — релизы alexshikaka/tapyor';
    }).catch(function(){ el.textContent = 'стабильная'; });
  }

  // «Сообщить об ошибке»: подставляем ТОЛЬКО версию, сборку и коммит — ни почты, ни имени
  // компьютера, ни каких-либо личных данных (решение владельца 11.11). Задача открывается на GitHub.
  function issuesUrl(){
    var b = (info && info.build) || 'неизвестна';
    var c = (info && info.commit) || 'неизвестен';
    var v = version || (info && info.version) || '?';
    var title = 'Ошибка ' + v + ' (' + b + ')';
    var body = 'Тапёр ' + v + '\nСборка: ' + b + '\nКоммит: ' + c + '\n\nЧто случилось:\n\n\nКак повторить:\n\n';
    return LINKS.issues + '?labels=bug&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
  }

  document.addEventListener('click', function (e){
    var b = e.target.closest('[data-about]');
    if (!b) return;
    var key = b.dataset.about;
    var url = key === 'issues' ? issuesUrl() : LINKS[key];
    if (!url || b.disabled) return;
    e.preventDefault();
    if (A.openExternal) A.openExternal(url);
  });

  // «Сменить в „Программе“»: перейти в раздел «Программа» и показать переключатель канала.
  // Раньше кнопка не работала: переход ловился только внутри левого меню (.set-side), а эта кнопка
  // живёт в области раздела.
  document.addEventListener('click', function (e){
    var b = e.target.closest('#sAbout [data-go="sApp"]');
    if (!b) return;
    e.preventDefault();
    if (typeof window.showSettingsPane === 'function') window.showSettingsPane('sApp');
    var seg = document.getElementById('setChannel');
    if (seg) {
      try { seg.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) { seg.scrollIntoView(); }
      var first = seg.querySelector('button');
      if (first) first.focus();
    }
  });

  document.addEventListener('click', function (e){
    if (!e.target.closest('[data-go="sAbout"]')) return;
    fill(); fillChannel();
  });

  function start(){
    if (!A.buildInfo) { info = { build: 'source', commit: '' }; fill(); return; }
    A.buildInfo().then(function (r){ info = r || {}; fill(); }).catch(function(){ fill(); });
  }
  if (A.getVersion) A.getVersion().then(function (v){ version = v || ''; fill(); }).catch(function(){});
  start();
})();
