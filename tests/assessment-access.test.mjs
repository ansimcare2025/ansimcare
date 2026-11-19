import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firebase/CI_RULES_MERGE_ONLY.txt',import.meta.url),'utf8');
test('기관의 자기점검은 담당자 계정으로만 제출',()=>{
  assert.match(api,/async function submitSelfAssessment\(s,u,b\)\{\s*const f=await getMy\(s,u\)/);
  assert.match(api,/if\(!\(f.managerUids\|\|\[\]\).includes\(u.uid\)\)/);
});
test('검토 승인·우려 게시 보류는 관리자 전용',()=>{
 assert.match(api,/async function adminReviewAssessment\(s,u,b\)\{requireAdmin\(u\)/);
 assert.match(api,/riskHold/);
 assert.match(api,/tx.delete\(s.db.collection\('ci_public'\).doc\(f.id\)\)/);
});
test('공개 심사자료는 유효기간 내 광고 참여기관에만 제공',()=>{
 assert.match(api,/async function publicAssessment\(s,b\)/);
 assert.match(api,/p.advertisement!==true/);
 assert.match(api,/p.contractEnd<today/);
 assert.match(api,/ci_public_assessments/);
});
test('비공개 점검 데이터는 Firestore 직접 접근 차단 목록에 포함',()=>{
 for(const name of ['ci_assessment_reports','ci_assessment_states','ci_public_assessments'])assert.match(rules,new RegExp(`match /${name}\\/\\{doc\\} \\{ allow read, write: if false; \\}`));
});
test('보호자 표준 안내 공개, 기관 제출 및 관리자 검토 UI는 권한별 별도 화면',()=>{
 assert.match(html,/id="page-standards"/);
 assert.match(html,/id="self-check-fields"/);
 assert.match(html,/id="a-assessments"/);
 assert.match(app,/loadPublicAssessment/);
});
