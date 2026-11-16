// RM3: мост ядра для «Пульта с телефона» (src/main/remote-bridge.js) без Electron.
// Поддельные узел второй панели и локальный сервер: лента, зрители, нажатия и настройки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bridgeModule = require(path.join(ROOT, 'src', 'main', 'remote-bridge.js'));

function makeBridge(extra = {}) {
  const docked = new Map();
  const hub = {
    forModule(id) {
      if (!docked.has(id)) docked.set(id, { id, on() {}, want() {}, cmd() { return { ok: true }; } });
      return docked.get(id);
    }
  };
  let state = { orders: [], msgCount: 0, reqAuto: false };
  const fns = new Set();
  const sent = [];
  const settings = [];
  const extraCounts = [];
  const widget = {
    widgetState: () => state,
    onWidgetState(fn) { fns.add(fn); return () => fns.delete(fn); },
    setWidgetExtra(n) { extraCounts.push(n); },
    widgetSend(ch, data) { sent.push({ ch, data }); },
    widgetSetting(key, value) {
      if (key !== 'reqAuto') return false;
      settings.push({ key, value });
      return true;
    }
  };
  widget.pushState = (next) => { state = next; for (const fn of fns) fn(state); };
  const logs = [];
  const bridge = bridgeModule.create({ hub, widget, log: (x) => logs.push(String(x)), ...extra });
  return { bridge, hub, widget, sent, settings, extraCounts, logs, fns, pushState: widget.pushState };
}

test('dock — ровно hub.forModule(id)', () => {
  const { bridge, hub } = makeBridge();
  const m = bridge.forModule('remote');
  assert.equal(m.dock, hub.forModule('remote'));
});

test('feed.on: сразу последнее состояние и обновления, отписка работает', () => {
  const { bridge, pushState } = makeBridge();
  const feed = bridge.forModule('remote').feed;
  const got = [];
  const off = feed.on((st) => got.push(st));
  assert.equal(got.length, 1, 'сразу отдан последний widgetState');
  assert.equal(got[0].reqAuto, false);

  pushState({ reqAuto: true, msgCount: 3 });
  assert.equal(got.length, 2);
  assert.equal(got[1].msgCount, 3);
  off();
  pushState({ reqAuto: false, msgCount: 4 });
  assert.equal(got.length, 2, 'после отписки fn больше не зовут');
});

test('feed.want: каждый модуль со want(true) — +1 зритель первой панели', () => {
  const { bridge, extraCounts } = makeBridge();
  const a = bridge.forModule('remote').feed;
  const b = bridge.forModule('other').feed;
  a.want(true);
  assert.equal(extraCounts.at(-1), 1);
  b.want(true);
  assert.equal(extraCounts.at(-1), 2);
  a.want(true);   // повтор не удваивает
  assert.equal(extraCounts.at(-1), 2);
  a.want(false);
  assert.equal(extraCounts.at(-1), 1);
  b.want(false);
  assert.equal(extraCounts.at(-1), 0);
  assert.equal(bridge.wanters(), 0);
});

test('feed.rq: разрешённые нажатия ленты уходят в окно без поднятия', () => {
  const { bridge, sent } = makeBridge();
  const feed = bridge.forModule('remote').feed;
  for (const rq of ['add', 'now', 'alts', 'link', 'skip', 'reparse']) {
    const r = feed.rq({ rq, ri: '3', id: 'r3' });
    assert.deepEqual(r, { ok: true }, rq);
  }
  assert.equal(sent.length, 6);
  assert.deepEqual(sent[0].data, { dataset: { rq: 'add', ri: '3', id: 'r3' }, focus: false });
  assert.equal(sent[0].ch, 'widget-rq');
});

test('feed.rq: find/textfind/settings, мусор и длинные значения — отказ', () => {
  const { bridge, sent } = makeBridge();
  const feed = bridge.forModule('remote').feed;
  const bad = [
    null, undefined, 'add', [], {},
    { rq: 'find', ri: '1' },
    { rq: 'textfind', ri: '1' },
    { rq: 'settings' },
    { rq: 'return', id: '1' },
    { rq: 'nope' },
    { rq: '' },
    { rq: 'add', ri: 3 },
    { rq: 'add', id: 'x'.repeat(81) },
    { rq: 'add', extra: '1' },
    { rq: 'add', ri: '1', key: 'ym:1' }
  ];
  for (const v of bad) {
    const r = feed.rq(v);
    assert.equal(r.ok, false, JSON.stringify(v));
  }
  assert.equal(sent.length, 0, 'отказ ничего не отправляет в окно');
});

