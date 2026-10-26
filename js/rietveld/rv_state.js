/*  Powder 6: the state of the program, its persistence, fit jobs, projects and the history of restore points.
 *
 *  Dataset { id, name, tth, y, sig, weights (Float64Array | null), inst, phases [keys of the phases it holds], p: {name: value},
 *            fit: {name: bool}, esd: {name: number}, stats: null | {...}, mem: {name: [value, fit]} (parameters that left
 *            the model), apart: {name: true} (shared parameters this dataset keeps its own value of in a global fit),
 *            calc (cached pattern), ints (intensities of the Le Bail and WPPF phases from the last fit, not saved),
 *            sim (simulated: no data) }
 *  inst    { anode, lambda1, lambda2, ratio, radiation 'xray' | 'neutron', pol 'tube' | 'mono' | 'sync' | 'none',
 *            monoTth, polFrac, tthMin, tthMax, bkgType 'cheb' | 'spline', bkgN (Chebyshev terms), bkgX (spline anchors,
 *            2theta), excl [[lo, hi], ...] (excluded regions) }
 *  Phase   { key 'p1', name, method 'rietveld' | 'lebail' | 'wppf', sg {number, symbol, hall, system, laue, setting,
 *            uniqueAxis}, ops, wyckoff, profileType, poDir [h, k, l], atoms [{ label, type, site }], v {name: value},
 *            fit {name: bool} }
 *
 *  As in Yappari, every dataset holds its own value of every parameter: its instrument and background, and the
 *  parameters of every phase in it. A dataset holds every phase unless one is taken out of it (a mixture measured in
 *  one pattern, a pure phase in another); in a global fit a shared parameter of a phase has one value for all the
 *  datasets of the fit that hold the phase, but those that keep it apart (ds.apart), which have their own value.
 *  v and fit of a phase are the start values of the datasets read later.
 *  Limits and the shared flags of the global fit are per parameter name. Parameter names are those of rietveld_core.js.
 *  The active calculation sets one method for all phases. Rietveld needs atoms; Le Bail and WPPF fit the intensities of the
 *  reflections instead, so the scale, the orientation and the atoms of such a phase are kept but not refined.
 */
