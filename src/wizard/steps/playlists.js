// Шаг визарда «Плейлисты» (WIZARD-PLAN.md, 3.6; макет W06-Playlists.dc.html).
// В визарде — заметка со списком владельца (30 песен) и кнопкой «Скопировать», в Тапёре
// открывается импорт на вкладке «Текст», подсвечивается поле вставки. Визард ловит вставку
// и подсвечивает «Собрать плейлист», ловит конец сборки и предлагает «Играть»/«Играть фоном».
// Демо пропускается, если ни одна площадка не отвечает и папки с музыкой нет.
// Чистые функции (demoLines / preview / importDoneText) проверяет юнит-тест.
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.WIZARD && root.WIZARD.register) root.WIZARD.register(api.step);
})(typeof window !== 'undefined' ? window : null, function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Список владельца (14.11), ровно 30 песен — «грязный»: номера и годы в скобках.
  const DEMO = `Queen — Bohemian Rhapsody (1975)

1. Michael Jackson — Billie Jean (1982)
2. The Beatles — Hey Jude (1968)
3. ABBA — Dancing Queen (1976)
4. Whitney Houston — I Will Always Love You (1992)
5. Nirvana — Smells Like Teen Spirit (1991)
6. Eagles — Hotel California (1976)
7. John Lennon — Imagine (1971)
8. Elton John — Your Song (1970)
9. Bon Jovi — It's My Life (2000)
10. Madonna — Like a Prayer (1989)
11. Adele — Rolling in the Deep (2010)
12. The Rolling Stones — (I Can't Get No) Satisfaction (1965)
13. Toto — Africa (1982)
14. Céline Dion — My Heart Will Go On (1997)
15. Queen — We Will Rock You (1977)
16. AC/DC — Highway to Hell (1979)
17. David Bowie — Heroes (1977)
18. Guns N' Roses — Sweet Child O' Mine (1987)
19. Prince — Purple Rain (1984)
20. Gloria Gaynor — I Will Survive (1978)
21. The Weeknd — Blinding Lights (2019)
22. Edith Piaf — Non, je ne regrette rien (1960)
23. Luis Fonsi ft. Daddy Yankee — Despacito (2017)
24. Bob Marley — No Woman, No Cry (1974)
25. Rihanna ft. Jay-Z — Umbrella (2007)
26. Frank Sinatra — My Way (1969)
27. Eurythmics — Sweet Dreams (Are Made of This) (1983)
28. Ricky Martin — Livin' la Vida Loca (1999)
29. Modern Talking — You're My Heart, You're My Soul (1984)`;

  function demoLines() {
    return String(DEMO).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  // Первые строки заметки и сколько осталось «за кадром».
  function preview(n) {
    const lines = demoLines();
    const show = Math.max(0, Math.min(lines.length, n == null ? 3 : n));
    return { lines: lines.slice(0, show), rest: lines.length - show, total: lines.length };
  }
  function songWord(n) {
    n = Math.abs(Number(n) || 0) % 100;
    const b = n % 10;
    if (n >= 11 && n <= 14) return 'песен';
    if (b === 1) return 'песня';
    if (b >= 2 && b <= 4) return 'песни';
    return 'песен';
  }
  // Итог сборки: сколько песен собралось и есть ли среди них отрывки.
  function importDoneText(found, previews) {
    const n = Number(found) || 0;
    let s = '✓ Собрано ' + n + ' ' + songWord(n) + '. Номера и годы Тапёр убрал сам.';
    if (previews) s += ' Только отрывки: ' + previews + ' — полные версии Тапёр поищет на других площадках.';
    return s;
  }

  // Копирование в буфер. В окне визарда нет моста к clipboard Electron, поэтому
  // navigator.clipboard (он и есть буфер Electron), а запасной путь — скрытое поле.
  function copyText(text) {
    const s = String(text == null ? '' : text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return copyFallback(s); });
    }
    return Promise.resolve(copyFallback(s));
  }
  function copyFallback(s) {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  const step = {
    id: 'playlists',
    routes: ['listener', 'streamer'],
    label: 'Плейлисты',
    title: 'Любой список — в плейлист',
    lead: 'Твоя музыка из ВКонтакте, из видео на YouTube или просто из списка — станет плейлистом за пару минут. Попробуем на списке.',
    skippable: true,
    render(el, api) {
      el.__wizCurrent = 'playlists';
      el.__wizPl = { data: { canDemo: null, pasted: 0, progress: null, done: null, copied: false }, api: api };
      if (!el.__wizPlBound) {
        el.__wizPlBound = true;
        el.addEventListener('click', function (e) {
          if (el.__wizCurrent !== 'playlists') return;
          const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
          if (!b) return;
          const st = el.__wizPl;
          const act = b.dataset.act;
          if (act === 'copy') {
            copyText(DEMO).then(function (ok) {
              if (!st) return;
              st.data.copied = !!ok;
              paint(el);
            });
            return;
          }
          if (act === 'pasteMe') { api.cmd({ op: 'do', name: 'importPaste', args: { text: DEMO } }); return; }
          if (act === 'play') { api.cmd({ op: 'do', name: 'importPlay' }); api.next(); }
        });
      }
      paint(el);
    },
    onEnter(api) {
      const st = { un: null, api: api };
      playlistsStep.state = st;
      api.cmd({ op: 'do', name: 'wizReset' });
      st.un = api.on('import', function (d) {
        const el = playlistsStep.el;
        if (!el || el.__wizCurrent !== 'playlists' || !el.__wizPl || !d) return;
        const data = el.__wizPl.data;
        if (d.stage === 'info') {
          data.canDemo = d.canDemo !== false;
          if (data.canDemo) {
            api.cmd({ op: 'do', name: 'importOpen' });
            api.cmd({ op: 'highlight', sel: '#impPaste' });
            // Список сразу в буфер: на шаге подсвечено «нажми Ctrl+V» (замечание владельца 15.11).
            // Кнопка «Скопировать» остаётся — если буфер успели перезаписать.
            if (!data.copied) {
              copyText(DEMO).then(function (ok) {
                if (!el.__wizPl || el.__wizCurrent !== 'playlists') return;
                el.__wizPl.data.copied = !!ok;
                paint(el);
              });
            }
          }
          paint(el);
          return;
        }
        if (d.stage === 'pasted') {
          data.pasted = Number(d.n) || 0;
          data.progress = null;
          if (data.pasted) api.cmd({ op: 'highlight', sel: '#impGo' });
          paint(el);
          return;
        }
        if (d.stage === 'progress') {
          data.progress = { done: Number(d.done) || 0, total: Number(d.total) || 0 };
          paint(el);
          return;
        }
        if (d.stage === 'done') {
          data.done = { found: Number(d.found) || 0, previews: Number(d.previews) || 0, total: Number(d.total) || 0 };
          data.progress = null;
          api.cmd({ op: 'clear' });
          paint(el);
        }
      });
      api.cmd({ op: 'do', name: 'importWatch', args: { on: true } });
      api.cmd({ op: 'do', name: 'importInfo' });
    },
    onLeave() {
      const st = playlistsStep.state;
      if (st && typeof st.un === 'function') st.un();
      playlistsStep.state = null;
      playlistsStep.el = null;
      const api = st && st.api;
      if (api) {
        api.cmd({ op: 'do', name: 'importWatch', args: { on: false } });
        api.cmd({ op: 'clear' });
      }
    }
  };

  const playlistsStep = { el: null, state: null, step: step };

  function paint(el) {
    playlistsStep.el = el;
    const box = el.__wizPl;
    if (!box) return;
    const d = box.data;
    const api = box.api;
    const streamer = api && api.route === 'streamer';

    if (d.canDemo === null) {
      el.innerHTML = '<p class="wiz-pl-wait">Готовлю демо…</p>';
      return;
    }
    if (d.canDemo === false) {
      el.innerHTML = '<div class="wiz-pl-card"><div class="wiz-pl-l">Демо пока не пройдёт</div>'
        + '<p class="wiz-pl-p">Ни одна площадка сейчас не отвечает и музыки с компьютера нет. '
        + 'Плейлисты можно будет собрать позже — всё на месте: вкладка «Плейлисты» → «Импорт».</p></div>';
      return;
    }

    const pv = preview(3);
    let h = '<div class="wiz-pl-note">'
      + '<div class="wiz-pl-l">Заметка · скинули список песен</div>'
      + pv.lines.map(function (line) { return '<div class="wiz-pl-line">' + esc(line) + '</div>'; }).join('')
      + (pv.rest ? '<div class="wiz-pl-line is-more">… ещё ' + pv.rest + ' строк</div>' : '')
      + '<div class="wiz-pl-copy"><button class="wiz-pl-copybtn" type="button" data-act="copy">'
      + (d.copied ? '✓ Скопировано' : 'Скопировать') + '</button></div>'
      + '</div>';

    h += '<div class="wiz-pl-paste">'
      + '<div class="wiz-pl-h">Теперь нажми <kbd>Ctrl</kbd> + <kbd>V</kbd></div>'
      + '<div class="wiz-pl-small">в подсвеченное поле слева</div>'
      + '</div>';

    if (d.done) {
      h += '<div class="wiz-pl-done">' + esc(importDoneText(d.done.found, d.done.previews)) + '</div>';
      h += '<div class="wiz-pl-result">'
        + '<div class="wiz-pl-l">' + (streamer ? 'Собери фон для эфира' : 'Собери свой плейлист') + '</div>'
        + '<button class="wiz-pl-play" type="button" data-act="play">' + (streamer ? 'Играть фоном' : 'Играть') + '</button>'
        + '</div>';
    } else if (d.progress && d.progress.total) {
      const pct = Math.max(2, Math.min(100, Math.round(d.progress.done / d.progress.total * 100)));
      h += '<div class="wiz-pl-bar"><i style="width:' + pct + '%"></i></div>'
        + '<div class="wiz-pl-small">Собираю песни… ' + d.progress.done + ' из ' + d.progress.total + '</div>';
    } else if (d.pasted) {
      h += '<div class="wiz-pl-ok">Есть! Теперь «Собрать плейлист».</div>';
    }

    h += '<p class="wiz-pl-hint">Номера и годы оставь как есть — Тапёр уберёт их сам.</p>';
    h += '<button class="wiz-pl-fallback" type="button" data-act="pasteMe">Вставь за меня</button>';
    el.innerHTML = h;
  }

  return { step: step, DEMO: DEMO, demoLines: demoLines, preview: preview, importDoneText: importDoneText };
});
