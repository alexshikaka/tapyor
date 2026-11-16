// STAB-F6: «Что играет» в панели волны берёт тот же список, что и «Для вас» на странице.
// Яндекс не спрашиваем: подкладываем ответ /rotor/wave/settings, как в жизни, и разбираем его.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const y = require('../../src/yandex.js');
const wv = require('../../src/wave-variants.js');

// Ответ Яндекса: несколько станций, среди них сама «Моя волна» (её и подхватывал старый wavePresets).
const WAVE_SETTINGS = {
  defaultStation: { id: { type: 'user', tag: 'onyourwave' }, name: 'Моя волна' },
  blocks: [
    {
      items: [
        { name: 'Танцую', id: { type: 'mood', tag: 'dance' }, icon: { backgroundColor: '#C23A5C' } },
        { name: 'Просыпаюсь', id: { type: 'mood', tag: 'wake' }, icon: { backgroundColor: '#C46A20' } },
        { name: 'Моя волна', id: { type: 'user', tag: 'onyourwave' } },
        { name: 'В дороге', idForFrom: 'mood-road', icon: { backgroundColor: '#3D55C4' } },
        { name: 'Работаю', seeds: ['mood:work'], icon: { backgroundColor: '#2E8C6A' } },
        { name: 'Танцую', id: { type: 'mood', tag: 'dance' }, icon: { backgroundColor: '#C23A5C' } }
      ]
    }
  ]
};

function fakeFetch(result) {
  return async (url) => {
    assert.match(String(url), /\/rotor\/wave\/settings/);
    return { ok: true, status: 200, text: async () => JSON.stringify({ result }) };
  };
}

async function contextsFromYandex() {
  const old = global.fetch;
  global.fetch = fakeFetch(WAVE_SETTINGS);
  try {
    const r = await y.waveContexts('test-token');
    return r.contexts;
  } finally {
    global.fetch = old;
  }
}

test('F6: waveContexts разбирает ответ Яндекса', async () => {
  const list = await contextsFromYandex();
  assert.ok(list.length >= 4, 'варианты из ответа не потерялись');
  const work = list.find((c) => c.name === 'Работаю');
  assert.deepEqual(work.seeds, ['mood:work']);
  const road = list.find((c) => c.name === 'В дороге');
  assert.equal(road.station, 'mood:road');
});

test('F6: в «Что играет» нет второй «Моей волны» и повторов id', async () => {
  const contexts = await contextsFromYandex();
  const list = wv.list(contexts);
  const ids = list.map((v) => wv.key(v));
  assert.equal(new Set(ids).size, ids.length, 'id строк не повторяются');
  assert.equal(list[0].station, 'user:onyourwave', 'первая строка — «Моя волна — как обычно»');
  assert.equal(list[0].color, '#FFD43B', 'первая строка жёлтая');
  assert.equal(ids.filter((id) => id === 'wave:user:onyourwave').length, 1, 'ровно одна строка ведёт на user:onyourwave');
  assert.ok(!list.some((v) => v.name === 'Моя волна'), 'дубль «Моей волны» выкинут');
});

test('F6: «Что играет» совпадает с «Для вас» по составу и id', async () => {
  const contexts = await contextsFromYandex();
  const right = wv.list(contexts).slice(1);
  const left = wv.pick(contexts);
  assert.deepEqual(right.map((v) => v.name), left.map((c) => c.name));
  assert.deepEqual(right.map((v) => wv.key(v)), left.map((c) => wv.key(c)));
  assert.deepEqual(right.map((v) => v.color), left.map((c) => c.color));
});

test('F6: выбор слева и справа даёт одну и ту же подсветку', async () => {
  const contexts = await contextsFromYandex();
  const chosen = contexts.find((c) => c.name === 'Работаю');
  const bg = {
    kind: 'wave',
    station: chosen.station || chosen.seeds[0],
    seeds: chosen.seeds && chosen.seeds.length ? chosen.seeds : undefined,
    name: chosen.name
  };
  assert.equal(wv.activeId(bg), wv.key(chosen), 'слева подсвечен выбранный вариант');
  const right = wv.list(contexts).find((v) => v.name === 'Работаю');
  assert.equal(wv.activeId(bg), wv.key(right), 'справа подсвечен тот же вариант');
});

test('F6: варианты только из user:onyourwave тоже выкидываются', () => {
  const list = wv.list([
    { name: 'Моя волна (семена)', seeds: ['user:onyourwave'], station: '' },
    { name: 'Моя волна (станция)', seeds: [], station: 'user:onyourwave' },
    { name: 'Ночью', seeds: [], station: 'mood:night' }
  ]);
  assert.deepEqual(list.map((v) => v.name), ['Моя волна — как обычно', 'Ночью']);
});

test('F6: нет ответа Яндекса — только «Моя волна — как обычно», без ошибок', () => {
  const list = wv.list([]);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Моя волна — как обычно');
  assert.equal(wv.list(null).length, 1);
});
