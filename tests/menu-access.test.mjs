import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../site/ui-fixes.css',import.meta.url),'utf8');
test('관리자 기관용 화면은 별도 읽기 전용이고 관리자 화면으로 강제전환하지 않음',()=>{
 assert.match(app,/if\(page==='facility'\)return \['facility','admin'\]\.includes/);
 assert.doesNotMatch(app,/if\(page==='facility'&&session\.role==='admin'\)page='admin'/);
 assert.match(html,/id="admin-facility-preview"/);assert.match(app,/renderAdminFacilityPreview/);
});
test('서비스 소개 기관 진입과 관리자 진입은 분리',()=>{
 assert.match(html,/id="institution-entry" data-go="facility"/);assert.match(html,/data-go="admin">관리자 화면/);
});
test('휴대폰 다섯 메뉴 균등 배치, 점검기준 강조',()=>{
 const bar=html.match(/<div class="mobile-nav"[^>]*>(.*?)<\/div>/s)?.[1];
 assert(bar);const pages=[...bar.matchAll(/data-page="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(pages,['home','match','standards','facility','admin']);
 assert.match(css,/repeat\(5,minmax\(0,1fr\)\)/);assert.match(html,/class="facility-shortcut"/);assert.match(html,/guardian-standards-cta/);
});
