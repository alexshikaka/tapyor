// B4: подпись обновлений своим ключом. Ключи создаются в самом тесте — папка владельца не читается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const U = require('../../src/update-sign.js');
const RF = require('../../src/release-feed.js');

const kp = crypto.generateKeyPairSync('ed25519');
const PRIV = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const reserve = crypto.generateKeyPairSync('ed25519');
const RESERVE_PRIV = reserve.privateKey.export({ type: 'pkcs8', format: 'pem' });
const RESERVE_PUB = reserve.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const evil = crypto.generateKeyPairSync('ed25519');
const EVIL_PRIV = evil.privateKey.export({ type: 'pkcs8', format: 'pem' });
const EVIL_PUB = evil.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

const VERSION = '0.36.0';
const FILE = 'Tapyor-Setup-0.36.0.exe';
const SHA = crypto.createHash('sha512').update('установщик 0.36.0').digest('base64');
const OTHER_SHA = crypto.createHash('sha512').update('другой установщик').digest('base64');

function makeSig(priv, o = {}) {
  const version = o.version !== undefined ? o.version : VERSION;
  const file = o.file !== undefined ? o.file : FILE;
  const sha512 = o.sha512 !== undefined ? o.sha512 : SHA;
  const sig = o.sig !== undefined ? o.sig : U.sign(version, file, sha512, priv);
  return { v: 1, version, file, sha512, sig };
}
const expected = () => ({ version: VERSION, file: FILE, sha512: SHA });

test('верная подпись проходит', () => {
  const r = U.verify(makeSig(PRIV), expected(), [PUB]);
  assert.equal(r.ok, true, r.reason);
});

test('подпись запасным ключом проходит — подошёл любой из списка', () => {
  const r = U.verify(makeSig(RESERVE_PRIV), expected(), [PUB, RESERVE_PUB]);
  assert.equal(r.ok, true, r.reason);
  assert.equal(U.verify(makeSig(RESERVE_PRIV), expected(), [PUB]).reason, 'bad-signature');
});

