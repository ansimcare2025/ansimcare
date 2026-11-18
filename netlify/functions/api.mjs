import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {getStorage} from 'firebase-admin/storage';
import { services, authUser, requireAdmin, response, wrapError, fail, txt, regions, types, prices, key, defaultCap, dateOK, todayKST, visible, publicFields, normalizedFacility, facilityId, audit, emailOK, ensureLocation, ensureType } from './_shared/core.mjs';
const sRef=(s,id)=>s.db.collection('ci_facilities').doc(id);
const empty={publicationStatus:'pending',advertisingStatus:'pending',paymentStatus:'unconfirmed',contractStart:'',contractEnd:'',managerUids:[],lastConfirmedAt:'',createdAt:null};
const sortTime=(f)=>f.createdAt?.toMillis?.()||0;
const calendarDate=(x)=>dateOK(x)?x:'';
const getBody=(event)=>{
  if((event.body||'').length>3100000)fail(413,'한 번에 전송할 수 있는 데이터 크기를 초과했습니다. 사진은 1.8MB 이내로 선택하세요.');
  try{return JSON.parse(event.body||'{}')}catch{fail(400,'JSON 형식이 유효하지 않습니다.');}
};
async function readFacility(s,id){const snap=await sRef(s,id).get();if(!snap.exists)fail(404,'등록된 기관을 찾을 수 없습니다.');return {id:snap.id,...snap.data()};}
function safeFacility(f){const {id,name,type,region,district,address,phone,description,homepage,imageUrl,officialId,source,sourceDate,lastConfirmedAt,publicationStatus,advertisingStatus,paymentStatus,contractStart,contractEnd,managerUids}=f;return {id,name,type,region,district,address,phone,description,homepage,imageUrl,officialId,source,sourceDate,lastConfirmedAt,publicationStatus,advertisingStatus,paymentStatus,contractStart,contractEnd,managerUids:managerUids||[]};}
function quotaDoc(s,f){return s.db.collection('ci_quotas').doc(key(f.region,f.district,f.type));}
function activeSlots(v,today=todayKST()){const entries=v?.slots||{};return Object.fromEntries(Object.entries(entries).filter(([,end])=>typeof end==='string'&&end>=today));}
async function publish(s,f){
  const ref=s.db.collection('ci_public').doc(f.id);
  if(visible(f))await ref.set(publicFields(f,f.id));
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
async function publicQuota(s,q){
  const region=txt(q.region,15),district=txt(q.district,35),type=txt(q.type,25);
  if(!regions[region]?.includes(district)||!types.includes(type))fail(400,'지역과 기관 유형을 선택하세요.');
  const snap=await s.db.collection('ci_quotas').doc(key(region,district,type)).get();
  const raw=snap.data()||{};const capacity=Number.isInteger(raw.capacity)?raw.capacity:defaultCap(region,district,type);
  const active=Object.keys(activeSlots(raw)).length;
  return {region,district,type,capacity,active,remaining:Math.max(0,capacity-active),price:prices[type],note:'홍보 정원은 시범 운영 정책이며 지역 전체 기관 수를 뜻하지 않습니다.'};
}
async function listAdmin(s,p){
  const limit=Number(p.pageSize)||100;if(limit<1||limit>200)fail(400,'페이지 크기는 1~200입니다.');
  let q=s.db.collection('ci_facilities').orderBy('__name__').limit(limit);
  const after=txt(p.after,90);if(after)q=q.startAfter(after);
  const snap=await q.get();return {items:snap.docs.map(d=>safeFacility({id:d.id,...d.data()})),next:snap.size===limit?snap.docs.at(-1).id:null};
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
  const id=txt(b.facilityId,90),uid=txt(b.uid,140);
  if(!id||!uid)fail(400,'기관 ID와 연결할 Firebase 사용자 UID가 필요합니다.');
  const f=await readFacility(s,id);
  let person;try{person=await s.auth.getUser(uid);}catch{fail(404,'먼저 카카오로 로그인하거나 생성된 이메일 계정의 UID를 입력하세요.');}
  const oldClaims=person.customClaims||{};
  if(oldClaims.role==='admin')fail(403,'관리자 계정은 기관 담당자로 겸직 연결할 수 없습니다.');
  if(oldClaims.role==='facility'&&oldClaims.facilityId&&oldClaims.facilityId!==id)fail(409,'이미 다른 기관에 연결된 계정입니다.');
  await s.auth.setCustomUserClaims(uid,{...oldClaims,role:'facility',facilityId:id});
  await sRef(s,id).update({managerUids:s.FieldValue.arrayUnion(uid),updatedAt:s.FieldValue.serverTimestamp()});
  await audit(s,u.uid,'link_manager',id,{uid});return {facilityId:id,uid};
}
async function issueEmail(s,u,b){requireAdmin(u);
  const id=txt(b.facilityId,90),email=txt(b.email,250).toLowerCase();
  if(!emailOK(email))fail(400,'올바른 담당자 이메일이 필요합니다.');
  const f=await readFacility(s,id);
  const password=randomBytes(21).toString('base64url')+'aA1!';
  let user;
  try{user=await s.auth.createUser({email,password,displayName:f.name,disabled:false});
    await s.auth.setCustomUserClaims(user.uid,{role:'facility',facilityId:id});
    await sRef(s,id).update({managerUids:s.FieldValue.arrayUnion(user.uid),updatedAt:s.FieldValue.serverTimestamp()});
    await audit(s,u.uid,'issue_email_account',id,{uid:user.uid});
    return {uid:user.uid,email,temporaryPassword:password,notice:'한 번만 표시되는 임시 비밀번호입니다. 안전하게 전달해 주세요.'};
  }catch(e){if(user)await s.auth.deleteUser(user.uid).catch(()=>{});if(e.code==='auth/email-already-exists')fail(409,'이메일 계정이 이미 존재합니다. 카카오 UID 연결 또는 기존 계정 연결을 이용하세요.');throw e;}
}
async function submitProfile(s,u,b){
  if(u.role!=='facility'||!u.facilityId)fail(403,'기관 전용 계정으로 로그인하세요.');
  const facility=await readFacility(s,u.facilityId);
  if(!(facility.managerUids||[]).includes(u.uid))fail(403,'해당 기관을 관리할 권한이 없습니다.');
  const patch=normalizedFacility(b.facility||{});
  const uploadedPath=txt(b.photoPath,300);
  if(uploadedPath){
    if(!uploadedPath.startsWith(`ci_pending/${u.facilityId}/${u.uid}/`))fail(403,'자기 기관 사진만 신청할 수 있습니다.');
    const bucket=getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET||'ansimcare-9bae3.firebasestorage.app');
    const [exists]=await bucket.file(uploadedPath).exists();if(!exists)fail(404,'업로드한 사진이 없습니다.');
  }
  const ref=await s.db.collection('ci_requests').add({facilityId:u.facilityId,authorUid:u.uid,kind:'profile',payload:{...patch,photoPath:uploadedPath},status:'pending',createdAt:s.FieldValue.serverTimestamp()});
  await audit(s,u.uid,'submit_profile',u.facilityId,{requestId:ref.id});return {requestId:ref.id};
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
  if(!['approved','rejected'].includes(decision))fail(400,'승인 또는 반려를 선택하세요.');
  const ref=s.db.collection('ci_requests').doc(id);
  const initial=await ref.get();if(!initial.exists)fail(404,'신청을 찾을 수 없습니다.');
  const row=initial.data();let imageUrl='';
  if(decision==='approved'&&row?.payload?.photoPath){
    if(!row.payload.photoPath.startsWith(`ci_pending/${row.facilityId}/${row.authorUid}/`))fail(403,'사진 경로를 확인할 수 없습니다.');
    const bucket=getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET||'ansimcare-9bae3.firebasestorage.app');
    const dest=`ci_public/${row.facilityId}/${randomBytes(10).toString('hex')}.${row.payload.photoPath.split('.').at(-1)}`;
    const token=randomUUID();
    await bucket.file(row.payload.photoPath).copy(bucket.file(dest));
    await bucket.file(dest).setMetadata({metadata:{firebaseStorageDownloadTokens:token},cacheControl:'public,max-age=3600'});
    imageUrl=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
  }
  await s.db.runTransaction(async tx=>{
    const r=await tx.get(ref);if(!r.exists||r.get('status')!=='pending')fail(409,'처리할 승인 대기 요청이 없습니다.');
    const v=r.data();const fref=sRef(s,v.facilityId);const old=await tx.get(fref);
    if(!old.exists)fail(404,'기관이 삭제되거나 없습니다.');
    if(decision==='approved'){
      const prior=old.data();
      if(prior.advertisingStatus==='active'&&[prior.type,prior.region,prior.district].join('|')!==[v.payload.type,v.payload.region,v.payload.district].join('|'))fail(409,'홍보 중인 기관의 유형·소재지 변경은 먼저 계약을 중지하세요.');
      tx.update(fref,{...v.payload,imageUrl:imageUrl||v.payload.imageUrl||prior.imageUrl||'',photoPath:s.FieldValue.delete(),publicationStatus:'approved',lastConfirmedAt:todayKST(),updatedAt:s.FieldValue.serverTimestamp()});
    }
    tx.update(ref,{status:decision,reason,reviewedBy:u.uid,reviewedAt:s.FieldValue.serverTimestamp()});
  });
  const req=(await ref.get()).data();const f=await readFacility(s,req.facilityId);
  await publish(s,f);await audit(s,u.uid,'review_profile',f.id,{id,decision});return {requestId:id,status:decision};
}
async function adminApprove(s,u,b){requireAdmin(u);
  const id=txt(b.facilityId,100),value=txt(b.status,30);
  if(!['approved','pending','rejected'].includes(value))fail(400,'승인 상태를 확인하세요.');
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
    rows.push({region,district,type,capacity,active,remaining:Math.max(0,capacity-active),monthlyPrice:prices[type]});
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
  if(!(f.managerUids||[]).includes(u.uid))fail(403,'기관 연결이 유효하지 않습니다.');return safeFacility(f);
}
async function getMyAccount(s,u){return {uid:u.uid,role:u.role||'guardian',facilityId:u.facilityId||'',email:u.email||'',displayName:u.name||''};}
export async function handler(event){
  try{
    const method=event.httpMethod;
    if(method!=='GET'&&method!=='POST')return response(405,{ok:false,error:'허용되지 않는 방식입니다.'});
    const body=method==='POST'?getBody(event):(event.queryStringParameters||{}),action=txt(body.action,60);
    const s=services();
    if(method==='GET'&&action==='public_list')return response(200,{ok:true,items:await listPublic(s,body)});
    if(method==='GET'&&action==='public_quota')return response(200,{ok:true,...await publicQuota(s,body)});
    const u=await authUser(event,s);
    let result;
    switch(action){
      case 'my_account': result=await getMyAccount(s,u);break;
      case 'my_facility': result={facility:await getMy(s,u)};break;
      case 'admin_list':requireAdmin(u);result=await listAdmin(s,body);break;
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
      case 'requests':result={items:await listRequests(s,u)};break;
      case 'review_request':result=await reviewProfile(s,u,body);break;
      default:fail(400,'지원하지 않는 요청입니다.');
    }
    return response(200,{ok:true,...result});
  }catch(e){return wrapError(e);}
}
