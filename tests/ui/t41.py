# 0.35, Э4: экран «Streamer.bot» (Настройки → Стримерам): три вкладки, пароль не возвращается,
# конструктор «изменено, не записано» → «Записать» зовёт sbot-write-settings с tapyor-именами,
# полоса «изменено в Streamer.bot», общий выключатель с ботом пака, чеклист и подпись sb-* в «Заказах».
import os, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
# Куда класть скриншоты: по умолчанию рядом с тестом (tests/ игнорирует *.png),
# а на ПК владельца можно задать SBOT_SHOTS. Абсолютных путей в файле нет — он попадает
# в открытый снимок (tools/public-export.mjs).
OUT = os.environ.get('SBOT_SHOTS') or os.path.join(HERE, 'shots-sbot')
os.makedirs(OUT, exist_ok=True)

# Поддельный Streamer.bot: форматы ответов — из ответов настоящего 1.0.7 (SB-FORMATS.json).
# chatOrders = sbot, а в Streamer.bot потолок очереди 15 — конструктор 10. Значит, должна
# появиться полоса «в Streamer.bot изменены вручную».
SBOT = """
(function(){
  var P = function(v){ return new Promise(function(r){ setTimeout(function(){ r(v); }, 10); }); };
  var now = Date.now();
  var globals = {
    tapyorCmdOrder:'!sr, !play', tapyorOnOrder:'1', tapyorCmdSong:'!song', tapyorOnSong:'1',
    tapyorCmdPlace:'!place', tapyorOnPlace:'1', tapyorCmdCancel:'!cancel', tapyorOnCancel:'1',
    tapyorCmdSkip:'!skip', tapyorOnSkip:'1', tapyorWho:'all', tapyorFollowDays:'0', tapyorPerUser:'1',
    tapyorPauseMin:'30', tapyorChatCap:'15', tapyorVipFree:'1', tapyorDoubt:'wait', tapyorPoints:'1',
    tapyorRewardName:'Заказать песню', tapyorPauseReward:'1', tapyorReplyAs:'broadcaster',
    tapyorReplyMode:'reply', tapyorTxtQueued:'', tapyorUrl:'http://127.0.0.1:47654', tapyorKey:'SECRET'
  };
  var written = JSON.parse(JSON.stringify(globals));
  written.tapyorChatCap = '10'; // так конструктор записал в прошлый раз
  delete written.tapyorUrl; delete written.tapyorKey;
  var st = {
    status:'ok', text:'Связь со Streamer.bot есть', host:'127.0.0.1', port:8080, endpoint:'/',
    hasPassword:true, sbVersion:'1.0.7', twitch:{connected:true, name:'streamer'},
    bot:{connected:null, name:''}, templateFound:true, templateVersion:1, templateCurrent:1,
    actionsFound:{setup:true, findReward:true, played:true, dropped:true},
    triggersFound:['tapyor_order_queued','tapyor_order_pending','tapyor_order_played',
      'tapyor_order_dropped','tapyor_track_started','tapyor_queue_empty','tapyor_accept_changed'],
    lastOrderAt: now - 120000, tapyorPort:47654, chatOrders:'sbot', accepting:true, mailbox:0,
    globals:globals, written:written
  };
  window.__sb = { st: st, conn: null, resets: 0, saved: null };
  window.app.sbotStatus = function(){ return P(JSON.parse(JSON.stringify(st))); };
  window.app.sbotGlobals = function(){ return P(JSON.parse(JSON.stringify(st.globals))); };
  window.app.sbotPortKey = function(){ return P('tp_TESTKEY1234567890abcdef'); };
  window.app.sbotSetConn = function(o){ window.__sb.conn = o; return P({ ok:true, host:o.host, port:o.port, endpoint:'/', hasPassword:true, changed:true }); };
  window.app.sbotConnect = function(){ window.__sb.connected = true; return P({ ok:true }); };
  window.app.sbotDisconnect = function(){ window.__sb.connected = false; return P({ ok:true }); };
  window.app.sbotWriteSettings = function(v){ window.__sb.saved = v; st.written = JSON.parse(JSON.stringify(v)); st.globals = Object.assign({}, st.globals, v); return P({ ok:true, count:Object.keys(v).length }); };
  window.app.sbotFindReward = function(){ st.globals.tapyorRewardId = 'reward-1'; return P({ ok:true, rewardId:'reward-1', message:'награда найдена' }); };
  window.app.sbotTrigger = function(n){ window.__sb.trig = n; return P({ ok:true, message:'триггер отправлен' }); };
  window.app.sbotCopyTemplate = function(){ return P({ ok:false, missing:true, message:'шаблон появится в следующей сборке' }); };
  window.app.sbotPortKeyReset = function(){ window.__sb.resets++; return P({ ok:true }); };
  window.app.onSbotState = function(cb){ window.__sbotState = cb; };
  // Пак: для страницы «Чат-бот» — установлен, запущен, лицензия полная.
  window.app.modStatus = function(){ return P({ installed:true, running:true, error:null,
    manifest:{ id:'streamer-pack', version:'0.3.0', minCore:'0.32.0', modules:[{ id:'bot', name:'Чат-бот Twitch' }] },
    dev:false, prev:null, server:false, keyMask:'',
    license:{ enabled:true, state:'full' }, modules:{ bot:{ name:'Чат-бот Twitch', running:true, error:null } } }); };
  window.app.botCmd = function(cmd){
    if (cmd === 'settings') return P({ accepting: window.__store.chatOrders === 'pack', onlyLive:true, identity:'self',
      commandsOn:true, pointsOn:true, triggers:['!play'], approval:'auto', sharedChat:'own',
      access:{ viewer:{access:'event'}, follower:{access:'event', minDays:7}, sub:{access:'event'}, vip:{access:'event'} },
      reward:{ title:'Заказать песню', cost:1000 } });
    if (cmd === 'status') return P({ channel:{ login:'streamer' }, online:true });
    if (cmd === 'replyDefaults') return P({});
    if (cmd === 'health') return P([]);
    if (cmd === 'journal') return P([]);
    if (cmd === 'blocked') return P([]);
    if (cmd === 'timeouts') return P([]);
    return P({});
  };
  window.app.onModStatus = function(){};
  // Общий выключатель: главный процесс в жизни шлёт тост ui-toast. Здесь его изображаем,
  // чтобы проверить, что окно показывает нужный текст.
  var oldSet = window.app.setSetting;
  window.app.onUiToast = function(cb){ window.__toastCb = cb; };
  window.app.setSetting = function(k, v){
    var r = oldSet(k, v);
    if (k === 'chatOrders') {
      window.__store.chatOrders = v;
      if (window.__toastCb) {
        window.__toastCb(v === 'sbot' ? 'Чат-бот пака выключен: заказы из чата теперь через Streamer.bot'
          : v === 'pack' ? 'Streamer.bot выключен: заказы из чата теперь принимает чат-бот пака'
          : 'Приём заказов из чата выключен');
      }
    }
    return r;
  };
  window.__store.chatOrders = 'sbot';
  window.__store.sbotEnabled = true;
})();
"""

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)

