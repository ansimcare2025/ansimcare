import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {ASSESSMENT_DOMAINS,PUBLIC_CHECKLIST,GUARDIAN_REFLECTION,GUARDIAN_REFLECTION_HINTS} from './assessment-standards.js';
import {getAuth, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, sendPasswordResetEmail, signOut} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// User-accessible only through authenticated Netlify server functions.
// Do not directly read Firestore from this page.
const REGION=window.DJ_REGION_DATA||{};
const ROLENAME={admin:'관리자',facility:'기관 담당자',guardian:'일반 사용자'};
const TITLES={home:'서비스 소개',match:'홍보 참여기관 찾기',elder:'돌봄 필요 정리',observe:'정서·인지 관찰',plans:'기관 전용 홍보 요금·정원',facility:'기관 전용 화면',admin:'기관·계약 관리',criteria:'입점심사 운영기준',standards:'돌봄지음 점검 기준'};
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtWon=n=>Number(n||0).toLocaleString('ko-KR')+'원';
const formValue=id=>$(id)?.value?.trim()||'';
let auth,session={user:null,role:'guest',uid:'',facilityId:''},popup=null,nextPage=null;
// Firebase가 휴대폰 저장소의 기존 로그인 상태를 복원하는 동안은 재로그인을 요구하지 않습니다.
let authRestored=false,pendingProtectedPage=null;
let publicFacilities=[],adminFacilities=[],selectedId='',nextAdminCursor=null,adminRequests=[],fullQuotaRows=[];
function setMessage(id,msg){if($(id))$(id).textContent=msg;}
async function call(action,values={},method='POST'){
  const headers={};let url='/.netlify/functions/api',opts={method,cache:'no-store',headers};
  if(session.user){headers.Authorization='Bearer '+await session.user.getIdToken();}
  if(method==='GET')url+='?'+new URLSearchParams({action,...values});
  else{headers['Content-Type']='application/json';opts.body=JSON.stringify({action,...values});}
  let res;
  try{res=await fetch(url,opts);}catch{throw Error('서버에 연결할 수 없습니다. 사이트 주소와 인터넷 연결을 확인하세요.');}
  const reply=await res.json().catch(()=>({ok:false,error:'서버 응답이 유효하지 않습니다.'}));
  if(!res.ok||reply.ok!==true)throw Error(reply.error||`서버 오류 ${res.status}`);
  return reply;
}
// 익명 이용 집계: 브라우저 세션의 임의 UUID만 서버로 보내고 IP·이름·건강정보는 보내지 않습니다.
// 본 지표는 일별 브라우저 세션 기준이며 실제 개인 수를 뜻하지 않습니다.
const TRACK_SESSION_KEY='dj_anon_session_v28';
let ephemeralSession='';
function getAnonymousSession(){
  try{
    const old=sessionStorage.getItem(TRACK_SESSION_KEY);
    if(old&&/^[0-9a-f-]{36}$/i.test(old))return old;
    const fresh=crypto.randomUUID();sessionStorage.setItem(TRACK_SESSION_KEY,fresh);return fresh;
  }catch{
    if(!ephemeralSession)ephemeralSession=crypto.randomUUID();return ephemeralSession;
  }
}
function recordVisit(metric,facilityId=''){
  // 시험 브랜치에서는 운영자료를 변경하지 않습니다.
  if(location.hostname.includes('--'))return;
  const data={action:'public_track',metric,sessionId:getAnonymousSession(),...(facilityId?{facilityId}:{})};
  const endpoint='/.netlify/functions/api';
  try{
    const body=JSON.stringify(data);
    if(navigator.sendBeacon){navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'}));}
    else fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true,credentials:'omit'}).catch(()=>{});
  }catch{} // 통계 오류가 기관 검색·전화 사용을 막지 않도록 합니다.
}
const fmtAnalytics=n=>Number(n||0).toLocaleString('ko-KR');
function renderAnalyticsReport(payload,prefix){
  const out=$(prefix+'-analytics-summary'),chart=$(prefix+'-analytics-chart'),foot=$(prefix+'-analytics-footnote');
  if(!out)return;
  const d=payload.summary||{};
  const kpis=[['돌봄지음 전체 방문','siteSessions','사이트 방문 세션'],['우리 기관 상세 조회','detailSessions','기관 상세정보 열람 세션'],['우리 기관 전화 클릭','phoneSessions','전화 연결 선택 세션']];
  const adminNoFacility=prefix==='a'&&!payload.facilityId;
  out.innerHTML=kpis.filter((_,i)=>!adminNoFacility||i===0).map(([title,key,desc])=>`<div class="analytics-kpi"><small>${esc(title)}</small><strong>${fmtAnalytics(d[key])}</strong><span>${esc(desc)}</span></div>`).join('');
  if(chart){
    const recent=(payload.days||[]).slice(-14),max=Math.max(1,...recent.map(r=>r.detailSessions||0));
    chart.innerHTML=recent.length&&payload.facilityId?`<h4>우리 기관 · 최근 14일 상세 조회</h4><div class="analytics-bars">${recent.map(r=>`<div class="analytics-bar-day" title="${esc(r.day)}: ${fmtAnalytics(r.detailSessions)}세션"><span class="analytics-bar" style="height:${Math.max(2,Math.round((r.detailSessions||0)/max*115))}px"></span><small>${esc(r.day.slice(5))}</small></div>`).join('')}</div><div class="analytics-legend">막대는 일별 기관 상세 조회 세션 수이며, 상담·입소 전환 실적이 아닙니다.</div>`:'';
  }
  if(foot)foot.textContent=`집계기간: ${payload.periodStart} ~ ${payload.periodEnd} · 하루에 한 번 집계한 익명 브라우저 세션 수입니다. 실제 사람 수와는 차이가 있습니다.${payload.testMode?' 시험 주소는 새 방문을 기록하지 않습니다.':''}`;
}
async function loadFacilityAnalytics(){if(session.role!=='facility')return;
  setMessage('f-analytics-summary','홍보 성과를 조회하는 중입니다.');
  try{const r=await call('facility_my_analytics');renderAnalyticsReport(r,'f');}
  catch(e){setMessage('f-analytics-summary','성과 조회 실패: '+e.message);}
}
async function loadAdminAnalytics(){if(session.role!=='admin')return;
  setMessage('a-analytics-summary','방문 현황을 조회하는 중입니다.');
  try{const r=await call('admin_analytics',{facilityId:selectedId||''});renderAnalyticsReport(r,'a');if(!selectedId)setMessage('a-analytics-footnote','전체 사이트 최근 30일 · 기관별 조회·전화 클릭은 아래에서 기관을 선택하면 표시합니다.');}
  catch(e){setMessage('a-analytics-summary','통계 조회 실패: '+e.message);}
}
$('f-analytics-refresh').onclick=loadFacilityAnalytics;
$('a-analytics-refresh').onclick=loadAdminAnalytics;

function optionDistrict(regionId,districtId,prefer){
  // 공용 지역 모듈은 로그인이 지연되어도 독립적으로 실행됩니다.
  return window.DJ_UPDATE_DISTRICT?.(regionId,districtId,prefer);
}
// 모든 시·도 선택은 regions.js가 관리하며, 이 화면은 같은 함수를 사용합니다.

// 동일한 웹앱의 PC 및 모바일에서 공통으로 사용하는 방문기록입니다.
// 홈페이지 바깥으로 나가지 않도록, 앱 내부에서 방문한 화면만 탐색합니다.
const visitPages=['home'];
let visitIndex=0;
const visitSession='dj-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
const visitState=(page,index)=>({...(history.state||{}),dolbomVisitSession:visitSession,dolbomPage:page,dolbomIndex:index});
history.replaceState(visitState('home',0),'',location.href);
function updateVisitControls(){
  $('page-back').disabled=visitIndex===0;
  $('page-forward').disabled=visitIndex>=visitPages.length-1;
  setMessage('travel-caption',visitIndex===0?'첫 화면입니다. 다른 메뉴로 이동해 보세요.':visitIndex<visitPages.length-1?'이전·다음 방문 화면으로 이동할 수 있습니다.':'이전에 방문한 화면으로 돌아갈 수 있습니다.');
}
function pageAuthorized(page){
  if(page==='plans')return ['facility','admin'].includes(session.role);
  if(page==='criteria'||page==='admin')return session.role==='admin';
  if(page==='facility')return ['facility','admin'].includes(session.role);
  return true;
}
function navigate(page,{fromHistory=false}={}){
  if(!TITLES[page])return;
  // 모바일에서는 초기 로그인 복원 전 메뉴 터치가 빠를 수 있습니다. 확인 완료 뒤 자동 이동합니다.
  if(typeof authRestored!=='undefined'&&!authRestored&&['facility','admin','criteria','plans'].includes(page)){
    pendingProtectedPage=page;
    setMessage('system-state','기존 로그인 상태를 확인하고 있습니다…');
    return;
  }
  // 관리자도 기관 전용 화면을 읽기 전용으로 미리 봅니다. 관리자 화면으로 강제 이동시키지 않습니다.
  if(page==='plans'&&!['facility','admin'].includes(session.role)){nextPage='plans';openAuth('facility');return;}
  if(page==='criteria'&&session.role!=='admin'){nextPage='criteria';openAuth('admin');return;}
  if(page==='admin'&&session.role!=='admin'){nextPage='admin';openAuth('admin');return;}
  if(page==='facility'&&!['facility','admin'].includes(session.role)){nextPage='facility';openAuth('facility');return;}
  // 다른 메뉴를 선택하면 앞으로 이동 기록은 초기화됩니다.
  if(!fromHistory&&page!==visitPages[visitIndex]){
    visitPages.splice(visitIndex+1);
    visitPages.push(page);
    visitIndex=visitPages.length-1;
    history.pushState(visitState(page,visitIndex),'',location.href);
  }
  updateVisitControls();
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+page));
  document.querySelectorAll('[data-page]').forEach(p=>p.classList.toggle('active',p.dataset.page===page));
  setMessage('top-title',TITLES[page]);window.scrollTo({top:0,behavior:'instant'});
  if(page==='match')loadPublic();
