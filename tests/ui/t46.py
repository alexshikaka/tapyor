import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from urllib.parse import urlparse
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8805','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# t45 — плеер YouTube вынесен на страницу другого адреса (P5c №1, B11).
# Проверяем: main-окно не исполняет чужой скрипт, страница плеера живёт на localhost,
# window.parent.app из неё недоступен, сообщения с чужого origin игнорируются,
# команды/события ходят через postMessage, и всё это на поддельном iframe_api.

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width':1440,'height':900})
        # Поддельный window.app — только для окна Тапёра. В кадр плеера его не пускаем:
        # там не должно быть ни моста окна, ни тестовых заглушек.
        mock = open('mock5.js', encoding='utf-8').read()
        await pg.add_init_script(script="if (location.pathname.indexOf('/ytplayer.html') < 0) {\n" + mock + "\n}")
        stub = open('ytstub.js', encoding='utf-8').read()
        async def yt_api(route):
            await route.fulfill(status=200, content_type='text/javascript', body=stub)
        await pg.route('**/iframe_api*', yt_api)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8805/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # 1. CSP главного окна: чужого скрипта больше нет, кадр — только с localhost.
        csp = await E("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")
        script = [x.strip() for x in csp.split(';') if x.strip().startswith('script-src')][0]
        frame = [x.strip() for x in csp.split(';') if x.strip().startswith('frame-src')][0]
        print('CSP окна:', script, '|', frame)
        assert 'youtube.com' not in script and 'ytimg.com' not in script, 'сторонний скрипт всё ещё разрешён'
        assert 'http://localhost:*' in frame and 'youtube.com' not in frame, 'iframe плеера должен быть с localhost'

        # 2. Запасной путь: поток YouTube не получен → встроенный плеер.
        await E("window.app.ytStream = function(id){ window.__log.push('ytStream fail ' + id); return Promise.resolve({ error: 'нет потока' }); }")
        await E("addToQueue({src:'yt', id:'v1', title:'Клип', author:'Кто-то', seconds:20})")
        for _ in range(40):
            if await E("!!document.querySelector('#ytFrame iframe') && !!(window.YX && YX.ready)"):
                break
            await pg.wait_for_timeout(100)
        print('режим:', await E("mode"), '| кадр:', await E("!!document.querySelector('#ytFrame iframe')"), '| готов:', await E("!!(window.YX && YX.ready)"))
        assert await E("mode") == 'iframe', 'нет перехода на встроенный плеер'
        assert await E("!!document.querySelector('#ytFrame iframe')"), 'нет iframe плеера'

        fr = next((f for f in pg.frames if 'ytplayer.html' in f.url), None)
        assert fr is not None, 'страница плеера не открылась'
        pu = urlparse(fr.url)
        print('адрес плеера:', pu.scheme, pu.hostname, pu.port, pu.path)
        assert pu.hostname == 'localhost' and pu.port == 8805, 'плеер должен быть с другого адреса (localhost)'
        assert await E("YX.origin") == 'http://localhost:8805', 'ожидаемый origin плеера'
        assert 'parent=' in fr.url, 'окно передало свой адрес странице плеера'

        # 3. Из страницы плеера нет моста окна: window.app отсутствует, parent.app — ошибка доступа.
        assert await fr.evaluate("typeof window.app") == 'undefined', 'в кадре плеера появился window.app'
        denied = await fr.evaluate("""() => {
          try { return { ok: true, app: typeof window.parent.app }; }
          catch (e) { return { ok: false, name: e.name }; }
        }""")
        print('parent.app из плеера:', denied)
        assert not denied['ok'] and denied['name'] == 'SecurityError', 'из плеера дотянулись до window.app'
        assert await fr.evaluate("typeof window.TapYtMsg.parseCmd") == 'function', 'на странице плеера нет проверки формата'

        # 4. Своя строгая CSP у страницы плеера.
        play_csp = await fr.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")
        print('CSP плеера:', play_csp)
        assert 'unsafe-inline' not in play_csp and 'unsafe-eval' not in play_csp, 'в CSP плеера unsafe-*'
        assert "default-src 'none'" in play_csp, 'в CSP плеера нет default-src none'
        assert 'https://www.youtube.com' in play_csp and 'https://s.ytimg.com' in play_csp, 'скрипт API не разрешён'
        assert 'frame-src https://www.youtube.com' in play_csp, 'кадр YouTube не разрешён'

        # 5. Плеер создан подделкой на странице плеера; окно видит его события.
        log = await fr.evaluate("window.__ytlog.slice()")
        print('поддельный YouTube:', log)
        assert any(x.startswith('create v1') for x in log), 'плеер не создан на странице плеера'
        assert any('origin=http://localhost:8805' in x for x in log), 'плеер создан с чужим origin'
        st = await E("({vid: YX.vid, state: YX.st, paused: ytx.paused, t: ytx.currentTime, dur: ytx.duration, rs: ytx.readyState})")
        print('состояние окна:', st)
        assert st['vid'] == 'v1' and st['state'] == 1 and not st['paused'] and st['dur'] == 6, 'события плеера не дошли'

        # 6. Громкость: та же формула curVol * _fade, что и у обычного элемента.
        for _ in range(20):
            if await fr.evaluate("window.__ytvol") is not None:
                break
            await pg.wait_for_timeout(100)
        want = await E("Math.round(parseFloat(document.getElementById('vol').value) / 100 * YX.fade * 100)")
        got = await fr.evaluate("window.__ytvol")
        print('громкость:', got, '| ждали:', want)
        assert got == want, 'громкость не ушла в плеер'
        await E("var ve=document.getElementById('vol'); ve.value=40; ve.dispatchEvent(new Event('input'))")
        await pg.wait_for_timeout(300)
        assert await fr.evaluate("window.__ytvol") == 40, 'ползунок не управляет плеером'

        # 7. Пауза, перемотка, продолжение — команды postMessage.
        await pg.wait_for_timeout(700)
        t0 = await E("ytx.currentTime")
        print('идёт время:', t0)
        assert t0 > 0, 'время не идёт'
        await E("ytx.pause()")
        await pg.wait_for_timeout(250)
        assert await E("ytx.paused") is True, 'пауза не дошла'
        assert await fr.evaluate("window.__ytplayer ? true : false"), 'нет доступа к подделке'
        await E("ytx.currentTime = 2")
        await pg.wait_for_timeout(250)
        print('после перемотки:', await E("ytx.currentTime"), await fr.evaluate("window.__ytlog.slice(-3)"))
        assert abs(await E("ytx.currentTime") - 2) < 0.6, 'перемотка не дошла'
        await E("ytx.play()")
        await pg.wait_for_timeout(300)
        assert await E("YX.st") == 1, 'продолжение не дошло'

        # 8. Следующий трек — тем же мостом.
        await E("ytxLoad('v2')")
        await pg.wait_for_timeout(400)
        assert await E("YX.vid") == 'v2', 'второй трек не загрузился'
        assert any(x.startswith('load v2') for x in await fr.evaluate("window.__ytlog.slice()")), 'команда load не дошла'

        # 9. Сообщение с чужого origin игнорируется обеими сторонами.
        st_before = await E("YX.st")
        fake = await E("""() => {
          var fr = document.querySelector('#ytFrame iframe');
          var ended = 0;
          function onEnd(){ ended++; }
          ytx.addEventListener('ended', onEnd);
          window.dispatchEvent(new MessageEvent('message', {
            data: { t: 1, dir: 'evt', type: 'state', value: 0 },
            origin: 'https://evil.example', source: fr.contentWindow
          }));
          var st = YX.st; ytx.removeEventListener('ended', onEnd);
          return { st: st, ended: ended };
        }""")
        print('чужое событие в окно:', fake, '| было состояние:', st_before)
        assert fake['st'] == st_before and fake['ended'] == 0, 'окно поверило событию с чужого origin'
        vol_before = await fr.evaluate("window.__ytvol")
        n_before = len(await fr.evaluate("window.__ytlog.slice()"))
        vol_after = await fr.evaluate("""() => {
          window.dispatchEvent(new MessageEvent('message', {
            data: { t: 1, dir: 'cmd', type: 'volume', value: 5 },
            origin: 'https://evil.example', source: window.parent
          }));
          return window.__ytvol;
        }""")
        n_after = len(await fr.evaluate("window.__ytlog.slice()"))
        print('чужое событие в плеер:', vol_before, '→', vol_after)
        assert vol_after == vol_before and n_after == n_before, 'плеер поверил команде с чужого origin'

        # 10. Остановка убирает кадр.
        await E("ytxStop()")
        await pg.wait_for_timeout(150)
        assert not await E("!!document.querySelector('#ytFrame iframe')"), 'iframe плеера не убран'
        assert await E("document.getElementById('ytFrame').hidden") is True, 'кадр не скрыт'

        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: %s' % errs
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
