// 0.34.0, задание 4: автокопии перед отладочными сбросами.
// Только временные папки в os.tmpdir(), реестр подменяется readReg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const backup = require('../../src/debug-backup.js');

const made = [];
function tmpRoot(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-unit-backup-' + tag + '-'));
  made.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
});
function write(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function fillUserData(ud) {
  write(path.join(ud, 'settings.json'), '{"theme":"violet","modLicenses":{"streamer-pack":["tpl1.a.b"]}}');
  write(path.join(ud, 'settings.json.bak'), '{"old":1}');
  write(path.join(ud, 'settings.json.bak.2'), '{"old":2}');
  write(path.join(ud, 'today.json'), '{"day":"2026-11-12","items":[{"id":"t"}],"current":0}');
  write(path.join(ud, 'lic-clock.dat'), '1762800000000');
  write(path.join(ud, 'requests.json'), '{"requests":[]}');
}

test('snapshot копирует нужные файлы, реестр и meta', async () => {
  const ud = tmpRoot('snap');
  fillUserData(ud);
  backup.setup({ userData: ud, appVersion: '0.33.1', readReg: async () => ({ ok: true, value: '123456' }) });
  const r = await backup.snapshot('settings');
  assert.equal(r.ok, true);
  assert.match(r.id, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-settings$/);
  const dir = path.join(ud, 'debug-backups', r.id);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json.bak'), 'utf8'), '{"old":1}');
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json.bak.2'), 'utf8'), '{"old":2}');
  assert.equal(fs.readFileSync(path.join(dir, 'today.json'), 'utf8'), fs.readFileSync(path.join(ud, 'today.json'), 'utf8'),
    'очередь с позицией (today.json) входит в копию — иначе после «Вернуть» она не вернётся');
  assert.equal(fs.readFileSync(path.join(dir, 'lic-clock.dat'), 'utf8'), '1762800000000');
  assert.equal(fs.readFileSync(path.join(dir, 'requests.json'), 'utf8'), '{"requests":[]}');
  assert.equal(fs.readFileSync(path.join(dir, 'registry-lcm.txt'), 'utf8'), '123456');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.kind, 'settings');
  assert.equal(meta.version, '0.33.1');
  assert.equal(meta.registryRead, true);
  assert.ok(meta.files.includes('today.json'), 'today.json записан в список файлов копии');
  assert.ok(meta.at > 0);
  const list = backup.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, r.id);
  assert.equal(list[0].kind, 'settings');
});

test('snapshot вида «кодировка» принимается (0.34.0, исправление плейлистов)', async () => {
  const ud = tmpRoot('encoding');
  fillUserData(ud);
  backup.setup({ userData: ud, appVersion: '0.34.0', readReg: async () => ({ ok: true, value: '1' }) });
  const r = await backup.snapshot('encoding');
  assert.equal(r.ok, true);
  assert.match(r.id, /-encoding$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ud, 'debug-backups', r.id, 'meta.json'), 'utf8')).kind, 'encoding');
});

test('реестр недоступен — в копии «не прочитано», restore не отдаёт значение', async () => {
  const ud = tmpRoot('reg');
  fillUserData(ud);
  backup.setup({ userData: ud, appVersion: '0.33.1', readReg: async () => ({ ok: false, value: '' }) });
  const r = await backup.snapshot('license');
  const dir = path.join(ud, 'debug-backups', r.id);
  assert.equal(fs.readFileSync(path.join(dir, 'registry-lcm.txt'), 'utf8'), 'не прочитано');
  const rr = backup.restore(r.id);
  assert.equal(rr.registry, null);
});

