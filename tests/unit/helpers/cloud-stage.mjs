// Помощник тестов: собирает облачные функции упаковщиком и загружает их из собранной папки.
//
// Зачем именно так (G-07): общий код лежит в server/common/*.js и попадает в функцию только при
// упаковке. Значит, проверять надо ровно то, что уедет в облако, — собранную папку, а не исходник
// в репозитории (там common/ рядом с index.js нет).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packAll } from '../../../tools/cloud-pack.mjs';

const require = createRequire(import.meta.url);

let outDir = null;

// Папка сборки одна на процесс теста: node --test запускает каждый файл отдельно
export function cloudDir() {
  if (!outDir) {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-cloud-'));
    packAll({ out: outDir, zip: false });
  }
  return outDir;
}

// Загрузить функцию из собранной папки: staged('yc-da') → module
export function staged(name) {
  const file = path.join(cloudDir(), name, 'index.js');
  if (!fs.existsSync(file)) throw new Error('нет собранной функции ' + name + ' — проверь tools/cloud-pack.mjs');
  return require(file);
}
