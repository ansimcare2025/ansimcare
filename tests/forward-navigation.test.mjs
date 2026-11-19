import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve(import.meta.dirname,'..');
const js=fs.readFileSync(path.join(root,'site/app.js'),'utf8');
const start=js.indexOf('// 동일한 웹앱의 PC 및 모바일에서 공통으로 사용하는 방문기록입니다.');
const end=js.indexOf("document.addEventListener('click',e=>{const b=e.target.closest",start);
assert.ok(start>=0&&end>start,'앱 네비게이션 코드가 있어야 합니다');
const navigationCode=js.slice(start,end);

function makeApp(){
 const handlers={}; const pageNames=['home','match','elder','observe','standards','plans','facility','admin','criteria'];
 const pageEls=pageNames.map(p=>({id:'page-'+p,classList:{active:p==='home',toggle(name,on){if(name==='active')this.active=on}}}));
 const navEls=pageNames.map(p=>({dataset:{page:p},classList:{toggle(name,on){if(name==='active')this.active=on}}}));
 const controls={
  'page-back':{disabled:true,addEventListener(name,fn){this[name]=fn}},
  'page-forward':{disabled:true,addEventListener(name,fn){this[name]=fn}}
 };
 const browserHistory=[{state:null}];let historyPos=0;
 const history={
  get state(){return browserHistory[historyPos].state},
  replaceState(state){browserHistory[historyPos]={state}},
  pushState(state){browserHistory.splice(historyPos+1);browserHistory.push({state});historyPos++},
  back(){if(historyPos>0){historyPos--;handlers.popstate?.({state:this.state})}},
  forward(){if(historyPos<browserHistory.length-1){historyPos++;handlers.popstate?.({state:this.state})}}
 };
 const messages={};const loginCalls=[];
 const context={
  Date,Math,history,location:{href:'https://example.org/',pathname:'/',search:''},
  window:{addEventListener(event,fn){handlers[event]=fn},scrollTo(){}},
  document:{querySelectorAll(sel){if(sel==='.page')return pageEls;if(sel==='[data-page]')return navEls;return []}},
  $:id=>controls[id],setMessage:(id,value)=>{messages[id]=value},
  TITLES:Object.fromEntries(pageNames.map(k=>[k,k])),
  session:{role:'guardian'},nextPage:null,openAuth:(role)=>loginCalls.push(role),
  loadPublic:()=>{},loadMine:()=>{},loadAdmin:()=>{},loadAssessments:()=>{},loadPrivatePlans:()=>{}
 };
 vm.createContext(context);vm.runInContext(navigationCode,context);
 const active=()=>pageEls.find(e=>e.classList.active)?.id;
 return {context,controls,history,active,messages,loginCalls};
}

test('PC/휴대폰 공용 뒤로·앞으로 이동: 홈 → 검색 → 관찰 → 뒤로 → 앞으로',()=>{
 const app=makeApp();
 assert.equal(app.active(),'page-home');
 assert.equal(app.controls['page-back'].disabled,true);
 assert.equal(app.controls['page-forward'].disabled,true);
 app.context.navigate('match');app.context.navigate('observe');
 assert.equal(app.controls['page-back'].disabled,false);
 app.controls['page-back'].click();
 assert.equal(app.active(),'page-match');
 assert.equal(app.controls['page-forward'].disabled,false);
 app.controls['page-forward'].click();
 assert.equal(app.active(),'page-observe');
 assert.equal(app.controls['page-forward'].disabled,true);
});
test('뒤로 간 뒤 새 메뉴를 누르면 앞으로 기록 초기화',()=>{
 const app=makeApp();
 app.context.navigate('match');app.context.navigate('observe');
 app.controls['page-back'].click();
 app.context.navigate('elder');
 assert.equal(app.active(),'page-elder');
 assert.equal(app.controls['page-forward'].disabled,true);
 app.history.forward();
 assert.equal(app.active(),'page-elder');
});
test('관리자 페이지는 로그인 전 자동 탐색 불가',()=>{
 const app=makeApp();
 app.context.navigate('admin');
 assert.equal(app.active(),'page-home');
 assert.equal(app.controls['page-back'].disabled,true);
 assert.deepEqual(app.loginCalls,['admin']);
});
