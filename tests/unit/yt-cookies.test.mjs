// M-01: cookies YouTube для yt-dlp — временный файл на вызов, после вызова удаляется,
// обновлённые yt-dlp значения подхватываются следующим вызовом (только в памяти).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { BrowserWindow: function () {}, session: {}, safeStorage: { isEncryptionAvailable: () => false } };
  return origLoad.call(this, req, ...rest);
};
const ytauth = require('../../src/ytauth.js');
Module._load = origLoad;

const enc = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
function setupWith(cookies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytck-'));
  const st = { ytCookies: cookies ? enc({ cookies }) : null };
  ytauth.setup({ log: () => {}, store: { get: (k) => st[k], set: (k, v) => { st[k] = v; } }, tmpDir: dir });
  return dir;
}
const C = [{ name: 'SID', value: 'aaa' }, { name: '__Secure-3PAPISID', value: 'bbb' }, { name: 'bad', value: 'x\ty' }];

test('нет входа — нет файла', () => {
  setupWith(null);
  assert.equal(ytauth.hasCookies(), false);
  assert.equal(ytauth.tempCookieFile(), null);
});

test('временный файл: свой на вызов, удаляется после done(), значения с \\t не пишутся', () => {
  const dir = setupWith(C);
  const a = ytauth.tempCookieFile(), b = ytauth.tempCookieFile();
  assert.notEqual(a.file, b.file);
  assert.ok(fs.existsSync(a.file));
  const txt = fs.readFileSync(a.file, 'utf8');
  assert.match(txt, /\tSID\taaa/);
  assert.doesNotMatch(txt, /\tbad\t/);
  a.done(); b.done();
  assert.equal(fs.readdirSync(dir).length, 0);
});

test('yt-dlp обновил cookie — следующий вызов берёт новое значение', () => {
  setupWith(C);
  const a = ytauth.tempCookieFile();
  fs.writeFileSync(a.file, fs.readFileSync(a.file, 'utf8').replace('\tSID\taaa', '\tSID\tnew1'));
  a.done();
  const b = ytauth.tempCookieFile();
  assert.match(fs.readFileSync(b.file, 'utf8'), /\tSID\tnew1/);
  b.done();
});

test('при запуске старые временные файлы подчищаются', () => {
  const dir = setupWith(C);
  fs.writeFileSync(path.join(dir, 'tapyor-yt-0123456789ab.txt'), 'old');
  fs.writeFileSync(path.join(dir, 'other.txt'), 'keep');
  ytauth.setup({ tmpDir: dir });
  assert.deepEqual(fs.readdirSync(dir), ['other.txt']);
});
