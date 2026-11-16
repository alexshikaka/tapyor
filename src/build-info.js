// Метка сборки (А12): один номер версии — две сборки.
//   dev    — из закрытого репозитория (канал «отладочная»), метку ставит CI закрытого;
//   stable — из открытого tapyor (канал «стабильная»), метку ставит CI открытого;
//   source — запуск из исходников, метки нет вовсе.
// Метки вшивает electron-builder: -c.extraMetadata.tapyorBuild=dev|stable и -c.extraMetadata.tapyorCommit=<7 знаков>.
// Они попадают в package.json внутри app.asar (или в папке trial-сборки) — оттуда и читаем.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const KNOWN = { dev: 'dev', stable: 'stable' };

function readPkg(app) {
  try { return require(path.join(app.getAppPath(), 'package.json')) || {}; } catch (err) { return {}; }
}

// Из исходников коммит берём у git; в сборке — из метки (в установщике .git нет).
function gitCommit(app) {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: app.getAppPath(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000
    }).trim();
  } catch (err) { return ''; }
}

function buildInfo(app) {
  const pkg = readPkg(app);
  // Из исходников всегда «source»: метка сборки к ним не относится, и «stable» — только явно.
  const label = String(pkg.tapyorBuild || '').trim().toLowerCase();
  const build = app.isPackaged ? (KNOWN[label] || 'dev') : 'source';
  const commit = String(pkg.tapyorCommit || '').trim() || (app.isPackaged ? '' : gitCommit(app));
  return { build, commit, version: app.getVersion() };
}

// Для журнала и автоотчётов: «0.32.0 dev (1e93603)» / «0.32.0 stable (1e93603)» / «0.32.0 из исходников (abc1234)»
function buildLabel(info) {
  const b = info || {};
  const ver = String(b.version || '').trim();
  if (!ver) return '';
  const what = b.build === 'source' ? 'из исходников' : b.build === 'stable' ? 'stable' : 'dev';
  return ver + ' ' + what + (b.commit ? ' (' + b.commit + ')' : '');
}

module.exports = { buildInfo, buildLabel };
