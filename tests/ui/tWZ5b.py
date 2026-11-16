import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8817','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':1300}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8817/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate

        # Действия шагов визарда регистрируются в 31-wizard.js, а вызывает их главное окно
        # командой {op:'do', name, args} — в тесте это тот же мост, что у настоящего окна.
        assert await E("typeof __wcmd === 'function'"), 'нет моста команд визарда (onWizardCmd)'
        assert await E("typeof wizardAction === 'function'"), 'нет регистрации действий шагов'

        # ── 1. Кнопки «?» у разделов настроек: wizard-open {from:'settings', step} ──
        checks = [
            ("sLook", "look", "Оформление"),
            ("sAcc", "logins", "Входы"),
            ("sStream", "donations", "Донаты"),
            ("sOrders", "rules", "Правила заказов"),
        ]
        await E("setTab('settings'); showSettingsPane('sLook')"); await pg.wait_for_timeout(250)
        for pane, step, name in checks:
            sel = '#%s .sec-h [data-wiz-step="%s"]' % (pane, step)
            assert await E("!!document.querySelector('%s')" % sel), 'нет кнопки «?» у раздела %s' % name
            await E("window.__wopen = null")
            await E("document.querySelector('%s').click()" % sel)
            await pg.wait_for_timeout(120)
            got = await E("window.__wopen")
            assert got == {'from': 'settings', 'step': step}, '«?» у %s послала %r' % (name, got)
        print('«?» в настройках:', [c[1] for c in checks])

        # ── 2. «?» в окне импорта плейлистов ──
        await E("setTab('my')"); await pg.wait_for_timeout(600)
        await E("openImport()"); await pg.wait_for_timeout(350)
        assert await E("!!document.querySelector('#myPl .imp-h [data-wiz-step=playlists]')"), 'в окне импорта нет «?»'
        await E("window.__wopen = null")
        await E("document.querySelector('#myPl .imp-h [data-wiz-step=playlists]').click()")
        await pg.wait_for_timeout(120)
        got = await E("window.__wopen")
        assert got == {'from': 'settings', 'step': 'playlists'}, '«?» импорта послала %r' % got
        print('«?» импорта:', got)

        # ── 3. «Пак стримера — месяц бесплатно» (16.11): нет пака — ставим, затем пробный период ──
        await E("""(function(){
          window.__packCalls = [];
          window.app.modStatus = function(){ return Promise.resolve({installed:false, license:{}}); };
          window.app.packInstall = function(){ window.__packCalls.push('install'); return Promise.resolve({ok:true}); };
          window.app.licTrial = function(){ window.__packCalls.push('trial'); return Promise.resolve({ok:true}); };
          window.app.packCheck = function(){ return Promise.resolve({ok:true}); };
          return 0; })()""")
        await E("__wcmd({op:'do', name:'packTry'})"); await pg.wait_for_timeout(500)
        assert await E("window.__packCalls") == ['install', 'trial'], 'пак не поставлен и не включён: %r' % await E("window.__packCalls")
        assert await E("curTab") == 'settings', 'раздел «Пак стримера» не открыт'
        await E("window.__packCalls = []; window.app.modStatus = function(){ return Promise.resolve({installed:true, manifest:{version:'0.4.0', modules:[]}, license:{enabled:true, state:'trial', daysLeft:30}}); }")
        await E("__wcmd({op:'do', name:'packTry'})"); await pg.wait_for_timeout(400)
        assert await E("window.__packCalls") == [], 'пак уже работает — лишнего не включаем'
        print('пак стримера: пробный период — ок')

        # ── 4. Подсказчик указывает на настоящие кнопки: они есть в Настройках ──
        await E("applyStreamer(true, false)"); await pg.wait_for_timeout(200)
        for pane, sel in (('sObs', '.set-side [data-go=sObs]'), ('sObs', '#wgCopy'), ('sOrders', '#stStop')):
            await E("window.__wcmd({op:'highlight', tab:'settings', pane:'%s', sel:'%s'})" % (pane, sel))
            await pg.wait_for_timeout(700)
            assert await E("!!document.querySelector('.wiz-hl')"), 'подсветка %s не нашла элемент' % sel
        await E("window.__wcmd({op:'clear'})")
        print('кнопки подсказчика на месте')

        # ── 5. «Включить фон для эфира»: плейлист, если Яндекса нет; волна, если вошёл ──
        await E("ymLoggedIn = false; savedLists.length = 0; mySel = null; window.__wevents = [];")
        await E("savedLists.push({src:'tap', type:'tap', listId:'wz5l', title:'Фон для эфира', tracks:[{src:'ym', id:'11', albumId:'1', title:'Лайк 1', author:'A', duration:'3:00', thumb:''}]})")
        await E("__wcmd({op:'do', name:'streamBg'})"); await pg.wait_for_timeout(700)
        ev = await E("window.__wevents.filter(function(e){return e.type==='bgStarted';}).pop()")
        assert ev and ev.get('kind') == 'list' and ev.get('title') == 'Фон для эфира', 'плейлист не включён фоном: %r' % (ev,)
        print('фон из плейлиста:', ev)

        await E("ymLoggedIn = true; window.__log.length = 0; window.__wevents = [];")
        await E("__wcmd({op:'do', name:'streamBg'})"); await pg.wait_for_timeout(700)
        ev = await E("window.__wevents.filter(function(e){return e.type==='bgStarted';}).pop()")
        assert ev and ev.get('kind') == 'wave', 'Моя волна не включилась: %r' % (ev,)
        assert await E("window.__log.some(function(x){return x.indexOf('waveStart user:onyourwave') === 0;})"), 'волна не запрошена у Яндекса'
        print('фон — Моя волна:', ev)

        await E("ymLoggedIn = false; savedLists.length = 0; mySel = null; window.__wevents = [];")
        await E("__wcmd({op:'do', name:'streamBg'})"); await pg.wait_for_timeout(250)
        ev = await E("window.__wevents.filter(function(e){return e.type==='bgStarted';}).pop()")
        assert ev and ev.get('kind') == 'none' and ev.get('error'), 'без входа и плейлиста нет честного ответа: %r' % (ev,)
        print('фон нечем включать:', ev.get('error'))

        # ── 6. «Настроить» на финале открывает только этот шаг; лишние id не проходят ──
        await E("window.__wopen = null")
        await E("__wcmd({op:'do', name:'openStep', args:{step:'orders'}})"); await pg.wait_for_timeout(150)
        got = await E("window.__wopen")
        assert got == {'from': 'settings', 'step': 'orders'}, '«Настроить» открыла не тот шаг: %r' % (got,)
        await E("window.__wopen = null")
        await E("__wcmd({op:'do', name:'openStep', args:{step:'rm -rf'}})"); await pg.wait_for_timeout(150)
        assert await E("window.__wopen === null"), 'открылся неизвестный шаг'
        print('«Настроить»:', got)

        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: %s' % errs
        await b.close()
asyncio.run(main()); srv.terminate()
