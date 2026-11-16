// B7b (P5a №3): разбор src/update-keys.json — открытых ключей проверки подписи обновлений.
// Раньше любая ошибка чтения/разбора молча давала пустой список, а пустой список значит
// «проверка подписи выключена» — то есть битый файл открывал установку чего угодно.
// Теперь пустой список — это только явно записанный `{"keys": []}`; всё остальное — ошибка.
// Модуль без Electron: tests/unit/update-keys-parse.test.mjs.
'use strict';

const BROKEN_TEXT = 'Проверка подписи обновлений сломана — переустановите Тапёр с сайта.';

// → { keys: string[], error: '', disabled: boolean }  — годный файл
// → { keys: [], error: BROKEN_TEXT, disabled: false } — битый (обновления не ставим)
function parseUpdateKeys(text) {
  if (typeof text !== 'string' || !text.trim()) return broken();
  let j;
  try { j = JSON.parse(text); } catch (e) { return broken(); }
  if (!j || typeof j !== 'object' || Array.isArray(j) || !Array.isArray(j.keys)) return broken();
  const keys = j.keys.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim());
  return { keys, error: '', disabled: keys.length === 0 };
}
function broken() { return { keys: [], error: BROKEN_TEXT, disabled: false }; }

module.exports = { BROKEN_TEXT, parseUpdateKeys };
