import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8786','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Ф4: раздел «Состояние сервисов» должен показывать тот же список пунктов и те же
# лампочки, что чеклист быстрой проверки в поиске, а ниже — подробности по площадкам
# из глубокой проверки и кнопку «Проверить сейчас».
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':1200}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8786/app2/index.html')
        E=pg.evaluate
        # ждём, пока быстрая проверка закончится и список нарисуется
        # (wait_for_function не годится: CSP окна запрещает eval)
        ready = False
        for _ in range(60):
            if await E("!!(window.QC && !QC.running && QC.at && document.querySelector('#qcBox .qc-list'))"):
                ready = True
                break
            await pg.wait_for_timeout(100)
        assert ready, 'быстрая проверка не нарисовала список'
        await pg.wait_for_timeout(300)
        seq_js = "(function(sel){ return Array.from(document.querySelectorAll(sel + ' .qc-list .ck-g, ' + sel + ' .qc-list .ck-r')).map(function(x){ return x.className + '|' + x.textContent; }); })"
        check = await E(seq_js + "('#qcBox')")
        print('пунктов в чеклисте:', await E("document.querySelectorAll('#qcBox .qc-list .ck-r').length"))
        assert len(check) > 0, 'чеклист в поиске пуст'
        # открываем раздел «Состояние сервисов»
        await E("setTab('settings'); showSettingsPane('sHealth')"); await pg.wait_for_timeout(300)
        assert await E("!$('sHealth').hidden"), 'раздел «Состояние сервисов» не открылся'
        assert await E("!!document.querySelector('#healthBox .qc-list')"), 'в разделе нет списка проверок'
        health = await E(seq_js + "('#healthBox')")
        print('пунктов в разделе:', await E("document.querySelectorAll('#healthBox .qc-list .ck-r').length"))
        assert health == check, 'набор пунктов в разделе не совпал с чеклистом поиска'
        assert await E("document.querySelectorAll('#healthBox .qc-list .lamp').length > 0"), 'в разделе нет лампочек'
        # «Проверить сейчас» запускает глубокую проверку и обновляет быструю
        assert await E("$('hsRun').textContent.trim() === 'Проверить сейчас'"), 'нет кнопки «Проверить сейчас»'
        await pg.click('#hsRun'); await pg.wait_for_timeout(2200)
        print('подробностей по площадкам:', await E("document.querySelectorAll('#healthBox .hs-platform').length"))
        assert await E("window.__log.indexOf('healthRun') >= 0"), '«Проверить сейчас» не запустила глубокую проверку'
        assert await E("document.querySelectorAll('#healthBox .hs-platform').length >= 2"), 'нет подробностей по площадкам'
        assert await E("document.querySelectorAll('#healthBox .hs-platform .hs-step').length > 0"), 'нет шагов глубокой проверки'
        txt = await E("document.querySelector('#healthBox').textContent")
        assert 'Яндекс Музыка' in txt and 'YouTube' in txt, 'подробности не по площадкам'
        # список быстрой проверки остался сверху, подробности — ниже
        assert await E("(function(){var q=document.querySelector('#healthBox .qc-list'),p=document.querySelector('#healthBox .hs-platform'); return !!(q&&p&&(q.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING));})()"), 'подробности оказались выше списка'
        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: %s' % errs
        await b.close()
asyncio.run(main()); srv.terminate()
