// Authoritative checks for protected areas. Client-side hiding is only UX.
export function adminUidAllowed(uid, roster) {
  if(typeof uid!=='string'||!uid||typeof roster!=='string')return false;
  return roster.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean).includes(uid);
}
export function belongsToFacility(user,facility){
  return Boolean(user?.role==='facility' && user?.uid && user?.facilityId &&
    user.facilityId===facility?.id && Array.isArray(facility.managerUids) &&
    facility.managerUids.includes(user.uid) && facility.accessSuspended!==true);
}
export function cleanAccessApplication(data,{regions,types}) {
  const trim=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
  const facilityName=trim(data.facilityName,100),applicantName=trim(data.applicantName,50),
    region=trim(data.region,15),district=trim(data.district,35),type=trim(data.type,25),
    contactPhone=trim(data.contactPhone,30);
  if(facilityName.length<2||applicantName.length<2)throw new Error('기관명과 담당자 실명을 입력하세요.');
  if(!regions[region]?.includes(district)||!types.includes(type))throw new Error('기관 소재 지역과 유형을 정확히 선택하세요.');
  if(!/^[+0-9()\s-]{8,30}$/.test(contactPhone)||contactPhone.replace(/\D/g,'').length<8)throw new Error('연락 가능한 업무 전화번호를 입력하세요.');
  if(data.consent!==true)throw new Error('담당자 권한 확인과 신청정보 수집에 동의해야 합니다.');
  return {facilityName,applicantName,region,district,type,contactPhone};
}
