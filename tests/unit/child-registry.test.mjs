// R12, п. 1: учёт дочерних yt-dlp. При выходе Тапёра живые процессы гасятся сразу,
// а не висят до своего тайм-аута (до 60 с). Подделки повторяют то, что важно:
// завершившийся ребёнок, живой, и тот, у кого kill() бросает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const reg = require('../../src/child-registry.js');

function fakeChild(opts) {
  const o = opts || {};
  const c = new EventEmitter();
  c.exitCode = o.exitCode === undefined ? null : o.exitCode;
  c.killed = false;
  c.kills = 0;
  c.kill = function () {
    if (o.throwOnKill) throw new Error('нельзя убить');
    c.kills++;
    c.killed = true;
    return o.killResult === undefined ? true : o.killResult;
  };
  return c;
}

test('учёт: добавленный процесс убивается, снятый — нет', () => {
  const lines = [];
  const r = reg.create({ log: (m) => lines.push(m) });
  const a = fakeChild();
  const b = fakeChild();
  r.track(a);
  r.track(b);
  assert.equal(r.size(), 2);
  // b завершился сам — снимаем (это делает и событие close)
  r.untrack(b);
  const res = r.killAll();
  assert.equal(a.kills, 1, 'живой процесс убит один раз');
  assert.equal(b.kills, 0, 'снятый процесс не трогаем');
  assert.equal(res.killed, 1);
  assert.equal(res.failed, 0);
  assert.ok(lines.some((m) => /убито 1/.test(m)), 'в журнал попало число убитых: ' + lines.join(' | '));
});

test('учёт: событие close снимает процесс с учёта', () => {
  const r = reg.create({ log: () => {} });
  const a = fakeChild();
  r.track(a);
  a.emit('close');
  assert.equal(r.size(), 0);
  r.killAll();
  assert.equal(a.kills, 0);
});

test('killAll: уже завершённый ребёнок не убивается', () => {
  const r = reg.create({ log: () => {} });
  const done = fakeChild({ exitCode: 0 });
  const killedBefore = fakeChild();
  killedBefore.killed = true;
  r.track(done);
  r.track(killedBefore);
  const res = r.killAll();
  assert.equal(done.kills, 0);
  assert.equal(killedBefore.kills, 0);
  assert.deepEqual(res, { killed: 0, failed: 0 });
});

test('killAll: бросающий kill не роняет выход, а попадает в счёт', () => {
  const lines = [];
  const r = reg.create({ log: (m) => lines.push(m) });
  const bad = fakeChild({ throwOnKill: true });
  const good = fakeChild();
  r.track(bad);
  r.track(good);
  let res;
  assert.doesNotThrow(() => { res = r.killAll(); });
  assert.equal(good.kills, 1, 'остальные всё равно убиты');
  assert.equal(res.killed, 1);
  assert.equal(res.failed, 1);
  assert.ok(lines.some((m) => /не удалось 1/.test(m)), 'сбой виден в журнале: ' + lines.join(' | '));
});

test('killAll: kill() вернул false — процесс не считается убитым', () => {
  const r = reg.create({ log: () => {} });
  const c = fakeChild({ killResult: false });
  r.track(c);
  const res = r.killAll();
  assert.equal(res.killed, 0);
  assert.equal(res.failed, 1);
});

test('killAll: пустой учёт — тихо и без ошибок', () => {
  const r = reg.create();
  assert.doesNotThrow(() => r.killAll());
  assert.equal(r.size(), 0);
});

// Все запуски yt-dlp должны проходить через учёт: иначе при выходе такой процесс
// снова останется висеть. Голый execFile разрешён только внутри помощника execTracked.
test('ytdlp.js: нет запусков yt-dlp в обход учёта', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const src = fs.readFileSync(path.join(root, 'src', 'main', 'ytdlp.js'), 'utf8');
  const bare = src.split(/\r?\n/)
    .filter((line) => /\bexecFile\s*\(/.test(line))
    .filter((line) => !/const child = execFile\s*\(/.test(line));
  assert.deepEqual(bare.map((s) => s.trim()), [], 'каждый запуск — через execTracked');
  assert.ok((src.match(/\bexecTracked\s*\(/g) || []).length >= 7, 'помощник и шесть мест запуска');
});
