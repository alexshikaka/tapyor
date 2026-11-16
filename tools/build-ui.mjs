// Собрать src/ui.js из частей src/ui/*.js (для запуска из file://, проверок и сборки установщика).
// В программе /ui.js склеивается на лету — этот файл нужен только как запасной. В git не хранится.
// Запуск: npm run ui   (или node tools/build-ui.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { buildUi, uiParts } = require(path.join(src, 'ui-build.js'));
fs.writeFileSync(path.join(src, 'ui.js'), buildUi(src));
console.log('src/ui.js собран из ' + uiParts(src).length + ' частей src/ui/');
