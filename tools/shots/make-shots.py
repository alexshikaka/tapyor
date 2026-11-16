#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Свежие снимки Тапёра 0.37 для сайта, README и инструкции Streamer.bot.

Настоящую программу не запускаем: открываем src/index.html в Chromium (Playwright) с поддельным
window.app — как tests/ui (mock5.js + mock_req.js), но со своими выдуманными данными
(tools/shots/shots-data.js) и своим портом. Обложки — градиенты data-URI, звук — тишина
нужной длины, которую отдаёт этот же сервер. Сеть не нужна.

Окно 1280×800, device_scale_factor 2. Визард — 380×800 (такой ширины его окно в программе).

Запуск (нужны python3 и playwright с Chromium; параллельно с UI-тестами не запускать — общий браузер):
    python3 tools/shots/make-shots.py
Только часть снимков:
    ... python3 tools/shots/make-shots.py --only search,orders
Только Streamer.bot (пишет в docs/img/streamerbot, чтобы не трогать снимки сайта):
    ... python3 tools/shots/make-shots.py --only sb
"""
import argparse
import asyncio
import json
import os
import re
import struct
import subprocess
import sys
import threading
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
SHOTS_DIR = Path(__file__).resolve().parent
UI_DIR = ROOT / "tests" / "ui"
OUT_DIR = ROOT / "public" / "docs" / "img"
SBOT_OUT = ROOT / "docs" / "img" / "streamerbot"
PORT = int(os.environ.get("TAPYOR_SHOTS_PORT", "8847"))
URL = "http://127.0.0.1:%d/src/index.html" % PORT
WIZARD_URL = "http://127.0.0.1:%d/src/wizard/index.html" % PORT
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"  # как в tests/ui/*.py
VIEW_MAIN = {"width": 1280, "height": 800}
VIEW_WIZ = {"width": 380, "height": 800}          # окно визарда в программе: 380 × высота главного
SCALE = 2

# ── Сервер: файлы репозитория + тишина нужной длины (звук «играет» по-настоящему) ──────────
_AUDIO = {}


def wav_bytes(seconds):
    """Тихий WAV 8 кГц, 8 бит, моно — ровно столько секунд, сколько длится трек."""
    seconds = max(1, min(900, int(seconds or 230)))
    if seconds in _AUDIO:
        return _AUDIO[seconds]
    rate, bits = 8000, 8
    data = b"\x80" * (rate * seconds)          # 0x80 = тишина в 8-битном PCM
    header = (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt "
              + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate, bits // 8, bits)
              + b"data" + struct.pack("<I", len(data)))
    _AUDIO[seconds] = header + data
    return _AUDIO[seconds]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/__shots/audio"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                sec = int((q.get("sec") or ["230"])[0])
            except ValueError:
                sec = 230
            body = wav_bytes(sec)
            total = len(body)
            start, end = 0, total - 1
            status = 200
            # Chromium перематывает только то, что умеет отдавать кусками: без 206 он
            # сбрасывает currentTime в 0, и на снимке прогресс был бы нулевым.
            rng = self.headers.get("Range")
            if rng:
                m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
                if m:
                    if m.group(1):
                        start = int(m.group(1))
                        if m.group(2):
                            end = min(total - 1, int(m.group(2)))
                    elif m.group(2):
                        start = max(0, total - int(m.group(2)))
                    if start >= total:
                        self.send_response(416)
                        self.send_header("Content-Range", "bytes */%d" % total)
                        self.end_headers()
                        return
                    status = 206
            chunk = body[start:end + 1]
            self.send_response(status)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(chunk)))
            if status == 206:
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, total))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(chunk)
            return
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()


# ── Подставная страница оверлея (её показывает превью в настройках) ─────────────────────────
OVERLAY_PREVIEW_HTML = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><style>
html,body{margin:0;width:1920px;height:1080px;background:transparent;overflow:hidden}
body{font-family:'Courier New',ui-monospace,monospace;color:#8CF28C}
.wrap{position:absolute;left:80px;bottom:70px;width:860px;padding:26px 30px;
  background:rgba(2,8,4,.78);border:3px solid #8CF28C;display:flex;gap:30px}
.cover{width:300px;height:300px;flex:none;border:3px solid #8CF28C;
  background:linear-gradient(135deg,#C05A38,#4A1A18)}
.right{flex:1 1 auto;min-width:0}
.lbl{font-size:24px;letter-spacing:4px;opacity:.75}
.title{font-size:46px;line-height:1.1;margin:6px 0 2px;color:#F2FFE8;white-space:nowrap}
.artist{font-size:30px;opacity:.9}
.bar{height:12px;margin-top:22px;border:1px solid #8CF28C;background:#0B1A10}
.bar i{display:block;height:100%;width:42%;background:#8CF28C}
.tm{display:flex;justify-content:space-between;font-size:22px;margin-top:6px}
.next{margin-top:20px;font-size:23px;line-height:1.55;opacity:.82}
</style></head><body>
<div class="wrap">
  <div class="cover"></div>
  <div class="right">
    <div class="lbl">СЕЙЧАС ИГРАЕТ</div>
    <div class="title">Группа крови</div>
    <div class="artist">Кино</div>
    <div class="bar"><i></i></div>
    <div class="tm"><span>01:40</span><span>03:58</span></div>
    <div class="next">1. Get Lucky — Daft Punk<br>2. Dreams — Fleetwood Mac<br>3. Выхода нет — Сплин</div>
  </div>
</div></body></html>"""


