# t48 — четыре правки интерфейса 14.11 (U1):
# 1) настройки открываются на «О программе», явные переходы работают;
# 2) обычные .set .btn — цвет главной кнопки (--pri/--prit), ghost/acc не тронуты;
# 3) в рядах действий вкладок со списками нет .pbtn.g;
# 4) режимы очереди: первым «Классический плейлист», по умолчанию classic.
import os, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8799', '--bind', '127.0.0.1'],
                       cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

bad = []


def check(name, cond):
    print(('  ✓ ' if cond else '  ✗ ') + name)
    if not cond:
        bad.append(name)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(path='ov8.js')
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8799/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # ===== 4. Режим очереди: порядок и значение по умолчанию =====
        order = await E("Array.from(document.querySelectorAll('#qMode .qm-l')).map(b=>b.dataset.qm)")
        labels = await E("Array.from(document.querySelectorAll('#qMode .qm-l')).map(b=>b.textContent.trim())")
        check('первым «Классический плейлист», вторым «Живая очередь»: ' + ','.join(labels),
              order == ['classic', 'live'] and labels[0].startswith('Классический') and labels[1].startswith('Живая'))
        check('по умолчанию classic при пустых настройках',
              await E("qMode === 'classic' && isClassic()"))
        check('подпись «Классический плейлист» горит, кружок тумблера слева, у неё',
              await E("document.querySelector('#qMode [data-qm=classic]').classList.contains('on') && !document.getElementById('qModeTg').classList.contains('on')"))
        check('значение по умолчанию не записывается как выбор пользователя',
              not any(x.startswith('set queueMode') for x in await E("window.__log")))

        # ===== 1. Настройки открываются на «О программе» =====
        async def panes():
            return await E("Array.from(document.querySelectorAll('#viewSettings .set-main > section')).filter(s=>!s.hidden).map(s=>s.id)")

        await pg.click('#tabs [data-tab=settings]')
        await pg.wait_for_timeout(350)
        check('настройки открылись на «О программе»: ' + ','.join(await panes()), await panes() == ['sAbout'])
        check('пункт «О программе» подсвечен в меню',
              await E("document.querySelector('.set-side [data-go=sAbout]').classList.contains('on')"))

        await pg.click('.set-side [data-go=sApp]')
        await pg.wait_for_timeout(300)
        check('явный переход на «Программу» работает',
              await E("document.getElementById('sApp').hidden === false && document.getElementById('sAbout').hidden === true"))
        await pg.click('#tabs [data-tab=search]')
        await pg.wait_for_timeout(200)
        await pg.click('#tabs [data-tab=settings]')
        await pg.wait_for_timeout(300)
        check('повторное открытие — снова «О программе»', await panes() == ['sAbout'])

        await pg.click('#sAbout [data-go=sApp]', force=True)
        await pg.wait_for_timeout(600)
        check('кнопка «Сменить в „Программе“» открывает нужный раздел',
              await E("document.getElementById('sApp').hidden === false && document.getElementById('sAbout').hidden === true"))

        # ===== 2. Обычные кнопки настроек — цвет главной кнопки =====
        sty = await E("""(()=>{
            function col(v){ var d=document.createElement('div'); d.style.background=v; document.body.appendChild(d);
              var c=getComputedStyle(d).backgroundColor; d.remove(); return c; }
            var b=document.getElementById('setUpdBtn');
            if (!b) return null;
            var cs=getComputedStyle(b);
            return { bg:cs.backgroundColor, color:cs.color, pri:col('var(--pri)'), prit:col('var(--prit)'),
              ghost:getComputedStyle(document.getElementById('setLogOpen')).backgroundColor,
              acc:getComputedStyle(document.querySelector('#sAbout .btn.acc')).backgroundColor,
              ac:col('var(--ac)') };
        })()""")
        check('у .set .btn фон --pri', sty and sty['bg'] == sty['pri'])
        check('у .set .btn текст --prit', sty and sty['color'] == sty['prit'])
        check('.btn.ghost остался прозрачным', sty and sty['ghost'] != sty['pri'])
        check('.btn.acc остался акцентным (--ac)', sty and sty['acc'] == sty['ac'])

        await pg.hover('#setUpdBtn')
        await pg.wait_for_timeout(150)
        hov = await E("(()=>{var cs=getComputedStyle(document.getElementById('setUpdBtn')); return [cs.backgroundColor, cs.filter];})()")
        check('наведение: фон --pri и осветление brightness(1.08)',
              sty and hov[0] == sty['pri'] and 'brightness(1.08)' in hov[1])
        await pg.hover('#setLogOpen')
        await pg.wait_for_timeout(150)
        gh = await E("(()=>{var cs=getComputedStyle(document.getElementById('setLogOpen')); return [cs.backgroundColor, cs.filter];})()")
        check('наведение не меняет .btn.ghost', gh[1] == 'none')
        await pg.mouse.move(5, 5)

        # ===== 3. В рядах действий вкладок со списками нет .pbtn.g =====
        await pg.click('#tabs [data-tab=search]')
        await pg.wait_for_timeout(250)
        await pg.fill('#search', 'Кино')
        await pg.press('#search', 'Enter')
        await pg.wait_for_timeout(900)
        await pg.click('.arc')
        await pg.wait_for_timeout(600)
        check('карточка исполнителя открылась', await E("!!document.querySelector('#searchPl .arh')"))
        classes = await E("Array.from(document.querySelectorAll('#searchPl .plbtns button')).map(b=>b.className)")
        check('в ряду действий артиста нет .pbtn.g: ' + ' | '.join(classes),
              await E("document.querySelectorAll('#searchPl .plbtns').length > 0 && document.querySelectorAll('#searchPl .plbtns .pbtn.g').length === 0"))
        check('в ряду артиста есть акцентная, главная и обычная',
              any('qadd' in c.split() for c in classes) and any('y' in c.split() for c in classes)
              and any(c.split() == ['pbtn'] for c in classes))

        await pg.click('#tabs [data-tab=my]')
        await pg.wait_for_timeout(900)
        await E("var g=document.querySelector('#mySide [data-mygrp=ym]'); if(g&&g.classList.contains('shut'))g.click()")
        await pg.wait_for_timeout(200)
        await E("Array.from(document.querySelectorAll('#mySide .mit')).find(x=>/Мой плейлист/.test(x.textContent)).click()")
        await pg.wait_for_timeout(700)
        check('плейлист открылся', await E("document.querySelectorAll('#myPl .plbtns').length > 0"))
        check('в ряду действий плейлиста нет .pbtn.g',
              await E("document.querySelectorAll('#myPl .plbtns .pbtn.g').length === 0"))
        check('во всех рядах .plbtns/.ar-acts/.mbar нет .pbtn.g',
              await E("document.querySelectorAll('.plbtns .pbtn.g, .ar-acts .pbtn.g, .mbar .pbtn.g').length === 0"))

        # ===== 4. Переключение режимов по-прежнему сохраняется =====
        await pg.click('#qMode [data-qm=live]')
        await pg.wait_for_timeout(250)
        check('выбор «Живой очереди» сохранён', not await E("isClassic()")
              and any('queueMode="live"' in x for x in await E("window.__log")))
        await pg.click('#qMode [data-qm=classic]')
        await pg.wait_for_timeout(250)
        check('обратно в классику — сохранено', await E("isClassic()")
              and any('queueMode="classic"' in x for x in await E("window.__log")))

        print('ошибки:', errs)
        check('без ошибок страницы', not errs)
        await b.close()
    if bad:
        raise SystemExit('провалено: ' + ', '.join(bad))


try:
    asyncio.run(main())
finally:
    srv.terminate()