recordVisit('site_visit');
  if(page==='facility'){
    if(session.role==='facility')loadMine();
    else if(session.role==='admin')renderAdminFacilityPreview();
  }
  if(page==='admin'){loadAdmin();loadAdminOverview();loadAssessments();loadAdminPaymentOrders();loadAdminAnalytics();}
  if(page==='plans')loadPrivatePlans();
}
// 브라우저/휴대폰의 자체 뒤로가기와 화면 내 화살표가 같은 기록을 사용합니다.
$('page-back').addEventListener('click',()=>{if(visitIndex>0)history.back();});
$('page-forward').addEventListener('click',()=>{if(visitIndex<visitPages.length-1)history.forward();});
window.addEventListener('popstate',event=>{
  const state=event.state;
  if(!state||state.dolbomVisitSession!==visitSession||!Number.isInteger(state.dolbomIndex)){
    // 다른 방문 세션/앱 바깥 기록은 이 UI의 방문 기록으로 다루지 않습니다.
    return;
  }
  const index=state.dolbomIndex;
  if(index<0||index>=visitPages.length||state.dolbomPage!==visitPages[index])return;
  visitIndex=index;
  if(!pageAuthorized(state.dolbomPage)){
    visitPages[visitIndex]='home';
    history.replaceState(visitState('home',visitIndex),'',location.href);
    navigate('home',{fromHistory:true});
    return;
  }
  navigate(state.dolbomPage,{fromHistory:true});
});
updateVisitControls();
document.addEventListener('click',e=>{const b=e.target.closest('[data-page], [data-go]');if(b)navigate(b.dataset.page||b.dataset.go);const l=e.target.closest('[data-login]');if(l)openAuth(l.dataset.login);});
function openAuth(role='guardian'){$('auth-dialog').showModal();setMessage('auth-feedback',role==='facility'?'카카오 로그인 후 담당자 UID를 관리자에게 전달하여 기관 연결을 요청하세요.':role==='admin'?'관리자 권한이 미리 발급된 계정이어야 합니다.':'카카오 또는 이메일로 로그인할 수 있습니다.');}
$('auth-open').onclick=()=>openAuth();$('auth-close').onclick=()=>$('auth-dialog').close();
$('auth-logout').onclick=async()=>{try{await signOut(auth);navigate('home');}catch(e){alert(e.message)}};
$('email-login').onclick=async()=>{
  try{const result=await signInWithEmailAndPassword(auth,formValue('auth-email'),$('auth-password').value);await updateSession(result.user);$('auth-dialog').close();navigate(nextPage&&((nextPage==='plans'&&['facility','admin'].includes(session.role))||(nextPage==='criteria'&&session.role==='admin')||(nextPage==='facility'&&session.role==='admin')||session.role===nextPage)?nextPage:session.role==='admin'?'admin':session.role==='facility'?'facility':'home');nextPage=null;}
  catch(e){setMessage('auth-feedback','이메일 로그인 실패: '+(e.code?.startsWith('auth/')?'이메일·비밀번호·인증설정을 확인하세요.':e.message));}
};
$('email-reset').onclick=async()=>{if(!formValue('auth-email')){setMessage('auth-feedback','이메일 주소를 먼저 입력하세요.');return;}try{await sendPasswordResetEmail(auth,formValue('auth-email'));setMessage('auth-feedback','계정이 등록된 경우 재설정 메일을 받을 수 있습니다.');}catch{setMessage('auth-feedback','메일 발송 실패: Firebase 이메일 인증 설정을 확인하세요.');}};
async function kakaoFinish(customToken){await signInWithCustomToken(auth,customToken);await updateSession(auth.currentUser);$('auth-dialog')?.close();navigate(nextPage&&((nextPage==='plans'&&['facility','admin'].includes(session.role))||(nextPage==='criteria'&&session.role==='admin')||(nextPage==='facility'&&session.role==='admin')||session.role===nextPage)?nextPage:session.role==='admin'?'admin':session.role==='facility'?'facility':'home');nextPage=null;}
window.addEventListener('message',async e=>{
  if(e.origin!==location.origin||!popup||e.source!==popup)return;
  if(e.data?.type!=='careindex-kakao'||typeof e.data.token!=='string')return;
  try{await kakaoFinish(e.data.token);}catch(err){setMessage('auth-feedback','카카오 인증 후 Firebase 연결 오류: '+err.message);}
  finally{popup=null;}
});
$('kakao-login').onclick=()=>{
  const url='/.netlify/functions/kakao-start?mode=popup';
  popup=window.open(url,'careindex-kakao','popup=yes,width=490,height=720');
  if(!popup){location.assign('/.netlify/functions/kakao-start?mode=redirect');return;}
  setMessage('auth-feedback','카카오 인증 창에서 로그인을 완료해 주세요.');
};
async function updateSession(user){
  if(!user){session={user:null,role:'guest',uid:'',facilityId:''};adminFacilities=[];selectedId='';nextAdminCursor=null;setMessage('a-full-detail','관리자 로그인 후 조회할 수 있습니다.');setMessage('a-facilities','관리자 로그인 후 조회할 수 있습니다.');}
  else{
    const claims=(await user.getIdTokenResult(true)).claims;
    session={user,uid:user.uid,role:claims.role==='admin'?'admin':claims.role==='facility'?'facility':'guardian',facilityId:claims.facilityId||''};
  }
  setMessage('user-state',session.user?`${ROLENAME[session.role]} · ${session.uid.length>21?session.uid.slice(0,18)+'…':session.uid}`:'로그인 전');
  $('auth-logout').hidden=!user;$('auth-open').textContent=user?'계정 연결 상태':'로그인';
  $('institution-entry').textContent=session.role==='admin'?'기관 전용 화면 미리보기 →':session.role==='facility'?'내 기관 화면 열기 →':'기관 전용 로그인 →';
  if(session.role==='guardian'&&session.user){setMessage('system-state','로그인 완료 · UID: '+session.uid);}else{setMessage('system-state',session.user?ROLENAME[session.role]+' 인증 완료':'참여기관 검색 가능');}
  $('facility-gate').hidden=['facility','admin'].includes(session.role);$('facility-portal').hidden=session.role!=='facility';
  $('admin-facility-preview').hidden=session.role!=='admin';
  $('home-admin-card').hidden=session.role!=='admin'; // 보호자 첫 화면에서는 관리자 업무 안내를 노출하지 않습니다.
  $('admin-gate').hidden=session.role==='admin';$('admin-portal').hidden=session.role!=='admin';
  document.querySelectorAll('[data-restricted="plan"]').forEach(x=>x.hidden=!['facility','admin'].includes(session.role));
  document.querySelectorAll('[data-restricted="admin"]').forEach(x=>x.hidden=session.role!=='admin');
  if(!['facility','admin'].includes(session.role))document.querySelectorAll('[data-price-type]').forEach(x=>x.textContent='기관 로그인 후 확인');
  const active=document.querySelector('.page.active')?.id;
  if((active==='page-admin'&&session.role!=='admin')||(active==='page-facility'&&!['facility','admin'].includes(session.role))||(active==='page-plans'&&!['facility','admin'].includes(session.role))||(active==='page-criteria'&&session.role!=='admin'))navigate('home');
}
try{
  const firebase=initializeApp(window.CAREINDEX_CONFIG.firebase);auth=getAuth(firebase);
  onAuthStateChanged(auth,async user=>{
    try{
      await updateSession(user);
      authRestored=true;
      if(pendingProtectedPage){
        const target=pendingProtectedPage;pendingProtectedPage=null;
        navigate(target);
      }
    }catch(e){
      console.error('auth state failed',e);
      authRestored=true;
      setMessage('system-state','인증 상태 확인 실패 · 인터넷 상태를 확인하고 새로고침하세요.');
    }
  });
  const hash=new URLSearchParams(location.hash.replace(/^#/,''));const code=hash.get('kakao_token');
  if(code){history.replaceState(visitState(visitPages[visitIndex],visitIndex),'',location.pathname+location.search);kakaoFinish(code).catch(e=>alert('카카오 로그인 연결 실패: '+e.message));}
}catch(e){console.error('Firebase init',e);setMessage('system-state','Firebase 초기화 실패');}

// 공개용 기본명단은 별도 JSON 파일에서 기관명·유형·지역·기준일만 가져옵니다.
// Firebase의 비공개 후보·연락처·관리자 메모는 직접 제공하지 않습니다.
let basicDirectory=null,basicDirectoryError='',basicPage=0;
const BASIC_PAGE_SIZE=24;
// 공백 없는 기관명('나주고운정요양원')과 자연어 입력('고운정 요양원', '나주 요양원')을 함께 지원.
function matchesDirectoryKeyword(f,keyword){
  const q=String(keyword||'').trim().toLocaleLowerCase('ko');
  if(!q)return true;
  const haystack=[f.name,f.region,f.district,f.type].join(' ').toLocaleLowerCase('ko');
  const compact=haystack.replace(/\s+/g,'');
  if(compact.includes(q.replace(/\s+/g,'')))return true;
  return q.split(/\s+/).every(term=>haystack.includes(term)||compact.includes(term));
}
const matchedBasicDirectory=()=>{
  const region=formValue('match-region'),district=formValue('match-district'),type=formValue('match-type'),kw=formValue('match-keyword');
  return (basicDirectory||[]).filter(f=>(region==='전체'||f.region===region)&&(district==='전체'||f.district===district)&&(type==='전체'||f.type===type)&&matchesDirectoryKeyword(f,kw));
};
async function ensureBasicDirectory(){
  if(basicDirectory||basicDirectoryError)return;
  try{
    const r=await fetch('./public-directory.json?v=20261120',{cache:'force-cache'});
    if(!r.ok)throw Error('기관 기본명단 파일 응답 '+r.status);
    const d=await r.json();
    if(!Array.isArray(d.items))throw Error('기관 기본명단 형식 오류');
    basicDirectory=d.items;
  }catch(e){basicDirectoryError=e.message||'파일을 불러올 수 없습니다.';}
}
function renderBasicDirectory(){
  const results=matchedBasicDirectory(),total=results.length,maxPage=Math.max(0,Math.ceil(total/BASIC_PAGE_SIZE)-1);
  basicPage=Math.min(basicPage,maxPage);
  const segment=results.slice(basicPage*BASIC_PAGE_SIZE,(basicPage+1)*BASIC_PAGE_SIZE);
  $('basic-directory-status').textContent=basicDirectoryError?'기본명단 조회 오류: '+basicDirectoryError:basicDirectory?`${total.toLocaleString('ko-KR')}곳의 과거 기본명단이 검색되었습니다. 실재·현재 운영 여부는 별도 확인이 필요합니다.`:'공공자료 기관명을 불러오고 있습니다.';
  $('basic-directory-list').innerHTML=segment.length?segment.map(f=>`<article class="basic-directory-row"><span class="basic-directory-symbol" aria-hidden="true">⌂</span><div><strong>${esc(f.name)}</strong><small>${esc(f.region)} ${esc(f.district)} · ${esc(f.type)} · 기준 ${esc(f.asOf)}</small></div><span class="basic-directory-tag">기본명단</span></article>`).join(''):'<div class="empty">이 조건의 기본 기관명을 찾지 못했습니다. 다른 지역·유형이나 기관명 일부로 검색해 주세요.</div>';
  $('basic-prev').hidden=basicPage===0;
  $('basic-next').hidden=basicPage>=maxPage;
  $('basic-page-note').textContent=total?`${basicPage+1} / ${maxPage+1}쪽 · ${total.toLocaleString('ko-KR')}곳`:'검색 결과 없음';
  setMessage('match-count',`${publicFacilities.length}곳 광고 · ${total.toLocaleString('ko-KR')}곳 기본명단`);
}
$('basic-prev').onclick=()=>{basicPage=Math.max(0,basicPage-1);renderBasicDirectory();};
$('basic-next').onclick=()=>{basicPage++;renderBasicDirectory();};
let publicSearchRequestId=0;
async function loadPublic(){
  const requestId=++publicSearchRequestId;basicPage=0;publicFacilities=[];
  setMessage('directory-status','새 조건으로 기본 기관명과 상세 홍보기관을 검색하는 중입니다.');
  $('facility-results').innerHTML='<div class="empty">상세 홍보기관을 확인하고 있습니다…</div>';
  renderBasicDirectory();
  // Promise rejection을 먼저 수습하고, 유료 서버 장애 시에도 기본명단은 정상 표시합니다.
  const paidTask=call('public_list',{region:formValue('match-region'),district:formValue('match-district'),type:formValue('match-type'),keyword:formValue('match-keyword')},'GET');
  const [paidResult]=await Promise.allSettled([paidTask,ensureBasicDirectory()]);
  if(requestId!==publicSearchRequestId)return;
  if(paidResult.status==='fulfilled'){
    publicFacilities=paidResult.value.items||[];renderPublic();
    setMessage('directory-status',`상세 홍보 ${publicFacilities.length}곳, 기본명단 ${matchedBasicDirectory().length.toLocaleString('ko-KR')}곳 · 두 목록의 의미는 다릅니다.`);
  }else{
    publicFacilities=[];renderPublic();
    setMessage('directory-status','상세 홍보기관 조회가 일시적으로 원활하지 않습니다. 기본 기관명은 아래에서 검색할 수 있습니다. ('+paidResult.reason.message+')');
  }
}
function renderPublic(){
  $('facility-results').innerHTML=publicFacilities.length?publicFacilities.map(f=>`<article class="fac-card"><div class="fac-photo">${f.imageUrl&&/^https:\/\//.test(f.imageUrl)?`<img src="${esc(f.imageUrl)}" alt="${esc(f.name)} 제공 사진" loading="lazy">`:'⌂'}<span class="adflag" style="position:absolute;top:12px;left:12px">유료 광고</span></div><div class="fac-card-body"><div class="badge-line"><span class="pill">${esc(f.type)}</span><span class="pill">${esc(f.region)} · ${esc(f.district)}</span></div><h3>${esc(f.name)}</h3><div class="smallprint">${esc(f.address||'주소는 기관에 문의하세요.')}</div><p>${esc(f.description||'기관 소개를 확인 중입니다.')}</p><button class="btn btn-outline btn-sm" data-public-detail="${esc(f.id)}">기관 정보·확인 질문 보기</button></div></article>`).join(''):'<div class="empty">현재 조건에 게시 승인된 유료 홍보 참여기관이 없습니다. 아래 공공자료 기본명단과는 구분해 주세요.</div>';
  renderBasicDirectory();
}
$('search-submit').onclick=loadPublic;
for(const id of ['match-region','match-district','match-type'])$(id).addEventListener('change',loadPublic);
$('search-reset').onclick=()=>{for(const id of ['match-region','match-type'])$(id).value='전체';optionDistrict('match-region','match-district');$('match-keyword').value='';loadPublic();};
$('match-keyword').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadPublic();}});
// 서비스 첫 화면에서 기관명을 입력하면 로그인 절차 없이 공개 검색으로 이동합니다.
$('hero-directory-search').addEventListener('submit',e=>{e.preventDefault();$('match-region').value='전체';optionDistrict('match-region','match-district');$('match-type').value='전체';$('match-keyword').value=$('hero-directory-keyword').value.trim();navigate('match');});
function showPublicDetail(id){
  const f=publicFacilities.find(x=>x.id===id);if(!f)return;
  $('detail-content').innerHTML=`<div class="kicker">PAID PARTICIPATING PROVIDER</div><h2>${esc(f.name)}</h2><div class="adflag">유료 홍보 참여기관 · 공적 인증 아님</div>${f.imageUrl&&/^https:\/\//.test(f.imageUrl)?`<img class="detail-img" src="${esc(f.imageUrl)}" alt="${esc(f.name)} 제공 사진">`:''}<dl><dt>유형·지역</dt><dd>${esc(f.type)} · ${esc(f.region)} ${esc(f.district)}</dd><dt>주소</dt><dd>${esc(f.address||'기관에 문의')}</dd><dt>대표전화</dt><dd>${esc(f.phone||'기관에 문의')}${f.phone&&f.phone.replace(/[^+0-9]/g,'').length>=8?` <a class="btn btn-primary btn-sm" href="tel:${esc(f.phone.replace(/[^+0-9]/g,''))}" data-track-call="${esc(f.id)}">전화 연결</a>`:''}</dd><dt>기관 소개</dt><dd>${esc(f.description||'정보 업데이트 예정')}</dd><dt>정보 확인일</dt><dd>${esc(f.lastConfirmedAt||'직접 확인 필요')}</dd>${f.homepage&&/^https:\/\//.test(f.homepage)?`<dt>홈페이지</dt><dd><a target="_blank" rel="noopener noreferrer" href="${esc(f.homepage)}">기관 홈페이지 열기</a></dd>`:''}</dl><h3>방문 전 확인 질문</h3><ul class="list"><li>오늘 현재 입소·입원이 가능한가요?</li><li>보험 적용 후 예상 월 비용과 추가 비용은?</li><li>야간 인력·응급상황·보호자 연락 방식은?</li><li>면회·송영·인지 활동은 어떻게 운영되나요?</li></ul><p class="smallprint">위 소개·사진은 기관이 제공하거나 관리자 확인을 거친 홍보 정보이며, 의료적 적합성 또는 공적 평가 결과를 의미하지 않습니다.</p>`;
  // 보호자는 점검기준을 언제든지 보고, 관리자 검토 완료된 정보만 추가로 받습니다.
  $('detail-content').insertAdjacentHTML('beforeend','<div class="panel" style="margin-top:18px"><h3>돌봄지음 돌봄약속 · 기관별 확인 현황</h3><p>어떤 기준으로 기관을 살펴보는지 <button class="btn btn-outline btn-sm" data-go="standards" data-close-detail="true">9개 점검기준 보기</button></p><div id="detail-assessment">공개 가능한 점검 결과를 확인하는 중입니다.</div></div>');
  $('detail-dialog').showModal();
  recordVisit('facility_detail',f.id);
  loadPublicAssessment(f);
}

