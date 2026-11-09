function doGet() {
  return ContentService.createTextOutput('권한 승인이 끝났습니다. 이 창을 닫고 터미널로 돌아가세요.');
}

function doPost(event) {
  try {
    const request = JSON.parse(event.postData.contents);
    let data;
    if (request.action === 'setup') {
      data = setupStorage();
    } else {
      const spreadsheet = getConfiguredSpreadsheet();
      if (request.action === 'read') data = readSheets(spreadsheet, request.tabs);
      else if (request.action === 'append') data = appendRows(spreadsheet, request.rows);
      else if (request.action === 'update') data = updateRow(spreadsheet, request);
      else if (request.action === 'savePhoto') data = savePhoto(request);
      else if (request.action === 'getPhoto') data = getPhoto(request.id);
      else if (request.action === 'saveGeminiResult') data = saveGeminiResult(spreadsheet, request.record);
      else if (request.action === 'listGeminiResults') data = listGeminiResults(spreadsheet, request.inspection_id);
      else if (request.action === 'saveEvidenceQuery') data = saveEvidenceQuery(spreadsheet, request.record);
      else if (request.action === 'listEvidenceQueries') data = listEvidenceQueries(spreadsheet, request.inspection_id);
      else if (request.action === 'saveEvidenceLink') data = saveEvidenceLink(spreadsheet, request.record);
      else if (request.action === 'listEvidenceLinks') data = listEvidenceLinks(spreadsheet, request.inspection_id);
      else if (request.action === 'runGemini') data = runGemini(request);
      else if (request.action === 'setOnePortKey') data = setOnePortKey(request.key);
      else throw new Error('지원하지 않는 일입니다.');
    }
    return jsonOutput({ ok: true, data: data });
  } catch (error) {
    const message = error && error.userMessage
      ? error.userMessage
      : '알 수 없는 오류가 났습니다.';
    return jsonOutput({ ok: false, error: message });
  }
}

function setupStorage() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheet = getOrCreateSpreadsheet(properties);
  const folder = getOrCreatePhotoFolder(properties);

  ensureSheetHeaders(spreadsheet, 'inspections', [
    'inspection_id',
    'product_id',
    'inspected_at',
    'revision',
    'weight_g',
    'memo',
    'decision',
    'content_version',
  ]);
  ensureSheetHeaders(spreadsheet, 'images', ['inspection_id', 'position', 'image_url']);
  ensureSheetHeaders(spreadsheet, 'gemini_results', [
    'result_id',
    'inspection_id',
    'created_at',
    'mode',
    'revision',
    'instruction_name',
    'instruction_text',
    'product_id',
    'weight_g',
    'images',
    'result',
  ]);
  ensureSheetHeaders(spreadsheet, 'evidence_queries', [
    'query_id',
    'inspection_id',
    'draft_id',
    'created_at',
    'mode',
    'revision',
    'prompt_name',
    'question',
    'answer',
    'sources',
  ]);
  ensureSheetHeaders(spreadsheet, 'evidence_links', [
    'link_id',
    'query_id',
    'inspection_id',
    'draft_id',
    'status',
    'memo',
    'user',
    'created_at',
  ]);
  removeEmptyDefaultSheet(spreadsheet);

  return { sheetUrl: spreadsheet.getUrl(), folderUrl: folder.getUrl() };
}

function getOrCreateSpreadsheet(properties) {
  const rememberedId = properties.getProperty('SHEET_ID');
  if (rememberedId) {
    try {
      return SpreadsheetApp.openById(rememberedId);
    } catch (error) {
      // Recreate the spreadsheet if the remembered file no longer exists.
    }
  }

  const spreadsheet = SpreadsheetApp.create('텀블러 공장 품질관리 데이터베이스');
  properties.setProperty('SHEET_ID', spreadsheet.getId());
  return spreadsheet;
}

function getOrCreatePhotoFolder(properties) {
  const rememberedId = properties.getProperty('FOLDER_ID');
  if (rememberedId) {
    try {
      return DriveApp.getFolderById(rememberedId);
    } catch (error) {
      // Recreate the folder if the remembered folder no longer exists.
    }
  }

  const folder = DriveApp.createFolder('텀블러 공장 품질검사 사진');
  properties.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function ensureSheetHeaders(spreadsheet, name, requiredHeaders) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  const lastColumn = sheet.getLastColumn();
  const existingHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    : [];
  const missingHeaders = requiredHeaders.filter((header) => !existingHeaders.includes(header));
  if (missingHeaders.length > 0) {
    sheet.getRange(1, lastColumn + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }
}

function removeEmptyDefaultSheet(spreadsheet) {
  spreadsheet.getSheets().forEach((sheet) => {
    const isDefaultSheet = sheet.getName() === 'Sheet1' || sheet.getName() === '시트1';
    const isEmpty = sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
    if (isDefaultSheet && isEmpty) spreadsheet.deleteSheet(sheet);
  });
}

function getConfiguredSpreadsheet() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('SHEET_ID');
  const folderId = properties.getProperty('FOLDER_ID');
  if (!spreadsheetId || !folderId) {
    throw createUserError('시트와 사진 폴더가 아직 없습니다. npm.cmd run gas:init을 실행하세요.');
  }

  try {
    DriveApp.getFolderById(folderId);
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw createUserError('시트와 사진 폴더가 아직 없습니다. npm.cmd run gas:init을 실행하세요.');
  }
}

