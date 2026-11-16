// Чистые функции для «честного предложения» при смене канала (А12).
// autoUpdater не ставит сборку того же номера, поэтому номер и файл целевого канала
// разбираем сами: latest.yml из релиза GitHub → версия, имя файла, sha512.
// Ничего не качает и не пишет на диск — только разбор и сверка (unit-тесты: tests/unit/release-feed.test.mjs).
'use strict';
const crypto = require('crypto');

// Каналы и куда они смотрят. Совпадает с UPD_FEEDS в src/main.js.
const FEEDS = {
  stable: { owner: 'alexshikaka', repo: 'tapyor', build: 'stable' },
  debug: { owner: 'alexshikaka', repo: 'tapyor-releases', build: 'dev' }
};

// Откуда вообще можно качать: только сам GitHub владельца и его файловый хост.
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

function feedReleaseUrl(channel) {
  const f = FEEDS[channel] || FEEDS.stable;
  return 'https://github.com/' + f.owner + '/' + f.repo + '/releases/latest/download/latest.yml';
}

// Ссылка на сам файл: имя берём из latest.yml, каталог — из целевого канала (не из файла!).
function assetUrl(channel, fileName) {
  const f = FEEDS[channel] || FEEDS.stable;
  return 'https://github.com/' + f.owner + '/' + f.repo + '/releases/latest/download/' + encodeURIComponent(fileName);
}

// Имя файла в адресе — только имя: без папок, «..» и служебных символов.
function safeAssetName(n) {
  const s = String(n == null ? '' : n);
  if (!s || s.length > 240) return false;
  return !/[\\/:*?"<>|\0]/.test(s) && !s.includes('..');
}

// B7b (P5a №15): файл из релиза конкретной версии — тег vX.Y.Z. Файл подписи `.sig` старой
// версии после выхода новой из latest/download исчезал (404), и обновление «молча ждало».
function assetUrlAtVersion(channel, version, fileName) {
  const f = FEEDS[channel] || FEEDS.stable;
  if (!safeVersion(version) || !safeAssetName(fileName)) return '';
  return 'https://github.com/' + f.owner + '/' + f.repo + '/releases/download/v' + encodeURIComponent(version) + '/' + encodeURIComponent(fileName);
}

function hostAllowed(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
}

// «0.32.0» → [0,32,0]. Хвост после дефиса (0.32.0-beta) для сравнения отбрасываем.
function parseVersion(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// B7b (P5a №12): строгий номер версии. Из latest.yml он попадает в имя файла установщика,
// поэтому кроме чисел и обычного хвоста (-beta.1) ничего: ни «/», ни «\», ни «..».
// parseVersion выше остаётся мягким — он только сравнивает номера.
const SAFE_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
function safeVersion(v) {
  return typeof v === 'string' && SAFE_VERSION.test(v);
}

// -1 меньше, 0 равно, 1 больше, null — если номер не разобрать.
function cmpVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

// latest.yml без зависимостей: нужны только version, path (имя файла) и sha512.
// Поддерживаем и плоский вид (path/sha512 сверху), и список files с одной записью.
function parseLatestYml(text) {
  const s = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  if (!s.trim()) return { ok: false, error: 'пустой latest.yml' };
  const top = {};
  const firstFile = {};
  let inFiles = false;
  for (const raw of s.split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const topLevel = /^[A-Za-z_]/.test(raw);
    if (topLevel) inFiles = false;
    if (/^files:/.test(raw)) { inFiles = true; continue; }
    if (inFiles && /^\s*-\s/.test(raw)) { /* начало новой записи о файле */ }
    const m = raw.match(/^\s*(?:-\s*)?([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1], val = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (inFiles) { if (!(key in firstFile)) firstFile[key] = val; }
    else if (!(key in top)) top[key] = val;
  }
  const version = top.version || '';
  const file = top.path || firstFile.url || firstFile.path || '';
  const sha512 = top.sha512 || firstFile.sha512 || '';
  if (!safeVersion(version)) return { ok: false, error: 'в latest.yml непонятная версия' };
  if (!file) return { ok: false, error: 'в latest.yml нет имени файла' };
  if (!/\.exe$/i.test(file)) return { ok: false, error: 'в latest.yml не установщик (.exe)' };
  if (!isSha512Base64(sha512)) return { ok: false, error: 'в latest.yml нет годной sha512' };
  return { ok: true, version: version, file: file.replace(/^.*[\\/]/, ''), sha512 };
}

// sha512 в latest.yml — base64 от 64 байт: 88 знаков с «=» на конце.
function isSha512Base64(s) {
  const v = String(s || '').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return false;
  if (v.length < 80 || v.length > 96) return false;
  try { return Buffer.from(v, 'base64').length === 64; } catch (e) { return false; }
}

function sha512Base64(buf) {
  return crypto.createHash('sha512').update(buf).digest('base64');
}

// Сверка скачанного файла с latest.yml. Подменённый файл — отказ.
function checkSha512(buf, expectedBase64) {
  if (!buf || !buf.length) return false;
  const want = String(expectedBase64 || '').trim();
  if (!isSha512Base64(want)) return false;
  const got = sha512Base64(buf);
  if (got.length !== want.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch (e) { return false; }
}

// Что предложить после переключения канала.
//   newer  — в целевом канале версия больше: обычный autoUpdater поставит её сам;
//   same   — тот же номер, другая сборка: предложить кнопку «Поставить …»;
//   older  — целевой канал отстал: не откатываем, пишем «догонит»;
//   empty  — релизов нет вовсе;
//   error  — latest.yml не прочитать/сети нет.
function decideChannelOffer(current, currentBuild, targetChannel, latest) {
  const targetBuild = (FEEDS[targetChannel] || FEEDS.stable).build;
  if (!latest) return { verdict: 'empty', build: targetBuild };
  if (latest.ok === false) return { verdict: 'error', build: targetBuild, error: latest.error || 'latest.yml не прочитан' };
  const c = cmpVersion(latest.version, current);
  if (c === null) return { verdict: 'error', build: targetBuild, error: 'непонятный номер версии' };
  if (c > 0) return { verdict: 'newer', version: latest.version, build: targetBuild };
  if (c === 0) {
    if (targetBuild === currentBuild) return { verdict: 'same', version: latest.version, build: targetBuild, sameBuild: true };
    return { verdict: 'same', version: latest.version, build: targetBuild, sameBuild: false };
  }
  return { verdict: 'older', version: latest.version, build: targetBuild };
}

module.exports = {
  FEEDS, ALLOWED_HOSTS, feedReleaseUrl, assetUrl, assetUrlAtVersion, hostAllowed,
  parseVersion, safeVersion, cmpVersion, parseLatestYml, isSha512Base64, sha512Base64, checkSha512, decideChannelOffer
};
