// T1: тесты theme.js — цвета, контраст, сборка темы, подбор палитры и код TAPYOR1.
// Чистая математика, без DOM, Electron и сети.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../../src/theme.js');

const HEX = /^#[0-9A-F]{6}$/;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const isHex = (h) => typeof h === 'string' && HEX.test(h);

// ---------- цвет ----------

test('theme.ok: красный переводится в OKLCH с ожидаемым тоном', () => {
  const o = T.ok('#FF0000');
  assert.ok(o.l > 0.6 && o.l < 0.66, 'яркость ' + o.l);
  assert.ok(o.c > 0.2, 'насыщенность ' + o.c);
  assert.ok(o.h > 20 && o.h < 40, 'тон ' + o.h);
});

test('theme.oklch2hex: перевод туда и обратно не сдвигает цвет больше чем на 1', () => {
  for (const h of ['#336699', '#FFFFFF', '#000000', '#8B7CF6', '#ECEDF2']) {
    const back = T.oklch2hex(T.ok(h));
    assert.ok(isHex(back), h + ' → ' + back);
    const a = rgb(h), b = rgb(back);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) <= 1, h + ' → ' + back + ' канал ' + i);
  }
});

test('theme.oklch2hex: цвет вне экрана и огромные значения не дают мусор', () => {
  for (const o of [{ l: 2, c: 10, h: 0 }, { l: -1, c: -5, h: 400 }, { l: 0.5, c: 1e6, h: 720 }]) {
    assert.ok(isHex(T.oklch2hex(o)), JSON.stringify(o));
  }
});

test('theme.contrast: чёрное на белом — 21, одинаковые цвета — 1', () => {
  assert.equal(T.contrast('#000000', '#FFFFFF'), 21);
  assert.equal(T.contrast('#FFFFFF', '#000000'), 21);
  assert.equal(T.contrast('#8B7CF6', '#8B7CF6'), 1);
});

