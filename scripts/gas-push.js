const { spawnSync } = require('node:child_process');

const result = spawnSync('npx --yes @google/clasp@3.4.1 push --force', {
  shell: true,
  encoding: 'utf8',
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

if (output.includes('Pushed') || output.includes('Script is already up to date')) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log('Google에 코드를 올렸습니다.');
} else if (output.includes('invalid_grant')) {
  console.error('구글 로그인이 만료됐을 수 있습니다. npm.cmd run gas:login을 다시 하세요.');
  process.exitCode = 1;
} else {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
