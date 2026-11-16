# C3: одно окно цвета (#colv) на весь интерфейс.
#  - открывается из темы, из цветовых схем оболочки и из награды Twitch;
#  - «Отмена» (и Esc) возвращает цвет, который был при открытии; крестик/фон/«Готово» — оставляют;
#  - пипетка одна и в окне цвета: поддельный pickColor с задержкой — два быстрых нажатия дают ОДИН вызов,
#    пока работает — кнопка нажата и недоступна, null/ошибка цвет не меняют;
#  - отдельных кнопок-пипеток в строках цвета больше нет, системного input[type=color] не видно.
import os, sys, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))

# Поддельный мост: пипетка с задержкой и цвет награды у чат-бота (пак «запущен», лицензия полная).
EXTRA = r"""
(function(){
  var a = window.app;
  var P = function(v){ return new Promise(function(r){ setTimeout(function(){ r(v); }, 20); }); };
  window.__pick = { calls: 0, next: '#22CC88', delay: 350 };
  a.pickColor = function(){
    window.__pick.calls++;
    var v = window.__pick.next, d = window.__pick.delay;
    return new Promise(function(r){ setTimeout(function(){ r(v); }, d); });
  };
  window.__botSaved = {};
  var REWARD = { title:'Заказать песню', cost:1000, color:'#112233' };
  var SETTINGS = { accepting:true, onlyLive:true, identity:'self', commandsOn:true, pointsOn:true,
    triggers:['!play'], approval:'auto', sharedChat:'own',
    access:{ viewer:{access:'event'}, follower:{access:'event', minDays:7}, sub:{access:'event'}, vip:{access:'event'} },
    reward: REWARD };
  a.modStatus = function(){ return P({ installed:true, running:true, error:null,
    manifest:{ id:'streamer-pack', version:'0.3.0', minCore:'0.32.0', modules:[{ id:'bot', name:'Чат-бот Twitch' }] },
    dev:false, prev:null, server:false, keyMask:'',
    license:{ enabled:true, state:'full' }, modules:{ bot:{ name:'Чат-бот Twitch', running:true, error:null } } }); };
  a.botCmd = function(cmd, arg){
    if (cmd === 'settings') return P(JSON.parse(JSON.stringify(SETTINGS)));
    if (cmd === 'status') return P({ channel:{ login:'streamer' }, online:true });
    if (cmd === 'save') {
      window.__botSaved = Object.assign(window.__botSaved, arg || {});
      if (arg && arg.reward) SETTINGS.reward = Object.assign({}, SETTINGS.reward, arg.reward);
      return P(JSON.parse(JSON.stringify(SETTINGS)));
    }
    if (cmd === 'replyDefaults') return P({});
    if (cmd === 'health') return P([]);
    if (cmd === 'journal') return P([]);
    if (cmd === 'blocked') return P([]);
    if (cmd === 'timeouts') return P([]);
    return P({});
  };
  a.onModStatus = function(){};
  window.__store.chatOrders = 'pack';
})();
"""

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8798', '--bind', '127.0.0.1'], cwd=HERE,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
            pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
            await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
            await pg.add_init_script(EXTRA)
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e) + ' || ' + (getattr(e, 'stack', '') or '')))
            await pg.goto('http://127.0.0.1:8798/app2/index.html')
            await pg.wait_for_timeout(1000)
            E = pg.evaluate
            vis = lambda sel: E("(()=>{var e=document.querySelector('%s'); return !!e && e.offsetParent!==null})()" % sel)
            # окно цвета — position:fixed, у него offsetParent всегда null: смотрим hidden и размер
            colvis = lambda: E("(()=>{var e=document.getElementById('colv'); if (!e || e.hidden) return false; var r=e.getBoundingClientRect(); return r.width>0 && r.height>0})()")
            hexv = lambda sel: E("(document.querySelector('%s')||{}).value || ''" % sel)
            colval = lambda name: E("((document.querySelector('#teEd [data-tc=%s]')||{}).value || '').toUpperCase()" % name)

            # 0. Пипетка в интерфейсе одна, строки цвета без своих пипеток, системного выбора цвета не видно.
            ok(await E("document.querySelectorAll('#colPip').length") == 1, 'кнопка пипетки одна — в окне цвета')
            ok(await E("document.querySelectorAll('[data-pick],[data-scpick]').length") == 0, 'в строках цвета отдельных пипеток нет')
            ok(await E("Array.from(document.querySelectorAll('input[type=color]')).filter(e=>e.offsetParent!==null).length") == 0,
               'видимого системного input[type=color] нет')

            # ── 1. Окно цвета из редактора темы ────────────────────────────────
            await E("setTab('settings'); showSettingsPane('sLook'); $('sLook').scrollIntoView()")
            await pg.wait_for_timeout(250)
            await pg.click('#teList [data-th-new]'); await pg.wait_for_timeout(300)
            await pg.click('#teEd [data-tcopen=accent]'); await pg.wait_for_timeout(250)
            ok(await colvis(), 'окно цвета открылось из редактора темы')
            ok(await E("document.getElementById('colTitle').textContent") == 'Цвет: Акцент', 'заголовок «Цвет: Акцент»')
            ok(await vis('#colCancel') and await vis('#colDone'), 'рядом с «Готово» есть «Отмена»')
            opened_with = await hexv('#colHex')   # цвет на момент открытия — к нему вернёт «Отмена»

            # 1a. Пипетка: два быстрых нажатия — один вызов; пока работает — кнопка нажата и недоступна.
            await E("window.__pick.calls=0; window.__pick.next='#22CC88'; window.__pick.delay=350")
            await E("(function(){var b=document.getElementById('colPip'); b.click(); setTimeout(function(){ b.click(); }, 80); })()")
            await pg.wait_for_timeout(160)
            ok(await E("window.__pick.calls") == 1, 'два быстрых клика по пипетке — один вызов pickColor')
            ok(await E("document.getElementById('colPip').disabled") is True, 'пока пипетка работает, кнопка недоступна')
            ok(await E("document.getElementById('colPip').classList.contains('on')") is True, 'кнопка выглядит нажатой')
            await pg.wait_for_timeout(450)
            ok(await E("document.getElementById('colPip').disabled") is False, 'после ответа кнопка снова доступна')
            ok(await hexv('#colHex') == '#22CC88', 'цвет из пипетки попал в окно')
            ok((await colval('accent')) == '#22CC88', 'цвет из пипетки применился к теме')

            # 1b. Пипетка вернула null — цвет не меняется.
            await E("window.__pick.calls=0; window.__pick.next=null; window.__pick.delay=120")
            await E("document.getElementById('colPip').click()")
            await pg.wait_for_timeout(260)
            ok(await hexv('#colHex') == '#22CC88' and (await colval('accent')) == '#22CC88', 'null от пипетки цвет не меняет')

            # 1c. «Отмена» возвращает цвет, который был при открытии окна.
            await pg.fill('#colHex', '#123456'); await pg.press('#colHex', 'Tab')
            await pg.wait_for_timeout(400)
            ok(await hexv('#colHex') == '#123456', 'цвет меняется сразу, без «Готово»')
            ok((await colval('accent')) == '#123456', 'и сразу применяется к теме')
            await pg.click('#colCancel'); await pg.wait_for_timeout(300)
            ok(await colvis() is False, '«Отмена» закрыла окно')
            ok(await hexv('#colHex') == opened_with, 'цвет в окне вернулся к цвету на момент открытия')
            ok((await colval('accent')) == opened_with, 'и тема вернулась к прежнему цвету')

            # 1d. Esc = «Отмена».
            await pg.click('#teEd [data-tcopen=accent]'); await pg.wait_for_timeout(200)
            start2 = await hexv('#colHex')
            await pg.fill('#colHex', '#654321'); await pg.press('#colHex', 'Tab'); await pg.wait_for_timeout(300)
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
            ok(await colvis() is False, 'Esc закрыл окно цвета')
            ok((await colval('accent')) == start2, 'Esc вернул прежний цвет')

            # 1e. «Готово» оставляет выбранный цвет, крестик — тоже.
            await pg.click('#teEd [data-tcopen=accent]'); await pg.wait_for_timeout(200)
            await pg.fill('#colHex', '#0A0B0C'); await pg.press('#colHex', 'Tab'); await pg.wait_for_timeout(300)
            await pg.click('#colDone'); await pg.wait_for_timeout(250)
            ok(await colvis() is False, '«Готово» закрыло окно')
            ok((await colval('accent')) == '#0A0B0C', '«Готово» оставило новый цвет')
            await pg.click('#teEd [data-tcopen=accent]'); await pg.wait_for_timeout(200)
            await pg.click('#colClose'); await pg.wait_for_timeout(250)
            ok(await colvis() is False and (await colval('accent')) == '#0A0B0C', 'крестик = «Готово», цвет остался')

            # ── 2. Окно цвета из цветовых схем оболочки ───────────────────────
            await E("applySkin('dos', false)"); await pg.wait_for_timeout(400)
            ok(await E("!!document.querySelector('[data-sc]')"), 'строки цветов оболочки нарисованы')
            skin_before = await E("(()=>{var b=document.querySelector('[data-sc=bg]'); return (b.style.background||''); })()")
            await pg.click('[data-sc=bg]'); await pg.wait_for_timeout(250)
            ok(await colvis(), 'окно цвета открылось из цветовой схемы оболочки')
            ok('VGA' in await E("document.getElementById('colTitle').textContent"), 'в заголовке название оболочки')
            await E("colSet('#334455')"); await pg.wait_for_timeout(200)
            await pg.click('#colCancel'); await pg.wait_for_timeout(300)
            skin_after = await E("(()=>{var b=document.querySelector('[data-sc=bg]'); return (b.style.background||''); })()")
            ok(skin_after == skin_before, '«Отмена» вернула прежний цвет оболочки')
            await E("applySkin('', false)"); await pg.wait_for_timeout(300)

            # ── 3. Окно цвета из награды Twitch ───────────────────────────────
            await E("setTab('settings'); showSettingsPane('sBot')")
            await pg.wait_for_timeout(300)
            await E("BOT.tab='pts'; botRender()"); await pg.wait_for_timeout(300)
            ok(await vis('[data-act=reward-color]'), 'у «Цвет награды» кружок-образец')
            ok(await E("document.querySelectorAll('#sBot input[type=color]').length") == 0, 'системного выбора цвета в награде нет')
            await pg.click('[data-act=reward-color]'); await pg.wait_for_timeout(300)
            ok(await colvis(), 'окно цвета открылось из награды Twitch')
            ok(await E("document.getElementById('colTitle').textContent") == 'Цвет награды', 'заголовок «Цвет награды»')
            ok(await hexv('#colHex') == '#112233', 'окно открылось с текущим цветом награды')
            await E("colSet('#AABBCC')"); await pg.wait_for_timeout(150)
            ok(await E("Object.keys(window.__botSaved).length") == 0, 'до «Готово» настройки бота не сохраняются')
            await pg.click('#colDone'); await pg.wait_for_timeout(500)
            ok(await E("window.__botSaved.reward && window.__botSaved.reward.color") == '#AABBCC', 'цвет награды ушёл в botSet при «Готово»')
            ok('170, 187, 204' in await E("(document.querySelector('[data-act=reward-color]').style.background || '')"), 'кружок показывает новый цвет')

            # ── 4. «Отмена» в награде ничего не сохраняет ─────────────────────
            await E("window.__botSaved = {}")
            await pg.click('[data-act=reward-color]'); await pg.wait_for_timeout(250)
            await E("colSet('#778899')"); await pg.wait_for_timeout(150)
            await pg.click('#colCancel'); await pg.wait_for_timeout(400)
            ok(await E("Object.keys(window.__botSaved).length") == 0, '«Отмена» в награде ничего не сохранила')

            await E("setTab('search')"); await pg.wait_for_timeout(200)
            print('ошибки:', errs)
            ok(not errs, 'без ошибок страницы')
            await b.close()
    finally:
        srv.terminate()

try:
    asyncio.run(main())
finally:
    pass
