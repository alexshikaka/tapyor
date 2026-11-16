// Ключи подписи обновлений: один разбор src/update-keys.json на все инструменты.
// Без ключей проверка подписи обновлений в программе выключена (src/main.js), поэтому
// выпуск с пустым списком не должен уходить молча (P5a №1, №10).

export const UNSIGNED_HINT = 'ключи обновлений не созданы — запусти «Создать ключи обновлений.cmd»; без них проверка подписи в этой версии выключена';

// Возвращает только непустые строки: мусор в поле keys ключом не считается.
export function parseKeys(jsonText) {
  let j;
  try { j = JSON.parse(String(jsonText == null ? '' : jsonText)); } catch { return []; }
  if (!j || !Array.isArray(j.keys)) return [];
  return j.keys.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim());
}

// Проверка для release-preflight: пусто — ошибка, если не передан --allow-unsigned.
export function keyCheck(jsonText, { allowUnsigned = false } = {}) {
  const keys = parseKeys(jsonText);
  if (keys.length) {
    return { ok: true, count: keys.length, unsigned: false, name: 'ключи обновлений в сборке: ' + keys.length };
  }
  if (allowUnsigned) {
    return { ok: true, count: 0, unsigned: true, name: 'ключи обновлений: пусто — выпуск без подписи разрешён --allow-unsigned' };
  }
  return { ok: false, count: 0, unsigned: false, name: 'ключи обновлений созданы (src/update-keys.json)', hint: UNSIGNED_HINT };
}

// Совпадают ли наборы открытых ключей (порядок не важен). Пустой набор ни с чем не совпадает.
export function sameKeys(a, b) {
  const A = new Set((a || []).map((k) => String(k).trim()).filter(Boolean));
  const B = new Set((b || []).map((k) => String(k).trim()).filter(Boolean));
  if (!A.size || !B.size || A.size !== B.size) return false;
  for (const k of A) if (!B.has(k)) return false;
  return true;
}
