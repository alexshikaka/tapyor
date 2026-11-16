import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTags } from '../../src/tags.js';

test('обрезанные файлы не роняют чтение тегов', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-tags-'));
  const files = {
    'bad.mp3': Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x7f', 'latin1'), // обещан огромный тег, тела нет
    'bad.flac': Buffer.concat([Buffer.from('fLaC', 'latin1'), Buffer.from([0, 0, 0, 4, 1, 2, 3, 4])]),
    'bad.ogg': Buffer.from('OggS', 'latin1'),
    'bad.wav': Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ', 'latin1'), Buffer.from([2, 0, 0, 0, 1, 2])]),
    'bad.m4a': Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('ftypM4A ', 'latin1'), Buffer.from([0, 0, 0, 0])])
  };
  try {
    for (const [name, data] of Object.entries(files)) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, data);
      const t = await readTags(p);
      assert.equal(typeof t.title, 'string');
      assert.equal(typeof t.artist, 'string');
      assert.ok(t.seconds >= 0);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
