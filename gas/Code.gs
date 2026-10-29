/**
 * 텀블러 공장 (TUMBLER FACTORY) - GAS Backend Core
 * Sheets 업무 기록 정본 및 Drive 비공개 사진 저장소 관리
 */

const SCHEMA_VERSION = 1;
const SPREADSHEET_ID_PROP = 'SPREADSHEET_ID';
const DRIVE_FOLDER_ID_PROP = 'DRIVE_FOLDER_ID';

const TABS = [
  'products',
  'inspections',
  'inspection_images',
  'defect_codes',
  'inspection_defects',
  'inspection_records',
  'record_defects',
  'standards',
  'ai_runs',
  'ai_drafts',
  'evidence_links',
  'evidence_queries',
  'requests'
];

/**
 * Web App Entry Point
 * The web app always answers 200, so every outcome (including exceptions) goes back as a JSON envelope.
 */
function doPost(e) {
  let response;
  try {
    response = handleWebAppRequest(e);
  } catch (err) {
    // Platform exception text can carry internal IDs; a fixed message keeps it out of the response.
    // The execution log (seen by the script owner only) keeps the name and message, with ID- and key-shaped text masked.
    console.error('doPost 예외: ' + logSafeError(err));
    response = errorResponse('UPSTREAM_FAILED', '웹앱 요청을 처리하지 못했습니다.', false);
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

// An exception's name and message for the log. Key shapes and long ID or token shapes (spreadsheet and Drive IDs,
// deployment IDs) become [가림], as src/log.ts does for the local log.
function logSafeError(err) {
  const text = (err && err.name ? err.name + ': ' : '') + String(err && err.message !== undefined ? err.message : err);
  return text.replace(/(?:AIza|AQ\.)[A-Za-z0-9_.-]+/g, '[가림]').replace(/[0-9A-Za-z_-]{25,}/g, '[가림]').slice(0, 500);
}

// The resource check runs before the script lock and any sheet read, except for setup.resources, which creates them.
// Anyone with the web app URL can call it (access: anyone), so the URL is kept in .env only.
function handleWebAppRequest(e) {
  let body;
  try {
    body = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (_) {
    return errorResponse('VALIDATION', '요청 본문이 JSON 형식이 아닙니다.', false);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('VALIDATION', '요청 객체가 유효하지 않습니다.', false);
  }

  const props = PropertiesService.getScriptProperties();
  // getOrCreateSpreadsheet would otherwise create a new spreadsheet for a web request.
  if (body.action !== 'setup.resources' && (!props.getProperty(SPREADSHEET_ID_PROP) || !props.getProperty(DRIVE_FOLDER_ID_PROP))) {
    return errorResponse('SETUP_REQUIRED', 'npm.cmd run gas:init(macOS: npm run gas:init)을 실행하세요(또는 편집기에서 setupTumblerResources를 한 번 실행하세요).', false);
  }

  return dispatch(body);
}

// Opening the web app URL in a browser (npm run gas:open) gives the first authorization and then this fixed text.
// It reads no data and calls nothing else.
function doGet() {
  return ContentService.createTextOutput('권한 승인이 끝났습니다. 이 창을 닫고 터미널로 돌아가세요.');
}

/**
 * Single Entry Point with Action Allowlist
 */
function dispatch(request) {
  if (!request || typeof request !== 'object') {
    return errorResponse('VALIDATION', '요청 객체가 유효하지 않습니다.', false);
  }

  const { schema_version, action, request_id, expected_version, payload } = request;

  if (schema_version !== SCHEMA_VERSION) {
    return errorResponse('VALIDATION', `지원되지 않는 스키마 버전입니다 (요청: ${schema_version}, 지원: ${SCHEMA_VERSION}).`, false);
  }

  if (!action || typeof action !== 'string') {
    return errorResponse('VALIDATION', 'action이 지정되지 않았습니다.', false);
  }
  // Inference claims/finalizes under a lock but never holds it during the remote call.
  if (action === 'ai.execute') {
    try { return successResponse(executeLiveAi(payload), request_id); }
    catch (_) { return errorResponse('UPSTREAM_FAILED', '판독 실행 조회가 필요합니다. 자동 재호출하지 않습니다.', false); }
  }
  // Reading a stored photo writes nothing (getLivePhoto reads the photos tab and Drive), so the home's card photos
  // do not wait in line for the lock. doPost has checked the spreadsheet ID, so the open below never creates one.
  if (action === 'photos.get') {
    try { return successResponse(getLivePhoto(getOrCreateSpreadsheet(), payload), request_id); }
    catch (err) { return errorResponse(err.code || 'UPSTREAM_FAILED', err.message || String(err), false); }
  }

  const lock = LockService.getScriptLock();
  // One wait for every action: a screen sends several requests at once and GAS runs them one at a time.
  const hasLock = lock.tryLock(30000);
  if (!hasLock) {
    return errorResponse('CONFLICT', '서버가 현재 다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.', true);
  }

  try {
    const ss = getOrCreateSpreadsheet();

    // Idempotency check for mutating requests
    if (request_id && isMutatingAction(action)) {
      const cached = getCachedRequest(ss, request_id, payload);
      if (cached) {
        if (cached.conflict) {
          return errorResponse('CONFLICT', '동일한 요청 ID에 서로 다른 내용이 제출되었습니다.', false);
        }
        return successResponse(cached.result, request_id);
      }
    }

    let result;
    switch (action) {
      case 'prompts.list': result=getRows(ss,'prompt_versions').filter(p=>!payload.kind||p.kind===payload.kind);break;
      case 'prompts.save': result=savePromptVersion(ss,payload);break;
      case 'prompts.seed':
        for(const row of payload.versions||[])savePromptVersion(ss,row);
        result={count:getRows(ss,'prompt_versions').length};break;
      case 'connection.status': result = liveConnectionStatus(ss); break;
      case 'init.configure': result = configureLiveResources(ss,payload); break;
      case 'photos.store': result = storeLivePhoto(ss, payload, request_id); break;
      case 'ai.runs': result = liveAiRuns(ss, payload); break;
      // gas:init's first call: under this lock getOrCreateSpreadsheet above has made or opened the spreadsheet.
      case 'setup.resources': result = prepareTumblerResources(ss); break;
      case 'init.resources':
        result = handleInitResources(ss);
        break;
      case 'home.get':
        result = handleHomeGet(ss, payload);
        break;
      case 'products.list':
        result = handleProductsList(ss);
        break;
      case 'inspections.list':
        result = handleInspectionsList(ss, payload);
        break;
      case 'inspections.get':
        // The detail carries its drafts, newest first, as in the mock store: the screen draws them before /drafts answers
        // and keeps them when that request fails (public/app.js renderDetailView, loadDrafts).
        result = handleInspectionsGet(ss, payload);
        result.drafts = handleDraftsGet(ss, {id: result.inspection_id}) || [];
        break;
      case 'inspections.createBatch':
        result = handleInspectionsCreateBatch(ss, payload, request_id);
        break;
      case 'inspections.update': result=updateLiveInspection(ss,payload,expected_version);break;
      case 'ai.runQueue':
        result = queueLiveAi(ss, payload, request_id, expected_version);
        break;
      case 'drafts.get':
        result = handleDraftsGet(ss, payload);
        break;
      case 'drafts.evidence.list': result=getRows(ss,'evidence_links').filter(r=>String(r.draft_id)===String(payload.draft_id));break;
      case 'standards.get':
        result = handleStandardsGet(ss, payload);
        break;
      default:
        return errorResponse('VALIDATION', `허용되지 않은 action입니다: '${action}'`, false);
    }

    if (request_id && isMutatingAction(action)) {
      recordRequest(ss, request_id, action, payload, result);
    }

    return successResponse(result, request_id);
  } catch (err) {
    return errorResponse(err.code || 'UPSTREAM_FAILED', err.message || String(err), false);
  } finally {
    lock.releaseLock();
  }
}

function isMutatingAction(action) {
  return [
    'inspections.createBatch',
    'ai.runQueue',
    'init.resources'
    , 'photos.store', 'init.configure', 'inspections.update', 'prompts.save','prompts.seed'
  ].includes(action);
}

function successResponse(result, request_id) {
  return {
    success: true,
    request_id: request_id || null,
    result: result
  };
}

function errorResponse(code, message, retryable) {
  return {
    success: false,
    error: {
      code: code || 'UPSTREAM_FAILED',
      message: message || '알 수 없는 오류가 발생했습니다.',
      retryable: !!retryable
    }
  };
}

/**
 * Formula Injection Sanitize
 */
// Text Sheets would turn into something else: a formula (= + - @) or a number or date (a leading digit, such as a memo
// "2026-10-21"). A leading apostrophe keeps it as the written text; desanitize removes it if a read returns it.
const QUOTED_TEXT = /^[=+\-@\t\r0-9]/;

function sanitize(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  const s = String(val);
  if (QUOTED_TEXT.test(s)) {
    return "'" + s;
  }
  return s;
}

function desanitize(val) {
  if (typeof val === 'string' && val.startsWith("'") && QUOTED_TEXT.test(val.slice(1))) {
    return val.slice(1);
  }
  return val;
}

/**
 * Sheets Helpers
 */
function getOrCreateSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty(SPREADSHEET_ID_PROP);
  if (ssId) {
    // Permission failure must not create an empty replacement database.
    return SpreadsheetApp.openById(ssId);
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('텀블러 공장 품질관리 데이터베이스');
  props.setProperty(SPREADSHEET_ID_PROP, ss.getId());
  ensureTabs(ss);
  return ss;
}

function ensureTabs(ss) {
  for (const tabName of TABS) {
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    }
  }
}

function getRows(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];
  // One read, header included. An empty sheet reads as [['']] and a header-only sheet as one row: no records.
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  let zone = null;
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, idx) => {
      let value = row[idx];
      if (Object.prototype.toString.call(value) === '[object Date]') value = sheetDateText(value, h, zone = zone || ss.getSpreadsheetTimeZone());
      obj[h] = desanitize(value);
    });
    return obj;
  });
}

