const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {normalizeAnomalousTable,interpolateAnomalous,loadScatteringTables}=require('../js/scatterers.js');
const HC=12398.419843320025;
const bundled=JSON.parse(fs.readFileSync(path.join(__dirname,'../scatters/anomalous_chantler.json'),'utf8'));
test('the copied Chantler table has finite corrections for all 92 elements',()=>{
  const table=normalizeAnomalousTable(bundled);assert.equal(table.size,92);
  for(const [el,item] of table){
    const at=interpolateAnomalous(table,el,HC/item.rows[300][0]);
    assert.ok(at.every(Number.isFinite),el);assert.ok(at[1]>=0,el);
  }
  const fe=interpolateAnomalous(table,'Fe',1.540598);
  assert.ok(fe[0]>-1.3 && fe[0]<-1.1 && fe[1]>3.1 && fe[1]<3.3);
});
test('linear energy interpolation preserves signed f-prime, endpoints and post-edge exact values',()=>{
  const table=normalizeAnomalousTable({Fe:{source:'fixture',table:[[100,-2,1],[200,-4,3],[200,-6,7],[300,2,9]]}});
  assert.deepEqual(interpolateAnomalous(table,'Fe',HC/100),[-2,1]);
  assert.deepEqual(interpolateAnomalous(table,'FE',HC/150),[-3,2]);
  assert.deepEqual(interpolateAnomalous(table,'fe',HC/200),[-6,7]);
  assert.deepEqual(interpolateAnomalous(table,'Fe',HC/250),[-2,8]);
  assert.deepEqual(interpolateAnomalous(table,'Fe',HC/300),[2,9]);
});
test('invalid tables, missing elements and out-of-range energies never fabricate corrections',()=>{
  for(const rows of [[[100,NaN,1],[200,0,2]],[[100,0,-1],[200,0,2]],[[200,0,1],[100,0,2]]])assert.throws(()=>normalizeAnomalousTable({Fe:{table:rows}}),/invalid/);
  const table=normalizeAnomalousTable(bundled);
  for(const wavelength of [0,-1,NaN,Infinity,HC/1,HC/200000])assert.throws(()=>interpolateAnomalous(table,'Fe',wavelength),/range/);
  assert.throws(()=>interpolateAnomalous(table,'Am',1.54),/No anomalous/);
  assert.deepEqual(interpolateAnomalous(table,'D',1.54),interpolateAnomalous(table,'H',1.54));
});
test('the scattering loader fetches the bundled anomalous file and reports a missing copy',async()=>{
  const previous=global.fetch,seen=[];
  try{
    global.fetch=async url=>{seen.push(url);return {ok:true,json:async()=>url.endsWith('index.json')?{preferred:'normal.json',anomalous:'anomalous.json',files:[]}:url.endsWith('anomalous.json')?bundled:{table:{}}};};
    const result=await loadScatteringTables('fixture');assert.equal(result.anomalous.Fe.source,'Chantler');assert.ok(seen.includes('fixture/anomalous.json'));
    global.fetch=async url=>url.endsWith('anomalous.json')?{ok:false,status:404}:{ok:true,json:async()=>url.endsWith('index.json')?{preferred:'normal.json',anomalous:'anomalous.json',files:[]}:{table:{}}};
    const missing=await loadScatteringTables('fixture');assert.equal(missing.anomalous,null);assert.match(missing.anomalousError,/anomalous.json: 404/);assert.ok(missing.xray.table);
  }finally{global.fetch=previous;}
});
