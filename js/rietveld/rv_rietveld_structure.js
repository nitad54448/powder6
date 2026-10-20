/* Current Rietveld model, using the same structure/contact viewer as WPPF. */
RV.rietveldStructure=(function(){
  'use strict';
  var St=RV.state,ui=RV.ui,choice={dataset:null,phase:null},cached={key:'',st:null},currentView=null;
  function dispose(){if(currentView && typeof WyckoffReport!=='undefined' && WyckoffReport.dispose)WyckoffReport.dispose(currentView);currentView=null;}
  function structure(ph,ds){
    var def=St.phaseDefs().find(function(p){return p.key===ph.key;}),v=AtomicConstraints.values([def],[ds.p],[{phases:[ph.key]}])[0],cell=St.cellOf(ph,v);
    return {cell:cell,spaceGroup:{number:ph.sg.number,symbol:ph.sg.symbol,hall:ph.sg.hall},opMatrices:ph.ops,source:'rietveld',label:ph.name+' in '+ds.name,
      sites:ph.atoms.map(function(at,i){var pre=ph.key+'.'+at.label+'.',pos=RVCore.sitePosition(at.site,[v[pre+'x'],v[pre+'y'],v[pre+'z']]);return {rank:i+1,label:at.label,element:St.elementOf(at.type),x:pos[0],y:pos[1],z:pos[2],occupancy:v[pre+'occ'],B:v[pre+'B'],wyckoff:at.site.wyck,multiplicity:at.site.mult};})};
  }
  function render(host,list){
    dispose();if(!host)return;
    var available=list.filter(function(d){return St.phasesIn(d).some(function(p){return p.atoms.length;});});
    if(!available.length){host.innerHTML='<p class="hint">Assign a phase with atoms to a selected dataset to view its Rietveld structure.</p>';return;}
    if(RV.state.S.busy){host.innerHTML='<p class="hint">The structure will update when the calculation finishes.</p>';return;}
    var ds=available.find(function(d){return d.id===choice.dataset;}) || available.find(function(d){return d===St.first();}) || available[0];
    var phases=St.phasesIn(ds).filter(function(p){return p.atoms.length;}),ph=phases.find(function(p){return p.key===choice.phase;}) || phases.find(function(p){return p===St.currentPhase();}) || phases[0];
    choice={dataset:ds.id,phase:ph.key};
    host.innerHTML='<div class="buttons"><label>Dataset <select data-rs="dataset">'+available.map(function(d){return '<option value="'+d.id+'"'+(d===ds?' selected':'')+'>'+ui.esc(d.name)+'</option>';}).join('')+'</select></label><label>Phase <select data-rs="phase">'+phases.map(function(p){return '<option value="'+p.key+'"'+(p===ph?' selected':'')+'>'+ui.esc(p.name)+'</option>';}).join('')+'</select></label><button type="button" data-rs-cif>Save CIF…</button></div><p class="hint">'+(ds.stats && ds.stats.ok!==false?'Current fitted Rietveld values.':'Current Rietveld starting values; no valid fit yet.')+' Structure, contacts and coordination use the actual symmetry operators, occupancies and dataset cell. Coordination and bond valence are occupancy-weighted average-model diagnostics; local mixed-site correlations are not determined.</p><div class="sv-struct" data-rs-view></div>';
    host.querySelectorAll('[data-rs]').forEach(function(s){s.addEventListener('change',function(){if(s.dataset.rs==='dataset'){choice.dataset=+s.value;choice.phase=null;}else choice.phase=s.value;render(host,list);});});
    host.querySelector('[data-rs-cif]').addEventListener('click',function(){ui.download(ph.name.replace(/[^\w-]+/g,'_')+'_'+ui.fileStamp()+'.cif',RV.results.cifText([ds],false,ph.key),'chemical/x-cif');});
    var view=host.querySelector('[data-rs-view]');currentView=view;
    document.querySelectorAll('.sv-struct-host').forEach(function(previous){if(typeof WyckoffReport!=='undefined' && WyckoffReport.dispose)WyckoffReport.dispose(previous);previous.innerHTML='';});
    try{var st=structure(ph,ds),key=JSON.stringify(st);if(cached.key!==key)cached={key:key,st:st};if(typeof WyckoffReport!=='undefined')WyckoffReport.render(view,cached.st);else view.textContent='The structure viewer is not loaded.';}catch(e){view.textContent='Structure unavailable: '+e.message;}
  }
  return {render:render,structure:structure,dispose:dispose};
})();
