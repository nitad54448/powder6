/*  The Solve tab: from the intensities of a WPPF phase to its structure, and back to the phase for a Rietveld fit.
 *
 *  1. Extract: the WPPF intensities of the phase in one dataset, at its current values, with their uncertainties (the
 *     parameters ticked in that dataset integrated out: the full Pawley normal matrix) and the precision block of the
 *     lowest-angle ones (RV.cmd.extract, a worker job that does not iterate). Fit the phase by WPPF first: the cell and
 *     the peak shape decide what the intensities are.
 *  2. Space group: the test of Markvardsen, David, Johnson and Shankland (2001) over the settings of the Laue class
 *     (rv_sgtest.js); a row sets the space group of the phase.
 *  3. Charge flipping (Oszlányi and Sütő 2004) and the Wyckoff search of powder5, in their own workers
 *     (js/charge_flipping_worker.js, js/wyckoff_worker.js), on the intensities with the French–Wilson
 *     correction of the weak ones (polarization.js), as powder5 prepared them.
 *  4. The sites found replace the atoms of the phase in every dataset; the phase can then be fitted by Rietveld.
 *  RV.solve = { init, render, running(), stop(), report() -> { lines, image } for the PDF, state (for tests) }
 */
RV.solve = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui, esc = ui.esc, C = RVCore;
  var CFD = typeof CF_DEFAULTS !== 'undefined' ? CF_DEFAULTS : { thresholdSigma: 1.1, maxIterations: 1000, randomStarts: 3, peakMerge: 0.9, symLambda: 0.5, overlapTolTth: 0.05, weakFraction: 0.15, weakGrouping: 'cluster' };
  var RHO_MIN = 0.5, RHO_MAX = 22.5, AMU_A3 = 1.66053906660;   // g/cm3 of 1 u per A^3
  function $(s) { return document.querySelector(s); }
  function plural(n, w) { return n + ' ' + (n === 1 ? w : /y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'); }
  function f(v, d) { return Number.isFinite(v) ? v.toFixed(d) : '—'; }
  function pct(v, d) { return Number.isFinite(v) ? (100 * v).toFixed(d == null ? 2 : d) + ' %' : '—'; }
  function capEl(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
  // the assignment of the Wyckoff worker ("NA 8c, TI 4a") with element symbols as they are written
  function prettyAssign(s) { return String(s || '').replace(/\b([A-Z]{1,2})(?= \d)/g, function (m) { return capEl(m); }); }

  // ---------------------------------------------------------------- options (kept in localStorage)
  function defaults() {
    return { formula: '', z: '', tab: 'sgt', sgtN: 0, sgtAuto:true,
             cf: { adaptive:false, grid: 'auto', threshold: CFD.thresholdSigma, iterations: CFD.maxIterations, trials: CFD.randomStarts, symLambda: CFD.symLambda,
                   densityLevel: 3, densityStride: 1, densityCell: true, densitySites: true, weakFraction: CFD.weakFraction, weakGrouping: CFD.weakGrouping, overlapTol: CFD.overlapTolTth, peakMerge: CFD.peakMerge },
             wy: { maxSites: '', maxRepeat: '', rhoMin: 2, rhoMax: 10, maxZ: 3, particles: 512, particlesAuto:true, iterations: 2000, restarts: 4, minContact: 1.0, constraints: '' } };
  }
  function loadOpts() {
    var o = defaults(), s = St.load('solve');
    if (s && typeof s === 'object') {
      ['formula', 'z', 'tab'].forEach(function (k) { if (typeof s[k] === 'string') o[k] = s[k]; });
      if (s.sgtAuto===false && Number.isSafeInteger(s.sgtN) && s.sgtN>=4 && s.sgtN<=C.MAX_PRECISION_REFLECTIONS){o.sgtN=s.sgtN;o.sgtAuto=false;}
      ['cf', 'wy'].forEach(function (g) { if (s[g] && typeof s[g] === 'object') Object.keys(o[g]).forEach(function (k) { if (typeof s[g][k] === typeof o[g][k]) o[g][k] = s[g][k]; }); });
    }
    if(s && s.wy && s.wy.particlesAuto==null && s.wy.particles!=null && s.wy.particles!==512)o.wy.particlesAuto=false;
    if (['sgt', 'cf', 'wy', 'st'].indexOf(o.tab) < 0) o.tab = 'sgt';
    return o;
  }
  var SV = { opts: null, phaseKey: null, dsId: null, ints: null, sgt: null, cf: null, wy: null, shown: null, cfRun: null, wyRun: null, extractions:{} };
  function sgtRange(){
    var I=SV.ints,valid=I && I.phaseKey===SV.phaseKey && I.dsId===SV.dsId;
    var available=valid?(I.pre && Number.isSafeInteger(I.pre.available)?I.pre.available:(I.det || []).length):0;
    return {available:available,max:Math.min(C.MAX_PRECISION_REFLECTIONS,available)};
  }
  function sgtCount(range){range=range || sgtRange();return SV.opts.sgtAuto || !SV.opts.sgtN?range.max:Math.min(SV.opts.sgtN,range.max);}
  function sgtCountIssue(){
    var range=sgtRange(),input=$('#sv-sgtn');
    if(!range.available)return 'Extract intensities for this dataset and phase first.';
    if(range.max<4)return 'Need at least 4 determined intensities; '+range.available+' available.';
    var raw=input?input.value.trim():String(sgtCount(range)),n=/^\d+$/.test(raw)?Number(raw):NaN;
    return Number.isSafeInteger(n) && n>=4 && n<=range.max?'':'Enter a whole number from 4 to '+range.max+'.';
  }
  function syncSgtCount(){
    var input=$('#sv-sgtn');if(!input)return;var range=sgtRange();
    input.min='4';input.max=String(range.max);input.value=range.max?String(sgtCount(range)):'';input.disabled=S.busy || range.max<4;
    input.setCustomValidity('');input.removeAttribute('aria-invalid');
    $('#sv-sgtn-note').textContent=range.available?range.available+' determined intensities available; lowest-angle reflections are used.'+(range.available>C.MAX_PRECISION_REFLECTIONS?' At most '+C.MAX_PRECISION_REFLECTIONS+' per test.':''):'Extract intensities to set the available range.';
  }
  var solutionSelection={},solutionViews={},inspectingSolution=false;
  function active(){return RV.app && (RV.app.commandTab()==='structure' || RV.app.resultTab()==='structure-results');}
  function withSolution(k,fn){
    if(inspectingSolution || !['cf','wy'].includes(k))return fn();
    var id=solutionSelection[k];if(!id && !SV[k]){var all=RV.fitHistory.list('wppf',k);id=all.length?all[all.length-1].id:null;}
    var r=id && RV.fitHistory.find(id);if(!r || !r.solution){delete solutionSelection[k];return fn();}
    if(!solutionViews[k] || solutionViews[k].record!==r)solutionViews[k]={record:r,value:JSON.parse(JSON.stringify(r.solution))};
    var before={value:SV[k],ints:SV.ints,opts:SV.opts,dsId:SV.dsId,phaseKey:SV.phaseKey,shown:SV.shown},value=solutionViews[k].value;
    inspectingSolution=true;SV[k]=value;SV.ints=value.I;SV.dsId=value.I.dsId;SV.phaseKey=value.I.phaseKey;SV.opts=Object.assign({},SV.opts,{formula:value.formula || ''});
    try{return fn();}finally{SV[k]=before.value;['ints','opts','dsId','phaseKey','shown'].forEach(function(key){SV[key]=before[key];});inspectingSolution=false;}
  }
  // A CF or Wyckoff record restored from History: the solution and the extraction it was made from.
  function adoptSolution(k,value){
    if(!['cf','wy'].includes(k) || !value)return false;
    SV[k]=value;delete solutionSelection[k];
    var I=value.I,d=I && St.byId(I.dsId),ph=I && St.phaseByKey(I.phaseKey);
    if(!d || !ph || !St.hasPhase(d,ph)){render();return false;}
    SV.phaseKey=ph.key;SV.dsId=d.id;SV.ints=I;SV.extractions[d.id]={I:I,stats:d.stats};
    render();return true;
  }
  function renderSelectedSolution(k,id){
    if(k==='sgt'){renderSgtOut();return;}solutionSelection[k]=id || null;
    withSolution(k,function(){if(k==='cf')renderCfOut();else renderWyOut();renderStruct(k);});
  }
  function saveOpts() { St.store('solve', SV.opts); }
  function clearEmptyComposition() {
    if (!SV.opts || (S.phases.length && S.datasets.length)) return;
    if (!SV.opts.formula && !SV.opts.z) return;
    SV.opts.formula = ''; SV.opts.z = '';
    saveOpts();
  }

  // WebGPU exposes limits, not physical core counts. Reserve memory and
  // bound dispatches conservatively; workers retain runtime timeout/loss guards.
  var gpuBudget={checked:false,available:false,maxParticles:1536,maxGrid:64,note:'Checking WebGPU limits…'};
  function budgetFor(limits) {
    var bytes=Math.min(limits.maxBufferSize || 134217728,limits.maxStorageBufferBindingSize || 134217728);
    var particles=Math.max(64,Math.min(1536,Math.floor(bytes/(32*3*2*4*3)),limits.maxComputeWorkgroupsPerDimension || 65535));
    var grid=32;while(grid<128 && Math.pow(grid*2,3)*16 <= bytes/3)grid*=2;
    return {maxParticles:particles,maxGrid:grid};
  }
  async function probeGPU() {
    var adapter=null, timer=null;
    try { if(navigator.gpu)adapter=await Promise.race([navigator.gpu.requestAdapter(),new Promise(function(r){timer=setTimeout(function(){r(null);},3000);})]); }catch(e){}finally{if(timer)clearTimeout(timer);}
    gpuBudget.checked=true;gpuBudget.available=!!adapter;
    if(adapter)Object.assign(gpuBudget,budgetFor(adapter.limits));
    gpuBudget.note=adapter ? 'WebGPU: up to '+gpuBudget.maxParticles+' particles in this conservative budget; default '+Math.max(64,Math.floor(gpuBudget.maxParticles/3))+' (33%). GPU cores are not exposed. CF runs random starts sequentially; its grid limit is '+gpuBudget.maxGrid+'³. Workers monitor timeouts and device loss.' : 'WebGPU unavailable: Wyckoff needs WebGPU. CF can use its CPU fallback, with a conservative 64³ grid limit.';
    if(SV.opts && !S.busy) {
      if(SV.opts.wy.particlesAuto)SV.opts.wy.particles=Math.max(64,Math.floor(gpuBudget.maxParticles/3));
      SV.opts.wy.particles=Math.min(gpuBudget.maxParticles,SV.opts.wy.particles);
      saveOpts();refresh();
    }
    return gpuBudget;
  }
  // ---------------------------------------------------------------- space-group records and operators
  /* The operators of a setting as powder5 hands them to its workers (powder5.html, getSymopsForSetting): the sym_ops of
     sg/all.json, translations as exact rationals where the file has them. Also the fallback of wyckoff_report.js. */
  function symopsFor(sg) {
    if (!sg || !globalThis.SG_DATABASE) return { error: 'The space-group database is not loaded.' };
    var entry = SG_DATABASE.space_groups && SG_DATABASE.space_groups[String(sg.number)];
    if (!entry) return { error: 'Space group ' + sg.number + ' is not in the database.' };
    var usable = (entry.settings || []).filter(function (st) {
      var sym = String((st && st.symbol) || '').replace(/\s+/g, '');
      return !/:R$/i.test(sym) && String((st && st.hall) || '').indexOf('*') === -1;
    });
    var setting = usable.filter(function (st) { return sg.hall && st.hall === sg.hall; })[0] || usable.filter(function (st) { return sg.symbol && st.symbol === sg.symbol; })[0] || null;
    if (!setting) return { error: 'No matching setting for space group ' + sg.number + ' (' + (sg.symbol || sg.hall || '?') + ') in the database.' };
    var raw = setting.sym_ops || setting.symops;
    if (!Array.isArray(raw) || !raw.length) return { error: 'The space-group database has no operators (sym_ops) for ' + (sg.symbol || sg.number) + '.' };
    var symops = raw.map(function (op) {
      return { r: op.r.map(Number), t: (op.t_num && op.t_den) ? op.t_num.map(function (n) { return Number(n) / Number(op.t_den); }) : op.t.map(Number), xyz: op.xyz || '' };
    });
    return { symops: symops, setting: setting, entry: entry };
  }
  if (typeof globalThis.getSymopsForSetting !== 'function') globalThis.getSymopsForSetting = symopsFor;

  // ---------------------------------------------------------------- formulas
  // { El: count per formula unit } with brackets, as wyckoff_assign.js reads it; null when it cannot be read
  function parseFormula(formula) {
    var src = String(formula || '').replace(/\s+/g, ''), counts = {}, order = [], bad = false;
    if (!src) return null;
    (function walk(s, mult) {
      var i = 0;
      while (i < s.length && !bad) {
        if (s[i] === '(') {
          var depth = 1, j = i + 1;
          while (j < s.length && depth) { if (s[j] === '(') depth++; if (s[j] === ')') depth--; j++; }
          if (depth) { bad = true; return; }
          var mm = /^(\d+(?:\.\d+)?)/.exec(s.slice(j));
          walk(s.slice(i + 1, j - 1), mult * (mm ? parseFloat(mm[1]) : 1));
          i = j + (mm ? mm[1].length : 0);
          continue;
        }
        var m = /^([A-Z][a-z]?)(\d+(?:\.\d+)?)?/.exec(s.slice(i));
        if (!m || !(St.atomicWeight(m[1]) > 0)) { bad = true; return; }
        if (!(m[1] in counts)) { counts[m[1]] = 0; order.push(m[1]); }
        counts[m[1]] += mult * (m[2] ? parseFloat(m[2]) : 1);
        i += m[0].length;
      }
    })(src, 1);
    if (bad || !order.length) return null;
    return order.map(function (el) { return { el: el, n: counts[el] }; });
  }
  function formulaMass(comp) { return comp ? comp.reduce(function (s, c) { return s + c.n * St.atomicWeight(c.el); }, 0) : NaN; }
  // what the element scatters with: f(0) for X-rays, b for neutrons (the heights of a density map follow it)
  function power(el, radiation) {
    var sc = St.scatterer(el);
    if (radiation === 'neutron') return Number.isFinite(sc.neutron) && sc.neutron !== 0 ? Math.abs(sc.neutron) : St.atomicWeight(el) / 2;
    if (sc.xray && Array.isArray(sc.xray.a)) return sc.xray.a.reduce(function (s, a) { return s + a; }, 0) + (sc.xray.c || 0);
    return St.atomicWeight(el) / 2 || 0;
  }
  function typedZ(value) { var z = parseInt(String(value==null?SV.opts.z:value).trim(), 10); return Number.isFinite(z) && z >= 1 ? Math.min(192, z) : null; }

  // ---------------------------------------------------------------- distance constraints (powder5.html, unchanged rules)
  function parseConstraints(text) {
    var out = [], bad = [], warn = [];
    String(text || '').split(/\n+/).forEach(function (line, i) {
      var t = line.trim();
      if (!t || t.charAt(0) === '#') return;
      var p = t.split(/[\s,]+/);
      if (p.length < 3) { bad.push('line ' + (i + 1) + ': need at least "A B N dmin/dmax"'); return; }
      var a = p[0].toUpperCase(), b = p[1].toUpperCase(), rest = p.slice(2), hasSlash = rest.some(function (tok) { return tok.indexOf('/') >= 0; });
      var count = null, mode = null, dmin = null, dmax = null;
      if (!hasSlash) {
        var nums = rest;
        if (rest[0] === '-' || rest[0] === '*') {
          nums = rest.slice(1);
          if (!nums.length) { bad.push('line ' + (i + 1) + ': "' + a + ' ' + b + ' ' + rest[0] + '" states nothing - add a distance, e.g. "' + a + ' ' + b + ' - 2.0"'); return; }
        } else if (/^\d+\+?$/.test(rest[0]) && rest.length === 1) {
          bad.push('line ' + (i + 1) + ': "' + rest[0] + '" on its own is ambiguous - write "' + a + ' ' + b + ' ' + rest[0] + ' dmin/dmax" for a coordination number, or "' + a + ' ' + b + ' ' + rest[0] + '.0" for a distance');
          return;
        }
        dmin = parseFloat(nums[0]);
        if (!Number.isFinite(dmin)) { bad.push('line ' + (i + 1) + ': "' + nums[0] + '" is not a distance'); return; }
        if (nums.length > 1) { dmax = parseFloat(nums[1]); if (!Number.isFinite(dmax)) { bad.push('line ' + (i + 1) + ': "' + nums[1] + '" is not a distance'); return; } }
      } else {
        var range;
        if (rest.length >= 2 && rest[0].indexOf('/') < 0) {
          var c = rest[0];
          if (c !== '-' && c !== '*') {
            var m = /^(\d+)(\+?)$/.exec(c);
            if (!m) { bad.push('line ' + (i + 1) + ': "' + c + '" is not a coordination number (use 4, 4+ or -)'); return; }
            count = parseInt(m[1], 10); mode = m[2] === '+' ? 'atleast' : 'exact';
          }
          range = rest[1];
        } else range = rest[0];
        var sides = range.split('/');
        if (sides.length !== 2) { bad.push('line ' + (i + 1) + ': "' + range + '" should be dmin/dmax'); return; }
        if (sides[0].trim() !== '') { dmin = parseFloat(sides[0]); if (!Number.isFinite(dmin)) { bad.push('line ' + (i + 1) + ': "' + sides[0] + '" is not a distance'); return; } }
        if (sides[1].trim() !== '') { dmax = parseFloat(sides[1]); if (!Number.isFinite(dmax)) { bad.push('line ' + (i + 1) + ': "' + sides[1] + '" is not a distance'); return; } }
      }
      if (dmin === null && dmax === null && count === null) { bad.push('line ' + (i + 1) + ': nothing to enforce - give a count, a distance, or both'); return; }
      if (dmin !== null && dmax !== null && dmax < dmin) { bad.push('line ' + (i + 1) + ': dmax (' + dmax + ') is below dmin (' + dmin + ')'); return; }
      if (count !== null && dmax === null) warn.push('line ' + (i + 1) + ': "' + a + ' ' + b + ' ' + count + (mode === 'atleast' ? '+' : '') + ' ' + (dmin == null ? '' : dmin) + '/" counts every ' + b + ' beyond ' + (dmin == null ? 0 : dmin) + ' Å, which is every ' + b + ' in the cell - add an upper distance to make the count mean something');
      out.push({ a: a, b: b, count: count, countMode: mode, dmin: dmin, dmax: dmax });
    });
    return { windows: out, bad: bad, warn: warn };
  }
  function describeConstraint(w) {
    var A = capEl(w.a), B = capEl(w.b), hasMin = Number.isFinite(w.dmin), hasMax = Number.isFinite(w.dmax), d = function (v) { return v.toFixed(2); };
    var range = hasMin && hasMax ? d(w.dmin) + ' to ' + d(w.dmax) + ' Å' : hasMax ? 'up to ' + d(w.dmax) + ' Å' : hasMin ? 'at least ' + d(w.dmin) + ' Å' : null;
    if (Number.isFinite(w.count) && w.count > 0) return A + '–' + B + ' distance ' + (range || 'any distance') + ', coordination ' + (w.countMode === 'atleast' ? w.count + ' or more' : w.count);
    if (hasMin && hasMax) return A + '–' + B + ' distance ' + d(w.dmin) + ' to ' + d(w.dmax) + ' Å';
    if (hasMax) return A + '–' + B + ' nearest neighbour within ' + d(w.dmax) + ' Å';
    if (hasMin) return A + '–' + B + ' no closer than ' + d(w.dmin) + ' Å';
    return A + '–' + B + ': no constraint';
  }
  // the parse, the elements against the formula and the bounds of the kernel (swarm_reflection.wgsl: 8 rules, 64 slots)
  function validateConstraints(text, formula) {
    var r = parseConstraints(text), errors = r.bad.slice(), warnings = r.warn.slice();
    var m = String(formula || '').match(/[A-Z][a-z]?/g), known = m && m.length ? new Set(m.map(function (s) { return s.toUpperCase(); })) : null;
    if (known) {
      var unseen = new Set();
      r.windows.forEach(function (w) { if (!known.has(w.a)) unseen.add(w.a); if (!known.has(w.b)) unseen.add(w.b); });
      unseen.forEach(function (el) { errors.push('"' + capEl(el) + '" is not in the formula, so no atom can ever match it'); });
    }
    var rules = r.windows.reduce(function (n, w) {
      var hasCount = Number.isFinite(w.count) && w.count >= 0;
      if (!hasCount && !Number.isFinite(w.dmax)) return n;
      return n + (!hasCount && w.a !== w.b ? 2 : 1);
    }, 0);
    if (rules > 8) errors.push('These ' + r.windows.length + ' constraints make ' + rules + ' rules; the kernel holds 8. A bare upper bound counts twice, being applied both ways.');
    r.windows.forEach(function (w) {
      if (!Number.isFinite(w.count) || w.count <= 0 || w.count % 2 === 0) return;
      warnings.push('"' + capEl(w.a) + ' ' + capEl(w.b) + ' ' + w.count + '": ' + w.count + ' is the coordination number of ' + capEl(w.a) + ' (its number of ' + capEl(w.b) + ' neighbours). An odd number keeps ' + capEl(w.a) +
        ' off every inversion centre, which can leave it no position at all. For a distance window alone write "' + capEl(w.a) + ' ' + capEl(w.b) + ' - ' + (w.dmin == null ? '' : w.dmin) + '/' + (w.dmax == null ? '' : w.dmax) + '".');
    });
    var slots = r.windows.reduce(function (n, w) { return n + (Number.isFinite(w.count) && w.count > 0 ? w.count : 0); }, 0);
    if (slots > 64) errors.push('The coordination numbers total ' + slots + ', above the 64 neighbour slots of the kernel.');
    for (var i = 0; i < r.windows.length; i++) {
      var w = r.windows[i];
      if (w.a !== w.b && Number.isFinite(w.count) && w.count > 0 && r.windows.some(function (v) { return v.a === w.b && v.b === w.a && Number.isFinite(v.count); })) {
        warnings.push('Both "' + capEl(w.a) + ' ' + capEl(w.b) + '" and "' + capEl(w.b) + ' ' + capEl(w.a) + '" state a coordination number: two separate demands, not one bond counted once.');
        break;
      }
    }
    return { windows: r.windows, errors: errors, warnings: warnings };
  }

  // ---------------------------------------------------------------- the phase and the dataset
  function phase() { return St.phaseByKey(SV.phaseKey); }
  function dataset() { return St.byId(SV.dsId); }
  function pickDefaults() {
    var cur = St.currentPhase();
    if (!phase()) {
      var w = S.phases.filter(function (p) { return p.method === 'wppf'; });
      SV.phaseKey = cur && cur.method === 'wppf' ? cur.key : (w[0] || cur || {}).key || null;
    }
    if(S.phases.length===1){
      var first=St.first();SV.phaseKey=S.phases[0].key;SV.dsId=first ? first.id : null;
      var cached=first && SV.extractions[first.id];
      SV.ints=first && St.hasPhase(first,S.phases[0]) && cached && cached.stats===first.stats ? cached.I : null;
      return;
    }
    // a dataset that holds the phase: the first selected one, else the first of the list
    var ph = phase(), ok = function (d) { return !!d && (!ph || St.hasPhase(d, ph)); };
    if (!ok(dataset())) {
      var d = [St.first()].concat(St.selected(), S.datasets).filter(ok)[0];
      SV.dsId = d ? d.id : null;
    }
    if(!SV.ints || SV.ints.phaseKey!==SV.phaseKey || SV.ints.dsId!==SV.dsId){var selected=dataset(),cached=selected && SV.extractions[selected.id];SV.ints=cached && cached.stats===selected.stats && cached.I.phaseKey===SV.phaseKey?cached.I:null;}
  }
  function polOf(inst) {
    if (inst.radiation === 'neutron' || inst.pol === 'none') return { mode: 'none' };
    if (inst.pol === 'mono') return { mode: 'lab', monoTth: inst.monoTth };
    if (inst.pol === 'sync') return { mode: 'synchrotron', polFrac: inst.polFrac };
    return { mode: 'lab', monoTth: 0 };
  }
  // the cell volume for the density: from the extraction, else from the phase and the dataset as they are
  function volume() {
    if (SV.ints && SV.ints.phaseKey === SV.phaseKey) return cellVolume(SV.ints.cell);
    var ph = phase(), ds = dataset(), c = ph ? St.cellOf(ph, ds ? ds.p : ph.v) : null;
    return c ? cellVolume(c) : NaN;
  }
  function density(Z, comp) { var M = formulaMass(comp), V = volume(); return M > 0 && V > 0 ? AMU_A3 * Z * M / V : NaN; }
  // the step between the values of Z the Wyckoff positions allow (wyZStepUI of powder5)
  function zStep(comp) {
    var ph = phase();
    if (!ph || !comp) return 1;
    var mults = (ph.wyckoff || []).map(function (w) { return Number(w.multiplicity); }).filter(function (m) { return m > 0; });
    if (!mults.length || !comp.every(function (c) { return Number.isInteger(c.n); })) return 1;
    function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
    var g = mults.reduce(gcd), step = 1;
    if (g <= 1) return 1;
    comp.forEach(function (c) { var need = g / gcd(g, c.n); step = step * need / gcd(step, need); });
    return Math.max(1, step);
  }
  // k: 'cf' or 'wy', the method whose row the hint is under
  function densityHint(k) {
    var comp = parseFormula(SV.opts.formula), Z = typedZ(), raw = String(SV.opts.formula || '').trim();
    if (!raw) return k === 'cf' ? { text: 'Optional here: with a formula unit the peaks are given element types; without one they stay unnamed.', warn: false }
                                : { text: 'Required: the Wyckoff search places exactly the atoms of this formula unit, Z times per cell.', warn: false };
    if (!comp) return { text: raw + ' is not a formula this program can read (element symbols, counts and brackets: Ca(OH)2).', warn: true };
    var M = formulaMass(comp), V = volume();
    if (!(V > 0)) return { text: 'M = ' + M.toFixed(2) + ' g/mol.', warn: false };
    if (Z) {
      var rho = density(Z, comp), bad = !(rho >= RHO_MIN && rho <= RHO_MAX);
      return { text: 'Z = ' + Z + ': ρ = ' + rho.toFixed(3) + ' g/cm³ (M = ' + M.toFixed(2) + ' g/mol, V = ' + V.toFixed(1) + ' Å³).' + (bad ? ' No solid has that density: Z counts formula units, not atoms.' : ''), warn: bad };
    }
    if (k === 'cf') return { text: 'Z = Auto: from the highest peak, its site multiplicity over the count of the heaviest element. M = ' + M.toFixed(2) + ' g/mol, V = ' + V.toFixed(1) + ' Å³.', warn: false };
    var w = wyOptions(), lo = Math.max(1, Math.ceil(V * w.rhoMin / (AMU_A3 * M) - 1e-9)), hi = Math.min(192, Math.floor(V * w.rhoMax / (AMU_A3 * M) + 1e-9)), st = zStep(comp), list = [];
    for (var z = Math.max(st, Math.ceil(lo / st) * st); z <= hi && list.length < 12; z += st) list.push(z);
    return { text: 'Z = Auto: ' + (list.length ? 'the Wyckoff search tries Z = ' + list.join(', ') + (st > 1 ? ' (multiples of ' + st + ' the positions allow)' : '') + ', ρ ' + density(list[0], comp).toFixed(2) + '–' + density(list[list.length - 1], comp).toFixed(2) + ' g/cm³'
                                                   : 'no Z gives a density between ' + w.rhoMin + ' and ' + w.rhoMax + ' g/cm³ here; widen the window (Wyckoff search)') + '. M = ' + M.toFixed(2) + ' g/mol, V = ' + V.toFixed(1) + ' Å³.', warn: !list.length };
  }

  // ---------------------------------------------------------------- 1. the intensities
  function extractWhy(ph, ds) {
    if (S.busy) return 'Wait for the current calculation to finish or press Stop.';
    if (!ph) return 'Create a phase first.';
    if (!ds) return 'Assign the phase to a dataset in Datasets first.';
    if (!St.hasPhase(ds, ph)) return 'Assign this phase to the dataset first.';
    if (S.calculation !== 'wppf' || ph.method !== 'wppf') return 'Select WPPF and fit this dataset first.';
    var st = ds.stats, fitted = st && st.ok !== false && Number.isFinite(st.iter) && !/stop|cancel|fail|error/i.test(st.msg || '') &&
      (st.phases || []).some(function (p) { return p.key === ph.key && p.method === 'wppf'; });
    return fitted ? '' : 'Fit this dataset in WPPF first. Refit after changing the model or point weights.';
  }
  async function extract(options) {
    options=options || {};
    if(!options.ds)pickDefaults();
    var ph = options.ph || phase(), ds = options.ds || dataset(), why = extractWhy(ph, ds);
    if (why) { ui.toast(why, 'warn'); return; }
    var pi = S.phases.indexOf(ph), res;
    try { res = await RV.cmd.extract(ds, { phase: pi, maxRefl: options.maxRefl || (!SV.opts.sgtAuto && SV.opts.sgtN) || C.MAX_PRECISION_REFLECTIONS }); }
    catch (e) { ui.toast('Intensities: ' + ((e && e.message) || e), 'err'); return; }
    if (!res) { ui.toast('Extraction stopped.', 'info'); return; }
    if (!res.ok) { ui.toast('The intensities of ' + ph.name + ' could not be extracted: ' + res.msg, 'err'); return; }
    var ev, T = res.intensities && res.intensities[0] && res.intensities[0][pi];
    try { ev = C.evaluate(St.problemFor([ds]), 0); } catch (e) { ui.toast('Intensities: ' + ((e && e.message) || e), 'err'); return; }
    if (!T || !ev.phases[pi]) { ui.toast('No WPPF intensities for ' + ph.name + '.', 'err'); return; }
    var profile=profileOf(ph,ds),refl = ev.phases[pi].refl.map(function (r, k) {
      return { i: k, h: r.h, k: r.k, l: r.l, m: r.m, d: r.d, tth: r.tth, lp: r.lp, K: r.K, height: r.height, Icalc: T.area[k], area: T.area[k],
               sigma: T.sigma[k], bound: !!T.bound[k], group: T.group[k], inRange: r.inRange, fwhm:reflectionWidth({profile:profile},r) };
    });
    var det = refl.filter(function (r) { return r.inRange && Number.isFinite(r.sigma); });
    var nv = (St.jobFor(ds).vars || []).length, st = res.stats[0], cell = St.cellOf(ph, ds.p), got = symopsFor(ph.sg);
    SV.ints = {
      stamp: ui.stamp(), phaseKey: ph.key, phaseName: ph.name, dsId: ds.id, dsName: ds.name, sg: Object.assign({}, ph.sg), ops: ph.ops, wyckoff: ph.wyckoff,
      cell: cell, lambda: ds.inst.lambda1, radiation: ds.inst.radiation, pol: polOf(ds.inst), inst: St.instCopy(ds.inst),
      covarianceOK:res.covarianceOK, profile: profile, refl: refl, det: det, pre: res.precision, s2: res.chi2red, nVar: nv, Rwp: st.Rwp, chi2: res.chi2red,
      symops: got.error ? null : got.symops, symErr: got.error || '', stale: false
    };
    ds.ints = res.intensities[0];
    SV.extractions[ds.id]={I:SV.ints,stats:ds.stats};
    RV.bus.emit('stats');
    var n0 = det.filter(function (r) { return r.bound; }).length, strong = det.filter(function (r) { return r.sigma > 0 && r.area > 3 * r.sigma; }).length;
    if(!options.quiet) ui.toast('Extracted ' + plural(det.length, 'intensity') + ' of ' + ph.name + ' in ' + ds.name + ': ' + strong + ' above 3σ, ' + n0 + ' held at zero; σ ' +
             (nv ? 'with the ' + plural(nv, 'ticked parameter') + ' integrated out' : 'conditional (nothing ticked)') + '.', 'ok');
    if(res.covarianceOK===false)ui.toast('Nonlinear covariance is ill-conditioned. Intensity uncertainties are conditional on the current parameters; reduce correlated fit variables.','warn');
    render(); return true;
  }
  async function autoExtract(list) {
    var targets=list.filter(function(d){return St.phasesIn(d).length===1 && !extractWhy(St.phasesIn(d)[0],d);}), done=0;
    for(var i=0;i<targets.length;i++){var ds=targets[i],ph=St.phasesIn(ds)[0]; if(!await extract({ds:ds,ph:ph,quiet:true}))break;done++;}
    pickDefaults(); if(done)ui.toast('Automatically extracted WPPF intensities for '+done+' dataset(s). Save .hkl is available for the selected dataset.','ok');
    render();
  }
  function profileOf(ph, ds) {
    return C.profileParamsFor({key:ph.key,profileType:ph.profileType,separatedProfile:ph.separatedProfile===true,system:ph.sg.system,uniqueAxis:ph.sg.uniqueAxis,ops:ph.ops,broadening:ph.broadening},
      Object.assign({},ds.inst,{minFwhm:Math.max(1e-4,2*(ds.step || .01))}),ds.p);
  }
  function reflectionWidth(I,r){
    if(r.fwhm>0 && Number.isFinite(r.fwhm))return r.fwhm;
    if(!I.profile)return null;
    var sine=r.d>0?I.profile.lambda/(2*r.d):NaN,tth=sine>0 && sine<1?360/Math.PI*Math.asin(sine):r.tth-(I.profile.zeroShift || 0);
    var p=prepareVoigt(tth,r.tth,{h_orig:r.h,k_orig:r.k,l_orig:r.l,d:r.d},I.profile);
    return p && Number.isFinite(p.fwhm_total)?p.fwhm_total:null;
  }
  // the list charge flipping and the Wyckoff search share (cfPrepareIntensities of powder5): the determined WPPF
  // intensities, French-Wilson for the weak ones, anything still not positive a measured zero
  function solveInput(I) {
    var list = I.det.map(function (r) { return { h: r.h, k: r.k, l: r.l, area: r.area, rawArea: r.area, sigma: r.sigma, multiplicity: r.m, tth: r.tth, d: r.d, lp: r.lp,fwhm:reflectionWidth(I,r) }; });
    var fw = frenchWilsonCorrect(list, I.symops, I.pol), zero = 0;
    var hklList = list.map(function (r) {
      var v = r.area;
      if (!(v > 0)) { v = 0; zero++; }
      return { h_orig: r.h, k_orig: r.k, l_orig: r.l, intensity: v, multiplicity: r.multiplicity, rawIntensity: r.rawArea, sigma: r.sigma > 0 ? r.sigma : null, tth: r.tth, d: r.d, lp: r.lp,fwhm:r.fwhm };
    }).filter(function (r) { return Number.isFinite(r.intensity); });
    var note = 'Lp: ' + polarizationDescription(I.pol) + '. ' + (fw.applied ? 'French–Wilson correction of ' + plural(fw.corrected, 'weak reflection') + (fw.negatives ? ' (' + fw.negatives + ' negative)' : '') : 'No French–Wilson correction (' + fw.reason + ')') + '; ' + zero + ' set to zero.';
    return { hklList: hklList, note: note, fw: fw, zero: zero };
  }
  function staleNote() {
    var I = SV.ints;
    if (!I) return '';
    var ph = St.phaseByKey(I.phaseKey);
    if (!ph) return 'The phase ' + I.phaseName + ' of this extraction is gone.';
    if (ph.sg.hall !== I.sg.hall) return 'The space group of ' + ph.name + ' changed since this extraction (' + I.sg.symbol + ' then, ' + ph.sg.symbol + ' now): fit and extract again.';
    if (I.stale) return 'The values changed since this extraction: extract again for the intensities at the new values.';
    return '';
  }

  // ---------------------------------------------------------------- 2. space-group test
  async function runSgt() {
    if(S.busy)return;
    var issue=sgtCountIssue();if(issue){ui.toast(issue,'warn');return;}
    var requested=Number($('#sv-sgtn').value);
    var I = SV.ints;
    if (!I) { ui.toast('Extract the intensities first.', 'warn'); return; }
    if (!I.pre || !I.pre.n) { ui.toast('The extraction holds no precision block (no WPPF intensity was determined).', 'warn'); return; }
    if(I.pre.n!==requested){
      var ds=St.byId(I.dsId),ph=St.phaseByKey(I.phaseKey),sourceIssue=staleNote() || extractWhy(ph,ds);
      if(sourceIssue){ui.toast('Refit and extract this source before changing the number of reflections. '+sourceIssue,'warn');return;}
      if(!await extract({ds:ds,ph:ph,maxRefl:requested,quiet:true}))return;
      I=SV.extractions[ds.id] && SV.extractions[ds.id].I;
      if(!I || !I.pre || I.pre.n<4){ui.toast('Need at least 4 determined intensities.','warn');return;}
    }
    var rec = RV.sgtest.recordOf(I.sg), inp = RV.sgtest.inputFrom(I.pre, I.refl);
    St.setBusy(true,'Checking space-group candidates…');
    await new Promise(function(resolve){setTimeout(resolve,20);});
    try {
    var out = RV.sgtest.run(Object.assign(inp, { fitRec: rec, cell: I.cell, lambda: I.lambda, truncatedTo: I.pre.n < I.det.length ? I.pre.n : 0 }));
    out.stamp = I.stamp; out.phaseName = I.phaseName; out.dsName = I.dsName; out.sgSymbol = I.sg.symbol;
    SV.sgt = out;
    if (out.error) ui.toast('Space-group test: ' + out.error, 'warn');
    else {
      var top = out.rows[0];
      ui.toast('Space-group test on ' + plural(out.n, 'intensity') + ' of ' + I.phaseName + ': ' + RV.sgtest.label(top.recs[0]) + (top.recs.length > 1 ? ' (or ' + (top.recs.length - 1) + ' more with the same absences)' : '') +
               ', p = ' + pct(top.p, 1) + (out.rows[1] ? '; next ' + RV.sgtest.label(out.rows[1].recs[0]) + ', ' + pct(out.rows[1].p, 1) : '') + '.', 'ok');
    }
    renderSgtOut();
    } catch(e) {ui.toast('Space-group test: '+e.message,'err');} finally {St.setBusy(false);}
  }
  function useSetting(number, hall) {
    var ph = St.phaseByKey(SV.ints ? SV.ints.phaseKey : SV.phaseKey);
    if (!ph) { ui.toast('The phase is gone.', 'warn'); return; }
    if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    var sg = St.resolveSG(number, hall);
    if (!sg) { ui.toast('Space group ' + number + ' could not be set up.', 'err'); return; }
    if (sg.hall === ph.sg.hall) { ui.toast(ph.name + ' is already in ' + St.sgText(sg) + '.', 'info'); return; }
    RV.history.take('space group of ' + ph.name);
    St.setPhaseSG(ph, sg);
    ui.toast('Space group of ' + ph.name + ': ' + sg.symbol + ' (' + sg.number + '). Fit again by WPPF and extract the intensities in this group before solving the structure.', 'ok');
  }

  // ---------------------------------------------------------------- 3a. charge flipping
  var CF_COMPARE_MAPS = 12;
  function readNum(v, lo, hi, int) { var x = typeof v === 'number' ? v : ui.parseNum(v); if (!Number.isFinite(x)) return NaN; if (int) x = Math.round(x); return Math.min(hi, Math.max(lo, x)); }
  function cfOptions() {
    var o = SV.opts.cf, g = String(o.grid);
    var r = { adaptive:o.adaptive===true,grid: g === 'auto' ? 'auto' : parseInt(g, 10), threshold: ui.parseNum(o.threshold), iterations: readNum(o.iterations, 10, 100000, true), trials: readNum(o.trials, 1, CFAdaptive.MAX_STARTS, true),
              symLambda: ui.parseNum(o.symLambda), weakFraction: readNum(o.weakFraction, 0, 0.33), weakGrouping: o.weakGrouping === 'individual' ? 'individual' : 'cluster',
              overlapTol: ui.parseNum(o.overlapTol), peakMerge: ui.parseNum(o.peakMerge) };
    if(r.adaptive){r.threshold=1.1;r.weakFraction=.15;r.symLambda=.5;r.weakGrouping='cluster';if(!Number.isFinite(r.overlapTol))r.overlapTol=.05;}
    if (r.grid !== 'auto' && !(r.grid >= 8 && (r.grid & (r.grid - 1)) === 0)) r.error = 'The grid must be a power of two.';
    else if (!(r.threshold >= 0)) r.error = 'The threshold must be a number ≥ 0 (in units of σ).';
    else if (!(r.iterations >= 10)) r.error = 'Use at least 10 cycles.';
    else if (!(r.trials >= 1)) r.error = 'At least one random start.';
    else if (!(r.symLambda >= 0 && r.symLambda <= 1)) r.error = 'The symmetry strength is between 0 and 1.';
    else if (!(r.overlapTol >= 0)) r.error = 'The overlap tolerance is a non-negative number of degrees 2θ.';
    else if (!(r.peakMerge > 0)) r.error = 'The peak merge distance is a positive number of ångström.';
    else if (!Number.isFinite(r.weakFraction)) r.error = 'The fraction of weak reflections is a number from 0 to 0.33.';
    var starts=ui.parseNum(o.trials);
    if(r.adaptive && (!Number.isSafeInteger(starts) || starts<CFAdaptive.MIN_STARTS || starts>CFAdaptive.MAX_STARTS))r.error='Adaptive CF needs '+CFAdaptive.MIN_STARTS+'–'+CFAdaptive.MAX_STARTS+' random starts.';
    else if(!r.adaptive && starts>CFAdaptive.MAX_STARTS)r.error='At most '+CFAdaptive.MAX_STARTS+' random starts.';
    return r;
  }
  function cfAssessment(I){return CFAdaptive.assess(I,SV.opts.cf,function(r){return reflectionWidth(I,r);});}
  function cfQualityText(q){
    return q.count+' intensities; '+q.clusters+' profile overlap groups; '+(q.dMin?'d min '+f(q.dMin,2)+' Å; ':'')+
      'median resolved I/σ '+f(q.medianISigma,1)+'; '+q.strongCount+' resolved entries at I/σ ≥ 3. I/σ by resolution shell (low/middle/high): '+q.shells.map(function(s){return f(s.medianISigma,1);}).join(' / ')+'.';
  }
  function renderCfPlan(){
    var host=$('#sv-cf-quality');if(!host)return;var adaptive=SV.opts.cf.adaptive===true;
    $('#sv-cf-adaptive').checked=adaptive;
    ['threshold','symLambda','weakFraction','weakGrouping','overlapTol'].forEach(function(k){var input=$('#sv-cf-'+k),box=input.parentElement;box.hidden=adaptive;box.previousElementSibling.hidden=adaptive;});
    if(!SV.ints){host.textContent='Extract WPPF intensities to assess the data and preview adaptive settings.';return;}
    var assessment=cfAssessment(SV.ints),q=assessment.quality;
    host.innerHTML='<p class="hint">'+esc(cfQualityText(q))+'</p>'+
      (!q.uncertaintiesReliable?'<p class="hint">Too few reliable resolved intensities, or uncertainties are missing or conditional; signal-to-noise guidance is limited.</p>':'')+
      (adaptive && q.widthCoverage<1?'<p class="hint">Some fitted widths are unavailable; those pairs use the manual overlap tolerance.</p>':'');
    if(!adaptive)return;
    try{var plan=CFAdaptive.plan(assessment,ui.parseNum(SV.opts.cf.trials),!!SV.ints.symops);
      host.innerHTML+='<p class="hint">Search preview: '+plan.trials.length+' starts across three settings, with repeated seeds. No additional intensity cutoff. Overlap tolerance follows half the mean fitted FWHM of each reflection pair. These choices are search heuristics.</p><p class="hint">Search emphasis: '+esc(plan.reasons.join('; ') || 'baseline parameter exploration')+'.</p>'+cfSettingsTable(plan.settings);
    }catch(e){host.innerHTML+='<p class="warn">'+esc(e.message)+'</p>';}
  }
  function cfSettingsTable(settings){return '<div class="table-wrap"><table class="grid compact"><thead><tr><th>δ / σ density</th><th>Weak fraction</th><th>Symmetry λ</th><th>Starts</th></tr></thead><tbody>'+settings.map(function(c){return '<tr><td>'+f(c.threshold,2)+'</td><td>'+f(c.weakFraction,2)+'</td><td>'+f(c.symLambda,2)+'</td><td>'+c.starts+'</td></tr>';}).join('')+'</tbody></table></div>';}
  // the smallest power of two that holds every member of every orbit (the worker drops what does not fit)
  function autoGrid(hklList, symops) {
    var mx = 0, ops = symops && symops.length ? symops : [{ r: [1, 0, 0, 0, 1, 0, 0, 0, 1] }];
    hklList.forEach(function (p) {
      ops.forEach(function (o) {
        var r = o.r, h = p.h_orig, k = p.k_orig, l = p.l_orig;
        mx = Math.max(mx, Math.abs(h * r[0] + k * r[3] + l * r[6]), Math.abs(h * r[1] + k * r[4] + l * r[7]), Math.abs(h * r[2] + k * r[5] + l * r[8]));
      });
    });
    var need = 2 * mx + 2, g = 32;
    while (g < need && g < 128) g *= 2;
    return { grid: g, maxIndex: mx, fits: g >= need };
  }
  function runCf() {
    if (S.busy || SV.cfRun || SV.wyRun) return;
    var I = SV.ints;
    if (!I) { ui.toast('Extract the intensities first.', 'warn'); return; }
    var o = cfOptions();
    if (o.error) { ui.toast('Charge flipping: ' + o.error, 'warn'); return; }
    var search=null;
    if(o.adaptive){try{search=CFAdaptive.plan(cfAssessment(I),o.trials,!!I.symops);}catch(e){ui.toast(e.message,'warn');return;}}
    var inp = solveInput(I);
    if (!inp.hklList.length) { ui.toast('No usable intensity for charge flipping.', 'warn'); return; }
    var rec = RV.sgtest.recordOf(I.sg), ag = autoGrid(inp.hklList, I.symops), grid = o.grid === 'auto' ? ag.grid : o.grid, W;
    if(grid<2*ag.maxIndex+2){ui.toast('The chosen CF grid cannot contain every reflection and symmetry mate. Increase the grid or reduce the extracted range.','warn');return;}
    if(grid>gpuBudget.maxGrid){ui.toast('This CF grid exceeds the current '+gpuBudget.maxGrid+'³ memory budget. Reduce the grid or the extracted reflection range.','warn');return;}
    if(!ag.fits){ui.toast('Reflections exceed the supported CF grid. Reduce the extracted range.','warn');return;}
    if (!I.symops) ui.toast(I.symErr + ' Charge flipping runs in P1, without the symmetry in the loop, and no sites can be placed.', 'warn');
    try { W = new Worker('js/charge_flipping_worker.js'); } catch (e) { ui.toast('Could not start js/charge_flipping_worker.js: ' + e.message, 'err'); return; }
    var run = SV.cfRun = { worker: W, trial: 0, done: 0, best: null, structure: null, stopped: false, stage: 'flip', o: o, grid: grid, auto: o.grid === 'auto', ag: ag, inp: inp, I: I, t0: performance.now(), infos: [],search:search,trialLog:[],candidates:[],seed:Date.now()>>>0,compareIndex:0 };
    var job = { type: 'run-charge-flipping', gridSize: grid, maxIterations: o.iterations, thresholdSigma: o.threshold, cell: I.cell, system: I.sg.system, hklList: inp.hklList,
                symops: I.symops, laueClass: rec ? rec.laue_class : null, centering: rec ? rec.centering : 'P', symLambda: I.symops ? o.symLambda : 0, overlapTolTth: o.overlapTol,
                applyLP: true, polarization: I.pol, minPeakSeparation: o.peakMerge, maxPeaks: 40, peakHeightCutoff: 0.04, weakFraction: o.weakFraction, weakGrouping: o.weakGrouping,overlapFwhmFraction:search?search.grouping.overlapFwhmFraction:0 };
    function trial() {
      try{run.current=search?search.trials[run.trial]:{threshold:o.threshold,weakFraction:o.weakFraction,symLambda:o.symLambda,seedSlot:run.trial};run.trial++;
        run.currentSeed=(run.seed+run.current.seedSlot*7919)>>>0;
        run.worker.postMessage(Object.assign({},job,{seed:run.currentSeed,thresholdSigma:run.current.threshold,weakFraction:run.current.weakFraction,symLambda:I.symops?run.current.symLambda:0}));
      }catch(e){finishCf(e.message);}
    }
    function logTrial(result,error){var c=run.current,entry={start:run.trial,seed:run.currentSeed,threshold:c.threshold,weakFraction:c.weakFraction,symLambda:I.symops?c.symLambda:0,bestR:result?result.bestR:null,backend:result?result.backend:null,error:error || null};run.trialLog.push(entry);return entry;}
    function compareNext(){
      while(run.compareIndex<run.candidates.length){var candidate=run.candidates[run.compareIndex];if(candidate.start===run.bestTrial){candidate.entry.mapCorrelation=1;run.compareIndex++;continue;}
        if(!candidate.map){run.compareIndex++;continue;}
        progress('cf',run.compareIndex/run.candidates.length,'comparing maps '+(run.compareIndex+1)+'/'+run.candidates.length);
        try{run.worker.postMessage({type:'compare-cf-maps',gridSize:grid,mapA:run.best.map,mapB:candidate.map});}catch(e){ui.log('CF map comparison: '+e.message,'warn');build();}return;
      }build();
    }
    function trialsDone(){if(search && run.best && run.candidates.length>1 && !run.stopped){run.stage='compare';compareNext();}else build();}
    function onMsg(e) {
      var m = e.data || {};
      if (run !== SV.cfRun) return;
      if (m.type === 'cf-progress') {
        var R = Number.isFinite(m.bestR) ? m.bestR : m.R;
        progress('cf', ((run.trial - 1) + m.iter / m.total) / o.trials, (o.trials > 1 ? 'start ' + run.trial + '/' + o.trials + ', ' : '') + 'cycle ' + m.iter + '/' + m.total + (Number.isFinite(R) ? ', R ' + R.toFixed(4) : ''));
      } else if(m.type==='cf-status'){
        progress('cf',-1,(o.trials>1?'start '+run.trial+'/'+o.trials+', ':'')+m.message);
      } else if (m.type === 'cf-info' || m.type === 'cf-wyckoff-start') {
        if (run.infos.indexOf(m.message) < 0) { run.infos.push(m.message); ui.log('Charge flipping: ' + m.message, 'info'); }
      } else if (m.type === 'cf-error') {
        if(search && run.stage==='flip'){logTrial(null,m.message);run.done=run.trial;ui.log('CF start '+run.trial+': '+m.message,'warn');if(run.trial<o.trials)trial();else if(run.best)trialsDone();else finishCf(m.message);}
        else if(run.stage==='compare'){ui.log('CF map comparison: '+m.message,'warn');run.compareIndex++;compareNext();}
        else finishCf(m.message);
      } else if (m.type === 'cf-result') {
        run.done = run.trial;
        var entry=logTrial(m.results);
        if (!run.best || m.results.bestR < run.best.bestR) { run.best = m.results; run.bestTrial = run.trial;run.bestOptions=Object.assign({},o,run.current); }
        if(search){
          run.candidates.push({start:run.trial,map:m.results.map,R:m.results.bestR,entry:entry});
          // Maps are grid³ floats; with up to 128 starts only the lowest-R ones are kept for the agreement check.
          var mapped=run.candidates.filter(function(c){return c.map;});
          if(mapped.length>CF_COMPARE_MAPS){var worst=mapped.reduce(function(a,c){return c.R>a.R?c:a;});worst.map=null;worst.entry.mapCorrelation=null;}
        }
        if (run.stopped || run.trial >= o.trials) trialsDone(); else trial();
      } else if(m.type==='cf-comparison'){
        var candidate=run.candidates[run.compareIndex];candidate.entry.mapCorrelation=m.results.correlation;candidate.map=null;run.compareIndex++;compareNext();
      } else if (m.type === 'cf-structure') {
        run.structure = m.results;
        finishCf(null);
      }
    }
    function onErr(ev) { if (run === SV.cfRun) finishCf('The charge-flipping worker crashed: ' + ((ev && ev.message) || 'unknown error')); }
    run.spawn = function () { run.worker = new Worker('js/charge_flipping_worker.js'); run.worker.onmessage = onMsg; run.worker.onerror = onErr; };
    W.onmessage = onMsg; W.onerror = onErr;
    // the map placed on the origin of the space group and its peaks reduced to the asymmetric unit
    function build() {
      if (!I.symops || !run.best) { finishCf(null); return; }
      run.stage = 'build';
      progress('cf', -1, 'origin and sites…');
      var map = Float32Array.from(run.best.map);
      try { run.worker.postMessage({ type: 'build-structure', map: map, gridSize: run.best.gridSize, symops: I.symops, wyckoffTable: (symopsFor(I.sg).setting || {}).wyckoff || [],
                               cell: run.best.cell, minPeakSeparation: o.peakMerge, maxPeaks: 60, peakHeightCutoff: 0.04, amplitudeCutoff: 0.05, originCandidates: 12,
                               hklList: inp.hklList, applyLP: true, polarization: I.pol, wavelength: I.lambda, radiation: I.radiation }, [map.buffer]); } catch(e) { finishCf(e.message); }
    }
    run.build = build;
    ui.log('Charge flipping of ' + I.phaseName + ': ' + plural(inp.hklList.length, 'intensity') + ', grid ' + grid + '³' + (run.auto ? ' (auto, largest index ' + ag.maxIndex + ')' : '') + ', ' +
           plural(o.trials, 'random start') + ' of ' + o.iterations + ' cycles, threshold ' + o.threshold + ' σ, symmetry ' + (I.symops ? o.symLambda : 'none') + '. ' + inp.note, 'info');
    if(search)ui.log('Adaptive CF: '+cfQualityText(search.quality)+' Seed '+run.seed+'. Three parameter settings; pairwise fitted-width overlap grouping.','info');
    St.setBusy(true,'Charge flipping…');
    progress('cf', -1, 'Preparing charge flipping…');
    syncRun();
    try { trial(); } catch(e) { finishCf(e.message); }
  }
  function stopCf() {
    var run = SV.cfRun;
    if (!run) return;
    if (run.stage === 'flip' || run.stage==='compare') {
      run.stopped = true;
      try { run.worker.terminate(); } catch (e) { /* gone */ }
      if (run.best) { try { run.spawn(); run.build(); } catch(e) { finishCf(e.message); } } else finishCf('Stopped before any random start finished.');
    } else finishCf(null);
  }
  function finishCf(err) {
    var run = SV.cfRun;
    if (!run) return;
    SV.cfRun = null;
    St.setBusy(false);
    try { run.worker.terminate(); } catch (e) { /* gone */ }
    progress('cf', 0);
    syncRun();
    var I = run.I, dt = ((performance.now() - run.t0) / 1000).toFixed(1);
    if (!run.best) {
      SV.cf = { error: err || 'No map.', stamp: I.stamp };
      ui.toast('Charge flipping: ' + (err || 'no map.'), run.stopped ? 'info' : 'err');
      renderCfOut();
      return;
    }
    var chosenOptions=run.bestOptions || run.o,snapTol = 0.6 * chosenOptions.peakMerge, pseudo = { ops: I.ops, wyckoff: I.wyckoff };
    var sites = (run.structure ? run.structure.sites : []).map(function (s) {
      var site = siteFor(pseudo, [s.x, s.y, s.z], I.cell, snapTol);
      return { rank: s.rank, x: site.pos[0], y: site.pos[1], z: site.pos[2], raw: [s.x, s.y, s.z], height: s.height, relative: s.relative, mult: site.mult, wyck: site.wyck, element: '', use: false };
    });
    SV.cf = { best: run.best, structure: run.structure, sites: sites, trials: run.o.trials, trialsDone: run.done, bestTrial: run.bestTrial,
              stopped: run.stopped, o: chosenOptions, grid: run.grid, auto: run.auto, ag: run.ag, note: run.inp.note, n: run.inp.hklList.length, I: I, stamp: I.stamp, err: err, seconds: dt,formula:SV.opts.formula,nameFromFormula:!!parseFormula(SV.opts.formula) };
    if(run.search)SV.cf.search=Object.assign({},run.search,{seed:run.seed,trials:run.trialLog,mapAgreementThreshold:.9,selectionRule:'Lowest CF R using the same observations and overlap groups'});
    var asg = assignCf();
    if(RV.fitHistory)RV.fitHistory.solution('cf',SV.cf);
    solutionSelection.cf = null; if (RV.layout && RV.layout.latestStructure) RV.layout.latestStructure('cf');
    var msg = 'Charge flipping of ' + I.phaseName + (run.stopped ? ' (stopped)' : '') + ': best R = ' + f(run.best.bestR, 4) + ' after ' + plural(SV.cf.trialsDone, 'random start') + ', ' + dt + ' s; ' +
              (run.structure ? plural(sites.length, 'site') + ', symmetry correlation ' + f(run.structure.symmetryCorrelation, 3) : 'no sites (' + (err || 'no symmetry to place the map on') + ')') +
              (asg ? '; ' + asg : '') + '.';
    ui.toast(msg, err || (SV.cf.unplaced || []).length ? 'warn' : 'ok');
    if (sites.length) SV.shown = 'cf';
    renderCfOut(); renderStOut();
  }
  // a position put on its site: snapped within tol (the images closer than that are one atom), letter from the table
  function siteFor(ph, xyz, cell, tol) {
    var snapped = C.siteSymmetry(ph.ops, xyz, cell, tol).pos.map(function (v) { v -= Math.floor(v); return Math.abs(v - 1) < 1e-9 ? 0 : v; });
    return St.siteOf(ph, snapped, cell);
  }
  // Farthest a peak is moved onto a special position when its element needs fewer atoms than the peak's own site holds.
  var CF_SNAP_MAX = 0.6;
  // The nearest position of multiplicity <= maxMult within CF_SNAP_MAX Å of the peak, not already taken: {site, shift} or null.
  function specialSiteFor(R, s, maxMult, taken) {
    var I = R.I, pseudo = { ops: I.ops, wyckoff: I.wyckoff }, G = metricTensor(I.cell), raw = s.raw || [s.x, s.y, s.z];
    function dist(a, b) { var d = [0, 1, 2].map(function (k) { var v = a[k] - b[k]; return v - Math.round(v); }); return fracDistance(G, d[0], d[1], d[2]); }
    // siteSymmetry compares a point with its images, which lie twice as far from it as the special position does
    for (var tol = 0.2; tol <= 2 * CF_SNAP_MAX + 1e-9; tol += 0.2) {
      var site;
      try { site = siteFor(pseudo, raw, I.cell, tol); } catch (e) { return null; }
      if (!(site.mult < s.mult) || site.mult > maxMult + 0.5) continue;
      var shift = dist(raw, site.pos);
      if (shift > CF_SNAP_MAX) return null;
      if (taken.some(function (p) { return dist(p, site.pos) < 0.3; })) return null;
      return { site: site, shift: shift };
    }
    return null;
  }
  /* Element types for the peaks from the formula unit: the strongest scatterer on the highest peaks, each element on as
     many atoms per cell as its count times Z asks (Z typed, or from the first peak: the heaviest atom on one site).
     A peak whose site holds more atoms than the element still needs is moved onto a nearby special position of small
     enough multiplicity (charge-flipping peaks of atoms on inversion centres or mirrors are rarely exactly on them);
     an element that still cannot be placed is named in the note. The peaks left over are kept, unticked.
     Returns a note, '' without a formula. */
  function assignCf(R,formula,z) {
    R=R || SV.cf;
    if (!R || !R.sites.length) return '';
    R.sites.forEach(function (s) { if (!s.base) s.base = { x: s.x, y: s.y, z: s.z, mult: s.mult, wyck: s.wyck }; else Object.assign(s, s.base); delete s.snapped; });
    var comp = parseFormula(formula==null?SV.opts.formula:formula);
    if (!comp) { R.sites.forEach(function (s) { s.use = s.relative >= 0.2; }); R.unplaced = []; return ''; }
    var rad = R.I.radiation, order = comp.slice().sort(function (a, b) { return power(b.el, rad) - power(a.el, rad); });
    var list = R.sites.slice().sort(function (a, b) { return b.height - a.height; }), Z = z===undefined?typedZ():z;
    list.forEach(function (s) { s.element = ''; s.use = false; });
    if (!Z) Z = list[0].mult / order[0].n;
    var missing = [], moved = [];
    function takenPositions() { return list.filter(function (s) { return s.use; }).map(function (s) { return [s.x, s.y, s.z]; }); }
    order.forEach(function (c) {
      var need = c.n * Z;
      list.forEach(function (s) {
        if (need <= 0.5 || s.element) return;
        if (s.mult > need + 0.5) {
          var snap = R.I.ops && R.I.wyckoff ? specialSiteFor(R, s, need, takenPositions()) : null;
          if (!snap) return;
          s.x = snap.site.pos[0]; s.y = snap.site.pos[1]; s.z = snap.site.pos[2]; s.mult = snap.site.mult; s.wyck = snap.site.wyck; s.snapped = snap.shift;
          moved.push(c.el + ' to ' + s.wyck + ' (' + snap.shift.toFixed(2) + ' Å)');
        }
        s.element = c.el; s.use = true; need -= s.mult;
      });
      if (need > 0.5) missing.push(c.el + ' (' + (+need.toFixed(2)) + ' of ' + (+(c.n * Z).toFixed(2)) + ' per cell)');
    });
    var light = order[order.length - 1].el, n = list.filter(function (s) { return s.use; }).length;
    list.forEach(function (s) { if (!s.element) s.element = light; });
    R.Z = Z; R.unplaced = missing;
    return 'elements of ' + comp.map(function (c) { return c.el + (c.n === 1 ? '' : c.n); }).join('') + ' on ' + plural(n, 'site') + ' (Z = ' + (+Z.toFixed(2)) + ')' +
      (moved.length ? '; moved onto special positions: ' + moved.join(', ') : '') +
      (missing.length ? '. NOT PLACED: ' + missing.join(', ') + ' — no peak within ' + CF_SNAP_MAX + ' Å of a free site of small enough multiplicity. Check Z, or place them by hand' : '');
  }

  // ---------------------------------------------------------------- 3b. the Wyckoff search
  function wyOptions() {
    var o = SV.opts.wy, pos = function (v) { var x = parseInt(String(v).trim(), 10); return Number.isFinite(x) && x >= 1 ? Math.min(24, x) : null; };
    var lo = readNum(o.rhoMin, 1, 22, true), hi = readNum(o.rhoMax, 1, 22, true);
    if (!Number.isFinite(lo)) lo = 2;
    if (!Number.isFinite(hi)) hi = 10;
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    if (lo === hi) { if (hi < 22) hi++; else lo--; }
    var mc = ui.parseNum(o.minContact);
    return { maxSites: pos(o.maxSites), maxRepeat: pos(o.maxRepeat), rhoMin: lo, rhoMax: hi, maxZ: readNum(o.maxZ, 1, 12, true) || 3,
             particles: readNum(o.particles,64,gpuBudget.maxParticles,true) || Math.max(64,Math.floor(gpuBudget.maxParticles/3)),
             iterations: readNum(o.iterations, 10, 10000, true) || 2000, restarts: readNum(o.restarts, 1, 10, true) || 4,
             minContact: Number.isFinite(mc) ? Math.min(4, Math.max(0, mc)) : undefined };
  }
  function runWy() {
    if (S.busy || SV.wyRun || SV.cfRun) return;
    var I = SV.ints, formula = String(SV.opts.formula || '').trim();
    if (!I) { ui.toast('Extract the intensities first.', 'warn'); return; }
    if (!formula) { ui.toast('The Wyckoff search needs the formula unit in Commands → Structure.', 'warn'); return; }
    var comp = parseFormula(formula);
    if (!comp) { ui.toast(formula + ' is not a formula this program can read.', 'warn'); return; }
    var got = symopsFor(I.sg);
    if (got.error) { ui.toast(got.error, 'err'); return; }
    if (!Array.isArray(got.setting.wyckoff) || !got.setting.wyckoff.length) { ui.toast('The space-group database has no Wyckoff positions for ' + I.sg.symbol + ': the search needs them.', 'err'); return; }
    var vc = validateConstraints(SV.opts.wy.constraints, formula);
    if (vc.errors.length) { ui.toast('Distance constraints: ' + vc.errors[0], 'warn'); renderWyStatus(); return; }
    var Z = typedZ();
    if (Z) {
      var rho = density(Z, comp);
      if (Number.isFinite(rho) && !(rho >= RHO_MIN && rho <= RHO_MAX)) { ui.toast('Z = ' + Z + ' gives ρ = ' + rho.toFixed(2) + ' g/cm³ for ' + formula + ' in this cell: no solid has that density. The search was not started.', 'warn'); return; }
    }
    var o = wyOptions(), inp = solveInput(I), W;
    try { W = new Worker('js/wyckoff_worker.js'); } catch (e) { ui.toast('Could not start js/wyckoff_worker.js: ' + e.message, 'err'); return; }
    var run = SV.wyRun = { worker: W, stopped: false, formula: formula, vc: vc, o: o, I: I, inp: inp, t0: performance.now(), log: [], partials: [], live: null };
    W.onmessage = function (e) {
      var m = e.data || {};
      if (run !== SV.wyRun) return;
      if (m.type === 'wy-error' || m.type === 'cf-error') finishWy(m.message);
      else if (m.type === 'wy-info' || m.type === 'cf-info') ui.log('Wyckoff search: ' + m.message, 'info');
      else if (m.type === 'wy-log') { run.log.push(m.message); ui.log('  ' + m.message, 'info'); }
      else if (m.type === 'wy-start' || m.type === 'cf-wyckoff-start') progress('wy', -1, zTag(m) + 'preparing…');
      else if (m.type === 'wy-partial') { if (m.solution) run.partials.push(m.solution); }
      else if (m.type === 'wy-refining') { var rl = 'Refining the best structure' + (Number.isFinite(m.z) ? ' (Z = ' + m.z + ')' : '') + '… please wait'; progress('wy', -1, rl); busyLabel(rl); }
      else if (m.type === 'wy-progress') {
        if (Array.isArray(m.bestSites) && m.bestSites.length && Number.isFinite(m.best))
          run.live = { z: m.z, assignment: m.assignment, best: m.best, cc: m.cc, sites: m.bestSites };
        var frac = (m.wave - 1 + (m.restart - 1 + m.generation / m.generations) / m.restarts) / m.waves;
        progress('wy', Number.isFinite(frac) ? frac : -1, zTag(m) + (m.waves > 1 ? 'wave ' + m.wave + '/' + m.waves + ', ' : '') + 'restart ' + m.restart + '/' + m.restarts + ', gen ' + m.generation + '/' + m.generations +
                 (Number.isFinite(m.best) ? ', wR2 ' + ((1 - m.best) * 100).toFixed(1) + ' %' : ''));
      } else if (m.type === 'wy-structure') { run.results = m.results; finishWy(null); }
    };
    W.onerror = function (ev) { if (run === SV.wyRun) finishWy('The Wyckoff worker crashed: ' + ((ev && ev.message) || 'unknown error')); };
    ui.log('Wyckoff search of ' + I.phaseName + ': ' + formula + ', ' + I.sg.symbol + ', ' + (Z ? 'Z = ' + Z : 'Z = Auto over ' + o.rhoMin + '–' + o.rhoMax + ' g/cm³') + ', ' +
           plural(inp.hklList.length, 'intensity') + ', ' + o.particles + ' particles, ' + o.iterations + ' iterations, ' + plural(o.restarts, 'restart') + '. ' + inp.note, 'info');
    vc.windows.forEach(function (w) { ui.log('  constraint: ' + describeConstraint(w), 'info'); });
    vc.warnings.forEach(function (w) { ui.log('  constraints: ' + w, 'warn'); });
    St.setBusy(true,'Wyckoff structure search…');
    try { W.postMessage({ type: 'wyckoff-search', cell: I.cell, profileParams: I.profile, profileType: I.profile.profileType, symops: got.symops, wyckoffTable: got.setting.wyckoff,
                    targetComposition: formula, wyckoffZ: Z, wyckoffMaxSites: o.maxSites, wyckoffMaxRepeat: o.maxRepeat, densityMin: o.rhoMin, densityMax: o.rhoMax,
                    maxZSearches: o.maxZ, swarmParticles: o.particles, swarmIterations: o.iterations, swarmRestarts: o.restarts, minContact: o.minContact,
                    distanceConstraints: vc.windows, hklList: inp.hklList, applyLP: true, polarization: I.pol, wavelength: I.lambda, radiation: I.radiation }); } catch(e) { finishWy(e.message); return; }
    progress('wy', -1, 'starting…');
    syncRun();
  }
  // The busy card is what the user looks at while the page is locked: it says what is happening now.
  function busyLabel(text) { if (!S.busy) return; S.busyLabel = text; var el = $('#busy-label'); if (el) el.textContent = text; }
  function zTag(m) { return m.zCount > 1 && Number.isFinite(m.z) ? 'Z = ' + m.z + ' (' + m.zIndex + '/' + m.zCount + '), ' : ''; }
  function stopWy() {
    var run = SV.wyRun;
    if (!run) return;
    if (!run.stopped) {
      // the worker keeps the best structure so far and returns it; a second Stop ends it without waiting
      run.stopped = true;
      try { run.worker.postMessage({ type: 'cancel-wyckoff' }); } catch (e) { /* gone */ }
      progress('wy', -1, 'stopping: refining the best structure so far… please wait');
      busyLabel('Stopping: refining the best structure so far… please wait');
      ui.toast('Stopping the Wyckoff search. The best structure found so far is being refined; please wait, this can take a little while. (Stop again only to end at once with the unrefined search positions.)', 'warn');
    } else finishWy('Stopped before the search returned its final result.');
  }
  // What the page already holds when the worker gives no final result: every Z it finished
  // (refined) and the best structure of the Z still running (search coordinates, not refined).
  function salvagedWy(run, why) {
    var sols = run.partials.slice(), live = run.live;
    if (live && !sols.some(function (s) { return s.z === live.z; }))
      sols.push({ z: live.z, assignment: live.assignment, searchCC: Number.isFinite(live.cc) ? live.cc : live.best, refinement: null, ranked: false, unrefined: true, stopped: true,
                  sites: live.sites.map(function (s) { return { element: s.element, wyckoff: s.wyckoff, multiplicity: s.multiplicity, siteSymmetry: s.siteSymmetry, x: s.x, y: s.y, z: s.z }; }) });
    if (!sols.length) return null;
    function merit(s) { var R = s.refinement && Number.isFinite(s.refinement.R) ? s.refinement.R : null; return R !== null ? [0, R] : [1, Number.isFinite(s.searchCC) ? -s.searchCC : Infinity]; }
    sols.sort(function (p, q) { var a = merit(p), b = merit(q); return (a[0] - b[0]) || (a[1] - b[1]); });
    var s0 = sols[0];
    return { sites: s0.sites, refinement: s0.refinement, z: s0.z, solutions: sols, stopped: true, salvaged: why || 'Stopped.',
             wyckoffResult: { assignment: s0.assignment, searchCC: s0.searchCC, ranked: s0.ranked }, distanceConstraints: run.vc ? run.vc.windows : [] };
  }
  function finishWy(err) {
    var run = SV.wyRun;
    if (!run) return;
    SV.wyRun = null;
    St.setBusy(false);
    try { run.worker.terminate(); } catch (e) { /* gone */ }
    progress('wy', 0);
    syncRun();
    var dt = ((performance.now() - run.t0) / 1000).toFixed(1), r = run.results;
    if (err || !r) {
      var kept = salvagedWy(run, err);
      if (kept) { r = kept; ui.log('Wyckoff search: ' + (err || 'no final result') + ' Kept the best structure already received (' + plural(kept.solutions.length, 'solution') + ').', 'warn'); err = null; }
    }
    if (err || !r) {
      SV.wy = { error: err || 'No structure.', stamp: run.I.stamp, log: run.log };
      ui.toast('Wyckoff search: ' + (err || 'no structure.'), run.stopped ? 'info' : 'err');
      renderWyOut();
      return;
    }
    var sols = Array.isArray(r.solutions) && r.solutions.length ? r.solutions : [{ z: r.z, sites: r.sites, refinement: r.refinement, assignment: (r.wyckoffResult || {}).assignment, searchCC: (r.wyckoffResult || {}).searchCC, ranked: (r.wyckoffResult || {}).ranked }];
    SV.wy = { results: r, sols: sols, pick: 0, formula: run.formula, vc: run.vc, o: run.o, I: run.I, stamp: run.I.stamp, stopped: !!r.stopped, salvaged: r.salvaged || null, seconds: dt, note: run.inp.note, n: run.inp.hklList.length, log: run.log };
    if(RV.fitHistory)RV.fitHistory.solution('wy',SV.wy);
    solutionSelection.wy = null; if (RV.layout && RV.layout.latestStructure) RV.layout.latestStructure('wy');
    var s0 = sols[0], R = s0.refinement && Number.isFinite(s0.refinement.R) ? s0.refinement.R : NaN;
    ui.toast('Wyckoff search of ' + run.I.phaseName + (r.stopped ? ' (stopped)' : '') + ': ' + (prettyAssign(s0.assignment) || '?') + (Number.isFinite(s0.z) ? ', Z = ' + s0.z : '') + (Number.isFinite(R) ? ', wR(F²) = ' + pct(R) : '') +
             (sols.length > 1 ? '; ' + sols.length + ' solutions, one per Z' : '') + ', ' + dt + ' s.', 'ok');
    SV.shown = 'wy';
    renderWyOut(); renderStOut();
  }

  // ---------------------------------------------------------------- 4. structures: shown, saved as CIF, exported to the phase
  // the structure of a source ('cf', 'wy') in the form of wyckoff_report.js, from the ticked sites
  function structureOf(src,cf) {
    var sites, I, label,R=cf || SV.cf;
    if (src === 'cf' && R && R.sites) {
      I = R.I;
      sites = R.sites.filter(function (s) { return s.use && s.element; }).map(function (s) { return { rank: s.rank, element: capEl(s.element), x: s.x, y: s.y, z: s.z, wyckoff: s.wyck, multiplicity: s.mult }; });
      label = 'charge flipping (R = ' + f(R.best.bestR, 4) + ')';
    } else if (src === 'wy' && SV.wy && SV.wy.sols) {
      I = SV.wy.I;
      var sol = SV.wy.sols[SV.wy.pick] || SV.wy.sols[0];
      sites = (sol.sites || []).map(function (s, i) { return { rank: i + 1, element: capEl(s.element), x: s.x, y: s.y, z: s.z, wyckoff: s.wyckoff || '', multiplicity: s.multiplicity }; });
      label = 'Wyckoff search' + (Number.isFinite(sol.z) ? ', Z = ' + sol.z : '') + (sol.refinement && Number.isFinite(sol.refinement.R) ? ' (wR(F²) = ' + pct(sol.refinement.R) + ')' : '');
    } else return null;
    if (!sites.length) return null;
    var got = symopsFor(I.sg);
    return { cell: I.cell, sites: sites, spaceGroup: { number: I.sg.number, symbol: I.sg.symbol, hall: I.sg.hall }, opMatrices: got.error ? null : got.symops,
             symops: got.error ? [] : got.symops.map(function (o) { return o.xyz; }).filter(Boolean), source: src === 'cf' ? 'charge-flipping' : 'wyckoff', label: label, I: I,
             z: src === 'wy' ? (SV.wy.sols[SV.wy.pick] || {}).z : (R.Z || null), formula: SV.opts.formula };
  }
  function show(src) {
    if(RV.layout)RV.layout.structureResult(src);
    var st = structureOf(src);
    if (!st) { ui.toast(src === 'cf' ? 'Tick at least one site with an element type.' : 'No structure from the Wyckoff search yet.', 'warn'); return; }
    SV.shown = src;
    RV.acc.open('wppf-' + src); RV.acc.open(src + '-struct');
    renderStruct(src);
    var host = $('#sv-' + src + '-st'); if (host && host.scrollIntoView) host.scrollIntoView({ block: 'nearest' });
  }
  function saveCif(src) {
    var st = structureOf(src);
    if (!st) { ui.toast('No structure to save.', 'warn'); return; }
    var c = st.cell, sg = st.spaceGroup, wy = src === 'wy', L = [];
    L.push(wy ? 'data_wyckoff_solution' : 'data_charge_flipping_solution');
    L.push("_audit_creation_method        'Powder 6 " + (wy ? 'Wyckoff direct-space search' : 'charge flipping') + "'");
    ['a', 'b', 'c'].forEach(function (k) { L.push('_cell_length_' + k + '                ' + c[k].toFixed(5)); });
    ['alpha', 'beta', 'gamma'].forEach(function (k) { L.push('_cell_angle_' + k + (k === 'beta' ? ' ' : '') + '            ' + c[k].toFixed(4)); });
    L.push('_space_group_IT_number        ' + sg.number, "_space_group_name_H-M_alt     '" + sg.symbol + "'");
    if (sg.hall) L.push("_space_group_name_Hall        '" + sg.hall + "'");
    L.push('');
    if (st.symops.length) { L.push('loop_', '_space_group_symop_operation_xyz'); st.symops.forEach(function (op) { L.push("  '" + op + "'"); }); L.push(''); }
    if (st.formula) L.push("_chemical_formula_sum         '" + st.formula + "'");
    if (Number.isFinite(st.z)) L.push('_cell_formula_units_Z         ' + (+st.z.toFixed(3)));
    L.push('# ' + (wy ? 'Direct-space Wyckoff search against WPPF intensities; element types are an input.' : 'Peak heights on an arbitrary scale; element types assigned from the formula unit, check them.'));
    L.push('# Occupancies are 1 and were not refined. Phase ' + st.I.phaseName + ', dataset ' + st.I.dsName + ', extracted ' + st.I.stamp + '.', '');
    L.push('loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y', '_atom_site_fract_z', '_atom_site_symmetry_multiplicity', '_atom_site_Wyckoff_symbol', '_atom_site_occupancy');
    var n = {};
    st.sites.forEach(function (s) {
      n[s.element] = (n[s.element] || 0) + 1;
      L.push('  ' + s.element + n[s.element] + '  ' + s.element + '  ' + s.x.toFixed(5) + '  ' + s.y.toFixed(5) + '  ' + s.z.toFixed(5) + '  ' + (Number.isFinite(s.multiplicity) ? s.multiplicity : '?') + '  ' +
             (String(s.wyckoff || '').replace(/^\d+/, '') || '?') + '  1.000');
    });
    ui.download((wy ? 'wyckoff_structure_' : 'charge_flipping_structure_') + ui.fileStamp() + '.cif', L.join('\n') + '\n', 'chemical/x-cif');
    ui.toast('Saved the ' + plural(st.sites.length, 'site') + ' of the ' + (wy ? 'Wyckoff search' : 'charge-flipping solution') + ' as a CIF.', 'ok');
  }
  // the sites replace the atoms of the phase, in every dataset; optionally the phase goes to Rietveld
  async function exportTo(src) {
    var cf=SV.cf,namingFormula;
    if(src==='cf' && cf && cf.nameFromFormula){
      // Transfer uses the current command inputs, including when inspecting an older result.
      namingFormula=$('#sv-formula-cf').value.trim();
      if(!parseFormula(namingFormula)){ui.toast('Give a valid formula unit in Commands → Structure, or uncheck Name them from the formula to keep the edited element types.','warn');return;}
      cf=Object.assign({},cf,{sites:cf.sites.filter(function(s){return s.use;}).map(function(s){return Object.assign({},s);})});
      assignCf(cf,namingFormula,typedZ($('#sv-z-cf').value));
      // Naming is a transfer option. Preserve the selected sites and the saved result.
      cf.sites.forEach(function(s){s.use=true;});
    }
    var st = structureOf(src,cf);
    if(st && namingFormula)st.formula=namingFormula;
    if (!st) { ui.toast(src === 'cf' ? 'Tick at least one site with an element type.' : 'No structure to export.', 'warn'); return; }
    var ph = St.phaseByKey(st.I.phaseKey);
    if (!ph) { ui.toast('The phase ' + st.I.phaseName + ' of this solution is gone.', 'warn'); return; }
    if (ph.sg.hall !== st.I.sg.hall) { ui.toast('The space group of ' + ph.name + ' is ' + ph.sg.symbol + ' now; this solution is in ' + st.I.sg.symbol + '. Set it back (Phases) to export the sites.', 'warn'); return; }
    if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    var bad = st.sites.filter(function (s) { return S.tables && !St.scatterer(s.element).xray; }).map(function (s) { return s.element; });
    var targets = S.phases.filter(function (p) { return p.sg.hall === st.I.sg.hall; });
    var transferFields = [
      { key: 'target', label: 'Destination', type: 'select', value: ph.key, options: targets.map(function (p) { return [p.key, 'Attach to ' + p.name]; }).concat([['new', 'Create a new phase']]) },
      { key: 'name', label: 'New phase name', type: 'text', value: ph.name + ' solved', when: 'target:new' },
      { key: 'B', label: 'B (Å²) of every atom', type: 'number', value: 0.5, hint: 'The solution gives positions only; refine B in the Rietveld fit.' },
      { key: 'riet', label: 'Open Rietveld setup after transfer', type: 'checkbox', value: true, hint: 'Review refinement choices in Commands → Datasets, then press FIT.' }
    ];
    if(RV.workspace)transferFields.splice(2,0,Object.assign(RV.workspace.targetField('Assign new phase to'),{when:'target:new'}));
    var res = await ui.prompt('Copy solution to phase',transferFields,'Copy atoms','Source: <b>'+esc(st.label)+'</b> · '+esc(st.I.phaseName)+' · '+esc(st.I.dsName)+'. '+plural(st.sites.length,'site')+'. Replacing an existing phase updates its atomic model in every dataset using it; obsolete atomic constraints are removed. Creating a new phase keeps the source model. The original solution remains in History.'+(bad.length ? ' <span class="warn">Not in the X-ray table: ' + esc(bad.join(', ')) + '.</span>' : ''),{
      after:'<p class="hint" data-transfer-impact></p>',onOpen:function(body){function impact(){var choice=body.querySelector('[data-key="target"]').value,dest=St.phaseByKey(choice),ds=dest?St.holdersOf(dest):RV.workspace?RV.workspace.targets(body.querySelector('[data-key="targets"]').value):[];body.querySelector('[data-transfer-impact]').textContent='Affected datasets: '+ds.length+' · '+ds.map(function(d){return d.name;}).join(', ');}body.addEventListener('change',impact);impact();}
    });
    if (!res) return;
    if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    var B = Number.isFinite(res.B) ? res.B : 0.5, cnt = {};
    var atoms = st.sites.map(function (s) {
      var el = capEl(s.element);
      cnt[el] = (cnt[el] || 0) + 1;
      return { label: el + cnt[el], type: el, x: s.x, y: s.y, z: s.z, occ: 1, B: B };
    });
    RV.history.take('atoms of ' + ph.name + ' from the ' + (src === 'cf' ? 'charge-flipping solution' : 'Wyckoff search'));
    if (res.target === 'new') {
      var sg = St.resolveSG(st.I.sg.number, st.I.sg.hall);
      ph = St.makePhase({ name: res.name.trim() || ph.name + ' solved', sg: sg, cell: st.I.cell, atoms: atoms, method: 'wppf' });
      St.addPhase(ph, RV.workspace?RV.workspace.targets(res.targets).map(function(d){return d.id;}):st.I.dsId ? [st.I.dsId] : undefined);
    } else {
      ph = St.phaseByKey(res.target);
      if (!ph || ph.sg.hall !== st.I.sg.hall) { ui.toast('Destination phase no longer matches the solution space group.', 'warn'); return; }
      St.replaceAtoms(ph, atoms, st.I.cell);
    }
    ph.provenance={kind:st.source,label:st.label,dataset:st.I.dsName,sourceDatasetId:st.I.dsId,sourcePhase:st.I.phaseKey,time:new Date().toISOString()};
    var toR = false;
    if (res.riet) {
      RV.app.calculation('rietveld', true);
      toR = St.setMethod(ph, 'rietveld') || ph.method === 'rietveld';
    }
    St.selectPhase(ph.key);
    ui.toast(ph.name + ': ' + plural(atoms.length, 'atom') + ' from the ' + st.label + (toR ? '; fitted by Rietveld now, scales estimated. Tick its scale and then the atoms (Solve, steps 1 and 4) and fit.' : '.'), 'ok');
    RV.app.showTab(res.riet?'method':'phases');
  }

  // ---------------------------------------------------------------- SHELX .hkl of the extracted intensities
  function hklWhy() {
    if(S.busy)return 'Wait for the current calculation to finish.';
    if(S.calculation!=='wppf')return 'Select WPPF to export extracted intensities.';
    pickDefaults();
    if(!SV.ints)return 'Fit by WPPF and extract the intensities first.';
    var why=staleNote();if(why)return why;
    if(!St.selected().some(function(d){return d.id===SV.ints.dsId;}))return 'Select the dataset of the extracted intensities.';
    return '';
  }
  function saveHkl(source) {
    var why=source?'':hklWhy();if(why){ui.toast(why,'warn');return;}
    var I = source || SV.ints;
    if (!I) { ui.toast('Extract the intensities first.', 'warn'); return; }
    var rows = I.det.map(function (r) { var w = r.m * r.lp; return { h: r.h, k: r.k, l: r.l, F2: Math.max(0, r.area) / w, s: r.sigma / w }; }).filter(function (r) { return Number.isFinite(r.F2) && r.s > 0; });
    var mx = rows.reduce(function (m, r) { return Math.max(m, r.F2); }, 0), k = mx > 0 ? 99999 / mx : 1;
    function i4(v) { var s = String(v); return '    '.slice(s.length) + s; }
    // F8.2 holds 99999.99 at most: the sigma of a reflection exactly overlapped by another (only their sum is known) is capped there
    function f8(v) { var s = Math.min(v, 99999.99).toFixed(2); return s.length >= 8 ? s : '        '.slice(s.length) + s; }
    var L = rows.map(function (r) { return i4(r.h) + i4(r.k) + i4(r.l) + f8(r.F2 * k) + f8(r.s * k); });
    L.push(i4(0) + i4(0) + i4(0) + f8(0) + f8(0));
    ui.download(I.phaseName.replace(/[^\w-]+/g, '_') + '_' + ui.fileStamp() + '.hkl', L.join('\n') + '\n');
    ui.toast('Saved ' + plural(rows.length, 'reflection') + ' of ' + I.phaseName + ' as SHELX HKLF 4: F² = I/(m·Lp) and σ, scaled to ' + (k !== 1 ? 'a largest F² of 99999' : 'their values') + '; reflections that overlap keep the split of the WPPF fit.', 'ok');
  }

  // ---------------------------------------------------------------- running state and progress
  function running() { return !!(SV.cfRun || SV.wyRun); }
  function stop() { stopCf(); stopWy(); }
  function syncRun() {
    var t = document.getElementById('tab-structure');
    if (t) t.classList.toggle('running', running());
    ['cf', 'wy'].forEach(function (k) {
      var on = !!SV[k + 'Run'], go = $('#sv-' + k + '-run');
      if (go) go.hidden = on;
    });
    if (RV.cmd && RV.cmd.syncButtons) RV.cmd.syncButtons();
  }
  var progState = { cf: null, wy: null };
  function progress(k, frac, label) {
    progState[k] = frac === 0 && !label ? null : { frac: frac, label: label || '' };
    paintProgress(k);
  }
  function paintProgress(k) {
    var s = progState[k];
    if(s && SV[k+'Run'])ui.busyProgress(s.frac,(k==='cf'?'Charge flipping: ':'Wyckoff search: ')+s.label);
    var p = $('#sv-' + k + '-prog');
    if (!p) return;
    p.hidden = !s;
    if (!s) return;
    p.classList.toggle('indet', s.frac < 0);
    p.querySelector('i').style.width = s.frac >= 0 ? (100 * Math.min(1, s.frac)).toFixed(1) + '%' : '';
    p.querySelector('span').textContent = s.label;
  }

  // ---------------------------------------------------------------- rendering
  var dirty = true;
  function field(id, label, value, hint, attrs) {
    return '<label for="' + id + '">' + label + '</label><div><input id="' + id + '" ' + attrs + ' value="' + esc(value) + '" autocomplete="off" spellcheck="false">' + (hint ? '<small>' + hint + '</small>' : '') + '</div>';
  }
  function select(id, label, value, options, hint, attrs) {
    return '<label for="' + id + '">' + label + '</label><div><select id="' + id + '" ' + attrs + '>' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>' + (hint ? '<small>' + hint + '</small>' : '') + '</div>';
  }
  function render() {
    clearEmptyComposition();
    var host = $('#solve');
    if (!host) return;
    dirty = false;
    pickDefaults();
    if (!S.sgReady) { host.innerHTML = '<div class="empty-pane"><p>' + (S.sgLoading ? 'Loading the space-group database…' : 'The space-group database is not loaded: open index.html through a web server.') + '</p></div>'; return; }
    if (!S.phases.length) { host.innerHTML = '<div class="empty-pane"><p>No phase yet.</p><p class="hint">Make a phase from its space group and cell (Phases, New phase), fit it by WPPF, then solve its structure here.</p></div>'; return; }
    var o = SV.opts, acc = RV.acc ? RV.acc.attr : function (k, d) { return d ? ' open' : ''; };
    function block(key, title, body, dflt, sub, cls) {
      return '<details class="acc' + (cls ? ' ' + cls : '') + '" data-acc="' + key + '"' + acc(key, dflt) + '><summary><span class="acc-t">' + title + '</span>' + (sub != null ? '<span class="acc-s" ' + sub + '></span>' : '') + '</summary><div class="acc-body">' + body + '</div></details>';
    }
    // the results of the WPPF calculation (rv_results.js fills these hosts), under each solution method
    function resultBlocks(k, withAtoms) {
      return block(k + '-results', 'Results and quantitative analysis', '<div data-res-part="summary"></div>', false, 'data-res-title="summary"', 'sub') +
        (withAtoms ? block(k + '-atoms', '<span data-res-title="atoms">Atoms</span>', '<div data-res-part="atoms"></div>', false, null, 'sub') : '') +
        block(k + '-ints', '<span data-res-title="refl">Intensities</span>', '<div data-res-part="refl"></div>', false, null, 'sub');
    }
    // the formula unit is one value, shown in both methods that use it, each saying what it does with it
    var FORMULA_USE = {
      cf: 'Charge flipping uses the formula unit and Z only to name its peaks: the strongest scatterer goes on the highest peaks, each element on count × Z atoms per cell. The map itself does not depend on them. The Wyckoff search below uses the same values.',
      wy: 'The Wyckoff search places these atoms and no others: count × Z of each element per cell, on the Wyckoff positions of the space group. Z = Auto tries every Z with a plausible density. Charge flipping above uses the same values to name its peaks.'
    };
    function formulaRow(k) {
      return '<div class="sv-row"><label class="sv-lbl" for="sv-formula-' + k + '">Formula unit</label><input id="sv-formula-' + k + '" class="sv-formula" data-opt="formula" value="' + esc(o.formula) + '" placeholder="e.g. PbSO4" spellcheck="false" autocomplete="off">' +
        '<label class="sv-lbl" for="sv-z-' + k + '">Z</label><input id="sv-z-' + k + '" class="num sv-z" data-opt="z" value="' + esc(o.z) + '" placeholder="Auto" inputmode="numeric" autocomplete="off">' +
        '<span class="hint sv-dens" data-k="' + k + '"></span></div><p class="hint sv-shared">' + esc(FORMULA_USE[k]) + '</p>';
    }
    function structBlock(k) {
      return block(k + '-struct', '3D structure', '<div class="sv-st-head" id="sv-' + k + '-st-head"></div><div class="sv-struct sv-struct-host" id="sv-' + k + '-st" data-src="' + k + '"></div>', false, null, 'sub');
    }
    host.innerHTML =
      '<p class="hint">'+esc(gpuBudget.note)+'</p>' +
      // the intensities everything below starts from; the source row only when there is a choice of phase
      '<div class="sv-bar">' +
        '<div class="sv-row" id="sv-extract-source"><span class="sv-lbl">Phase</span><div class="phase-chips" id="sv-phases"></div>' +
          '<label class="sv-lbl" for="sv-ds">in</label><select id="sv-ds" aria-label="Dataset"></select>' +
          '<button type="button" class="primary" id="sv-extract" data-sv="extract" title="The WPPF intensities of the phase in this dataset at its current values, with their uncertainties">Extract intensities</button>' +
          '<span id="sv-switch"></span><span class="tool-gap"></span>' +
          '</div>' +
        '<p class="hint" id="sv-fit-status"></p><div class="sv-int" id="sv-int"></div>' +
      '</div>' +
      block('wppf-sgt', 'Space group',
        block('sgt-test', 'Test · powder intensities',
        '<p class="hint">The probability of each set of systematic absences of the Laue class, from the WPPF intensities and their full correlation (Markvardsen, David, Johnson and Shankland 2001). For a complete test, fit in the space group of the Laue class with no absences (P2/m, Pmmm, P4/mmm, Pm-3m …): a reflection the WPPF fit did not contain was never measured.</p>' +
        '<p class="buttons sv-actions"><button type="button" class="primary" data-sv="sgt">Test the space groups</button>' +
          '<label class="sv-inline" for="sv-sgtn">Number of reflections</label><input id="sv-sgtn" type="number" min="4" step="1" class="num sv-short" data-opt="sgtN" inputmode="numeric" aria-describedby="sv-sgtn-note" title="Whole number of lowest-angle determined intensities to test"></p><p class="hint" id="sv-sgtn-note"></p>' +
        '<div id="sv-sgt-out"></div>', true, null, 'sub') +
        block('sgt-addsym', 'ADDSYM · atomic model',
          '<p class="hint">Find symmetry present in the atomic positions, then preview conversion to the detected space group. This uses the starting model or a dataset’s Rietveld positions and does not require WPPF intensities.</p>' +
          '<div class="form-grid sv-form">'+select('sv-sym-phase','Phase',St.currentPhase() && St.currentPhase().key,S.phases.map(function(p){return [p.key,p.name+' · '+St.sgText(p.sg)];}),'Choose a phase with atoms.','')+'</div>' +
          '<p class="buttons sv-actions"><button type="button" class="primary" id="sv-addsym" data-sv="find-symmetry" title="Find higher symmetry of the selected atomic model">Find higher symmetry…</button></p>',true,null,'sub'), true) +
      block('wppf-cf', 'Charge flipping',
          formulaRow('cf') +
          '<p class="hint">Charge flipping (Oszlányi and Sütő 2004) on the extracted intensities, in the worker of powder5: GPU where there is one. The peaks of the map, put on the origin of the space group and reduced to the asymmetric unit, become sites; the formula unit names them.</p>' +
          '<p><label class="chk"><input type="checkbox" id="sv-cf-adaptive" data-cf="adaptive"'+(o.cf.adaptive?' checked':'')+'> Adapt search to data quality</label></p>' +
          '<div class="form-grid sv-form">' +
            select('sv-cf-grid', 'Grid', o.cf.grid, [['auto', 'Auto'], ['32', '32³'], ['64', '64³'], ['128', '128³']], 'Points per axis; Auto: the smallest power of two that holds every reflection.', 'data-cf="grid"') +
            field('sv-cf-threshold', 'Threshold δ (σ)', o.cf.threshold, 'Density below δ, in standard deviations of the map, is flipped.', 'class="num" data-cf="threshold" inputmode="decimal"') +
            field('sv-cf-iterations', 'Cycles', o.cf.iterations, '', 'class="num" data-cf="iterations" inputmode="numeric"') +
            field('sv-cf-trials', 'Random starts', o.cf.trials, 'The best R is kept. 1–128 starts; adaptive mode uses 6–128 starts across three settings.', 'class="num" data-cf="trials" inputmode="numeric"') +
            field('sv-cf-symLambda', 'Symmetry in the loop', o.cf.symLambda, '0: none (P1), 1: strict.', 'class="num" data-cf="symLambda" inputmode="decimal"') +
            field('sv-cf-weakFraction', 'Weak reflections', o.cf.weakFraction, 'Fraction (0–0.33) of the weakest whose phase is shifted by π/2 instead (Oszlányi and Sütő 2005).', 'class="num" data-cf="weakFraction" inputmode="decimal"') +
            select('sv-cf-weakGrouping', 'Weak, by', o.cf.weakGrouping, [['cluster', 'overlap cluster'], ['individual', 'reflection']], '', 'data-cf="weakGrouping"') +
            field('sv-cf-overlapTol', 'Overlap (° 2θ)', o.cf.overlapTol, 'Reflections closer than this are one observation: their sum is kept, the split is free.', 'class="num" data-cf="overlapTol" inputmode="decimal"') +
            field('sv-cf-peakMerge', 'Peak merge (Å)', o.cf.peakMerge, 'Peaks closer than this are one site.', 'class="num" data-cf="peakMerge" inputmode="decimal"') +
          '</div>' +
          '<div id="sv-cf-quality"></div>' +
          '<p class="buttons sv-actions"><button type="button" class="primary" id="sv-cf-run" data-sv="cf-run">Run charge flipping</button></p>' +
          '<div class="progress sv-prog" id="sv-cf-prog" hidden><div class="track"><i></i></div><span></span></div>' +
          '<div id="sv-cf-out"></div>' +
        block('cf-density', '3D density',
          '<p class="hint" id="sv-cf-density-none">Run charge flipping to see its electron density.</p>' +
          '<section class="cf-density" id="sv-cf-density" hidden>' +
          '<div class="buttons"><label>Isosurface / σ <input class="num" id="sv-density-level" type="number" min="0.2" max="20" step="0.2" value="'+o.cf.densityLevel+'" aria-label="Density isosurface in sigma"></label>' +
          '<label>Grid stride <select id="sv-density-stride"><option value="1">Full resolution</option><option value="2">Every 2nd voxel</option><option value="4">Every 4th voxel</option></select></label>' +
          '<label class="chk"><input type="checkbox" id="sv-density-cell"'+(o.cf.densityCell?' checked':'')+'> Unit cell</label>' +
          '<label class="chk"><input type="checkbox" id="sv-density-sites"'+(o.cf.densitySites?' checked':'')+'> Sites</label>' +
          '<button type="button" data-sv="density-reset">Reset view</button><button type="button" data-sv="density-png">Save PNG</button><button type="button" data-sv="density-map">Save map</button></div>' +
          '<canvas id="sv-density-canvas" aria-label="Charge-flipping electron-density isosurface. Drag to rotate and wheel to zoom."></canvas><p class="hint" id="sv-density-note"></p></section>', false, null, 'sub') +
        block('cf-sites', 'Sites', '<div id="sv-cf-sites"></div>', true, 'id="sv-cf-sites-n"', 'sub') +
        structBlock('cf') +
        resultBlocks('cf', false), false, 'id="sv-cf-sum"') +
      block('wppf-wy', 'Wyckoff search',
          formulaRow('wy') +
          '<p class="hint">Atoms of the formula unit on the Wyckoff positions of the space group, fitted to the extracted intensities directly (|F<sub>calc</sub>|² against them, weighted by 1/σ²): the search of powder5, in its worker. It needs WebGPU.</p>' +
          '<div class="form-grid sv-form">' +
            field('sv-wy-maxSites', 'Sites per element, at most', o.wy.maxSites, 'Blank: Auto.', 'class="num" data-wy="maxSites" placeholder="Auto" inputmode="numeric"') +
            field('sv-wy-maxRepeat', 'Atoms per position, at most', o.wy.maxRepeat, 'Independent atoms on one Wyckoff position at different coordinates; blank: Auto.', 'class="num" data-wy="maxRepeat" placeholder="Auto" inputmode="numeric"') +
            '<label for="sv-wy-rhoMin">Density (g/cm³)</label><div><span class="sv-range"><input id="sv-wy-rhoMin" class="num" data-wy="rhoMin" value="' + esc(o.wy.rhoMin) + '" inputmode="numeric" aria-label="Lowest density"> to ' +
              '<input id="sv-wy-rhoMax" class="num" data-wy="rhoMax" value="' + esc(o.wy.rhoMax) + '" inputmode="numeric" aria-label="Highest density"></span><small>With Z on Auto, every Z with a density in this window is searched.</small></div>' +
            field('sv-wy-maxZ', 'Values of Z, at most', o.wy.maxZ, 'The least plausible are left out first.', 'class="num" data-wy="maxZ" inputmode="numeric"') +
            field('sv-wy-particles', 'Particles', o.wy.particles, 'Trial structures held at once (64–'+gpuBudget.maxParticles+'). Default is 33% of the conservative hardware budget.', 'class="num" data-wy="particles" inputmode="numeric"') +
            field('sv-wy-iterations', 'Iterations', o.wy.iterations, '10–10000.', 'class="num" data-wy="iterations" inputmode="numeric"') +
            field('sv-wy-restarts', 'Restarts', o.wy.restarts, '', 'class="num" data-wy="restarts" inputmode="numeric"') +
            field('sv-wy-minContact', 'Shortest contact (Å)', o.wy.minContact, 'A structure with two unlike atoms closer than this is rejected.', 'class="num" data-wy="minContact" inputmode="decimal"') +
            '<label for="sv-wy-constraints">Distance constraints</label><div><textarea id="sv-wy-constraints" data-wy="constraints" rows="3" spellcheck="false" placeholder="S O 4 1.35/1.65">' + esc(o.wy.constraints) + '</textarea>' +
              '<small>One per line: <code>A B N dmin/dmax</code> (N neighbours of B around each A), <code>A B - dmin/</code> for a floor.</small><div class="sv-cstat" id="sv-wy-cstat"></div></div>' +
          '</div>' +
          '<p class="buttons sv-actions"><button type="button" class="primary" id="sv-wy-run" data-sv="wy-run">Run the Wyckoff search</button></p>' +
          '<div class="progress sv-prog" id="sv-wy-prog" hidden><div class="track"><i></i></div><span></span></div>' +
        block('wy-solution', 'Solution', '<div id="sv-wy-sol"></div>', true, null, 'sub') +
        block('wy-sites', 'Sites', '<div id="sv-wy-sites"></div>', true, null, 'sub') +
        structBlock('wy') +
        resultBlocks('wy', true), false, 'id="sv-wy-sum"') +
      '<datalist id="sv-el-list"></datalist>';
    if(RV.layout)RV.layout.splitStructure(host);
    renderBar(); renderInt(); renderDensity(); renderSgtOut(); renderCfOut(); renderWyOut(); renderWyStatus(); renderStOut();
    paintProgress('cf'); paintProgress('wy'); syncRun();
    if (RV.results && RV.results.fill) RV.results.fill();
  }
  function renderBar() {
    var chips = $('#sv-phases'), sel = $('#sv-ds');
    if (!chips) return;
    chips.innerHTML = S.phases.map(function (ph, i) {
      return '<button type="button" class="chip" data-svph="' + ph.key + '" aria-pressed="' + (ph.key === SV.phaseKey) + '" title="' + esc(ph.name + ', ' + St.sgText(ph.sg) + ', ' + C.METHOD_LABELS[ph.method]) + '">' +
             '<i class="sw" style="background:' + RV.plots.phaseVar(i) + '"></i>' + esc(ph.name) + (ph.method === 'wppf' ? '' : ' <small>' + esc(C.METHOD_LABELS[ph.method]) + '</small>') + '</button>';
    }).join('');
    var source=$('#sv-extract-source');if(source)source.hidden=S.phases.length===1;
    var ph = phase(), sw = $('#sv-switch'), held = S.datasets.filter(function (d) { return !ph || St.hasPhase(d, ph); });
    sel.innerHTML = held.length ? held.map(function (d) { return '<option value="' + d.id + '"' + (d.id === SV.dsId ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') : '<option value="">' + (S.datasets.length ? 'not in any dataset' : 'no dataset') + '</option>';
    sw.innerHTML = ph && ph.method !== 'wppf' ? '<button type="button" data-sv="to-wppf" title="Fit ' + esc(ph.name) + ' by WPPF: its intensities become free variables of the fit">Fit ' + esc(ph.name) + ' by WPPF</button>' : '';
    var why = extractWhy(ph, dataset()), status = $('#sv-fit-status');
    ui.able($('#sv-extract'), why);
    if (status) status.textContent = (S.phases.length===1 ? 'Single-phase WPPF: intensities are extracted automatically after fitting; the source follows the first selected dataset. ' : '') + (why || ('Current WPPF fit: ' + dataset().stats.msg + '. ' +
      (/^converged/.test(dataset().stats.msg || '') ? 'Ready to extract intensities.' : 'Check the fit and convergence before using extracted intensities.')));
    var els = parseFormula(SV.opts.formula), dl = $('#sv-el-list');
    if (dl) dl.innerHTML = (els || []).map(function (c) { return '<option value="' + c.el + '">'; }).join('');
    syncSgtCount();renderCfPlan();syncAble();
  }
  // what the buttons of the methods need, as the reason they are greyed
  function syncAble() {
    var I = SV.ints, none = 'Extract the intensities first.';

    ui.able(document.querySelector('#solve [data-sv="sgt"]'), S.busy?'Calculation running.':sgtCountIssue() || (!I || !I.pre || !I.pre.n?'The extraction holds no precision block.':''));
    ui.able($('#sv-cf-run'), S.busy?'Calculation running.':!I?none:cfOptions().error || '');
    ui.able($('#sv-wy-run'), !I ? none : !parseFormula(SV.opts.formula) ? 'Give the formula unit in Commands → Structure.' : '');
    syncSymmetry();
  }
  function syncSymmetry(){
    var select=$('#sv-sym-phase'),ph=select && St.phaseByKey(select.value);
    ui.able($('#sv-addsym'),S.busy?'Calculation running.':!ph?'Select a phase.':!ph.atoms.length?'This phase has no atoms; ADDSYM needs an atomic model.':'');
  }
  function renderInt() {
    var el = $('#sv-int');
    if (!el) return;
    var I = SV.ints, ph = phase();
    if (!I || I.phaseKey !== SV.phaseKey) {
      el.innerHTML = '<p class="hint">' + (!ph ? '' : ph.method !== 'wppf' ? esc(ph.name) + ' is fitted by ' + esc(C.METHOD_LABELS[ph.method]) + '. Structure solution starts from the intensities of a WPPF phase: switch Method to WPPF, fit (zero, cell and peak shape ticked), then extract them.'
        : 'Fit ' + esc(ph.name) + ' by WPPF (zero, cell and peak shape ticked), then extract its intensities: the space-group test, charge flipping and the Wyckoff search start from them.' + (I ? ' The last extraction is of ' + esc(I.phaseName) + '.' : '')) + '</p>';
      return;
    }
    var det = I.det, n0 = det.filter(function (r) { return r.bound; }).length, nOv = det.filter(function (r) { return r.group >= 0; }).length, strong = det.filter(function (r) { return r.sigma > 0 && r.area > 3 * r.sigma; }).length;
    var lo = det.length ? det[0].tth : NaN, hi = det.length ? det[det.length - 1].tth : NaN, why = staleNote();
    el.innerHTML = '<p><b>' + plural(det.length, 'intensity') + '</b> of ' + esc(I.phaseName) + ' (' + esc(I.sg.symbol) + ') in ' + esc(I.dsName) + ', 2θ ' + f(lo, 2) + '–' + f(hi, 2) + '°: ' + strong + ' above 3σ, ' + n0 + ' held at zero, ' + nOv + ' in exact overlaps. ' +
      'R<sub>wp</sub> ' + pct(I.Rwp) + ', χ² ' + ui.fmt(I.chi2, 4) + '; σ ' + (I.nVar ? 'with the ' + plural(I.nVar, 'ticked parameter') + ' integrated out (full Pawley matrix)' : 'conditional on the values (nothing was ticked)') + '. ' +
      '<span class="sub">Extracted ' + esc(I.stamp) + (I.pre ? ', precision block of the ' + I.pre.n + ' lowest-angle' : '') + '.</span></p>' + (why ? '<p class="sv-warn">' + esc(why) + '</p>' : '');
  }
  function renderDensity() {
    document.querySelectorAll('#solve .sv-dens').forEach(function (el) { var h = densityHint(el.getAttribute('data-k') === 'cf' ? 'cf' : 'wy'); el.textContent = h.text; el.classList.toggle('sv-warn', !!h.warn); });
  }
  function chipsOf(recs, max) {
    var shown = recs.slice(0, max).map(function (r) {
      return '<button type="button" class="sgt-set" data-sgset="' + r.number + '|' + esc(r.hall) + '" title="Set the phase to ' + esc(RV.sgtest.label(r)) + ' (No. ' + r.number + (r.setting_description ? ', ' + esc(r.setting_description) : '') + ')">' + esc(RV.sgtest.label(r)) + '</button>';
    }).join('');
    return shown + (recs.length > max ? ' <span class="sub">+' + (recs.length - max) + ' more</span>' : '');
  }
  function renderSgtOut() {
    var el = $('#sv-sgt-out');
    if (!el) return;
    var T = SV.sgt;
    if (!T) { el.innerHTML = SV.ints ? '' : '<p class="hint">Extract the intensities first.</p>'; return; }
    if (T.error) { el.innerHTML = '<p class="sv-warn">' + esc(T.error) + '</p>'; return; }
    var rows = T.rows.slice(0, 16), fitLab = RV.sgtest.label(T.fitRec), open = T.openRec, older = !SV.ints || SV.ints.stamp !== T.stamp;
    el.innerHTML = '<p>' + plural(T.n, 'intensity') + ' of ' + esc(T.phaseName) + ' in ' + esc(T.dsName) + (T.truncatedTo ? ' (the ' + T.truncatedTo + ' lowest-angle)' : '') + ', Laue class ' + esc(T.laue) + ': ' + plural(T.rows.length, 'set') + ' of absences among the settings. ' +
        'Fitted in ' + esc(fitLab) + '. <span class="sub">Extraction of ' + esc(T.stamp) + (older ? ', not the last one' : '') + '.</span></p>' +
      (T.wppfIsOpen ? '' : '<p class="sv-warn">' + esc(fitLab) + ' already forbids some reflections of the Laue class' + (T.missingCount ? ' (' + T.missingCount + ' in the range)' : '') + ': they were never measured, so the groups that differ only there are not told apart (column Untested).' +
        (open ? ' For a complete test, fit in ' + esc(RV.sgtest.label(open)) + ' first. <button type="button" class="sgt-set" data-sgset="' + open.number + '|' + esc(open.hall) + '">Set ' + esc(RV.sgtest.label(open)) + '</button>' : '') + '</p>') +
      '<div class="table-wrap"><table class="grid compact sgt"><thead><tr><th>#</th><th>Space groups with these absences <span class="sub">(click one to set it)</span></th><th title="Reflections among those tested that the groups declare absent">Absent</th>' +
        '<th title="Absent reflections the WPPF fit never contained">Untested</th><th title="Mean I/σ of the reflections declared absent">⟨I/σ⟩</th><th title="The largest I/σ among them">max I/σ</th><th>Probability</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var w = Math.max(0, Math.min(100, 100 * r.p));
        return '<tr' + (i === 0 ? ' class="best"' : '') + '><td>' + (i + 1) + '</td><td class="sgt-sets">' + chipsOf(r.recs, 6) + '</td><td>' + r.m + '</td><td>' + (r.untested || '') + '</td><td>' + (r.m ? f(r.meanIsig, 2) : '—') + '</td><td>' + (r.m ? f(r.maxIsig, 1) : '—') + '</td>' +
               '<td class="sgt-p"><span class="bar"><i style="width:' + w.toFixed(1) + '%"></i></span>' + (r.p >= 1e-3 ? (100 * r.p).toFixed(1) + ' %' : r.p > 1e-300 ? r.p.toExponential(1) : '≈ 0') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (T.rows.length > rows.length ? '<p class="hint">' + (T.rows.length - rows.length) + ' less likely sets are not shown.</p>' : '') +
      '<p class="hint">Settings that predict the same absences among the tested reflections share one probability: the powder data cannot tell them apart. A flat prior over the sets; ' +
        (T.sigmaExact ? 'the uncertainties are the marginal ones of the extraction' : 'some reflections coincide exactly, so their uncertainties are conditional') + '. Choosing a group sets the space group of the phase; fit by WPPF again in it before solving.</p>';
  }
  function cfSitesTable(R) {
    return '<div class="table-wrap"><table class="grid compact sv-sites"><thead><tr><th title="Export and show this site">Use</th><th>#</th><th>Element</th><th>x</th><th>y</th><th>z</th><th>Site</th><th title="Peak height over the highest">Height</th></tr></thead><tbody>' +
      R.sites.map(function (s, i) {
        return '<tr' + (s.use ? '' : ' class="off"') + '><td><input type="checkbox" data-cfuse="' + i + '"' + (s.use ? ' checked' : '') + ' aria-label="Use site ' + s.rank + '"></td><td>' + s.rank + '</td>' +
               '<td><input class="sv-el" data-cfel="' + i + '" list="sv-el-list" value="' + esc(s.element) + '" spellcheck="false" autocomplete="off" aria-label="Element of site ' + s.rank + '"></td>' +
               '<td>' + f(s.x, 4) + '</td><td>' + f(s.y, 4) + '</td><td>' + f(s.z, 4) + '</td><td' + (Number.isFinite(s.snapped) ? ' title="Peak moved ' + s.snapped.toFixed(2) + ' Å onto this special position so that ' + esc(capEl(s.element)) + ' gets the number of atoms the formula asks for"' : '') + '>' + esc(s.wyck) + (Number.isFinite(s.snapped) ? ' ↦' : '') + '</td><td>' + f(s.relative, 3) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      ((R.unplaced || []).length ? '<p class="sv-warn">Not placed: ' + esc(R.unplaced.join(', ')) + '. No peak lies within ' + CF_SNAP_MAX + ' Å of a free position of small enough multiplicity. Check Z, or type the element on a site by hand.</p>' : '');
  }
  function spark(canvas, hist) {
    if (!canvas || !hist || !hist.length) return;
    var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 320, h = canvas.clientHeight || 56, cs = getComputedStyle(document.documentElement);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var vals = Array.prototype.filter.call(hist, Number.isFinite), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (!(hi > lo)) hi = lo + 1e-6;
    g.strokeStyle = (cs.getPropertyValue('--rule') || '#ccc').trim(); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5); g.stroke();
    g.strokeStyle = (cs.getPropertyValue('--blue') || '#2457a6').trim(); g.lineWidth = 1.5;
    g.beginPath();
    for (var i = 0; i < hist.length; i++) {
      if (!Number.isFinite(hist[i])) continue;
      var x = hist.length > 1 ? i / (hist.length - 1) * (w - 2) + 1 : w / 2, y = 3 + (h - 6) * (1 - (hist[i] - lo) / (hi - lo));
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  function renderCfOut() {
    if(!inspectingSolution && solutionSelection.cf)return withSolution('cf',renderCfOut);
    var el = $('#sv-cf-out');
    if (!el) return;
    var R = SV.cf, sitesEl = $('#sv-cf-sites'), sum = $('#sv-cf-sum'), nEl = $('#sv-cf-sites-n');
    function noMap(msg) { var dh=$('#sv-cf-density'),dn=$('#sv-cf-density-none');if(dh)dh.hidden=true;if(dn)dn.hidden=false; if(typeof Density3D !== 'undefined') Density3D.dispose(); el.innerHTML = msg; if (sitesEl) sitesEl.innerHTML = '<p class="hint">No charge-flipping sites yet.</p>'; if (sum) sum.textContent = ''; if (nEl) nEl.textContent = ''; }
    if (!R) { noMap(SV.ints ? '' : '<p class="hint">Extract the intensities first.</p>'); return; }
    if (R.error) { noMap('<p class="sv-warn">' + esc(R.error) + '</p>'); return; }
    var b = R.best, st = R.structure, rep = b.reflections || {};
    el.innerHTML = '<h3>Map' + (R.stopped ? ' <span class="sv-warn">stopped</span>' : '') + '</h3>' +
      '<dl class="sv-dl"><dt>Best R</dt><dd>' + f(b.bestR, 4) + ' at cycle ' + b.bestIter + ' of start ' + R.bestTrial + ' (' + R.trialsDone + ' of ' + R.trials + ' run, ' + R.seconds + ' s)</dd>' +
        '<dt>Map</dt><dd>' + b.gridSize + '³ on ' + (b.backend === 'gpu' ? 'the GPU' : 'the CPU') + (R.auto ? ' (auto)' : '') + ', symmetry in the loop ' + f(b.symLambda, 2) + ', weak fraction ' + f(b.weakFraction, 2) + '</dd>' +
        '<dt>Reflections</dt><dd>' + R.n + ' given, ' + (rep.unique != null ? rep.unique + ' used in ' + rep.clusters + ' clusters' : '') + (rep.droppedOutOfRange ? ', <span class="sv-warn">' + rep.droppedOutOfRange + ' beyond the grid (largest index ' + rep.maxIndex + ': grid ' + rep.minGridForAll + ' or more)</span>' : '') +
          (rep.multiplicityMismatch ? ', <span class="sv-warn">' + rep.multiplicityMismatch + ' multiplicities differ from the operators</span>' : '') + '</dd>' +
        '<dt>Intensities</dt><dd>' + esc(R.note) + '</dd>' +
        (st ? '<dt>Origin</dt><dd>symmetry correlation ' + f(st.symmetryCorrelation, 3) + (Number.isFinite(st.runnerUpCorrelation) ? ' (next ' + f(st.runnerUpCorrelation, 3) + ')' : '') + ', hand ' + (st.hand > 0 ? '+' : '−') + ', ' + st.rawPeakCount + ' peaks in the cell</dd>' : '') +
      '</dl><canvas class="sv-spark" id="sv-cf-spark" aria-label="R by cycle, best start"></canvas>';
    if(R.search)el.innerHTML+=cfSearchHTML(R);
    if (sum) sum.textContent = 'best R ' + f(b.bestR, 4) + (R.sites.length ? ', ' + plural(R.sites.length, 'site') : '');
    if (nEl) nEl.textContent = R.sites.length ? plural(R.sites.length, 'peak') + ' in the asymmetric unit' + (R.Z ? ', Z = ' + (+R.Z.toFixed(2)) + ' from the formula' : '') : '';
    if (sitesEl) sitesEl.innerHTML = (R.sites.length ? cfSitesTable(R) +
        '<p><label class="chk" title="Assign element types from the formula when copying atoms to the phase"><input type="checkbox" id="sv-cf-assign"'+(R.nameFromFormula?' checked':'')+'> Name them from the formula</label></p><p class="hint">Applied when copying atoms to the phase; uncheck to keep the edited element types. The selected sites are preserved.</p>' +
        '<p class="buttons sv-actions"><button type="button" data-sv="cf-show">Show the structure</button>' +
        '<button type="button" class="primary" data-sv="cf-export" title="The ticked sites become the atoms of the phase">Atoms to the phase…</button><button type="button" data-sv="cf-cif">Save CIF…</button></p>' +
        '<p class="hint">Charge flipping gives electron density, not chemistry: check the element of each peak, untick the spurious ones. Positions within ' + f(0.6 * R.o.peakMerge, 2) + ' Å of a special position are put on it.</p>'
        : '<p class="hint">' + (st ? 'No peak above the cutoff.' : 'No sites: the map could not be placed on the origin of the space group.') + '</p>');
    spark($('#sv-cf-spark'), R.best.rHistory);
    var dn = $('#sv-cf-density-none'); if (dn) dn.hidden = !!cfDensityData();
    renderDensityMap();
  }
  function cfSearchHTML(R){
    var search=R.search,rows=search.trials || [],best=rows.find(function(r){return r.start===R.bestTrial;}),other=new Set(),compared=new Set(),agree=new Set();
    rows.forEach(function(r){if(r.error || best && r.seed===best.seed)return;other.add(r.seed);if(Number.isFinite(r.mapCorrelation)){compared.add(r.seed);if(r.mapCorrelation>=search.mapAgreementThreshold)agree.add(r.seed);}});
    return '<h3>Adaptive search</h3><p class="hint">'+esc(cfQualityText(search.quality))+'</p><p class="hint">Selected the lowest CF R using the same observations and overlap groups. Map agreement ≥ '+f(search.mapAgreementThreshold,2)+': '+agree.size+' of '+other.size+' other independent seeds ('+compared.size+' compared), allowing periodic grid translations and inversion. Reproducibility does not establish a correct structure.</p><div class="table-wrap"><table class="grid compact"><thead><tr><th>Start</th><th>δ/σ</th><th>Weak</th><th>λ</th><th>CF R</th><th>Map correlation</th><th>Seed</th></tr></thead><tbody>'+rows.map(function(r){return '<tr'+(r.start===R.bestTrial?' class="best"':'')+'><td>'+r.start+(r.start===R.bestTrial?' ✓':'')+'</td><td>'+f(r.threshold,2)+'</td><td>'+f(r.weakFraction,2)+'</td><td>'+f(r.symLambda,2)+'</td><td>'+(r.error?esc(r.error):f(r.bestR,4))+'</td><td>'+f(r.mapCorrelation,3)+'</td><td>'+r.seed+'</td></tr>';}).join('')+'</tbody></table></div>';
  }
  function cfDensityData() {
    var R=SV.cf;
    if(!R || !R.best)return null;
    var aligned=R.structure && R.structure.map, map=aligned || R.best.map;
    if(!map)return null;
    var grid=R.best.gridSize;
    if(map.length !== grid*grid*grid)return null;
    var sites=[], seen=new Set();
    // ASU sites and the origin-aligned density must be in the same setting.
    // The raw map has not been origin-shifted, so never overlay aligned sites on it.
    if(aligned) R.sites.filter(function(s){return s.use || !s.element;}).forEach(function(s){
      (R.I.ops||[]).forEach(function(op){
        var r=op.r,t=op.t,q=[s.x,s.y,s.z],p=[0,1,2].map(function(i){var v=r[3*i]*q[0]+r[3*i+1]*q[1]+r[3*i+2]*q[2]+t[i];return v-Math.floor(v);});
        var key=p.map(function(v){return Math.round(v*1e5);}).join(',');
        if(!seen.has(key)){seen.add(key);sites.push({rank:s.rank,x:p[0],y:p[1],z:p[2],relative:s.relative});}
      });
    });
    return {map:map,gridSize:grid,cell:R.I.cell,sites:sites,aligned:!!aligned};
  }
  function renderDensityMap(rebuild) {
    if(!inspectingSolution && solutionSelection.cf)return withSolution('cf',function(){renderDensityMap(rebuild);});
    var host=$('#sv-cf-density'), canvas=$('#sv-density-canvas'), d=cfDensityData();
    if(!host || !canvas)return;
    host.hidden=!d;var none=$('#sv-cf-density-none');if(none)none.hidden=!!d;
    if(!d){if(none && SV.cf && SV.cf.best)none.textContent='This saved run has no retained density grid. Its sites and structure are available below.';return;}
    if(!RV.app || RV.app.resultTab()!=='structure-results' || RV.layout.structureKind()!=='cf' || !(RV.acc && RV.acc.isShown(canvas)))return;
    if(typeof Density3D==='undefined'){ $('#sv-density-note').textContent='The density viewer (js/density3d.js) is missing.'; return; }
    var stride=$('#sv-density-stride');if(stride)stride.value=String(SV.opts.cf.densityStride||1);
    try{
      if(!Density3D.init(canvas))throw new Error('The density canvas is unavailable.');
      var info=Density3D.show({map:d.map,gridSize:d.gridSize,cell:d.cell,sigmaLevel:SV.opts.cf.densityLevel||3,stride:SV.opts.cf.densityStride||1,
        showCell:SV.opts.cf.densityCell,showSites:SV.opts.cf.densitySites,sites:d.sites});
      SV.densityCanvas=canvas;
      $('#sv-density-note').textContent=SV.cf.I.phaseName+' in '+SV.cf.I.dsName+' · '+(d.aligned?'Origin-aligned, symmetrized CF density':'Raw CF density; no aligned sites')+' · '+d.gridSize+'³ voxels · '+(info?info.triangles+' triangles':'')+'. Drag to rotate, wheel to zoom, double-click to reset.';
    }catch(e){$('#sv-density-note').textContent='Density display: '+e.message;}
  }
  function saveDensityMap() {
    var d=cfDensityData();if(!d)return;
    ui.download('cf_density_'+ui.fileStamp()+'.json',JSON.stringify({format:'powder6-density',version:1,phase:SV.cf.I.phaseName,gridSize:d.gridSize,cell:d.cell,
      originAligned:d.aligned,axisOrder:'x-fastest: x + N*(y + N*z)',map:Array.from(d.map)},null,2),'application/json');
  }
  function renderWyStatus() {
    var el = $('#sv-wy-cstat');
    if (!el) return;
    var v = validateConstraints(SV.opts.wy.constraints, SV.opts.formula);
    el.innerHTML = v.windows.map(function (w) { return '<div>• ' + esc(describeConstraint(w)) + '</div>'; }).join('') +
      v.errors.map(function (e) { return '<div class="sv-err">✕ ' + esc(e) + '</div>'; }).join('') + v.warnings.map(function (w) { return '<div class="sv-warn">⚠ ' + esc(w) + '</div>'; }).join('');
  }
  function renderWyOut() {
    if(!inspectingSolution && solutionSelection.wy)return withSolution('wy',renderWyOut);
    var el = $('#sv-wy-sol'), sitesEl = $('#sv-wy-sites'), sum = $('#sv-wy-sum');
    if (!el) return;
    var R = SV.wy;
    function none(msg) { el.innerHTML = msg; if (sitesEl) sitesEl.innerHTML = '<p class="hint">No Wyckoff solution yet.</p>'; if (sum) sum.textContent = ''; }
    if (!R) { none(SV.ints ? '<p class="hint">Run the Wyckoff search.</p>' : '<p class="hint">Extract the intensities first.</p>'); return; }
    if (R.error) { none('<p class="sv-warn">' + esc(R.error) + '</p>'); return; }
    var sol = R.sols[R.pick] || R.sols[0], ref = sol.refinement || {};
    if (sum) sum.textContent = (prettyAssign(sol.assignment) || '?') + (Number.isFinite(sol.z) ? ', Z = ' + sol.z : '') + ', wR(F²) ' + pct(ref.R);
    var h = (R.salvaged ? '<p class="sv-warn">' + esc(R.salvaged) + ' Kept the best structure received before the search ended' + (sol.unrefined ? '; this one has search coordinates only (no quench, no refinement)' : '') + '. The choice is provisional.</p>' :
             R.stopped ? '<p class="sv-warn">Stopped early: the quench was skipped, the choice is provisional.</p>' : '') +
      '<dl class="sv-dl"><dt>Formula unit</dt><dd>' + esc(R.formula) + (Number.isFinite(sol.z) ? ', Z = ' + sol.z : '') + (Number.isFinite(sol.rho) ? ', ρ = ' + f(sol.rho, 3) + ' g/cm³' : '') + '</dd>' +
        '<dt>Assignment</dt><dd>' + esc(prettyAssign(sol.assignment) || '?') + '</dd>' +
        '<dt>wR(F²)</dt><dd>' + (Number.isFinite(ref.R) ? pct(ref.R) : 'not refined') + (Number.isFinite(sol.searchCC) ? ', search wR2 ' + pct(1 - sol.searchCC, 1) : '') + '</dd>' +
        (ref.skipped ? '<dt>Refinement</dt><dd class="sv-warn">Skipped: ' + esc(ref.skipped) + '.</dd>' : '') +
        (sol.ranked === false ? '<dt>Caution</dt><dd class="sv-warn">Unranked: ' + f(sol.obsPerParam, 2) + ' effective observations per free parameter. One candidate among several, not a solution.</dd>' : '') +
        '<dt>Intensities</dt><dd>' + R.n + '; ' + esc(R.note) + '</dd><dt>Time</dt><dd>' + R.seconds + ' s</dd></dl>';
    if (R.sols.length > 1) {
      h += '<h3>One solution per Z</h3><div class="table-wrap"><table class="grid compact"><thead><tr><th></th><th>Z</th><th>ρ g/cm³</th><th>wR(F²)</th><th>Assignment</th><th>Atoms</th></tr></thead><tbody>' +
        R.sols.map(function (s, i) {
          return '<tr' + (i === R.pick ? ' class="best"' : '') + '><td><input type="radio" name="sv-wy-pick" data-wypick="' + i + '"' + (i === R.pick ? ' checked' : '') + ' aria-label="Solution with Z = ' + s.z + '"></td><td>' + s.z + '</td><td>' + f(s.rho, 2) + '</td><td>' +
                 (s.refinement && Number.isFinite(s.refinement.R) ? pct(s.refinement.R) : 'not refined') + '</td><td>' + esc(prettyAssign(s.assignment)) + '</td><td>' + (s.nAtoms != null ? s.nAtoms : (s.sites || []).length) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    el.innerHTML = h;
    h = '<div class="table-wrap"><table class="grid compact"><thead><tr><th>#</th><th>Element</th><th>Wyckoff</th><th>x</th><th>y</th><th>z</th><th>Mult.</th><th title="The shortest distance to another atom">Shortest contact</th></tr></thead><tbody>' +
      (sol.sites || []).map(function (s, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(capEl(s.element)) + '</td><td>' + esc(s.wyckoff || '') + '</td><td>' + f(s.x, 4) + '</td><td>' + f(s.y, 4) + '</td><td>' + f(s.z, 4) + '</td><td>' + s.multiplicity + '</td><td>' +
               (Number.isFinite(s.shortestContact) ? f(s.shortestContact, 3) + ' Å' + (s.contacts && s.contacts[0] ? ' (' + esc(capEl(s.contacts[0].element)) + ')' : '') : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="buttons sv-actions"><button type="button" data-sv="wy-show">Show the structure</button><button type="button" class="primary" data-sv="wy-export" title="These sites become the atoms of the phase">Atoms to the phase…</button><button type="button" data-sv="wy-cif">Save CIF…</button></p>';
    if (sitesEl) sitesEl.innerHTML = h;
  }
  // the 3D structure of each solution, under its Sites; drawn only while its block is open
  function renderStOut() { renderStruct('cf'); renderStruct('wy'); }
  function renderStruct(k) {
    if(!inspectingSolution && solutionSelection[k])return withSolution(k,function(){renderStruct(k);});
    var head = $('#sv-' + k + '-st-head'), host = $('#sv-' + k + '-st');
    if (!head || !host) return;
    var st = structureOf(k);
    if (!st) {
      head.innerHTML = '<p class="hint">' + (k === 'cf' ? 'No structure yet: run charge flipping and tick sites with an element.' : 'No structure yet: run the Wyckoff search.') + '</p>';
      if (typeof WyckoffReport !== 'undefined' && WyckoffReport.dispose) WyckoffReport.dispose(host); host.innerHTML = ''; return;
    }
    head.innerHTML = '<span class="sub">' + esc(st.label) + ', ' + esc(st.spaceGroup.symbol) + ', ' + plural(st.sites.length, 'site') + '</span><span class="tool-gap"></span>' +
      '<button type="button" class="primary" data-sv="' + k + '-export">Atoms to the phase…</button><button type="button" data-sv="' + k + '-cif">Save CIF…</button>';
    if (typeof WyckoffReport === 'undefined') return;
    if (!(RV.acc && RV.acc.isShown(host)) || !RV.app || RV.app.resultTab()!=='structure-results' || RV.layout.structureKind()!==k) { if (WyckoffReport.dispose) WyckoffReport.dispose(host); host.innerHTML = ''; return; }
    if (RV.rietveldStructure) RV.rietveldStructure.dispose();
    SV.shown = k;
    WyckoffReport.render(host, cachedStructure(st));
  }
  // one object per shown structure, so the view (rotation, hidden sites) survives a re-render (wyckoff_report.js keys its state on it)
  var stCache = {};
  function cachedStructure(st) {
    var key = st.source + '|' + st.label + '|' + st.sites.map(function (s) { return s.element + s.x.toFixed(4) + s.y.toFixed(4) + s.z.toFixed(4); }).join(';');
    if (!stCache[st.source] || stCache[st.source].key !== key) stCache[st.source] = { key: key, st: st };
    return stCache[st.source].st;
  }
  // a block was opened: draw what it holds (canvases are drawn only when visible)
  function onAcc(k) {
    if (k === 'cf-struct' || k === 'wppf-cf') renderStruct('cf');
    if (k === 'wy-struct' || k === 'wppf-wy') renderStruct('wy');
    if (k === 'cf-density' || k === 'wppf-cf') { renderDensityMap(); if (SV.cf && SV.cf.best) spark($('#sv-cf-spark'), SV.cf.best.rHistory); }
  }
  // ---------------------------------------------------------------- events
  function onClick(e) {
    var resultKind=e.target.closest('#structure-result-cf')?'cf':e.target.closest('#structure-result-wy')?'wy':null;
    if(resultKind && solutionSelection[resultKind] && !inspectingSolution)return withSolution(resultKind,function(){onClick(e);});
    var t = e.target, b;
    if ((b = t.closest('[data-svph]'))) { SV.phaseKey = b.getAttribute('data-svph'); pickDefaults(); renderBar(); renderInt(); renderDensity(); return; }
    if ((b = t.closest('[data-sgset]'))) { var p = b.getAttribute('data-sgset').split('|'); useSetting(+p[0], p.slice(1).join('|')); return; }
    if (!(b = t.closest('[data-sv]'))) return;
    switch (b.getAttribute('data-sv')) {
      case 'extract': extract(); break;
      case 'to-wppf': { var ph = phase(); if (ph) RV.cmd.setMethod(ph, 'wppf'); break; }
      case 'sgt': runSgt(); break;
      case 'find-symmetry': {var select=$('#sv-sym-phase'),ph=select && St.phaseByKey(select.value);if(ph && !S.busy)RV.phasesTab.findSymmetry(ph);break;}
      case 'density-reset': if(typeof Density3D!=='undefined')Density3D.resetView(); break;
      case 'density-map': saveDensityMap(); break;
      case 'density-png': { var cv=$('#sv-density-canvas');if(cv){var a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download='cf_density_'+ui.fileStamp()+'.png';a.click();}break; }
      case 'cf-run': runCf(); break;
      case 'cf-show': show('cf'); break;
      case 'cf-export': exportTo('cf'); break;
      case 'cf-cif': saveCif('cf'); break;
      case 'wy-run': runWy(); break;
      case 'wy-show': show('wy'); break;
      case 'wy-export': exportTo('wy'); break;
      case 'wy-cif': saveCif('wy'); break;
    }
  }
  function onChange(e) {
    if(e.target.id==='sv-sym-phase'){syncSymmetry();return;}
    var resultKind=e.target.closest('#structure-result-cf')?'cf':e.target.closest('#structure-result-wy')?'wy':null;
    if(resultKind && solutionSelection[resultKind] && !inspectingSolution)return withSolution(resultKind,function(){onChange(e);});
    var t = e.target, k;
    if(t.id==='sv-cf-assign'){SV.cf.nameFromFormula=t.checked;return;}
    if (/^sv-density-/.test(t.id)) {
      var key=t.id.slice(11), o=SV.opts.cf;
      if(key==='level'){var level=Number(t.value);if(!(level>=.2 && level<=20)){t.value=o.densityLevel;return;}o.densityLevel=level;}
      else if(key==='stride')o.densityStride=[1,2,4].indexOf(Number(t.value))>=0?Number(t.value):1;
      else if(key==='cell')o.densityCell=t.checked;
      else if(key==='sites')o.densitySites=t.checked;
      saveOpts();renderDensityMap();return;
    }
    if (t.id === 'sv-ds') { SV.dsId = +t.value || null; pickDefaults();renderBar();renderInt();renderDensity();return; }
    if ((k = t.getAttribute('data-opt'))) {
      if (k === 'sgtN') { var issue=sgtCountIssue();t.setCustomValidity(issue);if(issue)t.setAttribute('aria-invalid','true');else t.removeAttribute('aria-invalid');syncAble();if(issue){ui.toast(issue,'warn');return;}SV.opts.sgtN=Number(t.value);SV.opts.sgtAuto=false; }
      else { SV.opts[k] = t.value.trim(); syncShared(t); }
      saveOpts();
      if (k === 'formula' || k === 'z') { RV.bus.emit('composition'); renderBar(); renderDensity(); renderWyStatus(); }
      return;
    }
    if ((k = t.getAttribute('data-cf'))) {
      if(k==='adaptive'){SV.opts.cf.adaptive=t.checked;if(t.checked){SV.opts.cf.trials=Math.min(CFAdaptive.MAX_STARTS,Math.max(CFAdaptive.MIN_STARTS,Math.round(ui.parseNum(SV.opts.cf.trials)) || 6));$('#sv-cf-trials').value=SV.opts.cf.trials;}}
      else SV.opts.cf[k] = t.tagName === 'SELECT' ? t.value : t.value.trim();
      saveOpts();renderCfPlan();syncAble();return;
    }
    if ((k = t.getAttribute('data-wy'))) { if(k==='particles')SV.opts.wy.particlesAuto=false; SV.opts.wy[k] = t.tagName === 'TEXTAREA' ? t.value : t.value.trim(); saveOpts(); if (k === 'constraints' || /^rho/.test(k)) { renderWyStatus(); renderDensity(); } return; }
    if (t.hasAttribute('data-cfuse')) { var s = SV.cf.sites[+t.getAttribute('data-cfuse')]; s.use = t.checked; t.closest('tr').classList.toggle('off', !s.use); renderDensityMap(); renderStruct('cf'); return; }
    if (t.hasAttribute('data-cfel')) { var s2 = SV.cf.sites[+t.getAttribute('data-cfel')], el = St.elementOf(t.value) || t.value.trim(); s2.element = el; t.value = el; SV.cf.nameFromFormula=false;$('#sv-cf-assign').checked=false;if((SV.cf.unplaced || []).length){SV.cf.unplaced=[];renderCfOut();}renderStruct('cf');return; }
    if (t.hasAttribute('data-wypick')) { SV.wy.pick = +t.getAttribute('data-wypick'); renderWyOut(); renderStruct('wy'); }
  }
  // the formula unit and Z appear under both charge flipping and the Wyckoff search: one value
  function syncShared(t) {
    var k = t.getAttribute('data-opt');
    if (k !== 'formula' && k !== 'z') return;
    document.querySelectorAll('#solve [data-opt="' + k + '"]').forEach(function (o) { if (o !== t) o.value = t.value; });
  }
  function onInput(e) {
    var t = e.target;
    if(t.id==='sv-sgtn'){var issue=sgtCountIssue();t.setCustomValidity(issue);if(issue)t.setAttribute('aria-invalid','true');else t.removeAttribute('aria-invalid');syncAble();return;}
    if (t.classList.contains('sv-formula') || t.classList.contains('sv-z')) { SV.opts[t.getAttribute('data-opt')] = t.value.trim(); syncShared(t); RV.bus.emit('composition'); renderDensity(); if (t.classList.contains('sv-formula')) { renderWyStatus(); syncAble(); } }
    else if (t.id === 'sv-wy-constraints') { SV.opts.wy.constraints = t.value; renderWyStatus(); }
  }

  // ---------------------------------------------------------------- the PDF report
  // the text of the structure solution for the report, '' when there is none
  function report(kind) {
    var L = [], I = SV.ints;
    if (!I && !SV.cf && !SV.wy) return { lines: [], image: null };
    L.push('## Structure solution');
    if (I) L.push('intensities\t' + I.det.length + ' WPPF intensities of ' + I.phaseName + ' (' + I.sg.symbol + ') in ' + I.dsName + ', extracted ' + I.stamp + (I.nVar ? ', sigma with ' + I.nVar + ' parameters integrated out' : ''));
    var T = SV.sgt;
    if ((!kind || kind==='sgt') && T && !T.error) {
      L.push('', '### Space-group test (Markvardsen et al. 2001), ' + T.n + ' intensities, Laue class ' + T.laue + ', fitted in ' + RV.sgtest.label(T.fitRec));
      T.rows.slice(0, 8).forEach(function (r, i) {
        L.push((i + 1) + '\t' + r.recs.slice(0, 4).map(RV.sgtest.label).join(', ') + (r.recs.length > 4 ? ' +' + (r.recs.length - 4) : '') + '\tabsent ' + r.m + (r.untested ? ' (untested ' + r.untested + ')' : '') + '\tp = ' + (r.p >= 1e-3 ? (100 * r.p).toFixed(2) + ' %' : r.p.toExponential(2)));
      });
    }
    function sites(head, list) {
      L.push(head);
      list.forEach(function (s) { L.push([s.label, s.element, s.wyckoff || '', f(s.x, 5), f(s.y, 5), f(s.z, 5), s.multiplicity].join('\t')); });
    }
    var cf = !kind || kind==='cf'?structureOf('cf'):null, wy = !kind || kind==='wy'?structureOf('wy'):null;
    if ((!kind || kind==='cf') && SV.cf && SV.cf.best) {
      L.push('', '### Charge flipping: best R = ' + f(SV.cf.best.bestR, 4) + ', grid ' + SV.cf.best.gridSize + '^3, ' + SV.cf.trialsDone + ' of ' + SV.cf.trials + ' starts' + (SV.cf.structure ? ', symmetry correlation ' + f(SV.cf.structure.symmetryCorrelation, 3) : ''));
      L.push(SV.cf.note);
      if(SV.cf.search){L.push('Adaptive search\t'+cfQualityText(SV.cf.search.quality),'Selection\t'+SV.cf.search.selectionRule,'start\tseed\tdelta/sigma\tweak fraction\tsymmetry\tCF R\tmap correlation');SV.cf.search.trials.forEach(function(r){L.push([r.start,r.seed,r.threshold,r.weakFraction,r.symLambda,r.error || r.bestR,r.mapCorrelation==null?'not compared':r.mapCorrelation].join('\t'));});}
      if (cf) sites('site\telement\tWyckoff\tx\ty\tz\tmult', labelled(cf.sites));
    }
    if ((!kind || kind==='wy') && SV.wy && SV.wy.sols) {
      var sol = SV.wy.sols[SV.wy.pick] || SV.wy.sols[0];
      L.push('', '### Wyckoff search: ' + SV.wy.formula + (Number.isFinite(sol.z) ? ', Z = ' + sol.z : '') + ', ' + prettyAssign(sol.assignment) + ', wR(F2) = ' + pct(sol.refinement && sol.refinement.R) + (SV.wy.stopped ? ' (stopped early)' : ''));
      if (wy) sites('site\telement\tWyckoff\tx\ty\tz\tmult', labelled(wy.sites));
    }
    // the structure plot as it is on screen, on the background of the plots (its canvas is transparent)
    var shown=kind || SV.shown || 'wy',canvas=kind==='sgt'?null:document.querySelector('#sv-'+shown+'-st canvas'),image=null;
    try {
      if (canvas && canvas.width > 10 && canvas.height > 10) {
        var c2 = document.createElement('canvas'), g = c2.getContext('2d');
        c2.width = canvas.width; c2.height = canvas.height;
        g.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--plot-bg') || '#fff').trim() || '#fff';
        g.fillRect(0, 0, c2.width, c2.height);
        g.drawImage(canvas, 0, 0);
        image = { url: c2.toDataURL('image/jpeg', 0.92), w: c2.width, h: c2.height, title: shown === 'wy' ? 'Structure from the Wyckoff search' : 'Structure from charge flipping' };
      }
    } catch (e) { image = null; }
    var densityImage=null, densityCanvas=$('#sv-density-canvas');
    try { if((!kind || kind==='cf') && densityCanvas && densityCanvas===SV.densityCanvas && SV.cf && SV.cf.best) {
      densityImage={url:densityCanvas.toDataURL('image/jpeg',.92),w:densityCanvas.width,h:densityCanvas.height,
        title:'Charge-flipping density of '+SV.cf.I.phaseName+' in '+SV.cf.I.dsName+', isosurface '+(SV.opts.cf.densityLevel||3)+' sigma'};
    } } catch(e) { densityImage=null; }
    return { lines: L, image: image, densityImage:densityImage };
  }
  function labelled(list) { var n = {}; return list.map(function (s) { n[s.element] = (n[s.element] || 0) + 1; return Object.assign({ label: s.element + n[s.element] }, s); }); }
  function archive(includeDensity){return JSON.parse(JSON.stringify({cf:SV.cf,wy:SV.wy,ints:SV.ints,sgt:SV.sgt,shown:SV.shown,opts:SV.opts,dsId:SV.dsId,phaseKey:SV.phaseKey},function(k,v){if(!includeDensity && k==='map' && (Array.isArray(v)||ArrayBuffer.isView(v)))return undefined;return ArrayBuffer.isView(v)?Array.from(v):v;}));}
  function restoreArchive(value,options){
    // Project boundaries must also clear caches keyed by IDs reused by the new project.
    SV.extractions={};SV.sgt=null;SV.cf=null;SV.wy=null;SV.ints=null;
    SV.dsId=null;SV.phaseKey=null;SV.shown=null;SV.opts=defaults();
    solutionSelection={};solutionViews={};inspectingSolution=false;
    value=value || {};
    ['cf','wy','ints','dsId','phaseKey','shown','sgt'].forEach(function(k){if(value[k]!==undefined)SV[k]=value[k];});
    var o=value.opts || {};
    Object.keys(SV.opts).forEach(function(k){if(o[k]!==undefined)SV.opts[k]=k==='cf'||k==='wy'?Object.assign({},SV.opts[k],o[k]):o[k];});
    if(SV.opts.sgtAuto!==false || !Number.isSafeInteger(SV.opts.sgtN) || SV.opts.sgtN<4 || SV.opts.sgtN>C.MAX_PRECISION_REFLECTIONS){SV.opts.sgtN=0;SV.opts.sgtAuto=true;}
    var d=SV.ints && St.byId(SV.ints.dsId);
    if(d && d.inst.lambda1===SV.ints.lambda)SV.extractions[d.id]={I:SV.ints,stats:d.stats};else SV.ints=null;
    if(SV.cf){if(SV.cf.best && SV.cf.best.map)SV.cf.best.map=Float32Array.from(SV.cf.best.map);if(SV.cf.structure && SV.cf.structure.map)SV.cf.structure.map=Float32Array.from(SV.cf.structure.map);}
    saveOpts();dirty=true;if(!(options && options.silent))render();
  }

  // ---------------------------------------------------------------- init
  function refresh() {
    clearEmptyComposition();
    dirty = true;
    if (active()) render();
  }
  function init() {
    SV.opts = loadOpts();
    clearEmptyComposition();
    probeGPU();
    var host = $('#work');
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', onInput);
    RV.bus.on('calculation',function(){if(RV.app.resultTab()!=='structure-results' && typeof Density3D!=='undefined')Density3D.dispose();else setTimeout(function(){renderDensityMap();renderStOut();},0);});
    RV.bus.on('tab',function(){if(RV.app.resultTab()!=='structure-results' && typeof Density3D!=='undefined')Density3D.dispose();else renderDensityMap();});
    RV.bus.on('theme',function(){if(typeof Density3D!=='undefined')Density3D.applyTheme();});
    RV.bus.on('tab', function () { if(active() && dirty)render();else if(active())renderStOut(); });
    RV.bus.on('acc', onAcc);
    RV.bus.on('phases', function () { if (SV.ints) SV.ints.stale = true; refresh(); });
    RV.bus.on('params', function () { if (SV.ints) SV.ints.stale = true; if (active()) { renderBar(); renderInt(); renderDensity(); } else dirty = true; });
    RV.bus.on('stats', function () { if (active()) renderBar(); else dirty = true; });
    RV.bus.on('phaseSel', function () { var cur = St.currentPhase(); if (cur && cur.method === 'wppf' && cur.key !== SV.phaseKey) { SV.phaseKey = cur.key; refresh(); } });
    ['datasets', 'selection', 'tables'].forEach(function (ev) { RV.bus.on(ev, function () { if (!dataset()) SV.dsId = null; refresh(); }); });
    RV.bus.on('busy', function () { if (active()) renderBar(); });
    RV.bus.on('theme', function () { if (active()) { if (SV.cf && SV.cf.best) spark($('#sv-cf-spark'), SV.cf.best.rHistory); renderStOut(); } });
  }

  return { init: init, running: running, stop: stop, report: report, render: render, saveHkl:saveHkl, hklWhy:hklWhy, autoExtract:autoExtract, probeGPU:probeGPU, budgetFor:budgetFor, gpuBudget:gpuBudget, state: SV, cfDensityData: cfDensityData, renderDensityMap: renderDensityMap, symopsFor: symopsFor, parseFormula: parseFormula,
           validateConstraints: validateConstraints, assignCf: assignCf,renderSelectedSolution:renderSelectedSolution,adoptSolution:adoptSolution,reportSelected:function(){var k=RV.layout && RV.layout.structureKind();return withSolution(k,function(){return report(k);});},archive:archive,restoreArchive:restoreArchive,exportTo:exportTo };
})();