async def main():
    srv = subprocess.Popen(['python', '-m', 'http.server', '8797', '--bind', '127.0.0.1'], cwd=HERE,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
            pg = await b.new_page(viewport={'width':1440, 'height':1000})
            await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
            await pg.add_init_script(SBOT)
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e) + ' || ' + (getattr(e, 'stack', '') or '')))
            await pg.goto('http://127.0.0.1:8797/app2/index.html')
            await pg.wait_for_timeout(1200)
            E = pg.evaluate
            vis = lambda sel: E("(()=>{var e=document.querySelector('%s'); return !!e && e.offsetParent!==null})()" % sel)

            # 1. Пункт меню и раздел видны при «Стримерам», точка связи горит.
            await pg.click('#tabs [data-tab=settings]'); await pg.wait_for_timeout(300)
            ok(await vis('.set-side [data-go=sSbot]'), 'пункт «Streamer.bot» в меню виден')
            ok(await E("document.getElementById('goSbot').textContent.trim()") == 'Streamer.bot', 'название пункта')
            ok(await E("document.getElementById('sbDot').hidden") is False, 'точка связи показана при связи')
            await pg.click('.set-side [data-go=sSbot]'); await pg.wait_for_timeout(600)
            ok(await vis('#sSbot'), 'раздел «Streamer.bot» открылся')
            ok((await E("document.getElementById('sbHeadText').textContent")).find('1.0.7') >= 0, 'в шапке версия Streamer.bot')
            ok('последний заказ' in await E("document.getElementById('sbHeadText').textContent"), 'в шапке время последнего заказа')
            ok(await E("document.getElementById('sbAcceptTg').classList.contains('on')"), 'тумблер «Принимать заказы» включён')
            ok((await E("document.getElementById('sbSummary').textContent")).startswith('Сейчас так:'), 'строка простыми словами собрана')
            ok('командой !sr или !play' in await E("document.getElementById('sbSummary').textContent"), 'в строке команды из конструктора')

            # 1b. Приём закрыли из Streamer.bot (/sb/accept?on=0): тумблер выключен, есть строка «открыть».
            await E("window.__sb.st.accepting = false; SB.st.accepting = false; sbRenderHead();")
            await pg.wait_for_timeout(200)
            ok(await E("document.getElementById('sbAcceptTg').classList.contains('on')") is False, 'тумблер выключен, когда приём закрыт из Streamer.bot')
            ok(await vis('#sbAcceptOpen'), 'строка «Приём закрыт из Streamer.bot — открыть» показана')
            await pg.click('#sbAcceptOpen'); await pg.wait_for_timeout(400)
            ok(await E("SB.st.accepting !== false"), 'кнопка открыла приём')
            ok(await E("document.getElementById('sbAcceptTg').classList.contains('on')") is True, 'тумблер снова включён')
            ok(not await vis('#sbAcceptOpen'), 'строка «открыть» пропала')

            # 1c. Событие sbot-state с частью полей не стирает globals/порт (A35-7).
            await E("window.__sbotState({status:'ok'})")
            await pg.wait_for_timeout(150)
            ok(await E("SB.st.globals && SB.st.globals.tapyorChatCap === '15'"), 'globals на месте после события')
            ok(await E("SB.st.tapyorPort === 47654"), 'порт Тапёра на месте после события')

            # 2. Три вкладки: открыта ровно одна.
            ok(await E("document.querySelectorAll('#sbTabs [data-sbtab]').length") == 3, 'три вкладки')
            ok(await vis('#sbConn') and not await vis('#sbKit') and not await vis('#sbApi'), 'сначала «Подключение»')
            await pg.click('[data-sbtab=kit]'); await pg.wait_for_timeout(300)
            ok(not await vis('#sbConn') and await vis('#sbKit') and not await vis('#sbApi'), '«Конструктор» — одна')
            ok((await E("document.getElementById('sbKit').innerText")).lower().find('tapyor') < 0, 'в видимом тексте нет сырых имён переменных')
            ok(await E("!document.querySelector('[data-sbtext=\"tapyorTxtCap\"]')"), 'поля «Очередь полна» нет — шаблон его не знает')
            await pg.click('[data-sbtab=api]'); await pg.wait_for_timeout(300)
            ok(not await vis('#sbConn') and not await vis('#sbKit') and await vis('#sbApi'), '«Для умельцев» — одна')
            ok('/sb/order' in await E("document.getElementById('sbApi').textContent"), 'в справке есть ссылка /sb/order')

            # 3. Пароль не возвращается в поле.
            await pg.click('[data-sbtab=conn]'); await pg.wait_for_timeout(300)
            ok(await E("document.getElementById('sbPassword').type") == 'password', 'пароль — type=password')
            ok(await E("document.getElementById('sbPassword').value") == '', 'поле пароля пустое после сохранения')
            ok('Пароль сохранён' in await E("document.getElementById('sbConn').textContent"), 'подпись «пароль сохранён»')
            await pg.click('#sbConnect'); await pg.wait_for_timeout(500)
            conn = await E("window.__sb.conn")
            ok(conn and conn['host'] == '127.0.0.1' and conn['port'] == 8080, '«Подключиться» отправляет адрес и порт')
            ok(conn and 'password' not in conn, 'пустой пароль не отправляется')
            await pg.fill('#sbPassword', 'секрет'); await pg.click('#sbConnect'); await pg.wait_for_timeout(500)
            ok(await E("window.__sb.conn.password") == 'секрет', 'новый пароль отправляется')
            ok(await E("document.getElementById('sbPassword').value") == '', 'после сохранения поле снова пустое')

            # 4. Конструктор: «изменено, не записано» → «Записать» с правильными именами.
            await pg.click('[data-sbtab=kit]'); await pg.wait_for_timeout(300)
            ok(await E("document.getElementById('sbDirty').hidden") is True, 'сначала «изменено» скрыто')
            await pg.fill('[data-sbtext="tapyorTxtQueued"]', '@{user}, тест')
            await pg.fill('[data-sbnum="tapyorChatCap"]', '12')
            await pg.wait_for_timeout(200)
            ok(await E("document.getElementById('sbDirty').hidden") is False, 'правка показывает «изменено, не записано»')
            await pg.click('#sbSave'); await pg.wait_for_timeout(600)
            saved = await E("window.__sb.saved")
            ok(bool(saved), '«Записать» вызвал sbot-write-settings')
            ok(saved.get('tapyorTxtQueued') == '@{user}, тест' and saved.get('tapyorChatCap') == 12, 'значения ушли как есть')
            ok(saved.get('tapyorVipFree') == '1' and saved.get('tapyorPoints') == '1', '«да/нет» записаны как 1/0')
            ok(saved.get('tapyorCmdOrder') == '!sr, !play', 'команды — строкой через запятую')
            ok('tapyorUrl' not in saved and 'tapyorKey' not in saved, 'адрес и ключ окно не подменяет')
            ok(await E("document.getElementById('sbDirty').hidden") is True, 'после записи «изменено» скрыто')
            tx = await E("(document.getElementById('toast')||{}).textContent || ''")
            ok('Записано в Streamer.bot' in tx, 'тост о записи')

            # 5. Полоса «в Streamer.bot изменены вручную» — после правки потолка в Streamer.bot.
            await E("window.__sb.st.globals.tapyorChatCap = '15'; window.__sb.st.written = Object.assign({}, window.__sb.st.written, {tapyorChatCap:'10'}); sbLoad(false); sbRenderKit()")
            await pg.wait_for_timeout(400)
            ok(await vis('#sbRemote'), 'полоса «изменено в Streamer.bot» показана')
            ok('Потолок очереди' in await E("document.getElementById('sbRemote').textContent"), 'в полосе написано, что разошлось')
            await pg.click('[data-sbremote=take]'); await pg.wait_for_timeout(600)
            ok(await E("window.__sb.saved.tapyorChatCap") == 15, '«Взять оттуда» записывает значение из Streamer.bot')
            ok(not await vis('#sbRemote'), 'полоса исчезла')

            # 6. Общий выключатель: Streamer.bot включён → бот пака выключен, тост.
            await E("window.__store.chatOrders='pack'; sbLoad(true)")
            await pg.wait_for_timeout(400)
            ok(await E("document.getElementById('sbAcceptTg').classList.contains('on')") is False, 'при боте пака тумблер Streamer.bot выключен')
            ok('принимает чат-бот пака' in await E("document.getElementById('sbSummary').textContent"), 'строка «сейчас принимает чат-бот пака»')
            await pg.click('#sbAcceptTg'); await pg.wait_for_timeout(500)
            ok(await E("A.getSetting('chatOrders')") == 'sbot', 'включил Streamer.bot — общая настройка sbot')
            ok(await E("document.getElementById('sbAcceptTg').classList.contains('on')") is True, 'тумблер включился')
            tx = await E("(document.getElementById('toast')||{}).textContent || ''")
            ok('Чат-бот пака выключен' in tx, 'тост: чат-бот пака выключен')

            # Бот пака: его тумблер показывает ту же настройку и выключен.
            await E("setTab('settings'); showSettingsPane('sBot'); botLoad(true)")
            await pg.wait_for_timeout(600)
            ok(await E("document.querySelector('[data-b=accepting]') && !document.querySelector('[data-b=accepting]').classList.contains('on')"), 'у бота пака тумблер выключен')
            ok('принимает Streamer.bot' in await E("document.getElementById('botPanel').textContent"), 'у бота пака строка «принимает Streamer.bot»')
            await pg.click('[data-b=accepting]'); await pg.wait_for_timeout(700)
            ok(await E("A.getSetting('chatOrders')") == 'pack', 'включил бота пака — общая настройка pack')
            tx = await E("(document.getElementById('toast')||{}).textContent || ''")
            ok('Streamer.bot выключен' in tx, 'тост: Streamer.bot выключен')
            ok('принимает Streamer.bot' not in await E("document.getElementById('botPanel').textContent"), 'строка «принимает Streamer.bot» пропала')

            # 7. Чеклист: строки «Streamer.bot · связь» и «· шаблон» только в режиме Streamer.bot.
            #    «Пульт когда-то включали» (sbotEnabled=true) при заказах через бота пака —
            #    не повод показывать ошибку (G1, 13.11).
            await E("window.__store.chatOrders='pack'; window.__store.sbotEnabled=true; sbLoad(true)")
            await pg.wait_for_timeout(500)
            ok(await E("SB.sbotEnabled === true"), 'пульт помечен включённым, как после старого подключения')
            ok(not await E("QC_GROUPS.some(g=>g[1].some(it=>it[0]==='sbot.link'))"), 'при заказах через бота пака строки «связь» нет')
            ok(not await E("QC_GROUPS.some(g=>g[1].some(it=>it[0]==='sbot.tpl'))"), 'при заказах через бота пака строки «шаблон» нет')
            ok(not await E("!!QC.items['sbot.link']"), 'старая строка «связь» убрана из списка')
            await E("window.__store.chatOrders='sbot'; sbLoad(true)")
            await pg.wait_for_timeout(500)
            ok(await E("QC_GROUPS.some(g=>g[1].some(it=>it[0]==='sbot.link'))"), 'в чеклисте есть строка «связь»')
            ok(await E("QC_GROUPS.some(g=>g[1].some(it=>it[0]==='sbot.tpl'))"), 'в чеклисте есть строка «шаблон»')
            ok(await E("QC.items['sbot.link'] && QC.items['sbot.link'].state") == 'ok', 'строка связи — зелёная')
            await E("setTab('search'); document.getElementById('results').hidden=false; renderQC()")
            await pg.wait_for_timeout(300)
            ok('Streamer.bot · связь' in await E("document.getElementById('qcBox').textContent"), 'чеклист нарисован в окне')
            ok('Streamer.bot · шаблон' in await E("document.getElementById('qcBox').textContent"), 'строка шаблона нарисована')

            # 8. Шапка: «Streamer.bot не отвечает» после 30 секунд без связи.
            await E("SB.st.status='error'; SB.chatOrders='sbot'; SB.badSince=Date.now()-31000; sbWarnTick()")
            await pg.wait_for_timeout(200)
            ok(await vis('#sbotWarn'), 'предупреждение в шапке показано')
            ok('Streamer.bot не отвечает' in await E("document.getElementById('sbotWarn').textContent"), 'текст предупреждения')
            await E("SB.st.status='ok'; sbWarnTick()")
            await pg.wait_for_timeout(150)
            ok(not await vis('#sbotWarn'), 'при связи предупреждение скрыто')

            # 9. В «Заказах» у заказа sb-* своя подпись.
            await E("""RQ.list = [{ prov:'sb-cmd', key:'sb-cmd:t1', id:'t1', name:'зритель', text:'кино кукушка',
              amount:null, currency:'', got:Date.now(), at:Date.now(), state:'new', level:'exact',
              items:[{ level:'exact', track:{ src:'ym', id:'1', title:'Кукушка', author:'Кино', duration:'3:00' } }] }];
              setTab('req'); rqRender();""")
            await pg.wait_for_timeout(400)
            ok('Streamer.bot · команда' in await E("document.getElementById('rqList').textContent"), 'в «Заказах» подпись «Streamer.bot · команда»')

            # 9b. Заказ sb-* в очереди: req.key попадает в «today» — после перезапуска played/dropped
            # дойдут, а уборка при запуске не снимет заказ, чей трек уже в очереди (A35-1).
            await E("queue = [{src:'ym', id:'1', title:'Кукушка', author:'Кино', seconds:160, req:{who:'зритель', amt:null, cur:'', key:'sb-points:sp1', ii:0}}]; current = 0; renderQueue(); saveToday()")
            await pg.wait_for_timeout(900)
            today = await E("window.__store.today")
            ok(bool(today) and today['items'][0].get('req', {}).get('key') == 'sb-points:sp1', '«today» сохраняет req.key заказа Streamer.bot')
            pend = await E("rqPending({key:'sb-points:sp1', droppedAt:Date.now(), items:[{level:'exact', track:{src:'ym', id:'1', title:'Кукушка', author:'Кино'}}]}).length")
            ok(pend == 0, 'снятый заказ (droppedAt) не считается ждущим')

            # 10. Раздел виден только при включённом «Стримерам».
            await E("setTab('settings'); showSettingsPane('sSbot'); sbLoad(true)")
            await pg.wait_for_timeout(400)
            await pg.click('#setStreamerTg'); await pg.wait_for_timeout(300)
            ok(not await vis('#sSbot'), 'выключил «Стримерам» — раздела нет')
            ok(not await vis('.set-side [data-go=sSbot]'), 'и пункта меню нет')
            await pg.click('#setStreamerTg'); await pg.wait_for_timeout(300)
            ok(await vis('.set-side [data-go=sSbot]'), 'включил — пункт вернулся')

            # 11. Скриншоты всех трёх вкладок: 1440 и 1000 px.
            for w, h in ((1440, 1000), (1000, 800)):
                await pg.set_viewport_size({'width': w, 'height': h})
                await E("setTab('settings'); showSettingsPane('sSbot'); document.querySelector('.set-main').scrollTop=0")
                await pg.wait_for_timeout(300)
                for tab in ('conn', 'kit', 'api'):
                    await pg.click('[data-sbtab=%s]' % tab); await pg.wait_for_timeout(250)
                    await E("document.querySelector('.set-main').scrollTop=0")
                    await pg.wait_for_timeout(150)
                    await pg.screenshot(path=os.path.join(OUT, 'E4-%s-%d.png' % (tab, w)))
            ok(True, 'скриншоты: ' + OUT)

            print('ошибки:', errs)
            ok(not errs, 'без ошибок страницы')
            await b.close()
    finally:
        srv.terminate()

try:
    asyncio.run(main())
finally:
    pass