// Columns written as local date-time text (YYYY-MM-DD HH:mm:ss), the form the registration screen sends.
const LOCAL_TIME_COLUMNS = ['inspected_at'];

// Sheets turns date-like text such as 2026-10-19 08:30:00 into a date cell, and getValues returns it as a Date
// (String() gives "Mon Oct 19 2026 ..."). Sheets read the text in the spreadsheet's time zone, so formatting in that
// zone gives the written text back.
// Other time columns hold toISOString() text, which Sheets keeps as text; a date cell there is returned as the same instant.
function sheetDateText(value, header, zone) {
  if (LOCAL_TIME_COLUMNS.indexOf(header) >= 0) return Utilities.formatDate(value, zone, 'yyyy-MM-dd HH:mm:ss');
  return value.toISOString();
}

function appendRow(ss, tabName, dataObj) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const row = headers.map(h => sanitize(dataObj[h] !== undefined ? dataObj[h] : ''));
  sheet.appendRow(row);
}

/**
 * Idempotency Check in Requests Sheet
 */
function getCachedRequest(ss, requestId, payload) {
  const rows = getRows(ss, 'requests');
  const found = rows.find(r => r.request_id === requestId);
  if (!found) return null;
  const payloadStr = canonicalJson(payload || {});
  if (found.payload_hash && found.payload_hash !== hashString(payloadStr)) {
    return { conflict: true };
  }
  return {
    conflict: false,
    result: found.result_json ? JSON.parse(found.result_json) : null
  };
}

