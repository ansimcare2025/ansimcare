import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PROFILE_FIELDS,proposeProfileChanges,reviewProfileChanges} from '../netlify/functions/_shared/profile-policy.mjs';
const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const current={name:'나주고운정요양원',region:'전남',district:'나주시',type:'요양원',phone:'061-123-4567',address:'나주시 원래 주소',description:'기존 소개',homepage:'',officialId:'OFFICIAL-123',source:'공단 자료',publicationStatus:'approved',managerUids:['u1']};
test('기관은 변경된 공개 필드만 제안하고 공식 식별번호·게시상태는 제안하지 못한다',()=>{
 const submitted={...current,phone:'061-333-4444',description:'변경 소개',officialId:'FAKE',managerUids:['evil'],publicationStatus:'approved'};
 const proposed=proposeProfileChanges(current,submitted);
 assert.deepEqual(proposed.changedFields,['phone','description']);
 assert.deepEqual(proposed.baseValues,{phone:'061-123-4567',description:'기존 소개'});
 assert.deepEqual(Object.keys(proposed.changes),['phone','description']);
 for(const blocked of ['officialId','source','publicationStatus','advertisingStatus','managerUids'])assert(!PROFILE_FIELDS.includes(blocked));
});
test('기관 제출값은 필드별 스냅샷 검증 후 승인하고 기존 데이터가 바뀌면 409',()=>{
 const r=proposeProfileChanges(current,{...current,description:'기관 수정'});
 const row={schemaVersion:'2.9.3',payload:r.changes,baseValues:r.baseValues};
 assert.deepEqual(reviewProfileChanges(current,row),{description:'기관 수정'});
 assert.throws(()=>reviewProfileChanges({...current,description:'다른 관리자 수정'},row),e=>e.statusCode===409);
});
test('자료 전달은 정보 변경과 별도이고 공개 게시 기능을 부르지 않는다',()=>{
 const start=api.indexOf('async function submitMaterial');
 const end=api.indexOf('async function reviewMaterial',start);
 const fn=api.slice(start,end);
 assert.match(fn,/await getMy\(s,u\)/);
 assert.match(fn,/kind:'material'/);
 assert.doesNotMatch(fn,/publish\(/);
 assert.match(api,/async function reviewMaterial\(s,u,b\)\{requireAdmin\(u\)/);
 assert.match(api,/case 'submit_material'/);
 assert.match(api,/case 'review_material'/);
});
test('정보 공개 승인에는 독립 확인근거 10자 이상과 관리자 권한이 필수',()=>{
 assert.match(api,/async function reviewProfile\(s,u,b\)\{requireAdmin\(u\)/);
 assert.match(api,/b\.verified!==true\|\|verificationNote\.length<10/);
 assert.match(api,/reviewProfileChanges\(prior,request\)/);
 assert.match(api,/changedFields,baseValues,referenceNote/);
 assert.match(html,/id="f-current-summary"/);
 assert.match(html,/id="f-change-preview"/);
 assert.match(html,/id="f-material-title"/);
 assert.match(js,/function facilityForm\(prefix\)/);
 assert.match(js,/data-review/);
});