// 방문 전 단계: 보호자는 직접 평가하지 않고 질문과 기관별 실제 확인현황을 읽습니다.
const standardCards=ASSESSMENT_DOMAINS.map(([id,name,desc],i)=>{
  const questions=PUBLIC_CHECKLIST[id]||[];
  return `<details class="panel public-standard-card" ${i===0?'open':''}><summary><span class="pill">${String(i+1).padStart(2,'0')}</span><span class="public-standard-title"><strong>${esc(name)}</strong><small>${esc(desc)}</small></span><span class="public-standard-action">점검 질문 ${questions.length}개 보기 <span aria-hidden="true">⌄</span></span></summary><ol class="public-question-list">${questions.map(([q,h])=>`<li class="public-question"><strong>${esc(q)}</strong><p>${esc(h)}</p></li>`).join('')}</ol></details>`;
});
standardCards.push(`<details class="panel public-standard-card public-standard-reflection"><summary><span class="pill">09</span><span class="public-standard-title"><strong>보호자의 심리적 신뢰</strong><small>개인 판단과 마음의 부담 · 기관 심사점수에서 제외</small></span><span class="public-standard-action">생각해 볼 질문 3개</span></summary><ol class="public-question-list">${GUARDIAN_REFLECTION.map((q,i)=>`<li class="public-question"><strong>${esc(q)}</strong><p>${esc(GUARDIAN_REFLECTION_HINTS[i])}</p></li>`).join('')}</ol></details>`);
$('public-standard-list').innerHTML=standardCards.join('');
function renderFieldPublicInspection(payload){
  const inspection=payload?.inspection,rows=inspection?.rows||{};
  const hasData=Boolean(inspection);
  const groups=ASSESSMENT_DOMAINS.map(([id,name,description],i)=>{
    const questions=PUBLIC_CHECKLIST[id]||[];
    const entries=questions.map(([q,hint],j)=>{
      const key=`${id}-${j+1}`,row=rows[key]||{source:'미확인',finding:'미확인',summary:''};
      const isKnown=row.source!=='미확인'&&row.finding!=='미확인';
      return `<div class="guardian-field-row"><strong>${esc(j+1)}. ${esc(q)}</strong><div class="field-result"><span class="field-pill ${!isKnown?'unknown':row.finding==='보완중'?'needs':''}">${esc(isKnown?row.finding:'미확인')}</span><span class="field-pill">${esc(isKnown?row.source:'확인 자료 없음')}</span></div>${row.summary?`<p class="field-note">${esc(row.summary)}</p>`:`<p class="field-note smallprint">${esc(hint)}</p>`}${isKnown?`<p class="field-checked-at">확인자료 기준일: ${esc(inspection.visitedDate)}</p>`:''}</div>`;
    }).join('');
    const count=questions.filter((_,j)=>{const row=rows[`${id}-${j+1}`];return row&&row.source!=='미확인'&&row.finding!=='미확인';}).length;
    return `<details class="guardian-field-domain" ${i===0?'open':''}><summary>${esc(i+1)}. ${esc(name)} · ${count}/${questions.length}개 항목 확인 <small>자세히 보기</small></summary>${entries}</details>`;
  }).join('');
  return `<div class="panel" style="margin-top:15px"><h3>돌봄지음 29개 항목별 확인 현황</h3><p class="smallprint">방문 전에 확인 가능한 자료를 보여드립니다. 9번째 심리적 신뢰는 보호자 개인의 판단으로 기관 평가에 포함되지 않습니다.</p><p class="smallprint">${esc(payload?.notice||'')}</p>${hasData?`<p class="smallprint">점검 자료 기준일 ${esc(inspection.visitedDate)} · 공개일 ${esc(inspection.publishedDate)} · 재확인 권장일 ${esc(inspection.nextReviewDate)}</p>`:''}${groups}<p class="field-warning">미확인은 문제가 없다는 뜻도, 문제가 있다는 뜻도 아닙니다. 돌봄지음의 확인정보는 공적 인증이나 의료적 적합성 판단을 대체하지 않습니다.</p></div>`;
}
async function loadPublicAssessment(f){
  const el=$('detail-assessment');if(!el)return;
  if(!['요양병원','요양원'].includes(f.type)){el.textContent='이 기관 유형은 아직 29개 세부 점검 공개대상이 아닙니다. 공통 기준을 먼저 확인해 주세요.';return;}
  try{
    const [r,detail]=await Promise.all([call('public_assessment',{facilityId:f.id},'GET'),call('public_field_inspection',{facilityId:f.id},'GET')]);
    if(!$('detail-dialog').open||!$('detail-assessment'))return;
    const summary=(!r.assessment||r.assessment.expired)?`<p>${esc(r.notice||'영역별 확인자료 없음')}</p>`:
      `<p class="smallprint">8개 영역별 검토일 ${esc(r.assessment.reviewedDate)} · 권장 재확인일 ${esc(r.assessment.nextAnnualDue)}</p>${ASSESSMENT_DOMAINS.map(([id,name])=>{const row=r.assessment.rows?.[id]||{source:'미확인',finding:'미확인'};return `<div class="assessment-row"><strong>${esc(name)}</strong><span>${esc(row.finding)}</span><small>확인 경로: ${esc(row.source)}</small></div>`;}).join('')}`;
    el.innerHTML=`<h4>영역별 자체심사 확인 현황</h4>${summary}${renderFieldPublicInspection(detail)}`;
  }catch(e){el.textContent='기관별 점검자료를 조회할 수 없습니다: '+e.message;}
}
document.addEventListener('click',e=>{const go=e.target.closest('[data-close-detail]');if(go)$('detail-dialog').close();});

