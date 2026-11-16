// Этап 2: пак отдельным подписанным файлом — сборка, проверка подписи, установка, обновление, откат.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../../src/packs.js');

const kp = crypto.generateKeyPairSync('ed25519');
const PRIV = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const evil = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tpack-'));

function packDir(ver, extra = {}) {
  const d = tmp();
  const man = Object.assign({ id: 'streamer-pack', name: 'Пак стримера', version: ver, minCore: '0.31.0', modules: [{ id: 'bot', main: 'bot/src/index.js', sinceEdition: 1 }] }, extra);
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(man));
  fs.mkdirSync(path.join(d, 'bot', 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'bot', 'src', 'index.js'), 'module.exports = { activate: async () => ({ v: "' + ver + '" }) };');
  fs.mkdirSync(path.join(d, 'bot', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(d, 'bot', 'tests', 'x.test.js'), '// тесты в пак не кладутся');
  return d;
}

test('сборка и проверка: подпись своя — ок, тесты в пак не попали', () => {
  const r = P.inspect(P.build(packDir('0.3.0'), PRIV), [PUB], '0.32.0');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.manifest.version, '0.3.0');
  assert.ok(r.files['bot/src/index.js']);
  assert.ok(!Object.keys(r.files).some((f) => f.includes('tests/')));
});

test('подделка: чужой ключ, изменённый код, изменённый манифест — отказ', () => {
  const ok = P.build(packDir('0.3.0'), PRIV);
  assert.match(P.inspect(P.build(packDir('0.3.0'), evil), [PUB]).error, /подпись/);
  const j = JSON.parse(ok.toString());
  const files = JSON.parse(zlib.gunzipSync(Buffer.from(j.payload, 'base64')).toString());
  files['bot/src/index.js'] = Buffer.from('require("child_process").exec("плохое")').toString('base64');
  const pl = zlib.gzipSync(Buffer.from(JSON.stringify(files)));
  const hacked = Object.assign({}, j, { payload: pl.toString('base64'), sha256: crypto.createHash('sha256').update(pl).digest('hex') });
  assert.match(P.inspect(Buffer.from(JSON.stringify(hacked)), [PUB]).error, /подпись/);
  const man2 = Object.assign({}, j, { manifest: j.manifest.replace('"minCore":"0.31.0"', '"minCore":"0.1.0"') });
  assert.match(P.inspect(Buffer.from(JSON.stringify(man2)), [PUB]).error, /подпись/);
  assert.match(P.inspect(Buffer.from('мусор'), [PUB]).error, /не файл пака/);
  assert.equal(P.inspect(ok, []).ok, false); // нет ключей — ничего не ставим
});

test('опасные пути внутри пака отклоняются', () => {
  for (const bad of ['../evil.js', '/etc/x', 'C:/x.js', 'a/../../b', 'a//b', './x']) assert.equal(P.safeRel(bad), null, bad);
  assert.equal(P.safeRel('bot/src/index.js'), 'bot/src/index.js');
});

test('старый Тапёр: пак требует новее — понятная ошибка', () => {
  const r = P.inspect(P.build(packDir('0.3.0', { minCore: '0.40.0' }), PRIV), [PUB], '0.31.14');
  assert.equal(r.ok, false); assert.match(r.error, /нужен Тапёр 0\.40\.0/);
});

