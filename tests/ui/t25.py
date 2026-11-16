import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8782','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# t25 — заказ не включился (неполадка): возвращается в «Заказы» с пометкой; при «Включать фон после очереди» — без тишины
ORDER = "function(key, name){ return {key:key,prov:'da',name:name,text:'Кино — Сломано',amount:100,currency:'RUB',at:Date.now(),got:Date.now(),level:'exact',state:'new',items:[{level:'exact',track:__T('broken','Кино','Сломано',200),alts:[],flags:[],paid:true}]}; }"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='mock_req.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8782/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        # нигде не играет: Яндекс 451 → сайт не отвечает → замены нет
        await E("window.app.findAlt = function(){ return Promise.resolve({ error: 'нет' }); }")
        # А) тумблер выключен — плеер ждёт стримера, заказ снова активный
        await E("waveCfg.on = false; var mk = " + ORDER + "; window.__reqCb(mk('da:50','Петя'))"); await pg.wait_for_timeout(300)
        await E("addToQueue({src:'ym', id:'n1', title:'Следующий', author:'Кто-то', seconds:200}); stopVideo()")
        await E("rqAdd(RQ.list.find(r=>r.key==='da:50'), RQ.list.find(r=>r.key==='da:50').items[0], null, true)"); await pg.wait_for_timeout(2600)
        it = await E("JSON.stringify((function(){ var it = RQ.list.find(r=>r.key==='da:50').items[0]; return {state: it.state||null, failed: it.failed||null}; })())")
        print('А) выкл: трек сейчас', await E("queue[current].id"), '| заказ', it)
        assert await E("queue[current].id") == 'broken', 'не должен был пропускать'
        assert '"state":null' in it and 'failed' in it
        await pg.click('#tabs [data-tab=req]'); await pg.wait_for_timeout(300)
        fl = await E("Array.from(document.querySelectorAll('.rq')).filter(x=>/Петя/.test(x.textContent)).map(x=>(x.querySelector('.rq-fl')||{}).textContent)")
        print('   пометка в «Заказах»:', fl)
        # авторежим не ставит его снова
        await E("RQ.auto = true; rqRender()"); await pg.wait_for_timeout(300)
        print('   авторежим не повторил:', await E("queue.filter(v=>v.id==='broken').length") == 1)
        # Б) тумблер включён — переходит к следующему сам
        await E("RQ.auto = false; waveCfg.on = true; window.__reqCb(mk('da:51','Вася'))"); await pg.wait_for_timeout(300)
        await E("rqAdd(RQ.list.find(r=>r.key==='da:51'), RQ.list.find(r=>r.key==='da:51').items[0], null, true)"); await pg.wait_for_timeout(3000)
        cur = await E("queue[current] && queue[current].id")
        st2 = await E("RQ.list.find(r=>r.key==='da:51').items[0].state || null")
        print('Б) вкл: после сбоя играет', cur, '(не сломанный, тишины нет)', '| заказ активен снова:', st2 is None)
        assert cur and cur != 'broken', 'не перешёл к следующему'
        print('ошибки:', errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
