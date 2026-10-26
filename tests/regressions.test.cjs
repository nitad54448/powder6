const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const database = JSON.parse(read('sg/all.json'));
const tables = {
  xray: JSON.parse(read('scatters/xray_wk1995_ions.json')),
  neutron: JSON.parse(read('scatters/neutron.json')),
  anomalous: JSON.parse(read('scatters/anomalous_chantler.json'))
};
const plain = value => JSON.parse(JSON.stringify(value));

function app(withTables = true) {
  const storage = new Map(), messages = [];
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, TextDecoder, TextEncoder,
    performance, setTimeout, clearTimeout, setImmediate, clearImmediate, navigator: { hardwareConcurrency: 2 },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    RV: { version: '2.6', bus: { emit() {}, on() {} }, ui: {
      readBuffer: f => f.arrayBuffer(), toast: (message, kind) => messages.push({ message, kind }),
      log() {}, logLoad() {}, progress() {}, confirm: async () => true,
      fmt: String, esc: String, stamp: () => '2026-10-21', fileStamp: () => '20261021'
    } }
  });
  context.window = context;
  for (const file of ['constants', 'crystal', 'profile', 'scatterers', 'wppf_linear', 'atomic_constraints', 'wyckoff_limits', 'distance_rules', 'atom_restraints', 'molecule_rules', 'rietveld_core',
    'cif_reader', 'data_io', 'parsers', 'cif_structure', 'sg_convert', 'sg_subgroups']) {
    vm.runInContext(read('js/' + file + '.js'), context, { filename: file + '.js' });
  }
  context.SG_DATABASE = database;
  for (const file of ['js/sg_engine.js', 'js/rietveld/rv_state.js', 'js/rietveld/rv_commands.js',
    'js/rietveld/rv_phases.js', 'js/rietveld/rv_results.js', 'js/rietveld/rv_gsas2.js', 'lib/jszip.min.js', 'js/rietveld/rv_fit_history.js', 'js/rietveld/rv_project.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const state = context.RV.state;
  state.S.sgReady = true;
  if (withTables) state.setTables(tables);
  return { context, state, S: state.S, core: context.RVCore, messages, storage,
    run: source => vm.runInContext(source, context) };
}

function file(name, text) {
  const bytes = new TextEncoder().encode(text);
  return { name, arrayBuffer: async () => bytes.buffer };
}

function model(a = app()) {
  a.S.calculation = 'rietveld';
  for (const [name, length] of [['Si', 5], ['Na', 7]]) {
    a.state.addPhase(a.state.makePhase({ name, sg: a.state.resolveSG(221), cell: { a: length },
      atoms: [{ label: name + '1', type: name, x: 0, y: 0, z: 0, B: 0.5, occ: 1 }] }));
  }
  const ds = a.state.makeDataset({ name: 'mixture', tth: Array.from({ length: 150 }, (_, i) => 10 + i * 0.5),
    y: Array(150).fill(100), inst: { bkgN: 1, lambda2: 0, ratio: 0 } });
  a.S.datasets.push(ds); a.state.selectIds([ds.id]);
  ds.p['p1.scale'] = 0.002; ds.p['p2.scale'] = 0.003; ds.p.bkg0 = 17;
  ds.y = a.core.evaluate(a.state.problemFor([ds]), 0).ycalc;
  Object.keys(ds.fit).forEach(k => { ds.fit[k] = k === 'bkg0'; });
  return { ...a, ds };
}

function fitted(a = model()) {
  const job = a.state.jobFor(a.ds), result = a.core.refine(job);
  assert.equal(result.ok, true, result.msg);
  a.state.applyResult([a.ds], result, job, false);
  return a;
}

test('the positive width continuation retains negative-tail precision and avoids overflow', () => {
  const a=app();
  assert.ok(Math.abs(a.run('softPositive(-1e10,1e-3)')/1e-16-1)<1e-14);
  assert.equal(a.run('softPositive(0,0.25)'),0.25);
  assert.equal(a.run('softPositive(1e308,0.25)'),1e308);
  assert.ok(a.run('softPositive(-1e308,0.25)')>0);
  for(const x of [-100,-1,1,100]){
    const actual=a.run('softPositive('+x+',0.5)'),expected=(x+Math.sqrt(x*x+1))/2;
    assert.ok(Math.abs(actual-expected)<1e-12);
  }
});

test('normal-matrix diagnostics find joint dependencies despite unequal parameter units', () => {
  const a=app(),base=[1,0,1,0,1,1,1,1,2],scales=[1e-9,1e6,.03];
  const A=base.map((x,i)=>x*scales[Math.floor(i/3)]*scales[i%3]);
  const diagnostic=a.core.normalDependence(A,3);
  assert.equal(diagnostic.rank,2);
  assert.deepEqual(plain(diagnostic.groups),[[0,1,2]]);
  assert.deepEqual(plain(a.core.normalDependence([1,0,0,1],2)),{rank:2,groups:[]});
  assert.deepEqual(plain(a.core.normalDependence([1,0,0,0],2)),{rank:1,groups:[[1]]});
});

test('joint instrument/sample size ambiguity is diagnosed in all three fit methods', () => {
  for(const method of ['rietveld','lebail','wppf']){
    const a=model();a.state.setCalculation(method);
    const job=a.state.problemFor([a.ds]);
    job.vars=['zero','inst.X','p1.size','p2.size'].map(name=>({d:0,name}));
    const result=a.core.refine(job,{evaluateOnly:true});
    assert.equal(result.ok,true,result.msg);assert.equal(result.covarianceOK,false,method);
    const warnings=result.fitWarnings[0].join('\n');
    assert.match(warnings,/inst\.X, p1\.size, p2\.size/);
    assert.match(result.uncertaintyIssues[0].zero,/does not establish/);
    assert.match(result.uncertaintyIssues[0]['inst.X'],/Cannot distinguish/);
    job.vars=job.vars.filter(v=>v.name!=='inst.X');
    const calibrated=a.core.refine(job,{evaluateOnly:true});
    assert.equal(calibrated.covarianceOK,true,method+': fixed instrument should resolve the sample ambiguity');
    assert.equal(calibrated.fitWarnings[0].length,0);
  }
});

test('instrument diagnostics test the full Gaussian variance rather than the sign of V', () => {
  const a=model(),job=a.state.problemFor([a.ds]);job.vars=[];
  assert.deepEqual(plain(a.core.refine(job,{evaluateOnly:true}).fitWarnings),[[]]);
  job.datasets[0].tth=Float64Array.from({length:6001},(_,i)=>10+.025*i);
  job.datasets[0].y=new Float64Array(6001).fill(100);job.datasets[0].w=new Float64Array(6001).fill(.01);
  Object.assign(job.values[0],{'inst.U':3.96361,'inst.V':-43.01288,'inst.W':18.71003});
  // The reported setup: instrument coefficients, zero, cell and background;
  // specimen size/strain are held fixed.
  job.vars=['zero','p1.a','p2.a','bkg0',...['U','V','W','X','Y','Z','SL','HL'].map(k=>'inst.'+k)].map(name=>({name,d:0}));
  const result=a.core.refine(job,{evaluateOnly:true});
  assert.equal(result.ok,true,result.msg);
  assert.match(result.fitWarnings[0][0],/Gaussian variance \(U, V, W\) is negative/);
  assert.match(result.fitWarnings[0][0],/negative V alone is allowed/);
  assert.match(result.fitWarnings[0][0],/159\.12 deg/);
  assert.equal(result.values[0]['p1.size'],job.values[0]['p1.size']);
  assert.equal(result.values[0]['p1.strain'],job.values[0]['p1.strain']);
  assert.ok(!result.fitWarnings[0].some(s=>/Cannot distinguish.*p[12]\.(?:size|strain)/.test(s)));
  // Both end points are positive, but the polynomial is negative inside.
  job.datasets[0].tth=Float64Array.from({length:150},(_,i)=>20+i*100/149);
  job.datasets[0].y=new Float64Array(150).fill(100);job.datasets[0].w=new Float64Array(150).fill(.01);
  Object.assign(job.values[0],{'inst.U':1,'inst.V':-2,'inst.W':.9});
  assert.match(a.core.refine(job,{evaluateOnly:true}).fitWarnings[0][0],/90\.00 deg/);
});

test('an inactive refined variable cannot silently pass the covariance quality flag', () => {
  const a=model();a.ds.inst.resolutionType='simple_pvoigt';
  const job=a.state.problemFor([a.ds]);job.vars=[{d:0,name:'bkg0'},{d:0,name:'inst.HL'}];
  const result=a.core.refine(job,{evaluateOnly:true});
  assert.equal(result.ok,true,result.msg);assert.equal(result.covarianceOK,false);
  assert.match(result.uncertaintyIssues[0]['inst.HL'],/zero derivative/);
  assert.match(result.fitWarnings[0].join('\n'),/inst.HL has no measurable effect/);
  assert.ok(Number.isFinite(result.esd[0].bkg0));
});

test('local variables with the same name are distinguished in global covariance diagnostics', () => {
  const a=model(),other=a.state.makeDataset({name:'other',tth:a.ds.tth,y:a.ds.y,inst:a.ds.inst});
  a.S.datasets.push(other);
  const job=a.state.problemFor([a.ds,other]);
  job.vars=[0,1].flatMap(d=>['inst.X','p1.size','p2.size'].map(name=>({d,name})));
  const result=a.core.refine(job,{evaluateOnly:true});
  assert.equal(result.ok,true,result.msg);assert.equal(result.covarianceOK,false);
  assert.match(result.uncertaintyIssues[0]['inst.X'],/inst.X \(dataset 1\)/);
  assert.doesNotMatch(result.uncertaintyIssues[0]['inst.X'],/dataset 2/);
  assert.match(result.uncertaintyIssues[1]['inst.X'],/inst.X \(dataset 2\)/);
});

test('fit diagnostics and truthful uncertainty labels survive reports, history and projects', () => {
  const a=model(),job=a.state.problemFor([a.ds]);
  job.vars=['zero','inst.X','p1.size','p2.size'].map(name=>({d:0,name}));
  const result=a.core.refine(job,{evaluateOnly:true});a.state.applyResult([a.ds],result,job,false);
  const expected=plain(result.fitWarnings[0]),report=a.context.RV.results.reportText([a.ds]);
  assert.match(report,/fit warning\tCannot distinguish/);
  assert.match(report,/X = .*\(uncertainty unavailable\)/);
  assert.doesNotMatch(report,/\(unconstrained\)/);
  const record=a.context.RV.fitHistory.complete(a.context.RV.fitHistory.begin([a.ds],false),[a.ds]);
  a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
  assert.deepEqual(plain(a.S.datasets[0].stats.fitWarnings),expected);
  assert.equal(a.S.datasets[0].stats.covarianceOK,false);
  a.context.RV.fitHistory.restore(record.id);
  assert.deepEqual(plain(a.S.datasets[0].stats.fitWarnings),expected);
});

test('scale estimation recovers both phase scales and the constant background', () => {
  const a = model();
  a.ds.p['p1.scale'] = 1e-9; a.ds.p['p2.scale'] = 1e-9; a.ds.p.bkg0 = 1;
  assert.equal(a.state.estimateScales(a.ds), true);
  assert.ok(Math.abs(a.ds.p['p1.scale'] - 0.002) < 1e-10);
  assert.ok(Math.abs(a.ds.p['p2.scale'] - 0.003) < 1e-10);
  assert.ok(Math.abs(a.ds.p.bkg0 - 17) < 1e-8);
});

test('space-group precision limits the tested reflections and reports the available count', () => {
  const a=model();a.state.setCalculation('wppf');
  const job=a.state.jobFor(a.ds);
  const all=a.core.refine(job,{evaluateOnly:true,precision:{dataset:0,phase:0}});
  assert.equal(all.ok,true,all.msg);
  assert.ok(all.precision.available>4);
  assert.equal(all.precision.n,Math.min(all.precision.available,a.core.MAX_PRECISION_REFLECTIONS));
  const limited=a.core.refine(job,{evaluateOnly:true,precision:{dataset:0,phase:0,maxRefl:4}});
  assert.equal(limited.ok,true,limited.msg);
  assert.equal(limited.precision.n,4);
  assert.equal(limited.precision.Q.length,16);
  assert.equal(limited.precision.available,all.precision.available);
  assert.deepEqual(Array.from(limited.precision.index),Array.from(all.precision.index).slice(0,4));
});

test('every space-group setting resolves from its own symbol; short monoclinic symbols and numbers give the standard setting', () => {
  const a=app(),E=a.context.SG_ENGINE,all=a.state.allSettings();
  assert.equal(all.length,520);
  const wrong=all.filter(s=>{const g=a.state.resolveSG(s.symbol);return !g || g.hall!==s.hall;}).map(s=>s.symbol);
  assert.deepEqual(Array.from(wrong),[],'symbols that resolve to another setting');
  const sym=t=>a.state.resolveSG(t).symbol;
  assert.equal(sym('Pnnn:2'),'Pnnn:2');assert.equal(sym('P 21/c'),'P121/c1');assert.equal(sym('P21/n'),'P121/n1');assert.equal(sym('C2/c'),'C12/c1');
  assert.equal(sym('14'),'P121/c1');assert.equal(sym('15'),'C12/c1');assert.equal(sym('225'),'Fm-3m');assert.equal(sym('F m -3 m'),'Fm-3m');
  assert.equal(a.state.resolveSG('-P 2yn').symbol,'P121/n1','a Hall symbol still resolves');
});
async function moyo() {
  const m = await import(require('node:url').pathToFileURL(path.join(root, 'lib/moyo/moyo_wasm.js')).href);
  await m.default({ module_or_path: fs.readFileSync(path.join(root, 'lib/moyo/moyo_wasm_bg.wasm')) });
  return m;
}
test('Find higher symmetry names the space group of structures given in P1, with the transformation to it', async () => {
  const a=app(),St=a.state,E=a.context.SG_ENGINE,K=a.context.SGConvert;K.useWasm(await moyo());
  const groups=[];for(let n=1;n<=230;n++){const s=E.listSettings(n),pick=d=>s.find(x=>x.setting_description===d);groups.push(Object.assign({},St.resolveSG(n,(pick('standard')||pick('b1')||pick('b')||pick('origin choice 2')||s[0]).hall)));}
  const P1=St.resolveSG(1);
  const inP1=(sg,atoms,cell)=>K.convertStructure(atoms,sg.ops,P1.ops,cell,K.IDENTITY,[0,0,0]).atoms.map(x=>({label:x.label,type:x.type,x:x.x,y:x.y,z:x.z,occ:1}));
  const find=(atoms,cell,tol=0.2)=>{const r=K.findSymmetryWasm(atoms,P1.ops,cell,groups,{tol,reportAll:true});const c=r.group&&K.convertStructure(atoms,P1.ops,r.group.ops,cell,r.P,r.p,{tol,cell:r.standardCell});return {r,c};};
  const cub=x=>({a:x,b:x,c:x,alpha:90,beta:90,gamma:90});
  const cases=[
    [225,inP1(St.resolveSG(225),[{label:'Na',type:'Na',x:0,y:0,z:0},{label:'Cl',type:'Cl',x:.5,y:.5,z:.5}],cub(5.64)),cub(5.64),2],
    [227,inP1(St.resolveSG(227,E.listSettings(227)[0].hall),[{label:'Si',type:'Si',x:0,y:0,z:0}],cub(5.43)),cub(5.43),1],
    [166,inP1(St.resolveSG(166),[{label:'Bi',type:'Bi',x:0,y:0,z:.4},{label:'Te1',type:'Te',x:0,y:0,z:0},{label:'Te2',type:'Te',x:0,y:0,z:.21}],{a:4.38,b:4.38,c:30.5,alpha:90,beta:90,gamma:120}),{a:4.38,b:4.38,c:30.5,alpha:90,beta:90,gamma:120},3],
    [186,inP1(St.resolveSG(186),[{label:'Zn',type:'Zn',x:1/3,y:2/3,z:0},{label:'O',type:'O',x:1/3,y:2/3,z:.382}],{a:3.25,b:3.25,c:5.21,alpha:90,beta:90,gamma:120}),{a:3.25,b:3.25,c:5.21,alpha:90,beta:90,gamma:120},2],
    [62,inP1(St.resolveSG(62),[{label:'Ca',type:'Ca',x:.05,y:.25,z:.99},{label:'O1',type:'O',x:.48,y:.25,z:.08},{label:'O2',type:'O',x:.29,y:.04,z:.71},{label:'Ti',type:'Ti',x:0,y:0,z:.5}],{a:5.44,b:7.64,c:5.38,alpha:90,beta:90,gamma:90}),{a:5.44,b:7.64,c:5.38,alpha:90,beta:90,gamma:90},4],
    [15,inP1(St.resolveSG(15,E.listSettings(15).find(x=>x.setting_description==='b1').hall),[{label:'Fe',type:'Fe',x:0,y:.2,z:.25},{label:'O',type:'O',x:.31,y:.12,z:.05}],{a:9.7,b:8.8,c:5.3,alpha:90,beta:107,gamma:90}),{a:9.7,b:8.8,c:5.3,alpha:90,beta:107,gamma:90},2]];
  for(const [number,atoms,cell,sites] of cases){const {r,c}=find(atoms,cell);assert.equal(r.group&&r.group.number,number,'group '+number);assert.equal(c.violations.length,0);assert.equal(c.atoms.length,sites,'sites of '+number);assert.ok(c.maxShift<1e-6);}
  // NaCl with one Cl moved 0.17 A: Fm-3m at 0.2 A (the move is reported), not at 0.1 A
  const d=cases[0][1].map(x=>({...x}));d.find(x=>x.type==='Cl').z+=0.03;
  let f=find(d,cub(5.64),0.2);assert.equal(f.r.group.number,225);assert.ok(f.c.maxShift>0.1 && f.c.maxShift<0.2,'maxShift '+f.c.maxShift);
  f=find(d,cub(5.64),0.1);assert.notEqual(f.r.group.number,225);
});
test('Subgroups of Fm-3m: every maximal subgroup is named by the engine and is a subgroup in the transformation found', async () => {
  const a=app(),St=a.state,K=a.context.SGConvert,SB=a.context.Subgroups;K.useWasm(await moyo());
  const groups=[];const E=a.context.SG_ENGINE;for(let n=1;n<=230;n++){const s=E.listSettings(n),pick=d=>s.find(x=>x.setting_description===d);groups.push(Object.assign({},St.resolveSG(n,(pick('standard')||pick('b1')||pick('b')||pick('origin choice 2')||s[0]).hall)));}
  const cub={a:5.64,b:5.64,c:5.64,alpha:90,beta:90,gamma:90};
  const names=(number,hall,cell=cub)=>{const g=St.resolveSG(number,hall);return SB.enumerate(g.ops).map(c=>{
    const q=SB.probe(c,cell);let r;for(const tol of SB.TOLERANCES){const x=K.findSymmetryWasm(q.atoms,q.ops,q.cell,groups,{tol,reportAll:true});if(x.group&&x.ops.length===c.nrep){r=x;break;}}
    assert.ok(r,'no tolerance names '+c.kind+c.index);const t=SB.compose(c,r.P,r.p);
    return {kind:c.kind,index:c.index,number:r.group.number,symbol:r.group.symbol,rel:K.relation(g.ops,r.group.ops,t.P,t.p),nops:r.ops.length,nrep:c.nrep};});};
  const list=names(225);
  const has=(sym,idx,kind)=>list.some(x=>x.symbol===sym && x.index===idx && x.kind===kind);
  for(const x of list)assert.equal(x.rel,'subgroup',x.symbol+' index '+x.index);
  for(const x of list)assert.equal(x.nops,x.nrep,x.symbol+' operators');
  assert.ok(has('I4/mmm',3,'t'),'I4/mmm '+JSON.stringify(list.map(x=>x.kind+x.index+x.symbol)));
  assert.ok(has('Fm-3',2,'t')||list.some(x=>x.number===202&&x.index===2),'Fm-3');
  assert.ok(list.some(x=>x.number===216&&x.index===2),'F-43m');assert.ok(list.some(x=>x.number===209&&x.index===2),'F432');
  assert.ok(list.some(x=>x.number===166&&x.index===4),'R-3m');
  assert.ok(list.some(x=>x.number===221&&x.index===4&&x.kind==='k'),'Pm-3m');
  // other lattices: every subgroup named is a subgroup, and the obvious ones are there
  const hex=names(194,undefined,{a:3.2,b:3.2,c:5.2,alpha:90,beta:90,gamma:120}),mono=names(14,undefined,{a:5,b:6,c:7,alpha:90,beta:100,gamma:90}),orth=names(62,undefined,{a:5,b:6,c:7,alpha:90,beta:90,gamma:90});
  for(const x of [...hex,...mono,...orth])assert.equal(x.rel,'subgroup',x.symbol+' index '+x.index);
  assert.ok(hex.some(x=>x.number===186&&x.index===2),'P63mc');assert.ok(hex.some(x=>x.number===176&&x.index===2),'P63/m');assert.ok(hex.some(x=>x.number===63&&x.index===3),'Cmcm');
  assert.ok(mono.some(x=>x.number===4&&x.index===2),'P21');assert.ok(mono.some(x=>x.number===2&&x.index===2),'P-1');
  assert.ok(orth.some(x=>x.number===33),'Pna21');assert.ok(orth.some(x=>x.number===26),'Pmc21');
});
test('Find higher symmetry treats nearly equal refined occupancies as one species and searches mixed sites', async () => {
  const a=app(),St=a.state,K=a.context.SGConvert;K.useWasm(await moyo());
  const P1=St.resolveSG(1),fm3m=St.resolveSG(225),cell={a:5.64,b:5.64,c:5.64,alpha:90,beta:90,gamma:90};
  const full=K.convertStructure([{label:'Na',type:'Na',x:0,y:0,z:0},{label:'Cl',type:'Cl',x:.5,y:.5,z:.5}],fm3m.ops,P1.ops,cell,K.IDENTITY,[0,0,0]).atoms.map(x=>({label:x.label,type:x.type,x:x.x,y:x.y,z:x.z,occ:1}));
  const refined=full.map((x,i)=>({...x,occ:x.type==='Na'?1-0.004*i:1}));
  assert.equal(K.findSymmetryWasm(refined,P1.ops,cell,[],{tol:.05,occTol:.02,reportAll:true}).group.number,225);
  assert.notEqual(K.findSymmetryWasm(refined,P1.ops,cell,[],{tol:.05,occTol:0,reportAll:true}).group.number,225);
  const r=K.findSymmetryWasm(refined,P1.ops,cell,[],{tol:.05,occTol:.02,reportAll:true}),c=K.convertStructure(refined,P1.ops,r.group.ops,cell,r.P,r.p,{tol:.05,cell:r.standardCell,occTol:.02});
  assert.equal(c.violations.length,0);assert.equal(c.atoms.length,2);
  const mixed=full.flatMap(x=>x.type==='Na'?[{...x,occ:.5},{...x,label:x.label+'K',type:'K',occ:.5}]:[x]);
  const m=K.findSymmetryWasm(mixed,P1.ops,cell,[],{tol:.05,reportAll:true});
  assert.equal(m.group.number,225);assert.equal(m.mixedSites,4);
});
function convertible(sgNumber, atoms, cell, hall) {
  const a=app();a.S.calculation='rietveld';
  const sg=a.state.resolveSG(sgNumber,hall),ph=a.state.makePhase({name:'X',sg,cell,atoms});a.state.addPhase(ph);
  const ds=a.state.makeDataset({name:'d1',tth:Array.from({length:100},(_,i)=>10+i*.5),y:Array(100).fill(10),inst:{bkgN:1,lambda2:0,ratio:0}});
  a.S.datasets.push(ds);a.state.selectIds([ds.id]);a.state.remapAll();
  return {...a,ph,ds,K:a.context.SGConvert};
}
function convert(a, target, hall, mode) {
  const sg=a.state.resolveSG(target,hall),cell=a.state.cellOf(a.ph,a.ph.v),norm=c=>a.context.normaliseCell(c,sg.system,sg.uniqueAxis);
  const t=mode || a.K.findTransforms(a.ph.ops,sg.ops,cell,{normalise:norm})[0];
  assert.ok(t,'no transformation found');
  const atoms=a.ph.atoms.map(at=>{const p=a.ph.key+'.'+at.label+'.';return {label:at.label,type:at.type,x:a.ph.v[p+'x'],y:a.ph.v[p+'y'],z:a.ph.v[p+'z'],occ:a.ph.v[p+'occ'],B:a.ph.v[p+'B']};});
  const conv=a.K.convertStructure(atoms,a.ph.ops,sg.ops,cell,t.P,t.p,{cell:norm(a.K.transformCell(cell,t.P))});
  return {sg,t,conv,report:conv.violations.length?null:a.state.convertPhase(a.ph,sg,conv,t.P,t.p)};
}
test('converting a phase to a subgroup splits its sites and keeps each dataset\'s own cell, positions, B and flags', () => {
  const a=convertible(225,[{label:'Na1',type:'Na',x:0,y:0,z:0,B:1},{label:'Cl1',type:'Cl',x:.5,y:.5,z:.5,B:1}],{a:5.64});
  const k=a.ph.key+'.';a.ds.p[k+'a']=5.7;a.ds.p[k+'Na1.B']=1.7;a.ds.fit[k+'Na1.B']=true;a.ds.fit[k+'a']=true;a.ph.poDir=[1,1,0];
  const r=convert(a,'P 4/m m m');
  assert.equal(r.t.relation,'subgroup');assert.equal(r.report.datasets,1);
  assert.equal(a.ph.sg.number,123);assert.equal(a.ph.atoms.length,6,'without the F centring, Na and Cl each split over three sites in P4/mmm');
  assert.deepEqual(Array.from(a.ph.atoms,x=>x.label).sort(),['Cl1a','Cl1b','Cl1c','Na1a','Na1b','Na1c']);
  assert.deepEqual(Array.from(a.ph.atoms.filter(x=>/^Na/.test(x.label)),x=>x.site.mult).sort(),[1,1,2]);
  assert.equal(a.ph.atoms.reduce((s,x)=>s+x.site.mult,0),8,'cell content kept');
  assert.ok(Math.abs(a.ds.p[k+'a']-5.7)<1e-9 && Math.abs(a.ds.p[k+'c']-5.7)<1e-9,'the dataset keeps its own cell');
  assert.ok(Math.abs(a.ph.v[k+'a']-5.64)<1e-9,'the starting model keeps its cell');
  ['Na1a','Na1b','Na1c'].forEach(l=>{assert.equal(a.ds.p[k+l+'.B'],1.7);assert.equal(a.ds.fit[k+l+'.B'],true);});
  assert.equal(a.ds.fit[k+'a'],true);assert.equal(a.ds.fit[k+'c'],true);
  assert.equal(a.ds.stats,null);assert.deepEqual(Array.from(a.ph.poDir),[1,1,0]);
});
test('an origin change in Fd-3m moves every position by the shift, in the phase and in each dataset', () => {
  const s=require('../sg/all.json').space_groups['227'].settings,o1=s.find(x=>/:1/.test(x.symbol)).hall,o2=s.find(x=>/:2/.test(x.symbol)).hall;
  const a=convertible(227,[{label:'Si1',type:'Si',x:.125,y:.125,z:.125,B:.5}],{a:5.43},o2);
  const r=convert(a,227,o1);
  assert.equal(r.t.relation,'same');assert.deepEqual(Array.from(r.t.p,v=>+v.toFixed(4)),[-0.125,-0.125,-0.125]);
  const k=a.ph.key+'.Si1.';
  assert.deepEqual([a.ph.v[k+'x'],a.ph.v[k+'y'],a.ph.v[k+'z']].map(Number),[0,0,0]);assert.equal(a.ph.atoms[0].site.mult,8);
  assert.deepEqual([a.ds.p[k+'x'],a.ds.p[k+'y'],a.ds.p[k+'z']].map(v=>+v.toFixed(9)),[0,0,0]);
});
test('a supergroup the structure does not have is refused; one it has merges the atoms', () => {
  const a=convertible(1,[{label:'Na1',type:'Na',x:0,y:0,z:0},{label:'Na2',type:'Na',x:0,y:.5,z:.5},{label:'Na3',type:'Na',x:.5,y:0,z:.5},{label:'Na4',type:'Na',x:.5,y:.5,z:0},
    {label:'Cl1',type:'Cl',x:.5,y:.5,z:.5},{label:'Cl2',type:'Cl',x:.5,y:0,z:0},{label:'Cl3',type:'Cl',x:0,y:.5,z:0},{label:'Cl4',type:'Cl',x:0,y:0,z:.53}],{a:5.64,b:5.64,c:5.64,alpha:90,beta:90,gamma:90});
  let r=convert(a,225);
  assert.equal(r.report,null);assert.ok(r.conv.violations.length>0 && /Cl4|Cl/.test(r.conv.violations.join(' ')));assert.equal(a.ph.sg.number,1,'refused: nothing changed');
  a.ph.v[a.ph.key+'.Cl4.z']=.5;r=convert(a,225);
  assert.ok(r.report);assert.equal(a.ph.atoms.length,2);assert.deepEqual(Array.from(a.ph.atoms,x=>x.site.mult),[4,4]);
});
test('a monoclinic setting change transforms the cell, the positions and the preferred-orientation direction', () => {
  const s=require('../sg/all.json').space_groups['14'].settings,pc=s.find(x=>x.symbol.replace(/\s/g,'')==='P121/c1').hall,pn=s.find(x=>x.symbol.replace(/\s/g,'')==='P121/n1').hall;
  const a=convertible(14,[{label:'O1',type:'O',x:.1,y:.2,z:.3}],{a:7,b:8,c:9,beta:110},pc);a.ph.poDir=[0,0,1];
  const r=convert(a,14,pn),k=a.ph.key+'.';
  assert.equal(r.t.relation,'same');assert.ok(a.ph.v[k+'beta']>90,'obtuse beta');
  const c=a.ph.v;assert.ok(Math.abs(c[k+'a']*c[k+'b']*c[k+'c']*Math.sin(c[k+'beta']*Math.PI/180)-7*8*9*Math.sin(110*Math.PI/180))<1e-6,'same volume');
  assert.equal(a.ph.atoms[0].site.mult,4);assert.deepEqual(Array.from(a.ph.poDir),Array.from(a.K.hklToNew([0,0,1],r.t.P)));
});
test('a WPPF fit with nothing ticked refines the intensities; Rietveld still asks for a ticked parameter', () => {
  const a=model();a.state.setCalculation('wppf');
  Object.keys(a.ds.fit).forEach(k=>{a.ds.fit[k]=false;});
  const job=a.state.jobFor(a.ds);assert.equal(job.vars.length,0);
  const r=a.core.refine(job);assert.equal(r.ok,true,r.msg);
  assert.match(r.msg,/WPPF intensities refined/);assert.ok(r.nInt>0,'no intensity was refined');assert.ok(Number.isFinite(r.stats[0].Rwp));
  assert.equal(a.context.RV.cmd.why('fit'),'');
  a.state.setCalculation('rietveld');Object.keys(a.ds.fit).forEach(k=>{a.ds.fit[k]=false;});
  assert.match(a.context.RV.cmd.why('fit'),/Tick at least one parameter/);
  assert.throws(()=>{const r2=a.core.refine(a.state.jobFor(a.ds),{rethrow:true});if(!r2.ok)throw new Error(r2.msg);},/nothing is ticked/);
});
test('a Wyckoff composition blocked by a stated coordination names the constraint, not the site caps', () => {
  const A=require('../js/wyckoff_assign.js'),db=require('../sg/all.json'),g=db.space_groups || db;
  const st=Object.values(g).flatMap(x=>x.settings).find(s=>s.symbol==='A112/m');
  const demand=[['Na',4,11],['Cu',2,29],['Fe',2,26],['C',12,6],['N',12,7]].map(([e,n,z])=>({element:e.toUpperCase(),count:n,z,r:1}));
  const bad=A.enumerateAssignments(st.wyckoff,demand,{ceiling:24,symOps:st.sym_ops,coordination:{FE:{count:1}},maxTotal:1});
  assert.match(bad.error,/coordination stated for Fe \(1 neighbour\)/);assert.match(bad.error,/Site symmetry excludes 2d, 2c, 2b, 2a/);
  assert.match(bad.error,/"Fe C - 1\.2\/1\.8"|Fe C - 1\.2\/1\.8/);assert.doesNotMatch(bad.error,/Raise the caps/);
  assert.equal(A.enumerateAssignments(st.wyckoff,demand,{ceiling:24,symOps:st.sym_ops,coordination:{FE:{count:6}},maxTotal:1}).error,undefined);
});
test('Wyckoff assignments related by an origin shift or the inversion are searched once', () => {
  const A=require('../js/wyckoff_assign.js'),g=require('../sg/all.json').space_groups;
  const count=(n,demand)=>{const s=g[n].settings[0],en=A.enumerateAssignments(s.wyckoff,demand,{ceiling:24,symOps:s.sym_ops});return [en.assignments.length,A.dedupeEquivalentAssignments(en.assignments,s.wyckoff,s.sym_ops).assignments.length];};
  const el=(e,n,z)=>({element:e,count:n,z,r:1});
  assert.deepEqual(count(123,[el('NA',1,11)]),[4,1],'P4/mmm 1a, 1b, 1c, 1d are one placement');
  // NaCl in P4/mmm: Cl displaced from Na by (0,0,1/2), (1/2,1/2,0) or (1/2,1/2,1/2) are three different structures
  assert.deepEqual(count(123,[el('NA',1,11),el('CL',1,17)]),[12,3]);
  assert.deepEqual(count(2,[el('PB',2,82),el('O',2,8)]),[477,78],'the eight inversion centres of P-1 are equivalent');
  const waves=A.allocateWaves([5,9,2,7],512,24,[1,1,1,1,1,1,1,1,1,1]);
  assert.deepEqual(waves.map(w=>w.ids),[[5,9,2,7]]);assert.ok(Array.from(waves[0].assignOf).every(a=>[5,9,2,7].includes(a)));
  assert.equal(A.assignmentsPerWave(512,24,true),10);
});
test('distance constraints beyond the old eight rules are packed, and the kernel is sized for them', () => {
  const A=require('../js/wyckoff_assign.js'),{WY_LIMITS}=require('../js/wyckoff_limits.js');
  const demand=['A','B','C','D','E','F'].map((e,i)=>({element:e,count:4,z:6+i,r:1}));
  const windows=[];for(let i=0;i<6;i++)for(let j=i+1;j<6;j++)windows.push({a:demand[i].element,b:demand[j].element,dmin:1,dmax:3});
  const t=A.buildRestraintTables(demand,windows,{});
  assert.equal(t.nRules,30,'15 bare upper bounds, each applied both ways');assert.ok(t.nRules>WY_LIMITS.baseRules && t.nRules<=WY_LIMITS.maxRules);
  const counted=A.buildRestraintTables(demand,[{a:'A',b:'B',count:12,countMode:'exact',dmin:1,dmax:3},{a:'C',b:'D',count:70,countMode:'exact',dmin:1,dmax:3}],{});
  assert.equal(counted.slotsNeeded,82);
  assert.throws(()=>A.buildRestraintTables(demand,windows.concat(windows.slice(0,2)),{}),/kernel holds 32/);
  const src=read('swarm_reflection.wgsl');
  assert.match(src,/const MAX_BOND_RULES: u32 = \d+u; \/\/__MAX_BOND_RULES__/);assert.match(src,/const MAX_COORD_SLOTS: u32 = \d+u; \/\/__MAX_COORD_SLOTS__/);
});
test('a coordination shell can be given a shape: it is packed for the kernel and rules out sites that cannot host it', () => {
  const A=require('../js/wyckoff_assign.js'),db=require('../sg/all.json').space_groups;
  const demand=[{element:'CU',count:2,z:29,r:1},{element:'O',count:8,z:8,r:1}];
  const t=A.buildRestraintTables(demand,[{a:'CU',b:'O',count:4,countMode:'exact',dmin:1.8,dmax:2.1,geometry:'square-planar'}],{});
  assert.equal(t.ruleStride,7);assert.equal(t.geometry,true);assert.equal(t.rules[0][6],4,'square-planar code');
  assert.equal(A.buildRestraintTables(demand,[{a:'CU',b:'O',count:4,countMode:'exact',dmin:1.8,dmax:2.1}],{}).geometry,false);
  assert.throws(()=>A.buildRestraintTables(demand,[{a:'CU',b:'O',count:6,countMode:'exact',dmin:1.8,dmax:2.1,geometry:'tetrahedral'}],{}),/needs exactly 4 neighbours/);
  assert.throws(()=>A.buildRestraintTables(demand,[{a:'CU',b:'O',count:4,countMode:'exact',dmin:1.8,geometry:'tetrahedral'}],{}),/upper distance/);
  // P-1: Cu is not a default tetrahedral former, so only a stated tetrahedron keeps it off the inversion centres
  const s=db[2].settings[0],count=geometry=>A.enumerateAssignments(s.wyckoff,[{element:'CU',count:1,z:29,r:1},{element:'O',count:4,z:8,r:1}],{ceiling:24,symOps:s.sym_ops,coordination:{CU:{count:4,geometry}}}).assignments.length;
  assert.ok(count('square-planar')>0);assert.equal(count('tetrahedral'),0);
});
test('intensity extraction rejects malformed and excessive reflection limits before dispatch', async () => {
  const a=model();a.state.setCalculation('wppf');
  for(const maxRefl of ['10k','1000k',1e6,0,-1,4.5,NaN,Infinity]){
    await assert.rejects(a.context.RV.cmd.extract(a.ds,{phase:0,maxRefl}),/whole number/);
    assert.equal(a.S.busy,false);
  }
});

test('ESD, FXYE and XYE uncertainties reach the fit weights', async () => {
  const a = app();
  await a.context.RV.cmd.readFiles([
    file('scan.esd', 'BANK 1 2 1 CONST 1000 100 0 0 ESD\n100 2 400 30'),
    file('scan.gsa', 'BANK 1 2 1 CONST 1000 100 0 0 FXYE\n1000 100 2\n1100 400 30'),
    file('scan.xye', '10 100 2\n11 400 30')
  ]);
  assert.equal(a.S.datasets.length, 3);
  for (const ds of a.S.datasets) {
    assert.deepEqual(Array.from(ds.sig), [2, 30]);
    assert.deepEqual(Array.from(a.state.fitPoints(ds).w), [0.25, 1 / 900]);
  }
});

test('uncertainties and explicit weights follow sorted, filtered and duplicate points', () => {
  const a = app();
  const parsed = a.run("normalizeParsedData({tth:[12,NaN,10,11,11],intensity:[120,5,100,110,999],sig:[12,1,2,3,9],weights:[.1,.2,.3,0,.9]})");
  assert.deepEqual(plain(parsed), { tth: [10, 11, 12], intensity: [100, 110, 120], sig: [2, 3, 12], weights: [0.3, 0, 0.1] });
  assert.throws(() => a.run("detectAndParseFile('bad.esd','BANK 1 2 1 CONST 1000 100 0 0 ESD\\n100 0 400 30')"), /uncertainty/);
  assert.throws(() => a.run("parseDataFile('10 100 -1\\n11 400 30','bad.xye')"), /uncertainty/);
});

test('pdCIF weights, including zero, survive unit weights, projects and undo', async () => {
  const a = app();
  await a.context.RV.cmd.readFiles([file('weights.cif', 'data_weights\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n_pd_proc_ls_weight\n10 100 .25\n11 400 0\n12 500 .1\n')]);
  let ds = a.S.datasets[0];
  assert.deepEqual(Array.from(a.state.fitPoints(ds).w), [0.25, 0, 0.1]);
  a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
  ds = a.S.datasets[0];
  assert.deepEqual(Array.from(ds.weights), [0.25, 0, 0.1]);
  a.context.RV.history.take('weight change'); a.state.setSetting('weight', 'unit');
  assert.deepEqual(Array.from(a.state.fitPoints(ds).w), [1, 0, 1]);
  a.context.RV.history.undo(); ds = a.S.datasets[0];
  assert.deepEqual(Array.from(a.state.fitPoints(ds).w), [0.25, 0, 0.1]);
});

test('adding and removing phases invalidates active and saved calculation results', () => {
  for (const action of ['add', 'remove']) {
    const a = fitted(); a.state.saveCalculation();
    assert.equal(a.ds.stats.Rwp, 0);
    if (action === 'remove') a.state.removePhase('p1');
    else a.state.addPhase(a.state.makePhase({ name: 'extra', sg: a.state.resolveSG(221), cell: { a: 8 },
      atoms: [{ label: 'C1', type: 'C', x: 0, y: 0, z: 0 }] }));
    assert.equal(a.ds.stats, null); assert.equal(Object.keys(a.ds.esd).length, 0);
    assert.equal(a.ds.calculations.rietveld.stats, null);
    assert.equal(a.ds.calculations.rietveld.ints, null);
    assert.equal(a.context.RV.results.statsOf(a.ds).fitted, false);
  }
});

test('each pdCIF block retains its wavelength and every profile is imported', async () => {
  const text = 'data_cu\n_diffrn_radiation_wavelength 1.540598\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n10 100\n11 200\ndata_co\n_diffrn_radiation_wavelength 1.788965\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n20 300\n21 400\n';
  const a = app(); a.context.input = text;
  const profiles = a.run('parsePdCifFiles(input)');
  assert.deepEqual(Array.from(profiles, p => p.wavelength), [1.540598, 1.788965]);
  await a.context.RV.cmd.readFiles([file('multi.cif', text)]);
  assert.equal(a.S.datasets.length, 2);
  assert.deepEqual(Array.from(a.S.datasets, d => d.inst.lambda1), [1.540598, 1.788965]);
  assert.deepEqual(Array.from(a.S.datasets[0].y), [100, 200]);
  assert.deepEqual(Array.from(a.S.datasets[1].y), [300, 400]);
});

test('neutron and explicit single-line pdCIF imports do not acquire a doublet', async () => {
  const a = app();
  for (const probe of ['neutron', 'x-ray']) {
    await a.context.RV.cmd.readFiles([file('single.cif', 'data_single\n_diffrn_radiation.probe ' + probe + '\n_diffrn_radiation_wavelength 1.540598\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n10 100\n11 200\n')]);
    const inst = a.S.datasets[0].inst;
    assert.equal(inst.radiation, probe === 'neutron' ? 'neutron' : 'xray');
    assert.equal(inst.lambda2, 0); assert.equal(inst.ratio, 0);
    if (probe === 'neutron') assert.equal(a.state.polK(inst), 0);
  }
});

test('CIF comments, quoted hashes, wrapped rows and multiline fields preserve atoms', () => {
  const a = app();
  a.context.input = "data_test\n_chemical_name_common\n;\nloop_\ndata_not_a_block\n;\n_cell_length_a\n5\n_space_group_IT_number 1\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n'C#1' C .1 .2 .3 # note with arbitrary tokens\nO1 O .4\n.5 .6 # another note\n";
  const cif = a.run('CifStructure.parse(input)');
  assert.equal(cif.blocks, 1); assert.equal(cif.cell.a, 5); assert.equal(cif.atoms.length, 2);
  assert.equal(cif.atoms[0].siteLabel, 'C#1'); assert.equal(cif.atoms[1].z, 0.6);
  a.context.input = 'data_p\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n10\n100 # comment\n11 200\n';
  assert.deepEqual(Array.from(a.run('parsePdCifFile(input).intensity')), [100, 200]);
  assert.throws(() => a.run("CifStructure.parse('data_bad\\nloop_\\n_atom_site_label\\n_atom_site_fract_x\\nC1')"), /Incomplete CIF loop/);
});

test('Rietveld rejects missing factors in the UI and fit core; zero neutron lengths remain valid', () => {
  const a = model(); a.S.tables = null;
  assert.match(a.state.calculationIssue(), /Missing scattering factors/);
  assert.throws(() => a.state.jobFor(a.ds), /Missing scattering factors/);
  // Isolate the core's missing-f0 validation from the separate anomalous-table check.
  a.ds.inst.anomalousEnabled=false;
  const result = a.core.refine(a.state.problemFor([a.ds]), { evaluateOnly: true });
  assert.equal(result.ok, false); assert.match(result.msg, /Missing X-ray scattering factor/);
  a.state.setCalculation('wppf');
  assert.equal(a.state.calculationIssue(), '');
  a.state.setCalculation('rietveld');
  a.state.setTables({ neutron: { table: { Si: { b_coh: 0 }, Na: { b_coh: -3 } } } });
  a.ds.inst.radiation = 'neutron';
  assert.equal(a.state.calculationIssue(), '');
  assert.equal(a.core.refine(a.state.problemFor([a.ds]), { evaluateOnly: true }).ok, true);
});

test('pdCIF export/reimport preserves radiation, wavelengths, zero, weights and phase associations', async () => {
  const a = model(), first = a.ds;
  first.phases = ['p1']; first.inst.ratio = 0.47; first.inst.lambda2 = 1.544426; first.p.zero = 0.12;
  first.weights = Float64Array.from(first.tth, (_, i) => i === 5 ? 0 : 0.25);
  a.state.invalidate(first);
  const second = a.state.makeDataset({ name: 'neutron', tth: first.tth, y: first.y, phases: ['p2'],
    inst: { radiation: 'neutron', lambda1: 1.8, lambda2: 0, ratio: 0, bkgN: 1 }, p: { zero: -0.07 } });
  a.S.datasets.push(second);
  const text = a.context.RV.results.cifText([first, second], true);
  a.context.input = text;
  const profiles = a.run('parsePdCifFiles(input)');
  assert.equal(profiles[0].wavelength2, 1.544426); assert.equal(profiles[0].ratio21, 0.47);
  assert.equal(profiles[0].zeroShift, 0.12); assert.equal(profiles[0].weights[5], 0);
  assert.equal(profiles[1].radiation, 'neutron'); assert.equal(profiles[1].zeroShift, -0.07);
  const b = app(); await b.context.RV.cmd.readFiles([file('roundtrip.cif', text)]);
  assert.equal(b.messages.filter(m => m.kind === 'err').length, 0, JSON.stringify(b.messages));
  assert.equal(b.S.datasets.length, 2); assert.equal(b.S.phases.length, 2);
  assert.equal(b.S.datasets[0].phases.length, 1); assert.equal(b.S.datasets[1].phases.length, 1);
  assert.notEqual(b.S.datasets[0].phases[0], b.S.datasets[1].phases[0]);
  assert.equal(b.S.datasets[0].inst.ratio, 0.47); assert.equal(b.S.datasets[1].inst.radiation, 'neutron');
  assert.equal(b.S.datasets[1].p.zero, -0.07);
});

test('every session starts as a Cu X-ray tube, whatever instrument the last one ended with', () => {
  const a = app();
  const neutron = { anode: '', lambda1: 1.54, lambda2: 0, ratio: 0, radiation: 'neutron', pol: 'none', monoTth: 26.6, polFrac: .95, radiusMM: 0, resolutionType: 'tch_aniso', bkgType: 'cheb', bkgN: 6, bkgX: [], excl: [] };
  a.storage.set('powder6.settings', JSON.stringify({ weight: 'unit', yscale: 'sqrt', inst: neutron }));
  a.state.restore();
  const i = a.S.settings.inst;
  assert.deepEqual([i.anode, i.lambda1, i.lambda2, i.ratio, i.radiation, i.pol], ['Cu', 1.540598, 1.544426, 0.5, 'xray', 'tube']);
  assert.equal(a.S.settings.weight, 'unit', 'the other remembered settings must survive');
  assert.equal(a.S.settings.yscale, 'sqrt');
  const ds = a.state.makeDataset({ name: 'new', tth: [10, 11, 12], y: [1, 2, 3] });
  assert.deepEqual([ds.inst.anode, ds.inst.radiation, ds.inst.pol], ['Cu', 'xray', 'tube'], 'a new pattern starts as the Cu tube');
});
test('opening a project clears every restore point and reads the project as saved', async () => {
  const a = fitted(), H = a.context.RV.history;
  H.take('an edit before'); H.take('another edit');
  const project = JSON.parse(a.state.projectJSON([]));
  project.settings.weight = 'unit'; project.settings.bkgN = 2; project.settings.nAnchors = 4; project.settings.inst.lambda1 = 2;
  await a.context.RV.cmd.openProject(JSON.stringify(project));
  assert.equal(a.context.RV.project.hasUnsavedChanges(),false,'An opened project should not warn on leaving');
  assert.equal(a.S.settings.weight, 'unit');
  assert.equal(H.count(), 0, 'restore points of the previous session survived');
  H.undo();
  assert.equal(a.S.settings.weight, 'unit'); assert.equal(a.S.settings.bkgN, 2); assert.equal(a.S.settings.nAnchors, 4);
  assert.equal(a.S.settings.inst.lambda1, 2);
  assert.equal(JSON.parse(a.storage.get('powder6.settings')).weight, 'unit');
});
test('a saved project brings back the active method intensities and the remembered values of each dataset', () => {
  const a = model(); a.state.setCalculation('lebail');
  Object.keys(a.ds.fit).forEach(k => { a.ds.fit[k] = k === 'bkg0'; });
  const job = a.state.jobFor(a.ds), result = a.core.refine(job);
  assert.equal(result.ok, true, result.msg); a.state.applyResult([a.ds], result, job, false);
  assert.ok(a.ds.ints, 'the Le Bail fit gave no intensities');
  a.ds.mem['p9.gone.B'] = [1.25, true];
  const ints = JSON.stringify(a.ds.ints);
  a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
  const d = a.S.datasets[0];
  assert.equal(JSON.stringify(d.ints), ints, 'the Le Bail intensities were dropped on load');
  assert.deepEqual(plain(d.mem['p9.gone.B']), [1.25, true]);
});

test('MOL/SDF and PDB CRYST1 are read; a fragment lands on general positions with its geometry and restraints', () => {
  const MR = require('../js/molecule_rules.js');
  const mol = MR.read(`x
  prog

  2  1  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0
    1.5400    0.0000    0.0000 O   0  0
  1  2  1  0
M  END
$$$$
`, { name: 'x.sdf' });
  assert.equal(mol.format, 'MOL'); assert.deepEqual(mol.atoms.map(a => a.name), ['C1', 'O1']);
  assert.throws(() => MR.read(`x


  0  0  0     0  0            999 V3000
`, { name: 'x.mol' }), /V3000/);
  const pdb = `CRYST1   10.000   12.000    8.000  90.00 100.00  90.00 P 1 21/c 1     4
ATOM      1  C1  MOL     1       1.000   2.000   3.000  1.00  0.00           C
ATOM      2  O1  MOL     1       2.200   2.000   3.000  1.00  0.00           O
`;
  const withCell = MR.read(pdb, { name: 'x.pdb' });
  assert.equal(withCell.cell.beta, 100);
  const asIs = MR.fragment(withCell, {});
  assert.ok(Math.abs(asIs.atoms[0].z - 3 / (8 * Math.sin(100 * Math.PI / 180))) < 1e-9, 'CRYST1 orthogonalisation');
  assert.equal(MR.read(read('test_files/cimetidine/cime.pdb'), { name: 'cime.pdb' }).cell, null);

  const a = app(), St = a.state, cif = a.context.CifStructure.parse(read('test_files/cimetidine_C10H16N6S.CIF'));
  const ph = St.makePhase({ name: 'cimetidine', sg: St.resolveFileSG({ symbol: cif.sgName, hall: cif.sgHall, number: cif.sgNumber }, cif.cell), cell: cif.cell, atoms: [] });
  St.addPhase(ph);
  const cime = MR.read(read('test_files/cimetidine/cime.pdb'), { name: 'cime.pdb' });
  const p = MR.generalPoint(ph.ops, cif.cell);
  const r = a.context.RV.cmd.fragmentInto(ph, cime, { mode: 'add', centre: p, skipH: true, restraints: true, B: 3 });
  assert.equal(r.atoms, 17); assert.equal(ph.atoms.length, 17); assert.equal(r.special.length, 0);
  assert.deepEqual(plain(ph.atoms.map(at => at.label).slice(0, 5)), ['C1', 'N1', 'C2', 'N2', 'C3']);
  assert.ok(ph.atoms.every(at => at.site.mult === ph.ops.length), 'every fragment atom on a general position');
  // the fragment keeps the bond lengths of the file: C1-N1 of cime.pdb
  const cart = f => { const c = cif.cell, d = Math.PI / 180, cb = Math.cos(c.beta * d), sb = Math.sin(c.beta * d); return [c.a * f[0] + c.c * cb * f[2], c.b * f[1], c.c * sb * f[2]]; };
  const at = l => cart(['x', 'y', 'z'].map(k => ph.v[ph.key + '.' + l + '.' + k]));
  const d = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
  assert.ok(Math.abs(d(at('C1'), at('N1')) - d(cime.atoms[0].xyz, cime.atoms[1].xyz)) < 1e-6);
  assert.ok(r.bonds >= 17 && r.angles > 0, 'restraints written');
  assert.ok(/^C1 N1 - /m.test(ph.restraints.text));
  assert.equal(a.context.AtomRestraints.check(ph.atoms, ph.restraints).errors.length, 0);
  // a second fragment is numbered past the first; replace starts again at 1
  a.context.RV.cmd.fragmentInto(ph, cime, { mode: 'add', centre: [0.1, 0.6, 0.7], skipH: true, restraints: false });
  assert.equal(ph.atoms.length, 34); assert.ok(ph.atoms.some(x => x.label === 'C11'));
  a.context.RV.cmd.fragmentInto(ph, cime, { mode: 'replace', centre: p, skipH: false, restraints: true });
  assert.equal(ph.atoms.length, 33); assert.equal(ph.atoms[0].label, 'C1');
  assert.ok(!/C11|C20/.test(ph.restraints.text), 'rules of the replaced atoms were pruned');
});

const PBSO4_CIF = ['data_PbSO4', '_cell_length_a 8.4818', '_cell_length_b 5.3998', '_cell_length_c 6.9614', '_cell_angle_alpha 90', '_cell_angle_beta 90', '_cell_angle_gamma 90',
  "_space_group_name_H-M_alt 'P n m a'", '_space_group_IT_number 62', 'loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y', '_atom_site_fract_z', '_atom_site_B_iso_or_equiv',
  'Pb1 Pb 0.1879 0.25 0.1671 1.5', 'S1 S 0.0654 0.25 0.6845 0.8', 'O1 O 0.9083 0.25 0.5953 1.6', 'O2 O 0.1932 0.25 0.5432 1.5', 'O3 O 0.0811 0.0272 0.8086 1.3'].join(String.fromCharCode(10));
test('atoms from a structure CIF go into an existing phase: replace or add, with what does not match said', () => {
  const a = app(), St = a.state, text = PBSO4_CIF, cif = a.context.CifStructure.parse(text);
  const ph = St.makePhase({ name: 'PbSO4', sg: St.resolveSG(62), cell: cif.cell, atoms: [{ label: 'X1', type: 'O', x: 0.1, y: 0.25, z: 0.1 }] });
  St.addPhase(ph);
  let r = a.context.RV.cmd.atomsFromCifText(ph, text, 'replace');
  assert.equal(r.n, cif.atoms.length); assert.equal(ph.atoms.length, cif.atoms.length); assert.equal(r.notes.length, 0, r.notes.join(' | '));
  assert.ok(!ph.atoms.some(x => x.label === 'X1'));
  r = a.context.RV.cmd.atomsFromCifText(ph, text, 'add');
  assert.equal(ph.atoms.length, 2 * cif.atoms.length);
  assert.equal(new Set(ph.atoms.map(x => x.label)).size, ph.atoms.length, 'added labels are made unique');
  const p1 = St.makePhase({ name: 'P1', sg: St.resolveSG(1), cell: { a: 5, b: 6, c: 7, alpha: 90, beta: 90, gamma: 90 }, atoms: [] });
  St.addPhase(p1);
  r = a.context.RV.cmd.atomsFromCifText(p1, text, 'add');
  assert.ok(r.notes.some(n => /Pnma|62/.test(n) && /sites of/.test(n)), r.notes.join(' | '));
  assert.ok(r.notes.some(n => /differs/.test(n)));
  assert.throws(() => a.context.RV.cmd.atomsFromCifText(p1, `data_x
_cell_length_a 5
`, 'add'), /no atom sites/);
});

test('a dataset saved without an id does not take the id of a later dataset', () => {
  const a = app();
  a.state.commitProject(a.state.prepareProject({ format: 'powder6-project', version: 3, phases: [], datasets: [
    { name: 'old', tth: [10, 11, 12], y: [1, 2, 3] }, { id: 1, name: 'new', tth: [10, 11, 12], y: [4, 5, 6] }] }));
  const ids = a.S.datasets.map(d => d.id);
  assert.equal(new Set(ids).size, 2, 'duplicate dataset ids ' + ids);
  assert.equal(a.state.byId(1).name, 'new');
  assert.ok(a.S.nextId > Math.max(...ids));
});

test('undo keeps the Le Bail intensities of the last fit', () => {
  const a = model(); a.state.setCalculation('lebail');
  Object.keys(a.ds.fit).forEach(k => { a.ds.fit[k] = k === 'bkg0'; });
  const job = a.state.jobFor(a.ds), result = a.core.refine(job);
  assert.equal(result.ok, true, result.msg); a.state.applyResult([a.ds], result, job, false);
  const ints = a.S.datasets[0].ints;
  assert.ok(ints, 'the Le Bail fit gave no intensities');
  const H = a.context.RV.history;
  H.take('rename'); a.state.rename(a.S.datasets[0].id, 'renamed'); H.undo();
  assert.equal(a.S.datasets[0].name, 'mixture');
  assert.equal(a.S.datasets[0].ints, ints, 'undo dropped the intensities');
});

test('bundled powder data and pdCIF fixtures remain readable', async () => {
  const a = app();
  const files = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? files(dir + '/' + e.name) : [dir + '/' + e.name]);
  // patterns only: molecules and saved projects kept beside them are not
  for (const name of files('test_files').filter(f => !/\.(pdb|project|archive|powder6)$/i.test(f))) {
    const bytes = fs.readFileSync(path.join(root, name));
    a.context.inputName = name;
    a.context.inputBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parsed = await a.run('(async()=>normalizeParsedData(await detectAndParseBuffer(inputName,inputBytes),inputName))()');
    assert.ok(parsed.tth.length > 2, name);
    assert.ok(parsed.tth[0] < parsed.tth[parsed.tth.length - 1], name);
  }
});

