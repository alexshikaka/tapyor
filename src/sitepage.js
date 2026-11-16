// Сайт-визитка стримера: одна страница (index.html) + страница QR-кода для OBS (qr.html).
// Тапёр выкладывает их в репозиторий стримера tapyor-page на GitHub и включает GitHub Pages.
let electron = {}; try { electron = require('electron'); } catch (e) { /* проверки без Electron */ }
const shell = electron.shell, safeStorage = electron.safeStorage;
const fs = require('fs');
const path = require('path');
const openExternal = require('./open-external');

let log = () => {};
let store = { get: () => null, set: () => {} };
function setup(o) { log = o.log || log; store = o.store || store; }
function enc(s) { return (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8')).toString('base64'); }
function dec(v) { try { const b = Buffer.from(v, 'base64'); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8'); } catch (e) { return ''; } }
const REPO = 'tapyor-page';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u) => { u = String(u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : ''; } catch (e) { return ''; } };
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : d);

const donateLogos = require('./donate-logos'); // настоящие логотипы DonationAlerts/DonatePay (хотфикс 0.36.3)
const SERVICES = [
  { k: 'da', name: 'DonationAlerts', short: 'DA', color: '#F4511E', logo: donateLogos.da },
  { k: 'dp', name: 'DonatePay', short: 'DP', color: '#22C55E', logo: donateLogos.dp },
  { k: 'boosty', name: 'Boosty', short: 'B', color: '#FF7A00' }, { k: 'other', name: 'Другой способ', short: 'Д', color: '#8B7CF6' }
];
const CHANNELS = [{ k: 'twitch', name: 'Twitch' }, { k: 'youtube', name: 'YouTube' }, { k: 'vk', name: 'VK Видео' }, { k: 'kick', name: 'Kick' }, { k: 'telegram', name: 'Telegram' }];
const DEFAULT_INSTR = 'Нажми любую кнопку доната выше.\n\nЕсли хочешь заказать песню, в сообщении напиши песню: `Исполнитель — Название` или ссылку (YouTube, Яндекс Музыка, SoundCloud).\n\nНесколько песен — через запятую или с новой строки. Цена — за каждую.\n\nПривет и пожелания пиши там же: песню программа найдёт сама.';

// p: { nick, about, avatar, channels:{k:url}, donate:{k:url}, price, currency, instr (текст инструкции), colors:{bg,card,tx,tx2,ac,pri} }
function build(p) {
  const c = p.colors || {};
  const bg = hex(c.bg, '#15161C'), card = hex(c.card, '#1E2029'), tx = hex(c.tx, '#ECEDF2'), tx2 = hex(c.tx2, '#9EA2B0'), ac = hex(c.ac, '#8B7CF6'), pri = hex(c.pri, '#8B7CF6');
  const cur = { RUB: '₽', UAH: '₴', KZT: '₸', USD: '$', EUR: '€' }[p.currency] || p.currency || '₽';
  const price = Number(p.price) > 0 && p.showPrice !== false ? Math.round(Number(p.price)) + ' ' + cur : '';
  const donate = SERVICES.map((s) => ({ s, url: safeUrl((p.donate || {})[s.k]) })).filter((x) => x.url);
  const chans = CHANNELS.map((s) => ({ s, url: safeUrl((p.channels || {})[s.k]) })).filter((x) => x.url);
  const instrText = String(p.instr || '').trim() || DEFAULT_INSTR;
  const instr = instrText.split(/\n+/).map((l) => '<li>' + esc(l).replace(/`([^`]+)`/g, '<code>$1</code>') + '</li>').join('');
  const ex = ['Отличного настроения! The Blasters — Dark Night', 'Ария — Беспечный, Земфира — Искала', 'https://youtu.be/… поставь, пожалуйста'];
  const avatar = safeUrl(p.avatar);
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(p.nick || 'Стрим') + ' — донаты и заказ музыки</title><meta name="description" content="Поддержать стрим и заказать песню">' +
    '<style>:root{--bg:' + bg + ';--card:' + card + ';--tx:' + tx + ';--tx2:' + tx2 + ';--ac:' + ac + ';--pri:' + pri + '}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif}' +
    '.w{max-width:620px;margin:0 auto;padding:32px 16px 48px}.hd{text-align:center}.av{width:96px;height:96px;border-radius:50%;object-fit:cover;border:3px solid var(--ac)}h1{margin:12px 0 4px;font-size:28px}.ab{color:var(--tx2);margin:0}' +
    '.ch{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:14px 0 0}.ch a{color:var(--tx2);text-decoration:none;border:1px solid color-mix(in srgb,var(--tx2) 35%,transparent);border-radius:99px;padding:4px 12px;font-size:14px}.ch a:hover{color:var(--tx);border-color:var(--ac)}' +
    'h2{font-size:19px;margin:32px 0 12px}.dn{display:grid;gap:10px}.dn a{display:flex;align-items:center;gap:12px;background:var(--card);color:var(--tx);text-decoration:none;padding:14px 18px;border-radius:14px;font-weight:600;font-size:17px;border:1px solid var(--bc,var(--ac));transition:.15s}.dn a:hover{border-color:var(--bc,var(--ac));transform:translateY(-1px)}.dn a .svc{flex:0 0 34px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--bc,var(--ac));color:#fff;font:800 13px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.02em}.dn a .svc.logo{background:transparent;border-radius:0}.dn a .svc.logo img{width:100%;height:100%;object-fit:contain}.dn a i{margin-left:auto;color:var(--tx2);font-style:normal;font-weight:400}' +
    '.mu{background:var(--card);border-radius:16px;padding:20px 22px;border:1px solid color-mix(in srgb,var(--pri) 45%,transparent)}.mu h2{margin:0 0 4px}.pr{display:inline-block;background:var(--pri);color:#fff;border-radius:99px;padding:2px 12px;font-weight:700;margin-left:6px;font-size:16px}' +
    '.mu ol{padding-left:20px;margin:12px 0}.mu li{margin:6px 0}code{background:color-mix(in srgb,var(--tx) 10%,transparent);padding:1px 6px;border-radius:6px;font-family:Consolas,monospace;font-size:14px}.ex{color:var(--tx2);font-size:14px}.ex div{margin:4px 0}.ft{text-align:center;color:var(--tx2);font-size:13px;margin-top:36px}.ft a{color:var(--tx2)}</style></head><body><div class="w">' +
    '<div class="hd">' + (avatar ? '<img class="av" src="' + esc(avatar) + '" alt="">' : '') + '<h1>' + esc(p.nick || 'Мой стрим') + '</h1>' + (p.about ? '<p class="ab">' + esc(p.about) + '</p>' : '') +
    (chans.length ? '<div class="ch">' + chans.map((x) => '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + x.s.name + '</a>').join('') + '</div>' : '') + '</div>' +
    '<h2>Поддержать стрим</h2><div class="dn">' + (donate.length ? donate.map((x) => '<a href="' + esc(x.url) + '" target="_blank" rel="noopener" style="--bc:' + x.s.color + '"><span class="svc' + (x.s.logo ? ' logo' : '') + '">' + (x.s.logo ? '<img src="' + x.s.logo + '" alt="' + esc(x.s.name) + '">' : esc(x.s.short)) + '</span>' + x.s.name + '<i>→</i></a>').join('') : '<p class="ab">Ссылки на донат появятся здесь.</p>') + '</div>' +
    '<div class="mu" style="margin-top:28px"><h2>🎵 Заказать песню' + (price ? '<span class="pr">' + esc(price) + ' за трек</span>' : '') + '</h2><ol>' + instr + '</ol>' +
    '<div class="ex"><b>Примеры сообщений:</b>' + ex.map((e) => '<div><code>' + esc(e) + '</code></div>').join('') + '</div>' +
    '</div>' +
    '<p class="ab" style="text-align:center;margin-top:20px">Не хочешь ничего заказывать — просто донать, это тоже супер ❤️</p>' +
    '<div class="ft">Страница сделана в <a href="https://github.com/alexshikaka/tapyor-player" target="_blank" rel="noopener">Тапёре</a> — плеере для стримов</div></div></body></html>';
}
// QR-код для OBS (источник «Браузер», прозрачный фон). QR рисует сам Тапёр при выкладке:
// готовый SVG внутри страницы, без чужих скриптов и внешних адресов (А8).
// Библиотека qrcode-svg (MIT, без зависимостей) — см. THIRD-PARTY.md.
function qrSvg(url, px) {
  const QRCode = require('qrcode-svg');
  const svg = new QRCode({
    content: String(url || ''), width: px, height: px,
    color: '#111111', background: '#ffffff', ecl: 'M', padding: 0
  }).svg();
  // <?xml …?> внутри HTML не нужен — браузер считает его «непонятным комментарием»
  return String(svg).replace(/^<\?xml[^>]*\?>\s*/i, '');
}
function buildQr(p, url) {
  const c = p.colors || {};
  const ac = hex(c.pri, '#8B7CF6');
  const svg = qrSvg(url, 220);
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>QR</title><style>html,body{margin:0;background:transparent}.b{display:inline-flex;flex-direction:column;align-items:center;gap:10px;padding:16px;background:#fff;border-radius:18px;border:4px solid ' + ac + ';font:700 22px "Segoe UI",system-ui,sans-serif;color:#111}.q svg{display:block;width:220px;height:220px}</style></head><body><div class="b"><div class="q">' + svg + '</div><div>' + esc(p.qrCaption || 'Заказать песню') + '</div></div></body></html>';
}

// --- GitHub ---
function ghConfig() {
  for (const f of [path.join(__dirname, 'github-oauth.json'), path.join(process.resourcesPath || '', 'github-oauth.json')]) {
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.clientId) return j; } catch (e) {}
  }
  return null;
}
function token() {
  try { const v = store.get('ghToken'); return v ? dec(v) : ''; }
  catch (e) { log('Сайт: не смог прочитать сохранённый вход GitHub — ' + (e && e.message || e)); return ''; }
}
async function gh(method, url, body, tok) {
  const r = await fetch('https://api.github.com' + url, { method, headers: { Authorization: 'Bearer ' + (tok || token()), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Tapyor', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok) { const err = new Error((j && j.message) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
  return j;
}
async function setToken(tok) {
  tok = String(tok || '').trim();
  if (!tok) { store.set('ghToken', null); store.set('ghAccount', null); return { ok: true }; }
  try { const me = await gh('GET', '/user', null, tok); store.set('ghToken', enc(tok)); store.set('ghAccount', { login: me.login, avatar: me.avatar_url }); log('Сайт: GitHub подключён'); return { ok: true, login: me.login }; }
  catch (e) { log('Сайт: ключ GitHub не подошёл (' + e.message + ')'); return { error: e.status === 401 ? 'ключ не подошёл' : e.message }; }
}
// Вход по коду (Device Flow) — если владелец Тапёра завёл приложение GitHub (github-oauth.json)
let device = null;
async function deviceStart() {
  const cfg = ghConfig(); if (!cfg) return { error: 'not-configured' };
  // 15 с на запрос: иначе вход по коду может висеть бесконечно (R6).
  const r = await fetch('https://github.com/login/device/code', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: cfg.clientId, scope: 'public_repo' }), signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (!j.device_code) return { error: j.error_description || j.error || 'GitHub не выдал код' };
  device = { code: j.device_code, interval: (j.interval || 5) * 1000, until: Date.now() + (j.expires_in || 900) * 1000, cancelled: false };
  // Адрес подтверждения пришёл от сервера — открываем только сам github.com (B5-2).
  const openUrl = openExternal.githubDeviceUrl(j.verification_uri);
  if (openUrl !== j.verification_uri) log('Сайт: GitHub прислал адрес подтверждения не со своего домена — открываю github.com/login/device');
  shell.openExternal(openUrl);
  return { user_code: j.user_code, verification_uri: j.verification_uri };
}
async function deviceWait() {
  const cfg = ghConfig(); const d = device; if (!cfg || !d) return { error: 'нет входа' };
  while (!d.cancelled && Date.now() < d.until) {
    await new Promise((r) => setTimeout(r, d.interval));
    const r = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: cfg.clientId, device_code: d.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }), signal: AbortSignal.timeout(15000) }).then((x) => x.json()).catch(() => ({}));
    if (r.access_token) return setToken(r.access_token);
    if (r.error === 'slow_down') d.interval += 5000;
    else if (r.error && r.error !== 'authorization_pending') return { error: r.error_description || r.error };
  }
  return { error: d.cancelled ? 'cancelled' : 'timeout' };
}
function deviceCancel() { if (device) device.cancelled = true; }

async function putFile(owner, file, content, msg) {
  let sha;
  try { const cur = await gh('GET', '/repos/' + owner + '/' + REPO + '/contents/' + file); sha = cur.sha; } catch (e) { if (e.status !== 404) throw e; }
  await gh('PUT', '/repos/' + owner + '/' + REPO + '/contents/' + file, { message: msg, content: Buffer.from(content, 'utf8').toString('base64'), sha });
}
async function publish(p) {
  if (!token()) return { error: 'сначала подключи GitHub' };
  try {
    const me = await gh('GET', '/user');
    const owner = me.login;
    let repo;
    try { repo = await gh('GET', '/repos/' + owner + '/' + REPO); }
    catch (e) { if (e.status !== 404) throw e; repo = await gh('POST', '/user/repos', { name: REPO, description: 'Страница стримера: донаты и заказ музыки (сделано в Тапёре)', homepage: 'https://' + owner.toLowerCase() + '.github.io/' + REPO + '/', auto_init: true, has_issues: false, has_wiki: false }); await new Promise((r) => setTimeout(r, 2500)); }
    const url = 'https://' + owner.toLowerCase() + '.github.io/' + REPO + '/';
    await putFile(owner, 'index.html', build(p), 'Обновил страницу (Тапёр)');
    await putFile(owner, 'qr.html', buildQr(p, url), 'QR-код для OBS (Тапёр)');
    try { await gh('POST', '/repos/' + owner + '/' + REPO + '/pages', { source: { branch: repo.default_branch || 'main', path: '/' } }); }
    catch (e) { if (e.status !== 409 && e.status !== 422) log('Сайт: GitHub Pages — ' + e.message); }
    store.set('siteUrl', url);
    log('Сайт: выложен ' + url);
    return { ok: true, url, qr: url + 'qr.html' };
  } catch (e) { log('Сайт: ошибка выкладки ' + e.message); return { error: e.status === 401 ? 'вход в GitHub устарел — подключи заново' : e.message }; }
}
function status() { return { configured: !!ghConfig(), connected: !!token(), account: store.get('ghAccount') || null, url: store.get('siteUrl') || '' }; }

module.exports = { setup, build, buildQr, publish, setToken, deviceStart, deviceWait, deviceCancel, status, SERVICES, CHANNELS };
