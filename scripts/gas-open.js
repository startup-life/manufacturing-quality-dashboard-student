const { spawnSync } = require('node:child_process');

const webAppUrl = process.env.GAS_WEBAPP_URL;
if (!webAppUrl) {
  console.error('.env에 웹앱 주소가 없습니다. 먼저 npm.cmd run gas:deploy를 실행하세요.');
  process.exit(1);
}

const deploymentId = /^https:\/\/script\.google\.com\/macros\/s\/(AKfyc[A-Za-z0-9_-]+)\/exec(?:\?.*)?$/.exec(webAppUrl)?.[1];
if (!deploymentId) {
  console.error('Google 권한 승인 창을 열지 못했습니다.');
  process.exit(1);
}

const url = `https://script.google.com/macros/s/${deploymentId}/exec?authuser=0`;
let result;
if (process.platform === 'win32') {
  result = spawnSync('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { stdio: 'ignore' });
} else {
  result = spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
}

if (result.error || result.status !== 0) {
  console.error('Google 권한 승인 창을 열지 못했습니다.');
  process.exitCode = 1;
}