function recordRequest(ss, requestId, action, payload, result) {
  appendRow(ss, 'requests', {
    request_id: requestId,
    action: action,
    payload_hash: hashString(canonicalJson(payload || {})),
    status: 'COMPLETED',
    result_json: JSON.stringify(result || null),
    created_at: new Date().toISOString()
  });
}

function hashString(str) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return digest.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// Sorted keys: the request hash must not depend on the key order a client serializes.
function canonicalJson(value) {
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

/**
 * Resource Initialization
 */
function handleInitResources(ss) {
  ensureTabs(ss);
  initHeadersIfEmpty(ss);
  return { status: 'INITIALIZED', spreadsheet_id: ss.getId() };
}

function initHeadersIfEmpty(ss) {
  const headersMap = {
    products: ['product_id', 'product_name', 'color', 'capacity_ml'],
    inspections: ['inspection_id', 'product_id', 'inspected_at', 'initial_weight_g', 'initial_decision', 'content_version', 'created_at'],
    inspection_images: ['image_id', 'inspection_id', 'image_url', 'drive_file_id', 'sha256', 'active', 'created_at'],
    defect_codes: ['defect_code', 'defect_name', 'severity'],
    inspection_defects: ['inspection_id', 'defect_code'],
    inspection_records: ['record_id', 'inspection_id', 'user_id', 'recorded_at', 'decision', 'weight_g', 'notes', 'content_version', 'change_reason'],
    record_defects: ['record_id', 'defect_code'],
    standards: ['standard_id', 'revision', 'standard_text', 'sha256', 'created_at'],
    ai_runs: ['run_id', 'request_id', 'inspection_id', 'content_version', 'standard_version', 'status', 'error_type', 'created_at'],
    ai_drafts: ['draft_id', 'run_id', 'inspection_id', 'input_snapshot', 'result', 'standard_revision', 'standard_hash', 'model', 'created_at'],
    evidence_links: ['link_id', 'inspection_id', 'draft_id', 'content_version', 'standard_revision', 'notebook_id', 'source_id', 'quote', 'note', 'status', 'verified_at'],
    evidence_queries: ['query_id', 'inspection_id', 'draft_id', 'content_version', 'standard_revision', 'notebook_id', 'source_id', 'query_text', 'response_text', 'sources_json', 'status', 'created_at'],
    requests: ['request_id', 'action', 'payload_hash', 'status', 'result_json', 'created_at']
  };

  for (const [tab, headers] of Object.entries(headersMap)) {
    const sheet = ss.getSheetByName(tab);
    if (sheet && sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  ensureLiveHeaders(ss);
}

/**
 * Inspection Batch Creation (사진 1장=검사 1건 기본 + 동일 제품 사진 묶기)
 */
function handleInspectionsCreateBatch(ss, payload, requestId) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    const err = new Error('등록할 검사 항목이 없습니다.');
    err.code = 'VALIDATION';
    throw err;
  }

  const createdInspections = [];
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMdd');

  for (let idx = 0; idx < payload.items.length; idx++) {
    const item = payload.items[idx];
    // 자동 검사번호 채번: INSP-YYYYMMDD-XXXX (충돌 방지 4자리 영숫자)
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const inspectionId = item.inspection_id || `INSP-${dateStr}-${randomSuffix}${idx > 0 ? ('-' + (idx + 1)) : ''}`;

    const productId = item.product_id || 'P-SILVER';
    const inspectedAt = item.inspected_at || now.toISOString();
    const weightG = item.weight_g !== undefined && item.weight_g !== null && item.weight_g !== '' ? Number(item.weight_g) : null;
    const initialDecision = item.decision || ''; // 미판정은 제품 HOLD와 별개
    if (!getRows(ss,'products').some(p=>p.product_id===productId)) throw Object.assign(Error('알 수 없는 제품번호입니다.'),{code:'VALIDATION'});
    if(getRows(ss,'inspections').some(i=>i.inspection_id===inspectionId)) throw Object.assign(Error('중복 검사번호입니다.'),{code:'CONFLICT'});
    const resolvedImages = (item.images||[]).map(img=>{
      const url=typeof img==='string'?img:img.image_url||img.url;
      const photo=getRows(ss,'photos').find(p=>'/api/drive-photos/'+p.image_id===url);
      if(!photo)throw Object.assign(Error('저장된 Drive 사진만 연결할 수 있습니다.'),{code:'VALIDATION'});
      return {...photo,image_url:url};
    });

    // 1. inspections 탭 기록
    appendRow(ss, 'inspections', {
      inspection_id: inspectionId,
      product_id: productId,
      inspected_at: inspectedAt,
      initial_weight_g: weightG !== null ? weightG : '',
      initial_decision: initialDecision,
      // Version 0 at registration, as in the mock store; each saved change (judgment or edit) adds 1.
      content_version: 0,
      created_at: now.toISOString()
    });

    // 2. inspection_images 탭 기록 (여러 사진 묶음 지원)
    const images = resolvedImages;
    for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
      const img = images[imgIdx];
      const imageId = img.image_id;
      appendRow(ss, 'inspection_images', {
        image_id: imageId,
        inspection_id: inspectionId,
        image_url: img.image_url,
        drive_file_id: img.drive_file_id || '',
        sha256: img.sha256 || '',
        active: 1,
        created_at: now.toISOString()
      });
    }

    createdInspections.push({
      inspection_id: inspectionId,
      product_id: productId,
      inspected_at: inspectedAt,
      weight_g: weightG,
      decision: initialDecision,
      content_version: 0,
      images_count: images.length
    });
  }

  return {
    created_count: createdInspections.length,
    inspections: createdInspections
  };
}

