// Снимок каналов IPC и подписок для стража STAB-GD1.
// Запуск: node tests/unit/a1-guard/make-snapshot.mjs
// Обновляет tests/unit/a1-guard/ipc-snapshot.json по текущему коду src/.
// Если поменяли канал намеренно — запустите этот скрипт и приложите новый снимок к коммиту.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChannelEntries, collectIpcChannels } from './guard-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const outFile = path.join(here, 'ipc-snapshot.json');

const { channels, dynamic } = collectIpcChannels(readChannelEntries(root));
if (dynamic.length) {
  console.error('Не могу собрать снимок: есть каналы с нестроковым именем:');
  for (const d of dynamic) console.error('  ' + d.file + ':' + d.line + ' — ' + d.kind + ' (' + d.reason + ')');
  process.exit(1);
}

fs.writeFileSync(outFile, JSON.stringify(channels, null, 2) + '\n', 'utf8');
for (const kind of Object.keys(channels)) {
  const names = Object.keys(channels[kind]);
  const calls = Object.values(channels[kind]).reduce((a, b) => a + b, 0);
  console.log(kind + ': имён ' + names.length + ', вызовов ' + calls);
}
console.log('Снимок записан: ' + path.relative(root, outFile).split(path.sep).join('/'));
