# WC1: шаги «Оформление», «Входы», «Музыка с компьютера» — подсказчик, а не копия кнопок Тапёра.
# При входе на шаг уходит команда highlight с настоящим разделом/селектором; такие элементы
# в главном окне (mock5) реально есть; состояние входа/папок или hlAct отмечают задачу.
import os, asyncio, subprocess, json
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8840
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

# шаг визарда → раздел Настроек и селектор настоящего элемента в Тапёре
STEPS = [
    ('logins', 'sAcc', '#setYmBtn'),
    ('local', 'sLocal', '#setLibAdd'),
    ('look', 'sLook', '#sLook .card'),
]

async def wizard_page(b):
    pg = await b.new_page(viewport={'width': 380, 'height': 820})
    await pg.add_init_script("""
      window.__wcalls = [];
      window.wizardApi = {
        cmd: function (p) { window.__wcalls.push(p); },
        close: function () { window.__wcalls.push({ op: 'close' }); },
        onEvent: function (fn) { window.__winit = fn; }
      };
    """)
    await pg.goto('http://127.0.0.1:%d/app2/wizard/index.html' % PORT)
    await pg.wait_for_timeout(300)
    return pg

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        errs = []
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # Визард «открыт» — тогда главное окно сообщает hlAct о нажатом подсвеченном элементе.
        await E("window.__wopened && window.__wopened()")

        # 1. Каждый шаг подсвечивает настоящий элемент Тапёра, а не свою копию.
        for step, pane, sel in STEPS:
            await E("window.__wcmd(%s)" % json.dumps({'op': 'highlight', 'tab': 'settings', 'pane': pane, 'sel': sel}, ensure_ascii=False))
            await pg.wait_for_timeout(300)
            got = await E("(function(){var e=document.querySelector(%s); return !!(e && e.hasAttribute('data-wiz-hl'));})()" % json.dumps(sel))
            ok(got, 'шаг «%s»: в Тапёре есть и подсвечен %s' % (step, sel))

        # 2. В «Аккаунтах» — настоящие кнопки входа и переключатели площадок.
        ok(await E("!!document.querySelector('#setYmBtn') && !!document.querySelector('#setYtLogin')"),
           'в «Аккаунтах» есть кнопки входа Яндекс и YouTube')
        ok(await E("!!document.querySelector('[data-set-tg=ymEnabled]') && !!document.querySelector('[data-set-tg=ytEnabled]')"),
           'рядом — переключатели «пользоваться площадкой»')
        # 3. В «Музыке с компьютера» — настоящая кнопка добавления папки.
        ok(await E("document.getElementById('setLibAdd').textContent.indexOf('Добавить папку') >= 0"),
           'в «Музыке с компьютера» есть «Добавить папку…»')
        # 4. В «Оформлении» — настоящий список тем, а не образцы визарда.
        ok(await E("document.querySelectorAll('#teList .te-c').length >= 8"), 'в «Оформлении» 8 настоящих тем')

        # 5. Нажатие настоящей кнопки в подсвеченной зоне доходит до визарда событием hlAct.
        await E("window.__wcmd(%s)" % json.dumps({'op': 'highlight', 'tab': 'settings', 'pane': 'sLocal', 'sel': '#setLibAdd'}, ensure_ascii=False))
        await pg.wait_for_timeout(250)
        await E("document.getElementById('setLibAdd').click()")
        await pg.wait_for_timeout(200)
        acts = await E("(window.__wevents||[]).filter(function(e){return e.type==='hlAct'})")
        ok(any(a.get('sel') == '#setLibAdd' and a.get('kind') == 'click' for a in acts),
           'нажал настоящую «Добавить папку…» — визард получил hlAct')

        # Тема: нажатие в настоящем списке тоже даёт hlAct (даже если список перерисовался).
        await E("window.__wcmd(%s)" % json.dumps({'op': 'highlight', 'tab': 'settings', 'pane': 'sLook', 'sel': '#sLook .card'}, ensure_ascii=False))
        await pg.wait_for_timeout(250)
        await E("document.querySelector('#teList [data-theme=winter-l]').click()")
        await pg.wait_for_timeout(250)
        acts = await E("(window.__wevents||[]).filter(function(e){return e.type==='hlAct'})")
        ok(any(a.get('sel') == '#sLook .card' and a.get('kind') == 'click' for a in acts),
           'выбрал тему в настоящем списке — визард получил hlAct')
        ok(await E("document.documentElement.className.indexOf('theme-light') >= 0"), 'тема действительно применилась')
        await E("document.querySelector('#teList [data-theme=dark]').click()")

        # 6. Действия, которые обслуживали только удалённые кнопки, убраны.
        ok(await E("typeof WIZ_ACTIONS === 'object' && !('lookIcons' in WIZ_ACTIONS) && !('lookPick' in WIZ_ACTIONS) && "
                   "!('loginsYm' in WIZ_ACTIONS) && !('loginsYt' in WIZ_ACTIONS) && !('loginsUse' in WIZ_ACTIONS) && "
                   "!('localPick' in WIZ_ACTIONS)"),
           'действия удалённых кнопок (lookIcons/lookPick/loginsYm/loginsYt/loginsUse/localPick) убраны')

        # 7. Окно визарда: шаги просят highlight и отмечают задачи.
        errs2 = []
        pg2 = await wizard_page(b)
        pg2.on('pageerror', lambda e: errs2.append(str(e)))
        E2 = pg2.evaluate
        for step, pane, sel in STEPS:
            await E2("window.__wcalls = []")
            await E2("window.__winit(%s)" % json.dumps({'type': 'init', 'route': 'listener', 'step': step}, ensure_ascii=False))
            await pg2.wait_for_timeout(180)
            calls = await E2("window.__wcalls")
            hl = [c for c in calls if c.get('op') == 'highlight']
            ok(bool(hl), 'шаг «%s» попросил подсветку' % step)
            got = hl[-1]
            ok(got.get('tab') == 'settings', 'шаг «%s» открывает Настройки' % step)
            ok(got.get('pane') == pane, 'шаг «%s» открывает раздел %s' % (step, pane))
            if step == 'look':
                ok('#sLook .card' in (got.get('sel') or '') and '#lookSlot .card' in (got.get('sel') or ''),
                   'подсвечена настоящая карточка оформления (переезжает во вкладку)')
            else:
                ok(got.get('sel') == sel, 'подсвечен %s' % sel)
            ok(await E2("document.querySelectorAll('.wiz-task').length") >= 1, 'у шага «%s» есть задачи-подсказки' % step)
            ok(await E2("document.querySelectorAll('[data-act]').length") == 0,
               'у шага «%s» нет своих кнопок-копий ([data-act])' % step)

        # Входы: Яндекс уже вошёл — задача отмечена сразу; без входа — не отмечена; обе «по желанию».
        await E2("window.__wcalls = []")
        await E2("window.__winit(%s)" % json.dumps({'type': 'init', 'route': 'listener', 'step': 'logins'}, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        await E2("window.__winit(%s)" % json.dumps({
            'type': 'logins',
            'items': {'ymSvc': {'state': 'ok'}, 'ytSvc': {'state': 'bad'}, 'sc': {'state': 'bad'}},
            'accounts': {'ym': {'loggedIn': False}, 'yt': {'name': ''}},
            'enabled': {'ym': True, 'yt': True}
        }, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Войти в Яндекс Музыку' in body and 'Войти в YouTube' in body, 'обе задачи — про настоящие кнопки')
        ok(body.count('по желанию') >= 2, 'обе задачи подписаны «по желанию»')
        ok(await E2("document.querySelector('.wiz-task[data-task=ym]').classList.contains('done')") is False,
           'входа нет — задача не отмечена')
        await E2("window.__winit(%s)" % json.dumps({
            'type': 'logins', 'accounts': {'ym': {'loggedIn': True, 'hasPlus': True, 'name': 'tester'}, 'yt': {'name': 'murzik'}}
        }, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        ok(await E2("document.querySelector('.wiz-task[data-task=ym]').classList.contains('done')"), 'вошёл в Яндекс — задача отмечена')
        ok(await E2("document.querySelector('.wiz-task[data-task=yt]').classList.contains('done')"), 'вошёл в YouTube — задача отмечена')

        # Музыка с компьютера: папок нет — не отмечена; папка появилась — отмечена.
        await E2("window.__wcalls = []")
        await E2("window.__winit(%s)" % json.dumps({'type': 'init', 'route': 'listener', 'step': 'local'}, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        await E2("window.__winit(%s)" % json.dumps({
            'type': 'local', 'web': True, 'status': {'count': 0, 'folders': []}
        }, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        ok(await E2("document.querySelector('.wiz-task[data-task=folder]').classList.contains('done')") is False,
           'папок нет — задача не отмечена')
        await E2("window.__winit(%s)" % json.dumps({
            'type': 'local', 'web': True,
            'status': {'count': 2, 'folders': [{'path': 'C:\\Музыка', 'count': 2}]}
        }, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        ok(await E2("document.querySelector('.wiz-task[data-task=folder]').classList.contains('done')"),
           'главное окно сообщило про папку — задача отмечена')
        body = await E2("document.getElementById('wizBody').textContent")
        ok('C:\\Музыка' in body and 'Нашлось: 2 песни' in body, 'список папок и итог — сводка, без своей кнопки')

        # Оформление: выбор в Тапёре (hlAct) отмечает задачу.
        await E2("window.__wcalls = []")
        await E2("window.__winit(%s)" % json.dumps({'type': 'init', 'route': 'listener', 'step': 'look'}, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        calls = await E2("window.__wcalls")
        hl = [c for c in calls if c.get('op') == 'highlight'][-1]
        await E2("window.__winit(%s)" % json.dumps({'type': 'hlAct', 'sel': hl.get('sel'), 'kind': 'click'}, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        ok(await E2("document.querySelector('.wiz-task[data-task=theme]').classList.contains('done')"),
           'выбор темы в Тапёре отмечает задачу')
        ok(await E2("document.querySelectorAll('.wiz-look-grid, [data-skin], [data-theme]').length") == 0,
           'в визарде нет копий иконок тем и оболочек')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
