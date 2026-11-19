import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MONTH_OPTIONS,invoiceAmount,normalizeOrderMonths,providerOrderView} from '../netlify/functions/_shared/payment-policy.mjs';
const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
const page=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
test('기간은 정해진 개월 수만 선택',()=>{assert.deepEqual(MONTH_OPTIONS,[1,3,6,12]);assert.equal(normalizeOrderMonths('6'),6);for(const v of [0,2,13,-1,'abc'])assert.throws(()=>normalizeOrderMonths(v));});
test('서버 산정 금액; 클라이언트가 가격을 전달하지 않음',()=>{assert.equal(invoiceAmount(3,210000),630000);assert.throws(()=>invoiceAmount(3,1e12));assert.match(api,/getPrivatePrices\(\)\[f.type\]/);assert.doesNotMatch(app,/facility_create_order[^;]*monthlyPrice:/);});
test('카드결제 허위 연결을 하지 않음',()=>{assert.match(page,/<option value="card" disabled>/);assert.match(api,/b.method!=='manual_transfer'/);assert.match(page,/PG 심사 후/);});
test('기관과 관리자 API를 인증된 경로에서만 제공',()=>{assert.ok(api.indexOf('const u=await authUser')<api.indexOf("case 'facility_create_order'"));assert.match(api,/const f=await getMy\(s,u\),months=normalizeOrderMonths/);assert.match(api,/adminReviewPaymentOrder\(s,u,b\)\{requireAdmin\(u\)/);});
test('수납 확인은 관리자 실제 확인 체크와 참조번호 필요',()=>{assert.match(api,/b.confirmedActualReceipt/);assert.match(api,/reference.length<5/);assert.match(api,/status!==ORDER_PENDING/);});
test('주문 자체로 광고가 자동 게시되지 않음',()=>{const block=api.slice(api.indexOf('async function facilityCreateOrder('),api.indexOf('async function facilityMyOrders('));assert.doesNotMatch(block,/(?:advertisingStatus|'ci_public'|publish\()/);});
test('민감 자료 없는 주문 공개 객체',()=>{const view=providerOrderView({id:'1',facilityId:'F',status:'awaiting_manual_review',paymentReference:'secret'});assert.equal(view.paymentReference,undefined);assert.equal(view.status,'awaiting_manual_review');});
test('기관 요금표가 일반 방문자 HTML에 표시되지 않음',()=>{assert.doesNotMatch(page,/100,000원|150,000원|200,000원|300,000원/);assert.match(page,/data-private-only="facility"/);});

test('Netlify branch deploy 운영 DB 쓰기 차단',()=>{assert.match(api,/process.env.CONTEXT!==\'production\'/); assert.match(api,/!stagingReadActions.has\(action\)/);assert.ok(!api.slice(api.indexOf("const stagingReadActions"),api.indexOf("if(process.env.CONTEXT")).includes("facility_create_order"));});
