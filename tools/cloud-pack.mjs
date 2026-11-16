// G-07: упаковка облачных функций в ZIP — для выкладки из Cloud Shell.
//
// Зачем: общий код (лимит частоты, общий ключ, адрес клиента, ответ, разбор тела) живёт в одном месте —
// server/common/*.js. В репозитории он не дублируется по функциям, а попадает в каждую функцию при
// упаковке: получается dist/cloud/<имя>/<файлы функции + common/> и рядом dist/cloud/<имя>.zip.
// Поэтому архив — единственное, что реально уезжает в облако, и тесты проверяют именно собранное.
//
// Своя запись ZIP нужна, чтобы не тянуть зависимость: zlib уже встроен, формат простой (deflate + каталог).
//
// Команда: node tools/cloud-pack.mjs [--out dist/cloud] [--no-zip] [--quiet]
// Печатает: имя функции, сколько файлов, размер архива.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER = path.join(ROOT, 'server');
const COMMON = path.join(SERVER, 'common');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'cloud');

// Что вообще может лежать в папке функции (архивы и мусор не берём)
const KEEP = new Set(['.js', '.json', '.md', '.yql', '.sql']);

// ── ZIP без зависимостей ─────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Время в формате DOS (как требует ZIP): дата и время файла
function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

// entries: [{ name, data:Buffer, mtime:Date }] — имена с прямыми слэшами, без ведущего слэша
export function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const packed = zlib.deflateRawSync(e.data, { level: 9 });
    const method = packed.length < e.data.length ? 8 : 0; // мелочь выгоднее хранить как есть
    const body = method === 8 ? packed : e.data;
    const { time, date } = dosTime(e.mtime || new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // версия для распаковки
    local.writeUInt16LE(0, 6);         // флаги
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);        // extra

    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);           // версия, которой создан
    cd.writeUInt16LE(20, 6);           // версия для распаковки
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);           // extra
    cd.writeUInt16LE(0, 32);           // comment
    cd.writeUInt16LE(0, 34);           // диск
    cd.writeUInt16LE(0, 36);           // внутренние атрибуты
    cd.writeUInt32LE(0, 38);           // внешние атрибуты
    cd.writeUInt32LE(offset, 42);      // где начинается local header
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([Buffer.concat(chunks), cdBuf, eocd]);
}

// ── Сборка ───────────────────────────────────────────────────────────────────

// Имена функций — папки в server/, кроме common и прочего не-функционального
export function functionNames() {
  return fs.readdirSync(SERVER, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'common' && !d.name.startsWith('.'))
    .map((d) => d.name)
    .filter((n) => fs.existsSync(path.join(SERVER, n, 'index.js')))
    .sort();
}

// Файлы одной функции: её собственные + common/ (плоская копия папки)
export function functionFiles(name) {
  const dir = path.join(SERVER, name);
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!f.isFile()) continue;
    if (!KEEP.has(path.extname(f.name).toLowerCase())) continue;
    out.push({ rel: f.name, from: path.join(dir, f.name) });
  }
  if (fs.existsSync(COMMON)) {
    for (const f of fs.readdirSync(COMMON, { withFileTypes: true })) {
      if (!f.isFile() || !KEEP.has(path.extname(f.name).toLowerCase())) continue;
      out.push({ rel: 'common/' + f.name, from: path.join(COMMON, f.name) });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// Разложить функцию по папке: dist/cloud/<имя>/… — ровно то, что попадёт в архив
export function stageFunction(name, outDir) {
  const dir = path.join(outDir, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = functionFiles(name);
  for (const f of files) {
    const to = path.join(dir, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f.from, to);
  }
  return files.map((f) => path.join(dir, f.rel));
}

// Собрать всё: папки и архивы. Возвращает [{ name, files, zip, size }]
export function packAll(opts = {}) {
  const outDir = opts.out || DEFAULT_OUT;
  const zip = opts.zip !== false;
  fs.mkdirSync(outDir, { recursive: true });
  const names = opts.names || functionNames();
  const result = [];
  for (const name of names) {
    const staged = stageFunction(name, outDir);
    let zipPath = '';
    let size = 0;
    if (zip) {
      const entries = staged.map((p) => ({
        name: path.relative(path.join(outDir, name), p).split(path.sep).join('/'),
        data: fs.readFileSync(p),
        mtime: fs.statSync(p).mtime
      }));
      const buf = makeZip(entries);
      zipPath = path.join(outDir, name + '.zip');
      fs.writeFileSync(zipPath, buf);
      size = buf.length;
    }
    result.push({ name, files: staged.map((p) => path.relative(path.join(outDir, name), p).split(path.sep).join('/')), zip: zipPath, size });
  }
  return result;
}

// ── Команда ──────────────────────────────────────────────────────────────────

function main(argv) {
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : ''; };
  const out = arg('--out') || DEFAULT_OUT;
  const zip = !argv.includes('--no-zip');
  const quiet = argv.includes('--quiet');

  const list = packAll({ out, zip });
  if (!quiet) {
    const rel = path.relative(ROOT, out) || out;
    for (const f of list) {
      const kb = (f.size / 1024).toFixed(1);
      console.log(f.name + ': файлов ' + f.files.length + (zip ? ', архив ' + kb + ' КБ' : '') + ' → ' + path.join(rel, f.name + (zip ? '.zip' : '')));
    }
    console.log('готово: ' + list.length + ' функций в ' + rel);
  }
  return list;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
