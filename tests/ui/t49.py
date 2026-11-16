import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8785','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':1000}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8785/app2/index.html'); await pg.wait_for_timeout(2500)
        E=pg.evaluate
        # исходно список проверок виден в поиске
        assert await E("!!$('qcBox') && !$('qcBox').hidden"), 'список проверок не показан при запуске'
        # делаем проблему, чтобы в шапке появился «⚠ Проблем»
        await E("QC.items['yt.svc']={id:'yt.svc',state:'bad',text:'не отвечает',action:'vpn'}; renderQC(); renderHealthWarn();")
        await pg.wait_for_timeout(150)
        assert await E("!$('healthWarn').hidden"), '⚠ не появился при проблеме'
        # обычный поиск: есть выдача, проверки убраны
        await pg.fill('#search','Кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(1000)
        rows = await E("document.querySelectorAll('#results .row').length")
        print('строк выдачи:', rows)
        assert rows > 0, 'поиск не нарисовал выдачу'
        assert await E("!$('results').hidden"), 'выдача скрыта после поиска'
        assert await E("$('qcBox') && $('qcBox').hidden"), 'проверки остались поверх выдачи'
        # открываем страницу внутри поиска (как из выдачи) — она тоже должна свернуться
        await E("$('searchPl').hidden=false; $('searchPl').innerHTML='<div class=\"plrows\">страница</div>';")
        # щелчок по «⚠ Проблем»
        await pg.click('#healthWarn'); await pg.wait_for_timeout(500)
        print('после ⚠: qcBox виден:', await E("!$('qcBox').hidden"),
              '| выдача скрыта:', await E("$('results').hidden"),
              '| searchPl скрыт:', await E("$('searchPl').hidden"))
        assert await E("!$('qcBox').hidden"), 'проверки не показаны после щелчка «⚠»'
        assert await E("!!document.querySelector('#qcBox .ck')"), 'чеклист не нарисован'
        assert await E("$('results').hidden"), 'выдача осталась под проверками'
        assert await E("$('searchPl').hidden && !$('searchPl').innerHTML"), 'страница поиска осталась под проверками'
        assert await E("document.body.dataset.tab === 'search'"), 'не открылась вкладка «Поиск»'
        assert await E("QC.view === true"), 'режим проверок не включился'
        # новый поиск возвращает выдачу
        await pg.fill('#search','Кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(1000)
        rows2 = await E("document.querySelectorAll('#results .row').length")
        print('строк выдачи после нового поиска:', rows2)
        assert rows2 > 0, 'новый поиск не вернул выдачу'
        assert await E("!$('results').hidden"), 'выдача не вернулась новым поиском'
        assert await E("$('qcBox').hidden"), 'проверки остались поверх вернувшейся выдачи'
        # второй вход: свёрнутый список (#qcMini) тоже показывает проверки вместо выдачи
        await E("curQuery=''; search.value=''; QC.view=false; QC.open=false; results.hidden=false; renderQC();")
        await pg.wait_for_timeout(150)
        assert await E("!!$('qcMini')"), 'свёрнутый список (qcMini) не появился'
        await pg.click('#qcMini'); await pg.wait_for_timeout(300)
        print('после qcMini: qcBox виден:', await E("!$('qcBox').hidden"), '| выдача скрыта:', await E("$('results').hidden"))
        assert await E("!$('qcBox').hidden && $('results').hidden"), 'qcMini не свернул выдачу'
        # третий вход: «Подробности» ведёт в настройки, в раздел «Состояние сервисов»
        await pg.click('#qcMore'); await pg.wait_for_timeout(400)
        print('после qcMore вкладка:', await E("document.body.dataset.tab"))
        assert await E("document.body.dataset.tab === 'settings'"), 'qcMore не открыл настройки'
        assert await E("!$('sHealth').hidden"), 'раздел «Состояние сервисов» не открыт'
        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: %s' % errs
        await b.close()
asyncio.run(main()); srv.terminate()
