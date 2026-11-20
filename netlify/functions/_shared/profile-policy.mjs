// 기관 담당자 제안은 최종 게시물이 아닙니다. 변경 필드만 서버가 선별합니다.
export const PROFILE_FIELDS=Object.freeze(['name','type','region','district','phone','address','description','homepage']);
export const PROFILE_LABELS=Object.freeze({name:'기관명',type:'기관 유형',region:'시·도',district:'시·군·구',phone:'대표전화',address:'주소',description:'기관 소개',homepage:'공식 홈페이지'});
const value=v=>String(v??'');
export function proposeProfileChanges(current,validated){
  const changes={};const baseValues={};
  for(const k of PROFILE_FIELDS){
    if(value(validated[k])!==value(current[k])){
      changes[k]=validated[k];baseValues[k]=value(current[k]);
    }
  }
  return {changes,baseValues,changedFields:Object.keys(changes)};
}
export function reviewProfileChanges(current,request){
  const isDelta=request?.schemaVersion==='2.9.3';
  const submitted=request?.payload||{};
  const accepted={};
  for(const k of PROFILE_FIELDS){
    if(Object.prototype.hasOwnProperty.call(submitted,k)){
      if(isDelta && (!Object.prototype.hasOwnProperty.call(request.baseValues||{},k)||value(current[k])!==value(request.baseValues[k])))
        throw Object.assign(new Error('다른 변경으로 기존 기관정보가 달라졌습니다. 새 자료를 요청하세요.'),{statusCode:409});
      accepted[k]=submitted[k];
    }
  }
  // 제공기관이 원래 DB의 공식 식별번호·자료 출처·관리 상태를 임의로 변경할 수 없습니다.
  return accepted;
}
