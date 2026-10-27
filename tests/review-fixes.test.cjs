const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),test=require('node:test');
function ui(){const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},console,setTimeout,clearTimeout});context.window=context;context.addEventListener=()=>{};vm.runInContext(fs.readFileSync('js/rietveld/rv_ui.js','utf8'),context);return context.RV.ui;}
test('very small report uncertainties remain nonzero and retain the value precision',()=>{
  const u=ui();assert.equal(u.withEsd(5.64021,.00003),'5.64021(3)');
  assert.equal(u.withEsd(.123456789,1e-10),'1.2345678900e-1 ± 1.0e-10');
  assert.equal(u.withEsd(1.23456789e-9,1e-12),'1.2346e-9 ± 1.0e-12');
  assert.equal(u.withEsd(0,1e-12),'0e+0 ± 1.0e-12');
  assert.equal(u.withEsd(-1.23456789e-9,1e-12),'-1.2346e-9 ± 1.0e-12');
});
function panels(){
  const phases=[{key:'p1',name:'First',method:'wppf'},{key:'p2',name:'Later',method:'wppf'}];
  const S={phases,disabledPhases:[],parameterLinks:[],sel:new Set([1,2])};
  const nodes=new Map();const node=q=>{if(!nodes.has(q))nodes.set(q,{hidden:false,textContent:'',innerHTML:'',setAttribute(){},addEventListener(type,fn){this[type]=fn;}});return nodes.get(q);};
  const St={S,load:()=>null,fitNames:d=>Object.keys(d.fit).filter(n=>d.fit[n]),instrumentParamsFor:()=>[['U']],hasPhase:(d,p)=>d.phases.includes(p.key)};
  const context=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},RV:{state:St,ui:{esc:String}},RVCore:{classify:n=>({kind:n.startsWith('inst.')?'instrument':'cell',phase:n.split('.')[0],comp:n.split('.')[1]})}});
  // Expose the private summary in this VM only, without widening the production API.
  const source=fs.readFileSync('js/rietveld/rv_panels.js','utf8').replace('return { init: init,','return { onLimit:onLimit, initSettings:initSettings, fitGroups:fitGroups, init: init,');
  vm.runInContext(source,context);return {RV:context.RV,S,St,node};
}
test('global summary uses first holders and includes phases absent from the first dataset',()=>{
  const {RV}=panels(),first={p:{'p1.a':5,'inst.U':1},fit:{'p1.a':false,'inst.U':true},phases:['p1']},later={p:{'p1.a':6,'p2.a':7,'inst.U':2},fit:{'p1.a':true,'p2.a':true,'inst.U':true},phases:['p1','p2']};
  const g=RV.panels.fitGroups(first,[first,later]);assert.equal(g.count,2);
  assert.ok(g.rows.some(r=>r[0]==='Later · cell'));
  assert.ok(g.rows.some(r=>r[0]==='Later · intensities'));
  assert.ok(!g.rows.some(r=>r[0]==='First · cell'));
  assert.equal(RV.panels.fitGroups(first).count,1);
});
test('empty limits view clears stale sharing controls and reset label',()=>{
  const {RV,St,node}=panels();St.first=()=>null;node('#fit-sharing').hidden=false;node('#lim-reset').textContent='All limits and shared flags to their defaults';RV.panels.renderLimits();assert.equal(node('#fit-sharing').hidden,true);assert.equal(node('#lim-reset').textContent,'All limits to their defaults');
});

test('limit edits and both reset actions snapshot the prior configuration for undo',()=>{
  const {RV,St,S,node}=panels(),snapshots=[];
  const ds={p:{zero:0},fit:{},phases:[]};S.limits={};S.shared={};S.settings={};
  St.first=()=>ds;St.namesFor=()=>[];St.isVariable=()=>true;St.limitsOf=n=>(S.limits[n]||[-1,1]).slice();St.fromDisplay=(n,v)=>v;St.toDisplay=(n,v)=>v;St.isSizeParam=()=>false;
  St.setLimit=(n,lo,hi)=>{S.limits[n]=[lo,hi];};St.clearLimit=n=>{delete S.limits[n];};
  RV.history={take:()=>snapshots.push(JSON.parse(JSON.stringify({limits:S.limits,shared:S.shared})))};
  RV.ui.parseNum=Number;RV.ui.toast=()=>{};RV.ui.fmt=String;RV.bus={on(){},emit(){}};
  const tr={getAttribute:()=> 'zero'};
  const input={value:'-.5',closest:()=>tr,hasAttribute:()=>false,getAttribute:k=>k==='data-lim'?'0':null,classList:{add(){},remove(){}}};
  RV.panels.onLimit({target:input});assert.deepEqual(S.limits.zero,[-.5,1]);assert.deepEqual(snapshots[0].limits,{});
  RV.panels.onLimit({target:input});assert.equal(snapshots.length,1,'unchanged values should not add undo records');
  RV.panels.initSettings();node('#limits').click({target:{closest:q=>q==='tr'?tr:{}}});
  assert.deepEqual(snapshots[1].limits.zero,[-.5,1]);assert.equal(S.limits.zero,undefined);
  S.limits={zero:[-.25,.25]};node('#lim-reset').click();assert.deepEqual(snapshots[2].limits.zero,[-.25,.25]);assert.deepEqual(Object.keys(S.limits),[]);
  S.shared={zero:false};St.namesFor=()=>['zero'];St.shareable=()=>true;St.selected=()=>[ds,ds];S.sel=new Set([1]);ds.id=1;St.load=()=>null;RV.app={fitMode:()=> 'global'};
  St.isShared=n=>S.shared[n]!==false;St.setShared=(n,v)=>{S.shared[n]=v;};
  RV.panels.onLimit({target:{closest:()=>tr,hasAttribute:k=>k==='data-shared',checked:true}});
  assert.equal(snapshots[3].shared.zero,false);assert.equal(S.shared.zero,true);
  node('#lim-reset').click();assert.equal(snapshots[4].shared.zero,true);assert.deepEqual(Object.keys(S.shared),[]);
});
test('startup dependency check allows missing compression but still diagnoses required modules',()=>{
  const source=fs.readFileSync('js/rietveld/rv_app.js','utf8'),prefix=source.slice(0,source.indexOf('  var S = RV.state.S'))+'})();';
  const required=source.match(/var REQUIRED = (\[[\s\S]*?\]);/)[1],context=vm.createContext({});context.window=context;
  for(const name of vm.runInContext(required,context)){const parts=name.split('.');let obj=context;for(const part of parts)obj=obj[part]||(obj[part]={});}
  assert.doesNotThrow(()=>vm.runInContext(prefix,context));
  context.document={createElement:()=>({setAttribute(){}}),body:{prepend(){}}};delete context.RVCore;
  assert.throws(()=>vm.runInContext(prefix,context),/missing modules RVCore/);
});