/**
 * Quality Dashboard Home Data
 */
function handleHomeGet(ss, payload) {
  // Every inspection with its current inspection time and judgment, from one read of each tab (readInspections).
  const inspections = readInspections(ss);
  const drafts = getRows(ss, 'ai_drafts');
  const links = getRows(ss, 'evidence_links');

  let latestDate = '';
  if (payload && payload.date) {
    latestDate = payload.date;
  } else if (inspections.length > 0) {
    const dates = inspections.map(i => String(i.inspected_at || '').slice(0, 10)).filter(Boolean);
    dates.sort();
    latestDate = dates[dates.length - 1] || '2026-10-01';
  } else {
    latestDate = '2026-10-01';
  }

  // Filter inspections on selected date
  const dayInspections = inspections.filter(i => String(i.inspected_at || '').startsWith(latestDate));

  let totalCount = dayInspections.length;
  let ngCount = 0;
  let holdCount = 0;
  let pendingCount = 0;

  for (const insp of dayInspections) {
    // The registered decision.
    if (insp.decision === 'NG') ngCount++;
    if (insp.decision === 'HOLD') holdCount++;
    // Waiting for review, by the same rule as the list's review filter (the '검토 대기' card opens that list).
    if (reviewState(insp, drafts, links).is_pending) pendingCount++;
  }

  const result = {
    latest_date: latestDate,
    metrics: {
      total: totalCount,
      ng: ngCount,
      hold: holdCount,
      pending: pendingCount
    },
    scope: '교육용; 출하 승인 아님'
  };
  // The home's first card page for this date, by the list's own rules over the tabs read above,
  // so the screen does not need a second web app call (inspections.list) to draw it.
  // Left out on purpose when the list fails (a draft row with broken result JSON): the counts still answer,
  // and the screen asks inspections.list, which shows that failure under the cards.
  try { result.first_page = listInspections(inspections, drafts, links, { date: latestDate, page: 1, pageSize: 6 }); } catch (_) {}
  return result;
}

