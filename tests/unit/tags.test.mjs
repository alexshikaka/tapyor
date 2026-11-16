// T1: тесты tags.js — чтение тегов, обложек и длительности без сторонних библиотек.
// Файлы собираются в памяти и пишутся во временную папку, после теста убираются.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tags = require('../../src/tags.js');

const dirs = [];
function tmpFile(name, buf) {
  const dir = mkdtempSync(join(tmpdir(), 'tapyor-tags-'));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, buf);
  return file;
}
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };

function id3Frame(id, payload, ver) {
  if (ver === 2) {
    const size = payload.length;
    return Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from([(size >> 16) & 255, (size >> 8) & 255, size & 255]), payload]);
  }
  return Buffer.concat([Buffer.from(id, 'latin1'), be32(payload.length), Buffer.from([0, 0]), payload]);
}
function textFrame(id, text, enc, ver) {
  return id3Frame(id, Buffer.concat([Buffer.from([enc]), enc === 1 ? Buffer.from('\uFEFF', 'utf16le') : Buffer.from(String(text), enc === 1 ? 'utf16le' : 'utf8')]), ver);
}
function id3(ver, frames, flags) {
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([ver, 0, flags || 0]), syncsafe(body.length), body]);
}

// ---------- константы ----------

test('tags: расширения аудио, видео и общий список без повторов', () => {
  for (const e of ['.mp3', '.flac', '.wav', '.m4a', '.ogg']) assert.ok(tags.AUDIO_EXT.includes(e), e);
  for (const e of ['.mp4', '.webm', '.mkv']) assert.ok(tags.VIDEO_EXT.includes(e), e);
  assert.equal(new Set(tags.MEDIA_EXT).size, tags.MEDIA_EXT.length);
  for (const e of tags.AUDIO_EXT) assert.ok(tags.MEDIA_EXT.includes(e));
  for (const e of tags.VIDEO_EXT) assert.ok(tags.MEDIA_EXT.includes(e));
});

// ---------- WAV ----------

function wavBuffer() {
  const sampleRate = 44100, byteRate = 44100, dataLen = 44100;
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'latin1');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);       // PCM
  fmt.writeUInt16LE(1, 10);      // моно
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(byteRate, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);

  const info = (id, value) => {
    const v = Buffer.from(value + '\0', 'utf8');
    const b = Buffer.alloc(8 + v.length + (v.length & 1)); // RIFF: нечётная длина добивается нулём
    b.write(id, 0, 'latin1'); b.writeUInt32LE(v.length, 4); v.copy(b, 8);
    return b;
  };
  const listBody = Buffer.concat([Buffer.from('INFO', 'latin1'), info('INAM', 'Группа крови'), info('IART', 'Кино'), info('IPRD', 'Лучшее'), info('ICRD', '2024')]);
  const list = Buffer.concat([Buffer.from('LIST', 'latin1'), le32(listBody.length), listBody]);
  const data = Buffer.alloc(8 + dataLen);
  data.write('data', 0, 'latin1'); data.writeUInt32LE(dataLen, 4);
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, list, data]);
  const riff = Buffer.concat([Buffer.from('RIFF', 'latin1'), le32(body.length), body]);
  return riff;
}

test('tags.readTags: WAV — название, исполнитель, альбом, год и длительность', async () => {
  const file = tmpFile('a.wav', wavBuffer());
  const t = await tags.readTags(file);
  assert.equal(t.title, 'Группа крови');
  assert.equal(t.artist, 'Кино');
  assert.equal(t.album, 'Лучшее');
  assert.equal(t.year, 2024);
  assert.equal(t.seconds, 1);
  assert.equal(t.hasCover, false);
});

test('tags.readCover: WAV без обложки — null', async () => {
  const file = tmpFile('b.wav', wavBuffer());
  assert.equal(await tags.readCover(file), null);
});

// ---------- MP3 / ID3v2 ----------

function mp3Id3v23() {
  const frames = [
    textFrame('TIT2', 'Группа крови', 3, 3),
    textFrame('TPE1', 'Кино', 3, 3),
    textFrame('TALB', 'Лучшее', 3, 3),
    textFrame('TYER', '2024', 3, 3),
    textFrame('TRCK', '3/10', 3, 3),
    textFrame('TLEN', '210000', 3, 3),
    id3Frame('TXXX', Buffer.concat([Buffer.from([3]), Buffer.from('REPLAYGAIN_TRACK_GAIN\0'), Buffer.from('-7.5 dB', 'utf8')]), 3),
    id3Frame('APIC', Buffer.concat([
      Buffer.from([3]), Buffer.from('image/jpeg\0', 'latin1'), Buffer.from([3]), Buffer.from('\0', 'latin1'),
      Buffer.from('JPEGDATA', 'latin1'),
    ]), 3),
  ];
  return Buffer.concat([id3(3, frames), Buffer.alloc(2000)]);
}

test('tags.readTags: MP3 ID3v2.3 — теги, год, номер, длина, усиление и обложка', async () => {
  const file = tmpFile('a.mp3', mp3Id3v23());
  const t = await tags.readTags(file);
  assert.equal(t.title, 'Группа крови');
  assert.equal(t.artist, 'Кино');
  assert.equal(t.album, 'Лучшее');
  assert.equal(t.year, 2024);
  assert.equal(t.track, 3);
  assert.equal(t.seconds, 210);
  assert.equal(t.gain, -7.5);
  assert.equal(t.hasCover, true);
});

test('tags.readCover: обложка из APIC отдаётся с типом и данными', async () => {
  const file = tmpFile('b.mp3', mp3Id3v23());
  const cover = await tags.readCover(file);
  assert.equal(cover.mime, 'image/jpeg');
  assert.equal(cover.data.toString('utf8'), 'JPEGDATA');
});

