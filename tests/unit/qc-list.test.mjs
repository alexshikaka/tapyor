// Ф4: раздел «Состояние сервисов» должен показывать те же пункты, что и чеклист
// быстрой проверки в поиске. Список пунктов — один на оба места (src/qc-list.js),
// поэтому сверяем его с тем, что реально присылает quickCheck (src/main/health.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

test('Ф4: общий список пунктов совпадает с набором quickCheck', () => {
  const qc = require(path.join(ROOT, 'src/qc-list.js'));
  const health = fs.readFileSync(path.join(ROOT, 'src/main/health.js'), 'utf8');
  // Строки, которые быстрая проверка ставит через put('id', …).
  // sbot.* и bot.* добавляют модули позже (src/ui/24-bot.js, src/ui/30-sbot.js),
  // поэтому в базовом списке их нет — как и в чеклисте до подключения модуля.
  const quick = [...new Set([...health.matchAll(/put\('([^']+)'/g)].map((m) => m[1]))]
    .filter((id) => !/^(sbot|bot)\./.test(id))
    .sort();
  const list = qc.list();
  assert.ok(list.length > 0, 'общий список пуст');
  assert.deepEqual(list.map((x) => x.id).sort(), quick, 'пункты раздела и quickCheck разошлись');
  assert.equal(new Set(list.map((x) => x.id)).size, list.length, 'в общем списке повторяются id');
  for (const it of list) {
    assert.ok(it.group && it.label, 'у пункта нет группы или названия: ' + JSON.stringify(it));
  }
  // Идентификаторы уникальны и не меняются от вызова к вызову.
  assert.deepEqual(qc.list().map((x) => x.id).sort(), quick, 'список нестабилен');
});
