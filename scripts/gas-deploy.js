const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');

if (process.env.GAS_WEBAPP_URL) {
  console.log('이미 웹앱 주소가 있습니다. npm.cmd run gas:redeploy를 쓰세요.');
  process.exit(0);
}

const result = spawnSync('npx --yes @google/clasp@3.4.1 deploy', {
  shell: true,
  encoding: 'utf8',
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const deploymentIds = output.match(/AKfyc[A-Za-z0-9_-]+/g) ?? [];

if (deploymentIds.length !== 1) {
  console.error('웹앱 번호를 찾지 못했습니다. 로그인이 만료됐으면 npm.cmd run gas:login을 다시 하세요.');
  process.exitCode = 1;
} else {
  const envPath = '.env';
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const lines = existing ? existing.split(/\r?\n/) : [];
  if (existing.endsWith('\n')) lines.pop();
  const values = {
    GAS_WEBAPP_URL: `https://script.google.com/macros/s/${deploymentIds[0]}/exec`,
    STORAGE_MODE: 'live',
  };
  const seen = new Set();
  const updated = lines.map((line) => {
    const match = /^\s*(GAS_WEBAPP_URL|STORAGE_MODE)\s*=/.exec(line);
    if (!match) return line;
    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) updated.push(`${key}=${value}`);
  }

  writeFileSync(envPath, `${updated.join(newline)}${newline}`, 'utf8');
  console.log('.env에 웹앱 주소를 적었습니다.');
  console.log('다음: npm.cmd run gas:open');
}
