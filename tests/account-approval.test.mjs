import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminUidAllowed,belongsToFacility,cleanAccessApplication} from '../netlify/functions/_shared/access-policy.mjs';
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
const core=readFileSync(new URL('../netlify/functions/_shared/core.mjs',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firebase/CI_RULES_MERGE_ONLY.txt',import.meta.url),'utf8');
test('Admin rights require both signed role claim and server allowlisted UID',()=>{
 assert(adminUidAllowed('admin-one','admin-one,admin-two'));
 assert(!adminUidAllowed('attacker','admin-one,admin-two'));
 assert(!adminUidAllowed('admin-one',''));
 assert.match(core,/CI_ADMIN_UIDS/);assert.match(core,/u.role!=='admin'/);
});
test('Only explicitly linked institution UID can access own institution',()=>{
 const f={id:'CI-1',managerUids:['user-1'],accessSuspended:false};
 assert(belongsToFacility({role:'facility',uid:'user-1',facilityId:'CI-1'},f));
 assert(!belongsToFacility({role:'facility',uid:'user-2',facilityId:'CI-1'},f));
 assert(!belongsToFacility({role:'facility',uid:'user-1',facilityId:'CI-2'},f));
 assert(!belongsToFacility({role:'admin',uid:'user-1',facilityId:'CI-1'},f));
 assert(!belongsToFacility({role:'facility',uid:'user-1',facilityId:'CI-1'},{...f,accessSuspended:true}));
});
test('Institution application rejects invalid location, phone and missing consent',()=>{
 const regions={전남:['나주시']},types=['요양원'];
 const good={facilityName:'나주고운정요양원',applicantName:'홍길동',region:'전남',district:'나주시',type:'요양원',contactPhone:'061-123-4567',consent:true};
 assert.equal(cleanAccessApplication(good,{regions,types}).facilityName,'나주고운정요양원');
 assert.throws(()=>cleanAccessApplication({...good,district:'서울'}, {regions,types}));
 assert.throws(()=>cleanAccessApplication({...good,contactPhone:'??'}, {regions,types}));
 assert.throws(()=>cleanAccessApplication({...good,consent:false},{regions,types}));
});
test('Server enforces role on every private action and login cannot self-approve',()=>{
 assert.match(api,/if\(u.role==='admin'\)requireAdmin\(u\);/);
 assert.match(api,/if\(u.role==='facility'\)await getMy\(s,u\);/);
 assert.match(api,/case 'facility_apply'/);assert.match(api,/case 'admin_review_access_application'/);
 assert.match(api,/setCustomUserClaims\(applicantUid/);
 assert.match(api,/verificationNote/);
 assert.match(rules,/ci_access_applications/);
 assert.match(html,/id="facility-application-panel"/);
 assert.match(html,/id="a-access-applications"/);
});
