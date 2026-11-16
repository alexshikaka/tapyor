# t31 — книга в очереди: монолит, правила одного трека в живой очереди (02.11.2026)
import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8791','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
BOOK = """(function(){ var src = S.tracks[0];
  var ch = [1,2,3,4].map(function(n){ var c = copyTrack(src); c.id = 'ch'+n; c.title = 'Глава '+n; c.sp='book'; c.albumId='777'; c.workId='ym:777'; c.workTitle='Книга'; c.idx=n; return c; });
  addMany(ch, true); })()"""
ST = "queue.map(function(v,i){return (i===current?'[':'')+v.id+(i===current?']':'');}).join(' ')"
WHOLE = """(function(){ var ks = queue.map(spKeyOf), f = ks.indexOf('ym:777'), l = ks.lastIndexOf('ym:777');
  for (var i = f; i <= l; i++) if (ks[i] !== 'ym:777') return 'разорвана';
  return queue.slice(f, l + 1).map(function(v){return v.id;}).join() === 'ch1,ch2,ch3,ch4' ? 'целая' : 'порядок сбит'; })()"""
DRAG = """(function(srcSel, n, dstSel, frac){
  var src = document.querySelectorAll(srcSel)[n], dst = document.querySelector(dstSel);
  var dt = new DataTransfer(), r = dst.getBoundingClientRect(), y = r.top + r.height * frac, x = r.left + 30;
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
})"""
bad = []
def check(name, cond):
    print(('  ✓ ' if cond else '  ✗ ') + name)
    if not cond: bad.append(name)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8791/app2/index.html'); await pg.wait_for_timeout(800)
        E = pg.evaluate
        # Тест про правила ЖИВОЙ очереди; с 14.11 по умолчанию классический плейлист.
        await E("setQueueMode('live')"); await pg.wait_for_timeout(100)
        await pg.fill('#search', 'Кино Группа крови'); await pg.press('#search', 'Enter'); await pg.wait_for_timeout(1200)
        await E("addMany([S.tracks[1]])"); await E(BOOK); await pg.wait_for_timeout(300)
        check('свёрнутая книга — одна рамка, глав не видно', await E("document.querySelectorAll('#queue .qbwrap').length === 1 && !document.querySelector('#queue .qbwrap .qrow')"))
        await E("playQueueItem(queue.findIndex(function(v){return v.id==='ch3';}))"); await pg.wait_for_timeout(400)
        print('книга играет:', await E(ST))
        check('нажатие на главу включает её, книга целая', await E("queue[current].id") == 'ch3' and await E(WHOLE) == 'целая')
        await E("document.querySelectorAll('#results .tarea .row .add')[2].click()"); await pg.wait_for_timeout(200)
        check('«В очередь» добавляет трек в конец', await E("queue.length") == 6 and await E("spKeyOf(queue[5])") == '')
        await E("document.querySelectorAll('#results .tarea .row .nxt')[3].click()"); await pg.wait_for_timeout(200)
        check('«Играть следующим» встаёт сразу за книгой', await E("queue[afterCur()-0] && queue.indexOf(queue[current]) < afterCur() && spKeyOf(queue[afterCur()]) === ''") and await E(WHOLE) == 'целая')
        await E("spOpenBooks['ym:777'] = true; renderQueue()"); await pg.wait_for_timeout(200)
        check('развёрнутая книга — главы внутри одной рамки', await E("document.querySelectorAll('#queue .qbwrap .qrow.inbook').length") == 4)
        await E("document.querySelector('#queue').scrollTop = 0; playQueueItem(queue.findIndex(function(v){return v.id==='ch4';}))"); await pg.wait_for_timeout(300)
        check('глава внутри играющей книги не листает очередь', await E("document.querySelector('#queue').scrollTop") == 0)
        await E(DRAG + "('#queue > .qrow', 0, '#queue .qbwrap .qrow.inbook:nth-of-type(3)', 0.5)"); await pg.wait_for_timeout(300)
        check('трек, брошенный на главу, не попадает внутрь книги', await E(WHOLE) == 'целая')
        await E("""(function(){ bgSel = { kind: 'wave', name: 'Моя волна' }; bgPending = true;
          waveBuf = [S.tracks[3], S.tracks[4]].map(function(t, k){ var c = copyTrack(t); c.id = 'w' + k; return c; }); qNextOpen = true; renderQueue(); })()""")
        await pg.wait_for_timeout(200)
        await E(DRAG + "('#queue .qn-row', 0, '#queue .qbwrap', 0.5)"); await pg.wait_for_timeout(300)
        check('трек из волны, брошенный на книгу, — в очереди и не внутри книги', await E("queue.some(function(v){return v.id==='w0';})") and await E(WHOLE) == 'целая')
        await E("document.querySelectorAll('#queue .qn-row')[0].click()"); await pg.wait_for_timeout(400)
        print('после нажатия в волне:', await E(ST))
        check('нажатие в «Дальше в волне»: трек играет, книга целая', await E("queue[current].id") == 'w1' and await E(WHOLE) == 'целая')
        check('книга бледнеет как отыгравшая', await E("!!document.querySelector('#queue .qbwrap.done')"))
        # глава не заиграла: замену с другой площадки не ставим — иначе книга рвётся
        await E("playQueueItem(queue.findIndex(function(v){return v.id==='ch2';}))"); await pg.wait_for_timeout(300)
        await E("A.findAlt = function(){ return Promise.resolve({ track: { src: 'yt', id: 'alt1', title: 'Чужой трек', author: 'x' } }); }")
        await E("failOver(queue[current], 'ym', 'тест: поток не играет')"); await pg.wait_for_timeout(400)
        check('глава, которая не играет, не заменяется чужим треком', await E(WHOLE) == 'целая' and not await E("queue.some(function(v){return v.id==='alt1';})"))
        await E("removeAt(queue.findIndex(function(v){return v.id==='ch2';}))"); await pg.wait_for_timeout(200)
        check('«Убрать» у главы убирает книгу целиком', await E("queue.filter(function(v){return spKeyOf(v);}).length") == 0)
        # длинная очередь (как на стриме): рамка книги не сжимается и видна после запуска со страницы
        await E("""(function(){ var l=[]; for (var k=0;k<40;k++){ var c=copyTrack(S.tracks[k%5]); c.id='long'+k; l.push(c);} addMany(l); playQueueItem(queue.length-1); })()""")
        await pg.wait_for_timeout(300)
        await E("""spPlayFrom({ src:'ym', sp:'book', albumId:'888', workId:'ym:888', title:'Длинная книга',
          tracks: [1,2,3].map(function(n){ var c = copyTrack(S.tracks[0]); c.id='lb'+n; c.sp='book'; c.albumId='888'; c.workId='ym:888'; c.workTitle='Длинная книга'; c.idx=n; return c; }) }, 1, 0)""")
        await pg.wait_for_timeout(400)
        hv = await E("""(function(){ var box=document.querySelector('#queue'), w=box.querySelector('.qbwrap.playing'); if(!w) return [0,0];
          var a=box.getBoundingClientRect(), r=w.getBoundingClientRect(); return [Math.round(r.height), (r.top>=a.top-1 && r.bottom<=a.bottom+1) ? 1 : 0]; })()""")
        check('в длинной очереди рамка книги не сжимается (высота ' + str(hv[0]) + ' px)', hv[0] >= 50)
        check('после запуска со страницы книга видна в окне очереди', hv[1] == 1)
        # ===== книга — один трек: упаковка, «Дальше», «Назад» =====
        await E("""(function(){ queue = []; current = -1; renderQueue();
          var L = { src:'ym', sp:'book', albumId:'999', workId:'ym:999', title:'Третья книга',
            tracks: [1,2,3,4,5].map(function(n){ var c = copyTrack(S.tracks[0]); c.id='k'+n; c.title='Часть '+n; c.sp='book'; c.albumId='999'; c.workId='ym:999'; c.workTitle='Третья книга'; c.idx=n; return c; }) };
          spBooks['ym:999'] = L; window.__K = L;
          var a = copyTrack(S.tracks[1]); a.id='before'; var z = copyTrack(S.tracks[2]); z.id='after';
          addMany([a]); playQueueItem(0); })()""")
        await pg.wait_for_timeout(300)
        await E("playNow(window.__K.tracks[2])"); await pg.wait_for_timeout(500)
        print('«Играть сейчас» у главы 3:', await E(ST))
        check('«Играть сейчас» у одной главы ставит всю книгу и играет эту главу', await E("queue.filter(function(v){return spKeyOf(v)==='ym:999';}).length") == 5 and await E("queue[current].id") == 'k3')
        await E("addToQueue(window.__K.tracks[0])"); await pg.wait_for_timeout(300)
        check('«В очередь» у главы книги, которая уже в очереди, — без второй копии', await E("queue.filter(function(v){return spKeyOf(v)==='ym:999';}).length") == 5)
        await E("var z = copyTrack(S.tracks[2]); z.id='after'; addMany([z])"); await pg.wait_for_timeout(200)
        await E("next()"); await pg.wait_for_timeout(400)
        print('«Дальше» из главы 3:', await E(ST))
        check('«Дальше» перескакивает через всю книгу', await E("queue[current].id") == 'after')
        check('пропущенная книга — отыгравшая (бледная, выше)', await E("!!document.querySelector('#queue .qbwrap.done')"))
        await E("prev()"); await pg.wait_for_timeout(400)
        print('«Назад» с трека после книги:', await E(ST))
        check('«Назад» возвращает книгу на её месте, с запомненной главы', await E("queue[current].id") == 'k3' and await E("queue.map(function(v){return v.id;}).join()") == 'before,k1,k2,k3,k4,k5,after')
        await E("prev()"); await pg.wait_for_timeout(400)
        check('«Назад» в начале главы — трек перед книгой, а не предыдущая глава', await E("queue[current].id") == 'before')
        print('ошибки:', [e for e in errs if 'urlStream' not in e])
        await b.close()
    if bad: raise SystemExit('провалено: ' + ', '.join(bad))
asyncio.run(main()); srv.terminate()
