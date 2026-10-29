// Learners edit natural-language text, not variables, JSON, or authentication.
let settingsGeneration=0;
let editorDirty=false;
const kindNames={gemini:'Gemini 판독 지시'};
// Times are stored in UTC; the screen shows Korean time as YYYY-MM-DD HH:mm, and anything that is not a date as stored.
export function kstTime(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : (value || '');
}
function label(p){return p.base_version+(p.is_default?' · 기본 원문':p.prompt_version_id?.startsWith('BASE-')?' · 이전 기본 원문':' · 수정본 '+kstTime(p.created_at));}
// Historical defaults remain available to saved results, not to new selections.
function selectablePrompts(versions){return versions.filter(p=>p.is_default||!p.prompt_version_id?.startsWith('BASE-'));}
export async function loadPromptSettings(host,{api,el,setFormDirty}){
  const generation=++settingsGeneration;host.replaceChildren(el('p','자연어 지시문을 불러오는 중입니다.','muted'));
  const current=()=>generation===settingsGeneration;
  const panels=[];
  try{
    const {versions}=await api('/api/prompts?kind=gemini');if(generation!==settingsGeneration)return;
    host.replaceChildren(el('h2','자연어 지시문과 검사기준'),el('p','지시문을 저장한 뒤 검사 상세에서 선택해 실행하세요. 저장만으로 AI를 호출하지 않습니다.','muted'));
    for(const kind of ['gemini']){
      const card=el('section',undefined,'panel prompt-editor');card.append(el('h3',kindNames[kind]));
      const select=el('select'),selectLabel=el('label','저장된 버전');select.setAttribute('aria-label',kindNames[kind]+' 버전');selectLabel.append(select);
      const text=el('textarea'),textLabel=el('label','자연어 원문');text.rows=12;text.maxLength=5000;text.setAttribute('aria-label',kindNames[kind]+' 원문');textLabel.append(text);
      const status=el('p','', 'muted');status.setAttribute('role','status');
      const save=el('button','수정본 저장','btn-action primary');save.type='button';save.disabled=true;
      let rows=selectablePrompts(versions).filter(p=>p.kind===kind),selected,saving=false,saveId=null;
      const state={dirty:false};panels.push(state);
      const dirty=()=>{if(!current())return;editorDirty=panels.some(p=>p.dirty);setFormDirty(editorDirty);};
      const options=()=>{select.replaceChildren();for(const p of rows){const o=el('option',label(p));o.value=p.prompt_version_id;select.append(o);}};
      const choose=p=>{selected=p;select.value=p.prompt_version_id;text.value=p.text;state.dirty=false;dirty();save.disabled=true;status.textContent='저장된 원문입니다. 기본 버전 '+p.base_version;};
      options();choose(rows.find(p=>p.is_default&&p.base_version==='v3'));
      select.onchange=()=>{if(state.dirty&&!window.confirm('저장하지 않은 수정 내용을 버리고 버전을 바꿀까요?')){select.value=selected.prompt_version_id;return;}choose(rows.find(p=>p.prompt_version_id===select.value));};
      text.oninput=()=>{state.dirty=text.value!==selected.text;saveId=null;dirty();save.disabled=!state.dirty||!text.value.trim()||saving;status.textContent=state.dirty?'수정 중입니다. 저장하기 전에는 판독에 사용되지 않습니다.':'저장된 원문입니다.';};
      save.onclick=async()=>{
        if(!current()||saving||!state.dirty)return;saving=true;save.disabled=true;select.disabled=true;text.disabled=true;saveId??=crypto.randomUUID();status.textContent='수정본을 저장하는 중입니다.';
        try{const p=await api('/api/prompts/'+kind+'/versions',{method:'POST',headers:{'X-Request-Id':saveId},body:JSON.stringify({base_version:selected.base_version,text:text.value})});if(!current())return;rows.push(p);options();choose(p);status.textContent='새 버전으로 저장했습니다. 이전 원문과 결과는 유지됩니다.';}
        catch(e){if(current())status.textContent='저장 실패: '+e.message+' 같은 내용으로 다시 저장할 수 있습니다.';}
        finally{saving=false;if(current()){select.disabled=false;text.disabled=false;save.disabled=!state.dirty;}}
      };
      card.append(selectLabel,textLabel,save,status);host.append(card);
    }
    const standard=el('section',undefined,'panel prompt-editor');standard.append(el('h3','검사기준 · 읽기 전용'));
    const select=el('select');select.setAttribute('aria-label','검사기준 버전');for(const v of ['Rev.A','Rev.B']){const o=el('option',v);o.value=v;select.append(o);}
    const body=el('div',undefined,'prompt-natural-text');let sequence=0;
    const refresh=async()=>{const n=++sequence;body.textContent='검사기준을 불러오는 중입니다.';try{const r=await api('/api/standards/'+select.value);if(n===sequence)body.textContent=r.natural_text;}catch(e){if(n===sequence)body.textContent='검사기준 조회 실패: '+e.message;}};
    select.onchange=refresh;standard.append(select,body);host.append(standard);void refresh();
  }catch(e){if(generation!==settingsGeneration)return;const retry=el('button','지시문 다시 조회');retry.onclick=()=>loadPromptSettings(host,{api,el,setFormDirty});host.replaceChildren(el('p','지시문 조회 실패: '+e.message,'error'),retry);}
}
export function resetPromptEditors(){settingsGeneration++;editorDirty=false;}
export async function promptChoice(host,kind,{api,el,inspectionId,revision,getRevision,expectedVersion,current=()=>true}){
  const box=el('div',undefined,'prompt-choice'),select=el('select'),name=el('label','다음 실행에 사용할 '+kindNames[kind]);name.append(select);
  const details=el('details'),summary=el('summary','전달 내용 보기'),preview=el('div',undefined,'prompt-natural-text');details.append(summary,preview);
  const status=el('p','저장된 지시문을 조회하는 중입니다.','muted');status.setAttribute('role','status');box.append(name,status,details);host.append(box);
  let selected=null,rows=[],sequence=0;
  async function show(){const seq=++sequence;preview.replaceChildren(el('p','전달 내용을 확인하는 중입니다.'));try{
    const params=new URLSearchParams({kind,prompt_version_id:selected.prompt_version_id,revision:getRevision?.()||revision});
    if(Number.isSafeInteger(expectedVersion))params.set('expected_version',String(expectedVersion));
    const p=await api('/api/inspections/'+encodeURIComponent(inspectionId)+'/prompt-preview?'+params);
    if(seq!==sequence||!current())return;
    preview.replaceChildren();for(const [key,title]of [['instruction','지시문'],['inspection','검사 정보'],['standard','적용 검사기준']])preview.append(el('h4',title),el('p',p[key]));
  }catch(e){if(seq===sequence&&current())preview.replaceChildren(el('p','전달 내용 조회 실패: '+e.message,'error'));}}
  details.ontoggle=()=>{if(details.open&&selected)void show();};
  async function load(){status.textContent='저장된 지시문을 조회하는 중입니다.';try{
    const r=await api('/api/prompts?kind='+kind);if(!current())return;rows=selectablePrompts(r.versions);select.replaceChildren();
    for(const p of rows){const o=el('option',label(p));o.value=p.prompt_version_id;select.append(o);}
    selected=rows.find(p=>p.is_default&&p.base_version==='v3');if(!selected)throw Error('기본 v3 원문이 없습니다.');select.value=selected.prompt_version_id;status.textContent='선택은 다음 실행에만 적용됩니다. 저장된 결과는 바뀌지 않습니다. 원문 수정은 설정에서 할 수 있습니다.';
  }catch(e){selected=null;status.textContent='지시문 조회 실패: '+e.message;const retry=el('button','지시문 다시 조회');retry.onclick=load;box.append(retry);}}
  select.onchange=()=>{selected=rows.find(p=>p.prompt_version_id===select.value);if(details.open)void show();};
  await load();return {id:()=>selected?.prompt_version_id,refresh:()=>{if(details.open&&selected)void show();}};
}
export function comparisonStatus(a,b){
  if(!a||!b||!a.draft_id||!b.draft_id||String(a.draft_id)===String(b.draft_id))return 'same';
  const complete=d=>d.is_mock===false&&d.result?.is_mock!==true&&d.prompt&&
    Number.isSafeInteger(d.content_version)&&d.content_version>=0&&
    ['inspection_id','standard_revision','standard_hash','model','contract_version','safety_hash'].every(k=>typeof d[k]==='string'&&d[k].length>0)&&
    Array.isArray(d.image_hashes)&&d.image_hashes.length>0&&d.image_hashes.every(h=>typeof h==='string'&&h.length>0);
  if(!complete(a)||!complete(b))return 'unverified';
  // Same AI input as draftOutdated uses (product, weight, photos); a judgment between the runs does not matter.
  return a.inspection_id===b.inspection_id&&a.product_id===b.product_id&&a.weight_g===b.weight_g&&
    a.standard_revision===b.standard_revision&&a.standard_hash===b.standard_hash&&
    a.model===b.model&&a.contract_version===b.contract_version&&a.safety_hash===b.safety_hash&&
    JSON.stringify(a.image_hashes)===JSON.stringify(b.image_hashes)?'comparable':'different';
}
export function draftComparison(host,drafts,{el}){
  const details=el('details',undefined,'prompt-comparison');details.append(el('summary','판독 이력과 결과 비교'));
  const note=el('p','같은 사진·측정값·검사기준으로 실행한 결과만 프롬프트 비교로 볼 수 있습니다.','muted');details.append(note);
  const selectors=el('div',undefined,'prompt-compare-selectors'),output=el('div',undefined,'prompt-compare-results');
  const selects=['첫 번째 결과','두 번째 결과'].map((title,index)=>{const labelNode=el('label',title),s=el('select');drafts.forEach((d,n)=>{const p=d.prompt;const o=el('option',(p?label(p):'이전 실행 — 버전 기록 없음')+' · '+kstTime(d.created_at));o.value=String(n);s.append(o);});s.value=String(Math.min(index,drafts.length-1));labelNode.append(s);selectors.append(labelNode);return s;});
  const render=()=>{output.replaceChildren();const pair=selects.map(s=>drafts[Number(s.value)]);if(!pair.every(Boolean))return;
    const [a,b]=pair;const status=comparisonStatus(a,b);
    note.textContent={same:'비교하려면 서로 다른 판독 결과 두 건을 선택하세요.',unverified:'모의 결과이거나 실행 조건 기록이 부족해 프롬프트 비교를 확인할 수 없습니다. 결과를 참고용으로 표시합니다.',different:'입력이나 실행 조건이 달라 프롬프트만의 효과로 비교할 수 없습니다. 결과를 참고용으로 표시합니다.',comparable:'같은 사진·측정값·검사기준·모델·안전 지침의 결과입니다. 지시문과 결과의 차이를 비교하세요.'}[status];
    for(const d of pair){const section=el('section',undefined,'panel');section.append(el('h4',d.prompt?label(d.prompt):'이전 실행 — 버전 기록 없음'));const mock=d.is_mock||d.result?.is_mock||d.status==='MOCK_COMPLETED';section.append(el('p',mock?'모의 결과 — 실제 판독 아님':d.is_mock===false||d.result?.is_mock===false?'실제 판독 결과':'이전 결과 — 실행 방식 확인 필요','muted'));for(const k of ['판정','불량유형','관찰·수치 근거','적용 기준과 출처','권고 조치','사람 승인 필요 여부'])section.append(el('h5',k),el('p',d.result?.[k]||'기록 없음'));if(d.prompt){const original=el('details');original.append(el('summary','실행한 지시문 원문'),el('p',d.prompt.text,'prompt-natural-text'));section.append(original);}output.append(section);}
  };selects.forEach(s=>s.onchange=render);details.append(selectors,output);host.append(details);render();
}
