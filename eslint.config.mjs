import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'history/**', 'docs/**', 'build/**', 'resources/**', 'tests/ui/**', 'src/ui/**', 'src/vendor/**'] },
  // Скрипт окна: части src/ui/*.js проверяются склейкой src/ui.js (один общий скрипт, как в программе)
  {
    files: ['src/ui.js', 'src/skins/*.js', 'src/boot.js', 'src/ytplayer.js'],   // модуль оболочек — тоже скрипт окна
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, Hls: 'readonly', YT: 'readonly', TapRank: 'readonly', TapTheme: 'readonly', TapReq: 'readonly', TapSkinPack: 'readonly', TapQC: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'off', 'no-redeclare': 'error' },
  },
  // Общий формат сообщений плеера YouTube: один файл работает и в окне (window), и в Node-тестах (module).
  {
    files: ['src/yt-msg.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'off', 'no-redeclare': 'error' },
  },
  // Скрипт панели OBS (страница /widget в браузере OBS) — код окна, не Node (B9: вынесен из widget.html)
  {
    files: ['src/widget.js', 'src/dock2.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'off', 'no-redeclare': 'error' },
  },
  {
    files: ['src/**/*.js'],
    ignores: ['src/ui.js', 'src/rank.js', 'src/theme.js', 'src/reqparse.js', 'src/skins/**', 'src/boot.js', 'src/widget.js', 'src/dock2.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        fetch: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
      'no-redeclare': 'error',
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'off' },
  },
];
