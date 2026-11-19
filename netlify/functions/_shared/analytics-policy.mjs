// 돌봄지음 v2.8: 이용자 식별 없이 일별 브라우저 세션을 근사 집계합니다.
// 실제 사람 수, 실입소/상담 건수 또는 광고 전환을 의미하지 않습니다.
import {createHash} from 'node:crypto';
export const METRICS=Object.freeze({site_visit:'siteSessions',facility_detail:'detailSessions',phone_click:'phoneSessions'});
const SESSION_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function cleanTrackingRequest(body={}){
  const metric=String(body.metric||'');
  const sessionId=String(body.sessionId||'');
  const facilityId=String(body.facilityId||'');
  if(!Object.hasOwn(METRICS,metric))throw Error('지원하지 않는 방문 집계 항목입니다.');
  if(!SESSION_RE.test(sessionId))throw Error('방문 집계 세션이 유효하지 않습니다.');
  if(metric==='site_visit'){
    if(facilityId)throw Error('전체 방문 기록에는 기관 ID가 포함되지 않아야 합니다.');
  }else if(!/^[A-Za-z0-9_-]{4,90}$/.test(facilityId))throw Error('기관 식별값이 유효하지 않습니다.');
  return {metric,sessionId:sessionId.toLowerCase(),facilityId};
}
export function trackingKeys(day,{metric,sessionId,facilityId}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('집계 날짜가 유효하지 않습니다.');
  const target=metric==='site_visit'?'site':'facility_'+facilityId;
  const dedupId=createHash('sha256').update(['v1',day,metric,facilityId,sessionId].join('|')).digest('hex');
  return {dailyDoc:day+'__'+target,dedupId,field:METRICS[metric]};
}
export function lastDays(endDay,days=30){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(endDay)||days<1||days>90)throw Error('기간 오류');
  const end=Date.parse(endDay+'T00:00:00Z');
  return Array.from({length:days},(_,i)=>new Date(end-(days-1-i)*86400000).toISOString().slice(0,10));
}
export function aggregateReport(days,siteDocs,facilityDocs){
  const daily=days.map((day,i)=>({day,siteSessions:Math.max(0,Number(siteDocs[i]?.siteSessions)||0),detailSessions:Math.max(0,Number(facilityDocs[i]?.detailSessions)||0),phoneSessions:Math.max(0,Number(facilityDocs[i]?.phoneSessions)||0)}));
  return {days:daily,summary:daily.reduce((a,r)=>({siteSessions:a.siteSessions+r.siteSessions,detailSessions:a.detailSessions+r.detailSessions,phoneSessions:a.phoneSessions+r.phoneSessions}),{siteSessions:0,detailSessions:0,phoneSessions:0})};
}
