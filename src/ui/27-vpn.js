// VPN и Яндекс: список сетей Яндекса для исключения из туннеля (split tunneling).
// Зачем: при включённом VPN часть запросов к Яндексу может уходить за границу, и плеер
// music.yandex.ru ждёт по 10–20 секунд перед треком (бывает не всегда).
// Данные: живой список из RIPE с кэшем (src/vpn-nets-live.js), запасной — src/vpn-nets.js.

function vpnNetsMeta(o) {
  var parts = [];
  if (o && o.nets) parts.push(o.nets.length + ' сетей');
  if (o && o.source === 'live') parts.push('обновлено из RIPE');
  else if (o && o.source === 'cache' && o.at) parts.push('из кэша, ' + new Date(o.at).toLocaleDateString('ru-RU'));
  else if (o && o.source === 'builtin') parts.push('встроенный список');
  if (o && o.error) parts.push('сеть недоступна — показан сохранённый');
  return parts.join(' · ');
}

function vpnNetsRender(o) {
  var ta = $('vpnNets'); if (!ta || !o || !o.nets) return;
  ta.value = o.line;
  var c = $('vpnCount'); if (c) c.textContent = vpnNetsMeta(o);
}

function vpnNetsLoad(force) {
  var fn = force && A.vpnNetsRefresh ? A.vpnNetsRefresh : A.vpnNets;
  if (!fn) return Promise.resolve();
  return fn().then(vpnNetsRender).catch(function () {});
}

(function () {
  var copy = $('vpnCopyBtn');
  if (copy) copy.addEventListener('click', function () {
    var ta = $('vpnNets');
    if (!ta || !ta.value) { toast('Список ещё загружается'); return; }
    ta.focus(); ta.select(); ta.setSelectionRange(0, 999999);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    toast(ok ? 'Список сетей скопирован' : 'Не удалось скопировать — выдели текст и нажми Ctrl+C');
  });
  var ref = $('vpnRefreshBtn');
  if (ref) ref.addEventListener('click', function () {
    ref.disabled = true;
    vpnNetsLoad(true).then(function () { ref.disabled = false; toast('Список обновлён'); })
      .catch(function () { ref.disabled = false; });
  });
  var nav = document.querySelector('.set-side [data-go="sVpn"]');
  if (nav) nav.addEventListener('click', function () { vpnNetsLoad(false); });
  vpnNetsLoad(false);
})();
