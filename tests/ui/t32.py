# t32 — подкаст: «Слушать всё» и «Всё в очередь»; вкладка «Книги и подкасты» (02.11.2026)
import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8792','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
POD = """window.__P = { src:'ym', sp:'pod', type:'podcast', albumId:'555', workId:'ym:555', title:'Подкаст', author:'Студия',
  tracks: [5,4,3,2,1].map(function(n){ var c = copyTrack(S.tracks[0]); c.id='ep'+n; c.title='Выпуск '+n; c.sp='pod'; c.albumId='555'; c.workId='ym:555'; c.workTitle='Подкаст'; c.pub='2026-10-0'+n+'T00:00:00'; return c; }) };
  window.__B = { src:'ym', sp:'book', type:'book', albumId:'777', workId:'ym:777', title:'Книга', author:'Автор', thumb:'/app2/assets/book-cover.png',
    tracks: [1,2,3].map(function(n){ var c = copyTrack(S.tracks[0]); c.id='ch'+n; c.title='Глава '+n; c.sp='book'; c.albumId='777'; c.workId='ym:777'; c.workTitle='Книга'; c.idx=n; return c; }) };
  A.ymSpeech = function(id, sp){ return Promise.resolve(id === '555' ? window.__P : (id === '777' ? window.__B : { error: 'нет' })); };"""