# ── Окно визарда: узкий мост и подставные ответы главного окна ───────────────────────────────
WIZARD_BRIDGE = r"""
window.__wcalls = [];
window.__winit = null;
window.wizardApi = {
  cmd: function (p) {
    window.__wcalls.push(p);
    if (p && p.op === 'do' && p.name === 'wz4DonState') {
      setTimeout(function () {
        if (window.__winit) window.__winit({ type: 'donState',
          da: { connected: true, name: 'Демо' }, dp: { connected: false },
          price: 150, currency: 'RUB' });
      }, 30);
    }
  },
  close: function () {},
  onEvent: function (fn) { window.__winit = fn; }
};
"""

NO_DEV_JS = """
(function(){
  var tag = document.getElementById('buildTag');
  var ver = document.getElementById('ver');
  return { buildTagHidden: !tag || tag.hidden, buildTag: tag ? tag.textContent : '',
           version: ver ? ver.textContent : '', tab: document.body.dataset.tab };
})()
"""


def log(msg):
    print(msg, flush=True)


def start_server():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def new_page(browser, scripts, viewport, overlay_route=False):
    ctx = await browser.new_context(viewport=viewport, device_scale_factor=SCALE)
    pg = await ctx.new_page()
    for p in scripts:
        await pg.add_init_script(path=str(p))
    errs = []

    def on_err(e):
        errs.append("pageerror: " + str(e))

    def on_console(m):
        if m.type == "error":
            errs.append("console: " + m.text)

    pg.on("pageerror", on_err)
    pg.on("console", on_console)
    if overlay_route:
        async def fulfill(route):
            await route.fulfill(status=200, content_type="text/html; charset=utf-8",
                                body=OVERLAY_PREVIEW_HTML)
        await pg.route("**/overlay/playlist*", fulfill)
    return ctx, pg, errs


def base_scripts():
    return [UI_DIR / "mock5.js", UI_DIR / "mock_req.js", SHOTS_DIR / "shots-data.js"]


async def open_main(browser, extra=(), overlay=False):
    ctx, pg, errs = await new_page(browser, base_scripts() + list(extra), VIEW_MAIN,
                                   overlay_route=overlay)
    await pg.goto(URL)
    await pg.wait_for_timeout(1100)
    return ctx, pg, errs


async def wait_playing(pg, timeout=8000):
    try:
        await pg.wait_for_function(
            "() => { var m = master(); return !!m && m.readyState >= 1 && !m.paused && m.duration > 1; }",
            timeout=timeout)
        return True
    except Exception:
        return False


async def apply_theme(pg, theme_id):
    await pg.evaluate("applyTheme(%s, false)" % json.dumps(theme_id))
    await pg.wait_for_timeout(320)


async def seek_show(pg, frac):
    ok = await pg.evaluate("SHOTS.seek(%s)" % json.dumps(frac))
    await pg.wait_for_timeout(350)
    info = await pg.evaluate(
        "(function(){ var m = master(); return { t: m.currentTime || 0, d: m.duration || 0, p: !!m.paused }; })()")
    log("  звук: %s, позиция %d / %d c%s" % (
        "идёт" if info["p"] is False else "пауза", round(info["t"]), round(info["d"]),
        "" if ok else " (перемотка не удалась)"))
    return ok


