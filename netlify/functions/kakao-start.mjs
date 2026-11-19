import { randomBytes } from 'node:crypto';
import { response } from './_shared/core.mjs';
import {resolveKakaoRedirect} from './_shared/kakao-origin.mjs';
export async function handler(event){
  if(event.httpMethod!=='GET')return response(405,{ok:false,error:'GET only'});
  const key=process.env.KAKAO_REST_API_KEY,redirect=process.env.KAKAO_REDIRECT_URI;
  if(!key||!redirect)return response(503,{ok:false,error:'카카오 로그인 키/리다이렉트 설정이 아직 완료되지 않았습니다.'});
  try{
    const siteRedirect=resolveKakaoRedirect(event.headers?.host||event.headers?.Host,redirect);
    const state=randomBytes(32).toString('hex');
    const mode=event.queryStringParameters?.mode==='redirect'?'redirect':'popup';
    const url=new URL('https://kauth.kakao.com/oauth/authorize');
    url.searchParams.set('response_type','code');url.searchParams.set('client_id',key);url.searchParams.set('redirect_uri',siteRedirect);url.searchParams.set('state',state);
    return {statusCode:302,headers:{Location:url.toString(),'Set-Cookie':`__Host-ci-oauth=${state}.${mode}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,'Cache-Control':'no-store'}};
  }catch(e){return response(503,{ok:false,error:'카카오 환경설정의 HTTPS 리다이렉트 URI를 확인하세요.'});}
}
