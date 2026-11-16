# 14.11.2026: визард первого запуска — подсветка зоны и снятие, команды главному окну,
# тема для окна визарда, развилка (streamerMode/queueMode) и финалы.
import os, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8790', '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        errs = []
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8790/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # Кнопка «Пройти знакомство заново» в «О программе» и тема для окна визарда
        ok(await E("!!document.getElementById('aboutWizard')"), 'в «О программе» есть кнопка знакомства')
        await E("document.getElementById('aboutWizard').click()")
        await pg.wait_for_timeout(100)
        op = await E("window.__wopen")
        ok(bool(op) and op.get('from') == 'settings', 'кнопка зовёт wizardOpen {from: settings}')
        await E("window.__wopened && window.__wopened()")
        await pg.wait_for_timeout(180)
        th = await E("window.__wtheme")
        ok(bool(th) and bool(th.get('vars')) and bool(th.get('vars', {}).get('--ac')), 'главное окно отдаёт визарду переменные темы')
        ok(bool(th) and isinstance(th.get('className'), str) and bool(th.get('font')), 'и классы оболочки со шрифтом')

        # Подсветка (16.11): без затемнения — пульсирующая рамка акцентом у самого элемента
        await E("var d=document.createElement('div'); d.id='wizProbe'; d.style.height='20px'; d.style.width='40px'; document.querySelector('#viewSearch').appendChild(d); true")
        await E("window.__wcmd({op:'highlight',tab:'search',sel:'#wizProbe'})")
        await pg.wait_for_timeout(260)
        st = await E("(function(){var e=document.getElementById('wizProbe');var a=getComputedStyle(e,'::after');var r=e.getBoundingClientRect();return {cls:e.classList.contains('wiz-hl'),ov:e.classList.contains('wiz-hl-ov'),hl:e.hasAttribute('data-wiz-hl'),anim:a.animationName,pos:a.position,aw:parseFloat(a.width),w:r.width,ol:getComputedStyle(e).outlineStyle}})()")
        ok(st['cls'] and st['hl'], 'highlight помечает элемент')
        ok(st['ov'] and st['pos'] == 'absolute' and abs(st['aw'] - st['w']) < 1, 'рамка — слой внутри элемента, ровно по его контуру: %r' % (st,))
        ok(st['anim'] == 'wizHlIn' and st['ol'] == 'none', 'рамка внутрь, пульсирует, наружу не выходит')
        inp = await E("(function(){var i=document.createElement('input');i.id='wizProbeIn';document.querySelector('#viewSearch').appendChild(i);return 1})()")
        await E("window.__wcmd({op:'highlight',tab:'search',sel:'#wizProbeIn'})")
        await pg.wait_for_timeout(260)
        ok(await E("(function(){var e=document.getElementById('wizProbeIn');return e.classList.contains('wiz-hl') && !e.classList.contains('wiz-hl-ov') && getComputedStyle(e).animationName==='wizHlIn'})()"), 'у поля ввода — тень внутрь у самого поля')
        await E("window.__wcmd({op:'highlight',tab:'search',sel:'#wizProbe'})")
        await pg.wait_for_timeout(260)
        ok(await E("!document.getElementById('wizDim')"), 'затемнения нет')

        # Перерисовка: элемент пересоздан — подсветка находится заново
        await E("(function(){var o=document.getElementById('wizProbe');var n=document.createElement('div');n.id='wizProbe';n.style.height='20px';o.replaceWith(n);return true})()")
        await pg.wait_for_timeout(320)
        ok(await E("document.getElementById('wizProbe').classList.contains('wiz-hl')"), 'подсветка переживает перерисовку списка')

        # Снятие возвращает как было
        await E("window.__wcmd({op:'clear'})")
        await pg.wait_for_timeout(80)
        st3 = await E("(function(){var e=document.getElementById('wizProbe');var c=getComputedStyle(e);return {cls:e.classList.contains('wiz-hl'),hl:e.hasAttribute('data-wiz-hl'),os:c.outlineStyle}})()")
        ok(not st3['cls'] and not st3['hl'] and st3['os'] == 'none', 'clear снимает рамку')

        # Запись настроек из визарда идёт существующим путём
        await E("window.__wcmd({op:'set',key:'streamerMode',value:false})")
        await pg.wait_for_timeout(120)
        ok(await E("window.app.getSetting('streamerMode')") is False, 'команда set записывает streamerMode')
        await E("window.__wcmd({op:'set',key:'queueMode',value:'live'})")
        await pg.wait_for_timeout(220)
        ok(await E("window.app.getSetting('queueMode')") == 'live', 'команда set записывает queueMode')
        ok(await E("document.getElementById('qModeTg').classList.contains('on')"), 'живая очередь сразу видна в главном окне')
        await E("window.__wcmd({op:'set',key:'streamerMode',value:true})")
        await E("window.__wcmd({op:'set',key:'queueMode',value:'classic'})")
        await pg.wait_for_timeout(160)

        # Окно визарда: развилка слушателя
        errs2 = []
        pg2 = await b.new_page(viewport={'width': 380, 'height': 820})
        await pg2.add_init_script("""
          window.__wcalls = [];
          window.wizardApi = {
            cmd: function (p) { window.__wcalls.push(p); },
            close: function () { window.__wcalls.push({ op: 'close' }); },
            onEvent: function (fn) { window.__winit = fn; }
          };
        """)
        pg2.on('pageerror', lambda e: errs2.append(str(e)))
        await pg2.goto('http://127.0.0.1:8790/app2/wizard/index.html')
        await pg2.wait_for_timeout(250)
        E2 = pg2.evaluate
        # Между развилкой и финалом идут общие шаги WZ2 (Оформление, Входы, Музыка с
        # компьютера, Поиск, Плейлисты) — пропускаем их, чтобы дойти до финала.
        async def advance_common(pg, ev):
            for _ in range(5):
                if not await ev("document.getElementById('wizSkip').hidden"):
                    await pg.click('#wizSkip')
                else:
                    await pg.click('.wiz-sh-skip')
                await pg.wait_for_timeout(110)
        facts = "{music:{ym:true,yt:false,ymEnabled:true,ytEnabled:true},donations:{da:true,dp:false},rules:{tier:'default',auto:false},chat:{mode:'pack'}}"
        await E2("window.__winit && window.__winit({type:'init',from:'debug',facts:" + facts + "})")
        await pg2.wait_for_timeout(120)
        ok(await E2("document.querySelectorAll('.wiz-fork').length") == 2, 'развилка: две большие кнопки')
        ok(await E2("document.getElementById('wizHead').hidden === true"), 'на развилке нет крестика')
        ok(await E2("document.getElementById('wizFoot').hidden === true"), 'на развилке нет «Пропустить» и «Дальше»')

        await pg2.click('[data-route=listener]')
        await pg2.wait_for_timeout(160)
        calls = await E2("window.__wcalls")
        ok(any(c.get('op') == 'set' and c.get('key') == 'streamerMode' and c.get('value') is False for c in calls), 'слушатель: streamerMode=false')
        ok(any(c.get('op') == 'set' and c.get('key') == 'queueMode' and c.get('value') == 'classic' for c in calls), 'слушатель: queueMode=classic')
        await advance_common(pg2, E2)
        # WZ3: у слушателя между развилкой и финалом появился шаг «Очередь» — проходим его.
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Твой плейлист уже играет', 'слушатель: шаг «Очередь»')
        await pg2.click('#wizNext')
        await pg2.wait_for_timeout(160)
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Всё готово', 'финал слушателя: «Всё готово»')
        ok(await E2("document.getElementById('wizClose').hidden === false"), 'в финале есть крестик')
        await pg2.click('[data-final=wave]')
        await pg2.wait_for_timeout(120)
        calls = await E2("window.__wcalls")
        ok(any(c.get('op') == 'tab' and c.get('tab') == 'wave' for c in calls), '«Моя волна» ведёт на вкладку «Волна»')
        ok(any(c.get('op') == 'bg' for c in calls), '«Моя волна» включает фон')
        ok(any(c.get('op') == 'close' for c in calls), 'финал закрывает визард')

        # Развилка стримера и чек-лист «Готов к эфиру».
        # Между развилкой и финалом у стримера есть шаги (Донаты, Правила, Заказы в деле…),
        # поэтому идём по ним кнопкой «Дальше» — так тест не зависит от набора шагов.
        await pg2.goto('http://127.0.0.1:8790/app2/wizard/index.html')
        await pg2.wait_for_timeout(250)
        await E2("window.__winit && window.__winit({type:'init',from:'debug',facts:" + facts + "})")
        await pg2.wait_for_timeout(100)
        await pg2.click('[data-route=streamer]')
        await pg2.wait_for_timeout(160)
        calls = await E2("window.__wcalls")
        ok(any(c.get('op') == 'set' and c.get('key') == 'streamerMode' and c.get('value') is True for c in calls), 'стример: streamerMode=true')
        ok(any(c.get('op') == 'set' and c.get('key') == 'queueMode' and c.get('value') == 'live' for c in calls), 'стример: queueMode=live')
        # Между развилкой и финалом теперь есть шаги (WZ2–WZ5): открываем финал по id, как это делает «?».
        await E2("window.__winit({type:'init',from:'debug',facts:" + facts + ",step:'streamer-final'})")
        await pg2.wait_for_timeout(160)
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Готов к эфиру', 'финал стримера: «Готов к эфиру»')
        # WZ5: чек-лист финала расширен до семи пунктов плана (заказы проверены, OBS, сайт-визитка).
        ok(await E2("document.querySelectorAll('.wiz-check-row').length") == 7, 'чек-лист: музыка, донаты, правила, заказы, OBS, чат, сайт')
        vals = await E2("Array.from(document.querySelectorAll('.wiz-check-value')).map(function(e){return e.textContent})")
        ok('Яндекс' in vals[0], 'чек-лист: вход в музыку из настроек')
        ok('DonationAlerts' in vals[1], 'чек-лист: донаты из настроек')
        ok('Сбалансированно' in vals[2], 'чек-лист: правила из настроек')
        ok('Настройки → OBS и стрим' in vals[4], 'чек-лист: строка про OBS')
        ok('наш бот' in vals[5], 'чек-лист: чат из настроек')
        # 16.11: «Включить фон для эфира» убрана — обычный подвал «Дальше»
        ok(await E2("!document.querySelector('[data-final=bg]')"), 'кнопки «Включить фон для эфира» нет')
        # 16.11: «Готов к эфиру» — последний шаг: «Готово» закрывает визард
        ok(await E2("!document.getElementById('wizNext').hidden && document.getElementById('wizNext').textContent === 'Готово'"), 'на «Готов к эфиру» — «Готово»')
        await E2("window.__wcalls.length = 0")
        await pg2.click('#wizNext')
        await pg2.wait_for_timeout(150)
        ok(any(c.get('op') == 'close' for c in await E2("window.__wcalls")), '«Готово» закрывает визард')

        # Шаг 13 «Взаимодействие со зрителями» — перед «Готов к эфиру»
        await E2("window.__wcalls.length = 0")
        await E2("window.__winit({type:'init',from:'debug',route:'streamer',step:'obs'})")
        await pg2.wait_for_timeout(120)
        await pg2.click('#wizNext')
        await pg2.wait_for_timeout(150)
        calls = await E2("window.__wcalls")
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Взаимодействие со зрителями', 'после OBS — «Взаимодействие со зрителями»')
        ok({'op': 'center', 'big': True} in calls, 'окно визарда просит встать по центру поверх Тапёра')
        ok(await E2("!document.getElementById('wizNext').hidden && document.getElementById('wizNext').textContent === 'Дальше'"), 'на шаге 13 есть обычная «Дальше»')
        ok(await E2("document.querySelectorAll('.wiz-vw-choice').length") == 2 and await E2("document.querySelectorAll('.wiz-vw-stage img').length") == 8, 'два крупных выбора и сцена с оверлеями')
        txt = await E2("document.querySelector('.wiz-vw-choices').textContent")
        ok('Свой бот и оверлеи' in txt and 'Связь с чатом через посредника' in txt, 'выборы подписаны понятно')
        await pg2.wait_for_timeout(3000)
        ok(await E2("document.querySelector('.wiz-vw-stage img.on').getAttribute('src')") != 'img/ov-neon.webp', 'оверлеи на сцене меняются сами')
        ok(await E2("document.querySelectorAll('.wiz-vw-pack .wiz-vw-chat p').length") == 4, 'в карточке пака — чат Twitch с заказом и ответом бота')
        ok(await E2("document.querySelector('.wiz-vw-sb b').textContent") == 'Настроить Streamer.bot' and await E2("document.querySelector('.wiz-vw-shot').naturalWidth") > 0, 'Streamer.bot: заголовок и скриншот')
        ok(await E2("[].every.call(document.querySelectorAll('.wiz-vw-stage img'), function(i){return i.naturalWidth > 0})"), 'все кадры загрузились')
        await E2("window.__wcalls.length = 0")
        await pg2.click('#wizNext')
        await pg2.wait_for_timeout(150)
        calls = await E2("window.__wcalls")
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Готов к эфиру' and {'op': 'dock'} in calls, '«Дальше» — итог «Готов к эфиру», окно снова сбоку')
        await E2("window.__winit({type:'init',from:'debug',route:'streamer',step:'viewers'})")
        await pg2.wait_for_timeout(120)
        await E2("window.__wcalls.length = 0")
        await pg2.click('[data-vw=sbot]')
        await pg2.wait_for_timeout(150)
        calls = await E2("window.__wcalls")
        ok({'op': 'tab', 'tab': 'settings', 'pane': 'sSbot'} in calls and await E2("document.getElementById('wizTitle').textContent") == 'Готов к эфиру', 'Streamer.bot: открыт его раздел, дальше — итог')
        await E2("window.__winit({type:'init',from:'debug',route:'streamer',step:'viewers'})")
        await pg2.wait_for_timeout(120)
        await E2("window.__wcalls.length = 0")
        await pg2.click('[data-vw=pack]')
        await pg2.wait_for_timeout(150)
        calls = await E2("window.__wcalls")
        ok({'op': 'do', 'name': 'packTry'} in calls and await E2("document.getElementById('wizTitle').textContent") == 'Готов к эфиру', 'пак: пробный период в главном окне, дальше — итог')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