document.addEventListener('click',e=>{const b=e.target.closest('[data-track-call]');if(b)recordVisit('phone_click',b.dataset.trackCall);});
$('detail-close').onclick=()=>$('detail-dialog').close();
document.addEventListener('click',e=>{const b=e.target.closest('[data-public-detail]');if(b)showPublicDetail(b.dataset.publicDetail);});
$('elder-search').onclick=()=>{for(const [a,b] of [['elder-region','match-region'],['elder-type','match-type']])$(b).value=$(a).value;optionDistrict('match-region','match-district',formValue('elder-district'));navigate('match');};
const QUESTIONS=['평소보다 의욕이 줄거나 즐거워하는 일이 감소했나요?','수면·식사 또는 생활 리듬에 변화가 있었나요?','평소와 다른 혼란이나 기억 관련 어려움을 관찰했나요?','다른 사람과의 교류가 눈에 띄게 줄었나요?','불안·초조·짜증 등의 변화가 관찰되었나요?'];
$('questions').innerHTML=QUESTIONS.map((q,i)=>`<div class="question"><p><strong>${i+1}.</strong> ${esc(q)}</p><select id="obs-${i}" aria-label="${esc(q)}"><option value="미확인">확인하지 못함</option><option>변화 없음</option><option>가끔 관찰됨</option><option>자주 관찰됨</option></select></div>`).join('');
$('observe-submit').onclick=()=>{const items=QUESTIONS.map((q,i)=>({question:q,answer:formValue(`obs-${i}`)})).filter(x=>['가끔 관찰됨','자주 관찰됨'].includes(x.answer));$('observe-output').innerHTML=items.length?'<strong>가족 관찰 메모 (진단 아님)</strong><ul class="list">'+items.map(x=>`<li>${esc(x.question)} · ${esc(x.answer)}</li>`).join('')+'</ul><p>변화가 지속되거나 안전상 우려가 있다면 의료진과 상담하세요.</p>':'특별히 기록된 변화 항목은 없습니다. 확인하지 못한 항목은 추가로 살펴보세요.';};
$('observe-reset').onclick=()=>{QUESTIONS.forEach((_,i)=>$(`obs-${i}`).selectedIndex=0);setMessage('observe-output','관찰 메모를 다시 작성할 수 있습니다.');};

async function loadPrivatePlans(){
  if(!['facility','admin'].includes(session.role))return;
  const out=$('quota-result');out.textContent='기관 계정의 요금 및 정원을 확인하고 있습니다.';
  try{
    const result=await call('private_plan_prices',{},'GET');
    for(const el of document.querySelectorAll('[data-price-type]')){
      const type=el.dataset.priceType,price=result.prices?.[type];
      el.textContent=Number.isInteger(price)?'월 '+fmtWon(price):'본인 기관 유형만 조회 가능';
      el.closest('.price-card')?.toggleAttribute('hidden',!Number.isInteger(price));
    }
    if(session.role==='facility'&&result.region&&result.district&&result.type){
      $('quota-region').value=result.region;optionDistrict('quota-region','quota-district',result.district);
      $('quota-type').value=result.type;
      for(const id of ['quota-region','quota-district','quota-type'])$(id).disabled=true;
      await showQuota();
    }else{
      for(const id of ['quota-region','quota-district','quota-type'])$(id).disabled=false;
      out.textContent='관리자: 지역과 기관 유형을 선택해 정원을 조회하세요.';
    }
  }catch(e){out.textContent='기관 홍보 조건 확인 실패: '+e.message;}
}
async function showQuota(){
  const out=$('quota-result');
  if(!['facility','admin'].includes(session.role)){out.textContent='승인된 기관 계정이 필요합니다.';return;}
  try{
    const r=await call('private_quota',{region:formValue('quota-region'),district:formValue('quota-district'),type:formValue('quota-type')},'GET');
    out.innerHTML=`<strong>${esc(r.region)} ${esc(r.district)} · ${esc(r.type)}</strong><div>홍보 정원 <span class="quota-number">${r.capacity}</span>곳　/　현재 계약 <span class="quota-number">${r.active}</span>곳　/　남은 자리 <span class="quota-number">${r.remaining}</span>곳</div><div>기준 월 홍보료 <strong>${fmtWon(r.price)}</strong></div><small>광고상품 정원이며 지역 전체 요양기관 수나 시설 우수성 인증이 아닙니다.</small>`;
  }catch(e){out.textContent='기관용 정원 확인 실패: '+e.message;}
}
$('quota-check').onclick=showQuota;

// 기관 전용 결제 신청 창. 카드 승인 및 무통장 자동수납을 하지 않습니다.
async function loadPaymentQuote(){
  if(session.role!=='facility')return;
  setMessage('pay-quote','기준 홍보료를 서버에서 확인하고 있습니다.');
  try{
    const q=await call('facility_order_quote',{months:Number(formValue('pay-months'))});
    $('pay-quote').innerHTML=`<div class="pay-summary-head"><div><small>내 기관</small><strong>${esc(q.facilityName)}</strong><span>${esc(q.region)} ${esc(q.district)} · ${esc(q.facilityType)}</span></div><span class="pill">기관 로그인 전용</span></div><div class="pay-summary-row"><span>월 홍보료</span><b>${fmtWon(q.monthlyPrice)}</b></div><div class="pay-summary-row"><span>신청기간</span><b>${q.months}개월</b></div><div class="pay-summary-row total"><span>예상 홍보료 합계</span><strong>${fmtWon(q.estimatedAmount)}</strong></div><div class="pay-summary-foot">${esc(q.taxNote)}<div>해당 권역의 현재 참여 가능 정원: ${q.quota.remaining}곳 (실제 계약 시점 재확인)</div></div>`;
    $('pay-request').disabled=q.quota.remaining===0;
    setMessage('pay-feedback',q.quota.remaining===0?'해당 권역 홍보 정원이 모두 찼습니다. 기관 관리 담당자에게 문의하세요.':'카드 결제는 아직 이용할 수 없습니다. 신청 후 담당자가 입금 절차를 안내합니다.');
  }catch(e){setMessage('pay-quote','홍보료 조회 오류: '+e.message);$('pay-request').disabled=true;}
}
async function loadMyPaymentOrders(){if(session.role!=='facility')return;
  try{const data=await call('facility_my_orders');$('pay-orders').innerHTML=(data.items||[]).map(o=>`<div class="review"><strong>${esc(o.id)}</strong> · ${esc(o.status==='awaiting_manual_review'?'입금 안내·신청 검토 대기':o.status==='manually_verified'?'관리자 입금 확인':'신청 취소')}<div class="smallprint">${esc(o.requestDate)} · ${esc(o.months)}개월 · 예상 ${fmtWon(o.estimatedAmount)}</div><p>${esc(o.status==='manually_verified'?'입금 확인이 기록되었습니다. 게시 및 계약 활성화는 별도 절차입니다.':'신청만으로 결제가 완료되지 않습니다.')}</p></div>`).join('')||'<div class="empty">아직 홍보 신청 내역이 없습니다.</div>';}catch(e){setMessage('pay-orders','조회 실패: '+e.message);}
}
$('f-open-checkout').onclick=()=>{if(session.role!=='facility')return openAuth('facility');$('payment-dialog').showModal();loadPaymentQuote();loadMyPaymentOrders();};
$('pay-close').onclick=()=>$('payment-dialog').close();
$('pay-months').onchange=loadPaymentQuote;
$('pay-refresh').onclick=()=>{loadPaymentQuote();loadMyPaymentOrders();};
$('pay-request').onclick=async()=>{
  if(session.role!=='facility')return alert('기관 계정으로 로그인해야 합니다.');
  if(!$('pay-ack').checked)return alert('신청과 실제 결제 완료는 다르다는 안내를 확인하세요.');
  if(!confirm('홍보상품 신청서를 접수할까요? 실제 결제나 광고 게시가 바로 진행되지 않습니다.'))return;
  const btn=$('pay-request');btn.disabled=true;
  try{const r=await call('facility_create_order',{months:Number(formValue('pay-months')),method:'manual_transfer',note:formValue('pay-note'),acknowledged:true});setMessage('pay-feedback',r.message+' 신청번호: '+r.order.id);await loadMyPaymentOrders();}
  catch(e){setMessage('pay-feedback','신청 실패: '+e.message);}finally{btn.disabled=false;}
};
async function loadAdminPaymentOrders(){if(session.role!=='admin')return;
  try{
    const data=await call('admin_payment_orders');
    $('a-pay-orders').innerHTML=(data.items||[]).map(o=>`<div class="review"><strong>${esc(o.facilityName)}</strong> · ${esc(o.status==='awaiting_manual_review'?'입금 검토 대기':o.status==='manually_verified'?'입금 수동 확인':'취소')}<div class="smallprint">신청번호 ${esc(o.id)} · ${esc(o.facilityType)} · ${esc(o.region)} ${esc(o.district)} · ${esc(o.requestDate)}</div><p>상품 ${o.months}개월 · 월 ${fmtWon(o.monthlyPrice)} · 예상 합계 <strong>${fmtWon(o.estimatedAmount)}</strong></p>${o.status==='awaiting_manual_review'?`<div class="flex"><button class="btn btn-primary btn-sm" data-pay-confirm="${esc(o.id)}">실제 입금 확인</button><button class="btn btn-outline btn-sm" data-pay-cancel="${esc(o.id)}">신청 취소</button></div>`:'<p class="smallprint">별도 계약 승인 필요</p>'}</div>`).join('')||'<div class="empty">접수된 홍보 신청이 없습니다.</div>';
  }catch(e){setMessage('a-pay-orders','신청 목록 조회 실패: '+e.message);}
}
$('a-pay-refresh').onclick=loadAdminPaymentOrders;
document.addEventListener('click',async e=>{
  const yes=e.target.closest('[data-pay-confirm]'),no=e.target.closest('[data-pay-cancel]');if(!yes&&!no)return;
  const orderId=(yes||no).dataset.payConfirm||(yes||no).dataset.payCancel;
  const decision=yes?'manually_verified':'canceled';
  let reference='';if(yes){reference=prompt('계좌 내역을 실제 확인한 뒤 수납 확인번호(5자 이상)를 입력하세요. 카드번호는 입력하지 마세요.');if(reference===null)return;if(reference.trim().length<5){alert('수납 확인번호가 너무 짧습니다.');return;}}
  if(!confirm(yes?'실제 입금내역을 확인했습니까? 확인 후에도 광고는 자동 공개되지 않습니다.':'신청을 취소하시겠습니까?'))return;
  try{const r=await call('admin_review_payment_order',{orderId,decision,reference,confirmedActualReceipt:!!yes});setMessage('a-pay-feedback',r.notice);await loadAdminPaymentOrders();}
  catch(err){setMessage('a-pay-feedback','처리 실패: '+err.message);}
});

