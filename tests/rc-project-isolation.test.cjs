const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function app(){
  const handlers={},messages=[],storage=new Map();
  const c=vm.createContext({console,TextDecoder,TextEncoder,performance,setTimeout,clearTimeout,setImmediate,clearImmediate,navigator:{hardwareConcurrency:2},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},
    RV:{bus:{on:(ev,fn)=>(handlers[ev]||(handlers[ev]=[])).push(fn),emit:(ev,data)=>(handlers[ev]||[]).slice().forEach(fn=>fn(data))},ui:{readBuffer:f=>f.arrayBuffer(),toast:(message,kind)=>messages.push({message,kind}),log(){},logLoad(){},progress(){},confirm:async()=>true,fmt:String,esc:String,stamp:()=>'',fileStamp:()=>''}}});
  c.window=c;
  for(const name of ['constants','crystal','profile','scatterers','wppf_linear','atomic_constraints','wyckoff_limits','distance_rules','atom_restraints','molecule_rules','rietveld_core','cif_reader','data_io','parsers','cif_structure'])vm.runInContext(read('js/'+name+'.js'),c,{filename:name+'.js'});
  c.SG_DATABASE=JSON.parse(read('sg/all.json'));
  for(const file of ['js/sg_engine.js','js/rietveld/rv_state.js','js/rietveld/rv_commands.js','lib/jszip.min.js','js/rietveld/rv_fit_history.js','js/rietveld/rv_project.js','js/absorption_table.js','js/rietveld/rv_absorption.js'])vm.runInContext(read(file),c,{filename:file});
  const St=c.RV.state,S=St.S;S.sgReady=true;
  const phase=name=>St.makePhase({name,sg:St.resolveSG(221),cell:{a:5}});
  return {c,St,S,messages,phase};
}
const clone=x=>JSON.parse(JSON.stringify(x));
const table=(value,label)=>({label,energyUnit:'eV',elements:{Si:{unit:'cm2/g',mu:[[1000,value],[20000,value]]}}});