function readSheets(spreadsheet, tabNames) {
  if (!Array.isArray(tabNames)) throw new Error('탭 이름 목록이 필요합니다.');
  const result = {};
  tabNames.forEach((tabName) => {
    const sheet = spreadsheet.getSheetByName(tabName);
    result[tabName] = sheet ? readSheetRows(sheet) : [];
  });
  return result;
}

function readSheetRows(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn === 0) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0];
  return values.slice(1).filter((row) => row.some((value) => value !== '' && value !== null)).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      if (header !== '' && header !== null) item[header] = readCellValue(row[index]);
    });
    return item;
  });
}

function appendRows(spreadsheet, rowsByTab) {
  if (!rowsByTab || typeof rowsByTab !== 'object' || Array.isArray(rowsByTab)) {
    throw new Error('더할 줄을 확인하세요.');
  }

  let added = 0;
  Object.keys(rowsByTab).forEach((tabName) => {
    const rows = rowsByTab[tabName];
    if (!Array.isArray(rows)) throw new Error('더할 줄을 확인하세요.');
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) throw new Error('시트 탭을 찾을 수 없습니다.');
    if (rows.length === 0) return;

    const headers = getSheetHeaders(sheet);
    if (headers.length === 0) throw new Error('시트 머리글을 찾을 수 없습니다.');
    const values = rows.map((row) => headers.map((header) => toSheetValue(row[header])));
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
    added += values.length;
  });
  return { added: added };
}

function saveGeminiResult(spreadsheet, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw createUserError('판독 결과를 확인하세요.');
  }
  if (typeof record.images !== 'string' || typeof record.result !== 'string') {
    throw createUserError('판독 결과의 사진과 항목은 JSON 글이어야 합니다.');
  }
  try {
    JSON.parse(record.images);
    JSON.parse(record.result);
  } catch (error) {
    throw createUserError('판독 결과의 사진과 항목을 읽을 수 없습니다.');
  }

  const appended = appendRows(spreadsheet, { gemini_results: [record] });
  return { saved: appended.added };
}

function listGeminiResults(spreadsheet, inspectionId) {
  if (inspectionId !== undefined && typeof inspectionId !== 'string') {
    throw createUserError('검사번호를 확인하세요.');
  }

  const sheet = spreadsheet.getSheetByName('gemini_results');
  if (!sheet) return { results: [] };

  const rows = readSheetRows(sheet)
    .filter((row) => inspectionId === undefined || row.inspection_id === inspectionId)
    .map((row) => ({
      ...row,
      images: parseGeminiJsonCell(row.images, []),
      result: parseGeminiJsonCell(row.result, {}),
    }));
  return { results: rows };
}

function saveEvidenceQuery(spreadsheet, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw createUserError('근거 답을 확인하세요.');
  }
  if (typeof record.sources !== 'string') {
    throw createUserError('근거 답의 출처는 JSON 글이어야 합니다.');
  }
  try {
    JSON.parse(record.sources);
  } catch (error) {
    throw createUserError('근거 답의 출처를 읽을 수 없습니다.');
  }
  const appended = appendRows(spreadsheet, { evidence_queries: [record] });
  return { saved: appended.added };
}

function listEvidenceQueries(spreadsheet, inspectionId) {
  if (inspectionId !== undefined && typeof inspectionId !== 'string') {
    throw createUserError('검사번호를 확인하세요.');
  }
  const sheet = spreadsheet.getSheetByName('evidence_queries');
  if (!sheet) return { queries: [] };

  const queries = readSheetRows(sheet)
    .filter((row) => inspectionId === undefined || row.inspection_id === inspectionId)
    .map((row) => ({ ...row, sources: parseGeminiJsonCell(row.sources, []) }));
  return { queries: queries };
}

function saveEvidenceLink(spreadsheet, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw createUserError('대조 기록을 확인하세요.');
  }
  const appended = appendRows(spreadsheet, { evidence_links: [record] });
  return { saved: appended.added };
}