async def do_search(pg, query="Кино"):
    await pg.fill("#search", query)
    await pg.press("#search", "Enter")
    await pg.wait_for_timeout(1600)


async def shot(pg, out_dir, name):
    path = Path(out_dir) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    await pg.screenshot(path=str(path))
    log("  ✓ %s" % name)


async def scene_search_screens(browser, out_dir, only):
    """search.png + все темы + все оболочки — один и тот же экран поиска."""
    ctx, pg, errs = await open_main(browser)
    try:
        await do_search(pg)
        await pg.evaluate("SHOTS.seed(SHOTS.queueSearch, 0)")
        await wait_playing(pg)
        await seek_show(pg, 0.42)

        info = await pg.evaluate(NO_DEV_JS)
        log("  шапка: %s | %s | раздел: %s" % (info["version"], "метки сборки нет" if info["buildTagHidden"] else "МЕТКА " + info["buildTag"], info["tab"]))

        themes = await pg.evaluate(
            "TapTheme.builtinList().map(function(t){ return [t.id, t.name, t.sub]; })")
        skins = await pg.evaluate("SKINS.map(function(s){ return [s.id, s.name]; })")
        rows = await pg.evaluate("document.querySelectorAll('#results .tarea .row').length")
        log("  в выдаче строк: %d" % rows)

        if "search" in only:
            await shot(pg, out_dir, "search.png")

        if "themes" in only:
            for tid, name, sub in themes:
                await apply_theme(pg, tid)
                await shot(pg, out_dir, "themes-%s.png" % tid)
            await apply_theme(pg, "dark")

        if "shells" in only:
            for sid, name in skins:
                await pg.evaluate("applySkin(%s, false)" % json.dumps(sid))
                await pg.wait_for_timeout(700)   # шрифты оболочки успевают загрузиться
                await shot(pg, out_dir, "shell-%s.png" % sid)

        log("  темы (id → название): " + ", ".join("%s → %s, %s" % (t[0], t[1], t[2]) for t in themes))
        log("  оболочки (id → название): " + ", ".join("%s → %s" % (s[0], s[1]) for s in skins))
        return {"themes": themes, "skins": skins, "errors": errs}
    finally:
        await ctx.close()


async def scene_orders(browser, out_dir):
    ctx, pg, errs = await open_main(browser)
    try:
        await pg.evaluate("SHOTS.feedRequests()")
        await pg.wait_for_timeout(250)
        await pg.evaluate("setTab('req')")
        await pg.wait_for_timeout(300)
        # Строка «какой сервис донатов на связи» — тот же ответ моста, что и в настройках.
        await pg.evaluate("A.donStatus().then(function(s){ RQ.don = s; rqSvcLine(); })")
        await pg.wait_for_timeout(200)
        await pg.evaluate("SHOTS.seed(SHOTS.queueOrders, 0)")
        await wait_playing(pg)
        await seek_show(pg, 0.35)
        # Видео-карточку поджимаем: на снимке должна быть видна живая очередь (4–5 строк), а не она одна.
        await pg.evaluate("setVH(120)")
        await pg.wait_for_timeout(300)
        log("  заказов в списке: %s" % await pg.evaluate("RQ.list.length"))
        await shot(pg, out_dir, "orders.png")
        return {"errors": errs}
    finally:
        await ctx.close()


async def scene_queue(browser, out_dir):
    """Длинная живая очередь и «Моя волна» — главное окно, вкладка «Волна»."""
    ctx, pg, errs = await open_main(browser)
    try:
        await pg.evaluate("SHOTS.seed(SHOTS.queueLong, 2)")
        await wait_playing(pg)
        await seek_show(pg, 0.28)
        # Видео-карточка минимальной высоты: иначе в колонке видно две строки, а нужна длинная очередь.
        await pg.evaluate("setVH(90)")
        await pg.evaluate("setTab('wave')")
        await pg.wait_for_timeout(700)
        log("  в очереди: %s (%s впереди)" % (
            await pg.evaluate("queue.length"), await pg.evaluate("queue.filter(function(v){return !v.played}).length")))
        await shot(pg, out_dir, "queue.png")
        return {"errors": errs}
    finally:
        await ctx.close()