test('GSAS-II export respects imported weights and omits zero-weight observations', () => {
  const a = model();
  a.ds.weights = Float64Array.from(a.ds.tth, (_, i) => i === 5 ? 0 : 0.25);
  const lines = a.context.RV.gsas2.xyeOf(a.ds).split('\n').filter(line => line && !line.startsWith('#'));
  assert.equal(lines.length, a.ds.tth.length - 1);
  assert.equal(Number(lines[0].trim().split(/\s+/)[2]), 2);
  assert.ok(!lines.some(line => Number(line.split(/\s+/)[0]) === a.ds.tth[5]));
});

test('pdCIF range axes, wavelength loops, calibration and reflection aliases still work', () => {
  const a = app();
  a.context.input = `data_range
_cell_length_a 5
_space_group_name_Hall 'P 1'
_pd_meas_2theta_range_min 10
_pd_meas_2theta_range_inc .5
loop_
_diffrn_radiation_wavelength_id
_diffrn_radiation_wavelength
_diffrn_radiation_wavelength_wt
2 1.544426 .5
1 1.540598 1
loop_
_pd_calib_xcoord.nominal_2theta
_pd_calib_xcoord.actual_2theta
10 9.9
20 19.9
loop_
_refln_index_h
_refln_index_k
_refln_index_l
_refln_f_squared_meas
_refln_f_squared_sigma
1 0 0 100 5
loop_
_pd_meas_intensity_total
_pd_calc_intensity_total
_pd_calc_intensity_bkg
100(2) 98 4
200(3) 195 5
`;
  const p = a.run('parsePdCifFile(input)');
  assert.deepEqual(Array.from(p.tth), [10, 10.5]);
  assert.deepEqual(Array.from(p.sig), [2, 3]);
  assert.deepEqual(Array.from(p.calc), [98, 195]);
  assert.deepEqual(Array.from(p.bkg), [4, 5]);
  assert.equal(p.wavelength, 1.540598); assert.equal(p.ratio21, 0.5);
  assert.ok(Math.abs(p.zeroShift - 0.1) < 1e-12);
  assert.equal(p.hklList[0].Fsq_sigma, 5); assert.equal(p.spaceGroup.hall, 'P 1');
  assert.equal(p.cell.a, 5); assert.equal(p.hasCalculatedData, true);
  a.context.input = 'data_calc\nloop_\n_pd_meas_2theta_scan\n_pd_calc_intensity_total\n10 100\n11 200\n';
  const simulation = a.run('parsePdCifFile(input)');
  assert.equal(simulation.hasCalculatedData, false); assert.equal(simulation.calc, null);
});

