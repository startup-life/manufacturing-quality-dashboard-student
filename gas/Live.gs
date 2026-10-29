// Actual Google storage/inference. No simulated results or public Drive links.
function configureLiveResources(ss,payload) {
  // gas:init sends GEMINI_API_KEY from .env; without it the stored key stays. The value never goes into a response or a message.
  let apiKey=null;
  if(payload.gemini_api_key!==undefined) {
    if(typeof payload.gemini_api_key!=='string' || !payload.gemini_api_key || /[\s<>]/.test(payload.gemini_api_key))throw Object.assign(Error('GEMINI_API_KEY 값을 확인하세요. 빈 값, 공백, <…> 자리표시는 받지 않습니다.'),{code:'VALIDATION'});
    apiKey=payload.gemini_api_key;
  }
  // Omitted values keep the stored property (or the GAS default); the merged result is what gets checked.
  const gemini={},props=PropertiesService.getScriptProperties();
  if(payload.gemini_model!==undefined)gemini.GEMINI_MODEL=String(payload.gemini_model);
  if(payload.gemini_fallback_model!==undefined)gemini.GEMINI_FALLBACK_MODEL=String(payload.gemini_fallback_model);
  const merged={};
  for(const key of ['GEMINI_MODEL','GEMINI_FALLBACK_MODEL'])merged[key]=key in gemini?gemini[key]:props.getProperty(key);
  const resolved=geminiResolveSettings(merged),invalid=geminiSettingsError(resolved);
  if(invalid)throw Object.assign(Error(invalid),{code:'VALIDATION'});
  handleInitResources(ss);
  if(Object.keys(gemini).length)props.setProperties(gemini);
  if(apiKey)props.setProperty('GEMINI_API_KEY',apiKey);
  if(!props.getProperty('DRIVE_FOLDER_ID'))props.setProperty('DRIVE_FOLDER_ID',DriveApp.createFolder('텀블러 공장 품질검사 사진').getId());
  for(const product of (payload.products||[]))if(!getRows(ss,'products').some(p=>p.product_id===product.product_id))appendRow(ss,'products',product);
  for(const standard of (payload.standards||[])) {
    if(!standard.revision || !standard.standard_text || standard.sha256!==hashString(standard.standard_text))throw Object.assign(Error('기준 원문 해시 오류'),{code:'VALIDATION'});
    const old=getRows(ss,'standards').find(s=>s.revision===standard.revision);
    if(old && old.sha256!==standard.sha256)throw Object.assign(Error('동일 버전 기준은 덮어쓰지 않습니다.'),{code:'CONFLICT'});
    if(!old)appendRow(ss,'standards',{...standard,created_at:new Date().toISOString()});
  }
  return liveConnectionStatus(ss);
}

function ensureLiveHeaders(ss) {
  const extra = {
    ai_runs: ['started_at','finished_at','error_message','input_snapshot','image_hashes','standard_hash','draft_id','model','fallback_from'],
    inspection_images: ['mime'],
    photos: ['image_id','drive_file_id','sha256','mime','created_at'],
    inspection_updates: ['update_id','inspection_id','content_version','product_id','inspected_at','weight_g','memo','change_reason','created_at'],
    inspection_records: ['change_reason'],
    standards: ['rules_json']
    ,evidence_queries: ['result_json']
    ,review_events: ['event_id','draft_id','reviewer_id','reviewer_name','state','note','created_at']
    ,evidence_links: ['evidence_id','source_url','source_title','source_locator','evidence_text','evidence_sha256','verified_by_user','created_at','query_id']
  };
  for (const tab in extra) ensureHeaderColumns(ss, tab, extra[tab]);
}

// appendRow writes only columns that have a header, so a column added later must be appended to existing sheets first.
function ensureHeaderColumns(ss, tab, names) {
  let sheet = ss.getSheetByName(tab);
  if (!sheet) sheet = ss.insertSheet(tab);
  const count = sheet.getLastColumn();
  const headers = count ? sheet.getRange(1,1,1,count).getValues()[0] : [];
  const missing = names.filter(h => headers.indexOf(h) < 0);
  if (missing.length) sheet.getRange(1,count+1,1,missing.length).setValues([missing]);
}