// Source-check statuses a saved evidence_links row can carry; nothing in this app writes one yet.
const REVIEW_NEEDED_STATUSES = ['REVIEW_NEEDED_BY_USER', 'MOCK_REVIEW_NEEDED'];
const REVIEWED_STATUSES = ['VERIFIED_BY_USER', 'MOCK_USER_REVIEWED', 'VERIFIED'];

// 다시 판독 필요(stale): the product, weight or photos the AI saw (the draft's input_snapshot) differ from the inspection
// now. A judgment, a memo or the inspection time are not AI input. The mock store has the same function.
function draftOutdated(seen, now) {
  const weight = w => w === null || w === undefined || w === '' ? null : Number(w);
  const photos = list => (list || []).map(i => String(i.image_id)).sort().join(',');
  return seen.product_id !== now.product_id || weight(seen.weight_g) !== weight(now.weight_g) || photos(seen.images) !== photos(now.images);
}

// Report review state of an inspection's latest draft, the same rule as the mock store (src/gas-transport.ts).
// A source check saved for that draft is the review; with none saved, every current draft waits for review.
// stale: the AI input changed since the draft (draftOutdated); needs_check: the last check is '검토 필요';
// reviewed: it is '일치'; pending: no check yet. Stale, needs_check and pending wait; no draft is no_draft and does not.
// current is the inspection as handleInspectionsGet gives it.
function reviewState(current, drafts, links) {
  const own = drafts.filter(d => d.inspection_id === current.inspection_id);
  const draft = own[own.length - 1];
  if (!draft) return {review_state: 'no_draft', is_pending: false};
  if (draftOutdated(JSON.parse(draft.input_snapshot || '{}'), current)) return {review_state: 'stale', is_pending: true};
  const checks = links.filter(l => String(l.draft_id) === String(draft.draft_id) && String(l.inspection_id) === String(current.inspection_id) &&
    (REVIEW_NEEDED_STATUSES.indexOf(l.status) >= 0 || REVIEWED_STATUSES.indexOf(l.status) >= 0));
  const last = checks[checks.length - 1];
  if (!last) return {review_state: 'pending', is_pending: true};
  if (REVIEW_NEEDED_STATUSES.indexOf(last.status) >= 0) return {review_state: 'needs_check', is_pending: true};
  return {review_state: 'reviewed', is_pending: false};
}

