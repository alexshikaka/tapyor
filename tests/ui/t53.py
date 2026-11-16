import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8806','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':1300}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8806/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        cssvar = lambda n: E("getComputedStyle(document.documentElement).getPropertyValue('%s').trim()" % n)
        cls = lambda: E("document.documentElement.className")
        await E("setTab('settings'); showSettingsPane('sLook'); $('sLook').scrollIntoView()"); await pg.wait_for_timeout(300)

        # ── 1. Четыре иконки оболочек: мини-окно, название, подвал плеера ──
        n = await E("document.querySelectorAll('#skinGrid .skin-c[data-skin]').length")
        assert n == 4, 'иконок оболочек: %d' % n
        for sid, name in [('','Стандарт'),('dos','VGA / DOS'),('crt','Неон-скан'),('retro','Ретро-десктоп')]:
            assert await E("!!document.querySelector('#skinGrid .skin-c[data-skin=\"%s\"] .look-win-name')" % sid), 'нет названия у ' + name
            got = await E("document.querySelector('#skinGrid .skin-c[data-skin=\"%s\"] .look-win-name').textContent" % sid)
            assert got == name, 'имя оболочки: %r вместо %r' % (got, name)
            assert await E("document.querySelectorAll('#skinGrid .skin-c[data-skin=\"%s\"] .look-win-bar > *').length >= 4" % sid), 'подвал неполный у ' + name
            assert await E("!!document.querySelector('#skinGrid .skin-c[data-skin=\"%s\"] .look-win-bar .look-ac')" % sid), 'нет черты акцента у ' + name
            assert await E("document.querySelectorAll('#skinGrid .skin-c[data-skin=\"%s\"] .look-win-bar svg').length == 3" % sid), 'значков в подвале не 3 у ' + name
        # Название — шрифтом оболочки (в обычной теме, пока оболочка не включена)
        fonts = await E("Object.fromEntries(Array.from(document.querySelectorAll('#skinGrid .skin-c')).map(x=>[x.dataset.skin, getComputedStyle(x.querySelector('.look-win-name')).fontFamily]))")
        assert 'JetBrains Mono' in fonts['dos'], 'DOS не своим шрифтом: ' + str(fonts.get('dos'))
        assert 'Pixelify Sans' in fonts['crt'], 'CRT не своим шрифтом: ' + str(fonts.get('crt'))
        assert 'Tahoma' in fonts['retro'], 'Ретро не своим шрифтом: ' + str(fonts.get('retro'))
        print('иконки оболочек:', fonts)

        # ── 2. Восемь иконок тем сразу, парами «тёмная — светлая» ──
        ids = await E("Array.from(document.querySelectorAll('#teList [data-theme]')).map(x=>x.dataset.theme)")
        assert ids == ['dark','dark-l','mono','mono-l','winter','winter-l','magenta','magenta-l'], 'id тем: %s' % ids
        names = await E("Array.from(document.querySelectorAll('#teList [data-theme] .look-win-name')).map(x=>x.textContent)")
        assert names == ['Графит','Графит','Монохром','Монохром','Зима близко','Зима близко','Маджента','Маджента'], 'названия: %s' % names
        subs = await E("Array.from(document.querySelectorAll('#teList [data-theme] .look-win-sub')).map(x=>x.textContent)")
        assert subs == ['тёмная','светлая','тёмная','светлая','тёмная','светлая','тёмная','светлая'], 'подписи: %s' % subs
        visible = await E("Array.from(document.querySelectorAll('#teList [data-theme]')).every(x=>x.offsetParent!==null)")
        assert visible, 'не все 8 тем видны сразу'
        assert await E("document.getElementById('teEd').hidden === true"), 'у встроенной темы открыт редактор'
        assert await E("typeof themeIcon === 'function' && typeof skinIcon === 'function'"), 'нет общих функций иконок'
        print('иконки тем:', ids, subs)

        # ── 3. Щелчок по теме меняет тему окна ──
        await pg.click('#teList [data-theme=winter]'); await pg.wait_for_timeout(250)
        c = await cls()
        assert 'theme-custom' in c and 'theme-light' not in c, 'Зима не включилась: ' + c
        assert await cssvar('--bg1') == '#0E121A', 'фон Зимы: ' + await cssvar('--bg1')
        saved = await E("window.__log.filter(x=>x.startsWith('set theme')).pop()")
        assert saved and 'winter' in saved, 'тема не сохранилась: ' + str(saved)
        print('Зима близко:', c, '| --bg1:', await cssvar('--bg1'))

        await pg.click('#teList [data-theme=dark-l]'); await pg.wait_for_timeout(250)
        c = await cls()
        assert 'theme-light' in c and 'theme-custom' in c, 'светлый Графит не включился: ' + c
        expected = await E("TapTheme.build(TapTheme.builtinTheme('dark-l')).bg1")
        assert await cssvar('--bg1') == expected, 'фон светлого Графита: %s вместо %s' % (await cssvar('--bg1'), expected)
        print('светлый Графит:', c, '| --bg1:', await cssvar('--bg1'))

        await pg.click('#teList [data-theme=magenta-l]'); await pg.wait_for_timeout(250)
        assert 'theme-light' in (await cls()), 'светлая Маджента не включилась'
        print('светлая Маджента: --bg1:', await cssvar('--bg1'))

        await pg.click('#teList [data-theme=dark]'); await pg.wait_for_timeout(250)
        c = await cls()
        assert 'theme-dark' in c and 'theme-light' not in c and 'theme-custom' not in c, 'Графит не вернулся: ' + c
        assert await cssvar('--bg1') == '#272727', 'фон Графита: ' + await cssvar('--bg1')

        # ── 4. Иконки оболочек: клик перекрашивает окно, их схемы — теми же иконками ──
        for sid, clsname, scheme, want_bg in [
            ('dos', 'skin-dos', 'turbo', '#000080'),
            ('crt', 'skin-crt', 'p1', '#03110A'),
            ('retro', 'skin-retro', 'win95', '#C3C7CB'),
        ]:
            await pg.click('#skinGrid [data-skin=%s]' % sid); await pg.wait_for_timeout(300)
            assert clsname in (await cls()), 'оболочка %s не включилась: %s' % (sid, await cls())
            schemes = await E("Array.from(document.querySelectorAll('#skinSchemeIcons [data-scheme]')).map(x=>x.dataset.scheme)")
            assert len(schemes) >= 4, 'схем %s: %s' % (sid, schemes)
            assert await E("document.querySelectorAll('#skinSchemeIcons .look-win-bar').length") == len(schemes), 'схемы без иконок'
            # у иконки Стандарта в сетке нет чужого шрифта-оболочки? проверяем только шрифт названия схемы
            await pg.click('#skinSchemeIcons [data-scheme=%s]' % scheme); await pg.wait_for_timeout(300)
            got = await cssvar('--bg0')
            assert got.upper() == want_bg.upper(), 'схема %s/%s: --bg0 = %s' % (sid, scheme, got)
            print('оболочка', sid, '→ схема', scheme, '| --bg0:', got)

        await pg.click('#skinGrid [data-skin=""]'); await pg.wait_for_timeout(300)
        c = await cls()
        assert 'skin-' not in c and 'theme-dark' in c, '«Стандарт» не вернул тему: ' + c
        assert await E("!!document.querySelector('#lookThemes [data-theme=winter]')"), 'после возврата нет тем'
        # даже внутри оболочки иконки показывают СВОЙ шрифт, а не шрифт текущей оболочки
        await pg.click('#skinGrid [data-skin=crt]'); await pg.wait_for_timeout(300)
        dos_font = await E("getComputedStyle(document.querySelector('#skinGrid [data-skin=dos] .look-win-name')).fontFamily")
        assert 'JetBrains Mono' in dos_font, 'внутри CRT иконка DOS потеряла свой шрифт: ' + dos_font
        print('шрифт иконки DOS внутри CRT:', dos_font)
        await pg.click('#skinGrid [data-skin=""]'); await pg.wait_for_timeout(300)

        # ── 5. Миграция старых профилей: violet → Графит, light → светлый Графит ──
        await E("localStorage.setItem('tapTheme','violet'); localStorage.removeItem('tapThemeVars')")
        await pg.reload(); await pg.wait_for_timeout(700)
        c = await cls()
        assert 'theme-dark' in c, 'Фиолетовая не мигрировала в Графит: ' + c
        assert await cssvar('--bg1') == '#272727', 'фон после миграции: ' + await cssvar('--bg1')
        print('миграция violet:', c, '| --bg1:', await cssvar('--bg1'))

        await E("localStorage.setItem('tapTheme','light'); localStorage.removeItem('tapThemeVars')")
        await pg.reload(); await pg.wait_for_timeout(700)
        c = await cls()
        assert 'theme-light' in c, 'Светлая не мигрировала в светлый Графит: ' + c
        expected = await E("TapTheme.build(TapTheme.builtinTheme('dark-l')).bg1")
        assert await cssvar('--bg1') == expected, 'фон светлого Графита после миграции: ' + await cssvar('--bg1')
        print('миграция light:', c, '| --bg1:', await cssvar('--bg1'))

        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: %s' % errs
        await b.close()
asyncio.run(main()); srv.terminate()
