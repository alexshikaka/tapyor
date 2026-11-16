import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','rangeserver.py','8805'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# t28 (26.10) — визуализатор: трек без картинки — обложка + столбики; есть картинка — нет столбиков; пауза — гаснут
#        и перестают рисоваться; захват звука окна (подменён генератором) двигает столбики; кнопка «на весь экран»
def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        # «захват своего окна» в Тапёре — здесь звук генератора
        await pg.add_init_script(script="""window.__arms=0; window.app.vizArm=function(){ window.__arms++; return Promise.resolve(true); };
          navigator.mediaDevices.getDisplayMedia=function(){ var c=new AudioContext(), o=c.createOscillator(), d=c.createMediaStreamDestination(); o.type='sawtooth'; o.frequency.value=220; o.connect(d); o.start();
            var cv=document.createElement('canvas'); var vs=cv.captureStream(1); var st=new MediaStream(d.stream.getAudioTracks().concat(vs.getVideoTracks())); return Promise.resolve(st); };""")
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8805/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        await E("document.body.classList.remove('calm')")
        await E("playNow({src:'ym', id:'V1', albumId:'1', title:'Звук без картинки', author:'Кино', duration:'0:33', seconds:33, thumb:''})"); await pg.wait_for_timeout(1500)
        await E("document.body.classList.remove('calm'); vizKick()"); await pg.wait_for_timeout(900)
        ok(await E("mode==='audio' && !document.getElementById('viz').hidden"), 'только звук → визуализатор виден')
        ok(await E("window.__arms===1 && !!VZ.cap"), 'захват звука окна запрошен один раз')
        lit = await E("(()=>{ var c=document.getElementById('vizCv'), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data, n=0; for (var i=3;i<d.length;i+=4) if (d[i]>0) n++; return n; })()")
        ok(lit > 500, 'столбики нарисованы (%d точек)' % lit)
        hs = await E("VZ.bars.slice(0,6).map(x=>+x.toFixed(2))"); ok(max(hs) > 0.2, 'столбики двигаются от звука: %s' % hs)
        # цвет столбиков: обложка / акцент / градиент; в оболочке без скруглений — прямые углы
        await E("vizSetColor('#20C060')")
        PX = "(()=>{ var c=document.getElementById('vizCv'), g=c.getContext('2d'); var col=Math.floor(c.width*0.1); var top=-1,bot=-1; for (var y=0;y<c.height;y++){ var d=g.getImageData(col,y,1,1).data; if(d[3]>0){ if(top<0) top=y; bot=y; } } var a=g.getImageData(col,top+2,1,1).data, b=g.getImageData(col,bot-1,1,1).data; return [Array.from(a).slice(0,3), Array.from(b).slice(0,3)]; })()"
        await E("vizColorSet('cover', true); VZ.bars=VZ.bars.map(()=>0.9); vizDraw()"); c1 = await E(PX)
        await E("vizColorSet('accent', true); VZ.bars=VZ.bars.map(()=>0.9); vizDraw()"); c2 = await E(PX)
        await E("vizColorSet('grad', true); VZ.bars=VZ.bars.map(()=>0.9); vizDraw()"); c3 = await E(PX)
        ok(c1[0][1] > c1[0][0] and c2[0] != c1[0], 'обложка (зелёный) и акцент — разные цвета: %s %s' % (c1[0], c2[0]))
        ok(c3[0] != c3[1], 'градиент: верх и низ разного цвета: %s → %s' % (c3[0], c3[1]))
        ok(await E("A.getSetting('vizColor')") == 'grad', 'выбор цвета сохранён')
        await E("applySkin('dos'); VST.at=0; vizStyle()"); ok(await E("VST.round") is False, 'DOS: столбики без скруглений')
        await E("applySkin(''); VST.at=0; vizStyle()"); ok(await E("VST.round") is True, 'стандарт: скругления есть')
        # окно в фоне — не рисуем
        await E("document.body.classList.add('calm')"); await pg.wait_for_timeout(200)
        f0 = await E("VZ.last"); await pg.wait_for_timeout(600); f1 = await E("VZ.last")
        ok(f0 == f1, 'окно в фоне — кадры не рисуются')
        await E("document.body.classList.remove('calm'); vizKick()")
        # пауза — опускаются и замирают
        await E("master().pause()"); await pg.wait_for_timeout(2500)
        ok(await E("VZ.bars.every(x=>x<0.01) && !VZ.raf"), 'пауза — столбики опустились, рисование остановлено')
        # на весь экран
        await pg.hover('#vidBox'); await pg.click('#vidFs'); await pg.wait_for_timeout(500)
        fs = await E("document.fullscreenElement && document.fullscreenElement.id")
        ok(fs == 'vidBox', 'кнопка «на весь экран» работает')
        ok(await E("document.getElementById('vfsT').textContent") == 'Звук без картинки', 'в полном экране — название трека')
        await E("document.exitFullscreen()"); await pg.wait_for_timeout(400)
        ok(await E("!document.fullscreenElement && !document.getElementById('vidBox').classList.contains('vfs')"), 'выход из полного экрана')
        # трек с картинкой — без столбиков
        await E("window.app.ytStream=function(id){ return Promise.resolve({ videoUrl:'/vid.webm', audioUrl:'/loud.wav' }); }")
        await E("playNow({src:'yt', id:'v1', title:'Клип', author:'Кто-то', seconds:20})"); await pg.wait_for_timeout(1500)
        ok(await E("mode==='split' && document.getElementById('viz').hidden"), 'видео с картинкой → визуализатора нет')
        print('ошибки:', errs); ok(not errs, 'без ошибок')
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
