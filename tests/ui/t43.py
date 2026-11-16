import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8798','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# R3: ловим состояние обновления из главного процесса и считаем вызовы кнопки «Перезапустить сейчас»
PATCH = """
window.__upd = null; window.__dl = 0;
window.app.onUpdateState = function(cb){ window.__upd = cb; };
window.app.updateDownload = function(){ window.__dl++; return Promise.resolve(true); };
"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':1000})
        await pg.add_init_script(path='mock5.js'); await pg.add_init_script(PATCH)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8798/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        # 1) состояние «скачано, поставится при выходе» — текст и кнопка
        await E("window.__upd({ state: 'ready', version: '9.9.9', onQuit: true, channel: 'stable' })")
        await pg.wait_for_timeout(150)
        hdr = await E("$('updArea').innerText")
        btn = await E("($('updGo')||{}).textContent || ''")
        print('шапка:', hdr.replace('\n', ' | '))
        print('кнопка:', btn)
        await pg.screenshot(path='q_upd_ready.png')
        assert '9.9.9' in hdr, 'в шапке нет версии'
        assert 'готово' in hdr and 'закроете Тапёр' in hdr, 'нет текста про закрытие: ' + hdr
        assert 'музыка остановится' not in hdr, 'остался старый текст про паузу'
        assert btn.strip() == 'Перезапустить сейчас', 'кнопка не та: ' + btn
        # 2) нажатие зовёт тот же метод моста, что и раньше (A.updateDownload)
        await pg.click('#updGo'); await pg.wait_for_timeout(150)
        calls = await E("window.__dl")
        print('вызовов установки:', calls)
        assert calls == 1, 'кнопка не позвала мост updateDownload: ' + str(calls)
        # 3) старый вид «скачано, ждём паузы» без onQuit не сломан
        await E("window.__upd({ state: 'ready', version: '9.9.8', channel: 'stable' })")
        await pg.wait_for_timeout(150)
        hdr2 = await E("$('updArea').innerText")
        btn2 = await E("($('updGo')||{}).textContent || ''")
        print('шапка без onQuit:', hdr2.replace('\n', ' | '), '| кнопка:', btn2)
        assert 'музыка остановится' in hdr2, 'сломан старый вид ready: ' + hdr2
        assert btn2.strip() == 'Обновить сейчас', 'кнопка старого вида не та: ' + btn2
        # 4) текст в настройках
        setTxt = await E("$('setUpdText').textContent")
        await E("window.__upd({ state: 'ready', version: '9.9.9', onQuit: true, channel: 'stable' })")
        await pg.wait_for_timeout(150)
        setTxt = await E("$('setUpdText').textContent")
        print('настройки:', setTxt)
        assert 'закроете Тапёр' in setTxt, 'в настройках старый текст: ' + setTxt
        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: ' + str(errs)
        await b.close()
try:
    asyncio.run(main())
except AssertionError as e:
    print('✗', e)
    srv.terminate(); sys.exit(1)
srv.terminate()
