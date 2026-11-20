import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../site/app.js', import.meta.url),'utf8');
const html=readFileSync(new URL('../site/index.html', import.meta.url),'utf8');

test('보호자 지역 및 기관유형 변경시 자동 검색',()=>{
  for(const id of ['match-region','match-district','match-type'])assert.match(js,new RegExp(`'${id}'`));
  assert.match(js,/\$\(id\)\.addEventListener\('change',loadPublic\)/);
  assert.match(html,/지역·시군구·기관 유형을 바꾸면 결과가 자동으로 갱신됩니다/);
});
test('관리자 지역 및 기관유형 변경시 전체 검색',()=>{
  for(const id of ['a-filter-region','a-filter-district','a-filter-type'])assert.match(js,new RegExp(`'${id}'`));
  assert.match(js,/\$\(id\)\.addEventListener\('change',runAdminSearch\)/);
  assert.match(js,/변경된 지역·기관 유형으로 전체 등록기관을 조회하고 있습니다/);
});
test('늦게 도착한 이전 검색 응답으로 새 화면을 덮지 않음',()=>{
  assert.match(js,/const requestId=\+\+publicSearchRequestId/);
  assert.match(js,/if\(requestId!==publicSearchRequestId\)return/);
  assert.match(js,/const requestId=\+\+adminSearchRequestId/);
  assert.match(js,/if\(requestId!==adminSearchRequestId\)return/);
});
test('비공개 후보의 유료 홍보 검색 노출 제한 유지',()=>{
  const api=readFileSync(new URL('../netlify/functions/api.mjs', import.meta.url),'utf8');
  assert.match(api,/collection\('ci_public'\)/);
  assert.match(api,/f\.advertisement&&f\.contractStart<=todayKST\(\)&&f\.contractEnd>=todayKST\(\)/);
});
