import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8779','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# t24 — аудит 25.10: громкость при игре через сайт Яндекса; запасной путь, если поток получен, но не играет
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8779/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        # 1) поток Яндекса получен, но звук не пошёл → сайт Яндекс Музыки (раньше — тишина)
        await E("window.__ywOk = true; window.__log.length = 0; addToQueue({src:'ym', id:'500', title:'Тест поток', author:'Кино', seconds:200})"); await pg.wait_for_timeout(900)
        print('играет напрямую:', await E("mode"), await E("!!aud.getAttribute('src')"))
        await E("aud.dispatchEvent(new Event('error'))"); await pg.wait_for_timeout(700)
        log = await E("window.__log.slice()")
        print('после сбоя звука: режим', await E("mode"), '| сайт Яндекса:', any(x.startswith('ymwebPlay 500') for x in log))
        assert await E("mode") == 'ymweb', 'нет запасного пути'
        # 2) громкость слушается при игре через сайт
        await E("window.__log.length = 0; var ve = document.getElementById('vol'); ve.value = 40; ve.dispatchEvent(new Event('input'))"); await pg.wait_for_timeout(200)
        vl = [x for x in await E("window.__log.slice()") if x.startswith('ymwebCmd volume')]
        print('громкость на сайт:', vl)
        assert vl and vl[-1].endswith(' 0.4'), 'громкость не ушла на сайт'
        # повтор той же громкости не шлётся
        await E("window.__log.length = 0; document.getElementById('vol').dispatchEvent(new Event('input'))"); await pg.wait_for_timeout(150)
        print('повтор не шлётся:', not [x for x in await E("window.__log.slice()") if x.startswith('ymwebCmd volume')])
        # 3) второй сбой того же запуска не зацикливается: флаг сбрасывается только при новом запуске
        print('флаг сбоя на треке:', await E("!!queue[current]._mediaFb"))
        print('ошибки:', errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