test('phase allocation skips occupied identities and explicit additions reserve their key',()=>{
  const {St,S,phase}=app(),first=phase('one');St.addPhase(first);S.nextPhase=1;
  const second=phase('two');assert.equal(second.key,'p2');St.addPhase(second);
  const custom=phase('explicit'),old=custom.key;custom.key='p40';for(const map of [custom.v,custom.fit])for(const key of Object.keys(map)){map[key.replace(old+'.','p40.')]=map[key];delete map[key];}
  St.addPhase(custom);assert.equal(phase('after explicit').key,'p41');
  S.nextPhase=Infinity;assert.equal(phase('after invalid counter').key,'p4');
});
test('adding a duplicate phase object or clone fails before changing phases or dataset assignments',()=>{
  const {St,S,phase}=app(),ph=phase('one');St.addPhase(ph);const ds=St.makeDataset({name:'pattern',tth:[10,20],y:[1,2]});S.datasets.push(ds);
  const before=JSON.stringify(ds.phases);assert.throws(()=>St.addPhase(ph),/Duplicate phase key p1/);assert.throws(()=>St.addPhase({...ph}),/Duplicate phase key p1/);
  assert.equal(S.phases.length,1);assert.equal(JSON.stringify(ds.phases),before);
});
test('project preparation rejects duplicate and unsafe phase identities without changing the active project',()=>{
  const {St,S,phase}=app();St.addPhase(phase('one'));St.addPhase(phase('two'));const doc=JSON.parse(St.projectJSON([]));
  doc.phases[1]={...clone(doc.phases[0]),name:'duplicate'};assert.throws(()=>St.prepareProject(doc),/duplicate phase key p1/i);assert.equal(S.phases.length,2);
  for(const key of ['p9007199254740992','p1e10','p0']){doc.phases[1].key=key;assert.throws(()=>St.prepareProject(doc),/invalid phase key/i);}
});
test('project preparation reserves explicit phase keys before assigning missing legacy keys',()=>{
  const {St,phase}=app();St.addPhase(phase('one'));St.addPhase(phase('two'));const doc=JSON.parse(St.projectJSON([]));doc.phases.reverse();delete doc.phases[0].key;
  const prepared=St.prepareProject(doc);assert.deepEqual(Array.from(prepared.phases,p=>p.key),['p2','p1']);St.commitProject(prepared);assert.equal(phase('next').key,'p3');
});
test('commit rejects duplicate identities independently, and safe allocator handles an exhausted counter',()=>{
  const {St,S,phase}=app();St.addPhase(phase('one'));const doc=JSON.parse(St.projectJSON([])),prepared=St.prepareProject(doc);prepared.phases.push(prepared.phases[0]);
  assert.throws(()=>St.commitProject(prepared),/Duplicate phase key/);assert.equal(S.phases.length,1);
  S.nextPhase=Number.MAX_SAFE_INTEGER;const huge=phase('huge');St.addPhase(huge);const next=phase('wrapped');assert.equal(next.key,'p2');
});
test('project replacement clears a Fourier map even when the new project reuses p1',()=>{
  const {c,St,phase}=app();c.FourierMap={};vm.runInContext(read('js/rietveld/rv_fourier.js'),c);c.RV.fourier.init();St.addPhase(phase('old'));
  c.RV.fourier.state.result={phaseKey:'p1',phaseName:'old',dsId:123};c.RV.fourier.state.opts.negative=true;
  const doc=JSON.parse(St.projectJSON([]));doc.phases[0].name='new';St.commitProject(St.prepareProject(doc));assert.equal(c.RV.fourier.state.result,null);assert.equal(c.RV.fourier.state.opts.negative,false);
});
test('opening a project without a custom absorption table restores the bundled table',async()=>{
  const {c,St,phase}=app();St.addPhase(phase('one'));c.RV.absorption.loadDocument(table(10),'absorption.json','eV',true);const doc=JSON.parse(St.projectJSON([]));assert.equal(doc.absorption,null);
  c.RV.absorption.loadDocument(table(99),'custom-A','eV');assert.equal(c.RV.absorption.coefficient('Si',1000).value,99);
  await c.RV.cmd.openProject(doc);assert.equal(c.RV.absorption.exportUser(),null);assert.equal(c.RV.absorption.coefficient('Si',1000).value,10);
});
test('late bundled absorption load caches defaults without overwriting a custom project table',async()=>{
  const {c}=app();let resolve;c.fetch=()=>new Promise(r=>{resolve=r;});const pending=c.RV.absorption.init();
  c.RV.absorption.restoreUser(table(99,'custom-A'));resolve({ok:true,json:async()=>table(10)});await pending;
  assert.equal(c.RV.absorption.exportUser().label,'custom-A');assert.equal(c.RV.absorption.coefficient('Si',1000).value,99);
  c.RV.absorption.restoreUser(null);assert.equal(c.RV.absorption.exportUser(),null);assert.equal(c.RV.absorption.coefficient('Si',1000).value,10);
});
test('restoring builtin absorption while its startup read is pending cannot retain the old custom table',async()=>{
  const {c}=app();let resolve;c.fetch=()=>new Promise(r=>{resolve=r;});const pending=c.RV.absorption.init();c.RV.absorption.restoreUser(table(99,'custom-A'));c.RV.absorption.restoreUser(null);
  assert.equal(c.RV.absorption.exportUser(),null);assert.equal(c.RV.absorption.status().loaded,false);resolve({ok:true,json:async()=>table(10)});await pending;assert.equal(c.RV.absorption.coefficient('Si',1000).value,10);
});

test('detached phase creation reserves identities before addPhase and undo never reuses allocated keys',()=>{
  const {St,S,phase,c}=app(),first=phase('detached one');S.nextPhase=1;const second=phase('detached two');assert.equal(second.key,'p2');St.addPhase(first);c.RV.history.take('before third');const third=phase('three');St.addPhase(third);c.RV.history.undo();S.nextPhase=1;assert.equal(phase('after undo').key,'p4');
});