async def scene_wizard(browser, out_dir):
    out = {}
    for route, step, name in (("listener", "fork", "wizard.png"),
                              ("streamer", "donations", "wizard-donations.png")):
        ctx, pg, errs = await new_page(browser, [ROOT / "src" / "theme.js"], VIEW_WIZ)
        try:
            # мост должен быть до wizard.js — добавляем отдельным init-скриптом
            await pg.add_init_script(script=WIZARD_BRIDGE)
            await pg.goto("%s?route=%s&step=%s" % (WIZARD_URL, route, step))
            await pg.wait_for_timeout(220)
            # Тему главное окно присылает готовыми CSS-переменными; в окно визарда app.css не загружен,
            # поэтому берём их из theme.js и дополняем тем, что живёт в :root (скругления, наведение, цвета).
            built = await pg.evaluate("TapTheme.build(TapTheme.builtinTheme('dark'))")
            vars_ = {"--" + k: v for k, v in built.items()}
            vars_.update({
                "--hov": "rgba(255,255,255,.05)", "--hov2": "rgba(255,255,255,.07)",
                "--ok": "#4ADE9A", "--warn": "#FFB84D",
                "--r-panel": "20px", "--r-card": "14px", "--r-ctl": "10px",
            })
            payload = {"type": "theme", "theme": {
                "className": "theme-dark", "vars": vars_,
                "font": "'Onest', 'Segoe UI', system-ui, sans-serif", "fontSize": "14px"}}
            await pg.evaluate("window.__winit && window.__winit(" + json.dumps(payload, ensure_ascii=False) + ")")
            await pg.wait_for_timeout(1000)
            title = await pg.evaluate("document.getElementById('wizTitle').textContent")
            log("  визард: %s — «%s»" % (name, title))
            await shot(pg, out_dir, name)
            out[name] = errs
        finally:
            await ctx.close()
    return out


async def scene_overlay(browser, out_dir):
    ctx, pg, errs = await open_main(browser, extra=[SHOTS_DIR / "shots-overlay.js"], overlay=True)
    try:
        # Пусть внизу играет трек — иначе снимок настроек выглядит как «ничего не играет».
        await pg.evaluate("SHOTS.seed(SHOTS.queueOrders, 0)")
        await wait_playing(pg)
        await seek_show(pg, 0.3)
        await pg.evaluate("setTab('settings'); showSettingsPane('sOverlay'); ovLoad();")
        await pg.wait_for_timeout(1500)
        styles = await pg.evaluate("document.querySelectorAll('#ovCtl .ov-style').length")
        log("  стилей в настройках: %s" % styles)
        # Блок превью «прилипает» к верху и занимает почти весь экран. Прокручиваем так,
        # чтобы карточка «Стиль» со списком стилей встала сразу под ним (иначе её не видно).
        pos = await pg.evaluate("""(function(){
            var main = document.querySelector('.set-main');
            var prev = document.getElementById('ovScreen');
            var sec = document.querySelector('#ovCtl .bot-sec');
            var side = document.querySelector('.set-side');
            var item = document.getElementById('goOverlay');
            if (!main || !prev || !sec) return null;
            var mainTop = main.getBoundingClientRect().top;
            var ph = prev.getBoundingClientRect().height;
            var now = sec.getBoundingClientRect().top - mainTop;
            main.scrollTop = Math.max(0, main.scrollTop + now - ph - 4);
            if (side && item) side.scrollTop = item.offsetTop - side.clientHeight / 2 + item.offsetHeight / 2;
            return { scroll: Math.round(main.scrollTop), previewH: Math.round(ph),
                     secTop: Math.round(sec.getBoundingClientRect().top - mainTop),
                     prevBottom: Math.round(prev.getBoundingClientRect().bottom - mainTop),
                     side: side ? Math.round(side.scrollTop) : null };
        })()""")
        log("  прокрутка настроек: %s" % pos)
        await pg.wait_for_timeout(500)
        await shot(pg, out_dir, "overlay-settings.png")
        return {"styles": styles, "errors": errs}
    finally:
        await ctx.close()


