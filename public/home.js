import {api,el,setListDate,navigate} from './app.js';

const get=id=>typeof document!=='undefined'?document.getElementById(id):null;
let user=null,date='',request=0,recordsRequest=0,homePage=1,homeMetricFilter='';

export function clearHome(){
 user=null;
 request++;
 recordsRequest++;
 homePage=1;
 homeMetricFilter='';
 const panel=get('home-panel');if(panel)panel.hidden=true;
 const homeCards=get('home-records-cards');if(homeCards)homeCards.replaceChildren();
 for(const k of ['total','ng','hold','pending']){
  const elMetric=get('home-'+k);if(elMetric)elMetric.textContent='—';
 }
 setListDate('');
 closeAllHelp();
}

export async function initializeHome(account,{load=true}={}){
 user=account;
 date='';
 homePage=1;
 homeMetricFilter='';
 const act=get('home-action');
 if(act){
  act.textContent='사진 등록';
  act.onclick=()=>{if(user)navigate('/inspections/new');};
 }
 initHelpControls();
 initHomePagination();
 if(load)await refresh();
}

if(typeof window!=='undefined'&&window.addEventListener){
 window.addEventListener('home-opening',()=>{if(user)void refresh();});
}

function photoThumb(url,alt){
 const img=el('img');
 img.src=url;
 img.alt=alt||'텀블러 외관 검사 사진';
 img.addEventListener('error',()=>img.replaceWith(el('p','사진을 불러오지 못했습니다.','photo-error error')),{once:true});
 return img;
}

async function loadHomeRecords(current=request){
 const cardsContainer=get('home-records-cards');
 if(!cardsContainer)return;
 const currentRecords=++recordsRequest;
 const requestedPage=homePage;
 cardsContainer.replaceChildren(el('p','검사 기록을 불러오는 중입니다.','loading-placeholder'));
 cardsContainer.setAttribute('aria-busy','true');
 for(const id of ['home-prev','home-next']){const button=get(id);if(button)button.disabled=true;}
 const pendingPage=get('home-page-status');if(pendingPage)pendingPage.textContent='조회 중';

 const q=new URLSearchParams({
  page:String(homePage),
  pageSize:'6'
 });
 if(date)q.set('date',date);
 if(homeMetricFilter==='ng')q.set('decision','NG');
 else if(homeMetricFilter==='hold')q.set('decision','HOLD');
 else if(homeMetricFilter==='pending')q.set('review','pending');

 try{
  const res=await api('/api/inspections?'+q.toString());
  if(current!==request||currentRecords!==recordsRequest||!user)return;
  showHomeRecords(cardsContainer,res,requestedPage);
 }catch(err){
  if(current===request&&currentRecords===recordsRequest&&user){
   const retry=el('button','검사 기록 다시 조회');retry.onclick=()=>loadHomeRecords();
   cardsContainer.replaceChildren(el('p','검사 기록을 불러오지 못했습니다: '+err.message,'error'),retry);
   if(pendingPage)pendingPage.textContent='조회 실패';
  }
 }finally{
  if(current===request&&currentRecords===recordsRequest)cardsContainer.setAttribute('aria-busy','false');
 }
}

// One page of /api/inspections (or /api/home's firstPage) as cards, with the page status and buttons.
function showHomeRecords(cardsContainer,res,requestedPage){
  cardsContainer.replaceChildren();

  for(const r of res.rows){
   const card=el('article',undefined,'product recent-product-card');
   if(r.image_url)card.append(photoThumb(r.image_url,r.inspection_id+' 외관 사진'));
   const body=el('div');
   const title=el('h3',r.inspection_id);
   const prod=el('p',r.product_name);
   const decisionLabel={OK:'정상',NG:'불량',HOLD:'보류'}[r.decision]||'미판정';
   const desc=el('p',(r.weight_g===null?'미측정':r.weight_g+' g')+' · '+decisionLabel,'decision '+(r.decision||'UNJUDGED'));
   const btn=el('button','상세 보기');
   btn.setAttribute('type','button');
   btn.setAttribute('aria-label',r.inspection_id+' 상세 보기');
   btn.onclick=()=>navigate('/inspections/'+encodeURIComponent(r.inspection_id));
   body.append(title,prod,desc,btn);
   card.append(body);
   cardsContainer.append(card);
  }

  if(!res.rows.length){
   cardsContainer.append(el('p','해당 조건의 검사 기록이 없습니다.','muted'));
  }

  const pageStatus=get('home-page-status');
  if(pageStatus)pageStatus.textContent=requestedPage+' / '+Math.max(1,Math.ceil(res.total/6));
  const prev=get('home-prev');
  if(prev)prev.disabled=homePage<=1;
  const next=get('home-next');
  if(next)next.disabled=homePage*6>=res.total;
}