// Facility member portal.
async function loadMine(){if(session.role!=='facility')return;
  try{
    const r=await call('my_facility'),f=r.facility;
    setMessage('mine-id',f.id);setMessage('mine-approval',f.publicationStatus==='approved'?'게시 승인':'미승인 / 검토 중');setMessage('mine-contract',f.advertisingStatus==='active'?`계약 중 · ${f.contractEnd}`:'광고 미활성');
    const mapping={'f-name':'name','f-type':'type','f-region':'region','f-phone':'phone','f-address':'address','f-desc':'description','f-homepage':'homepage'};
    for(const [id,key] of Object.entries(mapping))if($(id)&&f[key])$(id).value=f[key];
    optionDistrict('f-region','f-district',f.district);
    await refreshRequests();await loadSelfAssessmentState();await loadPaymentQuote();await loadMyPaymentOrders();await loadFacilityAnalytics();
  }catch(e){setMessage('f-feedback','기관정보 연결 오류: '+e.message);}
}
async function uploadImage(file,facilityId){
  if(!file)return '';
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>1800000)throw Error('JPG/PNG/WebP, 1.8MB 이하의 사진을 선택하세요.');
  const content=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(file);});
  const imageData=String(content).split(',')[1];const r=await call('upload_photo',{facilityId,mime:file.type,imageData});return r.photoPath;
}
$('f-photo').onchange=()=>{const f=$('f-photo').files[0];setMessage('photo-preview',f?`선택한 사진: ${f.name} (${Math.round(f.size/1024)}KB)`:'');};
function facilityForm(prefix){return {name:formValue(prefix+'name'),type:formValue(prefix+'type'),region:formValue(prefix+'region'),district:formValue(prefix+'district'),phone:formValue(prefix+'phone'),address:formValue(prefix+'address'),description:formValue(prefix+'desc'),homepage:formValue(prefix+'homepage'),imageUrl:prefix==='a-'?formValue('a-image'):'',source:prefix==='a-'?formValue('a-source'):'기관 제공',officialId:prefix==='a-'?formValue('a-official'):''};}
$('f-submit').onclick=async()=>{const btn=$('f-submit');btn.disabled=true;setMessage('f-feedback','승인 신청을 제출하고 있습니다.');try{const file=$('f-photo').files[0];const photoPath=await uploadImage(file,session.facilityId);const r=await call('submit_profile',{facility:facilityForm('f-'),photoPath});setMessage('f-feedback','관리자 승인 대기로 저장되었습니다. 요청 ID: '+r.requestId);$('f-photo').value='';await refreshRequests();}catch(e){setMessage('f-feedback','제출 실패: '+e.message);}finally{btn.disabled=false;}};
async function refreshRequests(){if(!['facility','admin'].includes(session.role))return;try{const r=await call('requests');adminRequests=r.items||[];if(session.role==='facility')renderMyRequests();if(session.role==='admin')renderAdminRequests();}catch(e){setMessage(session.role==='admin'?'a-requests':'my-requests','변경 요청을 불러오지 못했습니다: '+e.message);}}
function renderMyRequests(){setMessage('my-requests',adminRequests.length?'':'아직 제출된 요청이 없습니다.');if(!adminRequests.length)return;$('my-requests').innerHTML=adminRequests.map(r=>`<div class="review"><strong>${esc(r.createdAt?.slice(0,10)||'')} · ${esc(r.status)}</strong><p>${esc(r.payload?.name||'기관정보 변경')}</p><p>${esc(r.reason||'')}</p></div>`).join('');}

// 기관별 6개월 자기점검. 고객·환자 식별정보를 입력받지 않습니다.
$('self-check-fields').innerHTML=ASSESSMENT_DOMAINS.map(([id,name,desc],i)=>`<div class="assessment-row"><label for="self-${esc(id)}"><strong>${i+1}. ${esc(name)}</strong><small>${esc(desc)}</small></label><select id="self-${esc(id)}" aria-label="${esc(name)} 자체점검 상태"><option value="미확인">미확인</option><option value="양호">기관 자체점검 양호</option><option value="보완중">보완중</option><option value="우려">안전·인권 우려 / 즉시 검토 요청</option></select></div>`).join('');
async function loadSelfAssessmentState(){if(session.role!=='facility')return;
  try{const x=await call('my_assessment_state');setMessage('self-check-status',`지난 제출: ${x.lastSubmittedDate||'없음'} · 다음 6개월 자체점검 권장일: ${x.nextSelfDue||'제출 후 안내'} · 관리자 재확인 권장일: ${x.nextAnnualDue||'검토 후 안내'} · 상태: ${x.status}`);}
  catch(e){setMessage('self-check-status','점검 현황 조회 실패: '+e.message);}}
$('self-check-send').onclick=async()=>{
  if(session.role!=='facility')return alert('기관 담당자 로그인이 필요합니다.');
  const answers=Object.fromEntries(ASSESSMENT_DOMAINS.map(([id])=>[id,formValue('self-'+id)]));
  if(!confirm('8개 영역의 자체점검 결과를 비공개 제출하시겠습니까? 우려 항목을 제출하면 기관 게시가 자동 보류될 수 있습니다.'))return;
  const btn=$('self-check-send');btn.disabled=true;
  try{const r=await call('submit_self_assessment',{answers,generalNote:formValue('self-check-note')});
    setMessage('self-check-feedback',`제출 완료 · 관리자 검토 대기 · 다음 자체점검 권장일 ${r.nextSelfDue}${r.publicationPaused?' · 안전 우려 신고로 게시가 일시 보류되었습니다.':''}`);
    await loadSelfAssessmentState();
  }catch(e){setMessage('self-check-feedback','제출 실패: '+e.message);}finally{btn.disabled=false;}
};

// 관리자는 기관 담당자 계정을 사칭하지 않고도 기관용 화면 구성을 열람합니다.
// 기관의 계약/수납/심사는 별도 관리자 화면에서만 수정 가능합니다.
function renderAdminFacilityPreview(){
  if(session.role!=='admin')return;
  const panel=$('admin-facility-preview-details');
  if(!panel)return;
  const f=adminFacilities.find(item=>item.id===selectedId);
  panel.innerHTML=f?`<div class="admin-preview-data"><div><small>선택한 기관</small><strong>${esc(f.name)}</strong></div><div><small>유형·위치</small><strong>${esc(f.type)} · ${esc(f.region)} ${esc(f.district)}</strong></div><div><small>게시 상태</small><strong>${esc(f.publicationStatus||'미확인')}</strong></div><div><small>홍보 상태</small><strong>${esc(f.advertisingStatus||'미확인')}</strong></div></div><p class="hintline">이 내용은 관리자 권한으로 읽은 기관 정보입니다. 기관 담당자 계정으로 대신 로그인한 화면은 아닙니다.</p>`:
  '<div class="empty">현재 선택한 기관이 없습니다. [기관·계약·승인 관리]에서 기관을 검색하고 선택하면 이곳에 선택 기관의 기본 현황이 표시됩니다.</div>';
}

