// A1 аудита 0.34.0: «открой X.Y.Z» имеет право писать только в alexshikaka/tapyor,
// только из ветки main. Раньше хватало подстроки «tapyor» — под неё подходил и чужой форк,
// и закрытый tapyor-player, и tapyor-releases, куда «открой» писать не должен.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrigin, isPublicOrigin, checkReleaseTarget, OPEN_OWNER, OPEN_REPO } from '../../tools/lib/open-origin.mjs';

test('origin: https/ssh/scp, .git и регистр — один и тот же репозиторий', () => {
  for (const url of [
    'https://github.com/alexshikaka/tapyor',
    'https://github.com/alexshikaka/tapyor.git',
    'https://github.com/alexshikaka/tapyor.git/',
    'https://github.com/AlexShikaka/Tapyor.git',
    'http://github.com/alexshikaka/tapyor',
    'ssh://git@github.com/alexshikaka/tapyor.git',
    'ssh://git@github.com:22/alexshikaka/tapyor.git',
    'git@github.com:alexshikaka/tapyor.git',
    'git@github.com:alexshikaka/tapyor',
  ]) {
    assert.equal(isPublicOrigin(url), true, url);
  }
  assert.deepEqual(parseOrigin('git@github.com:alexshikaka/tapyor.git'), {
    host: 'github.com', owner: 'alexshikaka', repo: 'tapyor',
  });
});

test('origin: чужие репозитории и обманки — стоп', () => {
  for (const url of [
    'https://github.com/alexshikaka/tapyor-player.git',   // закрытый репозиторий кода
    'https://github.com/alexshikaka/tapyor-releases.git', // релизы
    'https://github.com/evil/tapyor.git',                 // чужой владелец
    'https://github.com/alexshikaka/tapyor-evil.git',
    'https://gitlab.com/alexshikaka/tapyor.git',          // другой хост
    'https://github.com/alexshikaka/tapyor/extra.git',
    'C:\\Work\\app\\project',                                 // локальный путь — не remote
    'E:/Work/app/project',
    '',
    null,
  ]) {
    assert.equal(isPublicOrigin(url), false, String(url));
  }
});

test('checkReleaseTarget: только main и только alexshikaka/tapyor', () => {
  const right = 'https://github.com/' + OPEN_OWNER + '/' + OPEN_REPO + '.git';
  assert.deepEqual(checkReleaseTarget(right, 'main'), { ok: true });
  assert.deepEqual(checkReleaseTarget('git@github.com:' + OPEN_OWNER + '/' + OPEN_REPO + '.git', 'main'), { ok: true });

  const wrongBranch = checkReleaseTarget(right, 'experiment');
  assert.equal(wrongBranch.ok, false);
  assert.match(wrongBranch.why, /main/);

  const wrongRepo = checkReleaseTarget('https://github.com/alexshikaka/tapyor-player.git', 'main');
  assert.equal(wrongRepo.ok, false);
  assert.match(wrongRepo.why, /tapyor/);
  assert.match(wrongRepo.why, /Ничего не тронуто|не alexshikaka/);
});
