import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {cleanTrackingRequest,trackingKeys,lastDays,aggregateReport} from './_shared/analytics-policy.mjs';
import {adminSearchParams,adminMatchesFacility,adminPageResult} from './_shared/admin-search.mjs';
import {getStorage} from 'firebase-admin/storage';
import {validateFieldDraft,publicFieldRows,FIELD_IDS} from './_shared/field-policy.mjs';
import {invoiceAmount,normalizeOrderMonths,providerOrderView,ORDER_PENDING,ORDER_PAID,ORDER_CANCELED} from './_shared/payment-policy.mjs';
import {DOMAINS, SUPPORTED_TYPES, addMonths, checkSelf, checkReview, publicReview, riskReleaseAllowed} from './_shared/assessment-policy.mjs';
import { services, authUser, requireAdmin, response, wrapError, fail, txt, regions, types, getPrivatePrices, key, defaultCap, dateOK, todayKST, visible, publicFields, normalizedFacility, facilityId, audit, emailOK, ensureLocation, ensureType } from './_shared/core.mjs';
import {belongsToFacility,cleanAccessApplication} from './_shared/access-policy.mjs';
import {PROFILE_FIELDS, proposeProfileChanges, reviewProfileChanges} from './_shared/profile-policy.mjs';
const sRef=(s,id)=>s.db.collection('ci_facilities').doc(id);
const empty={publicationStatus:'pending',advertisingStatus:'pending',paymentStatus:'unconfirmed',contractStart:'',contractEnd:'',managerUids:[],lastConfirmedAt:'',createdAt:null};
const sortTime=(f)=>f.createdAt?.toMillis?.()||0;
const calendarDate=(x)=>dateOK(x)?x:'';
const getBody=(event)=>{
  if((event.body||'').length>3100000)fail(413,'한 번에 전송할 수 있는 데이터 크기를 초과했습니다. 사진은 1.8MB 이내로 선택하세요.');
  try{return JSON.parse(event.body||'{}')}catch{fail(400,'JSON 형식이 유효하지 않습니다.');}
};
async function readFacility(s,id){const snap=await sRef(s,id).get();if(!snap.exists)fail(404,'등록된 기관을 찾을 수 없습니다.');return {id:snap.id,...snap.data()};}
function safeFacility(f){const {id,name,type,region,district,address,phone,description,homepage,imageUrl,officialId,source,sourceDate,lastConfirmedAt,publicationStatus,advertisingStatus,paymentStatus,contractStart,contractEnd,managerUids,paymentReference,paidConfirmedBy,paidConfirmedAt,createdAt,updatedAt}=f;return {id,name,type,region,district,address,phone,description,homepage,imageUrl,officialId,source,sourceDate,lastConfirmedAt,publicationStatus,advertisingStatus,paymentStatus,contractStart,contractEnd,managerUids:managerUids||[],paymentReference:paymentReference||'',paidConfirmedBy:paidConfirmedBy||'',paidConfirmedAt:paidConfirmedAt?.toDate?.()?.toISOString?.()||'',createdAt:createdAt?.toDate?.()?.toISOString?.()||'',updatedAt:updatedAt?.toDate?.()?.toISOString?.()||''};}
function quotaDoc(s,f){return s.db.collection('ci_quotas').doc(key(f.region,f.district,f.type));}
function activeSlots(v,today=todayKST()){const entries=v?.slots||{};return Object.fromEntries(Object.entries(entries).filter(([,end])=>typeof end==='string'&&end>=today));}
async function publish(s,f){
  const ref=s.db.collection('ci_public').doc(f.id);
  // 기관 소개 수정/계약 재활성화 중에도 안전·인권 게시보류를 무시할 수 없습니다.
  const state=await s.db.collection('ci_assessment_states').doc(f.id).get();
  const riskHold=state.data()?.riskHold===true;
  if(visible(f)&&!riskHold)await ref.set(publicFields(f,f.id));
  else await ref.delete();
}
async function listPublic(s,q){
  // The server, not the browser, enforces paid-only and date validation.
  const region=txt(q.region,15),district=txt(q.district,35),type=txt(q.type,25),word=txt(q.keyword,100).toLocaleLowerCase();
  if(region&&region!=='전체'&&!regions[region])fail(400,'시도를 확인하세요.');
  if(type&&type!=='전체'&&!types.includes(type))fail(400,'기관 유형을 확인하세요.');
  const snap=await s.db.collection('ci_public').limit(2501).get();
  if(snap.size>2500)fail(503,'조회량이 증가했습니다. 관리자에게 지역별 색인 설정을 요청해 주세요.');
  const data=snap.docs.map(d=>({id:d.id,...d.data()})).filter(f=>f.advertisement&&f.contractStart<=todayKST()&&f.contractEnd>=todayKST() && (!region||region==='전체'||f.region===region)&&(!district||district==='전체'||f.district===district)&&(!type||type==='전체'||f.type===type)&&(!word||[f.name,f.district,f.address,f.description].join(' ').toLocaleLowerCase().includes(word)));
  return data.sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko')).map(f=>{const {contractStart,contractEnd,...p}=f;return p;});
}
async function privateQuota(s,u,q){
  if(!['facility','admin'].includes(u.role))fail(403,'승인된 기관·관리자 계정만 이용할 수 있습니다.');
  let region=txt(q.region,15),district=txt(q.district,35),type=txt(q.type,25);
  if(u.role==='facility'){
    const f=await getMy(s,u);region=f.region;district=f.district;type=f.type;
  }
  if(!regions[region]?.includes(district)||!types.includes(type))fail(400,'지역과 기관 유형을 선택하세요.');
  const snap=await s.db.collection('ci_quotas').doc(key(region,district,type)).get();
  const raw=snap.data()||{};const capacity=Number.isInteger(raw.capacity)?raw.capacity:defaultCap(region,district,type);
  const active=Object.keys(activeSlots(raw)).length;
  return {region,district,type,capacity,active,remaining:Math.max(0,capacity-active),price:getPrivatePrices()[type],note:'홍보 정원은 시범 운영 정책이며 지역 전체 기관 수를 뜻하지 않습니다.'};
}
async function listAdmin(s,p){
  let filter;try{filter=adminSearchParams(p);}catch(e){fail(400,e.message);}
  if(filter.region&&!regions[filter.region])fail(400,'검색할 시·도를 확인하세요.');
  if(filter.district&&(!filter.region||!regions[filter.region].includes(filter.district)))fail(400,'검색할 시·군·구를 확인하세요.');
  if(filter.type&&!types.includes(filter.type))fail(400,'검색할 기관 유형을 확인하세요.');
  const col=s.db.collection('ci_facilities');
  // 전체 기관명 Enter 검색은 우선 단일 필드 색인을 이용해 정확한 이름부터 찾습니다.
  // 부분 이름은 아래의 전체검색으로 자동 대체합니다.
  if(p.preferExactName && filter.query && !filter.after && !filter.region && !filter.district && !filter.type){
    const exactName=txt(p.keyword,100);
    try{
      const exact=await col.where('name','==',exactName).limit(filter.pageSize).get();
      if(!exact.empty)return {items:exact.docs.map(d=>safeFacility({id:d.id,...d.data()})),next:'',scanned:exact.size,partial:false,exact:true};
    }catch(e){console.warn('Admin name index lookup fallback',e.code||e.message);}
  }
  // 필터 없이 불러올 때는 가볍게 1페이지만 조회합니다.
  if(!filter.query&&!filter.region&&!filter.district&&!filter.type){
    let q=col.orderBy('__name__').limit(filter.pageSize);
    if(filter.after)q=q.startAfter(filter.after);
    const snap=await q.get();
    return {items:snap.docs.map(d=>safeFacility({id:d.id,...d.data()})),next:snap.size===filter.pageSize?(snap.docs.at(-1)?.id||''):'',scanned:snap.size,partial:false};
  }
  // 예전에 등록된 약 3,800개 기관에는 검색 색인이 없으므로, 관리자만 전체 문서를 스캔해 검색합니다.
  // 최대 6,000개 문서씩 검사하고 다음 커서를 제공하여 향후 기관 수 증가에도 검색이 가능합니다.
  const found=[];let last=filter.after,scanned=0,exhausted=false;
  // 단일 필드 색인으로 먼저 지역을 줄입니다. 기존 기관코드/명칭 부분 검색도 유지합니다.
  // 복합 색인 생성을 요구하지 않도록 시·군·구가 지정되면 district 하나만 선필터합니다.
  let narrowed=col;
  if(filter.district)narrowed=col.where('district','==',filter.district);
  else if(filter.region)narrowed=col.where('region','==',filter.region);
  while(found.length<filter.pageSize&&scanned<6000){
    let q=narrowed.orderBy('__name__').limit(400);
    if(last)q=q.startAfter(last);
    const snap=await q.get();
    if(snap.empty){exhausted=true;break;}
    for(const doc of snap.docs){
      last=doc.id;scanned++;
      const item={id:doc.id,...doc.data()};
      if(adminMatchesFacility(item,filter))found.push(safeFacility(item));
      if(found.length>=filter.pageSize||scanned>=6000)break;
    }
    if(snap.size<400&&found.length<filter.pageSize){exhausted=true;break;}
  }
  return adminPageResult({items:found,after:last,scanned,limitReached:scanned>=6000,exhausted});
}
async function adminOverview(s,u){requireAdmin(u);
  const col=s.db.collection('ci_facilities');
  // 별도 집계 중 한 항목이 실패해도 관리자 전체검색은 계속 이용할 수 있어야 합니다.
  const results=await Promise.allSettled([
    col.count().get(),col.where('advertisingStatus','==','active').count().get(),col.where('publicationStatus','==','pending').count().get()
  ]);
  const values=results.map(x=>x.status==='fulfilled'?x.value.data().count:null);
  const partial=results.some(x=>x.status!=='fulfilled');
  if(partial)console.warn('Admin overview partial count failure',results.map((x,i)=>x.status==='rejected'?`${i}:${x.reason?.code||x.reason?.message}`:'ok').join(','));
  return {total:values[0],active:values[1],pending:values[2],partial,notice:'관리자 전용 전체 기관 집계. 비공개 후보 포함.'};
}
async function adminFacilityDetail(s,u,b){requireAdmin(u);
  const id=txt(b.facilityId,90);if(!id)fail(400,'기관 ID가 필요합니다.');
  return {facility:safeFacility(await readFacility(s,id))};
}
async function createOrEdit(s,u,b){requireAdmin(u);
  const requestedId=txt(b.facilityId,90);
  const patch=normalizedFacility(b.facility||{});
  let id=requestedId||facilityId();
  const ref=sRef(s,id);
  await s.db.runTransaction(async tx=>{
    const old=await tx.get(ref);
    if(requestedId&&!old.exists)fail(404,'수정할 기관이 없습니다.');
    if(!requestedId&&old.exists)fail(409,'중복 기관 ID입니다.');
    const prior=old.exists?old.data():empty;
    if(prior.advertisingStatus==='active'&&[prior.region,prior.district,prior.type].join('|')!==[patch.region,patch.district,patch.type].join('|'))fail(409,'활성 계약 기관의 지역/유형을 수정하려면 계약을 먼저 중지하세요.');
    tx.set(ref,{...prior,...patch,createdAt:prior.createdAt||s.FieldValue.serverTimestamp(),updatedAt:s.FieldValue.serverTimestamp(),publicationStatus:prior.publicationStatus||'pending',advertisingStatus:prior.advertisingStatus||'pending',paymentStatus:prior.paymentStatus||'unconfirmed',managerUids:prior.managerUids||[]});
  });
  const f=await readFacility(s,id);await publish(s,f);await audit(s,u.uid,requestedId?'admin_edit':'admin_create',id);
  return {facility:safeFacility(f)};
}
async function importPrivate(s,u,b){requireAdmin(u);
  const rows=b.rows;if(!Array.isArray(rows)||rows.length<1||rows.length>40)fail(400,'한 번에 1~40개 기관을 가져올 수 있습니다.');
  let created=0,updated=0,errors=[];
  for(const row of rows){
    try{
      const v=normalizedFacility(row);
      const src=txt(row.source,60)||'CSV',officialId=txt(row.officialId,80);
      const stable=officialId||[v.name,v.type,v.region,v.district,v.address].join('|');
      const id='IMP-'+createHash('sha256').update(src+'|'+stable).digest('hex').slice(0,20).toUpperCase();
      const ref=sRef(s,id);
      const old=await ref.get();
      if(old.exists){
        const f=old.data();
        if(f.advertisingStatus==='active'||f.publicationStatus==='approved') {errors.push(`${v.name}: 계약·승인기관은 자동 덮어쓰지 않음`);continue;}
        // Preserve staff edits; import only provenance and missing fields.
        await ref.set({source:src,sourceDate:txt(row.sourceDate,20),officialId:v.officialId||f.officialId,updatedAt:s.FieldValue.serverTimestamp()},{merge:true});updated++;
      }else{
        await ref.create({...empty,...v,source:src,createdAt:s.FieldValue.serverTimestamp(),updatedAt:s.FieldValue.serverTimestamp()});created++;
      }
    }catch(e){errors.push(`${txt(row?.name,45)||'미상'}: ${e.statusCode?e.message:'형식 확인 필요'}`);}
  }
  await audit(s,u.uid,'import_private',null,{created,updated,rejected:errors.length});
  return {created,updated,errors:errors.slice(0,25)};
}
async function linkUser(s,u,b){requireAdmin(u);
  if(b.verified!==true||txt(b.verificationNote,250).length<8)fail(400,'담당자 소속 및 위임 권한을 별도로 확인한 근거가 필요합니다.');
  const id=txt(b.facilityId,90),uid=txt(b.uid,140);
  if(!id||!uid)fail(400,'기관 ID와 연결할 Firebase 사용자 UID가 필요합니다.');
  const f=await readFacility(s,id);
  let person;try{person=await s.auth.getUser(uid);}catch{fail(404,'먼저 카카오로 로그인하거나 생성된 이메일 계정의 UID를 입력하세요.');}
  const oldClaims=person.customClaims||{};
  if(oldClaims.role==='admin')fail(403,'관리자 계정은 기관 담당자로 겸직 연결할 수 없습니다.');
  if(oldClaims.role==='facility'&&oldClaims.facilityId&&oldClaims.facilityId!==id)fail(409,'이미 다른 기관에 연결된 계정입니다.');
  await s.auth.setCustomUserClaims(uid,{...oldClaims,role:'facility',facilityId:id});
  await sRef(s,id).update({managerUids:s.FieldValue.arrayUnion(uid),updatedAt:s.FieldValue.serverTimestamp()});
  await audit(s,u.uid,'link_manager',id,{uid,verificationMethod:txt(b.verificationNote,250)});return {facilityId:id,uid};
}
async function issueEmail(s,u,b){requireAdmin(u);
  if(b.verified!==true||txt(b.verificationNote,250).length<8)fail(400,'담당자 소속 및 위임 권한을 별도로 확인한 근거가 필요합니다.');
  const id=txt(b.facilityId,90),email=txt(b.email,250).toLowerCase();
  if(!emailOK(email))fail(400,'올바른 담당자 이메일이 필요합니다.');
  const f=await readFacility(s,id);
  const password=randomBytes(21).toString('base64url')+'aA1!';
  let user;
  try{user=await s.auth.createUser({email,password,displayName:f.name,disabled:false});
    await s.auth.setCustomUserClaims(user.uid,{role:'facility',facilityId:id});
    await sRef(s,id).update({managerUids:s.FieldValue.arrayUnion(user.uid),updatedAt:s.FieldValue.serverTimestamp()});
    await audit(s,u.uid,'issue_email_account',id,{uid:user.uid,verificationMethod:txt(b.verificationNote,250)});
    return {uid:user.uid,email,temporaryPassword:password,notice:'한 번만 표시되는 임시 비밀번호입니다. 안전하게 전달해 주세요.'};
  }catch(e){if(user)await s.auth.deleteUser(user.uid).catch(()=>{});if(e.code==='auth/email-already-exists')fail(409,'이메일 계정이 이미 존재합니다. 카카오 UID 연결 또는 기존 계정 연결을 이용하세요.');throw e;}
}
// 기관 계정 등록과 광고/게시 승인은 별개입니다. 가입 신청 자체에는 관리자 권한을 부여하지 않습니다.
const accessCollection=s=>s.db.collection('ci_access_applications');
const accessView=(id,v)=>({uid:id,status:v.status||'pending',facilityName:v.facilityName||'',
  applicantName:v.applicantName||'',region:v.region||'',district:v.district||'',type:v.type||'',
  contactPhone:v.contactPhone||'',approvedFacilityId:v.approvedFacilityId||'',
  submittedAt:v.submittedAt?.toDate?.()?.toISOString?.()||'',
  reviewedAt:v.reviewedAt?.toDate?.()?.toISOString?.()||'',reason:v.reason||''});
