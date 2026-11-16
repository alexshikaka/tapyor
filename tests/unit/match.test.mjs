// T1: тесты чистого модуля match.js — разбор строк «Исполнитель — Название»
// и выбор лучшего найденного трека. Сеть, диск и Electron не нужны.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../src/match.js');

// ---------- clean / tokens / norm ----------

test('match.clean: номер строки, длинное тире и скобки уходят из запроса, строка остаётся', () => {
  const r = M.clean('12. Кино - Группа крови (ремикс)');
  assert.equal(r.display, 'Кино - Группа крови (ремикс)');
  assert.equal(r.query, 'Кино Группа крови');
  assert.deepEqual(r.toks, ['кино', 'группа', 'крови']);
});

test('match.clean: мусорные скобки, хэштеги, подчёркивания и «----» вырезаются', () => {
  const r = M.clean('Кино_Группа крови #музыка [www.site.ru] ---- подпись');
  assert.equal(r.display, 'Кино Группа крови');
  assert.equal(r.query, 'Кино Группа крови');
  assert.deepEqual(r.toks, ['кино', 'группа', 'крови']);
});

test('match.clean: пустое, null и одна пунктуация — пустой запрос без исключения', () => {
  for (const v of ['', null, undefined, '   ', '--- ... !!!', '()[]{}']) {
    const r = M.clean(v);
    assert.equal(r.query, '', 'запрос для ' + JSON.stringify(v));
    assert.deepEqual(r.toks, [], 'токены для ' + JSON.stringify(v));
  }
  assert.equal(M.clean(null).line, null, 'исходная строка сохраняется как есть');
});

test('match.clean: «ё» приводится к «е», регистр не важен, юникод-буквы остаются', () => {
  assert.deepEqual(M.tokens('Ёлка — Всё будет хорошо'), ['елка', 'все', 'будет', 'хорошо']);
  assert.deepEqual(M.tokens('Sigur Rós — Hoppípolla'), ['sigur', 'rós', 'hoppípolla'], 'диакритика сохраняется');
  assert.deepEqual(M.tokens('五十音 — テスト'), ['五十音', 'テスト'], 'японские буквы не теряются');
});

test('match.tokens: служебные слова (the, feat, official, клип) не участвуют в поиске', () => {
  assert.deepEqual(M.tokens('The Beatles feat. Someone — Official Video (HD)'), ['beatles', 'someone']);
  assert.deepEqual(M.tokens('Кино — Клип'), ['кино']);
});

test('match.norm: скобки вырезаются вместе с содержимым, лишние знаки — в пробел', () => {
  assert.equal(M.norm('Кино (live) — Группа крови!'), 'кино группа крови');
  assert.equal(M.norm(''), '');
  assert.equal(M.norm(null), '');
});

test('match.clean: очень длинная строка (20000 символов) не бросает и не съедает память', () => {
  const long = 'Кино — ' + 'Группа крови '.repeat(1500);
  const r = M.clean(long);
  assert.ok(r.toks.length > 2);
  assert.equal(r.toks[0], 'кино');
});

// ---------- decide ----------

const q = (s) => M.clean(s);

test('match.decide: точное совпадение названия и исполнителя у Яндекса — exact', () => {
  const d = M.decide(q('Кино — Группа крови'), [{ title: 'Группа крови', author: 'Кино' }], []);
  assert.equal(d.status, 'exact');
  assert.equal(d.track.author, 'Кино');
});

test('match.decide: YouTube покрывает все слова запроса (2+ слова) — exact', () => {
  const d = M.decide(q('Nirvana — Smells Like Teen Spirit'), [],
    [{ title: 'Nirvana - Smells Like Teen Spirit', author: 'Nirvana' }]);
  assert.equal(d.status, 'exact');
  assert.match(d.track.title, /Teen Spirit/);
});

test('match.decide: одно слово запроса на YouTube — не exact, а сомнение (close)', () => {
  const d = M.decide(q('Гроза'), [], [{ title: 'Гроза', author: 'Кто-то' }]);
  assert.equal(d.status, 'close', 'одиночное слово не должно молча становиться точным заказом');
});

test('match.decide: название совпало наполовину и исполнитель найден — close', () => {
  // «live» без скобок остаётся словом названия: 2 из 3 слов совпали, точного уже нет.
  const d = M.decide(q('Кино — Группа крови'), [{ title: 'Группа крови live', author: 'Кино' }], []);
  assert.equal(d.status, 'close');
});

test('match.decide: пустые списки — none и null, без исключения', () => {
  for (const [ym, yt] of [[[], []], [null, null], [undefined, undefined]]) {
    const d = M.decide(q('Кино — Группа крови'), ym, yt);
    assert.equal(d.status, 'none');
    assert.equal(d.track, null);
    assert.deepEqual(d.alts, []);
  }
});

