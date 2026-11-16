// Описание релиза для открытого репозитория (сборка в GitHub Actions, шаг после установщика).
//   node tools/release-notes.mjs <тег vX.Y.Z> [sha256] [коммит] [адрес журнала] > notes.md
import fs from 'node:fs';
import { releaseNotes } from './lib/release-notes.mjs';

const [tag, sha256 = '', commit = '', runUrl = ''] = process.argv.slice(2);
let changelog = '';
try { changelog = fs.readFileSync('CHANGELOG.md', 'utf8'); } catch (e) { /* нет файла — останется ссылка */ }
process.stdout.write(releaseNotes({ changelog, tag, sha256, commit, runUrl }));
