// П6 аудита: исключение внутри получения потока не должно оставлять вызов без ответа.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ytdlp = require('../../src/main/ytdlp.js');

function makeModule(tmp, execFile) {
  const mod = ytdlp.setup({
    app: { isPackaged: false, getPath: () => tmp, getVersion: () => '0.38.1' },
    fs, path, crypto,
    https: { get: () => new EventEmitter() },
    execFile,
    log: () => {},
    cfg: (k) => (k === 'videoQuality' ? '1080' : ''),
    faultSim: { applyCall: (name, fn) => fn() },
    ytHasCookies: () => false,
    ytCookies: () => ({ args: [], done() {} }),
    fmtDur: () => '',
    streamBusy: { isBusy: () => false },
    srcDir: path.join(tmp, 'src'),
    childRegistry: null
  });
  fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'bin', 'yt-dlp.exe'), 'движок');
  return mod;
}

test('движок падает с исключением — вызов отвечает ошибкой, а не висит', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-hang-'));
  // execFile бросает синхронно: так ведёт себя сломанный/недоступный бинарник.
  const mod = makeModule(tmp, () => { throw new Error('битый движок'); });

  const result = await Promise.race([
    mod.streamViaYtDlp('https://www.youtube.com/watch?v=jNQXAC9IVRw'),
    new Promise((r) => setTimeout(() => r('ВИСИТ'), 5000))
  ]);

  assert.notEqual(result, 'ВИСИТ', 'вызов обязан завершиться');
  assert.match(String(result && result.error), /битый движок|движок YouTube/, 'ошибка объяснена');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('переключение трека гасит текущий процесс получения потока', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-cancel-'));
  let killed = false;
  const child = new EventEmitter();
  child.kill = () => { killed = true; };
  const mod = makeModule(tmp, () => child);

  mod.streamViaYtDlp('https://www.youtube.com/watch?v=jNQXAC9IVRw'); // нарочно не ждём
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(mod.cancelStream(), true, 'отмена сообщает, что остановила процесс');
  assert.equal(killed, true, 'процесс yt-dlp действительно убит');
  assert.equal(mod.cancelStream(), false, 'повторная отмена безвредна');
  fs.rmSync(tmp, { recursive: true, force: true });
});
