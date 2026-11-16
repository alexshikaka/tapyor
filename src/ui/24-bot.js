  // ===== Модуль «Чат-бот Twitch» в настройках (группа «Модули») — docs/BOT.md =====
  // Окно только показывает и сохраняет настройки бота; вся логика — в модуле (modules/streamer-pack, через A.botCmd).
  // Тумблеры здесь — свои (data-b), НЕ data-set-tg: настройки бота хранятся в модуле, а не в общих настройках.
  var BOT_BAN_MIN = 10; // читает очередь (⛔ у заказа «Твич»)
  var BOT = { st: null, s: null, tab: 'conn', code: null, replyDef: null, journal: [], blocked: [], timeouts: [], status: null, poll: 0, chatOrders: 'none' };
  var BOT_TABS = [['conn', 'Подключение'], ['cmd', 'Заказы командой'], ['pts', 'Баллы канала'], ['ev', 'Событие'], ['rep', 'Ответы и журнал']];
  var BOT_CATS = [['viewer', 'Зрители'], ['follower', 'Фолловеры'], ['sub', 'Подписчики'], ['vip', 'VIP'], ['mod', 'Модераторы']];

  function botSet(path, val){
    var ks = path.split('.'), o = BOT.s;
    for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
    var patch = {}; patch[ks[0]] = BOT.s[ks[0]];
    return A.botCmd('save', patch).then(function (s){ BOT.s = s; if (ks[0] === 'banMin') BOT_BAN_MIN = Number(val) || 10; }).catch(function (e){ toast('Не сохранил: ' + (e.message || e)); });
  }

  // Цвет награды Twitch: кружок открывает общее окно цвета (#colv). Значение уходит
  // в настройки бота при закрытии окна, а не на каждое движение мышью.
  function botRewardColor(r){
    r = r || {};
    var bg = r.color ? esc(r.color) : 'var(--bg3)';
    return '<button class="te-sw" type="button" data-act="reward-color" style="background:' + bg + '" title="Выбрать цвет" aria-label="Цвет награды"></button>';
  }

  function bTg(path, on, label){ return '<button class="toggle' + (on ? ' on' : '') + '" data-b="' + path + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(label) + '"><span></span></button>'; }
  function bSeg(path, cur, opts, label){ return '<div class="seg" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o){ return '<button class="' + (String(cur) === String(o[0]) ? 'on' : '') + '" data-v="' + path + '" data-val="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; }
  function bTier(){
    var opts = [['default', 'Донаты и баллы → команда'], ['money', 'Деньги главнее всего'], ['equal', 'Все равны']];
    return '<div class="seg" role="group" aria-label="Приоритеты заказов">' + opts.map(function (o){ return '<button class="' + (String(REQ_TIERS) === o[0] ? 'on' : '') + '" data-tier="' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function bNum(path, val, w, label){ return '<input class="field" type="number" min="0" data-n="' + path + '" value="' + esc(val == null ? '' : val) + '" style="width:' + (w || 80) + 'px" aria-label="' + esc(label) + '">'; }
  function bTxt(path, val, w, label){ return '<input class="field" type="text" data-t="' + path + '" value="' + esc(val == null ? '' : val) + '" style="width:' + (w || 300) + 'px;font-family:Onest,sans-serif" aria-label="' + esc(label) + '">'; }
  function bRow(title, desc, ctl){ return '<div class="srow"><div class="sl"><div class="st">' + title + '</div>' + (desc ? '<div class="sd">' + desc + '</div>' : '') + '</div>' + (ctl || '') + '</div>'; }
  function bSec(title, sub, body){ return '<div class="bot-sec"><div class="sec-h"><h2 style="font-size:16px">' + title + '</h2>' + (sub ? '<span>' + sub + '</span>' : '') + '</div><div class="card">' + body + '</div></div>'; }
  function botDays(n){ n = n % 100; if (n >= 11 && n <= 14) return 'дней'; n = n % 10; return n === 1 ? 'день' : (n >= 2 && n <= 4 ? 'дня' : 'дней'); }

  // Строка лицензии пака (общая с оверлеем) — src/ui/26-packs.js
  function botLicenseHtml(){ return packLicStrip(BOT.st && BOT.st.license); }

  function botConnHtml(){
    var s = BOT.s, st = BOT.status || {}, self = s.identity === 'self';
    var h = bSec('Приём заказов', 'главный выключатель модуля',
      bRow('Принимать заказы из чата', 'Выключено — бот молчит, награда за баллы на паузе', bTg('accepting', BOT.chatOrders === 'pack', 'Принимать заказы')) +
      bRow('Только во время стрима', 'Офлайн бот не принимает заказы и не открывает событие', bTg('onlyLive', s.onlyLive !== false, 'Только во время стрима')) +
      bRow('Способы заказа', 'Каждый настраивается на своей вкладке', '<div class="bot-pair"><label>Командой в чате ' + bTg('commandsOn', s.commandsOn !== false, 'Заказы командой') + '</label><label>За баллы канала ' + bTg('pointsOn', s.pointsOn !== false, 'Заказы за баллы') + '</label></div>'));
    // Общий выключатель (0.35, раздел 9 плана): включён Streamer.bot — бот пака молчит.
    if (BOT.chatOrders !== 'pack') {
      h += '<div class="bot-note warn"><b>Сейчас заказы из чата ' + (BOT.chatOrders === 'sbot' ? 'принимает Streamer.bot' : 'не принимает никто') + '.</b> Включить здесь? <button class="btn" type="button" data-act="take-pack">Включить чат-бота</button></div>';
    }
    var who = function (u){ return u ? '<span class="pill ok">' + esc(u.login) + '</span>' : '<span class="pill">не вошёл</span>'; };
    var codeBox = BOT.code ? '<div class="bot-code">Код для Twitch: <b class="mono">' + esc(BOT.code.userCode) + '</b> — страница открыта в браузере, нажми там «Активировать». <button class="btn ghost" data-act="code-open">Открыть снова</button></div>' : '';
    var body = bRow('От чьего имени пишет бот', self ? 'Один вход: ответы в чате идут от твоего ника' : 'Два входа: аккаунт бота пишет в чат, твой аккаунт нужен для баллов канала',
      bSeg('identity', s.identity || 'bot', [['self', 'От моего имени'], ['bot', 'От отдельного аккаунта']], 'От чьего имени'));
    if (self) body += bRow('Твой аккаунт Twitch', 'Разрешить Тапёру читать и писать в чат и управлять наградой за баллы', '<div class="bot-pair">' + who(st.broadcaster) + (st.broadcaster ? '<button class="btn ghost" data-act="logout" data-role="broadcaster">Выйти</button>' : '<button class="btn" data-act="login" data-role="broadcaster">Войти через Twitch</button>') + '</div>');
    else {
      body += bRow('1. Аккаунт бота', 'Заведи на twitch.tv обычный аккаунт для бота (например, «твойник_bot») и войди им здесь — он будет писать в чат', '<div class="bot-pair">' + who(st.chat) + (st.chat ? '<button class="btn ghost" data-act="logout" data-role="bot">Выйти</button>' : '<button class="btn" data-act="login" data-role="bot">Войти как бот</button>') + '</div>');
      body += bRow('2. Твой аккаунт', 'Нужен для баллов канала и проверки фолловеров. Без него — укажи канал ниже', '<div class="bot-pair">' + who(st.broadcaster) + (st.broadcaster ? '<button class="btn ghost" data-act="logout" data-role="broadcaster">Выйти</button>' : '<button class="btn" data-act="login" data-role="broadcaster">Войти как стример</button>') + '</div>');
      if (!st.broadcaster) body += bRow('Канал', 'Ник канала, в чате которого работает бот', bTxt('channelLogin', s.channelLogin || '', 220, 'Канал'));
      body += bRow('3. Сделай бота модератором', 'В своём чате напиши <span class="mono">/mod ' + esc((st.chat && st.chat.login) || 'ник_бота') + '</span>. У модераторов выше лимиты сообщений и нет медленного режима', '');
    }
    h += bSec('Вход в Twitch', st.channel ? 'в чате канала ' + esc(st.channel.login) + (st.online ? ' · идёт стрим' : '') : '', codeBox + body);
    h += bSec('Общий чат Twitch', 'когда ты объединяешь чат с другим стримером',
      bRow('Чьи заказы принимать', 'В общем чате команды пишут и зрители другого канала', bSeg('sharedChat', s.sharedChat || 'own', [['own', 'Только моих зрителей'], ['all', 'Всех в общем чате']], 'Общий чат')));
    h += '<div class="bot-note warn"><b>Музыку в эфире ставишь ты, и отвечаешь за неё тоже ты.</b> Twitch проверяет записи эфиров и заглушает в них чужую музыку, а за жалобы правообладателей выдаёт предупреждения — после трёх канал могут удалить. Как снизить риск: в OBS отдай записям эфира (VOD) отдельную звуковую дорожку без музыки — «Настройки → Вывод → Дорожка для VOD Twitch». Тогда в эфире музыка звучит, а в записи её нет.</div>';
    return h;
  }

  function botAccessPreset(){
    var a = BOT.s.access || {}, vals = BOT_CATS.filter(function (c){ return c[0] !== 'mod'; }).map(function (c){ return (a[c[0]] || {}).access; });
    if (vals.every(function (v){ return v === 'always'; })) return 'always';
    if (vals.every(function (v){ return v === 'event'; })) return 'event';
    return 'custom';
  }
  function botCmdHtml(){
    var s = BOT.s, a = s.access || {}, on = s.commandsOn !== false;
    var head = '<div class="bot-mtg">' + bRow('Заказы командой', on ? 'Включено' : 'Выключено — бот не принимает команды. Настройки можно менять', bTg('commandsOn', on, 'Заказы командой')) + '</div>';
    var trig = (s.triggers || ['!play']).map(function (t, i){ var cmd = t.charAt(0) === '!'; return '<span class="bot-chip' + (cmd ? '' : ' word') + '">' + esc(t) + (cmd ? '' : ' <small>слово</small>') + '<button data-act="trig-del" data-i="' + i + '" aria-label="Убрать ' + esc(t) + '">×</button></span>'; }).join('');
    var h = bSec('Команды заказа', 'любое количество — команды и слова',
      bRow('Чем заказывают', 'Зритель пишет команду и песню: <span class="mono">!play кино группа крови</span> или ссылку. Регистр не важен',
        '<div class="bot-trig"><div class="bot-chips">' + trig + '</div><div class="bot-pair"><input class="field" id="botTrigNew" placeholder="!заказ или слово" style="width:200px;font-family:Onest,sans-serif" aria-label="Новая команда"><button class="btn" data-act="trig-add">Добавить</button></div></div>') +
      '<div class="srow"><div class="bot-note" style="flex:1 1 100%"><b>Слова без «!»</b> срабатывают только в начале сообщения и если после слова есть текст; ставится только точно найденное, при ошибке бот молчит. <b>Совет:</b> <span class="mono">!play</span> занята чат-игрой Marbles on Stream — если запускаешь её, убери <span class="mono">!play</span>.</div></div>' +
      bRow('Что делать с найденным заказом', '«Через подтверждение» — заказ падает во вкладку «Заказы», ты жмёшь «＋ В очередь» или «Не то»', bSeg('approval', s.approval || 'auto', [['auto', 'Сразу в очередь, если нашёл'], ['manual', 'Через подтверждение']], 'Подтверждение')));
    var rows = BOT_CATS.map(function (c){
      var k = c[0], t = a[k] || {};
      return '<tr><td>' + c[1] + (k === 'follower' ? '<br><span class="sd">от ' + bNum('access.follower.minDays', t.minDays == null ? 7 : t.minDays, 54, 'Дней фолловинга') + ' дн.</span>' : '') + '</td><td>' +
        bSeg('access.' + k + '.access', t.access || 'event', [['none', 'Нельзя'], ['always', 'Всегда'], ['event', 'По событию']], 'Доступ: ' + c[1]) + '</td>' +
        (t.unlimited ? '<td colspan="2"><span class="pill">без лимитов</span></td>' :
          '<td>' + bNum('access.' + k + '.pauseMin', t.pauseMin == null ? 30 : t.pauseMin, 56, 'Пауза: ' + c[1]) + ' <span class="sd">мин</span></td><td>' + bNum('access.' + k + '.perStream', t.perStream || 0, 56, 'За стрим: ' + c[1]) + '</td>') + '</tr>';
    }).join('');
    h += bSec('Кто и когда может заказывать', 'один активный заказ всегда; лимит за стрим — всегда; пауза — по порогу очереди',
      bRow('Приём', '«Всегда» и «По событию» выставляют доступ всем сразу. Ниже — по категориям', bSeg('_preset', botAccessPreset(), [['always', 'Всегда'], ['event', 'По событию'], ['custom', 'Свой вариант']], 'Приём')) +
      '<div class="srow" style="display:block;overflow-x:auto"><table class="bot-tbl"><thead><tr><th>Категория</th><th>Доступ</th><th>Пауза</th><th>За стрим (0 — без огр.)</th></tr></thead><tbody>' + rows +
      '<tr><td>Стример</td><td colspan="3"><span class="sd">Всегда, без лимитов</span></td></tr></tbody></table></div>' +
      bRow('Пауза считается', 'Через сколько зритель может заказать снова', bSeg('pauseFrom', s.pauseFrom || 'played', [['ordered', 'от заказа'], ['played', 'после того, как трек сыграл']], 'Пауза считается')) +
      '<div class="srow"><div class="bot-note" style="flex:1 1 100%">Несколько ролей (подписчик и VIP) — действует самая щедрая. В розыгрыше события шансы у всех равны.</div></div>');
    h += bSec('Общие правила', 'для всех категорий',
      bRow('Приоритеты заказов', 'Кто встаёт в очередь раньше. Общие для донатов, команд и баллов; «Играть», «В конец очереди» и перетаскивание всегда твои', bTier()) +
      bRow('Потолок очереди команд', 'Больше — бот отвечает «очередь полна»', bNum('queueCap', s.queueCap == null ? 10 : s.queueCap, 80, 'Потолок очереди')) +
      bRow('Пауза включается, когда заказов много', 'Один активный заказ и лимит за стрим действуют всегда. Пауза — только когда в очереди «Твич» не меньше порога (0 — всегда)', bNum('limitsFromQueue', s.limitsFromQueue == null ? 5 : s.limitsFromQueue, 80, 'Порог лимитов')) +
      bRow('Самый короткий трек', 'Против роликов-приколов. Самый длинный и стоп-лист — в «Стримерам → Заказы»', bNum('minTrackSec', s.minTrackSec == null ? 60 : s.minTrackSec, 80, 'Минимальная длина') + ' <span class="sd">сек</span>') +
      bRow('Ссылки YouTube: минимум просмотров', 'Только для YouTube — у Яндекс Музыки официальный каталог', bNum('minViews', s.minViews == null ? 5000 : s.minViews, 100, 'Минимум просмотров')));
    var bl = BOT.blocked.map(function (b){ return '<span class="bot-chip">' + esc(b.login || b.id) + '<button data-act="unblock" data-id="' + esc(b.id) + '" aria-label="Разблокировать">×</button></span>'; }).join('') || '<span class="sd">никого</span>';
    var to = BOT.timeouts.map(function (b){ return '<span class="bot-chip">' + esc(b.login || b.id) + ' · ' + b.leftMin + ' мин<button data-act="untimeout" data-id="' + esc(b.id) + '" aria-label="Снять тайм-аут">×</button></span>'; }).join('') || '<span class="sd">нет</span>';
    h += bSec('Блокировки', 'треки и исполнители — в общем стоп-листе «Заказов»',
      bRow('Кнопка ⛔ у заказов «Твич»', 'Правый клик по заказу в очереди → «⛔ Убрать и закрыть заказы зрителю». На тебя не действует', bSeg('banMin', s.banMin || 10, [[5, '5 мин'], [10, '10 мин'], [30, '30 мин'], [60, '60 мин']], 'Тайм-аут')) +
      bRow('Сейчас в тайм-ауте', '', '<div class="bot-chips">' + to + '</div>') +
      bRow('Заблокированные зрители', 'Насовсем, пока не снимешь. Бот им не отвечает', '<div class="bot-trig"><div class="bot-chips">' + bl + '</div><div class="bot-pair"><input class="field" id="botBlockNew" placeholder="ник зрителя" style="width:200px;font-family:Onest,sans-serif" aria-label="Заблокировать зрителя"><button class="btn" data-act="block">Заблокировать</button></div></div>'));
    return head + '<div class="bot-body' + (on ? '' : ' off') + '">' + h + '</div>';
  }

  function botPtsHtml(){
    var s = BOT.s, r = s.reward || {}, on = s.pointsOn !== false, st = BOT.status || {};
    var head = '<div class="bot-mtg">' + bRow('Заказы за баллы канала', on ? 'Включено' : 'Выключено — награда на Twitch на паузе. Настройки можно менять', bTg('pointsOn', on, 'Заказы за баллы')) + '</div>';
    var h = '<div class="bot-note">Баллы канала есть только у компаньонов и партнёров Twitch. Заказ за баллы — платный: встаёт по приоритетам из «Стримерам → Заказы». Событие его не касается.</div>';
    h += bSec('Награда', s.rewardId ? 'создана Тапёром' : (st.broadcaster ? 'появится после «Обновить»' : 'войди как стример на вкладке «Подключение»'),
      bRow('Название', '', bTxt('reward.title', r.title || 'Заказать песню', 300, 'Название награды')) +
      bRow('Цена', 'Баллы копятся просто за просмотр. Сделай цену ощутимой — иначе за баллы заказывать станет выгоднее, чем донатом', bNum('reward.cost', r.cost || 1000, 110, 'Цена') + ' <span class="sd">баллов</span>') +
      bRow('Подсказка в поле ввода', 'Что зритель видит, когда берёт награду', bTxt('reward.prompt', r.prompt || 'Исполнитель — название или ссылка', 340, 'Подсказка')) +
      bRow('Цвет награды', 'Цвет кнопки награды на Twitch', botRewardColor(r)) +
      bRow('На одного зрителя за стрим', 'Ограничение самого Twitch (0 — без ограничения)', bNum('reward.perUserPerStream', r.perUserPerStream == null ? 2 : r.perUserPerStream, 70, 'На зрителя')) +
      bRow('Перезарядка награды', 'После каждой покупки награда недоступна всем на время (0 — нет)', bNum('reward.cooldownSec', r.cooldownSec || 0, 80, 'Перезарядка') + ' <span class="sd">сек</span>') +
      bRow('Отправить изменения на Twitch', 'Создаст награду, если её ещё нет', '<button class="btn" data-act="reward-sync">Обновить награду</button>'));
    h += '<div class="bot-note"><b>Как это работает.</b> Зритель берёт награду и пишет песню — Twitch сразу списывает баллы. Тапёр ищет её, как заказ из доната. Трек заиграл — награда «выполнена». Не прозвучал (не нашёл, длинный, ты убрал из очереди) — баллы возвращаются сами, бот пишет почему. Сомнение — заказ ждёт тебя во вкладке «Заказы». Награда сама на паузе, когда приём выключен.</div>';
    return head + '<div class="bot-body' + (on ? '' : ' off') + '">' + h + '</div>';
  }

  function botEvHtml(){
    var s = BOT.s, e = s.event || {}, st = BOT.status || {};
    var next = st.event ? 'Идёт событие: ' + st.event.entries + ' заявок' : (st.nextEventMin ? 'Следующее событие примерно через ' + st.nextEventMin + ' мин' : (e.when === 'manual' ? 'Только вручную' : 'Начнётся, когда пойдёт стрим'));
    var h = '<div class="bot-note">Событие — короткий промежуток, когда заказывают категории с доступом «По событию» (вкладка «Заказы командой»). Донаты и баллы канала событие не касается.</div>';
    h += '<div class="bot-hero"><span class="st" style="flex:1 1 260px">' + esc(next) + '</span><button class="pbtn y" data-act="event-open">Открыть сейчас</button><button class="btn" data-act="event-skip">Пропустить следующее</button></div>';
    h += bSec('Когда открывать', '',
      bRow('Как', '', bSeg('event.when', e.when || 'random', [['timer', 'По таймеру'], ['random', 'Случайно'], ['afterEmpty', 'Когда кончились заказы'], ['manual', 'Только вручную']], 'Когда')) +
      bRow('По таймеру — каждые', '', bNum('event.everyMin', e.everyMin || 20, 70, 'Каждые') + ' <span class="sd">мин</span>') +
      bRow('Случайно — в промежутке', 'Нельзя караулить таймер', '<span class="sd">от</span> ' + bNum('event.minMin', e.minMin || 15, 60, 'От') + ' <span class="sd">до</span> ' + bNum('event.maxMin', e.maxMin || 25, 60, 'До') + ' <span class="sd">мин</span>') +
      bRow('Когда кончились заказы — через', '', bNum('event.afterEmptyMin', e.afterEmptyMin == null ? 3 : e.afterEmptyMin, 60, 'Через') + ' <span class="sd">мин</span>') +
      bRow('Не открывать само, если заказов «Твич» в очереди больше', 'Сначала сыграть старые (0 — не проверять)', bNum('event.skipIfQueued', e.skipIfQueued == null ? 5 : e.skipIfQueued, 70, 'Порог')));
    h += bSec('Как выбирать победителей', '',
      bRow('Способ', 'Розыгрыш — честнее к тем, кто печатает медленно; кто первый — азартнее', bSeg('event.method', e.method || 'raffle', [['raffle', 'Розыгрыш'], ['first', 'Кто первый']], 'Способ')) +
      bRow('Сколько победителей', 'Розыгрыш — случайно из заявок, шансы у всех равны. Кто первый — первые подходящие, событие закрывается досрочно',
        '<span class="sd">розыгрыш</span> ' + bNum('event.winners', e.winners || 3, 60, 'Победителей') + ' <span class="sd">кто первый</span> ' + bNum('event.firstN', e.firstN || 10, 60, 'Первых')) +
      bRow('Длительность события', 'Зрители не успевают придумать песню — увеличь', bNum('event.durationSec', e.durationSec || 60, 80, 'Длительность') + ' <span class="sd">сек</span>') +
      bRow('Не выигрывать два события подряд', 'Чтобы шанс доставался другим', bTg('event.noRepeatWin', e.noRepeatWin !== false, 'Не выигрывать подряд')) +
      '<div class="srow"><div class="bot-note" style="flex:1 1 100%"><b>Кто участвует:</b> только точно найденные треки — по названию ищем в официальных каталогах (Яндекс Музыка и др.), YouTube — только ссылкой. Ошибся — бот подскажет, можно исправиться до конца события. Принятую заявку заменить нельзя.</div></div>');
    return h;
  }

  var BOT_REPLY_NAMES = { queued: 'Поставил', awaiting: 'Ждёт стримера', choose: 'Варианты', notFound: 'Не нашёл', notFoundEvent: 'Не нашёл (событие)', rules: 'Не прошёл правила', queueFull: 'Очередь полна', pause: 'Пауза у зрителя', active: 'Заказ уже ждёт', perStream: 'Лимит за стрим', timeout: 'Тайм-аут ⛔', blocked: 'Заблокирован', noAccess: 'Нет доступа', outsideEvent: 'Вне события', outsideEventNoTime: 'Вне события (без времени)', eventOpen: 'Событие: открыто', eventResult: 'Событие: итоги', eventEmpty: 'Событие: никого', repeatWin: 'Выиграл прошлое', offline: 'Стрим не идёт', closed: 'Приём закрыт', pointsCancel: 'Баллы вернул', pointsDoubt: 'Баллы: сомнение', acceptOpen: 'Приём открыт', acceptClosed: 'Приём закрыт (объявление)' };
  function botRepHtml(){
    var def = BOT.replyDef || {}, cur = BOT.s.replies || {};
    var rows = Object.keys(def).map(function (k){
      var c = cur[k] || {}, on = c.on != null ? c.on : def[k].on, txt = c.text != null && c.text !== '' ? c.text : def[k].text, nm = BOT_REPLY_NAMES[k] || k;
      return '<div class="srow bot-rep"><span class="bot-rep-n">' + esc(nm) + '</span><input class="field' + (on ? '' : ' off') + '" type="text" data-t="replies.' + k + '.text" value="' + esc(txt) + '" aria-label="Текст: ' + esc(nm) + '">' + bTg('replies.' + k + '.on', on, 'Ответ: ' + nm) + '</div>';
    }).join('');
    var h = bSec('Тексты ответов', 'каждый можно выключить или переписать', rows +
      '<div class="srow"><div class="sd">Подстановки: {ник} {трек} {время} {место} {причина} {мин} {сек} {заявок} {победители} {варианты}</div></div>');
    var KIND = { points: 'баллы · ', say: '→ ', sys: '· ' };
    var j = BOT.journal.slice(-150).reverse().map(function (x){ var t = new Date(x.at); return '<div><span class="t">' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2) + '</span> ' + esc((KIND[x.kind] || '') + x.text) + '</div>'; }).join('') || '<div class="sd">пусто</div>';
    h += '<div class="bot-sec"><div class="sec-h"><h2 style="font-size:16px">Журнал</h2><span>что пришло из чата и что бот сделал · хранится 7 дней</span><span style="margin-left:auto"><button class="btn" data-act="journal">Обновить</button></span></div><div class="bot-log">' + j + '</div></div>';
    return h;
  }

  function botRender(){
    var box = $('botPanel'); if (!box) return;
    // Б10: пункт меню виден всегда. Если пака, модуля или лицензии нет — понятная подсказка
    // с готовыми действиями (установить пак, пробный период, ключ).
    var hint = typeof packModuleHint === 'function' ? packModuleHint('Чат-бот', BOT.st, 'bot') : '';
    if (hint) { box.innerHTML = hint; return; }
    if (!BOT.s) { box.innerHTML = '<div class="bot-note">' + esc(BOT.st.error ? 'Чат-бот не запустился: ' + BOT.st.error : 'Чат-бот запускается…') + '</div>'; return; }
    var tabs = '<nav class="bot-tabs" aria-label="Разделы модуля">' + BOT_TABS.map(function (t){ return '<button class="' + (BOT.tab === t[0] ? 'on' : '') + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</nav>';
    var body = BOT.tab === 'cmd' ? botCmdHtml() : BOT.tab === 'pts' ? botPtsHtml() : BOT.tab === 'ev' ? botEvHtml() : BOT.tab === 'rep' ? botRepHtml() : botConnHtml();
    box.innerHTML = botLicenseHtml() + tabs + body;
  }

  function botMenu(){
    // Б10: «Чат-бот» всегда в меню — даже без пака, чтобы было видно, что это и как поставить.
    ['goBot', 'sBot'].forEach(function (id){ var e = $(id); if (e) e.hidden = false; });
    var p = $('botPill'), L = BOT.st && BOT.st.license;
    if (p) p.textContent = L && !L.enabled && L.state !== 'not-installed' ? 'выключен' : '';

  }

  // Строки «Чат-бот · …» в стартовом чеклисте (группа «Стрим») — только если модуль есть
  var botQcAdded = false;
  var BOT_QC_IDS = ['bot.login', 'bot.chat', 'bot.points', 'bot.license'];
  // Строка лицензии в чеклисте. Пак не включён — серая строка, не «проблема» (16.11.2026):
  // жёлтым только пробный на исходе и переведённые назад часы.
  function botLicQc(lic){
    var text = lic.state === 'full' ? 'куплен'
      : lic.state === 'trial' ? 'пробный период · ' + lic.daysLeft + ' дн.'
      : lic.state === 'trial-ended' ? 'пробный период закончился'
      : lic.state === 'other-pc' ? 'лицензия от другого компьютера'
      : lic.state === 'clock' ? 'часы компьютера переведены назад'
      : lic.state === 'edition' ? 'нужна новая редакция пака'
      : lic.state === 'dev' ? 'режим разработки'
      : lic.state === 'not-installed' ? 'пак не установлен'
      : 'не активирован';
    var state = lic.enabled ? (lic.state === 'trial' && lic.daysLeft <= 3 ? 'warn' : 'ok') : (lic.state === 'clock' ? 'warn' : 'off');
    return { id: 'bot.license', state: state, text: text };
  }
  // Нет пака — строк бота в проверке нет вовсе; пак есть, но не работает — серые строки без ошибки.
  function botQcSync(){
    var st = BOT.st;
    if (!st || !st.installed) {
      if (!botQcAdded) return;
      QC_GROUPS.forEach(function (g){ g[1] = g[1].filter(function (x){ return BOT_QC_IDS.indexOf(x[0]) < 0; }); });
      for (var k = QC_ALL.length - 1; k >= 0; k--) if (BOT_QC_IDS.indexOf(QC_ALL[k]) >= 0) QC_ALL.splice(k, 1);
      BOT_QC_IDS.forEach(function (id){ delete QC.items[id]; });
      botQcAdded = false;
      if (typeof renderQC === 'function') { renderQC(); renderHealthWarn(); }
      return;
    }
    if (st.running) return;   // работает — лампочки даёт сам модуль (botLoad / botQcRefresh)
    var lic = st.license || {};
    var why = lic.enabled ? 'бот не запущен' : 'пак не включён';
    ['bot.login', 'bot.chat', 'bot.points'].forEach(function (id){ QC.items[id] = { id: id, state: 'off', text: why }; });
    QC.items['bot.license'] = botLicQc(lic);
    if (typeof renderQC === 'function') { renderQC(); renderHealthWarn(); }
  }
  // Пак работает, но чат-ботом не пользуются (заказы из чата принимает Streamer.bot или никто) — вход,
  // чат и награда бота не «проблема»: серые строки «чат-бот не используется» (16.11.2026, вопрос владельца).
  // Лицензия показывается как есть. Зовётся для каждой строки бота, откуда бы она ни пришла.
  // Так же, если в чат-боте ни разу не входили в Twitch (вход есть, но устарел — это по-прежнему проблема).
  function botQcItem(it){
    if (!it || !/^bot\.(login|chat|points)$/.test(it.id)) return it;
    if (BOT.chatOrders !== 'pack') return { id: it.id, state: 'off', text: 'чат-бот не используется' };
    var st = BOT.status;
    if (!st || (!st.chat && !st.broadcaster)) return { id: it.id, state: 'off', text: 'в Twitch не входили' };
    return it;
  }
  function botQcGroups(){
    if (botQcAdded || !BOT.st || !BOT.st.installed) return;
    var g = QC_GROUPS.filter(function (x){ return x[0] === 'Стрим'; })[0]; if (!g) return;
    [['bot.login', 'Чат-бот · вход'], ['bot.chat', 'Чат-бот · чат канала'], ['bot.points', 'Чат-бот · награда за баллы'], ['bot.license', 'Чат-бот · лицензия']].forEach(function (it){ g[1].push(it); QC_ALL.push(it[0]); });
    botQcAdded = true;
  }

  async function botLoad(full){
    try { BOT.st = await A.modStatus(); } catch (e) { BOT.st = null; }
    // Кто принимает заказы из чата — общая настройка ядра (0.35): none | pack | sbot.
    // Тумблер «Принимать заказы» здесь — только окно к ней, своей настройки у пака нет.
    try { var co = await A.getSetting('chatOrders'); BOT.chatOrders = co === 'sbot' || co === 'pack' ? co : 'none'; } catch (e) { BOT.chatOrders = 'none'; }
    botMenu(); botQcGroups(); botQcSync();
    if (!BOT.st || !BOT.st.running) { botRender(); return; }
    try {
      BOT.s = await A.botCmd('settings');
      BOT_BAN_MIN = Number(BOT.s.banMin) || 10;
      BOT.status = await A.botCmd('status');
      if (full || !BOT.replyDef) BOT.replyDef = await A.botCmd('replyDefaults');
      if (full) { BOT.journal = await A.botCmd('journal'); BOT.blocked = await A.botCmd('blocked'); BOT.timeouts = await A.botCmd('timeouts'); }
      (await A.botCmd('health')).forEach(function (it){ QC.items[it.id] = botQcItem(it); });
      // Если модуль не сообщает состояние строки — не оставляем её пустой («ждёт»)
      ['bot.login', 'bot.chat', 'bot.points'].forEach(function (id) { QC.items[id] = botQcItem(QC.items[id] || { id: id, state: 'off', text: '—' }); });
      if (BOT.st.license) QC.items['bot.license'] = botLicQc(BOT.st.license);
      renderQC(); renderHealthWarn();
    } catch (e) { BOT.s = null; }
    botRender();
  }
  function openBotPanel(tab){ if (tab) BOT.tab = tab; setTab('settings', 'sBot'); botLoad(true).then(function(){ if (typeof showSettingsPane === 'function') showSettingsPane('sBot'); else { var e = $('sBot'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }); }

  // После входа бот перезапускается: обновляем интерфейс с повторами, пока модуль не поднимется
  function botRefreshSoon(attempt){
    attempt = attempt || 0;
    setTimeout(function(){
      botLoad(true).then(function(){
        if ((!BOT.st || !BOT.st.running || !BOT.s) && attempt < 6) botRefreshSoon(attempt + 1);
      }).catch(function(){ if (attempt < 6) botRefreshSoon(attempt + 1); });
    }, attempt ? 2500 : 400);
  }

  // Перечитать «лампочки» бота в чеклисте (health модуля). Зовётся после перепроверки
  // чеклиста и после автопочинки: health живёт в модуле, а не в общей проверке.
  function botQcRefresh(){
    if (!A.botCmd || !BOT.st || !BOT.st.running) return Promise.resolve();
    return A.botCmd('health').then(function (list) {
      (list || []).forEach(function (it) { if (it && it.id) QC.items[it.id] = botQcItem(it); });
      // Модуль не всегда публикует состояние (например, награда ещё не создана).
      // Пустая строка рисовалась заглушкой «ждёт» — выглядело как застывшая проблема.
      ['bot.login', 'bot.chat', 'bot.points'].forEach(function (id) {
        if (!QC.items[id]) QC.items[id] = { id: id, state: 'off', text: '—' };
      });
      renderQC(); renderHealthWarn();
    }).catch(function () {});
  }

  function botWatchLogin(){
    clearInterval(BOT.poll); var n = 0;
    // Вход по коду может занять и 5, и 10 минут (открыл страницу, ввёл код) — ждём долго
    BOT.poll = setInterval(async function(){
      n++;
      var st;
      try { st = await A.botCmd('status'); }
      catch (e) {
        // Бот перезапускается после входа — это нормально, продолжаем ждать
        if (n > 300) { clearInterval(BOT.poll); botRender(); }
        return;
      }
      BOT.status = st;
      if (st.chat || st.broadcaster) {
        BOT.code = null; clearInterval(BOT.poll);
        toast('Вошёл в Twitch');
        botRefreshSoon();
        return;
      }
      if (n > 300) { clearInterval(BOT.poll); BOT.code = null; botRender(); }
    }, 2000);
    // Вернулся в окно — сразу проверяем, не вошёл ли уже
    if (window.__botFocusHook) window.removeEventListener('focus', window.__botFocusHook);
    window.__botFocusHook = function(){
      if (!BOT.poll) return;
      A.botCmd('status').then(function(st){
        BOT.status = st;
        if (st.chat || st.broadcaster) { BOT.code = null; clearInterval(BOT.poll); toast('Вошёл в Twitch'); botRefreshSoon(); }
      }).catch(function(){});
    };
    window.addEventListener('focus', window.__botFocusHook);
  }

  var botPanelEl = $('botPanel');
  if (botPanelEl) {
    botPanelEl.addEventListener('click', async function(e){
      var b = e.target.closest('[data-b],[data-v],[data-act],[data-tier]'); if (!b) return;
      if (b.dataset.tier) { REQ_TIERS = b.dataset.tier; A.setSetting('reqTiers', REQ_TIERS); botRender(); return; }
      // Общий выключатель: тумблер пака и тумблер Streamer.bot — одно и то же (chatOrders).
      if (b.dataset.b === 'accepting') {
        var nowPack = BOT.chatOrders !== 'pack';
        var okSet = false;
        try { okSet = await A.setSetting('chatOrders', nowPack ? 'pack' : 'none'); } catch (x) { okSet = false; }
        if (!okSet) { toast('Не получилось переключить приём'); return; }
        BOT.chatOrders = nowPack ? 'pack' : 'none';
        botLoad(false);
        return;
      }
      if (b.dataset.b) { var on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); await botSet(b.dataset.b, on); botRender(); return; }
      if (b.dataset.v) {
        var path = b.dataset.v, raw = b.dataset.val, val = /^\d+$/.test(raw) ? Number(raw) : raw;
        if (path === '_preset') { if (val !== 'custom') { BOT_CATS.forEach(function (c){ if (c[0] !== 'mod') { BOT.s.access[c[0]] = BOT.s.access[c[0]] || {}; BOT.s.access[c[0]].access = val; } }); await botSet('access', BOT.s.access); } botRender(); return; }
        await botSet(path, val);
        if (path === 'identity') BOT.status = await A.botCmd('status').catch(function(){ return BOT.status; });
        botRender(); return;
      }
      var act = b.dataset.act;
      if (act === 'tab') { BOT.tab = b.dataset.tab; botLoad(BOT.tab === 'rep' || BOT.tab === 'cmd'); return; }
      if (act === 'take-pack') {
        var okTake = false;
        try { okTake = await A.setSetting('chatOrders', 'pack'); } catch (x) { okTake = false; }
        if (!okTake) { toast('Не получилось включить приём'); return; }
        BOT.chatOrders = 'pack';
        botLoad(false);
        return;
      }
      if (act === 'reward-color') {
        var rcur = (BOT.s && BOT.s.reward && BOT.s.reward.color) || '', rnext = rcur;
        colOpenFor('Цвет награды', rcur || '', function (hex){ rnext = hex; }, function (){
          if (!rnext || rnext === rcur) return;
          botSet('reward.color', rnext).then(function (){ botRender(); });
        });
        return;
      }
      if (act === 'login') { try { BOT.code = await A.botCmd('login', { role: b.dataset.role }); botRender(); botWatchLogin(); } catch (x) { toast('Twitch: ' + (x.message || x)); } return; }
      if (act === 'code-open') { if (BOT.code) A.openLink(BOT.code.verificationUri); return; }
      if (act === 'logout') { await A.botCmd('logout', { role: b.dataset.role }); botLoad(true); return; }
      if (act === 'trig-add') {
        var inp = $('botTrigNew'), t = (inp && inp.value || '').trim().toLowerCase(); if (!t) return;
        var list = (BOT.s.triggers || []).slice();
        if (list.indexOf(t) >= 0) { toast('Уже есть'); return; }
        if (/\s/.test(t)) { toast('Без пробелов: одно слово или команда'); return; }
        if (['!отмена', '!песня', '!место', '!событие'].indexOf(t) >= 0) { toast('Это служебная команда бота'); return; }
        list.push(t); await botSet('triggers', list); botRender(); return;
      }
      if (act === 'trig-del') { var l2 = (BOT.s.triggers || []).slice(); l2.splice(+b.dataset.i, 1); if (!l2.length) { toast('Нужна хотя бы одна команда'); return; } await botSet('triggers', l2); botRender(); return; }
      if (act === 'event-open') { var ok = await A.botCmd('event:open').catch(function (x){ toast(x.message || x); return null; }); if (ok != null) toast(ok ? 'Событие открыто' : 'Событие уже идёт'); botLoad(false); return; }
      if (act === 'event-skip') { await A.botCmd('event:skip'); toast('Следующее событие пропущу'); return; }
      if (act === 'reward-sync') { try { await A.botCmd('reward:sync'); toast('Награда обновлена'); } catch (x) { toast('Twitch: ' + (x.message || x)); } botLoad(false); return; }
      if (act === 'journal') { BOT.journal = await A.botCmd('journal'); botRender(); return; }
      if (act === 'unblock') { await A.botCmd('unblock', { id: b.dataset.id }); botLoad(true); return; }
      if (act === 'untimeout') { await A.botCmd('untimeout', { id: b.dataset.id }); botLoad(true); return; }
      if (act === 'block') { var bi = $('botBlockNew'), nick = (bi && bi.value || '').trim().replace(/^@/, '').toLowerCase(); if (!nick) return; await A.botCmd('blockLogin', { login: nick }).then(function(){ toast('Заблокирован: ' + nick); }).catch(function (x){ toast(x.message || x); }); botLoad(true); return; }
    });
    botPanelEl.addEventListener('change', async function(e){
      var t = e.target;
      if (t.dataset.n) { var n = Number(t.value); if (!isFinite(n) || n < 0) { toast('Нужно число'); return; } await botSet(t.dataset.n, n); botRender(); }
      else if (t.dataset.t) { await botSet(t.dataset.t, t.value); }
    });
  }

  if (A.onModStatus) A.onModStatus(function (st){ BOT.st = st; botMenu(); botQcGroups(); botQcSync(); botLoad(false); });
  if (A.modStatus) setTimeout(function(){ botLoad(false); }, 3500);
  botMenu(); // Б10: пункт виден сразу, не ждём ответа о паке
  document.addEventListener('click', function(e){ if (e.target.closest('[data-go="sBot"]')) botLoad(true); });
