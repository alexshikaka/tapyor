// Ранний запуск окна: тема, оболочка и масштаб ставятся ДО первой отрисовки, чтобы не было вспышки.
// Раньше это были два inline-скрипта в index.html, и ради них в CSP стоял 'unsafe-inline'.
// Вынесено в файл (аудит 01.11, M2): теперь CSP запрещает любой встроенный скрипт — внедрённый
// через XSS кусок <script> просто не выполнится. Файл подключается в <head> синхронно,
// поэтому по-прежнему отрабатывает до отрисовки.

// 1. Тема и оболочка из localStorage
try {
  var _t = localStorage.getItem('tapTheme'), _d = document.documentElement, _s = localStorage.getItem('tapSkin');
  if (_s) {
    _d.classList.add('pixel-skin', 'skin-' + _s);
    var _sf = localStorage.getItem('tapSkinFont');
    if (_sf) _d.classList.add('font-' + _sf);
    var _ss = localStorage.getItem('tapSkinAdj');
    if (_ss) {
      try {
        var _a = JSON.parse(_ss) || {};
        var _b = Math.max(20, Math.min(100, _a.b == null ? 100 : +_a.b)), _s2 = Math.max(0, Math.min(100, _a.s == null ? 100 : +_a.s)), _c = Math.max(0, Math.min(100, _a.c == null ? 100 : +_a.c));
        _d.style.setProperty('--sk-b', (_b / 100).toFixed(2));
        _d.style.setProperty('--sk-s', (_s2 / 100).toFixed(2));
        _d.style.setProperty('--sk-c', (0.62 + 0.38 * (_c / 100)).toFixed(3));
      } catch (e) {}
    }
  }
  // «Фиолетовой» больше нет: старый id сразу показываем «Графитом», без вспышки фиолетового.
  if (_t === 'violet') _t = 'dark';
  // Встроенные темы на переменных (светлые версии, «Зима близко», «Маджента») — из tapThemeVars.
  var _varsTheme = /^(dark-l|mono-l|winter|winter-l|magenta|magenta-l)$/.test(_t || '');
  if (_t === 'dark' || (!_t && !_s)) _d.classList.add('theme-dark');
  else if (_t === 'mono') _d.classList.add('theme-mono');
  else if (_t === 'light') _d.classList.add('theme-light-default');
  else if (_t && (_t.indexOf('c:') === 0 || _varsTheme)) {
    var _v = JSON.parse(localStorage.getItem('tapThemeVars') || 'null');
    if (_v) {
      _d.classList.add('theme-custom');
      if (_v._light) _d.classList.add('theme-light');
      for (var _k in _v) if (_k[0] !== '_') _d.style.setProperty('--' + _k, _v[_k]);
    }
  }
} catch (e) {}

// 2. Масштаб интерфейса
try{var _z=parseFloat(localStorage.getItem('tapUiZoom'))||1;if(_z<0.6)_z=0.6;if(_z>1.4)_z=1.4;document.documentElement.style.setProperty('--ui-zoom',_z);}catch(e){}