test('чужой ключ — bad-signature', () => {
  const r = U.verify(makeSig(EVIL_PRIV), expected(), [PUB, RESERVE_PUB]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-signature');
  assert.equal(U.verify(makeSig(PRIV), expected(), [EVIL_PUB]).reason, 'bad-signature');
});

test('подмена версии, файла или sha512 — mismatch', () => {
  assert.equal(U.verify(makeSig(PRIV), { version: '0.37.0', file: FILE, sha512: SHA }, [PUB]).reason, 'mismatch');
  assert.equal(U.verify(makeSig(PRIV), { version: VERSION, file: 'Tapyor-Setup-0.36.1.exe', sha512: SHA }, [PUB]).reason, 'mismatch');
  assert.equal(U.verify(makeSig(PRIV), { version: VERSION, file: FILE, sha512: OTHER_SHA }, [PUB]).reason, 'mismatch');
  // подменили поле в самом файле подписи, а latest.yml остался прежним
  const s = makeSig(PRIV);
  assert.equal(U.verify(Object.assign({}, s, { version: '0.37.0' }), expected(), [PUB]).reason, 'mismatch');
  assert.equal(U.verify(Object.assign({}, s, { file: 'Evil.exe' }), expected(), [PUB]).reason, 'mismatch');
  assert.equal(U.verify(Object.assign({}, s, { sha512: OTHER_SHA }), expected(), [PUB]).reason, 'mismatch');
});

test('мусор вместо JSON, v: 2, лишняя длина — bad-format', () => {
  for (const t of ['', 'не json', '[]', 'null', '{}', '"строка"', '{"v":1}']) {
    const r = U.parseSig(t);
    assert.equal(r.ok, false, t);
    assert.equal(r.reason, 'bad-format', t);
  }
  assert.equal(U.parseSig('').reason, 'bad-format');
  assert.equal(U.parseSig(JSON.stringify(makeSig(PRIV))).ok, true);
  assert.equal(U.parseSig(JSON.stringify(Object.assign(makeSig(PRIV), { v: 2 }))).reason, 'bad-format');
  assert.equal(U.parseSig('x'.repeat(5000)).reason, 'bad-format');
  assert.equal(U.parseSig(JSON.stringify(Object.assign(makeSig(PRIV), { version: '1'.repeat(100) }))).reason, 'bad-format');
  assert.equal(U.parseSig(JSON.stringify(Object.assign(makeSig(PRIV), { version: '' }))).reason, 'bad-format');
  assert.equal(U.parseSig(JSON.stringify(Object.assign(makeSig(PRIV), { file: 'C:\\Windows\\evil.exe' }))).reason, 'bad-format');
  assert.equal(U.parseSig(JSON.stringify(Object.assign(makeSig(PRIV), { sha512: 'короткая' }))).reason, 'bad-format');
  assert.equal(U.parseSig(JSON.stringify(Object.assign(makeSig(PRIV), { sig: 'нет' }))).reason, 'bad-format');
  // прямой вызов verify с испорченным объектом не должен пропускать
  assert.equal(U.verify({ v: 2 }, expected(), [PUB]).reason, 'bad-format');
  assert.equal(U.verify({ v: 1, version: VERSION, file: FILE, sha512: SHA, sig: 'x' }, expected(), [PUB]).reason, 'bad-format');
});

test('пустой список ключей — no-keys (проверка выключена)', () => {
  assert.equal(U.verify(makeSig(PRIV), expected(), []).reason, 'no-keys');
  assert.equal(U.verify(makeSig(PRIV), expected(), null).reason, 'no-keys');
});

test('подпись пака (другой префикс) не проходит — обновлению не подходит', () => {
  const packMsg = Buffer.from('tpack1\n' + VERSION + '\n' + FILE + '\n' + SHA, 'utf8');
  const sig = crypto.sign(null, packMsg, crypto.createPrivateKey(PRIV)).toString('base64url');
  const s = makeSig(PRIV, { sig });
  assert.equal(U.verify(s, expected(), [PUB]).reason, 'bad-signature');
});

test('message — ровно байты «tapyor-update1\\n» + поля через перевод строки', () => {
  assert.equal(U.message(VERSION, FILE, SHA).toString('utf8'), 'tapyor-update1\n' + VERSION + '\n' + FILE + '\n' + SHA);
  // подпись сходится, только если строку собрали так же
  assert.equal(U.sign(VERSION, FILE, SHA, PRIV).length > 60, true);
  assert.equal(Buffer.from(U.sign(VERSION, FILE, SHA, PRIV), 'base64url').length, 64);
});

test('fromInfo: версия, файл и sha512 из события electron-updater', () => {
  const info = {
    version: VERSION,
    files: [{ url: FILE, sha512: SHA, size: 12345 }],
  };
  assert.deepEqual(U.fromInfo(info), { version: VERSION, file: FILE, sha512: SHA });
  // старый вид: path/sha512 сверху
  assert.deepEqual(U.fromInfo({ version: VERSION, path: FILE, sha512: SHA }), { version: VERSION, file: FILE, sha512: SHA });
  // без установщика — ничего не разобрать
  assert.equal(U.fromInfo({ version: VERSION, files: [{ url: 'Tapyor-Setup-0.36.0.exe.blockmap', sha512: SHA }] }), null);
  assert.equal(U.fromInfo(null), null);
  // подмена: сверху настоящие (подписанные) path/sha512, а в files — другой файл или другой отпечаток.
  // Библиотека качает то, что в files, поэтому такое обновление не должно разбираться вовсе.
  const OTHER = Buffer.alloc(64, 7).toString('base64');
  assert.equal(U.fromInfo({ version: VERSION, path: FILE, sha512: SHA, files: [{ url: 'evil.exe', sha512: OTHER }] }), null);
  assert.equal(U.fromInfo({ version: VERSION, path: FILE, sha512: SHA, files: [{ url: FILE, sha512: OTHER }] }), null);
  // в files берётся отпечаток самой записи, а не верхний
  assert.deepEqual(U.fromInfo({ version: VERSION, files: [{ url: FILE, sha512: OTHER }] }), { version: VERSION, file: FILE, sha512: OTHER });
  // два установщика, запись без sha512, адрес с ? или # — не разбираем
  assert.equal(U.fromInfo({ version: VERSION, files: [{ url: FILE, sha512: SHA }, { url: 'b.exe', sha512: OTHER }] }), null);
  assert.equal(U.fromInfo({ version: VERSION, files: [{ url: FILE, sha2: 'x' }] }), null);
  assert.equal(U.fromInfo({ version: VERSION, files: [{ url: 'evil.bin#' + FILE, sha512: SHA }] }), null);
  // рядом с установщиком может лежать .blockmap — он не мешает
  assert.deepEqual(U.fromInfo({ version: VERSION, files: [{ url: FILE, sha512: SHA }, { url: FILE + '.blockmap', sha512: OTHER }] }), { version: VERSION, file: FILE, sha512: SHA });
  assert.equal(U.fromInfo({ files: [{ url: FILE, sha512: SHA }] }), null);
});

test('файл подписи в одну строку: JSON как пишет инструмент', () => {
  const s = makeSig(PRIV);
  const oneLine = JSON.stringify(s);
  const back = U.parseSig(oneLine);
  assert.equal(back.ok, true, back.reason);
  assert.deepEqual(back.sig, s);
  assert.equal(U.verify(back.sig, expected(), [PUB]).ok, true);
  assert.equal(RF.isSha512Base64(s.sha512), true);
});

// B7b (P5a №13): на update-downloaded сверяем не только версию, но и sha512 того файла,
// для которого прошла подпись. Иначе защита держалась бы на одном поле version.
test('downloadedMatches: ставим только тот файл, чей sha512 прошёл подпись', () => {
  const checked = { version: VERSION, file: FILE, sha512: SHA, mode: 'signed' };
  const info = (sha, version) => ({ version: version || VERSION, files: [{ url: FILE, sha512: sha }] });
  assert.equal(U.downloadedMatches(checked, info(SHA)).ok, true);
  const bad = U.downloadedMatches(checked, info(OTHER_SHA));
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'sha512');
  assert.equal(U.downloadedMatches(checked, info(SHA, '0.37.0')).reason, 'version');
  assert.equal(U.downloadedMatches(checked, { version: VERSION }).ok, false, 'нет данных о файле — отказ');
  assert.equal(U.downloadedMatches(null, info(SHA)).ok, false);
  // Проверка выключена (ключей нет): как раньше — только версия.
  assert.equal(U.downloadedMatches({ version: VERSION, file: '', sha512: '', mode: 'disabled' }, { version: VERSION }).ok, true);
  assert.equal(U.downloadedMatches({ version: VERSION, file: '', sha512: '', mode: 'disabled' }, { version: '0.37.0' }).ok, false);
});