async function myAccessApplication(s,u){
  const row=await accessCollection(s).doc(u.uid).get();
  return {application:row.exists?accessView(u.uid,row.data()):null};
}
async function applyForFacilityAccess(s,u,b){
  if(u.role==='admin'||u.role==='facility')fail(403,'기존 관리자·기관 담당자는 신규 기관 권한 신청을 할 수 없습니다.');
  let clean;
  try{clean=cleanAccessApplication(b,{regions,types});}catch(e){fail(400,e.message);}
  const ref=accessCollection(s).doc(u.uid);
  await s.db.runTransaction(async tx=>{
    const old=await tx.get(ref);
    if(old.exists&&['pending','approved'].includes(old.get('status')))fail(409,'이미 접수되었거나 승인된 신청이 있습니다.');
    tx.set(ref,{...clean,status:'pending',applicantUid:u.uid,provider:u.firebase?.sign_in_provider||'firebase',
      submittedAt:s.FieldValue.serverTimestamp(),reviewedAt:null,approvedFacilityId:'',reason:''});
  });
  await audit(s,u.uid,'facility_access_requested',null,{region:clean.region,district:clean.district,type:clean.type});
  return {status:'pending',notice:'기관 담당자 접수 완료. 관리자 확인 전에는 기관 화면에 접근할 수 없습니다.'};
}
async function listAccessApplications(s,u){
  requireAdmin(u);
  const snap=await accessCollection(s).where('status','==','pending').limit(100).get();
  return {items:snap.docs.map(d=>accessView(d.id,d.data())).sort((x,y)=>
    (x.status==='pending'?0:1)-(y.status==='pending'?0:1)||String(y.submittedAt).localeCompare(x.submittedAt))};
}
async function reviewAccessApplication(s,u,b){
  requireAdmin(u);
  const applicantUid=txt(b.applicantUid,140),decision=txt(b.decision,20),reason=txt(b.reason,300),id=txt(b.facilityId,90);
  if(!applicantUid||!['approved','rejected'].includes(decision))fail(400,'신청자와 처리결과를 확인하세요.');
  if(decision==='approved'&&(b.verified!==true||reason.length<8))fail(400,'기관 대표번호 등 독립 경로로 소속·권한을 확인한 후 확인방법과 근거를 입력하세요.');
  if(decision==='rejected'&&reason.length<4)fail(400,'반려 사유를 입력하세요.');
  const ref=accessCollection(s).doc(applicantUid);
  const initial=await ref.get();if(!initial.exists||initial.get('status')!=='pending')fail(409,'승인 대기 중인 신청이 아닙니다.');
  const app=initial.data();
  if(decision==='rejected'){
    await s.db.runTransaction(async tx=>{
      const cur=await tx.get(ref);if(!cur.exists||cur.get('status')!=='pending')fail(409,'이미 처리된 신청입니다.');
      tx.update(ref,{status:'rejected',reason,reviewedBy:u.uid,reviewedAt:s.FieldValue.serverTimestamp()});
    });
    await audit(s,u.uid,'facility_access_rejected',null,{applicantUid});return {status:'rejected'};
  }
  if(!id)fail(400,'승인할 실제 등록 기관을 선택하세요.');
  const f=await readFacility(s,id);
  if(f.region!==app.region||f.district!==app.district||f.type!==app.type)fail(409,'신청 지역·유형과 승인 기관이 다릅니다. 정확한 기관을 선택하세요.');
  if(applicantUid===u.uid)fail(403,'관리자 본인의 기관 권한 신청은 승인할 수 없습니다.');
  let person;try{person=await s.auth.getUser(applicantUid);}catch{fail(404,'신청자의 로그인 계정이 존재하지 않습니다.');}
  if(person.disabled)fail(403,'비활성화된 로그인 계정입니다.');
  const oldClaims=person.customClaims||{};
  if(oldClaims.role==='admin'||oldClaims.role==='facility'&&oldClaims.facilityId&&oldClaims.facilityId!==id)fail(409,'이미 다른 권한을 가진 계정입니다.');
  // Claim first, roster second: backend checks both claim and roster on every request.
  await s.auth.setCustomUserClaims(applicantUid,{...oldClaims,role:'facility',facilityId:id});
  try{
    await s.db.runTransaction(async tx=>{
      const [current,fac]=await Promise.all([tx.get(ref),tx.get(sRef(s,id))]);
      if(!current.exists||current.get('status')!=='pending'||!fac.exists)fail(409,'다른 관리자가 이미 처리한 신청입니다.');
      tx.update(sRef(s,id),{managerUids:s.FieldValue.arrayUnion(applicantUid),updatedAt:s.FieldValue.serverTimestamp()});
      tx.update(ref,{status:'approved',approvedFacilityId:id,reason,reviewedBy:u.uid,reviewedAt:s.FieldValue.serverTimestamp()});
    });
  }catch(e){await s.auth.setCustomUserClaims(applicantUid,oldClaims).catch(()=>{});throw e;}
  await audit(s,u.uid,'facility_access_approved',id,{applicantUid});
  return {status:'approved',facilityId:id,notice:'계정 접속만 승인했습니다. 기관정보 게시·계약은 별도로 승인해야 합니다.'};
}
async function revokeFacilityAccess(s,u,b){
  requireAdmin(u);
  const uid=txt(b.uid,140),id=txt(b.facilityId,90);if(!uid||!id)fail(400,'기관 ID와 담당자 UID가 필요합니다.');
  const f=await readFacility(s,id);
  if(!(f.managerUids||[]).includes(uid))fail(404,'이 기관에 연결된 담당자가 아닙니다.');
  const person=await s.auth.getUser(uid),claims=person.customClaims||{};
  if(claims.role==='admin'||(claims.facilityId&&claims.facilityId!==id))fail(403,'다른 역할·기관 계정을 이 화면에서 해제할 수 없습니다.');
  await sRef(s,id).update({managerUids:s.FieldValue.arrayRemove(uid),updatedAt:s.FieldValue.serverTimestamp()});
  const {role,facilityId,...rest}=claims;
  await s.auth.setCustomUserClaims(uid,rest);
  await s.auth.revokeRefreshTokens(uid);
  const appRef=accessCollection(s).doc(uid),app=await appRef.get();
  if(app.exists&&app.get('approvedFacilityId')===id)await appRef.update({status:'revoked',reason:'관리자 접속권한 해제',reviewedBy:u.uid,reviewedAt:s.FieldValue.serverTimestamp()});
  await audit(s,u.uid,'facility_access_revoked',id,{uid});return {revoked:true};
}
async function ensureRequestRoom(s,facilityId,kind){
  // 단일 기관이 미처리 요청을 무제한 저장하지 못하게 합니다 (단일 필드 색인만 사용).
  const snap=await s.db.collection('ci_requests').where('facilityId','==',facilityId).limit(300).get();
  const pending=snap.docs.filter(doc=>doc.get('status')==='pending'&&doc.get('kind')===kind).length;
  if(pending>=(kind==='material'?10:5))fail(429,'관리자 검토 대기 요청이 많습니다. 기존 요청이 처리된 뒤 제출하세요.');
}
async function submitProfile(s,u,b){
  const facility=await getMy(s,u);
  await ensureRequestRoom(s,facility.id,'profile');
  // 관리자 승인 전에는 기관 기본DB·보호자 공개DB를 수정하지 않습니다.
  const proposal=normalizedFacility({...facility,...(b.facility||{})});
  const {changes,baseValues,changedFields}=proposeProfileChanges(facility,proposal);
  const uploadedPath=txt(b.photoPath,300),referenceNote=txt(b.referenceNote,600);
  if(!changedFields.length&&!uploadedPath)fail(400,'수정할 항목이나 사진을 선택한 다음 요청하세요.');
  if(uploadedPath){
    if(!uploadedPath.startsWith(`ci_pending/${u.facilityId}/${u.uid}/`))fail(403,'자기 기관 사진만 신청할 수 있습니다.');
    const bucket=getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET||'ansimcare-9bae3.firebasestorage.app');
    const [exists]=await bucket.file(uploadedPath).exists();if(!exists)fail(404,'업로드한 사진이 없습니다.');
  }
  const ref=await s.db.collection('ci_requests').add({facilityId:u.facilityId,authorUid:u.uid,kind:'profile',
    schemaVersion:'2.9.3',payload:{...changes,photoPath:uploadedPath},changedFields,baseValues,referenceNote,
    status:'pending',createdAt:s.FieldValue.serverTimestamp()});
  await audit(s,u.uid,'submit_profile',u.facilityId,{requestId:ref.id,changedFields});
  return {requestId:ref.id,changedFields};
}
async function submitMaterial(s,u,b){
  const facility=await getMy(s,u);
  await ensureRequestRoom(s,facility.id,'material');
  const title=txt(b.title,90),description=txt(b.description,1200);
  if(title.length<3||description.length<10)fail(400,'자료 제목 3자 이상, 전달 내용 10자 이상 입력하세요.');
  const ref=await s.db.collection('ci_requests').add({facilityId:facility.id,authorUid:u.uid,kind:'material',
    payload:{title,description},status:'pending',createdAt:s.FieldValue.serverTimestamp()});
  await audit(s,u.uid,'submit_material',facility.id,{requestId:ref.id});
  return {requestId:ref.id};
}
async function reviewMaterial(s,u,b){requireAdmin(u);
  const id=txt(b.requestId,150),decision=txt(b.decision,25),reason=txt(b.reason,300);
  if(!['reviewed','rejected'].includes(decision))fail(400,'검토완료 또는 보완요청을 선택하세요.');
  if(reason.length<4)fail(400,'처리 메모를 4자 이상 입력하세요.');
  const ref=s.db.collection('ci_requests').doc(id);
  const outcome=await s.db.runTransaction(async tx=>{
    const row=await tx.get(ref);
    if(!row.exists||row.get('status')!=='pending'||row.get('kind')!=='material')fail(409,'미처리 자료 제출 건이 아닙니다.');
    tx.update(ref,{status:decision,reason,reviewedBy:u.uid,reviewedAt:s.FieldValue.serverTimestamp()});
    return {facilityId:row.get('facilityId')};
  });
  await audit(s,u.uid,'review_material',outcome.facilityId,{requestId:id,decision});
  return {requestId:id,status:decision,notice:'전달자료 처리 상태만 변경했습니다. 기관 공개정보는 변경되지 않았습니다.'};
}
async function listRequests(s,u){
  const col=s.db.collection('ci_requests');
  let query;
  if(u.role==='admin')query=col.orderBy('__name__').limit(200);
  else if(u.role==='facility')query=col.where('facilityId','==',u.facilityId).limit(100);
  else fail(403,'기관 또는 관리자 로그인이 필요합니다.');
  const snap=await query.get();return snap.docs.map(d=>({id:d.id,...d.data(),createdAt:d.data().createdAt?.toDate?.()?.toISOString()||''})).sort((a,b)=>String(b.createdAt).localeCompare(a.createdAt));
}
async function uploadPhoto(s,u,b){
  if(!['facility','admin'].includes(u.role))fail(403,'기관 또는 관리자 로그인이 필요합니다.');
  const id=u.role==='facility'?u.facilityId:txt(b.facilityId,90);
  if(!id)fail(400,'기관 ID를 입력하세요.');
  const f=await readFacility(s,id);
  if(u.role==='facility'&&!(f.managerUids||[]).includes(u.uid))fail(403,'기관 계정이 연결되지 않았습니다.');
  const raw=txt(b.imageData,2600000),mime=txt(b.mime,30);
  if(!['image/jpeg','image/png','image/webp'].includes(mime)||!raw||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))fail(400,'JPG/PNG/WebP 형식의 이미지만 가능합니다.');
  const bytes=Buffer.from(raw,'base64');
  if(bytes.length<10||bytes.length>1800000)fail(413,'사진 크기는 1.8MB 이하여야 합니다.');
  const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)fail(400,'사진 형식과 실제 파일내용이 다릅니다.');
  const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
  const path=`ci_pending/${id}/${u.uid}/${randomBytes(12).toString('hex')}.${ext}`;
  const bucket=getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET||'ansimcare-9bae3.firebasestorage.app');
  await bucket.file(path).save(bytes,{resumable:false,contentType:mime,metadata:{cacheControl:'private,no-store'}});
  return {photoPath:path};
}
async function reviewProfile(s,u,b){requireAdmin(u);
  const id=txt(b.requestId,150),decision=txt(b.decision,25),reason=txt(b.reason,300);
  const verificationNote=txt(b.verificationNote,500);
  if(!['approved','rejected'].includes(decision))fail(400,'승인 또는 반려를 선택하세요.');
  if(decision==='approved'&&(b.verified!==true||verificationNote.length<10))fail(400,'실제 자료 확인 후 검증근거와 확인일을 10자 이상 입력하세요.');
  if(decision==='rejected'&&reason.length<4)fail(400,'반려·보완 사유를 4자 이상 입력하세요.');
  const ref=s.db.collection('ci_requests').doc(id);
  const initial=await ref.get();
  if(!initial.exists||initial.get('status')!=='pending'||initial.get('kind')!=='profile')fail(409,'승인 대기 중인 기관정보 변경 요청이 아닙니다.');
  const row=initial.data();let imageUrl='',copiedFile=null;
  if(decision==='approved'&&row?.payload?.photoPath){
    if(!String(row.payload.photoPath).startsWith(`ci_pending/${row.facilityId}/${row.authorUid}/`))fail(403,'사진 경로를 확인할 수 없습니다.');
    const bucket=getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET||'ansimcare-9bae3.firebasestorage.app');
    const dest=`ci_public/${row.facilityId}/${randomBytes(10).toString('hex')}.${row.payload.photoPath.split('.').at(-1)}`;
    const token=randomUUID();copiedFile=bucket.file(dest);
    await bucket.file(row.payload.photoPath).copy(copiedFile);
    await copiedFile.setMetadata({metadata:{firebaseStorageDownloadTokens:token},cacheControl:'public,max-age=3600'});
    imageUrl=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
  }
  let outcome;
  try{
    outcome=await s.db.runTransaction(async tx=>{
      const [r,old]=await Promise.all([tx.get(ref),tx.get(sRef(s,row.facilityId))]);
      if(!r.exists||r.get('status')!=='pending'||r.get('kind')!=='profile')fail(409,'이미 처리한 변경 요청입니다.');
      if(!old.exists)fail(404,'기관이 삭제되거나 없습니다.');
      const request=r.data(),prior={id:old.id,...old.data()};
      if(decision==='approved'){
        if(request.schemaVersion!=='2.9.3')fail(409,'이전 양식으로 제출된 수정 요청입니다. 자료 보완을 요청한 뒤 새 양식으로 제출받아 주세요.');
        const edit=reviewProfileChanges(prior,request);
        // 유효한 지역·유형·기관명과 HTTPS URL인지 승인 시점에 재검증합니다.
        const merged=normalizedFacility({...prior,...edit});
        if(prior.advertisingStatus==='active'&&[prior.type,prior.region,prior.district].join('|')!==[merged.type,merged.region,merged.district].join('|'))
          fail(409,'홍보 중인 기관의 유형·소재지 변경은 먼저 계약을 중지하세요.');
        const patch={};for(const key of PROFILE_FIELDS)if(Object.prototype.hasOwnProperty.call(edit,key))patch[key]=merged[key];
        if(imageUrl)patch.imageUrl=imageUrl;
        tx.update(sRef(s,row.facilityId),{...patch,lastConfirmedAt:todayKST(),
          profileVerifiedBy:u.uid,profileVerificationNote:verificationNote,profileVerificationDate:todayKST(),
          updatedAt:s.FieldValue.serverTimestamp()});
      }
      tx.update(ref,{status:decision,reason:decision==='approved'?'관리자 검증 후 반영':reason,
        verificationNote:decision==='approved'?verificationNote:'',reviewedBy:u.uid,reviewedAt:s.FieldValue.serverTimestamp()});
      return {facilityId:row.facilityId};
    });
  }catch(e){if(copiedFile)await copiedFile.delete({ignoreNotFound:true}).catch(()=>{});throw e;}
  if(decision==='approved'){
    const f=await readFacility(s,outcome.facilityId);await publish(s,f);
  }
  await audit(s,u.uid,'review_profile',outcome.facilityId,{requestId:id,decision});
  return {requestId:id,status:decision};
}
async function adminApprove(s,u,b){requireAdmin(u);
  const id=txt(b.facilityId,100),value=txt(b.status,30);
  if(!['approved','pending','rejected'].includes(value))fail(400,'승인 상태를 확인하세요.');
  if(value==='approved'){const a=await s.db.collection('ci_assessment_states').doc(id).get();if(a.data()?.riskHold)fail(409,'돌봄 안전·인권 우려로 게시가 보류된 기관입니다. 재점검 및 관리자 검토 승인 후 게시할 수 있습니다.');}
  await sRef(s,id).update({publicationStatus:value,updatedAt:s.FieldValue.serverTimestamp(),lastConfirmedAt:value==='approved'?todayKST():''});
  const f=await readFacility(s,id);await publish(s,f);
  await audit(s,u.uid,'admin_approve',id,{value});return {facility:safeFacility(f)};
}
async function contract(s,u,b){requireAdmin(u);
  const id=txt(b.facilityId,100),command=txt(b.command,20);
  if(!['activate','suspend','end'].includes(command))fail(400,'계약 작업을 선택하세요.');
  const start=txt(b.start,10),end=txt(b.end,10),reference=txt(b.reference,160);
  if(command==='activate'&&(!dateOK(start)||!dateOK(end)||start>end||start>todayKST()||end<todayKST()))fail(400,'계약 시작일은 오늘 이전 또는 오늘이어야 하며, 종료일은 오늘 이후여야 합니다. 미래 시작 계약은 시작일에 활성화하세요.');
  if(command==='activate'&&!b.paymentConfirmed)fail(400,'입금 확인을 체크해야 계약을 활성화할 수 있습니다.');
  const ref=sRef(s,id);
  const ret=await s.db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)fail(404,'기관을 찾을 수 없습니다.');
    const f=snap.data();
    const slotRef=quotaDoc(s,f);
    const slotSnap=await tx.get(slotRef);
    const safetySnap=await tx.get(s.db.collection('ci_assessment_states').doc(id));
    if(command==='activate'&&safetySnap.data()?.riskHold===true)fail(409,'안전·인권 우려로 게시가 보류되어 있습니다. 관리자 재검토 후 계약을 진행하세요.');
    const old=slotSnap.data()||{};const slots=activeSlots(old);
    const capacity=Number.isInteger(old.capacity)?old.capacity:defaultCap(f.region,f.district,f.type);
    if(command==='activate'){
      if(f.publicationStatus!=='approved')fail(409,'기관정보 게시 승인 후 계약을 활성화하세요.');
      if(!(id in slots)&&Object.keys(slots).length>=capacity)fail(409,'이 지역·유형의 유료 홍보 정원이 모두 찼습니다.');
      slots[id]=end;
      tx.set(slotRef,{region:f.region,district:f.district,type:f.type,capacity,slots,updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
      tx.update(ref,{advertisingStatus:'active',paymentStatus:'confirmed',paymentReference:reference,paidConfirmedAt:s.FieldValue.serverTimestamp(),paidConfirmedBy:u.uid,contractStart:start,contractEnd:end,updatedAt:s.FieldValue.serverTimestamp()});
    }else{
      delete slots[id];tx.set(slotRef,{region:f.region,district:f.district,type:f.type,capacity,slots,updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
      tx.update(ref,{advertisingStatus:command==='end'?'ended':'suspended',paymentStatus:command==='end'?'unconfirmed':f.paymentStatus,updatedAt:s.FieldValue.serverTimestamp()});
    }
    return {facilityId:id,command,capacity};
  });
  const f=await readFacility(s,id);await publish(s,f);await audit(s,u.uid,'contract_'+command,id,{start,end,reference});
  return {...ret,visible:visible(f)};
}
async function getQuotas(s){
  const existing=await s.db.collection('ci_quotas').get();const map=new Map(existing.docs.map(d=>[d.id,d.data()]));const rows=[];
  for(const [region,districts] of Object.entries(regions))for(const district of districts)for(const type of types){
    const q=map.get(key(region,district,type))||{};const active=Object.keys(activeSlots(q)).length;
    const capacity=Number.isInteger(q.capacity)?q.capacity:defaultCap(region,district,type);
    rows.push({region,district,type,capacity,active,remaining:Math.max(0,capacity-active),monthlyPrice:getPrivatePrices()[type]});
  }
  return rows;
}
async function setQuota(s,u,b){requireAdmin(u);
  const region=txt(b.region,15),district=txt(b.district,35),type=txt(b.type,25),capacity=Number(b.capacity);
  ensureLocation(region,district);ensureType(type);
  if(!Number.isInteger(capacity)||capacity<1||capacity>200)fail(400,'홍보 정원은 1~200곳의 정수로 지정하세요.');
  const ref=s.db.collection('ci_quotas').doc(key(region,district,type));
  await s.db.runTransaction(async tx=>{
    const old=await tx.get(ref),slots=activeSlots(old.data());
    if(Object.keys(slots).length>capacity)fail(409,'현재 유효 계약 수보다 정원을 적게 설정할 수 없습니다.');
    tx.set(ref,{region,district,type,capacity,slots,updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
  });
  await audit(s,u.uid,'set_quota',null,{region,district,type,capacity});return {region,district,type,capacity};
}
async function getMy(s,u){if(u.role!=='facility')fail(403,'기관 계정이 필요합니다.');
  const f=await readFacility(s,u.facilityId);
  if(!belongsToFacility(u,f))fail(403,'승인된 본인 기관 계정이 아니거나 접속이 중지되었습니다.');return safeFacility(f);
}
async function getMyAccount(s,u){
  if(u.role==='admin')requireAdmin(u);
  if(u.role==='facility')await getMy(s,u);
  return {uid:u.uid,role:u.role||'guardian',facilityId:u.role==='facility'?u.facilityId:'',email:u.email||'',displayName:u.name||''};
}
// 기관 자체점검은 비공개 제출물로 저장합니다. 관리자 검토 없이 공개되지 않습니다.
async function submitSelfAssessment(s,u,b){
  const f=await getMy(s,u);if(!SUPPORTED_TYPES.includes(f.type))fail(400,'현재 정기 자체점검은 요양병원·요양원에 우선 적용합니다.');
  let answers;try{answers=checkSelf(b.answers);}catch(e){fail(400,e.message);}
  const note=txt(b.generalNote,500);
  const reportRef=s.db.collection('ci_assessment_reports').doc();
  const stateRef=s.db.collection('ci_assessment_states').doc(f.id);
  const reportedRiskDomains=Object.entries(answers).filter(([,v])=>v==='우려').map(([id])=>id);
  const risky=reportedRiskDomains.length>0;const day=todayKST();
  await s.db.runTransaction(async tx=>{
    const prior=await tx.get(stateRef);
    const last=prior.data()?.submittedAtMs||0;
    if(Date.now()-last<60*60*1000)fail(429,'중복 등록 방지를 위해 한 시간 뒤에 재제출할 수 있습니다.');
    tx.create(reportRef,{facilityId:f.id,facilityName:f.name,facilityType:f.type,answers,generalNote:note,submittedBy:u.uid,submittedAt:s.FieldValue.serverTimestamp(),submittedDate:day,status:'pending',schemaVersion:'1.0'});
    const previousRisk=Array.isArray(prior.data()?.riskDomains)?prior.data().riskDomains:[];
    const unresolvedRisk=[...new Set([...previousRisk,...reportedRiskDomains])];
    tx.set(stateRef,{facilityId:f.id,lastSubmittedDate:day,submittedAtMs:Date.now(),lastReportId:reportRef.id,nextSelfDue:addMonths(day,6),status:(risky||prior.data()?.riskHold)?'safety_hold':'pending',riskHold:risky?true:(prior.data()?.riskHold||false),riskDomains:unresolvedRisk,updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
    if(risky){tx.update(sRef(s,f.id),{publicationStatus:'pending',updatedAt:s.FieldValue.serverTimestamp()});tx.delete(s.db.collection('ci_public').doc(f.id));}
  });
  await audit(s,u.uid,'self_assessment_submit',f.id,{reportId:reportRef.id,risky});
  return {reportId:reportRef.id,status:'pending',nextSelfDue:addMonths(day,6),publicationPaused:risky};
}
async function selfAssessmentState(s,u){
  const f=await getMy(s,u);
  const snap=await s.db.collection('ci_assessment_states').doc(f.id).get();
  const v=snap.data()||{};
  return {facilityId:f.id,type:f.type,lastSubmittedDate:v.lastSubmittedDate||'',nextSelfDue:v.nextSelfDue||'',lastVerifiedDate:v.lastVerifiedDate||'',nextAnnualDue:v.nextAnnualDue||'',status:v.status||'아직 제출하지 않음'};
}
async function listAssessmentPending(s,u){requireAdmin(u);
  // 1차 운영용 최근 80건 목록. 기관 증가 시 관리용 색인과 페이지네이션 필요.
  const snap=await s.db.collection('ci_assessment_reports').orderBy('__name__','desc').limit(80).get();
  return snap.docs.filter(d=>d.get('status')==='pending').map(d=>{
    const v=d.data();return {id:d.id,facilityId:v.facilityId,facilityName:v.facilityName,facilityType:v.facilityType,answers:v.answers,submittedDate:v.submittedDate,generalNote:v.generalNote};
  });
}
async function adminReviewAssessment(s,u,b){requireAdmin(u);
  const reportId=txt(b.reportId,150),decision=txt(b.decision,25);
  if(!['publish','revision','hold'].includes(decision))fail(400,'심사 처리 방법을 선택하세요.');
  const ref=s.db.collection('ci_assessment_reports').doc(reportId);
  const snap=await ref.get();if(!snap.exists)fail(404,'심사 기록을 찾을 수 없습니다.');
  const record=snap.data();if(record.status!=='pending')fail(409,'이미 처리된 심사 기록입니다.');
  const f=await readFacility(s,record.facilityId);
  const stateRef=s.db.collection('ci_assessment_states').doc(f.id),pubRef=s.db.collection('ci_public_assessments').doc(f.id);
  let rows=null;
  if(decision==='publish'||decision==='hold'){
    try{rows=checkReview(b.results);}catch(e){fail(400,e.message);}
    if(decision==='publish'&&Object.values(rows).some(x=>x.finding==='우려'))fail(409,'안전·인권 관련 우려가 있으면 결과를 공개 승인할 수 없습니다. 게시 보류를 검토하세요.');
    if(decision==='publish'&&!riskReleaseAllowed(record.answers,rows))fail(409,'기관이 보고한 안전·인권 우려 항목은 서류 또는 현장 점검 근거로 해소 여부를 확인해야 게시보류를 해제할 수 있습니다.');
    if(decision==='hold'&&!Object.values(rows).some(x=>x.finding==='우려')&&!Object.values(record.answers).some(x=>x==='우려'))fail(400,'보류 근거가 된 위험 징후를 확인하세요.');
  }
  const today=todayKST(),message=txt(b.internalReason,400);
  if(decision==='revision'&&!message)fail(400,'보완 요청 사유를 기록하세요.');
  await s.db.runTransaction(async tx=>{
    const current=await tx.get(ref);if(!current.exists||current.get('status')!=='pending')fail(409,'다른 관리자가 이미 검토했습니다.');
    const facilityRef=sRef(s,f.id),state=await tx.get(stateRef);
    const publicDoc=await tx.get(s.db.collection('ci_public').doc(f.id));
    // 과거 보고서의 미해결 위험도 해소해야 함. 새로운 '양호' 자체보고로 보류를 풀 수 없음.
    if(decision==='publish'&&state.data()?.riskHold===true){
      const saved=Array.isArray(state.data()?.riskDomains)?state.data().riskDomains:[];
      const required=saved.length?saved:['neglect','dignity','incident'];
      if(!riskReleaseAllowed(record.answers,rows,required))fail(409,'이전에 보고된 안전·인권 위험의 해소 근거가 부족합니다. 관련 항목의 서류 또는 현장 확인과 구체적 근거를 기록하세요.');
    }
    if(decision==='publish'){
      const safeRows=publicReview(rows);
      tx.set(pubRef,{facilityId:f.id,facilityType:f.type,rows:safeRows,reviewedDate:today,sourceReportId:reportId,confirmedByAdmin:true,nextAnnualDue:addMonths(today,12),lastSelfDate:record.submittedDate}, {merge:false});
      tx.set(stateRef,{status:'reviewed',riskHold:false,riskDomains:[],lastVerifiedDate:today,nextAnnualDue:addMonths(today,12),lastReviewReportId:reportId,updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
    }else if(decision==='hold'){
      tx.update(facilityRef,{publicationStatus:'pending',updatedAt:s.FieldValue.serverTimestamp()});
      tx.delete(s.db.collection('ci_public').doc(f.id));tx.delete(pubRef);
      const reported=Object.entries(record.answers||{}).filter(([,v])=>v==='우려').map(([id])=>id);
      const reviewed=Object.entries(rows||{}).filter(([,v])=>v.finding==='우려').map(([id])=>id);
      const oldRisk=Array.isArray(state.data()?.riskDomains)?state.data().riskDomains:[];
      tx.set(stateRef,{status:'safety_hold',riskHold:true,riskDomains:[...new Set([...oldRisk,...reported,...reviewed])],updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
    }else tx.set(stateRef,{status:'revision_requested',riskHold:state.data()?.riskHold||false,updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
    tx.update(ref,{status:decision==='publish'?'reviewed':decision==='hold'?'held':'revision_requested',reviewedBy:u.uid,reviewedDate:today,reviewedAt:s.FieldValue.serverTimestamp(),internalReason:message,results:rows||{}});
  });
  await audit(s,u.uid,'assessment_'+decision,f.id,{reportId});
  return {reportId,status:decision,facilityId:f.id};
}
async function publicAssessment(s,b){
  const facilityId=txt(b.facilityId,95);if(!facilityId)fail(400,'기관 ID가 필요합니다.');
  const visibleSnap=await s.db.collection('ci_public').doc(facilityId).get();
  const p=visibleSnap.data();const today=todayKST();
  if(!p||p.advertisement!==true||!p.contractStart||p.contractStart>today||p.contractEnd<today)fail(404,'현재 공개된 참여기관이 아닙니다.');
  const result=await s.db.collection('ci_public_assessments').doc(facilityId).get();
  if(!result.exists)return {assessment:null,notice:'관리자 검토가 완료된 점검 결과가 아직 없습니다.'};
  const v=result.data();
  if(!v.confirmedByAdmin||!v.reviewedDate)return {assessment:null,notice:'공개 가능한 점검 결과가 없습니다.'};
  if(v.nextAnnualDue<today)return {assessment:{reviewedDate:v.reviewedDate,expired:true},notice:'이전 점검 결과의 재확인 시점이 경과했습니다. 최근 결과를 다시 확인 중입니다.'};
  return {assessment:{reviewedDate:v.reviewedDate,nextAnnualDue:v.nextAnnualDue,rows:v.rows,expired:false},notice:'돌봄지음 자체 확인정보이며 공적 인증이나 서비스 품질 보증이 아닙니다.'};
}

// [v2.6] 현장점검. 관리자 내부 메모와 보호자 공개용 문장을 물리적으로 분리합니다.
const fieldDraftRef=(s,id)=>s.db.collection('ci_field_inspection_drafts').doc(id);
const fieldPublicRef=(s,id)=>s.db.collection('ci_public_field_inspections').doc(id);
async function adminFieldState(s,u,b){requireAdmin(u);
  const id=txt(b.facilityId,90);if(!id)fail(400,'기관을 먼저 선택하세요.');
  const f=await readFacility(s,id);
  const [draft,publicDoc,state]=await Promise.all([fieldDraftRef(s,id).get(),fieldPublicRef(s,id).get(),s.db.collection('ci_assessment_states').doc(id).get()]);
  return {facility:{id,name:f.name,type:f.type,region:f.region,district:f.district},draft:draft.exists?draft.data():null,published:publicDoc.exists?{visitedDate:publicDoc.data().visitedDate,publishedDate:publicDoc.data().publishedDate}:null,riskHold:state.data()?.riskHold===true};
}
async function adminSaveField(s,u,b){requireAdmin(u);
  const id=txt(b.facilityId,90);if(!id)fail(400,'기관을 먼저 선택하세요.');
  const f=await readFacility(s,id);
  if(!['요양병원','요양원'].includes(f.type))fail(400,'29개 세부점검은 현재 요양병원·요양원에 적용합니다.');
  let v;try{v=validateFieldDraft(b);}catch(e){fail(400,e.message);}
  const ref=fieldDraftRef(s,id),stateRef=s.db.collection('ci_assessment_states').doc(id);
  const riskDomains=[...new Set(v.concerns.map(x=>x.split('-')[0]))];
  await s.db.runTransaction(async tx=>{
    const state=await tx.get(stateRef);
    tx.set(ref,{facilityId:id,facilityName:f.name,visitedDate:v.visitedDate,rows:v.rows,internalGeneral:v.internalGeneral,editStatus:v.concerns.length?'risk_hold':'draft',updatedBy:u.uid,updatedAt:s.FieldValue.serverTimestamp()});
    if(v.concerns.length){
      const previous=Array.isArray(state.data()?.riskDomains)?state.data().riskDomains:[];
      tx.set(stateRef,{facilityId:id,riskHold:true,status:'safety_hold',riskDomains:[...new Set([...previous,...riskDomains])],updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
      tx.update(sRef(s,id),{publicationStatus:'pending',updatedAt:s.FieldValue.serverTimestamp()});
      tx.delete(s.db.collection('ci_public').doc(id));
      tx.delete(fieldPublicRef(s,id));
    }
  });
  await audit(s,u.uid,'field_inspection_save',id,{visitedDate:v.visitedDate,checked:v.verified,risky:v.concerns.length>0});
  return {saved:true,publicationPaused:v.concerns.length>0,verified:v.verified};
}
async function adminPublishField(s,u,b){requireAdmin(u);
  const id=txt(b.facilityId,90);if(!id)fail(400,'기관을 먼저 선택하세요.');
  const f=await readFacility(s,id);
  if(!['요양병원','요양원'].includes(f.type))fail(400,'해당 기관 유형은 세부 현장점검 지원 전입니다.');
  const draftRef=fieldDraftRef(s,id),ref=fieldPublicRef(s,id),stateRef=s.db.collection('ci_assessment_states').doc(id);
  const today=todayKST();
  await s.db.runTransaction(async tx=>{
    const [draft,state,pub]=await Promise.all([tx.get(draftRef),tx.get(stateRef),tx.get(s.db.collection('ci_public').doc(id))]);
    if(!draft.exists)fail(404,'저장된 현장점검 초안이 없습니다.');
    let v;try{v=validateFieldDraft(draft.data(),{publish:true});}catch(e){fail(400,e.message);}
    if(v.concerns.length)fail(409,'우려 기록이 있는 점검표는 공개할 수 없습니다. 보완 확인과 게시보류 검토가 필요합니다.');
    if(state.data()?.riskHold===true)fail(409,'안전·인권 관련 게시보류 상태입니다. 기존 심사 검토에서 해제 근거를 확인한 후에 공개하세요.');
    // 기초 기관정보, 수납, 계약, 게시는 별도 승인 절차입니다.
    if(!pub.exists||!visible(f))fail(409,'계약·입금·게시 승인이 완료된 공개 참여기관에만 점검결과를 게시할 수 있습니다. 초안은 유지됩니다.');
    const publicRows=publicFieldRows(v.rows);
    tx.set(ref,{facilityId:id,visitedDate:v.visitedDate,publishedDate:today,nextReviewDate:addMonths(v.visitedDate,12),rows:publicRows,confirmedByAdmin:true,schemaVersion:'2.6'});
    tx.update(draftRef,{editStatus:'published',publishedDate:today,publishedBy:u.uid,updatedAt:s.FieldValue.serverTimestamp()});
  });
  await audit(s,u.uid,'field_inspection_publish',id,{date:today});
  return {published:true,date:today};
}
async function publicFieldInspection(s,b){
  const id=txt(b.facilityId,90);if(!id)fail(400,'기관 ID가 필요합니다.');
  const [fac,doc,state]=await Promise.all([s.db.collection('ci_public').doc(id).get(),fieldPublicRef(s,id).get(),s.db.collection('ci_assessment_states').doc(id).get()]);
  const f=fac.data(),today=todayKST();
  if(!f||f.advertisement!==true||!f.contractStart||f.contractStart>today||f.contractEnd<today||state.data()?.riskHold===true)fail(404,'현재 공개된 참여기관이 아닙니다.');
  if(!doc.exists||doc.data()?.confirmedByAdmin!==true)return {inspection:null,notice:'공개 승인된 세부 현장점검 자료가 없습니다. 모든 항목은 미확인으로 표시됩니다.'};
  const data=doc.data();
  if(!data.nextReviewDate||data.nextReviewDate<today)return {inspection:null,notice:'지난 현장점검 자료의 재확인 시점이 경과했습니다. 현재 다시 확인 중입니다.'};
  return {inspection:{visitedDate:data.visitedDate,publishedDate:data.publishedDate,nextReviewDate:data.nextReviewDate,rows:publicFieldRows(data.rows)},notice:'자체 점검정보입니다. 국가 인증·품질보증은 아닙니다.'};
}

// [v2.7] 기관 전용 결제 신청. 전자결제/수납 자동확정이 아니라 수동 입금·계약 검토 대기입니다.
const paymentOrders=s=>s.db.collection('ci_payment_orders');
const orderDate=todayKST;
async function facilityOrderQuote(s,u,b){
  const f=await getMy(s,u);
  const months=normalizeOrderMonths(b.months);
  const quota=await privateQuota(s,u,{});
  const monthlyPrice=getPrivatePrices()[f.type];
  return {facilityId:f.id,facilityName:f.name,facilityType:f.type,region:f.region,district:f.district,months,monthlyPrice,estimatedAmount:invoiceAmount(months,monthlyPrice),quota:{capacity:quota.capacity,active:quota.active,remaining:quota.remaining},taxNote:'예상 홍보료입니다. 부가세·세금계산서·최종 계약조건은 계약서 및 담당자 안내를 확인하세요.',methods:[{id:'manual_transfer',name:'무통장입금 신청(담당자 확인 후 안내)'},{id:'card',name:'신용카드 결제(PG 계약·심사 후 제공)',enabled:false}]};
}
async function facilityCreateOrder(s,u,b){
  const f=await getMy(s,u),months=normalizeOrderMonths(b.months);
  if(b.method!=='manual_transfer')fail(400,'현재는 무통장입금 신청만 가능합니다. 신용카드 결제는 준비 중입니다.');
  if(b.acknowledged!==true)fail(400,'신청과 실제 결제 완료가 다르다는 안내를 확인하세요.');
  const quote=await facilityOrderQuote(s,u,{months});
  if(quote.quota.remaining<=0)fail(409,'해당 지역의 홍보 정원이 모두 찼습니다. 관리자와 별도 상담해 주세요.');
  const note=txt(b.note,300);
  const existing=await paymentOrders(s).where('facilityId','==',f.id).limit(60).get();
  const pending=existing.docs.find(d=>d.data().status===ORDER_PENDING);
  if(pending)return {order:providerOrderView({id:pending.id,...pending.data()}),existing:true,message:'이미 접수된 신청이 있습니다. 다시 신청하지 않아도 됩니다.'};
  const id='DJ-'+Date.now().toString(36).toUpperCase()+'-'+randomBytes(4).toString('hex').toUpperCase();
  const data={facilityId:f.id,facilityName:f.name,facilityType:f.type,region:f.region,district:f.district,months,monthlyPrice:quote.monthlyPrice,estimatedAmount:quote.estimatedAmount,method:'manual_transfer',status:ORDER_PENDING,requestDate:orderDate(),createdBy:u.uid,note,createdAt:s.FieldValue.serverTimestamp()};
  await paymentOrders(s).doc(id).create(data);
  await audit(s,u.uid,'payment_application',f.id,{orderId:id,months,estimatedAmount:quote.estimatedAmount});
  return {order:providerOrderView({id,...data}),existing:false,message:'신청 접수 완료. 입금계좌와 최종 계약조건은 관리자 확인 후 별도로 안내합니다. 아직 결제된 상태가 아닙니다.'};
}
async function facilityMyOrders(s,u){
  const f=await getMy(s,u);
  const snap=await paymentOrders(s).where('facilityId','==',f.id).limit(60).get();
  return {items:snap.docs.map(d=>providerOrderView({id:d.id,...d.data()})).sort((a,b)=>b.id.localeCompare(a.id))};
}
async function adminPaymentOrders(s,u){requireAdmin(u);
  const snap=await paymentOrders(s).orderBy('__name__','desc').limit(150).get();
  return {items:snap.docs.map(d=>providerOrderView({id:d.id,...d.data()}))};
}
async function adminReviewPaymentOrder(s,u,b){requireAdmin(u);
  const orderId=txt(b.orderId,120),decision=txt(b.decision,35),reference=txt(b.reference,160);
  if(![ORDER_PAID,ORDER_CANCELED].includes(decision))fail(400,'지원하지 않는 입금 검토 상태입니다.');
  if(decision===ORDER_PAID&&(!b.confirmedActualReceipt||reference.length<5))fail(400,'실제 계좌 입금을 확인했는지 체크하고 수납 확인번호를 입력하세요.');
  const ref=paymentOrders(s).doc(orderId);
  const ret=await s.db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)fail(404,'신청내역이 없습니다.');
    const order=snap.data();if(order.status!==ORDER_PENDING)fail(409,'이미 처리된 신청입니다.');
    tx.update(ref,{status:decision,reviewedBy:u.uid,reviewedDate:orderDate(),paymentReference:decision===ORDER_PAID?reference:'',reviewedAt:s.FieldValue.serverTimestamp()});
    return {orderId,status:decision,facilityId:order.facilityId,facilityName:order.facilityName};
  });
  await audit(s,u.uid,'payment_review',ret.facilityId,{orderId,decision});
  return {...ret,notice:decision===ORDER_PAID?'신청 건의 실제 입금 확인을 기록했습니다. 게시 승인과 광고 계약 활성화는 별도 관리 화면에서 진행해야 합니다.':'신청이 취소되었습니다.'};
}

// [v2.8] 비로그인 사용자의 페이지 이용을 일별 익명 브라우저 세션으로 집계합니다.
// 카카오 UID, IP, 전화번호, 의료/건강정보, URL 쿼리 등은 기록하지 않습니다.
const trackingCollection=s=>s.db.collection('dj_analytics_daily');
const trackingDedup=s=>s.db.collection('dj_analytics_dedup');
async function recordPublicVisit(s,event,body){
  // 시험 브랜치는 운영 데이터베이스에 기록을 남기지 않습니다.
  if(process.env.CI_DEPLOY_KIND==='auth-test' || process.env.CONTEXT!=='production')return {counted:false,testMode:true,note:'시험 배포에서는 방문 성과를 집계하지 않습니다.'};
  const origin=event.headers?.origin||event.headers?.Origin||'';
  const host=event.headers?.host||event.headers?.Host||'';
  if(origin&&(!host||new URL(origin).host!==host))fail(403,'다른 사이트의 기록 요청을 허용하지 않습니다.');
  let t;try{t=cleanTrackingRequest(body);}catch(e){fail(400,e.message);}
  if(t.facilityId){
    const ref=s.db.collection('ci_public').doc(t.facilityId);
    const snap=await ref.get(),f=snap.data();
    if(!f||f.advertisement!==true||!f.contractStart||f.contractStart>todayKST()||f.contractEnd<todayKST())fail(404,'현재 공개 참여기관이 아닙니다.');
    const state=await s.db.collection('ci_assessment_states').doc(t.facilityId).get();
    if(state.data()?.riskHold===true)fail(404,'현재 공개 참여기관이 아닙니다.');
  }
  const day=todayKST(),k=trackingKeys(day,t);
  const seen=trackingDedup(s).doc(k.dedupId),daily=trackingCollection(s).doc(k.dailyDoc);
  const now=Date.now();
  const counted=await s.db.runTransaction(async tx=>{
    const existing=await tx.get(seen);
    if(existing.exists)return false;
    // 이 문서의 TTL 필드는 Firebase 콘솔에서 35일 만료 정책을 지정해야 자동 삭제됩니다.
    tx.create(seen,{day,metric:t.metric,expireAt:new Date(now+35*86400000),createdAt:s.FieldValue.serverTimestamp()});
    tx.set(daily,{day,scope:t.metric==='site_visit'?'site':'facility',...(t.facilityId?{facilityId:t.facilityId}:{}),[k.field]:s.FieldValue.increment(1),updatedAt:s.FieldValue.serverTimestamp()},{merge:true});
    return true;
  });
  return {counted};
}
async function readAnalyticsReport(s,facilityId){
  const days=lastDays(todayKST(),30);
  const siteRefs=days.map(day=>trackingCollection(s).doc(day+'__site'));
  const facRefs=facilityId?days.map(day=>trackingCollection(s).doc(day+'__facility_'+facilityId)):[];
  const [siteDocs,facDocs]=await Promise.all([
    Promise.all(siteRefs.map(ref=>ref.get())),
    Promise.all(facRefs.map(ref=>ref.get()))
  ]);
  return {periodStart:days[0],periodEnd:days.at(-1),facilityId:facilityId||'',...aggregateReport(days,siteDocs.map(d=>d.data()||{}),days.map((_,i)=>facDocs[i]?.data()||{})),method:'하루 한 번 집계한 익명 브라우저 세션 수. 실제 사람 수나 상담·입소 실적이 아닙니다.',testMode:process.env.CONTEXT!=='production'};
}
async function facilityMyAnalytics(s,u){const f=await getMy(s,u);return {facilityName:f.name,...await readAnalyticsReport(s,f.id)};}
async function adminAnalytics(s,u,b){requireAdmin(u);const id=txt(b.facilityId,90);if(id)await readFacility(s,id);return {facilityName:id?(await readFacility(s,id)).name:'',...await readAnalyticsReport(s,id)};}

export async function handler(event){
  try{
    const method=event.httpMethod;
    if(method!=='GET'&&method!=='POST')return response(405,{ok:false,error:'허용되지 않는 방식입니다.'});
    const body=method==='POST'?getBody(event):(event.queryStringParameters||{}),action=txt(body.action,60);
    // Netlify branch-deploy는 운영 DB와 환경변수를 공유할 수 있으므로 반드시 읽기 전용.
    // 관리자/기관이라고 해도 지점별 자료수정·입금확인·신청등록을 시험 주소에서는 차단합니다.
    const stagingReadActions=new Set(['my_account','my_facility','private_quota','private_plan_prices','requests','my_assessment_state','admin_field_state','admin_pending_assessments','admin_list','admin_quotas','facility_order_quote','facility_my_orders','admin_payment_orders','facility_my_analytics','admin_analytics','admin_overview','admin_facility_detail','my_access_application','admin_access_applications','public_track']);
    // Even if this standalone Netlify site has CONTEXT='production', writes remain
    // disabled until BOTH the isolated test project and explicit test-write opt-in match.
    const isolatedTest = process.env.CI_DEPLOY_KIND==='auth-test' && process.env.CI_FIREBASE_PROJECT_ID==='dolbomjieum-test';
    const allowTestWrites = isolatedTest && process.env.CI_TEST_WRITES==='enabled' && process.env.CONTEXT==='production';
    if(method==='POST' && !stagingReadActions.has(action) && !allowTestWrites)
      fail(403,'시험용 쓰기 기능은 독립 사이트/시험 Firebase 연결을 확인한 후 활성화할 수 있습니다.');
    const s=services();
    if(method==='GET'&&action==='public_list')return response(200,{ok:true,items:await listPublic(s,body)});
    if(method==='GET'&&action==='public_assessment')return response(200,{ok:true,...await publicAssessment(s,body)});
    if(method==='GET'&&action==='public_field_inspection')return response(200,{ok:true,...await publicFieldInspection(s,body)});
    if(method==='POST'&&action==='public_track')return response(200,{ok:true,...await recordPublicVisit(s,event,body)});

    const u=await authUser(event,s);
    // Every protected request is authorized by the server, not by the menu state.
    if(u.role==='admin')requireAdmin(u);
    if(u.role==='facility')await getMy(s,u);
    let result;
    switch(action){
      case 'my_account': result=await getMyAccount(s,u);break;
      case 'my_access_application': result=await myAccessApplication(s,u);break;
      case 'facility_apply':result=await applyForFacilityAccess(s,u,body);break;
      case 'admin_access_applications':result=await listAccessApplications(s,u);break;
      case 'admin_review_access_application':result=await reviewAccessApplication(s,u,body);break;
      case 'admin_revoke_facility_access':result=await revokeFacilityAccess(s,u,body);break;
      case 'private_quota': result=await privateQuota(s,u,body);break;
      case 'private_plan_prices': {
        if(u.role==='admin')result={prices:getPrivatePrices()};
        else if(u.role==='facility'){
          const f=await getMy(s,u);
          result={prices:{[f.type]:getPrivatePrices()[f.type]},region:f.region,district:f.district,type:f.type};
        }else fail(403,'기관 또는 관리자 로그인이 필요합니다.');
        break;
      }
      case 'my_facility': result={facility:await getMy(s,u)};break;
      case 'facility_my_analytics':result=await facilityMyAnalytics(s,u);break;
      case 'admin_analytics':result=await adminAnalytics(s,u,body);break;
      case 'facility_order_quote': result=await facilityOrderQuote(s,u,body);break;
      case 'facility_create_order': result=await facilityCreateOrder(s,u,body);break;
      case 'facility_my_orders': result=await facilityMyOrders(s,u);break;
      case 'admin_payment_orders': result=await adminPaymentOrders(s,u);break;
      case 'admin_review_payment_order': result=await adminReviewPaymentOrder(s,u,body);break;
      case 'submit_self_assessment': result=await submitSelfAssessment(s,u,body);break;
      case 'my_assessment_state': result=await selfAssessmentState(s,u);break;
      case 'admin_field_state':result=await adminFieldState(s,u,body);break;
      case 'admin_field_save':result=await adminSaveField(s,u,body);break;
      case 'admin_field_publish':result=await adminPublishField(s,u,body);break;
      case 'admin_pending_assessments': result={items:await listAssessmentPending(s,u)};break;
      case 'admin_review_assessment': result=await adminReviewAssessment(s,u,body);break;
      case 'admin_list':requireAdmin(u);result=await listAdmin(s,body);break;
      case 'admin_overview':result=await adminOverview(s,u);break;
      case 'admin_facility_detail':result=await adminFacilityDetail(s,u,body);break;
      case 'admin_quotas':requireAdmin(u);result={items:await getQuotas(s)};break;
      case 'admin_set_quota':result=await setQuota(s,u,body);break;
      case 'admin_save_facility':result=await createOrEdit(s,u,body);break;
      case 'admin_import':result=await importPrivate(s,u,body);break;
      case 'admin_link_uid':result=await linkUser(s,u,body);break;
      case 'admin_issue_email':result=await issueEmail(s,u,body);break;
      case 'admin_approve':result=await adminApprove(s,u,body);break;
      case 'admin_contract':result=await contract(s,u,body);break;
      case 'upload_photo':result=await uploadPhoto(s,u,body);break;
      case 'submit_profile':result=await submitProfile(s,u,body);break;
      case 'submit_material':result=await submitMaterial(s,u,body);break;
      case 'review_material':result=await reviewMaterial(s,u,body);break;
      case 'requests':result={items:await listRequests(s,u)};break;
      case 'review_request':result=await reviewProfile(s,u,body);break;
      default:fail(400,'지원하지 않는 요청입니다.');
    }
    return response(200,{ok:true,...result});
  }catch(e){return wrapError(e);}
}
