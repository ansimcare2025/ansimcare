// Pure business policy; these default quotas are proposals, not observed local facility counts.
export const regions = {
  '광주':['동구','서구','남구','북구','광산구'],
  '전남':['목포시','여수시','순천시','나주시','광양시','담양군','곡성군','구례군','고흥군','보성군','화순군','장흥군','강진군','해남군','영암군','무안군','함평군','영광군','장성군','완도군','진도군','신안군'],
  '전북':['전주시 완산구','전주시 덕진구','군산시','익산시','정읍시','남원시','김제시','완주군','진안군','무주군','장수군','임실군','순창군','고창군','부안군']
};
export const types = ['요양병원','요양원','주야간보호','방문돌봄'];
// Commercial rates are stored only in private Netlify environment variables.
// Never put actual rates in this public GitHub source tree.
export function getPrivatePrices(){
  const raw=process.env.DOLBOM_AD_RATES_JSON;
  if(!raw)throw Object.assign(new Error('광고요금 환경변수 설정 필요'),{statusCode:503});
  let data;
  try{data=JSON.parse(raw);}catch{throw Object.assign(new Error('광고요금 JSON 형식을 확인하세요.'),{statusCode:503});}
  if(!data||typeof data!=='object'||types.some(t=>!Number.isSafeInteger(data[t])||data[t]<0||data[t]>1e8)){
    throw Object.assign(new Error('광고요금이 올바르게 설정되지 않았습니다.'),{statusCode:503});
  }
  return Object.fromEntries(types.map(t=>[t,data[t]]));
}
export function defaultCap(region,district,type){
  const dense=region==='광주'||district.startsWith('전주시 ');
  const city=dense||district.endsWith('시');
  const t=types.indexOf(type);
  return (dense?[4,6,6,8] : city?[3,4,4,6] : [1,2,2,3])[t]||2;
}
export function dateOK(iso){return typeof iso==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(iso)&&!isNaN(Date.parse(iso+'T00:00:00Z'))&&new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso;}
export function todayKST(){return new Date(Date.now()+9*3600*1000).toISOString().slice(0,10);}
export function visible(f,today=todayKST()){
  return !!(f&&f.publicationStatus==='approved'&&f.advertisingStatus==='active'&&f.paymentStatus==='confirmed'&&dateOK(f.contractStart)&&dateOK(f.contractEnd)&&f.contractStart<=today&&f.contractEnd>=today&&types.includes(f.type)&&regions[f.region]?.includes(f.district));
}