// Administrative portal. The backend checks the admin custom claim on EVERY request.
let adminSearchState={keyword:'',region:'',district:'',type:''},adminSearchRequestId=0;
async function loadAdminOverview(){if(session.role!=='admin')return;
  try{
    const r=await call('admin_overview');
    for(const [key,id] of [['total','a-total'],['active','a-active'],['pending','a-pending']]){
      setMessage(id,Number.isInteger(r[key])?r[key].toLocaleString('ko-KR'):'—');
    }
    setMessage('a-overview-notice',r.partial?'일부 집계 항목은 현재 확인할 수 없습니다. 아래 기관 검색은 별도로 작동합니다.':'전체 등록기관 집계 완료 · 비공개 후보 포함');
  }catch(e){
    for(const id of ['a-total','a-active','a-pending'])setMessage(id,'—');
    setMessage('a-overview-notice','전체 집계 일시 오류: '+e.message+' · 아래 기관명 검색을 계속 이용할 수 있습니다.');
  }
}
async function loadAdmin(reset=true){if(session.role!=='admin')return;
  if(reset){
    nextAdminCursor=null;adminFacilities=[];
    setMessage('a-facilities','변경된 지역·기관 유형으로 전체 등록기관을 조회하고 있습니다…');
    $('a-more').hidden=true;
  }
  const requestId=++adminSearchRequestId;
  setMessage('a-search-notice','전체 등록기관에서 검색하는 중입니다.');
  try{
    const r=await call('admin_list',{...adminSearchState,after:nextAdminCursor||'',pageSize:100});
    if(requestId!==adminSearchRequestId)return;
    const prior=new Set(adminFacilities.map(f=>f.id));
    adminFacilities.push(...(r.items||[]).filter(f=>!prior.has(f.id)));
    nextAdminCursor=r.next||'';
    setMessage('a-search-notice',`현재 ${adminFacilities.length.toLocaleString('ko-KR')}곳 표시 · ${nextAdminCursor?'결과가 더 있습니다. [다음 결과]를 누르세요.':'현재 조건의 마지막 결과입니다.'}${r.partial?' 일부 자료는 계속 검색해야 합니다.':''} · 보호자에게 비공개인 기관도 포함`);
    renderAdmin();
    if(reset)await refreshRequests();
  }catch(e){if(requestId===adminSearchRequestId){
    setMessage('a-search-notice','관리자 DB 검색 오류: '+e.message+' · 아래에는 공개 기본명단만 참고용으로 표시합니다.');
    setMessage('a-facilities','관리자 서버 연결을 확인하는 중입니다. 공개 기본명단을 대신 불러옵니다…');
    $('a-more').hidden=true;
    // 관리서버가 실패해도 이미 공개가 허용된 '기관명·지역·유형' 참고 목록만 보여줍니다.
    // 관리자 전용 비공개 원본·기관ID·계약·승인·수납·계정은 로컬 목록으로 대체하지 않습니다.
    await ensureBasicDirectory();
    if(requestId!==adminSearchRequestId)return;
    if(!basicDirectory){
      setMessage('a-facilities','관리자 서버 검색과 공개 참고명단을 모두 불러오지 못했습니다. Netlify Functions의 api 로그 및 FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 확인하세요.');
      return;
    }
    const {keyword,region,district,type}=adminSearchState;
    const matches=basicDirectory.filter(f=>(!region||f.region===region)&&(!district||f.district===district)&&(!type||f.type===type)&&matchesDirectoryKeyword(f,keyword));
    const rows=matches.slice(0,60);
    $('a-facilities').innerHTML=`<div class="callout warn"><strong>참고용 기본명단 ${matches.length.toLocaleString('ko-KR')}곳</strong><br>관리자 서버 연결에 실패하여 공공자료의 과거 이름만 표시합니다. 아래 결과는 관리자 DB 조회·계약·수납·승인 결과가 아니며 선택하여 수정할 수 없습니다. 실제 운영 여부도 재확인이 필요합니다.</div>`+
      (rows.length?rows.map(f=>`<div class="admin-entry"><div><strong>${esc(f.name)}</strong><small>${esc(f.region)} ${esc(f.district)} · ${esc(f.type)} · 기준일 ${esc(f.asOf)}</small></div><span class="pill">참고명단</span></div>`).join(''):'<div class="empty">이 검색어에 해당하는 공개 참고 기관명이 없습니다.</div>')+
      (matches.length>rows.length?'<p class="hintline">첫 60개만 표시합니다. 검색어 또는 지역을 좁혀 주세요.</p>':'');
  }}
}
function renderAdmin(){
  $('a-facilities').innerHTML=adminFacilities.map(f=>`<div class="admin-entry ${selectedId===f.id?'selected':''}"><div><strong>${esc(f.name)}</strong><small>${esc(f.id)} · ${esc(f.region)} ${esc(f.district)} · ${esc(f.type)} · 게시 ${esc(f.publicationStatus)} · 광고 ${esc(f.advertisingStatus)}</small></div><button class="btn btn-outline btn-sm" data-select-fac="${esc(f.id)}">선택</button></div>`).join('')||'<div class="empty">현재 조건에 표시할 기관이 없습니다. 다른 지역이나 검색어로 다시 찾아보세요.</div>';
  $('a-more').hidden=!nextAdminCursor;
}
function setAdminDistricts(){optionDistrict('a-filter-region','a-filter-district');}
function runAdminSearch({allRegions=false}={}){
  adminSearchState={keyword:formValue('a-filter'),region:allRegions?'':formValue('a-filter-region'),district:allRegions?'':formValue('a-filter-district'),type:allRegions?'':formValue('a-filter-type'),preferExactName:allRegions};
  if(allRegions){setMessage('a-enter-hint','기관명 Enter 검색: 선택된 지역·유형과 관계없이 전체 지역에서 기관명을 찾습니다. 검색 버튼을 누르면 지역 필터가 다시 적용됩니다.');}
  loadAdmin(true);
}
$('a-refresh').onclick=()=>{runAdminSearch();loadAdminOverview();};
$('a-search').onclick=runAdminSearch;
// 관리자도 유형·지역을 바꾸면 전체 DB에 새 조건을 즉시 적용합니다.
for(const id of ['a-filter-region','a-filter-district','a-filter-type']){
  $(id).addEventListener('change',runAdminSearch);
}
$('a-filter').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runAdminSearch({allRegions:!!formValue('a-filter')});}};
$('a-search-reset').onclick=()=>{$('a-filter').value='';$('a-filter-region').value='';setAdminDistricts();$('a-filter-type').value='';runAdminSearch();};
$('a-more').onclick=()=>{if(nextAdminCursor)loadAdmin(false);};
function renderAdminDetails(f){const fields=[
  ['기관명',f.name],['내부 기관 ID',f.id],['기관 유형',f.type],['지역',`${f.region||''} ${f.district||''}`],['주소',f.address],['전화번호',f.phone],['공식 기관코드',f.officialId],['원본 출처',f.source],['원본 기준일',f.sourceDate],['정보 최근 확인일',f.lastConfirmedAt],['홈페이지',f.homepage],['기관 소개',f.description],['게시 승인',f.publicationStatus],['홍보 상태',f.advertisingStatus],['수납 상태',f.paymentStatus],['계약 시작일',f.contractStart],['계약 종료일',f.contractEnd],['내부 수납 확인번호',f.paymentReference],['수납 확인자 UID',f.paidConfirmedBy],['수납 확인시각',f.paidConfirmedAt],['담당자 UID',(f.managerUids||[]).join(', ')],['최초 등록일',f.createdAt],['최근 수정일',f.updatedAt]
 ];
  $('a-full-detail').innerHTML=fields.map(([title,value])=>`<div class="admin-detail-pair"><small>${esc(title)}</small><strong>${esc(value||'미확인 / 미입력')}</strong></div>`).join('');
}
function selectFacility(id){const f=adminFacilities.find(x=>x.id===id);if(!f)return;selectedId=id;setMessage('a-selected',f.id);const mapping={'a-name':'name','a-type':'type','a-region':'region','a-phone':'phone','a-address':'address','a-desc':'description','a-homepage':'homepage','a-image':'imageUrl','a-official':'officialId','a-source':'source'};for(const [field,key] of Object.entries(mapping))$(field).value=f[key]||'';
  optionDistrict('a-region','a-district',f.district);
  $('a-start').value=f.contractStart||'';$('a-end').value=f.contractEnd||'';$('a-reference').value='';$('a-paid').checked=false;
  setMessage('a-save-message',`선택: ${f.name} | 게시 ${f.publicationStatus} | 광고 ${f.advertisingStatus} | 입금 ${f.paymentStatus}`);renderAdmin();renderAdminDetails(f);renderAdminFacilityPreview();loadFieldAdmin();loadAdminAnalytics();
  // 목록 캐시와 별개로 최신 기관 정보를 관리자 권한으로 다시 조회합니다.
  call('admin_facility_detail',{facilityId:id}).then(r=>{if(selectedId===id&&r.facility)renderAdminDetails(r.facility);}).catch(e=>{if(selectedId===id)setMessage('a-detail-privacy','상세 재조회 오류: '+e.message);});
}
document.addEventListener('click',e=>{const btn=e.target.closest('[data-select-fac]');if(btn)selectFacility(btn.dataset.selectFac);});
$('a-new').onclick=()=>{selectedId='';setMessage('a-selected','신규 기관');setMessage('a-full-detail','신규 등록 화면입니다. 기관 저장 후 상세정보를 확인할 수 있습니다.');for(const id of ['a-name','a-phone','a-address','a-desc','a-homepage','a-image','a-official'])$(id).value='';$('a-source').value='직접 확인';setMessage('a-save-message','신규 기관은 비공개 후보로 등록됩니다.');renderAdmin();};
$('a-save').onclick=async()=>{const btn=$('a-save');btn.disabled=true;try{const r=await call('admin_save_facility',{facilityId:selectedId,facility:facilityForm('a-')});setMessage('a-save-message',`기관 저장 완료: ${r.facility.id} (공개 여부는 계약·승인 조건으로 결정)`);await loadAdmin();if(!adminFacilities.find(f=>f.id===r.facility.id)){adminFacilities.unshift(r.facility);renderAdmin();}selectFacility(r.facility.id);await loadAdminOverview();}catch(e){setMessage('a-save-message','저장 실패: '+e.message);}finally{btn.disabled=false;}};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-approve]');if(!b)return;if(!selectedId){alert('먼저 기관을 선택하세요.');return;}const st=b.dataset.approve;if(!confirm(st==='approved'?'기관정보의 사실·공개권한을 확인했고 게시 승인하시겠습니까?':'기관 게시 상태를 변경할까요?'))return;try{await call('admin_approve',{facilityId:selectedId,status:st});await loadAdmin();if(!adminFacilities.find(f=>f.id===selectedId)){const d=await call('admin_facility_detail',{facilityId:selectedId});adminFacilities.unshift(d.facility);}selectFacility(selectedId);await loadAdminOverview();await loadPublic();}catch(err){alert('승인상태 변경 실패: '+err.message);}});
$('a-link').onclick=async()=>{if(!selectedId)return alert('먼저 기관을 선택하세요.');const uid=formValue('a-uid');if(!uid)return alert('담당자 UID를 입력하세요.');if(!confirm('UID를 확인하고 선택된 기관의 관리 권한을 부여하시겠습니까?'))return;try{await call('admin_link_uid',{facilityId:selectedId,uid});alert('기관 담당자 연결 성공. 담당자가 로그아웃 후 다시 로그인하면 새 권한이 적용됩니다.');}catch(e){alert('권한 연결 실패: '+e.message);}};
$('a-issue-email').onclick=async()=>{if(!selectedId)return alert('기관을 선택하세요.');if(!confirm('담당자 이메일 계정과 임시 비밀번호를 발급하시겠습니까?'))return;try{const r=await call('admin_issue_email',{facilityId:selectedId,email:formValue('a-email')});setMessage('a-credential-output',`기관 ID: ${r.facilityId||selectedId}\n담당자 UID: ${r.uid}\n이메일: ${r.email}\n임시 비밀번호: ${r.temporaryPassword}\n\n비밀번호는 다시 조회할 수 없습니다. 안전하게 전달하세요.`);}catch(e){alert('계정 발급 실패: '+e.message);}};
async function changeContract(command){if(!selectedId)return alert('먼저 기관을 선택하세요.');if(command==='activate'&&!$('a-paid').checked)return alert('수납을 확인했다면 체크박스에 동의 표시하세요.');if(!confirm(command==='activate'?'실제 입금·계약 서류를 확인했고 유료 홍보를 시작하시겠습니까?':'이 기관의 홍보 노출 상태를 변경하시겠습니까?'))return;
  try{const r=await call('admin_contract',{facilityId:selectedId,command,start:formValue('a-start'),end:formValue('a-end'),paymentConfirmed:$('a-paid').checked,reference:formValue('a-reference')});setMessage('a-contract-message',`계약 ${command} 완료 · 현재 공개 ${r.visible?'예':'아니오'} · 정원 ${r.capacity}곳`);await loadAdmin();if(!adminFacilities.find(f=>f.id===selectedId)){const d=await call('admin_facility_detail',{facilityId:selectedId});adminFacilities.unshift(d.facility);}selectFacility(selectedId);await loadAdminOverview();await loadPublic();}catch(e){setMessage('a-contract-message','계약 처리 실패: '+e.message);}}
