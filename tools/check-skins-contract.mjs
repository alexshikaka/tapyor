// Контракт оболочек: оболочка только перекрашивает, ничего не двигает.
// Запуск: node tools/check-skins-contract.mjs   (выход 1 — нарушение)
//
// Зачем статически, а не в браузере: так проверка работает везде, в том числе там,
// где нет Chrome (облачная среда, CI). Геометрию живьём проверяет tests/skins/audit.js.
//
// Что проверяем:
//  1. В ядре (src/app.css) нет правил оболочек — они живут в src/skins/skins.css.
//     В 1.0 оболочки уходят в отдельный модуль; правило в ядре — это код модуля,
//     оставшийся в бесплатной части.
//  2. В src/skins/skins.css нет свойств раскладки — кроме исключений ниже, поимённо.
import fs from 'node:fs';

const core = fs.readFileSync('src/app.css', 'utf8');
const skins = fs.readFileSync('src/skins/skins.css', 'utf8');
const SKIN_SEL = /html\.(skin-|pixel-skin|font-)/;
const problems = [];

// Разбор на правила «селектор { объявления }» без вложенности (@media в оболочках не используется)
function rules(css) {
  const out = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  return out;
}

// 1. Ядро без правил оболочек
for (const r of rules(core)) {
  if (SKIN_SEL.test(r.sel)) problems.push('в ядре правило оболочки: ' + r.sel.slice(0, 90));
}

// 2. Раскладка в оболочках
const LAYOUT = /^(width|height|min-width|max-width|min-height|max-height|margin(-[a-z]+)?|padding(-[a-z]+)?|gap|row-gap|column-gap|display|flex(-[a-z]+)?|grid(-[a-z]+)?|order|position|top|left|right|bottom|inset|z-index|overflow(-[xy])?|font-size|visibility)$/;

// Исключения: селектор (подстрока) → какие свойства можно и почему.
// Добавлять сюда только с причиной. Это не лазейка, а записанное решение.
const ALLOW = [
  { sel: 'body::before', props: ['position', 'inset', 'z-index'], why: 'наложение узора/скан-линий, pointer-events: none' },
  { sel: 'body::after', props: ['position', 'inset', 'z-index'], why: 'наложение скан-линий CRT, pointer-events: none' },
  { sel: 'html.skin-retro .app-shell', props: ['position', 'z-index'], why: 'поднять содержимое над фоновым узором Ретро; ничего не сдвигает' },
  { sel: 'html.pixel-skin', props: ['font-size'], why: 'компенсация метрики моноширинного пиксельного шрифта' },
];

for (const r of rules(skins)) {
  for (const decl of r.body.split(';')) {
    const prop = decl.split(':')[0].trim().toLowerCase();
    if (!prop || !LAYOUT.test(prop)) continue;
    const ok = ALLOW.some((a) => r.sel.includes(a.sel) && a.props.includes(prop));
    if (!ok) problems.push('раскладка в оболочке: ' + prop + ' — ' + r.sel.slice(0, 80));
  }
}

if (problems.length) {
  console.log('Контракт оболочек нарушен (' + problems.length + '):');
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nОболочка только перекрашивает. Если свойство действительно нужно — добавь исключение');
  console.log('в ALLOW с причиной, а не убирай проверку.');
  process.exit(1);
}
console.log('оболочки: правил в ядре 0, раскладки вне исключений нет (исключений: ' + ALLOW.length + ')');
