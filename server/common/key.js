// G-07: общий ключ Тапёра — один на все функции.
// Ключ не секретный (лежит в установщике), но без него адрес функции перестаёт быть приглашением
// для всех подряд. Если SHARED_KEY не задан — пускаем всех: так старые сборки продолжают работать.
'use strict';

const HEADER = 'x-tapyor-key';

function keyOf(event) {
  const h = (event && event.headers) || {};
  let got = '';
  for (const k of Object.keys(h)) if (String(k).toLowerCase() === HEADER) got = String(h[k]);
  return got;
}

// opts.required — для функции, которая без общего ключа не должна работать вовсе (yc-license: она выдаёт
// платные лицензии). Остальные функции зовут keyOk(event) как раньше: без SHARED_KEY пускаем всех.
function keyOk(event, opts) {
  const want = process.env.SHARED_KEY;
  if (!want) return !(opts && opts.required);
  return keyOf(event) === want;
}

module.exports = { keyOk, keyOf, HEADER };
