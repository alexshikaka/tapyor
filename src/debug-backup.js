'use strict';
// Резервные копии перед отладочными сбросами (0.34.0, задание 4).
//
// Копия лежит в <папка данных>\debug-backups\<ГГГГ-ММ-ДД_ЧЧ-ММ-СС>-<вид>\.
// Внутри — settings.json со всеми .bak, lic-clock.dat, requests.json, today.json
// (очередь с позицией, с R2 живёт отдельным файлом), значение реестра lcm
// (registry-lcm.txt) и meta.json (вид, дата, версия Тапёра).
// Храним 5 последних копий ВООБЩЕ (не на вид), старые удаляем.
//
// Модуль без require('electron') на верхнем уровне и без прямых обращений к реестру
// в тестах: чтение реестра подменяется через setup({ readReg }). Сам он к реестру
// только читает (запись при восстановлении делает main.js и только в обычном профиле).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const KINDS = ['settings', 'license', 'trial', 'encoding'];
const KEEP = 5;
const DIR_NAME = 'debug-backups';
const REG_KEY = 'HKCU\\Software\\Tapyor';
const REG_VAL = 'lcm';
const NAME_RX = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(settings|license|trial|encoding)(?:-(\d+))?$/;
const BAK_RX = /^settings\.json\.bak(?:\.\d+)?$/;
const REG_TEXT = 'не прочитано';

let cfg = {
  userData: '',
  appVersion: '',
  readReg: defaultReadReg,
  now: () => new Date(),
  log: () => {}
};

function setup(o) {
  const v = o || {};
  cfg = {
    userData: v.userData ? path.resolve(v.userData) : '',
    appVersion: v.appVersion ? String(v.appVersion) : '',
    readReg: typeof v.readReg === 'function' ? v.readReg : defaultReadReg,
    now: typeof v.now === 'function' ? v.now : (() => new Date()),
    log: typeof v.log === 'function' ? v.log : (() => {})
  };
}

function defaultReadReg() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ ok: false, value: '' }); return; }
    try {
      execFile('reg.exe', ['query', REG_KEY, '/v', REG_VAL], { timeout: 5000, windowsHide: true }, (err, out) => {
        if (err) { resolve({ ok: false, value: '' }); return; }
        const m = /lcm\s+REG_SZ\s+(\d+)/i.exec(String(out || ''));
        resolve(m ? { ok: true, value: m[1] } : { ok: false, value: '' });
      });
    } catch (e) { resolve({ ok: false, value: '' }); }
  });
}

function rootDir() { return path.join(cfg.userData, DIR_NAME); }
function two(n) { return n < 10 ? '0' + n : String(n); }
function stamp(d) {
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
    + '_' + two(d.getHours()) + '-' + two(d.getMinutes()) + '-' + two(d.getSeconds());
}
function validKind(kind) { return KINDS.indexOf(kind) >= 0; }
function validId(id) {
  return typeof id === 'string' && NAME_RX.test(id) && path.basename(id) === id;
}
function metaAt(id) {
  const m = NAME_RX.exec(id);
  if (!m) return 0;
  // запасной вариант, если meta.json не прочитался: имя хранит местное время
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

function readMeta(dir, id) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (e) {}
  const m = NAME_RX.exec(id);
  return { kind: m ? m[7] : '', at: metaAt(id), date: m ? new Date(metaAt(id)).toISOString() : '', version: '' };
}

// Список копий, новые сверху. Читает только папку данных.
function list() {
  if (!cfg.userData) return [];
  const root = rootDir();
  let names = [];
  try { names = fs.readdirSync(root); } catch (e) { return []; }
  const out = [];
  for (const id of names) {
    if (!NAME_RX.test(id)) continue;
    const dir = path.join(root, id);
    let st = null;
    try { st = fs.lstatSync(dir); } catch (e) { continue; }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    const meta = readMeta(dir, id);
    // «Старее/новее» — по времени создания каталога, а не по meta.at: часы могли
    // перевести назад (аудит 0.34.0, A5). meta.at остаётся только для показа даты.
    const born = Number(st.birthtimeMs) || Number(st.ctimeMs) || Number(meta.at) || metaAt(id);
    out.push({
      id: id,
      kind: validKind(meta.kind) ? meta.kind : NAME_RX.exec(id)[7],
      at: Number(meta.at) || metaAt(id),
      born: born,
      date: meta.date || '',
      version: meta.version || '',
      dir: dir
    });
  }
  out.sort((a, b) => (b.born - a.born) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return out;
}

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch (e) { return false; }
}

// Оставляем ровно 5 последних копий (вообще, не на вид). Только что созданную
// (excludeId) не удаляем никогда: даже при сбитых часах она должна остаться.
function prune(excludeId) {
  const all = list();
  let removed = 0;
  for (let i = KEEP; i < all.length; i++) {
    if (excludeId && all[i].id === excludeId) continue;
    if (removeDir(all[i].dir)) removed++;
  }
  return removed;
}

function copyIf(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.copyFileSync(src, dst);
    return true;
  } catch (e) {
    try { cfg.log('отладка: файл копии «' + path.basename(dst) + '» не скопирован — ' + ((e && e.message) || e)); } catch (e2) {}
    return false;
  }
}

