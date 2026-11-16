// Проверка библиотеки: скан, поиск, кэш, атомарное сохранение.
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-lib-'));
  const lib = require('../../src/library');
  lib.setup({ dataDir: base, log: () => {} });
  const music = path.join(base, 'music');
  fs.mkdirSync(music);
  fs.writeFileSync(path.join(music, 'Artist One - First Song.mp3'), Buffer.alloc(16));
  fs.writeFileSync(path.join(music, 'Artist Two - Second Song.flac'), Buffer.alloc(16));

  lib.addFolder(music);
  const r = await lib.scan();
  if (r.count !== 2) throw new Error('scan count ' + r.count);
  if (lib.all().length !== 2) throw new Error('all cache');
  if (lib.search('artist').length !== 2) throw new Error('search artist');
  if (lib.search('second').length !== 1) throw new Error('search second');

  await new Promise((res) => setTimeout(res, 1000));
  const file = path.join(base, 'library.json');
  if (!fs.existsSync(file)) throw new Error('library.json не сохранён');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!saved.files || Object.keys(saved.files).length !== 2) throw new Error('saved files count');
  if (fs.existsSync(file + '.tmp')) throw new Error('остался .tmp');

  fs.writeFileSync(path.join(music, 'Artist Three - Third Song.mp3'), Buffer.alloc(16));
  await lib.scan();
  if (lib.all().length !== 3) throw new Error('cache invalidation');
  if (lib.search('third').length !== 1) throw new Error('search after rescan');

  // видео: индексируется, помечается video, обложка всегда есть (значок с расширением)
  fs.writeFileSync(path.join(music, 'Clip - Live.mkv'), Buffer.alloc(16));
  await lib.scan();
  const v = lib.all().find((t) => t.ext === 'mkv');
  if (!v || !v.video) throw new Error('видео не найдено или не помечено');
  if (!lib.all().every((t) => t.thumb === '/lcover/' + t.id)) throw new Error('обложка не у всех');
  if (lib.isVideo('a.mp3') || !lib.isVideo('a.MOV')) throw new Error('isVideo');
  fs.rmSync(base, { recursive: true, force: true });
  console.log('library: ok');
})().catch((e) => { console.error('library: ' + e.message); process.exit(1); });