/**
 * Inspections List (검색, 필터, 페이징 지원)
 */
function handleInspectionsList(ss, payload) {
  // Each tab is read once and grouped per inspection in memory (readInspections), not once per inspection.
  const drafts = getRows(ss, 'ai_drafts');
  const links = getRows(ss, 'evidence_links');
  return listInspections(readInspections(ss), drafts, links, payload);
}

// The list rows, filters, order and page from tabs already read (handleInspectionsList, and handleHomeGet's first page).
function listInspections(inspections, drafts, links, payload) {
  let filtered = inspections.map(view => {
    const own = drafts.filter(d => d.inspection_id === view.inspection_id);
    const latestDraft = own[own.length - 1];
    let aiStatus = '미판독';
    if (latestDraft) {
      const res = latestDraft.result ? JSON.parse(latestDraft.result) : {};
      aiStatus = res.is_mock ? '모의 초안 — 실제 미판독' : res.decision ? `AI ${res.decision}` : '판독 완료';
    }

    return {
      inspection_id: view.inspection_id,
      product_id: view.product_id,
      product_name: view.product_name,
      color: view.color,
      inspected_at: view.inspected_at,
      weight_g: view.weight_g,
      decision: view.decision,
      content_version: view.content_version,
      image_url: view.images[0]?.image_url || '/media/sample.jpg',
      images_count: view.images.length,
      ai_status: aiStatus,
      ...reviewState(view, drafts, links)
    };
  });

  // Filter by date
  if (payload && payload.date) {
    filtered = filtered.filter(i => String(i.inspected_at).startsWith(payload.date));
  }
  // Filter by decision
  if (payload && payload.decision) {
    filtered = filtered.filter(i => i.decision === payload.decision);
  }
  // Reports waiting for review (the home "검토 대기" card), as in the mock store.
  if (payload && payload.review === 'pending') {
    filtered = filtered.filter(i => i.is_pending);
  }
  // Filter by search query
  if (payload && payload.search) {
    const q = String(payload.search).toLowerCase();
    filtered = filtered.filter(i =>
      i.inspection_id.toLowerCase().includes(q) ||
      i.product_name.toLowerCase().includes(q) ||
      i.color.toLowerCase().includes(q)
    );
  }

  filtered.sort((a, b) => String(b.inspected_at).localeCompare(String(a.inspected_at)));

  const page = Math.max(1, Number(payload?.page) || 1);
  const pageSize = Math.max(1, Number(payload?.pageSize) || 12);
  const totalCount = filtered.length;
  const startIndex = (page - 1) * pageSize;
  const pageItems = filtered.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize) || 1
  };
}

/**
 * Inspection Detail
 */
