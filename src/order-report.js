'use strict';
// Отдельный журнал заказов: JSONL, по одной строке на заказ.
// Пишем только локально, без токенов и секретов. Ошибка записи не влияет на заказ.
const fs = require('fs');
const path = require('path');

let reportPath = path.join(process.cwd(), 'orders-report.jsonl');
let log = () => {};
let maxBytes = 8 * 1024 * 1024;

function setup(opts = {}) {
  if (opts.file) reportPath = opts.file;
  if (opts.log) log = opts.log;
  if (opts.maxBytes) maxBytes = opts.maxBytes;
}
function ensure() {
  try { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); if (!fs.existsSync(reportPath)) fs.writeFileSync(reportPath, '', 'utf8'); }
  catch (e) { try { log('orders-report: файл не создан — ' + e.message); } catch (x) {} }
  return reportPath;
}
function rotate() {
  try {
    if (fs.existsSync(reportPath) && fs.statSync(reportPath).size > maxBytes) {
      const old = reportPath + '.1';
      try { if (fs.existsSync(old)) fs.unlinkSync(old); } catch (e) {}
      fs.renameSync(reportPath, old);
    }
  } catch (e) { try { log('orders-report: ротация не сделана — ' + e.message); } catch (x) {} }
}
function append(entry) {
  try {
    ensure();
    rotate();
    fs.appendFileSync(reportPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) { try { log('orders-report: ' + e.message); } catch (x) {} }
}
function begin(d, extra = {}) {
  const prov = d && d.prov || '';
  const text = String(d && d.text || '');
  const entry = {
    ts: new Date().toISOString(),
    key: d && d.prov && d.id ? d.prov + ':' + d.id : '',
    prov,
    id: d && d.id || '',
    amount: d && d.amount,
    currency: d && d.currency || '',
    // Текст заказа из Streamer.bot в файл не пишем: только длина (PRIVACY.md, A35-8).
    text: prov === 'sbot' ? '' : text,
    steps: [],
    plan: null,
    analyzer: null,
    links: [],
    groups: [],
    lookup: null,
    gate: null,
    flags: [],
    paid: null,
    result: null,
    error: null,
  };
  if (prov === 'sbot') entry.textLen = text.length;
  return Object.assign(entry, extra);
}
function step(trace, name, data) {
  if (!trace) return;
  try { trace.steps.push(Object.assign({ at: new Date().toISOString(), name }, data || {})); }
  catch (e) { try { log('orders-report: шаг «' + name + '» не записан — ' + e.message); } catch (x) {} }
}
function finish(trace, result) {
  if (!trace) return;
  try {
    trace.result = result ? {
      level: result.level,
      signal: result.signal,
      items: (result.items || []).map((it) => ({
        level: it.level, via: it.via || '', query: it.query || '', margin: it.margin == null ? null : it.margin,
        track: it.track ? { src: it.track.src, id: it.track.id, title: it.track.title, author: it.track.author, duration: it.track.duration } : null,
        flags: it.flags || [], paid: it.paid === true, note: it.note || '',
      })),
    } : null;
    trace.durationMs = Date.now() - Date.parse(trace.ts);
    append(trace);
  } catch (e) { try { log('orders-report: finish — ' + e.message); } catch (x) {} }
}
function fail(d, err) {
  const t = begin(d);
  t.error = String(err && err.message || err || 'unknown');
  t.durationMs = 0;
  append(t);
}
module.exports = { setup, ensure, begin, step, finish, fail, path: () => reportPath };