$('a-activate').onclick=()=>changeContract('activate');$('a-suspend').onclick=()=>changeContract('suspend');$('a-end-contract').onclick=()=>changeContract('end');
$('a-refresh-requests').onclick=refreshRequests;
function renderAdminRequests(){
  $('a-requests').innerHTML=adminRequests.length?adminRequests.map(r=>`<div class="review"><strong>${esc(r.payload?.name||'기관정보 요청')}</strong> · ${esc(r.status)}<div class="smallprint">${esc(r.facilityId)} · ${esc(r.authorUid)} · ${esc(r.createdAt?.slice(0,16))}</div><p>${esc(r.payload?.description||'')}</p>${r.status==='pending'?`<div class="flex"><button class="btn btn-primary btn-sm" data-review="${esc(r.id)}" data-decision="approved">내용 승인</button><button class="btn btn-outline btn-sm" data-review="${esc(r.id)}" data-decision="rejected">반려</button></div>`:''}</div>`).join(''):'<div class="empty">등록된 기관 수정 요청이 없습니다.</div>';
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-review]');if(!b)return;const status=b.dataset.decision;const reason=status==='rejected'?prompt('반려 사유를 입력하세요:','자료 보완 요청'):'관리자 확인 완료';if(reason===null)return;if(!confirm('기관 제출 내용 '+(status==='approved'?'승인':'반려')+'을 확정하시겠습니까?'))return;try{await call('review_request',{requestId:b.dataset.review,decision:status,reason});await refreshRequests();await loadAdmin();await loadPublic();}catch(e){alert('검토 처리 실패: '+e.message);}});

