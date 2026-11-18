import test from 'node:test';
import assert from 'node:assert/strict';
import {regions,types,prices,defaultCap,dateOK,visible} from '../netlify/functions/_shared/business-rules.mjs';
const live={name:'가상 요양원',type:'요양원',region:'전남',district:'나주시', publicationStatus:'approved',advertisingStatus:'active',paymentStatus:'confirmed',contractStart:'2026-11-01',contractEnd:'2027-01-31'};
test('42 regional advertising zones and 168 type-zone pairs',()=>{
  assert.equal(Object.values(regions).flat().length,42);
  assert.equal(types.length,4);assert.equal(42*types.length,168);
  assert(regions['전북'].includes('전주시 완산구'));
  assert(regions['전북'].includes('전주시 덕진구'));
});
test('pricing matches approved business model',()=>{
  assert.deepEqual(prices,{'요양병원':300000,'요양원':200000,'주야간보호':150000,'방문돌봄':100000});
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
