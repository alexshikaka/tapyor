// G-07: адрес клиента — один на все функции.
// Берём только то, что видит облако: адрес из requestContext (identity.sourceIp). Из тела запроса
// адрес НЕ берём — иначе его можно подделать (M1).
//
// X-Forwarded-For — только запасной путь, если sourceIp пуст. В этом заголовке перечислена цепочка
// прокси: «клиент, прокси1, прокси2…». Первое значение присылает сам клиент — его можно написать
// каким угодно, поэтому доверять ему нельзя (иначе лимит «по адресу» обходится сменой заголовка).
// Каждый прокси ДОПИСЫВАЕТ в конец адрес, который увидел сам; последнее значение добавил ближайший
// к функции (край облака, ему клиент не управляет) — его и берём. Если заголовок пуст, адреса нет.
'use strict';

function ipOf(event) {
  const c = event && event.requestContext;
  const ip = c && c.identity && c.identity.sourceIp;
  if (ip) return String(ip).trim();
  const h = (event && event.headers) || {};
  for (const k of Object.keys(h)) {
    if (String(k).toLowerCase() !== 'x-forwarded-for') continue;
    const parts = String(h[k] || '').split(',');
    return (parts[parts.length - 1] || '').trim();
  }
  return '';
}

module.exports = { ipOf };
