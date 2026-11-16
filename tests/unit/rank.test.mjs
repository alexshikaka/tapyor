// Рейтинг выдачи поиска (src/rank.js). 147 строк решают, какой трек окажется первым,
// а тестов не было ни одного (функц. аудит 01.11, S3). Здесь — «золотые» случаи:
// то, что пользователь ожидает увидеть первым, сформулированное как проверка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const R = createRequire(import.meta.url)('../../src/rank.js');

const CTX = { ymOn: true, ymFull: true, ytOn: true, ytLogged: false, scOn: true, auOn: true, lcOn: true };
const t = (src, id, title, author, extra) => Object.assign({ src, id, title, author, seconds: 210 }, extra || {});
const first = (q, list, mode, ctx) => R.rank(q, list, mode || 'smart', ctx || CTX)[0];

test('rank: оригинал выше кавера, ремикса и «slowed», если о них не просили', () => {
  const list = [
    t('yt', 'c', 'Кино - Группа крови (cover)', 'Someone'),
    t('yt', 's', 'Кино - Группа крови slowed + reverb', 'Edits'),
    t('yt', 'r', 'Кино - Группа крови (remix)', 'DJ'),
    t('yt', 'o', 'Кино - Группа крови', 'Кино'),
  ];
  assert.equal(first('кино группа крови', list).id, 'o');
});

test('rank: попросили ремикс — ремикс не штрафуется', () => {
  const list = [
    t('yt', 'o', 'Кино - Группа крови', 'Кино'),
    t('yt', 'r', 'Кино - Группа крови (remix)', 'DJ'),
  ];
  assert.equal(first('группа крови remix', list).id, 'r');
});

test('rank: одна песня с разных площадок склеивается, остальное — в «другие версии»', () => {
  const list = [
    t('ym', 'y1', 'Группа крови', 'Кино'),
    t('yt', 'v1', 'Кино - Группа крови (Official Video)', 'Кино'),
  ];
  const out = R.rank('группа крови', list, 'smart', CTX);
  assert.equal(out.length, 1, 'одна строка, а не две');
  assert.equal(out[0].alts.length, 1, 'вторая площадка — в alts');
});

test('rank: при равной точности свой файл выше, потом Яндекс, потом YouTube', () => {
  const list = [
    t('yt', 'v', 'Кино - Звезда по имени Солнце', 'Кино'),
    t('ym', 'y', 'Звезда по имени Солнце', 'Кино'),
    t('lc', 'l', 'Звезда по имени Солнце', 'Кино'),
  ];
  // разные площадки одной песни склеятся — смотрим, какая победила
  const top = first('звезда по имени солнце', list);
  assert.equal(top.src, 'lc');
});

test('rank: без Плюса Яндекс — только отрывок, полная версия с другой площадки выше', () => {
  const list = [
    t('ym', 'y', 'Кукушка', 'Кино'),
    t('yt', 'v', 'Кино - Кукушка', 'Кино'),
  ];
  const noPlus = Object.assign({}, CTX, { ymFull: false });
  assert.equal(first('кукушка кино', list, 'smart', noPlus).src, 'yt');
});

test('rank: выключенная площадка — в самом низу', () => {
  const list = [
    t('sc', 's', 'Кукушка', 'Кино'),
    t('ym', 'y', 'Кукушка — другая песня', 'Другой'),
  ];
  const scOff = Object.assign({}, CTX, { scOn: false });
  const out = R.rank('кукушка', list, 'smart', scOff);
  assert.equal(out[out.length - 1].src, 'sc');
});

test('rank: режим «для эфира» опускает часовые записи и концерты', () => {
  const list = [
    t('yt', 'long', 'Кино - Группа крови (полный концерт)', 'Кино', { seconds: 3600 }),
    t('yt', 'live', 'Кино - Группа крови live', 'Кино'),
    t('yt', 'ok', 'Кино - Группа крови', 'Кино'),
  ];
  assert.equal(first('кино группа крови', list, 'air').id, 'ok');
});

test('rank: splitArtists разбирает соавторов', () => {
  const names = R.splitArtists('Баста, Скриптонит feat. Мот').filter((x) => x.name).map((x) => x.name);
  assert.deepEqual(names, ['Баста', 'Скриптонит', 'Мот']);
});