function listEvidenceLinks(spreadsheet, inspectionId) {
  if (inspectionId !== undefined && typeof inspectionId !== 'string') {
    throw createUserError('검사번호를 확인하세요.');
  }
  const sheet = spreadsheet.getSheetByName('evidence_links');
  if (!sheet) return { links: [] };

  const links = readSheetRows(sheet)
    .filter((row) => inspectionId === undefined || row.inspection_id === inspectionId);
  return { links: links };
}

function parseGeminiJsonCell(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw createUserError('저장된 판독 결과를 읽을 수 없습니다.');
  }
}

function runGemini(request) {
  if (
    !request ||
    typeof request.instruction !== 'string' ||
    typeof request.product_name !== 'string' ||
    typeof request.weight !== 'string' ||
    typeof request.revision !== 'string' ||
    typeof request.standard !== 'string' ||
    !Array.isArray(request.imageIds) ||
    request.imageIds.length === 0
  ) {
    throw createUserError('판독에 필요한 검사 정보와 사진을 확인하세요.');
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('ONEPORT_API_KEY');
  if (!apiKey) throw createUserError('OnePort 키가 없습니다.');

  const content = [{
    type: 'text',
    text: [
      request.instruction,
      `검사 정보: 제품 ${request.product_name || '제품 미지정'}, 중량 ${request.weight || '미측정'}, 적용 검사기준 ${request.revision}.`,
      `검사기준 원문:\n${request.standard}`,
      '아래 6개 항목의 JSON으로만 답해 주세요: 판정, 불량유형, 관찰·수치 근거, 적용 기준과 출처, 권고 조치, 사람 승인 필요 여부. 판정은 OK, NG, HOLD 중 하나로 작성해 주세요.',
    ].join('\n\n'),
  }];
  let totalImageBytes = 0;

  request.imageIds.forEach((imageId) => {
    if (typeof imageId !== 'string' || imageId === '') {
      throw createUserError('등록된 사진이 없습니다.');
    }

    let file;
    try {
      file = DriveApp.getFileById(imageId);
    } catch (error) {
      throw createUserError('등록된 사진이 없습니다.');
    }
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    const mimeType = blob.getContentType() || file.getMimeType();
    if (!mimeType || mimeType.indexOf('image/') !== 0) {
      throw createUserError('등록된 사진이 없습니다.');
    }
    totalImageBytes += bytes.length;
    if (totalImageBytes > 3 * 1024 * 1024) {
      throw createUserError('사진이 너무 커서 판독할 수 없습니다.');
    }
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${Utilities.base64Encode(bytes)}` },
    });
  });

  let response;
  try {
    response = UrlFetchApp.fetch('https://oneport.kr/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${apiKey}` },
      payload: JSON.stringify({
        model: 'gemini-3.8-flash',
        messages: [{ role: 'user', content: content }],
        response_format: { type: 'json_object' },
        max_tokens: 8192,
      }),
      muteHttpExceptions: true,
      timeoutSeconds: 120,
    });
  } catch (error) {
    throw createUserError('OnePort에 연결하지 못했습니다. 2분쯤 뒤 다시 눌러 주세요.');
  }

  const statusCode = response.getResponseCode();
  let responseBody = {};
  try {
    responseBody = JSON.parse(response.getContentText());
  } catch (error) {
    if (statusCode < 200 || statusCode >= 300) {
      throw createUserError(getOnePortErrorMessage(statusCode, {}, apiKey));
    }
    throw createUserError('AI 응답 형식이 올바르지 않아 판독하지 못했습니다.');
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw createUserError(getOnePortErrorMessage(statusCode, responseBody, apiKey));
  }

  const contentText = responseBody && responseBody.choices && responseBody.choices[0] &&
    responseBody.choices[0].message && responseBody.choices[0].message.content;
  if (typeof contentText !== 'string') {
    throw createUserError('AI 응답 형식이 올바르지 않아 판독하지 못했습니다.');
  }

  const jsonText = contentText.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let parsedResult;
  try {
    parsedResult = JSON.parse(jsonText);
  } catch (error) {
    throw createUserError('AI 응답 형식이 올바르지 않아 판독하지 못했습니다.');
  }

  const result = normalizeGeminiResult(parsedResult);
  if (!result) throw createUserError('AI 응답 형식이 올바르지 않아 판독하지 못했습니다.');
  return result;
}

function setOnePortKey(key) {
  if (typeof key !== 'string' || key === '') {
    throw createUserError('OnePort 키가 .env에 없습니다.');
  }
  PropertiesService.getScriptProperties().setProperty('ONEPORT_API_KEY', key);
  return { saved: true };
}

