import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { pick, choose, inspect, better } = require('../../src/select.js');

const t = (src, id, title, author, seconds = 0) => ({ src, id, title, author, seconds });
const pickTitle = (cands, msg, opts) => {
  const r = pick(cands, msg, opts);
  return r && (r.track.author + ' — ' + r.track.title);
};

test('select: Pussy выше одноимённого Rammstein', () => {
  const c = [t('ym', 'r', 'Rammstein', 'Rammstein', 266), t('ym', 'p', 'Pussy', 'Rammstein', 239)];
  assert.equal(pickTitle(c, 'Rammstein pussy'), 'Rammstein — Pussy');
});

test('select: одноимённый трек допустим, если название не просили', () => {
  const c = [t('ym', 'r', 'Rammstein', 'Rammstein', 266)];
  assert.equal(pickTitle(c, 'Rammstein'), 'Rammstein — Rammstein');
});

test('select: Kosandra с Яндекса выше YouTube-канала', () => {
  const c = [
    t('ym', 'k', 'Kosandra', 'Miyagi & Andy Panda', 221),
    t('yt', 'h', 'Miyagi & Andy Panda - Kosandra (Official Audio)', 'Hajime', 221)
  ];
  assert.equal(pickTitle(c, 'Miyagy kosandra'), 'Miyagi & Andy Panda — Kosandra');
});

test('select: длинный YouTube не обходит Яндекс', () => {
  const c = [
    t('ym', 'd', 'DEUTSCHLAND', 'Rammstein', 0),
    t('yt', 'o', 'Rammstein - Deutschland (Official Video)', 'Rammstein Official', 563)
  ];
  assert.equal(pickTitle(c, 'Rammstein Deutschland', { maxSec: 420 }), 'Rammstein — DEUTSCHLAND');
});

test('select: азербайджанское название без исполнителя', () => {
  const c = [t('ym', 'n', 'Nə Qədər Qoca Olsam', 'Babak Radmanesh', 126)];
  const r = pick(c, 'Nə Qədər Qoca Olsam Da');
  assert.equal(r.track.title, 'Nə Qədər Qoca Olsam');
  assert.ok(r.info.tier >= 3);
});

test('select: фраза в середине сообщения', () => {
  const c = [t('ym', 'p', 'Pussy', 'Rammstein', 239)];
  assert.equal(pickTitle(c, 'поставь Rammstein pussy пожалуйста'), 'Rammstein — Pussy');
});

test('select: версия/канал не должны давать titleOnlyArtist', () => {
  const c = [t('yt', 'x', 'Rammstein - Deutschland (Official Video)', 'Rammstein Official', 563)];
  const r = inspect(c[0], 'Rammstein Deutschland', { maxSec: 420 });
  assert.equal(r.titleOnlyArtist, false);
  assert.ok(r.long);
});

test('select: choose не отдаёт YouTube при сильном Яндексе', () => {
  const c = [
    t('ym', 'd', 'DEUTSCHLAND', 'Rammstein', 0),
    t('yt', 'o', 'Rammstein - Deutschland (Official Video)', 'Rammstein Official', 563)
  ];
  const r = choose(c, 'Rammstein Deutschland', { maxSec: 420 });
  assert.equal(r.track.src, 'ym');
});

test('select: better не ломает выбранный трек случайным +0.01', () => {
  const old = { candidate: t('ym', 'a', 'Песня', 'Артист'), score: 0.80 };
  const neu = { candidate: t('ym', 'b', 'Песня', 'Другой'), score: 0.81 };
  assert.equal(better(neu, old, 'Песня'), false);
});

test('select: выключенный Яндекс не выбирается', () => {
  const c = [
    t('ym', 'y', 'Песня', 'Артист'),
    t('yt', 'v', 'Песня', 'Артист')
  ];
  const r = pick(c, 'Артист Песня', { enabled: { ym: false, yt: true } });
  assert.equal(r.track.src, 'yt');
});

test('select: выключенные все источники → null', () => {
  const c = [t('ym', 'y', 'Песня', 'Артист')];
  assert.equal(pick(c, 'Артист Песня', { enabled: { ym: false } }), null);
});

test('select: local учитывает выключатель lc', () => {
  const c = [t('local', 'l', 'Песня', 'Артист'), t('ym', 'y', 'Песня', 'Артист')];
  const r = pick(c, 'Артист Песня', { enabled: { lc: false, ym: true } });
  assert.equal(r.track.src, 'ym');
});

test('select: French version не обходит оригинал', () => {
  const c = [
    t('sc', 's', 'Журек АДАМ', 'SLOIVO', 197),
    t('yt', 'y', 'Adam-Zhurek (French version)', 'MUSIC MANIA', 185)
  ];
  assert.equal(pickTitle(c, 'Адам Журек'), 'SLOIVO — Журек АДАМ');
});

test('select: длинный оригинал не проигрывает короткому каверу', () => {
  const c = [
    t('ym', 'o', 'November Rain', "Guns N' Roses", 537),
    t('ym', 'c', 'November Rain', 'Sweet Little Band', 351)
  ];
  assert.equal(pickTitle(c, "Отличного настроение мореманы!!! Guns N' Roses-november Rain"), "Guns N' Roses — November Rain");
});


