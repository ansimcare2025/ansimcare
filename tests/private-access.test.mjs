import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
test('no monthly advertising prices shipped in public html',()=>{
  for(const v of ['월 100,000원','월 150,000원','월 200,000원','월 300,000원'])assert(!html.includes(v));
});
test('advertising plans hidden by default and guarded in navigation',()=>{
  assert.match(html, /data-page="plans"[^>]*hidden/);
  assert.match(app,/page==='plans'&&!\['facility','admin'\].includes\(session.role\)/);
});
test('public quota route removed; price fetch requires authentication',()=>{
  assert(!api.includes("action==='public_quota'"));
  assert(!api.includes('async function publicQuota('));
  assert.match(api,/case 'private_quota'/);
  assert.match(api,/async function privateQuota\(s,u,q\)/);
  assert.match(api,/u.role==='facility'/);
});
test('brand display updated while authentication route remains compatible',()=>{
  assert(html.includes('돌봄지음 호남'));
  assert(app.includes('careindex-kakao'));
});

test('commercial fees are not hard-coded into public git sources',()=>{
  const rules=readFileSync(new URL('../netlify/functions/_shared/business-rules.mjs',import.meta.url),'utf8');
  assert.match(rules,/DOLBOM_AD_RATES_JSON/);
  assert(!rules.includes('300000'));
});
