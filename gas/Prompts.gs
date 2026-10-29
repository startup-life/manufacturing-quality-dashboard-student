function ensurePromptSheet(ss) {
  let sheet=ss.getSheetByName('prompt_versions');
  if(!sheet)sheet=ss.insertSheet('prompt_versions');
  const headers=['prompt_version_id','kind','base_version','text','sha256','is_default','created_by','created_at'];
  if(sheet.getLastRow()===0)sheet.getRange(1,1,1,headers.length).setValues([headers]);
  sheet.getRange(2,1,Math.max(1,sheet.getMaxRows()-1),headers.length).setNumberFormat('@');
}
function savePromptVersion(ss,payload) {
  if(!['gemini','notebooklm'].includes(payload.kind)||!['v1','v2','v3'].includes(payload.base_version)||typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>5000||hashString(payload.text)!==payload.sha256||!/^((BASE-(gemini|notebooklm)-v[123]-[a-f0-9]{12})|(PV-[a-f0-9]{24}))$/.test(payload.prompt_version_id))throw Object.assign(Error('프롬프트 원문·버전 검증에 실패했습니다.'),{code:'VALIDATION'});
  ensurePromptSheet(ss);
  const existing=getRows(ss,'prompt_versions').find(p=>p.prompt_version_id===payload.prompt_version_id);
  if(existing){if(existing.sha256!==payload.sha256 || existing.kind!==payload.kind || existing.base_version!==payload.base_version || existing.created_by!==payload.created_by)throw Object.assign(Error('같은 저장 번호의 내용이 다릅니다.'),{code:'CONFLICT'});return existing;}
  const row={...payload,created_at:new Date().toISOString()};appendRow(ss,'prompt_versions',row);return row;
}
function getPromptVersion(ss,kind,id) {
  const rows=getRows(ss,'prompt_versions').filter(p=>p.kind===kind);
  const row=id?rows.find(p=>p.prompt_version_id===id):rows.find(p=>p.is_default===true&&p.base_version==='v3');
  if(!row || typeof row.text!=='string'||row.sha256!==hashString(row.text))throw Object.assign(Error('사용할 프롬프트 원문을 확인하세요.'),{code:'VALIDATION'});
  return row;
}
