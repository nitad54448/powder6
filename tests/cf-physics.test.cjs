const assert=require('node:assert/strict');
const test=require('node:test');
const cf=require('../js/charge_flipping_worker.js');
globalThis.postMessage=()=>{};
const identity={r:[1,0,0,0,1,0,0,0,1],t:[0,0,0]};
const inversion=t=>({r:[-1,0,0,0,-1,0,0,0,-1],t});
function job(symops=[identity,inversion([0,0,0])]){return {gridSize:16,maxIterations:1,thresholdSigma:1.1,seed:543,cell:{a:5,b:5,c:5,alpha:90,beta:90,gamma:90},symops,symLambda:.5,weakFraction:.25,weakGrouping:'individual',overlapTolTth:.001,applyLP:false,minPeakSeparation:.5,maxPeaks:20,peakHeightCutoff:.04,hklList:Array.from({length:8},(_,i)=>({h_orig:i%3+1,k_orig:Math.floor(i/3),l_orig:1,intensity:(i+1)*10,tth:10+i}))};}
for(const t of [[0,0,0],[.5,.25,0]])test('centric starts have the measured amplitudes and a real map, inversion translation '+t,()=>{
  const j=job([identity,inversion(t)]),m=cf.buildReflectionModel(j,16),init=cf.modelInitialGrid(m,16,j.seed);
  for(let g=0;g<m.nOrbits;g++)for(let p=m.orbitStart[g];p<m.orbitStart[g]+m.orbitCount[g];p++){
    const i=m.orbitIdx[p]&0x7fffffff,expected=m.orbitTargetI[g]/m.orbitCount[g];
    assert.ok(Math.abs(init[2*i]**2+init[2*i+1]**2-expected)<1e-6*expected);
  }
  const re=Float64Array.from({length:16**3},(_,i)=>init[2*i]),im=Float64Array.from({length:16**3},(_,i)=>init[2*i+1]);
  cf.fft3d(re,im,16,true);
  assert.ok(im.reduce((s,v)=>s+v*v,0)<1e-12*re.reduce((s,v)=>s+v*v,0),'initial density has an imaginary component');
});
test('all 230 standard space-group settings initialize a real density',()=>{
  const groups=require('../sg/all.json').space_groups,hklList=[];
  for(let h=0;h<3;h++)for(let k=-2;k<=2;k++)for(let l=-2;l<=2;l++)if(h||k||l)hklList.push({h_orig:h,k_orig:k,l_orig:l,intensity:100+2*h+k+l,tth:hklList.length+1});
  let count=0;
  for(const group of Object.values(groups)){
    const model=cf.buildReflectionModel({symops:group.settings[0].sym_ops,applyLP:false,overlapTolTth:1e-8,hklList},8);
    assert.equal(model.error,undefined,group.standard_symbol);
    const init=cf.modelInitialGrid(model,8,43),re=Float64Array.from({length:512},(_,i)=>init[2*i]),im=Float64Array.from({length:512},(_,i)=>init[2*i+1]);
    cf.fft3d(re,im,8,true);
    assert.ok(im.reduce((s,v)=>s+v*v,0)<1e-12*re.reduce((s,v)=>s+v*v,0),group.standard_symbol+' has imaginary density');count++;
  }
  assert.equal(count,230);
});
test('a weak centrosymmetric Friedel pair survives the actual CPU quarter-turn and map readback',()=>{
  const j=job(),m=cf.buildReflectionModel(j,16),out=cf.runChargeFlippingCPU(j),re=Float64Array.from(out.map),im=new Float64Array(re.length);
  cf.fft3d(re,im,16,false);assert.equal(out.weakOrbits,2);
  for(let g=0;g<2;g++){let energy=0;for(let p=m.orbitStart[g];p<m.orbitStart[g]+m.orbitCount[g];p++){const i=m.orbitIdx[p]&0x7fffffff;energy+=re[i]**2+im[i]**2;}assert.ok(energy>1e-6,'weak orbit '+g+' was discarded');}
});
test('a cubic map retains all independent sites before applying its site limit',async()=>{
  const N=64,cell={a:40,b:40,c:40,alpha:90,beta:90,gamma:90},perms=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]],ops=[];
  for(const p of perms)for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const r=Array(9).fill(0);r[p[0]]=x;r[3+p[1]]=y;r[6+p[2]]=z;ops.push({r,t:[0,0,0]});}
  const map=new Float32Array(N**3),positions=[[8,16,24],[5,13,21],[11,19,27]].map(p=>p.map(v=>v/N));
  for(let i=0;i<positions.length;i++)for(const op of ops){const q=cf.applyOp(op,positions[i]).map(v=>Math.round(((v%1+1)%1)*N)%N);map[q[0]+N*q[1]+N*N*q[2]]=1-i*.3;}
  const st=await cf.buildStructure({map,gridSize:N,symops:ops,cell,minPeakSeparation:.3,maxPeaks:3,peakHeightCutoff:.04,originCandidates:1});
  assert.equal(st.error,undefined);assert.equal(st.rawPeakCount,144);assert.equal(st.sites.length,3);
  assert.ok(st.sites.every(s=>s.observedImages===48 && s.multiplicity===48));
});
