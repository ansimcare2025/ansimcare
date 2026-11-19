import test from 'node:test';import assert from 'node:assert/strict';
import {DOMAINS,SUPPORTED_TYPES,addMonths,checkSelf,checkReview,publicReview} from '../netlify/functions/_shared/assessment-policy.mjs';
import {ASSESSMENT_DOMAINS} from '../site/assessment-standards.js';
test('보호자 기준과 서버 심사 항목 일치 (8개 기관 영역 + 별도 보호자 인식)',()=>{assert.equal(DOMAINS.length,8);assert.deepEqual(DOMAINS.map(x=>x.id),ASSESSMENT_DOMAINS.map(x=>x[0]));assert.deepEqual(SUPPORTED_TYPES,['요양병원','요양원']);});
test('6개월과 12개월 권장 점검일; 윤년과 말일',()=>{assert.equal(addMonths('2026-08-31',6),'2027-02-28');assert.equal(addMonths('2024-02-29',12),'2025-02-28');assert.equal(addMonths('2026-11-19',6),'2027-05-19');});
test('빠진 자체점검 영역·불법 상태 차단',()=>{assert.throws(()=>checkSelf({}),/선택/);let r=Object.fromEntries(DOMAINS.map(x=>[x.id,'양호']));assert.equal(Object.keys(checkSelf(r)).length,8);r.dignity='위험없음';assert.throws(()=>checkSelf(r),/선택/);});
test('기관 자체보고만으로 독립 확인 표시 금지',()=>{const rows=Object.fromEntries(DOMAINS.map(x=>[x.id,{source:'기관보고',finding:'미확인'}]));rows.dignity={source:'기관보고',finding:'확인'};assert.throws(()=>checkReview(rows),/기관 자체보고만/);});
test('미확인을 확인으로 바꿀 수 없고 현장 확인에는 근거 필수',()=>{const rows=Object.fromEntries(DOMAINS.map(x=>[x.id,{source:'미확인',finding:'미확인'}]));rows.dignity={source:'미확인',finding:'확인'};assert.throws(()=>checkReview(rows),/미확인/);rows.dignity={source:'현장',finding:'확인',note:''};assert.throws(()=>checkReview(rows),/근거/);rows.dignity.note='방문 점검표';assert.equal(checkReview(rows).dignity.source,'현장');assert.equal(publicReview(checkReview(rows)).dignity.note,undefined);});
