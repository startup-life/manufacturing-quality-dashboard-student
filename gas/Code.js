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
