const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');

if (existsSync('.clasp.json')) {
  console.log('이미 프로젝트가 있습니다. 다시 만들지 않습니다.');
  process.exit(0);
}

mkdirSync('gas', { recursive: true });
const result = spawnSync(
  'npx --yes @google/clasp@3.4.1 create --type standalone --title tumbler-factory --rootDir gas',
  { shell: true, encoding: 'utf8' },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (existsSync('.clasp.json')) {
  console.log('프로젝트를 만들었습니다.');
} else {
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
