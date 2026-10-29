// Deploys the gas/ web app with clasp (deploy), updates the same address (redeploy) and opens it in the browser (open).
// The web app address goes into .env as GAS_WEBAPP_URL (docs/LOCAL_SETUP.md).
import fs, { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CLASP = ['--yes', '@google/clasp@3.4.1'];
const ENV = '.env';
const NO_ID = 'clasp 출력에서 배포 ID를 찾지 못했습니다. 위 출력을 확인하고, 로그인이 만료됐으면 npm.cmd run gas:login(macOS: npm run gas:login)을 다시 실행하세요.';
const NO_URL = '.env에 GAS_WEBAPP_URL이 없습니다. 먼저 npm.cmd run gas:deploy(macOS: npm run gas:deploy)를 실행하세요.';
const fail = message => { console.error(message); process.exit(1); };

// npx on Windows runs only through a shell, so the command goes to the shell as one line. A value with spaces is wrapped in double quotes by the caller.
function clasp(args) {
  const result = spawnSync('npx ' + [...CLASP, ...args].join(' '), { encoding: 'utf8', shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return (result.stdout ?? '') + (result.stderr ?? '');
}

// clasp can fail and still exit 0, so an ID is used only when the output has exactly one deployment ID (AKfyc…).
export function deploymentId(text) {
  const ids = new Set(text.match(/AKfyc[\w-]+/g));
  return ids.size === 1 ? [...ids][0] : null;
}

// The last uncommented GAS_WEBAPP_URL= line, when its value starts with https:// (the .env.example line is a comment).
export function readUrl(file = ENV) {
  const line = fs.existsSync(file) && fs.readFileSync(file, 'utf8').split(/\r?\n/).findLast(l => l.startsWith('GAS_WEBAPP_URL='));
  const url = line ? line.slice('GAS_WEBAPP_URL='.length).trim() : '';
  return url.startsWith('https://') ? url : null;
}

// Replaces the GAS_WEBAPP_URL= line or adds one, and adds STORAGE_MODE=live when there is no STORAGE_MODE= line.
// Other lines stay as they are. A missing .env starts from .env.example.
export function writeUrl(url, file = ENV) {
  const lines = fs.readFileSync(fs.existsSync(file) ? file : file + '.example', 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const at = lines.findLastIndex(l => l.startsWith('GAS_WEBAPP_URL='));
  lines[at < 0 ? lines.length : at] = 'GAS_WEBAPP_URL=' + url;
  if (!lines.some(l => l.startsWith('STORAGE_MODE='))) lines.push('STORAGE_MODE=live');
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
}

const commands = {
  // A second deployment gets a new address. With an address already in .env, redeploy updates the same deployment.
  deploy() {
    if (readUrl()) fail('이미 배포 주소가 있습니다. npm.cmd run gas:redeploy(macOS: npm run gas:redeploy)로 갱신하세요.');
    const id = deploymentId(clasp(['create-deployment', '--description', 'tumbler'])) || fail(NO_ID);
    writeUrl(`https://script.google.com/macros/s/${id}/exec`);
    console.log('.env에 GAS_WEBAPP_URL을 적었습니다.\n다음: npm.cmd run gas:init(macOS: npm run gas:init)');
  },
  redeploy() {
    const id = deploymentId(readUrl() || '') || fail(NO_URL);
    if (!clasp(['update-deployment', id, '--description', 'tumbler']).includes(`Redeployed ${id} @`)) fail(NO_ID);
    console.log('같은 배포를 새 버전으로 갱신했습니다. 주소는 그대로입니다.');
  },
  open() {
    const url = readUrl() || fail(NO_URL);
    console.log(`브라우저로 엽니다. 권한 승인 화면이 나오면 허용하세요.\n${url}`);
    spawnSync(`${{ win32: 'start ""', darwin: 'open' }[process.platform] || 'xdg-open'} "${url}"`, { shell: true });
  }
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = commands[process.argv[2]] || fail('사용법: node scripts/gas-clasp.mjs deploy|redeploy|open');
  command();
}
