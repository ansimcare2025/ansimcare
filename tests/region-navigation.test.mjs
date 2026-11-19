import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../site/regions.js',import.meta.url),'utf8');
const ctx={window:{addEventListener(){}},document:{readyState:'loading',addEventListener(){}},Option:function(label,value){this.text=label;this.value=value;}};
vm.runInNewContext(code,ctx);
test('광주 5개, 전남 22개, 전북 15개 — 42권역',()=>{
  const r=ctx.window.DJ_REGION_DATA;
  assert.equal(r['광주'].length,5);assert.equal(r['전남'].length,22);assert.equal(r['전북'].length,15);
  assert.equal(Object.values(r).reduce((s,a)=>s+a.length,0),42);
  assert(r['전남'].includes('장성군'));assert(r['전북'].includes('전주시 완산구'));
});
test('전체 검색의 빈 값과 일반 검색의 전체 표기는 구분',()=>{
  const region={value:'전남'},sel={value:'',options:[],replaceChildren(...nodes){this.options=[...nodes];},add(o){this.options.push(o);},setAttribute(){}};
  ctx.document.getElementById=id=>id==='a-filter-region'?region:id==='a-filter-district'?sel:null;
  const choices=ctx.window.DJ_UPDATE_DISTRICT('a-filter-region','a-filter-district');
  assert.equal(choices.length,22);assert.equal(sel.options.length,23);
  assert.equal(sel.options[0].value,'');assert.equal(sel.options.at(-1).value,'신안군');
  assert.equal(sel.disabled,false);
});
test('공개 기관검색의 전체 값은 전체로 유지',()=>{
  const region={value:'전북'},sel={value:'',options:[],replaceChildren(...nodes){this.options=[...nodes];},add(o){this.options.push(o);},setAttribute(){}};
  ctx.document.getElementById=id=>id==='match-region'?region:id==='match-district'?sel:null;
  ctx.window.DJ_UPDATE_DISTRICT('match-region','match-district');
  assert.equal(sel.options.length,16);assert.equal(sel.options[0].value,'전체');
  assert.equal(sel.options[1].value,'전주시 완산구');
});
