# 28.10: «Классический плейлист» — треки стоят на месте, заказы зелёным блоком, «Волна» заменяет плейлист
import os, asyncio, subprocess
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8784','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8784/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        # С 14.11 по умолчанию «Классический плейлист». Этот тест — про переход ИЗ живой
        # очереди в классику, поэтому сначала явно включаем живую.
        await E("setQueueMode('live')"); await pg.wait_for_timeout(100)
        T="(id,t)=>({src:'yt',id:id,title:t,author:'A',duration:'3:00',thumb:''})"
        ids=lambda: E("queue.map(v=>v.title)")
        await E("waveBuf = [{src:'ym',id:'w0',title:'Волна до',author:'A',duration:'3:00',thumb:''}]; renderQueue()")
        await pg.click('#qMode [data-qm=classic]'); await pg.wait_for_timeout(150)
        ok(await ids()==['Волна до'] and await E("waveBuf.length")==0, '«Дальше в волне» стало строками плейлиста')
        await E("queue=[]; current=-1; waveBuf=[]; renderQueue()")
        ok(await E("isClassic()") and await E("document.querySelector('#qMode [data-qm=classic]').classList.contains('on')"), 'нажал на текст — включился классический, подпись горит')
        ok('queueMode="classic"' in ' '.join(await E("window.__log")), 'режим сохранён')
        await E(f"addMany([({T})('a','A'),({T})('b','B'),({T})('c','C'),({T})('d','D')])"); await pg.wait_for_timeout(300)
        ok(await E("current")==0, 'добавил 4 трека — заиграл первый')
        await E("playQueueItem(2)"); await pg.wait_for_timeout(200)
        ok(await ids()==['A','B','C','D'] and await E("current")==2, 'нажал третий — играет на своём месте, порядок не менялся')
        ok(await E("document.querySelectorAll('#queue .qrow.done').length")==0, 'бледных «сыгранных» нет')
        await E(f"addReq(Object.assign(({T})('r1','R1'),{{req:{{who:'Петя'}}}}))"); await E(f"addReq(Object.assign(({T})('r2','R2'),{{req:{{who:'Вася'}}}}))")
        ok(await ids()==['A','B','C','R1','R2','D'], 'заказы встали под играющим, второй — под первым: ' + ','.join(await ids()))
        ok(await E("document.querySelectorAll('#queue .qrow.req').length")==2, 'заказы помечены зелёным')
        await E(f"addNext(({T})('n','N'))")
        ok(await ids()==['A','B','C','R1','R2','N','D'], '«играть следующим» — после заказов')
        await E(f"addToQueue(({T})('e','E'))")
        ok((await ids())[-1]=='E', '«в очередь» — в самый конец')
        await E("playQueueItem(0)"); await pg.wait_for_timeout(200)
        ok(await ids()==['A','B','C','R1','R2','N','D','E'] and await E("current")==0, 'нажал трек выше играющего — играет он, ничего не переехало')
        await E("moveItem(6, 0)")
        ok((await ids())[0]=='D', 'перетаскивание свободное — выше играющего тоже')
        # волна заменяет плейлист, заказы остаются
        await E("ymLoggedIn = true; playQueueItem(1)"); await pg.wait_for_timeout(200)
        await E("setBg(MY_WAVE, true)"); await pg.wait_for_timeout(800)
        q = await ids()
        ok(q[0].startswith('Волна') and q[1:3]==['R1','R2'] and all(x.startswith('Волна') for x in q[3:]) and await E("current")==0, 'волна заменила плейлист: первый трек волны играет, заказы под ним: ' + ','.join(q))
        ok(await E("document.querySelector('#queue .qnext')") is None, 'вкладки «Дальше в волне» нет')
        hist = await E("histLoad().map(e=>e.t.title)")
        ok('A' in hist and 'C' in hist, 'сыгранное ушло в «Историю»: ' + ','.join(hist))
        # обратно в живую
        await pg.click('#qModeTg'); await pg.wait_for_timeout(150)
        ok(not await E("isClassic()") and await E("queue.every((v,i)=> v.played === (i<=current))"), 'тумблер — назад в живую: всё под играющим стало активной очередью')
        # классика: выбор трека не должен прокручивать список к верху
        await pg.click('#qMode [data-qm=classic]'); await pg.wait_for_timeout(150)
        await E("addMany(Array.from({length:18},function(_,i){return {src:'yt',id:'s'+i,title:'S'+i,author:'A',duration:'3:00',thumb:''}}))")
        await pg.wait_for_timeout(200)
        await E("document.getElementById('queue').scrollTop=0")
        await E("playQueueItem(12)")
        await pg.wait_for_timeout(250)
        ok(await E("document.getElementById('queue').scrollTop")==0, 'классика: выбор трека не прокручивает список')
        ok(not errs, 'без ошибок' + (': ' + '; '.join(errs) if errs else ''))
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
