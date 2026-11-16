import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8782','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8782/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        async def bg1():
            return await E("getComputedStyle(document.documentElement).getPropertyValue('--bg1').trim()")

        # Новый профиль (темы в настройках нет) должен получить новую тему «Графит».
        cls = await E("document.documentElement.className")
        assert 'theme-dark' in cls, 'новая тема не включилась по умолчанию: ' + cls
        assert await bg1() == '#272727', 'фон по умолчанию: ' + await bg1()
        print('тема по умолчанию:', cls, '| --bg1:', await bg1())

        await E("setTab('settings'); showSettingsPane('sLook')"); await E("$('sLook').scrollIntoView()"); await pg.wait_for_timeout(200)
        assert await E("!!document.querySelector('#teList [data-th=dark]')"), 'в списке тем нет Графита'
        assert await E("getComputedStyle(document.documentElement).getPropertyValue('--tx').trim()") == '#E7F0F5', 'текст Графита'
        assert await E("getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()") == '#D17834', 'акцент Графита'
        assert await E("getComputedStyle(document.documentElement).getPropertyValue('--pri').trim()") == '#7180AC', 'главная кнопка Графита'
        # Проверяем не только переменную, но и настоящий фон элемента с var(--bg1)
        elem_bg = await E("(function(){var e=document.createElement('div');e.style.background='var(--bg1)';document.body.appendChild(e);var c=getComputedStyle(e).backgroundColor;e.remove();return c;})()")
        assert elem_bg == 'rgb(39, 39, 39)', 'фон элемента: ' + elem_bg
        print('цвета Графита:', await bg1(), elem_bg, '| сохранено:', await E("window.__log.filter(x=>x.startsWith('set theme')).pop()"))
        await pg.screenshot(path='m_dark.png')

        # Переключение на «Монохром» и сохранение после перезагрузки
        await pg.click('#teList [data-th=mono]'); await pg.wait_for_timeout(200)
        cls = await E("document.documentElement.className")
        assert 'theme-mono' in cls and 'theme-dark' not in cls, 'Монохром не включился: ' + cls
        assert await bg1() == '#161616', 'фон Монохрома: ' + await bg1()
        saved = await E("window.__log.filter(x=>x.startsWith('set theme')).pop()")
        assert saved and 'mono' in saved, saved
        print('Монохром:', cls, '| сохранено:', saved)
        await pg.screenshot(path='m_mono.png')
        await pg.reload(); await pg.wait_for_timeout(600)
        cls = await E("document.documentElement.className")
        assert 'theme-mono' in cls, 'Монохром не сохранился после перезагрузки: ' + cls
        print('после перезагрузки:', cls)

        # Возврат на «Графит» и сохранение после перезагрузки
        await E("setTab('settings'); showSettingsPane('sLook')"); await pg.wait_for_timeout(200)
        await pg.click('#teList [data-th=dark]'); await pg.wait_for_timeout(200)
        cls = await E("document.documentElement.className")
        assert 'theme-dark' in cls and 'theme-mono' not in cls, 'Графит не включился: ' + cls
        assert await bg1() == '#272727', 'фон Графита: ' + await bg1()
        assert await E("getComputedStyle(document.documentElement).getPropertyValue('--tx').trim()") == '#E7F0F5', 'текст Графита'
        saved = await E("window.__log.filter(x=>x.startsWith('set theme')).pop()")
        assert saved and 'dark' in saved, saved
        print('Графит:', cls, '| сохранено:', saved)
        await pg.reload(); await pg.wait_for_timeout(600)
        cls = await E("document.documentElement.className")
        assert 'theme-dark' in cls, 'Графит не сохранился после перезагрузки: ' + cls
        assert await bg1() == '#272727', 'фон после перезагрузки: ' + await bg1()
        print('после перезагрузки:', cls, '| --bg1:', await bg1())

        # Старый профиль: «Фиолетовая» удалена из встроенных — по миграции это «Графит»
        await E("localStorage.setItem('tapTheme','violet')")
        await pg.reload(); await pg.wait_for_timeout(600)
        cls = await E("document.documentElement.className")
        assert 'theme-dark' in cls, 'violet не мигрировал в Графит: ' + cls
        assert await bg1() == '#272727', 'фон после миграции violet: ' + await bg1()
        print('старая тема violet → Графит:', cls, '| --bg1:', await bg1())

        # Панель OBS: тема есть в списке и её палитра отдаётся тем же цветом
        assert await E("!!document.querySelector('#wgLook option[value=\"theme:dark\"]')"), 'в настройках OBS нет темы Графит'
        pal = await E("(function(){WG.look='theme:dark';var p=widgetTheme();WG.look='current';return p;})()")
        assert pal and pal.get('bg') == '#222222' and pal.get('card') == '#272727', 'палитра OBS: ' + str(pal)
        assert pal.get('ac') == '#D17834' and pal.get('pri') == '#7180AC', 'акцент/кнопка OBS: ' + str(pal)
        print('панель OBS:', pal)
        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: %s' % errs
        await b.close()
asyncio.run(main()); srv.terminate()