function initHomePagination(){
 const prev=get('home-prev'),next=get('home-next');
 if(prev){
  prev.onclick=async()=>{
   if(homePage>1){
    homePage--;
    await loadHomeRecords(request);
   }
  };
 }
 if(next){
  next.onclick=async()=>{
   homePage++;
   await loadHomeRecords(request);
  };
 }
}

async function refresh(){
 if(!user)return;
 const current=++request;
 recordsRequest++;
 // While /api/home is out, 새로고침 and 재시도 would only queue the same request behind it in GAS.
 const buttons=['home-refresh','home-retry'].map(get).filter(Boolean);
 for(const b of buttons)b.disabled=true;
 const status=get('home-status');
 if(status){
  status.className='';
  status.textContent='품질 현황을 불러오는 중입니다.';
 }
 const retry=get('home-retry');if(retry)retry.hidden=true;
 const homeCards=get('home-records-cards');if(homeCards)homeCards.replaceChildren(el('p','집계일 확인 후 검사 기록을 불러옵니다.','loading-placeholder'));

 if(typeof document!=='undefined'&&document.querySelectorAll){
  for(const b of document.querySelectorAll('[data-metric]'))b.disabled=true;
 }
 for(const k of ['total','ng','hold','pending']){
  const elMetric=get('home-'+k);if(elMetric)elMetric.textContent='—';
 }

 try{
  const data=await api('/api/home'+(date?'?date='+encodeURIComponent(date):''));
  if(current!==request||!user)return;
  date=data.date||'';
  const dateInput=get('home-date');if(dateInput)dateInput.value=date;
  setListDate(date);

  for(const [k,v] of Object.entries(data.counts)){
   const elMetric=get('home-'+k);
   if(elMetric)elMetric.textContent=Number(v).toLocaleString('ko-KR');
  }

  if(typeof document!=='undefined'&&document.querySelectorAll){
   for(const b of document.querySelectorAll('[data-metric]'))b.disabled=!date;
  }

  if(status){
   status.textContent=data.counts.total
    ? date+' 기준 품질 현황입니다. 확인이 필요한 항목이나 수치 카드를 눌러 필터링하세요.'
    : date
    ? '선택하신 일자('+date+')에는 검사 기록이 없습니다. 다른 일자를 선택하거나 사진 등록을 실행해 주세요.'
    : '아직 등록된 검사 기록이 없습니다. 상단의 사진 등록 버튼을 눌러 첫 검사를 등록해 주세요.';
  }

  // The live GAS sends the first card page with the counts. A filter or another page, an older GAS,
  // the mock store asks /api/inspections as before.
  const cards=get('home-records-cards');
  if(data.firstPage&&homePage===1&&!homeMetricFilter&&cards){
   recordsRequest++;
   showHomeRecords(cards,data.firstPage,1);
   cards.setAttribute('aria-busy','false');
  }else void loadHomeRecords(current);
 }catch(e){
  if(current!==request||!user)return;
  if(status){
   status.className='error';
   status.textContent='품질 현황 조회에 실패했습니다: '+e.message;
  }
  if(retry)retry.hidden=false;
  if(homeCards)homeCards.replaceChildren(el('p','집계일을 확인하지 못했습니다. 위의 재시도 버튼을 눌러 주세요.','error'));
 }finally{
  // A newer refresh (a date change) keeps them off until its own answer.
  if(current===request)for(const b of buttons)b.disabled=false;
 }
}

