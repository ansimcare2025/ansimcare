// Only a configured HTTPS callback for THIS isolated test site is allowed.
// Register the exact callback URL in Kakao Developers before enabling login.
export function resolveKakaoRedirect(host,configured){
  const root=new URL(configured);
  if(root.protocol!=='https:'||root.pathname!=='/.netlify/functions/kakao-callback' ||root.search||root.hash)
    throw Error('잘못된 시험용 카카오 복귀 주소');
  const given=String(host||'').toLowerCase();
  if(!given || given!==root.host.toLowerCase())throw Error('시험 사이트와 카카오 복귀 주소가 다릅니다.');
  return root.toString();
}
