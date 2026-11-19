// 돌봄지음 보호자 중심 자체점검 (자체 기준; 공적 인증 아님)
export const DOMAINS = Object.freeze([
  {id:'qualification',name:'기본 자격',description:'인허가·공식평가·행정 이력의 확인 범위'},
  {id:'environment',name:'시설 환경',description:'청결·냄새·채광·공용공간과 생활환경'},
  {id:'neglect',name:'방치 예방',description:'요청 응답·순회·식사·투약 관련 관리체계'},
  {id:'dignity',name:'존중과 인권',description:'호칭·선택권·사생활·부당 통제 방지'},
  {id:'relation',name:'정서와 관계',description:'개별 상호작용·대화·가족 소통'},
  {id:'staff',name:'직원 안정성',description:'근속·인력 운영·교육·업무 연속성'},
  {id:'incident',name:'안전 및 사고 대응',description:'사고 보고·기록·보호자 통보·응급 연계'},
  {id:'activities',name:'프로그램 실효성',description:'프로그램 실제 참여·개별화·접근성'}
]);
export const SELF_STATUSES=['양호','보완중','우려','미확인'];
export const FINDINGS=['확인','보완중','우려','미확인'];
export const SOURCES=['현장','서류','기관보고','미확인'];
export const SUPPORTED_TYPES=['요양병원','요양원'];
export function addMonths(date,months){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isInteger(months))throw new Error('유효한 날짜가 아닙니다.');
  const [y,m,d]=date.split('-').map(Number);
  const candidate=new Date(Date.UTC(y,m-1,1));
  if(candidate.getUTCFullYear()!==y||candidate.getUTCMonth()!==m-1||d<1||d>new Date(Date.UTC(y,m,0)).getUTCDate())throw new Error('유효하지 않은 달력 날짜입니다.');
  const next=new Date(Date.UTC(y,m-1+months,1)),days=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();
  next.setUTCDate(Math.min(d,days));return next.toISOString().slice(0,10);
}
export function checkSelf(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('자체점검 항목을 확인하세요.');
  const entries={};for(const d of DOMAINS){const status=payload[d.id];if(!SELF_STATUSES.includes(status))throw new Error(`${d.name} 상태를 선택하세요.`);entries[d.id]=status;}return entries;
}
export function checkReview(rows){
  if(!rows||typeof rows!=='object'||Array.isArray(rows))throw new Error('검토 결과를 확인하세요.');
  const out={};for(const d of DOMAINS){const r=rows[d.id];if(!r||!SOURCES.includes(r.source)||!FINDINGS.includes(r.finding))throw new Error(`${d.name}의 확인방법과 상태를 선택하세요.`);
    if(r.source==='미확인'&&r.finding!=='미확인')throw new Error(`${d.name}: 확인하지 못한 항목은 미확인으로 표시해야 합니다.`);
    if(r.source==='기관보고'&&r.finding==='확인')throw new Error(`${d.name}: 기관 자체보고만으로 확인 완료를 표시할 수 없습니다.`);
    const note=typeof r.note==='string'?r.note.trim().slice(0,300):'';
    if(['현장','서류'].includes(r.source)&&!note)throw new Error(`${d.name}: 현장·서류 확인의 내부 근거를 기재하세요.`);
    out[d.id]={source:r.source,finding:r.finding,note};
  }return out;
}
export function publicReview(rows){return Object.fromEntries(DOMAINS.map(d=>[d.id,{source:rows[d.id]?.source||'미확인',finding:rows[d.id]?.finding||'미확인'}]));}

// 안전·인권 우려가 제출된 항목은 관리자 확인으로만 보류 해제.
// 기관 자체보고 또는 미확인 상태만으로 보류를 해제하지 않습니다.
export function riskReleaseAllowed(selfAnswers={},reviewRows={},additionalRiskDomains=[]){
  const required=new Set([...Object.entries(selfAnswers||{}).filter(([,status])=>status==='우려').map(([id])=>id),...additionalRiskDomains]);
  return [...required].every((id)=>{
    const row=reviewRows?.[id];
    return Boolean(row && ['현장','서류'].includes(row.source) && row.finding==='확인' && typeof row.note==='string' && row.note.trim());
  });
}