// the stored restraints of a phase (js/atom_restraints.js), with defaults for projects that have none
RV.restraintsOf = function (r) { return typeof AtomRestraints !== 'undefined' ? AtomRestraints.normalize(r) : Object.assign({ on: true, text: '', weight: 1, sigmaD: 0.02, sigmaA: 3 }, r || {}); };
RV.state = (function () {
  'use strict';
  var LS = 'powder6.', C = RVCore;

  // ---------------------------------------------------------------- instrument
  // K-alpha1, K-alpha2 (angstrom) and I(Ka2)/I(Ka1)
  var ANODES = { Cu: [1.540598, 1.544426, 0.5], Co: [1.788965, 1.79285, 0.5], Fe: [1.936042, 1.93998, 0.5],
                 Cr: [2.28976, 2.293663, 0.5], Mo: [0.7093, 0.71359, 0.5], Ag: [0.5594075, 0.563798, 0.5] };
  function defaultInst() {
    return { anode: 'Cu', lambda1: 1.540598, lambda2: 1.544426, ratio: 0.5, radiation: 'xray', pol: 'tube', monoTth: 26.6, polFrac: 0.95,
             radiusMM:0, anomalous: '', anomalousEnabled:true, resolutionType:'tch_aniso', bkgType: 'cheb', bkgN: 6, bkgX: [], excl: [], exclOff: [] };
  }
  // arrays of an instrument copied, so a restore point or a copy never shares them
  function instCopy(i) {
    var o = Object.assign({}, i);
    o.bkgX = Array.isArray(i.bkgX) ? i.bkgX.slice() : [];
    o.excl = Array.isArray(i.excl) ? i.excl.map(function (r) { return [r[0], r[1]]; }) : [];
    o.exclOff = Array.isArray(i.exclOff) ? i.exclOff.map(function (r) { return [r[0], r[1]]; }) : [];
    return o;
  }
  // an instrument read from a project or a file: the fields checked, the arrays cleaned
  function cleanInst(i) {
    var o = Object.assign(defaultInst(), i || {});
    o.resolutionType = own(C.PROFILE_PARAMS,o.resolutionType) ? o.resolutionType : 'tch_aniso';
    o.radiusMM = Number.isFinite(+o.radiusMM) && +o.radiusMM > 0 ? +o.radiusMM : 0;
    // f' and f'' per element at this wavelength, as text ("Fe -3.36 3.20, O 0.05 0.03"); entries that do not read are dropped
    o.anomalous = C.parseAnomalous(typeof o.anomalous === 'string' ? o.anomalous : '').text;
    o.anomalousEnabled = o.anomalousEnabled !== false;
    o.bkgType = o.bkgType === 'spline' ? 'spline' : 'cheb';
    o.bkgX = (Array.isArray(o.bkgX) ? o.bkgX : []).map(Number).filter(Number.isFinite).sort(function (a, b) { return a - b; })
      .filter(function (x, k, a) { return k === 0 || x - a[k - 1] > 1e-6; });
    o.excl = mergeRegions((Array.isArray(o.excl) ? o.excl : []).filter(function (r) { return Array.isArray(r) && r.length === 2 && Number.isFinite(+r[0]) && Number.isFinite(+r[1]); })
      .map(function (r) { return [Math.min(+r[0], +r[1]), Math.max(+r[0], +r[1])]; }));
    // zones kept but not applied (the Apply tick of an excluded region): the fit never sees them
    o.exclOff = (Array.isArray(o.exclOff) ? o.exclOff : []).filter(function (r) { return Array.isArray(r) && r.length === 2 && Number.isFinite(+r[0]) && Number.isFinite(+r[1]) && +r[0] !== +r[1]; })
      .map(function (r) { return [Math.min(+r[0], +r[1]), Math.max(+r[0], +r[1])]; }).sort(function (a, b) { return a[0] - b[0]; });
    if (!(Number.isInteger(o.bkgN) && o.bkgN >= 0 && o.bkgN <= 24)) o.bkgN = 6;
    return o;
  }
  // sorted, overlapping or touching regions joined
  function mergeRegions(list) {
    var r = list.filter(function (x) { return x[1] > x[0]; }).map(function (x) { return [x[0], x[1]]; }).sort(function (a, b) { return a[0] - b[0]; }), out = [];
    r.forEach(function (x) { var last = out[out.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push(x); });
    return out;
  }
  function excluded(inst, t) {
    var ex = inst.excl || [];
    for (var i = 0; i < ex.length; i++) if (t >= ex[i][0] && t <= ex[i][1]) return true;
    return false;
  }
  // the polarisation ratio K of crystal.js (P = (1 + K cos^2 2theta) / (1 + K)); neutrons are not polarised
  function polK(inst) {
    if (inst.radiation === 'neutron') return 0;
    switch (inst.pol) {
      case 'none': return 0;
      case 'mono': return sharkoPolarizationK({ mode: 'lab', monoTth: inst.monoTth });
      case 'sync': return sharkoPolarizationK({ mode: 'synchrotron', polFrac: inst.polFrac });
      default: return 1;
    }
  }
  function anodeOf(l1) {
    var best = '';
    Object.keys(ANODES).forEach(function (k) { if (Math.abs(ANODES[k][0] - l1) < 2e-3) best = k; });
    return best;
  }

  // ---------------------------------------------------------------- settings
  function defaults() {
    return { algorithm: 'lm', ptSweeps: 50, ptChains: 6, ptMaxTemp: 100, ptSeed: 12345, maxIter: 30, tol: 1e-5, theme: 'system', yscale: 'lin', showAnchors:true, showBkg: true, showPhases: true, showTicks: true, noBackground:false, plotMode:'overlay', historyMB:100, historyCount:20,
             maxPlots: 8, bkgN: 6, nAnchors: 12, weight: 'poisson', inst: defaultInst() };
  }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  var REFINEMENT_KEYS = ['algorithm','ptSweeps','ptChains','ptMaxTemp','ptSeed','maxIter','tol'];
  var VALID = {
    algorithm: function (v) { return v === 'lm' || v === 'pt'; },
    ptSweeps: function (v) { return Number.isInteger(v) && v >= 10 && v <= 100000; },
    ptChains: function (v) { return Number.isInteger(v) && v >= 2 && v <= 16; },
    ptMaxTemp: function (v) { return v > 1 && v <= 1e6; },
    ptSeed: function (v) { return Number.isInteger(v) && v >= 1 && v <= 2147483647; },
    maxIter: function (v) { return Number.isInteger(v) && v >= 1 && v <= 10000; },
    tol: function (v) { return v > 0 && v < 1; },
    theme: function (v) { return ['system', 'light', 'dark'].indexOf(v) >= 0; },
    yscale: function (v) { return ['lin', 'sqrt', 'log'].indexOf(v) >= 0; },
    maxPlots: function (v) { return Number.isInteger(v) && v >= 1 && v <= 1000; },
    plotMode: function(v){return ['overlay','focus','overview'].indexOf(v)>=0;},
    historyMB: function(v){return Number.isFinite(v) && v>=1 && v<=10000;},
    historyCount: function(v){return Number.isInteger(v) && v>=1 && v<=1000;},
    bkgN: function (v) { return Number.isInteger(v) && v >= 0 && v <= 24; },
    nAnchors: function (v) { return Number.isInteger(v) && v >= 2 && v <= 200; },
    weight: function (v) { return v === 'poisson' || v === 'unit'; },
    inst: function (v) { return !!v && typeof v === 'object' && v.lambda1 > 0; }
  };
  function validSetting(k, v) {
    var d0 = defaults();
    return own(d0, k) && typeof v === typeof d0[k] && !(typeof v === 'number' && !isFinite(v)) && (!own(VALID, k) || VALID[k](v));
  }
  function cleanSettings(src) {
    var st = defaults();
    if (src && typeof src === 'object') Object.keys(src).forEach(function (k) { if (validSetting(k, src[k])) st[k] = src[k]; });
    st.inst = cleanInst(st.inst);
    st.inst.bkgX = []; st.inst.excl = []; st.inst.exclOff = [];
    return st;
  }

  var S = {
    datasets: [], sel: new Set(), anchor: null, focus: null, nextId: 1, busy: false,
    phases: [], phaseSel: null, nextPhase: 1, shared: {}, limits: {}, settings: defaults(),
    tables: null, sgReady: false, version: 0, presetDefaults: {}, calculation: 'lebail', calculationOptions: {}, parameterLinks:[], disabledPhases:[]
  };

  function store(key, val) { try { localStorage.setItem(LS + key, JSON.stringify(val)); } catch (e) { /* private mode */ } }
  function load(key) { try { var v = localStorage.getItem(LS + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  // the settings of the Rietveld page of Powder 5 are taken over the first time
  function restore() {
    var st = load('settings');
    if (!st) { try { st = JSON.parse(localStorage.getItem('powder5-rietveld.settings') || 'null'); } catch (e) { st = null; } }
    // The source, wavelength and polarisation describe a measurement, not the user: whatever the last session ended with
    // (a Co tube, neutrons, an opened project) must not become the start of the next one. Every session begins as a Cu
    // X-ray tube; a pattern's own wavelength, the Instrument dialog or a project change it from there.
    if (st && typeof st === 'object') { st = Object.assign({}, st); delete st.inst; }
    S.settings = cleanSettings(st);
  }
  function setSetting(k, v) {
    if (!validSetting(k, v)) return false;
    var changed = S.settings[k] !== v;
    S.settings[k] = v;
    if (k === 'weight' && changed) {
      S.datasets.forEach(function (ds) { ds.stats = null; ds.esd = {}; ds.ints = null; invalidate(ds); });
      RV.bus.emit('stats'); RV.bus.emit('params', {});
    }
    store('settings', S.settings);
    RV.bus.emit('settings', k);
    return true;
  }
  function refinementOptions() {
    var out = {}; REFINEMENT_KEYS.forEach(function (k) { out[k] = S.settings[k]; }); return out;
  }
  function restoreRefinementOptions(options) {
    REFINEMENT_KEYS.forEach(function (k) { if (options && validSetting(k, options[k])) S.settings[k] = options[k]; });
  }
  function resetSettings() { var next = defaults(); next.inst.bkgType=backgroundType(); setSetting('weight',next.weight); S.settings = next; store('settings', S.settings); RV.bus.emit('settings', '*'); }

  // ---------------------------------------------------------------- scattering factors
  // tables from loadScatteringTables() (scatterers.js); labels are matched without regard to case
  function setTables(t) {
    var xm = new Map(), nm = new Map();
    Object.keys((t.xray && t.xray.table) || {}).forEach(function (k) { xm.set(k.toUpperCase(), { label: k, e: t.xray.table[k] }); });
    Object.keys((t.neutron && t.neutron.table) || {}).forEach(function (k) { nm.set(k.toUpperCase(), { label: k, e: t.neutron.table[k] }); });
    S.tables = { raw: t, xray: xm, neutron: nm, anomalous:t.anomalous?normalizeAnomalousTable(t.anomalous):null, labels: Object.keys((t.xray && t.xray.table) || {}) };
    S.datasets.forEach(function (ds) { clearFit(ds, true); });
  }
  // standard atomic weights (g/mol), for cell masses, densities and weight fractions
  var WEIGHTS = {};
  ('H 1.008 D 2.014 He 4.0026 Li 6.94 Be 9.0122 B 10.81 C 12.011 N 14.007 O 15.999 F 18.998 Ne 20.18 Na 22.99 Mg 24.305 ' +
   'Al 26.982 Si 28.085 P 30.974 S 32.06 Cl 35.45 Ar 39.948 K 39.098 Ca 40.078 Sc 44.956 Ti 47.867 V 50.942 Cr 51.996 ' +
   'Mn 54.938 Fe 55.845 Co 58.933 Ni 58.693 Cu 63.546 Zn 65.38 Ga 69.723 Ge 72.63 As 74.922 Se 78.971 Br 79.904 Kr 83.798 ' +
   'Rb 85.468 Sr 87.62 Y 88.906 Zr 91.224 Nb 92.906 Mo 95.95 Tc 98 Ru 101.07 Rh 102.91 Pd 106.42 Ag 107.87 Cd 112.41 ' +
   'In 114.82 Sn 118.71 Sb 121.76 Te 127.6 I 126.9 Xe 131.29 Cs 132.91 Ba 137.33 La 138.91 Ce 140.12 Pr 140.91 Nd 144.24 ' +
   'Pm 145 Sm 150.36 Eu 151.96 Gd 157.25 Tb 158.93 Dy 162.5 Ho 164.93 Er 167.26 Tm 168.93 Yb 173.05 Lu 174.97 Hf 178.49 ' +
   'Ta 180.95 W 183.84 Re 186.21 Os 190.23 Ir 192.22 Pt 195.08 Au 196.97 Hg 200.59 Tl 204.38 Pb 207.2 Bi 208.98 Po 209 ' +
   'At 210 Rn 222 Fr 223 Ra 226 Ac 227 Th 232.04 Pa 231.04 U 238.03 Np 237 Pu 244 Am 243 Cm 247 Bk 247 Cf 251')
    .split(' ').forEach(function (t, i, a) { if (i % 2 === 0) WEIGHTS[t] = +a[i + 1]; });
  function atomicWeight(el) { return WEIGHTS[el] || NaN; }
  // the element of a scatterer or a site label: "Fe3+" -> Fe, "CL" -> Cl, "OW" -> O (two letters that are no element)
  function elementOf(type) {
    var m = /^([A-Za-z]{1,2})/.exec(String(type || '').trim());
    if (!m) return '';
    var s = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    if (s.length === 2 && !WEIGHTS[s]) s = s.charAt(0);
    return WEIGHTS[s] ? s : '';
  }
  // { xray: {a, b, c} | null, neutron: fm, xlabel, nlabel }: the type as written ("Fe3+"), then without its charge, then
  // the element; the neutron length of the element
  function scatterer(type) {
    var t = String(type || '').trim(), T = S.tables, out = { xray: null, neutron: null, xlabel: '', nlabel: '' };
    if (!T || !t) return out;
    var ionic=/^([A-Za-z]{1,2})(?:([0-9]+)([+-])|([+-])([0-9]+))$/.exec(t), ion=ionic ? ionic[1]+(ionic[2] || ionic[5])+(ionic[3] || ionic[4]) : t;
    var cands = [t, ion, ionic ? ionic[1]+(ionic[3] || ionic[4])+(ionic[2] || ionic[5]) : '', elementOf(t)], i, hit;
    for (i = 0; i < cands.length; i++) { hit = cands[i] && T.xray.get(cands[i].toUpperCase()); if (hit) { out.xray = hit.e; out.xlabel = hit.label; break; } }
    hit = T.neutron.get(elementOf(t).toUpperCase()) || T.neutron.get(t.toUpperCase());
    if (hit && Number.isFinite(hit.e.b_coh)) { out.neutron = hit.e.b_coh; out.nlabel = hit.label; }
    return out;
  }

  // ---------------------------------------------------------------- space groups
  // SG_ENGINE.resolve() of powder5 (sg_engine.js, loaded by Le Bail · WPPF): a Hall symbol first (it names one setting), then the symbol or number
  function resolveSG(input, hall) {
    if (typeof SG_ENGINE === 'undefined' || !globalThis.SG_DATABASE) return null;
    var rec = null;
    try { if (hall) rec = SG_ENGINE.resolve(String(hall).trim()); } catch (e) { rec = null; }
    // the exact symbol of a setting first: the general resolver reads "Pnnn:2" as origin choice 1
    if (!rec && input != null) rec = settingBySymbol(input);
    try { if (!rec && input != null && String(input).trim()) rec = SG_ENGINE.resolve(String(input).trim()); } catch (e) { rec = null; }
    return fromRecord(rec);
  }
  var symbolIndex = null;
  function settingBySymbol(s) {
    var key = String(s).replace(/\s+/g, '');
    if (!key || typeof SG_ENGINE.listSettings !== 'function') return null;
    // a monoclinic number: the standard setting of International Tables (b unique, cell choice 1)
    if (/^\d+$/.test(key) && +key >= 3 && +key <= 15) {
      var mono = SG_ENGINE.listSettings(+key) || [];
      return mono.filter(function (r) { return r.setting_description === 'b1'; })[0] || mono.filter(function (r) { return r.setting_description === 'b'; })[0] || null;
    }
    if (!symbolIndex) {
      symbolIndex = {};
      var all = [];
      for (var n = 1; n <= 230; n++) (SG_ENGINE.listSettings(n) || []).forEach(function (r) { all.push(r); var k = String(r.symbol || '').replace(/\s+/g, ''); if (k && !(k in symbolIndex)) symbolIndex[k] = r; });
      // the short monoclinic symbols people type (P21/c for P121/c1), the b-unique axis first, as in International Tables
      [/^([PABCIF])1(.+)1$/, /^([PABCIF])11(.+)$/, /^([PABCIF])(.+)11$/].forEach(function (re) {
        all.forEach(function (r) { var m = re.exec(String(r.symbol || '').replace(/\s+/g, '')); if (m && r.system === 'monoclinic' && !((m[1] + m[2]) in symbolIndex)) symbolIndex[m[1] + m[2]] = r; });
      });
    }
    return symbolIndex[key] || null;
  }
  // every setting of every group, for the lists that offer them: { number, symbol, hall, system, setting }
  function allSettings() {
    var out = [];
    if (typeof SG_ENGINE === 'undefined' || typeof SG_ENGINE.listSettings !== 'function') return out;
    for (var n = 1; n <= 230; n++) (SG_ENGINE.listSettings(n) || []).forEach(function (r) { out.push({ number: n, symbol: r.symbol, hall: r.hall, system: r.system || '', setting: r.setting_description || '' }); });
    return out;
  }
  /* The setting a FILE names (structure CIF), as resolveFileSpaceGroup() of powder5.html: the Hall symbol, then the full
     symbol (ICSD's origin suffixes "Z" and "S" read as :2 and :1), then among the settings with the same short symbol the
     one whose monoclinic unique axis matches the oblique angle of the cell, then the primary setting of the number. */
  function resolveFileSG(sgIn, cell) {
    if (typeof SG_ENGINE === 'undefined' || !globalThis.SG_DATABASE || !sgIn) return null;
    var norm = function (s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); };
    var sym = String(sgIn.symbol || '').trim().replace(/\s+Z$/i, ' :2').replace(/\s+S$/i, ' :1').replace(/\s+H$/i, ' :H');
    var shortOf = function (s) { var t = String(s || '').replace(/:\w+$/, '').trim(); if (!/\s/.test(t)) return norm(t); var p = t.split(/\s+/); return [p[0]].concat(p.slice(1).filter(function (q) { return q !== '1'; })).join('').toUpperCase(); };
    var wantSym = norm(sym), wantHall = norm(sgIn.hall), number = Number.isFinite(sgIn.number) ? sgIn.number : null;
    try {
      if (number === null) { var r0 = (wantHall && SG_ENGINE.resolve(sgIn.hall)) || (wantSym && SG_ENGINE.resolve(sym)) || null; if (r0) number = r0.number; }
      if (number === null) return null;
      var settings = SG_ENGINE.listSettings(number) || [];
      if (!settings.length) return null;
      var rec = (wantHall && settings.filter(function (r) { return norm(r.hall) === wantHall; })[0]) || (wantSym && settings.filter(function (r) { return norm(r.symbol) === wantSym; })[0]);
      if (rec) return fromRecord(rec, 'exact');
      var cands = wantSym ? settings.filter(function (r) { return shortOf(r.symbol) === shortOf(sym); }) : [];
      if (!cands.length) cands = settings;
      if (cands.length > 1 && cands[0].system === 'monoclinic') {
        var off = cell ? ['alpha', 'beta', 'gamma'].filter(function (k) { return Number.isFinite(cell[k]) && Math.abs(cell[k] - 90) > 1e-3; }) : [];
        var axis = off.length === 1 ? { alpha: 'a', beta: 'b', gamma: 'c' }[off[0]] : 'b';
        var onAxis = cands.filter(function (r) { var m = /^-?([abc])/i.exec(r.setting_description || ''); return (m ? m[1].toLowerCase() : 'b') === axis; });
        if (onAxis.length) cands = onAxis;
      }
      var primary = SG_ENGINE.resolve(number);
      rec = cands.filter(function (r) { return primary && norm(r.hall) === norm(primary.hall); })[0] || cands[0];
      return fromRecord(rec, wantSym || wantHall ? 'approximate' : 'number only');
    } catch (e) { return null; }
  }
  function fromRecord(rec, how) {
    if (!rec || !rec.sym_ops) return null;
    var entry = SG_DATABASE.space_groups[String(rec.number)], setting = null;
    if (entry) setting = (entry.settings || []).filter(function (s) { return s.hall === rec.hall; })[0] || null;
    var m = /^-?([abc])/i.exec(rec.setting_description || '');
    return { number: rec.number, symbol: rec.symbol || rec.standard_symbol, hall: rec.hall || '', system: rec.system, laue: rec.laue_class || '',
             setting: rec.setting_description || '', uniqueAxis: m ? m[1].toLowerCase() : 'b',
             ops: C.expandOps(rec.sym_ops, rec.centring_translations), wyckoff: (setting && Array.isArray(setting.wyckoff)) ? setting.wyckoff : [], how: how || 'exact' };
  }
  function sgText(sg) { return sg ? sg.symbol + ' (' + sg.number + ')' : '?'; }

  // ---------------------------------------------------------------- sites
  function phaseByKey(key) { for (var i = 0; i < S.phases.length; i++) if (S.phases[i].key === key) return S.phases[i]; return null; }
  function cellOf(ph, v) { return C.cellOf(ph.sg.system, ph.sg.uniqueAxis, function (c) { return v[ph.key + '.' + c]; }); }
  function wrap1(v) { v -= Math.floor(v); return Math.abs(v - 1) < 1e-9 ? 0 : v; }
  // the distinct images of a point (0.02 A, as simulation.js)
  function orbitOf(ops, x, G) {
    var out = [];
    ops.forEach(function (o) {
      var r = o.r, t = o.t;
      var y = [wrap1(r[0] * x[0] + r[1] * x[1] + r[2] * x[2] + t[0]), wrap1(r[3] * x[0] + r[4] * x[1] + r[5] * x[2] + t[1]), wrap1(r[6] * x[0] + r[7] * x[1] + r[8] * x[2] + t[2])];
      for (var i = 0; i < out.length; i++) {
        var d = [y[0] - out[i][0], y[1] - out[i][1], y[2] - out[i][2]];
        if (fracDistance(G, d[0] - Math.round(d[0]), d[1] - Math.round(d[1]), d[2] - Math.round(d[2])) < 0.02) return;
      }
      out.push(y);
    });
    return out;
  }
  function project(w, q) {
    var P = [1, 0, 0, 0, 1, 0, 0, 0, 1], T = [0, 0, 0];
    if (Array.isArray(w.P_num) && w.P_num.length === 9 && w.P_den) { P = w.P_num.map(function (v) { return v / w.P_den; }); T = (w.T_num || [0, 0, 0]).map(function (v) { return v / (w.T_den || 1); }); }
    return [P[0] * q[0] + P[1] * q[1] + P[2] * q[2] + T[0], P[3] * q[0] + P[4] * q[1] + P[5] * q[2] + T[1], P[6] * q[0] + P[7] * q[1] + P[8] * q[2] + T[2]];
  }
  // the Wyckoff letter: the multiplicity decides, the projection of the table only breaks ties (simulation.js)
  function wyckoffLetter(ph, site, cell) {
    var cands = (ph.wyckoff || []).filter(function (w) { return Number(w.multiplicity) === site.mult; });
    if (!cands.length) return '';
    if (cands.length === 1) return cands[0].letter || '';
    var G = metricTensor(cell), orbit = orbitOf(ph.ops, site.pos, G), best = '', bd = Infinity;
    cands.forEach(function (w) {
      orbit.forEach(function (q) {
        var p = project(w, q), d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        var dd = fracDistance(G, d[0] - Math.round(d[0]), d[1] - Math.round(d[1]), d[2] - Math.round(d[2]));
        if (dd < bd) { bd = dd; best = w.letter || ''; }
      });
    });
    return best;
  }
  function siteOf(ph, xyz, cell) {
    var s = C.siteSymmetry(ph.ops, xyz, cell);
    // the average of the images and the offsets of the site, without their last bits: 1/4 rather than 0.25000000000000006
    function r12(v) { return Math.round(v * 1e12) / 1e12; }
    s.pos = s.pos.map(r12); s.r0 = s.r0.map(r12);
    Object.keys(s.basis).forEach(function (f) { s.basis[f] = s.basis[f].map(r12); });
    s.wyck = s.mult + wyckoffLetter(ph, s, cell);
    return s;
  }
  // coordinates fixed by a site (constant) or following a free one (linked); free ones are parameters
  function coordRole(site, i) {
    if (site.free.indexOf(i) >= 0) return 'free';
    return site.free.some(function (f) { return Math.abs(site.basis[f][i]) > 1e-12; }) ? 'linked' : 'fixed';
  }
  // after a change of the free coordinates: the others from the site (r = r0 + sum u basis)
  function syncSites(ds) {
    S.phases.forEach(function (ph) {
      ph.atoms.forEach(function (at) {
        var pre = ph.key + '.' + at.label + '.', u = [ds.p[pre + 'x'], ds.p[pre + 'y'], ds.p[pre + 'z']];
        if (!u.every(Number.isFinite)) return;
        var r = C.sitePosition(at.site, u);
        ds.p[pre + 'x'] = r[0]; ds.p[pre + 'y'] = r[1]; ds.p[pre + 'z'] = r[2];
      });
    });
  }
  function syncTemplate(ph) {
    ph.atoms.forEach(function (at) {
      var pre = ph.key + '.' + at.label + '.', u = [ph.v[pre + 'x'], ph.v[pre + 'y'], ph.v[pre + 'z']];
      if (!u.every(Number.isFinite)) return;
      var r = C.sitePosition(at.site, u);
      ph.v[pre + 'x'] = r[0]; ph.v[pre + 'y'] = r[1]; ph.v[pre + 'z'] = r[2];
    });
  }

  // ---------------------------------------------------------------- parameter names
  // The solver and existing projects store size in micrometres. Public
  // controls and reports use integer nanometres, without changing the model.
  function isSizeParam(name) { return /^(?:p[0-9]+\.)?size(?:Axial|B|C)?$/.test(name); }
  function toDisplay(name,value) { return isSizeParam(name) ? value*1000 : value; }
  function fromDisplay(name,value) { return isSizeParam(name) ? value/1000 : value; }
  function dsNames(ds) {
    var out = ['zero', 'disp', 'transp'], k;
    C.ALL_INSTRUMENT_PROFILE.forEach(function (p) { out.push('inst.' + p[0]); });
    if (ds && ds.inst.bkgType === 'spline') { for (k = 0; k < ds.inst.bkgX.length; k++) out.push('bga' + k); return out; }
    var n = ds ? ds.inst.bkgN : S.settings.bkgN;
    for (k = 0; k < n; k++) out.push('bkg' + k);
    return out;
  }
  function instrumentParamsFor(ds) {
    var list = Array.isArray(ds) ? ds : [ds], names = new Set();
    list.forEach(function (d) { if(d.inst.resolutionType)C.instrumentProfileParams(d.inst.resolutionType).forEach(function(p){names.add(p[0]);}); phasesIn(d).forEach(function (ph) {
      if (C.usesSeparatedProfile(ph)) C.instrumentProfileParams(d.inst.resolutionType || ph.profileType).forEach(function (p) { names.add(p[0]); });
    }); });
    return C.ALL_INSTRUMENT_PROFILE.filter(function (p) { return names.has(p[0]); });
  }
  function profileNames(ph) { if (C.usesSeparatedProfile(ph)) return C.sampleProfileNames(ph.sg.system, ph.sg.uniqueAxis, ph.broadening, ph.ops); return (C.PROFILE_PARAMS[ph.profileType] || C.PROFILE_PARAMS.simple_pvoigt).map(function (q) { return q[0]; }); }
  function phaseNames(ph) {
    var k = ph.key + '.', out = [k + 'scale'];
    C.cellParams(ph.sg.system, ph.sg.uniqueAxis).forEach(function (c) { out.push(k + c); });
    profileNames(ph).forEach(function (n) { out.push(k + n); });
    out.push(k + 'po');
    ph.atoms.forEach(function (at) { ['x', 'y', 'z', 'occ', 'B'].forEach(function (c) { out.push(k + at.label + '.' + c); }); });
    return out;
  }
  function namesFor(ds) { var out = dsNames(ds); S.phases.forEach(function (ph) { if (!ds || hasPhase(ds, ph)) out = out.concat(phaseNames(ph)); }); return out; }
  // a parameter the fit can vary: not a coordinate set by its site, not the scale, orientation or atoms of a phase fitted
  // by Le Bail or WPPF (its intensities come from the pattern instead)
  function isVariable(name) {
    var c = C.classify(name);
    if (c.kind === 'unknown') return false;
    var ph = c.phase ? phaseByKey(c.phase) : null;
    if (ph && !C.methodAllows(ph.method, c.kind)) return false;
    if (c.kind !== 'atom' || 'xyz'.indexOf(c.comp) < 0) return true;
    var at = ph && ph.atoms.filter(function (a) { return a.label === c.atom; })[0];
    return !!at && at.site.free.indexOf('xyz'.indexOf(c.comp)) >= 0;
  }
  // the start value of a peak-shape parameter: from the default preset of that shape (Voigt_default.json …) if there is one
  // onlyIfAbsent: the preset files next to the page fill in the start values a project does not carry and must not
  // replace the ones it does, so a project opened before those files arrive keeps its own (see loadDefaultPresets).
  function setPresetDefault(type, values, onlyIfAbsent) {
    if (!C.PROFILE_PARAMS[type]) return;
    if (onlyIfAbsent && S.presetDefaults[type]) return;
    S.presetDefaults[type] = Object.assign({}, values);
  }
  function profileDefault(ph, comp) {
    var pd = C.usesSeparatedProfile(ph) ? null : S.presetDefaults[ph.profileType];
    if (pd && Number.isFinite(pd[comp])) return pd[comp];
    var list = C.usesSeparatedProfile(ph) ? C.SAMPLE_PROFILE : C.PROFILE_PARAMS[ph.profileType] || C.PROFILE_PARAMS.simple_pvoigt;
    for (var i = 0; i < list.length; i++) if (list[i][0] === comp) return list[i][1];
    return 0;
  }
  // start value and fit flag of a name a dataset does not hold yet
  function startOf(name, ds) {
    var c = C.classify(name), ph = c.phase ? phaseByKey(c.phase) : null;
    if (ph && Number.isFinite(ph.v[name])) return [ph.v[name], !!ph.fit[name]];
    switch (c.kind) {
      case 'instrument': return [C.ALL_INSTRUMENT_PROFILE.filter(function (p) { return p[0] === c.comp; })[0][1], false];
      case 'bkg': return [c.index === 0 && ds ? bkgGuess(ds) : 0, true];
      case 'bga': return [ds && ds.inst.bkgX[c.index] != null ? anchorValue(ds, ds.inst.bkgX[c.index]) : 0, true];
      case 'scale': return [1e-3, true];
      case 'po': return [1, false];
      case 'profile': return [profileDefault(ph, c.comp), false];
      case 'cell': return [/^[abc]$/.test(c.comp) ? (ph && ph.v[ph.key + '.a']) || 5 : (c.comp === 'gamma' && /hexagonal|trigonal|rhombohedral/.test(ph && ph.sg.system) ? 120 : 90), false];
      case 'atom': return [c.comp === 'occ' ? 1 : c.comp === 'B' ? 0.5 : 0, false];
      default: return [0, false];
    }
  }
  // the names of the model for a dataset: kept, remembered (they left the model and came back) or new
  function remap(ds) {
    var np = {}, nf = {}, ne = {};
    ds.mem = ds.mem || {};
    Object.keys(ds.p).forEach(function (n) { ds.mem[n] = [ds.p[n], ds.fit[n]]; });
    namesFor(ds).forEach(function (n) {
      if (own(ds.p, n)) { np[n] = ds.p[n]; nf[n] = !!ds.fit[n]; if (ds.esd && own(ds.esd, n)) ne[n] = ds.esd[n]; }
      else if (ds.mem[n]) { np[n] = ds.mem[n][0]; nf[n] = !!ds.mem[n][1]; }
      else { var d = startOf(n, ds); np[n] = d[0]; nf[n] = d[1]; }
    });
    ds.p = np; ds.fit = nf; ds.esd = ne;
    syncSites(ds);
  }
  function pruneLinks() { if (!Array.isArray(S.parameterLinks) || !S.parameterLinks.length) return; S.parameterLinks = S.parameterLinks.filter(function (l) { if (!l || !l.source || !l.target) return false; var sd = byId(l.source.datasetId), td = byId(l.target.datasetId); return !!(sd && td && own(sd.p, l.source.name) && own(td.p, l.target.name) && isVariable(l.source.name) && isVariable(l.target.name)); }); } function remapAll() { S.datasets.forEach(function (ds) { remap(ds); ds.ints = null; invalidate(ds); }); pruneLinks(); }

  // ---------------------------------------------------------------- shared flags and limits
  function shareable(name) { var k = C.classify(name).kind; return k === 'cell' || k === 'atom' || k === 'po' || k === 'profile' || k === 'zero' || k === 'disp' || k === 'transp' || k === 'instrument'; }
  // global fit: one value for all datasets (cell, atoms, orientation) or one per dataset (the profile, which follows
  // the instrument; the scale, the background and the instrument are always per dataset)
  function isShared(name) {
    if (!shareable(name)) return false;
    if (S.shared[name] != null) return !!S.shared[name];
    return ['cell', 'atom', 'po'].indexOf(C.classify(name).kind) >= 0;
  }
  function setShared(name, v) { if (!shareable(name)) return; S.shared[name] = !!v; RV.bus.emit('shared', { name: name }); }
  // a dataset that keeps its own value of a shared parameter in a global fit
  function isApart(ds, name) { return !!(ds && ds.apart && ds.apart[name]); }
  function setApart(list, names, on) {
    var n = 0;
    list.forEach(function (ds) {
      names.forEach(function (k) {
        if (!shareable(k) || isApart(ds, k) === !!on) return;
        if (on) ds.apart[k] = true; else delete ds.apart[k];
        n++;
      });
    });
    if (n) RV.bus.emit('shared', { names: names });
    return n;
  }
  /* How a name is fitted in a global fit of list: the datasets that hold it, those that share one value (empty: none,
     each has its own) and those that keep their own value. */
  function shareOf(name, list) {
    var held = list.filter(function (ds) { return own(ds.p, name); }), sh = isShared(name) ? held.filter(function (ds) { return !isApart(ds, name); }) : [];
    if (sh.length < 2) sh = [];
    return { held: held, shared: sh, alone: held.filter(function (ds) { return sh.indexOf(ds) < 0; }) };
  }
  function limitsOf(name, v) {
    var L = S.limits[name];
    return L ? [L[0], L[1]] : C.defaultLimits(name, Number.isFinite(v) ? v : 1);
  }
  function setLimit(name, lo, hi) { if(Array.isArray(lo)){hi=lo[1];lo=lo[0];} if(!(lo<hi))throw new Error('Invalid parameter limits for '+name); S.limits[name] = [lo, hi]; }
  function clearLimit(name) { delete S.limits[name]; }

  // ---------------------------------------------------------------- datasets
  function percentile(arr, f) {
    var n = arr.length, step = Math.max(1, Math.floor(n / 4000)), a = [];
    for (var i = 0; i < n; i += step) if (Number.isFinite(arr[i])) a.push(arr[i]);
    if (!a.length) return 0;
    a.sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.floor(f * a.length))];
  }
  function bkgGuess(ds) { return Math.max(0, percentile(rangeY(ds), 0.1)); }
  // the background at an anchor: the mean of the 7 points about the lowest point within a fifth of the anchor spacing,
  // excluded points left out (powder5's autoFindSplinePoints)
  function anchorValue(ds, x) {
    var t = ds.tth, y = ds.y, n = t.length, j = Math.min(n - 1, Math.max(0, lowerBound(t, x)));
    if (j > 0 && Math.abs(t[j - 1] - x) < Math.abs(t[j] - x)) j--;
    var xs = ds.inst.bkgX, k = xs.indexOf(x), gap = Infinity;
    if (k > 0) gap = Math.min(gap, x - xs[k - 1]);
    if (k >= 0 && k < xs.length - 1) gap = Math.min(gap, xs[k + 1] - x);
    var half = Number.isFinite(gap) ? 0.2 * gap : 10 * (ds.step || 0.02), best = j, bv = Infinity;
    for (var i = Math.max(0, lowerBound(t, x - half)); i < n && t[i] <= x + half; i++) {
      if (excluded(ds.inst, t[i]) || !Number.isFinite(y[i])) continue;
      if (y[i] < bv) { bv = y[i]; best = i; }
    }
    var sum = 0, cnt = 0;
    for (i = Math.max(0, best - 3); i < Math.min(n, best + 4); i++) if (!excluded(ds.inst, t[i]) && Number.isFinite(y[i])) { sum += y[i]; cnt++; }
    return cnt ? sum / cnt : (Number.isFinite(y[j]) ? y[j] : 0);
  }
  /* Anchors for a spline background, as powder5 places them: the two ends of the fitted range, and in each of n - 2
     equal chunks between them the lowest point (searched again within 30 % of the chunk width about the first minimum),
     never inside an excluded region. Returns sorted 2theta values. */
  function autoAnchors(ds, nAnch) {
    var lo = ds.inst.tthMin, hi = ds.inst.tthMax, t = ds.tth, y = ds.y, inner = Math.max(0, (nAnch | 0) - 2), out = [lo, hi];
    var a = lowerBound(t, lo), b = lowerBound(t, hi + 1e-9), len = b - a;
    if (inner > 0 && len > inner + 6) {
      var chunk = Math.floor(len / inner);
      for (var q = 0; q < inner; q++) {
        var c0 = a + q * chunk, c1 = q === inner - 1 ? b - 1 : a + (q + 1) * chunk, m0 = -1, v0 = Infinity, i;
        if (c0 >= c1) continue;
        for (i = c0; i < c1; i++) if (!excluded(ds.inst, t[i]) && y[i] < v0) { v0 = y[i]; m0 = i; }
        if (m0 < 0) continue;
        var r = 0.3 * (t[Math.max(c0, c1 - 1)] - t[c0]), best = m0, bv = Infinity;
        for (i = c0; i < c1; i++) if (!excluded(ds.inst, t[i]) && Math.abs(t[i] - t[m0]) <= r && y[i] < bv) { bv = y[i]; best = i; }
        if (t[best] > lo && t[best] < hi) out.push(t[best]);
      }
    }
    out.sort(function (p, q2) { return p - q2; });
    return out.filter(function (x, k) { return k === 0 || x - out[k - 1] > 1e-6; });
  }
  function rangeY(ds) {
    var lo = ds.inst.tthMin, hi = ds.inst.tthMax, out = [];
    for (var i = 0; i < ds.tth.length; i++) if (ds.tth[i] >= lo && ds.tth[i] <= hi) out.push(ds.y[i]);
    return out;
  }
// The MEDIAN step, not (last - first) / (n - 1). The mean is only the real step on a gap-free, uniformly
// stepped axis: excluded regions are removed from the data, so the span stays while n falls and the mean
// rises -- excluding a third of a pattern raised the derived minimum FWHM by half and clamped peaks the
// data could resolve, quietly. The median ignores the few large differences a gap contributes, and it is
// also right for the variable-step axes some formats carry. On a uniform axis the two agree.
  // The MEDIAN step, not (last - first) / (n - 1). The mean is only the real step on a gap-free, uniformly
  // stepped axis: excluded regions are removed from the data, so the span stays while n falls and the mean
  // rises -- excluding a third of a pattern raised the derived minimum FWHM by half and clamped peaks the
  // data could resolve, quietly. The median ignores the few large differences a gap contributes, and it is
  // also right for the variable-step axes some formats carry. On a uniform axis the two agree.
  function medianStep(t) {
    var d = [];
    for (var i = 1; i < t.length; i++) if (t[i] > t[i - 1]) d.push(t[i] - t[i - 1]);
    if (!d.length) return 0;
    d.sort(function (a, b) { return a - b; });
    return d[d.length >> 1];
  }

  // {name: true} from a list of names or a map (projects, restore points)
  function apartOf(a) {
    var o = {};
    if (Array.isArray(a)) a.forEach(function (n) { if (typeof n === 'string') o[n] = true; });
    else if (a && typeof a === 'object') Object.keys(a).forEach(function (n) { if (a[n]) o[n] = true; });
    return o;
  }
  function makeDataset(raw) {
    var tth = ArrayBuffer.isView(raw.tth)?raw.tth:Float64Array.from(raw.tth), y = ArrayBuffer.isView(raw.y)?raw.y:Float64Array.from(raw.y), n = tth.length;
    var inst = cleanInst(Object.assign({}, S.settings.inst, { bkgN: S.settings.bkgN, bkgX: [], excl: [], exclOff: [] }, raw.inst || {}));
    if (!(inst.tthMin < inst.tthMax)) { inst.tthMin = tth[0]; inst.tthMax = tth[n - 1]; }
    var ds = { id: S.nextId++, dataKey:raw.dataKey || 'data-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2), color: /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : null, name: raw.name || 'data', tth: tth, y: y, sig: raw.sig ? (ArrayBuffer.isView(raw.sig)?raw.sig:Float64Array.from(raw.sig)) : null, weights: raw.weights ? (ArrayBuffer.isView(raw.weights)?raw.weights:Float64Array.from(raw.weights)) : null, inst: inst,
               p: raw.p ? Object.assign({}, raw.p) : {}, fit: raw.fit ? Object.assign({}, raw.fit) : {}, esd: raw.esd ? Object.assign({}, raw.esd) : {},
               calculations: cleanCalculations(raw.calculations), stats: raw.stats || null, mem: raw.mem ? Object.assign({}, raw.mem) : null, calc: null, ints: null, sim: raw.sim || null, step: medianStep(tth), apart: apartOf(raw.apart),
               phases: Array.isArray(raw.phases) ? raw.phases.filter(function (k) { return !!phaseByKey(k); }) : S.phases.map(function (ph) { return ph.key; }) };
    if (inst.bkgType === 'spline' && inst.bkgX.length < 2) inst.bkgX = autoAnchors(ds, S.settings.nAnchors);
    remap(ds);
    return ds;
  }
  // new datasets go to the top of the list (as in Yappari) and the first of them is selected
  function addDatasets(raws, opts) { return insertDatasets(raws.map(makeDataset), opts); }
  function insertDatasets(made, opts) {
    opts = opts || {};
    made.forEach(function(ds){if(ds.inst.bkgType!==backgroundType())updateInstrument(ds,{bkgType:backgroundType()});});
    Array.prototype.unshift.apply(S.datasets, made);
    if (S.phases.length && opts.estimate !== false) made.forEach(function (ds) { if (!ds.sim) estimateScales(ds); });
    RV.bus.emit('datasets');
    if (made.length && opts.select !== false) selectIds(opts.selectAll ? made.map(function (d) { return d.id; }) : [made[0].id]);
    return made;
  }
  function byId(id) { for (var i = 0; i < S.datasets.length; i++) if (S.datasets[i].id === id) return S.datasets[i]; return null; }
  function removeDatasets(ids) {
    var set = new Set(ids);
    S.datasets = S.datasets.filter(function (d) { return !set.has(d.id); });
    ids.forEach(function (id) { S.sel.delete(id); });
    RV.bus.emit('datasets'); RV.bus.emit('selection');
  }
  function rename(id, name) { var d = byId(id); if (d && name) { d.name = name; RV.bus.emit('datasets'); } }
  function move(id, beforeId) {
    var d = byId(id);
    if (!d || id === beforeId) return;
    S.datasets.splice(S.datasets.indexOf(d), 1);
    var at = beforeId == null ? S.datasets.length : S.datasets.indexOf(byId(beforeId));
    S.datasets.splice(at < 0 ? S.datasets.length : at, 0, d);
    RV.bus.emit('datasets');
  }
  function backgroundRange(ds, inst) {
    var first=-1,last=-1;
    for(var i=0;i<ds.tth.length;i++)if(ds.tth[i]>=inst.tthMin && ds.tth[i]<=inst.tthMax && Number.isFinite(ds.y[i])){if(first<0)first=i;last=i;}
    return first>=0 && last>first ? [ds.tth[first],ds.tth[last]] : null;
  }
  // The Chebyshev coordinate is defined by the endpoints of the fitted data.
  // Re-express the same polynomial when those endpoints change, including a
  // background restored from another method's parameter bank.
  function rebaseBackground(ds, from, to) {
    if(!from || from.bkgType!=='cheb' || to.bkgType!=='cheb')return;
    var oldRange=backgroundRange(ds,from),newRange=backgroundRange(ds,to),n=Math.min(from.bkgN,to.bkgN);
    if(!oldRange || !newRange || !n || oldRange[0]===newRange[0] && oldRange[1]===newRange[1])return;
    var scale=(newRange[1]-newRange[0])/(oldRange[1]-oldRange[0]);
    var offset=(newRange[0]+newRange[1]-oldRange[0]-oldRange[1])/(oldRange[1]-oldRange[0]);
    var prev=new Float64Array(n),term=new Float64Array(n),out=new Float64Array(n);
    term[0]=1;
    for(var k=0;k<n;k++){
      var value=ds.p['bkg'+k] || 0;
      for(var j=0;j<n;j++)out[j]+=value*term[j];
      if(k===n-1)break;
      var next=new Float64Array(n),factor=k===0?1:2;
      for(j=0;j<n;j++){
        next[j]+=factor*offset*term[j]-(k===0?0:prev[j]);
        if(j===0){if(n>1)next[1]+=factor*scale*term[j];}
        else {next[j-1]+=.5*factor*scale*term[j];if(j+1<n)next[j+1]+=.5*factor*scale*term[j];}
      }
      prev=term;term=next;
    }
    for(k=0;k<n;k++)ds.p['bkg'+k]=out[k];
  }
  // instrument, range and background of some datasets; another kind or number of background terms changes their names.
  // The values of spline anchors that stay where they were are kept; a new anchor starts at the data.
  function updateInstrument(ds, inst) {
    var old = ds.inst, oldX = old.bkgX.slice(), oldVals = {};
    oldX.forEach(function (x, k) { if (own(ds.p, 'bga' + k)) oldVals[x] = [ds.p['bga' + k], ds.fit['bga' + k]]; });
    ds.inst = cleanInst(Object.assign({}, old, inst));
    if (!(ds.inst.tthMin < ds.inst.tthMax)) { ds.inst.tthMin = old.tthMin; ds.inst.tthMax = old.tthMax; }
    rebaseBackground(ds,old,ds.inst);
    if (ds.inst.bkgType === 'spline' && ds.inst.bkgX.length < 2) ds.inst.bkgX = autoAnchors(ds, S.settings.nAnchors);
    var sameX = ds.inst.bkgX.length === oldX.length && ds.inst.bkgX.every(function (x, k) { return x === oldX[k]; });
    if (ds.inst.bkgN !== old.bkgN || ds.inst.bkgType !== old.bkgType || !sameX) {
      if (!sameX) {
        // the anchors are named by their rank: drop the old names, keep the values of the anchors that did not move
        var mem = ds.mem || {};
        Object.keys(mem).forEach(function (n) { if (/^bga\d+$/.test(n)) delete mem[n]; });
        Object.keys(ds.p).forEach(function (n) { if (/^bga\d+$/.test(n)) { delete ds.p[n]; delete ds.fit[n]; } });
        ds.inst.bkgX.forEach(function (x, k) { if (oldVals[x]) { ds.p['bga' + k] = oldVals[x][0]; ds.fit['bga' + k] = oldVals[x][1]; } });
      }
      remap(ds);
    }
    ds.stats = null; ds.esd = {}; ds.ints = null;
    invalidate(ds);
  }
  // One explicit project choice; dataset order and selection do not control it.
  function backgroundType() { return S.settings.inst.bkgType === 'spline' ? 'spline' : 'cheb'; }
  function normalizeBackgrounds(type) {
    S.datasets.forEach(function(ds){if(ds.inst.bkgType!==type)updateInstrument(ds,{bkgType:type});});
  }
  function setInstrument(list, inst) {
    list.forEach(function(ds){updateInstrument(ds,inst);});
    if(own(inst,'bkgType'))normalizeBackgrounds(inst.bkgType==='spline'?'spline':'cheb');
    var keep = Object.assign({}, inst);
    delete keep.tthMin; delete keep.tthMax; delete keep.bkgX; delete keep.excl; delete keep.exclOff;
    setSetting('inst', Object.assign(cleanInst(S.settings.inst), keep, { bkgX: [], excl: [], exclOff: [] }));
    if (inst.bkgN != null) setSetting('bkgN', inst.bkgN);
    RV.bus.emit('data'); RV.bus.emit('params', {});
  }

  // Move one spline anchor without assigning its height/fit flag to a different
  // point when the sorted anchor indices change. Saved method banks stay intact.
  function moveBackgroundAnchor(ds, index, x, y) {
    if (!ds || ds.inst.bkgType !== 'spline' || !Number.isInteger(index) || index < 0 || index >= ds.inst.bkgX.length ||
        !Number.isFinite(x) || !Number.isFinite(y) || x < ds.tth[0] || x > ds.tth[ds.tth.length - 1]) return -1;
    var anchors = ds.inst.bkgX.map(function (a, k) { return { x:k === index ? x : a, y:k === index ? y : ds.p['bga'+k], fit:!!ds.fit['bga'+k], moved:k === index }; });
    anchors.sort(function (a,b) { return a.x-b.x; });
    if (anchors.some(function (a,k) { return k && a.x-anchors[k-1].x <= 1e-6; })) return -1;
    setInstrument([ds], { bkgX:anchors.map(function(a){return a.x;}) });
    var at = -1;
    anchors.forEach(function (a,k) { ds.p['bga'+k] = a.y; ds.fit['bga'+k] = a.fit; if(a.moved)at=k; });
    invalidate(ds); RV.bus.emit('params', {});
    return at;
  }

  // Le Bail/WPPF do not own an atomic model. Display the Rietveld bank when
  // available; new atoms and datasets without a Rietveld bank use their starts.
  function atomicValues(ds) {
    var out = {}, bank = ds && S.calculation !== 'rietveld' && ds.calculations && ds.calculations.rietveld;
    S.phases.forEach(function (ph) { ph.atoms.forEach(function (at) { ['x','y','z','occ','B'].forEach(function (comp) {
      var name = ph.key+'.'+at.label+'.'+comp;
      out[name] = bank && Number.isFinite(bank.p[name]) ? bank.p[name] : ds && Number.isFinite(ds.p[name]) ? ds.p[name] : ph.v[name];
    }); }); });
    return out;
  }

  // ---------------------------------------------------------------- selection
  function selectIds(ids, keepAnchor) {
    S.sel = new Set(ids); S.focus = null;
    if (!keepAnchor) S.anchor = ids.length ? ids[0] : null;
    RV.bus.emit('selection');
  }
  function toggle(id) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); S.anchor = id; S.focus = null; RV.bus.emit('selection'); }
  function setFocus(id) { if (S.sel.has(id) && S.focus !== id) { S.focus = id; RV.bus.emit('selection'); } }
  function range(id) {
    var a = S.datasets.findIndex(function (d) { return d.id === S.anchor; }), b = S.datasets.findIndex(function (d) { return d.id === id; });
    if (a < 0) a = b;
    selectIds(S.datasets.slice(Math.min(a, b), Math.max(a, b) + 1).map(function (d) { return d.id; }), true);
  }
  function selectAll() { selectIds(S.datasets.map(function (d) { return d.id; }), true); }
  function selected() { return S.datasets.filter(function (d) { return S.sel.has(d.id); }); }
  function first() {
    if (S.focus != null && S.sel.has(S.focus)) { var f = byId(S.focus); if (f) return f; }
    for (var i = 0; i < S.datasets.length; i++) if (S.sel.has(S.datasets[i].id)) return S.datasets[i];
    return null;
  }

  // ---------------------------------------------------------------- the phases of each dataset
  /* ds.phases: the keys of the phases the dataset holds (every phase unless taken out). A phase a dataset does not hold
     has no names there and adds nothing to its pattern; its values come back if it is put in again. */
  function hasPhase(ds, ph) { return !!ds && !!ph && Array.isArray(ds.phases) && ds.phases.indexOf(ph.key) >= 0; }
  function phasesIn(ds) { return S.phases.filter(function (ph) { return hasPhase(ds, ph); }); }
  function participatingPhases(ds){return phasesIn(ds).filter(function(p){return !S.disabledPhases.includes(p.key);});}
  function holdersOf(ph, list) { return (list || S.datasets).filter(function (ds) { return hasPhase(ds, ph); }); }
  // the phase put in (on) or taken out of the datasets of list; returns how many changed
  function setPhaseIn(list, ph, on) {
    var changed = 0;
    list.forEach(function (ds) {
      if (hasPhase(ds, ph) === !!on) return;
      var remembered = !!(ds.mem && ds.mem[ph.key + '.scale']);
      // the keys in the order of the phases
      var keys = on ? ds.phases.concat([ph.key]) : ds.phases.filter(function (k) { return k !== ph.key; });
      ds.phases = S.phases.filter(function (p) { return keys.indexOf(p.key) >= 0; }).map(function (p) { return p.key; });
      remap(ds);
      if (on && ph.method === 'rietveld' && !ds.sim && !remembered) estimateScales(ds, ph.key);
      ds.stats = null; ds.esd = {}; ds.ints = null;
      invalidate(ds);
      changed++;
    });
    if (changed) { pruneLinks(); S.version++; RV.bus.emit('phases'); RV.bus.emit('datasets'); RV.bus.emit('params', {}); }
    return changed;
  }

  // ---------------------------------------------------------------- phases
  function currentPhase() { return phaseByKey(S.phaseSel) || S.phases[0] || null; }
  function selectPhase(key) { if (phaseByKey(key) && S.phaseSel !== key) { S.phaseSel = key; RV.bus.emit('phaseSel'); } }
  function cleanLabel(s, used) {
    var b = String(s || '').trim().replace(/[\s.]+/g, '_').replace(/[^\w+\-'()]/g, '') || 'X', l = b, k = 1;
    while (used.has(l)) l = b + '_' + (++k);
    used.add(l);
    return l;
  }
  /* o = { name, sg (from resolveSG), cell {a ... gamma}, atoms [{label, type, x, y, z, occ, B}], profileType, poDir, color }
     The positions are put exactly on their sites: a coordinate typed as 0.3333 becomes 1/3 where the site says so.
     The internal method field mirrors the active calculation; it is not a phase setting. */
  function makePhase(o) {
    var key = 'p' + S.nextPhase++, sg = o.sg, atoms = o.atoms || [];
    var method = S.calculation || 'lebail';
    var ph = { key: key, color: /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : null, name: o.name || ('phase ' + key.slice(1)), method: method, sg: { number: sg.number, symbol: sg.symbol, hall: sg.hall, system: sg.system, laue: sg.laue, setting: sg.setting, uniqueAxis: sg.uniqueAxis },
               ops: sg.ops, wyckoff: sg.wyckoff, profileType: o.profileType || 'gsas_cw', separatedProfile: o.separatedProfile === true || !o.profileType || o.profileType==='gsas_cw', broadening: RVCore.broadeningConfig(o.broadening), poDir: (o.poDir || [0, 0, 1]).slice(), constraints:JSON.parse(JSON.stringify(o.constraints || [])), restraints:RV.restraintsOf(o.restraints), atoms: [], v: {}, fit: {} };
    var cell = normaliseCell(o.cell || { a: 5 }, sg.system, sg.uniqueAxis) || normaliseCell({ a: 5 }, sg.system, sg.uniqueAxis), k = key + '.';
    C.cellParams(sg.system, sg.uniqueAxis).forEach(function (c) { ph.v[k + c] = cell[c]; ph.fit[k + c] = false; });
    ph.v[k + 'scale'] = 1e-3; ph.fit[k + 'scale'] = true;
    profileNames(ph).forEach(function (n) { ph.v[k + n] = profileDefault(ph, n); ph.fit[k + n] = false; });
    ph.v[k + 'po'] = 1; ph.fit[k + 'po'] = false;
    var used = new Set();
    atoms.forEach(function (a) { addAtomTo(ph, a, cell, used); });
    return ph;
  }
  // Rietveld needs a structure; Le Bail and WPPF only the cell and the space group
  function canRietveld(ph) { return !!ph && ph.atoms.length > 0; }
  function methodLabel(m) { return C.METHOD_LABELS[m] || m; }
  /* The method of a phase. Every dataset keeps the values of the phase; what changes is what the fit varies and where
     the intensities come from. To Rietveld, the scales are estimated from the patterns first. */
  function setMethod(ph, m) { return setCalculation(m); }
  function calculationIssue(list) {
    list = list || selected();
    var empty = list.filter(function (d) { return !S.phases.some(function (p) { return hasPhase(d, p) && !S.disabledPhases.includes(p.key); }); });
    if (empty.length) return 'No enabled phase for '+empty.slice(0,5).map(function(d){return d.name;}).join(', ')+(empty.length>5?' and '+(empty.length-5)+' more':'')+'. Assign phases in Datasets or enable them in Method.';
    if (S.calculation !== 'rietveld') return '';
    try { if(typeof AtomicConstraints!=='undefined')S.phases.filter(function(p){return list.some(function(d){return hasPhase(d,p) && !S.disabledPhases.includes(p.key);});}).forEach(function(p){AtomicConstraints.definitions(p);}); } catch(e){return 'Atomic constraints: '+e.message;}
    var missing = S.phases.filter(function (p) { return !S.disabledPhases.includes(p.key) && !canRietveld(p) && list.some(function (d) { return hasPhase(d, p); }); });
    if (missing.length) return 'Rietveld needs atoms for ' + missing.map(function (p) { return p.name; }).join(', ') + '. Add an atomic model in Phases, change assignments in Datasets, or choose Le Bail / WPPF in Solve.';
    var factors = [];
    list.forEach(function (ds) {
      var neutron = ds.inst.radiation === 'neutron';
      participatingPhases(ds).forEach(function (ph) { ph.atoms.forEach(function (at) {
        var f = scatterer(at.type);
        if (neutron ? !f.nlabel : !f.xray) {
          var label = (neutron ? 'neutron' : 'X-ray') + ': ' + ph.name + '/' + at.label + ' (' + at.type + ')';
          if (factors.indexOf(label) < 0) factors.push(label);
        }
      }); });
    });
    if(factors.length)return 'Missing scattering factors (' + factors.join('; ') + '). Load the required tables or correct the atom types before Rietveld fitting.';
    for(var j=0;j<list.length;j++){var anomalous=anomalousFor(list[j]);if(anomalous.error)return 'Anomalous scattering: '+anomalous.error;}
    return '';
  }
  function addAtomTo(ph, a, cell, used) {
    used = used || new Set(ph.atoms.map(function (x) { return x.label; }));
    var label = cleanLabel(a.label || ((elementOf(a.type) || 'X') + (ph.atoms.length + 1)), used), pre = ph.key + '.' + label + '.';
    var site = siteOf(ph, [a.x, a.y, a.z], cell);
    ph.atoms.push({ label: label, type: a.type || elementOf(label) || label, site: site });
    ph.v[pre + 'x'] = site.pos[0]; ph.v[pre + 'y'] = site.pos[1]; ph.v[pre + 'z'] = site.pos[2];
    ph.v[pre + 'occ'] = Number.isFinite(a.occ) ? a.occ : 1;
    ph.v[pre + 'B'] = Number.isFinite(a.B) ? a.B : 0.5;
    ['x', 'y', 'z', 'occ', 'B'].forEach(function (c) { ph.fit[pre + c] = false; S.datasets.forEach(function (ds) { if (ds.mem) delete ds.mem[pre + c]; Object.keys(ds.calculations || {}).forEach(function (m) { var b = ds.calculations[m]; if (b) { delete b.p[pre + c]; delete b.fit[pre + c]; delete b.esd[pre + c]; } }); }); });
    return label;
  }
  // ids: the datasets that hold the new phase (default: every dataset)
  function addPhase(ph, ids) {
    S.phases.push(ph);
    S.phaseSel = ph.key;
    S.version++;
    S.datasets.forEach(function (ds) {
      if (!ids || ids.indexOf(ds.id) >= 0) ds.phases.push(ph.key);
      remap(ds);
      if (ph.method === 'rietveld' && !ds.sim && hasPhase(ds, ph)) estimateScales(ds, ph.key);
      clearFit(ds, true);
    });
    RV.bus.emit('phases'); RV.bus.emit('phaseSel'); RV.bus.emit('params', {});
  }
  function removePhase(key) {
    S.phases = S.phases.filter(function (p) { return p.key !== key; });
    S.datasets.forEach(function (ds) {
      ds.phases = ds.phases.filter(function (k) { return k !== key; });
      Object.keys(ds.apart).forEach(function (n) { if (n.indexOf(key + '.') === 0) delete ds.apart[n]; });
      clearFit(ds, true);
    });
    if (S.phaseSel === key) S.phaseSel = S.phases.length ? S.phases[0].key : null;
    S.version++;
    remapAll();
    RV.bus.emit('phases'); RV.bus.emit('phaseSel'); RV.bus.emit('params', {});
  }
  // an edit of the phase definition (space group, profile, atoms list): names and sites follow, every pattern is redone
  function phaseChanged(ph) {
    // GSAS-II relationships that no longer apply (a site or the space group changed, an atom left) are trimmed
    if (ph && ph.constraints && ph.constraints.length && typeof AtomicConstraints !== 'undefined') {
      var pr = AtomicConstraints.prune(ph);
      ph.constraints = pr.constraints;
      if (pr.dropped.length) { pr.dropped.forEach(function (m) { RV.ui.log('Atomic constraints of ' + ph.name + ': ' + m + '.', 'warn'); }); RV.ui.toast(pr.dropped.length + ' constraint term' + (pr.dropped.length === 1 ? '' : 's') + ' of ' + ph.name + ' no longer apply (site symmetry or missing atom) and were removed. See the Log.', 'warn'); }
    }
    // restraint rules that name an atom the phase no longer has are removed
    if (ph && ph.restraints && typeof AtomRestraints !== 'undefined') {
      var rp = AtomRestraints.prune(ph.atoms, ph.restraints);
      if (rp.dropped.length) { ph.restraints = Object.assign({}, ph.restraints, { text: rp.text }); rp.dropped.forEach(function (m) { RV.ui.log('Restraints of ' + ph.name + ': removed "' + m + '" (an atom it names is gone).', 'warn'); }); RV.ui.toast(rp.dropped.length + ' restraint rule' + (rp.dropped.length === 1 ? '' : 's') + ' of ' + ph.name + ' removed: ' + (rp.dropped.length === 1 ? 'it names' : 'they name') + ' a missing atom (see the Log).', 'warn'); }
    }
    S.datasets.forEach(function (d) { d.stats = null; d.esd = {}; if (hasPhase(d, ph)) Object.keys(d.calculations || {}).forEach(function (m) { var b = d.calculations[m]; if (b) { b.stats = null; b.esd = {}; b.ints = null; } }); });
    S.version++;
    remapAll();
    RV.bus.emit('phases'); RV.bus.emit('params', {});
  }
  function renameKeys(map, from, to) {
    if (!map) return;
    Object.keys(map).forEach(function (n) { if (n.indexOf(from) === 0) { map[to + n.slice(from.length)] = map[n]; delete map[n]; } });
  }
  function renameAtom(ph, oldLabel, newLabel) {
    var used = new Set(ph.atoms.map(function (a) { return a.label; }));
    used.delete(oldLabel);
    var label = cleanLabel(newLabel, used), from = ph.key + '.' + oldLabel + '.', to = ph.key + '.' + label + '.';
    if (label === oldLabel) return oldLabel;
    var before = ph.atoms.map(function (a) { return a.label; });
    ph.atoms.forEach(function (a) { if (a.label === oldLabel) a.label = label; });
    (ph.constraints || []).forEach(function(c){c.atoms=c.atoms.map(function(a){return a===oldLabel?label:a;});});
    if(ph.restraints && ph.restraints.text)ph.restraints.text=AtomRestraints.relabel(before,ph.restraints.text,oldLabel,label); (S.parameterLinks || []).forEach(function (l) { if (l.source && l.source.name.indexOf(from) === 0) l.source.name = to + l.source.name.slice(from.length); if (l.target && l.target.name.indexOf(from) === 0) l.target.name = to + l.target.name.slice(from.length); });
    [ph.v, ph.fit, S.shared, S.limits].forEach(function (m) { renameKeys(m, from, to); });
    S.datasets.forEach(function (ds) { [ds.p, ds.fit, ds.esd, ds.mem, ds.apart].forEach(function (m) { renameKeys(m, from, to); });Object.keys(ds.calculations || {}).forEach(function(k){var bank=ds.calculations[k];[bank.p,bank.fit,bank.esd,bank.apart].forEach(function(m){if(m)renameKeys(m,from,to);});bank.stats=null;bank.ints=null;}); });
    phaseChanged(ph);
    return label;
  }
  // returns true when the phase lost its last atom and went from Rietveld to Le Bail
  function removeAtom(ph, label) {
    ph.atoms = ph.atoms.filter(function (a) { return a.label !== label; });
    var gone=[];ph.constraints=AtomicConstraints.withoutAtom(ph.constraints || [],label,gone);
    if(gone.length){gone.forEach(function(t){RV.ui.log('Atomic constraints of '+ph.name+': '+t+' dropped, its total no longer applies without '+label+'.','warn');});RV.ui.toast(gone.length+' constraint equation'+(gone.length===1?'':'s')+' of '+ph.name+' dropped with '+label+': re-enter '+(gone.length===1?'it':'them')+' for the remaining atoms if wanted (see the Log).','warn');}
    var switched = false;
    phaseChanged(ph);
    return switched;
  }
  /* The atoms of a phase replaced by the sites of a structure solution (the Solve tab), in the phase and in every
     dataset: the old ones leave the values, fit flags, uncertainties, the memory of names, the limits and the shared
     flags, so the new ones start from the solution rather than from what an atom of the same label held before.
     atoms: [{ label, type, x, y, z, occ, B }]; cell: the cell the positions were found in (for the site tolerance). */
  function replaceAtoms(ph, atoms, cell) {
    function mine(n) { var c = C.classify(n); return c.kind === 'atom' && c.phase === ph.key; }
    function drop(m) { if (m) Object.keys(m).forEach(function (n) { if (mine(n)) delete m[n]; }); }
    [ph.v, ph.fit, S.shared, S.limits].forEach(drop);
    S.datasets.forEach(function (ds) { [ds.p, ds.fit, ds.esd, ds.mem, ds.apart].forEach(drop); });
    S.datasets.forEach(function (ds) { Object.keys(ds.calculations || {}).forEach(function (m) {
      var b = ds.calculations[m]; [b.p, b.fit, b.esd].forEach(drop); b.stats = null; b.ints = null;
    }); });
    ph.atoms = [];ph.constraints=[]; S.parameterLinks = S.parameterLinks.filter(function (l) { return !mine(l.source.name) && !mine(l.target.name); });
    var used = new Set(), c = cell || cellOf(ph, ph.v);
    atoms.forEach(function (a) { addAtomTo(ph, a, c, used); });
    S.datasets.forEach(function (ds) { ds.stats = null; ds.esd = {}; });
    phaseChanged(ph);
  }
  // a new space group: sites again from the start positions; atoms keep their coordinates
  function setPhaseSG(ph, sg) {
    var k = ph.key + '.', cells = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'];
    var oldCell = cellOf(ph, ph.v), oldDs = S.datasets.map(function (d) { return cellOf(ph, d.p); });
    var oldBanks = S.datasets.map(function (d) {
      var cells = {}; Object.keys(d.calculations || {}).forEach(function (m) { cells[m] = cellOf(ph, d.calculations[m].p); }); return cells;
    });
    ph.sg = { number: sg.number, symbol: sg.symbol, hall: sg.hall, system: sg.system, laue: sg.laue, setting: sg.setting, uniqueAxis: sg.uniqueAxis };
    ph.ops = sg.ops; ph.wyckoff = sg.wyckoff;
    function constrain(v, fit, old) {
      var full = normaliseCell(old || { a: 5 }, sg.system, sg.uniqueAxis), free = C.cellParams(sg.system, sg.uniqueAxis);
      cells.forEach(function (c) { v[k + c] = full[c]; if (free.indexOf(c) < 0) fit[k + c] = false; });
    }
    constrain(ph.v, ph.fit, oldCell);
    S.datasets.forEach(function (d, i) {
      if (hasPhase(d, ph)) constrain(d.p, d.fit, oldDs[i]);
      // A new symmetry changes every calculation of this phase. Seed its cell
      // from the constrained live values, never from an obsolete metric.
      Object.keys(d.calculations || {}).forEach(function (m) {
        var b = d.calculations[m];
        if (oldBanks[i][m]) constrain(b.p, b.fit || {}, oldBanks[i][m]);
      });
    });
    var cell = cellOf(ph, ph.v);
    ph.atoms.forEach(function (at) {
      var pre = k + at.label + '.';
      at.site = siteOf(ph, [ph.v[pre + 'x'], ph.v[pre + 'y'], ph.v[pre + 'z']], cell);
      ph.v[pre + 'x'] = at.site.pos[0]; ph.v[pre + 'y'] = at.site.pos[1]; ph.v[pre + 'z'] = at.site.pos[2];
    });
    phaseChanged(ph);
  }

  /* The phase carried to another space group by the change of basis (P, p) (js/sg_convert.js): the space group, the cell of
     the starting model, of every dataset holding the phase and of each of their saved calculations, and the atoms of each,
     rebuilt from its OWN values of the source atoms, so refined positions and B stay refined. conv: SGConvert.convertStructure
     of the starting model (its atoms define the new sites and names). The preferred-orientation direction and the uniaxial
     broadening axes follow the basis (h' = h P). Fit flags follow the source atoms and the cell; uncertainties and results are
     cleared, and atomic constraints and parameter links of the old atoms are removed, since their atoms no longer exist.
     Returns what was changed, for the message. */
  function convertPhase(ph, sg, conv, P, p) {
    var K = SGConvert, k = ph.key + '.', oldOps = ph.ops, oldLabels = ph.atoms.map(function (a) { return a.label; });
    var CELLS = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'], free = C.cellParams(sg.system, sg.uniqueAxis);
    var maps = [{ v: ph.v, fit: ph.fit, template: true }], nDatasets = 0, nBanks = 0;
    S.datasets.forEach(function (d) {
      if (hasPhase(d, ph)) { maps.push({ v: d.p, fit: d.fit }); nDatasets++; }
      Object.keys(d.calculations || {}).forEach(function (m) {
        var b = d.calculations[m];
        if (b && b.p && Number.isFinite(b.p[k + 'a'])) { if (!b.fit) b.fit = {}; maps.push({ v: b.p, fit: b.fit }); nBanks++; }
      });
    });
    // what each holds now, read with the old symmetry before any name changes
    maps.forEach(function (m) {
      m.cell = cellOf(ph, m.v) || cellOf(ph, ph.v);
      m.cellFit = CELLS.some(function (c) { return !!m.fit[k + c]; });
      m.atoms = {};
      oldLabels.forEach(function (l) {
        var pre = k + l + '.', val = function (c) { return Number.isFinite(m.v[pre + c]) ? m.v[pre + c] : ph.v[pre + c]; };
        m.atoms[l] = { xyz: [val('x'), val('y'), val('z')], occ: val('occ'), B: val('B'), fitXYZ: ['x', 'y', 'z'].some(function (c) { return !!m.fit[pre + c]; }), fitOcc: !!m.fit[pre + 'occ'], fitB: !!m.fit[pre + 'B'] };
      });
    });
    function mine(n) { var c = C.classify(n); return c.kind === 'atom' && c.phase === ph.key; }
    function drop(m) { if (m) Object.keys(m).forEach(function (n) { if (mine(n)) delete m[n]; }); }
    [ph.v, ph.fit, S.shared, S.limits].forEach(drop);
    S.datasets.forEach(function (ds) {
      [ds.p, ds.fit, ds.esd, ds.mem, ds.apart].forEach(drop);
      Object.keys(ds.calculations || {}).forEach(function (m) { var b = ds.calculations[m]; [b.p, b.fit, b.esd].forEach(drop); b.stats = null; b.ints = null; b.esd = {}; });
    });
    var links = S.parameterLinks.length;
    S.parameterLinks = S.parameterLinks.filter(function (l) { return !mine(l.source.name) && !mine(l.target.name); });
    var constraints = (ph.constraints || []).length;
    // the new group
    ph.sg = { number: sg.number, symbol: sg.symbol, hall: sg.hall, system: sg.system, laue: sg.laue, setting: sg.setting, uniqueAxis: sg.uniqueAxis };
    ph.ops = sg.ops; ph.wyckoff = sg.wyckoff; ph.atoms = []; ph.constraints = [];
    ph.poDir = K.hklToNew(ph.poDir, P);
    var broad = C.broadeningConfig(ph.broadening);
    broad.sizeAxis = K.hklToNew(broad.sizeAxis, P); broad.strainAxis = K.hklToNew(broad.strainAxis, P);
    ph.broadening = C.broadeningConfig(broad);
    // the cells, each from its own
    maps.forEach(function (m) {
      var nc = normaliseCell(K.transformCell(m.cell, P), sg.system, sg.uniqueAxis);
      CELLS.forEach(function (c) { m.v[k + c] = nc[c]; m.fit[k + c] = m.cellFit && free.indexOf(c) >= 0; });
      m.newCell = nc;
    });
    // the atoms: sites from the starting model, values of each from its own source atoms
    var used = new Set();
    conv.atoms.forEach(function (a) { addAtomTo(ph, { label: a.label, type: a.type, x: a.x, y: a.y, z: a.z, occ: a.occ, B: a.B }, maps[0].newCell, used); });
    maps.forEach(function (m, mi) {
      conv.atoms.forEach(function (a, ai) {
        var at = ph.atoms[ai], pre = k + at.label + '.', src = m.atoms[a.from.label];
        if (!src) return;
        if (!m.template) {
          var xyz = C.sitePosition(at.site, K.derive(a.from, src.xyz, oldOps, P, p, sg.ops));
          m.v[pre + 'x'] = xyz[0]; m.v[pre + 'y'] = xyz[1]; m.v[pre + 'z'] = xyz[2]; m.v[pre + 'occ'] = src.occ; m.v[pre + 'B'] = src.B;
        }
        ['x', 'y', 'z'].forEach(function (c, i) { m.fit[pre + c] = src.fitXYZ && at.site.free.indexOf(i) >= 0; });
        m.fit[pre + 'occ'] = src.fitOcc; m.fit[pre + 'B'] = src.fitB;
      });
    });
    S.datasets.forEach(function (ds) { ds.stats = null; ds.esd = {}; ds.ints = null; });
    phaseChanged(ph);
    return { datasets: nDatasets, banks: nBanks, linksDropped: links - S.parameterLinks.length, constraintsDropped: constraints };
  }

  // ---------------------------------------------------------------- values
  function invalidate(ds) { ds.calc = null; }
  function clearFit(ds, banks) {
    ds.stats = null; ds.esd = {}; ds.ints = null; invalidate(ds);
    if (banks) Object.keys(ds.calculations || {}).forEach(function (m) {
      var b = ds.calculations[m]; b.stats = null; b.esd = {}; b.ints = null;
    });
  }
  function invalidateAll() { S.datasets.forEach(invalidate); }
  // list: the datasets to change (default: the selected ones); template: also the start values of the phase
  function setParam(name, value, list, template) {
    var c=C.classify(name),ph=c.phase?phaseByKey(c.phase):null,targets=(list || selected()).filter(function(d){return own(d.p,name);}),staged=[];
    try{
      targets.forEach(function(ds){var v=Object.assign({},ds.p);v[name]=value;
        if(c.kind==='atom' && S.calculation==='rietveld' && S.phases.some(function(p){return p.constraints && p.constraints.length;})){
          var plan=AtomicConstraints.prepare({phases:phaseDefs(),datasets:[{phases:ds.phases}],values:[v],referenceValues:[ds.p],limits:S.limits},name);v=plan.values[0];
          if(!plan.valid([v]))throw new Error('This edit would put a constrained occupancy or atomic parameter outside its limits.');
        }staged.push({ds:ds,v:v});
      });
      var tv=null;if(template && ph){tv=Object.assign({},ph.v);tv[name]=value;if(c.kind==='atom' && ph.constraints && ph.constraints.length){var def=phaseDefs().filter(function(p){return p.key===ph.key;})[0];def.method='rietveld';var tp=AtomicConstraints.prepare({phases:[def],datasets:[{phases:[ph.key]}],values:[tv],referenceValues:[ph.v],limits:S.limits},name);tv=tp.values[0];if(!tp.valid([tv]))throw new Error('The edit conflicts with an atomic constraint or its bounds.');}}
      if(S.parameterLinks.length){var maps=S.datasets.map(function(d){var pending=staged.find(function(o){return o.ds===d;});return Object.assign({},pending?pending.v:d.p);});
        S.parameterLinks.forEach(function(link){
          if(link.target.name!==name || !targets.some(function(d){return d.id===link.target.datasetId;}))return;
          var sd=S.datasets.findIndex(function(d){return d.id===link.source.datasetId;}),td=S.datasets.findIndex(function(d){return d.id===link.target.datasetId;});
          if(sd<0 || td<0)throw new Error('The linked source dataset is unavailable.');
          var next=(maps[td][name]-(link.offset || 0))/link.factor,lim=AtomicConstraints.limits({limits:S.limits},link.source.name,next);
          if(next<lim[0] || next>lim[1])throw new Error('This edit would put the linked source outside its limits.');
          maps[sd][link.source.name]=next;
        });
        var plan=AtomicConstraints.prepare({phases:phaseDefs(),datasets:S.datasets.map(function(d){return {id:d.id,phases:d.phases};}),values:maps,parameterLinks:S.parameterLinks,limits:S.limits},name);if(!plan.valid(plan.values))throw new Error('This edit conflicts with linked parameter limits.');staged=S.datasets.map(function(d,i){return {ds:d,v:plan.values[i]};}).filter(function(o){return Object.keys(o.v).some(function(n){return o.v[n]!==o.ds.p[n];});});}
    }catch(e){RV.ui.toast(e.message,'warn');RV.bus.emit('params',{name:name});return false;}
    staged.forEach(function(o){o.ds.p=o.v;o.ds.stats=null;o.ds.esd={};o.ds.ints=null;if(c.kind==='atom')syncSites(o.ds);invalidate(o.ds);});
    if(tv){ph.v=tv;if(c.kind==='atom')syncTemplate(ph);}
    RV.bus.emit('params',{name:name});return true;
  }
  function setFit(name, on, list) {
    var c=C.classify(name),ph=c.phase?phaseByKey(c.phase):null,names=[name];
    if(ph && S.calculation==='rietveld')AtomicConstraints.normalizeAll(ph.constraints).forEach(function(rule){
      if(rule.kind!=='sum')return;
      var group=rule.atoms.map(function(a){return ph.key+'.'+a+'.'+rule.component;});
      if(group.indexOf(name)>=0)names=group;
    });
    (list || selected()).forEach(function(ds){names.forEach(function(n){if(own(ds.fit,n))ds.fit[n]=!!on;});});
    if(ph && !(list || selected()).length)names.forEach(function(n){ph.fit[n]=!!on;});
    RV.bus.emit('params',{name:name,flag:true});
  }
  function copyParams(from, list, values, flags) {
    list.forEach(function (ds) {
      if (ds === from) return;
      Object.keys(from.p).forEach(function (n) { if (own(ds.p, n)) { if(values!==false)ds.p[n] = from.p[n]; if(flags!==false)ds.fit[n] = from.fit[n]; } });
      ds.stats = null; ds.esd = {}; ds.ints = null;
    });
    // the copied values follow the atomic constraints and parameter links of the datasets they land in
    if (values !== false && typeof AtomicConstraints !== 'undefined' && (S.parameterLinks.length || S.phases.some(function (ph) { return ph.method === 'rietveld' && ph.constraints && ph.constraints.length; }))) {
      try {
        var plan = AtomicConstraints.prepare({ phases: phaseDefs(), datasets: S.datasets.map(function (d) { return { id: d.id, phases: d.phases }; }), values: S.datasets.map(function (d) { return Object.assign({}, d.p); }), parameterLinks: S.parameterLinks, limits: S.limits });
        S.datasets.forEach(function (d, i) { if (d !== from && list.indexOf(d) >= 0) { d.p = plan.values[i]; syncSites(d); } });
        if (!plan.valid(plan.values)) RV.ui.toast('The copied values put a constrained or linked parameter outside its limits; check the limits before fitting.', 'warn');
      } catch (e) { RV.ui.toast('Values copied, but they do not satisfy the constraints or links: ' + e.message, 'warn'); }
    }
    list.forEach(function (ds) { if (ds !== from) invalidate(ds); });
    RV.bus.emit('params', {});
  }

  // ---------------------------------------------------------------- the problem handed to rietveld_core.js
  // the points of the fitted range; a point in an excluded region gets weight 0 (it is calculated, not fitted)
  function pointWeight(ds, k) {
    // A supplied zero weight excludes a point even in unit-weight mode.
    if (ds.weights && ds.weights[k] === 0) return 0;
    if (S.settings.weight === 'unit') return 1;
    if (ds.weights && Number.isFinite(ds.weights[k]) && ds.weights[k] > 0) return ds.weights[k];
    var s = ds.sig && ds.sig[k] > 0 ? ds.sig[k] : Math.sqrt(Math.max(ds.y[k], 1));
    return 1 / (s * s);
  }
  function fitPoints(ds) {
    var lo = ds.inst.tthMin, hi = ds.inst.tthMax, idx = [];
    for (var i = 0; i < ds.tth.length; i++) if (ds.tth[i] >= lo && ds.tth[i] <= hi && Number.isFinite(ds.y[i])) idx.push(i);
    var n = idx.length, tth = new Float64Array(n), y = new Float64Array(n), w = new Float64Array(n), nEx = 0;
    idx.forEach(function (k, j) {
      tth[j] = ds.tth[k]; y[j] = ds.y[k];
      w[j] = excluded(ds.inst, tth[j]) ? 0 : pointWeight(ds, k);
      if (!w[j]) nEx++;
    });
    return { tth: tth, y: y, w: w, nExcluded: nEx };
  }
  function phaseDefs() {
    return S.phases.map(function (ph) {
      return { key: ph.key, method: ph.method, system: ph.sg.system, uniqueAxis: ph.sg.uniqueAxis, profileType: ph.profileType, separatedProfile: ph.separatedProfile === true, broadening: RVCore.broadeningConfig(ph.broadening), ops: ph.ops, poDir: ph.poDir,
               constraints:JSON.parse(JSON.stringify(ph.constraints || [])), restraints:RV.restraintsOf(ph.restraints), atoms: ph.atoms.map(function (at) { var f = scatterer(at.type); return { label: at.label, element: elementOf(at.type), ff: { xray: f.xray, neutron: f.neutron }, site: at.site }; }) };
    });
  }
  // Resolve once per job; workers receive only the selected numerical corrections and their provenance.
  function anomalousFor(ds, simulatedPhases) {
    var i=ds.inst,viewing=RV.fitHistory && RV.fitHistory.viewing(),saved=ds.stats && ds.stats.anomalousData;
    if(viewing && saved)return cloneCalculation(saved);
    var legacy=C.parseAnomalous(i.anomalous),enabled=i.radiation!=='neutron' && i.anomalousEnabled!==false;
    var out={enabled:enabled,wavelength:i.lambda1,energyEV:12398.419843320025/i.lambda1,source:'Chantler',interpolation:'linear in photon energy; no extrapolation',map:{}};
    if(!enabled){out.source=i.radiation==='neutron'?'Not applicable to neutrons':'Disabled';return out;}
    // An old archived fit must not acquire corrections that were absent from its calculation.
    if(viewing){out.enabled=Object.keys(legacy.map).length>0;out.source='Saved legacy input';out.interpolation=out.enabled?'supplied values':'none';out.map=legacy.map;return out;}
    if(Object.keys(legacy.map).length){out.source='Legacy explicit values';out.interpolation='supplied values';out.map=legacy.map;return out;}
    var elements=[];
    var phases=simulatedPhases?S.phases.filter(function(p){return simulatedPhases.includes(p.key);}):participatingPhases(ds).filter(function(p){return p.method==='rietveld';});
    phases.forEach(function(p){p.atoms.forEach(function(at){var el=elementOf(at.type);if(el && elements.indexOf(el)<0)elements.push(el);});});
    if(!elements.length){out.source='Not used by free-intensity methods';return out;}
    try {
      if(!S.tables || !S.tables.anomalous)throw new Error(S.tables && S.tables.raw.anomalousError || 'The bundled anomalous scattering table is unavailable.');
      elements.sort().forEach(function(el){out.map[el.toUpperCase()]=interpolateAnomalous(S.tables.anomalous,el,i.lambda1);});
    }catch(e){out.error=e.message;out.map={};}
    return out;
  }
  function datasetDef(ds, simulatedPhases) {
    var pts = fitPoints(ds), i = ds.inst, an=anomalousFor(ds, simulatedPhases);
    if(an.error)throw new Error(an.error);
    return { id: ds.id, tth: pts.tth, y: pts.y, w: pts.w, lambda1: i.lambda1, lambda2: i.ratio > 0 ? i.lambda2 : 0, ratio: i.lambda2 > 0 ? i.ratio : 0,
             polK: polK(i), radiation: i.radiation, anomalous: an.map, anomalousData:an, resolutionType:i.resolutionType, bkgType: i.bkgType, bkgN: i.bkgN, bkgX: i.bkgX.slice(), minFwhm: Math.max(1e-4, 2 * (ds.step || 0.01)),
             phases: ds.phases.filter(function(k){return simulatedPhases?simulatedPhases.includes(k):!S.disabledPhases.includes(k);}) };
  }
  function problemFor(list, simulatedPhases) {
    var phases=phaseDefs();
    // Build simulation's Rietveld model before resolving its energy-dependent scattering factors.
    if(simulatedPhases)phases.forEach(function(p){if(simulatedPhases.includes(p.key))p.method='rietveld';});
    return { phases: phases, datasets: list.map(function(ds){return datasetDef(ds, simulatedPhases);}), values: list.map(function (ds) { return Object.assign({}, ds.p); }), parameterLinks:cloneCalculation(S.parameterLinks),
             linkValues:S.parameterLinks.reduce(function(o,l){var d=byId(l.source.datasetId);if(d){o[d.id]=o[d.id] || {};o[d.id][l.source.name]=d.p[l.source.name];}return o;},{}),maxIter: S.settings.maxIter, tol: S.settings.tol, algorithm: S.settings.algorithm,
             pt: { sweeps:S.settings.ptSweeps, chains:S.settings.ptChains, maxTemp:S.settings.ptMaxTemp, seed:S.settings.ptSeed } };
  }
  function limitsFor(names, v) { var L = {}; names.forEach(function (n) { L[n] = limitsOf(n, v[n]); }); return L; }
  function fitNames(ds) { return Object.keys(ds.fit).filter(function (n) { return ds.fit[n] && isVariable(n) && !S.disabledPhases.includes(C.classify(n).phase) && !S.parameterLinks.some(function(l){return l.target.datasetId===ds.id && l.target.name===n;}) && (C.classify(n).kind !== 'instrument' || instrumentParamsFor(ds).some(function(p){return 'inst.'+p[0] === n;})); }); }
  // one dataset alone
  function jobFor(ds) {
    var issue = calculationIssue([ds]); if (issue) throw new Error(issue);
    var pr = problemFor([ds]), names = fitNames(ds);
    pr.vars = names.map(function (n) { return { name: n, d: 0 }; });
    pr.limits = limitsFor(names, ds.p);
    return pr;
  }
  /* Several datasets together. Each name is refined in the datasets of the list that hold it (a phase is only in some
     of them), with the fit flag of the first of those; a shared name has one value for all of them but those that keep
     it apart (a value each), a local one a value per dataset. ticks: the flag used for each name; mixed: the names
     whose flags differ between the datasets. */
  function globalJob(list) {
    var issue = calculationIssue(list); if (issue) throw new Error(issue);
    var pr = problemFor(list), held = {}, names = [], vars = [], nShared = 0, nLocal = 0, ticks = {}, mixed = [], v0 = {};
    list.forEach(function (ds, d) { Object.keys(ds.p).forEach(function (n) { if(S.disabledPhases.includes(C.classify(n).phase))return;if(C.classify(n).kind === 'instrument' && !instrumentParamsFor(ds).some(function(p){return 'inst.'+p[0] === n;}))return; (held[n] = held[n] || []).push(d); }); });
    Object.keys(held).forEach(function (n) {
      var h = held[n], f = list[h[0]];
      ticks[n] = !!f.fit[n]; v0[n] = f.p[n];
      if (h.some(function (d) { return !!list[d].fit[n] !== ticks[n]; })) mixed.push(n);
      if (!ticks[n] || !isVariable(n)) return;
      names.push(n);
      var sh = isShared(n) ? h.filter(function (d) { return !isApart(list[d], n); }) : [];
      if (sh.length > 1) { vars.push({ name: n, d: -1, ds: sh }); nShared++; } else sh = [];
      h.forEach(function (d) { if (sh.indexOf(d) < 0) { vars.push({ name: n, d: d }); nLocal++; } });
    });
    pr.vars = vars; pr.limits = limitsFor(names, v0); pr.nShared = nShared; pr.nLocal = nLocal; pr.ticks = ticks; pr.mixed = mixed;
    if(S.parameterLinks.length || S.calculation==='rietveld' && S.phases.some(function(p){return p.constraints && p.constraints.length;})){try{var independent=AtomicConstraints.prepare(pr).vars;pr.nShared=independent.filter(function(v){return v.d<0;}).length;pr.nLocal=independent.length-pr.nShared;}catch(e){pr.constraintIssue=e.message;}}
    return pr;
  }

  // Only independent shared variables need one starting value. Local parameters,
  // apart datasets and values determined by constraints retain their own rules.
  function sharedStartConflicts(job) {
    return AtomicConstraints.prepare(job).vars.filter(function(v){return v.d<0;}).map(function(v){
      var indices=v.ds && v.ds.length?v.ds:job.datasets.map(function(_,i){return i;});
      return {name:v.name,indices:indices.slice(),values:indices.map(function(i){return job.values[i][v.name];})};
    }).filter(function(c){return c.values.some(function(v){return v!==c.values[0];});});
  }
  function resolveSharedStarts(job, choices) {
    var conflicts=sharedStartConflicts(job),next=Object.assign({},job,{values:job.values.map(function(v){return Object.assign({},v);}),limits:Object.assign({},job.limits),sharedStarts:[]});
    conflicts.forEach(function(c){
      var v=choices && choices[c.name];
      if(!Number.isFinite(v))throw new Error('Choose a shared starting value for '+c.name+'.');
      next.limits[c.name]=limitsOf(c.name,v);
      c.indices.forEach(function(i){next.values[i][c.name]=v;});
      next.sharedStarts.push({name:c.name,value:v,datasetIds:c.indices.map(function(i){return job.datasets[i].id;})});
    });
    var plan=AtomicConstraints.prepare(next);
    plan.vars.forEach(function(v,i){var d=v.d>=0?v.d:v.ds && v.ds.length?v.ds[0]:0,value=plan.values[d][v.name],lim=plan.limits[i];if(!Number.isFinite(value)||value<lim[0]||value>lim[1])throw new Error('Starting value for '+v.name+' is outside its limits.');});
    if(!plan.valid(plan.values))throw new Error('The shared starting values violate a constraint or parameter limit.');
    return next;
  }

  // the calculated pattern of a dataset (cached; null when it cannot be computed, the reason in ds.calcErr)
  function calcFor(ds) {
    var issue = calculationIssue([ds]); if (issue) { ds.calcErr = issue; return null; }
    if (ds.calc) return ds.calc;
    try { ds.calc = C.evaluate(problemFor([ds]), 0); ds.calcErr = ''; }
    catch (e) { ds.calc = null; ds.calcErr = String((e && e.message) || e); }
    return ds.calc;
  }

  // scales of the phases (all, or one) and the constant background, by linear least squares from the patterns of the
  // phases at unit scale; a phase that comes out negative is kept small rather than removed
  function estimateScales(ds, onlyKey) {
    if (!S.phases.length || calculationIssue([ds])) return false;
    try {
      var rv = S.phases.map(function (p, i) { return p.method === 'rietveld' && hasPhase(ds, p) ? i : -1; }).filter(function (i) { return i >= 0; });
      if (!rv.length || (onlyKey && !rv.some(function (i) { return S.phases[i].key === onlyKey; }))) return false;
      var pr = problemFor([ds]), v = pr.values[0], M, keys = rv.map(function (i) { return S.phases[i].key; });
      keys.forEach(function (k) { v[k + '.scale'] = 1; });
      M = new C.Model(pr);
      var D = M.datasets[0], n = D.n, y = D.def.y, w = D.def.w;
      var cols = rv.map(function (pi) { return M.evalPhase(pi, 0, v).y; });
      var spline = D.spline, bk = M.background(0, spline ? v : Object.assign({}, v, { bkg0: 0 })), r = new Float64Array(n);
      for (var i = 0; i < n; i++) r[i] = y[i] - bk[i];
      var use = keys.map(function (k) { return !onlyKey || k === onlyKey; }), nb = !spline && D.T.length > 0 ? 1 : 0;
      for (var pass = 0; pass < 4; pass++) {
        var idx = [];
        keys.forEach(function (k, pi) { if (use[pi]) idx.push(pi); });
        var m = nb + idx.length, A = new Float64Array(m * m), b = new Float64Array(m), base = new Float64Array(n);
        keys.forEach(function (k, pi) { if (!use[pi]) { var s = v[k + '.scale'] = ds.p[k + '.scale']; for (var q = 0; q < n; q++) base[q] += s * cols[pi][q]; } });
        var col = function (j, q) { return j < nb ? 1 : cols[idx[j - nb]][q]; };
        for (var q = 0; q < n; q++) {
          var t = r[q] - base[q];
          for (var a = 0; a < m; a++) { var ca = col(a, q); b[a] += w[q] * ca * t; for (var c2 = 0; c2 <= a; c2++) A[a * m + c2] += w[q] * ca * col(c2, q); }
        }
        for (a = 0; a < m; a++) for (c2 = a + 1; c2 < m; c2++) A[a * m + c2] = A[c2 * m + a];
        var x = C.solveSPD(A, b, m);
        if (!x) return false;
        var neg = -1;
        idx.forEach(function (pi, j) { if (!(x[nb + j] > 0) && neg < 0) neg = pi; });
        if (neg >= 0 && pass < 3) {
          var mx = 0, my = 0;
          for (q = 0; q < n; q++) { mx = Math.max(mx, cols[neg][q]); my = Math.max(my, r[q]); }
          ds.p[keys[neg] + '.scale'] = mx > 0 ? 0.01 * my / mx : 1e-6;
          use[neg] = false;
          continue;
        }
        idx.forEach(function (pi, j) { if (x[nb + j] > 0) ds.p[keys[pi] + '.scale'] = x[nb + j]; });
        if (nb && !onlyKey && own(ds.p, 'bkg0')) ds.p.bkg0 = x[0];
        break;
      }
      clearFit(ds);
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- simulation
  /* A pattern calculated from the phases, with no data behind it. o = { name, tthMin, tthMax, step, inst, peak (counts
     of the strongest point; 0 keeps the scales as they are), bkg (constant counts), noise (Poisson counting noise),
     seed }. The values of the phases are those of the first selected dataset (or the start values). The selected
     atomic models are evaluated by Rietveld independently of the active fitting method. The result is an ordinary dataset: it can be fitted. */
  function simulate(o) {
    var n = Math.max(2, Math.round((o.tthMax - o.tthMin) / o.step) + 1), tth = new Float64Array(n);
    for (var i = 0; i < n; i++) tth[i] = +(o.tthMin + i * o.step).toFixed(6);
    var inst = Object.assign(instCopy(o.inst || S.settings.inst), { tthMin: tth[0], tthMax: tth[n - 1], bkgType: 'cheb', bkgN: 1, bkgX: [], excl: [], exclOff: [] });
    var from = first(), keys = Array.isArray(o.phases) ? o.phases : (from ? from.phases : S.phases.map(function(p){return p.key;}));
    keys = keys.filter(function(k){return canRietveld(phaseByKey(k));});
    if(!keys.length) throw new Error('Select at least one phase with atoms to simulate.');
    var ds = makeDataset({ name: o.name || 'simulated', tth: tth, y: new Float64Array(n), inst: inst, phases:keys,
                           sim: { tthMin: tth[0], tthMax: tth[n - 1], step: o.step, peak: o.peak || 0, bkg: o.bkg || 0, noise: !!o.noise, phases:keys.slice() } });
    if (from) Object.keys(ds.p).forEach(function (k) { var c = C.classify(k); if ((c.phase || c.kind==='instrument') && own(from.p, k)) ds.p[k] = from.p[k]; });
    ds.p.bkg0 = 0; ds.p.zero = from && own(from.p, 'zero') ? from.p.zero : 0;
    syncSites(ds);
    var job=problemFor([ds],keys);
    ds.sim.anomalousData=cloneCalculation(job.datasets[0].anomalousData);
    var ev = C.evaluate(job, 0), y = Float64Array.from(ev.ycalc), mx = 0;
    for (i = 0; i < n; i++) if (y[i] > mx) mx = y[i];
    var k = o.peak > 0 && mx > 0 ? o.peak / mx : 1;
    if (k !== 1) {
      S.phases.forEach(function (ph) { if (keys.indexOf(ph.key)>=0 && own(ds.p, ph.key + '.scale')) ds.p[ph.key + '.scale'] *= k; });
      for (i = 0; i < n; i++) y[i] *= k;
    }
    var b = o.bkg > 0 ? o.bkg : 0, r = rng(o.seed || 1);
    ds.p.bkg0 = b;
    for (i = 0; i < n; i++) {
      var yc = y[i] + b;
      y[i] = o.noise ? Math.max(0, Math.round(yc + Math.sqrt(Math.max(yc, 1)) * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()))) : yc;
    }
    ds.y = y;
    ds.fit = {}; Object.keys(ds.p).forEach(function (nm) { ds.fit[nm] = false; });
    invalidate(ds);
    return ds;
  }
  function rng(seed) { var st = seed >>> 0 || 1; return function () { st = (st * 16807) % 2147483647; return st / 2147483647; }; }

  // ---------------------------------------------------------------- fit results
  var globalFitSerial = 0;
  function shortStats(st) { return { n: st.n, chi2: st.chi2, sumWeightedObserved2: st.sumWeightedObserved2, sumAbsObserved: st.sumAbsObserved, sumAbsResidual: st.sumAbsResidual, Rp: st.Rp, Rwp: st.Rwp, Rexp: st.Rexp, gof: st.gof, phases: st.phases.map(function (p, i) { return { key: S.phases[i] ? S.phases[i].key : '', method: p.method, RBragg: p.RBragg, RF: p.RF, nRefl: p.nRefl }; }) }; }
  function applyResult(list, res, job, global) {
    var names = {}, overall = null;
    if (global && res.stats.every(function(st){return Number.isFinite(st.sumWeightedObserved2) && Number.isFinite(st.sumAbsObserved) && Number.isFinite(st.sumAbsResidual);})) {
      var sum = res.stats.reduce(function (a, st) {
        a.n += st.n; a.chi2 += st.chi2; a.sw += st.sumWeightedObserved2;
        a.so += st.sumAbsObserved; a.sa += st.sumAbsResidual; a.nInt += st.nInt || 0; return a;
      }, {n:0, chi2:0, sw:0, so:0, sa:0, nInt:0});
      var nv = Number.isFinite(res.nVar) ? res.nVar : job.vars.length, dof = Math.max(1,sum.n - nv - sum.nInt);
      overall = { id: Date.now().toString(36) + '-' + (++globalFitSerial), datasetIds: list.map(function(d){return d.id;}),
        n:sum.n, nVar:nv, nInt:sum.nInt, dof:dof, chi2:sum.chi2, chi2red:sum.chi2/dof, GOF:Math.sqrt(sum.chi2/dof),
        Rp:sum.so>0 ? sum.sa/sum.so : null, Rwp:sum.sw>0 ? Math.sqrt(sum.chi2/sum.sw) : null,
        Rexp:sum.sw>0 ? Math.sqrt(dof/sum.sw) : null, sumWeightedObserved2:sum.sw,
        algorithm:res.effectiveAlgorithm || 'lm', iter:res.iter, msg:res.msg, calculation:S.calculation };
    }
    job.vars.forEach(function (vr) { names[vr.name] = true; });
    (res.constraintNames || []).forEach(function(n){names[n]=true;});
    list.forEach(function (ds, d) {
      Object.keys(names).forEach(function (n) { if (own(ds.p, n) && Number.isFinite(res.values[d][n])) ds.p[n] = res.values[d][n]; });
      syncSites(ds);
      ds.esd = {};
      Object.keys(res.esd[d] || {}).forEach(function (n) { ds.esd[n] = res.esd[d][n]; });
      var st = res.stats[d], nVar = Number.isFinite(st.nPar) ? st.nPar-(st.nInt || 0) : job.vars.filter(function (vr) { return vr.d === d || (vr.d === -1 && (!vr.ds || vr.ds.indexOf(d) >= 0)); }).length, nPar = nVar + (st.nInt || 0);
      ds.ints = res.intensities ? res.intensities[d] : null;
      ds.stats = Object.assign(shortStats(st), { ok: true, calculation:S.calculation, msg: res.msg, iter: res.iter, nVar: nVar, nInt: st.nInt || 0, chi2red: st.chi2 / Math.max(1, st.n - nPar),
                                                 constraintWarnings:res.constraintWarnings || [], uncertaintyIssues: res.uncertaintyIssues ? res.uncertaintyIssues[d] : {}, fitWarnings:res.fitWarnings ? res.fitWarnings[d] : [], covarianceOK:res.covarianceOK, global: !!global, globalSummary: overall, globalChi2red: global ? res.chi2red : null, nSets: list.length,
                                                 anomalousData:cloneCalculation(job.datasets[d].anomalousData || null), algorithm: res.algorithm || 'lm', effectiveAlgorithm: res.effectiveAlgorithm || 'lm', pt: res.pt || null, maxIter: job.maxIter, tol: job.tol, ms: res.ms, weight: S.settings.weight });
      invalidate(ds);
    });
  }
  function fitStatus(msg) { return /^converged/.test(msg || '') ? 'ok' : 'warn'; }

  // A calculation owns numerical values, flags, uncertainties, results and background.
  // Observations, phase definitions and their dataset assignments belong to the project.
  function cloneCalculation(o) {
    if (o == null || typeof o !== 'object') return o;
    if (ArrayBuffer.isView(o)) return o.slice();
    if (Array.isArray(o)) return o.map(cloneCalculation);
    var out={}; Object.keys(o).forEach(function(k){out[k]=cloneCalculation(o[k]);}); return out;
  }
  function cleanCalculations(raw) {
    var out = {};
    C.METHODS.forEach(function (m) {
      var b = raw && raw[m];
      if (!b || !b.p || typeof b.p !== 'object' || Array.isArray(b.p)) return;
      var p = {}, fit = {}, esd = {};
      Object.keys(b.p).forEach(function (n) { if (Number.isFinite(b.p[n])) { p[n] = b.p[n]; fit[n] = !!(b.fit && b.fit[n]); } });
      Object.keys(b.esd || {}).forEach(function (n) { if (Number.isFinite(b.esd[n])) esd[n] = b.esd[n]; });
      out[m] = { p: p, fit: fit, esd: esd, ints: b.ints || null, stats: b.stats || null, signature: String(b.signature || ''),
                 inst: b.inst ? cleanInst(b.inst) : null, apart: apartOf(b.apart) };
    });
    return out;
  }
  function calculationSignature(ds) {
    return JSON.stringify({ dataKey:ds.dataKey, weight:S.settings.weight, inst:ds.inst, disabledPhases:S.disabledPhases, parameterLinks:S.parameterLinks,
      linkValues:S.parameterLinks.map(function(l){var source=byId(l.source.datasetId);return source && source.p[l.source.name];}), phases: phasesIn(ds).map(function (p) {
      var signature=[p.key, p.sg.hall, p.sg.symbol, p.profileType, p.separatedProfile === true, p.broadening, p.poDir, p.atoms, p.method];
      if(p.method==='rietveld' && p.constraints && p.constraints.length)signature.push(p.constraints);if(p.method==='rietveld' && typeof AtomRestraints!=='undefined' && AtomRestraints.active(p.restraints))signature.push(p.restraints);return signature;
    }) });
  }
  function saveCalculation() {
    var m = S.calculation;
    if (C.METHODS.indexOf(m) < 0) return;
    S.calculationOptions[m] = { refinement: refinementOptions(), shared: Object.assign({}, S.shared), limits:Object.keys(S.limits).reduce(function(o,k){o[k]=S.limits[k].map(function(v){return v===Infinity?'inf':v===-Infinity?'-inf':v;});return o;},{}), parameterLinks:cloneCalculation(S.parameterLinks), weight:S.settings.weight, disabledPhases:S.disabledPhases.slice(), fitmode: load('fitmode') || 'single', maxIter: S.settings.maxIter, tol: S.settings.tol };
    S.datasets.forEach(function (d) {
      d.calculations = d.calculations || {};
      d.calculations[m] = { p: Object.assign({}, d.p), fit: Object.assign({}, d.fit), esd: Object.assign({}, d.esd),
        ints: cloneCalculation(d.ints), stats: cloneCalculation(d.stats), signature: calculationSignature(d), inst: instCopy(d.inst), apart: Object.assign({}, d.apart) };
      // A plot is immutable after evaluation. Retain it in memory only; project
      // files and undo copies do not need another copy of all its arrays.
      Object.defineProperty(d.calculations[m],'plot',{value:d.calc,configurable:true});
      Object.defineProperty(d.calculations[m],'plotValues',{value:JSON.stringify(d.p),configurable:true});
    });
  }
  function setCalculation(m) {
    if (S.busy || C.METHODS.indexOf(m) < 0) return false;
    if (m === S.calculation) return true;
    saveCalculation();
    S.calculation = m;
    var opts = S.calculationOptions[m], newR = [];
    S.phases.forEach(function (ph) {
      ph.method = m;
      if (ph.method === 'rietveld') newR.push(ph.key);
    });
    S.shared = Object.assign({}, opts ? opts.shared : S.shared);
    if (opts) {
      S.disabledPhases=(opts.disabledPhases || []).slice();S.parameterLinks=cloneCalculation(opts.parameterLinks || []);
      S.limits={};Object.keys(opts.limits || {}).forEach(function(k){S.limits[k]=opts.limits[k].map(function(v){return v==='inf'?Infinity:v==='-inf'?-Infinity:v;});});
      if(opts.weight)S.settings.weight=opts.weight;
      restoreRefinementOptions(opts.refinement || {algorithm:'lm'});
      store('fitmode', opts.fitmode === 'global' ? 'global' : 'single');
      if (validSetting('maxIter', opts.maxIter)) S.settings.maxIter = opts.maxIter;
      if (validSetting('tol', opts.tol)) S.settings.tol = opts.tol;
    }
    S.version++;
    S.datasets.forEach(function (d) {
      var b = d.calculations && d.calculations[m];
      if (b) {
        // Acquisition wavelength and range remain dataset properties. A saved
        // calculation restores its background model, not an old acquisition.
        if (b.inst) ['bkgType', 'bkgN', 'bkgX'].forEach(function (n) { d.inst[n] = cloneCalculation(b.inst[n]); });
        d.p = Object.assign({}, b.p); d.fit = Object.assign({}, b.fit); d.mem = {};
        rebaseBackground(d,b.inst,d.inst);
        d.apart = Object.assign({}, b.apart);
      }
      d.esd={};d.stats=null;d.ints=null;
      remap(d);invalidate(d);
      if (!b && !d.sim) newR.forEach(function (k) { if (d.phases.indexOf(k) >= 0) estimateScales(d, k); });
    });
    normalizeBackgrounds(backgroundType());
    // A link may read another dataset: validate caches only once all method
    // values are restored. Calibration imports can also edit inactive banks.
    S.datasets.forEach(function(d){
      var b=d.calculations && d.calculations[m];
      if(!b || b.signature!==calculationSignature(d))return;
      d.esd=Object.assign({},b.esd);d.stats=cloneCalculation(b.stats);d.ints=cloneCalculation(b.ints);
      if(b.plot && b.plotValues===JSON.stringify(d.p))d.calc=b.plot;
    });
    RV.bus.emit('fitmode'); RV.bus.emit('settings', 'maxIter'); RV.bus.emit('settings', '*'); RV.bus.emit('calculation', m); RV.bus.emit('phases'); RV.bus.emit('params', {}); RV.bus.emit('stats'); RV.bus.emit('shared', {});
    return true;
  }

  // ---------------------------------------------------------------- project files
  var PROJECT = 'powder6-project', PROJECT_V1 = 'powder5-rietveld-project';
  function numOut(v) { return Number.isFinite(v) ? v : null; }
  function mapOut(m) { var o = {}; Object.keys(m || {}).forEach(function (k) { o[k] = typeof m[k] === 'number' ? numOut(m[k]) : m[k]; }); return o; }
  function projectJSON(log, opts) {
    opts=opts || {};
    saveCalculation();
    var lim = {};
    Object.keys(S.limits).forEach(function (n) { lim[n] = S.limits[n].map(function (v) { return Number.isFinite(v) ? v : (v > 0 ? 'inf' : '-inf'); }); });
    return JSON.stringify({
      format: PROJECT, version: 4, parameterUnits: {sampleSize:'um'}, program: 'Powder 6, ' + RV.version, saved: new Date().toISOString(),
      disabledPhases:S.disabledPhases, parameterLinks:S.parameterLinks, selection:Array.from(S.sel), focus:S.focus,
      fitHistory:!opts.noHistory && RV.fitHistory ? RV.fitHistory.exportData(!!opts.metadataOnly) : null,
      calculation: S.calculation, calculationOptions: S.calculationOptions, fitmode:load('fitmode') || 'single', phaseSelection:S.phaseSel, presetDefaults:S.presetDefaults, settings: S.settings, shared: S.shared, limits: lim,
      absorption: RV.absorption && RV.absorption.exportUser ? RV.absorption.exportUser() : null,
      phases: S.phases.map(function (ph) {
        return { key: ph.key, color: ph.color || null, name: ph.name, method: ph.method, number: ph.sg.number, symbol: ph.sg.symbol, hall: ph.sg.hall, profileType: ph.profileType, separatedProfile: ph.separatedProfile === true, broadening: RVCore.broadeningConfig(ph.broadening), poDir: ph.poDir,
                 constraints:JSON.parse(JSON.stringify(ph.constraints || [])), restraints:RV.restraintsOf(ph.restraints), provenance:ph.provenance || null, atoms: ph.atoms.map(function (a) { return { label: a.label, type: a.type }; }), v: mapOut(ph.v), fit: ph.fit };
      }),
      datasets: S.datasets.map(function (d) {
        return { id: d.id, dataKey:d.dataKey, color:d.color || null, name: d.name, tth:opts.metadataOnly?undefined:Array.from(d.tth), y:opts.metadataOnly?undefined:Array.from(d.y), sig:!opts.metadataOnly && d.sig ? Array.from(d.sig) : null, weights:!opts.metadataOnly && d.weights ? Array.from(d.weights) : null, inst: instCopy(d.inst),
                 calculations: d.calculations, phases: d.phases.slice(), apart: Object.keys(d.apart), p: mapOut(d.p), fit: d.fit, esd: mapOut(d.esd), stats: d.stats, sim: d.sim || null,
                 // values of names the dataset does not hold now (an atom removed, a phase unassigned), for when they return
                 mem: Object.keys(d.mem || {}).reduce(function (o, n) { if (!own(d.p, n) && Array.isArray(d.mem[n]) && Number.isFinite(d.mem[n][0])) o[n] = [d.mem[n][0], !!d.mem[n][1]]; return o; }, {}) };
      }),
      log: log || []
    });
  }
  // everything checked and built before anything in memory changes, so a bad file leaves the program as it was
  function prepareProject(doc) {
    function bad(what) { throw new Error('invalid project: ' + what); }
    function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
    function nums(a, n, what) {
      if ((!Array.isArray(a) && !ArrayBuffer.isView(a)) || (n != null && a.length !== n)) bad(what);
      a.forEach(function (v, k) { if (!(typeof v === 'number' && isFinite(v))) bad(what + ', value ' + (k + 1)); });
      return a;
    }
    function numMap(m, what) {
      var o = {};
      if (m == null) return o;
      if (!isObj(m)) bad(what);
      Object.keys(m).forEach(function (k) { var v = m[k]; o[k] = v == null ? NaN : (typeof v === 'number' ? v : bad(what + ' ' + k)); });
      return o;
    }
    if (!isObj(doc) || (doc.format !== PROJECT && doc.format !== PROJECT_V1)) throw new Error('not a project of this program');
    var v1 = doc.format === PROJECT_V1;
    if (v1 ? (doc.version != null && doc.version !== 1) : ![2,3,4].includes(doc.version)) throw new Error('project version ' + doc.version + ' is not supported');
    if (!S.sgReady) throw new Error('the space-group database is not loaded, so the phases cannot be rebuilt');
    var phases = (doc.phases || []).map(function (p, i) {
      if (!isObj(p)) bad('phase ' + (i + 1));
      var sg = resolveSG(p.number, p.hall) || resolveSG(p.symbol);
      if (!sg) bad('phase ' + (i + 1) + ': unknown space group ' + (p.symbol || p.number));
      var key = /^p\d+$/.test(p.key) ? p.key : 'p' + (i + 1);
      var ph = { key: key, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : null, name: String(p.name || key), method: C.METHODS.indexOf(p.method) >= 0 ? p.method : 'rietveld',
                 sg: { number: sg.number, symbol: sg.symbol, hall: sg.hall, system: sg.system, laue: sg.laue, setting: sg.setting, uniqueAxis: sg.uniqueAxis },
                 ops: sg.ops, wyckoff: sg.wyckoff, profileType: C.PROFILE_PARAMS[p.profileType] ? p.profileType : 'simple_pvoigt', separatedProfile: p.separatedProfile === true, broadening: RVCore.broadeningConfig(p.broadening),
                 constraints:JSON.parse(JSON.stringify(p.constraints || [])), restraints:RV.restraintsOf(p.restraints), provenance:p.provenance || null, poDir: Array.isArray(p.poDir) && p.poDir.length === 3 ? p.poDir.map(Number) : [0, 0, 1], atoms: [], v: numMap(p.v, 'phase values'), fit: isObj(p.fit) ? Object.assign({}, p.fit) : {} };
      var cell = cellOf(ph, ph.v);
      if (!cell) bad('phase ' + ph.name + ': no cell');
      (p.atoms || []).forEach(function (a) {
        if (!isObj(a) || typeof a.label !== 'string') bad('an atom of ' + ph.name);
        var pre = key + '.' + a.label + '.';
        ph.atoms.push({ label: a.label, type: String(a.type || a.label), site: siteOf(ph, [ph.v[pre + 'x'], ph.v[pre + 'y'], ph.v[pre + 'z']], cell) });
      });
      if(typeof AtomicConstraints!=='undefined')AtomicConstraints.definitions(ph);
      return ph;
    });
    var usedIds=new Set();
    var raws = (doc.datasets || []).map(function (r, i) {
      var what = 'dataset ' + (i + 1);
      if (!isObj(r)) bad(what);
      if(r.id!=null){if(!Number.isInteger(r.id)||r.id<=0||usedIds.has(r.id))bad(what+': duplicate or invalid ID');usedIds.add(r.id);}
      var n = nums(r.tth, null, what + ': 2-theta').length;
      nums(r.y, n, what + ': intensities');
      if (r.sig != null) nums(r.sig, n, what + ': standard deviations');
      if (r.weights != null) {
        nums(r.weights, n, what + ': weights');
        if (r.weights.some(function (w) { return w < 0; })) bad(what + ': negative weight');
      }
      if (n < 2) bad(what + ': fewer than two points');
      return { savedId: r.id, dataKey:r.dataKey, color:/^#[0-9a-f]{6}$/i.test(r.color || '')?r.color:null, name: String(r.name || 'data'), tth: r.tth, y: r.y, sig: r.sig, weights: r.weights, inst: isObj(r.inst) ? cleanInst(r.inst) : null,
               phases: Array.isArray(r.phases) ? r.phases.filter(function (k) { return phases.some(function (ph) { return ph.key === k; }); }) : null,
               apart: Array.isArray(r.apart) ? r.apart.filter(function (n) { return typeof n === 'string'; }) : null,
               p: numMap(r.p, what + ': values'), fit: isObj(r.fit) ? r.fit : {}, esd: numMap(r.esd, what + ': uncertainties'), stats: isObj(r.stats) ? r.stats : null,
               sim: isObj(r.sim) ? r.sim : null, calculations: cleanCalculations(r.calculations),
               mem: isObj(r.mem) ? Object.keys(r.mem).reduce(function (o, n) { var e = r.mem[n]; if (Array.isArray(e) && typeof e[0] === 'number' && isFinite(e[0])) o[n] = [e[0], !!e[1]]; return o; }, {}) : null };
    });
    var limits = {};
    if (isObj(doc.limits)) Object.keys(doc.limits).forEach(function (n) {
      var L = doc.limits[n];
      if (!Array.isArray(L) || L.length !== 2) return;
      var lo = L[0] === '-inf' ? -Infinity : Number(L[0]), hi = L[1] === 'inf' ? Infinity : Number(L[1]);
      if (lo < hi) limits[n] = [lo, hi];
    });
    var KINDS = ['info', 'ok', 'warn', 'err', 'cmd'];
    if(doc.disabledPhases!=null && (!Array.isArray(doc.disabledPhases) || doc.disabledPhases.some(function(k){return typeof k!=='string';})))bad('method phase inclusion');
    if(doc.parameterLinks!=null && (!Array.isArray(doc.parameterLinks) || doc.parameterLinks.some(function(l){return !l || !l.source || !l.target || !Number.isInteger(l.source.datasetId) || !Number.isInteger(l.target.datasetId) || typeof l.source.name!=='string' || typeof l.target.name!=='string' || !Number.isFinite(l.factor) || l.factor===0 || !Number.isFinite(l.offset || 0);})))bad('parameter links');
    var log = (Array.isArray(doc.log) ? doc.log : []).filter(function (e) { return isObj(e) && typeof e.msg === 'string' && typeof e.t === 'string'; })
      .slice(-5000).map(function (e) { return { t: e.t, kind: KINDS.indexOf(e.kind) >= 0 ? e.kind : 'info', msg: e.msg.slice(0, 2000) }; });
    return { fitmode:doc.fitmode, phaseSelection:doc.phaseSelection, presetDefaults:isObj(doc.presetDefaults)?doc.presetDefaults:{}, calculation: C.METHODS.indexOf(doc.calculation) >= 0 ? doc.calculation : (phases[0] ? phases[0].method : 'lebail'), calculationOptions: isObj(doc.calculationOptions) ? doc.calculationOptions : {}, settings: cleanSettings(doc.settings), shared: isObj(doc.shared) ? doc.shared : {}, limits: limits, phases: phases, raws: raws, log: log, disabledPhases:doc.disabledPhases || [],  parameterLinks:doc.parameterLinks || [],selection:doc.selection,focus:doc.focus,fitHistory:RV.fitHistory?RV.fitHistory.validate(doc.fitHistory,raws.map(function(r){return r.dataKey;}).filter(Boolean)):null };
  }
  function commitProject(pj) {
    // A project replaces the start values too: nothing of the session before it survives (openProject waits for the
    // bundled preset files first, so they cannot land after this and refill what the project left empty).
    S.nextId=1; S.anchor=null; S.presetDefaults=cloneCalculation(pj.presetDefaults || {});
    store('fitmode',pj.fitmode==='global'?'global':'single');
    S.calculation = pj.calculation; S.calculationOptions = pj.calculationOptions;
    S.settings = pj.settings; store('settings', S.settings);
    S.phases = pj.phases; S.phases.forEach(function (ph) { ph.method = S.calculation; }); S.shared = Object.assign({}, pj.shared); S.limits = pj.limits;
    S.nextPhase = 1 + S.phases.reduce(function (m, p) { return Math.max(m, +p.key.slice(1)); }, 0);
    S.phaseSel = S.phases.some(function(p){return p.key===pj.phaseSelection;}) ? pj.phaseSelection : S.phases.length ? S.phases[0].key : null;
    S.datasets = []; S.sel.clear(); S.focus = null; S.version++;
    // Saved ids are reserved first: a dataset saved without one (older files) is numbered after all of them, so it can
    // no longer take the id a later dataset brings with it.
    S.nextId=1+pj.raws.reduce(function(m,r){return Number.isInteger(r.savedId) && r.savedId>0?Math.max(m,r.savedId):m;},0);
    S.datasets = pj.raws.map(function(r){var d=makeDataset(r);if(Number.isInteger(r.savedId) && r.savedId>0)d.id=r.savedId;return d;});
    normalizeBackgrounds(backgroundType());
    S.disabledPhases=pj.disabledPhases || [];S.parameterLinks=pj.parameterLinks;
    // Populate the selection before notifying views. They must never observe
    // new instruments with the previous project's dataset selection.
    var selection=Array.isArray(pj.selection)?pj.selection.filter(function(id){return !!byId(id);}):S.datasets.length?[S.datasets[0].id]:[];
    S.sel=new Set(selection);S.anchor=selection[0] || null;S.focus=S.sel.has(pj.focus)?pj.focus:null;
    if(RV.fitHistory)RV.fitHistory.importData(pj.fitHistory);
    // Dataset IDs are assigned anew on import. Reconnect the complete fitted
    // sets in active results and every saved calculation bank.
    var ids = {};
    pj.raws.forEach(function(r,i){if(r.savedId != null) ids[r.savedId]=S.datasets[i].id;});
    function reconnect(st) {
      if (!st || !st.globalSummary || !Array.isArray(st.globalSummary.datasetIds)) return;
      st.globalSummary = Object.assign({},st.globalSummary,{datasetIds:st.globalSummary.datasetIds.map(function(id){return ids[id] == null ? null : ids[id];})});
    }
    S.datasets.forEach(function(d){reconnect(d.stats);Object.keys(d.calculations || {}).forEach(function(m){reconnect(d.calculations[m].stats);});});
    // The intensities of the active method live in its saved calculation; brought back as switching to it would.
    S.datasets.forEach(function(d){
      var b=d.calculations && d.calculations[S.calculation];
      if(b && b.ints && b.signature===calculationSignature(d))d.ints=cloneCalculation(b.ints);
    });
    RV.bus.emit('settings', '*'); RV.bus.emit('calculation',S.calculation); RV.bus.emit('fitmode'); RV.bus.emit('phases'); RV.bus.emit('phaseSel'); RV.bus.emit('datasets');
    RV.bus.emit('selection');
  }

  function setBusy(b,label) { S.busy = !!b; S.busyLabel = b ? label || 'Calculation running…' : ''; RV.bus.emit('busy',!!b); }

  return {
    S: S, ANODES: ANODES, defaultInst: defaultInst, instCopy: instCopy, cleanInst: cleanInst, mergeRegions: mergeRegions, excluded: excluded,
    backgroundType:backgroundType, anchorValue: anchorValue, autoAnchors: autoAnchors, simulate: simulate, canRietveld: canRietveld, methodLabel: methodLabel, setMethod: setMethod,
    setPresetDefault: setPresetDefault,
    polK: polK, anodeOf: anodeOf, defaults: defaults, restore: restore, store: store, load: load,
    refinementOptions: refinementOptions, restoreRefinementOptions: restoreRefinementOptions, setSetting: setSetting, resetSettings: resetSettings, validSetting: validSetting,
    setTables: setTables, anomalousFor:anomalousFor, scatterer: scatterer, elementOf: elementOf, atomicWeight: atomicWeight, resolveSG: resolveSG, resolveFileSG: resolveFileSG, sgText: sgText,
    phaseByKey: phaseByKey, cellOf: cellOf, siteOf: siteOf, coordRole: coordRole, syncSites: syncSites, syncTemplate: syncTemplate,
    isSizeParam: isSizeParam, toDisplay: toDisplay, fromDisplay: fromDisplay, instrumentParamsFor: instrumentParamsFor, dsNames: dsNames, phaseNames: phaseNames, profileNames: profileNames, namesFor: namesFor, isVariable: isVariable, remap: remap, remapAll: remapAll,
    shareable: shareable, isShared: isShared, setShared: setShared, isApart: isApart, setApart: setApart, shareOf: shareOf, limitsOf: limitsOf, setLimit: setLimit, clearLimit: clearLimit,
    makeDataset: makeDataset, addDatasets: addDatasets, insertDatasets: insertDatasets, byId: byId, removeDatasets: removeDatasets, rename: rename, move: move, setInstrument: setInstrument, moveBackgroundAnchor:moveBackgroundAnchor, atomicValues:atomicValues,
    selectIds: selectIds, toggle: toggle, setFocus: setFocus, range: range, selectAll: selectAll, selected: selected, first: first,
    currentPhase: currentPhase, selectPhase: selectPhase, makePhase: makePhase, addAtomTo: addAtomTo, addPhase: addPhase, removePhase: removePhase,
    hasPhase: hasPhase, phasesIn: phasesIn, participatingPhases:participatingPhases, holdersOf: holdersOf, setPhaseIn: setPhaseIn,
    phaseChanged: phaseChanged, renameAtom: renameAtom, removeAtom: removeAtom, replaceAtoms: replaceAtoms, setPhaseSG: setPhaseSG, convertPhase: convertPhase, allSettings: allSettings, cleanLabel: cleanLabel,
    invalidate: invalidate, invalidateAll: invalidateAll, setParam: setParam, setFit: setFit, copyParams: copyParams,
    pointWeight: pointWeight, fitPoints: fitPoints, phaseDefs:phaseDefs, problemFor: problemFor, jobFor: jobFor, globalJob: globalJob, sharedStartConflicts:sharedStartConflicts, resolveSharedStarts:resolveSharedStarts, fitNames: fitNames, calcFor: calcFor,
    estimateScales: estimateScales, applyResult: applyResult, fitStatus: fitStatus,
    calculationIssue: calculationIssue, setCalculation: setCalculation, saveCalculation: saveCalculation, projectJSON: projectJSON, prepareProject: prepareProject, commitProject: commitProject, setBusy: setBusy
  };
})();

/*  Restore points, as in Yappari: one is kept before every command that changes datasets or phases. The data arrays are
 *  never changed in place, so a restore point shares them with the datasets; it copies the values, flags and results.
 *  The extracted intensities (ints) are a result like stats and are never changed in place either: they are kept with
 *  the point, so an undo no longer leaves Le Bail / WPPF without the intensities of its last fit.
 *  "undo" goes back one step; the Log shows "Restore before" on the line of each action whose restore point is kept.
 */
RV.history = (function () {
  'use strict';
  var S = RV.state.S, MAX = 40, MERGE_MS = 1500, points = [], nextId = 1, pending = null;
  function copy(o) { return o ? Object.assign({}, o) : o; }
  function copyBanks(banks){var out={};Object.keys(banks || {}).forEach(function(m){var b=banks[m];out[m]=Object.assign({},b,{p:copy(b.p),fit:copy(b.fit),esd:copy(b.esd),inst:b.inst?RV.state.instCopy(b.inst):null,apart:copy(b.apart)});});return out;}
  function capture() {
    var lim = {};
    Object.keys(S.limits).forEach(function (n) { lim[n] = S.limits[n].slice(); });
    return {
      datasets: S.datasets.map(function (d) {
        return { calculations: copyBanks(d.calculations), id: d.id, dataKey:d.dataKey, color:d.color || null, name: d.name, tth: d.tth, y: d.y, sig: d.sig, weights: d.weights, step: d.step, inst: RV.state.instCopy(d.inst), phases: d.phases.slice(), apart: copy(d.apart), p: copy(d.p), fit: copy(d.fit), esd: copy(d.esd), stats: d.stats, ints: d.ints, mem: copy(d.mem), sim: d.sim || null };
      }),
      phases: S.phases.map(function (ph) {
        return { key: ph.key, color: ph.color || null, name: ph.name, method: ph.method, sg: copy(ph.sg), ops: ph.ops, wyckoff: ph.wyckoff, profileType: ph.profileType, separatedProfile: ph.separatedProfile === true, broadening: RVCore.broadeningConfig(ph.broadening), poDir: ph.poDir.slice(),
                 constraints:JSON.parse(JSON.stringify(ph.constraints || [])), restraints:RV.restraintsOf(ph.restraints), provenance:ph.provenance || null, atoms: ph.atoms.map(function (a) { return { label: a.label, type: a.type, site: a.site }; }), v: copy(ph.v), fit: copy(ph.fit) };
      }),
      disabledPhases:S.disabledPhases.slice(),parameterLinks:JSON.parse(JSON.stringify(S.parameterLinks)),fitHistory:RV.fitHistory?RV.fitHistory.undoSnapshot():null,
      calculationSettings: { weight: S.settings.weight, bkgN: S.settings.bkgN, nAnchors: S.settings.nAnchors, inst: RV.state.instCopy(S.settings.inst) },
      refinement: RV.state.refinementOptions(), calculation: S.calculation, maxIter: S.settings.maxIter, tol: S.settings.tol, fitmode: RV.state.load('fitmode'), calculationOptions: JSON.parse(JSON.stringify(S.calculationOptions)), sel: Array.from(S.sel), focus: S.focus, anchor: S.anchor, phaseSel: S.phaseSel, shared: copy(S.shared), limits: lim,
      nextId: S.nextId, nextPhase: S.nextPhase
    };
  }
  function apply(st) {
    S.datasets = st.datasets.map(function (r) {
      return { calculations: copyBanks(r.calculations), id: r.id, dataKey:r.dataKey, color:r.color || null, name: r.name, tth: r.tth, y: r.y, sig: r.sig, weights: r.weights, step: r.step, inst: RV.state.instCopy(r.inst), phases: r.phases.slice(), apart: copy(r.apart) || {}, p: copy(r.p), fit: copy(r.fit), esd: copy(r.esd), stats: r.stats, mem: copy(r.mem), calc: null, ints: r.ints || null, sim: r.sim || null };
    });
    S.phases = st.phases.map(function (p) {
      return { key: p.key, color: p.color || null, name: p.name, method: p.method, sg: copy(p.sg), ops: p.ops, wyckoff: p.wyckoff, profileType: p.profileType, separatedProfile: p.separatedProfile === true, broadening: RVCore.broadeningConfig(p.broadening), poDir: p.poDir.slice(),
               constraints:JSON.parse(JSON.stringify(p.constraints || [])), restraints:RV.restraintsOf(p.restraints), provenance:p.provenance || null, atoms: p.atoms.map(function (a) { return { label: a.label, type: a.type, site: a.site }; }), v: copy(p.v), fit: copy(p.fit) };
    });
    S.disabledPhases=st.disabledPhases || [];S.parameterLinks=st.parameterLinks || [];if(RV.fitHistory)RV.fitHistory.importData(st.fitHistory);
    S.calculation = st.calculation || 'lebail'; S.calculationOptions = JSON.parse(JSON.stringify(st.calculationOptions || {}));
    if (st.calculationSettings) {
      ['weight', 'bkgN', 'nAnchors'].forEach(function (k) { S.settings[k] = st.calculationSettings[k]; });
      S.settings.inst = RV.state.instCopy(st.calculationSettings.inst);
    }
    RV.state.restoreRefinementOptions(st.refinement);
    S.settings.maxIter = st.maxIter == null ? S.settings.maxIter : st.maxIter; S.settings.tol = st.tol == null ? S.settings.tol : st.tol;
    RV.state.store('settings', S.settings);
    RV.state.store('fitmode', st.fitmode || 'single');
    RV.bus.emit('fitmode'); RV.bus.emit('settings', '*');
    S.shared = copy(st.shared); S.limits = {};
    Object.keys(st.limits).forEach(function (n) { S.limits[n] = st.limits[n].slice(); });
    S.nextId = Math.max(S.nextId, st.nextId); S.nextPhase = Math.max(S.nextPhase, st.nextPhase);
    S.phaseSel = st.phaseSel; S.version++;
    RV.bus.emit('phases'); RV.bus.emit('phaseSel'); RV.bus.emit('datasets');
    S.sel = new Set(st.sel.filter(function (id) { return !!RV.state.byId(id); })); S.focus = st.focus; S.anchor = st.anchor;
    RV.bus.emit('selection'); RV.bus.emit('data'); RV.bus.emit('params', {}); RV.bus.emit('stats');
  }
  // opts.merge: a burst of small edits of one parameter (mouse wheel, arrow keys) is one restore point
  function take(label, opts) {
    var last = points[points.length - 1], now = Date.now(), merge = (opts && opts.merge) || null;
    if (merge && last && last.merge === merge && now - last.at < MERGE_MS) { last.at = now; pending = null; return last.id; }
    var pt = { id: nextId++, label: label, time: new Date(), st: capture(), merge: merge, at: now };
    points.push(pt); pending = pt.id;
    while (points.length > MAX) {
      var old = points.shift(), b = document.querySelector('#log-list [data-restore="' + old.id + '"]');
      if (b) b.remove();
    }
    return pt.id;
  }
  function takePending() { var p = pending; pending = null; return p; }
  function restore(id) {
    var pt = points.filter(function (p) { return p.id === id; })[0];
    if (!pt) { RV.ui.toast('That restore point is no longer kept.', 'warn'); return; }
    if (S.busy) { RV.ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    take('restoring the state before ' + pt.label);
    apply(pt.st);
    RV.ui.toast('Restored the state before ' + pt.label + ', as it was at ' + pt.time.toLocaleTimeString() + '.', 'ok');
  }
  function undo() {
    var pt = points.pop();
    if (!pt) { RV.ui.toast('Nothing to undo.', 'info'); return; }
    var b = document.querySelector('#log-list [data-restore="' + pt.id + '"]');
    if (b) b.remove();
    if (pending === pt.id) pending = null;
    apply(pt.st);
    RV.ui.toast('Undone: ' + pt.label + ' (back to ' + pt.time.toLocaleTimeString() + ').', 'ok');
  }
  // every restore point forgotten: an opened project starts its own history
  function clear() {
    points = []; pending = null;
    if (typeof document !== 'undefined' && document.querySelectorAll) Array.prototype.forEach.call(document.querySelectorAll('#log-list [data-restore]'), function (b) { b.remove(); });
  }
  function init() {
    document.getElementById('log-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-restore]');
      if (b) restore(+b.getAttribute('data-restore'));
    });
  }
  return { init: init, take: take, takePending: takePending, undo: undo, restore: restore, clear: clear, count: function () { return points.length; } };
})();
