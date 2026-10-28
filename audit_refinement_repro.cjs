// Standalone review reproductions. Run: node audit_refinement_repro.cjs
const assert = require('node:assert/strict');
const fm = require('./js/fourier_map.js');
const ar = require('./js/atom_restraints.js');
const identity = { r: [1,0,0,0,1,0,0,0,1], t: [0,0,0] };
const opts = {
  cell: { a:5,b:5,c:5,alpha:90,beta:90,gamma:90 }, ops:[identity],
  atoms:[{label:'A',pos:[0,0,0],occ:1,B:0,ff:{}}],
  formFactor:()=>1, radiation:'xray', type:'diff', dmin:2, minSigma:1,
  refl:[
    {h:1,k:0,l:0,m:2,lp:1,area:2,inRange:true,group:-1},
    {h:0,k:1,l:0,m:2,lp:1,area:18,inRange:true,group:-1}
  ]
};
function delta(a,b) {
  let d=0; for(let i=0;i<a.map.length;i++)d=Math.max(d,Math.abs(a.map[i]-b.map[i]));
  return d;
}
const original=fm.build(opts);
opts.refl[0].area=18; opts.refl[1].area=2;
const swapped=fm.build(opts), collisionDelta=delta(original,swapped);
opts.refl.forEach(r=>delete r.group);
const independent=fm.build(opts);
opts.refl[0].area=2; opts.refl[1].area=18;
const independentSwap=fm.build(opts), independentDelta=delta(independent,independentSwap);
assert.ok(collisionDelta>0.02);
assert.ok(independentDelta>0.02);
assert.equal(collisionDelta,independentDelta);
console.log('Fourier maps:', {collisionDelta,independentDelta,
  collisionSigma:original.sigma,independentSigma:independent.sigma});

const phase={key:'p1',method:'rietveld',atoms:[{label:'A',site:{}},{label:'B',site:{}}],
  ops:[identity],restraints:{text:'A B - 1/2',weight:1,sigmaD:1}};
const values={'p1.A.x':0,'p1.A.y':0,'p1.A.z':0,'p1.B.x':.3,'p1.B.y':0,'p1.B.z':0};
const ctx={cellOf:()=>({a:10,b:10,c:10,alpha:90,beta:90,gamma:90}),sitePosition:(site,u)=>u};
const counts=[];
for(const holders of [1,3]) {
  const v=Array.from({length:holders},()=>({...values}));
  const restraints=ar.prepare({phases:[phase],datasets:v.map(()=>({phases:['p1']})),values:v},ctx);
  const cost=restraints.cost(v), count=restraints.count(v);
  assert.ok(Math.abs(cost-1)<1e-12); assert.equal(count,1);
  counts.push({holders,cost,countUsedInDof:count});
}
console.log('Identical shared-geometry restraint copies:',counts);
console.log('Shared copies contribute once to both cost and degrees of freedom.');
