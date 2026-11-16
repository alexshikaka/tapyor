// Страж брошенного кода (стабилизация, A3/A4).
// Брошенные и спрятанные функции удаляются (решение владельца, раздел 7 STABILIZATION.md).
// Проверка не даёт им вернуться незаметно: ищет слова в src/ и удалённые методы моста в preload.js.
// src/vendor — сторонняя библиотека, её не проверяем. src/ui.js — собранная копия src/ui/*.js
// (генерируется `npm test`), поэтому отдельно её не сканируем: источник и так проверен.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(SRC, full).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      if (rel === 'vendor') continue;
      walk(full, out);
    } else if (/\.(js|mjs|cjs|html|css)$/i.test(ent.name) && rel !== 'ui.js') {
      out.push({ file: 'src/' + rel, text: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
}
const FILES = walk(SRC);

// Слово ищем без учёта регистра. Для `yoo` достаточно начала слова: так находятся и `yooLogin`,
// и `YOO_PORT`, и ключ `'yoo'`, а обычных английских слов, начинающихся с «yoo», в src нет.
const FORBIDDEN = [
  { name: 'yoomoney', re: /yoomoney/i, hint: 'файл yoomoney.json и вход в ЮMoney' },
  { name: 'yoo (отдельное имя)', re: /\byoo/i, hint: 'yooLogin, YOO_PORT, yooWallet, yooRow…' },
  { name: 'donatello', re: /donatello/i, hint: 'сервис донатов Donatello и его API' },
  { name: 'showTelegram', re: /showTelegram/, hint: 'скрытая настройка вкладки Telegram' },
  { name: 'persist:telegram', re: /persist:telegram/, hint: 'отдельная партиция webview Telegram' }
];

function linesWith(text, re) {
  return text.split(/\r?\n/).map((l, i) => ({ n: i + 1, l })).filter((x) => re.test(x.l));
}

// G4: ссылки поддержки автора — это донатная ссылка на ЮMoney, а не вернувшийся вход в ЮMoney
// (файл yoomoney.json и методы yooLogin/YOO_PORT остаются запрещены). Разрешаем ровно эти строки
// и только в перечисленных файлах: любое другое упоминание yoo* по-прежнему считается следом.
const YOO_SUPPORT_ALLOW = {
  'src/index.html': (l) => l.includes('data-about="yoomoney"'),
  'src/ui/28-about.js': (l) => l.includes("yoomoney: 'https://yoomoney.ru/to/410011529262377'"),
  'src/open-external.js': (l) => l.includes('donationalerts\\.com|yoomoney\\.ru')
};
function supportAllowed(file, line) {
  const f = YOO_SUPPORT_ALLOW[file];
  return !!(f && f(line));
}

test('в src/ не осталось следов брошенного', () => {
  const hits = [];
  for (const f of FILES) {
    for (const t of FORBIDDEN) {
      if (!t.re.test(f.text)) continue;
      for (const x of linesWith(f.text, t.re)) {
        if (supportAllowed(f.file, x.l)) continue;
        hits.push(f.file + ':' + x.n + ' — ' + t.name + ' (' + t.hint + ')');
      }
    }
  }
  assert.deepEqual(hits, [], 'найдены следы удалённого:\n' + hits.join('\n'));
});

// Методы моста, удалённые вместе с функциями. Если имя осталось в preload.js, окно снова
// получит доступ к каналу, которого в главном процессе уже нет.
const DEAD_BRIDGE = ['donYooLogin', 'donYooCancel', 'donYooCode', 'sbotKeyGet', 'ymCreatePlaylist', 'packInstallFile'];

test('в src/preload.js нет методов моста удалённых функций', () => {
  const preload = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8');
  for (const name of DEAD_BRIDGE) assert.ok(!preload.includes(name), 'остался метод моста: ' + name);
});

// Каналы IPC, у которых не было ни одного вызывающего. Обработчик без вызова — мёртвый код,
// но главное: канал остаётся доступен любой странице с мостом.
const DEAD_CHANNELS = ['report-send', 'get-log', 'sbot-key-get', 'ym-create-playlist', 'pack-install-file'];

test('в src/ не осталось обработчиков мёртвых каналов IPC', () => {
  const hits = [];
  for (const f of FILES) {
    for (const ch of DEAD_CHANNELS) {
      if (f.text.includes("ipcMain.handle('" + ch + "'") || f.text.includes('ipcMain.handle("' + ch + '"')) hits.push(f.file + ' — ' + ch);
    }
  }
  assert.deepEqual(hits, [], 'остались обработчики:\n' + hits.join('\n'));
});

// Ключи донатов лежат одной зашифрованной «полкой» donKeys. Если у человека остался старый
// вход ЮMoney, чтение DonationAlerts и DonatePay обязано продолжиться (данные не мигрируем).
test('старый ключ ЮMoney в donKeys не мешает читать другие сервисы донатов', () => {
  const orig = Module._load;
  Module._load = function (r, ...a) {
    if (r === 'electron') return { shell: {}, safeStorage: { isEncryptionAvailable: () => false } };
    return orig.call(this, r, ...a);
  };
  let donations;
  try { donations = require('../../src/donations.js'); } finally { Module._load = orig; }

  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  const store = {
    donKeys: {
      yoo: b64({ at: 'старый-токен' }), // остался у пользователя от прежней версии
      da: b64({ at: 'tok', rt: 'refresh', exp: Date.now() + 3600 * 1000 }),
      dp: b64({ key: 'ключ' })
    }
  };
  donations.setup({ log: () => {}, store: { get: (k) => store[k], set: (k, v) => { store[k] = v; } } });
  const st = donations.status();
  assert.equal(st.da.connected, true, 'DonationAlerts должен читаться');
  assert.equal(st.dp.connected, true, 'DonatePay должен читаться');
  assert.equal(st.yoo, undefined, 'ЮMoney больше не сервис донатов');
});
