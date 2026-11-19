import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../site/manifest.webmanifest',import.meta.url),'utf8'));
test('휴대폰 홈 화면용 매니페스트 및 앱 아이콘 연결',()=>{
  assert.match(html,/rel="manifest"/);
  assert.equal(manifest.name,'돌봄지음 호남');
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.icons.length,2);
});
test('앞뒤 이동 화면과 카카오 세션 구분자 유지',()=>{
  assert.match(html,/id="page-forward"/);
  assert.match(html,/id="page-back"/);
  assert.match(app,/careindex-kakao/);
});
