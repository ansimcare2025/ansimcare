import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveKakaoRedirect} from '../netlify/functions/_shared/kakao-origin.mjs';
const text=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('test Firebase config only',()=>{
  const config=text('site/config.js');
  assert.match(config,/projectId: 'dolbomjieum-test'/);
  assert.doesNotMatch(config,/ansimcare-9bae3/);
});
test('server is fail closed for any production firebase service account',()=>{
  const core=text('netlify/functions/_shared/core.mjs');
  assert.match(core,/CI_DEPLOY_KIND!=='auth-test'/);
  assert.match(core,/parsed.project_id!=='dolbomjieum-test'/);
});
test('new Netlify production context cannot write without explicit enable',()=>{
  const api=text('netlify/functions/api.mjs');
  assert.match(api,/CI_TEST_WRITES==='enabled'/);
  assert.match(api,/CI_FIREBASE_PROJECT_ID==='dolbomjieum-test'/);
});
test('Kakao redirect matches only dedicated test origin',()=>{
  const redirect='https://example-test.netlify.app/.netlify/functions/kakao-callback';
  assert.equal(resolveKakaoRedirect('example-test.netlify.app',redirect),redirect);
  assert.throws(()=>resolveKakaoRedirect('careindex-honam.netlify.app',redirect));
  assert.throws(()=>resolveKakaoRedirect('example-test.netlify.app','http://example-test.netlify.app/.netlify/functions/kakao-callback'));
});
