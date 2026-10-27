const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
// Reuse the established application fixture without registering its tests.
const fixture=read('tests/regressions.test.cjs');
const {app}=new Function('require','__dirname',fixture.slice(0,fixture.indexOf('\ntest('))+';return {app};')(require,__dirname);
const pattern='10 10\n20 20\n30 10\n';
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function xy(name,text=pattern){return {name,arrayBuffer:async()=>new TextEncoder().encode(text).buffer};}
function slowFile(name){const started=deferred(),bytes=deferred();return {file:{name,arrayBuffer(){started.resolve();return bytes.promise;}},started:started.promise,release:()=>bytes.resolve(new TextEncoder().encode(pattern).buffer)};}

test('a file read that finishes after a calculation starts cannot mutate datasets or selection',async()=>{
  const a=app(),slow=slowFile('later.xy');await a.context.RV.cmd.readFiles([xy('initial.xy')]);const ids=Array.from(a.S.sel),before=a.S.datasets.length;
  const pending=a.context.RV.cmd.readFiles([slow.file]);await slow.started;a.state.setBusy(true,'test fit');slow.release();await pending;
  assert.equal(a.S.datasets.length,before);assert.deepEqual(Array.from(a.S.sel),ids);assert.equal(a.S.busy,true);assert.ok(a.messages.some(m=>/Import stopped.*calculation/.test(m.message)));
});
test('asynchronous pattern parsing is checked again before dataset commit',async()=>{
  const a=app(),parsed=deferred(),started=deferred(),zip=new a.context.JSZip();zip.file('scan.txt',pattern);const bytes=await zip.generateAsync({type:'arraybuffer'}),load=a.context.JSZip.loadAsync;let calls=0;
  a.context.JSZip.loadAsync=async function(...args){if(++calls===2){started.resolve();await parsed.promise;}return load.apply(this,args);};
  const pending=a.context.RV.cmd.readFiles([{name:'scan.zip',arrayBuffer:async()=>bytes}]);await started.promise;a.state.setBusy(true,'test fit');parsed.resolve();await pending;assert.equal(a.S.datasets.length,0);
});
test('concurrent import batches are serialized and both valid batches are retained',async()=>{
  const a=app(),slow=slowFile('one.xy');let secondStarted=false;const second=xy('two.xy'),readSecond=second.arrayBuffer;second.arrayBuffer=()=>{secondStarted=true;return readSecond();};
  const first=a.context.RV.cmd.readFiles([slow.file]);await slow.started;const next=a.context.RV.cmd.readFiles([second]);await Promise.resolve();assert.equal(secondStarted,false);slow.release();await Promise.all([first,next]);
  assert.equal(a.S.datasets.length,2);assert.deepEqual(Array.from(a.S.datasets,d=>d.name).sort(),['one','two']);
});
test('project replacement cancels a pending import instead of importing into the new project',async()=>{
  const a=app(),slow=slowFile('old-project.xy'),pending=a.context.RV.cmd.readFiles([slow.file]);await slow.started;
  await a.context.RV.cmd.openProject(JSON.parse(a.state.projectJSON([])));slow.release();await pending;
  assert.equal(a.S.datasets.length,0);assert.ok(a.messages.some(m=>/Import stopped.*project changed/.test(m.message)));
});
test('project confirmation cannot commit after a calculation starts',async()=>{
  const a=app();await a.context.RV.cmd.readFiles([xy('current.xy')]);const confirm=deferred(),started=deferred();a.context.RV.ui.confirm=()=>{started.resolve();return confirm.promise;};
  const before=a.S.datasets[0],pending=a.context.RV.cmd.openProject(JSON.parse(a.state.projectJSON([])));await started.promise;a.state.setBusy(true,'test fit');confirm.resolve(true);await pending;
  assert.equal(a.S.datasets[0],before);assert.equal(a.S.busy,true);
});
function pool(){
  const created=[];class Worker{constructor(){this.terminated=false;created.push(this);}terminate(){this.terminated=true;}postMessage(m){if(!this.terminated)queueMicrotask(()=>this.onmessage({data:{type:'done',id:m.id,result:{ok:true}}}));}}
  const context=vm.createContext({Worker,navigator:{hardwareConcurrency:2},RV:{ui:{log(){}}},console:{warn(){}},setTimeout,clearTimeout,Uint8Array});
  const source=read('js/rietveld/rv_commands.js');vm.runInContext(source.slice(0,source.indexOf('RV.cmd =')),context);return {created,pool:context.RV.pool};
}
test('a worker failure before first FIT is handled immediately and a fresh worker completes the job',async()=>{
  const a=pool();assert.equal(a.pool.usingWorkers(),true);const failed=a.created[0];assert.equal(typeof failed.onerror,'function');failed.onerror({message:'missing worker import',preventDefault(){}});assert.equal(failed.terminated,true);
  const run=a.pool.run([{}]);const results=await run.promise;assert.equal(a.created.length,2);assert.equal(results[0].ok,true);
});
test('completed idle workers retain an error handler and are replaced after a later failure',async()=>{
  const a=pool();await a.pool.run([{}]).promise;const failed=a.created[0];failed.onerror({message:'idle worker died',preventDefault(){}});const results=await a.pool.run([{}]).promise;assert.equal(a.created.length,2);assert.equal(results[0].ok,true);
});
test('an unavailable optional GPU script does not prevent the fit worker from returning CPU results',async()=>{
  const messages=[],imports=[];const context=vm.createContext({console:{warn(){}},RVCore:{refineAsync:async()=>({ok:true,backend:'cpu'})},self:{postMessage:m=>messages.push(m)},importScripts(...names){imports.push(names);if(names.includes('pt_gpu.js'))throw Error('404');}});
  vm.runInContext(read('js/rietveld_worker.js'),context);await context.self.onmessage({data:{type:'refine',id:9,problem:{}}});assert.equal(messages[0].type,'done');assert.equal(messages[0].result.ok,true);assert.equal(imports[0].includes('pt_gpu.js'),false);
});
