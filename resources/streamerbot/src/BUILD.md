# Сборка шаблона «Тапёр» v1 в Streamer.bot 1.0.7

Шаблон — 12 действий в группе **«Тапёр»** + служебные действия, которые вызывает Тапёр. Логика в C#,
сеть — только шагом **Fetch URL**. Каждый `.cs` из этой папки вставляется целиком в шаг **Execute C# Code**
(класс `CPHInline`, метод `Execute`). В Streamer.bot у шагов нет общего кода, поэтому общие функции
(URL-кодирование, «да/нет», подстановки) продублированы в каждом файле — это нормально.

> **Главное правило:** наши действия не править. Свои шаги — только в СВОИ действия на триггерах
> «Custom → Тапёр → …». При обновлении шаблона одноимённые действия перезапишутся.

---

## 1. Порядок сборки

1. Создать группу действий **«Тапёр»**.
2. Создать глобальные переменные из раздела 4 (persisted, тип строка; «да»/числа можно строками).
3. Создать действия и шаги по разделу 2. Имена действий — **точно как в таблице** (Тапёр ищет их по имени).
4. Прописать триггеры (раздел 3).
5. Для каждого шага C#: вставить файл, нажать **Compile**, сохранить. Ошибки — см. `CHECK.md`.
6. Для действия «Тапёр: триггеры» включить **Precompile on Application Start**.
7. Перезапустить Streamer.bot (или один раз запустить «Тапёр: триггеры»), проверить Custom → Тапёр.
8. Проверить по `CHECK.md`.

Очередь у всех действий — **Default**, галочка **Blocking — выкл.** (обычная неблокирующая). Для «заказ» и
«награда» это обязательно: пока идёт Fetch URL, чат не должен ждать. Служебные действия тоже неблокирующие.

---

## 2. Действия и шаги

### 2.1. «Тапёр: читай меня»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет.
- Шаги:
  1. **Execute C# Code** — `00-readme.cs` (только комментарии-оглавление).

### 2.2. «Тапёр: шаблон v1»

- Группа: **Тапёр**. Очередь: Default. Триггер: нет.
- Шагов нет. Пустое действие — метка версии для Тапёра (`GetActions` ищет имя `Тапёр: шаблон vN`).
  При выпуске v2 переименовать действие в «Тапёр: шаблон v2».