async def open_sbot(browser):
    """Главное окно на экране «Настройки → Стримерам → Streamer.bot»."""
    ctx, pg, errs = await open_main(browser)
    await pg.evaluate("sbOpen()")
    await pg.wait_for_timeout(850)
    return ctx, pg, errs


async def scroll_settings_to(pg, needle):
    """Поставить секцию настроек с текстом needle к верху области прокрутки."""
    pos = await pg.evaluate("""(needle) => {
        var main = document.querySelector('.set-main');
        if (!main) return null;
        var secs = Array.prototype.slice.call(main.querySelectorAll('.bot-sec'));
        var sec = secs.filter(function (s) { return s.textContent.indexOf(needle) >= 0; })[0];
        if (!sec) return null;
        var top = sec.getBoundingClientRect().top - main.getBoundingClientRect().top;
        main.scrollTop = Math.max(0, main.scrollTop + top - 10);
        return { scroll: Math.round(main.scrollTop), top: Math.round(top) };
    }""", needle)
    await pg.wait_for_timeout(350)
    log("  прокрутка к «%s»: %s" % (needle, pos))
    return pos


async def scene_sbot_connect(browser, out_dir):
    ctx, pg, errs = await open_sbot(browser)
    try:
        # 1280×800 ниже прежних 1440×1000: чуть прокручиваем, чтобы в кадр попали
        # и строка связи, и Twitch, и пароль с «подключено».
        await pg.evaluate("document.querySelector('.set-main').scrollTop=72")
        await pg.wait_for_timeout(250)
        info = await pg.evaluate(NO_DEV_JS)
        state = await pg.evaluate("""(function(){
            var q = function (s) { return (document.querySelector(s) || {}).textContent || ''; };
            return { head: q('#sbHeadText'), pill: q('#sbHeadPill'),
                     twitch: q('#sbTwitchPill'), bot: q('#sbBotPill'),
                     password: (document.getElementById('sbPassword') || {}).placeholder || '',
                     conn: q('#sbConnPill') };
        })()""")
        log("  шапка: %s | %s | раздел: %s" % (
            info["version"], "метки сборки нет" if info["buildTagHidden"] else "МЕТКА " + info["buildTag"],
            info["tab"]))
        log("  связь: «%s» · %s · %s · %s · пароль: %s" % (
            state["pill"], state["head"], state["conn"], state["twitch"], state["password"]))
        await shot(pg, out_dir, "sb-01-connect.png")

        await scroll_settings_to(pg, "Шаг 2. Добавь шаблон Тапёра")
        conn = await pg.evaluate("(document.getElementById('sbConn') || {}).innerText || ''")
        if "Скопировать шаблон" not in conn or "найден · v1" not in conn:
            log("  ВНИМАНИЕ: на экране нет кнопки шаблона или строки «найден · v1»")
        await shot(pg, out_dir, "sb-02-copy-template.png")
        return {"errors": errs}
    finally:
        await ctx.close()


async def scene_sbot_kit(browser, out_dir):
    ctx, pg, errs = await open_sbot(browser)
    try:
        await pg.evaluate("sbSetTab('kit')")
        await pg.wait_for_timeout(350)
        # Вкладки остаются видны, а карточка команд целиком влезает над панелью записи.
        await pg.evaluate("document.querySelector('.set-main').scrollTop=165")
        await pg.wait_for_timeout(200)
        kit = await pg.evaluate("(document.getElementById('sbKit') || {}).innerText || ''")
        log("  конструктор: !sr=%s, !play=%s, лимиты=%s, награда=%s" % (
            "!sr" in kit, "!play" in kit, "Кто и сколько" in kit, "Заказать песню" in kit))
        await shot(pg, out_dir, "sb-03-kit.png")

        await pg.evaluate("sbSave()")
        await pg.wait_for_timeout(700)
        # После записи показываем нижнюю часть конструктора: лимиты и награду,
        # которые тоже записались. Сообщение об успехе остаётся внизу кадра.
        await pg.evaluate("document.querySelector('.set-main').scrollTop=1100")
        await pg.wait_for_timeout(150)
        toast = await pg.evaluate("(document.getElementById('toast') || {}).textContent || ''")
        log("  после записи: %s" % (toast or "тоста нет"))
        await shot(pg, out_dir, "sb-04-kit-written.png")
        return {"errors": errs}
    finally:
        await ctx.close()


