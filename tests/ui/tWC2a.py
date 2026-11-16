# WC2 (15.11.2026): шаги визарда «Донаты» и «Правила заказов» — подсказчик.
# Визард не повторяет кнопки и поля Тапёра, а подсвечивает настоящие элементы
# Настроек → «Донаты» / «Заказы»; подключённое отмечается по состоянию, ход — событием.
import os
import asyncio
import subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
PORT = 8804
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)


def highlights(calls):
    return [c for c in calls if c.get('op') == 'highlight']


def last_highlight(calls):
    h = highlights(calls)
    return h[-1] if h else None


def names(calls):
    return [c.get('name') for c in calls if c.get('op') == 'do']


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        errs = []
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(path='mock_req.js')
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
        await pg.wait_for_timeout(900)
        E = pg.evaluate
        await E("window.__wopened && window.__wopened()")

        # ── Пока ждём вход DA: главное окно шлёт donState при изменении ────────
        # И не чаще раза в 2 с (последнее изменение не теряется, а ждёт).
        await E("window.__wevents = []")
        await E("window.__don({da:{name:'DonationAlerts',connected:false},dp:{name:'DonatePay',connected:false}})")
        await pg.wait_for_timeout(150)
        evs = await E("(window.__wevents||[]).filter(function(e){return e.type==='donState'})")
        ok(len(evs) == 1, 'изменение состояния ушло визарду сразу')
        await E("window.__don({da:{name:'DonationAlerts',connected:true,ok:true,account:{name:'murzik'}},dp:{name:'DonatePay',connected:false}})")
        await pg.wait_for_timeout(300)
        evs = await E("(window.__wevents||[]).filter(function(e){return e.type==='donState'})")
        ok(len(evs) == 1, 'второе изменение подождало — не чаще раза в 2 с')
        await pg.wait_for_timeout(2000)
        evs = await E("(window.__wevents||[]).filter(function(e){return e.type==='donState'})")
        ok(len(evs) == 2 and evs[-1]['da']['connected'] is True, 'подождавшее изменение дошло (вход DA виден)')

        # ── Настоящие элементы, на которые указывают задачи ────────────────────
        # «Донаты»: кнопка входа DonationAlerts, поле ключа DonatePay, цена, валюта, сайт.
        await E("window.app.donDisconnect('da')")
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sStream',sel:'#stPrice'})")
        await pg.wait_for_timeout(400)
        ok(await E("curTab") == 'settings' and await E("settingsPaneId") == 'sStream', 'открылись Настройки → Донаты')
        await E("window.app.donStatus().then(function(s){ window.__don(s); })")
        await pg.wait_for_timeout(400)
        ok(await E("!!document.querySelector('#stDon [data-don=\"da\"]')") is True, 'кнопка «Подключить» DonationAlerts — в #stDon')
        ok(await E("!!document.querySelector('#stDon [data-dk=\"dp\"]')") is True, 'поле API-ключа DonatePay — в #stDon')
        ok(await E("!!document.querySelector('#stPrice') && !!document.querySelector('#stCur')") is True, 'цена и валюта — настоящие поля')
        ok(await E("!!document.querySelector('#stSite')") is True, 'сайт-визитка — настоящая карточка')

        # «Правила»: переключатели, которые меняет набор, — в «Настройках → Заказы».
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sOrders',sel:'#stExplicit'})")
        await pg.wait_for_timeout(400)
        ok(await E("settingsPaneId") == 'sOrders', 'открылись Настройки → Заказы')
        ok(await E("!!document.querySelector('#sOrders [data-set-tg=\"reqAuto\"]')") is True, '«Точные — сразу в очередь» — в #sOrders')
        ok(await E("['stExplicit','stRepeat','stVersion','stStop'].every(function(id){return !!document.getElementById(id)})") is True,
           'мат, повторы, версии и стоп-лист — настоящие элементы')

        # ── Окно визарда: шаг «Донаты» ─────────────────────────────────────────
        pg2 = await b.new_page(viewport={'width': 380, 'height': 820})
        await pg2.add_init_script("""
          window.__wcalls = [];
          window.__winit = null;
          window.wizardApi = {
            cmd: function (p) { window.__wcalls.push(p); },
            close: function () { window.__wcalls.push({ op: 'close' }); },
            onEvent: function (fn) { window.__winit = fn; }
          };
        """)
        errs2 = []
        pg2.on('pageerror', lambda e: errs2.append(str(e)))
        await pg2.goto('http://127.0.0.1:%d/app2/wizard/index.html' % PORT)
        await pg2.wait_for_timeout(300)
        E2 = pg2.evaluate

        await E2("window.__winit({type:'init',from:'settings',step:'donations'})")
        await pg2.wait_for_timeout(150)
        calls = await E2("window.__wcalls")
        ok('wz4DonState' in names(calls), 'шаг «Донаты» спросил состояние сервисов')
        ok(await E2("document.querySelectorAll('#wizBody input, #wizBody select, #wizBody textarea').length") == 0,
           'в шаге нет копий полей Тапёра')
        ok(await E2("!!document.getElementById('wz4DaBtn')") is False, 'и нет своей кнопки «Подключить» DA')

        # Состояние: ничего не подключено → первая задача — настоящая кнопка DA.
        await E2("window.__winit({type:'donState', da:{connected:false,ok:true}, dp:{connected:false}, price:100, currency:'RUB'})")
        await pg2.wait_for_timeout(250)
        calls = await E2("window.__wcalls")
        hl = last_highlight(calls)
        ok(hl is not None and hl.get('tab') == 'settings' and hl.get('pane') == 'sStream', 'по задачам открыты Настройки → Донаты')
        ok(hl is not None and '#stDon [data-don="da"]' in hl.get('sel', ''), 'подсвечена настоящая кнопка входа DonationAlerts')
        ok(await E2("document.querySelectorAll('#wizBody .wiz-task').length") == 4, 'четыре задачи — DA, DP, цена, сайт')
        ok(await E2("(function(){var n=document.querySelector('.wiz-task.now');return n ? n.getAttribute('data-task') : '';})()") == 'da',
           'первая задача — вход DonationAlerts')

        # Подключённое отмечается само; ход переходит к цене за трек.
        await E2("window.__winit({type:'donState', da:{connected:true,ok:true,account:{name:'murzik'}}, dp:{connected:true,ok:true,account:{name:'tester'}}, price:100, currency:'RUB'})")
        await pg2.wait_for_timeout(250)
        ok(await E2("document.querySelector('[data-task=da]').classList.contains('done')") is True, 'вход DA отмечен по состоянию')
        ok(await E2("document.querySelector('[data-task=dp]').classList.contains('done')") is True, 'ключ DonatePay отмечен по состоянию')
        calls = await E2("window.__wcalls")
        hl = last_highlight(calls)
        ok(hl is not None and hl.get('sel') == '#stPrice' and hl.get('pane') == 'sStream', 'следующая задача — цена за трек в Настройках')

        # Заполнил цену — задача отмечена, дальше по желанию сайт-визитка.
        await E2("window.__winit({type:'hlAct', sel:'#stPrice', kind:'input', filled:true, value:'150'})")
        await pg2.wait_for_timeout(250)
        ok(await E2("document.querySelector('[data-task=price]').classList.contains('done')") is True, 'цена отмечена после ввода')
        calls = await E2("window.__wcalls")
        hl = last_highlight(calls)
        ok(hl is not None and hl.get('sel') == '#stSite', 'осталась сайт-визитка — по желанию, в той же карточке')

        # ── Окно визарда: шаг «Правила заказов» ────────────────────────────────
        await E2("window.__winit({type:'init',from:'settings',step:'rules'})")
        await pg2.wait_for_timeout(150)
        calls = await E2("window.__wcalls")
        ok('wz4RulesGet' in names(calls), 'шаг «Правила» спросил настройки')
        ok(await E2("document.querySelectorAll('#wizBody textarea').length") == 0, 'своего стоп-листа в визарде больше нет')
        await E2("window.__winit({type:'rulesState', auto:true, done:true, rules:{explicitOk:false,repeatOk:false,versionOk:true,maxSec:420}, stopText:'мат'})")
        await pg2.wait_for_timeout(150)

        # 15.11 (слово владельца): шаг сразу открывает «Настройки → Заказы»; списка задач с галочками нет —
        # выбрал набор, Тапёр по очереди подсвечивает изменённые переключатели, в визарде — одна строка.
        calls = await E2("window.__wcalls")
        ok({'op': 'highlight', 'tab': 'settings', 'pane': 'sOrders', 'sel': '#sOrders'} in calls, 'при входе на шаг подсвечен весь раздел «Настройки → Заказы»')
        await E2("window.__wcalls.length = 0")
        await E2("document.querySelector('#wz4Pre-all').click()")
        await pg2.wait_for_timeout(250)
        calls = await E2("window.__wcalls")
        applied = [c for c in calls if c.get('op') == 'do' and c.get('name') == 'wz4RulesApply']
        ok(applied and applied[-1]['args']['explicitOk'] is True and applied[-1]['args']['repeatOk'] is True,
           'набор «Всё сразу в эфир» применяется')
        ok(await E2("document.querySelectorAll('#wizBody .wiz-task').length") == 0, 'списка задач с галочками нет')

        await E2("window.__winit({type:'rulesState', auto:true, done:true, rules:{explicitOk:true,repeatOk:true,versionOk:true,maxSec:600}, stopText:'мат'})")
        await pg2.wait_for_timeout(1500)
        calls = await E2("window.__wcalls")
        ok(not any(c.get('op') == 'highlight' for c in calls), 'подсветка не скачет по переключателям (16.11)')
        ok(await E2("document.querySelector('#wz4Pre-all').classList.contains('on')") is True, 'выбранный набор подсвечен')
        txt = await E2("(document.querySelector('#wizBody .wz4-done')||{}).textContent || ''")
        ok('Всё сразу в эфир' in txt, 'одна строка о результате: %r' % txt)
        await E2("document.querySelector('#wz4Pre-safe, #wz4Pre-manual, .wz4-preset:not(.on)').click()")
        await pg2.wait_for_timeout(200)
        ok(await E2("document.querySelectorAll('#wizBody .wz4-done').length") <= 1, 'второй набор не дублирует строки')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок страницы')
        await b.close()


try:
    asyncio.run(main())
finally:
    srv.terminate()
