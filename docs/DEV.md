# Запуск из исходников

Тапёр — программа для Windows на Electron. Для правок не нужно собирать установщик: достаточно запустить из исходников.

## Что нужно

- Windows 10/11, [Node.js](https://nodejs.org) 22 или новее, npm.
- Git.

## Запуск

```powershell
git clone https://github.com/alexshikaka/tapyor
cd tapyor
npm install
node node_modules\electron\install.js   # см. ловушку 1 ниже
npm start
```

Правки `index.html` и `src/ui/*.js` подхватываются при перезапуске окна, правки `src/main.js` — только при полном
перезапуске программы (трей → «Выход» и запустить снова).

## Ловушки

### 1. npm не устанавливает сам Electron

npm 11 не выполняет install-скрипты пакетов без разрешения. После `npm install` бинарника нет, и `npm start` падает.
Решение — `node node_modules\electron\install.js` (должен появиться `node_modules\electron\dist\electron.exe`)
или `npm install-scripts approve electron` и повторить `npm install`.

### 2. Переменная ELECTRON_RUN_AS_NODE

Если в окружении стоит `ELECTRON_RUN_AS_NODE=1` (так бывает в средах разработки), Electron работает как обычный Node
и падает на первой строке `main.js` (`Cannot set properties of undefined (setting 'themeSource')`).
Перед запуском: `Remove-Item Env:\ELECTRON_RUN_AS_NODE`.

### 3. Папка с запрещающими правами

Если Electron молча завершается с кодом `-2147483645`, проверь права папки проекта:
`(Get-Acl .).Access` и при необходимости `icacls . /reset /T /C /Q`.

## Чего нет при запуске из исходников

Ключи сервисов (Last.fm, `clientId` входов в DonationAlerts и Google) подставляются только при сборке установщика —
локально эти функции не работают, самопроверка так и напишет. Автообновление тоже не работает: это не релиз.
Движок YouTube (`resources\yt-dlp.exe`) скачай сам с [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases).

Всё остальное — Яндекс Музыка, YouTube, SoundCloud, Audius, плейлисты, «Моя волна», заказы, оформление — работает
как в собранной программе.

Папка данных при запуске из исходников — та же, что у установленного Тапёра (`%APPDATA%\Тапёр`).
Отдельная — через переменную `TAPYOR_USER_DATA`.

## Проверки

```powershell
npm test            # синтаксис, ESLint, правила интерфейса, аудит оболочек, unit-тесты
```

Правила интерфейса — `docs/UI-RULES.md`, оболочки — `docs/SKINS.md`.

## Пак стримера

Чат-бот и оверлей — отдельный пак в репозитории [`alexshikaka/tapyor-modules`](https://github.com/alexshikaka/tapyor-modules).
В установленный Тапёр он ставится кнопкой «Настройки → Пак стримера → Установить».
