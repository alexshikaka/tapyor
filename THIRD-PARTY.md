# Сторонние библиотеки в Тапёре

Здесь — всё, что Тапёр использует из чужого кода и что попадает в установщик, с лицензией и причиной.
Правило проекта: добавили зависимость — строка сюда в том же коммите. Политика данных (что и куда уходит) — `PRIVACY.md`.

## Сводка

| Компонент | Версия | Лицензия | Где в проекте | Зачем |
|---|---|---|---|---|
| `electron-updater` | 6.8.11 | MIT | `dependencies`, `package.json` | автообновление программы |
| `qrcode-svg` | 1.1.0 | MIT | `dependencies`, `package.json` | QR-код на странице стримера |
| `yt-search` | 2.13.1 | MIT | `dependencies`, `package.json` | поиск на YouTube без ключа |
| Electron | 44.11.3 | MIT | `devDependencies` (в установщик входит сам Electron) | окно программы |
| hls.js | 1.5.17 | Apache-2.0 | `src/vendor/hls.min.js` | проигрывание HLS-потоков SoundCloud |
| Шрифты Onest, JetBrains Mono, Manrope, Pixelify Sans, Press Start 2P | по файлам, без отдельной версии | SIL OFL 1.1 | `src/assets/fonts/*.woff2` | шрифты интерфейса |
| yt-dlp | не зафиксирована: скачивается при сборке | Unlicense | `resources/yt-dlp.exe` (в репозитории нет) | звук с YouTube и SoundCloud |

Точные версии npm-пакетов берутся из `package-lock.json` на момент сборки. Версия Electron — из
`package.json` (`devDependencies.electron`); **эту строку обновляют вместе со сменой версии Electron**,
и `tests/unit/third-party.test.mjs` падает, если номер разошёлся.

## electron-updater 6.8.11 — MIT

- **Что это:** обновление Electron-программы по `latest.yml` из релизов GitHub.
- **Чей:** Copyright (c) electron-builder contributors.
- **Зачем у нас:** настройка «Настройки → Программа», кнопка «Обновить»; подпись обновления проверяется
  нашим ключом Ed25519 (`src/update-policy.js`, `src/main/updater.js`).
- **Текст лицензии:** `node_modules/electron-updater/LICENSE` после `npm ci`.

## qrcode-svg 1.1.0 — MIT

- **Что это:** маленький кодировщик QR прямо в JavaScript, без зависимостей. Отдаёт готовый SVG.
- **Чей:** Copyright (c) 2016 papnkukn. Текст лицензии — `node_modules/qrcode-svg/LICENSE` (MIT).
- **Зачем у нас:** страница QR-кода для OBS (`src/sitepage.js`). Раньше она грузила `qrcodejs` с cdnjs —
  то есть каждый зритель стримера скачивал чужой скрипт с чужого сервера. Теперь QR рисует сам Тапёр
  при выкладке страницы: в `qr.html` лежит готовый SVG, без единого `<script>` и без внешних адресов.
- **Где используется:** только при сборке страницы стримера (`buildQr`). В интерфейс и в запросы в сеть
  библиотека не лезет, ничего не отправляет.
- **Почему именно она:** около 40 КБ кода, ноль зависимостей, чистый SVG (не canvas, не PNG), лицензия MIT.
  Альтернатива `qrcode` тянет `pngjs` и `yargs` — для одной картинки это лишние мегабайты и лишние лицензии.

## yt-search 2.13.1 — MIT

- **Что это:** поиск на YouTube по названию без ключа API.
- **Зачем у нас:** запасной путь поиска, когда своей выдачи не хватает (`src/` поиск источника `yt`).
- **Текст лицензии:** `node_modules/yt-search/LICENSE` после `npm ci`.
- **Зависимости:** `node-fzf` → `redstar` → `minimatch@3.0.8` (уязвимые ReDoS). В `package.json` добавлен
  `overrides` для `redstar` → `minimatch` 3.1.5 — та же ветка 3.x; dev-копии `minimatch` (9.x/10.x/11.x)
  не тронуты. Код `yt-search` при этом не менялся (2.13.1).

## Electron 44.11.3 — MIT

- **Что это:** платформа, на которой работает окно Тапёра (Chromium + Node.js).
- **Где:** `devDependencies.electron` в `package.json`; в установщик входит собранный Electron.
- **Текст лицензии:** `node_modules/electron/LICENSE` после `npm ci`.

## hls.js 1.5.17 — Apache-2.0

- **Что это:** проигрывание HLS (`.m3u8`) в браузере через Media Source Extensions.
- **Чей:** Copyright (c) video-dev; текст — `src/vendor/README.txt`.
- **Где:** `src/vendor/hls.min.js`, подключается только в окне-источнике SoundCloud (HLS) и в панели.
- **Текст лицензии:** Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0.

## Шрифты — SIL OFL 1.1

- **Семейства:** Onest, JetBrains Mono, Manrope, Pixelify Sans, Press Start 2P (все с кириллицей).
- **Где:** 43 файла `src/assets/fonts/*.woff2`, подключение — `src/fonts.css` (собирается `npm run fonts`).
- **Лицензия:** SIL Open Font License 1.1. Текст — `src/assets/fonts/OFL.txt` рядом с файлами шрифтов.

## yt-dlp — Unlicense

- **Что это:** внешняя программа для скачивания звука (YouTube, SoundCloud и другие сайты).
- **Где:** в репозитории бинарника нет; его скачивает `docs/DEV.md` (руками) или CI открытого репозитория
  (`.github/workflows/build.yml`) и кладёт в `resources/yt-dlp.exe`. В установщик идёт через
  `build.extraResources` в `package.json`. При запуске Тапёр сверяет SHA-256 по официальному списку.
- **Лицензия:** Unlicense (общественное достояние). Текст — в самом репозитории yt-dlp.

## Как это проверяется

- `tests/unit/third-party.test.mjs` — каждый пакет `dependencies` назван в этом файле вместе с точной
  версией из `package-lock.json`; Electron — с версией из `package.json`; названы `hls.js`, `yt-dlp` и OFL;
  `src/assets/fonts/OFL.txt` на месте.
- `tests/unit/qr-page.test.mjs` — в готовом `qr.html` нет `<script>`, нет `cdnjs`, нет внешних адресов
  (кроме `xmlns` у самого SVG), рисунок не пустой и меняется при смене адреса, фон страницы прозрачный.
- `npm test` — общий прогон; `tools/check-asar.mjs` — проверка, что в установщик не попали секреты.