async def scene_sbot_api(browser, out_dir):
    ctx, pg, errs = await open_sbot(browser)
    try:
        await pg.evaluate("sbSetTab('api')")
        await pg.wait_for_timeout(350)
        await pg.evaluate("document.querySelector('.set-main').scrollTop=0")
        await pg.wait_for_timeout(200)
        api = await pg.evaluate("(document.getElementById('sbApi') || {}).innerText || ''")
        log("  ссылки: /sb/order=%s, /sb/control=%s, ключ точками=%s" % (
            "/sb/order" in api, "/sb/control" in api, "tp_••••••••••••" in api or "tp_************" in api))
        await scroll_settings_to(pg, "Ссылки — Streamer.bot спрашивает Тапёр")
        await shot(pg, out_dir, "sb-05-api.png")

        await scroll_settings_to(pg, "Триггеры — Тапёр сообщает Streamer.bot")
        await pg.click("#sbApi [data-sbtrig]")
        await pg.wait_for_timeout(300)
        trig = await pg.evaluate("(document.getElementById('toast') || {}).textContent || ''")
        log("  результат проверки триггера: %s" % (trig or "тоста нет"))
        await shot(pg, out_dir, "sb-06-trigger.png")
        return {"errors": errs}
    finally:
        await ctx.close()


async def scene_sbot_order(browser, out_dir):
    ctx, pg, errs = await open_main(browser)
    try:
        await pg.evaluate("SHOTS.seed(SHOTS.queueSbot, 0)")
        await wait_playing(pg)
        await seek_show(pg, 0.32)
        await pg.evaluate("setVH(130); setTab('wave')")
        await pg.wait_for_timeout(700)
        cur = await pg.evaluate("(function(){ var v = queue[current] || {}; return { title:v.title, author:v.author, who:(v.req||{}).who, key:(v.req||{}).key, n:queue.length }; })()")
        log("  играет: %s — %s · заказал %s (%s), в очереди %s" % (
            cur["author"], cur["title"], cur["who"], cur["key"], cur["n"]))
        await shot(pg, out_dir, "sb-07-order-playing.png")
        return {"errors": errs}
    finally:
        await ctx.close()


async def scene_sbot_switch(browser, out_dir):
    ctx, pg, errs = await open_main(browser)
    try:
        await pg.evaluate("setTab('settings'); showSettingsPane('sBot'); botLoad(true)")
        await pg.wait_for_timeout(900)
        await pg.evaluate("document.querySelector('.set-main').scrollTop=0")
        state = await pg.evaluate("""(function(){
            var t = document.querySelector('[data-b=accepting]');
            return { chat: window.__store.chatOrders,
                     acceptOn: !!(t && t.classList.contains('on')),
                     panel: (document.getElementById('botPanel') || {}).innerText || '' };
        })()""")
        log("  08: заказы принимает %s; тумблер бота %s; строка про Streamer.bot: %s" % (
            state["chat"], "включён" if state["acceptOn"] else "выключен",
            "принимает Streamer.bot" in state["panel"]))
        await shot(pg, out_dir, "sb-08-bot-off.png")

        await pg.click("[data-b=accepting]")
        await pg.wait_for_timeout(450)
        after = await pg.evaluate("window.__store.chatOrders")
        log("  09: после тумблера бота заказы принимает %s" % after)
        await pg.evaluate("sbOpen()")
        await pg.wait_for_timeout(650)
        await pg.evaluate("document.querySelector('.set-main').scrollTop=0")
        toast = await pg.evaluate("(document.getElementById('toast') || {}).textContent || ''")
        if "Streamer.bot выключен" not in toast:
            # Тост в программе живёт пару секунд; если не успел — показываем тот же текст.
            await pg.evaluate("toast('Streamer.bot выключен: заказы из чата теперь принимает чат-бот пака')")
            await pg.wait_for_timeout(120)
        sbot = await pg.evaluate("""(function(){
            return { chat: SB.chatOrders,
                     toggle: document.getElementById('sbAcceptTg').classList.contains('on'),
                     summary: (document.getElementById('sbSummary') || {}).textContent || '' };
        })()""")
        log("  09: экран Streamer.bot, принимает %s; тумблер %s; «принимает чат-бот пака»: %s" % (
            sbot["chat"], "включён" if sbot["toggle"] else "выключен",
            "чат-бот пака" in sbot["summary"]))
        await shot(pg, out_dir, "sb-09-switch-pack.png")
        return {"errors": errs}
    finally:
        await ctx.close()


