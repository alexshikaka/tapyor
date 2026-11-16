// Проверка оверлея целиком: настоящий хозяин модулей (modhost.js) + настоящий модуль + страница в Chromium.
// Запуск: node tests/overlay/page.js <папка ядра> <папка для снимков> (нужен Node-пакет playwright). Гоняет Claude в облаке.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = process.argv[2];                 // .../Tapyor-player
const OUT = process.argv[3];
const modhost = require(path.join(ROOT, 'src', 'modhost.js'));

const handlers = {}, ons = {}, sent = [];
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { ons[ch] = fn; } };
const store = { d: {}, get(k) { return this.d[k]; }, set(k, v) { this.d[k] = v; } };
const mounts = new Map();
let port = 0;
const host = modhost.setup({
  app: { getVersion: () => require(path.join(ROOT, 'package.json')).version, getPath: () => OUT },
  ipcMain, shell: { openExternal() {} }, safeStorage: { isEncryptionAvailable: () => false }, store,
  log: (t) => console.log('лог:', t), send: (ch, d) => sent.push([ch, d]),
  findOrder: async () => ({ level: 'none' }), checkTrack: () => ({ ok: true }), addRequest() {},
  mount: (p, fn) => mounts.set(p, fn), unmount: (p) => mounts.delete(p), pageUrl: (p) => 'http://127.0.0.1:' + port + p,
  localCover: async () => null
});

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  for (const [pre, fn] of mounts) {
    if (p === pre || p.startsWith(pre + '/')) { res.setHeader('Content-Security-Policy', require(path.join(ROOT, 'src', 'localguard.js')).MOD_PAGE_CSP); fn(req, res, p.slice(pre.length) || '/', new URL(req.url, 'http://x').searchParams); return; }
  }
  const f = path.join(ROOT, 'src', p);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : 'font/woff2' }); res.end(d); });
});

const SNAP = (over = {}) => ({
  np: { title: 'Группа крови', artist: 'Кино', cover: '', pos: 92, dur: 243, playing: true, at: Date.now(), ...over },
  next: [{ title: 'Хочешь?', artist: 'Земфира' }, { title: 'Midnight City', artist: 'M83' }, { title: 'Выхода нет', artist: 'Сплин' }],
  after: [['Instant Crush', 'Daft Punk'], ['Владивосток 2000', 'Мумий Тролль'], ['Heat Waves', 'Glass Animals'], ['Последний герой', 'Кино'], ['Dreams', 'Fleetwood Mac'], ['Genesis', 'Grimes'], ['Знаешь ли ты', 'МакSим']].map((x) => ({ title: x[0], artist: x[1] }))
});
const cmd = (c, d) => handlers['mod-cmd'](null, 'overlay', c, d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  await host.start();
  const st = host.status();
  console.log('модули:', JSON.stringify(st.modules));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/overlay/playlist');
  await sleep(300);
  console.log('после подключения OBS:', JSON.stringify(sent.filter((x) => x[0] === 'mod-player-want').pop()), 'статус:', JSON.stringify(await cmd('status')));
  // фон-шахматка только для снимков; через CSSOM — строгий CSP страницы (TAP-15) запрещает встроенные <style>
  await page.evaluate(() => { const b = document.body.style; b.setProperty('background-color', '#2B2C30', 'important'); b.setProperty('background-image', 'conic-gradient(#3A3B40 25%,#2B2C30 0 50%,#3A3B40 0 75%,#2B2C30 0)', 'important'); b.setProperty('background-size', '48px 48px', 'important'); });
  ons['mod-player'](null, SNAP());
  const lv = setInterval(() => ons['mod-level'](null, Math.random()), 90);

  const cases = [
    ['br', {}, {}],
    ['tl10', { pos: 'tl', count: 10, color: '#33FF66' }, {}],
    ['bc-nocover', { pos: 'bc', count: 2, color: '#E8E8E8', cover: true }, {}],
    ['br-paused', { pos: 'br', count: 3, color: '#FFB000' }, { playing: false }],
    ['tr-long-ru', { pos: 'tr', count: 3, lang: 'ru', color: '#4FD8FF' }, { title: 'Владивосток 2000 (Remastered Live Version)', artist: 'Мумий Тролль' }],
    ['bl-0', { pos: 'bl', count: 0, color: '#FF5FA2', lang: 'en' }, {}]
  ];
  for (const [name, cfg, np] of cases) {
    await cmd('reset');
    await cmd('save', cfg);
    ons['mod-player'](null, SNAP(np));
    await sleep(1200);
    const box = await page.$eval('#ov', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const clip = { x: Math.max(0, box.x - 200), y: Math.max(0, box.y - 30), width: Math.min(1920, box.w + 400), height: box.h + 60 };
    clip.width = Math.min(clip.width, 1920 - clip.x); clip.height = Math.min(clip.height, 1080 - clip.y);
    await page.screenshot({ path: path.join(OUT, name + '.png'), clip });
    const info = await page.evaluate(() => ({
      status: document.getElementById('sline').textContent, mq: document.getElementById('tval').classList.contains('mq'),
      rows: document.querySelectorAll('#queue div').length, hidden: document.getElementById('ov').hidden,
      title: document.getElementById('labT').textContent + document.getElementById('tval').textContent.slice(0, 40)
    }));
    console.log(name, JSON.stringify(box), JSON.stringify(info));
  }
  // вертушка: ширина строки статуса не меняется между фазами
  await cmd('reset');
  ons['mod-player'](null, SNAP());
  const widths = [];
  for (let i = 0; i < 8; i++) { widths.push(await page.$eval('#sline', (e) => [...e.children].map((c) => c.getBoundingClientRect().x.toFixed(1)).join(','))); await sleep(150); }
  console.log('позиции знаков времени по фазам вертушки одинаковые:', new Set(widths.map((w) => w.split(',').slice(2).join(','))).size === 1);
  // ничего не играет — оверлея нет
  ons['mod-player'](null, { np: null, next: [], after: [] }); await sleep(300);
  console.log('ничего не играет → скрыт:', await page.$eval('#ov', (e) => e.hidden));
  // демо и превью
  const p2 = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await p2.goto('http://127.0.0.1:' + port + '/overlay/playlist?preview=1&demo=1&paused=1'); await sleep(600);
  console.log('демо-превью:', await p2.$eval('#sline', (e) => e.textContent), 'статус (превью не OBS):', JSON.stringify(await cmd('status')));
  // POST на страницу модуля — модуль его не получит (в ядре 405), а у модуля нет команд
  clearInterval(lv);
  console.log('ошибки страницы:', JSON.stringify(errs));
  await browser.close(); await host.stop(); server.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