test('match.decide: пустой запрос ничего не подтверждает', () => {
  const d = M.decide(q(''), [{ title: 'Гроза', author: 'Кино' }], [{ title: 'Гроза', author: 'Кино' }]);
  assert.equal(d.status, 'none');
  assert.equal(d.track, null);
});

test('match.decide: выбранный трек не дублируется в «других вариантах»', () => {
  const best = { title: 'Группа крови', author: 'Кино' };
  const d = M.decide(q('Кино — Группа крови'), [best, { title: 'Звезда по имени Солнце', author: 'Кино' }], []);
  assert.equal(d.track, best);
  assert.ok(!d.alts.includes(best), 'выбранный трек не должен попасть в альтернативы');
  assert.equal(d.alts.length, 1);
});

test('match.decide: альтернатив не больше 5 с Яндекса и 4 с YouTube', () => {
  const ym = Array.from({ length: 10 }, (_, i) => ({ title: 'Песня ' + i, author: 'Кино' }));
  const yt = Array.from({ length: 10 }, (_, i) => ({ title: 'Песня ' + i, author: 'Кино' }));
  const d = M.decide(q('Кино — Группа крови'), ym, yt);
  assert.ok(d.alts.length <= 9, 'в альтернативах ' + d.alts.length);
});

test('match.decideOnly: kind=yt не смотрит на Яндекс, и наоборот', () => {
  const ym = [{ title: 'Группа крови', author: 'Кино' }];
  const yt = [{ title: 'Кино - Группа крови', author: 'Кино' }];
  const onlyYt = M.decideOnly(q('Кино — Группа крови'), yt, 'yt');
  assert.equal(onlyYt.status, 'exact');
  assert.equal(onlyYt.track, yt[0]);
  const onlyYm = M.decideOnly(q('Кино — Группа крови'), ym, 'ym');
  assert.equal(onlyYm.track, ym[0]);
});

// ---------- exactLocal ----------

test('match.exactLocal: точное совпадение названия и исполнителя среди своих файлов', () => {
  const list = [
    { title: 'Группа крови live', author: 'Кино' },
    { title: 'Группа крови', author: 'Кино' },
  ];
  assert.equal(M.exactLocal(q('Кино — Группа крови'), list).author, 'Кино');
  assert.equal(M.exactLocal(q('Кино — Группа крови'), list).title, 'Группа крови');
});

test('match.exactLocal: нет точного совпадения или список пуст — null', () => {
  assert.equal(M.exactLocal(q('Кино — Группа крови'), []), null);
  assert.equal(M.exactLocal(q('Кино — Группа крови'), null), null);
  assert.equal(M.exactLocal(q('Кино — Группа крови'), [{ title: 'Другая', author: 'Кто-то' }]), null);
});

// ---------- preferDuration ----------

test('match.preferDuration: трек той же длины не меняется (тот же объект)', () => {
  const r = { status: 'exact', track: { title: 'Песня', seconds: 220 }, alts: [] };
  assert.equal(M.preferDuration(r, 210), r);
});

test('match.preferDuration: без длины или короче 20 секунд подсказка не работает', () => {
  const r = { status: 'exact', track: { title: 'Песня', seconds: 600 }, alts: [] };
  assert.equal(M.preferDuration(r, 0), r);
  assert.equal(M.preferDuration(r, 10), r);
  assert.equal(M.preferDuration(null, 200), null);
});

test('match.preferDuration: длинный лайв заменяется версией той же длины и названия', () => {
  const live = { title: 'Песня', seconds: 600 };
  const studio = { title: 'Песня', seconds: 211 };
  const r = { status: 'exact', track: live, alts: [{ title: 'Другая', seconds: 500 }, studio] };
  const out = M.preferDuration(r, 210);
  assert.equal(out.track, studio);
  assert.equal(out.durFixed, true);
  assert.ok(out.alts.includes(live), 'старый трек уходит в альтернативы');
  assert.ok(!out.alts.includes(studio));
});

test('match.preferDuration: подходящей длины нет — exact становится close с пометкой durWarn', () => {
  const r = { status: 'exact', track: { title: 'Песня', seconds: 600 }, alts: [{ title: 'Песня', seconds: 900 }] };
  const out = M.preferDuration(r, 210);
  assert.equal(out.track, r.track);
  assert.equal(out.status, 'close');
  assert.equal(out.durWarn, true);
});

test('match.preferDuration: чужая песня той же длины не подставляется', () => {
  const r = { status: 'exact', track: { title: 'Песня', seconds: 600 }, alts: [{ title: 'Совсем другая', seconds: 210 }] };
  const out = M.preferDuration(r, 210);
  assert.equal(out.track, r.track, 'другое название не должно заменять трек');
  assert.equal(out.status, 'close');
});

test('match.preferDuration: отрицательная и огромная длина не ломают расчёт', () => {
  const r = { status: 'exact', track: { title: 'Песня', seconds: 600 }, alts: [] };
  assert.equal(M.preferDuration(r, -100), r);
  assert.equal(M.preferDuration(r, 1e12).track, r.track);
});
