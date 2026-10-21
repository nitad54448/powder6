/* Dataset and phase navigation, numerical calculation parameters, Solve setup and Settings. */
RV.panels = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui, esc = ui.esc, C = RVCore, editing = null, dsList = null, phList = null, dragId = null, cursor = null;
  function $(s) { return document.querySelector(s); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function fitMode() { return RV.app && RV.app.fitMode ? RV.app.fitMode() : 'single'; }

  // ================================================================ Datasets
  function dsRow(d) {
    var on = S.sel.has(d.id);
    return '<div class="ds'+(on?' on':'')+'" data-id="'+d.id+'" draggable="true" role="option" aria-selected="'+on+'"><span class="nm" title="'+esc(d.name)+'">'+esc(d.name)+'</span></div>';
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
    });
    countDatasets(); renderInfo();
  }
  function renderInfo() {
    var host = $('#ds-info'), d = St.first(), why = S.busy ? 'Not while a fit is running.' : !S.datasets.length ? 'No data loaded yet.' : !S.sel.size ? 'No dataset selected.' : '';
    ['#ds-inst', '#ds-bkg', '#ds-excl', '#ds-resolution'].forEach(function (b) { ui.able($(b), why); });
    ui.able($('#ds-phases'), S.busy ? 'Not while a fit is running.' : !S.phases.length ? 'No phase yet. Read a structure CIF (File) or make a new phase (Refine).' : !S.datasets.length ? 'No data loaded yet.' : '');
    if (!d) { host.innerHTML = ''; return; }
    var i = d.inst, pol = i.radiation === 'neutron' ? 'neutrons' : { tube: 'X-rays, no monochromator', mono: 'X-rays, monochromator at 2θ = ' + i.monoTth + '°', sync: 'synchrotron, polarised fraction ' + i.polFrac, none: 'X-rays, no polarisation correction' }[i.pol];
    var pts = St.fitPoints(d), nFit = pts.tth.length - pts.nExcluded;
    host.innerHTML = '<p class="hint">Properties of <b>'+esc(d.name)+'</b>; setup actions apply to '+S.sel.size+' selected dataset(s).</p><dl><dt>λ</dt><dd>' + i.lambda1 + (i.ratio > 0 && i.lambda2 > 0 ? ' and ' + i.lambda2 + ' Å, ratio ' + i.ratio : ' Å') + (i.anode && St.ANODES[i.anode] && Math.abs(St.ANODES[i.anode][0] - i.lambda1) < 1e-6 ? ' (' + i.anode + ')' : '') + '</dd>' +
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
      if (e.shiftKey) St.range(id); else if (e.ctrlKey || e.metaKey) St.toggle(id); else St.selectIds([id]);
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
    $('#ds-excl').addEventListener('click', function () { RV.cmd.excludeRegions(); });
    RV.bus.on('datasets', renderDatasets);
    RV.bus.on('selection', updateSel);
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
      return '<div class="ds ph' + (cur === ph ? ' on' : '') + '" data-key="' + ph.key + '" role="option" aria-selected="' + (cur === ph) + '"><i class="sw" style="--dataset-color:' + RV.plots.phaseVar(i) + '"></i><span class="nm">' + esc(ph.name) + '</span><small>' + esc(ph.sg.symbol) + ' · ' + ph.atoms.length + ' atoms</small></div>';
    }).join('') || '<p class="hint">Create or import a phase in the Phases tab.</p>';
  }
  function initPhases() {
    phList = $('#ph-list');
    phList.addEventListener('click', function (e) { if (e.target.closest('select, input')) return; var row = e.target.closest('.ph'); if (row) St.selectPhase(row.getAttribute('data-key')); });
    phList.addEventListener('dblclick', function (e) { if (e.target.closest('select, input')) return; var row = e.target.closest('.ph'); if (row) { St.selectPhase(row.getAttribute('data-key')); RV.app.showTab('phases'); } });
    phList.addEventListener('keydown', function (e) {
      if (e.target.closest('select, input')) return;
      var i = S.phases.indexOf(St.currentPhase());
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.phases.length) { e.preventDefault(); St.selectPhase(S.phases[Math.max(0, Math.min(S.phases.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].key); }
      else if (e.key === 'Enter') { e.preventDefault(); RV.app.showTab('phases'); }
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
                          { name: 'transp', label: 'transp.', unit: '', tip: 'Sample transparency: Δ2θ = transp. sin 2θ, in radians' }];
    var resolution = St.instrumentParamsFor(ds).filter(function (p) { return Object.prototype.hasOwnProperty.call(ds.p, 'inst.' + p[0]); }).map(function (p) {
      return { name: 'inst.' + p[0], label: p[0], unit: /^(U|V|W)(_[LR])?$/.test(p[0]) ? 'cdeg²' : /^(X|Y|Z)(_[LR])?$/.test(p[0]) ? 'cdeg' : '', tip: 'Instrument resolution shared by all separated-profile phases of this dataset. ' + ({U:'Gaussian tan²θ coefficient',V:'Gaussian tanθ coefficient',W:'Gaussian constant variance',Z:'Lorentzian constant width',X:'Lorentzian /cosθ coefficient',Y:'Lorentzian tanθ coefficient',SL:'Axial asymmetry coefficient /tanθ',HL:'Constant axial asymmetry coefficient'}[p[0]] || (/^eta/.test(p[0]) ? 'Independent pseudo-Voigt mixing fraction' : 'Left/right instrument width coefficient')) };
    });
    if (resolution.length) out.push({ key: 'resolution', title: 'Instrument resolution', sub: ds.name + ' · all phases', rows: resolution });
    out.push({ key: 'acquisition', title: 'Acquisition', sub: ds.name + ' · zero point', rows: [rows[0]] });
    out.push({ key: 'sample', title: 'Sample geometry', sub: ds.name + ' · displacement, transparency', rows: rows.slice(1) });
    rows = [];
    if (ds.inst.bkgType === 'spline') ds.inst.bkgX.forEach(function (x, k) { rows.push({ name: 'bga' + k, label: 'bkg ' + (+x.toFixed(2)) + '°', unit: '', tip: 'Background at the anchor 2θ = ' + x + '° (spline through ' + ds.inst.bkgX.length + ' anchors)' }); });
    else for (var k = 0; k < ds.inst.bkgN; k++) rows.push({ name: 'bkg' + k, label: 'bkg ' + k, unit: '', tip: 'Background, coefficient of the Chebyshev polynomial T' + k + ' over the fitted range' });
    out.push({ key: 'ds', title: 'Background', sub: ds.name, rows: rows });
    S.phases.forEach(function (ph, pi) {
      if (!St.hasPhase(ds, ph)) return;
      var kk = ph.key + '.', col = RV.plots.phaseVar(pi), rv = ph.method === 'rietveld';
      var main = rv ? [{ name: kk + 'scale', label: 'scale', unit: '', tip: 'Scale factor of ' + ph.name + ' in this dataset' }] : [];
      C.cellParams(ph.sg.system, ph.sg.uniqueAxis).forEach(function (c) { main.push({ name: kk + c, label: CELL_LABEL[c], unit: /^[abc]$/.test(c) ? 'Å' : '°', tip: 'Cell ' + CELL_LABEL[c] + ' of ' + ph.name }); });
      if (rv) main.push({ name: kk + 'po', label: 'PO r', unit: '', tip: 'March–Dollase r along (' + ph.poDir.join(' ') + '); 1 is no preferred orientation' });
      out.push({ key: ph.key, title: ph.name, sub: rv ? 'scale, cell, orientation' : 'cell (' + C.METHOD_LABELS[ph.method] + ': the intensities come from the pattern)', color: col, rows: main });
      out.push({ key: ph.key + ':prof', title: ph.name, sub: (C.usesSeparatedProfile(ph) ? 'Sample size / microstrain · ' : 'Legacy effective profile · ') + (C.PROFILE_LABELS[ph.profileType] || 'peak shape').toLowerCase(), color: col,
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
    var host = $('#param-list'), ds = St.first(), more = S.sel.size > 1 ? S.sel.size - 1 : 0, head = $('#param-ds');
    head.textContent = ds ? ds.name : '';
    $('#param-more').textContent = ds && more ? 'and ' + more + ' more' : '';
    head.title = !ds ? '' : more ? ds.name + ' (' + (St.selected().indexOf(ds) + 1) + ' of ' + S.sel.size + ' selected; ← → show the others). Changes apply to all ' + S.sel.size + ' selected datasets.' : ds.name;
    syncStep();
    if (!ds) {
      shownGroups = null;
      host.innerHTML = '<p class="hint">' + (S.datasets.length ? 'Select a dataset to see and edit its parameters.' : 'Read a powder pattern first: each dataset holds its own values of the parameters of its phases.') + '</p>';
      renderStats(); return;
    }
    var groups = groupsFor(ds), dis = S.busy ? ' disabled' : '';
    shownGroups = groups;
    host.innerHTML = groups.map(function (g) {
      var closed = !!collapsed[g.key];
      return '<div class="pgroup" data-group="' + esc(g.key) + '"><button type="button" class="pg-tog" aria-expanded="' + !closed + '">' +
        (g.color ? '<i class="sw" style="background:' + g.color + '"></i>' : '') + '<span class="pg-t">' + esc(g.title) + '</span><span class="pg-s" title="' + esc(g.sub) + '">' + esc(g.sub) + '</span></button>' +
        '<input type="checkbox" class="pg-fit"' + dis + ' aria-label="Fit all of ' + esc(g.title + ', ' + g.sub) + '"></div>' +
        '<div class="pg-rows"' + (closed ? ' hidden' : '') + '>' + g.rows.map(function (p) {
          return '<div class="prow' + (p.dep ? ' dep' : '') + '" data-name="' + esc(p.name) + '"><span class="pn" title="' + esc(p.tip) + '">' + esc(p.label) + '</span>' +
            '<input class="pv" aria-label="' + esc(p.name) + '" spellcheck="false" autocomplete="off"' + (p.dep ? ' disabled' : dis) + '>' +
            '<span class="pu" title="' + esc(p.unit) + '">' + esc(p.unit) + '</span><span class="ps"></span>' +
            (p.dep ? '<span class="pl" hidden></span><span class="pf-none"></span>' : '<button type="button" class="pl" aria-label="Shared or local ' + esc(p.name) + '"></button><input class="pf" type="checkbox" title="Fit ' + esc(p.name) + '" aria-label="Fit ' + esc(p.name) + '"' + dis + '>') +
            '</div>';
        }).join('') + '</div>';
    }).join('');
    renderValues();
  }
  function dsNames(list) { var t = list.slice(0, 4).map(function (d) { return d.name; }).join(', '); return list.length > 4 ? t + ' and ' + (list.length - 4) + ' more' : t; }
  function limitText(n, v) { var L = St.limitsOf(n, v); return ui.fmt(St.toDisplay(n,L[0]), 4) + ' to ' + ui.fmt(St.toDisplay(n,L[1]), 4) + (St.isSizeParam(n) ? ' nm' : ''); }
  function atLimit(n, v) { var L = St.limitsOf(n, v), e = 1e-9 * (1 + Math.abs(v)); return v <= L[0] + e || v >= L[1] - e; }
  function geometryTip(ds,n) {
    var R=ds.inst.radiusMM, v=ds.p[n];
    if(n==='disp')return 'Sample displacement: Δ2θ = −(displ./1000) cos θ in radians. '+(R>0 ? 'Bragg–Brentano height h = '+ui.fmt(v*R/2000,6)+' mm; radius R = '+R+' mm.' : 'Set the goniometer radius in Datasets → Instrument to obtain height in mm.');
    if(n==='transp' && RV.absorption)return RV.absorption.tip(ds);
    if(n==='transp')return 'Transparency: Δ2θ = transp. sin 2θ in radians. '+(R>0 && v>0 ? 'Thick flat Bragg–Brentano specimen approximation: µeff = 1/(2 R transp.) = '+ui.fmt(1/(2*R*v),6)+' mm⁻¹; absorption length '+ui.fmt(2*R*v,6)+' mm. Not a composition-derived absorption coefficient.' : 'Effective absorption requires a positive transparency coefficient and the goniometer radius (Datasets → Instrument), assuming a thick flat Bragg–Brentano specimen.');
    return null;
  }
  function renderValues() {
    var ds = St.first(), list = St.selected(), g = fitMode() === 'global', host = $('#param-list');
    if (!ds || !shownGroups) { renderStats(); return; }
    host.classList.toggle('global', g);
    // GSAS-II atomic constraints (Rietveld only): held, independent, dependent and equation terms are marked
    var acRoles = {};
    if (S.calculation === 'rietveld' && typeof AtomicConstraints !== 'undefined') S.phases.forEach(function (ph) {
      if (ph.method === 'rietveld' && ph.constraints && ph.constraints.length && St.hasPhase(ds, ph)) { try { Object.assign(acRoles, AtomicConstraints.roles(ph, ds.fit)); } catch (e) { /* shown by the editor */ } }
    });
    host.querySelectorAll('.prow').forEach(function (row) {
      var n = row.getAttribute('data-name'), v = ds.p[n], inp = row.querySelector('.pv');
      var ar = acRoles[n], pn = row.querySelector('.pn');
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
      pf.disabled = !!S.busy || !!(ar && ar.ignore);
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
      else if(ds.stats && ds.stats.uncertaintyIssues && ds.stats.uncertaintyIssues[n]) {se.textContent='unconstrained';se.title=ds.stats.uncertaintyIssues[n];se.className='ps lim';}
      else if (ds.stats && fit && atLimit(n, v)) { se.textContent = 'limit'; se.title = 'At its limit (' + limitText(n, v) + ', Settings): no uncertainty'; se.className = 'ps lim'; }
      else { se.textContent = ''; se.title = ''; se.className = 'ps'; }
    });
    host.querySelectorAll('.pgroup').forEach(function (gr) {
      var rows = gr.nextElementSibling.querySelectorAll('.prow:not(.dep)'), on = 0, tot = rows.length;
      rows.forEach(function (r) { if (ds.fit[r.getAttribute('data-name')]) on++; });
      var cb = gr.querySelector('.pg-fit');
      cb.checked = tot > 0 && on === tot; cb.indeterminate = on > 0 && on < tot;
      cb.title = on + ' of ' + tot + ' refined in ' + ds.name + '. Click to ' + (on === tot ? 'hold them all fixed.' : 'refine them all.');
    });
    renderStats();
  }
  function pct(v) { return Number.isFinite(v) ? (100 * v).toFixed(2) + ' %' : '—'; }
  function renderStats() {
    var ds = St.first(), host = $('#param-stats');
    if (!ds) { host.innerHTML = ''; return; }
    var failed=ds.stats && ds.stats.ok===false, st = failed ? null : ds.stats, live = null;
    if (!st) { var c = St.calcFor(ds); live = c && c.stats; }
    if (!st && !live) { host.innerHTML = '<p class="hint">' + (ds.calcErr ? esc(ds.calcErr) : 'No calculated pattern yet.') + '</p>'; return; }
    var s = st || live, rb = (s.phases || []).map(function (p, i) { var ph = S.phases[i]; return ph && ph.method === 'rietveld' && St.hasPhase(ds, ph) ? '<dt title="Integrated reflection intensity residual; affected by peak overlap and the current model">R<sub>Bragg</sub> ' + esc(ph.name) + '</dt><dd>' + pct(p.RBragg) + '</dd>' : ''; }).join('');
    var msg = st ? st.msg || '' : '', short = /^converged/.test(msg) ? 'converged' : msg;
    host.innerHTML = (failed ? '<p class="hint">Last fit failed: '+esc(ds.stats.msg || '')+'.</p>' : '') + (st ? '' : '<p class="hint">Not fitted: agreement of the current values.</p>') +
      '<dl><dt>R<sub>wp</sub></dt><dd>' + pct(s.Rwp) + '</dd><dt>R<sub>exp</sub></dt><dd>' + pct(s.Rexp) + '</dd><dt>R<sub>p</sub></dt><dd>' + pct(s.Rp) + '</dd>' +
      '<dt>χ²</dt><dd>' + (st ? ui.fmt(st.chi2red, 5) : ui.fmt(s.gof, 5)) + '</dd>' + rb +
      (st ? '<dt>Fit</dt><dd title="' + esc(msg) + '">' + (st.global ? 'global (' + st.nSets + '), ' : '') + st.iter + ' it, ' + esc(short) +
            (short === 'converged' ? ' <span class="why">(' + esc(msg.replace(/^converged: /, '')) + ')</span>' : '') + '</dd>' : '') + '</dl>';
  }
  function neighbour(dir) {
    var f = St.first();
    if (S.sel.size > 1) { var sl = St.selected(), k = (sl.indexOf(f) + dir + sl.length) % sl.length; return { ds: sl[k], k: k, n: sl.length, cycle: true }; }
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
    if (nb.cycle) { editing = null; St.setFocus(nb.ds.id); } else St.selectIds([nb.ds.id]);
  }
  function clampVal(n, v) { var L = St.limitsOf(n, v); return Math.min(L[1], Math.max(L[0], v)); }
  function changeValue(n, v, burst) {
    var list = St.selected();
    if (!list.some(function (ds) { return ds.p[n] !== v; })) return;
    var merge = burst ? 'step ' + n + ' ' + list.map(function (ds) { return ds.id; }).join(',') : null;
    RV.history.take('parameter ' + n, { merge: merge });
    if(St.setParam(n, v, list, false)===false)return;
    ui.toast(n + ' set to ' + fmtParam(n,v) + (St.isSizeParam(n) ? ' nm' : '') + (list.length > 1 ? ' in ' + list.length + ' datasets.' : '.'), 'info', merge);
  }
  function commitInput(inp) {
    var row = inp.closest('.prow'), n = row.getAttribute('data-name'), ds = St.first();
    if (!ds || row.classList.contains('dep')) return;
    if (S.busy) { inp.value = fmtParam(n,ds.p[n]); return; }
    if (inp.value === fmtParam(n,ds.p[n])) return;
    var v = ui.parseNum(inp.value);
    if (!isFinite(v)) { inp.value = fmtParam(n,ds.p[n]); ui.toast('Not a number: ' + n + ' unchanged.', 'warn'); return; }
    if (St.isSizeParam(n) && !Number.isInteger(v)) { inp.value = fmtParam(n,ds.p[n]); ui.toast('Enter crystallite size as a whole number of nanometres.', 'warn'); return; }
    v = St.fromDisplay(n,v);
    var c = clampVal(n, v);
    if (c !== v) ui.toast(n + ' kept within its limits, ' + limitText(n, v) + ' (Settings).', 'warn');
    changeValue(n, c);
  }
  // one step of the wheel or of an arrow key, by kind of parameter
  function step(n, dir, e) {
    var ds = St.first();
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
    host.addEventListener('focusin', function (e) { if (e.target.classList.contains('pv')) editing = e.target.closest('.prow').getAttribute('data-name'); });
    host.addEventListener('focusout', function (e) { if (e.target.classList.contains('pv')) { commitInput(e.target); editing = null; renderValues(); } });
    host.addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('pv')) return;
      var n = e.target.closest('.prow').getAttribute('data-name');
      if (e.key === 'Enter') { e.preventDefault(); commitInput(e.target); e.target.select(); }
      else if (e.key === 'Escape') { editing = null; renderValues(); e.target.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(n, e.key === 'ArrowUp' ? 1 : -1, e); editing = n; }
    });
    host.addEventListener('wheel', function (e) {
      // Hovering a row must scroll the panel. Only the focused value input
      // accepts wheel edits, and only while the pointer is over that input.
      var input = e.target.closest('.pv');
      if (!input || document.activeElement !== input || input.disabled || input.readOnly || S.busy || !e.deltaY) return;
      var row = input.closest('.prow'), n = row && row.getAttribute('data-name');
      if (!row || row.classList.contains('dep') || editing !== n || !St.first()) return;
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
      var ds = St.first(), on;
      if (e.target.classList.contains('pg-fit')) {
        var names = groupRows(e.target.closest('.pgroup').getAttribute('data-group'));
        if (S.busy) { renderValues(); return; }
        on = e.target.checked; e.target.indeterminate = false;
        RV.history.take('fit flags');
        names.forEach(function (n) { St.setFit(n, on); });
        ui.toast(names.length + ' parameters ' + (on ? 'will be refined.' : 'held fixed.'), 'info');
        return;
      }
      if (!e.target.classList.contains('pf')) return;
      var n = e.target.closest('.prow').getAttribute('data-name');
      if (S.busy) { e.target.checked = !!(ds && ds.fit[n]); ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
      on = e.target.checked;
      e.target.indeterminate = false;
      if (!St.selected().some(function (d) { return !!d.fit[n] !== on; })) return;
      RV.history.take('fit flag ' + n);
      St.setFit(n, on);
      ui.toast(n + (on ? ' will be refined.' : ' held fixed.'), 'info');
    });
  }
  function initParams() {
    bindParams();
    $('#param-prev').addEventListener('click', function () { stepDataset(-1); });
    $('#param-next').addEventListener('click', function () { stepDataset(1); });
    $('#clone-all').addEventListener('click', function () { RV.cmd.cloneTo(true); });
    $('#clone-sel').addEventListener('click', function () { RV.cmd.cloneTo(false); });
    ['selection', 'datasets', 'phases', 'phaseStyle', 'data'].forEach(function (ev) { RV.bus.on(ev, renderParams); });
    ['params', 'stats', 'fitmode', 'shared', 'absorption', 'composition', 'calculation'].forEach(function (ev) { RV.bus.on(ev, renderValues); });
    RV.bus.on('tables', renderStats);
    RV.bus.on('busy', function (b) {
      if (b && editing) { var a = document.activeElement; if (a && a.blur) a.blur(); }
      renderParams();
    });
    renderParams();
  }

  // ================================================================ Solve
  function syncFitTarget() {
    var n = S.sel.size, g = fitMode() === 'global', f = g ? St.selected()[0] : St.first(), why = n && !S.busy ? RV.cmd.why('fit') : '';
    var nPar = f ? St.fitNames(f).length : 0;
    $('#fit-target').innerHTML = !S.datasets.length ? 'No datasets yet.' :
      (n ? '<b>' + n + '</b> of ' + S.datasets.length + ' datasets selected' + (n === 1 && f ? ': ' + esc(f.name) : '') : 'No dataset selected. Choose some in Datasets.') +
      '<br>' + (S.phases.length ? plural(S.phases.length, 'phase') + ': ' + S.phases.map(function (p) {
        var k = St.selected().filter(function (d) { return St.hasPhase(d, p); }).length;
        return '<b>' + esc(p.name) + '</b> <span class="mtag">' + esc(C.METHOD_LABELS[p.method]) + (n > 1 && k < n ? ', in ' + k + ' of ' + n : n === 1 && !k ? ', not in it' : '') + '</span>';
      }).join(', ') : 'No phase yet: read a structure CIF or make a new phase.') +
      (f ? '<br>' + nPar + ' parameters ticked' + (g && n > 1 ? ' in ' + esc(f.name) + ' (used for all that hold them)' : '') : '') +
      (why ? '<br><span class="why-not">' + esc(why) + '</span>' : '');
  }
  function syncFitMode() {
    var canGlobal = S.sel.size >= 2;
    if (!canGlobal && St.load('fitmode') === 'global') St.store('fitmode','single');
    var g = canGlobal && fitMode() === 'global';
    document.querySelectorAll('[data-fitmode]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.getAttribute('data-fitmode') === 'global') === g)); ui.able(b,S.busy ? 'Calculation running.' : b.getAttribute('data-fitmode') === 'global' && !canGlobal ? 'Select at least two datasets for a global fit.' : ''); });
    var button = $('#btn-fit');
    button.dataset.tip = 'Open Solve to choose a calculation and refine datasets';
    ui.able(button, S.busy ? 'Calculation running.' : '');
    $('#fit-mode-hint').textContent = g ? 'One refinement of all selected datasets. A parameter with a closed padlock (Parameters) gets one value for the selected datasets that hold its phase, but those Sharing… keeps apart; the others one value per dataset. The ticks of the topmost selected dataset that holds each phase are used.'
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
      var state = RV.cmd.fitGroupState(el.dataset.fitGroup);
      el.checked = state.checked; el.indeterminate = state.mixed;
      el.disabled = S.busy || !state.total;
      el.title = state.total ? state.ticked + ' of ' + state.total + ' eligible parameters ticked' : 'No eligible parameters in the selected datasets';
    });
  }
  function syncAlgorithm() {
    var a = $('#fit-algorithm');
    a.textContent = S.settings.algorithm === 'pt' ? 'PT + LM finish' : 'LM';
    a.parentNode.title = S.settings.algorithm === 'pt' ? 'Parallel tempering (' + S.settings.ptChains + ' replicas, ' + S.settings.ptSweeps + ' sweeps), then Levenberg–Marquardt' : 'Levenberg–Marquardt';
  }
  function initFit() {
    document.querySelectorAll('[data-fitmode]').forEach(function (b) {
      b.addEventListener('click', function () { if (S.busy || (b.getAttribute('data-fitmode') === 'global' && S.sel.size < 2)) return; St.store('fitmode', b.getAttribute('data-fitmode')); syncFitMode(); syncFitTarget(); RV.cmd.syncButtons(); RV.bus.emit('fitmode'); });
    });
    document.querySelectorAll('[data-fit-group]').forEach(function (el) { el.addEventListener('change', function () { RV.cmd.setFitGroup(el.dataset.fitGroup, el.checked); }); });
    ['calculation','selection','datasets','params','phases','busy'].forEach(function (ev) { RV.bus.on(ev, syncFitGroups); });
    RV.bus.on('settings', syncAlgorithm);
    ['selection','datasets','calculation','busy','fitmode'].forEach(function(ev){RV.bus.on(ev,syncFitMode);});
    $('#fit-sharing').addEventListener('click', function () { RV.cmd.sharing(); });
    ['calculation', 'selection', 'datasets', 'params', 'phases', 'busy', 'fitmode'].forEach(function (ev) { RV.bus.on(ev, syncFitTarget); });
    RV.bus.on('settings', syncFitFields);
    syncFitMode(); syncFitTarget(); syncFitFields(); syncFitGroups(); syncAlgorithm();
  }

  // ================================================================ Settings tab
  var FIELDS = [
    { legend: 'Refinement', fields: [
      { key: 'algorithm', label: 'Algorithm', type: 'select', options: [['lm', 'LM · Levenberg–Marquardt'], ['pt', 'PT · parallel tempering + LM finish']], hint: 'PT searches across replicas at different temperatures, then LM converges locally and estimates uncertainties. PT usually costs more model evaluations.' },
      { key: 'ptSweeps', label: 'PT sweeps', type: 'int', pt: true, hint: '10 to 100000 sweeps; one proposal per replica per sweep.' },
      { key: 'ptChains', label: 'PT replicas', type: 'int', pt: true, hint: '2 to 16 replicas within each fit worker.' },
      { key: 'ptMaxTemp', label: 'PT highest temperature', type: 'num', pt: true, hint: 'Geometric temperature ladder from 1 to this value (greater than 1).' },
      { key: 'ptSeed', label: 'PT random seed', type: 'int', pt: true, hint: 'Repeat a run with the same seed and starting values for reproducible proposals.' },
      { key: 'maxIter', label: 'Maximum iterations', type: 'int', hint: 'LM iterations per stage, 1 to 10000. Also in Solve. PT sweeps are additional.' },
      { key: 'tol', label: 'Stop when χ² changes less than', type: 'num', hint: 'Relative change, twice in a row.' },
      { key: 'weight', label: 'Weight of each point', type: 'select', options: [['poisson', '1/σ², σ² = counts (or the σ read from the file)'], ['unit', '1 (no weighting)']] }] },
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
        return '<label for="' + id + '"' + visibility + '>' + esc(f.label) + '</label><div' + visibility + '>' + ctl + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
      }).join('') + '</div></fieldset>';
    }).join('');
  }
  function syncSettings() {
    document.querySelectorAll('[data-pt-setting]').forEach(function (el) { el.hidden = S.settings.algorithm !== 'pt'; });
    document.querySelectorAll('#settings-form [data-set]').forEach(function (el) {
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
    var host = $('#limits'), ds = St.first() || S.datasets[0];
    if (!ds) { host.innerHTML = '<p class="hint">No dataset yet.</p>'; return; }
    var names = St.namesFor(ds).filter(St.isVariable);
    host.innerHTML = '<table class="grid compact"><thead><tr><th>Parameter</th><th>Value in ' + esc(ds.name) + '</th><th>Min</th><th>Max</th>' +
      '<th title="Global fit: one value for all datasets (ticked) or one value per dataset">Shared in a global fit</th><th></th></tr></thead><tbody>' +
      names.map(function (n) {
        var L = St.limitsOf(n, ds.p[n]), own = !!S.limits[n], can = St.shareable(n);
        return '<tr data-name="' + esc(n) + '"><td><code>' + esc(n) + (St.isSizeParam(n) ? ' (nm)' : '') + '</code></td><td>' + fmtParam(n,ds.p[n]) + '</td>' +
          '<td><input data-lim="0" value="' + fmtVal(St.toDisplay(n,L[0])) + '" inputmode="decimal"></td><td><input data-lim="1" value="' + fmtVal(St.toDisplay(n,L[1])) + '" inputmode="decimal"></td>' +
          '<td>' + (can ? '<input type="checkbox" data-shared' + (St.isShared(n) ? ' checked' : '') + '>' : '<small>per dataset</small>') + '</td>' +
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
    $('#settings-form').addEventListener('change', onSetting);
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
    ['selection', 'datasets', 'phases', 'shared', 'data'].forEach(function (ev) { RV.bus.on(ev, function () { if (RV.app && RV.app.tab() === 'settings') renderLimits(); }); });
    RV.bus.on('tab', function (t) { if (t === 'settings') renderLimits(); });
  }

  function init() { initDatasets(); initPhases(); initParams(); initFit(); initSettings(); }
  return { init: init, fmtVal: fmtVal, fmtEsd: fmtEsd, syncFitMode: syncFitMode, renderLimits: renderLimits };
})();
