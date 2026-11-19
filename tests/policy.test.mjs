import test from 'node:test';
import assert from 'node:assert/strict';
import {regions,types,getPrivatePrices,defaultCap,dateOK,visible} from '../netlify/functions/_shared/business-rules.mjs';
const live={name:'가상 요양원',type:'요양원',region:'전남',district:'나주시', publicationStatus:'approved',advertisingStatus:'active',paymentStatus:'confirmed',contractStart:'2026-11-01',contractEnd:'2027-01-31'};
test('42 regional advertising zones and 168 type-zone pairs',()=>{
  assert.equal(Object.values(regions).flat().length,42);
  assert.equal(types.length,4);assert.equal(42*types.length,168);
  assert(regions['전북'].includes('전주시 완산구'));
  assert(regions['전북'].includes('전주시 덕진구'));
});
test('private pricing loaded only from environment and rejects missing values',()=>{
  const previous=process.env.DOLBOM_AD_RATES_JSON;
  delete process.env.DOLBOM_AD_RATES_JSON;
  assert.throws(()=>getPrivatePrices(),/환경변수/);
  process.env.DOLBOM_AD_RATES_JSON=JSON.stringify(Object.fromEntries(types.map((t,i)=>[t,(i+1)*17])));
  assert.equal(Object.keys(getPrivatePrices()).length,4);
  if(previous===undefined)delete process.env.DOLBOM_AD_RATES_JSON;
  else process.env.DOLBOM_AD_RATES_JSON=previous;
});
test('all 4 prerequisites are required for paid-only visibility',()=>{
  assert.equal(visible(live,'2026-11-18'),true);
  for(const [key,val] of [['publicationStatus','pending'],['advertisingStatus','suspended'],['paymentStatus','unconfirmed'],['contractStart','2026-12-01'],['contractEnd','2026-11-17'],['region','서울'],['type','기타']]){
    assert.equal(visible({...live,[key]:val},'2026-11-18'),false,key);
  }
});
test('date boundaries are inclusive and invalid dates rejected',()=>{
  assert(visible(live,'2026-11-01'));
  assert(visible(live,'2027-01-31'));
  assert(!visible(live,'2027-02-01'));
  assert(!dateOK('2026-02-30'));assert(dateOK('2028-02-29'));
});
test('proposed cap is valid positive integer for every zone and type',()=>{
  for(const [r,ds] of Object.entries(regions)) for(const d of ds) for(const t of types) assert(Number.isInteger(defaultCap(r,d,t))&&defaultCap(r,d,t)>0);
});