function updateLiveRow(ss, tab, key, id, patch) {
  const sheet = ss.getSheetByName(tab), values = sheet.getDataRange().getValues(), headers = values[0];
  const index = headers.indexOf(key);
  for (let r=1;r<values.length;r++) if (String(values[r][index]) === String(id)) {
    // Do not rewrite original cells: Sheets can auto-convert untouched date text.
    for (const k in patch) { const c=headers.indexOf(k); if(c>=0) sheet.getRange(r+1,c+1).setValue(sanitize(patch[k])); }
    return;
  }
  throw Error('수정할 기록이 없습니다.');
}

function liveConnectionStatus(ss) {
  const props=PropertiesService.getScriptProperties();
  const folder=props.getProperty('DRIVE_FOLDER_ID');
  if (!folder) throw Object.assign(Error('사진 저장소 설정이 없습니다.'),{code:'SETUP_REQUIRED'});
  DriveApp.getFolderById(folder).getName();
  // The models the next run uses, for the startup line and the settings card. Invalid stored values report null
  // here; queueing refuses them with the Script Properties message.
  const values=geminiResolveSettings({GEMINI_MODEL:props.getProperty('GEMINI_MODEL'),GEMINI_FALLBACK_MODEL:props.getProperty('GEMINI_FALLBACK_MODEL')});
  const valid=!geminiSettingsError(values);
  return {storage_provider:'gas',spreadsheet_id:ss.getId(),drive_folder_id:folder,
    gemini_ready:geminiKeyReady(props),
    gemini_model:valid?values.GEMINI_MODEL:null,
    gemini_fallback_model:valid?geminiFallbackModel({model:values.GEMINI_MODEL,fallback_model:values.GEMINI_FALLBACK_MODEL}):null};
}

function storeLivePhoto(ss,payload,requestId) {
  if (payload.mime!=='image/jpeg' || typeof payload.data_base64!=='string' || payload.data_base64.length>5600000) throw Object.assign(Error('정규화 JPEG 사진이 필요합니다.'),{code:'VALIDATION'});
  const bytes=Utilities.base64Decode(payload.data_base64);
  if (!bytes.length || bytes.length>4194304) throw Object.assign(Error('사진은 4MB 이하만 저장합니다.'),{code:'VALIDATION'});
  const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
  // Stable name recovers an orphaned Drive file after a Sheets write interruption.
  const id='PHOTO-'+hashString(requestId).slice(0,32), folder=DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID'));
  const existing=getRows(ss,'photos').find(p=>p.image_id===id);
  if (existing && existing.sha256!==hash) throw Object.assign(Error('동일 사진 요청의 내용이 다릅니다.'),{code:'CONFLICT'});
  let file;
  const named=folder.getFilesByName(id+'.jpg');
  if(named.hasNext()) {
    file=named.next();
    const found=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,file.getBlob().getBytes()).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
    if(found!==hash) throw Object.assign(Error('사진 해시가 일치하지 않습니다.'),{code:'CONFLICT'});
  } else file=folder.createFile(Utilities.newBlob(bytes,'image/jpeg',id+'.jpg'));
  if (!existing) appendRow(ss,'photos',{image_id:id,drive_file_id:file.getId(),sha256:hash,mime:'image/jpeg',created_at:new Date().toISOString()});
  return {image_id:id,image_url:'/api/drive-photos/'+id,drive_file_id:file.getId(),sha256:hash,drive_status:'stored_private',mime:'image/jpeg'};
}

function getLivePhoto(ss,payload) {
  const photo=getRows(ss,'photos').find(p=>p.image_id===payload.image_id);
  if (!photo) throw Object.assign(Error('등록된 사진이 없습니다.'),{code:'NOT_FOUND'});
  const blob=DriveApp.getFileById(photo.drive_file_id).getBlob();
  return {mime:photo.mime,data_base64:Utilities.base64Encode(blob.getBytes()),sha256:photo.sha256};
}

