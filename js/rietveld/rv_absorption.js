/* Elemental mass-attenuation tables and read-only Bragg–Brentano estimates.
 * Bare-table energies default to eV; per-element/document energyUnit wins.
 * Mass coefficients must be cm²/g. No extrapolation or invented coefficients.
 * The table rules - units, element keys, ordering, the edge refusal - live in js/absorption_table.js, which
 * holds no state and is covered by tests/absorption.test.cjs; this module keeps the loaded table, the
 * composition and the Bragg–Brentano estimate.
 */
RV.absorption = (function () {
  'use strict';
  var St=RV.state, S=St.S, ui=RV.ui, table=null, label='', error='', loading=false, revision=0, builtin=false;
  var HC_EV_ANGSTROM=12398.419843320025, AMU_DENSITY=1.66053906660;
  // The table rules -- units, element keys, ordering, the refusal to interpolate across an edge -- live in
  // js/absorption_table.js, which holds no state and is covered by tests/absorption.test.cjs.
  var AT = typeof AbsorptionTable !== 'undefined' ? AbsorptionTable : null;
  function api() { if (!AT) throw new Error('The absorption table module (js/absorption_table.js) is not loaded.'); return AT; }
  function normalize(doc, defaultUnit) { return api().normalize(doc, defaultUnit); }
  function coefficient(el, E) { return api().coefficient(table, el, E); }
  // isBuiltin: the absorption.json beside index.html, which every session reads itself and a project does not carry
  function loadDocument(doc,name,defaultUnit,isBuiltin) {
    var next=normalize(doc,defaultUnit); // validate completely before replacing a usable table
    table=next;label=String(name || 'absorption.json');error='';loading=false;revision++;builtin=!!isBuiltin;
    RV.bus.emit('absorption');return Object.keys(table).length;
  }
  // a table the user loaded, as a document loadDocument reads back (energies in eV), for the project; null otherwise
  function exportUser() {
    if(!table || builtin)return null;
    var elements={};Object.keys(table).forEach(function(el){elements[el]={mu:table[el].rows.map(function(r){return [r[0],r[1]];}),unit:'cm2/g',source:table[el].source};});
    return {label:label,energyUnit:'eV',elements:elements};
  }
  function restoreUser(doc) {
    if(!doc)return;
    try{loadDocument(doc,doc.label || 'project absorption table','eV');}catch(e){ui.toast('The absorption table saved with the project could not be read: '+e.message,'warn');}
  }
  function phaseComposition(ph,ds) {
    var counts={},pre=ph.key+'.';
    if(ph.atoms.length){
      for(var i=0;i<ph.atoms.length;i++){
        var at=ph.atoms[i],occ=ds.p[pre+at.label+'.occ'];
        if(!Number.isFinite(occ) || occ<0)return {error:ph.name+': invalid site occupancy.'};
        if(!occ)continue;
        var mult=at.site && at.site.mult;
        if(!(mult>0))return {error:ph.name+': site '+at.label+' has no multiplicity.'};
        // Absorption tables are elemental: strip ionic charge; use the label only if the scatterer is absent.
        var el=St.elementOf(at.type) || (!String(at.type || '').trim() ? St.elementOf(at.label) : '');if(!el)return {error:ph.name+': unknown element '+at.type+'.'};
        counts[el]=(counts[el] || 0)+occ*mult;
      }
    }else{
      var solve=RV.solve, opts=solve && solve.state && solve.state.opts;
      var comp=opts && solve.state.phaseKey===ph.key && solve.parseFormula(opts.formula), Z=opts && Number(opts.z);
      if(!comp || !(Z>0) || !Number.isInteger(Z))return {error:ph.name+': define atoms, or give its formula and explicit integer Z in WPPF, to obtain composition and crystallographic density.'};
      comp.forEach(function(c){counts[c.el]=(counts[c.el] || 0)+c.n*Z;});
    }
    var masses={},mass=0;
    for(var sym in counts){var w=St.atomicWeight(sym);if(!(w>0))return {error:'No atomic mass for '+sym+'.'};masses[sym]=counts[sym]*w;mass+=masses[sym];}
    var cell=St.cellOf(ph,ds.p), V=cell && cellVolume(cell);
    if(!(mass>0 && V>0))return {error:ph.name+': cell content or cell volume is unavailable.'};
    return {mass:mass,masses:masses,density:mass*AMU_DENSITY/V};
  }
  function sample(ds) {
    var phases=St.phasesIn(ds);if(!phases.length)return {error:'No phase assigned to this dataset.'};
    var parts=phases.map(function(ph){return phaseComposition(ph,ds);});
    for(var i=0;i<parts.length;i++)if(parts[i].error)return parts[i];
    for(i=0;i<parts.length;i++)if(!(parts[i].density>0))return {error:phases[i].name+': crystallographic density is unavailable.'};
    var weights=phases.length===1 ? [1] : null;
    if(!weights){
      if(S.calculation!=='rietveld' || !RV.results)return {error:'A multiphase prediction needs Rietveld mass fractions; Le Bail/WPPF free intensities do not determine composition weights.'};
      // By PHASE KEY, not by position: a change in the order or length of RV.results.weights() must not
      // silently attach one phase's mass fraction to another.
      var byKey={};RV.results.weights(ds).forEach(function(p){if(p && p.ph)byKey[p.ph.key]=p.w;});
      weights=phases.map(function(ph){return byKey[ph.key];});
      if(!weights.every(function(w){return Number.isFinite(w) && w>=0;}) || !(weights.reduce(function(a,b){return a+b;},0)>0))return {error:'Usable Rietveld phase mass fractions are required.'};
    }
    var fractions={},v=0;
    parts.forEach(function(p,i){var w=weights[i];v+=w/p.density;Object.keys(p.masses).forEach(function(el){fractions[el]=(fractions[el] || 0)+w*p.masses[el]/p.mass;});});
    if(!(v>0) || !Number.isFinite(v))return {error:'The mixture has no usable density.'};
    return {fractions:fractions,density:1/v,density90:0.9/v,multiphase:phases.length>1};
  }
  function predict(ds,lambda) {
    if(!ds || ds.inst.radiation!=='xray')return {error:'Elemental X-ray tables do not predict neutron attenuation.'};
    if(!table)return {error:loading?'Absorption table is loading.':error || 'The absorption.json table is unavailable. Place it beside index.html and reload.'};
    if(!(lambda>0))return {error:'A positive X-ray wavelength is required.'};
    var model=sample(ds);if(model.error)return model;
    var E=HC_EV_ANGSTROM/lambda,massMu=0;
    for(var el in model.fractions){if(!model.fractions[el])continue;var item=coefficient(el,E);if(item.error)return item;massMu+=model.fractions[el]*item.value;}
    if(!(massMu>0))return {error:'The mixture mass attenuation is zero; no finite transparency estimate.'};
    var mu90=massMu*model.density90/10, R=ds.inst.radiusMM;
    if(!Number.isFinite(mu90) || !(mu90>0))return {error:'The mixture attenuation gives no finite mu for this table.'};
    // a penetrating beam moves the peaks to LOWER angle: dtwotheta = -sin(2theta) / (2 mu R), so t = -1 / (2 mu R)
    return {energyEV:E,massMu:massMu,density:model.density,density90:model.density90,mu90:mu90,transparency90:R>0?-1/(2*R*mu90):null,multiphase:model.multiphase,label:label};
  }
  function tip(ds) {
    var R=ds.inst.radiusMM,t=ds.p.transp, f=ui.fmt;
    var lines=['Transparency coefficient t: Δ2θ = t sin(2θ), in radians; a physical value is negative (the peaks move to lower angle).'];
    lines.push(R>0 && t<0 ? 'From current t: µeff = '+f(-1/(2*R*t),6)+' mm⁻¹; absorption length '+f(-2*R*t,6)+' mm (R = '+R+' mm).' : 'Fitted µeff requires negative t and a known goniometer radius (Datasets → Instrument).');
    var p=predict(ds,ds.inst.lambda1);
    if(p.error)lines.push(p.error);
    else{
      lines.push('At λ1 = '+f(ds.inst.lambda1,7)+' Å ('+f(p.energyEV/1000,6)+' keV): µ/ρ = '+f(p.massMu,6)+' cm²/g; crystallographic density = '+f(p.density,6)+' g/cm³.');
      lines.push('Assuming 90% relative density: ρ90 = '+f(p.density90,6)+' g/cm³; µ90 = '+f(p.mu90,6)+' mm⁻¹; expected t90 = '+(p.transparency90==null?'unavailable until radius is set':f(p.transparency90,7))+'.');
      if(ds.inst.ratio>0 && ds.inst.lambda2>0){var q=predict(ds,ds.inst.lambda2);lines.push(q.error?'λ2: '+q.error:'At λ2: µ90 = '+f(q.mu90,6)+' mm⁻¹; expected t90 = '+(q.transparency90==null?'radius required':f(q.transparency90,7))+'.');}
      lines.push('Table: '+p.label+'. Log-energy/log-coefficient interpolation; no extrapolation. '+(p.multiphase?'Mixture uses current Rietveld mass fractions and additive solid volumes.':'Composition uses neutral element names (for example Fe3+ → Fe); ionic charge does not change the table lookup.'));
    }
    lines.push('Estimates assume a thick, flat Bragg–Brentano specimen. This diagnostic does not set or refine t automatically.');
    return lines.join('\n');
  }
  function status(){return {loaded:!!table,elements:table?Object.keys(table).length:0,label:label,error:error,loading:loading};}
  async function loadFile() {
    if(S.busy)return;
    var files=await ui.pickFiles({accept:'.json,application/json'});if(!files.length)return;
    try{
      var raw=JSON.parse(new TextDecoder().decode(await ui.readBuffer(files[0])));
      var opts=await ui.prompt('Absorption table',[{key:'unit',label:'Energy unit for entries without energyUnit',type:'select',value:raw.energyUnit || 'eV',options:[['eV','eV'],['keV','keV'],['MeV','MeV']]}],'Load','Mass coefficients must be cm²/g. The expected transparency assumes 90% of the crystallographic solid density. Loaded coefficients remain in this session and are saved with the project; place absorption.json beside index.html for automatic loading.');
      if(!opts || S.busy)return;
      var n=loadDocument(raw,files[0].name,opts.unit);ui.toast('Loaded '+n+' elemental absorption tables from '+files[0].name+'.','ok');
    }catch(e){ui.toast('Absorption table: '+e.message,'err');}
  }
  async function init() {
    if(typeof fetch!=='function')return;
    var token=revision;loading=true;
    try{var r=await fetch('absorption.json');if(!r.ok)throw new Error('absorption.json is unavailable. Place it beside index.html and reload.');var doc=await r.json();if(token===revision)loadDocument(doc,'absorption.json','eV',true);}
    catch(e){if(token===revision){loading=false;error=e.message;RV.bus.emit('absorption');}}
  }
  return {init:init,loadFile:loadFile,loadDocument:loadDocument,exportUser:exportUser,restoreUser:restoreUser,normalize:normalize,coefficient:coefficient,sample:sample,predict:predict,tip:tip,status:status};
})();
