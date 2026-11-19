import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {riskReleaseAllowed} from '../netlify/functions/_shared/assessment-policy.mjs';
const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
test('기관의 안전·인권 우려를 미확인/기관보고만으로 해제하지 않음',()=>{
  const report={neglect:'우려',dignity:'양호'};
  assert.equal(riskReleaseAllowed(report,{neglect:{source:'기관보고',finding:'확인',note:'자체 보고'}}),false);
  assert.equal(riskReleaseAllowed(report,{neglect:{source:'미확인',finding:'미확인',note:''}}),false);
  assert.equal(riskReleaseAllowed(report,{neglect:{source:'서류',finding:'확인',note:'증빙자료 검토'}}),true);
  assert.equal(riskReleaseAllowed(report,{neglect:{source:'현장',finding:'확인',note:'현장 실사'}}),true);
  assert.equal(riskReleaseAllowed({neglect:'양호'},{}),true);
  assert.equal(riskReleaseAllowed({neglect:'양호'},{},['dignity']),false);
  assert.equal(riskReleaseAllowed({neglect:'양호'},{dignity:{source:'현장',finding:'확인',note:'재점검 확인'}},['dignity']),true);
});
test('소개 변경 승인 시 기존 게시상태를 보존하고 게시 경로에서 위험 상태를 재확인',()=>{
  assert.match(api,/publicationStatus:prior\.publicationStatus\|\|'pending'/);
  assert.match(api,/const riskHold=state\.data\(\)\?\.riskHold===true/);
  assert.match(api,/if\(visible\(f\)&&!riskHold\)/);
  assert.match(api,/if\(command==='activate'&&safetySnap\.data\(\)\?\.riskHold===true\)/);
  assert.match(api,/riskReleaseAllowed\(record\.answers,rows\)/);
});
