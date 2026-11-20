import { randomBytes, createHash } from 'node:crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { regions, types, getPrivatePrices, defaultCap, dateOK, todayKST, visible } from './business-rules.mjs';
export { regions, types, getPrivatePrices, defaultCap, dateOK, todayKST, visible } from './business-rules.mjs';

export function fail(status,message){const e=new Error(message);e.statusCode=status;throw e;}
export function txt(x,n=150){return typeof x==='string'?x.trim().slice(0,n):'';}
export function response(status,body,headers={}) {return {statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff',...headers},body:JSON.stringify(body)};}
export function wrapError(e){
  const status=e.statusCode||500;
  if(status>=500){
    // 문제의 유형만 기록합니다. 자격증명 JSON/토큰/개인정보는 로그에 남기지 않습니다.
    const marker= /FIREBASE_SERVICE_ACCOUNT_JSON 미설정/.test(e.message)?'firebase-credentials-missing':
      /서비스 계정 JSON 형식 오류/.test(e.message)?'firebase-credentials-malformed':
      /허용된 Firebase 프로젝트가 아닙니다/.test(e.message)?'firebase-project-mismatch':
      String(e.code||e.name||'server_error').replace(/[^a-zA-Z0-9._-]/g,'').slice(0,70);
    console.error('CareIndex error:',marker,'status:',status);
  }
  return response(status,{ok:false,error:status>=500?'서버 연결/설정에 문제가 있습니다. 관리자에게 문의해 주세요.':e.message});
}
export function services(){
  if(!getApps().length){
    const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if(!raw)fail(503,'FIREBASE_SERVICE_ACCOUNT_JSON 미설정');
    let parsed;try{parsed=JSON.parse(raw);}catch{fail(503,'서비스 계정 JSON 형식 오류');}
    if(parsed.project_id!=='ansimcare-9bae3')fail(503,'허용된 Firebase 프로젝트가 아닙니다.');
    initializeApp({credential:cert(parsed),projectId:parsed.project_id});
  }
  return {auth:getAuth(),db:getFirestore(),FieldValue};
}
export async function authUser(event,s){
  const bearer=event.headers?.authorization||event.headers?.Authorization||'';
  const m=/^Bearer\s+(.+)$/i.exec(bearer);
  if(!m)fail(401,'로그인이 필요합니다.');
  try{return await s.auth.verifyIdToken(m[1],true);}catch{fail(401,'로그인이 만료되었거나 인증이 유효하지 않습니다.');}
}
export function requireAdmin(u){if(u.role!=='admin')fail(403,'관리자 권한이 없습니다.');}
export function ensureLocation(region,district){if(!regions[region]?.includes(district))fail(400,'시·군·구를 정확히 지정하세요. 전주시는 완산구/덕진구를 구분해야 합니다.');}
export function ensureType(type){if(!types.includes(type))fail(400,'지원하지 않는 기관 유형입니다.');}
export function key(region,district,type){return createHash('sha256').update([region,district,type].join('|')).digest('hex').slice(0,24);}
export function publicFields(f,id){return {id,name:txt(f.name,100),type:f.type,region:f.region,district:f.district,address:txt(f.address,180),phone:txt(f.phone,45),description:txt(f.description,1200),homepage:txt(f.homepage,200),imageUrl:txt(f.imageUrl,500),lastConfirmedAt:txt(f.lastConfirmedAt,16),contractStart:f.contractStart,contractEnd:f.contractEnd,advertisement:true};}
export function normalizedFacility(input={}){
  const region=txt(input.region,15),district=txt(input.district,35),type=txt(input.type,25),name=txt(input.name,100);
  ensureLocation(region,district);ensureType(type);
  if(name.length<2)fail(400,'기관명을 2자 이상 입력하세요.');
  const homepage=txt(input.homepage,200),imageUrl=txt(input.imageUrl,500);
  for(const u of [homepage,imageUrl])if(u && (!u.startsWith('https://')||/[<>"'\s]/.test(u)))fail(400,'홈페이지와 사진 주소는 유효한 https 주소여야 합니다.');
  return {name,type,region,district,address:txt(input.address,180),phone:txt(input.phone,45),description:txt(input.description,1200),homepage,imageUrl,officialId:txt(input.officialId,100),source:txt(input.source,100)||'기관/관리자 등록',sourceDate:txt(input.sourceDate,20),lastConfirmedAt:txt(input.lastConfirmedAt,16)};
}
export function facilityId(){return 'CI-'+randomBytes(7).toString('hex').toUpperCase();}
export async function audit(s,actor,action,id,details={}){await s.db.collection('ci_audit').add({actor,action,facilityId:id||null,details,createdAt:FieldValue.serverTimestamp()});}
export function emailOK(x){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x||'')&&(x||'').length<250;}
