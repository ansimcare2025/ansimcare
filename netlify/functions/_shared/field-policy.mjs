// 기관별 29개 세부 현장점검: 서버에서 데이터 유효성·공개정보를 제한합니다.
// 화면 문구와 인덱스를 바꾸면 기관별 저장 식별자도 바뀌므로 기존 ID를 유지하세요.
export const FIELD_GROUP_COUNTS=Object.freeze({qualification:4,environment:4,neglect:4,dignity:4,relation:4,staff:3,incident:3,activities:3});
export const FIELD_IDS=Object.freeze(Object.entries(FIELD_GROUP_COUNTS).flatMap(([d,n])=>Array.from({length:n},(_,i)=>`${d}-${i+1}`)));
export const FIELD_SOURCES=['미확인','현장','서류','기관보고'];
export const FIELD_FINDINGS=['미확인','확인','보완중','우려'];
export const FIELD_RISK_DOMAINS=['neglect','dignity','incident'];
const clip=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
export const checkedDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const sensitivePattern=/(?:\b\d{6}[- ]?[1-8]\d{6}\b)|(?:01[016789][- ]?\d{3,4}[- ]?\d{4})|(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
export function validateFieldDraft(input,{publish=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('점검자료 형식을 확인하세요.');
  const {rows,visitedDate,internalGeneral}=input;
  if(!checkedDate(visitedDate))throw Error('점검일은 YYYY-MM-DD 형식으로 입력하세요.');
  if(Date.parse(visitedDate+'T00:00:00Z')>Date.now()+86400000)throw Error('미래의 점검일은 입력할 수 없습니다.');
  if(!rows||typeof rows!=='object'||Array.isArray(rows))throw Error('29개 세부점검 결과가 필요합니다.');
  for(const k of Object.keys(rows))if(!FIELD_IDS.includes(k))throw Error('알 수 없는 세부점검 항목이 있습니다.');
  const safeRows={};let concerns=[],verified=0;
  for(const id of FIELD_IDS){
    const raw=rows[id]||{};const source=clip(raw.source,12)||'미확인',finding=clip(raw.finding,12)||'미확인';
    const note=clip(raw.internalNote,400),summary=clip(raw.publicSummary,180);
    if(!FIELD_SOURCES.includes(source)||!FIELD_FINDINGS.includes(finding))throw Error(`${id}: 확인 방식과 상태를 확인하세요.`);
    if(source==='미확인'&&finding!=='미확인')throw Error(`${id}: 확인 경로가 없으면 상태도 미확인입니다.`);
    if(source==='기관보고'&&finding==='확인')throw Error(`${id}: 기관 자체보고만으로 검증 완료로 표시할 수 없습니다.`);
    if(source!=='미확인'&&finding!=='미확인'&&note.length<8)throw Error(`${id}: 구체적인 내부 확인 근거를 8자 이상 기록하세요.`);
    if(publish&&source!=='미확인'&&finding!=='미확인'&&summary.length<8)throw Error(`${id}: 보호자 공개 설명을 8자 이상 작성하세요.`);
    if(sensitivePattern.test(summary))throw Error(`${id}: 공개 설명에 개인정보가 포함된 것으로 보입니다. 다시 확인하세요.`);
    if(finding==='우려')concerns.push(id);
    if(['현장','서류'].includes(source)&&finding==='확인')verified++;
    safeRows[id]={source,finding,internalNote:note,publicSummary:summary};
  }
  if(publish&&verified===0)throw Error('확인된 현장 또는 서류 항목이 없습니다. 모두 미확인인 상태는 공개하지 않습니다.');
  return {visitedDate,internalGeneral:clip(internalGeneral,700),rows:safeRows,concerns,verified};
}
export function publicFieldRows(rows){
  return Object.fromEntries(FIELD_IDS.map(id=>{const row=rows?.[id]||{};
    const source=row.source||'미확인',finding=row.finding||'미확인';
    return [id,{source,finding,summary:source==='미확인'||finding==='미확인'?'':(row.publicSummary||'')}];
  }));
}
