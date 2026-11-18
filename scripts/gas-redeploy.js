const { spawnSync } = require('node:child_process');

const webAppUrl = process.env.GAS_WEBAPP_URL;
if (!webAppUrl) {
  console.error('.env에 웹앱 주소가 없습니다. 먼저 npm.cmd run gas:deploy를 실행하세요.');
  process.exit(1);
}

const deploymentId = /\/s\/(AKfyc[A-Za-z0-9_-]+)\/exec(?:[?#].*)?$/.exec(webAppUrl)?.[1];
if (!deploymentId) {
  console.error('웹앱을 바꾸지 못했습니다. 로그인이 만료됐으면 npm.cmd run gas:login을 다시 하고 gas:push부터 다시 하세요.');
  process.exit(1);
}

const result = spawnSync(`npx --yes @google/clasp@3.4.1 deploy --deploymentId ${deploymentId}`, {
  shell: true,
  encoding: 'utf8',
});
const deployments = [...(result.stdout ?? '').matchAll(/^Deployed (AKfyc[A-Za-z0-9_-]+) @(?:\d+|HEAD)\s*$/gm)];

if (result.status === 0 && deployments.length === 1 && deployments[0][1] === deploymentId) {
  console.log('같은 웹앱을 새 버전으로 바꿨습니다. 주소는 그대로입니다.');
} else {
  console.error('웹앱을 바꾸지 못했습니다. 로그인이 만료됐으면 npm.cmd run gas:login을 다시 하고 gas:push부터 다시 하세요.');
  process.exitCode = 1;
}