test('the bundled demo generates patterns and its default Rietveld fit succeeds', async () => {
  const a = app(); await a.context.RV.cmd.demo();
  assert.equal(a.S.datasets.length, 2); assert.equal(a.S.phases.length, 2);
  const job = a.state.jobFor(a.S.datasets[0]); job.maxIter = 5;
  const result = a.core.refine(job);
  assert.equal(result.ok, true, result.msg);
  assert.ok(Number.isFinite(result.stats[0].Rwp));
});

test('async PT falls back to the unchanged seeded CPU search when WebGPU fails', async () => {
  const a = model(), job = a.state.jobFor(a.ds);
  job.algorithm = 'pt'; job.pt = { chains: 2, sweeps: 10, maxTemp: 5, seed: 771 }; job.maxIter = 2;
  const expected = a.core.refine(job);
  let called = 0;
  const actual = await a.core.refineAsync(job, { ptBackend: async ctx => {
    called++;
    assert.equal(ctx.setup.sweeps, 10); assert.equal(ctx.setup.chains, 2);
    assert.ok(Number.isFinite(ctx.cost(ctx.x)));
    throw new Error('test device lost');
  } });
  assert.equal(called, 1); assert.equal(actual.ok, true, actual.msg);
  assert.deepEqual(plain(actual.values), plain(expected.values));
  assert.equal(actual.chi2, expected.chi2); assert.equal(actual.pt.backend, 'cpu');
  assert.match(actual.pt.fallbackReason, /device lost/);
});

