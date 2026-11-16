// L4 (аудит 0.32.0): tools/cloud-deploy.sh не выкладывает yc-license без SHARED_KEY.
// Скрипт запускается целиком в bash, но yc и jq подменены функциями — облако не трогаем, ничего не выкладываем.
// Проверяем только страж: значение переменной нигде не печатается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
// D2 (F1): tools/cloud-deploy.sh — инструмент владельца, в открытый снимок не входит. Тогда
// проверять нечего: это пропуск с причиной, а не падение на отсутствующем файле.
const NO_SCRIPT = fs.existsSync(path.join(ROOT, 'tools', 'cloud-deploy.sh'))
  ? false
  : 'нет tools/cloud-deploy.sh — он не входит в открытый снимок';

// sharedKey: true — у функции «задана» переменная (заглушка jq отвечает 1), false — пусто (0).
function deploy(name, sharedKey) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-'));
  const mark = path.join(dir, 'created');
  const script = `
yc() {
  if [ "$3" = "version" ] && [ "$4" = "get-by-tag" ]; then echo "$GET_JSON"; return 0; fi
  if [ "$3" = "version" ] && [ "$4" = "create" ]; then echo "made" >> "$MARK"; echo '{"id":"v1","status":"active","environment":{}}'; return 0; fi
  return 0
}
jq() {
  local f="\${@: -1}"
  case "$f" in
    *SHARED_KEY*) echo "$SK";;
    *service_account_id*) echo "";;
    *.runtime) echo nodejs22;;
    *.entrypoint) echo index.handler;;
    *.resources.memory) echo 134217728;;
    *.execution_timeout) echo 5;;
    *.id) echo v1;;
    *.status) echo active;;
    *to_entries|map*) echo "LICENSE_PRIVATE_KEY=x";;
    *length*) echo 1;;
    *) echo "";;
  esac
}
export -f yc jq
bash tools/cloud-deploy.sh "$@"
`;
  const r = spawnSync('bash', ['-c', script, 'bash', name, 'x.zip'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { GET_JSON: '{"environment":{}}', SK: sharedKey ? '1' : '0', MARK: mark }),
    encoding: 'utf8',
  });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || ''), made: fs.existsSync(mark) };
}

test('cloud-deploy: yc-license без SHARED_KEY не выкладывается, с переменной — выкладывается', { skip: NO_SCRIPT || (!hasBash && 'нет bash') }, () => {
  const no = deploy('yc-license', false);
  assert.equal(no.code, 1, 'выкладка остановлена: ' + no.out + no.err);
  assert.match(no.err + no.out, /SHARED_KEY/);
  assert.equal(no.made, false, 'версия не создавалась');
  const yes = deploy('yc-license', true);
  assert.equal(yes.code, 0, yes.err);
  assert.equal(yes.made, true);
  assert.match(yes.out, /новая версия/);
});

test('cloud-deploy: остальные функции без SHARED_KEY выкладываются как раньше', { skip: NO_SCRIPT || (!hasBash && 'нет bash') }, () => {
  const r = deploy('yc-da', false);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.made, true);
  assert.doesNotMatch(r.out + r.err, /SHARED_KEY/);
});