test('restore возвращает файлы байт-в-байт и убирает лишние .bak', async () => {
  const ud = tmpRoot('restore');
  fillUserData(ud);
  backup.setup({ userData: ud, appVersion: '0.33.1', readReg: async () => ({ ok: true, value: '77' }) });
  const r = await backup.snapshot('settings');
  const snapSettings = fs.readFileSync(path.join(ud, 'debug-backups', r.id, 'settings.json'));
  const snapBak = fs.readFileSync(path.join(ud, 'debug-backups', r.id, 'settings.json.bak'));
  const snapToday = fs.readFileSync(path.join(ud, 'debug-backups', r.id, 'today.json'));

  // Порттим текущее состояние: другие настройки, другой набор .bak.
  write(path.join(ud, 'settings.json'), '{"reset":true}');
  write(path.join(ud, 'settings.json.bak'), '{"reset":"bak"}');
  write(path.join(ud, 'settings.json.bak.9'), '{"extra":1}');
  write(path.join(ud, 'today.json'), '{"reset":"today"}');
  fs.rmSync(path.join(ud, 'settings.json.bak.2'));

  const rr = backup.restore(r.id);
  assert.equal(rr.ok, true);
  assert.deepEqual(fs.readFileSync(path.join(ud, 'settings.json')), snapSettings);
  assert.deepEqual(fs.readFileSync(path.join(ud, 'settings.json.bak')), snapBak);
  assert.deepEqual(fs.readFileSync(path.join(ud, 'today.json')), snapToday, 'очередь возвращается вместе с настройками');
  assert.equal(fs.existsSync(path.join(ud, 'settings.json.bak.9')), false);
  assert.equal(fs.readFileSync(path.join(ud, 'settings.json.bak.2'), 'utf8'), '{"old":2}');
  assert.equal(rr.registry, 77);
});

test('хранится ровно 5 последних копий (вообще, не на вид)', async () => {
  const ud = tmpRoot('five');
  fillUserData(ud);
  let t = Date.UTC(2026, 10, 11, 12, 0, 0);
  backup.setup({ userData: ud, appVersion: '0.33.1', readReg: async () => ({ ok: true, value: '1' }), now: () => new Date(t) });
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const r = await backup.snapshot(i % 2 ? 'license' : 'settings');
    ids.push(r.id);
    t += 1000;
  }
  const list = backup.list();
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((x) => x.id), ids.slice(1).reverse());
  for (const gone of ids.slice(0, 1)) assert.equal(fs.existsSync(path.join(ud, 'debug-backups', gone)), false);
});

test('ошибочные вид и id отклоняются', async () => {
  const ud = tmpRoot('bad');
  fillUserData(ud);
  backup.setup({ userData: ud, appVersion: '0.33.1', readReg: async () => ({ ok: true, value: '1' }) });
  await assert.rejects(() => backup.snapshot('nope'), /вид/);
  assert.throws(() => backup.restore('../../secret'), /копия/);
  assert.throws(() => backup.restore('2026-11-11_12-00-00-settings'), /settings\.json/);
});

test('A5: сбитые часы не удаляют только что созданную копию; порядок — по каталогу, а не meta.at', async () => {
  const ud = tmpRoot('clock');
  fillUserData(ud);
  let t = Date.UTC(2026, 10, 11, 12, 0, 0);
  backup.setup({ userData: ud, appVersion: '0.34.0', readReg: async () => ({ ok: true, value: '1' }), now: () => new Date(t) });
  for (let i = 0; i < 5; i++) {
    await backup.snapshot(i % 2 ? 'license' : 'settings');
    t += 1000;
    await new Promise((r) => setTimeout(r, 8));   // чтобы время создания каталогов различалось
  }
  // Часы перевели назад: meta.at новой копии «старее» всех остальных.
  t = Date.UTC(2020, 0, 1, 0, 0, 0);
  const r = await backup.snapshot('settings');
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(r.dir), true, 'новая копия удалена при уборке');
  assert.equal(backup.snapshotReady(r), true, 'копия готова для сброса');
  const list = backup.list();
  assert.equal(list.length, 5, 'хранится ровно 5 копий');
  assert.equal(list[0].id, r.id, 'новая копия — первая: порядок по времени создания каталога');
  assert.ok(list.some((x) => x.id === r.id), 'новая копия есть в списке');

  // snapshotReady: без готовой папки сброс продолжать нельзя.
  assert.equal(backup.snapshotReady(null), false);
  assert.equal(backup.snapshotReady({ ok: true, dir: path.join(ud, 'нет-такой') }), false);
  fs.rmSync(path.join(r.dir, 'meta.json'));
  assert.equal(backup.snapshotReady(r), false);
});
