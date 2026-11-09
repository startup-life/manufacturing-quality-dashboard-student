const { spawnSync } = require('node:child_process');

const result = spawnSync('npx --yes @google/clasp@3.4.1 login', {
  shell: true,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