function liveAiRuns(ss,payload) {
  for (const run of getRows(ss,'ai_runs')) if (run.inspection_id===payload.inspection_id && run.status==='PROCESSING' && Date.parse(run.started_at)<Date.now()-420000) {
    const draft=getRows(ss,'ai_drafts').find(d=>d.run_id===run.run_id);
    updateLiveRow(ss,'ai_runs','run_id',run.run_id,draft ? {status:'SUCCEEDED',draft_id:draft.draft_id} : {status:'UNKNOWN',error_type:'INTERRUPTED',error_message:'실행 중단 또는 결과 저장 유실입니다. 자동 재호출하지 않습니다.'});
  }
  return getRows(ss,'ai_runs').filter(r=>r.inspection_id===payload.inspection_id && (!payload.run_id || r.run_id===payload.run_id)).reverse().map(r=>({
    run_id:r.run_id,status:r.status,content_version:Number(r.content_version),standard_revision:r.standard_version,
    error_code:r.error_type,error_message:r.error_message,draft_id:r.draft_id,model:r.model||null,fallback_from:r.fallback_from||null,created_at:r.created_at,finished_at:r.finished_at,is_mock:false
  }));
}

function queueLiveAi(ss,payload,requestId,expectedVersion) {
  const props=PropertiesService.getScriptProperties(), gemini=geminiScriptSettings(props);
  if (!geminiKeyReady(props)) throw Object.assign(Error('Gemini API 키 설정이 필요합니다. 사진은 보존됐습니다.'),{code:'SETUP_REQUIRED'});
  const inspection=handleInspectionsGet(ss,{id:payload.inspection_id});
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw Object.assign(Error('최신 검사 버전을 확인한 뒤 판독을 요청하세요.'),{code:'VALIDATION'});
  if(expectedVersion!==inspection.content_version)throw Object.assign(Error('검사 자료가 변경됐습니다. 최신 검사 내용을 다시 조회하세요.'),{code:'CONFLICT'});
  const standard=getRows(ss,'standards').find(s=>s.revision===(payload.revision||'Rev.A'));
  if(!standard || !standard.standard_text || standard.sha256!==hashString(standard.standard_text)) throw Object.assign(Error('판독 기준 원문·해시를 확인하세요.'),{code:'SETUP_REQUIRED'});
  if(!inspection.images.length || inspection.images.length>8) throw Object.assign(Error('검사 사진 1~8장이 필요합니다.'),{code:'VALIDATION'});
  const photos=getRows(ss,'photos');
  const images=inspection.images.map(i=>{const p=photos.find(p=>p.image_id===i.image_id);if(!p)throw Object.assign(Error('Drive에 저장되지 않은 사진입니다.'),{code:'CONFLICT'});return p;});
  const prompt=getPromptVersion(ss,'gemini',payload.prompt_version_id);
  const rules=JSON.parse(standard.rules_json||'null');
  const snapshot={inspection_id:inspection.inspection_id,product_id:inspection.product_id,product_name:inspection.product_name,weight_g:inspection.weight_g,content_version:inspection.content_version,standard_revision:standard.revision,standard_text:standard.standard_text,standard_rules:rules,standard_natural_text:sourceStandard(standard.standard_text,rules),prompt:{prompt_version_id:prompt.prompt_version_id,base_version:prompt.base_version,kind:prompt.kind,text:prompt.text,sha256:prompt.sha256,is_default:prompt.is_default===true,created_at:prompt.created_at||''},model:gemini.model,fallback_model:geminiFallbackModel(gemini),contract_version:'source-v1',safety_text:GEMINI_SAFETY,images};
  const fingerprint=hashString(JSON.stringify(snapshot));
  const previous=getRows(ss,'ai_runs').find(r=>r.inspection_id===inspection.inspection_id && r.standard_hash===fingerprint && ['QUEUED','PROCESSING','SUCCEEDED'].indexOf(r.status)>=0);
  if(previous)return {run_id:previous.run_id,status:previous.status,is_mock:false};
  const runId='RUN-'+Utilities.getUuid();
  appendRow(ss,'ai_runs',{run_id:runId,request_id:requestId,inspection_id:inspection.inspection_id,content_version:inspection.content_version,standard_version:standard.revision,status:'QUEUED',input_snapshot:JSON.stringify(snapshot),image_hashes:JSON.stringify(images.map(i=>i.sha256)),standard_hash:fingerprint,created_at:new Date().toISOString()});
  SpreadsheetApp.flush();
  return {run_id:runId,status:'QUEUED',is_mock:false};
}

