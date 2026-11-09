const webAppUrl = process.env.GAS_WEBAPP_URL;
const onePortKey = process.env.ONEPORT_API_KEY;
if (!webAppUrl) {
  console.error('.env에 웹앱 주소가 없습니다. 먼저 npm.cmd run gas:deploy를 실행하세요.');
  process.exit(1);
}

const deploymentId = /^https:\/\/script\.google\.com\/macros\/s\/(AKfyc[A-Za-z0-9_-]+)\/exec(?:\?.*)?$/.exec(webAppUrl)?.[1];
const connectionError = 'Google에 연결하지 못했습니다. 인터넷 연결과 권한 승인(npm.cmd run gas:open)을 확인하세요.';

async function initializeGoogleStorage() {
  if (!deploymentId) {
    console.error(connectionError);
    process.exitCode = 1;
    return;
  }

  let response;
  let result;
  try {
    response = await fetch(`https://script.google.com/macros/s/${deploymentId}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup' }),
    });
    result = await response.json();
  } catch {
    console.error(connectionError);
    process.exitCode = 1;
    return;
  }

  if (!response.ok || !result || typeof result !== 'object') {
    console.error(connectionError);
    process.exitCode = 1;
    return;
  }
  if (result.ok === false) {
    console.error(typeof result.error === 'string' ? result.error : '알 수 없는 오류가 났습니다.');
    process.exitCode = 1;
    return;
  }

  const { sheetUrl, folderUrl } = result.data ?? {};
  if (result.ok !== true || typeof sheetUrl !== 'string' || typeof folderUrl !== 'string') {
    console.error(connectionError);
    process.exitCode = 1;
    return;
  }

  console.log('시트와 사진 폴더를 준비했습니다.');
  console.log(`시트: ${sheetUrl}`);
  console.log(`폴더: ${folderUrl}`);

  if (!onePortKey) {
    console.log('OnePort 키가 .env에 없습니다.');
    return;
  }

  let keyResponse;
  let keyResult;
  try {
    keyResponse = await fetch(`https://script.google.com/macros/s/${deploymentId}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setOnePortKey', key: onePortKey }),
    });
    keyResult = await keyResponse.json();
  } catch {
    console.error(connectionError);
    process.exitCode = 1;
    return;
  }

  if (!keyResponse.ok || !keyResult || typeof keyResult !== 'object') {
    console.error(connectionError);
    process.exitCode = 1;
    return;
  }
  if (keyResult.ok === false) {
    console.error(typeof keyResult.error === 'string' ? keyResult.error : '알 수 없는 오류가 났습니다.');
    process.exitCode = 1;
    return;
  }
  if (keyResult.ok !== true || keyResult.data?.saved !== true) {
    console.error(connectionError);
    process.exitCode = 1;
    return;
  }

  console.log('OnePort 키를 넣었습니다.');
}

void initializeGoogleStorage();
