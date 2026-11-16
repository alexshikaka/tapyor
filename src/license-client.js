'use strict';
// Клиент сервера активации (yc-license, этап 4 плана docs/PLAN-MODULES-SPLIT.md).
// Тапёр шлёт только: действие, пак, отпечаток (3 хэша), ключ (при активации). Ответ — подписанная лицензия tpl1.…,
// которую Тапёр всё равно проверяет сам (license.verify) — серверу на слово не верим.
//
// Адрес сервера: src/license-server.json { "url": "https://functions.yandexcloud.net/…" } рядом с программой
// (или в resources), либо скрытая настройка licServerUrl (для проверки). Нет адреса — активация недоступна,
// остаётся ручная выдача (вставить строку лицензии).
const fs = require('fs');
const path = require('path');
const L = require('./license');

const ERRORS = {
  'no-key': 'такого ключа нет — проверь, нет ли опечатки',
  'key-revoked': 'ключ отозван — напиши автору Тапёра',
  'too-many-pcs': 'ключ уже активирован на 3 компьютерах — отвяжи старый компьютер в Тапёре на нём или напиши автору',
  'trial-used': 'пробный период на этом компьютере уже был',
  'rate': 'слишком много попыток — подожди час',
  'bad-fp': 'не удалось определить компьютер — напиши автору',
  'forbidden': 'сервер не принял запрос Тапёра — обнови Тапёр',
  'not-configured': 'сервер активации ещё не настроен',
};

function serverUrl(store) {
  const o = store && store.get && store.get('licServerUrl');
  if (o && /^https:\/\//.test(String(o))) return String(o);
  for (const p of [path.join(__dirname, 'license-server.json'), path.join(process.resourcesPath || '', 'license-server.json')]) {
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); if (j && /^https:\/\//.test(String(j.url || ''))) return j.url; } catch (e) {}
  }
  return '';
}

// Нормализация ключа: TPR-XXXX-XXXX-XXXX, регистр и пробелы не важны, путаемые буквы прощаем
function normKey(k) {
  const s = String(k || '').toUpperCase().replace(/[\s_]+/g, '').replace(/[ОO]/g, '0').replace(/[IІL]/g, '1');
  const body = s.replace(/^TPR-?/, '').replace(/-/g, '');
  if (!/^[0-9A-Z]{12}$/.test(body)) return null;
  return 'TPR-' + body.slice(0, 4) + '-' + body.slice(4, 8) + '-' + body.slice(8, 12);
}

// o: { fetch, store, key, keyHeader, timeoutMs, pubkeys, plain }
// plain — действие без лицензии в ответе (deactivate): успех = HTTP 200 и { ok: true }
async function call(action, body, o) {
  const url = serverUrl(o.store);
  if (!url) return { ok: false, code: 'not-configured', error: ERRORS['not-configured'] };
  let r, j = null;
  try {
    r = await o.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', [o.keyHeader]: o.cloudKey }, body: JSON.stringify(Object.assign({ action }, body)), signal: AbortSignal.timeout(o.timeoutMs || 15000) });
    try { j = await r.json(); } catch (e) {}
  } catch (e) { return { ok: false, code: 'net', error: 'сервер активации не ответил — проверь интернет и попробуй ещё раз' }; }
  if (o.plain) {
    if (r.ok && j && j.ok === true) return { ok: true, body: j };
    const code = (j && j.error) || ('http-' + (r && r.status));
    return { ok: false, code, error: ERRORS[code] || ('сервер активации: ' + code) };
  }
  if (!r.ok || !j || !j.token) {
    const code = (j && j.error) || ('http-' + (r && r.status));
    return { ok: false, code, error: ERRORS[code] || ('сервер активации: ' + code) };
  }
  const lic = L.verify(j.token, o.pubkeys || L.LICENSE_PUBKEYS);
  if (!lic) return { ok: false, code: 'bad-token', error: 'сервер прислал неподписанную лицензию — не принимаю' };
  return { ok: true, token: j.token, lic };
}

// Время сервера для защиты часов (M3): заголовок Date ответа. Действие 'time' сервер не знает и отвечает
// сразу (до лимитов и базы) — нам нужен только заголовок. Нет сети — 0, защита работает по локальным записям.
async function serverTime(o) {
  const url = serverUrl(o.store);
  if (!url) return 0;
  try {
    const r = await o.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', [o.keyHeader]: o.cloudKey }, body: '{"action":"time"}', signal: AbortSignal.timeout(o.timeoutMs || 5000) });
    const d = Date.parse(r && r.headers && r.headers.get ? r.headers.get('date') : '');
    return Number.isFinite(d) ? d : 0;
  } catch (e) { return 0; }
}

// Хранилище лицензий: store 'modLicenses' = { [pack]: [token, …] } — держим полную и последний триал
function saveToken(store, pack, token) {
  const all = Object.assign({}, store.get('modLicenses') || {});
  const lic = L.verify(token);
  const list = (all[pack] || []).filter((t) => { const x = L.verify(t); return x && lic && x.kind !== lic.kind; });
  list.push(token);
  all[pack] = list;
  store.set('modLicenses', all);
}
function tokens(store, pack) { return ((store.get('modLicenses') || {})[pack]) || []; }
function dropFull(store, pack) {
  const all = Object.assign({}, store.get('modLicenses') || {});
  all[pack] = (all[pack] || []).filter((t) => { const x = L.verify(t); return x && x.kind !== 'full'; });
  store.set('modLicenses', all);
}

module.exports = { call, serverTime, serverUrl, normKey, saveToken, tokens, dropFull, ERRORS };