// Typing a year digit by digit changes the value at every valid date (0002, 0020, 0202, 2026), and each change
// used to send /api/home; GAS ran them all in turn. Only the value left after a short pause is asked for,
// and the date already shown is not asked for again.
const DATE_SETTLE_MS=400;
let dateTimer=null;
const datePicker=get('home-date');
if(datePicker){
 datePicker.onchange=()=>{
  // The value picked now: a /api/home answer that lands during the pause rewrites the input with its own date.
  const picked=datePicker.value;
  clearTimeout(dateTimer);
  dateTimer=setTimeout(()=>{
   if(picked===date)return;
   date=picked;homePage=1;refresh();
  },DATE_SETTLE_MS);
 };
}
const refreshBtn=get('home-refresh');
if(refreshBtn)refreshBtn.onclick=()=>{homePage=1;refresh();};
const retryBtn=get('home-retry');
if(retryBtn)retryBtn.onclick=()=>{homePage=1;refresh();};

async function selectMetric(metric){
 homeMetricFilter=(homeMetricFilter===metric)?'':metric;
 homePage=1;

 if(typeof document!=='undefined'&&document.querySelectorAll){
  for(const b of document.querySelectorAll('[data-metric]')){
   b.setAttribute('aria-pressed',String(b.dataset.metric===homeMetricFilter));
  }
 }

 const s=get('search'),d=get('decision-filter'),r=get('review-filter');
 if(s)s.value='';
 if(d)d.value=homeMetricFilter==='ng'?'NG':homeMetricFilter==='hold'?'HOLD':'';
 if(r)r.value=homeMetricFilter==='pending'?'pending':'';

 await loadHomeRecords(request);
}

if(typeof document!=='undefined'&&document.querySelectorAll){
 for(const b of document.querySelectorAll('[data-metric]')){
  b.onclick=()=>selectMetric(b.dataset.metric);
 }
}

const actionBtn=get('home-action');
if(actionBtn){
 actionBtn.onclick=()=>{
  if(!user)return;
  navigate('/inspections/new');
 };
}

let helpInitialized=false;
function initHelpControls(){
 if(helpInitialized||typeof document==='undefined')return;
 helpInitialized=true;

 const helpBtns=document.querySelectorAll('.metric-help-btn');
 for(const btn of helpBtns){
  const targetId=btn.getAttribute('data-help-target');
  const popover=get(targetId);
  if(!popover)continue;

  const toggle=show=>{
   const willOpen=show!==undefined?show:popover.hidden;
   if(willOpen)closeAllHelp();
   popover.hidden=!willOpen;
   btn.setAttribute('aria-expanded',String(willOpen));
   if(willOpen){
    const closeBtn=popover.querySelector('.help-close-btn');
    if(closeBtn)closeBtn.focus();
   }
  };

  btn.onclick=e=>{
   e.stopPropagation();
   toggle();
  };

  btn.onkeydown=e=>{
   if(e.key==='Enter'||e.key===' '){
    e.preventDefault();
    toggle();
   }else if(e.key==='Escape'){
    toggle(false);
    btn.focus();
   }
  };
 }

 const closeBtns=document.querySelectorAll('.help-close-btn');
 for(const closeBtn of closeBtns){
  closeBtn.onclick=e=>{
   e.stopPropagation();
   const popover=closeBtn.closest('.metric-help-popover');
   if(!popover)return;
   popover.hidden=true;
   const trigger=document.querySelector(`.metric-help-btn[data-help-target="${popover.id}"]`);
   if(trigger){
    trigger.setAttribute('aria-expanded','false');
    trigger.focus();
   }
  };
 }

 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
   closeAllHelp(true);
  }
 });

 document.addEventListener('click',e=>{
  if(!e.target.closest('.metric-box')){
   closeAllHelp();
  }
 });
}

function closeAllHelp(restoreFocus=false){
 if(typeof document==='undefined')return;
 const popovers=document.querySelectorAll('.metric-help-popover');
 for(const p of popovers){
  if(!p.hidden){
   p.hidden=true;
   const trigger=document.querySelector(`.metric-help-btn[data-help-target="${p.id}"]`);
   if(trigger){
    trigger.setAttribute('aria-expanded','false');
    if(restoreFocus)trigger.focus();
   }
  }
 }
}

if(typeof window!=='undefined'){
 window.addEventListener('qc-data-changed',()=>refresh());
}
