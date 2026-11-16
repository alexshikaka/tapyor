import os
import asyncio
import subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
# WZ4: шаг «Заказы в деле» — два пробных заказа, очередь, «＋ В очередь», уборка.
srv = subprocess.Popen(['python3', '-m', 'http.server', '8777', '--bind', '127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def last_event(evs, kind):
    found = [e for e in evs if e.get('type') == kind]
    return found[-1] if found else None


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(path='mock_req.js')
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8777/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        await E("window.__store.reqPrice = 100; window.__store.reqCurrency = 'RUB';")
        await E("window.__wcmd({op:'do', name:'wz4RulesApply', args:{reqAuto:true, explicitOk:false, repeatOk:false, versionOk:true, maxSec:420}})")
        await pg.wait_for_timeout(250)
        assert await E("RQ.auto") is True

        # ── «Сбалансированно»: первый заказ сам в очередь, второй ждёт ────────
        await E("window.__wcmd({op:'do', name:'wz4OrdersStart'})")
        await pg.wait_for_timeout(1000)
        print('очередь:', await E("queue.filter(v=>v.req).map(v=>v.title + ' — ' + v.req.key)"))
        print('заказы:', await E("RQ.list.map(r=>r.text + ' | paid=' + (r.items[0]&&r.items[0].paid) + ' | state=' + (r.items[0]&&r.items[0].state))"))
        assert await E("queue.some(v=>v.req && v.title==='Кукушка')") is True, 'заказ с достаточной суммой не встал в очередь'
        assert await E("queue.some(v=>v.req && v.title==='Группа крови')") is False, 'заказ без суммы не должен вставать сам'
        assert await E("window.__wevents.filter(e=>e.type==='wz4OrdersReady').length") == 1
        ready = last_event(await E("window.__wevents || []"), 'wz4OrdersReady')
        assert ready['auto'] is True
        assert ready['first']['queued'] is True
        assert ready['second']['paid'] is False
        assert ready['second']['queued'] is False
        # обе очереди и карточка размечены для подсветки
        assert await E("!!document.querySelector('#queue .qrow[data-wz4q]')") is True
        assert await E("!!document.querySelector('[data-wz4wait]')") is True
        assert await E("document.querySelector('[data-wz4wait]').textContent.includes('не хватает суммы')") is True
        # заказы встали во вкладку «Заказы», тестовые — с пометкой
        assert await E("curTab") == 'req'
        print('пометка теста:', await E("Array.from(document.querySelectorAll('.rq .pill')).map(x=>x.textContent)"))

        # ── «＋ В очередь» на карточке ждущего заказа засчитывает шаг ─────────
        await E("document.querySelector('[data-wz4wait]').querySelector('[data-rq=add]').click()")
        await pg.wait_for_timeout(400)
        print('после «＋ В очередь»:', await E("queue.filter(v=>v.req).map(v=>v.title)"))
        assert await E("queue.some(v=>v.req && v.title==='Группа крови')") is True
        assert await E("window.__wevents.some(e=>e.type==='wz4OrderAdded')") is True

        # ── После шага пробные заказы убираются из «Заказов» и очереди ───────
        await E("window.__wcmd({op:'do', name:'wz4OrdersCleanup'})")
        await pg.wait_for_timeout(400)
        left = await E("queue.filter(v=>v.req && /^test:/.test(v.req.key)).length")
        reqs = await E("RQ.list.filter(r=>r.wz4).length")
        print('после уборки:', 'в очереди', left, '| в заказах', reqs)
        assert left == 0, 'пробные заказы остались в очереди'
        assert reqs == 0, 'пробные заказы остались в «Заказах»'
        assert await E("!!document.querySelector('[data-wz4q],[data-wz4wait]')") is False
        assert await E("window.__log.includes('reqClear')") is True

        # ── «Всё через меня»: ждут оба, тексты по ситуации ────────────────────
        await E("window.__wcmd({op:'do', name:'wz4RulesApply', args:{reqAuto:false, explicitOk:false, repeatOk:false, versionOk:false, maxSec:0}})")
        await pg.wait_for_timeout(250)
        assert await E("RQ.auto") is False
        await E("window.__wcmd({op:'do', name:'wz4OrdersStart'})")
        await pg.wait_for_timeout(1000)
        print('всё через меня:', await E("queue.filter(v=>v.req && /^test:/.test(v.req.key)).map(v=>v.title)"))
        assert await E("queue.some(v=>v.req && /^test:/.test(v.req.key))") is False, 'при «Всё через меня» заказ встал сам'
        ready = last_event(await E("window.__wevents || []"), 'wz4OrdersReady')
        assert ready['auto'] is False
        assert ready['first']['queued'] is False
        assert ready['second']['paid'] is False
        assert await E("!!document.querySelector('[data-wz4wait]')") is True

        await E("window.__wcmd({op:'do', name:'wz4OrdersCleanup'})")
        await pg.wait_for_timeout(400)
        assert await E("queue.filter(v=>v.req && /^test:/.test(v.req.key)).length") == 0
        assert await E("RQ.list.filter(r=>r.wz4).length") == 0

        print('ошибки:', errs)
        assert errs == [], 'ошибки страницы: ' + repr(errs)
        await b.close()


try:
    asyncio.run(main())
finally:
    srv.terminate()
