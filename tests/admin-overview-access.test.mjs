import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
test('관리자 전체조회 및 개별상세 API는 role=admin 권한 필수',()=>{
 assert(api.includes('async function adminOverview(s,u){requireAdmin(u)'));
 assert(api.includes('async function adminFacilityDetail(s,u,b){requireAdmin(u)'));
 assert.match(api,/case 'admin_list':requireAdmin\(u\)/);
 assert.match(api,/case 'admin_overview':result=await adminOverview\(s,u\)/);
 assert.match(api,/case 'admin_facility_detail':result=await adminFacilityDetail\(s,u,body\)/);
});
test('관리자 전용 기관검색/상세, 기관 전용 성과 화면 구분',()=>{
 assert.match(html,/id="a-search"/);
 assert.match(html,/id="a-full-detail"/);
 assert.match(html,/id="f-analytics-summary"/);
 assert.match(app,/facility_my_analytics/);
});
