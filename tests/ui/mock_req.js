// Добавка к mock5.js: заказы со стрима, сервисы донатов, сайт-визитка
(function(){
  var P = function(v){ return new Promise(function(r){ setTimeout(function(){ r(v); }, 20); }); };
  var A = window.app, L = window.__log;
  var T = function(id, author, title, sec, extra){ return Object.assign({ src: 'ym', id: String(id), albumId: '9', title: title, author: author, duration: Math.floor(sec/60) + ':' + ('0' + sec%60).slice(-2), seconds: sec, thumb: '' }, extra || {}); };
  window.__T = T;
  var don = { da: { name: 'DonationAlerts', connected: true, ok: true, account: { name: 'murzik' }, configured: true }, dp: { name: 'DonatePay', connected: false } };
  var site = { configured: false, connected: false, account: null, url: '' };
  A.reqList = function(){ return P([]); };
  A.reqUpdate = function(k, p){ L.push('reqUpdate ' + k + ' ' + (p.items || []).map(function (i){ return i.state || '-'; }).join(',')); return P(true); };
  A.reqClear = function(){ L.push('reqClear'); return P([]); };
  A.reqRemember = function(line, t){ L.push('remember ' + line + ' → ' + t.title); return P(true); };
  A.onReqNew = function(cb){ window.__reqCb = cb; };
  A.reqTest = function(text, amt){
    // Старый вызов — текст и сумма; новый (отладочное меню и визард) — объект { name, amount, service, text }.
    var o = (text && typeof text === 'object') ? text : { text: text, amount: amt };
    var raw = String(o.text == null ? '' : o.text);
    var sum = Number(o.amount) || 0;
    L.push('reqTest ' + raw + ' ' + o.amount);
    var n = window.__reqN = (window.__reqN || 0) + 1;
    var title = /группа крови/i.test(raw) ? 'Группа крови' : 'Кукушка';
    var r = { key: 'test:' + n, prov: 'test', test: true, service: o.service || 'da', name: o.name || 'Пробный заказ', text: raw, amount: sum, currency: 'RUB', at: Date.now(), got: Date.now(), level: 'exact', state: 'new', items: [{ level: 'exact', track: T(70 + n, 'Кино', title, 398), alts: [], flags: [], paid: sum >= 100 }] };
    setTimeout(function(){ window.__reqCb && window.__reqCb(r); }, 5); return P(r);
  };
  A.donStatus = function(){ return P(don); };
  // Слушателей несколько (Настройки и визард) — как в preload, где событие получают все.
  window.__donCbs = [];
  A.onDonStatus = function(cb){ (window.__donCbs = window.__donCbs || []).push(cb); };
  window.__don = function(s){ (window.__donCbs || []).forEach(function(cb){ try { cb(s); } catch (e) {} }); };
  A.donDaLogin = function(){ return P({ ok: true }); }; A.donDaCancel = function(){ return P(true); };
  A.donSetKey = function(p, k){ L.push('donSetKey ' + p + ' ' + k.length); don[p].connected = true; don[p].ok = true; don[p].account = { name: 'tester' }; return P({ ok: true }); };
  A.donDisconnect = function(p){ don[p].connected = false; return P(true); };
  A.siteStatus = function(){ return P(site); };
  A.sitePreview = function(p){ L.push('sitePreview ' + p.price + ' ' + Object.keys(p.donate || {}).join(',') + ' showPrice=' + (p.showPrice !== false)); return P('<html><body><h1>' + (p.nick || '') + '</h1><p>Заказать песню</p></body></html>'); };
  A.sitePublish = function(p){ L.push('sitePublish ' + p.nick); site.url = 'https://alexshikaka.github.io/tapyor-page/'; return P({ ok: true, url: site.url }); };
  A.siteSave = function(){ return P({ ok: true }); };
  A.siteGhToken = function(t){ L.push('ghToken ' + t.length); site.connected = !!t; site.account = t ? { login: 'alexshikaka' } : null; return P({ ok: true }); };
  A.openLink = function(u){ L.push('openLink ' + u); return P(true); };
})();
