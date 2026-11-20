// 관리자 전용 기관 검색 입력과 목록 필터 — 일반 이용자에 공개되지 않습니다.
const text=(x,max=110)=>typeof x==='string'?x.trim().slice(0,max):'';
export function adminSearchParams(body={}){
  const query=text(body.keyword,100).toLocaleLowerCase('ko');
  const region=text(body.region,15), district=text(body.district,35), type=text(body.type,25);
  const raw=Number(body.pageSize ?? 100);
  if(!Number.isInteger(raw)||raw<1||raw>200)throw Error('페이지 크기는 1~200이어야 합니다.');
  return {query,region,district,type,pageSize:raw,after:text(body.after,90)};
}
export function adminMatchesFacility(f,{query='',region='',district='',type=''}){
  if(region&&f.region!==region)return false;
  if(district&&f.district!==district)return false;
  if(type&&f.type!==type)return false;
  if(!query)return true;
  // '고운정 요양원' -> '나주고운정요양원', '나주 요양원' -> 나주시의 요양원.
  // 공백을 제거한 연속명칭과, 분리된 검색어가 각각 포함되는 경우를 모두 지원합니다.
  const q=String(query).toLocaleLowerCase('ko').trim();
  const haystack=[f.id,f.name,f.officialId,f.region,f.district,f.type,f.address,f.phone,f.source]
   .map(x=>String(x??'')).join(' ').toLocaleLowerCase('ko');
  const compact=haystack.replace(/\s+/g,'');
  if(compact.includes(q.replace(/\s+/g,'')))return true;
  return q.split(/\s+/).every(term=>haystack.includes(term)||compact.includes(term));
}
// 반환한 마지막 문서 ID를 다음 커서로 사용하므로 검색 중 결과가 빠지지 않습니다.
export function adminPageResult({items,after,scanned,limitReached,exhausted}){
  return {items,next:exhausted?'':after,scanned,partial:!!limitReached&&!exhausted};
}
