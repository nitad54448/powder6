const test=require('node:test');
const assert=require('node:assert/strict');
const {buildIsosurface}=require('../js/density3d.js')._internals;
test('periodic density has surfaces at every equivalent cell edge',()=>{
 const N=24,map=new Float32Array(N**3);
 for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  const dx=Math.min(x,N-x)/N,dy=Math.min(y,N-y)/N,dz=z/N-.5;
  map[x+N*(y+N*z)]=Math.exp(-(dx*dx+dy*dy+dz*dz)/.008);
 }
 const {mesh,scale}=buildIsosurface(map,N,.3,1);
 for(const x of [0,1])for(const y of [0,1]){
  const found=Array.from(mesh.indices).some(i=>Math.abs(mesh.positions[3*i]*scale-x)<.13 && Math.abs(mesh.positions[3*i+1]*scale-y)<.13 && Math.abs(mesh.positions[3*i+2]*scale-.5)<.13);
  assert.ok(found,`surface near ${x}, ${y}, 0.5`);
 }
});
