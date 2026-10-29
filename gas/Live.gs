// Actual Google storage. No simulated results or public Drive links.
function configureLiveResources(ss,payload) {
  handleInitResources(ss);
  const props=PropertiesService.getScriptProperties();
  if(!props.getProperty('DRIVE_FOLDER_ID'))props.setProperty('DRIVE_FOLDER_ID',DriveApp.createFolder('텀블러 공장 품질검사 사진').getId());
  for(const product of (payload.products||[]))if(!getRows(ss,'products').some(p=>p.product_id===product.product_id))appendRow(ss,'products',product);
  // Only missing codes are added, so an existing sheet is filled on the next initialize.
  for(const defect of (payload.defect_codes||[]))if(!getRows(ss,'defect_codes').some(d=>d.defect_code===defect.defect_code))appendRow(ss,'defect_codes',defect);
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
  return {storage_provider:'gas',spreadsheet_id:ss.getId(),drive_folder_id:folder};
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