test('feed.setting: только разрешённые ключи (как POST /widget/setting)', () => {
  const { bridge, settings } = makeBridge();
  const feed = bridge.forModule('remote').feed;
  assert.deepEqual(feed.setting('reqAuto', true), { ok: true });
  assert.deepEqual(settings, [{ key: 'reqAuto', value: true }]);
  assert.deepEqual(feed.setting('theme', '#000'), { ok: false });
  assert.equal(settings.length, 1, 'запрещённый ключ не сохраняется');
  assert.equal(feed.setting('', true).ok, false);
  assert.equal(feed.setting(null, true).ok, false);
});

test('qr: SVG-строка qrcode-svg — <svg, масштабируется (viewBox), без <?xml', () => {
  const { bridge } = makeBridge();
  const svg = bridge.forModule('remote').qr('https://example.com/remote/#abc');
  assert.equal(typeof svg, 'string');
  assert.ok(svg.startsWith('<svg'), 'начинается с <svg');
  assert.ok(!/^<\?xml/i.test(svg), 'без <?xml');
  // 16.11: окно ужимает код до 220 px — корневой <svg> обязан масштабироваться (viewBox, без жёстких width/height),
  // иначе край кода обрезается и телефон его не читает.
  const root = svg.slice(0, svg.indexOf('>') + 1);
  assert.ok(/viewBox="0 0 256 256"/.test(root), 'у корня есть viewBox');
  assert.ok(!/\swidth=/.test(root) && !/\sheight=/.test(root), 'у корня нет жёсткого размера');
  assert.ok(svg.includes('</svg>'));
});

test('qr: подменённый qrSvg (для проверок без библиотеки)', () => {
  const { bridge } = makeBridge({ qrSvg: (t) => '<svg data-t="' + t + '"></svg>' });
  assert.equal(bridge.forModule('remote').qr('x'), '<svg data-t="x"></svg>');
});

test('локальный сервер: onWidgetState, setWidgetExtra и общие widgetSend/widgetSetting', () => {
  const localGuard = require(path.join(ROOT, 'src', 'localguard.js'));
  const localServer = require(path.join(ROOT, 'src', 'main', 'local-server.js'));
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, data) => sent.push({ ch, data }) } };
  let saved = null;
  const host = localServer.setup({
    fs, path, localGuard, perf: { overlayPeak: 0 }, srcDir: path.join(ROOT, 'src'),
    getMainWindow: () => win,
    readSettingsFile: () => ({ reqAuto: false, theme: 'dark' }),
    writeSettingsFile: (s) => { saved = s; }
  });

  const got = [];
  const off = host.onWidgetState((st) => got.push(st));
  host.setWidgetState({ reqAuto: true, msgCount: 2 });
  host.widgetBroadcast();
  assert.equal(got.length, 1);
  assert.equal(got[0].msgCount, 2);
  off();
  host.widgetBroadcast();
  assert.equal(got.length, 1, 'после отписки не зовут');

  host.setWidgetExtra(2);
  let last = sent.filter((x) => x.ch === 'widget-clients').at(-1);
  assert.equal(last.data, 2, 'зрители модуля прибавляются к клиентам /widget');
  host.setWidgetExtra(0);
  last = sent.filter((x) => x.ch === 'widget-clients').at(-1);
  assert.equal(last.data, 0);

  host.widgetSend('widget-rq', { dataset: { rq: 'add' }, focus: false });
  assert.deepEqual(sent.at(-1), { ch: 'widget-rq', data: { dataset: { rq: 'add' }, focus: false } });

  assert.equal(host.widgetSetting('reqAuto', true), true);
  assert.equal(saved.reqAuto, true);
  assert.deepEqual(sent.at(-1), { ch: 'widget-setting', data: { key: 'reqAuto', value: true } });
  assert.equal(host.widgetSetting('theme', 'light'), false, 'ключ не из белого списка не пишется');
  assert.equal(saved.theme, 'dark');
});

test('relays: адреса облака пульта из ядра, только https (16.11)', () => {
  const { create } = require('../../src/main/remote-bridge.js');
  const b = create({ relays: ['https://functions.example/a', 'http://plain', 5, 'https://functions.example/b'] });
  assert.deepEqual(b.forModule('remote').relays, ['https://functions.example/a', 'https://functions.example/b']);
  assert.deepEqual(create({}).forModule('remote').relays, []);
});
