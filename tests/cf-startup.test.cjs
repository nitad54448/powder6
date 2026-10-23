const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const never=()=>new Promise(()=>{});
function job(){return {type:'run-charge-flipping',gridSize:8,maxIterations:12,thresholdSigma:1.1,seed:543,cell:{a:5,b:5,c:5,alpha:90,beta:90,gamma:90},symops:[{r:[1,0,0,0,1,0,0,0,1],t:[0,0,0]}],laueClass:'-1',symLambda:0,weakFraction:.15,weakGrouping:'cluster',overlapTolTth:.01,applyLP:false,
  hklList:[{h_orig:1,k_orig:0,l_orig:0,intensity:100,tth:10,d:5},{h_orig:0,k_orig:1,l_orig:0,intensity:80,tth:12,d:5},{h_orig:0,k_orig:0,l_orig:1,intensity:60,tth:20,d:5},{h_orig:1,k_orig:1,l_orig:0,intensity:30,tth:30,d:3.5}]};}
function worker(stage){
  let gpuCalls=0;
  const messages=[],device={lost:never(),createBindGroupLayout:()=>({}),createShaderModule:()=>({}),createPipelineLayout:()=>({}),createComputePipelineAsync:()=>{gpuCalls++;return stage==='compile'?never():Promise.reject(Error('Invalid test shader'));}};
  const context=vm.createContext({console:{warn(){},info(){},error(){}},performance,
    // Exercise the production watchdog paths without waiting 15–30 seconds.
    setTimeout:(fn,ms)=>setTimeout(fn,ms>=15000?1:ms),clearTimeout,
    navigator:{gpu:{requestAdapter:()=>{gpuCalls++;return stage==='adapter'?never():Promise.resolve({requestDevice:()=>{gpuCalls++;return stage==='device'?never():Promise.resolve(device);}});}}},
    GPUShaderStage:{COMPUTE:4},fetch:stage==='fetch'?never:async()=>({ok:true,text:stage==='text'?never:async()=>read('charge_flipping.wgsl')}),
    postMessage:message=>messages.push(message)});
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(read('js/'+file),context,{filename:file}));
  vm.runInContext(read('js/charge_flipping_worker.js'),context,{filename:'charge_flipping_worker.js'});
  return {context,messages,gpuCalls:()=>gpuCalls};
}
for(const stage of ['adapter','device','fetch','text','compile','invalid shader']){
  test('CF falls back to the same CPU calculation when GPU startup stalls at '+stage,async()=>{
    const instance=worker(stage),{context,messages}=instance,input=job();
    const expected=vm.runInContext('runChargeFlippingCPU',context)(input);messages.length=0;
    await context.onmessage({data:input});
    const result=messages.find(m=>m.type==='cf-result')?.results;
    assert.ok(result,JSON.stringify(messages));assert.equal(result.backend,'cpu');
    assert.equal(result.bestR,expected.bestR);assert.deepEqual(Array.from(result.map),Array.from(expected.map));
    assert.ok(messages.some(m=>m.type==='cf-status' && /CPU/.test(m.message)));
    assert.ok(messages.some(m=>m.type==='cf-progress' && m.iter>0));
    assert.equal(messages.filter(m=>m.type==='cf-result').length,1);
    assert.equal(messages.some(m=>m.type==='cf-error'),false);
    const calls=instance.gpuCalls();messages.length=0;
    await context.onmessage({data:{...input,seed:544}});
    assert.equal(instance.gpuCalls(),calls,'another random start retried the same stalled GPU initialization');
    assert.ok(messages.some(m=>m.type==='cf-result' && m.results.backend==='cpu'));
  });
}
