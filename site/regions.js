/* 돌봄지음 호남 v2.8.4 · 광주/전남/전북 42개 시군구 안정화.
 * Firebase 로그인이나 API 장애와 독립적으로 드롭다운을 갱신합니다. */
(function(){
  'use strict';
  const REGION=Object.freeze({"광주":["동구","서구","남구","북구","광산구"],"전남":["목포시","여수시","순천시","나주시","광양시","담양군","곡성군","구례군","고흥군","보성군","화순군","장흥군","강진군","해남군","영암군","무안군","함평군","영광군","장성군","완도군","진도군","신안군"],"전북":["전주시 완산구","전주시 덕진구","군산시","익산시","정읍시","남원시","김제시","완주군","진안군","무주군","장수군","임실군","순창군","고창군","부안군"]});
  const pairs=[
    ['match-region','match-district','전체'],
    ['elder-region','elder-district','전체'],
    ['quota-region','quota-district','전체'],
    ['f-region','f-district','전체'],
    ['a-region','a-district','전체'],
    ['a-q-region','a-q-district','전체'],
    ['a-filter-region','a-filter-district','']
  ];
  function update(regionId,districtId,preferred){
    const r=document.getElementById(regionId), d=document.getElementById(districtId);
    if(!r||!d)return [];
    const items=REGION[r.value]||[], all=districtId==='a-filter-district'?'':'전체';
    const old=preferred===undefined?d.value:preferred;
    d.replaceChildren(new Option('전체 시·군·구',all));
    for(const name of items)d.add(new Option(name,name));
    d.value=items.includes(old)?old:all;
    // 전체 시·도 검색에서는 전체 구 선택을 그대로 쓸 수 있습니다.
    d.disabled=items.length===0;
    d.setAttribute('aria-label',items.length?`시·군·구 ${items.length}개 선택 가능`:'시·도를 먼저 선택하세요');
    return items;
  }
  function initialize(){
    for(const [r,d] of pairs){
      const region=document.getElementById(r);
      if(!region||region.dataset.dolbomDistrictBound)continue;
      region.dataset.dolbomDistrictBound='1';
      region.addEventListener('change',()=>update(r,d));
      update(r,d);
    }
  }
  window.DJ_REGION_DATA=REGION;
  window.DJ_UPDATE_DISTRICT=update;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
  window.addEventListener('pageshow',initialize);
})();
