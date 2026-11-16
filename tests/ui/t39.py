import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8779','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        # Б10: пака нет. Пункты «Чат-бот» и «Оверлей-плейлист» всё равно видны и показывают подсказку.
        await pg.add_init_script("window.app.modStatus = function(){ return Promise.resolve({ installed:false, manifest:null, license:{ state:'not-installed', enabled:false }, modules:{}, dev:false, error:null }); };")
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8779/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        await E("botLoad(true)"); await E("ovLoad()"); await pg.wait_for_timeout(300)
        assert await E("document.getElementById('goBot').hidden === false"), 'пункт «Чат-бот» скрыт без пака'
        assert await E("document.getElementById('goOverlay').hidden === false"), 'пункт «Оверлей-плейлист» скрыт без пака'
        await E("setTab('settings'); showSettingsPane('sBot')"); await pg.wait_for_timeout(200)
        print('чат-бот:', (await E("document.getElementById('botPanel').innerText")).replace('\n',' | '))
        assert 'входит в пак стримера' in (await E("document.getElementById('botPanel').innerText"))
        assert await E("!!document.querySelector('#botPanel [data-pack-open]')"), 'в подсказке бота нет кнопки «Установить пак»'
        await E("showSettingsPane('sOverlay')"); await pg.wait_for_timeout(200)
        print('оверлей:', (await E("document.getElementById('ovPanel').innerText")).replace('\n',' | '))
        assert 'входит в пак стримера' in (await E("document.getElementById('ovPanel').innerText"))
        assert await E("!!document.querySelector('#ovPanel [data-pack-open]')"), 'в подсказке оверлея нет кнопки «Установить пак»'
        await pg.screenshot(path='mod_nopack.png', clip={'x':0,'y':0,'width':1440,'height':900})
        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: ' + str(errs)
        await b.close()
asyncio.run(main()); srv.terminate()
