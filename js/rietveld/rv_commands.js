/*  Commands behind the File / Data / Refine menus, the Fit button, the plot gestures and the command line, and the
 *  pool of fit workers.
 *
 *  RV.pool.run(jobs, onResult(result, k), onProgress(done, total), onIter(k, it, maxIter)) -> { promise, cancel, stopped }
 *  Each job is one problem of rietveld_core.js, refined in js/rietveld_worker.js; several run in parallel. A job with
 *  type 'extract' is not iterated: it returns the statistics, uncertainties and intensities at its values (and with
 *  job.precision the precision block of one phase, for the space-group test). Stop terminates the workers still
 *  running (fresh ones replace them): a stopped refinement leaves its datasets as they were. Without workers the jobs
 *  run in this window, one after the other, and cannot be stopped.
 */
RV.pool = (function () {
  'use strict';
  var workers = [], broken = false;
  function size() { return Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)); }
  function make() { try { return new Worker('js/rietveld_worker.js'); } catch (e) { return null; } }
  function init() {
    if (workers.length || broken) return;
    for (var i = 0; i < size(); i++) {
      var w = make();
      if (!w) { broken = true; workers.forEach(function (x) { x.w.terminate(); }); workers = []; console.warn('Web Workers unavailable, refining in this window.'); return; }
      workers.push({ w: w, busy: false, token: null });
    }
  }
  function restart(wk) {
    try { wk.w.terminate(); } catch (e) { /* */ }
    wk.busy = false; wk.token = null;
    var w = make();
    if (w) wk.w = w; else workers.splice(workers.indexOf(wk), 1);
  }
  function run(jobs, onResult, onProgress, onIter, opts) {
    opts=opts||{};
    function jobAt(k){return typeof jobs[k]==='function'?jobs[k]():jobs[k];}
    onResult = onResult || function () {}; onProgress = onProgress || function () {}; onIter = onIter || function () {};
    var state = { cancelled: false, done: 0 }, results = new Array(jobs.length), settle = null;
    var promise = new Promise(function (resolve) {
      settle = resolve;
      init();
      function put(k, r) { if(r.pt)RV.ui.log('PT backend: '+(r.pt.backend || 'cpu')+(r.pt.fallbackReason ? ' — '+r.pt.fallbackReason : '')+'.',r.pt.fallbackReason?'warn':'info'); onResult(r, k); results[k] = opts.compactResults ? {ok:r.ok,msg:r.msg,iter:r.iter} : r; state.done++; onProgress(state.done, jobs.length); }
      if (broken || !workers.length) {
        var i = 0;
        (async function next() {
          if (state.cancelled || i >= jobs.length) { resolve(results); return; }
          var k = i++;
          var job=jobAt(k);
          var result = await RVCore.refineAsync(job, { evaluateOnly: job.type === 'extract', precision: job.precision || null, shouldStop:function(){return state.cancelled;}, onIter: function (p) { onIter(k, p.it, p.maxIter); } });
          if (state.cancelled) { resolve(results); return; }
          put(k, result);
          setTimeout(next, 0);
        })();
        return;
      }
      var nextJob = 0, inflight = 0, tries = new Uint8Array(jobs.length), retry = [];
      function feed(wk) {
        if (state.cancelled) return;
        var k = retry.length ? retry.shift() : (nextJob < jobs.length ? nextJob++ : -1);
        if (k < 0) { wk.busy = false; if (!inflight) resolve(results); return; }
        var token = {};
        inflight++; wk.busy = true; wk.token = token;
        wk.w.onmessage = function (e) {
          var m = e.data;
          if (wk.token !== token || state.cancelled) return;
          if (m.type === 'iter') { onIter(k, m.it, m.maxIter); return; }
          if (m.type !== 'done') return;
          inflight--; put(k, m.result); feed(wk);
        };
        wk.w.onerror = function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (wk.token !== token || state.cancelled) return;
          console.warn('a refinement worker stopped:', ev && ev.message);
          inflight--;
          if (tries[k]++) put(k, { ok: false, msg: 'the refinement stopped its worker twice (' + ((ev && ev.message) || 'out of memory?') + ')' }); else retry.push(k);
          restart(wk);
          if (workers.indexOf(wk) >= 0) feed(wk); else if (!workers.length) { jobs.forEach(function (_, j) { if (!results[j]) put(j, { ok: false, msg: 'no worker left' }); }); resolve(results); }
        };
        var job=jobAt(k);
        try { wk.w.postMessage({ type: job.type === 'extract' ? 'extract' : 'refine', id: k, problem: job, precision: job.precision || null }); } catch(e) { wk.w.onerror({message:e.message,preventDefault:function(){}}); }
      }
      workers.slice().forEach(feed);
    });
    function cancel() {
      if (state.cancelled) return;
      state.cancelled = true;
      workers.slice().forEach(function (wk) { if (wk.busy) restart(wk); });
      settle(results);
    }
    return { promise: promise, cancel: cancel, stopped: function () { return state.cancelled; } };
  }
  return { run: run, size: size, usingWorkers: function () { init(); return !broken && workers.length > 0; } };
})();

