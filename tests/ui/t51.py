import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8789','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# t51 — Ф2: Яндекс без входа. ▶ по треку не молчит: играет отрывок 30 с, а если
# ничего не сыграло — заметное сообщение с кнопкой «Войти в Яндекс». В выдаче без
# входа у треков Яндекса пометка «нужен вход».
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8789/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        # без входа и без YouTube: замена невозможна
        await E("ymLoggedIn=false; ymPlus=false; A.ymStatus=function(){ return Promise.resolve({loggedIn:false}); }; SVC.ytOn=false; SVC.ytDownAt=0; renderSvc()")
        await pg.fill('#search','Кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(900)
        badges = await E("Array.from(document.querySelectorAll('#results .tarea .row[data-src=ym] .rbs')).map(function(b){ return b.textContent; })")
        print('пометки Яндекса без входа:', badges)
        assert badges, 'треки Яндекса не нарисовались в выдаче'
        assert all('нужен вход' in x for x in badges), 'у треков Яндекса без входа должна быть пометка «нужен вход»'
        assert not any('отрывок' in x for x in badges), 'без входа «отрывок» не должен подменять «нужен вход»'

        # поддельный ответ ym-stream «войди» + YouTube недоступен → ничего не сыграло
        await E("A.ymStream=function(){ return new Promise(function(r){ setTimeout(function(){ r({error:'чтобы слушать Яндекс, войди в аккаунт (кнопка вверху)'}); }, 20); }); }; var t=document.getElementById('toast'); if(t)t.hidden=true")
        await E("document.querySelector('#results .tarea .row[data-src=ym]').click()")
        await pg.wait_for_timeout(700)
        toast = await E("(function(){ var t=document.getElementById('toast'); return t && !t.hidden ? {text:t.textContent, btn:(t.querySelector('button')||{}).textContent||''} : null; })()")
        print('заметное сообщение:', toast)
        assert toast, 'после неудачи должно появиться заметное сообщение, а не только строка в подвале'
        assert 'Яндекс играет только после входа' in toast['text'], 'текст сообщения про вход в Яндекс'
        assert toast['btn'] == 'Войти в Яндекс', 'в сообщении должна быть кнопка «Войти в Яндекс»'
        # кнопка ведёт в тот же вход, что и кнопка в шапке
        await E("window.__loginTry=0; A.ymLoginBrowserStart=function(){ window.__loginTry++; return Promise.resolve({error:'x'}); }; true")
        await E("document.querySelector('#toast button').click()"); await pg.wait_for_timeout(400)
        print('нажали «Войти в Яндекс» → запусков входа:', await E("window.__loginTry"))
        assert await E("window.__loginTry") == 1, 'кнопка сообщения должна открывать вход в Яндекс'

        # поток-отрывок всё-таки играет — в плеере честная пометка
        await E("A.ymStream=function(){ return Promise.resolve({audioUrl:'/loud.wav', preview:true}); }; SVC.ytOn=true")
        await E("document.querySelector('#results .tarea .row[data-src=ym]').click()")
        await pg.wait_for_timeout(700)
        sub = await E("document.getElementById('card-sub').textContent")
        print('подпись плеера у отрывка:', sub)
        assert 'отрывок 30 с' in sub, 'в плеере должна быть пометка «отрывок 30 с»'

        # с входом без Плюса — как раньше «отрывок»; с Плюсом — без пометки
        await E("A.ymStatus=function(){ return Promise.resolve({loggedIn:true, name:'tester', hasPlus:false}); }; refreshAcct()")
        await pg.wait_for_timeout(500)
        await E("rerenderTracks(false)"); await pg.wait_for_timeout(200)
        logged = await E("Array.from(document.querySelectorAll('#results .tarea .row[data-src=ym] .rbs')).map(function(b){ return b.textContent; })")
        print('пометки Яндекса со входом без Плюса:', logged)
        assert logged and all('отрывок' in x for x in logged), 'со входом без Плюса остаётся «отрывок»'
        assert not any('нужен вход' in x for x in logged), 'со входом пометки «нужен вход» быть не должно'

        await E("A.ymStatus=function(){ return Promise.resolve({loggedIn:true, name:'tester', hasPlus:true}); }; refreshAcct()")
        await pg.wait_for_timeout(500)
        await E("rerenderTracks(false)"); await pg.wait_for_timeout(200)
        full = await E("Array.from(document.querySelectorAll('#results .tarea .row[data-src=ym] .rbs')).map(function(b){ return b.textContent; })")
        print('пометки Яндекса с Плюсом:', full)
        assert full == [], 'с полным доступом пометок у треков Яндекса нет'
        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: ' + repr(errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
