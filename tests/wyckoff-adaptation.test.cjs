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