test('GPU PT hands its checked best candidate to LM with combined progress and metadata', async () => {
  const a = model(), job = a.state.jobFor(a.ds), progress = [];
  job.algorithm = 'pt'; job.pt = { chains: 2, sweeps: 10, maxTemp: 5, seed: 19 }; job.maxIter = 2;
  a.ds.p.bkg0 = 10; job.values[0].bkg0 = 10;
  const result = await a.core.refineAsync(job, { linearStart: false, onIter: p => progress.push(p), ptBackend: async ctx => {
    const x = Float64Array.from(ctx.x); x[0] = 17;
    assert.ok(ctx.cost(x) < ctx.setup.initialCost);
    return { x, pt: { backend: 'webgpu', chains: 2, sweeps: 10, seed: 19 } };
  } });
  assert.equal(result.ok, true, result.msg); assert.equal(result.effectiveAlgorithm, 'pt+lm');
  assert.equal(result.pt.backend, 'webgpu'); assert.ok(result.iter >= 10);
  assert.ok(Math.abs(result.values[0].bkg0 - 17) < 1e-9);
});

test('WebGPU PT compiles all profile types and joint intensity methods from their real model definitions', async () => {
  for (const method of ['rietveld', 'lebail', 'wppf']) {
    for (const profileType of ['simple_pvoigt', 'split_pvoigt', 'tch_aniso', 'gsas_cw']) {
      const a = app(); a.S.calculation = method;
      a.state.addPhase(a.state.makePhase({ name: 'C', sg: a.state.resolveSG(1), cell: { a: 3, b: 3.4, c: 3.7, alpha: 87, beta: 94, gamma: 102 }, profileType,
        atoms: [{ label: 'C1', type: 'C', x: .13, y: .21, z: .32, B: .5, occ: 1 }] }));
      const ds = a.state.makeDataset({ name: 'sample', tth: [15, 25, 35, 45], y: [10, 15, 20, 25], inst: { bkgN: 1, lambda2: 1.544, ratio: .5 } });
      a.S.datasets.push(ds); a.state.selectIds([ds.id]); ds.fit.bkg0 = true;
      const job = a.state.jobFor(ds); job.algorithm = 'pt'; job.pt = { chains: 2, sweeps: 10, maxTemp: 5, seed: 19 }; job.maxIter = 1;
      vm.runInContext(read('js/pt_gpu.js'), a.context);
      let compiled = false;
      const result = await a.core.refineAsync(job, { ptBackend: ctx => {
        const plan = a.context.RVPTGPU.compile(ctx); compiled = true;
        assert.equal(plan.chains, 2); assert.ok(plan.reflectionCount > 0);
        assert.ok(Array.from(plan.data).every(Number.isFinite));
        assert.ok(plan.shader.includes('@compute')); assert.ok(!plan.shader.includes('/*GENERATED*/'));
        assert.equal(plan.datasets[0].m > 0, method !== 'rietveld');
        return { x: ctx.x, pt: { backend: 'webgpu', sweeps: 10 } };
      } });
      assert.equal(compiled, true, method + ' ' + profileType); assert.equal(result.ok, true, result.msg);
    }
  }
});

test('PT reflection envelope covers expanded and oblique trial cells', () => {
  const a = app(), sg = a.state.resolveSG(1), initial = { a: 3, b: 4, c: 5, alpha: 90, beta: 90, gamma: 90 };
  const envelope = a.core.generateReflections(initial, sg.ops, 1, [6, 8, 10]);
  const keys = new Set(envelope.map(r => [r.h, r.k, r.l].join(',')));
  for (const cell of [{ a: 6, b: 8, c: 10, alpha: 90, beta: 90, gamma: 90 }, { a: 5, b: 7, c: 9, alpha: 72, beta: 108, gamma: 115 }]) {
    for (const r of a.core.generateReflections(cell, sg.ops, 1)) assert.ok(keys.has([r.h, r.k, r.l].join(',')));
  }
});

test('missing WebGPU uses CPU PT, while LM and extraction never request a GPU', async () => {
  const a = model(), job = a.state.jobFor(a.ds);
  vm.runInContext(read('js/pt_gpu.js'), a.context);
  job.algorithm = 'pt'; job.pt = { chains: 2, sweeps: 10, maxTemp: 5, seed: 771 }; job.maxIter = 1;
  const result = await a.core.refineAsync(job);
  assert.equal(result.ok, true, result.msg); assert.equal(result.pt.backend, 'cpu');
  assert.match(result.pt.fallbackReason, /WebGPU is unavailable/);
  let called = 0;
  const opts = { ptBackend: () => { called++; throw new Error('Must not initialize GPU'); } };
  job.algorithm = 'lm';
  assert.equal((await a.core.refineAsync(job, opts)).ok, true);
  job.algorithm = 'pt';
  assert.equal((await a.core.refineAsync(job, { ...opts, evaluateOnly: true })).ok, true);
  assert.equal(called, 0);
});

test('manual background anchors use both cursor coordinates and keep existing anchors', () => {
  const a = model(); a.context.RV.plots = { anchorAt: () => null };
  a.context.RV.cmd.markAt(25, 42.75, 100, 120);
  assert.equal(a.ds.inst.bkgType, 'spline');
  let k = a.ds.inst.bkgX.indexOf(25); assert.ok(k >= 0);
  assert.equal(a.ds.p['bga' + k], 42.75);
  a.ds.fit['bga' + k] = false;
  a.context.RV.cmd.markAt(45, 18.125, 200, 150);
  assert.equal(a.ds.p['bga' + a.ds.inst.bkgX.indexOf(45)], 18.125);
  assert.equal(a.ds.p['bga' + a.ds.inst.bkgX.indexOf(25)], 42.75);
  assert.equal(a.ds.fit['bga' + a.ds.inst.bkgX.indexOf(25)], false);
  a.context.RV.history.undo();
  const restored = a.state.byId(a.ds.id);
  assert.equal(restored.inst.bkgX.includes(45), false);
  assert.equal(restored.p['bga' + restored.inst.bkgX.indexOf(25)], 42.75);
});

test('moving anchors preserves point identity across sorting and retains separate method backgrounds', () => {
  const a = model(); a.state.setInstrument([a.ds], { bkgType: 'spline', bkgX: [10, 30, 60] });
  [12, 24, 36].forEach((v,k) => { a.ds.p['bga' + k] = v; a.ds.fit['bga' + k] = k !== 1; });
  a.state.saveCalculation(); const bank = plain(a.ds.calculations.rietveld);
  const index = a.state.moveBackgroundAnchor(a.ds, 0, 45, 21.5);
  assert.equal(index, 1);
  assert.deepEqual(plain(a.ds.inst.bkgX), [30, 45, 60]);
  assert.deepEqual([a.ds.p.bga0, a.ds.p.bga1, a.ds.p.bga2], [24, 21.5, 36]);
  assert.deepEqual([a.ds.fit.bga0, a.ds.fit.bga1, a.ds.fit.bga2], [false, true, true]);
  assert.deepEqual(plain(a.ds.calculations.rietveld), bank);
  assert.equal(a.state.moveBackgroundAnchor(a.ds, 1, 60, 99), -1);
  assert.equal(a.state.moveBackgroundAnchor(a.ds, 1, 60 - .0000005, 99), -1);
  assert.deepEqual(plain(a.ds.inst.bkgX), [30, 45, 60]);
  assert.equal(a.ds.p.bga1, 21.5);
  a.state.setCalculation('wppf');
  a.state.setInstrument([a.ds], { bkgType: 'spline', bkgX: [10, 70] });
  a.state.setParam('bga0', 9, [a.ds]);
  a.state.setCalculation('rietveld');
  assert.deepEqual(plain(a.ds.inst.bkgX), [30, 45, 60]); assert.equal(a.ds.p.bga1, 21.5);
  a.state.setCalculation('wppf');
  assert.deepEqual(plain(a.ds.inst.bkgX), [10, 70]); assert.equal(a.ds.p.bga0, 9);
});

test('Sample and Resolution group controls change only their eligible selected parameters', () => {
  const a = model();
  a.S.phases[1].profileType = 'simple_pvoigt'; a.S.phases[1].separatedProfile = false;
  a.S.phases[0].profileType = 'gsas_cw'; a.state.phaseChanged(a.S.phases[0]);
  const other = a.state.makeDataset({ name: 'untouched', tth: [10,20], y: [50,50] }); a.S.datasets.push(other);
  const before = plain(other.fit);
  Object.keys(a.ds.fit).forEach(n => { a.ds.fit[n] = false; });
  a.context.RV.cmd.setFitGroup('profile', true);
  assert.equal(a.ds.fit['p1.size'], true); assert.equal(a.ds.fit['p1.sizeMix'], true);
  assert.equal(a.ds.fit['p2.GU'], true); assert.equal(a.ds.fit['inst.U'], false);
  assert.equal(a.ds.fit.bkg0, false);
  a.context.RV.cmd.setFitGroup('resolution', true);
  assert.equal(a.ds.fit['inst.U'], true); assert.equal(a.ds.fit['inst.SL'], true);
  assert.equal(a.ds.fit['inst.U_L'], false);
  assert.equal(a.context.RV.cmd.fitGroupState('resolution').total, 8);
  assert.deepEqual(plain(other.fit), before);
});

test('Le Bail and WPPF display Rietveld atomic values across edits and project reloads', () => {
  const a = model(), name = 'p1.Si1.B';
  a.state.setParam(name, 1.2, [a.ds]); a.state.setCalculation('lebail');
  a.ds.p[name] = 9.4; // An older method snapshot can contain unused stale values.
  a.state.saveCalculation(); assert.equal(a.state.atomicValues(a.ds)[name], 1.2);
  a.state.setCalculation('rietveld'); a.state.setParam(name, 2.1, [a.ds]);
  a.state.setCalculation('lebail');
  assert.equal(a.ds.p[name], 9.4); assert.equal(a.state.atomicValues(a.ds)[name], 2.1);
  a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
  assert.equal(a.state.atomicValues(a.S.datasets[0])[name], 2.1);
  a.state.setCalculation('wppf'); assert.equal(a.state.atomicValues(a.S.datasets[0])[name], 2.1);
});

test('Le Bail and WPPF exports retain their cell and use the Rietveld atomic model', () => {
  const a = model(), B = 'p1.Si1.B', occ = 'p1.Si1.occ';
  a.state.setParam(B, 1.75, [a.ds]); a.state.setParam(occ, .6, [a.ds]);
  for (const method of ['lebail', 'wppf']) {
    a.state.setCalculation(method);
    a.ds.p[B] = 8.5; a.ds.p[occ] = .9; a.ds.p['p1.a'] = 5.25;
    a.ds.esd[B] = .3; // A free-intensity fit must not give the displayed atom a spurious uncertainty.
    const cif = a.context.RV.results.cifText([a.ds], false, 'p1');
    assert.match(cif, /_cell_length_a 5\.25/);
    assert.match(cif, /'Si1' 'Si' 0 0 0 0\.6 1\.75\n/);
    assert.match(cif, /Rietveld atomic model; unused by/);
    const gsas = a.context.RV.gsas2.cifOf(a.S.phases[0], a.ds);
    assert.match(gsas, /_cell_length_a 5\.250000/);
    const atom = gsas.split('\n').find(line => line.startsWith('Si1 ')).split(/\s+/);
    assert.equal(Number(atom[5]), .6);
    assert.ok(Math.abs(Number(atom[6]) * 8 * Math.PI ** 2 - 1.75) < .00005);
    const report = a.context.RV.results.reportText([a.ds]);
    const row = report.split('\n').find(line => line.startsWith('Si1\t')).split('\t');
    assert.equal(row.at(-1), '1.75'); assert.equal(row.at(-2), '0.6');
    assert.match(report, /content\tSi0\.6/);
    assert.equal(a.ds.p[B], 8.5, 'Export changed a saved method value');
  }
});

