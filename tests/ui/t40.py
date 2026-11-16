import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8791','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# t40 — аудит 0.34.0, A10: после падения окна трек, стоявший на паузе, не включается сам.
# И у сайта Яндекса (ymx) «играет/пауза» запоминается явно, а не угадывается.
def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)

DAY = "(function(){var d=new Date(Date.now()-6*3600*1000);return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();})()"
def restore_script(playing):
    return ("""
window.__today = { day: %s,
  items: [{ src:'yt', id:'v1', title:'Трек после сбоя', author:'Тест', duration:'3:00', seconds:180, played:true }],
  current: 0, pos: 1.5, playing: %s };
var _gs = window.app.getSetting;
window.app.getSetting = function(k){ if (k === 'today') return Promise.resolve(window.__today); return _gs(k); };
window.app.recoverTake = function(){ return Promise.resolve({ recovered: true }); };
window.__busy = []; window.app.playerBusy = function(b){ window.__busy.push(!!b); };
""" % (DAY, 'true' if playing else 'false'))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None),
                                    args=['--autoplay-policy=no-user-gesture-required'])
        errs = []

        # 1) Сайт Яндекса: пауза должна записаться как playing:false (явный признак из событий).
        pg = await b.new_page(viewport={'width':1440,'height':900})
        await pg.add_init_script(path='mock5.js')
        pg.on('pageerror', lambda e: errs.append('ymx: ' + str(e)))
        await pg.goto('http://127.0.0.1:8791/app2/index.html'); await pg.wait_for_timeout(900)
        E = pg.evaluate
        # Свой ymwebPlay: у мока он сам шлёт «ended» через 2,5 с и перезапускает трек.
        # Здесь нужны только play/pause, чтобы проверить запись «играет/пауза».
        await E("""(function(){
window.__ywOk = true;
window.app.ymwebPlay = function(t){
  window.__log.push('ymwebPlay ' + t.id);
  setTimeout(function(){ window.__yw({ev:'play', paused:false, ended:false, time:2.0, dur:200}); }, 60);
  return Promise.resolve({ ok:true, dur:200 });
};
})()""")
        await E("addToQueue({src:'ym', id:'500', title:'Сайт Яндекса', author:'Кино', seconds:200})")
        await pg.wait_for_timeout(900)
        await E("aud.dispatchEvent(new Event('error'))"); await pg.wait_for_timeout(600)
        ok(await E("mode") == 'ymweb', 'трек играет через сайт Яндекса')
        t1 = await E("window.__store.today || null")
        ok(bool(t1) and t1.get('playing') is True, 'сайт Яндекса: «играет» записано')
        await E("window.__yw({ev:'pause', paused:true, ended:false, time:7.5, dur:200})"); await pg.wait_for_timeout(900)
        t2 = await E("window.__store.today || null")
        ok(bool(t2) and t2.get('playing') is False, 'сайт Яндекса: пауза записана как «не играет»')
        ok(float((t2 or {}).get('pos') or 0) >= 7.0, 'позиция на паузе сохранена: ' + str((t2 or {}).get('pos')))
        await pg.close()

        # 2) Окно упало, трек был на паузе: не включаем, только выбираем.
        pg2 = await b.new_page(viewport={'width':1440,'height':900})
        await pg2.add_init_script(path='mock5.js')
        await pg2.add_init_script(restore_script(False))
        pg2.on('pageerror', lambda e: errs.append('paused: ' + str(e)))
        await pg2.goto('http://127.0.0.1:8791/app2/index.html'); await pg2.wait_for_timeout(1400)
        E2 = pg2.evaluate
        ok(not (await E2("!!master().getAttribute('src')")), 'трек после сбоя НЕ загружен и не играет')
        ok(True not in (await E2("window.__busy.slice()")), 'playerBusy не включался — музыка молчит')
        ok(await E2("playingId") == 'v1', 'трек выбран в очереди')
        toast = await E2("(document.getElementById('toast')||{}).textContent || ''")
        ok('на паузе' in toast, 'подсказка: трек на паузе, нажми «Играть» — ' + toast)
        # Владелец сам нажимает «Играть» — вот теперь трек грузится и место восстанавливается.
        await E2("document.getElementById('playpause').click()"); await pg2.wait_for_timeout(1200)
        ok(bool(await E2("master().getAttribute('src')")), 'после «Играть» звук загрузился')
        ok(True in (await E2("window.__busy.slice()")), 'после «Играть» playerBusy включился')
        await pg2.close()

        # 3) Если играло — после поднятия окна музыка продолжается, как раньше.
        pg3 = await b.new_page(viewport={'width':1440,'height':900})
        await pg3.add_init_script(path='mock5.js')
        await pg3.add_init_script(restore_script(True))
        pg3.on('pageerror', lambda e: errs.append('playing: ' + str(e)))
        await pg3.goto('http://127.0.0.1:8791/app2/index.html'); await pg3.wait_for_timeout(1600)
        E3 = pg3.evaluate
        ok(bool(await E3("master().getAttribute('src')")), 'игравший трек продолжил после сбоя')
        ok(True in (await E3("window.__busy.slice()")), 'playerBusy включился')
        await pg3.close()

        print('ошибки:', errs)
        ok(not errs, 'без ошибок страницы')
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
