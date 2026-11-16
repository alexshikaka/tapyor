// Вкладка «Модули → Оверлей-плейлист» в окне Тапёра (поддельный window.app) + настоящий модуль за мостом.
// Запуск: node tests/overlay/tab.js <папка ядра> <папка для снимков> (нужен Node-пакет playwright).
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = process.argv[2], OUT = process.argv[3];
const modhost = require(path.join(ROOT, 'src', 'modhost.js'));
const uiBuild = require(path.join(ROOT, 'src', 'ui-build.js'));
const handlers = {}, ons = {};
let toPage = null;
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { ons[ch] = fn; } };
const store = { d: {}, get(k) { return this.d[k]; }, set(k, v) { this.d[k] = v; } };
const mounts = new Map();
let port = 0;
const host = modhost.setup({
  app: { getVersion: () => '0.30.1', getPath: () => OUT }, ipcMain, shell: { openExternal() {} },
  safeStorage: { isEncryptionAvailable: () => false }, store, log: (t) => console.log('лог:', t),
  send: (ch, d) => { if (toPage) toPage(ch, d); },
  findOrder: async () => ({ level: 'none' }), checkTrack: () => ({ ok: true }), addRequest() {},
  mount: (p, fn) => mounts.set(p, fn), unmount: (p) => mounts.delete(p), pageUrl: (p) => 'http://127.0.0.1:' + port + p, localCover: async () => null
});
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  for (const [pre, fn] of mounts) if (p === pre || p.startsWith(pre + '/')) { fn(req, res, p.slice(pre.length) || '/', new URL(req.url, 'http://x').searchParams); return; }
  if (p === '/ui.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(uiBuild.buildUi(path.join(ROOT, 'src'))); return; }
  const f = path.join(ROOT, 'src', p === '/' ? 'index.html' : p);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(c, m) { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; }

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
  await host.start();
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.exposeFunction('__modInvoke', async (ch, a, b, c) => handlers[ch](null, a, b, c));
  await pg.exposeFunction('__modSend', async (ch, x) => ons[ch](null, x));
  await pg.addInitScript({ path: path.join(ROOT, 'tests', 'ui', 'mock5.js') });
  await pg.addInitScript(() => {
    const L = {};
    const A = window.app;
    A.modStatus = () => window.__modInvoke('mod-status');
    A.modCmd = (id, cmd, data) => window.__modInvoke('mod-cmd', id, cmd, data);
    A.botCmd = () => Promise.reject(new Error('нет бота'));
    A.modPlayer = (s) => window.__modSend('mod-player', s);
    A.modLevel = (x) => window.__modSend('mod-level', x);
    A.onModPlayerWant = (cb) => { L['mod-player-want'] = cb; };
    A.onModStatus = (cb) => { L['mod-status'] = cb; };
    window.__fromMain = (ch, d) => { if (L[ch]) L[ch](d); };
  });
  toPage = (ch, d) => { pg.evaluate(([c, x]) => window.__fromMain && window.__fromMain(c, x), [ch, d]).catch(() => {}); };
  await pg.goto('http://127.0.0.1:' + port + '/index.html');
  await sleep(4500);                                                     // ovLoad — через 3,6 с после старта
  await pg.click('#tabs [data-tab=settings]'); await sleep(300);
  ok(await pg.evaluate(() => { const b = document.getElementById('goOverlay'); return !!b && !b.hidden && b.offsetParent !== null; }), 'в меню «Модули» есть «Оверлей-плейлист»');
  await pg.click('#goOverlay'); await sleep(1500);
  ok(await pg.evaluate(() => !!document.querySelector('#ovPanel .ov-pos')), 'вкладка нарисована: угол, цвет, список');
  ok(await pg.evaluate(() => (document.getElementById('ovFrame').getAttribute('src') || '').startsWith('/overlay/playlist?preview=1')), 'превью подключено, пока раздел виден');
  // играет трек — окно шлёт снимок, превью показывает его
  await pg.evaluate(() => { queue.length = 0; queue.push({ src: 'ym', id: '1', title: 'Группа крови', author: 'Кино', seconds: 243 }, { src: 'ym', id: '2', title: 'Хочешь?', author: 'Земфира' }, { src: 'ym', id: '3', title: 'Midnight City', author: 'M83' }); current = 0; });
  await sleep(1500);
  const F = () => pg.frames().find((f) => /overlay\/playlist/.test(f.url()));
  ok(!!F(), 'превью открыто');
  await pg.click('#ovPanel [data-ovpos="tl"]'); await sleep(600);
  ok(await F().evaluate(() => document.getElementById('ov').dataset.v === 't' && document.getElementById('ov').dataset.h === 'l'), 'угол «сверху слева» сразу в превью');
  await pg.click('#ovPanel [data-ovc="#33FF66"]'); await sleep(400);
  ok(await F().evaluate(() => getComputedStyle(document.getElementById('ov')).getPropertyValue('--c').trim()) === '#33FF66', 'цвет сразу в превью');
  await pg.click('#ovPanel [data-ovv="count"][data-val="10"]'); await sleep(400);
  ok((await pg.evaluate(() => window.__modInvoke('mod-cmd', 'overlay', 'settings'))).count === 10, 'до 10 песен сохраняется');
  await pg.click('#ovPanel [data-ovp="demo"][data-val="1"]'); await sleep(900);
  ok(await pg.evaluate(() => /demo=1/.test(document.getElementById('ovFrame').getAttribute('src'))), 'демо-трек');
  ok(await F().evaluate(() => !document.getElementById('ov').hidden && document.getElementById('queue').children.length === 10), 'в превью демо-трек и 10 строк');
  await pg.click('#ovPanel [data-ovp="view"][data-val="ph"]'); await sleep(300);
  ok(await pg.evaluate(() => document.getElementById('ovStage').style.width === '780px'), 'вид «телефон гориз.» — 780 px');
  await pg.click('#ovPanel [data-ovp="view"][data-val="mon"]'); await sleep(300);
  await pg.click('#ovPanel [data-ovpos="br"]'); await sleep(800);
  const st = await pg.$('#ovPanel');
  await pg.evaluate(() => document.getElementById('sOverlay').scrollIntoView());
  await sleep(500);
  await pg.screenshot({ path: path.join(OUT, 'tab.png') });
  await pg.evaluate(() => document.querySelector('#ovPanel [data-ovt="fill"]').scrollIntoView({ block: 'end' })); await sleep(700);
  await pg.screenshot({ path: path.join(OUT, 'tab-prev.png') });
  // ушли в другой раздел — превью отключается
  await pg.click('#tabs [data-tab=search]'); await sleep(800);
  ok(await pg.evaluate(() => document.getElementById('ovFrame').getAttribute('src') === 'about:blank'), 'ушли из настроек — превью отключено');
  console.log('ошибки:', JSON.stringify(errs));
  ok(!errs.length, 'без ошибок страницы');
  await browser.close(); await host.stop(); server.close(); process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