RV.cmd = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui, C = RVCore, running = null;
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function need(ok, msg) { if (!ok) ui.toast(msg, 'warn'); return !!ok; }
  function idle() { return need(!S.busy, 'A fit is running. Wait for it to finish or press Stop.'); }
  function haveSel(n) { n = n || 1; return need(S.sel.size >= n, n > 1 ? 'Select at least ' + n + ' datasets.' : 'Select one or more datasets first.'); }
  function havePhase() { return need(S.phases.length, 'No phase yet. Read CIF or make a new phase in Phases.'); }
  function haveSG() { return need(S.sgReady, S.sgLoading ? 'The space groups are still loading.' : 'The space-group database is not loaded: open index.html through a web server.'); }
  function sel() { return St.selected(); }
  function datasetTargets() { var d=RV.workspace && RV.workspace.dataset();return d?[d]:[]; }
  function snapshot(label, opts) { RV.history.take(label, opts); }
  function baseName(n) { return String(n).replace(/\.[^./\\]+$/, ''); }
  function fmt(v) { return ui.fmt(v, 4); }

  // ---------------------------------------------------------------- reading files
  // powder patterns (every format the readers of Le Bail · WPPF know), structure CIFs (phases) and project files, sorted by content
  async function readFiles(files) {
    if (!idle()) return;
    var data = [], structures = [], project = null, presets = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i], buf;
      try { buf = await ui.readBuffer(f); } catch (e) { ui.toast(f.name + ': ' + e.message, 'err'); continue; }
      // a project: saved as .project (also read: .archive, and .powder6 from earlier versions), or any zip holding project.json
      if(RV.project.isProjectName(f.name) || await RV.project.isProjectArchive(buf)){try{project={name:f.name,document:await RV.project.unpack(buf)};}catch(e){ui.toast(f.name+': '+e.message,'err');}continue;}
      var head = '';
      try { head = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 65536))); } catch (e) { head = ''; }
      if (/^\s*\{/.test(head) && (head.indexOf('"powder6-project"') >= 0)) { project = { name: f.name, text: new TextDecoder().decode(buf) }; continue; }
      if (/^\s*\{/.test(head) && (head.indexOf('"powder6-profile"') >= 0 || head.indexOf('"powder6-instrument-resolution"') >= 0)) { presets.push({ name: f.name, text: new TextDecoder().decode(buf) }); continue; }
      if (RV.absorption && /^\s*\{/.test(head) && (/absorption/i.test(f.name) || /"mu"\s*:\s*\[/.test(head))) {
        try { var raw=JSON.parse(new TextDecoder().decode(buf));var count=RV.absorption.loadDocument(raw,f.name,'eV');ui.toast('Loaded '+count+' elemental absorption tables from '+f.name+'. Energies without metadata are interpreted as eV.','ok'); }
        catch(e){ui.toast(f.name+': '+e.message,'err');}
        continue;
      }
      if (/\.(?:pd)?cif$/i.test(f.name)) {
        var text = new TextDecoder().decode(buf);
        if (/_cell[._]length_a/i.test(text)) structures.push({ name: f.name, text: text, source: f });
        if (/_pd_(?:meas|proc|calc)[._]/i.test(text)) data.push({ name: f.name, buf: buf, source: f });
        else if (!/_cell[._]length_a/i.test(text)) data.push({ name: f.name, buf: buf, source: f });
        continue;
      }
      data.push({ name: f.name, buf: buf });
    }
    if (project) { try { await openProject(project.document || project.text); } catch (e) { ui.toast(project.name + ': ' + e.message, 'err'); } return; }
    var importedPhases = structures.length ? readStructures(structures) : [];
    if (data.length) await readData(data, importedPhases);
    for (var preset of presets) await applyPresetText(preset.text, preset.name);
  }
  function instFromFile(pd) {
    var inst = {}, base = S.settings.inst;
    if (pd.radiation) inst.radiation = pd.radiation;
    if (pd.wavelength > 0) {
      var an = St.anodeOf(pd.wavelength);
      inst.lambda1 = pd.wavelength; inst.anode = an;
      if (an) { var A = St.ANODES[an]; inst.lambda2 = base.anode === an ? base.lambda2 : A[1]; inst.ratio = base.anode === an ? base.ratio : A[2]; }
      else { inst.lambda2 = 0; inst.ratio = 0; }
    }
    if (pd.wavelength2 > 0 && Number.isFinite(pd.ratio21)) { inst.lambda2 = pd.wavelength2; inst.ratio = pd.ratio21; }
    if (pd.singleWavelength || pd.radiation === 'neutron') { inst.lambda2 = 0; inst.ratio = 0; }
    if (pd.radiation === 'neutron') { inst.anode = ''; inst.pol = 'none'; }
    return inst;
  }
  async function readData(items, importedPhases) {
    var raws = [], failed = 0, warnings = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      try {
        var parsed = await detectAndParseBuffer(it.name, it.buf), patterns = parsed.patterns || [parsed], fileRaws = [];
        patterns.forEach(function (pattern) {
          var pd = normalizeParsedData(pattern, it.name);
          (pd.warnings || []).forEach(function(warning){warnings.push(it.name+': '+warning);});
          var raw = { name: baseName(it.name) + (patterns.length > 1 ? ' / ' + pd.blockName : ''), tth: pd.tth, y: pd.intensity, sig: pd.sig, weights: pd.weights, inst: instFromFile(pd) };
          if (pd.phaseBlockIds) raw.phases = pd.phaseBlockIds.map(function (blockName) {
            var found = (importedPhases || []).filter(function (p) { return p.source === it.source && p.blockName === blockName; })[0];
            if (!found) throw new Error('Referenced phase block data_' + blockName + ' could not be imported.');
            return found.key;
          });
          if (Number.isFinite(pd.zeroShift)) raw.p = { zero: pd.zeroShift };
          fileRaws.push(raw);
        });
        Array.prototype.push.apply(raws, fileRaws);
      } catch (e) { failed++; ui.toast(it.name + ': ' + ((e && e.message) || e), 'err'); }
    }
    if (!raws.length) return;
    snapshot('reading ' + plural(raws.length, 'file'));
    var made = St.addDatasets(raws);
    if(RV.app)RV.app.showTab('pattern');
    var pts = made.reduce(function (a, d) { return a + d.tth.length; }, 0), wl = made.filter(function (d) { return raws[made.indexOf(d)].inst.lambda1; }).length;
    ui.toast('Read ' + plural(made.length, 'dataset') + ' (' + pts + ' points): ' + made.slice(0, 3).map(function (d) { return d.name; }).join(', ') + (made.length > 3 ? ' …' : '') + '. ' +
      (wl ? 'Wavelength from the file' + (wl < made.length ? ' for ' + wl + ' of them' : '') + '. ' : 'No wavelength in the file: ' + made[0].inst.lambda1 + ' Å assumed (Data, Instrument and range). ') +
      (S.phases.length ? 'Scales estimated.' : 'Next: read a structure CIF.'), failed ? 'warn' : 'ok');
    warnings.forEach(function(warning){ui.toast(warning,'warn');});
  }
  function phaseFromCif(text, fileName) {
    if (!window.CifStructure) throw new Error('the CIF reader (js/cif_structure.js) is not loaded');
    var cif = CifStructure.parse(text);
    if (!cif.cell) throw new Error('no cell (_cell_length_a)');
    var hm = cif.sgName && cif.sgName !== cif.sgHall ? cif.sgName : null;
    var sg = St.resolveFileSG({ symbol: hm, hall: cif.sgHall, number: cif.sgNumber }, cif.cell);
    if (!sg) throw new Error('space group ' + (cif.sgName || cif.sgNumber || '(none given)') + ' not recognised');
    var ph = St.makePhase({ name: cif.blockName && !/^global$/i.test(cif.blockName) ? cif.blockName : baseName(fileName), sg: sg, cell: cif.cell, atoms: cifAtoms(cif) });
    return { ph: ph, cif: cif, how: sg.how };
  }
  function readStructures(items) {
    if (!haveSG()) return [];
    var blocks = [], imported = [];
    items.forEach(function (it) {
      try {
        var parts = CifReader.parse(it.text).filter(function (b) { return Object.keys(b.values).some(function (k) { return /^_cell[._]length_a$/i.test(k); }); });
        if (!parts.length) blocks.push(it);
        else parts.forEach(function (b) { blocks.push({ name: it.name, text: b.text, source: it.source }); });
      } catch (e) { ui.toast(it.name + ': ' + e.message, 'err'); }
    });
    blocks.forEach(function (it) {
      var got;
      try { got = phaseFromCif(it.text, it.name); } catch (e) { ui.toast(it.name + ': ' + e.message, 'err'); return; }
      snapshot('reading phase ' + got.ph.name);
      St.addPhase(got.ph);
      imported.push({ source: it.source, blockName: got.cif.blockName, key: got.ph.key });
      var ph = got.ph, miss = S.tables ? ph.atoms.filter(function (a) { return !St.scatterer(a.type).xray; }).map(function (a) { return a.label + ' (' + a.type + ')'; }) : [];
      ui.toast('Phase ' + ph.name + ' from ' + it.name + ': ' + St.sgText(ph.sg) + ', ' + ph.sg.system + ', ' + plural(ph.atoms.length, 'atom') + ' (' +
        ph.atoms.slice(0, 6).map(function (a) { return a.label + ' ' + a.site.wyck; }).join(', ') + (ph.atoms.length > 6 ? ' …' : '') + ')' +
        (got.cif.blocks > 1 ? '. The file has ' + got.cif.blocks + ' data blocks: only the first was read' : '') +
        (got.how !== 'exact' ? '. The symbol of the file (' + (got.cif.sgName || got.cif.sgNumber) + ') named no setting exactly: check the space group' : '') +
        (miss.length ? '. Not in the X-ray table: ' + miss.join(', ') : '') +
        (S.datasets.length ? '. In ' + (S.datasets.length > 1 ? 'every dataset, scales estimated (change assignments in Datasets for datasets without it)' : 'the dataset, scale estimated') + '.' : '.'),
        miss.length || got.cif.blocks > 1 || got.how !== 'exact' ? 'warn' : 'ok');
    });
    return imported;
  }
  async function readData0() { var fs = await ui.pickFiles({ multiple: true }); if (fs.length) await readFiles(fs); }
  async function readStructure() {
    if (!idle() || !haveSG()) return;
    var fs = await ui.pickFiles({ multiple: true, accept: '.cif,.pdcif' });
    if (!fs.length) return;
    var items = [];
    for (var i = 0; i < fs.length; i++) { try { items.push({ name: fs[i].name, text: new TextDecoder().decode(await ui.readBuffer(fs[i])) }); } catch (e) { ui.toast(fs[i].name + ': ' + e.message, 'err'); } }
    readStructures(items);
  }

  // ---------------------------------------------------------------- phases
  async function newPhase() {
    if (!idle() || !haveSG()) return;
    var n = S.phases.length + 1, chosen = null;
    var v = await ui.prompt('New phase', [
      { key: 'name', label: 'Name', type: 'text', value: 'phase ' + n },
      { key: 'sg', label: 'Space group', type: 'text', value: 'P 1', list: 'sg-list', hint: 'Symbol (P 21/c, Fm-3m), number or Hall symbol' },
      { key: 'a', label: 'a /Å', type: 'number', value: 5 }, { key: 'b', label: 'b /Å', type: 'number', value: 5, hint: 'Lengths and angles the crystal system fixes are ignored.' },
      { key: 'c', label: 'c /Å', type: 'number', value: 5 }, { key: 'alpha', label: 'α /°', type: 'number', value: 90 },
      { key: 'beta', label: 'β /°', type: 'number', value: 90 }, { key: 'gamma', label: 'γ /°', type: 'number', value: 90 },
    ].concat(S.datasets.length > 1 && S.sel.size && S.sel.size < S.datasets.length ? [{ key: 'where', label: 'In', type: 'select', value: 'all',
      options: [['all', 'every dataset (' + S.datasets.length + ')'], ['sel', 'the selected datasets (' + S.sel.size + ')']], hint: 'Change phase assignments later in Datasets.' }] : []), 'Make phase', 'A phase without atoms is fitted by Le Bail or WPPF; once it has atoms (added in the Phases tab, or found in the Solve tab) it can be fitted by Rietveld. A structure CIF (File) gives the space group, the cell and the atoms at once.',
    { onOpen: function (body) {
      var sgInput = body.querySelector('[data-key="sg"]');
      function adapt() {
        var sg = St.resolveSG(sgInput.value);
        if (!sg) return;
        var free = C.cellParams(sg.system, sg.uniqueAxis);
        var raw = {};
        ['a', 'b', 'c', 'alpha', 'beta', 'gamma'].forEach(function (c) { raw[c] = ui.parseNum(body.querySelector('[data-key="' + c + '"]').value); });
        var cell = normaliseCell(raw, sg.system, sg.uniqueAxis);
        ['a', 'b', 'c', 'alpha', 'beta', 'gamma'].forEach(function (c) {
          var el = body.querySelector('[data-key="' + c + '"]'), on = free.indexOf(c) >= 0;
          el.parentElement.hidden = !on;
          body.querySelector('label[for="f_' + c + '"]').hidden = !on;
          if (!on && cell) el.value = cell[c];
        });
        sgInput.title = sg.system + ': independent parameters ' + free.join(', ');
      }
      sgInput.addEventListener('input', adapt); sgInput.addEventListener('change', adapt);
      body.addEventListener('change', function (e) { if (e.target.matches('[data-key="a"]')) adapt(); });
      adapt();
    }, check: function (r) {
      chosen = St.resolveSG(r.sg);
      if (!chosen) return 'Space group not recognised: ' + r.sg + '.';
      var cell = normaliseCell(r, chosen.system, chosen.uniqueAxis);
      if (!cell || !C.cellParams(chosen.system, chosen.uniqueAxis).every(function (c) { return Number.isFinite(r[c]) && (/^[abc]$/.test(c) ? r[c] > 0 : r[c] > 0 && r[c] < 180); }) || !(cellVolume(cell) > 0)) return 'Enter a valid cell with positive lengths and a positive volume.';
      return '';
    } });
    if (!v || !chosen) return;
    var ph = St.makePhase({ name: v.name.trim() || 'phase ' + n, sg: chosen, cell: { a: v.a, b: v.b, c: v.c, alpha: v.alpha, beta: v.beta, gamma: v.gamma } });
    var only = v.where === 'sel' ? Array.from(S.sel) : null;
    snapshot('new phase ' + ph.name);
    St.addPhase(ph, only);
    RV.app.showTab('phases');
    ui.toast('New phase ' + ph.name + ': ' + St.sgText(ph.sg) + ', ' + ph.sg.system + ', fitted by ' + C.METHOD_LABELS[ph.method] + (only ? ', in the ' + plural(only.length, 'selected dataset') : '') +
             '. Tick its cell and peak shape and fit; add atoms for Rietveld.', 'ok');
  }
  async function addAtom() {
    var ph = St.currentPhase();
    if (!idle() || !havePhase()) return;
    var used = new Set(ph.atoms.map(function (a) { return a.label; })), k = ph.atoms.length + 1;
    while (used.has('X' + k)) k++;
    var v = await ui.prompt('Add an atom to ' + ph.name, [
      { key: 'label', label: 'Label', type: 'text', value: 'X' + k }, { key: 'type', label: 'Scatterer', type: 'text', value: 'O', list: 'scat-list', hint: 'Element or ion of the scattering table: Fe, Fe3+, O2- …' },
      { key: 'x', label: 'x', type: 'number', value: 0 }, { key: 'y', label: 'y', type: 'number', value: 0 }, { key: 'z', label: 'z', type: 'number', value: 0 },
      { key: 'occ', label: 'Occupancy', type: 'number', value: 1 }, { key: 'B', label: 'B /Å²', type: 'number', value: 0.5 }
    ], 'Add atom', 'Fractional coordinates. The site, its multiplicity and the coordinates it allows are worked out from the position.');
    if (!v) return;
    var ds = St.first(), src = ds && St.hasPhase(ds, ph) ? ds.p : ph.v;
    snapshot('adding an atom to ' + ph.name);
    var label = St.addAtomTo(ph, { label: v.label, type: v.type.trim() || 'O', x: v.x, y: v.y, z: v.z, occ: v.occ, B: v.B }, St.cellOf(ph, src));
    St.phaseChanged(ph);
    var at = ph.atoms.filter(function (a) { return a.label === label; })[0];
    ui.toast('Atom ' + label + ' added to ' + ph.name + ' on ' + at.site.wyck + ' (' + at.site.expr + ').', 'ok');
  }
  // ---------------------------------------------------------------- atoms into the current phase: from a CIF, or a molecule (fragment)
  function cifAtoms(cif) {
    return cif.atoms.map(function (a) {
      return { label: a.siteLabel, type: a.type || St.elementOf(a.siteLabel) || a.siteLabel, x: a.x, y: a.y, z: a.z, occ: Number.isFinite(a.occ) ? a.occ : 1,
               B: Number.isFinite(a.biso) ? a.biso : Number.isFinite(a.uiso) ? 8 * Math.PI * Math.PI * a.uiso : 0.5 };
    });
  }
  // the cell the new atoms are placed in: that of the first dataset holding the phase (its fitted cell), else the starting model
  function modelCell(ph) { var ds = St.first(), src = ds && St.hasPhase(ds, ph) ? ds.p : ph.v; return St.cellOf(ph, src); }
  // mode 'add' keeps the atoms of the phase, 'replace' clears them (with their values, flags and constraints) first
  function putAtoms(ph, atoms, mode) {
    var cell = modelCell(ph);
    if (mode === 'replace') St.replaceAtoms(ph, atoms, cell);
    else { var used = new Set(ph.atoms.map(function (a) { return a.label; })); atoms.forEach(function (a) { St.addAtomTo(ph, a, cell, used); }); St.phaseChanged(ph); }
  }
  /* The atoms of a structure CIF into ph, at the fractional coordinates of the file: the phase keeps its cell and space
     group. -> {n, notes}: what does not match (another space group, another cell) is said, not refused. */
  function atomsFromCifText(ph, text, mode) {
    var cif = CifStructure.parse(text), notes = [];
    if (!cif.atoms.length) throw new Error('no atom sites (_atom_site_fract_x …) in the file');
    var sg = St.resolveFileSG({ symbol: cif.sgName && cif.sgName !== cif.sgHall ? cif.sgName : null, hall: cif.sgHall, number: cif.sgNumber }, cif.cell || modelCell(ph));
    if (sg && sg.hall !== ph.sg.hall) notes.push('the file is in ' + St.sgText(sg) + ', the phase in ' + St.sgText(ph.sg) + ': the sites are read as sites of ' + St.sgText(ph.sg));
    else if (!sg) notes.push('the space group of the file is not given or not recognised: the sites are read as sites of ' + St.sgText(ph.sg));
    var cell = modelCell(ph);
    if (cif.cell && cell && ['a', 'b', 'c'].some(function (k) { return Math.abs(cif.cell[k] - cell[k]) > 0.02 * cell[k]; })) notes.push('the cell of the file (' + ['a', 'b', 'c'].map(function (k) { return cif.cell[k].toFixed(3); }).join(', ') + ' Å) differs from that of the phase by more than 2 %');
    var atoms = cifAtoms(cif);
    putAtoms(ph, atoms, mode);
    return { n: atoms.length, notes: notes };
  }
  async function atomsFromCif() {
    var ph = St.currentPhase();
    if (!idle() || !havePhase()) return;
    var fs = await ui.pickFiles({ accept: '.cif' });
    if (!fs.length) return;
    var text;
    try { text = new TextDecoder().decode(await ui.readBuffer(fs[0])); } catch (e) { ui.toast(fs[0].name + ': ' + e.message, 'err'); return; }
    var mode = 'add';
    if (ph.atoms.length) {
      var v = await ui.prompt('Atoms from ' + fs[0].name, [{ key: 'mode', label: 'Atoms of ' + ph.name, type: 'select', value: 'replace', options: [['replace', 'Replace the ' + plural(ph.atoms.length, 'atom') + ' of the phase'], ['add', 'Add to them']] }],
        'Read atoms', 'The atom sites of the CIF go into ' + ui.esc(ph.name) + ' at their fractional coordinates; the cell and the space group of the phase stay as they are.');
      if (!v) return;
      mode = v.mode;
    }
    if (!idle() || St.currentPhase() !== ph) return;
    snapshot((mode === 'replace' ? 'replacing the atoms of ' : 'adding atoms to ') + ph.name + ' from ' + fs[0].name);
    try { var r = atomsFromCifText(ph, text, mode); }
    catch (e) { ui.toast(fs[0].name + ': ' + e.message, 'err'); return; }
    ui.toast(plural(r.n, 'atom') + ' of ' + fs[0].name + (mode === 'replace' ? ' now make ' : ' added to ') + ph.name + (r.notes.length ? '; ' + r.notes.join('; ') + '.' : '.'), r.notes.length ? 'warn' : 'ok');
  }
  /* A molecule (PDB, MOL/SDF, XYZ, Z-matrix) into ph, as a fragment: labels by element (C1, C2 …, past those in the
     phase), its centroid at o.centre in the orientation of the file, or at the coordinates of its own cell (a PDB with
     CRYST1, o.centre null). o.restraints: the bonds and angles of the molecule are added to the restraints of the phase,
     by the labels just made. -> {atoms, bonds, angles} */
  function fragmentInto(ph, mol, o) {
    var used = new Set(o.mode === 'replace' ? [] : ph.atoms.map(function (a) { return a.label; }));
    var fr = MoleculeRules.fragment(mol, { cell: modelCell(ph), centre: o.centre, skipH: o.skipH, used: used });
    putAtoms(ph, fr.atoms.map(function (a) { return { label: a.label, type: a.el, x: a.x, y: a.y, z: a.z, occ: 1, B: Number.isFinite(o.B) ? o.B : 3 }; }), o.mode);
    // an atom within 0.02 Å of a symmetry element is put on it, with a lower multiplicity: said, since the molecule is meant on general positions
    var mine = new Set(fr.atoms.map(function (a) { return a.label; }));
    var out = { atoms: fr.atoms.length, bonds: 0, angles: 0, special: ph.atoms.filter(function (a) { return mine.has(a.label) && a.site.mult < ph.ops.length; }).map(function (a) { return a.label; }) };
    if (o.restraints) {
      var made = MoleculeRules.rules(fr.named, { only: new Set(fr.atoms.map(function (a) { return a.label; })) });
      if (made.text) {
        var merged = AtomRestraints.merge(ph.atoms, ph.restraints.text, made.text);
        ph.restraints = AtomRestraints.normalize(Object.assign({}, ph.restraints, { text: merged.text }));
        out.bonds = made.bonds; out.angles = made.angles; S.version++; RV.bus.emit('phases');
      }
    }
    return out;
  }
  async function fragment() {
    var ph = St.currentPhase();
    if (!idle() || !havePhase()) return;
    var fs = await ui.pickFiles({ accept: '.pdb,.ent,.mol,.sdf,.xyz,.zmat,.txt' });
    if (!fs.length) return;
    var mol;
    try { mol = MoleculeRules.read(new TextDecoder().decode(await ui.readBuffer(fs[0])), { name: fs[0].name }); } catch (e) { ui.toast(fs[0].name + ': ' + e.message, 'err'); return; }
    var nH = mol.atoms.filter(function (a) { return a.el === 'H'; }).length, ds = St.first(), neutron = ds && ds.inst.radiation === 'neutron';
    var p = MoleculeRules.generalPoint(ph.ops, modelCell(ph)), f3 = function (x) { return +x.toFixed(3); };
    var fields = [];
    if (ph.atoms.length) fields.push({ key: 'mode', label: 'Atoms of ' + ph.name, type: 'select', value: 'add', options: [['add', 'Add the fragment to the ' + plural(ph.atoms.length, 'atom')], ['replace', 'Replace them by the fragment']] });
    if (mol.cell) fields.push({ key: 'place', label: 'Position', type: 'select', value: 'file', options: [['file', 'As in the file (its CRYST1 cell)'], ['point', 'Centred at a point']] });
    fields.push({ key: 'x', label: 'Centre x', type: 'number', value: f3(p[0]), when: mol.cell ? 'place:point' : '' }, { key: 'y', label: 'Centre y', type: 'number', value: f3(p[1]), when: mol.cell ? 'place:point' : '' },
                { key: 'z', label: 'Centre z', type: 'number', value: f3(p[2]), when: mol.cell ? 'place:point' : '', hint: 'Fractional. The default is the point of the cell farthest from every symmetry element (a general position).' },
                { key: 'B', label: 'B /Å²', type: 'number', value: 3 });
    if (nH) fields.push({ key: 'skipH', label: 'Leave out the ' + nH + ' H', type: 'checkbox', value: !neutron, hint: 'X-rays barely see hydrogen; the restraints still follow the full molecule.' });
    fields.push({ key: 'restraints', label: 'Restraints', type: 'checkbox', value: true, hint: 'Add a rule for every bond and every angle (1-3 distance) of the molecule to the restraints of the phase.' });
    fields.forEach(function (f) { if (!f.when) delete f.when; });
    var v = await ui.prompt('Fragment from ' + fs[0].name, fields, 'Add fragment',
      ui.esc(mol.format) + ': ' + plural(mol.atoms.length, 'atom') + '. The molecule keeps the orientation of the file; its atoms are labelled by element (C1, C2 …) and placed in the cell of ' + ui.esc(ph.name) + ' on general positions. It is a starting model: refine it with restraints, or move it.');
    if (!v || !idle() || St.currentPhase() !== ph) return;
    var mode = v.mode || 'add', centre = mol.cell && v.place === 'file' ? null : [v.x, v.y, v.z];
    snapshot((mode === 'replace' ? 'replacing the atoms of ' : 'adding a fragment to ') + ph.name + ' from ' + fs[0].name);
    try { var r = fragmentInto(ph, mol, { mode: mode, centre: centre, skipH: !!v.skipH, B: v.B, restraints: v.restraints }); }
    catch (e) { ui.toast(fs[0].name + ': ' + e.message, 'err'); return; }
    ui.toast('Fragment ' + fs[0].name + ': ' + plural(r.atoms, 'atom') + (mode === 'replace' ? ' now make ' : ' added to ') + ph.name + (r.bonds ? ', with ' + r.bonds + ' bond and ' + r.angles + ' angle restraints' : '') + '.' +
      (r.special.length ? ' ' + r.special.join(', ') + ' fell on a symmetry element (special position): move the fragment to another centre.' : ''), r.special.length ? 'warn' : 'ok');
  }
  async function deletePhase(key) {
    var ph = typeof key==='string'?St.phaseByKey(key):St.currentPhase();if(!ph)return;
    if (!idle() || !havePhase()) return;
    if (!(await ui.confirm('Delete phase ' + ph.name + ' from every dataset? Undo brings it back.', 'Delete', true, 'Delete phase'))) return;
    if(!idle() || !St.phaseByKey(ph.key))return;
    snapshot('deleting phase ' + ph.name);
    St.removePhase(ph.key);
    ui.toast('Phase ' + ph.name + ' deleted.', 'info');
  }

  function setMethod(ph, m) { if (!S.busy) RV.app.calculation(m); }

  /* A phase put in the selected datasets, or taken out of them (the box of each row of the Phases panel, the command
     phases>>). A phase taken out keeps its values in the dataset, for when it comes back. */
  function phaseIn(ph, on, list) {
    if (!idle()) return false;
    list = list || sel();
    if (!need(list.length, 'Select the datasets to put ' + ph.name + ' in or take it out of.')) return false;
    var todo = list.filter(function (ds) { return St.hasPhase(ds, ph) !== !!on; });
    if (!todo.length) { ui.toast(ph.name + ' is ' + (on ? 'already in' : 'in none of') + ' the ' + plural(list.length, 'selected dataset') + '.', 'info'); return false; }
    snapshot((on ? 'putting ' : 'taking ') + ph.name + (on ? ' in ' : ' out of ') + plural(todo.length, 'dataset'));
    St.setPhaseIn(todo, ph, on);
    var n = St.holdersOf(ph).length;
    ui.toast(ph.name + (on ? ' put in ' : ' taken out of ') + todo.map(function (d) { return d.name; }).slice(0, 4).join(', ') + (todo.length > 4 ? ' …' : '') + '; it is in ' + n + ' of ' + plural(S.datasets.length, 'dataset') + '.' +
             (on && ph.method === 'rietveld' ? ' Its scale was estimated there.' : '') + (!on ? ' Its values there are kept for when it comes back.' : ''), 'ok');
    return true;
  }
  // phases>>p1&p2, phases>>all, phases>>none: the phases of the selected datasets (keys or names)
  function setPhasesOfSelection(arg) {
    if (!idle() || !haveSel()) return;
    var a = String(arg || '').trim(), want;
    if (/^all$/i.test(a)) want = S.phases.slice();
    else if (/^none$/i.test(a)) want = [];
    else {
      want = [];
      var bad = [];
      a.split('&').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) {
        var ph = St.phaseByKey(x) || S.phases.filter(function (p) { return p.name.toLowerCase() === x.toLowerCase(); })[0];
        if (ph) { if (want.indexOf(ph) < 0) want.push(ph); } else bad.push(x);
      });
      if (bad.length || !want.length) { ui.toast(bad.length ? 'No such phase: ' + bad.join(', ') + '. Phases: ' + S.phases.map(function (p) { return p.key + ' (' + p.name + ')'; }).join(', ') + '.' : 'phases>>p1&p2, phases>>all or phases>>none.', 'err'); return; }
    }
    var list = sel(), change = S.phases.filter(function (ph) { var on = want.indexOf(ph) >= 0; return list.some(function (ds) { return St.hasPhase(ds, ph) !== on; }); });
    if (!change.length) { ui.toast('The ' + plural(list.length, 'selected dataset') + ' already hold ' + (want.length ? want.map(function (p) { return p.name; }).join(' and ') : 'no phase') + '.', 'info'); return; }
    snapshot('phases of ' + plural(list.length, 'dataset'));
    change.forEach(function (ph) { St.setPhaseIn(list, ph, want.indexOf(ph) >= 0); });
    ui.toast('Phases of ' + plural(list.length, 'selected dataset') + ': ' + (want.length ? want.map(function (p) { return p.name; }).join(', ') : 'none') + '.', 'ok');
  }

  /* The phases of every dataset, as a table: a row per dataset, a column per phase (the box of a column head puts the
     phase in every dataset or takes it out of all of them). */
  async function phaseMap() {
    if (!idle() || !havePhase()) return;
    if (!need(S.datasets.length, 'No dataset yet: read a powder pattern first.')) return;
    var esc = ui.esc, list = S.datasets.slice();
    var head = '<tr><th>Dataset</th>' + S.phases.map(function (ph, i) {
      return '<th><label class="pm-h" title="' + esc('Put ' + ph.name + ' in every dataset, or take it out of all of them') + '"><input type="checkbox" data-pm-col="' + i + '">' +
        '<i class="sw-inline" style="background:' + RV.plots.phaseVar(i) + '"></i>' + esc(ph.name) + '</label></th>';
    }).join('') + '</tr>';
    var rows = list.map(function (ds, r) {
      return '<tr' + (S.sel.has(ds.id) ? ' class="on"' : '') + '><th scope="row"><i class="sw-inline" style="background:' + RV.plots.colorVar(ds) + '"></i>' + esc(ds.name) + '</th>' +
        S.phases.map(function (ph, i) {
          return '<td><input type="checkbox" data-pm="' + r + ':' + i + '"' + (St.hasPhase(ds, ph) ? ' checked' : '') + ' aria-label="' + esc(ph.name + ' in ' + ds.name) + '"></td>';
        }).join('') + '</tr>';
    }).join('');
    function sync(b) {
      S.phases.forEach(function (ph, i) {
        var cells = b.querySelectorAll('[data-pm$=":' + i + '"]'), on = Array.prototype.filter.call(cells, function (c) { return c.checked; }).length, h = b.querySelector('[data-pm-col="' + i + '"]');
        h.checked = on === cells.length; h.indeterminate = on > 0 && on < cells.length;
      });
    }
    var want = await ui.modal({
      title: 'Phases of the datasets', wide: true,
      body: '<p class="intro">Tick the phases each pattern holds: a mixture in one pattern, a pure phase in another. A phase adds nothing to a dataset that does not hold it; ' +
            'taken out, it keeps its values there for when it comes back.</p><div class="table-wrap pm-wrap"><table class="grid compact pm"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
            '<p class="hint">Highlighted: the selected datasets. In a global fit, a shared parameter of a phase has one value for the datasets of the fit that hold it (Sharing… to keep some of them apart).</p>',
      onOpen: function (b) {
        sync(b);
        b.addEventListener('change', function (e) {
          var col = e.target.getAttribute('data-pm-col');
          if (col != null) b.querySelectorAll('[data-pm$=":' + col + '"]').forEach(function (c) { c.checked = e.target.checked; });
          sync(b);
        });
      },
      buttons: [{ label: 'Cancel', value: null },
                { label: 'Apply', primary: true, value: function (b) { return list.map(function (ds, r) { return S.phases.map(function (ph, i) { return b.querySelector('[data-pm="' + r + ':' + i + '"]').checked; }); }); } }]
    });
    if (!want || !idle()) return;
    var phases = S.phases.slice(), moves = phases.map(function (ph, i) {
      var live = function (ds) { return S.datasets.indexOf(ds) >= 0; };
      return { ph: ph, on: list.filter(function (ds, r) { return live(ds) && want[r][i] && !St.hasPhase(ds, ph); }), off: list.filter(function (ds, r) { return live(ds) && !want[r][i] && St.hasPhase(ds, ph); }) };
    }).filter(function (m) { return m.on.length || m.off.length; });
    if (!moves.length) { ui.toast('No change to the phases of the datasets.', 'info'); return; }
    snapshot('phases of the datasets');
    moves.forEach(function (m) { if (m.on.length) St.setPhaseIn(m.on, m.ph, true); if (m.off.length) St.setPhaseIn(m.off, m.ph, false); });
    ui.toast('Phases of the datasets: ' + moves.map(function (m) {
      return m.ph.name + (m.on.length ? ' put in ' + nameList(m.on) : '') + (m.on.length && m.off.length ? ' and' : '') + (m.off.length ? ' taken out of ' + nameList(m.off) : '');
    }).join('; ') + '.', 'ok');
  }
  function nameList(list) { var t = list.slice(0, 4).map(function (d) { return d.name; }).join(', '); return list.length > 4 ? t + ' and ' + (list.length - 4) + ' more' : t; }

  /* Sharing in the global fit of the selected datasets: a row per group of shareable parameters of each phase (cell and
     orientation, peak shape, each atom), a column per selected dataset. Shared: one value for the ticked datasets that
     hold the phase, the unticked ones keeping their own value; not shared: one value per dataset. */
  function shareGroups(list) {
    var out = [];
    [['Acquisition', 'zero point', ['zero']], ['Sample geometry', 'displacement, transparency', ['disp', 'transp']]].forEach(function (g, i) {
      out.push({ key: 'dataset:' + i, ph: { name: g[0] }, pi: 0, held: list.slice(), names: g[2], sub: g[1], tip: g[2].join(', ') });
    });
    var instHeld = list.filter(function (d) { return St.instrumentParamsFor(d).length > 0; });
    if (instHeld.length) out.push({ key:'instrument-resolution', ph:{name:'Instrument resolution'}, pi:0, held:instHeld, names:St.instrumentParamsFor(instHeld).map(function(p){return 'inst.'+p[0];}), sub:'calibration', tip:'One instrumental resolution per dataset; share between datasets measured with the same calibrated instrument.' });
    S.phases.forEach(function (ph, pi) {
      var held = list.filter(function (ds) { return St.hasPhase(ds, ph); });
      if (!held.length) return;
      var by = {};
      St.phaseNames(ph).filter(function (n) { return St.shareable(n) && St.isVariable(n); }).forEach(function (n) {
        var c = C.classify(n), k = c.kind === 'atom' ? 'atom:' + c.atom : c.kind === 'profile' ? 'prof' : 'cell';
        (by[k] = by[k] || []).push(n);
      });
      Object.keys(by).forEach(function (k) {
        var nm = by[k], atom = k.indexOf('atom:') === 0;
        out.push({ key: ph.key + ':' + k, ph: ph, pi: pi, held: held, names: nm,
                   sub: atom ? k.slice(5) : k === 'prof' ? 'peak shape' : nm.some(function (n) { return C.classify(n).kind === 'po'; }) ? 'cell, orientation' : 'cell',
                   tip: nm.map(function (n) { return n.slice(ph.key.length + 1); }).join(' ') });
      });
    });
    return out;
  }
  async function sharing(focus) {
    if (!idle() || !haveSel(2)) return;
    var list = sel(), esc = ui.esc, groups = shareGroups(list);
    if (!groups.length) { ui.toast('Nothing to share: the selected datasets hold no phase with a cell, a peak shape or atoms to refine.', 'warn'); return; }
    function tri(n, of) { return n === of ? ' checked' : ''; }
    var head = '<tr><th>Parameters</th><th title="Shared: one value for the ticked datasets. Not shared: one value per dataset">Shared</th>' + list.map(function (ds, j) {
      return '<th><label class="pm-h" title="' + esc(ds.name + ': share every group (ticked) or keep its own values') + '"><input type="checkbox" data-sh-col="' + j + '"><i class="sw-inline" style="background:' + RV.plots.colorVar(ds) + '"></i>' + esc(ds.name) + '</label></th>';
    }).join('') + '<th>In the global fit</th></tr>';
    var rows = groups.map(function (g, r) {
      var nSh = g.names.filter(St.isShared).length, foc = focus && g.names.indexOf(focus) >= 0;
      return '<tr data-row="' + r + '"' + (foc ? ' class="focus"' : '') + '><th scope="row" title="' + esc(g.tip) + '"><i class="sw-inline" style="background:' + RV.plots.phaseVar(g.pi) + '"></i>' + esc(g.ph.name) + ' <span class="sub">' + esc(g.sub) + '</span></th>' +
        '<td><input type="checkbox" data-sh="' + r + '"' + tri(nSh, g.names.length) + ' data-mixed="' + (nSh > 0 && nSh < g.names.length ? 1 : 0) + '" aria-label="' + esc('Share ' + g.ph.name + ' ' + g.sub) + '"></td>' +
        list.map(function (ds, j) {
          if (g.held.indexOf(ds) < 0) return '<td class="why" title="' + esc(g.ph.name + ' is not in ' + ds.name) + '">—</td>';
          var nIn = g.names.filter(function (n) { return !St.isApart(ds, n); }).length;
          return '<td><input type="checkbox" data-in="' + r + ':' + j + '"' + tri(nIn, g.names.length) + ' data-mixed="' + (nIn > 0 && nIn < g.names.length ? 1 : 0) + '" aria-label="' + esc(ds.name + ' shares ' + g.ph.name + ' ' + g.sub) + '"></td>';
        }).join('') + '<td class="sh-sum" data-sum="' + r + '"></td></tr>';
    }).join('');
    function box(b, q) { return b.querySelector(q); }
    function sync(b) {
      groups.forEach(function (g, r) {
        var sh = box(b, '[data-sh="' + r + '"]'), on = sh.checked || sh.indeterminate, ins = [], outs = [];
        list.forEach(function (ds, j) {
          var c = box(b, '[data-in="' + r + ':' + j + '"]');
          if (!c) return;
          c.disabled = !on;
          (c.checked || c.indeterminate ? ins : outs).push(ds);
        });
        var t;
        if (!on) t = g.held.length > 1 ? 'a value per dataset' : 'in ' + g.held[0].name + ' only';
        else if (ins.length < 2) t = 'a value per dataset' + (ins.length ? ' (one dataset ticked)' : '');
        else t = 'one value for ' + nameList(ins) + (outs.length ? '; ' + nameList(outs) + ' ' + (outs.length === 1 ? 'its' : 'their') + ' own' : '');
        if (sh.indeterminate || ins.some(function (ds) { var c = box(b, '[data-in="' + r + ':' + list.indexOf(ds) + '"]'); return c && c.indeterminate; })) t += ' (some parameters differ)';
        box(b, '[data-sum="' + r + '"]').textContent = t;
      });
      list.forEach(function (ds, j) {
        var cells = Array.prototype.filter.call(b.querySelectorAll('[data-in$=":' + j + '"]'), function (c) { return c.getAttribute('data-in').split(':')[1] === String(j); });
        var n = cells.filter(function (c) { return c.checked; }).length, h = box(b, '[data-sh-col="' + j + '"]');
        h.checked = cells.length > 0 && n === cells.length; h.indeterminate = n > 0 && n < cells.length; h.disabled = !cells.length;
      });
    }
    var res = await ui.modal({
      title: 'Sharing in the global fit', size: groups.length > 8 || list.length > 5 ? 'xl' : '', wide: true,
      body: '<p class="intro">For the global fit of the ' + plural(list.length, 'selected dataset') + '. A shared group of parameters has one value for the ticked datasets that hold its phase; ' +
            'an unticked dataset keeps its own value. Not shared: one value per dataset. Scales and background have one value per dataset. Zero point and sample geometry may be shared explicitly; what is refined is what is ticked in the dataset tabs.</p>' +
            '<div class="table-wrap pm-wrap"><table class="grid compact pm sh"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
            '<p class="hint">The padlocks of Parameters show the same: closed shared, open one value per dataset; right-click a padlock to come back here.</p>',
      onOpen: function (b) {
        b.querySelectorAll('[data-mixed="1"]').forEach(function (c) { c.indeterminate = true; });
        sync(b);
        var f = b.querySelector('tr.focus');
        if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
        b.addEventListener('change', function (e) {
          var col = e.target.getAttribute('data-sh-col');
          if (col != null) groups.forEach(function (g, r) { var c = box(b, '[data-in="' + r + ':' + col + '"]'); if (c && !c.disabled) { c.checked = e.target.checked; c.indeterminate = false; } });
          e.target.indeterminate = false;
          sync(b);
        });
      },
      buttons: [{ label: 'Cancel', value: null },
                { label: 'Apply', primary: true, value: function (b) {
                  return groups.map(function (g, r) {
                    var sh = box(b, '[data-sh="' + r + '"]');
                    return { shared: sh.indeterminate ? null : sh.checked,
                             apart: list.map(function (ds, j) { var c = box(b, '[data-in="' + r + ':' + j + '"]'); return !c || c.indeterminate ? null : !c.checked; }) };
                  });
                } }]
    });
    if (!res || !idle()) return;
    var changed = [];
    groups.forEach(function (g, r) {
      var w = res[r], diff = false;
      if (w.shared != null && g.names.some(function (n) { return St.isShared(n) !== w.shared; })) diff = true;
      list.forEach(function (ds, j) { if (w.apart[j] != null && (g.held.indexOf(ds) >= 0) && g.names.some(function (n) { return St.isApart(ds, n) !== w.apart[j]; })) diff = true; });
      if (diff) changed.push(r);
    });
    if (!changed.length) { ui.toast('No change to the sharing.', 'info'); return; }
    snapshot('sharing in the global fit');
    changed.forEach(function (r) {
      var g = groups[r], w = res[r];
      if (w.shared != null) g.names.forEach(function (n) { if (St.isShared(n) !== w.shared) St.setShared(n, w.shared); });
      list.forEach(function (ds, j) { if (w.apart[j] != null && (g.held.indexOf(ds) >= 0)) St.setApart([ds], g.names, w.apart[j]); });
    });
    RV.bus.emit('params', {});
    ui.toast('Sharing in the global fit: ' + changed.map(function (r) {
      var g = groups[r], so = St.shareOf(g.names[0], list);
      return g.ph.name + ' ' + g.sub + (so.shared.length ? ' shared by ' + nameList(so.shared) + (so.alone.length ? ', ' + nameList(so.alone) + ' apart' : '') : ' one value per dataset');
    }).join('; ') + '.', 'ok');
  }

  // Resolution files own their profile type; instrument coefficients stay
  // dataset properties, while sample size/strain remain phase/dataset values.
  function calibrationOf(doc) {
    if (!doc || typeof doc !== 'object') throw new Error('Expected an instrument calibration JSON.');
    function validType(type) { return Object.prototype.hasOwnProperty.call(C.PROFILE_PARAMS,type); }
    function checked(type, values, metadata) {
      if (!validType(type)) throw new Error('Unknown calibration profile type: ' + type);
      var out = {};
      C.instrumentProfileParams(type).forEach(function (p) {
        if (!values || !Number.isFinite(values[p[0]])) throw new Error('Missing or non-finite coefficient ' + p[0]);
        if (/^eta/.test(p[0]) && (values[p[0]] < 0 || values[p[0]] > 1)) throw new Error(p[0] + ' must be between 0 and 1.');
        out[p[0]] = values[p[0]];
      });
      var result={format:'powder6-instrument-resolution',version:2,profile:'constant-wavelength',profileType:type,label:String(metadata && metadata.label || C.PROFILE_LABELS[type]),values:out};
      if(metadata && metadata.conversion)result.conversion={approximate:metadata.conversion.approximate===true,notes:(metadata.conversion.notes || []).map(String)};
      return result;
    }
    if (doc.format === 'powder6-instrument-resolution') {
      if (doc.profile !== 'constant-wavelength') throw new Error('Unsupported instrument calibration profile.');
      if (doc.version === 2) return checked(doc.profileType,doc.values,doc);
      if (doc.version !== 1) throw new Error('Unsupported instrument calibration version.');
      C.INSTRUMENT_PROFILE.forEach(function (p) { if (!doc.values || !Number.isFinite(doc.values[p[0]])) throw new Error('Missing coefficient ' + p[0]); });
      // Earlier exports stored a canonical TCH approximation plus their source.
      // Recover the declared profile, its mixture and both split flanks; keep
      // any edits to the exported mean width coefficients.
      if (doc.source && validType(doc.source.profileType) && doc.source.parameters) {
        var recovered = calibrationOf(doc.source), values = Object.assign({},recovered.values);
        if (recovered.profileType === 'split_pvoigt') {
          ['U','V','W','X'].forEach(function (name) {
            var mean = (values[name+'_L'] + values[name+'_R'])/2, delta = doc.values[name] - mean;
            values[name+'_L'] += delta; values[name+'_R'] += delta;
          });
        } else C.instrumentProfileParams(recovered.profileType).forEach(function (p) { if (Number.isFinite(doc.values[p[0]])) values[p[0]] = doc.values[p[0]]; });
        return checked(recovered.profileType,values,Object.assign({},recovered,{label:doc.label || recovered.label}));
      }
      return checked(doc.profileType || 'gsas_cw',doc.values,doc);
    }
    if (doc.format !== PRESET_FORMAT) throw new Error('Expected a Powder 6 instrument calibration or peak-shape preset, not format ' + JSON.stringify(doc.format === undefined ? null : doc.format) + ' (expected ' + PRESET_FORMAT + ').');
    if (doc.version !== 2) throw new Error('Peak-shape preset version ' + doc.version + ' is not supported (expected 2).');
    if (!doc.parameters || !validType(doc.profileType)) throw new Error('The peak-shape preset has no parameters or an unknown profile type (' + doc.profileType + ').');
    if (doc.separatedProfile === true || doc.profileType === 'gsas_cw') throw new Error('This is a sample-broadening preset. Load it from the active dataset; use Save instrument profile for instrument parameters.');
    var type = doc.profileType, P = doc.parameters, notes = [];
    values = {};
    function read(name, optional) {
      var raw = P['param-'+name.toLowerCase()];
      if (raw == null && optional) return 0;
      if (raw == null || typeof raw === 'boolean' || String(raw).trim() === '' || !Number.isFinite(Number(raw))) throw new Error('Missing or non-finite coefficient ' + name);
      return Number(raw);
    }
    C.instrumentProfileParams(type).forEach(function (p) { values[p[0]] = 0; });
    if (type === 'simple_pvoigt') {
      var gp = read('GP',true);
      values.U = read('GU') + gp; values.V = read('GV'); values.W = read('GW') + gp;
      values.X = read('LX'); values.eta = read('eta');
      notes.push('Voigt mixture eta is retained. GP/cos²(theta) is represented exactly by adding GP to U and W.');
    } else if (type === 'split_pvoigt') {
      ['L','R'].forEach(function (side) {
        ['U','V','W'].forEach(function (name) { values[name+'_'+side] = read('G'+name+'_'+side); });
        values['X_'+side] = read('LX_'+side);
      });
      values.eta_split = read('eta_split');
      notes.push('Both left/right widths and eta_split are retained; no symmetric averaging is used.');
    } else if (type === 'tch_aniso') {
      ['U','V','W','SL','HL'].forEach(function (name) { values[name] = read(name); });
      values.X = read('X'); values.Y = read('Y');
      notes.push('TCH shape is retained: X is the 1/cos(theta) term and Y the tan(theta) term, as in GSAS-II.');
      if (Object.keys(P).some(function (name) { return /^param-s[0-4]{3}$/.test(name) && Number(P[name]) !== 0; })) notes.push('Stephens terms are sample strain, excluded from this instrument calibration; define sample strain in each dataset tab.');
    } else {
      C.instrumentProfileParams(type).forEach(function (p) { values[p[0]] = read(p[0]); });
    }
    return checked(type,values,{label:doc.label || C.PROFILE_LABELS[type],conversion:{approximate:false,notes:notes},
      source:{format:doc.format,version:doc.version,profileType:type,label:doc.label,parameters:Object.assign({},P)}});
  }

  async function resolution(initialDocument, initialName) {
    if (!idle()) return;
    var list = datasetTargets(), d = list[0], current = St.currentPhase();if(!d)return;
    RV.app.showTab('datasets');
    if (!current || !list.some(function(ds){return St.hasPhase(ds,current);})) current=St.phasesIn(d)[0] || null;
    var activeType = d.inst.resolutionType || (current && current.profileType) || 'gsas_cw';
    var loadedDocument = initialDocument ? calibrationOf(initialDocument) : null;
    if (loadedDocument) activeType = loadedDocument.profileType;
    var fields = [];
    C.ALL_INSTRUMENT_PROFILE.forEach(function (p) {
      fields.push({key:p[0],label:p[0]+(/^(U|V|W)(_[LR])?$/.test(p[0])?' /cdeg²':/^(X|Y|Z)(_[LR])?$/.test(p[0])?' /cdeg':''),type:'number',value:Number.isFinite(d.p['inst.'+p[0]])?d.p['inst.'+p[0]]:p[1]});
    });
    if(RV.workspace)fields.unshift(RV.workspace.targetField());
    var v = await ui.prompt('Instrument profile · '+d.name,fields,'Apply resolution',
      'Instrument calibration belongs to each dataset. Sample size and strain remain separate in its phase contributions. Choose refinement flags in the dataset tab.',{
      before:'<p class="buttons"><button type="button" data-res-cal="load">Read instrument profile…</button><button type="button" data-res-cal="save">Save instrument profile…</button></p><p class="hint" data-res-status role="status">Load a calibration to detect its profile and coefficients automatically, or edit the current coefficients. Save instrument profile writes the coefficients shown here. Apply resolution updates the chosen datasets.</p><p class="hint" data-res-profile></p>',
      after:'<p class="hint" data-res-targets></p>',
      onOpen:function(body){
        function status(message) { body.querySelector('[data-res-status]').textContent = message; }
        function showProfile() {
          var active = C.instrumentProfileParams(activeType).map(function (p) { return p[0]; });
          fields.forEach(function (field) {
            if(field.key==='targets')return;
            var key = field.key, hidden = active.indexOf(key) < 0;
            body.querySelector('[data-key="'+field.key+'"]').closest('div').hidden = hidden;
            body.querySelector('label[for="f_'+field.key+'"]').hidden = hidden;
          });
          body.querySelector('[data-res-profile]').textContent = (loadedDocument ? 'Detected profile: ' : 'Current profile: ') + C.PROFILE_LABELS[activeType==='gsas_cw'?'tch_aniso':activeType];
        }
        function showTargets(){if(!RV.workspace)return;var selected=RV.workspace.targets(body.querySelector('[data-key="targets"]').value),phases=S.phases.filter(function(p){return selected.some(function(d){return St.hasPhase(d,p);});});body.querySelector('[data-res-targets]').textContent='Apply to '+selected.length+' datasets · '+selected.slice(0,5).map(function(d){return d.name;}).join(', ')+(selected.length>5?' …':'')+'. Phase contributions: '+phases.map(function(p){return p.name;}).join(', ')+'.';}
        body.addEventListener('change',showTargets);showTargets();
        function loadDocument(doc,name) {
          var parsed = calibrationOf(doc);
          loadedDocument = parsed; activeType = parsed.profileType;
          C.instrumentProfileParams(activeType).forEach(function (p) {
            body.querySelector('[data-key="'+p[0]+'"]').value = parsed.values[p[0]];
          });
          showProfile();
          status('Loaded '+name+'. Apply will use this calibration for the chosen datasets. '+(parsed.conversion && parsed.conversion.notes || []).join(' '));
        }
        if (loadedDocument) loadDocument(loadedDocument,initialName || 'instrument calibration'); else showProfile();
        body.addEventListener('click',async function(e){
          var button=e.target.closest('[data-res-cal]');if(!button || button.disabled)return;
          button.disabled=true;
          try {
            if(button.dataset.resCal==='save'){
              var values={};C.instrumentProfileParams(activeType).forEach(function(p){values[p[0]]=ui.parseNum(body.querySelector('[data-key="'+p[0]+'"]').value);});
              var output=calibrationOf(Object.assign({},loadedDocument || {},{format:'powder6-instrument-resolution',version:2,profile:'constant-wavelength',profileType:activeType,values:values}));
              var saved=await ui.saveTextFile('instrument_resolution_'+ui.fileStamp()+'.json',JSON.stringify(output,null,2),'application/json',{title:'Save instrument profile file',description:'Instrument resolution JSON',pickerId:'powder6-resolution'});
              if(saved)status((saved.downloaded?'Download started: ':'Saved: ')+saved.name+'. Profile: '+C.PROFILE_LABELS[activeType]+'.');
              return;
            }
            var files=await ui.pickFiles({accept:'.json'});if(!files.length)return;
            loadDocument(JSON.parse(new TextDecoder().decode(await ui.readBuffer(files[0]))),files[0].name);
          } catch(error) {status('Calibration: '+error.message);ui.toast('Calibration: '+error.message,'err');}
          finally {button.disabled=false;}
        });
      },
      check:function(v){
        v.profileType=activeType;
        var names=C.instrumentProfileParams(activeType);
        if(names.some(function(p){return !Number.isFinite(v[p[0]]);}))return 'Enter finite coefficients.';
        if(names.some(function(p){return /^eta/.test(p[0]) && (v[p[0]]<0 || v[p[0]]>1);}))return 'Mixing fractions must be between 0 and 1.';
        return '';
      }
    });
    if(!v || !idle())return;
    if(RV.workspace)list=RV.workspace.targets(v.targets);
    if(!list.length){ui.toast('Select at least one target dataset.','warn');return;}
    applyResolution(list,v.profileType,v);
  }
  function setInstrumentProfile(ds,type) {
    if(!idle() || !ds || !C.INSTRUMENT_PROFILE_TYPES.includes(type))return;
    if((ds.inst.resolutionType==='gsas_cw'?'tch_aniso':ds.inst.resolutionType)===type && St.phasesIn(ds).every(C.usesSeparatedProfile))return;
    var values={};C.instrumentProfileParams(type).forEach(function(p){values[p[0]]=Number.isFinite(ds.p['inst.'+p[0]])?ds.p['inst.'+p[0]]:p[1];});
    applyResolution([ds],type,values);
  }
  function applyResolution(list,type,values) {
    snapshot('instrument resolution calibration');
    var affected=S.phases.filter(function(ph){return list.some(function(ds){return St.hasPhase(ds,ph);});});
    var changed=affected.some(function(ph){return !C.usesSeparatedProfile(ph);});
    affected.forEach(function(ph){
      ph.separatedProfile=true;
      St.profileNames(ph).forEach(function(name){
        var key=ph.key+'.'+name;
        if(!Number.isFinite(ph.v[key])){var def=C.SAMPLE_PROFILE.filter(function(p){return p[0]===name;})[0];ph.v[key]=def?def[1]:0;ph.fit[key]=false;}
      });
    });
    if(changed)St.phaseChanged(affected[0]);
    var coefficients=C.instrumentProfileParams(type);
    list.forEach(function(ds){
      ds.inst.resolutionType=type;
      ds.mem=ds.mem||{};
      coefficients.forEach(function(p){var n='inst.'+p[0];ds.mem[n]=[values[p[0]],!!ds.fit[n]];ds.p[n]=values[p[0]];});
      Object.keys(ds.calculations||{}).forEach(function(m){var bank=ds.calculations[m];coefficients.forEach(function(p){var n='inst.'+p[0];bank.p[n]=values[p[0]];/* Refinement flags belong to the calculation, not the calibration. */});bank.stats=null;bank.esd={};bank.ints=null;});
      ds.stats=null;ds.esd={};ds.ints=null;St.invalidate(ds);
    });
    RV.bus.emit('params',{});RV.bus.emit('data');ui.toast('Set '+C.PROFILE_LABELS[type]+' resolution for '+plural(list.length,'dataset')+'.','ok');
  }

  async function orientation() {
    var ph=St.currentPhase();if(!idle() || !ph)return;
    var held=St.holdersOf(ph,datasetTargets()), source=held[0],pre=ph.key+'.po',values=source?source.p:ph.v;
    RV.app.showTab('datasets');
    var v=await ui.prompt('Preferred orientation · '+ph.name,[
      {key:'h',label:'Axis h',type:'number',value:ph.poDir[0]}, {key:'k',label:'Axis k',type:'number',value:ph.poDir[1]}, {key:'l',label:'Axis l',type:'number',value:ph.poDir[2]},
      {key:'r',label:'March–Dollase r',type:'number',value:values[pre]||1,hint:'1 means random orientation; r is dimensionless.'},
      {key:'refine',label:'Refine r',type:'checkbox',value:ph.method==='rietveld' && !!(source?source.fit[pre]:ph.fit[pre])},
      {key:'shared',label:'Share r in a global fit',type:'checkbox',value:St.isShared(pre)}
    ],'Apply','The axis belongs to the phase. The strength r and its refinement flag apply only to the active dataset containing this phase. Preferred orientation is meaningful only for a Rietveld intensity model.',{
      check:function(v){if([v.h,v.k,v.l].every(function(x){return x===0;}))return 'The axis must be nonzero.';if(!(v.r>=.1 && v.r<=5))return 'r must be between 0.1 and 5.';if(v.refine && ph.method!=='rietveld')return 'Choose the Rietveld calculation in Solve before refining preferred orientation.';return '';}
    });
    if(!v || !idle())return;snapshot('preferred orientation of '+ph.name);ph.poDir=[v.h,v.k,v.l];St.phaseChanged(ph);
    St.setParam(pre,v.r,held,!source);St.setFit(pre,v.refine,held);if(!source)ph.fit[pre]=v.refine;St.setShared(pre,v.shared);
    ui.toast('Preferred orientation of '+ph.name+': ('+ph.poDir.join(' ')+'), r = '+v.r+(v.refine?', refined.':', fixed.'),'ok');
  }

  // ---------------------------------------------------------------- datasets
  async function instrument() {
    if (!idle()) return;
    var list = datasetTargets(), d = list[0];if(!d)return;
    RV.app.showTab('datasets');
    var i = d.inst, lo = Infinity, hi = -Infinity;
    list.forEach(function (x) { lo = Math.min(lo, x.tth[0]); hi = Math.max(hi, x.tth[x.tth.length - 1]); });
    var anodes = Object.keys(St.ANODES).map(function (k) { return [k, k + ' Kα1 ' + St.ANODES[k][0] + ', Kα2 ' + St.ANODES[k][1] + ' Å']; }).concat([['', 'Other wavelength']]);
    var anode = i.anode && St.ANODES[i.anode] && Math.abs(St.ANODES[i.anode][0] - i.lambda1) < 1e-6 ? i.anode : '';
    var v = await ui.prompt('Instrument and range', [
      { key: 'anode', label: 'Source', type: 'select', value: anode, options: anodes },
      { key: 'lambda1', label: 'λ1 /Å', type: 'number', value: i.lambda1 },
      { key: 'lambda2', label: 'λ2 /Å', type: 'number', value: i.lambda2, hint: 'Kα2; set the ratio to 0 for a monochromatic beam.' },
      { key: 'ratio', label: 'Ratio I(λ2)/I(λ1)', type: 'number', value: i.ratio },
      { key: 'radiation', label: 'Radiation', type: 'select', value: i.radiation, options: [['xray', 'X-rays'], ['neutron', 'Neutrons (constant wavelength)']] },
      { key: 'pol', label: 'Polarisation', type: 'select', value: i.pol, options: [['tube', 'Tube, no monochromator (K = 1)'], ['mono', 'Monochromator'], ['sync', 'Synchrotron, polarised'], ['none', 'None (K = 0)']] },
      { key: 'monoTth', label: 'Monochromator 2θ /°', type: 'number', value: i.monoTth, when: 'pol:mono', hint: '26.6° for graphite (002) with Cu Kα' },
      { key: 'polFrac', label: 'Polarised fraction', type: 'number', value: i.polFrac, when: 'pol:sync' },
      { key:'radiusMM',label:'Goniometer radius /mm',type:'number',value:i.radiusMM || 0,hint:'Bragg–Brentano radius. 0 = unknown; required for displacement in mm and effective absorption.' },
      { key: 'anomalous', label: 'Anomalous f′, f″', type: 'text', value: i.anomalous || '', when: 'radiation:xray', hint: 'Per element at λ1, in electrons: Fe -3.36 3.20, O 0.05 0.03. Used in the Rietveld structure factors (Friedel-averaged); an element not listed has none. Take the values from tables (Sasaki, Cromer–Liberman) for this wavelength.' },
      { key: 'tthMin', label: 'Fit from 2θ /°', type: 'number', value: i.tthMin }, { key: 'tthMax', label: 'Fit to 2θ /°', type: 'number', value: i.tthMax, hint: 'Measured: ' + lo.toFixed(2) + ' to ' + hi.toFixed(2) + '°. The background and the excluded regions have their own buttons.' }
    ], 'Apply', (list.length > 1 ? 'For the ' + plural(list.length, 'selected dataset') + ': the fields show the values of ' + RV.ui.esc(d.name) + ', and only the fields you change are applied to all of them. ' : '') +
       'Polarisation does not apply to neutrons.', {
      onOpen: function (body) {
        body.querySelector('[data-key="anode"]').addEventListener('change', function (e) {
          var A = St.ANODES[e.target.value];
          if (!A) return;
          body.querySelector('[data-key="lambda1"]').value = A[0]; body.querySelector('[data-key="lambda2"]').value = A[1]; body.querySelector('[data-key="ratio"]').value = A[2];
        });
      },
      check: function (r) {
        if (!(r.lambda1 > 0 && r.lambda1 < 20)) return 'λ1 must be a wavelength in Å.';
        if (!(r.ratio >= 0 && r.ratio <= 1) || (r.ratio > 0 && !(r.lambda2 > 0))) return 'The ratio is from 0 to 1, with a positive λ2.';
        if (r.radiusMM != null && !(r.radiusMM >= 0)) return 'Radius must be positive, or 0 for unknown.';
        var an = C.parseAnomalous(r.anomalous); if (an.bad.length) return 'Anomalous f′, f″: “' + an.bad[0] + '” is not an element followed by two numbers.';
        if (!(r.tthMin < r.tthMax)) return 'The fitted range must go from a lower to a higher 2θ.';
        if (r.pol === 'sync' && !(r.polFrac > 0 && r.polFrac <= 1)) return 'The polarised fraction is from 0 to 1.';
        return '';
      }
    });
    if (!v) return;
    // only what was changed is applied, so datasets measured differently keep their own wavelength or range
    var want = { anode: v.anode, lambda1: v.lambda1, lambda2: v.lambda2, ratio: v.ratio, radiation: v.radiation, pol: v.pol,
                 monoTth: Number.isFinite(v.monoTth) ? v.monoTth : i.monoTth, polFrac: Number.isFinite(v.polFrac) ? v.polFrac : i.polFrac,
                 radiusMM:Number.isFinite(v.radiusMM)?v.radiusMM:i.radiusMM || 0, anomalous: v.anomalous != null ? C.parseAnomalous(v.anomalous).text : i.anomalous || '', tthMin: v.tthMin, tthMax: v.tthMax }, changed = {};
    if (want.anode === anode) delete want.anode;
    Object.keys(want).forEach(function (k) { if (list.length === 1 || want[k] !== i[k]) changed[k] = want[k]; });
    if (('tthMin' in changed) !== ('tthMax' in changed)) { changed.tthMin = v.tthMin; changed.tthMax = v.tthMax; }
    var keys = Object.keys(changed).filter(function (k) { return k !== 'anode'; });
    if (!keys.length) { ui.toast('Nothing changed.', 'info'); return; }
    snapshot('instrument of ' + plural(list.length, 'dataset'));
    St.setInstrument(list, changed);
    var LBL = { radiusMM:'goniometer radius /mm', anomalous: 'anomalous f′, f″', lambda1: 'λ1', lambda2: 'λ2', ratio: 'ratio', radiation: 'radiation', pol: 'polarisation', monoTth: 'monochromator 2θ', polFrac: 'polarised fraction', tthMin: 'from', tthMax: 'to' };
    ui.toast('Instrument of ' + plural(list.length, 'dataset') + ': ' + keys.map(function (k) { return LBL[k] + ' ' + changed[k]; }).join(', ') + '.', 'ok');
  }
  // ---------------------------------------------------------------- background and excluded regions
  function fmt6(x) { return String(+(+x).toFixed(4)); }
  function parseList(text) {
    var out = [], bad = [];
    String(text || '').split(/[\s,;]+/).filter(Boolean).forEach(function (t) { var v = ui.parseNum(t); if (Number.isFinite(v)) out.push(v); else bad.push(t); });
    return { values: out, bad: bad };
  }
  async function background() {
    if (!idle()) return;
    var list = datasetTargets(), d = list[0];if(!d)return;
    RV.app.showTab('datasets');
    var i = d.inst, placed = null;
    var v = await ui.prompt('Background', [
      { key: 'type', label: 'Background', type: 'select', value: i.bkgType, options: [['cheb', 'Chebyshev polynomials over the fitted range'], ['spline', 'Spline through anchors (monotone cubic)']] },
      { key: 'bkgN', label: 'Terms', type: 'number', value: i.bkgN, when: 'type:cheb', hint: 'A whole number from 0 to 24.' },
      { key: 'anchors', label: 'Anchors at 2θ /°', type: 'text', value: i.bkgX.map(fmt6).join(' '), when: 'type:spline', hint: 'Separated by spaces. Empty: placed automatically in each dataset. Ctrl+click on the pattern places an anchor at both cursor coordinates, or removes the one under the cursor. Right-drag an anchor to move it; its height and refinement flag are in this dataset’s Background group.' },
      { key: 'nAuto', label: 'Anchors to place', type: 'number', value: S.settings.nAnchors, when: 'type:spline', hint: 'Place puts them at the two ends of the fitted range and at the lowest point of equal stretches between them, never in an excluded region.' }
    ], 'Apply', (list.length > 1 ? 'For the ' + plural(list.length, 'selected dataset') + ' (the values shown are those of ' + ui.esc(d.name) + '). ' : '') +
       'The heights of new anchors start at the data; anchors that stay where they were keep their values.', {
      after: '<p class="buttons" data-when="type:spline"><button type="button" data-place>Place anchors now</button><span class="hint" data-placed></span></p>',
      onOpen: function (body) {
        body.querySelector('[data-place]').addEventListener('click', function () {
          var n = Math.round(ui.parseNum(body.querySelector('[data-key="nAuto"]').value));
          if (!(n >= 2 && n <= 200)) { ui.toast('Anchors to place: a whole number from 2 to 200.', 'warn'); return; }
          placed = St.autoAnchors(d, n);
          body.querySelector('[data-key="anchors"]').value = placed.map(fmt6).join(' ');
          body.querySelector('[data-placed]').textContent = placed.length + ' anchors placed in ' + d.name + (list.length > 1 ? ' (empty the list to place them in each dataset)' : '') + '.';
        });
      },
      check: function (r) {
        if (r.type === 'cheb' && !(Number.isInteger(r.bkgN) && r.bkgN >= 0 && r.bkgN <= 24)) return 'Terms: a whole number from 0 to 24.';
        if (r.type === 'spline') {
          var pl = parseList(r.anchors);
          if (pl.bad.length) return 'Not a number: ' + pl.bad[0] + '.';
          if (pl.values.length === 1) return 'A spline needs at least two anchors (or none, to place them automatically).';
          if (!(Math.round(r.nAuto) >= 2 && Math.round(r.nAuto) <= 200)) return 'Anchors to place: a whole number from 2 to 200.';
        }
        return '';
      }
    });
    if (!v) return;
    snapshot('background of ' + plural(list.length, 'dataset'));
    if (v.type === 'cheb') {
      St.setInstrument(list, { bkgType: 'cheb', bkgN: v.bkgN });
      ui.toast('Background of ' + plural(list.length, 'dataset') + ': ' + plural(v.bkgN, 'Chebyshev term') + '.', 'ok');
      return;
    }
    St.setSetting('nAnchors', Math.round(v.nAuto));
    var xs = parseList(v.anchors).values;
    list.forEach(function (ds) { St.setInstrument([ds], { bkgType: 'spline', bkgX: xs.length ? xs : St.autoAnchors(ds, Math.round(v.nAuto)) }); });
    ui.toast('Background of ' + plural(list.length, 'dataset') + ': a spline through ' + (xs.length ? plural(xs.length, 'anchor') : 'anchors placed in each') + '. Their heights start at the data; tick them in this dataset’s Background group to refine them.', 'ok');
  }
  function regionsText(ex) { return ex.map(function (r) { return fmt6(r[0]) + ' ' + fmt6(r[1]); }).join('\n'); }
  async function excludeRegions() {
    if (!idle()) return;
    var list = datasetTargets(), d = list[0];if(!d)return;
    RV.app.showTab('datasets');
    var result = null;
    var v = await ui.modal({
      title: 'Excluded regions', wide: true,
      body: '<p class="intro">2θ regions left out of the fit, one per line: from and to, in degrees (for example <code>26.4 26.9</code>). The pattern is still calculated there; the points take no part in the fit, the Le Bail and WPPF intensities or the R factors. ' +
            (list.length > 1 ? 'For the ' + plural(list.length, 'selected dataset') + '; shown: those of ' + ui.esc(d.name) + '. ' : '') +
            'On the pattern, Ctrl+Shift+drag marks a region and Ctrl+Shift+click in one removes it.</p>' +
            '<textarea id="excl-text" rows="8" spellcheck="false" class="code-area">' + ui.esc(regionsText(d.inst.excl)) + '</textarea>',
      buttons: [{ label: 'Remove all', left: true, close: false, onClick: function (body) { body.querySelector('#excl-text').value = ''; return false; } },
                { label: 'Cancel', value: null },
                { label: 'Apply', primary: true, onClick: function (body) {
                  var lines = body.querySelector('#excl-text').value.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean), out = [];
                  for (var k = 0; k < lines.length; k++) {
                    var q = lines[k].replace(/(\d)\s*[-–]\s*(\d)/, '$1 $2').split(/[\s,;]+/).map(ui.parseNum);
                    if (q.length !== 2 || !q.every(Number.isFinite) || q[0] === q[1]) { ui.toast('Line ' + (k + 1) + ': two different angles, from and to.', 'warn'); return false; }
                    out.push([Math.min(q[0], q[1]), Math.max(q[0], q[1])]);
                  }
                  result = St.mergeRegions(out);
                  return true;
                }, value: function () { return result; } }]
    });
    if (!v) return;
    snapshot('excluded regions of ' + plural(list.length, 'dataset'));
    St.setInstrument(list, { excl: v });
    ui.toast(v.length ? 'Excluded in ' + plural(list.length, 'dataset') + ': ' + v.map(function (r) { return fmt6(r[0]) + '–' + fmt6(r[1]) + '°'; }).join(', ') + '.' : 'No excluded region in ' + plural(list.length, 'dataset') + '.', 'ok');
  }
  // The zones of Datasets → Excluded regions, for the active dataset. Each is a row: from, to, an Apply tick and a remove button.
  // A zone that is not applied stays in the list (inst.exclOff) but takes no part in the fit, to compare fits with and without it.
  function zoneTarget() {
    var ds = RV.workspace && RV.workspace.dataset();
    if (!ds) return null;
    if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return null; }
    return ds;
  }
  function zoneLists(ds) { var c = function (r) { return [r[0], r[1]]; }; return { on: ds.inst.excl.map(c), off: ds.inst.exclOff.map(c) }; }
  function putZones(ds, z, label, message) {
    snapshot(label + ' of ' + ds.name);
    St.setInstrument([ds], { excl: z.on, exclOff: z.off });
    if (message) ui.toast(message, 'info');
  }
  async function addZone() {
    var ds = zoneTarget();
    if (!ds) return;
    var v = await ui.prompt('Add an excluded zone', [
      { key: 'lo', label: 'From 2θ (°)', type: 'number', value: '' },
      { key: 'hi', label: 'To 2θ (°)', type: 'number', value: '' }], 'Add zone',
      'A 2θ zone of ' + ui.esc(ds.name) + ' left out of the fit (the pattern is still calculated there). On the pattern, Ctrl+Shift+drag marks a zone too.',
      { check: function (r) { return r.lo === r.hi ? 'The start and the end angle must differ.' : ''; } });
    if (!v) return;
    ds = zoneTarget();
    if (!ds) return;
    var z = zoneLists(ds), lo = Math.min(v.lo, v.hi), hi = Math.max(v.lo, v.hi);
    z.on.push([lo, hi]);
    putZones(ds, z, 'excluded zone', 'Zone ' + fmt6(lo) + '–' + fmt6(hi) + '° excluded in ' + ds.name + '.');
  }
  // kind 'on' (applied) or 'off' (kept, not applied); returns false when the angles are refused
  function editZone(ds, kind, index, lo, hi) {
    var z = zoneLists(ds), list = z[kind];
    if (!list || !list[index] || S.busy) return false;
    if (!(Number.isFinite(lo) && Number.isFinite(hi))) { ui.toast('Enter a number for each end of the zone.', 'warn'); return false; }
    if (lo === hi) { ui.toast('The start and the end angle of a zone must differ.', 'warn'); return false; }
    list[index] = [Math.min(lo, hi), Math.max(lo, hi)];
    putZones(ds, z, 'excluded zone', '');
    return true;
  }
  function applyZone(ds, kind, index, on) {
    var z = zoneLists(ds), from = z[kind], to = on ? z.on : z.off;
    if (!from || !from[index] || S.busy || (kind === 'on') === on) return;
    to.push(from.splice(index, 1)[0]);
    putZones(ds, z, on ? 'zone applied' : 'zone not applied', '');
  }
  function removeZone(ds, kind, index) {
    var z = zoneLists(ds), list = z[kind];
    if (!list || !list[index] || S.busy) return;
    var gone = list.splice(index, 1)[0];
    putZones(ds, z, 'excluded zone', 'Zone ' + fmt6(gone[0]) + '–' + fmt6(gone[1]) + '° removed from ' + ds.name + '.');
  }
  // Ctrl+click on the pattern: an anchor of the spline background of the first selected dataset, or off the one under the cursor
  function markAt(x, y, px, py) {
    var ds = St.first();
    if (!ds) { ui.toast('Select the dataset whose background anchors to edit.', 'warn'); return; }
    if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    if (S.settings.noBackground) { ui.toast('Turn off No background to edit background anchors.', 'info'); return; }
    var i = ds.inst;
    if (!(x >= ds.tth[0] && x <= ds.tth[ds.tth.length - 1]) || !Number.isFinite(y)) return;
    St.setSetting('showBkg', true);
    St.setSetting('showAnchors', true);
    if (i.bkgType !== 'spline') {
      snapshot('spline background of ' + ds.name);
      St.setInstrument([ds], { bkgType: 'spline', bkgX: [i.tthMin, x, i.tthMax] });
      var inserted = ds.inst.bkgX.indexOf(x);
      if (inserted >= 0) St.setParam('bga'+inserted, y, [ds]);
      ui.toast('The background of ' + ds.name + ' is now a spline through ' + plural(ds.inst.bkgX.length, 'anchor') + '. The anchor at ' + fmt6(x) + '° uses the cursor height. Ctrl+click adds more; right-drag an anchor to move it.', 'ok');
      return;
    }
    var hit = RV.plots.anchorAt(px, py, ds), near = hit ? hit.index : -1;
    if (near >= 0) {
      if (i.bkgX.length <= 2) { ui.toast('A spline background keeps at least two anchors; Background… turns it back into polynomials.', 'warn'); return; }
      snapshot('background anchor of ' + ds.name);
      var xs = i.bkgX.filter(function (_, k) { return k !== near; }), gone = i.bkgX[near];
      St.setInstrument([ds], { bkgX: xs });
      ui.toast('Background anchor at ' + fmt6(gone) + '° removed from ' + ds.name + ' (' + plural(xs.length, 'anchor') + ' left).', 'info');
      return;
    }
    snapshot('background anchor of ' + ds.name);
    St.setInstrument([ds], { bkgX: i.bkgX.concat([x]) });
    var index = ds.inst.bkgX.indexOf(x);
    if (index >= 0) St.setParam('bga'+index, y, [ds]);
    ui.toast('Background anchor at ' + fmt6(x) + '°, height ' + fmt(y) + ', placed in ' + ds.name + '.', 'info');
  }
  // the x button of an anchor row in Datasets: the same removal as Ctrl+click on the anchor
  function removeAnchor(ds, index) {
    if (!ds || ds.inst.bkgType !== 'spline' || !(index >= 0 && index < ds.inst.bkgX.length)) return;
    if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    if (ds.inst.bkgX.length <= 2) { ui.toast('A spline background keeps at least two anchors; Background… turns it back into polynomials.', 'warn'); return; }
    snapshot('background anchor of ' + ds.name);
    var gone = ds.inst.bkgX[index], xs = ds.inst.bkgX.filter(function (_, k) { return k !== index; });
    St.setInstrument([ds], { bkgX: xs });
    ui.toast('Background anchor at ' + fmt6(gone) + '° removed from ' + ds.name + ' (' + plural(xs.length, 'anchor') + ' left).', 'info');
  }
  // Ctrl+Shift+drag: an excluded region of the first selected dataset; Ctrl+Shift+click in one removes it
  function regionAt(x0, x1) {
    var ds = St.first();
    if (!ds) { ui.toast('Select the dataset whose excluded regions to edit.', 'warn'); return; }
    if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    var ex = ds.inst.excl;
    if (x1 - x0 < 1e-9) {
      var hit = ex.filter(function (r) { return x0 >= r[0] && x0 <= r[1]; })[0];
      if (!hit) return;
      snapshot('excluded region of ' + ds.name);
      St.setInstrument([ds], { excl: ex.filter(function (r) { return r !== hit; }) });
      ui.toast('Excluded region ' + fmt6(hit[0]) + '–' + fmt6(hit[1]) + '° removed from ' + ds.name + '.', 'info');
      return;
    }
    snapshot('excluded region of ' + ds.name);
    St.setInstrument([ds], { excl: ex.concat([[x0, x1]]) });
    var n = St.fitPoints(ds).nExcluded;
    ui.toast('Excluded ' + fmt6(x0) + '–' + fmt6(x1) + '° in ' + ds.name + ': ' + n + ' points left out of the fit in all.', 'info');
  }

  // ---------------------------------------------------------------- simulation
  async function simulate() {
    if (!idle() || !havePhase()) return;
    var rv = S.phases.filter(St.canRietveld);
    if (!need(rv.length, 'Simulation needs at least one phase with atoms. Its current fitting method can be Rietveld, WPPF or Le Bail.')) return;
    var d = St.first(), base = d ? d.inst : S.settings.inst, anodes = Object.keys(St.ANODES).map(function (k) { return [k, k + ' Kα1 ' + St.ANODES[k][0] + ', Kα2 ' + St.ANODES[k][1] + ' Å']; }).concat([['', 'Other wavelength']]);
    var anode = base.anode && St.ANODES[base.anode] && Math.abs(St.ANODES[base.anode][0] - base.lambda1) < 1e-6 ? base.anode : '';
    var v = await ui.prompt('Simulate a pattern', [
      { key: 'name', label: 'Name', type: 'text', value: 'simulated ' + rv.map(function (p) { return p.name; }).join(' + ') },
    ].concat(rv.map(function(p){return {key:'sim_'+p.key,label:'Include '+p.name,type:'checkbox',value:!d || St.hasPhase(d,p)};})).concat([
      { key: 'from', label: 'From 2θ /°', type: 'number', value: d ? d.inst.tthMin : 10 }, { key: 'to', label: 'To 2θ /°', type: 'number', value: d ? d.inst.tthMax : 100 },
      { key: 'step', label: 'Step /°', type: 'number', value: d && d.step ? +d.step.toPrecision(3) : 0.02 },
      { key: 'anode', label: 'Source', type: 'select', value: anode, options: anodes },
      { key: 'lambda1', label: 'λ1 /Å', type: 'number', value: base.lambda1 }, { key: 'lambda2', label: 'λ2 /Å', type: 'number', value: base.lambda2 },
      { key: 'ratio', label: 'Ratio I(λ2)/I(λ1)', type: 'number', value: base.ratio },
      { key: 'radiation', label: 'Radiation', type: 'select', value: base.radiation, options: [['xray', 'X-rays'], ['neutron', 'Neutrons (constant wavelength)']] },
      { key: 'pol', label: 'Polarisation', type: 'select', value: base.pol, options: [['tube', 'Tube, no monochromator (K = 1)'], ['mono', 'Monochromator'], ['sync', 'Synchrotron, polarised'], ['none', 'None (K = 0)']] },
      { key: 'monoTth', label: 'Monochromator 2θ /°', type: 'number', value: base.monoTth, when: 'pol:mono' },
      { key: 'polFrac', label: 'Polarised fraction', type: 'number', value: base.polFrac, when: 'pol:sync' },
      { key: 'peak', label: 'Strongest point /counts', type: 'number', value: 10000, hint: 'The scales are set for this; 0 keeps the scales of the phases as they are.' },
      { key: 'bkg', label: 'Background /counts', type: 'number', value: 50 },
      { key: 'noise', label: 'Counting noise', type: 'checkbox', value: true, hint: 'Poisson noise on every point, so the pattern can be fitted like a measurement' }
    ]), 'Simulate', 'A pattern calculated from the selected phases with atoms, regardless of their current intensity models. It becomes an ordinary dataset. The active calculation and phase methods are kept.', {
      onOpen: function (body) {
        body.querySelector('[data-key="anode"]').addEventListener('change', function (e) {
          var A = St.ANODES[e.target.value];
          if (!A) return;
          body.querySelector('[data-key="lambda1"]').value = A[0]; body.querySelector('[data-key="lambda2"]').value = A[1]; body.querySelector('[data-key="ratio"]').value = A[2];
        });
      },
      check: function (r) {
        if(!rv.some(function(p){return r['sim_'+p.key];}))return 'Include at least one phase with atoms.';
        if (!(r.from < r.to) || !(r.from > 0) || !(r.to < 180)) return 'The range goes from a lower to a higher 2θ, within 0 to 180°.';
        if (!(r.step > 0) || (r.to - r.from) / r.step > 200000) return 'The step must be positive, and give at most 200000 points.';
        if (!(r.lambda1 > 0 && r.lambda1 < 20)) return 'λ1 must be a wavelength in Å.';
        if (!(r.ratio >= 0 && r.ratio <= 1) || (r.ratio > 0 && !(r.lambda2 > 0))) return 'The ratio is from 0 to 1, with a positive λ2.';
        if (!(r.peak >= 0) || !(r.bkg >= 0)) return 'The counts cannot be negative.';
        return '';
      }
    });
    if (!v) return;
    var inst = Object.assign(St.instCopy(base), { anode: v.anode, lambda1: v.lambda1, lambda2: v.lambda2, ratio: v.ratio, radiation: v.radiation, pol: v.pol,
                                                 monoTth: Number.isFinite(v.monoTth) ? v.monoTth : base.monoTth, polFrac: Number.isFinite(v.polFrac) ? v.polFrac : base.polFrac });
    var ds;
    St.setBusy(true,'Simulating a powder pattern…');
    await new Promise(function(resolve){setTimeout(resolve,20);});
    try { ds = St.simulate({ phases:rv.filter(function(p){return v['sim_'+p.key];}).map(function(p){return p.key;}), name: v.name.trim() || 'simulated', tthMin: v.from, tthMax: v.to, step: v.step, inst: inst, peak: v.peak, bkg: v.bkg, noise: v.noise, seed: Date.now() % 2147483647 }); }
    catch (e) { ui.toast('Simulation failed: ' + ((e && e.message) || e), 'err'); return; } finally {St.setBusy(false);}
    snapshot('simulating a pattern');
    St.insertDatasets([ds], { estimate: false });
    RV.app.showTab('pattern');
    ui.toast('Simulated ' + ds.name + ': ' + ds.tth.length + ' points, ' + fmt6(v.from) + '–' + fmt6(v.to) + '°, λ1 ' + v.lambda1 + ' Å' + (v.noise ? ', with counting noise' : '') + '. Nothing is ticked: it is a dataset like any other.', 'ok');
  }

  // ---------------------------------------------------------------- peak-shape presets (powder6-profile JSON)
  var PRESET_FORMAT = 'powder6-profile', PRESET_FILES = { simple_pvoigt: 'Voigt_default.json', tch_aniso: 'TCH_default.json', split_pvoigt: 'Split_default.json' };
  // { type, values {GU: ...}, fit {GU: bool}, disp, transp, ignored [] } from a preset document, or throws
  function presetOf(doc) {
    if (!doc || typeof doc !== 'object' || (doc.format && doc.format !== PRESET_FORMAT)) throw new Error('not a peak-shape preset (format ' + PRESET_FORMAT + ')');
    var type = C.PROFILE_PARAMS[doc.profileType] ? doc.profileType : null;
    if (!type) throw new Error('unknown peak shape ' + doc.profileType);
    var separated = doc.separatedProfile === true || type === 'gsas_cw';
    var P = doc.parameters || {}, names = (separated ? C.SAMPLE_PROFILE : C.PROFILE_PARAMS[type]).map(function (q) { return q[0]; }), out = { type: type, separatedProfile: separated, values: {}, fit: {}, ignored: [], label: doc.label || C.PROFILE_LABELS[type], broadening: C.broadeningConfig(doc.broadening) };
    names.forEach(function (n) {
      var key = 'param-' + n.toLowerCase(), v = P[key] == null ? NaN : ui.parseNum(P[key]);
      if (St.isSizeParam(n) && doc.sizeUnit === 'nm') v = St.fromDisplay(n,v);
      if (Number.isFinite(v)) { out.values[n] = v; out.fit[n] = !!P['fit-' + n.toLowerCase()]; }
    });
    ['shft', 'trns'].forEach(function (k) { var v = ui.parseNum(P['param-' + k] != null ? P['param-' + k] : P['param-' + k + '_split']); if (Number.isFinite(v)) out[k === 'shft' ? 'disp' : 'transp'] = v; });
    Object.keys(P).forEach(function (k) { var m = /^param-(s\d{3})$/.exec(k); if (m && Math.abs(ui.parseNum(P[k])) > 0) if(!separated)out.ignored.push(m[1].toUpperCase()); });
    if (!Object.keys(out.values).length) throw new Error('no parameter of the ' + C.PROFILE_LABELS[type] + ' in it');
    return out;
  }
  async function applyPreset(pr, from) {
    var current=St.currentPhase();if(!current || !idle())return;
    RV.app.showTab('datasets');
    if(!pr.separatedProfile)throw new Error('Use an instrument-resolution calibration or a sample-broadening preset.');
    var fields=[{key:'phase',label:'Destination phase',type:'select',value:current.key,options:S.phases.map(function(p){return [p.key,p.name];})}];
    if(RV.workspace)fields.push(RV.workspace.targetField());
    var result=await ui.prompt('Load sample broadening',fields,'Apply sample values','Source: '+ui.esc(from)+'. This updates sample size/strain values for the chosen phase in the target datasets. Instrument resolution and refinement flags are kept.');
    if(!result)return;var ph=St.phaseByKey(result.phase),list=(RV.workspace?RV.workspace.targets(result.targets):sel()).filter(function(d){return St.hasPhase(d,ph);});
    snapshot('sample broadening of '+ph.name);ph.separatedProfile=true;ph.broadening=C.broadeningConfig(pr.broadening);St.phaseChanged(ph);
    Object.keys(pr.values).forEach(function(n){St.setParam(ph.key+'.'+n,pr.values[n],list,true);});
    RV.bus.emit('params',{});ui.toast('Loaded sample broadening for '+ph.name+' in '+list.length+' dataset(s).','ok');
  }
  async function applyPresetText(text, name) {
    try {
      var doc = JSON.parse(text);
      if (doc && doc.format === 'powder6-instrument-resolution') {
        // A calibration belongs to the dataset instrument, not the phase.
        // Show its coefficients and targets; nothing changes until Apply.
        return await resolution(calibrationOf(doc), name);
      }
      await applyPreset(presetOf(doc), name);
    } catch (e) { ui.toast(name + ': ' + ((e && e.message) || e), 'err'); }
  }
  async function loadPreset() {
    if (!idle()) return;
    var fs = await ui.pickFiles({ accept: '.json,application/json' });
    if (!fs.length) return;
    try { await applyPresetText(new TextDecoder().decode(await ui.readBuffer(fs[0])), fs[0].name); } catch (e) { ui.toast(fs[0].name + ': ' + e.message, 'err'); }
  }
  function savePreset() {
    var ph = St.currentPhase();
    if (!need(ph, 'No phase yet.')) return;
    var ds = RV.workspace.dataset(), src = ds && St.hasPhase(ds,ph)?ds.p:ph.v, fit = ds && St.hasPhase(ds,ph)?ds.fit:ph.fit, P = {};
    St.profileNames(ph).forEach(function (n) { var v = src[ph.key + '.' + n]; P['param-' + n.toLowerCase()] = Number.isFinite(v) ? (St.isSizeParam(n) ? String(Math.round(St.toDisplay(n,v))) : v.toFixed(4)) : '0'; P['fit-' + n.toLowerCase()] = !!fit[ph.key + '.' + n]; });
    if (ds) { P['param-shft'] = (ds.p.disp || 0).toFixed(4); P['fit-shft'] = !!ds.fit.disp; P['param-trns'] = (ds.p.transp || 0).toFixed(6); P['fit-trns'] = !!ds.fit.transp; }
    var doc = { broadening:C.broadeningConfig(ph.broadening), format: PRESET_FORMAT, version: 2, profileType: ph.profileType, separatedProfile: C.usesSeparatedProfile(ph), sizeUnit: 'nm', label: 'Sample broadening, ' + ph.name, savedAt: new Date().toISOString(), parameters: P };
    ui.download(String(PRESET_FILES[ph.profileType] || 'profile.json').replace('_default', '_' + ph.name.replace(/[^\w-]+/g, '_')), JSON.stringify(doc, null, 2), 'application/json');
    ui.toast('Saved the peak shape of ' + ph.name + (ds ? ' in ' + ds.name : '') + ' as a sample-broadening preset. Instrument calibration is saved separately using Resolution.', 'ok');
  }
  // the start values of new phases, from Voigt_default.json and its siblings next to the page; silent when absent
  async function loadDefaultPresets() {
    var got = [];
    for (var type in PRESET_FILES) {
      try {
        var r = await fetch(PRESET_FILES[type], { cache: 'no-cache' });
        if (!r.ok) continue;
        var pr = presetOf(await r.json());
        if (pr.type !== type || pr.separatedProfile) continue;
        St.setPresetDefault(type, pr.values);
        got.push(PRESET_FILES[type]);
      } catch (e) { /* absent or not a preset: the built-in defaults stay */ }
    }
    return got;
  }

  // ---------------------------------------------------------------- intensities for the Solve tab
  /* The statistics, uncertainties and intensities of a dataset at its current values, with the ticked parameters
     integrated out (a worker job that does not iterate). precision: { phase (index), maxRefl } adds the precision
     block of that phase's WPPF intensities. Resolves to the result of RVCore.refine, or null if stopped. */
  async function extract(ds, precision) {
    if (S.busy) throw new Error('a fit is running');
    var job = St.jobFor(ds);
    job.type = 'extract';
    if (precision) {
      var limit=precision.maxRefl==null?C.MAX_PRECISION_REFLECTIONS:precision.maxRefl;
      if(!Number.isSafeInteger(limit) || limit<1 || limit>C.MAX_PRECISION_REFLECTIONS)throw new Error('Number of reflections must be a whole number between 1 and '+C.MAX_PRECISION_REFLECTIONS+'.');
      job.precision={dataset:0,phase:precision.phase,maxRefl:limit};
    }
    St.setBusy(true,'Extracting integrated intensities…');
    ui.progress(0, -1, 'intensities');
    var run = null;
    try {
      await new Promise(function(resolve){setTimeout(resolve,20);});
      running = run = RV.pool.run([job]);
      syncButtons();
      var res = (await run.promise)[0];
      return run.stopped() ? null : res;
    } finally {
      running = null;
      St.setBusy(false);
      ui.progress(0, 0);
    }
  }

  async function deleteDatasets(id) {
    if (!idle()) return;
    var ids=typeof id==='number'?(St.byId(id)?[id]:[]):Array.from(S.sel),n=ids.length;
    if(!n)return;
    if (!(await ui.confirm('Delete ' + (typeof id==='number'?St.byId(id).name:plural(n, 'selected dataset')) + '? Undo brings them back.', 'Delete', true, 'Delete datasets'))) return;
    snapshot('deleting ' + plural(n, 'dataset'));
    if(!idle())return;
    St.removeDatasets(ids);
    ui.toast('Deleted ' + plural(n, 'dataset') + '.', 'info');
  }
  function estimate() {
    if (!idle() || !haveSel() || !havePhase()) return;
    var list = sel();
    snapshot('estimating scales');
    var ok = list.filter(function (ds) { ds.stats = null; ds.esd = {}; return St.estimateScales(ds); }).length;
    RV.bus.emit('params', {});
    ui.toast('Scales and constant background estimated by linear least squares in ' + ok + ' of ' + plural(list.length, 'dataset') + '.', ok === list.length ? 'ok' : 'warn');
  }
  function cloneTo(all, values, flags) {
    if (!idle()) return;
    var from = RV.workspace.dataset(), targets = (typeof all==='string' ? (all==='all'?S.datasets:S.datasets.filter(function(d){return String(d.id)===all;})) : all ? S.datasets.slice() : sel()).filter(function(d){return d!==from;});
    if(values===false && flags===false){ui.toast('Choose Values or Refinement flags to copy.','info');return;}
    if (!need(from && targets.length, S.datasets.length < 2 ? 'There is only one dataset.' : typeof all === 'string' ? 'The chosen dataset is no longer available: pick another one.' : 'Select the datasets to copy to.')) return;
    snapshot('copying the parameters of ' + from.name);
    St.copyParams(from, targets, values, flags);
    ui.toast('Copied '+(values===false?'refinement flags':flags===false?'values':'values and refinement flags')+' of ' + from.name + ' to ' + plural(targets.length, 'other dataset') + '.', 'ok');
  }

  // fit flags by steps, the usual order of a Rietveld refinement; each step keeps the ones before
  var STEPS = ['scale', 'cell', 'profile', 'atoms'], STEP_LABEL = { scale: 'background and scales', cell: 'zero and cells', profile: 'peak shapes', atoms: 'atoms (x, y, z, B)', none: 'nothing' };
  var PROF_STEP = { GU: 1, GV: 1, GW: 1, LX: 1, eta: 1, U: 1, V: 1, W: 1, X: 1, Y: 1, GU_L: 1, GV_L: 1, GW_L: 1, LX_L: 1, GU_R: 1, GV_R: 1, GW_R: 1, LX_R: 1, eta_split: 1 };
  function stepOf(n) {
    var c = C.classify(n);
    switch (c.kind) {
      case 'scale': case 'bkg': case 'bga': return 0;
      case 'zero': case 'cell': return 1;
      case 'instrument': return -1;
      case 'profile': return /Mix$|^rot/.test(c.comp) ? -1 : PROF_STEP[c.comp] || /^(size|strain|S[0-9])/.test(c.comp) ? 2 : -1;
      case 'atom': return c.comp === 'occ' ? -1 : 3;
      default: return -1;
    }
  }
  function tickSteps(kind) {
    if (!idle() || !haveSel()) return;
    var upto = kind === 'none' ? -1 : STEPS.indexOf(kind), list = sel(), n = 0;
    if (upto < 0 && kind !== 'none') return;
    snapshot('fit flags: ' + STEP_LABEL[kind]);
    list.forEach(function (ds) {
      Object.keys(ds.fit).forEach(function (nm) { var s = stepOf(nm); ds.fit[nm] = upto >= 0 && s >= 0 && s <= upto && St.isVariable(nm); if (ds.fit[nm] && ds === list[0]) n++; });
    });
    RV.bus.emit('params', {});
    ui.toast(kind === 'none' ? 'Nothing ticked.' : 'Ticked ' + STEPS.slice(0, upto + 1).map(function (s) { return STEP_LABEL[s]; }).join(', then ') + ': ' + plural(n, 'parameter') + (list.length > 1 ? ' in each of ' + list.length + ' datasets' : '') + '.', 'info');
  }

  // Independent group toggles used by Solve. Preserve all other fit flags.
  function fitGroup(name) {
    var c = C.classify(name);
    if (c.kind === 'instrument') return 'resolution';
    if (c.kind === 'profile') return 'profile';
    if (c.kind === 'atom') return c.comp === 'occ' ? 'occupancy' : c.comp === 'B' ? 'adp' : 'atoms';
    var step = stepOf(name);
    return step >= 0 && step < 3 ? STEPS[step] : null;
  }
  function fitGroupState(kind, targets) {
    var total = 0, ticked = 0;
    (targets || sel()).forEach(function (ds) {
      Object.keys(ds.fit).forEach(function (name) {
        if (fitGroup(name) !== kind || !groupEligible(ds,name)) return;
        total++; if (ds.fit[name]) ticked++;
      });
    });
    return { total: total, ticked: ticked, checked: total > 0 && ticked === total, mixed: ticked > 0 && ticked < total };
  }
  function setFitGroup(kind, on, targets) {
    if (!idle() || !(targets ? targets.length : haveSel())) return;
    if (STEPS.concat(['adp','occupancy','resolution']).indexOf(kind) < 0) return;
    if (['atoms','adp','occupancy'].indexOf(kind) >= 0 && S.calculation !== 'rietveld') return;
    snapshot('refinement group ' + kind + (on ? ' on' : ' off'));
    (targets || sel()).forEach(function (ds) {
      Object.keys(ds.fit).forEach(function (name) {
        if (fitGroup(name) === kind && groupEligible(ds,name)) ds.fit[name] = !!on;
      });
    });
    RV.bus.emit('params', {});
  }
  function groupEligible(ds,name) {
    return St.isVariable(name) && !S.disabledPhases.includes(C.classify(name).phase) && !S.parameterLinks.some(function(l){return l.target.datasetId===ds.id && l.target.name===name;}) && (C.classify(name).kind !== 'instrument' || St.instrumentParamsFor(ds).some(function(p){return 'inst.'+p[0]===name;}));
  }

  // ---------------------------------------------------------------- refining
  function summary(r) { return 'Rwp ' + (100 * r.Rwp).toFixed(2) + ' %, χ² ' + fmt(r.chi2red); }
  // An enabled WPPF phase in the dataset: its reflection intensities are refined even with nothing ticked.
  function freeIntensities(ds) { return S.phases.some(function (p) { return p.method === 'wppf' && St.hasPhase(ds, p) && S.disabledPhases.indexOf(p.key) < 0; }); }
  function refinable(ds) { return St.fitNames(ds).length > 0 || freeIntensities(ds); }
  async function fitSelected() {
    if (!idle() || !haveSel() || !havePhase()) return;
    if (St.calculationIssue()) { ui.toast(St.calculationIssue(), 'warn'); return; }
    var list = sel().filter(refinable);
    if (!list.length) { ui.toast('Tick at least one parameter to refine (Datasets).', 'warn'); return; }
    var jobs = list.filter(function(ds){return St.fitPoints(ds).tth.length>=2;}).map(function(ds){return {id:ds.id,job:null};});
    if (!need(jobs.length, 'Fewer than two points in the fitted range (Data, Instrument and range).')) return;
    snapshot('refining ' + plural(jobs.length, 'dataset'));
    ui.log('Starting from the current values for '+C.METHOD_LABELS[S.calculation]+'.');
    var historyTicket=RV.fitHistory?RV.fitHistory.begin(list,false):null;
    ui.log('Refinement algorithm: ' + (S.settings.algorithm === 'pt' ? 'parallel tempering + LM finish' : 'Levenberg–Marquardt') + '.');
    var t0 = performance.now(), last = 0, nOk = 0, nWarn = 0, nBad = 0, run = null, results;
    St.setBusy(true,'Fitting '+jobs.length+' dataset(s) individually…');
    ui.progress(0, jobs.length);
    try {
      await new Promise(function(resolve){setTimeout(resolve,20);});
      running = run = RV.pool.run(jobs.map(function (j) { return function(){j.job=St.jobFor(St.byId(j.id));return j.job;}; }), function (res, k) {
        var ds = St.byId(jobs[k].id);
        if (!ds) return;
        if (res.ok) { (res.constraintWarnings || []).forEach(function(w){ui.log(w,'warn');}); St.applyResult([ds], res, jobs[k].job, false); if (St.fitStatus(res.msg) === 'ok') nOk++; else nWarn++; }
        else { ds.stats = { ok: false, msg: res.msg }; nBad++; }
        jobs[k].job=null;
        var now = performance.now();
        if (now - last > 250) { last = now; RV.bus.emit('stats'); }
      }, function (done, total) { if (total > 1) ui.progress(done, total); }, function (k, it, maxIter) { if (jobs.length === 1) ui.progress(it, maxIter, 'iteration ' + it + ' / ' + maxIter); }, {compactResults:jobs.length>1});
      syncButtons();
      results = await run.promise;
    } finally {
      running = null;
      St.setBusy(false);
      ui.progress(0, 0);
      RV.bus.emit('stats'); RV.bus.emit('params', {});
    }
    if(S.calculation==='wppf' && RV.solve && RV.solve.autoExtract && !run.stopped()) await RV.solve.autoExtract(jobs.map(function(j){return St.byId(j.id);}).filter(function(d){return d && d.stats && d.stats.ok;}));
    if(RV.fitHistory)RV.fitHistory.complete(historyTicket,jobs.filter(function(j,k){return results[k] && results[k].ok;}).map(function(j){return St.byId(j.id);}),run.stopped());
    var n = results.filter(Boolean).length, dt = ((performance.now() - t0) / 1000).toFixed(2), stopped = run.stopped();
    if (jobs.length === 1 && results[0]) {
      var r = results[0], ds = St.byId(jobs[0].id);
      if (r.ok && ds && ds.stats) ui.toast('Refined (' + C.METHOD_LABELS[S.calculation] + ') ' + ds.name + ': ' + summary(ds.stats) + ', ' + r.iter + ' iterations, ' + r.msg + ', ' + dt + ' s.', St.fitStatus(r.msg));
      else ui.toast('Refinement of ' + (ds ? ds.name : 'the dataset') + ' failed: ' + r.msg, 'err');
    } else {
      ui.toast((stopped ? 'Stopped. ' : '') + 'Refined (' + C.METHOD_LABELS[S.calculation] + ') ' + n + ' of ' + plural(jobs.length, 'dataset') + ' in ' + dt + ' s: ' + nOk + ' converged' +
        (nWarn ? ', ' + nWarn + ' at the iteration limit or stalled' : '') + (nBad ? ', ' + nBad + ' failed' : '') + '.' +
        (stopped && n < jobs.length ? ' The ' + (jobs.length - n) + ' not refined keep their values.' : ''), stopped || nBad || nWarn ? 'warn' : 'ok');
    }
  }
  async function chooseSharedStarts(job) {
    var conflicts=St.sharedStartConflicts(job);
    if(!conflicts.length)return job;
    var fields=[],resolved=null;
    conflicts.forEach(function(c,k){
      var label=c.name+(St.isSizeParam(c.name)?' (nm)':'');
      fields.push({key:'shared'+k,label:label,type:'select',value:'',options:[['','Choose a current value...']].concat(c.indices.map(function(i){var ds=St.byId(job.datasets[i].id);return [String(i),(ds?ds.name:'Dataset '+job.datasets[i].id)+': '+String(St.toDisplay(c.name,job.values[i][c.name]))];})).concat([['custom','Enter a value...']])});
      fields.push({key:'value'+k,label:'Shared value for '+label,type:'number',value:'',when:'shared'+k+':custom'});
    });
    var picked=await ui.prompt('Choose shared starting values',fields,'Use values and FIT',
      'These parameters are shared in the global fit, but their current values differ between the selected datasets. Choose a starting value for each. Local parameters keep their own current values. Cancel to change sharing in Datasets.',
      {wide:true,check:function(values){
        var starts={};
        for(var k=0;k<conflicts.length;k++){
          var c=conflicts[k],choice=values['shared'+k];
          if(choice==='')return 'Choose a shared starting value for '+c.name+'.';
          starts[c.name]=choice==='custom'?St.fromDisplay(c.name,values['value'+k]):job.values[+choice][c.name];
        }
        try{resolved=St.resolveSharedStarts(job,starts);return '';}catch(e){return e.message;}
      }});
    if(!picked)return null;
    resolved.sharedStarts.forEach(function(c){ui.log('Shared starting value '+c.name+' = '+String(St.toDisplay(c.name,c.value))+'.');});
    return resolved;
  }
  async function globalFit() {
    if (!idle() || !haveSel(2) || !havePhase()) return;
    if (St.calculationIssue()) { ui.toast(St.calculationIssue(), 'warn'); return; }
    var list=sel(), first=list[0], job=St.globalJob(list);
    if (!job.vars.length && !list.some(freeIntensities)) { ui.toast('Tick at least one parameter (Datasets).', 'warn'); return; }
    if (job.constraintIssue) { ui.toast(job.constraintIssue,'warn'); return; }
    if (job.mixed.length && !(await ui.confirm('The fit ticks differ between the selected datasets for ' + job.mixed.slice(0, 8).join(', ') + (job.mixed.length > 8 ? ' …' : '') +
        '. The global fit uses for each the ticks of the first of them that holds it, ' + first.name + ' first.', 'Continue', false, 'Global fit'))) return;
    if (!need(job.datasets.every(function (d) { return d.tth.length >= 2; }), 'A dataset has fewer than two points in its fitted range.')) return;
    job=await chooseSharedStarts(job);
    if(!job)return;
    snapshot('global fit of ' + plural(list.length, 'dataset'));
    ui.log('Starting from the current values for '+C.METHOD_LABELS[S.calculation]+'.');
    var historyTicket=RV.fitHistory?RV.fitHistory.begin(list,true):null;
    if(historyTicket)historyTicket.sharedStarts=job.sharedStarts || [];
    St.setBusy(true,'Global refinement…');
    ui.progress(0, -1);
    ui.log('Refinement algorithm: ' + (S.settings.algorithm === 'pt' ? 'parallel tempering + LM finish' : 'Levenberg–Marquardt') + '.');
    ui.toast('Global fit (' + C.METHOD_LABELS[S.calculation] + ') of ' + plural(list.length, 'dataset') + ': ' + job.nShared + ' shared and ' + job.nLocal + ' local parameters…', 'info');
    var t0 = performance.now(), run = null, res;
    try {
      await new Promise(function(resolve){setTimeout(resolve,20);});
      running = run = RV.pool.run([job], null, null, function (k, it, maxIter) { ui.progress(it, maxIter, 'iteration ' + it + ' / ' + maxIter); });
      syncButtons();
      res = (await run.promise)[0];
    } finally {
      running = null;
      St.setBusy(false);
      ui.progress(0, 0);
    }
    if (run.stopped() || !res) { ui.toast('Global fit stopped; the parameters are unchanged.', 'info'); return; }
    if (!res.ok) { ui.toast('Global fit failed: ' + res.msg, 'err'); return; }
    list.forEach(function (ds) { Object.keys(job.ticks).forEach(function (n) { if (n in ds.fit) ds.fit[n] = job.ticks[n]; }); });
    (res.constraintWarnings || []).forEach(function(w){ui.log(w,'warn');});
    St.applyResult(list, res, job, true);
    var overall = list[0].stats.globalSummary;
    if (overall) ui.log('Overall global fit: Rwp ' + (Number.isFinite(overall.Rwp) ? (100*overall.Rwp).toFixed(2) : '—') + '%, Rp ' + (Number.isFinite(overall.Rp) ? (100*overall.Rp).toFixed(2) : '—') + '%, reduced chi2 ' + fmt(overall.chi2red) + ', GOF ' + fmt(overall.GOF) + '.');
    RV.bus.emit('stats'); RV.bus.emit('params', {});
    if(S.calculation==='wppf' && RV.solve && RV.solve.autoExtract) await RV.solve.autoExtract(list);
    if(RV.fitHistory)RV.fitHistory.complete(historyTicket,list,false);
    ui.log('Refinement algorithm: ' + (S.settings.algorithm === 'pt' ? 'parallel tempering + LM finish' : 'Levenberg–Marquardt') + '.');
    ui.toast('Global fit (' + C.METHOD_LABELS[S.calculation] + ') of ' + plural(list.length, 'dataset') + ': ' + job.nShared + ' shared and ' + job.nLocal + ' local parameters, χ² ' + fmt(res.chi2red) + ', ' +
      res.iter + ' iterations, ' + res.msg + ', ' + ((performance.now() - t0) / 1000).toFixed(2) + ' s.' + (job.mixed.length ? ' Ticks of ' + first.name + ' used for all.' : ''), St.fitStatus(res.msg));
  }
  function fit() { var el=document.activeElement;if(el && el.matches && el.matches('input,select,textarea'))el.blur(); if (RV.app.fitMode() === 'global') return globalFit(); else return fitSelected(); }
  function stop() { if (running) running.cancel(); if (RV.solve) RV.solve.stop(); }

  // ---------------------------------------------------------------- projects
  function saveProject() {
    if(RV.project)return RV.project.save();
    if (!need(S.datasets.length || S.phases.length, 'Nothing to save yet.')) return;
    var lines = ui.logEntries();
    ui.download('rietveld_project_' + ui.fileStamp() + '.json', St.projectJSON(lines), 'application/json');
    ui.toast('Saved the project: ' + plural(S.phases.length, 'phase') + ', ' + plural(S.datasets.length, 'dataset') + ', settings and the Log.', 'ok');
  }
  async function openProject(text) {
    if (!idle()) return;
    var doc;
    try { doc = typeof text==='object'?text:JSON.parse(text); } catch (e) { throw new Error('the project file is not valid JSON'); }
    var pj = St.prepareProject(doc);
    if ((S.datasets.length || S.phases.length) && !(await ui.confirm('Reading a project replaces the ' + plural(S.phases.length, 'phase') + ' and the ' + plural(S.datasets.length, 'dataset') + ' in memory and clears their restore points: it cannot be undone. Save the current project first if you need it.', 'Read project', false, 'Read project'))) return;
    // a project is read as it was saved: nothing of the session before it can be restored into it
    if (RV.history && RV.history.clear) RV.history.clear();
    if(RV.solve && RV.solve.restoreArchive)RV.solve.restoreArchive(null,{silent:true});
    St.commitProject(pj);
    if(RV.absorption && RV.absorption.restoreUser)RV.absorption.restoreUser(doc.absorption || null);
    if(RV.solve && RV.solve.restoreArchive)RV.solve.restoreArchive(doc.solutionState);
    ui.logLoad(pj.log, 'Log saved with the project, ' + plural(pj.log.length, 'line') + ' (newest first):');
    ui.toast('Opened a project with ' + plural(S.phases.length, 'phase') + ' and ' + plural(S.datasets.length, 'dataset') + '.', 'ok');
  }
  async function openProjectFile() {
    var fs = await ui.pickFiles({ accept: RV.project.EXTENSIONS.join(',') + ',.json,application/json,application/zip' });
    if (!fs.length) return;
    await readFiles(fs);
  }

  // ---------------------------------------------------------------- demo: NaCl and Si, measured with Cu Ka1+Ka2 and with Co Ka1
  function rng(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  async function demo() {
    if (!idle() || !haveSG()) return;
    if (!need(S.tables, 'The demo needs the scattering factors (scatters/index.json).')) return;
    var sgN = St.resolveSG('F m -3 m'), sgS = St.resolveSG('F d -3 m', '-F 4vw 2vw 3');
    if (!need(sgN && sgS, 'Fm-3m or Fd-3m is missing from the space-group database.')) return;
    if ((S.datasets.length || S.phases.length) && !(await ui.confirm('The demo replaces the phases and datasets in memory. Undo brings them back.', 'Load the demo', false, 'Demo'))) return;
    snapshot('demo');
    S.datasets = []; S.sel.clear(); S.focus = null; S.phases = []; S.phaseSel = null; S.calculation = 'rietveld'; S.calculationOptions = {};
    var siCell = { a: 5.4309 }, si8 = St.siteOf({ ops: sgS.ops, wyckoff: sgS.wyckoff }, [0.125, 0.125, 0.125], normaliseCell(siCell, 'cubic')).mult === 8 ? 0.125 : 0;
    var nacl = St.makePhase({ name: 'NaCl', sg: sgN, cell: { a: 5.6402 }, atoms: [{ label: 'Na1', type: 'Na', x: 0, y: 0, z: 0, B: 1.2 }, { label: 'Cl1', type: 'Cl', x: 0.5, y: 0.5, z: 0.5, B: 1.1 }] });
    var si = St.makePhase({ name: 'Si', sg: sgS, cell: siCell, atoms: [{ label: 'Si1', type: 'Si', x: si8, y: si8, z: si8, B: 0.5 }] });
    S.phases = [nacl, si]; S.phaseSel = nacl.key; S.version++;
    function axis(a, b, st) { var n = Math.round((b - a) / st) + 1; return Float64Array.from({ length: n }, function (_, i) { return +(a + i * st).toFixed(6); }); }
    var defs = [
      { name: 'NaCl-Si_Cu', tth: axis(15, 120, 0.02), inst: { anode: 'Cu', lambda1: 1.540598, lambda2: 1.544426, ratio: 0.5, radiation: 'xray', pol: 'tube', bkgN: 4 },
        truth: { zero: 0.03, bkg0: 60, bkg1: -15, bkg2: 4, bkg3: 0, s1: 2e-3, s2: 1e-3, GW: 5 } },
      { name: 'NaCl-Si_Co', tth: axis(20, 130, 0.02), inst: { anode: 'Co', lambda1: 1.78897, lambda2: 0, ratio: 0, radiation: 'xray', pol: 'mono', monoTth: 31, bkgN: 4 },
        truth: { zero: -0.02, bkg0: 40, bkg1: -8, bkg2: 2, bkg3: 0, s1: 1.2e-3, s2: 2.4e-3, GW: 7 } }
    ];
    var r = rng(20261016), made = defs.map(function (d) {
      var ds = St.makeDataset({ name: d.name, tth: d.tth, y: new Float64Array(d.tth.length), inst: d.inst }), t = d.truth;
      Object.assign(ds.p, { zero: t.zero, bkg0: t.bkg0, bkg1: t.bkg1, bkg2: t.bkg2, bkg3: t.bkg3 });
      ds.p[nacl.key + '.scale'] = t.s1; ds.p[si.key + '.scale'] = t.s2; ds.p[nacl.key + '.GW'] = t.GW; ds.p[si.key + '.GW'] = t.GW;
      var yc = C.evaluate(St.problemFor([ds]), 0).ycalc, y = new Float64Array(yc.length);
      for (var i = 0; i < yc.length; i++) { var g = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); y[i] = Math.max(0, Math.round(yc[i] + Math.sqrt(Math.max(yc[i], 1)) * g)); }
      ds.y = y;
      // start values a little off the truth, as a real start would be
      ds.p[nacl.key + '.a'] = 5.645; ds.p[si.key + '.a'] = 5.428; ds.p.zero = 0;
      ds.p[nacl.key + '.Na1.B'] = 0.5; ds.p[nacl.key + '.Cl1.B'] = 0.5; ds.p[nacl.key + '.GW'] = 5; ds.p[si.key + '.GW'] = 5;
      ds.p.bkg1 = 0; ds.p.bkg2 = 0;
      St.estimateScales(ds);
      St.invalidate(ds);
      return ds;
    });
    S.datasets = made;
    RV.bus.emit('phases'); RV.bus.emit('phaseSel'); RV.bus.emit('datasets');
    St.selectIds([made[0].id]);
    ui.toast('Demo: NaCl and Si, two patterns simulated with counting noise (Cu Kα1 + Kα2, Co Kα1), true a = 5.6402 and 5.4309 Å. ' +
      'Press Fit (scales and background are ticked), then tick more with the steps of the Solve. Ctrl+A in Datasets selects both: Fit refines each, Global mode both together.', 'ok');
  }

  // ---------------------------------------------------------------- availability: why a command cannot run now ('' when it can)
  var NO_DATA = 'No data loaded yet. Use File, or drop files on the window.', NO_SEL = 'No dataset selected.', BUSY = 'Not while a fit is running.',
      NO_PHASE = 'No phase yet. Read CIF or make a new phase in Phases.', NO_SG = 'The space-group database is not loaded.';
  function noSel() { return !S.datasets.length ? NO_DATA : !S.sel.size ? NO_SEL : ''; }
  function idleSel() { return S.busy ? BUSY : noSel(); }
  function fitWhy() {
    var r = idleSel();
    if (r) return r;
    if (!S.phases.length) return NO_PHASE;
    if (St.calculationIssue()) return St.calculationIssue();
    var g = RV.app && RV.app.fitMode() === 'global', list = sel();
    if (g && list.length < 2) return 'A global fit needs at least two selected datasets.';
    return list.some(refinable) ? '' : 'Tick at least one parameter to refine (Datasets).';
  }
  var WHY = {
    read: function () { return S.busy ? BUSY : ''; },
    phase: function () { return S.busy ? BUSY : S.sgReady ? '' : NO_SG; },
    havePhase: function () { return S.busy ? BUSY : S.phases.length ? '' : NO_PHASE; },
    havePhaseAny: function () { return S.phases.length ? '' : NO_PHASE; },
    phaseMap: function () { return S.busy ? BUSY : !S.phases.length ? NO_PHASE : S.datasets.length ? '' : NO_DATA; },
    rietveldOk: function () { var ph = St.currentPhase(); return S.busy ? BUSY : !ph ? NO_PHASE : St.canRietveld(ph) ? '' : 'The current phase has no atoms: Rietveld needs a structure.'; },
    saveProject: function () { return S.datasets.length || S.phases.length ? '' : 'Nothing to save yet.'; },
    selection: noSel, edit: idleSel,
    report: function () { if(RV.layout && RV.layout.resultTab()==='solve')return RV.layout.record()?'':'No completed run selected.';return RV.layout && RV.layout.resultTab()==='structure-results' && RV.layout.structureRecord()?'':noSel(); },
    withPhase: function () { return idleSel() || (S.phases.length ? '' : NO_PHASE); },
    undo: function () { return S.busy ? BUSY : RV.history.count() ? '' : 'Nothing to undo.'; },
    fit: fitWhy,
    global: function () { return idleSel() || (S.phases.length ? '' : NO_PHASE) || (S.sel.size > 1 ? '' : 'A global fit needs at least two selected datasets.'); },
    cloneAll: function () { return S.busy ? BUSY : S.datasets.length > 1 ? '' : 'There is only one dataset.'; },
    cloneSel: function () { var from=RV.workspace.dataset();return S.busy ? BUSY : sel().some(function(d){return d!==from;}) ? '' : 'Select the datasets to copy to.'; },
    stop: function () { return running || (RV.solve && RV.solve.running()) ? '' : 'Only fits and structure solutions can be stopped.'; }
  };
  function why(id) { var f = WHY[id]; return f ? f() || '' : ''; }
  var BUTTONS = [['#busy-cancel', 'stop'], ['#btn-fit', 'fit'], ['[data-workflow="fit"]', 'fit'], ['[data-workflow="scales"]', 'selection'], ['#clone-all', 'cloneAll'], ['#clone-sel', 'cloneSel'], ['[data-plot-action="png"]', 'selection'],
                  ['#btn-report', 'report'], ['#fit-sharing', 'global'], ['#ds-phases', 'phaseMap'],
                  ['[data-dataset-action="delete"]', 'edit']];
  var syncRaf = 0;
  function syncButtons() {
    if (syncRaf) { cancelAnimationFrame(syncRaf); syncRaf = 0; }
    BUTTONS.forEach(function (b) { var r = why(b[1]); document.querySelectorAll(b[0]).forEach(function (el) { ui.able(el, r); }); });
  }
  function scheduleSync() { if (!syncRaf) syncRaf = requestAnimationFrame(function () { syncRaf = 0; syncButtons(); }); }

  // ---------------------------------------------------------------- command line
  var HELP = [
    ['fit, globalfit', 'refine the selected datasets one by one, or together (shared parameters once)'],
    ['stop', 'stop the refinement that is running'],
    ['steps>>scale, cell, profile, atoms, none', 'tick the parameters of a refinement step and of the steps before it'],
    ['tick>>pattern, untick>>pattern', 'tick or untick the parameters whose name matches (regular expression): tick>>p1\\.a, untick>>bkg'],
    ['scales', 'estimate the scales and the constant background of the selected datasets'],
    ['range>>a&b', 'fit the selected datasets from 2θ = a to b'],
    ['bkg>>n', 'n Chebyshev background terms in the selected datasets'],
    ['anchors>>n', 'a spline background through n anchors placed automatically in the selected datasets'],
    ['exclude>>a&b, include>>a&b', 'leave the region a to b out of the fit, or take it back'],
    ['method>>rietveld, lebail, wppf', 'choose the active Solve calculation; applies to all participating phases'],
    ['phases', 'the table of the phases each dataset holds'],
    ['phases>>p1&p2, phases>>all, phases>>none', 'the phases the selected datasets hold (keys or names); a phase taken out keeps its values for when it comes back'],
    ['sharing', 'which selected datasets share each group of parameters in the global fit; the others keep their own values'],
    ['simulate', 'a pattern calculated from phases with atoms, independent of the active fit method'],
    ['clone_all, clone_active', 'copy matching parameter values and refinement flags from the active dataset to all others, or to the selected others'],
    ['select>>text', 'select the datasets whose name contains text (regular expressions work)'],
    ['demo', 'NaCl and Si, two simulated patterns'],
    ['gsas2', 'ZIP file for GSAS-II: a CIF per phase, a .xye per selected dataset with its .instprm, and a README'],
    ['undo', 'go back one step, repeat to go further; the Log has a Restore button on each action'],
    ['cmd', 'this list of commands'],
    ['help', 'open the documentation (Powder6_documentation.html) in a new tab']
  ];
  function openDocumentation() {
    var w = null;
    try { w = window.open('Powder6_documentation.html', '_blank', 'noopener'); } catch (e) { w = null; }
    if (!w) ui.toast('The documentation did not open. Allow pop-ups for this page, or open Powder6_documentation.html yourself.', 'warn');
  }
  function showHelp() {
    ui.modal({ title: 'Commands', wide: true, body: '<p class="intro">Type them in the command line at the bottom of the window. They act on the selected datasets.</p><table class="grid">' +
      HELP.map(function (h) { return '<tr><td><code>' + ui.esc(h[0]) + '</code></td><td>' + ui.esc(h[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<p class="hint">Parameter names: zero, disp, transp, bkg0 … (Chebyshev) or bga0 … (spline anchors); p1.scale, p1.a, p1.GW, p1.po; p1.Na1.x, p1.Na1.occ, p1.Na1.B (p1 is the first phase). A Le Bail or WPPF phase has no scale, po or atoms to refine.</p>' });
  }
  function tickPattern(text, on) {
    if (!idle() || !haveSel()) return;
    var rx;
    try { rx = new RegExp(text, 'i'); } catch (e) { ui.toast('Not a valid pattern: ' + e.message, 'err'); return; }
    // the names of every selected dataset (a phase may be in only some of them)
    var list = sel(), seen = {}, names = [];
    list.forEach(function (ds) { Object.keys(ds.fit).forEach(function (n) { if (!seen[n] && rx.test(n) && St.isVariable(n)) { seen[n] = 1; names.push(n); } }); });
    if (!names.length) { ui.toast('No parameter name matches ' + text + '. Type cmd for the names.', 'warn'); return; }
    snapshot('fit flags ' + text);
    names.forEach(function (n) { St.setFit(n, on, list); });
    ui.toast((on ? 'Ticked ' : 'Unticked ') + names.slice(0, 8).join(', ') + (names.length > 8 ? ' … (' + names.length + ')' : '') + '.', 'info');
  }
  function runCommand(line) {
    var s = String(line).trim();
    if (!s) return;
    ui.log('› ' + s, 'cmd');
    var m = /^(select|tick|untick)>>(.+)$/i.exec(s);
    if (m) {
      var what = m[1].toLowerCase(), arg = m[2].trim();
      if (what === 'tick' || what === 'untick') { tickPattern(arg, what === 'tick'); return; }
      var rx;
      try { rx = new RegExp(arg, 'i'); } catch (e) { ui.toast('Not a valid pattern: ' + e.message, 'err'); return; }
      var ids = S.datasets.filter(function (d) { return rx.test(d.name); }).map(function (d) { return d.id; });
      St.selectIds(ids);
      ui.toast('Selected ' + plural(ids.length, 'dataset') + ' matching ' + arg + '.', ids.length ? 'ok' : 'warn');
      return;
    }
    m = /^([a-z_]+)(?:>>(.*))?$/i.exec(s.replace(/\s+/g, ''));
    if (!m) { ui.toast('Unknown command: ' + s + '. Type cmd for the list.', 'err'); return; }
    var cmd = m[1].toLowerCase(), raw = m[2] || '', a = raw.split('&').filter(Boolean).map(function (x) { return ui.parseNum(x); });
    switch (cmd) {
      case 'fit': fitSelected(); break;
      case 'globalfit': case 'global_fit': globalFit(); break;
      case 'stop': stop(); break;
      case 'steps': tickSteps(STEPS.indexOf(raw.toLowerCase()) >= 0 || raw.toLowerCase() === 'none' ? raw.toLowerCase() : 'scale'); break;
      case 'scales': estimate(); break;
      case 'range':
        if (!idle() || !haveSel()) break;
        if (!(a.length === 2 && a[0] < a[1])) { ui.toast('range>>a&b needs two angles, a below b.', 'err'); break; }
        snapshot('fitted range');
        St.setInstrument(sel(), { tthMin: a[0], tthMax: a[1] });
        ui.toast('Fitted range of ' + plural(S.sel.size, 'dataset') + ': ' + a[0] + '–' + a[1] + '°.', 'ok');
        break;
      case 'bkg':
        if (!idle() || !haveSel()) break;
        if (!(Number.isInteger(a[0]) && a[0] >= 0 && a[0] <= 24)) { ui.toast('bkg>>n needs a whole number from 0 to 24.', 'err'); break; }
        snapshot('background terms');
        St.setInstrument(sel(), { bkgN: a[0] });
        ui.toast(plural(a[0], 'background term') + ' in ' + plural(S.sel.size, 'dataset') + '.', 'ok');
        break;
      case 'anchors':
        if (!idle() || !haveSel()) break;
        if (!(Number.isInteger(a[0]) && a[0] >= 2 && a[0] <= 200)) { ui.toast('anchors>>n needs a whole number from 2 to 200.', 'err'); break; }
        snapshot('spline background');
        St.setSetting('nAnchors', a[0]);
        sel().forEach(function (ds) { St.setInstrument([ds], { bkgType: 'spline', bkgX: St.autoAnchors(ds, a[0]) }); });
        ui.toast('Spline background through ' + a[0] + ' anchors in ' + plural(S.sel.size, 'dataset') + '.', 'ok');
        break;
      case 'exclude': case 'include':
        if (!idle() || !haveSel()) break;
        if (!(a.length === 2 && a[0] < a[1])) { ui.toast(cmd + '>>a&b needs two angles, a below b.', 'err'); break; }
        snapshot(cmd === 'exclude' ? 'excluded region' : 'included region');
        sel().forEach(function (ds) {
          var ex = ds.inst.excl, out = [];
          if (cmd === 'exclude') out = ex.concat([[a[0], a[1]]]);
          else ex.forEach(function (r) { if (r[1] <= a[0] || r[0] >= a[1]) out.push(r); else { if (r[0] < a[0]) out.push([r[0], a[0]]); if (r[1] > a[1]) out.push([a[1], r[1]]); } });
          St.setInstrument([ds], { excl: out });
        });
        ui.toast((cmd === 'exclude' ? 'Excluded ' : 'Taken back into the fit: ') + a[0] + '–' + a[1] + '° in ' + plural(S.sel.size, 'dataset') + '.', 'ok');
        break;
      case 'method': {
        var parts = raw.split('&'), mth = (parts[0] || '').toLowerCase().replace(/[^a-z]/g, ''), ph = parts[1] ? St.phaseByKey(parts[1].trim()) : St.currentPhase();
        if (mth === 'lb') mth = 'lebail';
        if (C.METHODS.indexOf(mth) < 0) { ui.toast('method>>rietveld, lebail or wppf.', 'err'); break; }
        if (!ph) { ui.toast('No such phase.', 'err'); break; }
        setMethod(ph, mth);
        break;
      }
      case 'phases': if (raw) setPhasesOfSelection(raw); else phaseMap(); break;
      case 'sharing': sharing(); break;
      case 'simulate': simulate(); break;
      case 'clone_all': cloneTo(true); break;
      case 'clone_active': cloneTo(false); break;
      case 'demo': demo(); break;
      case 'gsas2': RV.gsas2.exportSelected(); break;
      case 'undo': undo(); break;
      case 'cmd': showHelp(); break;
      case 'help': openDocumentation(); break;
      default: ui.toast('Unknown command: ' + cmd + '. Type cmd for the list.', 'err');
    }
  }
  function undo() { if (idle()) RV.history.undo(); }

  // ---------------------------------------------------------------- menus
  function init() {
    var M = {
      file: [['Read patterns…', readData0, 'read'], ['Read CIF…', readStructure, 'phase'], null,
             ['Read project…', openProjectFile, 'read'], ['Save project', saveProject, 'saveProject'], null,
             ['Save results of selected…', function () { RV.results.save('save'); }, 'selection'],
             ['Save reflections and intensities of selected…', function () { RV.results.save('refl'); }, 'selection'],
             ['Save calculated patterns of selected…', function () { RV.results.save('calc'); }, 'selection'], null,
             ['Export to GSAS-II…', function () { RV.gsas2.exportSelected(); }, 'selection']],
      data: [['Undo the last command', undo, 'undo'], null,
             ['Instrument and range of selected…', instrument, 'edit'], ['Background of selected…', background, 'edit'], ['Excluded regions of selected…', excludeRegions, 'edit'], null,
             ['Simulate a pattern from the phases…', simulate, 'havePhase'], ['Delete selected datasets…', deleteDatasets, 'edit'], null,
             ['Copy active dataset parameters to all others', function () { cloneTo(true); }, 'cloneAll'],
             ['Copy active dataset parameters to selected others', function () { cloneTo(false); }, 'cloneSel']],
      refine: [['Fit selected datasets (F9)', fit, 'fit'], ['Global fit of selected datasets', globalFit, 'global'], null,
               ['Tick scales and background', function () { tickSteps('scale'); }, 'edit'], ['… and zero and cells', function () { tickSteps('cell'); }, 'edit'],
               ['… and peak shapes', function () { tickSteps('profile'); }, 'edit'], ['… and atoms', function () { tickSteps('atoms'); }, 'edit'],
               ['Untick everything', function () { tickSteps('none'); }, 'edit'], ['Estimate scales and background', estimate, 'withPhase'], null,
               ['Sharing in the global fit…', function () { sharing(); }, 'global'], null,
               ['Phases of the datasets…', phaseMap, 'phaseMap'], ['Add an atom to the current phase…', addAtom, 'havePhase'], ['Atoms from CIF into the current phase…', atomsFromCif, 'havePhase'], ['Fragment (molecule) into the current phase…', fragment, 'havePhase'], ['Delete the current phase…', deletePhase, 'havePhase']]
    };
    document.querySelectorAll('[data-menu]').forEach(function (b) {
      b.addEventListener('click', function () {
        ui.menu(b, M[b.getAttribute('data-menu')].map(function (it) { return it ? { label: it[0], act: it[1], off: why(it[2]) } : { sep: true }; }));
      });
    });
    ['datasets', 'selection', 'params', 'phases', 'data', 'fitmode','tab','fitHistory'].forEach(function (ev) { RV.bus.on(ev, scheduleSync); });
    RV.bus.on('busy', syncButtons);
    syncButtons();
  }

  return { init: init, readFiles: readFiles, readStructure: readStructure, newPhase: newPhase, addAtom: addAtom, atomsFromCif: atomsFromCif, atomsFromCifText: atomsFromCifText, fragment: fragment, fragmentInto: fragmentInto, deletePhase: deletePhase, setMethod: setMethod,
           readData: readData0, orientation: orientation, resolution: resolution, setInstrumentProfile:setInstrumentProfile, instrument: instrument, background: background, excludeRegions: excludeRegions, markAt: markAt, removeAnchor: removeAnchor, addZone: addZone, editZone: editZone, applyZone: applyZone, removeZone: removeZone, regionAt: regionAt, simulate: simulate,
           loadPreset: loadPreset, savePreset: savePreset, loadDefaultPresets: loadDefaultPresets, extract: extract,
           deleteDatasets: deleteDatasets, estimate: estimate, cloneTo: cloneTo, tickSteps: tickSteps, fitGroupState: fitGroupState, setFitGroup: setFitGroup,
           fit: fit, fitSelected: fitSelected, globalFit: globalFit, stop: stop, undo: undo, saveProject: saveProject, openProject: openProject,
           demo: demo, runCommand: runCommand, showHelp: showHelp, openDocumentation: openDocumentation, why: why, syncButtons: syncButtons, phaseFromCif: phaseFromCif,
           phaseIn: phaseIn, setPhasesOfSelection: setPhasesOfSelection, phaseMap: phaseMap, sharing: sharing, shareGroups: shareGroups };
})();