async function adminQuotaPreview(){try{const r=await call('private_quota',{region:formValue('a-q-region'),district:formValue('a-q-district'),type:formValue('a-q-type')},'GET');$('a-q-cap').value=r.capacity;setMessage('a-q-feedback',`${r.region} ${r.district} ${r.type}: 정원 ${r.capacity}, 현재 계약 ${r.active}, 잔여 ${r.remaining}`);}catch(e){setMessage('a-q-feedback',e.message);}}
$('a-q-preview').onclick=adminQuotaPreview;
$('a-q-save').onclick=async()=>{if(!confirm('지역 유료 홍보 정원을 변경할까요? 기존 유효 계약보다 작게 설정할 수 없습니다.'))return;try{const r=await call('admin_set_quota',{region:formValue('a-q-region'),district:formValue('a-q-district'),type:formValue('a-q-type'),capacity:Number(formValue('a-q-cap'))});setMessage('a-q-feedback',`${r.region} ${r.district} ${r.type} 정원 ${r.capacity}곳 저장 완료`);}catch(e){setMessage('a-q-feedback','정원 변경 실패: '+e.message);}};
$('a-q-export').onclick=async()=>{try{const r=await call('admin_quotas');fullQuotaRows=r.items;downloadCSV('돌봄지음_42권역_홍보정원.csv',['시도','시군구','유형','홍보정원','계약중','남은자리','월홍보료'],r.items.map(x=>[x.region,x.district,x.type,x.capacity,x.active,x.remaining,x.monthlyPrice]));}catch(e){alert('정원 다운로드 실패: '+e.message);}};
function csvEscape(x){let s=String(x??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function downloadCSV(name,headers,rows){const body='\uFEFF'+[headers,...rows].map(row=>row.map(csvEscape).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function parseCSV(text){const sep=(text.split(/\r?\n/,1)[0].match(/\t/g)||[]).length>(text.split(/\r?\n/,1)[0].match(/,/g)||[]).length?'\t':',';let rows=[],row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===sep&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;}
function mapImportCSV(rows){const headers=rows[0].map(v=>v.replace(/^\uFEFF/,'').trim().toLowerCase());const idx=(names)=>names.map(n=>headers.indexOf(n.toLowerCase())).find(x=>x!==-1);
  const pick=(r,n)=>{const i=idx(n);return i===undefined?'':String(r[i]||'').trim();};
  return rows.slice(1).map(r=>{
    const address=pick(r,['주소','addr','address']),typeRaw=pick(r,['유형','type','기관유형']),regionRaw=pick(r,['시도','region','광역시도','시·도']);
    const region=regionRaw.includes('광주')?'광주':regionRaw.includes('전남')?'전남':regionRaw.includes('전북')?'전북':address.includes('광주')?'광주':address.includes('전라남도')?'전남':address.includes('전북')?'전북':'';
    let district=pick(r,['시군구','sigungu','district','시·군·구']);
    if(region==='전북'&&(district==='전주시'||district==='전주시 완산구'||district==='전주시 덕진구'))district=address.includes('완산구')?'전주시 완산구':address.includes('덕진구')?'전주시 덕진구':district==='전주시'?'전주시 (구 미확정)':district;
    const type=typeRaw.includes('병원')?'요양병원':typeRaw.includes('주야')||typeRaw.includes('주간')?'주야간보호':typeRaw.includes('요양원')?'요양원':typeRaw.includes('재가')||typeRaw.includes('방문')?'방문돌봄':typeRaw;
    return {name:pick(r,['기관명','name','n']),type,region,district,address,phone:pick(r,['전화','tel','phone','전화번호']),description:pick(r,['소개','description','pr']),officialId:pick(r,['원본id','기관코드','officialId','id']),source:pick(r,['출처','source'])||'CSV 가져오기',sourceDate:pick(r,['기준일','sourceDate'])};
  }).filter(x=>x.name);
}
$('a-import').onclick=async()=>{const file=$('a-csv').files?.[0];if(!file)return alert('먼저 CSV 파일을 선택하세요.');if(file.size>3500000)return alert('CSV 파일은 3.5MB 이하만 가능합니다.');const btn=$('a-import');btn.disabled=true;
  try{const rows=mapImportCSV(parseCSV(await file.text()));if(!rows.length)throw Error('인식된 기관이 없습니다. CSV 제목 행을 확인하세요.');if(!confirm(`${rows.length}곳을 비공개 영업 후보로 가져오시겠습니까? 공개되거나 자동 계약되지 않습니다.`))return;
    let created=0,updated=0,errors=[];
    for(let i=0;i<rows.length;i+=40){const r=await call('admin_import',{rows:rows.slice(i,i+40)});created+=r.created;updated+=r.updated;errors.push(...(r.errors||[]));setMessage('a-import-message',`${Math.min(i+40,rows.length)}/${rows.length}곳 처리 중...`);}
    setMessage('a-import-message',`비공개 이관 완료: 신규 ${created}곳, 기존 ${updated}곳, 확인 필요 ${errors.length}곳${errors.length?' / '+errors.slice(0,5).join(' · '):''}`);await loadAdmin();
  }catch(e){setMessage('a-import-message','이관 실패: '+e.message);}finally{btn.disabled=false;}};
$('a-export').onclick=async()=>{try{let items=[],after='';do{const r=await call('admin_list',{after,pageSize:200});items.push(...r.items);after=r.next||'';if(items.length>6000)throw Error('일괄 내보내기 제한에 걸렸습니다.');}while(after);
  downloadCSV('돌봄지음_비공개기관_백업.csv',['기관ID','기관명','유형','시도','시군구','주소','전화','소개','공식ID','출처','정보승인','광고상태','입금상태','계약시작','계약종료'],items.map(x=>[x.id,x.name,x.type,x.region,x.district,x.address,x.phone,x.description,x.officialId,x.source,x.publicationStatus,x.advertisingStatus,x.paymentStatus,x.contractStart,x.contractEnd]));}catch(e){alert('기관자료 백업 실패: '+e.message);}};

const CRITERIA=[
 ['기본 자격','공적 신고·인허가 현황, 기관별 공단 평가체계, 행정처분 등 확인. 과거 원안의 등급·운영기간 제한은 법적·유형별 적용성 재검토가 필요합니다.'],
 ['시설 환경','청결·악취·환기·자연채광·안전한 이동동선·생활공간의 실제 사용 여부를 확인합니다.'],
 ['방치 위험','응답·순회·식사·투약 누락 방지 체계와 인력 배치를 해당 기관 유형에 맞게 확인합니다.'],
 ['존중과 인권','이름으로 호칭, 개인 선택권, 부당 억제 방지, 사생활 보호 여부를 확인합니다.'],
 ['정서와 관계','개별 상호작용과 가족 소통, 사회적 교류 기회 등 정서적 지지 환경을 살핍니다.'],
 ['직원 안정성','근속·이직 추이와 교육·업무지원, 응대 태도 등 확인 가능한 근거를 살핍니다.'],
 ['사고 대응','사고 인지·기록·보호자 통보와 응급 연계 프로토콜을 확인합니다.'],
 ['프로그램 실효성','게시된 프로그램 목록보다 실제 참여·개별화·접근 가능성을 확인합니다.'],
 ['보호자 심리적 신뢰','기관 방문 시 느끼는 존중·안정감·설명 충실도를 기록하되, 객관적 안전성 평가를 대체하지 않습니다.']
];
$('criteria-list').innerHTML=CRITERIA.map((x,i)=>`<div class="panel"><span class="pill">${String(i+1).padStart(2,'0')}</span><h3 style="margin-top:12px">${esc(x[0])}</h3><p>${esc(x[1])}</p></div>`).join('');

// 심사결과는 광고계약과 독립적이며, 검토된 출처·상태만 공개 DB에 저장됩니다.
let assessmentPending=[];
async function loadAssessments(){if(session.role!=='admin')return;
  try{const x=await call('admin_pending_assessments');assessmentPending=x.items||[];renderAssessments();}
  catch(e){setMessage('a-assessments','점검 신청 조회 실패: '+e.message);}}
$('a-refresh-assessments').onclick=loadAssessments;
function renderAssessments(){
 const root=$('a-assessments');
 if(!assessmentPending.length){root.innerHTML='<div class="empty">검토 대기 중인 점검이 없습니다. 점검 보고가 없다는 뜻이지 시설의 우수성을 뜻하지 않습니다.</div>';return;}
 root.innerHTML=assessmentPending.map(r=>`<section class="panel" style="margin-top:12px" data-assess-id="${esc(r.id)}"><h3>${esc(r.facilityName)} · ${esc(r.facilityType)}</h3><p class="smallprint">기관 ID ${esc(r.facilityId)} · 제출일 ${esc(r.submittedDate)}</p><p>기관 내부 개선계획: ${esc(r.generalNote||'미입력')}</p><div class="assessment-form">${ASSESSMENT_DOMAINS.map(([id,name])=>`<div class="assessment-row"><strong>${esc(name)}</strong><small>기관 자체점검: ${esc(r.answers?.[id]||'미확인')}</small><label>확인 방법 <select data-source="${esc(id)}"><option value="미확인">미확인</option><option value="기관보고">기관 자체보고</option><option value="서류">서류 확인</option><option value="현장">현장 확인</option></select></label><label>확인 상태 <select data-finding="${esc(id)}"><option value="미확인">미확인</option><option value="보완중">보완중</option><option value="확인">확인</option><option value="우려">안전·인권 우려</option></select></label><label>근거(서류·현장은 필수) <input data-evidence="${esc(id)}" maxlength="300" placeholder="개인정보 없이 확인자료 종류/확인일 기록"></label></div>`).join('')}</div><label>내부 검토 메모 (보완요청 시 필수)<textarea data-internal-reason rows="2" maxlength="400" placeholder="개인정보 없이 보완 요청 이유 기록"></textarea></label><div class="flex" style="margin-top:12px"><button class="btn btn-primary btn-sm" data-assess-action="publish">확인현황 공개 승인</button><button class="btn btn-outline btn-sm" data-assess-action="revision">보완요청</button><button class="btn btn-outline btn-sm" data-assess-action="hold">중대 우려 · 게시 보류</button></div><p class="hintline">광고비와 무관하게 확인합니다. 기관 자체보고만으로 확인 완료를 선택할 수 없습니다.</p></section>`).join('');
}
document.addEventListener('click',async e=>{
 const btn=e.target.closest('[data-assess-action]');if(!btn)return;
 const container=btn.closest('[data-assess-id]');const decision=btn.dataset.assessAction;
 const results=Object.fromEntries(ASSESSMENT_DOMAINS.map(([id])=>[id,{source:container.querySelector(`[data-source="${id}"]`).value,finding:container.querySelector(`[data-finding="${id}"]`).value,note:container.querySelector(`[data-evidence="${id}"]`).value}]));
 const internalReason=container.querySelector('[data-internal-reason]').value;
 if(!confirm(decision==='publish'?'검토 내용을 보호자에게 공개하시겠습니까? 미확인·기관 자체보고는 그대로 구분됩니다.':decision==='hold'?'이 기관의 공개 게시를 보류하고 심사 기록을 남기시겠습니까?':'기관에 추가 증빙과 보완을 요청하시겠습니까?'))return;
 btn.disabled=true;
 try{await call('admin_review_assessment',{reportId:container.dataset.assessId,decision,results,internalReason});await loadAssessments();if(decision==='hold'){await loadAdmin();await loadPublic();}}
 catch(err){alert('점검 검토 실패: '+err.message);}finally{btn.disabled=false;}
});


// [v2.6] 관리자가 직접 방문해 확인한 29개 세부 자료: 초안과 공개본 분리.
function fieldSelectOptions(values,current){return values.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v)}</option>`).join('');}
const FIELD_IDS_UI=ASSESSMENT_DOMAINS.flatMap(([id],_)=>PUBLIC_CHECKLIST[id].map((_,j)=>`${id}-${j+1}`));
let fieldDraftVersion=null;
function renderFieldEditor(rows={}){
  $('a-field-questions').innerHTML=ASSESSMENT_DOMAINS.map(([group,name],i)=>{
    const items=(PUBLIC_CHECKLIST[group]||[]).map(([q,hint],j)=>{
      const id=`${group}-${j+1}`,row=rows[id]||{};
      return `<article class="field-item" data-field-id="${esc(id)}"><b>${j+1}. ${esc(q)}</b><p>${esc(hint)}</p><div class="field-cols"><label>확인 방법<select data-field-source>${fieldSelectOptions(['미확인','현장','서류','기관보고'],row.source||'미확인')}</select></label><label>판단 상태<select data-field-finding>${fieldSelectOptions(['미확인','확인','보완중','우려'],row.finding||'미확인')}</select></label></div><label>관리자 내부 점검 근거 · 비공개<textarea data-field-internal maxlength="400" rows="2" placeholder="관찰한 사실과 자료 종류를 구체적으로 기록. 개인정보 금지">${esc(row.internalNote||'')}</textarea></label><label>보호자가 읽을 공개 설명 · 승인 시에만 노출<textarea data-field-public maxlength="180" rows="2" placeholder="예: 현장점검 당시 공용공간을 관찰했습니다. 관찰하지 않은 내용은 적지 마세요.">${esc(row.publicSummary||'')}</textarea></label></article>`;
    }).join('');
    return `<details class="field-domain" ${i===0?'open':''}><summary>${i+1}. ${esc(name)} <small>${PUBLIC_CHECKLIST[group].length}개 항목 · 직접 확인한 내용만 기록</small></summary><div class="field-items">${items}</div></details>`;
  }).join('');
}
function getFieldForm(){
  const rows={};
  document.querySelectorAll('[data-field-id]').forEach(el=>{
    rows[el.dataset.fieldId]={source:el.querySelector('[data-field-source]').value,finding:el.querySelector('[data-field-finding]').value,internalNote:el.querySelector('[data-field-internal]').value,publicSummary:el.querySelector('[data-field-public]').value};
  });
  return {facilityId:selectedId,visitedDate:formValue('a-field-date'),internalGeneral:formValue('a-field-internal'),rows};
}
async function loadFieldAdmin(){
  if(session.role!=='admin')return;
  const f=adminFacilities.find(x=>x.id===selectedId);
  if(!f){$('a-field-name').value='';$('a-field-questions').innerHTML='';setMessage('a-field-status','기관을 먼저 선택하세요.');return;}
  $('a-field-name').value=`${f.name} (${f.type})`;
  if(!['요양병원','요양원'].includes(f.type)){$('a-field-questions').innerHTML='';setMessage('a-field-status','이 유형은 아직 29개 세부점검을 지원하지 않습니다. 요양병원 또는 요양원을 선택하세요.');return;}
  const targetId=selectedId;
  setMessage('a-field-status','관리자 전용 현장점검 초안을 불러오는 중입니다.');
  try{
    const result=await call('admin_field_state',{facilityId:targetId},'GET');
    if(targetId!==selectedId)return;
    const draft=result.draft||{};
    $('a-field-date').value=draft.visitedDate||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
    $('a-field-internal').value=draft.internalGeneral||'';
    renderFieldEditor(draft.rows||{});
    setMessage('a-field-status',`선택: ${f.name} · 초안 ${draft.editStatus||'없음'} · 기존 공개 ${result.published?.publishedDate||'없음'} · 안전 게시보류 ${result.riskHold?'적용':'없음'}`);
  }catch(e){setMessage('a-field-status','세부점검 초안 조회 실패: '+e.message);}
}
$('a-field-refresh').onclick=loadFieldAdmin;
$('a-field-save').onclick=async()=>{
  if(!selectedId){alert('기관을 먼저 선택하세요.');return;}
  const payload=getFieldForm();
  if(payload.rows&&Object.values(payload.rows).some(r=>r.finding==='우려')&&!confirm('중대한 우려로 기록한 항목이 있습니다. 저장 즉시 해당 기관의 광고 게시가 보류될 수 있습니다. 계속하시겠습니까?'))return;
  const btn=$('a-field-save');btn.disabled=true;
  try{const r=await call('admin_field_save',payload);setMessage('a-field-status',`초안 저장 완료. 확인 항목 ${r.verified}개${r.publicationPaused?' · 안전 관련 우려로 기관 게시 보류됨':''}`);}
  catch(e){setMessage('a-field-status','임시저장 실패: '+e.message);}finally{btn.disabled=false;}
};
$('a-field-publish').onclick=async()=>{
  if(!selectedId){alert('기관을 먼저 선택하세요.');return;}
  if(!confirm('저장된 현장점검 초안을 보호자에게 공개할까요? 내부 메모는 공개하지 않지만 승인된 공개용 설명은 보호자에게 표시됩니다.'))return;
  const btn=$('a-field-publish');btn.disabled=true;
  try{const r=await call('admin_field_publish',{facilityId:selectedId});setMessage('a-field-status',`보호자 공개 완료 · 공개일 ${r.date}`);}
  catch(e){setMessage('a-field-status','공개 승인 실패: '+e.message+' (필요한 경우 먼저 임시저장하세요)');}finally{btn.disabled=false;}
};

// Only public approved paid institutions are requested at start.
loadPublic();
recordVisit('site_visit');
