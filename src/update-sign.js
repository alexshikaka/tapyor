'use strict';
// B4: подпись обновлений своим ключом (решение владельца 12.11, раздел 7 STABILIZATION.md).
//
// Рядом с установщиком в релизе лежит файл `<имя установщика>.sig` — JSON в одну строку:
//   { "v": 1, "version": "0.36.0", "file": "Tapyor-Setup-0.36.0.exe",
//     "sha512": "<base64, как в latest.yml>", "sig": "<base64url>" }
// sig — подпись Ed25519 над байтами UTF-8 строки
//   "tapyor-update1\n" + version + "\n" + file + "\n" + sha512
//
// Ключ обновлений — отдельная пара (не паки и не лицензии). Закрытые ключи живут только
// на ПК владельца (папка signing вне репозитория), открытые — в src/update-keys.json:
//   { "keys": ["<base64 spki основного>", "<base64 spki запасного>"] }
// Пустой список = проверка выключена (программа работает как раньше).
//
// Модуль без Electron: проверяется тестами tests/unit/update-sign.test.mjs.

const crypto = require('crypto');
const releaseFeed = require('./release-feed');

const PREFIX = 'tapyor-update1\n';
const FORMAT = 1;
const MAX_SIG_FILE = 4 * 1024;   // файл подписи — четыре сотни байт, больше не бывает
const MAX_VERSION = 64;
const MAX_FILE = 200;
const MAX_SHA = 200;

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Строка, которую подписываем. Одна и та же здесь, в инструменте и в тестах.
function message(version, file, sha512) {
  return Buffer.from(PREFIX + String(version) + '\n' + String(file) + '\n' + String(sha512), 'utf8');
}

// Имя установщика — только имя файла, без папок: путь в подписи не нужен и опасен.
function installerName(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v || v !== s || v.length > MAX_FILE) return false;
  if (/[\\/:*?"<>|\0]/.test(v) || v.includes('..')) return false;
  return /\.exe$/i.test(v);
}

function plainField(s, max) {
  if (typeof s !== 'string') return false;
  return s.length > 0 && s.length <= max && s === s.trim();
}

// Общая проверка вида объекта подписи. Возвращает '' или причину.
function shapeError(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'подпись — не объект';
  if (o.v !== FORMAT) return 'неизвестная версия формата';
  if (!plainField(o.version, MAX_VERSION)) return 'нет версии';
  if (!installerName(o.file)) return 'нет имени установщика';
  if (!plainField(o.sha512, MAX_SHA) || !releaseFeed.isSha512Base64(o.sha512)) return 'нет годной sha512';
  if (typeof o.sig !== 'string' || !/^[A-Za-z0-9_-]+$/.test(o.sig) || unb64u(o.sig).length !== 64) return 'нет подписи';
  return '';
}

// Строгий разбор файла подписи. → { ok: true, sig: {...} } | { ok: false, reason: 'bad-format', error }
function parseSig(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'bad-format', error: 'подпись — не текст' };
  if (text.length > MAX_SIG_FILE) return { ok: false, reason: 'bad-format', error: 'файл подписи слишком большой' };
  let j;
  try { j = JSON.parse(text); } catch (e) { return { ok: false, reason: 'bad-format', error: 'это не JSON' }; }
  const why = shapeError(j);
  if (why) return { ok: false, reason: 'bad-format', error: why };
  return { ok: true, sig: { v: FORMAT, version: j.version, file: j.file, sha512: j.sha512, sig: j.sig } };
}

// Открытый ключ из src/update-keys.json: base64 spki (можно и PEM — на случай ручной вставки).
function publicKey(k) {
  const s = String(k == null ? '' : k).trim();
  if (!s) return null;
  if (s.includes('BEGIN')) return crypto.createPublicKey(s);
  return crypto.createPublicKey({ key: Buffer.from(s, 'base64'), format: 'der', type: 'spki' });
}

