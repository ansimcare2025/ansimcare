// 운영·고정 시험 도메인만 허용합니다. 요청의 Host를 임의의 카카오 복귀 주소로 믿지 않습니다.
const TEST_HOST='dolbom-v25-test--careindex-honam.netlify.app';
export function resolveKakaoRedirect(host,configured){
  const root=new URL(configured);
  if(root.protocol!=='https:'||root.pathname!=='/.netlify/functions/kakao-callback')throw Error('잘못된 카카오 운영 복귀 주소');
  const given=String(host||'').toLowerCase();
  if(given===root.host.toLowerCase())return root.toString();
  if(given===TEST_HOST)return `https://${TEST_HOST}/.netlify/functions/kakao-callback`;
  throw Error('허용되지 않은 로그인 접속 주소');
}