async def scene_sbot(browser, out_dir):
    scenes = (
        ("sb-01/02 Подключение и шаблон", scene_sbot_connect),
        ("sb-03/04 Конструктор", scene_sbot_kit),
        ("sb-05/06 Для умельцев", scene_sbot_api),
        ("sb-07 Заказ играет", scene_sbot_order),
        ("sb-08/09 Чат-бот и возврат к паку", scene_sbot_switch),
    )
    errors = {}
    for label, fn in scenes:
        log("• " + label)
        r = await fn(browser, out_dir)
        if r["errors"]:
            errors[label] = r["errors"]
    return {"errors": errors}


SCENES = ("search", "orders", "queue", "themes", "shells", "wizard", "wizard-donations",
          "overlay-settings", "sb")


async def main():
    ap = argparse.ArgumentParser(description="Снимки Тапёра для сайта и README")
    ap.add_argument("--only", default="", help="через запятую: " + ", ".join(SCENES))
    ap.add_argument("--out", default="", help="куда складывать PNG (по умолчанию: public/docs/img, "
                                             "а снимки Streamer.bot — docs/img/streamerbot)")
    args = ap.parse_args()
    only = {x.strip() for x in args.only.split(",") if x.strip()} or set(SCENES)
    unknown = only - set(SCENES)
    if unknown:
        log("Неизвестные снимки: " + ", ".join(sorted(unknown)))
        return 2
    out_dir = Path(args.out) if args.out else OUT_DIR
    sbot_dir = Path(args.out) if args.out else SBOT_OUT
    out_dir.mkdir(parents=True, exist_ok=True)
    sbot_dir.mkdir(parents=True, exist_ok=True)

    log("Склеиваю src/ui.js…")
    subprocess.run(["node", "tools/build-ui.mjs"], cwd=str(ROOT), check=True,
                   stdout=subprocess.DEVNULL)

    log("Поднимаю сервер на 127.0.0.1:%d (репозиторий как корень)" % PORT)
    httpd = start_server()
    result = {"errors": {}}
    try:
        kwargs = {"args": ["--autoplay-policy=no-user-gesture-required"]}
        if os.path.exists(CH):
            kwargs["executable_path"] = CH
        async with async_playwright() as p:
            browser = await p.chromium.launch(**kwargs)
            try:
                if only & {"search", "themes", "shells"}:
                    log("• Поиск, темы и оболочки")
                    result["search"] = await scene_search_screens(browser, out_dir, only)
                    result["errors"]["search/темы/оболочки"] = result["search"]["errors"]
                if "orders" in only:
                    log("• Заказы")
                    r = await scene_orders(browser, out_dir)
                    result["errors"]["orders"] = r["errors"]
                if "queue" in only:
                    log("• Очередь")
                    r = await scene_queue(browser, out_dir)
                    result["errors"]["queue"] = r["errors"]
                if only & {"wizard", "wizard-donations"}:
                    log("• Визард")
                    r = await scene_wizard(browser, out_dir)
                    for k, v in r.items():
                        result["errors"][k] = v
                if "overlay-settings" in only:
                    log("• Настройки оверлея")
                    r = await scene_overlay(browser, out_dir)
                    result["errors"]["overlay-settings"] = r["errors"]
                if "sb" in only:
                    log("• Streamer.bot")
                    r = await scene_sbot(browser, sbot_dir)
                    result["errors"]["Streamer.bot"] = r["errors"]
            finally:
                await browser.close()
    finally:
        httpd.shutdown()

    log("")
    if only == {"sb"}:
        log("Снимки: %s" % sbot_dir)
    elif "sb" in only:
        log("Снимки: %s и %s" % (out_dir, sbot_dir))
    else:
        log("Снимки: %s" % out_dir)
    bad = {k: v for k, v in result["errors"].items() if v}
    if bad:
        log("ОШИБКИ СТРАНИЦ:")
        for k, v in bad.items():
            log("  %s: %s" % (k, v))
        return 1
    log("Ошибки страниц: нет")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
