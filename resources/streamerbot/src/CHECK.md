# CHECK.md — что Claude проверяет при сборке в Streamer.bot 1.0.7

Синтаксис всех 13 файлов проверен `dotnet 8` с заглушкой `stub/CphStub.cs` (13/13 OK). Заглушка —
приблизительные сигнатуры, поэтому **компиляция в настоящем Streamer.bot обязательна**. Ниже — что именно
может не совпасть и как быстро починить.

## 1. Компиляция (блокирующее)

| Что | Где | Если ошибка |
|---|---|---|
| `CPH.SendMessage(string, bool)` и `CPH.TwitchReplyToMessage(string, string, bool)` | `Say` в `10`, `11`, `20`, `21`, `32`, `36` | Если есть 3-й/4-й `fallback` — добавить `, true`; если наоборот, лишний аргумент — убрать. Сигнатуры в 1.0.7 не подтверждены. |
| `CPH.PauseReward(id)` / `CPH.UnPauseReward(id)` | `33-accept.cs` | Если методы требуют `(id, bool)` — добавить `, true`/`, false`. |
| `CPH.TwitchGetRewards()` | `35-find-reward.cs` | Если нужен аргумент (`bool includePaused` и т. п.) — добавить. Если возвращает не `IEnumerable` — заменить цикл на `foreach (var r in rewards)` и поля `r.Id/r.Title`. |
| `CPH.TwitchGetBot()` | `10-chat-prep.cs` (`IsBot`) | Если возвращает не объект с `Id`, а строку — `PropStr` уже обрабатывает строку. Если поле называется иначе — добавить имя в `PropStr(bot, "Id", "UserId", ...)`. |
| `CPH.TwitchGetExtendedUserInfoById(userId)` | `10`, `20` (`FollowerOk`) | Если метода нет/другая сигнатура — заменить проверку фолловера на разрешение (см. п. 2). |
| `CPH.GetArguments()` | `30-settings.cs` | Должен вернуть словарь (`Dictionary<string, object>`/`<string,string>`). Если метода нет — переписать на перебор известных имён `tapyor…` через `TryGetArg`. |
| `CPH.GetGlobalVar<T>(name, true)`, `SetGlobalVar(name, value, true)` | везде | Если `SetGlobalVar` только `(string, string, bool)` — мы и передаём строку, должно быть ок. |
| `CPH.GetTwitchUserVarById<T>` / `SetTwitchUserVarById` | `10`, `11`, `20`, `21` | Если методы не generic — убрать `<string>` и привести результат к строке. |
| `CPH.RegisterCustomTrigger(name, event, string[])` | `40-triggers.cs` | Если категория передаётся иначе (`List<string>`) — поправить тип. |
| `System.Reflection` | `10`, `20`, `35` | Если сборка не видит `System.Reflection` (нет ссылки), заменить рефлексию: в `35` — прямые `r.Id/r.Title`; в `10/20` — разрешать фолловера без проверки. |
| `CPH` в helper-методах | все | Helpers сделаны **instance** (не `static`), чтобы работать и с instance-, и со static-свойством `CPH`. Если SB требует иначе — ошибка будет в каждой строке `CPH.…`; сообщить. |

## 2. Поле даты фолловинга (обязательно вживую)

`FollowerOk` ищет свойства/поля в таком порядке:

`FollowedAt`, `FollowDate`, `FollowedAtUtc`, `FollowedAtDateTime`, `Followed`.

- Если ни одного нет — проверка **пропускается** (зритель допускается). Это осознанно: не блокировать
  всех из-за неизвестного API. Записать в отчёт «поле не найдено, проверка фолловера не работает».
- Если поле есть, но `null` — тоже считается «недоступно» и проверка пропускается.
- Если поле есть и это дата — сравниваем `(UtcNow - followed).TotalDays >= tapyorFollowDays`.

Проверить: временным C#-шагом вывести `info.GetType().GetProperties()` (например, `CPH.LogInfo(p.Name)`)
для реального фолловера и не-фолловера. Если поле называется иначе — добавить имя в массив `names`
в `10-chat-prep.cs` и `20-reward-prep.cs` (два места).

## 3. `res.*` из Fetch URL

- После Fetch URL добавить временный C#-шаг:
  `CPH.TryGetArg("res.status", out string st); CPH.LogInfo("st=" + st);`
  и (при необходимости) перебрать `CPH.GetArguments()`.
- Ожидание: `TryGetArg("res.status", …)` видит ключ с точкой. Если нет — возможно, ключ называется иначе
  (`res` целиком или `status`); тогда поправить `ArgStr("res.status")` во всех reply-файлах
  (`11`, `21`) и `res.refund`/`res.reply`/`res.track`/`res.place`/`res.etaMin`/`res.reason`.
- `res.refund` может быть bool или строкой `"true"` — `ArgBool` обрабатывает оба.
- HTTP 500/ошибка/не JSON: переменных `res.*` нет — `ArgStr` вернёт `""`, сработает ветка «плеер не принимает».
  Проверить с выключенным Тапёром (порт закрыт): через ~2 с шаг идёт дальше.

## 4. Аргументы триггеров

Проверить на реальном событии (или Test Trigger с args):

- Chat Message: `userId`, `user`, `userName`, `rawInput`, `msgId`, `role`, `isSubscribed`, `isVip`,
  `isModerator`. `rawInput` содержит команду с `!`; `input0` — без `!` (мы его не используем).
