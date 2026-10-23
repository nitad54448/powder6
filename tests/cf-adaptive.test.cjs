const assert=require('node:assert/strict');
const test=require('node:test');
const adaptive=require('../js/cf_adaptive.js');
const cf=require('../js/charge_flipping_worker.js');
globalThis.postMessage=()=>{};
const identity={r:[1,0,0,0,1,0,0,0,1],t:[0,0,0]};
function data(sigma=2,width=.1){return {covarianceOK:true,det:Array.from({length:18},(_,i)=>({h:i+1,k:0,l:0,tth:10+i*.5,d:3/(1+i*.2),area:100-i*2,sigma,fwhm:width}))};}

test('quality diagnostics respond to uncertainty without changing measured intensities',()=>{
  const clean=data(),noisy=data(100),before=JSON.stringify(noisy);
  const a=adaptive.assess(clean),b=adaptive.assess(noisy);
  assert.ok(a.quality.medianISigma>b.quality.medianISigma);
  assert.equal(a.quality.lowSignal,false);assert.equal(b.quality.lowSignal,true);
  assert.equal(JSON.stringify(noisy),before);assert.equal(a.rows.length,b.rows.length);
  const pa=adaptive.plan(a,9,true),pb=adaptive.plan(b,9,true);
  assert.notDeepEqual(pa.settings,pb.settings);
  assert.equal(pa.trials.length,9);assert.equal(pb.trials.length,9);
});
test('conditional and missing uncertainties remain unknown rather than becoming good data',()=>{
  const I=data();I.covarianceOK=false;
  assert.equal(adaptive.assess(I).quality.uncertaintiesReliable,false);
  I.covarianceOK=true;I.det.forEach(r=>r.sigma=null);
  const a=adaptive.assess(I);assert.equal(a.quality.medianISigma,null);assert.equal(a.quality.uncertaintiesReliable,false);
  assert.ok(adaptive.plan(a,6,true).difficult);
});
test('exact-overlap partitions do not masquerade as independent high-signal measurements',()=>{
  const I=data();I.det.forEach(r=>r.group=0);
  const assessed=adaptive.assess(I);assert.equal(assessed.quality.uncertaintiesReliable,false);assert.equal(assessed.quality.medianISigma,null);assert.equal(assessed.rows.length,I.det.length);
  assert.equal(assessed.quality.resolvedCount,0);
});
test('fitted peak widths change overlap grouping with angle; missing widths use an explicit fallback',()=>{
  const narrow=adaptive.assess(data(2,.1)),broad=adaptive.assess(data(2,1.2));
  assert.ok(broad.quality.clusters<narrow.quality.clusters);
  assert.ok(broad.quality.heavyOverlap);
  assert.equal(adaptive.overlap({tth:10,fwhm:.1},{tth:10.08,fwhm:.1},{overlapFwhmFraction:.5,overlapTolTth:.01}),false);
  assert.equal(adaptive.overlap({tth:10,fwhm:.2},{tth:10.08,fwhm:.2},{overlapFwhmFraction:.5,overlapTolTth:.01}),true);
  assert.equal(adaptive.overlap({tth:10},{tth:10.08},{overlapFwhmFraction:.5,overlapTolTth:.1}),true);
});
test('resolution shells and nonpositive intensities are diagnostic and do not impose a cutoff',()=>{
  const I=data();I.det[0].area=-2;I.det[1].area=0;I.det[1].bound=true;
  const a=adaptive.assess(I);assert.equal(a.quality.nonpositive,2);assert.equal(a.rows.length,I.det.length);
  assert.equal(a.quality.shells.reduce((s,r)=>s+r.count,0),I.det.length);
  I.det.forEach(r=>r.d*=4);
  assert.equal(adaptive.assess(I).quality.limitedResolution,true);
});
test('a weak high-resolution shell changes the plan even when the overall signal remains strong',()=>{
  const I=data(),baseline=adaptive.assess(I);
  I.det.forEach(r=>{if(1/(r.d*r.d)>1.45)r.sigma=100;});
  const assessed=adaptive.assess(I);assert.ok(assessed.quality.medianISigma>=3);assert.equal(assessed.quality.weakHighAngleData,true);
  assert.notDeepEqual(adaptive.plan(assessed,6,true).settings,adaptive.plan(baseline,6,true).settings);
});
test('search plans repeat seeds across settings within a strict, bounded start budget',()=>{
  const a=adaptive.assess(data());
  for(const n of [6,9,12,13,64,128]){const p=adaptive.plan(a,n,true);assert.equal(p.settings.reduce((s,c)=>s+c.starts,0),n);assert.ok(p.settings.every(c=>c.starts>=2));assert.deepEqual(p.trials.slice(0,3).map(c=>c.seedSlot),[0,0,0]);assert.deepEqual(p.trials.slice(3,6).map(c=>c.seedSlot),[1,1,1]);}
  for(const n of [0,3,5,6.5,129,1e6,NaN])assert.throws(()=>adaptive.plan(a,n,true),/6–128/);
  assert.ok(adaptive.plan(a,6,false).trials.every(c=>c.symLambda===0));
});
function pattern(seed,N=8){let s=seed;return Float64Array.from({length:N**3},()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;});}
function transform(a,N,hand,delta){const b=new Float64Array(a.length);for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){const q=[x,y,z].map((v,k)=>(hand*v+delta[k]+N*4)%N);b[q[0]+N*(q[1]+N*q[2])]=3*a[x+N*(y+N*z)]+7;}return b;}
test('map agreement accounts for periodic origin shifts, inversion, density scale and offset',()=>{
  const a=pattern(42),before=Array.from(a);
  for(const hand of [1,-1]){const b=transform(a,8,hand,[2,3,1]),r=cf.compareCFMaps(a,b,8);assert.ok(Math.abs(r.correlation-1)<1e-10);assert.equal(r.hand,hand);}
  assert.deepEqual(Array.from(a),before);
  assert.ok(cf.compareCFMaps(a,pattern(99),8).correlation<.5);
  assert.equal(cf.compareCFMaps(new Float32Array(512),a,8).correlation,null);
  assert.throws(()=>cf.compareCFMaps(a,a,9),/grid/);
});
function job(){return {gridSize:8,maxIterations:24,thresholdSigma:1.1,seed:543,cell:{a:5,b:5,c:5,alpha:90,beta:90,gamma:90},symops:[identity],laueClass:'-1',symLambda:0,weakFraction:.15,weakGrouping:'cluster',overlapTolTth:.01,overlapFwhmFraction:.5,minPeakSeparation:.5,maxPeaks:10,peakHeightCutoff:.04,applyLP:false,
  hklList:[{h_orig:1,k_orig:0,l_orig:0,intensity:100,tth:10,d:5,fwhm:.2},{h_orig:0,k_orig:1,l_orig:0,intensity:80,tth:10.08,d:4.9,fwhm:.2},{h_orig:0,k_orig:0,l_orig:1,intensity:60,tth:20,d:3,fwhm:.1},{h_orig:1,k_orig:1,l_orig:0,intensity:30,tth:30,d:2,fwhm:.1}]};}
test('the actual CF reflection model and CPU search consume the adapted groups',()=>{
  const j=job(),model=cf.buildReflectionModel(j,8);
  assert.equal(model.nClusters,3);
  assert.equal(cf.buildReflectionModel({...j,overlapFwhmFraction:0},8).nClusters,4);
  const result=cf.runChargeFlippingCPU(j);assert.ok(Number.isFinite(result.bestR));assert.equal(result.map.length,512);
  const repeat=cf.runChargeFlippingCPU(j);assert.deepEqual(Array.from(result.map),Array.from(repeat.map));
  assert.ok(cf.compareCFMaps(result.map,repeat.map,8).correlation>1-1e-10);
});
test('P1 CF keeps its arbitrary origin when extracting sites from a nonempty map',async()=>{
  const j=job(),result=cf.runChargeFlippingCPU(j);
  const structure=await cf.buildStructure({map:result.map,gridSize:8,symops:[identity],cell:j.cell,minPeakSeparation:.5,maxPeaks:10,peakHeightCutoff:.04});
  assert.equal(structure.error,undefined);assert.deepEqual(structure.originShift,[0,0,0]);
  assert.ok(structure.sites.length>0);assert.ok(structure.symmetryCorrelation>.999);
});
