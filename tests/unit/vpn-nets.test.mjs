// Список сетей Яндекса для исключения из VPN-туннеля (src/vpn-nets.js).
// Зачем тест: список показывается клиентам в настройках и копируется в их VPN-клиент.
// Если в нём окажется мусор или пропадёт ключевая сеть — музыка снова начнёт «думать».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NETS, LINE } = require('../../src/vpn-nets.js');

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

test('vpn-nets: каждая запись — корректная IPv4-подсеть', () => {
  assert.ok(NETS.length > 20, 'сетей слишком мало');
  for (const n of NETS) {
    const m = V4.exec(n);
    assert.ok(m, 'не IPv4-подсеть: ' + n);
    for (let i = 1; i <= 4; i++) {
      const o = Number(m[i]);
      assert.ok(o >= 0 && o <= 255, 'октет вне диапазона: ' + n);
    }
    const p = Number(m[5]);
    assert.ok(p >= 1 && p <= 32, 'маска вне диапазона: ' + n);
  }
});

test('vpn-nets: без дублей и без пересечений', () => {
  const seen = new Set();
  for (const n of NETS) assert.ok(!seen.has(n) && seen.add(n), 'дубль: ' + n);
  // пересечения считаем по сети/маске: 87.250.224.0/19 и 87.250.224.0/19 — дубль, уже отсечён
  assert.equal(seen.size, NETS.length);
});

test('vpn-nets: ключевые сети Яндекса на месте', () => {
  for (const must of ['87.250.224.0/19', '77.88.0.0/18', '213.180.192.0/19', '100.43.64.0/19', '5.45.192.0/18', '178.176.128.0/18']) {
    assert.ok(NETS.includes(must), 'пропала сеть ' + must);
  }
});

test('vpn-nets: строка собирается из массива и влезает в поле VPN-клиента', () => {
  assert.equal(LINE, NETS.join(', '));
  assert.ok(LINE.length > 100 && LINE.length < 4000, 'неожиданная длина строки: ' + LINE.length);
  assert.ok(!LINE.includes('\n'), 'в строке не должно быть переводов строк');
});

// --- нормализация и склейка (используются живым списком из RIPE) ---

test('vpn-nets: clean отбрасывает мусор и дубли', () => {
  const { clean } = require('../../src/vpn-nets.js');
  const out = clean(['1.2.3.0/24', '1.2.3.0/24', '1.2.3.4', '999.1.1.1/24', '1.2.3.0/33', '', null]);
  assert.deepEqual(out, ['1.2.3.0/24']);
});

test('vpn-nets: clean сортирует по адресу', () => {
  const { clean } = require('../../src/vpn-nets.js');
  assert.deepEqual(clean(['10.0.2.0/24', '2.0.0.0/8', '10.0.1.0/24']), ['2.0.0.0/8', '10.0.1.0/24', '10.0.2.0/24']);
});

test('vpn-nets: collapse склеивает соседние и поглощает вложенные', () => {
  const { collapse } = require('../../src/vpn-nets.js');
  assert.deepEqual(collapse(['10.0.0.0/24', '10.0.1.0/24']), ['10.0.0.0/23']);
  assert.deepEqual(collapse(['10.0.0.0/8', '10.1.0.0/16']), ['10.0.0.0/8']);
  assert.deepEqual(collapse(['1.1.1.1/32', '1.1.1.0/24']), ['1.1.1.0/24']);
});

test('vpn-nets: вшитый список уже склеен (никто не вложен в другого)', () => {
  const { collapse } = require('../../src/vpn-nets.js');
  assert.deepEqual(collapse(NETS), NETS);
});

// --- 11.11: чужие сети (DENY) не возвращаются ни из RIPE, ни из старого кэша ---
const inAny = (nets, ip) => {
  const { clean } = require('../../src/vpn-nets.js');
  const n = (s) => s.split('.').map(Number).reduce((a, x) => a * 256 + x, 0);
  return clean(nets).some((c) => { const [a, p] = c.split('/'); const s = n(a), e = s + 2 ** (32 - +p) - 1; return n(ip) >= s && n(ip) <= e; });
};

test('vpn-nets: DENY — чужих сетей нет во встроенном списке', () => {
  const { NETS, DENY } = require('../../src/vpn-nets.js');
  for (const d of DENY) assert.ok(!inAny(NETS, d.split('/')[0]), 'во встроенном списке чужая сеть ' + d);
});

test('vpn-nets: withoutDeny — совпадающая и вложенная чужая сеть пропадают, Яндекс остаётся', () => {
  const { withoutDeny } = require('../../src/vpn-nets.js');
  const out = withoutDeny(['87.250.224.0/19', '195.133.64.0/19', '176.123.178.0/24', '77.88.0.0/18']);
  assert.ok(inAny(out, '87.250.224.1') && inAny(out, '77.88.0.1'), 'пропал Яндекс');
  assert.ok(!inAny(out, '195.133.64.1') && !inAny(out, '195.133.95.254'), 'осталась Timeweb');
  assert.ok(!inAny(out, '176.123.178.5'), 'осталась вложенная VK Tech');
});

test('vpn-nets: withoutDeny — из широкой сети вырезается только чужой кусок', () => {
  const { withoutDeny } = require('../../src/vpn-nets.js');
  const out = withoutDeny(['176.123.176.0/20']);
  assert.ok(!inAny(out, '176.123.178.1') && !inAny(out, '176.123.179.254'), 'чужой кусок не вырезан');
  assert.ok(inAny(out, '176.123.176.1') && inAny(out, '176.123.180.1') && inAny(out, '176.123.191.254'), 'вырезано лишнее');
});

test('vpn-nets-live: старый кэш с чужими сетями вычищается при чтении', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const live = require('../../src/vpn-nets-live.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpnnets-'));
  fs.writeFileSync(live.cacheFile(dir), JSON.stringify({ at: Date.now(), nets: ['87.250.224.0/19', '195.133.64.0/19', '176.123.178.0/23'] }));
  const c = live.readCache(dir);
  assert.ok(c && inAny(c.nets, '87.250.224.1'));
  assert.ok(!inAny(c.nets, '195.133.70.1') && !inAny(c.nets, '176.123.178.1'));
  const r = await live.load(dir); // свежий кэш — без похода в сеть
  assert.equal(r.source, 'cache'); assert.ok(!inAny(r.nets, '195.133.70.1'));
  fs.rmSync(dir, { recursive: true, force: true });
});
