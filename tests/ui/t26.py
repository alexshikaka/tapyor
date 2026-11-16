import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','rangeserver.py','8804'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# t26 — энергосбережение: картинка YouTube на паузе, когда окна видео не видно; панель OBS не обновляется без панели;
#        окно в фоне (body.calm) — украшения замирают; заставка «Ничего не играет» не дышит бесконечно
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(script="window.__pushes=0; window.app.widgetPush=function(){ window.__pushes++; }; window.app.onWidgetClients=function(cb){ window.__wgcb=cb; setTimeout(function(){ cb(0); }, 10); };")
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8804/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        # заставка: конечная анимация
        it = await E("getComputedStyle(document.querySelector('.vidph-logo')).animationIterationCount")
        print('заставка: повторов анимации', it); assert it != 'infinite'
        # YouTube видео + звук
        await E("window.app.ytStream=function(id){ return Promise.resolve({ videoUrl:'/vid.webm', audioUrl:'/loud.wav' }); }")
        await E("addToQueue({src:'yt', id:'v1', title:'Клип', author:'Кто-то', seconds:20})"); await pg.wait_for_timeout(1500)
        st="({mode: mode, vid: !video.paused, aud: !aud.paused})"
        s1 = await E(st); print('играет:', s1); assert s1['mode']=='split' and s1['vid'] and s1['aud']
        await E("setTab('settings')"); await pg.wait_for_timeout(500)
        s2 = await E(st); print('в настройках:', s2); assert not s2['vid'] and s2['aud'], 'картинка не на паузе'
        await pg.wait_for_timeout(1200)
        await E("setTab('search')"); await pg.wait_for_timeout(800)
        s3 = await E("({vid: !video.paused, aud: !aud.paused, drift: Math.abs(video.currentTime-aud.currentTime)})"); print('вернулся:', s3); assert s3['vid'] and s3['drift'] < 1
        # панель OBS: без открытых панелей ничего не шлём
        n0 = await E("window.__pushes"); await pg.wait_for_timeout(3500); n1 = await E("window.__pushes")
        print('обновлений панели без панели:', n1 - n0); assert n1 == n0
        await E("window.__wgcb(1)"); await pg.wait_for_timeout(3500); n2 = await E("window.__pushes")
        print('с открытой панелью:', n2 - n1); assert n2 > n1
        # окно в фоне — эквалайзер очереди на паузе
        await E("document.body.classList.add('calm')")
        ps = await E("(()=>{ var r=document.querySelector('.qov .eq rect'); return r ? getComputedStyle(r).animationPlayState : 'нет' })()")
        print('эквалайзер в фоне:', ps); assert ps in ('paused', 'нет')
        print('ошибки:', errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
