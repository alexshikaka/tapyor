// Этап 1 разделения модулей: отпечаток «2 из 3», подпись лицензии, привратник, защита часов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../../src/license.js');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const other = crypto.generateKeyPairSync('ed25519');
const OTHER_PRIV = other.privateKey.export({ type: 'pkcs8', format: 'pem' });

const RAW = { machineGuid: '6f1c2a3b-1111-2222-3333-444455556666', uuid: '4C4C4544-0042-3610-8052-B4C04F4B4E32', disk: 'S4EWNX0R123456A' };
const FP = L.fpFromRaw(RAW);
const DAY = 86400000, NOW = Date.UTC(2026, 10, 8);
const full = (o = {}) => L.sign(Object.assign({ v: 1, kind: 'full', pack: 'streamer-pack', edition: 1, fp: FP, key: 'k1', iat: NOW }, o), PRIV);
const trial = (days, o = {}) => L.sign(Object.assign({ v: 1, kind: 'trial', pack: 'streamer-pack', edition: 1, fp: FP, iat: NOW, exp: NOW + days * DAY }, o), PRIV);
const g = (tokens, o = {}) => L.gate(Object.assign({ tokens, pack: 'streamer-pack', fp: FP, now: NOW, pubkeys: [PUB] }, o));

test('отпечаток: мусорные значения отбрасываются, хэш стабилен и не раскрывает значение', () => {
  assert.equal(L.hashPart('To be filled by O.E.M.'), null);
  assert.equal(L.hashPart('00000000-0000-0000-0000-000000000000'), null);
  assert.equal(L.hashPart('  '), null);
  assert.equal(L.hashPart('abcd-1234'), L.hashPart(' ABCD-1234 '));
  assert.equal(FP.length, 3); assert.ok(FP.every(Boolean));
  assert.ok(!FP.join('').includes('S4EWNX'));
});

test('2 из 3: замена диска или переустановка Windows — тот же компьютер; другой компьютер — нет', () => {
  const newDisk = L.fpFromRaw(Object.assign({}, RAW, { disk: 'WD-NEWDISK999' }));
  const newWin = L.fpFromRaw(Object.assign({}, RAW, { machineGuid: '99999999-aaaa-bbbb-cccc-dddddddddddd' }));
  const otherPc = L.fpFromRaw({ machineGuid: 'aaaa-1111-x', uuid: 'bbbb-2222-y', disk: RAW.disk });
  assert.equal(L.fpMatch(FP, newDisk), true);
  assert.equal(L.fpMatch(FP, newWin), true);
  assert.equal(L.fpMatch(FP, otherPc), false);
  assert.equal(L.fpMatch([null, null, null], FP), false);
  // в лицензии только одна часть (бедное железо) — нужна она
  assert.equal(L.fpMatch([FP[0], null, null], FP), true);
});

test('fingerprint(): чтение подменяется, результат кэшируется, ок при ≥2 частях', async () => {
  L._resetFp();
  let n = 0;
  const r = await L.fingerprint({ read: async () => { n++; return RAW; } });
  assert.deepEqual(r.parts, FP); assert.equal(r.ok, true);
  await L.fingerprint({ read: async () => { n++; return {}; } });
  assert.equal(n, 1);
  const bad = await L.fingerprint({ fresh: true, read: async () => null });
  assert.equal(bad.ok, false);
  L._resetFp();
  assert.match(L.fpCode(FP), /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
});

test('подпись: своя проходит, подделка и чужой ключ — нет', () => {
  const t = full();
  assert.equal(L.verify(t, [PUB]).kind, 'full');
  const [p, body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, kind: 'full', pack: 'streamer-pack', edition: 9, fp: FP })).toString('base64url');
  assert.equal(L.verify([p, forged, sig].join('.'), [PUB]), null);
  assert.equal(L.verify(L.sign({ v: 1, kind: 'full', pack: 'streamer-pack', edition: 1, fp: FP }, OTHER_PRIV), [PUB]), null);
  assert.equal(L.verify('мусор', [PUB]), null);
  assert.equal(L.verify(t, []), null); // нет ключей проверки — ничего не принимаем
});

test('привратник: полная лицензия, редакция, другой пак, другой компьютер', () => {
  assert.deepEqual(g([full()]).state, 'full');
  assert.equal(g([full()]).enabled, true);
  assert.equal(g([full({ edition: 1 })], { sinceEdition: 2 }).enabled, false);
  assert.equal(g([full({ pack: 'skins' })]).state, 'none');
  const elsewhere = L.fpFromRaw({ machineGuid: 'x-1234', uuid: 'y-5678', disk: 'z-9012' });
  assert.equal(g([full()], { fp: elsewhere }).state, 'other-pc');
  assert.equal(g([]).state, 'none');
});

test('привратник: триал идёт, кончился, полная лицензия важнее триала', () => {
  const r = g([trial(30)]);
  assert.equal(r.enabled, true); assert.equal(r.state, 'trial'); assert.equal(r.daysLeft, 30);
  assert.equal(g([trial(30)], { now: NOW + 29.5 * DAY }).daysLeft, 1);
  const end = g([trial(30)], { now: NOW + 31 * DAY });
  assert.equal(end.enabled, false); assert.equal(end.state, 'trial-ended');
  assert.equal(g([trial(-1), full()]).state, 'full');
});

test('часы перевели назад: триал не продлевается, полная лицензия работает', () => {
  const st = new Map(); const store = { get: (k) => st.get(k), set: (k, v) => st.set(k, v) };
  assert.equal(L.clockCheck(store, NOW + 40 * DAY).ok, true);
  const c = L.clockCheck(store, NOW + 10 * DAY); // кто-то вернул часы на месяц назад
  assert.equal(c.ok, false);
  assert.equal(g([trial(30)], { now: NOW + 10 * DAY, clockOk: c.ok }).state, 'clock');
  assert.equal(g([full()], { clockOk: false }).state, 'full');
  assert.equal(L.clockCheck(store, NOW + 40 * DAY - 3600000).ok, true); // сдвиг на час — нормально
});
