# t52 — находки Ф1 и Ф5 в окне импорта плейлистов (IM):
# 1) «Собрать плейлист» — цветом акцента;
# 2) ссылка vk.com сразу открывает «Браузер» на vk.com/audios и подсвечивает «Собрать песни»;
# 3) список найденного — на всю высоту, «и ещё N» считается по высоте и пересчитывается при resize;
# 4) поле вставки и список с контуром и нормальной яркостью, после вставки «✓ Вставлено N строк»;
# 5) Telegram убран из описаний вкладок «Ссылка» и «Файл»;
# плюс выбор «Искать: Авто / только Яндекс / только YouTube» (Ф1).
import os, re, sys, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8804', '--bind', '127.0.0.1'],
                       cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

bad = []


def check(name, cond):
    print(('  ✓ ' if cond else '  ✗ ') + name)
    if not cond:
        bad.append(name)


# Поверх mock5: у «пользователя» Яндекс без Плюса (треки — отрывки),
# а ссылка приносит ровно 30 строк, чтобы проверить «и ещё N» по высоте.
MOCK = r"""
(function(){
  var a = window.app, P = function(x){ return new Promise(function(r){ setTimeout(function(){ r(x); }, 15); }); };
  a.ymStatus = function(){ return P({ loggedIn: true, name: 'tester', hasPlus: false }); };
  var items = [];
  for (var i = 1; i <= 30; i++) items.push({ line: 'Песня ' + i + ' — Исполнитель ' + i });
  a.importUrl = function(){ return P({ title: 'Список на 30', source: 'text', items: items }); };
})();
"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(script=MOCK)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8804/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # ===== 1. Кнопка «Собрать плейлист» — акцентная, id на месте =====
        await pg.click('#tabs [data-tab=my]')
        await pg.wait_for_timeout(500)
        await E("document.querySelector('#mySide [data-import]').click()")
        await pg.wait_for_timeout(300)
        check('кнопка «Собрать» имеет постоянный id impGo', await E("!!document.getElementById('impGo')"))
        check('поле вставки имеет постоянный id impPaste', await E("!!document.getElementById('impPaste')"))
        go = await E("(()=>{var el=document.getElementById('impGo');var d=document.createElement('div');d.style.background=getComputedStyle(document.documentElement).getPropertyValue('--ac').trim();document.body.appendChild(d);var ac=getComputedStyle(d).backgroundColor;d.remove();return {cls:el.className,bg:getComputedStyle(el).backgroundColor,ac:ac};})()")
        check('«Собрать плейлист» — класс акцентной кнопки и фон --ac: ' + str(go), 'acc' in go['cls'] and go['bg'] == go['ac'])

        # ===== Ф1. Выбор «Искать»: Авто по умолчанию, три варианта, запоминается =====
        labels = await E("Array.from(document.querySelectorAll('.imp-src button')).map(b=>b.textContent.trim())")
        check('выбор «Искать»: ' + ' | '.join(labels),
              len(labels) == 3 and labels[0].startswith('Авто') and 'Яндекс' in labels[1] and 'YouTube' in labels[2])
        check('по умолчанию выбран «Авто»',
              await E("document.querySelector('.imp-src [data-io=\"\"]').classList.contains('on')"))
        await pg.click('.imp-src [data-io=ym]')
        await pg.wait_for_timeout(100)
        check('выбор «только Яндекс» запомнен в настройках',
              any(x.startswith('set impOnly') and '"ym"' in x for x in await E("window.__log")))
        check('выбор «только Яндекс» подсвечен',
              await E("document.querySelector('.imp-src [data-io=ym]').classList.contains('on')"))

        # ===== 4. Поле вставки: контур и яркость; после вставки «✓ Вставлено N строк» =====
        field = await E("(()=>{var el=document.getElementById('impPaste');var d=document.createElement('div');d.style.color=getComputedStyle(document.documentElement).getPropertyValue('--tx').trim();document.body.appendChild(d);var tx=getComputedStyle(d).color;d.remove();var cs=getComputedStyle(el);return {bw:cs.borderTopWidth,color:cs.color,tx:tx};})()")
        check('у поля вставки заметный контур и текст цвета --tx: ' + str(field),
              field['bw'] not in ('0px', '') and field['color'] == field['tx'])
        await E("""(()=>{var t=document.getElementById('impPaste');
            t.value='Кино — Группа крови\\nКино — Кукушка\\nКино — Звезда по имени Солнце';
            t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));})()""")
        await pg.wait_for_timeout(150)
        ok = await E("(document.getElementById('impPasteOk')||{}).textContent")
        check('после вставки «✓ Вставлено 3 строки»: ' + str(ok), bool(ok) and 'Вставлено 3 строки' in ok)
        check('кнопка считает строки: ' + str(await E("document.getElementById('impGo').textContent")),
              '3 строки' in (await E("document.getElementById('impGo').textContent")))

        # ===== Ф1. Отрывки: пометка у строки и итог «N песен — только отрывки» =====
        await pg.click('#impGo')
        await pg.wait_for_timeout(1200)
        chips = await E("(document.querySelector('.imp-chips')||{}).textContent||''")
        check('итог «3 песни — только отрывки»: ' + chips, '3 песни — только отрывки' in chips)
        check('у строк пометка «отрывок 30 с»',
              'отрывок 30 с' in (await E("(document.querySelector('.imp-list')||{}).textContent||''")))

        # ===== 3. Список найденного — по высоте окна, «и ещё N» пересчитывается =====
        await pg.click('#impBack')
        await pg.wait_for_timeout(200)
        await E("document.querySelector('#myPl [data-it=url]').click()")
        await pg.wait_for_timeout(200)
        await pg.fill('#impUrl', 'https://www.youtube.com/watch?v=mix123')
        await pg.click('#impUrlGo')
        await pg.wait_for_timeout(500)
        rows900 = await E("document.querySelectorAll('#impPrev .o').length")
        txt900 = await E("(document.querySelector('#impPrev .o:last-child')||{}).textContent||''")
        check('список показывает не все 30 строк и «и ещё N»: ' + str(rows900) + ' / ' + txt900,
              rows900 < 30 and '… и ещё' in txt900)
        geom = await E("(()=>{var p=document.getElementById('impPrev').getBoundingClientRect();var s=document.getElementById('impSrcBox').getBoundingClientRect();var i=document.querySelector('#myPl .imp').getBoundingClientRect();var v=document.getElementById('viewMy').getBoundingClientRect();return {prevBottom:Math.round(p.bottom),srcBottom:Math.round(s.bottom),impBottom:Math.round(i.bottom),viewBottom:Math.round(v.bottom),srcH:Math.round(s.height)};})()")
        check('список тянется вниз до кнопок: ' + str(geom),
              geom['srcH'] > 200 and abs(geom['prevBottom'] - geom['srcBottom']) <= 2 and abs(geom['impBottom'] - geom['viewBottom']) <= 40)
        prev = await E("(()=>{var el=document.getElementById('impPrev');var d=document.createElement('div');d.style.color=getComputedStyle(document.documentElement).getPropertyValue('--tx2').trim();document.body.appendChild(d);var tx2=getComputedStyle(d).color;d.remove();var cs=getComputedStyle(el);return {bw:cs.borderTopWidth,color:cs.color,tx2:tx2};})()")
        check('у списка заметный контур и текст цвета --tx2: ' + str(prev),
              prev['bw'] not in ('0px', '') and prev['color'] == prev['tx2'])
        await pg.set_viewport_size({'width': 1440, 'height': 640})
        await pg.wait_for_timeout(450)
        rows640 = await E("document.querySelectorAll('#impPrev .o').length")
        txt640 = await E("(document.querySelector('#impPrev .o:last-child')||{}).textContent||''")
        n900 = int(re.search(r'(\d+)', txt900).group(1)) if re.search(r'(\d+)', txt900) else 0
        n640 = int(re.search(r'(\d+)', txt640).group(1)) if re.search(r'(\d+)', txt640) else 0
        check('при меньшем окне строк меньше, «и ещё» больше: ' + str(rows640) + ' / ' + txt640,
              rows640 < rows900 and n640 > n900)
        await pg.set_viewport_size({'width': 1440, 'height': 900})
        await pg.wait_for_timeout(300)

        # ===== 5. Telegram убран из описаний вкладок =====
        url_d = await E("document.querySelector('#myPl .imp-d').textContent")
        check('в описании вкладки «Ссылка» нет Telegram: ' + url_d,
              'Telegram' not in url_d and 't.me' not in url_d)
        await E("document.querySelector('#myPl [data-it=file]').click()")
        await pg.wait_for_timeout(200)
        file_d = await E("document.querySelector('#myPl .imp-d').textContent")
        check('в инструкции вкладки «Файл» нет Telegram и экспорта чата: ' + file_d,
              'Telegram' not in file_d and 'Экспорт истории' not in file_d)

        # ===== 2. Ссылка ВКонтакте сразу открывает «Браузер» на vk.com/audios =====
        await E("document.querySelector('#myPl [data-it=url]').click()")
        await pg.wait_for_timeout(200)
        await pg.fill('#impUrl', 'https://vk.com/audio-123_456')
        await pg.wait_for_timeout(400)
        check('вкладка переключилась на «Браузер»', await E("curTab") == 'browser')
        check('открыт именно vk.com/audios, а не конкретное аудио',
              await E("BR.cur") == 'web' and (await E("(BR.views.web||{}).getAttribute ? BR.views.web.getAttribute('src') : ''")) == 'https://vk.com/audios')
        check('«Собрать песни» подсвечена',
              await E("document.getElementById('brCollect').classList.contains('hl')") and
              await E("getComputedStyle(document.getElementById('brCollect')).boxShadow") != 'none')
        note = await E("(document.querySelector('#impSrcBox .imp-note')||{}).textContent||''")
        bad_note = await E("!!document.querySelector('#impSrcBox .imp-note.bad')")
        check('пояснение одной строкой, не ошибкой: ' + note,
              'ВКонтакте' in note and 'Собрать песни' in note and not bad_note)

        print('ошибки:', errs)
        check('нет ошибок страницы', not errs)
        await b.close()
    return not bad and not errs


ok = False
try:
    ok = asyncio.run(main())
finally:
    srv.terminate()
if not ok:
    print('✗ t49: не прошло проверок — ' + str(len(bad)))
    sys.exit(1)
print('t49: ок')
