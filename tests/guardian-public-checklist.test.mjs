import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ASSESSMENT_DOMAINS,PUBLIC_CHECKLIST,GUARDIAN_REFLECTION} from '../site/assessment-standards.js';
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
test('기관점검 8영역 29개와 보호자 심리 3개를 구분한다',()=>{
  assert.equal(ASSESSMENT_DOMAINS.length,8);
  assert.deepEqual(ASSESSMENT_DOMAINS.map(x=>PUBLIC_CHECKLIST[x[0]].length),[4,4,4,4,4,3,3,3]);
  assert.equal(Object.values(PUBLIC_CHECKLIST).reduce((n,a)=>n+a.length,0),29);
  assert.equal(GUARDIAN_REFLECTION.length,3);
  assert.match(html,/9개 영역/);assert.match(html,/32개 질문/);
});
test('보호자 방문 전 화면은 근거 안내이며 직접 기관 평가를 요구하지 않음',()=>{
  assert.doesNotMatch(html,/id="guardian-check-count"/);
  assert.doesNotMatch(app,/class="guardian-choice"/);
  assert.match(html,/판단을 요구하는 설문이 아니라/);
  assert.match(app,/renderFieldPublicInspection/);
  assert.match(app,/public_field_inspection/);
  assert.match(app,/esc\(row.summary\)/);
});
