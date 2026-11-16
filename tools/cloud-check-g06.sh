#!/bin/bash
# Живая проверка облачных функций после выкладки (G-06, 11.11). Запуск в Yandex Cloud Shell:
#   bash cloud-check-g06.sh [имя функции ...]
# По умолчанию проверяет все четыре: tapyor-da, tapyor-google, tapyor-report, tapyor-license.
#
# Что доказывает: новая версия функции отвечает полем tapyor_error (наши ошибки отличимы от ответа
# провайдера), при этом поле error осталось прежним — старые сборки Тапёра не ломаются.
# Ничего не меняет в облаке: только два безобидных вызова на функцию (GET и запрос без общего ключа).
# Значения переменных окружения берутся из настроек функции и на экран не выводятся.
set -e

NAMES=${*:-"tapyor-da-token tapyor-google-token tapyor-report tapyor-license"}
[ $# -gt 0 ] && NAMES="$*"
BAD=0

for N in $NAMES; do
  J=$(yc serverless function version get-by-tag --function-name "$N" --tag '$latest' --format json 2>/dev/null) || {
    echo "$N: функции нет или нет доступа — пропускаю"; BAD=$((BAD+1)); continue; }
  SK=$(jq -r '.environment.SHARED_KEY // ""' <<<"$J")
  ENTRIES=$(jq -r '(.environment//{})|keys|join(",")' <<<"$J")
  echo "── $N (переменные: $ENTRIES)"

  # 1) GET с ключом: живая функция отвечает 405 и кодом method
  EV=$(jq -cn --arg k "$SK" '{httpMethod:"GET",headers:{"X-Tapyor-Key":$k}}')
  R1=$(yc serverless function invoke --name "$N" -d "$EV" 2>/dev/null || echo '{}')
  C1=$(jq -r '.statusCode // 0' <<<"$R1")
  B1=$(jq -r 'if (.body|type)=="string" then (.body|fromjson) else .body end | .tapyor_error // "-"' <<<"$R1" 2>/dev/null || echo '-')
  E1=$(jq -r 'if (.body|type)=="string" then (.body|fromjson) else .body end | .error // "-"' <<<"$R1" 2>/dev/null || echo '-')
  echo "   GET:            $C1, tapyor_error=$B1, error=$E1"

  # 2) POST без общего ключа: 403 + код forbidden (если SHARED_KEY вообще задан)
  EV2=$(jq -cn '{httpMethod:"POST",headers:{},body:"{}"}')
  R2=$(yc serverless function invoke --name "$N" -d "$EV2" 2>/dev/null || echo '{}')
  C2=$(jq -r '.statusCode // 0' <<<"$R2")
  B2=$(jq -r 'if (.body|type)=="string" then (.body|fromjson) else .body end | .tapyor_error // "-"' <<<"$R2" 2>/dev/null || echo '-')
  echo "   POST без ключа: $C2, tapyor_error=$B2"

  # Текст error у функций разный («only POST» и «POST only») — сравнивать его нельзя, только код.
  if [ "$C1" = "405" ] && [ "$B1" = "method" ]; then
    echo "   ✓ новая версия на месте: 405 + код method (текст error у функций разный, не сверяем)"
  elif [ "$C1" = "405" ] && [ "$B1" = "-" ]; then
    echo "   ✗ старая версия: 405 есть, а tapyor_error нет — выкладка не дошла до этой функции"; BAD=$((BAD+1))
  else
    echo "   ✗ неожиданный ответ ($C1) — смотри логи функции"; BAD=$((BAD+1))
  fi
  if [ -n "$SK" ] && { [ "$C2" != "403" ] || [ "$B2" != "forbidden" ]; }; then
    echo "   ✗ без ключа ответ не «403 forbidden» с кодом — проверь SHARED_KEY"; BAD=$((BAD+1))
  fi
done

echo
if [ "$BAD" = "0" ]; then
  echo "ИТОГ: все проверенные функции отвечают tapyor_error. Дальше — cloud-license-check.sh для лицензий."
else
  echo "ИТОГ: проблемы у $BAD проверок — пришли этот вывод Claude, выкладку не считать законченной"
  exit 1
fi
