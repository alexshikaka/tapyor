import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ms = require('../../src/match-score.js');

test('match-score: полное название Doom выше короткого Only Eternal', () => {
  const message = 'На футболку Doom Eternal OST - The Only Thing They Fear Is You и Serious Sam';
  const good = ms.scoreCandidate({ message, query: 'Doom Eternal OST The Only Thing They Fear Is You', track: { src: 'yt', title: 'DOOM Eternal OST - The Only Thing They Fear Is You (Mick Gordon)', author: 'DOOM' }, wantsYouTube: true });
  const bad = ms.scoreCandidate({ message, query: 'Eternal OST The Only', track: { src: 'ym', title: 'Only Eternal', author: 'Jackson Scott' }, wantsYouTube: true });
  assert.ok(good.score > bad.score, JSON.stringify({ good, bad }));
});

test('match-score: Инстасамка и За деньги да', () => {
  const x = ms.scoreCandidate({ message: 'Инстасамка. За деньги да', query: 'Инстасамка За деньги да', track: { src: 'ym', title: 'ЗА ДЕНЬГИ ДА', author: 'INSTASAMKA' } });
  assert.ok(x.score > 0.5, String(x.score));
  assert.ok(x.parts.artist > 0);
});

test('match-score: YouTube-бонус не отменяет плохое название', () => {
  const message = 'Кино - Группа крови, ставь на ютубе';
  const good = ms.scoreCandidate({ message, query: 'Кино Группа крови', track: { src: 'yt', title: 'КИНО - ГРУППА КРОВИ', author: 'КИНО' }, wantsYouTube: true });
  const bad = ms.scoreCandidate({ message, query: 'Кино Группа крови', track: { src: 'yt', title: 'Совсем другая песня', author: 'Кто-то' }, wantsYouTube: true });
  assert.ok(good.score > bad.score);
});
test('match-score: версия не получает бонус, запрет — отдельный признак', () => {
  const base = { message: 'Кино Группа крови', query: 'Кино Группа крови', track: { src: 'ym', title: 'Группа крови', author: 'Кино' } };
  const remix = { message: 'Кино Группа крови', query: 'Кино Группа крови', track: { src: 'ym', title: 'Группа крови (Remix)', author: 'Кино' }, allowVersions: true };
  const a = ms.scoreCandidate(base), b = ms.scoreCandidate(remix);
  assert.equal(b.parts.version, true);
  assert.equal(b.parts.versionPenalty, 0);
  assert.equal(ms.isVersion('Группа крови (Remix)'), true);
  assert.equal(ms.isVersion('Группа крови'), false);
});

test('match-score: margin различает близких и далёких кандидатов', () => {
  const close = ms.margin([{ score: 0.84 }, { score: 0.83 }]);
  const far = ms.margin([{ score: 0.84 }, { score: 0.4 }]);
  assert.ok(close < 0.02);
  assert.ok(far > 0.3);
});
