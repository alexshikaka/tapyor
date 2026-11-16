#!/bin/sh
# Проверки интерфейса в Chromium (Playwright). Окно Тапёра открывается как веб-страница с поддельным window.app (mock5.js).
# Нужно: python3 + playwright (pip install playwright && playwright install chromium).
cd "$(dirname "$0")"
[ -e app2 ] || ln -s ../../src app2
[ -e loud.wav ] || python3 gen_audio.py
[ -e vid.webm ] || ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=320x240:rate=25:duration=30" -c:v libvpx -b:v 200k -an vid.webm   # для t26 (нужен ffmpeg)
node ../../tools/build-ui.mjs   # скрипт окна склеивается из src/ui/*.js
# Сначала короткий smoke: если приложение не открылось, t9–t32 нет смысла запускать.
echo "== smoke"
python3 smoke.py || { echo "✗ smoke упал"; exit 1; }
# Тесты печатают «ошибки: [...]» — ошибки страницы. Раньше непустой список не валил прогон,
# и выдача поиска, упавшая целиком (01.11), прошла незамеченной. Теперь любая ошибка страницы — провал.
for t in t9 t10 t11 t12 t13 t14 t15 t16 t17 t18 t19 t20 t21 t22 t23 t24 t25 t26 t27 t28 t29 t30 t31 t32 t33 t34 t35 t36 t37 t38 t39 t40 t41 t42 t43 t44 t45 t46 t47 t48 t49 t50 t51 t52 t53 tWZ4a tWZ4b tWZ5a tWZ5b tWZ2a tWZ2b tWZ2c tWZ2d tWZ2e tWZ3a tWZ3b tWZ6a tOVCa tOVCb tOVC2a tOVC2b tOVC3a tOVC3b tWC1a tWC2a tYM1a tFLT1a tVO1a tDOCK2a tDOCK2b tRM3a tBQ1a tHK1a; do
  echo "== $t"
  out=$(python3 $t.py 2>&1); code=$?
  printf '%s\n' "$out"
  [ $code -ne 0 ] && { echo "✗ $t упал (код $code)"; exit 1; }
  if printf '%s\n' "$out" | grep -E 'ошибки: \[.+\]' | grep -vE 'ошибки: \[\]' >/dev/null; then echo "✗ $t: ошибки страницы"; exit 1; fi
done
echo "UI: все тесты прошли, ошибок страницы нет"

