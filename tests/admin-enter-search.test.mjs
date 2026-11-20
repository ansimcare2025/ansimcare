import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
test('관리자 기관명 Enter는 전체 지역을 검색',()=>{
 assert.match(html,/기관명 입력 후 Enter → 전체 지역 검색/);
 assert.match(js,/runAdminSearch\(\{allRegions:!!formValue\('a-filter'\)\}\)/);
 assert.match(api,/preferExactName/);
});
test('전체 집계 실패는 관리자 목록 검색 오류와 독립',()=>{
 assert.match(js,/a-overview-notice/);
 assert.match(api,/Promise\.allSettled/);
 assert.match(html,/id="a-overview-notice"/);
});
