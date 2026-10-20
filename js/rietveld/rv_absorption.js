/* Elemental mass attenuation tables and read-only Bragg–Brentano estimates.
 * Bare-table energies default to eV; per-element/document energyUnit wins.
 * Mass coefficients must be cm²/g. No extrapolation or invented coefficients.
 */
RV.absorption = (function () {
  'use strict';
  var St=RV.state, S=St.S, ui=RV.ui, table=null, label='', error='', loading=false, revision=0;
  var HC_EV_ANGSTROM=12398.419843320025, AMU_DENSITY=1.66053906660;
  function unitFactor(unit) {
    var u=String(unit || 'eV').toLowerCase().replace(/\s/g,'');
    if(u==='ev')return 1;if(u==='kev')return 1000;if(u==='mev')return 1e6;
    throw new Error('Energy unit must be eV, keV or MeV.');
  }
  function normalize(doc, defaultUnit) {
    if(!doc || typeof doc!=='object' || Array.isArray(doc))throw new Error('Expected an elemental absorption JSON object.');
    var source=doc.elements || doc, out={}, factor=unitFactor(doc.energyUnit || defaultUnit || 'eV');
    Object.keys(source).forEach(function(el){
      if(!/^[A-Z][a-z]?$/.test(el))return;
      var item=source[el];
      if(!item || typeof item!=='object' || !Array.isArray(item.mu) || item.mu.length<2)throw new Error(el+': expected at least two [energy, mass coefficient] pairs.');
      if(item.symbol && item.symbol!==el)throw new Error(el+': symbol does not match its key.');
      var unit=String(item.unit || doc.unit || '').replace(/\s/g,'').replace(/²/g,'2').replace(/\^/g,'');
      if(unit!=='cm2/g')throw new Error(el+': coefficients must have unit cm²/g.');
      var f=item.energyUnit ? unitFactor(item.energyUnit) : factor, last=0;
      var rows=item.mu.map(function(pair,i){
        if(!Array.isArray(pair) || pair.length!==2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || !(pair[0]>0) || pair[1]<0)throw new Error(el+': invalid coefficient pair '+(i+1)+'.');
        var E=pair[0]*f;if(!Number.isFinite(E))throw new Error(el+': energy is out of range.');if(E<last)throw new Error(el+': energies must be ordered, with equal-energy pairs allowed at absorption edges.');last=E;
        return [E,pair[1]];
      });
      out[el]={rows:rows,source:String(item.source || doc.source || 'user table')};
    });
    if(!Object.keys(out).length)throw new Error('No elemental absorption tables found.');
    return out;
  }
  function loadDocument(doc,name,defaultUnit) {
    var next=normalize(doc,defaultUnit); // validate completely before replacing a usable table
    table=next;label=String(name || 'absorption.json');error='';loading=false;revision++;
    RV.bus.emit('absorption');return Object.keys(table).length;
  }
  function coefficient(el,E) {
    if(!table || !table[el])return {error:'No mass attenuation table for '+el+'.'};
    var rows=table[el].rows,n=rows.length;
    if(!(E>=rows[0][0] && E<=rows[n-1][0]))return {error:el+': photon energy is outside the table range; no extrapolation.'};
    // Upper bound chooses the post-edge value when an exact energy is duplicated.
    var lo=0,hi=n;while(lo<hi){var mid=(lo+hi)>>1;if(rows[mid][0]<=E)lo=mid+1;else hi=mid;}
    var a=rows[Math.max(0,lo-1)];if(a[0]===E || lo===n)return {value:a[1]};
    var b=rows[lo];
    if(b[1]>a[1]*1.25 && b[0]/a[0]<1.2)return {error:el+': energy brackets a sharp absorption edge; add resolved edge values instead of interpolating across it.'};
    var t=Math.log(E/a[0])/Math.log(b[0]/a[0]);
    return {value:a[1]>0 && b[1]>0 ? Math.exp(Math.log(a[1])+t*Math.log(b[1]/a[1])) : a[1]+t*(b[1]-a[1])};
  }
  function phaseComposition(ph,ds) {
    var counts={},pre=ph.key+'.';
    if(ph.atoms.length){
      for(var i=0;i<ph.atoms.length;i++){
        var at=ph.atoms[i],occ=ds.p[pre+at.label+'.occ'];
        if(!Number.isFinite(occ) || occ<0)return {error:ph.name+': invalid site occupancy.'};
        if(!occ)continue;
        // Absorption tables are elemental: strip ionic charge; use the label only if the scatterer is absent.
        var el=St.elementOf(at.type) || (!String(at.type || '').trim() ? St.elementOf(at.label) : '');if(!el)return {error:ph.name+': unknown element '+at.type+'.'};
        counts[el]=(counts[el] || 0)+occ*at.site.mult;
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
    var weights=phases.length===1 ? [1] : null;
    if(!weights){
      if(S.calculation!=='rietveld' || !RV.results)return {error:'A multiphase prediction needs Rietveld mass fractions; Le Bail/WPPF free intensities do not determine composition weights.'};
      var all=RV.results.weights(ds);weights=phases.map(function(ph){return all[S.phases.indexOf(ph)].w;});
      if(!weights.every(function(w){return Number.isFinite(w) && w>=0;}) || !(weights.reduce(function(a,b){return a+b;},0)>0))return {error:'Usable Rietveld phase mass fractions are required.'};
    }
    var fractions={},v=0;
    parts.forEach(function(p,i){var w=weights[i];v+=w/p.density;Object.keys(p.masses).forEach(function(el){fractions[el]=(fractions[el] || 0)+w*p.masses[el]/p.mass;});});
    return {fractions:fractions,density:1/v,density90:0.9/v,multiphase:phases.length>1};
  }
  function predict(ds,lambda) {
    if(!ds || ds.inst.radiation!=='xray')return {error:'Elemental X-ray tables do not predict neutron attenuation.'};
    if(!table)return {error:loading?'Absorption table is loading.':'Load absorption.json using Datasets → Absorption (energies default to eV, coefficients cm²/g).'};
    var model=sample(ds);if(model.error)return model;
    if(!(lambda>0))return {error:'A positive X-ray wavelength is required.'};
    var E=HC_EV_ANGSTROM/lambda,massMu=0;
    for(var el in model.fractions){if(!model.fractions[el])continue;var item=coefficient(el,E);if(item.error)return item;massMu+=model.fractions[el]*item.value;}
    if(!(massMu>0))return {error:'The mixture mass attenuation is zero; no finite transparency estimate.'};
    var mu90=massMu*model.density90/10, R=ds.inst.radiusMM;
    return {energyEV:E,massMu:massMu,density:model.density,density90:model.density90,mu90:mu90,transparency90:R>0?1/(2*R*mu90):null,multiphase:model.multiphase,label:label};
  }
  function tip(ds) {
    var R=ds.inst.radiusMM,t=ds.p.transp, f=ui.fmt;
    var lines=['Transparency coefficient t: Δ2θ = t sin(2θ), in radians.'];
    lines.push(R>0 && t>0 ? 'From current t: µeff = '+f(1/(2*R*t),6)+' mm⁻¹; absorption length '+f(2*R*t,6)+' mm (R = '+R+' mm).' : 'Fitted µeff requires positive t and a known goniometer radius (Datasets → Instrument).');
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
    var files=await ui.pickFiles('.json',false);if(!files.length)return;
    try{
      var raw=JSON.parse(new TextDecoder().decode(await ui.readBuffer(files[0])));
      var opts=await ui.prompt('Absorption table',[{key:'unit',label:'Energy unit for entries without energyUnit',type:'select',value:raw.energyUnit || 'eV',options:[['eV','eV'],['keV','keV'],['MeV','MeV']]}],'Load','Mass coefficients must be cm²/g. The expected transparency assumes 90% of the crystallographic solid density. Loaded coefficients remain in this session; place absorption.json beside powder6.html for automatic loading.');
      if(!opts || S.busy)return;
      var n=loadDocument(raw,files[0].name,opts.unit);ui.toast('Loaded '+n+' elemental absorption tables from '+files[0].name+'.','ok');
    }catch(e){ui.toast('Absorption table: '+e.message,'err');}
  }
  async function init() {
    var btn=document.querySelector('#ds-absorption');if(btn)btn.addEventListener('click',loadFile);
    if(typeof fetch!=='function')return;
    var token=revision;loading=true;
    try{var r=await fetch('absorption.json');if(!r.ok)throw new Error('absorption.json is not available; load your table in Datasets → Absorption.');var doc=await r.json();if(token===revision)loadDocument(doc,'absorption.json','eV');}
    catch(e){if(token===revision){loading=false;error=e.message;RV.bus.emit('absorption');}}
  }
  return {init:init,loadFile:loadFile,loadDocument:loadDocument,normalize:normalize,coefficient:coefficient,sample:sample,predict:predict,tip:tip,status:status};
})();