ST = "queue.map(function(v,i){return (i===current?'[':'')+v.id+(i===current?']':'');}).join(' ')"
bad = []
def check(name, cond):
    print(('  ✓ ' if cond else '  ✗ ') + name)
    if not cond: bad.append(name)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8792/app2/index.html'); await pg.wait_for_timeout(800)
        E = pg.evaluate
        # Порядок «заказы под первым, живые» — это правила живой очереди; с 14.11
        # по умолчанию классический плейлист.
        await E("setQueueMode('live')"); await pg.wait_for_timeout(100)
        await pg.fill('#search', 'Кино Группа крови'); await pg.press('#search', 'Enter'); await pg.wait_for_timeout(1200)
        await E(POD)
        # очередь: отыгравший, играющий, два ждущих и заказ
        await E("""(function(){ var l=[0,1,2,3].map(function(k){ var c=copyTrack(S.tracks[k+1]); c.id='q'+k; return c; });
          var r = copyTrack(S.tracks[5]); r.id='order'; r.req = { who: 'Миша' }; l.push(r); addMany(l); playQueueItem(1); })()""")
        await pg.wait_for_timeout(400)
        print('до:', await E(ST))
        await E("openSpeechPage(window.__P)"); await pg.wait_for_timeout(400)
        check('у подкаста есть «Слушать всё» и «Всё в очередь»', await E("!!document.querySelector('#searchPl [data-a=all]') && !!document.querySelector('#searchPl [data-a=allq]')"))
        await E("document.querySelector('#searchPl [data-a=all]').click()"); await pg.wait_for_timeout(500)
        print('«Слушать всё»:', await E(ST))
        check('«Слушать всё» заменяет очередь: от последнего выпуска к первому, заказ — сразу под первым',
              await E("queue.map(function(v){return v.id;}).join()") == 'q0,q1,ep5,order,ep4,ep3,ep2,ep1' and await E("queue[current].id") == 'ep5')
        await E("document.querySelector('#searchPl [data-a=allq]').click()"); await pg.wait_for_timeout(300)
        check('«Всё в очередь» — все выпуски в конец, от последнего к первому', await E("queue.slice(-5).map(function(v){return v.id;}).join()") == 'ep5,ep4,ep3,ep2,ep1')
        await E("document.querySelector('#searchPl [data-a=save]').dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); document.querySelector('#searchPl [data-a=save]').click()"); await pg.wait_for_timeout(400)
        check('«Следить» запоминает последний выпуск', await E("spSaved.some(function(s){return s.workId==='ym:555' && s.seen==='2026-10-05T00:00:00';})"))
        # вкладка
        check('вкладка «Книги и подкасты» есть в шапке', await E("!!document.querySelector('#tabs [data-tab=books]')"))
        await E("""marks['book:ym:777'] = { id:'ch2', idx:2, n:10, sec:30, dur:600, title:'Книга', sp:'book', alb:'777', thumb:'', at: Date.now() }""")
        await pg.click('#tabs [data-tab=books]'); await pg.wait_for_timeout(500)
        check('вкладка открывается', await E("!$('viewBooks').hidden"))
        check('сверху слева — «Библиотека», она открыта', await E("!!document.querySelector('#bkSide [data-k=lib].on')") and await E("(document.querySelector('#bkMain h3')||{}).textContent") == 'Библиотека')
        check('слева в «Слушаю сейчас» — начатая книга', await E("Array.from(document.querySelectorAll('#bkSide .bkit b')).some(function(b){return b.textContent==='Книга';})"))
        check('слева — подписка на подкаст', await E("Array.from(document.querySelectorAll('#bkSide .mit b')).some(function(b){return b.textContent==='Подкаст';})"))
        await pg.wait_for_timeout(400)
        check('обложка, которой не было в записи, догрузилась', await E("marks['book:ym:777'] && marks['book:ym:777'].thumb") == '/app2/assets/book-cover.png' and await E("!!document.querySelector('#bkMain .bkt img.lgi')"))
        check('«Слушаю сейчас» — начатая книга плиткой с прогрессом', await E("Array.from(document.querySelectorAll('#bkMain .bkt b')).some(function(b){return b.textContent==='Книга';}) && !!document.querySelector('#bkMain .bkbar i')"))
        # новые выпуски: подписка видела только выпуск 3
        await E("spSaved.forEach(function(s){ if (s.workId==='ym:555') s.seen='2026-10-03T00:00:00'; }); bkFresh['ym:555'] = { at: Date.now(), L: window.__P }; bkRefresh()"); await pg.wait_for_timeout(300)
        check('счётчик новых выпусков у подписки', await E("(document.querySelector('#bkSide .bkn')||{}).textContent") == '2')
        check('«Новые выпуски» в Библиотеке', await E("document.querySelectorAll('#bkMain .bkfresh .row').length") == 2)
        await pg.click('#bkSide .mit:has-text("Подкаст")'); await pg.wait_for_timeout(500)
        check('нажатие на подписку открывает страницу подкаста', await E("(document.querySelector('#bkMain h3')||{}).textContent") == 'Подкаст')
        await pg.click('#bkSide [data-k=lib]'); await pg.wait_for_timeout(300)
        qn = await E("queue.length")
        await pg.click('#bkMain .bkt:has-text("Книга")'); await pg.wait_for_timeout(500)
        check('нажатие на плитку открывает страницу книги, а не включает её', await E("(document.querySelector('#bkMain h3')||{}).textContent") == 'Книга' and await E("queue.length") == qn)
        # удалить по правому клику
        await pg.click('#bkSide [data-k=lib]'); await pg.wait_for_timeout(300)
        await pg.click('#bkMain .bkt:has-text("Книга")', button='right'); await pg.wait_for_timeout(200)
        check('правый клик — меню с «Удалить»', await E("Array.from(document.querySelectorAll('.ctx button')).some(function(b){return b.textContent.indexOf('Удалить')>=0;})"))
        await pg.click('.ctx button:has-text("Удалить")'); await pg.wait_for_timeout(300)
        check('«Удалить» убирает книгу из раздела', not await E("Array.from(document.querySelectorAll('#bkMain .bkt b')).some(function(b){return b.textContent==='Книга';})") and not await E("!!marks['book:ym:777']"))
        await pg.click('#bkSide [data-k=hist]'); await pg.wait_for_timeout(300)
        check('«История прослушанного» открывается', await E("(document.querySelector('#bkMain h3')||{}).textContent") == 'История прослушанного')
        await pg.screenshot(path='bk_tab.png')
        print('ошибки:', [e for e in errs if 'urlStream' not in e])
        await b.close()
    if bad: raise SystemExit('провалено: ' + ', '.join(bad))
asyncio.run(main()); srv.terminate()