// Снять копию и вернуть { ok, id, dir, meta }. Перед вызовом настройки должны быть
// уже записаны на диск (main.js делает flush), иначе копия отстанет на 400 мс.
async function snapshot(kind) {
  if (!validKind(kind)) throw new Error('неизвестный вид копии');
  if (!cfg.userData) throw new Error('не задана папка данных');
  const ud = cfg.userData;
  const at = cfg.now();
  const root = rootDir();
  fs.mkdirSync(root, { recursive: true });
  let id = stamp(at) + '-' + kind;
  let n = 2;
  while (fs.existsSync(path.join(root, id))) { id = stamp(at) + '-' + kind + '-' + n; n++; }
  const dir = path.join(root, id);
  fs.mkdirSync(dir);

  const files = [];
  if (copyIf(path.join(ud, 'settings.json'), path.join(dir, 'settings.json'))) files.push('settings.json');
  let names = [];
  try { names = fs.readdirSync(ud); } catch (e) {}
  for (const f of names) {
    if (!BAK_RX.test(f)) continue;
    if (copyIf(path.join(ud, f), path.join(dir, f))) files.push(f);
  }
  if (copyIf(path.join(ud, 'lic-clock.dat'), path.join(dir, 'lic-clock.dat'))) files.push('lic-clock.dat');
  if (copyIf(path.join(ud, 'requests.json'), path.join(dir, 'requests.json'))) files.push('requests.json');
  // Очередь с позицией: без неё после «Вернуть» очередь не вернётся (R2).
  if (copyIf(path.join(ud, 'today.json'), path.join(dir, 'today.json'))) files.push('today.json');

  let reg = { ok: false, value: '' };
  try { reg = await cfg.readReg(); } catch (e) { reg = { ok: false, value: '' }; }
  const regOk = !!(reg && reg.ok && reg.value != null && String(reg.value) !== '');
  fs.writeFileSync(path.join(dir, 'registry-lcm.txt'), regOk ? String(reg.value) : REG_TEXT, 'utf8');

  files.push('registry-lcm.txt', 'meta.json');
  const meta = {
    kind: kind,
    at: at.getTime(),
    date: at.toISOString(),
    version: cfg.appVersion,
    registryRead: regOk,
    files: files
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  const removed = prune(id);
  cfg.log('отладка: копия ' + id + ' (файлов: ' + files.length + (removed ? ', убрано старых: ' + removed : '') + ')');
  // Последняя страховка: сброс продолжается, только если копия реально на диске.
  if (!fs.existsSync(dir)) return { ok: false, id: id, dir: dir, meta: meta, error: 'копия исчезла при уборке' };
  return { ok: true, id: id, dir: dir, meta: meta };
}

// Восстановить файлы копии. Возвращает { ok, id, kind, registry } — registry равен
// числу, только если в копии есть прочитанное значение. Запись в реестр — дело main.js.
function restore(id) {
  if (!validId(id)) throw new Error('неизвестная копия');
  const dir = path.join(rootDir(), id);
  const settings = path.join(dir, 'settings.json');
  if (!fs.existsSync(settings)) throw new Error('в копии нет settings.json');
  const meta = readMeta(dir, id);
  const ud = cfg.userData;
  fs.mkdirSync(ud, { recursive: true });

  // Текущие .bak убираем, чтобы после восстановления store не поднял обрывки нового сброса.
  let names = [];
  try { names = fs.readdirSync(ud); } catch (e) {}
  for (const f of names) {
    if (!BAK_RX.test(f)) continue;
    try { fs.unlinkSync(path.join(ud, f)); } catch (e) {}
  }
  // settings.json и все .bak из копии — байт-в-байт.
  fs.copyFileSync(settings, path.join(ud, 'settings.json'));
  let snapNames = [];
  try { snapNames = fs.readdirSync(dir); } catch (e) {}
  for (const f of snapNames) {
    if (!BAK_RX.test(f)) continue;
    fs.copyFileSync(path.join(dir, f), path.join(ud, f));
  }
  if (fs.existsSync(path.join(dir, 'lic-clock.dat'))) {
    try { fs.copyFileSync(path.join(dir, 'lic-clock.dat'), path.join(ud, 'lic-clock.dat')); } catch (e) { cfg.log('отладка: защита часов не восстановлена — ' + ((e && e.message) || e)); }
  }
  if (fs.existsSync(path.join(dir, 'requests.json'))) {
    try { fs.copyFileSync(path.join(dir, 'requests.json'), path.join(ud, 'requests.json')); } catch (e) { cfg.log('отладка: заказы не восстановлены — ' + ((e && e.message) || e)); }
  }
  // today.json возвращаем, если он был в копии. Если его там нет (копия старше R2) —
  // текущий файл не трогаем: очередь могла быть записана уже после снятия копии.
  if (fs.existsSync(path.join(dir, 'today.json'))) {
    try { fs.copyFileSync(path.join(dir, 'today.json'), path.join(ud, 'today.json')); } catch (e) {}
  }

  let registry = null;
  try {
    const txt = String(fs.readFileSync(path.join(dir, 'registry-lcm.txt'), 'utf8')).trim();
    if (/^\d+$/.test(txt)) registry = Number(txt);
  } catch (e) {}

  cfg.log('отладка: восстановлена копия ' + id + ' (' + (meta.kind || '?') + ')');
  return { ok: true, id: id, kind: validKind(meta.kind) ? meta.kind : '', registry: registry };
}

// Готова ли копия к тому, чтобы после неё делать сброс: папка есть и не пустая.
// main.js проверяет это перед сбросом (аудит 0.34.0, A5): без копии сбрасывать нельзя.
function snapshotReady(snap) {
  if (!snap || !snap.ok || !snap.dir) return false;
  try { return fs.existsSync(path.join(snap.dir, 'meta.json')); } catch (e) { return false; }
}

module.exports = { setup, list, snapshot, restore, prune, snapshotReady, rootDir, KINDS, KEEP };
