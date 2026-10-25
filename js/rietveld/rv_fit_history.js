/* Completed calculations are immutable checkpoints. Observation arrays are shared by
   dataKey; parameter/model records never contain copies of the powder patterns. */
RV.fitHistory = (function () {
  'use strict';
  var St=RV.state,S=St.S,records=[],models={},data={},serial=1,method='lebail',busyView=false,active={},historySelected={};
  function clone(x){return JSON.parse(JSON.stringify(x,function(k,v){return ArrayBuffer.isView(v)?Array.from(v):v;}));}
  function bytes(x){return new TextEncoder().encode(JSON.stringify(x)).length;}
  function phaseDoc(p){return {key:p.key,name:p.name,color:p.color,method:p.method,number:p.sg.number,symbol:p.sg.symbol,hall:p.sg.hall,profileType:p.profileType,separatedProfile:p.separatedProfile,broadening:p.broadening,poDir:p.poDir,constraints:p.constraints,atoms:p.atoms.map(function(a){return {label:a.label,type:a.type};}),v:p.v,fit:p.fit,provenance:p.provenance || null};}
  function observation(d){data[d.dataKey]={key:d.dataKey,tth:d.tth,y:d.y,sig:d.sig,weights:d.weights};return d.dataKey;}
  function model(list){var keys=new Set();list.forEach(function(d){d.phases.forEach(function(k){keys.add(k);});});var value=clone(S.phases.filter(function(p){return keys.has(p.key);}).map(phaseDoc)),json=JSON.stringify(value),key=Object.keys(models).find(function(k){return JSON.stringify(models[k])===json;});if(!key){key='model-'+serial++;models[key]=value;}return key;}
  function dataset(d){var atoms=St.atomicValues(d);return clone({id:d.id,dataKey:observation(d),name:d.name,color:d.color || null,inst:d.inst,phases:d.phases,p:Object.keys(d.p).reduce(function(o,n){o[n]=Number.isFinite(atoms[n])?atoms[n]:d.p[n];return o;},{}),step:d.step,fit:d.fit,esd:d.esd,stats:d.stats,ints:d.ints,apart:d.apart,sim:d.sim});}
  function options(){return clone({refinement:St.refinementOptions(),maxIter:S.settings.maxIter,tol:S.settings.tol,weight:S.settings.weight,shared:S.shared,limits:Object.keys(S.limits).reduce(function(o,k){o[k]=S.limits[k].map(function(v){return v===Infinity?'inf':v===-Infinity?'-inf':v;});return o;},{}),fitmode:St.load('fitmode') || 'single',disabledPhases:S.disabledPhases.slice(),parameterLinks:S.parameterLinks || []});}
  function begin(list,global){var ids=new Set(list.map(function(d){return d.id;})),sources=S.parameterLinks.filter(function(l){return ids.has(l.target.datasetId) && !ids.has(l.source.datasetId);}).map(function(l){return St.byId(l.source.datasetId);}).filter(function(d,i,a){return d && a.indexOf(d)===i;});return {dependencies:sources.map(dataset),method:S.calculation,time:new Date().toISOString(),model:model(list.concat(sources)),options:options(),global:!!global,targets:list.map(function(d){return d.id;}),refined:list.map(function(d){return {id:d.id,names:St.fitNames(d)};})};}
  function complete(ticket,list,stopped){if(!ticket)return null;var included=list.filter(function(d){return d && d.stats && d.stats.ok!==false;});if(!included.length){gc();return null;}var r=Object.assign({},ticket,{id:'run-'+serial++,kind:'fit',pinned:false,stopped:!!stopped,datasets:included.map(dataset)});r.bytes=bytes(r);records.push(r);active[r.method]={id:r.id};prune();RV.bus.emit('fitHistory');return r;}
  function solution(kind,value){if(!value || !value.I)return;var d=St.byId(value.I.dsId);if(!d)return;var r=begin([d],false);r.id='run-'+serial++;r.kind=kind;r.method='wppf';r.pinned=false;r.datasets=[dataset(d)];r.solution=JSON.parse(JSON.stringify(value,function(k,v){if(['rho','bestRho','density','map','densityMap'].indexOf(k)>=0 && (Array.isArray(v)||ArrayBuffer.isView(v)))return undefined;return ArrayBuffer.isView(v)?Array.from(v):v;}));r.bytes=bytes(r);records.push(r);prune();RV.bus.emit('fitHistory');return r;}
  function gc(){var usedModels=new Set(records.map(function(r){return r.model;})),usedData=new Set();records.forEach(function(r){r.datasets.concat(r.dependencies || []).forEach(function(d){usedData.add(d.dataKey);});});S.datasets.forEach(function(d){usedData.add(d.dataKey);});Object.keys(models).forEach(function(k){if(!usedModels.has(k))delete models[k];});Object.keys(data).forEach(function(k){if(!usedData.has(k))delete data[k];});}
  // Models never change once stored, so their size is measured once per key.
  var modelBytes={};
  function modelSize(k){if(!(k in modelBytes))modelBytes[k]=bytes(models[k]);return modelBytes[k];}
  function historyBytes(){var n=records.reduce(function(n,r){if(!r.bytes)r.bytes=bytes(r);return n+r.bytes;},0);Object.keys(models).forEach(function(k){n+=modelSize(k);});Object.keys(modelBytes).forEach(function(k){if(!models[k])delete modelBytes[k];});return n;}
  function usage(){var observations=0;Object.keys(data).forEach(function(k){['tth','y','sig','weights'].forEach(function(f){if(data[k][f])observations+=data[k][f].length*8;});});return {history:historyBytes(),observations:observations,count:records.length,pinned:records.filter(function(r){return r.pinned;}).length};}
  function isActive(r){return r.kind==='fit' && !!active[r.method] && active[r.method].id===r.id;}
  // Fits, charge-flipping and Wyckoff records each keep their own quota, so structure searches never evict fits.
  function prune(){
    var budget=(S.settings.historyMB || 100)*1000000,limit=Math.max(1,S.settings.historyCount || 20),groups={};
    records.forEach(function(r){if(r.pinned)return;var g=r.method+'|'+r.kind;(groups[g]=groups[g] || []).push(r);});
    var drop=new Set();Object.keys(groups).forEach(function(g){var list=groups[g],excess=list.length-limit;list.forEach(function(r){if(excess>0 && !isActive(r)){drop.add(r);excess--;}});});
    if(drop.size)records=records.filter(function(r){return !drop.has(r);});
    gc();var total=historyBytes();
    while(total>budget){var r=records.find(function(r){return !r.pinned && !isActive(r);});if(!r)break;records.splice(records.indexOf(r),1);var before=Object.keys(models).length;gc();total-=r.bytes || 0;if(Object.keys(models).length!==before)total=historyBytes();}
  }
  function find(id){return records.find(function(r){return r.id===id;}) || null;}
  function list(m,kind){return records.filter(function(r){return (!m || r.method===m) && (!kind || r.kind===kind);});}
  function keep(id,on){var r=find(id);if(!r)return;records=records.map(function(old){return old===r?Object.assign({},old,{pinned:!!on}):old;});prune();RV.bus.emit('fitHistory');}
  function historyDisplay(){var choices=list(method).slice().reverse(),r=choices.find(function(item){return item.id===historySelected[method];}) || choices[0];return r?[r]:[];}
  function historyPicker(){var chosen=historyDisplay()[0];return '<label class="history-picker">Run <select data-history-run aria-label="History run">'+(list(method).slice().reverse().map(function(r){return '<option value="'+r.id+'"'+(r.pinned?' data-kept="true"':'')+(chosen && chosen.id===r.id?' selected':'')+'>'+RV.ui.esc((r.pinned?'★ Kept · ':'')+new Date(r.time).toLocaleString()+' - '+(r.kind==='fit'?RVCore.METHOD_LABELS[r.method]:r.kind)+' - '+r.id)+'</option>';}).join('') || '<option>No completed run</option>')+'</select></label>';}
  function latest(m){var selected=active[m],r=selected && find(selected.id) || records.slice().reverse().find(function(r){return r.method===m && r.kind==='fit';});if(!r)return null;return selected && selected.datasetId?Object.assign({},r,{datasets:r.datasets.filter(function(d){return d.id===selected.datasetId;})}):r;}
  function observationFor(d){return data[d.dataKey] || S.datasets.find(function(x){return x.dataKey===d.dataKey;});}
  function materialize(r){var defs=models[r.model];if(!defs)throw new Error('The saved model is missing.');var doc={format:'powder6-project',version:3,calculation:r.method,phases:defs,settings:Object.assign({},S.settings,r.options.refinement,{weight:r.options.weight}),shared:r.options.shared,limits:r.options.limits,datasets:r.datasets.concat(r.dependencies || []).map(function(d){var raw=observationFor(d);if(!raw)throw new Error('Observations for '+d.name+' are missing.');return Object.assign({},d,{tth:raw.tth,y:raw.y,sig:raw.sig,weights:raw.weights,apart:Object.keys(d.apart || {})});})};return St.prepareProject(doc);}
  // Repeated UI events can render the same immutable run several times during a
  // method switch. Keep its evaluated patterns rather than solving WPPF again.
  var resultPlots=new WeakMap();
  function withResult(r,fn){
    if(!r || busyView)return fn();
    var pj=materialize(r),cache=resultPlots.get(r);
    if(!cache || cache.tables!==S.tables){cache={tables:S.tables,plots:new Map()};resultPlots.set(r,cache);}
    var before={calculation:S.calculation,datasets:S.datasets,phases:S.phases,sel:S.sel,focus:S.focus,phaseSel:S.phaseSel,settings:S.settings,shared:S.shared,limits:S.limits,parameterLinks:S.parameterLinks,disabledPhases:S.disabledPhases};
    busyView=true;
    try{
      S.calculation=r.method;S.phases=pj.phases;
      var all=r.datasets.concat(r.dependencies || []);
      S.datasets=pj.raws.map(function(raw,i){return Object.assign({},all[i],{tth:observationFor(all[i]).tth,y:observationFor(all[i]).y,sig:observationFor(all[i]).sig,weights:observationFor(all[i]).weights,calc:cache.plots.get(all[i].id) || null,mem:{},step:all[i].step});});
      S.sel=new Set(r.datasets.map(function(d){return d.id;}));S.focus=null;
      S.phaseSel=S.phases.some(function(p){return p.key===before.phaseSel;})?before.phaseSel:S.phases[0] && S.phases[0].key;
      S.settings=pj.settings;S.shared=pj.shared;S.limits=pj.limits;S.parameterLinks=r.options.parameterLinks || [];S.disabledPhases=r.options.disabledPhases || [];
      return fn();
    }finally{
      S.datasets.forEach(function(d){if(d.calc)cache.plots.set(d.id,d.calc);});
      Object.keys(before).forEach(function(k){S[k]=before[k];});busyView=false;
    }
  }
  // Records are immutable, so their side of the comparison is serialized once.
  var changedCache=new WeakMap();
  function savedSide(r){var c=changedCache.get(r);if(c)return c;var defs=models[r.model] || [];c={disabled:JSON.stringify(r.options.disabledPhases || []),links:JSON.stringify(r.options.parameterLinks || []),model:JSON.stringify(models[r.model]),keys:new Set(defs.map(function(p){return p.key;})),
    datasets:r.datasets.map(function(old){return {id:old.id,dataKey:old.dataKey,p:JSON.stringify(old.p),inst:JSON.stringify(old.inst)};})};changedCache.set(r,c);return c;}
  function changed(r){if(!r)return false;var c=savedSide(r);if(c.disabled!==JSON.stringify(S.disabledPhases) || c.links!==JSON.stringify(S.parameterLinks) || r.options.weight!==S.settings.weight)return true;return c.datasets.some(function(old){var d=St.byId(old.id);return !d || d.dataKey!==old.dataKey || old.p!==JSON.stringify(d.p) || old.inst!==JSON.stringify(d.inst);}) || c.model!==JSON.stringify(S.phases.filter(function(p){return c.keys.has(p.key);}).map(phaseDoc));}
  function restore(id,onlyId){if(S.busy)throw new Error('Wait for the running calculation.');var r=find(id);if(!r)throw new Error('Calculation no longer retained.');if(onlyId && r.global)throw new Error('Restore a global fit as a complete set.');var chosen=onlyId?r.datasets.filter(function(d){return d.id===onlyId;}):r.datasets;if(!chosen.length)throw new Error('No saved dataset.');materialize(r);RV.history.take('Set calculation '+r.id);St.setCalculation(r.method);var doc=JSON.parse(St.projectJSON([], {noHistory:true})),savedKeys=new Set((models[r.model] || []).map(function(p){return p.key;}));doc.phases=doc.phases.filter(function(p){return !savedKeys.has(p.key);}).concat(clone(models[r.model]));doc.parameterLinks=clone(r.options.parameterLinks || []);doc.disabledPhases=r.options.disabledPhases || [];doc.settings=Object.assign(doc.settings,r.options.refinement,{weight:r.options.weight});doc.shared=clone(r.options.shared);doc.limits=clone(r.options.limits);doc.calculationOptions[r.method]=clone(r.options);var restoreSet=chosen.concat(r.dependencies || []),ids=new Set(restoreSet.map(function(d){return d.id;}));doc.datasets=doc.datasets.filter(function(d){return !ids.has(d.id);}).concat(restoreSet.map(function(d){var raw=observationFor(d);var live=St.byId(d.id);return Object.assign({},clone(d),{calculations:live?clone(live.calculations || {}):{},tth:Array.from(raw.tth),y:Array.from(raw.y),sig:raw.sig?Array.from(raw.sig):null,weights:raw.weights?Array.from(raw.weights):null,apart:Object.keys(d.apart || {})});}));doc.fitHistory=exportData(false);var pj=St.prepareProject(doc);St.commitProject(pj);St.selectIds(chosen.map(function(d){return d.id;}));St.store('fitmode',r.global?'global':'single');chosen.forEach(function(old){var d=St.byId(old.id);if(d)d.ints=clone(old.ints);});if(r.kind==='fit')active[r.method]={id:r.id,datasetId:onlyId || null};RV.bus.emit('fitmode');RV.bus.emit('stats');RV.bus.emit('params',{});RV.bus.emit('fitHistory');// after the events: a 'params' event marks the shown intensities stale
  if(r.kind!=='fit' && RV.solve && !RV.solve.adoptSolution(r.kind,clone(r.solution)))RV.ui.toast('The solution is shown, but its phase or dataset is no longer in the project, so its intensities were not restored.','warn');return r;}
  function exportData(metadataOnly){S.datasets.forEach(observation);gc();return {active:clone(active),serial:serial,records:clone(records),models:clone(models),observations:Object.keys(data).map(function(k){var d=data[k],o={key:k};if(!metadataOnly)['tth','y','sig','weights'].forEach(function(f){o[f]=d[f]?Array.from(d[f]):null;});return o;})};}
  function importData(doc){modelBytes={};changedCache=new WeakMap();resultPlots=new WeakMap();historySelected={};active=clone(doc && doc.active || {});records=clone(doc && doc.records || []);models=clone(doc && doc.models || {});data={};(doc && doc.observations || []).forEach(function(d){data[d.key]={key:d.key,tth:ArrayBuffer.isView(d.tth)?d.tth:Float64Array.from(d.tth || []),y:ArrayBuffer.isView(d.y)?d.y:Float64Array.from(d.y || []),sig:d.sig?(ArrayBuffer.isView(d.sig)?d.sig:Float64Array.from(d.sig)):null,weights:d.weights?(ArrayBuffer.isView(d.weights)?d.weights:Float64Array.from(d.weights)):null};});serial=Math.max(doc && doc.serial || 1,1+records.reduce(function(m,r){return Math.max(m,+String(r.id).slice(4) || 0);},0));S.datasets.forEach(observation);prune();
    if(doc && doc.dropped && doc.dropped.length && RV.ui)RV.ui.log('History: '+doc.dropped.length+' saved run(s) were left out because their observations are not in the project: '+doc.dropped.join(', ')+'.','warn');
    RV.bus.emit('fitHistory');}
  function undoSnapshot(){S.datasets.forEach(observation);return {active:clone(active),serial:serial,records:records.slice(),models:Object.assign({},models),observations:Object.values(data)};}
  // The history of a project being read. `available` lists the dataKeys whose observations the project itself carries.
  // A record whose observations are nowhere is dropped (it could never be Set) and named in `dropped`.
  function validate(doc,available){
    if(!doc)return null;
    var out=clone(Object.assign({},doc,{observations:[]}));out.observations=doc.observations;
    if(!Array.isArray(out.records) || !out.models || typeof out.models!=='object' || Array.isArray(out.models) || !Array.isArray(out.observations))throw new Error('Invalid calculation history.');
    var keys=new Set(available || []),seen=new Set(),top=0;out.dropped=[];
    out.observations.forEach(function(o){if(!o || typeof o.key!=='string')throw new Error('Invalid calculation history observations.');if(o.tth && o.y && o.tth.length && o.tth.length===o.y.length)keys.add(o.key);});
    out.records=out.records.filter(function(r){
      if(!r || typeof r!=='object')throw new Error('Invalid calculation checkpoint.');
      r.kind=r.kind || 'fit';
      if(!/^run-[0-9]+$/.test(r.id) || seen.has(r.id) || !RVCore.METHODS.includes(r.method) || ['fit','cf','wy'].indexOf(r.kind)<0 || !Array.isArray(out.models[r.model]) || !Array.isArray(r.datasets) || !r.datasets.length ||
         !r.options || !r.options.refinement || !['lm','pt'].includes(r.options.refinement.algorithm) || (r.kind!=='fit' && (!r.solution || typeof r.solution!=='object')))throw new Error('Invalid calculation checkpoint'+(r.id?' '+r.id:'')+'.');
      seen.add(r.id);top=Math.max(top,+r.id.slice(4));
      var ok=r.datasets.concat(r.dependencies || []).every(function(d){return d && typeof d.dataKey==='string' && keys.has(d.dataKey);});
      if(!ok)out.dropped.push(r.id);return ok;
    });
    out.serial=Math.max(Number.isSafeInteger(out.serial)?out.serial:1,top+1);
    var ids=new Set(out.records.map(function(r){return r.id;}));out.active=out.active && typeof out.active==='object'?out.active:{};
    Object.keys(out.active).forEach(function(m){if(!out.active[m] || !ids.has(out.active[m].id))delete out.active[m];});
    return out;
  }
  // ---------------------------------------------------------------- full description of one run (shown in History and saved as a report)
  function num(v){if(typeof v==='boolean')return v?'yes':'no';if(typeof v!=='number')return v==null || v===''?'—':String(v);if(!Number.isFinite(v))return v===Infinity?'inf':v===-Infinity?'-inf':'—';if(Number.isInteger(v))return String(v);var a=Math.abs(v);return a!==0 && (a>=1e5 || a<1e-3)?v.toExponential(4):String(+v.toPrecision(6));}
  function pctOf(v){return Number.isFinite(v)?(v*100).toFixed(2)+' %':'—';}
  function runTitle(r){return r.kind==='fit'?RVCore.METHOD_LABELS[r.method]:r.kind==='cf'?'Charge flipping':r.kind==='wy'?'Wyckoff search':String(r.kind);}
  function runStatus(r){if(r.stopped || (r.solution && r.solution.stopped))return 'Stopped';if(r.kind!=='fit')return r.solution && r.solution.error?'Failed':'Completed';return r.datasets.every(function(d){return d.stats && /^converged/.test(d.stats.msg);})?'Converged':'Completed';}
  function phaseNames(r){var names={};(models[r.model] || []).forEach(function(p){names[p.key]=p.name;});return names;}
  function paramLabel(n,names){return String(n).replace(/^(p\d+)\./,function(m,k){return (names[k] || k)+' · ';});}
  function scalars(o,skip){return Object.keys(o || {}).filter(function(k){var v=o[k];return (skip || []).indexOf(k)<0 && v!==null && typeof v!=='object' && typeof v!=='function';}).map(function(k){return [k,o[k]];});}
  function runSections(r){
    var names=phaseNames(r),o=r.options || {},ref=o.refinement || {},out=[];
    out.push({title:'Run',open:true,kv:[['Record',r.id],['Time',new Date(r.time).toLocaleString()],['Calculation',runTitle(r)+(r.kind!=='fit'?' (from '+RVCore.METHOD_LABELS[r.method]+' intensities)':'')],['Mode',r.global?'Global':'Individual'],['Status',runStatus(r)],['Kept',!!r.pinned],
      ['Datasets',r.datasets.map(function(d){return d.name;}).join(', ')],['Fixed parameter sources',(r.dependencies || []).map(function(d){return d.name;}).join(', ') || 'none'],['Max iterations',o.maxIter],['Min χ² change',o.tol],['Weighting',o.weight],['Fit mode setting',o.fitmode],
      ['Disabled phases',(o.disabledPhases || []).map(function(k){return names[k] || k;}).join(', ') || 'none'],['Parameter links',(o.parameterLinks || []).length],['Stored size',((r.bytes || 0)/1000).toFixed(1)+' kB']].concat(scalars(ref).map(function(kv){return ['Refinement: '+kv[0],kv[1]];}))});
    var g=r.global && r.datasets[0] && r.datasets[0].stats && r.datasets[0].stats.globalSummary;
    if(g)out.push({title:'Global fit summary',open:true,kv:[['Points',g.n],['Refined variables',g.nVar],['Free intensities',g.nInt],['Degrees of freedom',g.dof],['χ²',g.chi2],['Reduced χ²',g.chi2red],['GOF',g.GOF],['Rp',pctOf(g.Rp)],['Rwp',pctOf(g.Rwp)],['Rexp',pctOf(g.Rexp)],['Iterations',g.iter],['Algorithm',g.algorithm],['Result',g.msg]]});
    var phases=models[r.model] || [];
    if(phases.length)out.push({title:'Phases ('+phases.length+')',head:['Phase','Space group','Method','Profile','Atoms','Origin'],rows:phases.map(function(p){return [p.name,p.symbol+' ('+p.number+')',p.method,p.profileType || '—',(p.atoms || []).map(function(a){return a.label+(a.type && a.type!==a.label.replace(/\d+$/,'')?' ('+a.type+')':'');}).join(', ') || 'none',p.provenance?(p.provenance.label || p.provenance.kind)+(p.provenance.dataset?', '+p.provenance.dataset:''):'—'];})});
    if(r.solution)out=out.concat(solutionSections(r.kind,r.solution));
    var limits=o.limits || {},limitRows=Object.keys(limits).map(function(k){return [paramLabel(k,names),num(limits[k][0]),num(limits[k][1])];});
    if(limitRows.length)out.push({title:'Parameter limits ('+limitRows.length+')',head:['Parameter','Lower','Upper'],rows:limitRows});
    var shared=o.shared && typeof o.shared==='object'?Object.keys(o.shared).filter(function(k){return o.shared[k];}):[];
    if(shared.length)out.push({title:'Shared in global fits ('+shared.length+')',kv:[['Parameters',shared.map(function(k){return paramLabel(k,names);}).join(', ')]]});
    return out;
  }
  function datasetSections(r,d){
    var names=phaseNames(r),st=d.stats || {},out=[],refinedNames=((r.refined || []).find(function(x){return x.id===d.id;}) || {}).names || Object.keys(d.fit || {}).filter(function(n){return d.fit[n];});
    var refined=new Set(refinedNames),esd=d.esd || {};
    out.push({title:'Statistics',open:true,kv:[['Result',st.msg || (st.ok===false?'failed':'—')],['Calculation',st.calculation],['Points fitted',st.n],['Refined variables',st.nVar],['Free intensities',st.nInt],['Iterations',st.iter],['Rp',pctOf(st.Rp)],['Rwp',pctOf(st.Rwp)],['Rexp',pctOf(st.Rexp)],['(Rwp/Rexp)²',st.gof],['χ²',st.chi2],['Reduced χ²',st.chi2red],['Global reduced χ²',st.globalChi2red],
      ['Algorithm',st.effectiveAlgorithm || st.algorithm],['Max iterations',st.maxIter],['Min χ² change',st.tol],['Weighting',st.weight],['Covariance usable',st.covarianceOK],['Time',Number.isFinite(st.ms)?(st.ms/1000).toFixed(2)+' s':'—'],['Extracted intensities',d.ints && d.ints.length!=null?d.ints.length:d.ints && d.ints.det?d.ints.det.length:'—']]});
    if(st.phases && st.phases.length)out.push({title:'Phase agreement',open:true,head:['Phase','Method','R_Bragg','R_F','Reflections'],rows:st.phases.map(function(p){return [names[p.key] || p.key,p.method,p.method==='rietveld'?pctOf(p.RBragg):'—',p.method==='rietveld'?pctOf(p.RF):'—',p.nRefl];})});
    var warn=[].concat(st.fitWarnings || [],st.constraintWarnings || []).map(String);
    Object.keys(st.uncertaintyIssues || {}).forEach(function(k){var v=st.uncertaintyIssues[k];if(v)warn.push(paramLabel(k,names)+': '+(typeof v==='object'?JSON.stringify(v):v));});
    if(warn.length)out.push({title:'Warnings ('+warn.length+')',open:true,head:['Message'],rows:warn.map(function(w){return [w];})});
    var p=d.p || {},params=Object.keys(p).sort(function(a,b){return (refined.has(b)-refined.has(a));});
    out.push({title:'Parameters ('+refinedNames.length+' refined of '+params.length+')',open:true,head:['Parameter','Value','e.s.d.','Refined'],rows:params.map(function(n){return [paramLabel(n,names),num(p[n]),Number.isFinite(esd[n])?num(esd[n]):'—',refined.has(n)?'✓':''];})});
    var inst=d.inst || {},ikv=scalars(inst);
    if(Array.isArray(inst.bkgX))ikv.push(['Background anchors (2θ)',inst.bkgX.map(num).join(', ') || 'none']);
    if(Array.isArray(inst.excl))ikv.push(['Excluded regions (2θ)',inst.excl.map(function(x){return num(x[0])+'–'+num(x[1]);}).join(', ') || 'none']);
    out.push({title:'Instrument and background',kv:ikv});
    var an=st.anomalousData;
    if(an)out.push({title:'Anomalous scattering',kv:[['Enabled',an.enabled],['Source',an.source],['Wavelength (A)',an.wavelength],['Energy (eV)',an.energyEV],['Interpolation',an.interpolation || 'none']],head:['Element','f′ (electrons)','f″ (electrons)'],rows:Object.keys(an.map || {}).sort().map(function(el){return [el,an.map[el][0],an.map[el][1]];})});
    return out;
  }
  function solutionSections(kind,v){
    var out=[],I=v.I || {},sg=I.sg || {},o=v.o || {};
    if(v.error){out.push({title:'Solution',open:true,kv:[['Error',v.error]]});return out;}
    if(kind==='cf'){
      out.push({title:'Charge-flipping solution',open:true,kv:[['Phase',I.phaseName],['Dataset',I.dsName],['Space group',sg.symbol?sg.symbol+' ('+sg.number+')':'—'],['Intensities',v.n],['Input note',v.note],['Best R',v.best && v.best.bestR],['Random starts done',v.trialsDone+' of '+v.trials],['Best start',v.bestTrial],['Grid',v.grid+'³'+(v.auto?' (auto)':'')],
        ['Cycles',o.iterations],['Threshold δ/σ',o.threshold],['Weak fraction',o.weakFraction],['Symmetry λ',o.symLambda],['Adaptive',!!v.search],['Symmetry correlation',v.structure && v.structure.symmetryCorrelation],['Formula unit',v.formula || '—'],['Z',v.Z],['Stopped',!!v.stopped],['Time',v.seconds+' s'],['Note',v.err || '—']]});
      if(v.sites && v.sites.length)out.push({title:'Sites ('+v.sites.length+')',open:true,head:['#','Element','Wyckoff','x','y','z','Mult.','Height (rel.)','Used'],rows:v.sites.map(function(s){return [s.rank,s.element || '—',s.wyck || '—',num(s.x),num(s.y),num(s.z),s.mult,num(s.relative),s.use?'✓':''];})});
      if(v.search && v.search.trials)out.push({title:'Random starts ('+v.search.trials.length+')',head:['Start','Seed','δ/σ','Weak fraction','Symmetry λ','CF R','Map correlation'],rows:v.search.trials.map(function(t){return [t.start,t.seed,t.threshold,t.weakFraction,t.symLambda,t.error || num(t.bestR),t.mapCorrelation==null?'not compared':num(t.mapCorrelation)];})});
    } else if(kind==='wy'){
      var sols=v.sols || [];
      out.push({title:'Wyckoff search',open:true,kv:[['Phase',I.phaseName],['Dataset',I.dsName],['Space group',sg.symbol?sg.symbol+' ('+sg.number+')':'—'],['Formula unit',v.formula],['Intensities',v.n],['Input note',v.note],['Particles',o.particles],['Iterations',o.iterations],['Restarts',o.restarts],['Density window',o.rhoMin!=null?o.rhoMin+'–'+o.rhoMax+' g/cm³':'—'],
        ['Distance constraints',(v.vc && v.vc.windows || []).length],['Chosen solution',sols.length?'Z = '+(sols[v.pick] || sols[0]).z:'—'],['Stopped',!!v.stopped],['Kept after',v.salvaged || '—'],['Time',v.seconds+' s']]});
      if(sols.length)out.push({title:'Solutions ('+sols.length+')',open:true,head:['Z','ρ (g/cm³)','wR(F²)','Search wR2','Assignment','Ranked'],rows:sols.map(function(s){return [s.z,num(s.rho),s.refinement && Number.isFinite(s.refinement.R)?pctOf(s.refinement.R):'not refined'+(s.refinement && s.refinement.skipped?' ('+s.refinement.skipped+')':''),Number.isFinite(s.searchCC)?pctOf(1-s.searchCC):'—',s.assignment || '—',s.ranked===false?'no':'yes'];})});
      sols.forEach(function(s){out.push({title:'Sites for Z = '+s.z+' ('+(s.sites || []).length+')',open:sols.length===1,head:['#','Element','Wyckoff','x','y','z','Mult.','Shortest contact (Å)'],rows:(s.sites || []).map(function(a,i){return [i+1,a.element,a.wyckoff || '—',num(a.x),num(a.y),num(a.z),a.multiplicity,num(a.shortestContact)];})});});
      if(v.log && v.log.length)out.push({title:'Search log ('+v.log.length+' lines)',pre:v.log.join('\n')});
    }
    return out;
  }
  function sectionHTML(s){
    var esc=RV.ui.esc,body;
    if(s.kv)body='<dl class="sv-dl">'+s.kv.map(function(kv){return '<dt>'+esc(kv[0])+'</dt><dd>'+esc(num(kv[1]))+'</dd>';}).join('')+'</dl>';
    else if(s.pre!=null)body='<pre class="history-log">'+esc(s.pre)+'</pre>';
    else body='<div class="table-wrap"><table class="grid compact"><thead><tr>'+s.head.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+s.rows.map(function(row){return '<tr>'+row.map(function(c){return '<td>'+esc(num(c))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';
    return '<details class="object-group"'+(s.open?' open':'')+'><summary>'+esc(s.title)+'</summary>'+body+'</details>';
  }
  // Dataset blocks are filled when opened: a batch can hold hundreds of datasets.
  function detailHTML(r){
    var esc=RV.ui.esc,one=r.datasets.length===1;
    return '<section class="history-detail"><h3>All information for this run</h3>'+runSections(r).map(sectionHTML).join('')+
      r.datasets.map(function(d,i){return '<details class="object-group history-dataset" data-history-detail="'+r.id+'" data-history-index="'+i+'"'+(one?' open':'')+'><summary>Dataset '+esc(d.name)+'</summary>'+(one?datasetSections(r,d).map(sectionHTML).join(''):'')+'</details>';}).join('')+'</section>';
  }
  function fillDataset(el){if(el.dataset.filled)return;var r=find(el.dataset.historyDetail),d=r && r.datasets[+el.dataset.historyIndex];if(!d)return;el.dataset.filled='1';if(el.children.length>1)return;el.insertAdjacentHTML('beforeend',datasetSections(r,d).map(sectionHTML).join(''));}
  function sectionText(s){var L=['','## '+s.title];if(s.kv)s.kv.forEach(function(kv){L.push(kv[0]+'\t'+num(kv[1]));});else if(s.pre!=null)L.push(s.pre);else{L.push(s.head.join('\t'));s.rows.forEach(function(row){L.push(row.map(num).join('\t'));});}return L;}
  function runReport(r){
    var L=['# Powder 6 · '+runTitle(r)+' · '+r.id+' · '+new Date(r.time).toLocaleString()];
    runSections(r).forEach(function(s){L=L.concat(sectionText(s));});
    r.datasets.forEach(function(d){L.push('','# Dataset '+d.name);datasetSections(r,d).forEach(function(s){L=L.concat(sectionText(s));});});
    return L.join('\n')+'\n';
  }
  async function saveReport(id){
    var list=id?[find(id)].filter(Boolean):records.slice();
    if(!list.length){RV.ui.toast(id?'This run is no longer in History.':'No calculation in History to report.','info');return;}
    try{
      var text=list.map(runReport).join('\n\n'+'='.repeat(78)+'\n\n');
      var saved=await RV.ui.saveTextFile('powder6_history_'+(id || 'all')+'_'+RV.ui.fileStamp()+'.txt',text,'text/plain;charset=utf-8',{title:'Save History report',description:'Text report',pickerId:'powder6-history'});
      if(saved)RV.ui.toast('Saved the report of '+(list.length===1?'run '+list[0].id:list.length+' runs')+' as '+saved.name+'.','ok');
    }catch(x){RV.ui.toast('The History report could not be written: '+(x && x.message || x),'err');}
  }
  // The whole history with its results and observations, as JSON for reading elsewhere. Powder 6 reads
  // History back only as part of a project.
  async function saveHistory(){
    if(!records.length){RV.ui.toast('History is empty.','info');return;}
    try{
      var count=records.length,doc={format:'powder6-history',version:1,program:RV.version || '',saved:new Date().toISOString(),history:exportData(false),reports:records.map(function(r){return {id:r.id,text:runReport(r)};})};
      var saved=await RV.ui.saveTextFile('powder6_history_'+RV.ui.fileStamp()+'.json',JSON.stringify(doc),'application/json',{title:'Save History',description:'Powder 6 History JSON',pickerId:'powder6-history'});
      if(saved)RV.ui.toast('Saved '+count+' History record(s) with their results and observations as '+saved.name+'.','ok');
    }catch(x){RV.ui.toast('History could not be saved'+(x instanceof RangeError?': it is too large for one file. Delete or unkeep old runs, or save the project instead.':': '+(x && x.message || x)),'err');}
  }
  async function remove(id){
    var r=find(id);if(!r)return;
    if(isActive(r)){RV.ui.toast('Set another result before deleting the current calculation.','info');return;}
    var label=runTitle(r)+' · '+new Date(r.time).toLocaleString()+' · '+r.id;
    if(!(await RV.ui.confirm((r.pinned?'This run is kept (★). ':'')+'Delete '+label+' from History? Ctrl+Z undoes this.','Delete',true,'Delete run')))return;
    if(S.busy || !find(id) || isActive(find(id)))return;
    RV.history.take('delete '+label+' from History');
    records=records.filter(function(x){return x.id!==id;});gc();RV.bus.emit('fitHistory');
  }
  function render(){var host=document.getElementById('fit-history-list');if(!host)return;host.setAttribute('aria-labelledby','history-tab-'+method);var u=usage(),esc=RV.ui.esc;document.getElementById('fit-history-size').textContent=u.count+' records · '+(u.history/1000000).toFixed(2)+' MB · '+u.pinned+' kept · automatic budget '+S.settings.historyMB+' MB';document.querySelectorAll('[data-history-method]').forEach(function(b){var on=b.dataset.historyMethod===method;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;b.id='history-tab-'+b.dataset.historyMethod;b.setAttribute('aria-controls','fit-history-list');});host.innerHTML=historyPicker()+(historyDisplay().map(function(r){var stats=r.datasets[0].stats,overall=r.global && stats && stats.globalSummary,metric=overall || (r.datasets.length===1?stats:null),pct=function(v){return Number.isFinite(v)?(v*100).toFixed(2)+'%':'—';};return '<details class="history-run'+(r.pinned?' kept':'')+'" open><summary>'+(r.pinned?'<span class="kept-badge">★ Kept</span>':'')+'<time>'+esc(new Date(r.time).toLocaleString())+'</time><b>'+esc(r.kind==='fit'?RVCore.METHOD_LABELS[r.method]:r.kind==='cf'?'Charge flipping':'Wyckoff')+'</b><span>'+r.datasets.length+' dataset(s) · '+(r.global?'Global':'Individual')+'</span><span>'+(metric?'Rp '+pct(metric.Rp)+' · Rwp '+pct(metric.Rwp):'Per-dataset results')+'</span><span>'+(r.stopped?'Stopped':r.datasets.every(function(d){return d.stats && /^converged/.test(d.stats.msg);})?'Converged':'Completed')+'</span></summary><div class="buttons"><button title="Restore this run into the working setup without fitting" data-history-set="'+r.id+'">Set</button><button title="'+(r.pinned?'Allow automatic removal of this run':'Protect this run from automatic removal without changing the working setup')+'" aria-pressed="'+r.pinned+'" data-history-pin="'+r.id+'">'+(r.pinned?'Unkeep':'Keep')+'</button><button data-history-delete="'+r.id+'">Delete</button><button title="Save everything listed for this run as a text report" data-history-report="'+r.id+'">Save run report</button></div><p class="hint">'+esc(r.options.refinement.algorithm.toUpperCase())+' · '+(r.bytes/1000).toFixed(1)+' kB · '+esc((r.refined || []).map(function(d){return d.names.join(', ');}).filter(function(s,i,a){return a.indexOf(s)===i;}).join('; '))+'</p>'+((r.dependencies || []).length?'<p class="hint">Set also restores fixed parameter sources: '+esc(r.dependencies.map(function(d){return d.name;}).join(', '))+'.</p>':'')+'<div class="table-wrap"><table class="grid compact"><thead><tr><th>Dataset</th><th>Rp</th><th>Rwp</th><th>Result</th><th></th></tr></thead><tbody>'+r.datasets.map(function(d){return '<tr><td>'+esc(d.name)+'</td><td>'+pct(d.stats && d.stats.Rp)+'</td><td>'+pct(d.stats && d.stats.Rwp)+'</td><td>'+esc(d.stats && d.stats.msg || r.kind)+'</td><td>'+(!r.global && r.datasets.length>1?'<button title="Restore this run into the working setup without fitting" data-history-set="'+r.id+'" data-history-dataset="'+d.id+'">Set dataset</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>'+detailHTML(r)+'</details>';}).join('') || '<p class="hint">Completed calculations will appear here. Set restores their model, parameters and results; Keep protects a record from automatic pruning.</p>');}
  function inspect(id){var r=find(id);if(r){method=r.method;historySelected[method]=id;}render();}
  function init(){
    var host=document.getElementById('pane-history');
    var list=document.getElementById('fit-history-list');list.setAttribute('role','tabpanel');
    host.querySelector('[aria-label="History method"]').addEventListener('keydown',function(e){
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      var tabs=Array.from(this.querySelectorAll('[data-history-method]')),i=tabs.indexOf(document.activeElement);if(i<0)return;
      e.preventDefault();var j=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[j].focus();method=tabs[j].dataset.historyMethod;render();
    });
    host.addEventListener('change',function(e){if(e.target.hasAttribute('data-history-run'))inspect(e.target.value);});
    host.addEventListener('toggle',function(e){if(e.target.open && e.target.hasAttribute && e.target.hasAttribute('data-history-detail'))fillDataset(e.target);},true);
    host.addEventListener('click',function(e){
      var b=e.target.closest('button');if(!b)return;
      if(b.dataset.historyMethod){method=b.dataset.historyMethod;render();return;}
      if(b.dataset.historyReport){saveReport(b.dataset.historyReport==='all'?null:b.dataset.historyReport);return;}
      if(b.hasAttribute('data-history-save')){saveHistory();return;}
      if(S.busy)return;
      try{
        if(b.dataset.historySet){
          var restored=restore(b.dataset.historySet,+b.dataset.historyDataset || null);RV.app.calculation(S.calculation,true);
          if(RV.layout && restored.kind!=='fit')RV.layout.structureResult(restored.kind,restored.id);
          else if(RV.layout){RV.layout.showResult(S.calculation);RV.layout.selectRun(restored.id);}
          else RV.app.showTab('solve');
        }else if(b.dataset.historyPin){var r=find(b.dataset.historyPin);keep(r.id,!r.pinned);}
        else if(b.dataset.historyDelete)remove(b.dataset.historyDelete);
      }catch(x){RV.ui.toast(x.message,'warn');}
    });
    RV.bus.on('fitHistory',render);RV.bus.on('tab',function(t){if(t==='history')render();});RV.bus.on('settings',function(k){if(k==='historyMB'||k==='historyCount'){prune();render();}});
  }
  return {begin:begin,complete:complete,solution:solution,latest:latest,find:find,list:list,keep:keep,inspect:inspect,restore:restore,withResult:withResult,viewing:function(){return busyView;},changed:changed,usage:usage,prune:prune,exportData:exportData,undoSnapshot:undoSnapshot,importData:importData,validate:validate,observations:function(){S.datasets.forEach(observation);return data;},init:init,render:render,phaseDoc:phaseDoc,runReport:runReport,saveReport:saveReport,saveHistory:saveHistory,remove:remove};
})();
