import { timingSafeEqual } from 'node:crypto';
import { services, response } from './_shared/core.mjs';
import {resolveKakaoRedirect} from './_shared/kakao-origin.mjs';
const clear='__Host-ci-oauth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
function safeEqual(a,b){if(!a||!b||a.length!==b.length)return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function popupHTML(token,redirectMode,origin){
  // Custom Token is short-lived. Never put access/refresh tokens in client storage.
  const packet=JSON.stringify({type:'careindex-kakao',token}).replaceAll('<','\\u003c');
  const target=JSON.stringify(origin);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>돌봄지음 호남 로그인</title></head><body><p>로그인 확인 중입니다.</p><script>
  const packet=${packet};
  if(${redirectMode?'false':'true'} && window.opener && !window.opener.closed){window.opener.postMessage(packet,${target});window.close();document.body.textContent='로그인이 완료되었습니다. 이 창을 닫아주세요.';}
  else{window.location.replace('/#kakao_token='+encodeURIComponent(packet.token));}
  <\/script></body></html>`;
}
export async function handler(event){
  const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",'Set-Cookie':clear};
  const fail=(message)=>({statusCode:400,headers,body:`<!doctype html><meta charset="utf-8"><title>로그인 오류</title><p>${message}</p><a href="/">홈으로 돌아가기</a>`});
  if(event.httpMethod!=='GET')return fail('허용되지 않는 요청입니다.');
  const cookie=(event.headers?.cookie||event.headers?.Cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-ci-oauth='));
  const value=cookie?.split('=')[1]||'';const [expected,mode]=value.split('.');
  const state=event.queryStringParameters?.state||'';
  if(!safeEqual(expected,state))return fail('로그인 요청이 만료되었습니다. 처음부터 다시 시도해주세요.');
  if(event.queryStringParameters?.error)return fail('카카오에서 로그인이 취소되거나 승인되지 않았습니다.');
  const code=event.queryStringParameters?.code;
  if(!code||code.length>1024)return fail('카카오 로그인 인가코드를 받지 못했습니다.');
  const key=process.env.KAKAO_REST_API_KEY,configured=process.env.KAKAO_REDIRECT_URI;
  if(!key||!configured)return fail('서버의 카카오 로그인 설정이 필요합니다.');
  try{
    const redirect=resolveKakaoRedirect(event.headers?.host||event.headers?.Host,configured);
    const form=new URLSearchParams({grant_type:'authorization_code',client_id:key,redirect_uri:redirect,code});
    if(process.env.KAKAO_CLIENT_SECRET)form.set('client_secret',process.env.KAKAO_CLIENT_SECRET);
    const tokenRes=await fetch('https://kauth.kakao.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(10000)});
    if(!tokenRes.ok)throw Error('token-exchange-failed');
    const token=await tokenRes.json();
    const me=await fetch('https://kapi.kakao.com/v2/user/me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(10000)});
    if(!me.ok)throw Error('user-info-failed');
    const user=await me.json();
    if(!/^\d+$/.test(String(user.id||'')))throw Error('missing-user-id');
    const s=services();
    const uid='kakao:'+String(user.id);
    const nickname=String(user.kakao_account?.profile?.nickname||'돌봄지음 회원').slice(0,70);
    try{await s.auth.getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;try{await s.auth.createUser({uid,displayName:nickname});}catch(c){if(c.code!=='auth/uid-already-exists')throw c;}}
    await s.db.collection('ci_users').doc(uid).set({provider:'kakao',nickname,lastLoginAt:s.FieldValue.serverTimestamp()},{merge:true});
    const firebaseToken=await s.auth.createCustomToken(uid);
    const origin=new URL(redirect).origin;
    return {statusCode:200,headers,body:popupHTML(firebaseToken,mode==='redirect',origin)};
  }catch(e){console.error('kakao callback error',e.message);return fail('카카오 또는 서버 인증을 완료하지 못했습니다. 카카오 앱·키·서버 환경설정을 확인하세요.');}
}
