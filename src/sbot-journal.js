'use strict';
// Журнал заказов из Streamer.bot (0.35, Э1): <userData>\sbot-journal\ГГГГ-ММ-ДД.jsonl.
// Только локально. Ники и тексты заказов живут ТОЛЬКО здесь (в log.txt, отчёте и
// orders-report.jsonl их нет). Хранение 7 дней, уборка — при запуске.
// Образец — журнал бота пака (src/modhost.js: makeJournal), но своя папка и своя дата (местная).

const fs = require('fs');
const path = require('path');

const DAY = 86400000;
const KEEP_DAYS = 7;

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// Местная дата: у стримера день начинается по его часам, а не по UTC.
function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function setup(dir, opts) {
  const base = String(dir || '');
  const o = opts || {};
  const jdir = path.join(base, 'sbot-journal');
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const log = typeof o.log === 'function' ? o.log : () => {};
  const days = Number(o.days) > 0 ? Math.floor(Number(o.days)) : KEEP_DAYS;

  try { fs.mkdirSync(jdir, { recursive: true }); } catch (e) { log('Streamer.bot: журнал — ' + e.message); }

  function cleanup() {
    let names = [];
    try { names = fs.readdirSync(jdir); } catch (e) { return; }
    const keep = new Set();
    const t = now();
    for (let i = 0; i < days; i++) keep.add(dayKey(t - i * DAY) + '.jsonl');
    let removed = 0;
    for (const f of names) {
      if (!/\.jsonl$/i.test(f) || keep.has(f)) continue;
      try { fs.rmSync(path.join(jdir, f), { force: true }); removed++; }
      catch (e) { log('Streamer.bot: журнал — ' + e.message); }
    }
    return removed;
  }

  function append(entry) {
    try {
      const e = Object.assign({}, entry);
      let ms = e.at == null ? now() : e.at;
      if (typeof ms !== 'number') ms = Date.parse(String(ms));
      if (!isFinite(ms)) ms = now();
      e.at = new Date(ms).toISOString();
      fs.appendFileSync(path.join(jdir, dayKey(ms) + '.jsonl'), JSON.stringify(e) + '\n', 'utf8');
    } catch (e) { /* журнал не должен ломать заказ */ }
  }

  // Последние два файла, до `limit` записей — как у бота пака (300).
  function load(limit) {
    const max = Math.max(1, Number(limit) || 300);
    const out = [];
    try {
      const files = fs.readdirSync(jdir).filter((f) => /\.jsonl$/i.test(f)).sort().slice(-2);
      for (const f of files) {
        const text = fs.readFileSync(path.join(jdir, f), 'utf8');
        for (const line of text.split('\n')) {
          if (!line) continue;
          try { out.push(JSON.parse(line)); } catch (e) {}
        }
      }
    } catch (e) { return []; }
    return out.slice(-max);
  }

  cleanup();

  return { dir: jdir, append, load, cleanup };
}

module.exports = { setup, dayKey, KEEP_DAYS };
