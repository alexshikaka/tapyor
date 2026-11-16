'use strict';
// Живой список сетей Яндекса: тянем анонсы из RIPE (stat.ripe.net) и кладём в кэш.
// Зачем: сети Яндекса меняются, а вшитый список стареет. Кэш — чтобы не тянуть при
// каждом запуске и работать офлайн: держим его неделю, потом тихо обновляем.
const fs = require('fs');
const path = require('path');
const https = require('https');
const atomic = require('./atomic-write');
const { NETS, ASNS, EXTRA, withoutDeny } = require('./vpn-nets');

const TTL_DAYS = 7;
const TIMEOUT_MS = 8000;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; if (buf.length > 2 * 1024 * 1024) req.destroy(new Error('слишком большой ответ')); });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('таймаут')));
    req.on('error', reject);
  });
}

// Сети одного ASN: только IPv4, без мусора
async function asnNets(asn) {
  const d = await getJson('https://stat.ripe.net/data/announced-prefixes/data.json?resource=' + asn);
  const list = (d && d.data && d.data.prefixes) || [];
  return list.map((p) => p && p.prefix).filter((p) => typeof p === 'string' && p.indexOf(':') < 0);
}

function cacheFile(dir) { return path.join(dir, 'vpn-nets.json'); }

function readCache(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile(dir), 'utf8'));
    const nets = withoutDeny(j.nets); // старый кэш мог содержать чужие сети (до 11.11) — вычищаем сразу при чтении
    if (!nets.length || !j.at) return null;
    return { nets, at: Number(j.at) || 0 };
  } catch (e) { return null; }
}

function writeCache(dir, nets) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    atomic.writeFileAtomic(cacheFile(dir), JSON.stringify({ at: Date.now(), nets }));
  } catch (e) { /* кэш — не критично */ }
}

// Спросить RIPE по всем ASN. Если не ответил ни один — бросаем, вызывающий возьмёт запасное.
async function fetchLive() {
  const settled = await Promise.allSettled(ASNS.map(asnNets));
  const got = [];
  for (const r of settled) if (r.status === 'fulfilled') got.push.apply(got, r.value);
  if (!got.length) throw new Error('RIPE не ответил ни по одному ASN');
  return withoutDeny(got.concat(EXTRA)); // чужие сети (DENY) не пускаем, даже если RIPE их анонсирует
}

function stale(at, ttlDays) {
  if (!at) return true;
  return Date.now() - at > (ttlDays || TTL_DAYS) * 24 * 3600 * 1000;
}

// Для настроек: отдать список и откуда он. dir — userData приложения.
async function load(dir, opts) {
  opts = opts || {};
  const cache = readCache(dir);
  if (cache && !stale(cache.at, opts.ttlDays)) {
    return { nets: cache.nets, at: cache.at, source: 'cache', ttlDays: opts.ttlDays || TTL_DAYS };
  }
  try {
    const nets = await fetchLive();
    writeCache(dir, nets);
    return { nets, at: Date.now(), source: 'live', ttlDays: opts.ttlDays || TTL_DAYS };
  } catch (e) {
    if (cache) return { nets: cache.nets, at: cache.at, source: 'cache', error: e.message, ttlDays: opts.ttlDays || TTL_DAYS };
    return { nets: withoutDeny(NETS), at: 0, source: 'builtin', error: e.message, ttlDays: opts.ttlDays || TTL_DAYS };
  }
}

// Принудительное обновление (кнопка «Обновить»)
async function refresh(dir) {
  const before = readCache(dir);
  try {
    const nets = await fetchLive();
    writeCache(dir, nets);
    return { nets, at: Date.now(), source: 'live', prev: before ? before.nets.length : 0, ttlDays: TTL_DAYS };
  } catch (e) {
    const nets = before ? before.nets : withoutDeny(NETS);
    return { nets, at: before ? before.at : 0, source: before ? 'cache' : 'builtin', error: e.message, ttlDays: TTL_DAYS };
  }
}

module.exports = { load, refresh, fetchLive, readCache, writeCache, cacheFile, TTL_DAYS };
