import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8784','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':1300}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8784/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        await E("setTab('settings'); showSettingsPane('sLook')"); await pg.wait_for_timeout(200)
        # P5c №9: тема с цветом, который пытается добавить атрибут-обработчик
        await E("""(function(){
          myThemes = [{ id:'evil', name:'Злая тема', mode:'dark', bg:'#fff" onmouseover="window.__themeXss=1', text:'#ffffff', accent:'#ff0000', primary:'#00ff00', contrast:50 }];
          applyTheme('c:evil', false);
          colPresets();
        })()""")
        list_html = await E("document.querySelector('#teList').innerHTML")
        presets_html = await E("document.querySelector('#colPresets').innerHTML")
        editor_html = await E("document.querySelector('#teEd').innerHTML")
        assert 'onmouseover' not in list_html, 'в списке тем появился атрибут-обработчик'
        assert 'onmouseover' not in presets_html, 'в палитре появился атрибут-обработчик'
        assert 'onmouseover' not in editor_html, 'в редакторе темы появился атрибут-обработчик'
        assert await E("!document.querySelector('#teList [onmouseover], #colPresets [onmouseover], #teEd [onmouseover]')"), 'атрибут-обработчик в разметке'
        # наводим на иконку темы: обработчик не должен сработать
        await pg.hover('#teList [data-th="c:evil"] .look-win')
        await pg.wait_for_timeout(100)
        assert await E("(window.__themeXss || 0) === 0"), 'обработчик сработал'
        # недопустимый цвет заменён на безопасный, а не исчез
        print('цвет в иконке:', await E("document.querySelector('#teList [data-th=\"c:evil\"] .look-win').getAttribute('style')"))
        print('кнопок палитры:', await E("document.querySelectorAll('#colPresets [data-col]').length"))
        # допустимые форматы не ломаем: hex, rgb, oklch
        print('проверка форматов:', await E("[safeColor('#abc'), safeColor('#A1B2C3'), safeColor('rgb(10, 20, 30)'), safeColor('oklch(0.5 0.1 30)'), safeColor('#fff\\\" x')]"))
        assert await E("safeColor('#abc') === '#abc' && safeColor('#A1B2C3') === '#A1B2C3' && safeColor('rgb(10, 20, 30)') === 'rgb(10, 20, 30)' && safeColor('oklch(0.5 0.1 30)') === 'oklch(0.5 0.1 30)'"), 'допустимый формат цвета отброшен'
        assert await E("safeColor('#fff\\\" onmouseover=\\\"x') === '#000000'"), 'опасный цвет не заменён'
        # вернуть обычную тему
        await E("myThemes=[]; applyTheme('violet', false)")
        print('назад:', await E("document.documentElement.className"))
        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: %s' % errs
        await b.close()
asyncio.run(main()); srv.terminate()