test('установка → обновление → откат; хранится текущая и одна прошлая', () => {
  const root = tmp();
  const o = { root, pubkeys: [PUB], coreVersion: '0.32.0' };
  assert.equal(P.current(root, 'streamer-pack'), null);
  assert.equal(P.install(P.build(packDir('0.3.0'), PRIV), o).ok, true);
  assert.equal(P.current(root, 'streamer-pack').version, '0.3.0');
  const up = P.install(P.build(packDir('0.3.1'), PRIV), o);
  assert.equal(up.from, '0.3.0');
  const cur = P.current(root, 'streamer-pack');
  assert.equal(cur.version, '0.3.1'); assert.equal(cur.prev, '0.3.0');
  assert.ok(fs.existsSync(path.join(cur.dir, 'bot', 'src', 'index.js')));
  P.install(P.build(packDir('0.3.2'), PRIV), o);
  assert.deepEqual(fs.readdirSync(path.join(root, 'streamer-pack')).filter((f) => /^\d/.test(f)).sort(), ['0.3.1', '0.3.2']);
  assert.equal(P.rollback(root, 'streamer-pack').version, '0.3.1');
  assert.equal(P.current(root, 'streamer-pack').version, '0.3.1');
  // переустановка той же версии чинит файлы и не теряет прошлую
  fs.rmSync(path.join(root, 'streamer-pack', '0.3.1', 'bot'), { recursive: true });
  const re = P.install(P.build(packDir('0.3.1'), PRIV), o);
  assert.equal(re.same, true);
  assert.ok(fs.existsSync(path.join(root, 'streamer-pack', '0.3.1', 'bot', 'src', 'index.js')));
  assert.equal(P.remove(root, 'streamer-pack').ok, true);
  assert.equal(P.current(root, 'streamer-pack'), null);
});

test('битая подпись не трогает установленную версию', () => {
  const root = tmp(); const o = { root, pubkeys: [PUB], coreVersion: '0.32.0' };
  P.install(P.build(packDir('0.3.0'), PRIV), o);
  assert.equal(P.install(P.build(packDir('0.9.9'), evil), o).ok, false);
  assert.equal(P.current(root, 'streamer-pack').version, '0.3.0');
});

// L12 (аудит 0.32.0): ядро ставит только свой пак — подписанный пак с чужим id не принимается.
test('L12: пак с чужим id отклоняется, если ждём streamer-pack', () => {
  const root = tmp();
  const o = { root, pubkeys: [PUB], coreVersion: '0.32.0', expectId: 'streamer-pack' };
  const wrong = P.build(packDir('0.3.0', { id: 'other-pack' }), PRIV);
  const r = P.install(wrong, o);
  assert.equal(r.ok, false);
  assert.match(r.error, /это пак другого модуля/);
  assert.equal(P.current(root, 'other-pack'), null, 'на диск ничего не легло');
  assert.ok(!fs.existsSync(path.join(root, 'other-pack')));
  assert.equal(P.inspect(wrong, [PUB], '0.32.0', 'streamer-pack').ok, false);
  assert.equal(P.inspect(P.build(packDir('0.3.0'), PRIV), [PUB], '0.32.0', 'streamer-pack').ok, true);
  // без expectId — прежнее поведение (обратная совместимость)
  assert.equal(P.inspect(wrong, [PUB], '0.32.0').ok, true);
  assert.equal(P.install(wrong, { root, pubkeys: [PUB], coreVersion: '0.32.0' }).ok, true);
});


// M6 (P5b): подпись проверяется не только при установке. При запуске перепроверяем подпись
// установленной версии и хеши файлов: подменённый код модуля не должен запускаться.
test('M6: установленная версия проверяется при запуске, подменённый файл модуля — отказ', () => {
  const root = tmp(); const o = { root, pubkeys: [PUB], coreVersion: '0.32.0' };
  assert.equal(P.install(P.build(packDir('0.3.0'), PRIV), o).ok, true);
  const ver = P.verifyInstalled(root, 'streamer-pack', [PUB]);
  assert.equal(ver.ok, true, ver.error);
  assert.equal(ver.version, '0.3.0');
  // при установке рядом с версией сохранена подпись (исходный файл пака)
  assert.ok(fs.existsSync(path.join(root, 'streamer-pack', '0.3.0', 'signature.json')));
  // подменили файл модуля — запускать нельзя
  const mod = path.join(root, 'streamer-pack', '0.3.0', 'bot', 'src', 'index.js');
  fs.writeFileSync(mod, 'module.exports = { activate: async () => ({ evil: 1 }) };');
  const bad = P.verifyInstalled(root, 'streamer-pack', [PUB]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /повреждён/);
  // вернули файл — снова можно (подпись цела)
  fs.writeFileSync(mod, 'module.exports = { activate: async () => ({ v: "0.3.0" }) };');
  assert.equal(P.verifyInstalled(root, 'streamer-pack', [PUB]).ok, true);
  // подменили сам файл подписи — отказ
  fs.writeFileSync(path.join(root, 'streamer-pack', '0.3.0', 'signature.json'), '{"format":1}');
  const badSig = P.verifyInstalled(root, 'streamer-pack', [PUB]);
  assert.equal(badSig.ok, false);
  assert.match(badSig.error, /повреждён/);
});