- Reward Redemption: `rewardId`, `redemptionId`, `rewardName`, `rawInput`, `userId`, `user`, `role`,
  `isSubscribed`, `isVip`, `isModerator`.
- Служебные от Тапёра (Э2): `eventId`, `reward`, `redemption`, `user`, `track`, `reason`, `open`,
  `pending`, `reply`, `msgId`, `kind`, `refund`.
- Если имена отличаются (`reward_id` и т. п.) — поправить `ArgStr` в соответствующем файле.

## 5. Сценарии проверки

1. **Импорт/сборка.** Все 13 C# компилируются; Precompile у «Тапёр: триггеры» сохраняется.
2. **Свои триггеры.** После перезапуска SB: Custom → Тапёр → 7 событий; `GetCodeTriggers` их видит.
   Повторный запуск действия не плодит дубликаты.
3. **Настройка.** Тапёр подключается (Э2) → «Тапёр: настройка» пишет `tapyorUrl`, `tapyorKey` и остальные
   `tapyor…`; Fetch ack проходит; в почтовом ящике Тапёра событие удаляется.
4. **`!sr`** (зритель, `tapyorWho=all`): Fetch уходит, `queued` → ответ; в очереди Тапёра заказ.
   Повторный `!sr` → `limit`; `tapyorLastOrder` записан.
5. **`!sr` без Тапёра** (порт закрыт): «плеер сейчас не принимает заказы», действие не падает.
6. **`!song` / `!place` / `!cancel`**: каждая отвечает по своему `res`.
7. **`!skip`** зрителем → «пропускать трек могут модераторы»; модератором/стримером → `/sb/control?do=skip`.
8. **Выключенная команда** (`tapyorOnSong=0`) → молчание, Fetch не уходит.
9. **Бот.** Сообщение от бот-аккаунта (`TwitchGetBot().Id` = `userId`) → `return false`, ответа нет.
10. **Права.** `tapyorWho=follower/sub/vip`; `tapyorVipFree=да/нет`; role 1/2/3/4 через Test Trigger.
    Стример (role 4) и VIP/мод при `tapyorVipFree=да` — без паузы; иначе пауза `tapyorPauseMin`.
11. **Фолловер.** См. п. 2: реальный фолловер и свежий/старый фолловинг; отсутствие поля — допуск.
12. **Свои тексты.** Задать `tapyorTxtQueued` с `{user} {track} {place} {eta}` → подставилось; пусто →
    `res.reply`; `tapyorTxtOffline`; `tapyorTxtPause` с `{min}`; `tapyorTxtDropped` с `{user} {track} {reason}`.
13. **Ответ.** `tapyorReplyMode=reply` → ветка на `msgId`; `message` → обычное; `tapyorReplyAs=bot` без
    бота → fallback (если параметра нет — проверить, что Streamer.bot отвечает от стримера).
14. **`off`.** `res.status=off` в чате → молчание; для баллов `refund` → возврат.
15. **Награда.** Не та награда → `false` (ничего не трогаем). `tapyorPoints=0` → `false`.
    Та награда → `queued`; `res.refund=true` → `TwitchRedemptionCancel`; `pending` → запись в
    `tapyorPendingRedemptions`; `played`/`dropped` → удаление из неё.
16. **Выполнен/снят.** `31`/`32` с настоящими `reward`/`redemption` (компаньон или Test Trigger):
    `Fulfill`/`Cancel` без исключения; фраза `tapyorTxtDropped`; ack.
17. **Приём.** `open=1` → `UnPauseReward`; `open=0` → `PauseReward`; `tapyorPauseReward=0` или пустой
    `tapyorRewardId` → ничего; без `open` (ручной запуск) → ничего.
18. **Сверка.** В `tapyorPendingRedemptions` два списания, в `pending` одно → второе отменено, первое
    осталось; `pending` пустой → отменены все; аргумента `pending` нет → ничего не отменено.
19. **Найти награду.** `tapyorRewardName` совпадает без регистра → `tapyorRewardId` заполнен;
    не найдено → номер не меняется (решить, нужно ли очищать).
20. **Поздний ответ.** `reply` ушёл в чат; `refund=true` → возврат; `kind=points` без refund → списание
    добавлено в pending; ack.
21. **Повторная доставка.** Одно и то же событие пришло дважды: `Fulfill`/`Cancel` повторно безвредны,
    pending не дублируется, ack повторно проходит.
22. **Очередь.** «Заказ» и «Награда» не блокируют друг друга и чат (Blocking выкл.).

## 6. Что заведомо не проверено

- Настоящий возврат/засчитывание баллов: у владельца нет баллов (Э0). Только сигнатуры и вызовы.
- Точные сигнатуры `SendMessage`/`TwitchReplyToMessage`/`PauseReward`/`TwitchGetRewards`/`GetArguments`
  (в Э0 их нет) — проверяются компиляцией.
- Поле даты фолловинга и поведение `TwitchGetExtendedUserInfoById` — проверяется вживую (п. 2).
- Точные имена `res.*` в `TryGetArg` — проверяется после Fetch (п. 3).
- 100-секундный тайм-аут Streamer.bot при зависшем Тапёре — ограничение SB, не чинится шаблоном.
