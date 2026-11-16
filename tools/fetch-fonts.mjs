// Шрифты внутрь программы: один раз качаем woff2 из Google Fonts в src/assets/fonts/
// и пишем src/fonts.css с @font-face на локальные файлы.
// После этого окно, окно масштаба и панель OBS берут шрифты с сервера Тапёра —
// интернет, VPN и доступность Google больше не нужны.
//
// Запуск: npm run fonts   (нужен интернет; если Google режут — включи VPN)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const OUT = path.join(SRC, 'assets', 'fonts');
// UA Chrome: без него Google отдаёт устаревший ttf вместо woff2 (в 3–4 раза тяжелее)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// Берём только нужные алфавиты: латиница и кириллица. Греческий, вьетнамский и прочее — мимо.
const KEEP = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'];
// Те же наборы, что были в <link> на fonts.googleapis.com
const FAMILIES = [
  { name: 'Onest', query: 'Onest:wght@400;500;600;700', slug: 'onest' },
  { name: 'JetBrains Mono', query: 'JetBrains+Mono:wght@400;500', slug: 'jetbrains-mono' },
  { name: 'Press Start 2P', query: 'Press+Start+2P', slug: 'press-start-2p' },
  { name: 'Pixelify Sans', query: 'Pixelify+Sans:wght@400..700', slug: 'pixelify-sans' },
  { name: 'Manrope', query: 'Manrope:wght@500;700;800', slug: 'manrope' }
];

function cssUrl(query) { return 'https://fonts.googleapis.com/css2?family=' + query + '&display=swap'; }

async function get(url, asText) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  return asText ? r.text() : Buffer.from(await r.arrayBuffer());
}

// Разбираем ответ Google: перед каждым @font-face он пишет комментарий с названием алфавита
function parseFaces(css) {
  const faces = [];
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const subset = m[1], body = m[2];
    const pick = (prop) => { const r = new RegExp(prop + ':\\s*([^;]+);').exec(body); return r ? r[1].trim() : ''; };
    const src = /url\(([^)]+)\)/.exec(body);
    faces.push({
      subset,
      style: pick('font-style') || 'normal',
      weight: pick('font-weight') || '400',
      range: pick('unicode-range'),
      url: src ? src[1].replace(/^['"]|['"]$/g, '') : ''
    });
  }
  return faces;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const blocks = [];
  const report = [];
  let bytes = 0, files = 0;

  for (const fam of FAMILIES) {
    let css;
    try {
      css = await get(cssUrl(fam.query), true);
    } catch (e) {
      console.error('✗ ' + fam.name + ': не скачался список — ' + e.message);
      console.error('  Проверь интернет. Если Google Fonts режут — включи VPN и запусти ещё раз.');
      process.exit(1);
    }
    const faces = parseFaces(css).filter((f) => KEEP.includes(f.subset) && f.url);
    if (!faces.length) { console.error('✗ ' + fam.name + ': в ответе нет нужных алфавитов'); process.exit(1); }

    const got = [];
    for (const f of faces) {
      const w = f.weight.replace(/\s+/g, '-');
      const file = fam.slug + '-' + w + '-' + f.subset + '.woff2';
      let data;
      try { data = await get(f.url, false); } catch (e) { console.error('✗ ' + file + ' — ' + e.message); process.exit(1); }
      fs.writeFileSync(path.join(OUT, file), data);
      bytes += data.length; files++;
      got.push(f.subset + ' ' + w + ' (' + Math.round(data.length / 1024) + ' КБ)');
      blocks.push(
        '/* ' + fam.name + ' · ' + f.subset + ' */\n' +
        '@font-face {\n' +
        "  font-family: '" + fam.name + "';\n" +
        '  font-style: ' + f.style + ';\n' +
        '  font-weight: ' + f.weight + ';\n' +
        '  font-display: swap;\n' +
        "  src: url('assets/fonts/" + file + "') format('woff2');\n" +
        (f.range ? '  unicode-range: ' + f.range + ';\n' : '') +
        '}'
      );
    }
    const subsets = [...new Set(faces.map((f) => f.subset))];
    if (!subsets.some((s) => s.startsWith('cyrillic'))) {
      console.error('✗ ' + fam.name + ': нет кириллицы — шрифт не будет зашит');
      process.exit(1);
    }
    report.push('  ' + fam.name + ': ' + faces.length + ' файл(ов), алфавиты — ' + subsets.join(', '));
  }

  const head = [
    '/* Шрифты Тапёра — локальные копии, чтобы интерфейс не зависел от интернета.',
    '   Файл собран скриптом: npm run fonts (tools/fetch-fonts.mjs). Руками не править.',
    '   Сами файлы — src/assets/fonts/, отдаёт их локальный сервер (тот же, что /app.css). */',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(SRC, 'fonts.css'), head + blocks.join('\n\n') + '\n', 'utf8');

  console.log('Готово: ' + files + ' файл(ов), ' + Math.round(bytes / 1024) + ' КБ → src/assets/fonts/');
  console.log(report.join('\n'));
  console.log('Написан src/fonts.css (подключён из src/app.css).');
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
