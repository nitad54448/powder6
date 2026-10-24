/* Dataset and phase navigation, numerical calculation parameters, Solve setup and Settings. */
RV.panels = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui, esc = ui.esc, C = RVCore, editing = null, dsList = null, phList = null, dragId = null, cursor = null;
  function $(s) { return document.querySelector(s); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function fitMode() { return RV.app && RV.app.fitMode ? RV.app.fitMode() : 'single'; }
  function editorDataset() { return RV.workspace && RV.workspace.dataset ? RV.workspace.dataset() : St.first(); }

  // ================================================================ Datasets
  function dsRow(d) {
    var on = S.sel.has(d.id);
    return '<div class="ds'+(on?' on':'')+'" data-id="'+d.id+'" style="--dataset-color:'+RV.plots.colorVar(d)+'" draggable="true" role="option" aria-selected="'+on+'"><input type="checkbox" data-dataset-check="'+d.id+'" aria-label="Include '+esc(d.name)+' in plots and fit"'+(on?' checked':'')+'><span class="nm" title="'+esc(d.name)+'">'+esc(d.name)+'</span></div>';
  }
  function renderDatasets() {
    if (!S.datasets.length) {
      dsList.innerHTML = '<div class="empty-list"><p>No datasets yet.</p><p>Use File, drop powder patterns on this window, or ' +
        '<button type="button" class="link" data-act="demo">load the demo</button> (NaCl and Si, measured with Cu and Co radiation).</p></div>';
    } else dsList.innerHTML = S.datasets.map(dsRow).join('');
    countDatasets(); renderInfo();
  }
  function countDatasets() { $('#ds-count').textContent = S.datasets.length ? S.sel.size + ' of ' + S.datasets.length + ' selected' : ''; }
  function updateSel() {
    Array.prototype.forEach.call(dsList.children, function (r) {
      var id = +r.getAttribute('data-id');
      if (!id) return;
      var on = S.sel.has(id);
      if (r.classList.contains('on') !== on) { r.classList.toggle('on', on); r.setAttribute('aria-selected', String(on)); }
      var cb=r.querySelector('[data-dataset-check]');if(cb)cb.checked=on;
    });
    countDatasets(); renderInfo();
  }
  function renderInfo() {
    var host = $('#ds-info'), d = editorDataset(), why = S.busy ? 'Not while a fit is running.' : !d ? 'No data loaded yet.' : '';
    ['#ds-inst', '#ds-bkg', '#ds-excl', '#ds-resolution'].forEach(function (b) { ui.able($(b), why); });
    ui.able($('#ds-phases'), S.busy ? 'Not while a fit is running.' : !S.phases.length ? 'No phase yet. Read CIF or make a new phase in Phases.' : !S.datasets.length ? 'No data loaded yet.' : '');
    if (!d) { host.innerHTML = ''; return; }
    var i = d.inst, pol = i.radiation === 'neutron' ? 'neutrons' : { tube: 'X-rays, no monochromator', mono: 'X-rays, monochromator at 2θ = ' + i.monoTth + '°', sync: 'synchrotron, polarised fraction ' + i.polFrac, none: 'X-rays, no polarisation correction' }[i.pol];
    var pts = St.fitPoints(d), nFit = pts.tth.length - pts.nExcluded;
    host.innerHTML = '<p class="hint">Properties of <b>'+esc(d.name)+'</b>; setup actions default to this dataset.</p><dl><dt>λ</dt><dd>' + i.lambda1 + (i.ratio > 0 && i.lambda2 > 0 ? ' and ' + i.lambda2 + ' Å, ratio ' + i.ratio : ' Å') + (i.anode && St.ANODES[i.anode] && Math.abs(St.ANODES[i.anode][0] - i.lambda1) < 1e-6 ? ' (' + i.anode + ')' : '') + '</dd>' +
      '<dt>Beam</dt><dd>' + esc(pol) + '</dd>' +
      '<dt>Fitted</dt><dd>' + i.tthMin.toFixed(2) + '–' + i.tthMax.toFixed(2) + '°, ' + nFit + ' of ' + d.tth.length + ' points' + (d.step ? ', step ' + (+d.step.toPrecision(3)) + '°' : '') + '</dd>' +
      '<dt>Background</dt><dd>' + (i.bkgType === 'spline' ? 'spline through ' + plural(i.bkgX.length, 'anchor') : plural(i.bkgN, 'Chebyshev term')) + '</dd>' +
      (S.phases.length ? '<dt>Phases</dt><dd>' + (esc(St.phasesIn(d).map(function (p) { return p.name; }).join(', ')) || '<span class="why">none: background only</span>') + '</dd>' : '') +
      (i.excl.length ? '<dt>Excluded</dt><dd title="' + esc(i.excl.map(function (r) { return r[0].toFixed(2) + '–' + r[1].toFixed(2) + '°'; }).join(', ')) + '">' + plural(i.excl.length, 'region') + ', ' + pts.nExcluded + ' points</dd>' : '') +
      (d.sim ? '<dt>Simulated</dt><dd>calculated from the phases' + (d.sim.noise ? ', with counting noise' : '') + '</dd>' : '') + '</dl>';
  }
  function rowOf(id) { return dsList.querySelector('.ds[data-id="' + id + '"]'); }
  function renameDs(id) {
    var row = rowOf(id), d = St.byId(id);
    if (!row || !d) return;
    var nm = row.querySelector('.nm'), inp = document.createElement('input'), done = false;
    inp.className = 'rename'; inp.value = d.name; inp.setAttribute('aria-label', 'New name');
    nm.replaceWith(inp); inp.focus(); inp.select();
    function end(save) {
      if (done) return;
      done = true;
      var v = inp.value.trim();
      if (save && v && v !== d.name) { RV.history.take('renaming ' + d.name); St.rename(id, v); } else renderDatasets();
      dsList.focus();
    }
    inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false); });
    inp.addEventListener('blur', function () { end(true); });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    inp.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  }
  function moveSel(dir, extend) {
    var arr = S.datasets;
    if (!arr.length) return;
    var ref = cursor != null && S.sel.has(cursor) ? cursor : S.anchor, i = arr.findIndex(function (d) { return d.id === ref; });
    var j = Math.max(0, Math.min(arr.length - 1, i < 0 ? 0 : i + dir));
    cursor = arr[j].id;
    if (extend) St.range(cursor); else St.selectIds([cursor]);
    var r = rowOf(cursor);
    if (r) r.scrollIntoView({ block: 'nearest' });
  }
  function initDatasets() {
    dsList = $('#ds-list');
    dsList.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="demo"]')) { RV.cmd.demo(); return; }
      var row = e.target.closest('.ds');
      if (!row) return;
      var id = +row.getAttribute('data-id');
      cursor = id;
      if(e.target.matches('[data-dataset-check]'))St.toggle(id);else if (e.shiftKey) St.range(id); else if (e.ctrlKey || e.metaKey) St.toggle(id); else if(S.sel.has(id))St.setFocus(id);else St.selectIds([id]);
    });
    dsList.addEventListener('dblclick', function (e) { var row = e.target.closest('.ds'); if (row) renameDs(+row.getAttribute('data-id')); });
    dsList.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); St.selectAll(); }
      else if (e.key === 'Delete') { e.preventDefault(); RV.cmd.deleteDatasets(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey); }
      else if (e.key === 'F2') { e.preventDefault(); var f = St.first(); if (f) renameDs(f.id); }
    });
    dsList.addEventListener('dragstart', function (e) {
      var row = e.target.closest('.ds');
      if (!row) return;
      dragId = +row.getAttribute('data-id');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-rietveld-dataset', String(dragId));
    });
    dsList.addEventListener('dragover', function (e) {
      if (dragId == null) return;
      e.preventDefault();
      var row = e.target.closest('.ds');
      dsList.querySelectorAll('.drop').forEach(function (r) { if (r !== row) r.classList.remove('drop'); });
      if (row) row.classList.add('drop');
    });
    dsList.addEventListener('drop', function (e) {
      if (dragId == null) return;
      e.preventDefault(); e.stopPropagation();
      var row = e.target.closest('.ds');
      St.move(dragId, row ? +row.getAttribute('data-id') : null);
      dragId = null;
    });
    dsList.addEventListener('dragend', function () { dragId = null; dsList.querySelectorAll('.drop').forEach(function (r) { r.classList.remove('drop'); }); });
    $('#ds-inst').addEventListener('click', function () { RV.cmd.instrument(); });
    $('#ds-bkg').addEventListener('click', function () { RV.cmd.background(); });
    RV.bus.on('datasets', renderDatasets);
    RV.bus.on('selection', updateSel);
    RV.bus.on('datasetFocus', renderInfo);
    RV.bus.on('stats', renderDatasets);
    RV.bus.on('data', renderDatasets);
    RV.bus.on('busy', renderInfo);
    renderDatasets();
  }

  // ================================================================ Phases
  function renderPhases() {
    var cur = St.currentPhase();
    $('#ph-count').textContent = plural(S.phases.length, 'phase');
    phList.innerHTML = S.phases.map(function (ph, i) {
      return '<div class="ds ph' + (cur === ph ? ' on' : '') + '" data-key="' + ph.key + '" role="option" aria-selected="' + (cur === ph) + '"><i class="sw" style="--dataset-color:' + RV.plots.phaseVar(i) + '"></i><span class="nm">' + esc(ph.name) + '</span><small>' + esc(ph.sg.symbol) + ' · ' + ph.atoms.length + ' atoms</small><button type="button" class="icon-btn" data-remove-phase="'+ph.key+'" aria-label="Remove phase '+esc(ph.name)+'" title="Remove phase '+esc(ph.name)+'"'+(S.busy?' disabled':'')+'>✕</button></div>';
    }).join('') || '<p class="hint">Create or import a phase in the Phases tab.</p>';
  }
  function initPhases() {
    phList = $('#ph-list');
    phList.addEventListener('click', function (e) {var remove=e.target.closest('[data-remove-phase]');if(remove){e.stopPropagation();if(!S.busy)RV.cmd.deletePhase(remove.dataset.removePhase);return;}if (e.target.closest('select, input')) return; var row = e.target.closest('.ph'); if (row) St.selectPhase(row.getAttribute('data-key')); });
    phList.addEventListener('keydown', function (e) {
      if (e.target.closest('select, input, button')) return;
      var i = S.phases.indexOf(St.currentPhase());
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.phases.length) { e.preventDefault(); St.selectPhase(S.phases[Math.max(0, Math.min(S.phases.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].key); }
    });
    ['phases', 'phaseStyle', 'phaseSel', 'tables', 'busy', 'selection', 'datasets'].forEach(function (ev) { RV.bus.on(ev, renderPhases); });
    renderPhases();
  }

  // ================================================================ Parameters
  var CELL_LABEL = { a: 'a', b: 'b', c: 'c', alpha: 'α', beta: 'β', gamma: 'γ' };
  var PROF_UNIT = { GU: 'cdeg²', GV: 'cdeg²', GW: 'cdeg²', GP: 'cdeg²', LX: 'cdeg', U: 'cdeg²', V: 'cdeg²', W: 'cdeg²', X: 'cdeg', Y: 'cdeg',
                    GU_L: 'cdeg²', GV_L: 'cdeg²', GW_L: 'cdeg²', LX_L: 'cdeg', GU_R: 'cdeg²', GV_R: 'cdeg²', GW_R: 'cdeg²', LX_R: 'cdeg' };
  var PROF_TIP = { GU: 'Gaussian width, U tan²θ', GV: 'Gaussian width, V tanθ', GW: 'Gaussian width, W', GP: 'Gaussian width, P / cos²θ (size)', LX: 'Lorentzian width, X / cosθ (size)',
                   eta: 'Lorentzian fraction of the pseudo-Voigt', U: 'Gaussian, U tan²θ', V: 'Gaussian, V tanθ', W: 'Gaussian, W', X: 'Lorentzian, X tanθ (strain)', Y: 'Lorentzian, Y / cosθ (size)',
                   SL: 'Axial divergence, S/L', HL: 'Axial divergence, H/L', eta_split: 'Lorentzian fraction, both sides' };
  var collapsed = St.load('collapsed') || {};
  function groupsFor(ds) {
    var out = [], rows = [{ name: 'zero', label: 'zero', unit: '°', tip: 'Zero point: observed minus calculated 2θ' },
                          { name: 'disp', label: 'displ.', unit: '', tip: 'Sample displacement: Δ2θ = −(displ./1000) cos θ, in radians' },
                          { name: 'transp', label: 'transp.', unit: '', tip: 'Sample transparency: Δ2θ = transp. sin 2θ, in radians (negative for a real specimen: the peaks move to lower angle)' }];
    var resolution = St.instrumentParamsFor(ds).filter(function (p) { return Object.prototype.hasOwnProperty.call(ds.p, 'inst.' + p[0]); }).map(function (p) {
      return { name: 'inst.' + p[0], label: p[0], unit: /^(U|V|W)(_[LR])?$/.test(p[0]) ? 'cdeg²' : /^(X|Y|Z)(_[LR])?$/.test(p[0]) ? 'cdeg' : '', tip: 'Instrument resolution for all phase contributions in this dataset. ' + ({U:'Gaussian tan²θ coefficient',V:'Gaussian tanθ coefficient',W:'Gaussian constant variance',Z:'Lorentzian constant width',X:'Lorentzian /cosθ coefficient',Y:'Lorentzian tanθ coefficient',SL:'Axial asymmetry coefficient /tanθ',HL:'Constant axial asymmetry coefficient'}[p[0]] || (/^eta/.test(p[0]) ? 'Independent pseudo-Voigt mixing fraction' : 'Left/right instrument width coefficient')) };
    });
    if (resolution.length) out.push({ key: 'resolution', title: 'Instrument resolution', sub: ds.name + ' · all phases', rows: resolution });
    out.push({ key: 'acquisition', title: 'Acquisition', sub: ds.name + ' · zero point', rows: [rows[0]] });
    out.push({ key: 'sample', title: 'Sample geometry', sub: ds.name + ' · displacement, transparency', rows: rows.slice(1) });
    rows = [];
    if (ds.inst.bkgType === 'spline') ds.inst.bkgX.forEach(function (x, k) { rows.push({ name: 'bga' + k, label: 'bkg ' + (+x.toFixed(2)) + '°', unit: '', tip: 'Background at the anchor 2θ = ' + x + '° (spline through ' + ds.inst.bkgX.length + ' anchors)' }); });
    else for (var k = 0; k < ds.inst.bkgN; k++) rows.push({ name: 'bkg' + k, label: 'bkg ' + k, unit: '', tip: 'Background, coefficient of the Chebyshev polynomial T' + k + ' over the fitted range' });
    out.push({ key: 'ds', title: 'Background', sub: ds.name, rows: rows });
    out.push({key:'exclusions',title:'Excluded regions',sub:plural(ds.inst.excl.length+ds.inst.exclOff.length,'zone')+(ds.inst.exclOff.length?' ('+ds.inst.exclOff.length+' not applied)':''),rows:[]});
    S.phases.forEach(function (ph, pi) {
      if (!St.hasPhase(ds, ph)) return;
      var kk = ph.key + '.', col = RV.plots.phaseVar(pi), rv = ph.method === 'rietveld';
      var main = rv ? [{ name: kk + 'scale', label: 'scale', unit: '', tip: 'Scale factor of ' + ph.name + ' in this dataset' }] : [];
      C.cellParams(ph.sg.system, ph.sg.uniqueAxis).forEach(function (c) { main.push({ name: kk + c, label: CELL_LABEL[c], unit: /^[abc]$/.test(c) ? 'Å' : '°', tip: 'Cell ' + CELL_LABEL[c] + ' of ' + ph.name }); });
      if (rv) main.push({ name: kk + 'po', label: 'PO r', unit: '', tip: 'March–Dollase r along (' + ph.poDir.join(' ') + '); 1 is no preferred orientation' });
      out.push({ key: ph.key, title: ph.name, sub: rv ? 'scale, cell, orientation' : 'cell (' + C.METHOD_LABELS[ph.method] + ': the intensities come from the pattern)', color: col, rows: main });
      out.push({ key: ph.key + ':prof', title: ph.name, sub: C.usesSeparatedProfile(ph) ? 'Sample size / microstrain' : 'Peak broadening', color: col,
                 rows: St.profileNames(ph).map(function (n) { return { name: kk + n, label: n, unit: /^(size|sizeAxial|sizeB|sizeC)$/.test(n) ? 'nm' : /^strain/.test(n) && n !== 'strainMix' ? 'ppm' : /^rot/.test(n) ? '°' : PROF_UNIT[n] || '', tip: ({size:'Crystallite size: isotropic or first ellipsoid principal size, nanometres',sizeAxial:'Crystallite size parallel to the size axis, nanometres',sizeB:'Second ellipsoid principal size, nanometres',sizeC:'Third ellipsoid principal size, nanometres',strain:'Isotropic or equatorial RMS microstrain in ppm',strainAxial:'Axial RMS microstrain in ppm',sizeMix:'Lorentzian fraction of size broadening (0 Gaussian, 1 Lorentzian)',strainMix:'Lorentzian fraction of microstrain broadening (0 Gaussian, 1 Lorentzian)'})[n] || (/^S[0-9]/.test(n) ? 'Stephens reciprocal-metric variance coefficient, ppm² Å⁻⁴' : PROF_TIP[n] || n) }; }) });
      if (rv) ph.atoms.forEach(function (at) {
        var pre = kk + at.label + '.', r = [];
        ['x', 'y', 'z'].forEach(function (c, i) {
          var role = St.coordRole(at.site, i);
          if (role === 'fixed') return;
          var ex = at.site.expr.split(', ')[i];
          r.push(role === 'free' ? { name: pre + c, label: c, unit: '', tip: c + ' of ' + at.label + ', fractional' } : { name: pre + c, label: c, unit: '= ' + ex, dep: true, tip: c + ' = ' + ex + ' on site ' + at.site.wyck });
        });
        r.push({ name: pre + 'occ', label: 'occ', unit: '', tip: 'Occupancy of ' + at.label });
        r.push({ name: pre + 'B', label: 'B', unit: 'Å²', tip: 'Isotropic displacement of ' + at.label });
        out.push({ key: ph.key + ':' + at.label, title: ph.name + ' · ' + at.label, sub: at.type + ', ' + at.site.wyck + ' (' + at.site.expr + ')', color: col, rows: r });
      });
    });
    return out;
  }
  var LOCK_SVG = {
    shared: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    local: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.8-1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
  };
  function fmtVal(v) {
    if (v === Infinity) return 'inf';
    if (v === -Infinity) return '-inf';
    if (typeof v !== 'number' || !isFinite(v)) return String(v);
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e-3 && a < 1e6) return String(+v.toPrecision(7));
    return v.toExponential(5).replace('e', 'E');
  }
  function fmtEsd(e) { return e >= 1e-3 && e < 1e4 ? String(+e.toPrecision(2)) : e.toExponential(1).replace('e', 'E'); }
  function fmtParam(name,value) {
    return St.isSizeParam(name) && Number.isFinite(value) ? String(Math.round(St.toDisplay(name,value))) : fmtVal(value);
  }
  var shownGroups = null;
  function renderParams() {
    var copy=$('#sp-params .clone-bar'),source=editorDataset();copy.hidden=S.datasets.length<2 || !source;copy.querySelector('.sub').textContent=source?'Copy parameter values and refinement flags from '+source.name+' to:':'';
    var host = $('#param-list'), ds = editorDataset(), head = $('#param-ds');
    head.textContent = ds ? ds.name : '';
    $('#param-more').textContent = '';
    head.title = ds ? 'Values and refinement flags of '+ds.name+' only.' : '';
    syncStep();
    if (!ds) {
      shownGroups = null;
      host.innerHTML = '<p class="hint">' + (S.datasets.length ? 'Select a dataset to see and edit its parameters.' : 'Read a powder pattern first: each dataset holds its own values of the parameters of its phases.') + '</p>';
      renderStats(); return;
    }
    var groups = groupsFor(ds), dis = S.busy ? ' disabled' : '';
    shownGroups = groups;
    host.innerHTML = groups.map(function (g) {
      var closed = !!collapsed[g.key], anchors = g.key === 'ds' && ds.inst.bkgType === 'spline';
      var header='<div class="pgroup" data-group="' + esc(g.key) + '"><button type="button" class="pg-tog" aria-expanded="' + !closed + '">' +
        (g.color ? '<i class="sw" style="background:' + g.color + '"></i>' : '') + '<span class="pg-t">' + esc(g.title) + '</span><span class="pg-s" title="' + esc(g.sub) + '">' + esc(g.sub) + '</span></button>' +
        (g.key==='exclusions'?'':'<input type="checkbox" class="pg-fit"' + dis + ' aria-label="Fit all of ' + esc(g.title + ', ' + g.sub) + '">')+'</div>';
      if(g.key==='exclusions')return header+'<div class="pg-rows" id="dataset-exclusions"'+(closed?' hidden':'')+'>'+zoneRows(ds,dis)+'<p class="buttons"><button type="button" id="ds-excl"'+dis+'>Add zone</button></p></div>';
      var type=ds.inst.resolutionType || 'tch_aniso';if(type==='gsas_cw')type='tch_aniso';
      var instrument=g.key==='resolution'?'<label class="instrument-profile">Profile <select data-instrument-profile data-dataset-id="'+ds.id+'"'+dis+'>'+C.INSTRUMENT_PROFILE_TYPES.map(function(t){return '<option value="'+t+'"'+(t===type?' selected':'')+'>'+esc(C.PROFILE_LABELS[t])+'</option>';}).join('')+'</select></label>':'';
      return header+'<div class="pg-rows"' + (closed ? ' hidden' : '') + '>'+instrument + (anchors ? '<p class="hint">X is 2θ in degrees and stays fixed during refinement. Y is background intensity; tick its checkbox to refine it. × removes an anchor.</p><div class="anchor-head" aria-hidden="true"><span>Anchor</span><span>2θ (°)</span><span>Intensity</span><span></span><span></span><span class="hd-pl"></span><span>Fit</span></div>' : '') + g.rows.map(function (p) {
          var k=anchors?+p.name.slice(3):-1;
          return '<div class="prow' + (p.dep ? ' dep' : '') + (anchors ? ' anchor-row' : '') + '" data-name="' + esc(p.name) + '"><span class="pn" title="' + esc(p.tip) + '">' + (anchors?'Anchor '+(k+1):esc(p.label)) + '</span>' +
            (anchors?'<input class="anchor-x" data-anchor-x="'+k+'" value="'+esc(fmtVal(ds.inst.bkgX[k]))+'" spellcheck="false" autocomplete="off" aria-label="Anchor '+(k+1)+' X (2θ, degrees)"'+dis+'>':'') +
            '<input class="pv" data-dataset-id="'+ds.id+'" aria-label="' + (anchors?'Anchor '+(k+1)+' Y (intensity)':esc(p.name)) + '" spellcheck="false" autocomplete="off"' + (p.dep ? ' disabled' : dis) + '>' +
            (anchors ? '' : '<span class="pu" title="' + esc(p.unit) + '">' + esc(p.unit) + '</span>') + '<span class="ps"></span>' +
            (anchors ? '<button type="button" class="pr" data-anchor-remove="' + k + '" title="Remove anchor ' + (k + 1) + '" aria-label="Remove anchor ' + (k + 1) + '"' + dis + '>×</button>' : '') +
            (p.dep ? '<span class="pl" hidden></span><span class="pf-none"></span>' : '<button type="button" class="pl" aria-label="Shared or local ' + esc(p.name) + '"></button><input class="pf" type="checkbox" title="Fit ' + esc(p.name) + '" aria-label="Fit ' + esc(p.name) + '"' + dis + '>') +
            '</div>';
        }).join('') + '</div>';
    }).join('');
    renderValues();
  }
  // Datasets → Excluded regions: one row per zone (from, to, a tick to apply it, a button to remove it), applied ones and kept-aside ones in angle order
  function zoneRows(ds, dis) {
    var zones = ds.inst.excl.map(function (r, i) { return { r: r, kind: 'on', i: i }; }).concat(ds.inst.exclOff.map(function (r, i) { return { r: r, kind: 'off', i: i }; }))
      .sort(function (a, b) { return a.r[0] - b.r[0] || a.r[1] - b.r[1]; });
    if (!zones.length) return '<p class="hint">No excluded zone in this dataset. Add zone, or Ctrl+Shift+drag on the pattern.</p>';
    return '<p class="hint">2θ zones left out of the fit. Untick Apply to fit without a zone and keep it in the list; × removes it.</p>' +
      '<div class="zone-head" aria-hidden="true"><span>Zone</span><span>From 2θ (°)</span><span>To 2θ (°)</span><span></span><span>Apply</span></div>' +
      zones.map(function (z, n) {
        var id = 'Zone ' + (n + 1), on = z.kind === 'on';
        return '<div class="zone-row' + (on ? '' : ' off') + '" data-zone="' + z.kind + ':' + z.i + '"><span class="pn">' + id + '</span>' +
          '<input class="zone-box" data-zone-lo value="' + esc(fmtVal(z.r[0])) + '" spellcheck="false" autocomplete="off" aria-label="' + id + ' from 2θ (degrees)"' + dis + '>' +
          '<input class="zone-box" data-zone-hi value="' + esc(fmtVal(z.r[1])) + '" spellcheck="false" autocomplete="off" aria-label="' + id + ' to 2θ (degrees)"' + dis + '>' +
          '<button type="button" class="pr" data-zone-remove title="Remove ' + id + '" aria-label="Remove ' + id + '"' + dis + '>×</button>' +
          '<input type="checkbox" class="zone-apply" data-zone-apply' + (on ? ' checked' : '') + ' title="' + (on ? 'Applied: left out of the fit. Untick to fit with this zone.' : 'Not applied: the fit uses these points. Tick to leave the zone out.') + '" aria-label="Apply ' + id + '"' + dis + '></div>';
      }).join('');
  }
  function dsNames(list) { var t = list.slice(0, 4).map(function (d) { return d.name; }).join(', '); return list.length > 4 ? t + ' and ' + (list.length - 4) + ' more' : t; }
  function limitText(n, v) { var L = St.limitsOf(n, v); return ui.fmt(St.toDisplay(n,L[0]), 4) + ' to ' + ui.fmt(St.toDisplay(n,L[1]), 4) + (St.isSizeParam(n) ? ' nm' : ''); }
  function atLimit(n, v) { var L = St.limitsOf(n, v), e = 1e-9 * (1 + Math.abs(v)); return v <= L[0] + e || v >= L[1] - e; }
  function geometryTip(ds,n) {
    var R=ds.inst.radiusMM, v=ds.p[n];
    if(n==='disp')return 'Sample displacement: Δ2θ = −(displ./1000) cos θ in radians. '+(R>0 ? 'Bragg–Brentano height h = '+ui.fmt(v*R/2000,6)+' mm; radius R = '+R+' mm.' : 'Set the goniometer radius in Datasets → Instrument to obtain height in mm.');
    if(n==='transp' && RV.absorption)return RV.absorption.tip(ds);
    if(n==='transp')return 'Transparency: Δ2θ = transp. sin 2θ in radians; negative for a real specimen. '+(R>0 && v<0 ? 'Thick flat Bragg–Brentano specimen approximation: µeff = −1/(2 R transp.) = '+ui.fmt(-1/(2*R*v),6)+' mm⁻¹; absorption length '+ui.fmt(-2*R*v,6)+' mm. Not a composition-derived absorption coefficient.' : 'Effective absorption requires a negative transparency coefficient and the goniometer radius (Datasets → Instrument), assuming a thick flat Bragg–Brentano specimen.');
    return null;
  }
  function renderValues() {
    var ds = editorDataset(), list = ds ? [ds] : [], g = fitMode() === 'global', host = $('#param-list');
    if (!ds || !shownGroups) { renderStats(); return; }
    host.classList.toggle('global', g);
    // GSAS-II atomic constraints (Rietveld only): held, independent, dependent and equation terms are marked
    var acRoles = {};
    S.parameterLinks.filter(function(l){return l.target.datasetId===ds.id;}).forEach(function(l){acRoles[l.target.name]={role:'dependent',ignore:true,text:'Follows '+l.factor+' × '+l.source.name+' in '+(St.byId(l.source.datasetId)||{}).name+' + '+(l.offset || 0)};});
    if (S.calculation === 'rietveld' && typeof AtomicConstraints !== 'undefined') S.phases.forEach(function (ph) {
      if (ph.method === 'rietveld' && ph.constraints && ph.constraints.length && St.hasPhase(ds, ph)) { try { Object.assign(acRoles, AtomicConstraints.roles(ph, ds.fit)); } catch (e) { /* shown by the editor */ } }
    });
    host.querySelectorAll('.prow').forEach(function (row) {
      var n = row.getAttribute('data-name'), v = ds.p[n], inp = row.querySelector('.pv');
      var ar = acRoles[n], pn = row.querySelector('.pn');
      inp.readOnly=!St.isVariable(n) || !!(ar && ar.ignore);
      inp.disabled=!!S.busy || row.classList.contains('dep');
      var anchorX=row.querySelector('[data-anchor-x]');
      if(anchorX){if(document.activeElement!==anchorX)anchorX.value=fmtVal(ds.inst.bkgX[+anchorX.dataset.anchorX]);anchorX.disabled=!!S.busy;}
      row.classList.remove('ac-held', 'ac-dependent', 'ac-independent', 'ac-term');
      if (ar) row.classList.add('ac-' + ar.role);
      if (pn) { if (pn.dataset.tip == null) pn.dataset.tip = pn.title || ''; pn.title = ar ? ar.text + '. ' + pn.dataset.tip : pn.dataset.tip; }
      var physical=geometryTip(ds,n); if(physical){row.title=physical;inp.title=physical;var label=row.querySelector('.pn');if(label)label.title=physical;}
      if (editing !== n) inp.value = fmtParam(n,v);
      if (row.classList.contains('dep')) { row.querySelector('.pl').hidden = !g; return; }
      // among the selected datasets that hold the parameter (its phase may be in only some of them)
      var hold = list.filter(function (x) { return Object.prototype.hasOwnProperty.call(x.p, n); }), part = hold.length < list.length ? ' that hold it' : '';
      var nFit = hold.filter(function (x) { return x.fit[n]; }).length, mixed = hold.length > 1 && nFit > 0 && nFit < hold.length, fit = !!ds.fit[n];
      var pf = row.querySelector('.pf');
      pf.checked = fit && !mixed; pf.indeterminate = mixed;
      pf.disabled = !!S.busy || !!(ar && ar.ignore) || S.disabledPhases.includes(C.classify(n).phase);
      pf.title = mixed ? 'Refined in ' + nFit + ' of the ' + hold.length + ' selected datasets' + part + (g ? '; the global fit uses the ticks of ' + hold[0].name : '') + '. Click to refine it in all of them.'
                       : (fit ? 'Refined' : 'Held fixed') + (hold.length > 1 ? ' in all ' + hold.length + ' selected datasets' + part : '') + '. Click to ' + (fit ? 'hold it fixed.' : 'refine it.');
      if (ar && ar.ignore) pf.title = ar.text + '.';
      row.classList.toggle('fixed', !fit && !mixed);
      var pl = row.querySelector('.pl'), can = St.shareable(n), sh = St.isShared(n);
      pl.hidden = !g;
      if (g) {
        // shared by all the selected datasets that hold it, by some (the others keep their own value), or local
        var so = can && sh ? St.shareOf(n, list) : null, many = !!so && so.held.length > 1;
        var apart = many && St.isApart(ds, n), some = many && !apart && so.alone.length > 0;
        pl.innerHTML = can ? LOCK_SVG[sh && !apart ? 'shared' : 'local'] : '';
        pl.className = 'pl ' + (can ? (!sh ? 'local' : apart ? 'local apart' : some ? 'shared some' : 'shared') : 'own');
        pl.title = !can ? 'Always one value per dataset' :
          (!sh ? 'Local: one value per dataset in the global fit.' :
           apart ? 'Shared in the global fit, but ' + ds.name + ' keeps its own value' + (so.shared.length ? ' (shared by ' + dsNames(so.shared) + ').' : '.') :
           some && !so.shared.length ? 'Shared, but no two of the selected datasets that hold it share it: one value each.' :
           some ? 'Shared by ' + dsNames(so.shared) + '; ' + dsNames(so.alone) + ' keep' + (so.alone.length === 1 ? 's its' : ' their') + ' own value.' :
           'Shared: one value for all the datasets of the global fit that hold it' + (so && so.held.length === 1 && list.length > 1 ? ' (of the selected, only ' + ds.name + ' holds it).' : '.')) +
          ' Click to make it ' + (sh ? 'local' : 'shared') + '; right-click: the datasets that share it (Sharing…).';
        pl.disabled = S.busy || !can;
      }
      var se = row.querySelector('.ps'), e = ds.esd ? ds.esd[n] : undefined;
      if (Number.isFinite(e) && e > 0) { se.textContent = '±' + fmtEsd(St.toDisplay(n,e)); se.title = 'Standard uncertainty, from the last fit'; se.className = 'ps'; }
      else if(ds.stats && ds.stats.uncertaintyIssues && ds.stats.uncertaintyIssues[n]) {se.textContent='no s.u.';se.title=ds.stats.uncertaintyIssues[n];se.className='ps lim';}
      else if (ds.stats && fit && atLimit(n, v)) { se.textContent = 'limit'; se.title = 'At its limit (' + limitText(n, v) + ', Settings): no uncertainty'; se.className = 'ps lim'; }
      else { se.textContent = ''; se.title = ''; se.className = 'ps'; }
    });
    host.querySelectorAll('.pgroup').forEach(function (gr) {
      var rows = gr.nextElementSibling.querySelectorAll('.prow:not(.dep)'), on = 0, tot = rows.length;
      rows.forEach(function (r) { if (ds.fit[r.getAttribute('data-name')]) on++; });
      var cb = gr.querySelector('.pg-fit');if(!cb)return;
      cb.checked = tot > 0 && on === tot; cb.indeterminate = on > 0 && on < tot;
      cb.disabled=!!S.busy || !tot;
      cb.title = on + ' of ' + tot + ' refined in ' + ds.name + '. Click to ' + (on === tot ? 'hold them all fixed.' : 'refine them all.');
    });
    renderStats();
  }
  function renderStats() {
    // Actionable parameter diagnostics belong beside the editors; numerical
    // agreement factors remain in the selected Results calculation.
    var ds=editorDataset(),host=$('#param-stats'),warnings=ds && ds.stats && ds.stats.fitWarnings || [];
    host.hidden=!warnings.length;
    host.innerHTML=warnings.map(function(w){return '<p class="why">'+esc(w)+'</p>';}).join('');
  }
  function neighbour(dir) {
    var f = editorDataset();
    var list = S.datasets, i = f ? list.indexOf(f) : -1, j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    return j >= 0 && j < list.length ? { ds: list[j], k: j, n: list.length } : null;
  }
  function syncStep() {
    [['#param-prev', -1, 'Previous'], ['#param-next', 1, 'Next']].forEach(function (b) {
      var el = $(b[0]), nb = neighbour(b[1]);
      if (nb) el.dataset.tip = b[2] + (nb.cycle ? ' selected dataset: ' : ' dataset: ') + nb.ds.name + ' (' + (nb.k + 1) + ' of ' + nb.n + (nb.cycle ? ' selected; the selection is kept)' : ')');
      ui.able(el, !S.datasets.length ? 'No data loaded yet.' : nb ? '' : b[1] < 0 ? 'This is the first dataset of the list.' : 'This is the last dataset of the list.');
    });
  }
  function stepDataset(dir) {
    var nb = neighbour(dir);
    if (!nb) return;
    editing = null;RV.workspace.inspectDataset(nb.ds.id);
  }
  function clampVal(n, v) { var L = St.limitsOf(n, v); return Math.min(L[1], Math.max(L[0], v)); }
  function changeValue(n, v, burst) {
    var list = [editorDataset()].filter(Boolean);
    if (!list.some(function (ds) { return ds.p[n] !== v; })) return;
    var merge = burst ? 'step ' + n + ' ' + list.map(function (ds) { return ds.id; }).join(',') : null;
    RV.history.take('parameter ' + n, { merge: merge });
    if(St.setParam(n, v, list, false)===false)return;
    ui.toast(n + ' set to ' + fmtParam(n,v) + (St.isSizeParam(n) ? ' nm' : '') + (list.length > 1 ? ' in ' + list.length + ' datasets.' : '.'), 'info', merge);
  }
  function commitInput(inp) {
    if(inp.readOnly)return;
    var row = inp.closest('.prow'), n = row.getAttribute('data-name'), ds = editorDataset();
    if (!ds || +inp.dataset.datasetId!==ds.id || row.classList.contains('dep')) return;
    if (S.busy) { inp.value = fmtParam(n,ds.p[n]); return; }
    if (inp.value === fmtParam(n,ds.p[n])) return;
    var v = ui.parseNum(inp.value);
    if (!isFinite(v)) { inp.value = fmtParam(n,ds.p[n]); ui.toast('Not a number: ' + n + ' unchanged.', 'warn'); return; }
    if (St.isSizeParam(n) && !Number.isInteger(v)) { inp.value = fmtParam(n,ds.p[n]); ui.toast('Enter crystallite size as a whole number of nanometres.', 'warn'); return; }
    v = St.fromDisplay(n,v);
    var c = clampVal(n, v);
    if (c !== v) ui.toast(n + ' kept within its limits, ' + limitText(n, v) + ' (Datasets).', 'warn');
    changeValue(n, c);
  }
  // one step of the wheel or of an arrow key, by kind of parameter
  function step(n, dir, e) {
    var ds = editorDataset();
    if (!ds || S.busy || !(n in ds.p)) return;
    var v = ds.p[n], c = C.classify(n), f = e.shiftKey ? 10 : (e.altKey || e.ctrlKey) ? 0.1 : 1, d;
    if (St.isSizeParam(n)) {
      v = St.fromDisplay(n,Math.round(St.toDisplay(n,v)) + dir*(e.shiftKey ? 10 : 1));
      editing = null;
      changeValue(n,clampVal(n,v),true); return;
    }
    switch (c.kind) {
      case 'scale': v = v > 0 ? v * Math.pow(1 + 0.02 * f, dir) : 1e-6; break;
      case 'bkg': case 'bga': d = Math.max(Math.abs(v) * 0.01, 0.1) * f; v += dir * d; break;
      case 'cell': v += dir * (/^[abc]$/.test(c.comp) ? 5e-4 : 0.01) * f; break;
      case 'atom': v += dir * ({ occ: 0.01, B: 0.05 }[c.comp] || 1e-3) * f; break;
      case 'zero': v += dir * 2e-3 * f; break;
      case 'disp': v += dir * 1 * f; break;
      case 'transp': v += dir * 1e-4 * f; break;
      case 'po': v += dir * 0.01 * f; break;
      default: v += dir * Math.max(0.02 * Math.abs(v), 0.01) * f;
    }
    editing = null;
    changeValue(n, clampVal(n, +v.toPrecision(12)), true);
  }
  function groupRows(gkey) {
    var g = (shownGroups || []).filter(function (x) { return x.key === gkey; })[0];
    return g ? g.rows.filter(function (r) { return !r.dep; }).map(function (r) { return r.name; }) : [];
  }
  function bindParams() {
    var host = $('#param-list');
    host.addEventListener('focusin', function (e) { if (e.target.classList.contains('pv')) { editing = e.target.closest('.prow').getAttribute('data-name'); RV.bus.emit('paramFocus',{name:editing,dsId:editorDataset().id}); } });
    host.addEventListener('focusout', function (e) { if (e.target.classList.contains('pv')) { commitInput(e.target); editing = null; renderValues(); RV.bus.emit('paramFocus',null); } });
    host.addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('pv')) return;
      var n = e.target.closest('.prow').getAttribute('data-name');
      if (e.key === 'Enter') { e.preventDefault(); commitInput(e.target); e.target.select(); }
      else if (e.key === 'Escape') { editing = null; renderValues(); e.target.blur(); }
      else if (!e.target.readOnly && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); step(n, e.key === 'ArrowUp' ? 1 : -1, e); editing = n; }
    });
    host.addEventListener('wheel', function (e) {
      // Hovering a row must scroll the panel. Only the focused value input
      // accepts wheel edits, and only while the pointer is over that input.
      var input = e.target.closest('.pv');
      if (!input || document.activeElement !== input || input.disabled || input.readOnly || S.busy || !e.deltaY) return;
      var row = input.closest('.prow'), n = row && row.getAttribute('data-name');
      if (!row || row.classList.contains('dep') || editing !== n || !editorDataset()) return;
      e.preventDefault();
      commitInput(input);
      step(n, e.deltaY < 0 ? 1 : -1, e);
      editing = null; renderValues(); editing = n;
    }, { passive: false });
    host.addEventListener('click', function (e) {
      var tog = e.target.closest('.pg-tog');
      if (tog) {
        var gk = tog.closest('.pgroup').getAttribute('data-group'), rows = tog.closest('.pgroup').nextElementSibling, open = rows.hidden;
        rows.hidden = !open; tog.setAttribute('aria-expanded', String(open));
        if (open) delete collapsed[gk]; else collapsed[gk] = 1;
        St.store('collapsed', collapsed);
        return;
      }
      var pl = e.target.closest('.pl');
      if (!pl || pl.disabled || S.busy) return;
      var n = pl.closest('.prow').getAttribute('data-name');
      if (!St.shareable(n)) return;
      var sh = !St.isShared(n);
      St.setShared(n, sh);
      var so = St.shareOf(n, St.selected());
      ui.toast(n + (sh ? ' shared: one value for all the datasets of the global fit that hold it' + (so.alone.length && so.shared.length ? ', but ' + dsNames(so.alone) + ' (own value; Sharing… to change).' : '.') : ' local: one value per dataset in the global fit.'), 'info');
    });
    // right-click on a padlock: the datasets that share the parameter
    host.addEventListener('contextmenu', function (e) {
      var pl = e.target.closest('.pl');
      if (!pl || pl.hidden) return;
      var n = pl.closest('.prow').getAttribute('data-name');
      if (!St.shareable(n)) return;
      e.preventDefault();
      RV.cmd.sharing(n);
    });
    host.addEventListener('change', function (e) {
      if(e.target.hasAttribute('data-instrument-profile')){RV.cmd.setInstrumentProfile(St.byId(+e.target.dataset.datasetId),e.target.value);return;}
      if(e.target.classList.contains('pv')){commitInput(e.target);return;}
      var ds = editorDataset(), on;
      if (e.target.classList.contains('pg-fit')) {
        var names = groupRows(e.target.closest('.pgroup').getAttribute('data-group'));
        if (S.busy) { renderValues(); return; }
        var eligible=new Set(Array.from(host.querySelectorAll('.pf')).filter(function(p){return !p.disabled;}).map(function(p){return p.closest('.prow').getAttribute('data-name');}));
        names=names.filter(function(n){return eligible.has(n);});if(!ds || !names.length)return;
        on = e.target.checked; e.target.indeterminate = false;
        RV.history.take('fit flags');
        names.forEach(function (n) { St.setFit(n, on,[ds]); });
        ui.toast(names.length + ' parameters ' + (on ? 'will be refined.' : 'held fixed.'), 'info');
        return;
      }
      if (!e.target.classList.contains('pf')) return;
      var n = e.target.closest('.prow').getAttribute('data-name');
      if (S.busy) { e.target.checked = !!(ds && ds.fit[n]); ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
      on = e.target.checked;
      e.target.indeterminate = false;
      if (!ds || !!ds.fit[n] === on) return;
      RV.history.take('fit flag ' + n);
      St.setFit(n, on,[ds]);
      ui.toast(n + (on ? ' will be refined.' : ' held fixed.'), 'info');
    });
  }
  function initParams() {
    bindParams();
    $('#param-prev').addEventListener('click', function () { stepDataset(-1); });
    $('#param-next').addEventListener('click', function () { stepDataset(1); });
    $('#clone-all').addEventListener('click', function () { RV.cmd.cloneTo(true); });
    $('#clone-sel').addEventListener('click', function () { RV.cmd.cloneTo(false); });
    ['selection', 'datasetFocus', 'datasets', 'phases', 'phaseStyle', 'data', 'calculation'].forEach(function (ev) { RV.bus.on(ev, renderParams); });
    ['params', 'stats', 'fitmode', 'shared', 'absorption', 'composition', 'calculation'].forEach(function (ev) { RV.bus.on(ev, renderValues); });
    RV.bus.on('tables', renderStats);
    RV.bus.on('busy', function (b) {
      if (b && editing) { var a = document.activeElement; if (a && a.blur) a.blur(); }
      renderParams();
    });
    renderParams();
  }

  // ================================================================ Solve
  // What a fit of ds refines, grouped so it reads at a glance: [label, items] rows.
  function fitGroups(ds) {
    var names = St.fitNames(ds), phaseName = {}, rows = [], index = {};
    S.phases.forEach(function (p) { phaseName[p.key] = p.name; });
    function add(label, item) { if (!(label in index)) { index[label] = rows.length; rows.push([label, []]); } if (item && rows[index[label]][1].indexOf(item) < 0) rows[index[label]][1].push(item); }
    names.forEach(function (n) {
      var c = C.classify(n), ph = c.phase ? (phaseName[c.phase] || c.phase) : '';
      switch (c.kind) {
        case 'scale': add('Scale', ph); break;
        case 'bkg': add('Background', 'Chebyshev ' + c.index); break;
        case 'bga': add('Background', 'anchor ' + (c.index + 1)); break;
        case 'zero': add('Zero / geometry', 'zero'); break;
        case 'disp': add('Zero / geometry', 'displacement'); break;
        case 'transp': add('Zero / geometry', 'transparency'); break;
        case 'cell': add(ph + ' · cell', c.comp); break;
        case 'po': add(ph + ' · preferred orientation', ''); break;
        case 'profile': add(ph + ' · sample profile', c.comp); break;
        case 'instrument': add('Resolution', c.comp); break;
        case 'atom': add(ph + ' · ' + (c.comp === 'B' ? 'B' : c.comp === 'occ' ? 'occupancy' : 'position'), c.comp === 'B' || c.comp === 'occ' ? c.atom : c.atom + ' ' + c.comp); break;
        default: add('Other', n);
      }
    });
    S.phases.forEach(function (p) {
      if (p.method === 'wppf' && St.hasPhase(ds, p) && S.disabledPhases.indexOf(p.key) < 0) add(p.name + ' · intensities', 'every reflection (WPPF)');
      else if (p.method === 'lebail' && St.hasPhase(ds, p) && S.disabledPhases.indexOf(p.key) < 0 && names.length) add(p.name + ' · intensities', 'partitioned again each Le Bail cycle');
    });
    // "position: Fe1 x, Fe1 z, C1 x" reads better as "Fe1 (x, z), C1 (x)"
    rows.forEach(function (r) {
      if (!/· position$/.test(r[0])) return;
      var by = {}, order = [];
      r[1].forEach(function (it) { var m = /^(.*) ([xyz])$/.exec(it); if (!m) return; if (!by[m[1]]) { by[m[1]] = []; order.push(m[1]); } by[m[1]].push(m[2]); });
      r[1] = order.map(function (a) { return a + ' (' + by[a].join(', ') + ')'; });
    });
    return { count: names.length, rows: rows };
  }
  function fitListHTML(ds, g, n) {
    var fg = fitGroups(ds);
    if (!fg.rows.length) return '<br>Nothing ticked in ' + esc(ds.name) + '.';
    return '<br>' + (fg.count ? plural(fg.count, 'parameter') + ' ticked' : 'No parameter ticked') + (g && n > 1 ? ' in ' + esc(ds.name) + ' (used for all that hold them)' : n > 1 ? ' in ' + esc(ds.name) + ' (each selected dataset uses its own ticks)' : '') + '; the fit refines:' +
      '<ul class="fit-list">' + fg.rows.map(function (r) { return '<li><b>' + esc(r[0]) + '</b>' + (r[1].length ? ': ' + esc(r[1].join(', ')) : '') + '</li>'; }).join('') + '</ul>';
  }
  function syncFitTarget() {
    var n = S.sel.size, g = fitMode() === 'global', f = g ? St.selected()[0] : St.first(), why = n && !S.busy ? RV.cmd.why('fit') : '';
    $('#fit-target').innerHTML = !S.datasets.length ? 'No datasets yet.' :
      (n ? '<b>' + n + '</b> of ' + S.datasets.length + ' datasets selected' + (n === 1 && f ? ': ' + esc(f.name) : '') : 'No dataset selected. Choose some in Datasets.') +
      '<br>' + (S.phases.length ? plural(S.phases.length, 'phase') + ': ' + S.phases.map(function (p) {
        var k = St.selected().filter(function (d) { return St.hasPhase(d, p); }).length;
        return '<b>' + esc(p.name) + '</b> <span class="mtag">' + esc(C.METHOD_LABELS[p.method]) + (n > 1 && k < n ? ', in ' + k + ' of ' + n : n === 1 && !k ? ', not in it' : '') + '</span>';
      }).join(', ') : 'No phase yet: read a structure CIF or make a new phase.') +
      (f ? fitListHTML(f, g, n) : '') +
      (why ? '<br><span class="why-not">' + esc(why) + '</span>' : '');
  }
  function syncFitMode() {
    var canGlobal = S.sel.size >= 2;
    // with one dataset there is no choice to make: the selector, its separator and its explanation are hidden
    ['#fit-mode-lbl', '#fit-mode', '#fit-mode-sep', '#fit-mode-hint'].forEach(function (id) { var el = $(id); if (el) el.hidden = !canGlobal; });
    // Selection controls whether a global fit is available; rendering must
    // not overwrite the saved method preference while a project is loading.
    var g = canGlobal && fitMode() === 'global';
    document.querySelectorAll('[data-fitmode]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.getAttribute('data-fitmode') === 'global') === g)); ui.able(b,S.busy ? 'Calculation running.' : b.getAttribute('data-fitmode') === 'global' && !canGlobal ? 'Select at least two datasets for a global fit.' : ''); });
    var button = $('#btn-fit');
    button.dataset.tip = 'Fit selected datasets';
    ui.able(button, S.busy ? 'Calculation running.' : RV.cmd.why('fit'));
    $('#fit-mode-hint').textContent = g ? 'One refinement of all selected datasets. A parameter with a closed padlock below gets one value for the selected datasets that hold its phase, but those Sharing… keeps apart; the others one value per dataset. The ticks of the topmost selected dataset that holds each phase are used.'
                                        : 'Each selected dataset is refined on its own, in parallel.';
  }
  // read-only here: edited in Settings
  function syncFitFields() {
    var it = $('#fit-max-iter'), tol = $('#fit-tol');
    if (it) it.textContent = String(S.settings.maxIter);
    if (tol) tol.textContent = String(S.settings.tol);
  }
  function syncFitGroups() {
    var rietveld = S.calculation === 'rietveld';
    document.querySelectorAll('[data-rietveld-only]').forEach(function (el) { el.hidden = !rietveld; });
    $('#fit-background-label').textContent = rietveld ? 'Background / scales' : 'Background';
    document.querySelectorAll('[data-fit-group]').forEach(function (el) {
      var state = RV.cmd.fitGroupState(el.dataset.fitGroup,[editorDataset()].filter(Boolean));
      el.checked = state.checked; el.indeterminate = state.mixed;
      el.disabled = S.busy || !state.total;
      el.title = state.total ? state.ticked + ' of ' + state.total + ' eligible parameters ticked' : 'No eligible parameters in the selected datasets';
    });
  }
  function syncAlgorithm() {
    var a = $('#fit-algorithm');
    a.textContent = S.settings.algorithm === 'pt' ? 'PT + LM finish' : 'LM';
    a.parentNode.title = S.settings.algorithm === 'pt' ? 'Parallel tempering (' + S.settings.ptChains + ' replicas, ' + S.settings.ptSweeps + ' sweeps), WebGPU when available, then double-precision Levenberg–Marquardt' : 'Levenberg–Marquardt';
  }
  function initFit() {
    document.querySelectorAll('[data-fitmode]').forEach(function (b) {
      b.addEventListener('click', function () { if (S.busy || (b.getAttribute('data-fitmode') === 'global' && S.sel.size < 2)) return; St.store('fitmode', b.getAttribute('data-fitmode')); syncFitMode(); syncFitTarget(); RV.cmd.syncButtons(); RV.bus.emit('fitmode'); });
    });
    document.querySelectorAll('[data-fit-group]').forEach(function (el) { el.addEventListener('change', function () { RV.cmd.setFitGroup(el.dataset.fitGroup, el.checked,[editorDataset()].filter(Boolean)); }); });
    ['calculation','selection','datasetFocus','datasets','params','phases','busy'].forEach(function (ev) { RV.bus.on(ev, syncFitGroups); });
    RV.bus.on('settings', syncAlgorithm);
    ['selection','datasets','calculation','busy','fitmode'].forEach(function(ev){RV.bus.on(ev,syncFitMode);});
    $('#fit-sharing').addEventListener('click', function () { RV.cmd.sharing(); });
    ['calculation', 'selection', 'datasets', 'params', 'phases', 'busy', 'fitmode'].forEach(function (ev) { RV.bus.on(ev, syncFitTarget); });
    RV.bus.on('settings', syncFitFields);
    syncFitMode(); syncFitTarget(); syncFitFields(); syncFitGroups(); syncAlgorithm();
  }

  // ================================================================ Settings tab
  var FIELDS = [
    {legend:'History storage',fields:[{key:'historyMB',label:'Automatic history budget /MB',type:'num',hint:'Oldest unkept calculations are removed when this budget is exceeded. Kept records are preserved.'},{key:'historyCount',label:'Recent unkept calculations per method',type:'int',hint:'Charge-flipping and Wyckoff results have their own quota of the same size. Observation arrays are stored once. History retains complete global sets and grouped individual batches.'}]},
    { legend: 'Numerical conditions', fields: [
      { key: 'algorithm', label: 'Algorithm', type: 'select', options: [['lm', 'LM · Levenberg–Marquardt'], ['pt', 'PT · parallel tempering + LM finish']], hint: 'PT uses WebGPU when available, with automatic CPU fallback. LM then converges in double precision and estimates uncertainties. Results record which PT backend ran.' },
      { key: 'ptSweeps', label: 'PT sweeps', type: 'int', pt: true, hint: '10 to 100000 sweeps; a sweep is one proposal per refined variable per replica, so its cost grows with the number of ticked parameters.' },
      { key: 'ptChains', label: 'PT replicas', type: 'int', pt: true, hint: '2 to 16 replicas within each fit worker.' },
      { key: 'ptMaxTemp', label: 'PT highest temperature', type: 'num', pt: true, hint: 'Geometric temperature ladder from 1 to this value (greater than 1).' },
      { key: 'ptSeed', label: 'PT random seed', type: 'int', pt: true, hint: 'Repeat proposals with the same seed, backend and starting values. CPU and GPU searches use different random streams; floating-point behavior can vary between GPUs.' },
      { key: 'maxIter', label: 'Maximum iterations', type: 'int', hint: 'LM iterations per stage, 1 to 10000. PT sweeps are additional.' },
      { key: 'tol', label: 'Stop when χ² changes less than', type: 'num', hint: 'Relative change, twice in a row.' },
      { key: 'weight', label: 'Weight of each point', type: 'select', options: [['poisson', 'File weights or 1/σ² (counts if no σ supplied)'], ['unit', '1 (no weighting)']] }] },
    { legend: 'Background', fields: [
      { key: 'bkgN', label: 'Chebyshev terms of new datasets', type: 'int', hint: 'Polynomials over the fitted range, 0 to 24; per dataset in Background (Datasets panel).' },
      { key: 'nAnchors', label: 'Spline anchors placed', type: 'int', hint: 'How many anchors Place automatically puts, 2 to 200.' }] },
    { legend: 'Plots', fields: [
      { key: 'maxPlots', label: 'Datasets drawn at most', type: 'int', hint: 'Larger selections are thinned out evenly for drawing; fits use all of them. Legend names are evenly sampled, up to 8 including first and last.' }] }
  ];
  function renderSettings() {
    $('#settings-form').innerHTML = FIELDS.map(function (g) {
      return '<fieldset><legend>' + g.legend + '</legend><div class="form-grid">' + g.fields.map(function (f) {
        var id = 'set_' + f.key, v = S.settings[f.key], ctl;
        if (f.type === 'select') ctl = '<select id="' + id + '" data-set="' + f.key + '">' + f.options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
        else ctl = '<input id="' + id + '" data-set="' + f.key + '" value="' + esc(v) + '" inputmode="decimal" spellcheck="false" autocomplete="off">';
        var visibility = f.pt ? ' data-pt-setting' : '';
        var tip = f.hint ? ' title="' + esc(f.hint) + '"' : '';
        ctl = ctl.replace(/^<(select|input) /, '<$1' + tip + ' ');
        return '<label for="' + id + '"' + visibility + tip + '>' + esc(f.label) + '</label><div' + visibility + tip + '>' + ctl + '</div>';
      }).join('') + '</div></fieldset>';
    }).join('');
  }
  function syncSettings() {
    document.querySelectorAll('[data-pt-setting]').forEach(function (el) { el.hidden = S.settings.algorithm !== 'pt'; });
    document.querySelectorAll('[data-set]').forEach(function (el) {
      var v = S.settings[el.getAttribute('data-set')];
      if (document.activeElement !== el) { el.value = v; el.classList.remove('invalid'); }
    });
  }
  function onSetting(e) {
    var el = e.target, k = el.getAttribute('data-set');
    if (!k) return;
    var f = null;
    FIELDS.forEach(function (g) { g.fields.forEach(function (x) { if (x.key === k) f = x; }); });
    var v = f.type === 'select' ? el.value : ui.parseNum(el.value);
    if (f.type === 'int') v = Number.isInteger(v) ? v : NaN;
    if (!St.setSetting(k, v)) { el.classList.add('invalid'); ui.toast(f.label + ': value not accepted.', 'warn'); return; }
    el.classList.remove('invalid');
    if (k === 'weight') { St.invalidateAll(); RV.bus.emit('data'); }
  }
  function renderLimits() {
    var host = $('#limits'), ds = editorDataset();
    if (!ds) { host.innerHTML = '<p class="hint">No dataset yet.</p>'; return; }
    var names = St.namesFor(ds).filter(St.isVariable);
    host.innerHTML = '<table class="grid compact limits-table"><colgroup><col style="width:26%"><col style="width:22%"><col style="width:16%"><col style="width:16%"><col style="width:11%"><col style="width:9%"></colgroup><thead><tr><th>Parameter</th><th title="Value in ' + esc(ds.name) + '">Value</th><th>Min</th><th>Max</th>' +
      '<th title="Global fit: one value for all datasets (ticked) or one value per dataset">Shared</th><th></th></tr></thead><tbody>' +
      names.map(function (n) {
        var L = St.limitsOf(n, ds.p[n]), own = !!S.limits[n], can = St.shareable(n);
        return '<tr data-name="' + esc(n) + '"><td><code>' + esc(n) + (St.isSizeParam(n) ? ' (nm)' : '') + '</code></td><td>' + fmtParam(n,ds.p[n]) + '</td>' +
          '<td><input data-lim="0" value="' + fmtVal(St.toDisplay(n,L[0])) + '" inputmode="decimal"></td><td><input data-lim="1" value="' + fmtVal(St.toDisplay(n,L[1])) + '" inputmode="decimal"></td>' +
          '<td>' + (can ? '<input type="checkbox" data-shared' + (St.isShared(n) ? ' checked' : '') + '>' : '<small title="Always one value per dataset">—</small>') + '</td>' +
          '<td>' + (own ? '<button type="button" class="link" data-lim-reset>default</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function onLimit(e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    var n = tr.getAttribute('data-name'), ds = St.first() || S.datasets[0];
    if (e.target.hasAttribute('data-shared')) { St.setShared(n, e.target.checked); return; }
    var w = e.target.getAttribute('data-lim');
    if (w == null) return;
    var L = St.limitsOf(n, ds && ds.p[n]), raw = e.target.value.trim().toLowerCase(), v = /^-?inf/.test(raw) ? (raw.charAt(0) === '-' ? -Infinity : Infinity) : ui.parseNum(raw);
    if (St.isSizeParam(n) && Number.isFinite(v) && !Number.isInteger(v)) { ui.toast('Size limits use whole nanometres.', 'warn'); renderLimits(); return; }
    v = St.fromDisplay(n,v);
    L[+w] = v;
    if (!(L[0] < L[1]) || isNaN(v)) { e.target.classList.add('invalid'); ui.toast('Limits of ' + n + ': min must be below max (inf for none).', 'warn'); return; }
    e.target.classList.remove('invalid');
    St.setLimit(n, L[0], L[1]);
    ui.toast('Limits of ' + n + ': ' + ui.fmt(St.toDisplay(n,L[0]), 6) + ' to ' + ui.fmt(St.toDisplay(n,L[1]), 6) + (St.isSizeParam(n) ? ' nm' : '') + '.', 'info');
    renderLimits();
  }
  function initSettings() {
    renderSettings(); syncSettings();
    document.addEventListener('change', function(e){if(e.target.hasAttribute('data-set'))onSetting(e);});
    $('#limits').addEventListener('change', onLimit);
    $('#limits').addEventListener('click', function (e) {
      if (!e.target.closest('[data-lim-reset]')) return;
      var n = e.target.closest('tr').getAttribute('data-name');
      St.clearLimit(n); renderLimits();
      ui.toast('Limits of ' + n + ' back to the default.', 'info');
    });
    $('#set-reset').addEventListener('click', function () {
      ui.confirm('Reset the refinement, data and plot settings to their original values? Limits and shared flags are kept.', 'Reset settings').then(function (ok) { if (ok) { St.resetSettings(); ui.toast('Settings reset.', 'info'); } });
    });
    $('#lim-reset').addEventListener('click', function () {
      S.limits = {}; S.shared = {}; renderLimits(); RV.bus.emit('shared', {});
      ui.toast('All limits and shared flags back to their defaults.', 'info');
    });
    RV.bus.on('settings', syncSettings);
    ['selection', 'datasetFocus', 'datasets', 'phases', 'shared', 'data'].forEach(function (ev) { RV.bus.on(ev, function () { if (RV.app && RV.app.commandTab() === 'datasets') renderLimits(); }); });
    RV.bus.on('tab', function (t) { if (t === 'datasets') renderLimits(); });
  }

  function init() { initDatasets(); initPhases(); initParams(); initFit(); initSettings(); }
  return { init: init, fmtVal: fmtVal, fmtEsd: fmtEsd, syncFitMode: syncFitMode, renderLimits: renderLimits,groupsFor:groupsFor };
})();