function getOnePortErrorMessage(statusCode, responseBody, apiKey) {
  const error = responseBody && responseBody.error && typeof responseBody.error === 'object'
    ? responseBody.error
    : {};
  const safeMessage = sanitizeOnePortText(error.message || '요청에 실패했습니다.', apiKey);

  if (statusCode === 401 && error.reason === 'key_revoked') {
    return '이 OnePort 키는 꺼져 있습니다(코드 401). 강사에게 알려 주세요.';
  }
  if (statusCode === 401) return 'OnePort 키가 맞지 않습니다(코드 401). 키를 다시 넣어 주세요.';
  if (statusCode === 402) return 'OnePort 잔액이 부족해 판독하지 못했습니다(코드 402). 강사에게 알려 주세요.';
  if (statusCode === 403) return '이 OnePort 키로는 판독 모델을 쓸 수 없습니다(코드 403). 강사에게 알려 주세요.';
  if (statusCode === 404) return 'OnePort에서 판독 모델을 찾지 못했습니다(코드 404). 강사에게 알려 주세요.';
  if (statusCode === 413) return '사진이 너무 커서 판독할 수 없습니다(코드 413).';
  if (
    statusCode === 429 &&
    (error.code === 'key_limit_exceeded' || error.type === 'key_limit_exceeded')
  ) {
    return 'OnePort 키의 사용 한도를 다 썼습니다(코드 429). 강사에게 알려 주세요.';
  }
  if ([429, 500, 502, 503, 504].includes(statusCode)) {
    return `AI 판독 서버가 붐빕니다(코드 ${statusCode}). 2분쯤 뒤 다시 눌러 주세요.`;
  }
  return `OnePort 오류(코드 ${statusCode}): ${safeMessage}`;
}

function sanitizeOnePortText(value, apiKey) {
  let text = String(value);
  if (apiKey) text = text.split(apiKey).join('[가림]');
  return text.replace(/Bearer\s+[^\s"'`,}]+/gi, 'Bearer [가림]');
}

function updateRow(spreadsheet, request) {
  const sheet = spreadsheet.getSheetByName(request.tab);
  if (!sheet || !request || typeof request.key !== 'string' || !request.changes || typeof request.changes !== 'object') {
    throw new Error('수정할 기록이 없습니다.');
  }

  const headers = getSheetHeaders(sheet);
  const keyColumn = headers.indexOf(request.key);
  if (keyColumn < 0 || sheet.getLastRow() < 2) throw createUserError('수정할 기록이 없습니다.');

  const keyValues = sheet.getRange(2, keyColumn + 1, sheet.getLastRow() - 1, 1).getValues();
  const matchIndex = keyValues.findIndex((row) => valuesEqual(readCellValue(row[0]), request.value));
  if (matchIndex < 0) throw createUserError('수정할 기록이 없습니다.');

  const rowNumber = matchIndex + 2;
  Object.keys(request.changes).forEach((header) => {
    const column = headers.indexOf(header);
    if (column >= 0) sheet.getRange(rowNumber, column + 1).setValue(toSheetValue(request.changes[header]));
  });
  return { updated: 1 };
}

function getSheetHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
}

function toSheetValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return value;
  return "'" + String(value);
}

function readCellValue(value) {
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  if (typeof value === 'string' && value.charAt(0) === "'") return value.slice(1);
  return value;
}

function valuesEqual(left, right) {
  if (left instanceof Date) left = readCellValue(left);
  if (right instanceof Date) right = readCellValue(right);
  return left === right;
}

function createUserError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

function savePhoto(request) {
  if (typeof request.name !== 'string' || typeof request.mimeType !== 'string' || typeof request.base64 !== 'string') {
    throw new Error('사진 정보를 확인하세요.');
  }

  const properties = PropertiesService.getScriptProperties();
  const folder = DriveApp.getFolderById(properties.getProperty('FOLDER_ID'));
  const bytes = Utilities.base64Decode(request.base64);
  const blob = Utilities.newBlob(bytes, request.mimeType, request.name);
  const file = folder.createFile(blob);
  return { id: file.getId() };
}

function getPhoto(fileId) {
  if (typeof fileId !== 'string' || fileId === '') {
    throw createUserError('등록된 사진이 없습니다.');
  }

  const properties = PropertiesService.getScriptProperties();
  const folder = DriveApp.getFolderById(properties.getProperty('FOLDER_ID'));
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getId() === fileId) {
      return {
        mimeType: file.getMimeType(),
        base64: Utilities.base64Encode(file.getBlob().getBytes()),
      };
    }
  }
  throw createUserError('등록된 사진이 없습니다.');
}

function jsonOutput(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
