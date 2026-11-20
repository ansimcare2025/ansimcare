import test from 'node:test';
import assert from 'node:assert/strict';
import {adminSearchParams,adminMatchesFacility,adminPageResult} from '../netlify/functions/_shared/admin-search.mjs';
const row={id:'IMP-A1',name:'광주 사랑 요양원',officialId:'8881',region:'광주',district:'광산구',type:'요양원',address:'광주광역시 광산구',phone:'062-000-0110',source:'공단 원본'};
test('global admin search accepts Korean substrings, official code, phone and private rows',()=>{
  for(const word of ['광주','사랑','8881','광산구','062-000','공단','IMP-A1'])assert(adminMatchesFacility(row,{query:word.toLocaleLowerCase('ko')}));
  assert(!adminMatchesFacility(row,{query:'순천'}));
});
test('admin filters by region,district,type without affecting public listing',()=>{
  assert(adminMatchesFacility(row,{region:'광주',district:'광산구',type:'요양원'}));
  assert(!adminMatchesFacility(row,{region:'전남'}));
  assert(!adminMatchesFacility(row,{type:'요양병원'}));
});
test('page sizes validated and scanning cursor retained',()=>{
  assert.equal(adminSearchParams({pageSize:100}).pageSize,100);
  assert.throws(()=>adminSearchParams({pageSize:201}),/페이지 크기/);
  const page=adminPageResult({items:[row],after:'IMP-A1',scanned:500,limitReached:false,exhausted:false});
  assert.equal(page.next,'IMP-A1');
  assert.equal(adminPageResult({items:[],after:'IMP-A1',scanned:200,limitReached:false,exhausted:true}).next,'');
});

test('admin search accepts natural spacing and region/type tokens',()=>{
  const n={name:'나주고운정요양원',region:'전남',district:'나주시',type:'요양원'};
  for(const q of ['고운정 요양원','나주 요양원','나주고운정요양원','고운정  요양원'])
    assert(adminMatchesFacility(n,{query:q}),q);
  assert(!adminMatchesFacility(n,{query:'나주 요양병원'}));
  assert(!adminMatchesFacility(n,{query:'순천 요양원'}));
});
