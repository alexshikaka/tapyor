// Общий тайм-аут для запросов, у которых нет AbortSignal (сторонние библиотеки, старый код).
// Возвращает обещание первого, кто ответит: сама операция или таймер. По сроку вызывающий
// получает обычную ошибку «<label>: нет ответа за N с» — такую же, как при обрыве сети.
// Проигравшему обещанию сразу вешается .catch(() => {}): иначе его позднее отклонение
// всплывает как необработанная ошибка процесса уже после того, как мы перестали его ждать.
function withTimeout(promise, ms, label) {
  const p = Promise.resolve(promise);
  p.catch(() => {});
  const limit = Math.max(1, Number(ms) || 0);
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error((label || 'Запрос') + ': нет ответа за ' + Math.round(limit / 1000) + ' с')), limit);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
