const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const context=vm.createContext({console});
vm.runInContext(read('js/wyckoff_limits.js'),context);
vm.runInContext(read('js/swarm_wyckoff.js'),context);
const shader=read('swarm_reflection.wgsl');
const settings={stepMin:.001,stepMax:.25,stepInit:.04,targetAccept:.4,stepAdapt:.1};
function inject(options=settings,source=shader){return context.swInject(source,32,0,4,1,null,options);}
test('GPU adaptation uses the supplied bounds and Robbins-Monro factors',()=>{
  const result=inject();
  const value=name=>Number(result.match(new RegExp('const '+name+': f32 = ([^;]+);'))[1]);
  assert.equal(value('STEP_MIN'),settings.stepMin);
  assert.equal(value('STEP_MAX'),settings.stepMax);
  assert.ok(Math.abs(value('STEP_UP')-Math.exp(.06))<1e-9);
  assert.ok(Math.abs(value('STEP_DOWN')-Math.exp(-.04))<1e-9);
});
test('invalid adaptation bounds, targets and float overflows fail before compilation',()=>{
  for(const change of [{stepMin:0},{stepMax:.0001},{stepInit:1},{targetAccept:0},{targetAccept:1},{stepAdapt:-1},{stepAdapt:1e9},{stepMin:NaN}])
    assert.throws(()=>inject({...settings,...change}),/adaptation/);
});
test('a stale shader cannot silently retain its own adaptation settings',()=>{
  assert.throws(()=>inject(settings,shader.replace('//__STEP_UP__','')),/STEP_UP marker/);
});

const {WY_LIMITS,wyckoffRestartCount}=require('../js/wyckoff_limits.js');
test('restart counts above ten are preserved; missing counts use the shared default',()=>{
  for(const n of [1,4,10,20,37,1000,Number.MAX_SAFE_INTEGER]){
    assert.equal(wyckoffRestartCount(n),n);assert.equal(wyckoffRestartCount(String(n)),n);
  }
  for(const missing of [undefined,null,'','  '])assert.equal(wyckoffRestartCount(missing),WY_LIMITS.defaults.restarts);
});
test('invalid restart counts fail before GPU setup instead of being rounded or clamped',async()=>{
  for(const invalid of [0,-1,2.5,NaN,Infinity,'invalid','20 extra',true,{},Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>wyckoffRestartCount(invalid),/Restarts must be a positive whole number/);
    await assert.rejects(context.runWyckoffSearch({restarts:invalid}),/Restarts must be a positive whole number/);
  }
});
test('the worker forwards the exact restart count and validates before requesting a GPU',async()=>{
  let requests=0,destroyed=0;
  const device={destroy(){destroyed++;}},worker=vm.createContext({console,navigator:{gpu:{async requestAdapter(){requests++;return {async requestDevice(){return device;}};}}}});
  vm.runInContext(read('js/wyckoff_limits.js'),worker);
  vm.runInContext(read('js/wyckoff_worker.js'),worker);
  worker.wyRunWithDevice=async(device,cell,symops,job)=>({sites:[],restarts:job.swarmRestarts});
  for(const n of [1,20,37]){
    const result=await worker.runWyckoffFromIntensities({},[],{targetComposition:'C',swarmRestarts:n});
    assert.equal(result.restarts,n);
  }
  assert.equal(requests,3);assert.equal(destroyed,3);
  const result=await worker.runWyckoffFromIntensities({},[],{targetComposition:'C',swarmRestarts:2.5});
  assert.match(result.error,/Restarts must be a positive whole number/);assert.equal(requests,3);
});