test('a History run report lists settings, phases, statistics and every parameter with its e.s.d.', () => {
  const a=fitted(),h=a.context.RV.fitHistory;
  a.ds.stats=Object.assign({},a.ds.stats || {},{ok:true,msg:'converged',Rp:.0512,Rwp:.0734,n:1200,nVar:7});
  a.ds.esd=Object.assign({},a.ds.esd,{bkg0:.25});
  const r=h.complete(h.begin([a.ds],false),[a.ds]),text=h.runReport(r);
  assert.match(text,new RegExp('# Powder 6 .* '+r.id));
  assert.match(text,/## Run\nRecord\trun-\d+/);
  assert.match(text,/## Phases \(\d+\)/);
  assert.match(text,/Rp\t5\.12 %/);assert.match(text,/Rwp\t7\.34 %/);assert.match(text,/Points fitted\t1200/);
  assert.match(text,/## Parameters \(\d+ refined of \d+\)/);
  assert.match(text,/\nbkg0\t[^\t]+\t0\.25\t/);
  assert.match(text,/## Instrument and background/);
});
test('a stopped Wyckoff solution in History reports its solutions and sites, and History survives save and load', () => {
  const a=fitted(),h=a.context.RV.fitHistory;
  const I={dsId:a.ds.id,dsName:a.ds.name,phaseName:'test',phaseKey:'p1',sg:{symbol:'Fm-3m',number:225}};
  const site={element:'Na',wyckoff:'4a',multiplicity:4,x:0,y:0,z:0};
  h.solution('wy',{I,formula:'NaCl',n:20,note:'',o:{particles:64,iterations:10,restarts:1},stopped:true,salvaged:'Stopped.',seconds:'1.0',pick:0,
    sols:[{z:4,rho:2.16,assignment:'Na 4a, Cl 4b',refinement:{R:.08},searchCC:.95,sites:[site]},{z:8,assignment:'Na 8c',refinement:null,unrefined:true,ranked:false,sites:[site]}]});
  const r=h.list('wppf','wy').pop(),text=h.runReport(r);
  assert.match(text,/## Wyckoff search/);assert.match(text,/Stopped\tyes/);assert.match(text,/Kept after\tStopped\./);
  assert.match(text,/## Solutions \(2\)\nZ\t.*\n4\t2\.16\t8\.00 %/);assert.match(text,/\n8\t—\tnot refined\t/);
  assert.match(text,/## Sites for Z = 4 \(1\)/);
  const saved=JSON.parse(JSON.stringify({format:'powder6-history',history:h.exportData(false)})),count=h.list().length;
  const checked=h.validate(saved.history);h.importData(checked);
  assert.equal(h.list().length,count);assert.ok(h.find(r.id).solution.sols.length===2);
});
test('completed fits keep immutable models and observations shared across checkpoints', () => {
  const a=fitted(),h=a.context.RV.fitHistory;
  const first=h.complete(h.begin([a.ds],false),[a.ds]);
  const json=JSON.stringify(first),key=a.ds.dataKey;
  a.state.setParam('bkg0',91,[a.ds]);
  assert.equal(JSON.stringify(first),json);assert.equal(h.changed(first),true);
  assert.equal(first.datasets[0].tth,undefined);
  assert.equal(h.observations()[key].tth,a.ds.tth);
  const second=h.complete(h.begin([a.ds],false),[Object.assign({},a.ds,{stats:{ok:true,msg:'converged'}})]);
  assert.equal(first.model,second.model);
  assert.equal(Object.keys(h.observations()).length,1);
});

test('Set restores a calculation, its model and uncertainties without dropping other methods or history', () => {
  const a=fitted(),h=a.context.RV.fitHistory;
  a.state.setCalculation('lebail');a.state.setParam('bkg0',23,[a.ds]);a.state.saveCalculation();
  a.state.setCalculation('rietveld');
  const r=h.complete(h.begin([a.ds],false),[a.ds]),saved=r.datasets[0].p.bkg0;
  a.state.setParam('bkg0',93,[a.ds]);
  h.restore(r.id);
  const d=a.state.byId(a.ds.id);
  assert.equal(d.p.bkg0,saved);assert.equal(d.stats.msg,r.datasets[0].stats.msg);
  assert.equal(d.calculations.lebail.p.bkg0,23);
  assert.equal(h.latest('rietveld').id,r.id);
});

test('global history restores the complete set and rejects restoration of one member', () => {
  const a=model(),other=a.state.makeDataset({name:'second',tth:a.ds.tth,y:a.ds.y});a.S.datasets.push(other);
  a.state.selectAll();const job=a.state.globalJob(a.state.selected()),result=a.core.refine(job);
  assert.equal(result.ok,true,result.msg);a.state.applyResult(a.state.selected(),result,job,true);
  const h=a.context.RV.fitHistory,r=h.complete(h.begin(a.state.selected(),true),a.state.selected());
  assert.throws(()=>h.restore(r.id,a.ds.id),/complete set/);
  a.state.setParam('bkg0',93,[a.ds]);h.restore(r.id);
  assert.equal(a.S.sel.size,2);assert.equal(a.state.byId(a.ds.id).p.bkg0,r.datasets[0].p.bkg0);
});

test('history count and byte budgets prune oldest unkept results while preserving kept records', () => {
  const a=fitted(),h=a.context.RV.fitHistory;a.state.setSetting('historyCount',2);
  const first=h.complete(h.begin([a.ds],false),[a.ds]);first.pinned=true;
  for(let i=0;i<5;i++)h.complete(h.begin([a.ds],false),[a.ds]);
  assert.equal(h.usage().count,3);assert.ok(h.find(first.id));
  h.exportData(true).records.filter(r=>!r.pinned && r.id!==h.latest('rietveld').id).forEach(r=>h.find(r.id).bytes=2000000);a.state.setSetting('historyMB',1);h.prune();
  assert.ok(h.find(first.id));assert.ok(h.usage().history<=1000000);
});

test('charge-flipping and Wyckoff records have their own History quota and never evict fits', () => {
  const a=fitted(),h=a.context.RV.fitHistory;a.state.setSetting('historyCount',2);a.state.setCalculation('wppf');a.ds.stats={ok:true,msg:'converged'};
  const fits=[0,1].map(()=>h.complete(h.begin([a.ds],false),[a.ds]));
  const I={dsId:a.ds.id,dsName:a.ds.name,phaseName:'x',phaseKey:'p1',sg:{symbol:'P1',number:1}};
  for(let i=0;i<5;i++){h.solution('cf',{I,sites:[],best:{bestR:.3}});h.solution('wy',{I,sols:[]});}
  assert.ok(fits.every(r=>h.find(r.id)),'a structure search evicted a WPPF fit');
  assert.equal(h.list('wppf','fit').length,2);assert.equal(h.list('wppf','cf').length,2);assert.equal(h.list('wppf','wy').length,2);
});
test('a project History is checked record by record: unrestorable runs are dropped, ids stay unique', () => {
  const a=fitted(),h=a.context.RV.fitHistory,r=h.complete(h.begin([a.ds],false),[a.ds]);
  const doc=JSON.parse(JSON.stringify(h.exportData(false)));
  const orphan=JSON.parse(JSON.stringify(r));orphan.id='run-41';orphan.datasets[0].dataKey='gone';delete orphan.kind;
  doc.records.push(orphan);doc.active={rietveld:{id:'run-41'}};doc.serial=2;
  const out=h.validate(doc,[]);
  assert.deepEqual(Array.from(out.dropped),['run-41']);assert.equal(out.records.length,1);assert.equal(out.records[0].kind,'fit');
  assert.ok(out.serial>=42,'serial must stay above every saved id');assert.equal(out.active.rietveld,undefined);
  const noObs=Object.assign({},doc,{observations:[],records:[doc.records[0]]});
  assert.equal(h.validate(noObs,[a.ds.dataKey]).records.length,1,'observations carried by the project datasets count');
  assert.equal(h.validate(noObs,[]).records.length,0);
  const dup=Object.assign({},doc,{records:[doc.records[0],doc.records[0]]});
  assert.throws(()=>h.validate(dup,[]),/Invalid calculation checkpoint run-\d+/);
  h.importData(out);const next=h.complete(h.begin([a.ds],false),[a.ds]);assert.ok(+next.id.slice(4)>=42);
});
test('compressed projects retain datasets, observations and restorable history', async () => {
  const a=fitted(),h=a.context.RV.fitHistory,r=h.complete(h.begin([a.ds],false),[a.ds]);
  const packed=await a.context.RV.project.pack();assert.equal(packed[0],80);assert.equal(packed[1],75);
  const doc=await a.context.RV.project.unpack(packed);
  assert.equal(doc.observations.length,1);assert.equal(doc.fitHistory.records.length,1);
  a.state.commitProject(a.state.prepareProject(doc));
  assert.equal(doc.datasetGroups,undefined,'projects no longer carry dataset groups');
  assert.deepEqual(Array.from(a.S.datasets[0].y),Array.from(a.ds.y));
  a.context.RV.fitHistory.restore(r.id);assert.equal(a.S.datasets[0].p.bkg0,r.datasets[0].p.bkg0);
});

test('every method fits from each dataset current values without a source override', () => {
  const a=model();
  const other=a.state.makeDataset({name:'second',tth:a.ds.tth,y:a.ds.y});a.S.datasets.push(other);
  for(const method of ['lebail','wppf','rietveld']){
    a.state.setCalculation(method);a.ds.p['p1.a']=5.1;other.p['p1.a']=5.6;a.state.selectAll();
    const job=a.state.jobFor(other);assert.equal(job.values[0]['p1.a'],5.6);
    a.state.setParam('p1.a',5.8,[other]);assert.equal(a.state.jobFor(other).values[0]['p1.a'],5.8);
    assert.equal(job.values[0]['p1.a'],5.6);assert.equal(a.ds.p['p1.a'],5.1);
  }
});

test('conflicting shared starts require a choice and resolve without changing the current model', () => {
  const a=model(),other=a.state.makeDataset({name:'second',tth:a.ds.tth,y:a.ds.y});a.S.datasets.push(other);
  a.ds.fit['p1.a']=other.fit['p1.a']=true;other.p['p1.a']=5.6;
  const job=a.state.globalJob([a.ds,other]),conflicts=a.state.sharedStartConflicts(job);
  assert.deepEqual(plain(conflicts),[{name:'p1.a',indices:[0,1],values:[5,5.6]}]);
  assert.throws(()=>a.state.resolveSharedStarts(job,{}),/Choose a shared starting value/);
  const resolved=a.state.resolveSharedStarts(job,{'p1.a':5.6});
  assert.equal(resolved.values[0]['p1.a'],5.6);assert.equal(resolved.values[1]['p1.a'],5.6);
  assert.equal(a.ds.p['p1.a'],5);assert.equal(job.values[0]['p1.a'],5);
  a.state.setLimit('p1.a',[4,6]);
  assert.throws(()=>a.state.resolveSharedStarts(job,{'p1.a':7}),/outside its limits/);
  assert.equal(a.state.resolveSharedStarts(job,{'p1.a':5.3}).values[1]['p1.a'],5.3);
});

test('shared-start choices exclude local, apart, held and constraint-dependent values', () => {
  const a=model(),other=a.state.makeDataset({name:'second',tth:a.ds.tth,y:a.ds.y});a.S.datasets.push(other);
  const list=[a.ds,other];a.ds.fit['p1.a']=other.fit['p1.a']=true;other.p['p1.a']=5.6;
  a.state.setShared('p1.a',false);assert.equal(a.state.sharedStartConflicts(a.state.globalJob(list)).length,0);
  a.state.setShared('p1.a',true);a.state.setApart([other],['p1.a'],true);
  assert.equal(a.state.sharedStartConflicts(a.state.globalJob(list)).length,0);
  a.state.setApart([other],['p1.a'],false);a.ds.fit['p1.a']=other.fit['p1.a']=false;
  const name='p1.Si1.B';a.ds.fit[name]=other.fit[name]=true;other.p[name]=.8;
  a.S.phases[0].constraints=[{kind:'hold',component:'B',atoms:['Si1']}];
  assert.equal(a.state.sharedStartConflicts(a.state.globalJob(list)).length,0);
  a.S.phases[0].constraints=[];
  a.S.parameterLinks=list.map(d=>({source:{datasetId:a.ds.id,name:'p1.Si1.occ'},target:{datasetId:d.id,name},factor:1,offset:0}));
  assert.equal(a.state.sharedStartConflicts(a.state.globalJob(list)).length,0);
});

test('a dataset resolution profile is independent of phases reused by other datasets', () => {
  const a=model(),other=a.state.makeDataset({name:'second',tth:a.ds.tth,y:a.ds.y});a.S.datasets.push(other);
  a.ds.inst.resolutionType='simple_pvoigt';other.inst.resolutionType='split_pvoigt';
  const p=a.S.phases[0],definition=a.state.phaseDefs()[0];
  const first=a.core.profileParamsFor(definition,{lambda1:a.ds.inst.lambda1,resolutionType:a.ds.inst.resolutionType},a.ds.p);
  const second=a.core.profileParamsFor(definition,{lambda1:other.inst.lambda1,resolutionType:other.inst.resolutionType},other.p);
  assert.equal(first.profileType,'simple_pvoigt');assert.equal(second.profileType,'split_pvoigt');assert.equal(p.profileType,'gsas_cw');
  assert.ok(a.state.instrumentParamsFor(a.ds).some(p=>p[0]==='eta'));
  assert.equal(a.state.instrumentParamsFor(a.ds).some(p=>p[0]==='U_L'),false);
});

test('all instrument profile families retain independent sample size and strain', () => {
  const a=model(),ph=a.S.phases[0],angles=Array.from({length:3501},(_,i)=>10+i*.02);
  a.ds=a.state.makeDataset({name:'resolved peaks',tth:angles,y:Array(angles.length).fill(1),inst:a.ds.inst,p:a.ds.p,fit:a.ds.fit,phases:[ph.key]});a.S.datasets=[a.ds];a.state.selectIds([a.ds.id]);
  assert.equal(a.ds.inst.resolutionType,'tch_aniso');assert.equal(a.core.usesSeparatedProfile(ph),true);
  const instrument=JSON.stringify(Object.fromEntries(Object.entries(a.ds.p).filter(([k])=>k.startsWith('inst.'))));
  for(const type of a.core.INSTRUMENT_PROFILE_TYPES){
    a.ds.inst.resolutionType=type;a.ds.p[ph.key+'.size']=1;a.ds.p[ph.key+'.strain']=0;
    const reference=a.core.evaluate(a.state.problemFor([a.ds]),0).ycalc;
    a.ds.p[ph.key+'.size']=.03;const small=a.core.evaluate(a.state.problemFor([a.ds]),0).ycalc;
    a.ds.p[ph.key+'.size']=1;a.ds.p[ph.key+'.strain']=800;const strained=a.core.evaluate(a.state.problemFor([a.ds]),0).ycalc;
    const differs=y=>y.reduce((sum,v,i)=>sum+Math.abs(v-reference[i]),0)>1;
    assert.ok(differs(small),type+': crystallite size does not change the calculated pattern');
    assert.ok(differs(strained),type+': microstrain does not change the calculated pattern');
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(a.ds.p).filter(([k])=>k.startsWith('inst.')))),instrument);
    assert.equal(ph.profileType,'gsas_cw');
  }
  const next=a.state.makePhase({name:'new phase',sg:a.state.resolveSG(221),cell:{a:5}});
  assert.equal(next.profileType,'gsas_cw');assert.equal(a.core.usesSeparatedProfile(next),true);
  assert.ok(Number.isFinite(next.v[next.key+'.size']) && Number.isFinite(next.v[next.key+'.strain']));
});

test('exact links connect independent parameters across phases and datasets', () => {
  const a=model(),other=a.state.makeDataset({name:'second',tth:a.ds.tth,y:a.ds.y});a.S.datasets.push(other);
  a.S.parameterLinks=[{id:'link',source:{datasetId:a.ds.id,name:'p1.a'},target:{datasetId:other.id,name:'p2.a'},factor:1.5,offset:.1}];
  a.state.setParam('p1.a',5.2,[a.ds]);assert.ok(Math.abs(other.p['p2.a']-7.9)<1e-10);
  a.ds.fit['p1.a']=true;other.fit['p2.a']=true;a.state.selectAll();a.state.setShared('p1.a',false);
  const job=a.state.globalJob(a.state.selected()),plan=a.context.AtomicConstraints.prepare(job);
  assert.equal(plan.vars.some(v=>v.name==='p2.a' && v.d===1),false);
  const x=plan.vars.map(v=>plan.values[v.d>=0?v.d:0][v.name]),index=plan.vars.findIndex(v=>v.name==='p1.a' && v.d===0);
  x[index]=5.4;plan.apply(plan.values,x);assert.ok(Math.abs(plan.values[1]['p2.a']-8.2)<1e-10);
  const single=a.state.jobFor(other),p=a.context.AtomicConstraints.prepare(single);assert.ok(Math.abs(p.values[0]['p2.a']-7.9)<1e-10);
});

test('history retains external parameter sources and can restore deleted source datasets', () => {
  const a=fitted(),source=a.state.makeDataset({name:'source',tth:a.ds.tth,y:a.ds.y});a.S.datasets.push(source);source.p['p1.a']=5.2;
  a.S.parameterLinks=[{id:'source',source:{datasetId:source.id,name:'p1.a'},target:{datasetId:a.ds.id,name:'p1.a'},factor:1,offset:0}];
  a.state.setParam('p1.a',5.2,[source]);
  a.ds.stats={ok:true,msg:'converged',Rp:0,Rwp:0};
  const h=a.context.RV.fitHistory,r=h.complete(h.begin([a.ds],false),[a.ds]);
  assert.equal(r.dependencies.length,1);a.state.removeDatasets([source.id]);
  h.withResult(r,()=>assert.equal(a.state.byId(source.id).p['p1.a'],5.2));
  h.restore(r.id);assert.equal(a.state.byId(source.id).p['p1.a'],5.2);assert.equal(a.S.sel.size,1);
});

test('phase inclusion is a method choice that preserves dataset assignments', () => {
  const a=model();a.ds.fit['p2.a']=true;a.S.disabledPhases=['p2'];
  assert.deepEqual(plain(a.ds.phases),['p1','p2']);
  assert.deepEqual(plain(a.state.problemFor([a.ds]).datasets[0].phases),['p1']);
  assert.equal(a.state.fitNames(a.ds).includes('p2.a'),false);
  a.state.setCalculation('lebail');a.S.disabledPhases=[];a.state.setCalculation('rietveld');
  assert.deepEqual(plain(a.S.disabledPhases),['p2']);
});

test('Set makes an older fit the method result without changing its archived record', () => {
  const a=fitted(),h=a.context.RV.fitHistory,first=h.complete(h.begin([a.ds],false),[a.ds]);
  const json=JSON.stringify(first);a.ds.p.bkg0=20;const second=h.complete(h.begin([a.ds],false),[a.ds]);
  assert.equal(h.latest('rietveld').id,second.id);h.restore(first.id);
  assert.equal(h.latest('rietveld').id,first.id);assert.equal(JSON.stringify(h.find(first.id)),json);
  const saved=JSON.parse(a.state.projectJSON([]));a.state.commitProject(a.state.prepareProject(saved));
  assert.equal(h.latest('rietveld').id,first.id);
});

test('result inspection preserves the selected phase and restores working state after an error', () => {
  const a=fitted(),h=a.context.RV.fitHistory,r=h.complete(h.begin([a.ds],false),[a.ds]);
  a.S.phaseSel='p2';a.state.setParam('bkg0',91,[a.ds]);
  const working=a.S.datasets,phases=a.S.phases,selection=a.S.sel;
  assert.throws(()=>h.withResult(r,()=>{
    assert.equal(a.S.phaseSel,'p2');assert.equal(a.S.datasets[0].p.bkg0,r.datasets[0].p.bkg0);
    throw new Error('report failure');
  }),/report failure/);
  assert.equal(a.S.phaseSel,'p2');assert.equal(a.S.datasets,working);
  assert.equal(a.S.phases,phases);assert.equal(a.S.sel,selection);
  assert.equal(a.ds.p.bkg0,91);assert.equal(h.viewing(),false);
});


test('projects replace acquisition, method settings and defaults without inheriting the previous session', async () => {
  const a=model();a.state.setInstrument([a.ds],{lambda1:.71073,lambda2:0,ratio:0,radiation:'neutron',pol:'none',tthMin:20,tthMax:60});
  a.state.store('fitmode','global');a.S.phaseSel='p2';a.S.presetDefaults={simple_pvoigt:{GW:.2}};
  const saved=await a.context.RV.project.pack();
  a.state.setInstrument([a.ds],{lambda1:1.788965,lambda2:1.79285,ratio:.5});
  a.state.store('fitmode','single');a.S.presetDefaults={stale:{GW:99}};a.S.nextId=800;
  a.state.commitProject(a.state.prepareProject(await a.context.RV.project.unpack(saved)));
  const d=a.S.datasets[0];assert.equal(d.inst.lambda1,.71073);assert.equal(d.inst.lambda2,0);assert.equal(d.inst.ratio,0);assert.equal(d.inst.radiation,'neutron');
  assert.equal(a.state.problemFor([d]).datasets[0].lambda1,.71073);assert.equal(a.state.load('fitmode'),'global');assert.equal(a.S.phaseSel,'p2');assert.deepEqual(plain(a.S.presetDefaults),{simple_pvoigt:{GW:.2}});
  const legacy=JSON.parse(a.state.projectJSON([]));delete legacy.fitmode;delete legacy.presetDefaults;
  a.state.commitProject(a.state.prepareProject(legacy));assert.equal(a.state.load('fitmode'),'single');assert.deepEqual(plain(a.S.presetDefaults),{});
  // The bundled preset files only fill in what is missing: a value that is already there stays, whatever arrives later.
  a.state.setPresetDefault('simple_pvoigt',{GW:.2});
  a.state.setPresetDefault('simple_pvoigt',{GW:.9},true);assert.equal(a.S.presetDefaults.simple_pvoigt.GW,.2);
  a.state.setPresetDefault('tch_aniso',{W:4},true);assert.equal(a.S.presetDefaults.tch_aniso.W,4);
  a.state.setPresetDefault('simple_pvoigt',{GW:.5});assert.equal(a.S.presetDefaults.simple_pvoigt.GW,.5,'a loaded preset still replaces one');
});

test('a saved project keeps the WPPF precision block in its own entry, not in project.json', async () => {
  const a = model();
  const pre = { n: 2, available: 2, s2: 1.25, Q: [1, 0.5, 0.5, 2], index: [0, 4] };
  a.context.RV.solve = { archive: () => ({ ints: { stamp: 's', dsId: a.ds.id, phaseKey: 'p1', lambda: a.ds.inst.lambda1, det: [], refl: [], pre },
    wy: { intsRef: true } }) };
  const packed = await a.context.RV.project.pack();
  const zip = await a.context.JSZip.loadAsync(packed);
  assert.ok(zip.file('solution/precision.Q.f64'), 'the matrix has its own entry');
  assert.ok(zip.file('solution/precision.index.i32'), 'the index has its own entry');
  const doc = JSON.parse(await zip.file('project.json').async('string'));
  assert.equal(doc.version, 4);
  assert.deepEqual(doc.solutionState.ints.pre.Q, { path: 'solution/precision.Q.f64', length: 4 });
  assert.deepEqual(doc.solutionState.ints.pre.index, { path: 'solution/precision.index.i32', length: 2 });
  const back = await a.context.RV.project.unpack(packed);
  // Array.from: the values are rebuilt inside the vm realm, whose Array is not this realm's
  assert.deepEqual(Array.from(back.solutionState.ints.pre.Q), [1, 0.5, 0.5, 2]);
  assert.deepEqual(Array.from(back.solutionState.ints.pre.index), [0, 4]);
  assert.equal(back.solutionState.ints.pre.s2, 1.25);
});

test('Chebyshev backgrounds recover signed slope and curvature in all three methods, with exclusions', () => {
  for(const method of ['rietveld','lebail','wppf']){
    const a=model();a.state.setCalculation(method);a.state.setInstrument([a.ds],{bkgN:6,excl:[[30,35]]});
    // An independent polynomial oracle, rather than the model's own basis.
    const coefficients=[100,-12,8,3,-2,1];const lo=a.ds.tth[0],hi=a.ds.tth[a.ds.tth.length-1];
    const peaks=a.ds.y;
    a.ds.y=Float64Array.from(a.ds.tth,(t,i)=>{const x=2*(t-lo)/(hi-lo)-1;return peaks[i]-17+100-12*x+8*(2*x*x-1)+3*(4*x**3-3*x)-2*(8*x**4-8*x*x+1)+(16*x**5-20*x**3+5*x);});
    Object.keys(a.ds.fit).forEach(k=>a.ds.fit[k]=/^bkg/.test(k));
    const result=a.core.refine(a.state.jobFor(a.ds));assert.equal(result.ok,true,result.msg);
    coefficients.forEach((c,k)=>assert.ok(Math.abs(result.values[0]['bkg'+k]-c)<1e-3,method+' coefficient '+k));
  }
});

test('returning to an unchanged method reuses its calculated plot, but an acquisition edit invalidates it',()=>{
  const a=model(),plot=a.state.calcFor(a.ds);a.state.setCalculation('wppf');a.state.setCalculation('rietveld');assert.equal(a.state.calcFor(a.ds),plot);
  a.state.setCalculation('wppf');a.state.setInstrument([a.ds],{lambda1:.8,lambda2:0,ratio:0});a.state.setCalculation('rietveld');assert.notEqual(a.state.calcFor(a.ds),plot);
});

test('changing the fitted range preserves the Chebyshev curve, including inactive method backgrounds',()=>{
  const a=model();a.state.setInstrument([a.ds],{bkgN:6});
  [100,-12,8,3,-2,1].forEach((c,k)=>a.ds.p['bkg'+k]=c);
  const original=a.state.calcFor(a.ds),expected=new Map(Array.from(original.tth,(t,i)=>[t,original.bkg[i]]));
  a.state.setCalculation('wppf');
  a.state.setInstrument([a.ds],{tthMin:22.3,tthMax:62.9});
  for(const method of ['wppf','rietveld']){
    a.state.setCalculation(method);const plot=a.state.calcFor(a.ds);
    plot.tth.forEach((t,i)=>assert.ok(Math.abs(plot.bkg[i]-expected.get(t))<1e-8,method+' changed background at '+t));
  }
});

test('repeated inspection of a saved fit reuses its pattern without borrowing the working model',()=>{
  const a=fitted(),h=a.context.RV.fitHistory,r=h.complete(h.begin([a.ds],false),[a.ds],false);
  const first=h.withResult(r,()=>a.state.calcFor(a.S.datasets[0]));
  a.state.setInstrument([a.ds],{lambda1:.8,lambda2:0,ratio:0});
  const second=h.withResult(r,()=>a.state.calcFor(a.S.datasets[0]));
  assert.equal(first,second);assert.notEqual(first,a.state.calcFor(a.ds));
  h.importData(h.exportData(false));
  const reloaded=h.withResult(h.find(r.id),()=>a.state.calcFor(a.S.datasets[0]));
  assert.notEqual(reloaded,first);
});

test('method plot caches notice edits to inactive parameters and replacement observations',()=>{
  const a=model(),original=a.state.calcFor(a.ds);a.state.setCalculation('wppf');
  a.ds.calculations.rietveld.p.bkg0+=4;
  a.state.setCalculation('rietveld');const changed=a.state.calcFor(a.ds);
  assert.notEqual(changed,original);assert.ok(Math.abs(changed.bkg[0]-original.bkg[0]-4)<1e-9);
  a.state.setCalculation('wppf');a.ds.dataKey='replacement';a.ds.y=Float64Array.from(a.ds.y,y=>y+10);
  a.state.setCalculation('rietveld');assert.notEqual(a.state.calcFor(a.ds),changed);
});
test('excluded zones that are not applied are kept in projects and restore points, and the fit never sees them', () => {
  const a = model(), ds = a.S.datasets[0];
  a.state.setInstrument([ds], { excl: [[20, 22]], exclOff: [[40, 41], [30, 31], [30, 30]] });
  assert.deepEqual(plain(ds.inst.excl), [[20, 22]]);
  assert.deepEqual(plain(ds.inst.exclOff), [[30, 31], [40, 41]], 'sorted, a zone of no width dropped');
  assert.equal(a.state.excluded(ds.inst, 30.5), false, 'a zone not applied excludes nothing');
  assert.equal(a.state.excluded(ds.inst, 21), true);
  a.state.setInstrument([ds], { excl: [[20, 22], [21.5, 23]] });
  assert.deepEqual(plain(ds.inst.excl), [[20, 23]], 'applied zones are merged, the others are not');
  const copy = a.state.instCopy(ds.inst);
  copy.exclOff[0][0] = 99;
  assert.equal(ds.inst.exclOff[0][0], 30, 'a copy never shares the zones');
  a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
  const back = a.S.datasets[0];
  assert.deepEqual(plain(back.inst.exclOff), [[30, 31], [40, 41]]);
  assert.deepEqual(plain(back.inst.excl), [[20, 23]]);
  const old = JSON.parse(a.state.projectJSON([]));
  delete old.datasets[0].inst.exclOff;
  a.state.commitProject(a.state.prepareProject(old));
  assert.deepEqual(plain(a.S.datasets[0].inst.exclOff), [], 'a project of an earlier version has no zones kept aside');
});

test('anomalous dispersion enters the Rietveld structure factors, Friedel-averaged, from the instrument of the dataset', () => {
  const a = model(), ds = a.ds;
  a.state.setInstrument([ds],{anomalous:'Si 0 0, Na 0 0'});
  const before = a.core.evaluate(a.state.problemFor([ds]), 0).phases[0].refl.find(r => r.inRange);
  a.state.setInstrument([ds], { anomalous: 'si -0.3 0.4; ' });
  assert.equal(ds.inst.anomalous, 'Si -0.3 0.4', 'the text is cleaned');
  assert.deepEqual(plain(a.state.problemFor([ds]).datasets[0].anomalous), { SI: [-0.3, 0.4] });
  const after = a.core.evaluate(a.state.problemFor([ds]), 0).phases[0].refl.find(r => r.h === before.h && r.k === before.k && r.l === before.l);
  // Si at the origin of Pm-3m: F = f, so |F|^2 goes from f0^2 to (f0 + f')^2 + f''^2 (one Debye-Waller factor on both)
  const f0 = Math.sqrt(before.F2);
  assert.ok(Math.abs(after.F2 - ((f0 - 0.3 * Math.exp(-0.5 * (1 / before.d) ** 2 / 4)) ** 2 + (0.4 * Math.exp(-0.5 * (1 / before.d) ** 2 / 4)) ** 2)) < 1e-9 * after.F2, after.F2 + ' ' + before.F2);
  assert.match(a.core.parseAnomalous('Fe -3.36 3.2, Q').bad[0], /Q/);
  a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
  assert.equal(a.S.datasets[0].inst.anomalous, 'Si -0.3 0.4', 'saved with the project');
});

test('the area normaliser includes the SL/HL asymmetry (brute-force integral of the asymmetric peak)', () => {
  const a = app();
  const out = a.run(`(function(){var p={profileType:'tch_aniso',U:0,V:0,W:5,X:5,Y:0,SL:0.05,HL:0.02,minFwhm:0.005},prep=prepareVoigt(10,10,{d:1},p),
    asym=Object.assign({},prep,{x0:0,max_d:Infinity,pedestal:0}),sym=Object.assign({},asym,{asym_param:0}),L=3000*prep.fwhm_total,n=2e5,diff=0;
    for(var i=0;i<n;i++){var u=-1+(i+0.5)*2/n,x=L*u*u*u,dx=3*L*u*u*2/n;diff+=(evalVoigt(x,asym)-evalVoigt(x,sym))*dx;}
    return [getPseudoVoigtArea(10,{d:1},p),prep.analyticArea+diff,prep.analyticArea];})()`);
  assert.ok(Math.abs(out[0] - out[1]) < 2e-4 * out[1], out.join(' '));
  assert.ok(out[0] > out[2] * 1.01, 'the asymmetry visibly changes the area here');
});

test('charge flipping imposes F(hR) = F(h) exp(2 pi i h.t), the relation of rho = sum F exp(+2 pi i h.x)', () => {
  Object.assign(globalThis, require('../js/constants.js'), require('../js/crystal.js'));
  if (typeof globalThis.postMessage !== 'function') globalThis.postMessage = () => {};
  const cf = require('../js/charge_flipping_worker.js');
  const ops = [{ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, { r: [-1, 0, 0, 0, -1, 0, 0, 0, 1], t: [0, 0, 0.5] },
               { r: [0, -1, 0, 1, 0, 0, 0, 0, 1], t: [0, 0, 0.25] }, { r: [0, 1, 0, -1, 0, 0, 0, 0, 1], t: [0, 0, 0.75] }];   // P4_1
  const hklList = [];
  for (const [h, k, l] of [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1], [2, 1, 0], [1, 2, 3], [2, 1, 3], [0, 0, 4], [1, 0, 2]]) hklList.push({ h_orig: h, k_orig: k, l_orig: l, intensity: 100 + 37 * h + 11 * l, tth: 10 + 3 * (h + k + l) + 0.1 * h, d: 3 });
  const N = 16, r = cf.runChargeFlippingCPU({ gridSize: N, maxIterations: 20, thresholdSigma: 1, seed: 3, cell: { a: 5, b: 5, c: 8, alpha: 90, beta: 90, gamma: 90 },
    symops: ops, laueClass: '4/m', symLambda: 1, weakFraction: 0, applyLP: false, overlapTolTth: 1e-6, hklList });
  const re = Float64Array.from(r.map), im = new Float64Array(re.length);
  cf.fft3d(re, im, N, false);
  const w = v => ((v % N) + N) % N, at = h => w(h[0]) + w(h[1]) * N + w(h[2]) * N * N;
  let plus = 0, minus = 0, norm = 0;
  for (const p of hklList) {
    const h = [p.h_orig, p.k_orig, p.l_orig], x = re[at(h)], y = im[at(h)];
    for (const o of ops) {
      const hR = [0, 1, 2].map(j => h[0] * o.r[j] + h[1] * o.r[3 + j] + h[2] * o.r[6 + j]), t = 2 * Math.PI * (h[0] * o.t[0] + h[1] * o.t[1] + h[2] * o.t[2]);
      const c = Math.cos(t), s = Math.sin(t), X = re[at(hR)], Y = im[at(hR)];
      plus += (X - (x * c - y * s)) ** 2 + (Y - (x * s + y * c)) ** 2; minus += (X - (x * c + y * s)) ** 2 + (Y - (y * c - x * s)) ** 2; norm += X * X + Y * Y;
    }
  }
  assert.ok(plus < 1e-20 * norm && minus > 1e-3 * norm, 'residual with exp(+): ' + plus + ', with exp(-): ' + minus);
});

test('Wyckoff tables mark centring translates, and one image per class gives the full |F|^2 for allowed reflections', () => {
  const A = require('../js/wyckoff_assign.js'), db = require('../sg/all.json').space_groups;
  for (const num of [12, 166, 225]) {
    const s = db[num].settings[0], ops = s.sym_ops, count = num === 12 ? 8 : num === 166 ? 18 : 32;
    const demand = [{ element: 'A', count, z: 20, r: 1 }, { element: 'B', count, z: 8, r: 1 }];
    const list = A.enumerateAssignments(s.wyckoff, demand, { ceiling: 24, symOps: ops }).assignments.slice(0, 6);
    const T = A.buildAssignmentTables(list, ops.length, demand, ops), nC = T.centring.length + 1;
    assert.ok(nC > 1, 'centred group ' + num);
    list.forEach((As, ai) => {
      assert.equal(Array.from(T.genSkip.subarray(ai * T.nTot, (ai + 1) * T.nTot)).filter(x => !x).length, T.nTot / nC);
      const pos = As.sites.map((st, si) => A.projectOnto(st.w, 0.11 + 0.07 * si, 0.23 + 0.05 * si, 0.37 + 0.03 * si, new Float64Array(3)));
      for (const h of [[1, 1, 1], [2, 0, 0], [2, 2, 0], [3, 1, 1], [1, 0, 1], [0, 0, 3], [1, 1, 0], [4, 2, 0]]) {
        if (!T.centring.every(c => { const p = h[0] * c[0] + h[1] * c[1] + h[2] * c[2]; return Math.abs(p - Math.round(p)) < 1e-6; })) continue;
        let fr = 0, fi = 0, gr = 0, gi = 0;
        for (let g = 0; g < T.nTot; g++) {
          const o = ops[T.genOp[ai * T.nTot + g]], p = pos[T.genSite[ai * T.nTot + g]], f = T.genType[ai * T.nTot + g] ? 8 : 20;
          const q = [0, 1, 2].map(i => o.r[3 * i] * p[0] + o.r[3 * i + 1] * p[1] + o.r[3 * i + 2] * p[2] + o.t[i]), ph = 2 * Math.PI * (h[0] * q[0] + h[1] * q[1] + h[2] * q[2]);
          fr += f * Math.cos(ph); fi += f * Math.sin(ph);
          if (!T.genSkip[ai * T.nTot + g]) { gr += f * Math.cos(ph); gi += f * Math.sin(ph); }
        }
        assert.ok(Math.abs(fr * fr + fi * fi - nC * nC * (gr * gr + gi * gi)) < 1e-9 * Math.max(1, fr * fr + fi * fi), num + ' ' + h);
      }
    });
    assert.equal(T.genPack[0] >>> 24 & 1, T.genSkip[0]);
  }
  assert.equal(A.buildAssignmentTables([], 4, [{ element: 'A', count: 4, z: 1, r: 1 }]).centring.length, 0, 'without operators nothing is flagged');
});

test('observations scale sigma and covariances with their reflection, and overlapped groups use the covariance', () => {
  Object.assign(globalThis, require('../js/constants.js'), require('../js/crystal.js'));
  const O = require('../js/observations.js');
  const out = O.normaliseObservations([{ h: 1, k: 0, l: 0, Ihkl: 400, sigma: 20, multiplicity: 6, twoTheta: 20, cov: [[1, 1, 0, -150]] },
                                       { h: 1, k: 1, l: 0, Ihkl: 300, sigma: 30, multiplicity: 12, twoTheta: 20.05 }], { polarisationK: 1, wavelength: 1.5406 });
  assert.equal(out.route, 'lp_from_2theta');
  const lp = t => O.obsLorentzPolarization(t, 1), k1 = 6 * lp(20), k2 = 12 * lp(20.05), [r1, r2] = out.rows;
  assert.ok(Math.abs(r1.sigma - 20 / k1) < 1e-12 && Math.abs(r2.sigma - 30 / k2) < 1e-12, 'sigma in Fo2 units');
  assert.ok(Math.abs(r1.cov[0][3] + 150 / (k1 * k2)) < 1e-12, 'covariance in Fo2 units');
  const v = O.obsGroupVariance([r1, r2]), ind = (6 * r1.sigma) ** 2 + (12 * r2.sigma) ** 2;
  assert.ok(Math.abs(v - (ind + 2 * 6 * 12 * r1.cov[0][3])) < 1e-9 * ind && v < ind, 'the anti-correlation lowers the variance of the sum');
  assert.equal(O.obsGroupVariance([r1, { h: 2, k: 0, l: 0, mult: 1 }]), null, 'a member without sigma');
});

test('the WPPF solve factors a near-singular normal matrix (reflections cut by the end of the range) instead of returning zeros', () => {
  const a = app(), St = a.state;
  St.setCalculation('rietveld');
  const ph = St.makePhase({ name: 'Synthetic Si', sg: St.resolveSG(1), cell: { a: 4.2, b: 4.6, c: 5.1, alpha: 83, beta: 94, gamma: 101 }, atoms: [{ label: 'Si1', type: 'Si', x: .13, y: .21, z: .32 }] });
  St.addPhase(ph);
  const ds = St.makeDataset({ name: 'pattern', tth: Array.from({ length: 501 }, (_, i) => 10 + i * .2), y: Array(501).fill(100), inst: { bkgN: 1, lambda2: 0, ratio: 0, resolutionType: 'simple_pvoigt' } });
  a.S.datasets.push(ds); St.selectIds([ds.id]);
  ds.p[ph.key + '.scale'] = .002; ds.p.bkg0 = 10; ds.p.zero = .12; ds.y = a.core.evaluate(St.problemFor([ds]), 0).ycalc;
  St.setCalculation('wppf'); Object.keys(ds.fit).forEach(n => { ds.fit[n] = n === 'bkg0'; });
  const r = a.core.refine(St.jobFor(ds));
  assert.equal(r.ok, true, r.msg);
  assert.ok(r.stats[0].nInt > 100 && r.stats[0].Rwp < 0.01, 'intensities extracted: ' + r.stats[0].nInt + ', Rwp ' + r.stats[0].Rwp);
});

test('a Le Bail fit keeps to Maximum iterations for both of its stages together', () => {
  const a = model(); a.state.setCalculation('lebail');
  const ds = a.ds; ds.p['p1.a'] = 5.01; Object.keys(ds.fit).forEach(n => { ds.fit[n] = n === 'p1.a' || n === 'bkg0'; });
  for (const maxIter of [1, 4, 9]) {
    const job = a.state.jobFor(ds); job.maxIter = maxIter; job.tol = 1e-30;
    const r = a.core.refine(job);
    assert.equal(r.ok, true, r.msg);
    assert.ok(r.iter <= Math.max(2, maxIter), 'maxIter ' + maxIter + ' ran ' + r.iter);
  }
});

test('transparency estimates carry the physical sign: a penetrating beam moves the peaks to lower angle', () => {
  const src = read('js/rietveld/rv_absorption.js');
  assert.match(src, /transparency90:R>0\?-1\/\(2\*R\*mu90\)/);
  const a = app();
  assert.ok(a.run('calculatePeakShift(40,{profileType:"simple_pvoigt",trns:-0.001})') < 0, 'negative t shifts down');
});


test('dataset colours survive projects, undo and retained calculations', () => {
  const a=model();a.ds.color='#16746d';
  a.context.RV.history.take('dataset appearance');a.ds.color='#ad4a29';
  a.context.RV.history.undo();
  assert.equal(a.S.datasets[0].color,'#16746d');
  const d=a.S.datasets[0];d.stats={ok:true};
  const record=a.context.RV.fitHistory.complete(a.context.RV.fitHistory.begin([d],false),[d]);
  assert.equal(record.datasets[0].color,'#16746d');
  const doc=JSON.parse(a.state.projectJSON([]));
  a.state.commitProject(a.state.prepareProject(doc));
  assert.equal(a.S.datasets[0].color,'#16746d');
  a.S.datasets[0].color=null;a.context.RV.fitHistory.restore(record.id);
  assert.equal(a.S.datasets[0].color,'#16746d');
  doc.datasets[0].color='invalid';
  a.state.commitProject(a.state.prepareProject(doc));
  assert.equal(a.S.datasets[0].color,null);
});


test('GSAS header count mismatch imports complete points with a visible warning and no padding', async () => {
  const a=app(),pairs=Array.from({length:9568},(_,i)=>[142.5+i%5,17]);
  const rows=[];for(let i=0;i<pairs.length;i+=5)rows.push(pairs.slice(i,i+5).flat().map(v=>v.toFixed(1).padStart(8)).join(''));
  const text='Instrument parameter      bl04.prm\nBANK 1 9570 1914 CONST 0.300 0.300 0.0 0.0 ESD\n'+rows.join('\n');
  await a.context.RV.cmd.readFiles([file('sfmo_x3_373.gsa',text)]);
  assert.equal(a.S.datasets.length,1);const d=a.S.datasets[0];
  assert.equal(d.tth.length,9568);assert.equal(d.y.length,9568);assert.equal(d.sig.length,9568);
  assert.equal(d.y[0],142.5);assert.equal(d.sig[9567],17);
  assert.ok(Math.abs(d.tth[9567]-(.003+9567*.003))<1e-9);
  assert.ok(a.messages.some(m=>m.kind==='warn' && /9570.*9568/.test(m.message)));
  assert.throws(()=>a.run("detectAndParseFile('bad.gsa','BANK 1 10 2 CONST 1 1 0 0 ESD\\n100 2 400')"),/Invalid intensity/);
  assert.throws(()=>a.run("detectAndParseFile('empty.gsa','BANK 1 10 2 CONST 1 1 0 0 ESD\\n')"),/at least two/);
});


test('Philips UDF RawScan imports packed counts and wavelengths from the supplied fixture', async () => {
  const a=app(),text=read('test_files/sfmo_x3_299.udf');
  const p=a.run('detectAndParseFile("sample.udf",'+JSON.stringify(text)+')');
  assert.equal(p.tth.length,9574);assert.equal(p.intensity.length,9574);
  assert.deepEqual(Array.from(p.intensity.slice(0,8)),[239,288,232,253,260,240,251,263]);
  assert.deepEqual(Array.from(p.intensity.slice(-6)),[259,237,263,254,250,264]);
  assert.equal(p.tth[0],20.00718);assert.ok(Math.abs(p.tth[9573]-99.9953388)<1e-8);
  assert.equal(p.wavelength,1.54060);assert.equal(p.wavelength2,1.54443);assert.equal(p.ratio21,.5);
  assert.equal(p.warnings.length,0);
  await a.context.RV.cmd.readFiles([file('sfmo_x3_299.udf',text)]);
  const d=a.S.datasets[0];assert.equal(d.y.length,9574);assert.equal(d.inst.lambda1,1.54060);assert.equal(d.inst.lambda2,1.54443);assert.equal(d.inst.ratio,.5);
  assert.ok(!a.messages.some(m=>m.kind==='warn' && /DataAngleRange/.test(m.message)));
  const mismatch=a.run('detectAndParseFile("mismatch.udf",'+JSON.stringify(text.replace('99.99567','100.99567'))+')');
  assert.equal(mismatch.intensity.length,9574);assert.ok(mismatch.warnings.some(w=>/DataAngleRange/.test(w)));
});

test('Philips UDF retains sectioned XY support and rejects malformed RawScan instead of guessing XY', () => {
  const a=app();
  const p=a.run("detectAndParseFile('section.udf','Lambda=1.2\\n[Data]\\n10,100\\n11,200')");
  assert.deepEqual(Array.from(p.tth),[10,11]);assert.deepEqual(Array.from(p.intensity),[100,200]);
  assert.throws(()=>a.run("detectAndParseFile('bad.udf','DataAngleRange,10,11,/\\nScanStepSize,0.1,/\\nRawScan\\n100,bad,200,/')"),/invalid intensity/);
  assert.throws(()=>a.run("detectAndParseFile('bad.udf','RawScan\\n100,200,/')"),/DataAngleRange/);
  assert.throws(()=>a.run("detectAndParseFile('bad.udf','10 100\\n11 200')"),/No \[Data\] section/);
});

test('pattern readers: start-step-end files, GSAS counters, UXD and RAS layouts, header wavelengths', async () => {
  const a=app(),parse=(name,text)=>{a.context.input=text;return a.run('normalizeParsedData(detectAndParseFile('+JSON.stringify(name)+',input),'+JSON.stringify(name)+')');};
  // "start step end" then the counts, 10 per line: read as (start, step) and (count, count) points before.
  const cime=parse('cime.dat',read('test_files/cimetidine/cime.dat'));
  assert.equal(cime.tth.length,7699);assert.equal(cime.tth[0],8.01);assert.ok(Math.abs(cime.tth[7698]-84.99)<1e-9);
  assert.deepEqual(Array.from(cime.intensity.slice(0,3)),[2707,2648,2666]);assert.equal(cime.intensity[7698],939);
  // A three-column file whose first row is three numbers is still x y sigma.
  const xye=parse('a.xye','10.00 523 22.8\n10.02 530 23\n10.04 540 23.2\n10.06 520 22.8\n');
  assert.deepEqual(Array.from(xye.tth),[10,10.02,10.04,10.06]);assert.deepEqual(Array.from(xye.sig),[22.8,23,23.2,22.8]);
  // A misread axis fails instead of loading a pattern reaching 2-theta = 2700.
  assert.throws(()=>parse('bad.xy','10 5\n2700 6\n'),/outside -180\.\.180/);
  // sigma = 0 for an empty point takes counting statistics, with a warning.
  const zero=parse('z.xye','10 5 2\n10.02 0 0\n10.04 6 2\n');
  assert.deepEqual(Array.from(zero.sig),[2,1,2]);assert.ok(zero.warnings.some(w=>/standard uncertainty of 0/.test(w)));
  // GSAS STD 10(I2,F6.0): a filled counter field is not an intensity.
  const std=parse('a.xra','title\nBANK 1 4 1 CONST 1000 2.5 0 0 STD\n 1   179 1   147 1   165 1   172\n');
  assert.deepEqual(Array.from(std.intensity),[179,147,165,172]);
  // A title starting with "Bank" is not a GSAS bank.
  assert.deepEqual(Array.from(parse('b.xy','Bank of samples\n10 5\n10.02 6\n').intensity),[5,6]);
  // Decimal commas; whole-number fields only for the first data line.
  assert.deepEqual(Array.from(parse('c.csv','Angle;Int\n10,02;1234\n10,04;1300,5\n').intensity),[1234,1300.5]);
  assert.deepEqual(Array.from(parse('e.xy','2Theta 3Counts\n10 5\n10.02 6\n').tth),[10,10.02]);
  // Header wavelengths: a free title, and the PANalytical CSV keys.
  assert.equal(parse('C61Br2_079764.XY',read('test_files/C61Br2_079764.XY')).wavelength,0.79764);
  const csv=parse('h.csv',read('test_files/H183-10-90-30min_1.csv'));
  assert.equal(csv.wavelength,1.540598);assert.equal(csv.wavelength2,1.544426);assert.equal(csv.ratio21,0);
  // UXD: spaces around "=", one pattern per range, CPS times the step time, 2-theta/count pairs.
  const uxd=a.run('detectAndParseFile("a.uxd",'+JSON.stringify('_WL1 = 1.5406\n_START = 10\n_STEPSIZE = 0.02\n_STEPTIME = 2\n_CPS\n1 2 3\n_START=20\n_COUNTS\n4 5 6\n')+')');
  assert.equal(uxd.patterns.length,2);assert.equal(uxd.wavelength,1.5406);
  assert.deepEqual(Array.from(uxd.patterns[0].intensity),[2,4,6]);assert.deepEqual(Array.from(uxd.patterns[1].tth),[20,20.02,20.04]);
  assert.deepEqual(Array.from(parse('b.uxd','_FILEVERSION=1\n_2THETACOUNTS\n10 5\n10.02 6\n').tth),[10,10.02]);
  assert.throws(()=>parse('c.uxd','_COUNTS\n1 2 3\n'),/_START and _STEPSIZE/);
  // RAS: quoted wavelength, attenuator factor, every scan block.
  const ras=a.run('detectAndParseFile("a.ras",'+JSON.stringify('*RAS_HEADER_START\n*HW_XG_WAVE_LENGTH_ALPHA1 "1.540593"\n*RAS_INT_START\n10 5 1\n10.02 6 2\n*RAS_INT_END\n*RAS_INT_START\n20 5 1\n20.02 6 1\n*RAS_INT_END\n')+')');
  assert.equal(ras.wavelength,1.540593);assert.deepEqual(Array.from(ras.intensity),[5,12]);assert.equal(ras.patterns.length,2);
  // UTF-16 text is decoded; a binary scan is refused by name.
  const u16=Buffer.from('﻿10 5\r\n10.02 6\r\n','utf16le');
  a.context.inputBytes=u16.buffer.slice(u16.byteOffset,u16.byteOffset+u16.length);
  assert.deepEqual(Array.from((await a.run('detectAndParseBuffer("u.xy",inputBytes)')).intensity),[5,6]);
  a.context.inputBytes=new Uint8Array([86,51,82,68,0,0,1,2,0,0,0,9]).buffer;
  await assert.rejects(a.run('detectAndParseBuffer("x.rd",inputBytes)'),/binary file/);
});

test('distance rules are shared: the Wyckoff parser keeps elements upper case, restraints keep atom labels', () => {
  const DR = require('../js/distance_rules.js'), WL = require('../js/wyckoff_limits.js').WY_LIMITS;
  const wy = DR.parse('Fe C 6 1.6/2.2 oct', WL.geometries), re = DR.parse('Fe1 C1 6 1.6/2.2 oct', WL.geometries, { keepCase: true });
  assert.deepEqual(plain(wy.windows[0]), { a: 'FE', b: 'C', count: 6, countMode: 'exact', dmin: 1.6, dmax: 2.2, geometry: 'octahedral' });
  assert.equal(re.windows[0].a, 'Fe1'); assert.equal(re.windows[0].b, 'C1');
  assert.match(DR.parse('Fe C 6 1.6/2.2 cube', WL.geometries).bad[0], /not a shape/);
});

test('a distance rule never drops a token: extra numbers and a count with two distances are errors', () => {
  const DR = require('../js/distance_rules.js'), WL = require('../js/wyckoff_limits.js').WY_LIMITS;
  // the third number used to be read and thrown away without a word
  for (const text of ['Fe O 2.0 2.2 2.4', 'Fe O - 2.0 2.5 9', 'Fe O 2.0 2.2 2.4 tetra']) {
    const r = DR.parse(text, WL.geometries);
    assert.equal(r.windows.length, 0, text + ' must not become a rule');
    assert.match(r.bad[0], /is not read|not a shape|needs/, text + ': ' + r.bad[0]);
  }
  assert.match(DR.parse('Fe O 2.0 2.2 2.4', WL.geometries).bad[0], /"2\.4" after "2\.0 2\.2" is not read/);
  // "S O 4 1.4 1.6" is a count followed by two distances: it used to be reported as dmax below dmin
  const ambiguous = DR.parse('S O 4 1.4 1.6', WL.geometries).bad[0];
  assert.match(ambiguous, /has a count and two distances/);
  assert.match(ambiguous, /S O 4 1\.4\/1\.6/);
  // the forms that do read are untouched
  assert.deepEqual(plain(DR.parse('S O 4 1.4/1.6', WL.geometries).windows[0]), { a: 'S', b: 'O', count: 4, countMode: 'exact', dmin: 1.4, dmax: 1.6, geometry: null });
  assert.deepEqual(plain(DR.parse('S O 1.4 1.6', WL.geometries).windows[0]), { a: 'S', b: 'O', count: null, countMode: null, dmin: 1.4, dmax: 1.6, geometry: null });
  assert.deepEqual(plain(DR.parse('S O 4 1.40/1.60 tetra', WL.geometries).windows[0].geometry), 'tetrahedral');
});

test('restraints measure distances, counts and angles through the symmetry images', () => {
  const AR = require('../js/atom_restraints.js'), a = app();
  a.S.calculation = 'rietveld';
  // Fm-3m rock salt: Na at 0,0,0 and Cl at 1/2,0,0 in a 5.64 cell
  const ph = a.state.makePhase({ name: 'NaCl', sg: a.state.resolveSG(225), cell: { a: 5.64 },
    atoms: [{ label: 'Na1', type: 'Na', x: 0, y: 0, z: 0, B: 1, occ: 1 }, { label: 'Cl1', type: 'Cl', x: 0.5, y: 0, z: 0, B: 1, occ: 1 }] });
  a.state.addPhase(ph);
  const def = a.state.phaseDefs()[0], ctx = { cellOf: a.core.cellOf, sitePosition: a.core.sitePosition }, v = ph.v;
  const rows = AR.rows(def, { text: 'Na1 Cl1 6 2.7/2.9 oct' }, v, ctx);
  assert.equal(rows.filter(r => r.kind === 'd').length, 6);
  rows.filter(r => r.kind === 'd').forEach(r => { assert.ok(Math.abs(r.val - 2.82) < 1e-9); assert.equal(r.dev, 0); });
  const ang = rows.filter(r => r.kind === 'ang'); assert.equal(ang.length, 15);
  ang.forEach(r => { assert.ok(Math.abs(r.dev) < 1e-6, r.text + ' ' + r.val); });
  assert.equal(AR.rows(def, { text: 'Na1 Cl1 6 3.0/3.2' }, v, ctx).filter(r => r.dev !== 0).length, 6);
  assert.equal(AR.rows(def, { text: 'Na1 Na1 - 3.0/' }, v, ctx)[0].dev, 0);
  assert.match(AR.check(def.atoms, { text: 'Na1 K1 2 1/2' }).errors[0], /"K1" is not an atom label/);
  assert.equal(AR.check(def.atoms, { text: 'na1 cl1 6 2.7/2.9' }).rules[0].a, 'Na1');
});

test('a restraint pulls the refined geometry and the fit reports it', () => {
  const a = model(), AR = require('../js/atom_restraints.js');
  a.S.phases.length = 0; a.S.datasets.length = 0;
  const ph = a.state.makePhase({ name: 'AB', sg: a.state.resolveSG(1), cell: { a: 8, b: 8, c: 8 },
    atoms: [{ label: 'A1', type: 'Si', x: 0, y: 0, z: 0, B: 0.5, occ: 1 }, { label: 'B1', type: 'Si', x: 0.30, y: 0, z: 0, B: 0.5, occ: 1 }] });
  a.state.addPhase(ph);
  const ds = a.state.makeDataset({ name: 'd', tth: Array.from({ length: 300 }, (_, i) => 10 + i * 0.25), y: Array(300).fill(100), inst: { bkgN: 1, lambda2: 0, ratio: 0 } });
  a.S.datasets.push(ds); a.state.selectIds([ds.id]);
  ds.p[ph.key + '.scale'] = 0.01; ds.p.bkg0 = 10; ds.y = a.core.evaluate(a.state.problemFor([ds]), 0).ycalc;
  Object.keys(ds.fit).forEach(k => { ds.fit[k] = k === ph.key + '.B1.x'; });
  const run = restraint => {
    ph.restraints = restraint; const job = a.state.problemFor([ds]); job.vars = [{ d: 0, name: ph.key + '.B1.x' }];
    const res = a.core.refine(job); assert.equal(res.ok, true, res.msg); return res;
  };
  const plainFit = run(null); assert.ok(Math.abs(plainFit.values[0][ph.key + '.B1.x'] - 0.30) < 1e-4);
  const held = run({ text: 'A1 B1 - 1.9/2.1', weight: 1e6, sigmaD: 0.02 });
  const d = held.values[0][ph.key + '.B1.x'] * 8;
  assert.ok(d < 2.1 + 0.02 && d > 1.9, 'distance ' + d);
  assert.equal(held.restraints.n, 1); assert.ok(held.restraints.details[0].rows[0].val < 2.15);
  assert.throws(() => run({ text: 'A1 Zz9 - 1/2' }), /not an atom label/);
});

test('restraints survive projects, undo and an atom rename', async () => {
  const a = model(), ph = a.S.phases[0];
  ph.restraints = { on: true, text: 'Si1 Si1 - 3/', weight: 2, sigmaD: 0.05, sigmaA: 4 };
  const doc = await a.context.RV.project.unpack(await a.context.RV.project.pack());
  assert.equal(doc.phases[0].restraints.text, 'Si1 Si1 - 3/'); assert.equal(doc.phases[0].restraints.weight, 2);
  ph.restraints = null; a.state.commitProject(a.state.prepareProject(doc));
  assert.deepEqual(plain(a.S.phases[0].restraints), { on: true, text: 'Si1 Si1 - 3/', weight: 2, sigmaD: 0.05, sigmaA: 4 });
  a.state.renameAtom(a.S.phases[0], 'Si1', 'Si9');
  assert.equal(a.S.phases[0].restraints.text, 'Si9 Si9 - 3/');
  // an older project has none
  delete doc.phases[0].restraints; a.state.commitProject(a.state.prepareProject(doc));
  assert.equal(a.S.phases[0].restraints.text, ''); assert.equal(a.S.phases[0].restraints.on, true);
});

test('molecule files become bond and angle rules', () => {
  const M = require('../js/molecule_rules.js');
  const water = M.read('O\nH1 1 0.96\nH2 1 0.96 2 104.5\n'), r = M.rules(water.atoms);
  assert.equal(r.bonds, 2); assert.equal(r.angles, 1); assert.match(r.text, /^O H1 - 0\.930\/0\.990$/m); assert.match(r.text, /^H1 H2 - 1\.458\/1\.578$/m);
  const pdb = M.read('ATOM      1  C1  MOL A   1       0.000   0.000   0.000  1.00  0.00           C\nATOM      2  C2  MOL A   1       1.400   0.000   0.000  1.00  0.00           C\nEND\n', { name: 'x.pdb' });
  assert.equal(pdb.format, 'PDB'); assert.equal(M.rules(pdb.atoms).bonds, 1);
  const only = M.rules(M.read('3\nm\nC 0 0 0\nC 1.4 0 0\nC 2.8 0 0\n').atoms, { only: new Set(['C', 'C_2']) });
  assert.ok(only.skipped >= 1); assert.throws(() => M.read('C1\nC2 9 1.5'), /unknown reference/);
});

test('a difference Fourier map finds the atom the model lacks', () => {
  const FM = require('../js/fourier_map.js'), a = app(), sg = a.state.resolveSG(225), ops = a.core.expandOps ? a.core.expandOps(sg.ops, null) : sg.ops;
  const ff = el => a.state.scatterer(el), cell = { a: 5.64, b: 5.64, c: 5.64, alpha: 90, beta: 90, gamma: 90 };
  const na = { label: 'Na1', pos: [0, 0, 0], occ: 1, B: 0.5, ff: ff('Na') }, cl = { label: 'Cl1', pos: [0.5, 0, 0], occ: 1, B: 0.5, ff: ff('Cl') };
  const rots = FM.rotations(ops), sph = FM.sphere(cell, 0.9), classes = {};
  sph.forEach(h => { const key = FM.canonical(h[0], h[1], h[2], rots); (classes[key] = classes[key] || []).push(h); });
  const F = FM.calcF([na, cl], ops, sph, a.core.formFactor, 'xray'), amp2 = {};
  sph.forEach((h, i) => { amp2[h.join()] = F.re[i] ** 2 + F.im[i] ** 2; });
  const refl = Object.keys(classes).map((key, g) => { const h = classes[key][0], m = classes[key].length; return { h: h[0], k: h[1], l: h[2], m, lp: 1, area: m * amp2[h.join()], group: g, inRange: true }; });
  const run = (atoms, type) => FM.build({ cell, ops, atoms, radiation: 'xray', formFactor: a.core.formFactor, refl, type, dmin: 0.9 });
  const diff = run([na], 'diff'), top = diff.peaks[0];
  assert.ok(diff.N >= 8 && diff.nObs > 10 && diff.sigma > 0);
  assert.equal(top.sign, 1); assert.ok(top.sigmas > 3, 'peak ' + top.sigmas);
  const dist = o => Math.hypot(...[top.x, top.y, top.z].map((v, i) => { const d = v - o[i]; return (d - Math.round(d)) * 5.64; }));
  assert.ok(Math.min(...FM.orbit(ops, [0.5, 0, 0]).map(dist)) < 0.2, JSON.stringify(top));
  assert.equal(top.atom, 'Na1'); assert.ok(top.distance > 2.7 && top.distance < 2.9, 'distance to the nearest atom ' + top.distance);
  // the complete model leaves no difference peak; the observed map shows both atoms
  assert.ok(run([na, cl], 'diff').sigma < diff.sigma / 20);
  const obs = run([na], 'obs'); assert.ok(obs.peaks.length >= 1);
});


test('sum constraint refine flags toggle together in the target dataset', () => {
  const a=app();a.S.calculation='rietveld';
  const ph=a.state.makePhase({name:'NaCl',sg:a.state.resolveSG(1),cell:{a:5,b:5,c:5},atoms:[
    {label:'Na1',type:'Na',x:0,y:0,z:0,occ:.5,B:.5},
    {label:'Cl1',type:'Cl',x:.5,y:.5,z:.5,occ:.5,B:.5}]});
  a.state.addPhase(ph);
  const one=a.state.makeDataset({name:'one',tth:[10,20,30],y:[1,2,1]}),two=a.state.makeDataset({name:'two',tth:[10,20,30],y:[1,2,1]});
  a.S.datasets.push(one,two);
  const names=['Na1','Cl1'].map(n=>ph.key+'.'+n+'.occ');
  ph.constraints=[{kind:'sum',component:'occ',atoms:['Na1','Cl1'],mult:[1,1],total:1}];
  names.forEach(n=>{one.fit[n]=false;two.fit[n]=false;});
  a.state.setFit(names[0],true,[one]);
  names.forEach(n=>{assert.equal(one.fit[n],true);assert.equal(two.fit[n],false);});
  const plan=a.context.AtomicConstraints.prepare(a.state.jobFor(one));
  assert.equal(plan.vars.filter(v=>names.includes(v.name)).length,1,'the sum has only one independent variable');
  a.state.setFit(names[1],false,[one]);names.forEach(n=>assert.equal(one.fit[n],false));
  a.S.calculation='wppf';a.state.setFit(names[0],true,[one]);assert.equal(one.fit[names[1]],false);
});

test('sum constraints identify bounds that leave no refinement freedom', () => {
  const a=app(),AC=a.context.AtomicConstraints,ph={key:'p1',v:{}};
  const c={kind:'sum',component:'occ',atoms:['Na1','Cl1'],mult:[1,1],total:2};
  assert.equal(AC.sumInfo(ph,c,{}).noFreedom,true);
  c.total=1;assert.equal(AC.sumInfo(ph,c,{}).noFreedom,false);
  c.total=0;assert.equal(AC.sumInfo(ph,c,{}).noFreedom,true);
  c.mult=[1,-1];c.total=1;assert.equal(AC.sumInfo(ph,c,{}).noFreedom,true);
  c.total=0;assert.equal(AC.sumInfo(ph,c,{}).noFreedom,false);
});


test('editing either sum or equivalence term updates its partner with refinement on or off', () => {
  const a=app();a.S.calculation='rietveld';
  const ph=a.state.makePhase({name:'NaCl',sg:a.state.resolveSG(1),cell:{a:5,b:5,c:5},atoms:[
    {label:'Na1',type:'Na',x:0,y:0,z:0,occ:.5,B:.5},{label:'Cl1',type:'Cl',x:.5,y:.5,z:.5,occ:.5,B:.5}]});
  a.state.addPhase(ph);const ds=a.state.makeDataset({name:'Pattern',tth:[10,20,30],y:[1,2,1]});a.S.datasets.push(ds);
  const [na,cl]=['Na1','Cl1'].map(n=>ph.key+'.'+n+'.occ');
  ph.constraints=[{kind:'sum',component:'occ',atoms:['Na1','Cl1'],mult:[1,1],total:1}];
  for(const on of [false,true]){
    a.state.setFit(na,on,[ds]);
    assert.equal(a.state.setParam(na,.3,[ds]),true);assert.ok(Math.abs(ds.p[cl]-.7)<1e-12);
    assert.equal(a.state.setParam(cl,.4,[ds]),true);assert.ok(Math.abs(ds.p[na]-.6)<1e-12);
  }
  ph.constraints[0].total=2;ds.p[na]=ds.p[cl]=1;
  assert.equal(a.state.setParam(na,.9,[ds]),false);assert.equal(ds.p[na],1);assert.equal(ds.p[cl],1);
  ph.constraints=[{kind:'equiv',component:'occ',atoms:['Na1','Cl1'],mult:[1,2]}];
  assert.equal(a.state.setParam(na,.3,[ds]),true);assert.ok(Math.abs(ds.p[cl]-.6)<1e-12);
  assert.equal(a.state.setParam(cl,.4,[ds]),true);assert.ok(Math.abs(ds.p[na]-.2)<1e-12);
});

test('editing either end of a dataset link updates its source and all dependents', () => {
  const a=model(),source=a.ds,other=a.state.makeDataset({name:'Other',tth:[10,20,30],y:[1,2,1]}),third=a.state.makeDataset({name:'Third',tth:[10,20,30],y:[1,2,1]});a.S.datasets.push(other,third);
  a.S.parameterLinks=[{source:{datasetId:source.id,name:'zero'},target:{datasetId:other.id,name:'zero'},factor:2,offset:.1},{source:{datasetId:source.id,name:'zero'},target:{datasetId:third.id,name:'zero'},factor:3,offset:0}];
  assert.equal(a.state.setParam('zero',.2,[source]),true);assert.ok(Math.abs(other.p.zero-.5)<1e-12);
  assert.equal(a.state.setParam('zero',.7,[other]),true);assert.ok(Math.abs(source.p.zero-.3)<1e-12);assert.ok(Math.abs(third.p.zero-.9)<1e-12);
  a.S.limits.zero=[-.4,.4];const before=[source.p.zero,other.p.zero,third.p.zero];
  assert.equal(a.state.setParam('zero',2,[other]),false);assert.deepEqual([source.p.zero,other.p.zero,third.p.zero],before);
});


test('geometry helper writes bond and angle windows for distinct atom labels', () => {
  const MR=require('../js/molecule_rules.js'),AR=require('../js/atom_restraints.js');
  const bond=MR.geometryRules({kind:'bond',center:'Si',neighbours:['O1'],distance:1.62,distanceTol:.03});
  assert.equal(bond.text,'Si O1 - 1.5900/1.6500');assert.equal(bond.angles,0);
  const angle=MR.geometryRules({kind:'angle',center:'O',neighbours:['H1','H2'],distance:.96,secondDistance:.96,distanceTol:.03,angle:104.5,angleTol:3});
  const windows=AR.parse(angle.text).windows;assert.equal(windows.length,3);
  assert.ok(Math.abs(windows[2].dmin-2*.96*Math.sin(101.5*Math.PI/360))<.0001);
  assert.ok(Math.abs(windows[2].dmax-2*.96*Math.sin(107.5*Math.PI/360))<.0001);
  for(const [kind,count] of [['linear',2],['triangle',3],['tetrahedron',4],['square',4],['octahedron',6]]){
    const neighbours=Array.from({length:count},(_,i)=>'O'+(i+1));
    const r=MR.geometryRules({kind,center:'Si',neighbours,distance:2,distanceTol:.03,angleTol:3});
    assert.equal(r.bonds,count);assert.equal(r.angles,count*(count-1)/2);assert.equal(AR.parse(r.text).bad.length,0);
    if(kind==='square' || kind==='octahedron')assert.equal(r.pairs.filter(p=>p.angle===180).length,count/2);
  }
  assert.throws(()=>MR.geometryRules({kind:'tetrahedron',center:'Si',neighbours:['O1'],distance:2,distanceTol:.03,angleTol:3}),/exactly 4/);
  assert.throws(()=>MR.geometryRules({kind:'bond',center:'Si',neighbours:['Si'],distance:2,distanceTol:.03}),/distinct/);
  assert.throws(()=>MR.geometryRules({kind:'bond',center:'Si',neighbours:['O'],distance:2,distanceTol:-1}),/tolerance/);
});

test('generated tetrahedral restraints accept ideal geometry and penalize distortion', () => {
  const a=app(),MR=require('../js/molecule_rules.js'),AR=a.context.AtomRestraints;
  const vectors=[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],scale=2/Math.sqrt(3)/20;
  const atoms=[{label:'Si',type:'Si',x:.5,y:.5,z:.5,occ:1,B:.5}].concat(vectors.map((v,i)=>({label:'O'+(i+1),type:'O',x:.5+scale*v[0],y:.5+scale*v[1],z:.5+scale*v[2],occ:1,B:.5})));
  a.state.addPhase(a.state.makePhase({name:'Tetrahedron',sg:a.state.resolveSG(1),cell:{a:20,b:20,c:20},atoms}));
  const ph=a.S.phases[0],def=a.state.phaseDefs()[0],r={on:true,text:MR.geometryRules({kind:'tetrahedron',center:'Si',neighbours:['O1','O2','O3','O4'],distance:2,distanceTol:.03,angleTol:3}).text,weight:1,sigmaD:.02};
  const ctx={cellOf:a.core.cellOf,sitePosition:a.core.sitePosition};
  const ideal=AR.rows(def,r,ph.v,ctx);assert.equal(ideal.length,10);assert.ok(ideal.every(row=>row.dev===0));
  const distorted={...ph.v,[ph.key+'.O1.x']:ph.v[ph.key+'.O1.x']+.04};assert.ok(AR.rows(def,r,distorted,ctx).some(row=>Math.abs(row.dev)>.1));
});


test('symmetry geometry rules retain independent angular windows and penalize only outside them', () => {
  const a=app(),MR=require('../js/molecule_rules.js'),AR=a.context.AtomRestraints;
  const generated=MR.geometryRules({kind:'octahedron',mode:'symmetry',center:'A',neighbours:['B'],distance:3.46,distanceTol:.06,angleTol:25});
  assert.match(generated.text,/A B 6 3.4000\/3.5200 octahedron angle=25/);
  assert.equal(AR.parse(generated.text).windows[0].angleTol,25);
  assert.ok(AR.parse('A B - 1/2 angle=3').bad.length);
  assert.ok(AR.parse('A B 6 1/2 oct angle=-1').bad.length);
  assert.ok(AR.parse('A B 6 1/2 oct angle=NaN').bad.length);
  const ph=a.state.makePhase({name:'Distorted shell',sg:a.state.resolveSG(1),cell:{a:4,b:4,c:4},atoms:[{label:'A',type:'Na',x:0,y:0,z:0,B:.5,occ:1},{label:'B',type:'Cl',x:.5,y:.5,z:.5,B:.5,occ:1}]});a.state.addPhase(ph);
  const def=a.state.phaseDefs()[0],ctx={cellOf:a.core.cellOf,sitePosition:a.core.sitePosition};
  const rows=text=>AR.rows(def,{text,weight:1,sigmaA:3},ph.v,ctx).filter(r=>r.kind==='ang');
  assert.ok(rows(generated.text).every(r=>r.dev===0));
  const strict=rows(generated.text.replace(' angle=25','')),narrow=rows(generated.text.replace('angle=25','angle=10'));
  assert.ok(strict.some(r=>Math.abs(r.dev)>19));assert.ok(narrow.some(r=>Math.abs(r.dev)>9));assert.ok(narrow.every((r,i)=>Math.abs(r.dev)<=Math.abs(strict[i].dev)));
});


test('restraints reject repeated atom pairs (ordered for counted rules) regardless of windows or geometry', () => {
  const AR=require('../js/atom_restraints.js'),atoms=['Si','O1','O2'].map(label=>({label}));
  for(const text of ['Si O1 - 1.5/1.7\nO1 Si - 1.4/1.8','Si O1 4 1.5/1.7 tet angle=3\nSi O1 4 1.5/1.7 tetrahedron angle=5','Si O1 - 1.5/1.7\nsi o1 - 1.6/1.8'])assert.ok(AR.check(atoms,{text}).errors.some(e=>/Duplicate restraint/.test(e)));
  // the O1 around Si and the Si around O1 are two different rules
  assert.deepEqual(AR.check(atoms,{text:'Si O1 4 1.5/1.7 tet\nO1 Si 2 1.5/1.7'}).errors,[]);
  assert.ok(AR.check(atoms,{text:'Si O1 4 1.5/1.7 tet\nSi O1 4+ 1.5/1.8'}).errors.some(e=>/Duplicate restraint/.test(e)));
  const result=AR.merge(atoms,'Si O1 - 1.5/1.7','O1 Si - 1.4/1.8\nSi O2 - 1.5/1.7\nO2 Si - 1.3/1.9');
  assert.equal(result.added,1);assert.equal(result.skipped,2);assert.equal(result.conflicts,2);assert.equal(result.text,'Si O1 - 1.5/1.7\nSi O2 - 1.5/1.7');
  const again=AR.merge(atoms,result.text,result.text);assert.equal(again.conflicts,0);assert.equal(again.added,0);assert.equal(again.text,result.text);
  assert.throws(()=>AR.merge(atoms,'','Si Missing - 1/2'),/not an atom label/);
});

test('overlapping geometry helpers keep existing bonds and angle-distance rules exactly once', () => {
  const AR=require('../js/atom_restraints.js'),MR=require('../js/molecule_rules.js'),atoms=['Si','O1','O2','O3','O4'].map(label=>({label}));
  const tetra=MR.geometryRules({kind:'tetrahedron',center:'Si',neighbours:['O1','O2','O3','O4'],distance:1.62,distanceTol:.03,angleTol:3}).text;
  const initial=AR.merge(atoms,'O1 Si - 1.50/1.70',tetra);assert.equal(initial.added,9);assert.equal(initial.skipped,1);assert.equal(AR.check(atoms,{text:initial.text}).rules.length,10);
  const angle=MR.geometryRules({kind:'angle',center:'Si',neighbours:['O2','O1'],distance:1.62,secondDistance:1.62,distanceTol:.03,angle:109.47,angleTol:3}).text;
  const again=AR.merge(atoms,initial.text,angle);assert.equal(again.added,0);assert.equal(again.skipped,3);assert.equal(again.text,initial.text);
});


test('restraint text applies automatically even with a legacy disabled flag, and clearing removes it', () => {
  const a=model(),AR=a.context.AtomRestraints,ph=a.S.phases[0],ctx={cellOf:a.core.cellOf,sitePosition:a.core.sitePosition};
  ph.restraints={on:false,text:'Si1 Si1 - 6/',weight:1,sigmaD:.02,sigmaA:3};
  assert.equal(AR.active(ph.restraints),true);assert.equal(AR.normalize(ph.restraints).on,true);
  const plan=AR.prepare(a.state.problemFor([a.ds]),ctx);assert.ok(plan);assert.ok(plan.cost([a.ds.p])>0);
  ph.restraints.text='';assert.equal(AR.prepare(a.state.problemFor([a.ds]),ctx),null);
  assert.equal(AR.active({text:'# just a comment'}),false);
});

test('restraint rules follow renamed atoms (any case) and lose deleted ones', () => {
  const AR=require('../js/atom_restraints.js'),labels=['Fe1','O1','O2'];
  assert.equal(AR.relabel(labels,'fe1 O1 6 1.9/2.1 oct angle=3\n# Fe1 kept\nO1 Fe1 - /2.2',  'Fe1','Fe9'),'Fe9 O1 6 1.9/2.1 oct angle=3\n# Fe1 kept\nO1 Fe9 - /2.2');
  const p=AR.prune(['Fe1','O1'].map(label=>({label})),{text:'Fe1 O1 - 1.9/2.1\nFe1 O2 - 1.9/2.1\n# O2 note'});
  assert.equal(p.text,'Fe1 O1 - 1.9/2.1\n# O2 note');assert.deepEqual(p.dropped,['Fe1 O2 - 1.9/2.1']);
});

test('restraint neighbours: oblique cells, images across the cell face, and far shells', () => {
  const AR=require('../js/atom_restraints.js'),I={r:[1,0,0,0,1,0,0,0,1],t:[0,0,0]},inv={r:[-1,0,0,0,-1,0,0,0,-1],t:[0,0,0]};
  const ctxOf=cell=>({cellOf:()=>cell,sitePosition:(s,p)=>p});
  const def={key:'p1',atoms:[{label:'A'},{label:'B'}],ops:[I]};
  // gamma = 170 degrees: the cell is 0.87 A high along a and b, so shells reach many cells away
  const cell={a:5,b:5,c:6,alpha:90,beta:90,gamma:170},v={'p1.A.x':0,'p1.A.y':0,'p1.A.z':0,'p1.B.x':0.3,'p1.B.y':0.1,'p1.B.z':0};
  const rows=AR.rows(def,{text:'A B 6 /3'},v,ctxOf(cell)).filter(r=>r.kind==='d').map(r=>r.val);
  const cg=Math.cos(170*Math.PI/180),all=[];
  for(let i=-15;i<=15;i++)for(let j=-15;j<=15;j++)for(let k=-2;k<=2;k++){const x=0.3+i,y=0.1+j,z=k;all.push(Math.sqrt(25*x*x+25*y*y+36*z*z+2*25*x*y*cg));}
  all.sort((p,q)=>p-q);rows.forEach((d,n)=>assert.ok(Math.abs(d-all[n])<1e-9,'neighbour '+(n+1)));
  // an atom 2e-5 inside the cell face and its inverse 2e-5 beyond it are one image, not two
  const cub={a:5,b:5,c:5,alpha:90,beta:90,gamma:90},d2={key:'p1',atoms:[{label:'A'},{label:'B'}],ops:[I,inv]};
  const w={'p1.A.x':0.99998,'p1.A.y':0,'p1.A.z':0,'p1.B.x':0.2,'p1.B.y':0,'p1.B.z':0};
  const near=AR.rows(d2,{text:'B A 2 /9'},w,ctxOf(cub)).filter(r=>r.kind==='d');
  assert.ok(Math.abs(near[0].val-1)<1e-3);assert.ok(Math.abs(near[1].val-4)<1e-3,'second neighbour is the next cell, got '+near[1].val);
  // a shell wider than the first search radius is still real atoms, not a constant at the radius
  const far=AR.rows(def,{text:'A B 3 /1.0'},{'p1.A.x':0,'p1.A.y':0,'p1.A.z':0,'p1.B.x':0.5,'p1.B.y':0.5,'p1.B.z':0.5},ctxOf({a:20,b:20,c:20,alpha:90,beta:90,gamma:90})).filter(r=>r.kind==='d');
  far.forEach(r=>assert.ok(Math.abs(r.val-Math.sqrt(300))<1e-9));
});

test('an equivalence whose independent parameter is a link target follows the link source', () => {
  const a=app(),AC=a.context.AtomicConstraints,site={free:[0,1,2]};
  const plan=AC.prepare({phases:[{key:'p1',method:'rietveld',atoms:[{label:'A',site},{label:'B',site}],constraints:[{kind:'equiv',component:'B',atoms:['A','B'],mult:[1,2]}]}],
    datasets:[{id:1,phases:['p1']},{id:2,phases:['p1']}],values:[{'p1.A.B':1,'p1.B.B':2},{'p1.A.B':3,'p1.B.B':6}],vars:[{name:'p1.A.B',d:0},{name:'p1.A.B',d:1}],
    parameterLinks:[{target:{datasetId:2,name:'p1.A.B'},source:{datasetId:1,name:'p1.A.B'},factor:1}],limits:{}});
  assert.equal(plan.vars.length,1);
  const out=plan.apply(plan.values.map(v=>Object.assign({},v)),[0.5]);
  assert.equal(out[1]['p1.A.B'],0.5);assert.equal(out[1]['p1.B.B'],1);assert.equal(out[0]['p1.B.B'],1);
});

test('removing an atom drops a constraint equation whole, with its text', () => {
  const a=app(),AC=a.context.AtomicConstraints,gone=[];
  const out=AC.withoutAtom([{kind:'sum',component:'occ',atoms:['A','B','C'],mult:[1,1,1],total:1},{kind:'equiv',component:'B',atoms:['A','C'],mult:[1,1]}],'B',gone);
  assert.equal(out.length,1);assert.equal(out[0].kind,'equiv');assert.equal(gone.length,1);assert.match(gone[0],/= 1$/);
});

test('automatic anomalous corrections follow wavelength and the enable flag, and never affect neutrons',()=>{
  const a=model(),ds=a.ds;
  assert.equal(ds.inst.anomalousEnabled,true);
  const enabled=a.state.problemFor([ds]).datasets[0];
  assert.equal(enabled.anomalousData.source,'Chantler');assert.ok(enabled.anomalous.SI[0]>.2 && enabled.anomalous.SI[1]>.3);
  const first=a.state.calcFor(ds);
  a.state.setInstrument([ds],{anomalousEnabled:false});
  assert.deepEqual(plain(a.state.problemFor([ds]).datasets[0].anomalous),{});
  const off=a.state.calcFor(ds);assert.notStrictEqual(first,off);assert.ok(Array.from(first.ycalc).some((x,i)=>Math.abs(x-off.ycalc[i])>1e-8));
  a.state.setInstrument([ds],{anomalousEnabled:true,lambda1:.7093,lambda2:0,ratio:0});
  assert.notDeepEqual(plain(a.state.problemFor([ds]).datasets[0].anomalous.SI),plain(enabled.anomalous.SI));
  a.state.setInstrument([ds],{radiation:'neutron'});
  const neutron=a.state.problemFor([ds]).datasets[0];assert.deepEqual(plain(neutron.anomalous),{});assert.equal(neutron.anomalousData.enabled,false);
});
test('missing anomalous data blocks enabled X-ray fits but disabling corrections permits the comparison',()=>{
  const a=model(),copy={...tables};delete copy.anomalous;a.state.setTables(copy);
  assert.match(a.state.calculationIssue([a.ds]),/anomalous.*unavailable/i);
  a.state.setInstrument([a.ds],{anomalousEnabled:false});assert.equal(a.state.calculationIssue([a.ds]),'');
});
test('used anomalous corrections survive History and projects and appear in reports independently of current tables',()=>{
  const a=model(),H=a.context.RV.fitHistory,ticket=H.begin([a.ds],false),job=a.state.jobFor(a.ds),result=a.core.refine(job);
  assert.ok(result.ok,result.msg);a.state.applyResult([a.ds],result,job,false);
  const used=plain(a.ds.stats.anomalousData),record=H.complete(ticket,[a.ds],false);
  const report=a.context.RV.results.reportText([a.ds]);assert.match(report,/anomalous scattering\tenabled\tsource: Chantler/);assert.ok(report.includes('SI\t'+used.map.SI[0]+'\t'+used.map.SI[1]));
  assert.ok(H.runReport(record).includes('Anomalous scattering'));
  a.state.setInstrument([a.ds],{anomalousEnabled:false});
  assert.match(a.context.RV.results.reportText([a.ds]),/anomalous scattering\tdisabled/);
  const changed=JSON.parse(JSON.stringify(tables.anomalous));changed.Si.table.forEach(row=>row[1]+=2);
  a.state.setTables({...tables,anomalous:changed});
  H.withResult(record,()=>{assert.deepEqual(plain(a.state.problemFor(a.state.selected()).datasets[0].anomalous),used.map);assert.ok(a.context.RV.results.reportText(a.state.selected()).includes('SI\t'+used.map.SI[0]));});
  assert.equal(a.ds.inst.anomalousEnabled,false);
  a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
  assert.equal(a.S.datasets[0].inst.anomalousEnabled,false);
  const saved=H.find(record.id);assert.deepEqual(plain(saved.datasets[0].stats.anomalousData),used);
  const legacy=plain(saved);legacy.datasets.forEach(d=>{delete d.stats.anomalousData;delete d.inst.anomalousEnabled;});
  H.withResult(legacy,()=>{const old=a.state.problemFor(a.state.selected()).datasets[0];assert.deepEqual(plain(old.anomalous),{});assert.equal(old.anomalousData.enabled,false);assert.match(a.context.RV.results.reportText(a.state.selected()),/anomalous scattering\tdisabled\tsource: Saved legacy input/);});
});

test('simulation uses the selected anomalous factors in every starting method and preserves the working setup',()=>{
  let reference;
  for(const method of ['rietveld','wppf','lebail']){
    const a=model();a.state.setCalculation(method);
    const phase=a.S.phases[0],inst=a.state.instCopy(a.ds.inst);
    a.S.disabledPhases=[phase.key];
    const before=plain({method:a.S.calculation,phases:a.S.phases,inst:a.ds.inst,p:a.ds.p,disabled:a.S.disabledPhases});
    const options={phases:[phase.key],tthMin:10,tthMax:80,step:.25,peak:0,bkg:3,noise:false,seed:7};
    const on=a.state.simulate({...options,inst:{...inst,anomalousEnabled:true}});
    const off=a.state.simulate({...options,inst:{...inst,anomalousEnabled:false}});
    assert.equal(on.sim.anomalousData.source,'Chantler');assert.deepEqual(Object.keys(on.sim.anomalousData.map),['SI']);
    assert.deepEqual(plain(off.sim.anomalousData.map),{});
    assert.ok(Array.from(on.y).some((y,i)=>Math.abs(y-off.y[i])>1e-8),method+': the flag must change the generated observations');
    assert.ok(Math.max(...on.y)>options.bkg,method+': the chosen phase must be simulated even if disabled for fitting');
    const mo=a.state.simulate({...options,inst:{...inst,lambda1:.7093,anomalousEnabled:true}});
    assert.notDeepEqual(plain(mo.sim.anomalousData.map.SI),plain(on.sim.anomalousData.map.SI));
    const neutronOn=a.state.simulate({...options,inst:{...inst,radiation:'neutron',anomalousEnabled:true}});
    const neutronOff=a.state.simulate({...options,inst:{...inst,radiation:'neutron',anomalousEnabled:false}});
    assert.equal(neutronOn.sim.anomalousData.enabled,false);assert.deepEqual(Array.from(neutronOn.y),Array.from(neutronOff.y));
    assert.deepEqual(plain({method:a.S.calculation,phases:a.S.phases,inst:a.ds.inst,p:a.ds.p,disabled:a.S.disabledPhases}),before);
    if(reference)assert.deepEqual(Array.from(on.y),reference,method+': simulation must not depend on the active fit method');else reference=Array.from(on.y);
    a.state.insertDatasets([on],{estimate:false});a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
    assert.deepEqual(plain(a.S.datasets[0].sim.anomalousData),plain(on.sim.anomalousData));
  }
});