test('theme.mix: 0 — первый цвет, 1 — второй, середина между ними', () => {
  assert.equal(T.mix('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(T.mix('#000000', '#FFFFFF', 1), '#FFFFFF');
  const mid = T.mix('#000000', '#FFFFFF', 0.5);
  assert.ok(isHex(mid));
  const v = rgb(mid)[0];
  assert.ok(v > 90 && v < 160, 'середина ' + mid);
});

// ---------- build ----------

const BASE = { mode: 'dark', bg: '#15161C', text: '#ECEDF2', accent: '#8B7CF6', primary: '#8B7CF6', contrast: 50 };

test('theme.build: тёмная тема отдаёт все переменные интерфейса и сохраняет фон', () => {
  const v = T.build(BASE);
  for (const k of ['bg00', 'bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'ln', 'ln2', 'ln3', 'tx', 'tx2', 'tx3', 'tx4', 'tx5', 'ac', 'ac2', 'acr', 'acbg', 'pri', 'prit']) {
    assert.ok(v[k] !== undefined, 'нет ' + k);
  }
  assert.equal(v.bg1, '#15161C', 'выбранный фон становится bg1');
  for (const k of ['bg00', 'bg0', 'bg2', 'bg3', 'bg4', 'ln', 'ln2', 'ln3', 'tx', 'tx2', 'tx3', 'tx4', 'tx5', 'ac', 'ac2', 'acbg', 'pri', 'prit']) {
    assert.ok(isHex(v[k]), k + ' = ' + v[k]);
  }
  assert.match(v.acr, /^\d+,\d+,\d+$/);
});

test('theme.build: текст достаточно контрастен фону в тёмной и светлой теме', () => {
  for (const mode of ['dark', 'light']) {
    const v = T.build({ ...BASE, mode, bg: mode === 'dark' ? '#15161C' : '#F5F5F7', text: mode === 'dark' ? '#ECEDF2' : '#15161C' });
    for (const k of ['tx', 'tx2', 'tx3']) {
      assert.ok(T.contrast(v[k], v.bg1) >= 4.5, mode + ' ' + k + ': ' + T.contrast(v[k], v.bg1));
    }
  }
});

test('theme.build: крайний контраст 0 и 100 не ломает цвета', () => {
  for (const contrast of [0, 50, 100, -20, 300, null, undefined, 'x']) {
    const v = T.build({ ...BASE, contrast });
    assert.ok(isHex(v.bg1));
    assert.ok(isHex(v.tx));
    assert.ok(T.contrast(v.tx, v.bg1) > 1);
  }
});

test('theme.build: подпись на главной кнопке выбирается по контрасту', () => {
  const white = T.build({ ...BASE, primary: '#FFFFFF' });
  assert.equal(white.prit, '#111111');
  const dark = T.build({ ...BASE, primary: '#111111' });
  assert.equal(dark.prit, '#FFFFFF');
});

test('theme.build: крайние цвета (чёрный/белый) не бросают и дают валидные значения', () => {
  for (const bg of ['#000000', '#FFFFFF']) {
    const v = T.build({ mode: 'dark', bg, text: bg, accent: bg, primary: bg, contrast: 50 });
    for (const k of ['bg1', 'tx', 'ac', 'pri']) assert.ok(isHex(v[k]), k + ' = ' + v[k]);
  }
});

// build() проверяет формат цветов: битый цвет заменяется запасным, а не попадает
// в CSS-переменную (src/theme.js).
test('theme.build: битый цвет фона не должен попадать в CSS',
  () => {
    const v = T.build({ mode: 'dark', bg: 'не цвет', text: null, accent: '', primary: undefined, contrast: 50 });
    assert.ok(isHex(v.bg1), 'bg1 = ' + v.bg1);
  });

// ---------- встроенная тёмная тема ----------

const CSS = fs.readFileSync(new URL('../../src/app.css', import.meta.url), 'utf8');
function cssVars(selector) {
  const start = CSS.indexOf(selector + ' {');
  if (start < 0) return null;
  const open = CSS.indexOf('{', start);
  const end = CSS.indexOf('}', open);
  const vars = {};
  for (const part of CSS.slice(open + 1, end).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    vars[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return vars;
}

test('theme-dark: четыре цвета владельца стоят в переменных, остальные — валидные hex', () => {
  const v = cssVars('html.theme-dark');
  assert.ok(v, 'в app.css нет блока html.theme-dark');
  assert.equal(v['--bg1'], '#272727', 'фон');
  assert.equal(v['--tx'], '#E7F0F5', 'текст');
  assert.equal(v['--ac'], '#D17834', 'акцент');
  assert.equal(v['--pri'], '#7180AC', 'главная кнопка');
  const hex = ['bg00', 'bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'ln', 'ln2', 'ln3', 'tx', 'tx2', 'tx3', 'tx4', 'tx5', 'ac', 'ac2', 'acbg', 'pri', 'prit'];
  for (const k of hex) assert.ok(isHex(v['--' + k]), '--' + k + ' = ' + v['--' + k]);
  assert.equal(v['--acr'], rgb(v['--ac']).join(','));
});

test('theme-dark: текст и подпись кнопки читаются на своих фонах', () => {
  const v = cssVars('html.theme-dark');
  assert.ok(v, 'в app.css нет блока html.theme-dark');
  for (const k of ['tx', 'tx2', 'tx3', 'tx4', 'tx5']) {
    assert.ok(T.contrast(v['--' + k], v['--bg1']) >= 4.5, '--' + k + ': ' + T.contrast(v['--' + k], v['--bg1']).toFixed(2));
  }
  assert.ok(T.contrast(v['--ac'], v['--bg1']) >= 3, 'акцент: ' + T.contrast(v['--ac'], v['--bg1']).toFixed(2));
  assert.ok(T.contrast(v['--ac'], v['--acbg']) >= 4.5, 'акцент на подложке: ' + T.contrast(v['--ac'], v['--acbg']).toFixed(2));
  assert.ok(T.contrast(v['--prit'], v['--pri']) >= 4.5, 'подпись на кнопке: ' + T.contrast(v['--prit'], v['--pri']).toFixed(2));
});

// ---------- suggest ----------

test('theme.suggest: шесть вариантов с валидными цветами и тем же режимом', () => {
  const list = T.suggest({ mode: 'dark', tone: 'violet', chars: 'tone' }, 42);
  assert.equal(list.length, 6);
  for (const x of list) {
    assert.equal(x.mode, 'dark');
    assert.equal(x.contrast, 50);
    assert.equal(x.src, 'local');
    for (const k of ['bg', 'text', 'accent', 'primary']) assert.ok(isHex(x[k]), k + ' = ' + x[k]);
  }
});

test('theme.suggest: тот же seed — те же цвета, другой seed — другие', () => {
  const a = T.suggest({ mode: 'dark', tone: 'blue', chars: 'triad' }, 7);
  const b = T.suggest({ mode: 'dark', tone: 'blue', chars: 'triad' }, 7);
  const c = T.suggest({ mode: 'dark', tone: 'blue', chars: 'triad' }, 8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('theme.suggest: светлая тема и неизвестные тон/характер не бросают', () => {
  const list = T.suggest({ mode: 'light', tone: 'нет такого', chars: 'нет такого' }, 1);
  assert.equal(list.length, 6);
  for (const x of list) assert.equal(x.mode, 'light');
});

test('theme.suggest: монохром — без цветного акцента', () => {
  const list = T.suggest({ mode: 'dark', tone: 'mono', chars: 'tone' }, 3);
  for (const x of list) {
    const a = rgb(x.accent);
    assert.equal(a[0], a[1]);
    assert.equal(a[1], a[2]);
  }
});

// ---------- fromScheme ----------

test('theme.fromScheme: самый насыщенный цвет становится акцентом, режим сохраняется', () => {
  const t = T.fromScheme(['#777777', '#FF0000', '#888888'], 'dark');
  assert.equal(t.mode, 'dark');
  assert.equal(t.src, 'api');
  assert.equal(t.contrast, 50);
  for (const k of ['bg', 'text', 'accent', 'primary']) assert.ok(isHex(t[k]));
  assert.ok(T.ok(t.accent).c > T.ok(t.primary).c, 'акцент насыщеннее основного');
});

test('theme.fromScheme: светлая тема и мало цветов не бросают', () => {
  const one = T.fromScheme(['#336699'], 'light');
  assert.equal(one.mode, 'light');
  assert.ok(isHex(one.accent));
  assert.ok(isHex(one.bg));
});

// fromScheme терпит пустой ответ сервиса палитры: возвращает запасную тему,
// а не падает при чтении bySat[0] (src/theme.js).
test('theme.fromScheme: пустой список цветов не должен ронять подбор',
  () => {
    const bad = T.fromScheme([], 'dark');
    assert.ok(isHex(bad.bg));
    assert.ok(isHex(bad.accent));
  });

// ---------- encode / decode ----------

test('theme.encode/decode: код TAPYOR1 переживает круговую поездку', () => {
  const t = { mode: 'light', bg: '#112233', text: '#AABBCC', accent: '#FF0000', primary: '#00FF00', contrast: 75, name: 'Моя тема' };
  const code = T.encode(t);
  assert.match(code, /^TAPYOR1:l:112233:AABBCC:FF0000:00FF00:75:/);
  const back = T.decode(code);
  assert.equal(back.mode, 'light');
  assert.equal(back.bg, '#112233');
  assert.equal(back.text, '#AABBCC');
  assert.equal(back.accent, '#FF0000');
  assert.equal(back.primary, '#00FF00');
  assert.equal(back.contrast, 75);
  assert.equal(back.name, 'Моя тема');
});

test('theme.decode: без имени, с именем из 40+ символов и с юникодом', () => {
  const noName = T.decode('TAPYOR1:d:112233:AABBCC:FF0000:00FF00:50');
  assert.equal(noName.name, '');

  const longName = 'Т'.repeat(60);
  const back = T.decode(T.encode({ mode: 'dark', bg: '#112233', text: '#AABBCC', accent: '#FF0000', primary: '#00FF00', contrast: 50, name: longName }));
  assert.equal(back.name.length, 40);

  const emoji = T.decode(T.encode({ mode: 'dark', bg: '#112233', text: '#AABBCC', accent: '#FF0000', primary: '#00FF00', contrast: 50, name: 'Тема 🎵' }));
  assert.equal(emoji.name, 'Тема 🎵');
});

test('theme.decode: контраст обрезается в 0…100', () => {
  assert.equal(T.decode('TAPYOR1:d:112233:AABBCC:FF0000:00FF00:500').contrast, 100);
  assert.equal(T.decode('TAPYOR1:d:112233:AABBCC:FF0000:00FF00:-5').contrast, 0);
  assert.equal(T.decode('TAPYOR1:d:112233:AABBCC:FF0000:00FF00:abc').contrast, 50);
});

test('theme.decode: битые коды и чужой префикс — null', () => {
  for (const s of ['', null, undefined, 'TAPYOR2:d:112233:AABBCC:FF0000:00FF00:50', 'TAPYOR1:l:112233:AABBCC:FF0000', 'TAPYOR1:d:zzzzzz:AABBCC:FF0000:00FF00:50', 'просто текст']) {
    assert.equal(T.decode(s), null, String(s));
  }
});

test('theme.TONES и CHARS: направления и характеры палитры на месте', () => {
  assert.ok(T.TONES.violet && T.TONES.mono && T.TONES.blue);
  assert.equal(T.TONES.mono.mono, true);
  assert.deepEqual(Object.keys(T.CHARS).sort(), ['contrast', 'near', 'tone', 'triad']);
});