test('tags.readTags: MP3 ID3v2.2 (трёхбуквенные кадры)', async () => {
  const frames = [textFrame('TT2', 'Песня', 3, 2), textFrame('TP1', 'Кто-то', 3, 2)];
  const file = tmpFile('v22.mp3', Buffer.concat([id3(2, frames), Buffer.alloc(500)]));
  const t = await tags.readTags(file);
  assert.equal(t.title, 'Песня');
  assert.equal(t.artist, 'Кто-то');
});

test('tags.readTags: старый mp3 с тегом ID3v1 и кириллицей cp1251', async () => {
  const v1 = Buffer.alloc(128);
  v1.write('TAG', 0, 'latin1');
  // cp1251: «Группа крови» и «Кино»
  Buffer.from([0xC3, 0xF0, 0xF3, 0xEF, 0xEF, 0xE0, 0x20, 0xEA, 0xF0, 0xEE, 0xE2, 0xE8]).copy(v1, 3);
  Buffer.from([0xCA, 0xE8, 0xED, 0xEE]).copy(v1, 33);
  Buffer.from('2020', 'latin1').copy(v1, 93);
  v1[125] = 0; v1[126] = 7;
  const file = tmpFile('v1.mp3', Buffer.concat([Buffer.alloc(500), v1]));
  const t = await tags.readTags(file);
  assert.equal(t.title, 'Группа крови');
  assert.equal(t.artist, 'Кино');
  assert.equal(t.year, 2020);
  assert.equal(t.track, 7);
});

test('tags._test.parseId3: не-ID3 и обрезанный заголовок — null/пусто, без исключения', () => {
  assert.equal(tags._test.parseId3(Buffer.from('RIFF....'), false), null);
  assert.equal(tags._test.parseId3(Buffer.from('ID3'), false), null);
  const empty = tags._test.parseId3(Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(0)]), false);
  assert.equal(empty.title, '');
  assert.equal(empty.artist, '');
});

test('tags._test.mp3Duration: кадр Xing даёт длительность по числу кадров', () => {
  const frame = Buffer.alloc(200);
  frame[0] = 0xFF; frame[1] = 0xFB; // MPEG1 Layer III
  frame[2] = 0x90;                  // битрейт 128, частота 44100
  frame[3] = 0x44;                  // моно
  frame.write('Xing', 36, 'latin1');
  frame.writeUInt32BE(1, 40);       // есть поле кадров
  frame.writeUInt32BE(1000, 44);
  const sec = tags._test.mp3Duration(frame, 0, 100000);
  assert.ok(Math.abs(sec - 1000 * 1152 / 44100) < 0.001, 'длительность ' + sec);
  assert.equal(tags._test.mp3Duration(Buffer.alloc(100), 0, 100), 0, 'без кадра — 0');
});

// ---------- FLAC ----------

function flacBuffer() {
  const streaminfo = Buffer.alloc(34);
  streaminfo[10] = 0x0A; streaminfo[11] = 0xC4; streaminfo[12] = 0x40; // 44100 Гц
  streaminfo.writeUInt32BE(441000, 14);                                 // 10 секунд
  const hStream = Buffer.from([0x00, 0x00, 0x00, 34]);                  // не последний, тип 0
  const comments = [];
  const add = (k, v) => { const s = Buffer.from(k + '=' + v, 'utf8'); comments.push(Buffer.concat([le32(s.length), s])); };
  add('TITLE', 'Группа крови');
  add('ARTIST', 'Кино');
  add('ALBUM', 'Лучшее');
  add('DATE', '2024');
  add('TRACKNUMBER', '3');
  add('REPLAYGAIN_TRACK_GAIN', '+2.5 dB');
  const vendor = le32(0);
  const n = le32(comments.length);
  const vcBody = Buffer.concat([vendor, n, ...comments]);
  const hVc = Buffer.from([0x84, 0x00, 0x00, 0x00]); // последний, тип 4
  hVc.writeUIntBE(vcBody.length, 1, 3);
  return Buffer.concat([Buffer.from('fLaC', 'latin1'), hStream, streaminfo, hVc, vcBody]);
}

test('tags.readTags: FLAC — STREAMINFO и Vorbis-комментарии', async () => {
  const file = tmpFile('a.flac', flacBuffer());
  const t = await tags.readTags(file);
  assert.equal(t.title, 'Группа крови');
  assert.equal(t.artist, 'Кино');
  assert.equal(t.album, 'Лучшее');
  assert.equal(t.year, 2024);
  assert.equal(t.track, 3);
  assert.equal(t.gain, 2.5);
  assert.equal(t.seconds, 10);
});

test('tags.readTags: испорченный FLAC не бросает', async () => {
  const file = tmpFile('bad.flac', Buffer.from('fLaC\x00\x00\x00\x22короткий', 'latin1'));
  const t = await tags.readTags(file);
  assert.equal(t.title, '');
  assert.equal(t.seconds, 0);
});

// ---------- мусор и отсутствующий файл ----------

test('tags.readTags: случайный мусор и пустой файл не бросают', async () => {
  for (const buf of [Buffer.alloc(0), Buffer.from('не музыка'), Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x05abc')]) {
    const file = tmpFile('junk.bin', buf);
    const t = await tags.readTags(file);
    assert.equal(t.title, '');
    assert.equal(t.artist, '');
    assert.equal(t.seconds, 0);
  }
});

test('tags.readTags: отсутствующий файл — понятная ошибка, а не тихий ноль', async () => {
  await assert.rejects(() => tags.readTags(join(tmpdir(), 'tapyor-нет-такого-файла-12345.mp3')));
});