function handleInspectionsGet(ss, payload) {
  const id = payload?.id;
  if (!id) {
    const err = new Error('검사번호가 지정되지 않았습니다.');
    err.code = 'VALIDATION';
    throw err;
  }
  const found = readInspections(ss).find(i => i.inspection_id === id);
  if (!found) {
    const err = new Error(`검사 기록(${id})이 없습니다.`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  return found;
}

// Every inspection as the detail shows it. Each tab is read once; the rows are grouped per inspection in memory.
function readInspections(ss) {
  const tabs = {};
  for (const tab of ['products', 'inspection_images', 'inspection_defects', 'inspection_updates']) tabs[tab] = getRows(ss, tab);
  return getRows(ss, 'inspections').map(insp => inspectionView(insp, tabs));
}

// One inspection: its current product, time and weight (the latest edit), registered decision, memo, photos and defects.
function inspectionView(insp, tabs) {
  const id = insp.inspection_id;
  const products = tabs.products;
  const prod = products.find(p => p.product_id === insp.product_id) || { product_name: '텀블러', color: '은색', capacity_ml: 500 };

  const images = tabs.inspection_images.filter(img => img.inspection_id === id && img.active != 0);

  const defects = tabs.inspection_defects.filter(d => d.inspection_id === id);
  const updates = tabs.inspection_updates.filter(u => u.inspection_id === id);
  const update = updates[updates.length - 1];
  const effective = update || insp;
  const updatedProduct = products.find(p => p.product_id === effective.product_id) || prod;
  const measurement = update ? update.weight_g : insp.initial_weight_g;

  return {
    inspection_id: insp.inspection_id,
    product_id: effective.product_id,
    product_name: updatedProduct.product_name,
    color: updatedProduct.color,
    inspected_at: effective.inspected_at,
    weight_g: measurement !== '' && measurement !== null ? Number(measurement) : null,
    // The latest edit's memo, as in the mock store.
    memo: update ? update.memo : '',
    decision: insp.initial_decision || null,
    content_version: Number(insp.content_version ?? 1),
    original: {
      product_id: insp.product_id,
      inspected_at: insp.inspected_at,
      weight_g: insp.initial_weight_g !== '' ? Number(insp.initial_weight_g) : null,
      decision: insp.initial_decision || null
    },
    images: images.map(img => ({
      image_id: img.image_id,
      image_url: img.image_url,
      drive_file_id: img.drive_file_id,
      sha256: img.sha256
    })),
    defects: defects.map(d => ({ defect_code: d.defect_code })),
    created_at: insp.created_at
  };
}

/**
 * Products List
 */
function handleProductsList(ss) {
  return getRows(ss, 'products');
}

/**
 * Standards Get
 */
function handleStandardsGet(ss, payload) {
  const rev = payload?.revision || 'Rev.A';
  const standards = getRows(ss, 'standards');
  const found = standards.find(s => s.revision === rev);
  if (found) return found;
  throw Object.assign(Error('적용 기준 원문이 없습니다.'),{code:'SETUP_REQUIRED'});
}

/**
 * AI Run Queue
 */
function handleAiRunQueue(ss, payload) {
  const inspectionId = payload?.inspection_id;
  const inspection = handleInspectionsGet(ss, { id: inspectionId });

  const runId = `RUN-${inspectionId}-${Date.now()}`;
  appendRow(ss, 'ai_runs', {
    run_id: runId,
    request_id: payload.request_id || runId,
    inspection_id: inspectionId,
    content_version: inspection.content_version,
    standard_version: payload.revision || 'Rev.A',
    status: 'QUEUED',
    error_type: '',
    created_at: new Date().toISOString()
  });

  return {
    run_id: runId,
    status: 'QUEUED',
    inspection_id: inspectionId
  };
}

/**
 * AI Drafts Get
 */
function handleDraftsGet(ss, payload) {
  const id = payload?.id || payload?.inspection_id;
  const drafts = getRows(ss, 'ai_drafts').filter(d => d.inspection_id === id);
  drafts.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (drafts.length === 0) return null;
  const current=handleInspectionsGet(ss,{id});
  return drafts.map(latest=>{const snapshot=JSON.parse(latest.input_snapshot||'{}');return {
    draft_id: latest.draft_id,
    inspection_id: latest.inspection_id,
    result: latest.result ? JSON.parse(latest.result) : null,
    standard_revision: latest.standard_revision,
    model: latest.model,
    is_mock: !!JSON.parse(latest.result || '{}').is_mock,
    content_version: snapshot.content_version,
    // What the AI saw besides the photos (image_hashes), so two drafts compare on the same inputs as draftOutdated.
    product_id: snapshot.product_id,
    weight_g: snapshot.weight_g,
    prompt: snapshot.prompt || null,
    contract_version: snapshot.contract_version || null,
    safety_hash: typeof snapshot.safety_text==='string'&&snapshot.safety_text?hashString(snapshot.safety_text):null,
    standard_hash:latest.standard_hash||'',
    image_hashes:snapshot.images?.map(p=>p.sha256)||[],
    stale: draftOutdated(snapshot, current),
    created_at: latest.created_at
  };});
}