// Проверка подписи против latest.yml.
//   sigObj  — то, что вернул parseSig (или сам файл подписи)
//   expected — { version, file, sha512 } из latest.yml
//   keys    — список открытых ключей; пустой список = проверка выключена (reason 'no-keys')
// → { ok: true } | { ok: false, reason: 'no-keys' | 'bad-format' | 'mismatch' | 'bad-signature' }
function verify(sigObj, expected, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: 'no-keys' };
  const why = shapeError(sigObj);
  if (why) return { ok: false, reason: 'bad-format', error: why };
  const exp = expected && typeof expected === 'object' ? expected : {};
  if (!plainField(exp.version, MAX_VERSION) || !plainField(exp.file, MAX_FILE) || !plainField(exp.sha512, MAX_SHA)) {
    return { ok: false, reason: 'bad-format', error: 'нет ожидаемых данных из latest.yml' };
  }
  if (sigObj.version !== exp.version || sigObj.file !== exp.file || sigObj.sha512 !== exp.sha512) {
    return { ok: false, reason: 'mismatch' };
  }
  const data = message(sigObj.version, sigObj.file, sigObj.sha512);
  const sig = unb64u(sigObj.sig);
  const good = keys.some((k) => {
    try { return crypto.verify(null, data, publicKey(k), sig); } catch (e) { return false; }
  });
  if (!good) return { ok: false, reason: 'bad-signature' };
  return { ok: true };
}

// Подпись для инструмента и тестов: base64url.
function sign(version, file, sha512, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return b64u(crypto.sign(null, message(version, file, sha512), key));
}

// Что electron-updater кладёт в событие update-available/update-downloaded:
//   info.version, info.files: [{ url, sha512, size }] и устаревшие info.path / info.sha512.
// ВАЖНО: качает библиотека то, что в info.files (Provider.getFileList: files важнее path), поэтому
// подпись сверяем именно с этой записью. Иначе подделанный latest.yml мог бы показать нам сверху
// настоящие (подписанные) path/sha512, а в files подложить другой файл со своим sha512.
// Правила: в files ровно одна запись-установщик (.exe, без ? и #), у неё есть sha512; если сверху
// тоже есть path/sha512 — они обязаны совпасть. Нет files — берём верхние поля (как библиотека).
// → { version, file, sha512 } | null
function fromInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const version = typeof info.version === 'string' ? info.version.trim() : '';
  const base = (u) => String(u || '').replace(/\\/g, '/').split('/').pop() || '';
  const topPath = typeof info.path === 'string' ? info.path : '';
  const topSha = typeof info.sha512 === 'string' ? info.sha512.trim() : '';
  let file = '', sha512 = '';
  const files = Array.isArray(info.files) ? info.files : [];
  if (files.length > 0) {
    const real = files.filter((f) => !(f && typeof f.url === 'string' && /\.blockmap$/i.test(f.url)));
    if (real.length !== 1) return null;
    const f = real[0];
    if (!f || typeof f.url !== 'string' || /[?#]/.test(f.url) || typeof f.sha512 !== 'string') return null;
    file = base(f.url); sha512 = f.sha512.trim();
    if (topPath && base(topPath) !== file) return null;
    if (topSha && topSha !== sha512) return null;
  } else {
    file = base(topPath); sha512 = topSha;
  }
  if (!plainField(version, MAX_VERSION) || !installerName(file) || !releaseFeed.isSha512Base64(sha512)) return null;
  return { version, file, sha512 };
}

// B7b (P5a №13): на update-downloaded сверяем не только номер версии, но и sha512 —
// ровно тот файл, для которого прошла проверка подписи. expected — это updCheck из updater.js.
// Проверка выключена (ключей нет, mode: 'disabled') — как раньше, сверяем только версию.
// → { ok: true } | { ok: false, reason: 'no-check' | 'version' | 'bad-info' | 'sha512' }
function downloadedMatches(expected, info) {
  if (!expected || !plainField(expected.version, MAX_VERSION)) return { ok: false, reason: 'no-check' };
  const v = info && typeof info.version === 'string' ? info.version.trim() : '';
  if (v !== expected.version) return { ok: false, reason: 'version' };
  if (expected.mode === 'disabled' || !expected.sha512) return { ok: true };
  const got = fromInfo(info);
  if (!got) return { ok: false, reason: 'bad-info' };
  if (got.version !== expected.version) return { ok: false, reason: 'version' };
  if (got.sha512 !== expected.sha512) return { ok: false, reason: 'sha512' };
  return { ok: true };
}

module.exports = { message, parseSig, verify, sign, fromInfo, downloadedMatches, installerName, MAX_SIG_FILE };