test('M6: чужой ключ в списке pubkeys не принимается; откат проверяется так же', () => {
  const root = tmp(); const o = { root, pubkeys: [PUB], coreVersion: '0.32.0' };
  P.install(P.build(packDir('0.3.0'), PRIV), o);
  P.install(P.build(packDir('0.3.1'), PRIV), o);
  assert.equal(P.verifyInstalled(root, 'streamer-pack', []).ok, false);
  assert.equal(P.rollback(root, 'streamer-pack').version, '0.3.0');
  assert.equal(P.verifyInstalled(root, 'streamer-pack', [PUB]).version, '0.3.0');
  // нет current.json — это «не установлен», а не «повреждён»
  const empty = tmp();
  const none = P.verifyInstalled(empty, 'streamer-pack', [PUB]);
  assert.equal(none.ok, false);
  assert.equal(none.notInstalled, true);
});


test('список паков: только https и правильные версии', () => {
  const l = P.parseIndex(JSON.stringify({ packs: [{ id: 'streamer-pack', version: '0.3.0', url: 'https://github.com/x.tpack' }, { id: 'x', version: '1', url: 'https://a' }, { id: 'bad', version: '1.0.0', url: 'http://a' }] }));
  assert.equal(l.length, 1);
});

// L6 (P5b): обычная установка не понижает версию. Иначе индекс паков (или подменённый packsIndexUrl)
// мог бы тихо поставить старую подписанную версию поверх новой. Для понижения есть кнопка «Откатить».
test('L6: установка версии ниже текущей отклоняется, текущая не меняется; откат работает', () => {
  const root = tmp(); const o = { root, pubkeys: [PUB], coreVersion: '0.32.0' };
  assert.equal(P.install(P.build(packDir('0.3.0'), PRIV), o).ok, true);
  assert.equal(P.install(P.build(packDir('0.3.1'), PRIV), o).ok, true);
  const down = P.install(P.build(packDir('0.3.0'), PRIV), o);
  assert.equal(down.ok, false);
  assert.match(down.error, /старше|Откатить/);
  assert.equal(P.current(root, 'streamer-pack').version, '0.3.1');
  // отдельная кнопка «Откатить» по-прежнему возвращает прошлую версию
  assert.equal(P.rollback(root, 'streamer-pack').version, '0.3.0');
  assert.equal(P.current(root, 'streamer-pack').version, '0.3.0');
  // и уже после отката вперёд ставится спокойно
  assert.equal(P.install(P.build(packDir('0.3.2'), PRIV), o).ok, true);
});


// Приёмка B10 (13.11): пак, поставленный до проверки при запуске (нет signature.json), не считается повреждённым —
// иначе после обновления Тапёра у всех встали бы бот и оверлей. Работает с пометкой legacy.
test('verifyInstalled: старая установка без signature.json — ok с пометкой legacy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-legacy-'));
  const r = P.install(P.build(packDir('0.3.0'), PRIV), { root, pubkeys: [PUB] });
  assert.equal(r.ok, true, r.error);
  fs.unlinkSync(path.join(r.dir, P.SIG_NAME));
  const v = P.verifyInstalled(root, 'streamer-pack', [PUB]);
  assert.equal(v.ok, true);
  assert.equal(v.legacy, true);
  fs.rmSync(root, { recursive: true, force: true });
});
