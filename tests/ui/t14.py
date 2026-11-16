import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8779','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8779/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        # A4-3: отдельного сервиса Telegram во вкладке «Браузер» больше нет
        assert await E("document.getElementById('brTgBtn') === null"), 'кнопка Telegram осталась'
        assert await E("document.getElementById('setTgRow') === null"), 'строка Telegram в настройках осталась'
        assert await E("BR_SVC.tg === undefined"), 'сервис tg остался в BR_SVC'
        assert await E("typeof qcShown === 'undefined'"), 'старая фильтрация чеклиста осталась'
        await pg.fill('#search','Кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(600)
        await pg.click('.arc'); await pg.wait_for_timeout(600)
        print('вкладки:', await E("Array.from(document.querySelectorAll('.ar-tabs button')).map(b=>b.innerText.replace(/\\s+/g,' '))"))
        print('теги/слушатели:', await E("Array.from(document.querySelectorAll('.ar-tags span')).map(x=>x.textContent).join(',')"), await E("document.querySelector('.arh .pm').textContent"))
        print('популярное строк:', await E("document.querySelectorAll('.ar-body .row').length"), '| кнопки:', await E("Array.from(document.querySelectorAll('.ar-acts button')).map(b=>b.textContent)"))
        await pg.click('.ar-more'); await pg.wait_for_timeout(300)
        print('после «Загрузить ещё»:', await E("document.querySelectorAll('.ar-body .row').length"), await E("(document.querySelector('.ar-more')||{textContent:'кнопки нет'}).textContent"))
        await pg.click('.ar-more'); await pg.wait_for_timeout(300)
        print('ещё раз:', await E("document.querySelectorAll('.ar-body .row').length"), await E("(document.querySelector('.ar-more')||{textContent:'кнопки нет'}).textContent"))
        await E("openTrackMenu(400,300,S.tracks[0])"); await pg.wait_for_timeout(100); await pg.screenshot(path='a_menu.png'); await pg.keyboard.press('Escape')
        await pg.screenshot(path='a_page.png')
        await pg.click('.ar-tabs [data-apt=album]'); await pg.wait_for_timeout(200)
        print('альбомы:', await E("Array.from(document.querySelectorAll('.alc b')).map(b=>b.textContent)"))
        await pg.screenshot(path='a_albums.png')
        await pg.click('.alc:has-text(\"45\")'); await pg.wait_for_timeout(1500)
        print('альбом Deezer строки:', await E("Array.from(document.querySelectorAll('#searchPl .plrows > *')).map(r=>(r.querySelector('.t')||{}).textContent+' ['+((r.querySelector('.rbs')||r.querySelector('.fst')||{}).textContent||'')+']')"))
        await pg.screenshot(path='a_dz.png')
        await pg.click('#searchPl .plbtns [data-da=save]'); await pg.wait_for_timeout(150); await pg.click('.ask [data-x="1"]'); await pg.wait_for_timeout(200)
        print('сохранён плейлист:', await E("localLists().map(m=>m.title+':'+m.tracks.length)"))
        await pg.click('#searchPl [data-back]'); await pg.wait_for_timeout(200)
        print('назад к исполнителю:', await E("(document.querySelector('.arh h3')||{}).textContent"))
        await pg.click('.ar-tabs [data-apt=album]'); await pg.click('.alc:has-text(\"Группа крови\")'); await pg.wait_for_timeout(400)
        print('альбом Яндекса:', await E("document.querySelectorAll('#searchPl .plrows .row').length"), await E("document.querySelector('#searchPl [data-back]').textContent"))
        await pg.click('#searchPl [data-back]'); await pg.wait_for_timeout(200)
        await pg.click('.ar-tabs [data-apt=similar]'); await pg.click('.ar-simc:has-text(\"Алиса\")'); await pg.wait_for_timeout(500)
        print('похожий открыт:', await E("search.value"), await E("(document.querySelector('.arh .pk')||{}).textContent"))
        # меню трека
        await E("openTrackMenu(200,200,{src:'yt',id:'x',title:'Кино - Кукушка',author:'KinoVEVO'})")
        print('пункт меню:', await E("Array.from(document.querySelectorAll('.ctx button')).map(b=>b.textContent).filter(t=>t.startsWith('Страница'))"))
        await pg.keyboard.press('Escape')
        # браузер: t.me открывается как обычный сайт, адресная строка работает
        await pg.fill('#search','https://t.me/durov/123'); await pg.press('#search','Enter'); await pg.wait_for_timeout(400)
        print('t.me → вкладка:', await E("curTab"), await E("BR.cur"), await E("$('brUrl').value"))
        assert await E("curTab") == 'browser', 't.me не открыл вкладку «Браузер»'
        assert await E("BR.cur") == 'web', 't.me должен открыться как обычный сайт, а не во внутреннем Telegram'
        # у поддельного <webview> нет loadURL — записываем, куда Тапёр собирался перейти
        await E("BR.views.web.loadURL = function(u){ window.__brNav = String(u); }")
        await pg.fill('#brUrl','кино группа крови аккорды'); await pg.press('#brUrl','Enter'); await pg.wait_for_timeout(300)
        print('поиск в браузере → ', await E("BR.cur"), await E("window.__brNav"))
        assert await E("BR.cur") == 'web', 'адресная строка не открыла вкладку «Сайт»'
        assert 'ya.ru/search' in (await E("window.__brNav") or ''), 'поиск из адресной строки не сработал'
        await pg.screenshot(path='a_br.png', clip={'x':0,'y':0,'width':1440,'height':260})
        print('ошибки:', errs)
        await b.close()
asyncio.run(main()); srv.terminate()
