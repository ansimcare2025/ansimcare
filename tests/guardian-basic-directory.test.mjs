import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync(new URL('../site/public-directory.json', import.meta.url)));
const html=readFileSync(new URL('../site/index.html', import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js', import.meta.url),'utf8');
test('공공자료 기반 기관명 목록은 개인·계약·연락처를 포함하지 않음',()=>{
  assert.ok(data.items.length>=3700);const keys=['name','type','region','district','asOf'];
  for(const row of data.items){assert.deepEqual(Object.keys(row).sort(),keys.slice().sort());assert.ok(row.name.length);}
});
test('보호자에서 기본 명단과 유료 광고가 구분',()=>{
 assert.match(html,/기본 기관명 목록/);assert.match(html,/유료 광고/);
 assert.match(html,/공공자료 참고/);assert.match(html,/hero-directory-search/);
 assert.match(app,/matchedBasicDirectory/);
 assert.match(app,/renderBasicDirectory/);
});
test('기본명단은 서버의 비공개 내부 기관 문서를 직접 전달하지 않음',()=>{
 const api=readFileSync(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8');
 assert.match(app,/public-directory\.json/);
 assert.doesNotMatch(app,/fetch\(.*ci_facilities/);
 assert.match(api,/collection\('ci_public'\)/);
});