function updateLiveInspection(ss,payload,expectedVersion) {
  const current=handleInspectionsGet(ss,{id:payload.id});
  if(Number(expectedVersion)!==current.content_version)throw Object.assign(Error('자료가 이미 변경되었습니다.'),{code:'CONFLICT'});
  const product=payload.product_id||current.product_id;
  if(!getRows(ss,'products').some(p=>p.product_id===product))throw Object.assign(Error('알 수 없는 제품번호입니다.'),{code:'VALIDATION'});
  const weight=payload.weight_g===undefined?current.weight_g:payload.weight_g;
  if(weight!==null && (!Number.isFinite(Number(weight)) || Number(weight)<0))throw Object.assign(Error('실측 중량을 확인하세요.'),{code:'VALIDATION'});
  const version=current.content_version+1;
  appendRow(ss,'inspection_updates',{update_id:'UPDATE-'+Utilities.getUuid(),inspection_id:current.inspection_id,content_version:version,product_id:product,inspected_at:payload.inspected_at||current.inspected_at,weight_g:weight===null?'':Number(weight),memo:payload.memo||'',change_reason:payload.change_reason||'',created_at:new Date().toISOString()});
  updateLiveRow(ss,'inspections','inspection_id',current.inspection_id,{content_version:version});
  return handleInspectionsGet(ss,{id:current.inspection_id});
}

// Longer than a request's 30 s wait, so a finished Gemini result is saved before the screen's reads that queue behind it.
// Worst case: 15 s claim lock + two Gemini calls (about 60 s each, UrlFetchApp's own limit) + this 60 s wait = 195 s of 360 s.
const RESULT_LOCK_WAIT_MS = 60000;

function executeLiveAi(payload) {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(15000)) throw Error('실행 잠금 대기 중입니다.');
  let ss,run,snapshot;
  try {
    ss=getOrCreateSpreadsheet();
    run=getRows(ss,'ai_runs').find(r=>r.run_id===payload.run_id && r.inspection_id===payload.inspection_id);
    if(!run)throw Error('실행이 없습니다.');
    if(run.status!=='QUEUED')return liveAiRuns(ss,payload)[0];
    snapshot=JSON.parse(run.input_snapshot);
    updateLiveRow(ss,'ai_runs','run_id',run.run_id,{status:'PROCESSING',started_at:new Date().toISOString()});
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  let answer;
  try {
    const images=snapshot.images.map(p=>{
      const blob=DriveApp.getFileById(p.drive_file_id).getBlob(), bytes=blob.getBytes();
      const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
      if(hash!==p.sha256)throw Error('사진 변경');
      return {data:Utilities.base64Encode(bytes),mime:p.mime};
    });
    answer=callGeminiInference(images,snapshot);
  } catch (_) { answer={success:false,error_type:'IMAGE_OR_SERVICE_FAILED',error:'사진 확인 또는 호출 실패입니다. 자동 재호출하지 않습니다.'}; }
  if(!lock.tryLock(RESULT_LOCK_WAIT_MS)) throw Error('결과 저장 잠금 실패');
  try {
    // The model that answered and the main model it replaced, if the fallback answered.
    const patch={finished_at:new Date().toISOString(),model:answer.model||snapshot.model,fallback_from:answer.fallback_from||''};
    if(answer.success) {
      const draftId='DRAFT-'+run.run_id;
      if(!getRows(ss,'ai_drafts').some(d=>d.draft_id===draftId)) appendRow(ss,'ai_drafts',{draft_id:draftId,run_id:run.run_id,inspection_id:run.inspection_id,input_snapshot:run.input_snapshot,result:JSON.stringify(answer.result),standard_revision:run.standard_version,standard_hash:hashString(snapshot.standard_text),model:answer.model||snapshot.model,created_at:patch.finished_at});
      patch.status='SUCCEEDED';patch.draft_id=draftId;
    } else {patch.status='FAILED';patch.error_type=answer.error_type;patch.error_message=answer.error;}
    updateLiveRow(ss,'ai_runs','run_id',run.run_id,patch);SpreadsheetApp.flush();
    return liveAiRuns(ss,payload)[0];
  } finally { lock.releaseLock(); }
}
