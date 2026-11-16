// R6, часть 2: молчаливые потери должны попадать в журнал.
// Здесь — представители чистых модулей: заказы (копия .bak), отчёт заказов,
// перезапись копий настроек, копия перед отладкой и расшифровка секрета модуля.
// Без правки журнал пуст — эти проверки падали.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const reqStore = require('../../src/requests-store.js');
const report = require('../../src/order-report.js');
const debugReset = require('../../src/debug-reset.js');
const debugBackup = require('../../src/debug-backup.js');
const { makeSecure } = require('../../src/modhost.js');

function tmpdir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-r6-'));
  t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  return d;
}

test('заказы: неудачная копия .bak попадает в журнал', (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'requests.json');
  const logs = [];
  fs.writeFileSync(file, '[]', 'utf8');
  fs.mkdirSync(file + '.bak'); // копирование файла поверх папки невозможно → сбой
  assert.equal(reqStore.save(file, [{ key: 'da:1' }], { log: (m) => logs.push(String(m)) }), true);
  assert.ok(logs.some((m) => /копия \.bak не сделана/.test(m)), 'журнал: ' + JSON.stringify(logs));
});

test('отчёт заказов: файл не создан — запись в журнале', (t) => {
  const dir = tmpdir(t);
  const asFile = path.join(dir, 'not-a-dir');
  fs.writeFileSync(asFile, 'x', 'utf8');
  const logs = [];
  report.setup({ file: path.join(asFile, 'orders.jsonl'), log: (m) => logs.push(String(m)) });
  report.finish(report.begin({ prov: 'test', id: '1' }), null);
  assert.ok(logs.some((m) => /orders-report: файл не создан/.test(m)), 'журнал: ' + JSON.stringify(logs));
});

test('сброс настроек: неудачная перезапись копии попадает в журнал', (t) => {
  const dir = tmpdir(t);
  const settings = path.join(dir, 'settings.json');
  const bak = settings + '.bak';
  fs.mkdirSync(bak); // копия — папка, писать в неё нельзя
  const logs = [];
  const n = debugReset.rewriteBackups(settings, { a: 1 }, (m) => logs.push(String(m)));
  assert.equal(n, 0);
  assert.ok(logs.some((m) => /копия настроек «settings\.json\.bak» не переписана/.test(m)), 'журнал: ' + JSON.stringify(logs));
});

test('копия перед отладкой: файл не скопирован — запись в журнале', async (t) => {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, 'settings.json')); // источник — папка, copyFileSync не сможет
  const logs = [];
  debugBackup.setup({ userData: dir, appVersion: '0.0.0', now: () => new Date(), readReg: async () => ({ ok: false, value: '' }), log: (m) => logs.push(String(m)) });
  const snap = await debugBackup.snapshot('settings');
  assert.equal(snap.ok, true);
  assert.ok(logs.some((m) => /файл копии «settings\.json» не скопирован/.test(m)), 'журнал: ' + JSON.stringify(logs));
});

test('секрет модуля не расшифровался — запись в журнале', async () => {
  const store = { get: () => Buffer.from('не наше').toString('base64'), set: () => {} };
  const ss = { isEncryptionAvailable: () => true, decryptString: () => { throw new Error('bad key'); } };
  const logs = [];
  const sec = makeSecure(store, ss, 'bot', (m) => logs.push(String(m)));
  assert.equal(await sec.get('twitch.token'), null);
  assert.ok(logs.some((m) => /секрет «bot» не расшифрован/.test(m)), 'журнал: ' + JSON.stringify(logs));
});
