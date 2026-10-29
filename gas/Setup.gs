/**
 * Resource setup. gas:init calls it through the web app action setup.resources; the editor function runs the same body.
 * Logs carry property names and outcomes only, never property values.
 */

// Creates the spreadsheet (tabs and headers) and the private Drive photo folder once, and stores their IDs.
// Runs under the script lock (dispatch or the editor function), so two calls never create two spreadsheets.
function prepareTumblerResources(ss) {
  const props = PropertiesService.getScriptProperties();
  handleInitResources(ss);
  if (!props.getProperty(DRIVE_FOLDER_ID_PROP)) {
    props.setProperty(DRIVE_FOLDER_ID_PROP, DriveApp.createFolder('텀블러 공장 품질검사 사진').getId());
  }
  // Opening the stored folder fails here rather than on the first photo upload.
  DriveApp.getFolderById(props.getProperty(DRIVE_FOLDER_ID_PROP)).getName();
  const missing = [];
  if (!props.getProperty('GEMINI_API_KEY')) missing.push('GEMINI_API_KEY');
  return {spreadsheet_ready: true, drive_folder_ready: true, missing_properties: missing};
}

// Editor path for the same setup. The first run shows Google's authorization screen.
function setupTumblerResources() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw Error('다른 작업이 처리 중입니다. 잠시 뒤 다시 실행하세요.');
  try {
    const result = prepareTumblerResources(getOrCreateSpreadsheet());
    console.log('Sheets와 Drive 사진 폴더를 준비했습니다.');
    console.log(result.missing_properties.length ? '아직 비어 있는 스크립트 속성: ' + result.missing_properties.join(', ') : '필요한 스크립트 속성이 모두 있습니다.');
    return result;
  } finally {
    lock.releaseLock();
  }
}