### 2.3. «Тапёр: заказ»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл.
- Триггер: **Twitch → Chat → Chat Message** (без фильтров: C# сам проверяет команду, бота и права).
- Шаги:
  1. **Execute C# Code** — `10-chat-prep.cs` (проверки, сборка `tpUrl`).
  2. **Fetch URL**:
     - URL: `%tpUrl%`
     - Method: GET (другого нет)
     - Headers: `X-Tapyor-Key` = `~tapyorKey~`
     - Parse result as JSON: **вкл**
     - Variable Name: `res`
  3. **Execute C# Code** — `11-chat-reply.cs` (ответ по `res.*`, запись `tapyorLastOrder`).

### 2.4. «Тапёр: награда»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл.
- Триггер: **Twitch → Channel Reward → Reward Redemption** (без фильтра награды: C# сверяет
  `rewardId` с `tapyorRewardId` или `rewardName` с `tapyorRewardName`).
- Шаги:
  1. **Execute C# Code** — `20-reward-prep.cs`.
  2. **Fetch URL** — как в 2.3 (`%tpUrl%`, `X-Tapyor-Key: ~tapyorKey~`, Parse JSON вкл, `res`).
  3. **Execute C# Code** — `21-reward-reply.cs` (ответ, возврат баллов, `tapyorPendingRedemptions`).

> Проверки «кто может» и пауза — как у чата (план 7.3, шаги 3–11). Если зрителю нельзя или пауза не прошла,
> `20-reward-prep.cs` сразу возвращает баллы (`TwitchRedemptionCancel`) и пишет фразу, Fetch не выполняется.

> Награду стример создаёт **в Streamer.bot** (Platforms → Twitch → Channel Point Rewards → Add,
> «User Input Required»), а не на сайте Twitch — иначе `TwitchRedemptionCancel`/`Fulfill` не работают.

### 2.5. «Тапёр: настройка»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет (вызов `DoAction` от Тапёра).
- Шаги:
  1. **Execute C# Code** — `30-settings.cs`: все `args` с именем `tapyor[A-Za-z]+` пишет в persisted-глобальные
     (кроме `eventId`, `ping`), собирает `tpUrl` = `/sb/ack?id=<eventId>`.
  2. **Fetch URL**: URL `%tpUrl%`, Headers `X-Tapyor-Key` = `~tapyorKey~`, **Parse JSON выкл.** (ответ не нужен).

### 2.6. «Тапёр: заказ выполнен»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет (`DoAction`).
- Шаги:
  1. **Execute C# Code** — `31-played.cs`: `TwitchRedemptionFulfill(reward, redemption)`, убрать списание из
     `tapyorPendingRedemptions`, собрать `tpUrl` ack.
  2. **Fetch URL** — ack: URL `%tpUrl%`, заголовок, Parse JSON выкл.

### 2.7. «Тапёр: заказ снят»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет (`DoAction`).
- Шаги:
  1. **Execute C# Code** — `32-dropped.cs`: `TwitchRedemptionCancel(reward, redemption)`, убрать из
     `tapyorPendingRedemptions`, фраза `tapyorTxtDropped` (только если не пуста, подстановки
     `{user} {track} {reason}`), собрать ack.
  2. **Fetch URL** — ack.

### 2.8. «Тапёр: приём»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет (`DoAction`).
- Шаги:
  1. **Execute C# Code** — `33-accept.cs`: `open`=1 → `UnPauseReward(tapyorRewardId)`, `open`=0 →
     `PauseReward(...)`, только если `tapyorPauseReward` = да и номер награды задан; собрать ack.
  2. **Fetch URL** — ack.

### 2.9. «Тапёр: сверка»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет (`DoAction`).
- Шаги:
  1. **Execute C# Code** — `34-reconcile.cs`: `args.pending` — номера redemption, которые реально ждут/играют;
     всё из `tapyorPendingRedemptions`, чего там нет, → `TwitchRedemptionCancel`; собрать ack.
     Если аргумента `pending` нет вообще (ручной Test Trigger) — ничего не закрывает.
  2. **Fetch URL** — ack.

### 2.10. «Тапёр: найти награду»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет (`DoAction`).
- Шаги:
  1. **Execute C# Code** — `35-find-reward.cs`: `TwitchGetRewards()`, поиск по `tapyorRewardName` без регистра,
     `SetGlobalVar("tapyorRewardId", id, true)`; собрать ack.
  2. **Fetch URL** — ack.

### 2.11. «Тапёр: ответ»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет (`DoAction` — поздний ответ из ящика Тапёра).
- Шаги:
  1. **Execute C# Code** — `36-late-reply.cs`: `reply` в чат (как обычный ответ), `refund`=true и есть
     `redemption` → `TwitchRedemptionCancel`; для `kind=points` без refund — добавить списание в
     `tapyorPendingRedemptions`; собрать ack.
  2. **Fetch URL** — ack.

### 2.12. «Тапёр: триггеры»

- Группа: **Тапёр**. Очередь: Default, Blocking выкл. Триггер: нет.
- Шаги:
  1. **Execute C# Code** — `40-triggers.cs`.
     В настройках шага включить **Precompile on Application Start**.
- `Init()` регистрирует 7 триггеров, `Execute()` — на случай ручного запуска. Повторная регистрация
  в одном запуске защищена флагом.

---

## 3. Триггеры

| Действие | Триггер |
|---|---|
| Тапёр: заказ | Twitch → Chat → **Chat Message** (без фильтров) |
| Тапёр: награда | Twitch → Channel Reward → **Reward Redemption** (без фильтра награды) |
| остальные | без триггеров, вызов `DoAction` по имени от Тапёра |

Свои триггеры (для действий стримера) после запуска «Тапёр: триггеры» появятся в
**Custom → Тапёр**:

| Событие | Название в меню | Данные (args) |
|---|---|---|
| `tapyor_order_queued` | Заказ принят | `orderId, user, uid, track, place, etaMin, kind` |
| `tapyor_order_pending` | Заказ ждёт стримера | `orderId, user, uid, track` |
| `tapyor_order_played` | Заказ выполнен | + `reward, redemption` |
| `tapyor_order_dropped` | Заказ снят | + `reward, redemption, reason` |
| `tapyor_track_started` | Заиграл трек | `track, user` |
| `tapyor_queue_empty` | Очередь заказов пуста | — |
| `tapyor_accept_changed` | Приём заказов изменён | `open` |

---

## 4. Глобальные переменные (persisted)

Создать в **Global Variables** с галочкой **Persisted**. Тип — строка; «да»/числа тоже строками.

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `tapyorUrl` | *(пусто)* | адрес порта Тапёра; **пишет Тапёр** при подключении |
| `tapyorKey` | *(пусто)* | ключ порта; **пишет Тапёр** (в заголовок `X-Tapyor-Key`) |
| `tapyorCmdOrder` | `!sr, !play` | команды заказа (через запятую) |
| `tapyorCmdSong` | `!song` | что играет |
| `tapyorCmdPlace` | `!place` | моё место |
| `tapyorCmdCancel` | `!cancel` | отменить последний заказ |
| `tapyorCmdSkip` | `!skip` | пропустить трек (только модераторы) |
| `tapyorOnOrder` | `да` | команда заказа включена |
| `tapyorOnSong` | `да` | `!song` включена |
| `tapyorOnPlace` | `да` | `!place` включена |
| `tapyorOnCancel` | `да` | `!cancel` включена |
| `tapyorOnSkip` | `да` | `!skip` включена |
| `tapyorWho` | `all` | кто может: `all` / `follower` / `sub` / `vip` |
| `tapyorFollowDays` | `0` | для `follower`: минимум дней |
| `tapyorPerUser` | `1` | заказов зрителя одновременно (проверяет Тапёр) |
| `tapyorPauseMin` | `30` | пауза между заказами зрителя, мин |
| `tapyorChatCap` | `10` | потолок заказов из чата (проверяет Тапёр) |
| `tapyorVipFree` | `да` | VIP/модераторы без ограничений и пауз |
| `tapyorDoubt` | `wait` | сомнительный заказ: `wait` / `ask` |
| `tapyorPoints` | `да` | заказы за баллы включены |
| `tapyorRewardName` | `Заказать песню` | название награды |
| `tapyorRewardId` | *(пусто)* | номер награды; заполняет «Тапёр: найти награду» |
| `tapyorPauseReward` | `да` | ставить награду на паузу при закрытом приёме |
| `tapyorReplyAs` | `broadcaster` | `broadcaster` / `bot` |
| `tapyorReplyMode` | `reply` | `reply` (веткой) / `message` (обычное) |
| `tapyorTemplate` | `1` | версия шаблона |
| `tapyorPendingRedemptions` | *(пусто)* | **служебная**: висящие списания `reward:redemption` через `;` |
| `tapyorTxt…` | *(пусто)* | свои фразы (раздел 5) |

Отдельно: `tapyorLastOrder` — **пользовательская** переменная Twitch (не глобальная), пишется в
`11-chat-reply.cs`/`21-reward-reply.cs` как unixtime; читается для паузы.

---

## 5. Тексты (`tapyorTxt…`) — по умолчанию пусто

Пусто → берётся `res.reply` от Тапёра (он уже содержит ник и данные). Если задать свою фразу — она важнее.
Подстановки: `{user}`, `{track}`, `{place}`, `{eta}`, `{reason}`; для паузы — `{min}`.

| Переменная | Когда |
|---|---|
| `tapyorTxtQueued` | заказ поставлен |
| `tapyorTxtPending` | сомнительный, ждёт стримера |
| `tapyorTxtSearch` | ищет дольше 8 с (поздний ответ отдельно) |
| `tapyorTxtNotFound` | не нашёл |
| `tapyorTxtRule` | правила трека не пускают |
| `tapyorTxtLimit` | лимит заказов |
| `tapyorTxtClosed` | приём закрыт |
| `tapyorTxtAsk` | просят уточнить |
| `tapyorTxtOld` | шаблон устарел |
| `tapyorTxtError` | ошибка |
| `tapyorTxtOffline` | Тапёр не ответил |
| `tapyorTxtNoAccess` | зрителю нельзя заказывать |
| `tapyorTxtPause` | пауза между заказами (`{min}`) |
| `tapyorTxtSkipNoAccess` | `!skip` не модератором |
| `tapyorTxtDropped` | заказ снят (`{user} {track} {reason}`; пусто — молчим) |

`off` в чате — всегда молчание (заказы принимает бот пака). Для баллов при `refund=true` может уйти
`tapyorTxtOff` (или `res.reply`), иначе — общая фраза «заказ не принят, баллы возвращены».
Код ищет имя в PascalCase (`tapyorTxtNotFound`), затем в нижнем регистре (`tapyorTxtnotfound`) — на случай,
если конструктор Тапёра назовёт иначе. **Выбрать один вариант и зафиксировать в конструкторе.**

---

## 6. Fetch URL: поля

Все запросы — **GET** (другого Streamer.bot не умеет).

| Что | URL | Headers | Parse JSON | Variable Name |
|---|---|---|---|---|
| заказ / награда | `%tpUrl%` | `X-Tapyor-Key` = `~tapyorKey~` | **вкл** | `res` |
| ack (все служебные) | `%tpUrl%` | `X-Tapyor-Key` = `~tapyorKey~` | выкл | — |

`tpUrl` собирает C#-шаг через `CPH.SetArgument("tpUrl", …)`. Если C# вернул `false`, Fetch URL не выполняется.
Заголовок `X-Tapyor-Key` проверен вживую (Э0): `~tapyorKey~` подставляется. Аргументы `%…%` в адресе
**не экранируются**, поэтому текст шлём только через свою функцию кодирования в C# (UTF-8 → `%XX`).

Тайм-аут: Тапёр отвечает ≤ 8 с. Если Тапёр завис, Streamer.bot бросит действие через 100 с — ответа
зрителю не будет, это ограничение Streamer.bot.

---

## 7. Что проверить при сборке

См. `CHECK.md`: точные сигнатуры `SendMessage`/`TwitchReplyToMessage`, `PauseReward`/`UnPauseReward`,
`TwitchGetRewards`, `TwitchGetBot`/`TwitchGetExtendedUserInfoById`, `GetArguments`, поле даты фолловинга,
`TryGetArg("res.status")`, аргументы наград. Всё, что не подтверждено, помечено там.
---

## ВАЖНО: строка импорта устаревает

`resources/streamerbot/tapyor-template.txt` — это готовая строка импорта (UUEncoded), её делает
**сам Streamer.bot**: Actions → выделить группу «Тапёр» → **Export** → полученную строку положить в файл
одной строкой (без переводов строк). Она **не собирается** из файлов этой папки.

Поэтому после правки любого `.cs` строка импорта остаётся старой, пока её не переэкспортируют.
Проверка `tests/unit/sbot-template.test.mjs` это сторожит: она держит SHA-256 строки, и при замене
файла хеш в тесте нужно обновить вместе с экспортом.

Что это значит на практике: установка через импорт строки даёт ту ревизию кода, которая была
экспортирована. Если правился, например, `32-dropped.cs` (ответ зрителю «воспроизведение невозможно»,
21.11.2026), то у тех, кто импортирует строку, этого поведения не будет, пока строку не переэкспортируют
и не обновят хеш. Файлы `.cs` — источник правды; строка — снимок.