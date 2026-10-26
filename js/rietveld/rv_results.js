/*  The Results tab and the text files saved from it: agreement factors of each selected dataset, method, scale, weight
 *  fraction (Hill and Howard, Rietveld phases), R_Bragg and cell of each phase in each dataset that holds it, the atoms
 *  and the reflections of the phase being edited in the first selected dataset that holds it -- with the extracted
 *  intensities and their uncertainties for a Le Bail or WPPF phase (marginal, from the last fit; conditional on the
 *  current values before).
 *  Weight fraction of phase p:  W_p = S_p M_p V_p / sum_i S_i M_i V_i  (S the scale of rietveld_core.js, M the mass of
 *  the cell content, V the cell volume), valid when every crystalline phase of the sample is in the model.
 */
RV.results = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui, esc = ui.esc, C = RVCore, dirty = true;
  var MAX_ROWS = 500, CELL = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'], CELL_LABEL = { a: 'a', b: 'b', c: 'c', alpha: 'α', beta: 'β', gamma: 'γ' };
  function $(s) { return document.querySelector(s); }
  function pct(v) { return Number.isFinite(v) ? (100 * v).toFixed(2) : '—'; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // the statistics of a dataset: from its last fit, or computed for the current values (fitted: false)
  function statsOf(ds) {
    if (St.calculationIssue([ds])) return null;
    if (ds.stats && ds.stats.ok !== false) return Object.assign({ fitted: true }, ds.stats);
    var c = St.calcFor(ds);
    return c ? { fitted: false, fitError:ds.stats && ds.stats.ok===false ? ds.stats.msg : '', n: c.stats.n, Rp: c.stats.Rp, Rwp: c.stats.Rwp, Rexp: c.stats.Rexp, gof: c.stats.gof, phases: c.stats.phases } : null;
  }
  // A global result describes its complete fitted set, even when only one
  // member is selected. Never mix independent fits or show a stale set.
  function globalSummaries(list) {
    var seen = {}, out = [];
    list.forEach(function (d) {
      var g = d.stats && d.stats.global && d.stats.globalSummary;
      if (!g || !g.id || seen[g.id]) return;
      seen[g.id] = true;
      if (!Array.isArray(g.datasetIds) || g.datasetIds.length < 2) return;
      var members = g.datasetIds.map(St.byId);
      if (!members.every(function (m) { return m && m.stats && m.stats.globalSummary && m.stats.globalSummary.id === g.id; })) return;
      out.push({ stats:g, names:members.map(function(m){return m.name;}) });
    });
    return out;
  }
  function globalReportText(list) {
    var L = [];
    globalSummaries(list).forEach(function (item) {
      var g = item.stats;
      L.push('## Overall global fit', 'datasets (complete fitted set)\t' + item.names.join('; '),
        'points\t' + g.n + '\nrefined parameters (shared counted once)\t' + g.nVar + '\nfree intensities\t' + g.nInt + '\ndegrees of freedom\t' + g.dof,
        'Rp %\t' + pct(g.Rp) + '\nRwp %\t' + pct(g.Rwp) + '\nRexp %\t' + pct(g.Rexp),
        'chi2 (sum of weighted squared residuals)\t' + ui.fmt(g.chi2,8) + '\nreduced chi2\t' + ui.fmt(g.chi2red,6) + '\nGOF (sqrt reduced chi2)\t' + ui.fmt(g.GOF,6),
        'fit\t' + g.algorithm + ', ' + g.iter + ' iterations, ' + g.msg, '');
    });
    if (!L.length && list.some(function(d){return d.stats && d.stats.global;})) L.push('## Overall global fit', 'unavailable\tRefit the complete set together: missing overall sums or a member changed, was removed or was fitted again.', '');
    return L.join('\n');
  }
  function globalHTML(list) {
    var groups = globalSummaries(list);
    if (!groups.length) return list.some(function(d){return d.stats && d.stats.global;}) ?
      '<p class="hint">Overall global residual unavailable: refit the complete set together. A member may have changed, been removed or been fitted again; older saved fits do not contain overall residual sums.</p>' : '';
    return groups.map(function(item){
      var g=item.stats;
      return '<section class="global-agreement"><h3>Overall global fit · ' + g.datasetIds.length + ' datasets</h3>' +
        '<div class="global-metrics"><span>R<sub>wp</sub> <b>' + pct(g.Rwp) + '%</b></span><span>R<sub>p</sub> <b>' + pct(g.Rp) + '%</b></span><span>R<sub>exp</sub> <b>' + pct(g.Rexp) + '%</b></span>' +
        '<span>Reduced χ² <b>' + ui.fmt(g.chi2red,4) + '</b></span><span>GOF <b>' + ui.fmt(g.GOF,4) + '</b></span></div>' +
        '<p class="hint">Complete fitted set: ' + esc(item.names.join(', ')) + '. ' + g.n + ' points; ' + g.nVar + ' refined parameters (shared parameters counted once); ' + g.nInt + ' free intensities; ' + g.dof + ' degrees of freedom.</p>' +
        '<p class="hint">Rwp is calculated from the combined weighted residual sums, not the average of dataset percentages. GOF = √(reduced χ²). ' + esc(g.algorithm + ', ' + g.iter + ' iterations, ' + g.msg) + '.</p></section>';
    }).join('');
  }
  // among the Rietveld phases of the dataset; NaN for the others, and for a phase the dataset does not hold
  function weights(ds) {
    var atoms = St.atomicValues(ds);
    var parts = S.phases.map(function (ph) {
      var ct = RV.phasesTab.content(ph, ds.p, atoms), s = ph.method === 'rietveld' && !S.disabledPhases.includes(ph.key) && St.hasPhase(ds, ph) ? ds.p[ph.key + '.scale'] : NaN;
      return { ph: ph, ct: ct, smv: s * ct.mass * ct.V };
    });
    if (St.calculationIssue([ds]) || parts.some(function(p){return St.hasPhase(ds,p.ph) && p.ph.method==='rietveld' && (!(p.ct.mass>0) || !(p.ct.V>0) || (p.ct.missing || []).length);})) return parts.map(function (p) { return { ph: p.ph, ct: p.ct, w: NaN }; });
    var tot = parts.reduce(function (a, p) { return a + (p.smv > 0 ? p.smv : 0); }, 0);
    return parts.map(function (p) { return { ph: p.ph, ct: p.ct, w: tot > 0 && p.smv >= 0 ? p.smv / tot : NaN }; });
  }
  // the reflections of phase pi in a dataset, with the uncertainties of the last fit where it holds them
  function reflOf(ds, pi) {
    var c = St.calcFor(ds), ph = S.phases[pi];
    if (!c || !c.phases[pi]) return [];
    var t = ds.ints && ds.ints[pi] && ph && ph.method !== 'rietveld' ? ds.ints[pi] : null;
    return c.phases[pi].refl.map(function (r, k) {
      var o = Object.assign({}, r);
      if (t && k < t.sigma.length) { o.sigma = t.sigma[k]; o.marginal = ph.method === 'wppf'; }
      o.I = ph && ph.method === 'lebail' ? r.Iext : r.Icalc;
      o.F2obs = o.I > 0 && r.m > 0 && r.lp > 0 ? o.I / (r.m * r.lp) : NaN;
      return o;
    });
  }
  function val(ds, n, dec) { var v = ds.p[n], e = ds.esd ? ds.esd[n] : NaN; if(ds.stats && ds.stats.uncertaintyIssues && ds.stats.uncertaintyIssues[n])return (Number.isFinite(v)?String(St.isSizeParam(n)?Math.round(St.toDisplay(n,v)):+v.toPrecision(7)):'—')+' (uncertainty unavailable)'; if (St.isSizeParam(n)) return Number.isFinite(v) ? String(Math.round(St.toDisplay(n,v))) + (e > 0 ? ' ± ' + ui.fmt(St.toDisplay(n,e),2) : '') : '—'; return Number.isFinite(e) && e > 0 ? ui.withEsd(v, e) : (Number.isFinite(v) ? String(+v.toFixed(dec == null ? 6 : dec)) : '—'); }
  // Reports print an explicit standard uncertainty; fixed values have no invented esd.
  function reportVal(ds,n,dec) {
    var text=val(ds,n,dec), e=ds.esd && ds.esd[n], v=ds.p[n];
    if(ds.stats && ds.stats.uncertaintyIssues && ds.stats.uncertaintyIssues[n])return text;
    if(Number.isFinite(e) && e>0)return ui.fmt(St.toDisplay(n,v),10)+' ± '+ui.fmt(St.toDisplay(n,e),4);
    return text;
  }
  // Free-intensity methods display the Rietveld model without assigning their fit uncertainties to it.
  function atomicModel(ds) { return S.calculation === 'rietveld' ? ds : { p: St.atomicValues(ds) }; }
  function cellSource(ph,c) {
    var free=C.cellParams(ph.sg.system,ph.sg.uniqueAxis);
    if(free.indexOf(c)>=0)return c;
    var sys=String(ph.sg.system).toLowerCase();
    if(sys==='cubic' && (c==='b' || c==='c'))return 'a';
    if(['tetragonal','hexagonal','trigonal','rhombohedral'].indexOf(sys)>=0 && c==='b')return 'a';
    return null;
  }
  function cellText(ph, ds, explicit) {
    var cell=St.cellOf(ph,ds.p);
    return CELL.map(function(c){var source=cellSource(ph,c);return source ? (explicit?reportVal:val)(ds,ph.key+'.'+source,6) : (cell ? String(+cell[c].toFixed(6)) : '—');});
  }

  // ---------------------------------------------------------------- the tab: parts mounted in the accordions of Solve
  /* render() builds the parts of the active calculation once ({summary, atoms, refl} HTML and the titles of their
     blocks); fill() puts them into every [data-res-part] host of the active layout (WPPF shows some of them twice:
     under charge flipping and under the Wyckoff search). Rietveld adds the 3D structure and the constraints. */
  function atomsHTML(ph, ds) {
    var atoms = atomicModel(ds);
    return ph.atoms.length ?
        '<div class="table-wrap"><table class="grid compact"><thead><tr><th>Label</th><th>Scatterer</th><th>Site</th><th>x</th><th>y</th><th>z</th><th>Occ.</th><th>B /Å²</th></tr></thead><tbody>' +
        ph.atoms.map(function (at) {
          var pre = ph.key + '.' + at.label + '.';
          return '<tr><td>' + esc(at.label) + '</td><td>' + esc(at.type) + '</td><td>' + esc(at.site.wyck) + ' <code>' + esc(at.site.expr) + '</code></td>' +
            ['x', 'y', 'z', 'occ', 'B'].map(function (c) { return '<td>' + val(atoms, pre + c, c === 'occ' || c === 'B' ? 4 : 6) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' + (ph.method !== 'rietveld' ? '<p class="hint">Rietveld atomic model. Unused by ' + esc(C.METHOD_LABELS[ph.method]) + '; switch to Rietveld to edit or refine these values.</p>' : '') : '<p class="hint">No atoms.</p>';
  }
  function reflHTML(ph, ds) {
      var pi = S.phases.indexOf(ph), refl = reflOf(ds, pi).filter(function (r) { return r.inRange; }), rv = ph.method === 'rietveld';
      var fresh = !rv && ds.ints && ds.ints[pi];
      var title = (rv ? 'Reflections' : 'Intensities') + ' of ' + ph.name + ' · in ' + ds.name + ', ' + plural(refl.length, 'reflection') + (rv ? '' : ', ' + C.METHOD_LABELS[ph.method]);
      var html = (refl.length ? '<div class="table-wrap"><table class="grid compact refl"><thead><tr><th>h</th><th>k</th><th>l</th><th>m</th><th>d /Å</th><th>2θ /°</th>' +
          (rv ? '<th>|F|²</th><th>I calc</th><th>I obs</th>' : '<th>I</th><th>σ(I)</th><th title="I / (m Lp), on the scale of |F|²">I/(m·Lp)</th><th></th>') + '</tr></thead><tbody>' +
          refl.slice(0, MAX_ROWS).map(function (r) {
            return '<tr><td>' + r.h + '</td><td>' + r.k + '</td><td>' + r.l + '</td><td>' + r.m + '</td><td>' + r.d.toFixed(5) + '</td><td>' + r.tth.toFixed(4) + '</td>' +
              (rv ? '<td>' + ui.fmt(r.F2, 5) + '</td><td>' + ui.fmt(r.Icalc, 5) + '</td><td>' + ui.fmt(r.Iobs, 5) + '</td>'
                  : '<td>' + ui.fmt(r.I, 5) + '</td><td>' + ui.fmt(r.sigma, 3) + '</td><td>' + ui.fmt(r.F2obs, 5) + '</td><td class="why">' +
                    (r.group >= 0 ? 'overlap' : '') + (r.bound ? 'at 0' : '') + '</td>') + '</tr>';
          }).join('') + '</tbody></table></div>' + (refl.length > MAX_ROWS ? '<p class="hint">The first ' + MAX_ROWS + ' are shown; Save reflections writes them all.</p>' : '') : '<p class="hint">' + esc(ds.calcErr || 'No reflection in the fitted range.') + '</p>') +
        (rv ? '<p class="hint">I obs is the observed intensity shared out among the reflections in proportion to the calculated ones (Rietveld), the basis of R<sub>Bragg</sub>.</p>'
            : '<p class="hint">I is the integrated Kα1 intensity of the reflection (the convention of the Rietveld model: I = S·m·Lp·P·|F|²). ' +
              (ph.method === 'wppf' ? 'σ(I) ' + (fresh ? 'from the last fit, with the cell, profile and background integrated out (the full Pawley normal matrix). ' : 'conditional on the current values (fit for the full uncertainties). ') + '“at 0”: held at zero by the non-negativity. '
                                    : 'σ(I) propagates the counting statistics through the partition. ') +
              '“overlap”: exactly coincident with another reflection; only their sum is determined.</p>');
    return { title: title, html: html, n: refl.length };
  }
  var parts = { summary: '', atoms: '', refl: '', titles: {} };
  function render() {
    if(RV.fitHistory && !RV.fitHistory.viewing()){
      var checkpoint=RV.layout?RV.layout.record():RV.fitHistory.latest(S.calculation);
      if(checkpoint)return RV.fitHistory.withResult(checkpoint,render);
      dirty=false;parts={summary:'<p class="hint">No completed fit for this method. Configure it in Commands, then press FIT.</p>',atoms:'',refl:'',titles:{summary:'Selected result',atoms:'Atoms',refl:'Reflections'}};fill();return;
    }
    var list = St.selected(), ph = St.currentPhase();
    dirty = false;
    var method=C.METHOD_LABELS[S.calculation], fitted=list.filter(function(d){return d.stats && d.stats.ok!==false;}).length;
    parts = { summary: '', atoms: '', refl: '', titles: { summary: method + ' · ' + (fitted ? fitted+' of '+list.length+' selected datasets fitted' : 'current values, not fitted'), atoms: 'Atoms', refl: S.calculation === 'rietveld' ? 'Reflections' : 'Intensities' } };
    if (!list.length) { parts.summary = '<p class="hint">' + (S.datasets.length ? 'Select one or more datasets to see their results.' : 'No data yet.') + '</p>'; parts.atoms = parts.refl = '<p class="hint">Select a dataset.</p>'; fill(); return; }
    var h = '<div class="res-head"><h2>' + esc(method) + ' results</h2><span class="sub">' + plural(list.length, 'selected dataset') + '</span><span class="tool-gap"></span>' +
      (S.calculation==='wppf' ? '<button type="button" data-res="hkl" title="Export extracted WPPF F² and σ as SHELX HKLF 4">Save HKL…</button>' : '') + '<button type="button" data-res="cif">Save CIF…</button><button type="button" data-res="pdcif">Save pdCIF…</button><button type="button" data-res="save">Save results…</button><button type="button" data-res="refl">Save reflections…</button><button type="button" data-res="calc">Save calculated patterns…</button></div>';
    h += '<section class="block"><h2>Agreement</h2>' + globalHTML(list) + '<div class="table-wrap"><table class="grid compact"><thead><tr><th>Dataset</th><th>Points</th><th>Refined</th>' +
      '<th>R<sub>p</sub> %</th><th>R<sub>wp</sub> %</th><th>R<sub>exp</sub> %</th><th title="Reduced chi-squared for this dataset">χ²<sub>red</sub></th><th>Fit</th></tr></thead><tbody>' +
      list.map(function (d) {
        var s = statsOf(d);
        if (!s) return '<tr><td>' + esc(d.name) + '</td><td colspan="7" class="hint">' + esc(d.calcErr || 'no calculated pattern') + '</td></tr>';
        return '<tr><td>' + esc(d.name) + '</td><td>' + s.n + '</td><td>' + (s.fitted ? s.nVar : '—') + '</td><td>' + pct(s.Rp) + '</td><td>' + pct(s.Rwp) + '</td><td>' + pct(s.Rexp) + '</td>' +
          '<td>' + ui.fmt(s.fitted ? s.chi2red : s.gof, 4) + '</td><td>' + (s.fitted ? esc((s.effectiveAlgorithm || 'lm') + (s.pt ? ' (PT: ' + (s.pt.backend || 'cpu') + ')' : '') + ', ' + (s.global ? 'global, ' : '') + s.iter + ' it, ' + s.msg) + (s.pt && s.pt.fallbackReason ? '<span class="why" title="'+esc(s.pt.fallbackReason)+'"> · CPU fallback</span>' : '') : '<span class="why">'+(s.fitError ? 'Last fit failed: '+esc(s.fitError)+'. ' : '')+'Current values, not fitted</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    list.forEach(function(d){var warnings=d.stats && d.stats.fitWarnings || [];if(warnings.length)h+='<section class="block"><h2>'+esc(d.name)+' · Fit diagnostics</h2>'+warnings.map(function(w){return '<p class="why">'+esc(w)+'</p>';}).join('')+'</section>';});
    if (S.phases.length) {
      h += '<section class="block"><h2>Phases</h2><div class="table-wrap"><table class="grid compact"><thead><tr><th>Dataset</th><th>Phase</th><th>Method</th><th>Scale</th><th title="Mass fraction, not mole fraction. Hill and Howard: S·Mcell·V over the sum for all Rietveld phases">Mass (wt%)</th>' +
        '<th title="100 × sum |Iobs − Icalc| / sum |Iobs|">R<sub>Bragg</sub> %</th><th>R<sub>F</sub> %</th>' + CELL.map(function (c) { return '<th>' + CELL_LABEL[c] + '</th>'; }).join('') + '<th>V /Å³</th></tr></thead><tbody>' +
        list.map(function (d) {
          var s = statsOf(d), W = weights(d), first = true;
          if (!St.phasesIn(d).length) return '<tr><td>' + esc(d.name) + '</td><td colspan="' + (6 + CELL.length) + '" class="hint">no phase in this dataset</td></tr>';
          return S.phases.map(function (p, i) {
            if (!St.hasPhase(d, p)) return '';
            var r = s && s.phases && s.phases[i], head = first; first = false;
            return '<tr><td>' + (head ? esc(d.name) : '') + '</td><td><i class="sw-inline" style="background:' + RV.plots.phaseVar(i) + '"></i>' + esc(p.name) + '</td><td>' + esc(C.METHOD_LABELS[p.method]) + '</td><td>' + (p.method === 'rietveld' ? val(d, p.key + '.scale') : '—') + '</td>' +
              '<td>' + (Number.isFinite(W[i].w) ? (100 * W[i].w).toFixed(2) : '—') + '</td><td>' + (r && p.method === 'rietveld' ? pct(r.RBragg) : '—') + '</td><td>' + (r && p.method === 'rietveld' ? pct(r.RF) : '—') + '</td>' +
              cellText(p, d).map(function (t) { return '<td>' + t + '</td>'; }).join('') + '<td>' + (Number.isFinite(W[i].ct.V) ? W[i].ct.V.toFixed(3) : '—') + '</td></tr>';
          }).join('');
        }).join('') + '</tbody></table></div><p class="hint">Weight fractions are among the Rietveld phases and assume that every crystalline phase of the sample is in the model; a Le Bail or WPPF phase has no scale. Values with their standard uncertainty in brackets, from the last fit.</p>' +
        '</section>';
    }
    parts.summary = h;
    var pairs = [];
    list.forEach(function (d) { S.phases.forEach(function (p) { if (St.hasPhase(d, p)) pairs.push({ d: d, p: p }); }); });
    if (ph && !pairs.length) {
      var none = '<p class="hint">' + esc(ph.name) + ' is in none of the selected datasets' +
        (St.holdersOf(ph).length ? ' (it is in ' + St.holdersOf(ph).map(function (d) { return d.name; }).join(', ') + ')' : '') + ': select one that holds it, or assign ' + esc(ph.name) + ' to it in Datasets.</p>';
      parts.atoms = parts.refl = none; parts.titles.atoms = 'Atoms of ' + ph.name; parts.titles.refl = parts.titles.refl + ' of ' + ph.name;
    } else if (!ph) { parts.atoms = parts.refl = '<p class="hint">No phase yet.</p>'; }
    else {
      // every selected dataset, every phase it holds: one table each (a single pair keeps the plain look)
      if (pairs.length === 1) { parts.titles.atoms = 'Atoms of ' + pairs[0].p.name + ' · in ' + pairs[0].d.name; parts.atoms = atomsHTML(pairs[0].p, pairs[0].d);
        var one = reflHTML(pairs[0].p, pairs[0].d); parts.titles.refl = one.title; parts.refl = one.html; }
      else if (pairs.length > 1) {
        var MAXP = 40, shown = pairs.slice(0, MAXP), tabs = shown.map(function (q) { return reflHTML(q.p, q.d); });
        var head = function (q, extra) { return '<h4 class="res-sub"><i class="sw-inline" style="background:' + RV.plots.phaseVar(S.phases.indexOf(q.p)) + '"></i>' + esc(q.p.name) + ' · in ' + esc(q.d.name) + (extra || '') + '</h4>'; };
        // atoms: datasets whose values and uncertainties for a phase are identical (shared parameters of a global fit) share one table
        var groups = [];
        pairs.forEach(function (q) {
          var html = atomsHTML(q.p, q.d), g = groups.find(function (x) { return x.p === q.p && x.html === html; });
          if (g) g.names.push(q.d.name); else groups.push({ p: q.p, html: html, names: [q.d.name] });
        });
        parts.titles.atoms = 'Atoms · ' + plural(groups.length, 'table');
        parts.atoms = groups.map(function (g) {
          return '<h4 class="res-sub"><i class="sw-inline" style="background:' + RV.plots.phaseVar(S.phases.indexOf(g.p)) + '"></i>' + esc(g.p.name) + ' · in ' + g.names.map(esc).join(', ') + '</h4>' + g.html;
        }).join('');
        parts.titles.refl = (S.calculation === 'rietveld' ? 'Reflections' : 'Intensities') + ' · ' + plural(pairs.length, 'phase table');
        parts.refl = shown.map(function (q, k) { return head(q, ', ' + plural(tabs[k].n, 'reflection') + ', ' + C.METHOD_LABELS[q.p.method]) + tabs[k].html; }).join('') + (pairs.length > MAXP ? '<p class="hint">The first ' + MAXP + ' of ' + pairs.length + ' are shown; Save reflections writes them all.</p>' : '');
      }
    }
    fill();
  }
  function layout() { var m=RV.layout && !(RV.fitHistory && RV.fitHistory.viewing())?RV.layout.resultMethod():S.calculation;return document.querySelector('.calc-layout[data-layout="' + m + '"]'); }
  function fill() {
    var lay = layout(), list = St.selected();
    if (!lay) return;
    lay.querySelectorAll('[data-res-part]').forEach(function (host) {
      var k = host.getAttribute('data-res-part');
      if (k === 'summary' || k === 'atoms' || k === 'refl') host.innerHTML = parts[k];
    });
    lay.querySelectorAll('[data-res-title]').forEach(function (t) { var k = t.getAttribute('data-res-title'); if (parts.titles[k] != null) t.textContent = parts.titles[k]; });
    if (S.calculation === 'rietveld' && (!RV.fitHistory || RV.fitHistory.viewing())) {
      var ch = lay.querySelector('[data-res-part="constraints"]');
      if (ch && RV.constraints) { var n = RV.constraints.renderSolve(ch), t = lay.querySelector('[data-res-title="constraints"]'); if (t) t.textContent = n ? n + (n === 1 ? ' relationship' : ' relationships') : 'none'; }
      renderStructure();
    } else {lay.querySelectorAll('[data-res-part="constraints"],[data-res-part="structure"]').forEach(function(host){host.innerHTML='';});if(RV.rietveldStructure)RV.rietveldStructure.dispose();}
    lay.querySelectorAll('[data-res="hkl"]').forEach(function (b) { ui.able(b,list.some(function(d){return d.ints;})?'':'This run has no stored intensity uncertainties.'); });
  }
  // the 3D view of the Rietveld model, drawn only while its block is open
  function renderStructure() {
    if(RV.fitHistory && !RV.fitHistory.viewing()){var r=RV.layout?RV.layout.record():RV.fitHistory.latest(S.calculation);if(r)return RV.fitHistory.withResult(r,renderStructure);}
    var lay = layout(), host = lay && lay.querySelector('[data-res-part="structure"]');
    if (!host || !RV.rietveldStructure) return;
    if (S.calculation !== 'rietveld' || !RV.acc.isShown(host)) { RV.rietveldStructure.dispose(); host.innerHTML = ''; return; }
    RV.rietveldStructure.render(host, St.selected());
  }
  function refresh() {
    dirty = true;
    if (RV.app && RV.app.resultTab() === 'solve') render();
  }

  // ---------------------------------------------------------------- text files
  function line(a) { return a.join('\t'); }
  function reportText(list, skipGlobal) {
    var L = ['# ' + C.METHOD_LABELS[S.calculation] + ' calculation, ' + RV.version, '# ' + ui.stamp(), '# Phases: ' + S.phases.map(function (p) { return p.name + ' (' + St.sgText(p.sg) + ')'; }).join(', '), ''];
    if (!skipGlobal) { var overall = globalReportText(list); if (overall) L.push(overall); var cons = constraintsText(list); if (cons) L.push(cons); }
    list.forEach(function (d) {
      var s = statsOf(d), i = d.inst, W = weights(d), atoms = atomicModel(d);
      L.push('## Dataset ' + d.name, 'method\t'+C.METHOD_LABELS[S.calculation], 'uncertainties\tValues with available standard uncertainties are written value ± esd. Symmetry-equivalent cell lengths share their esd; fixed parameters have none.');
      L.push('instrument profile (dataset)\t'+C.PROFILE_LABELS[i.resolutionType || 'tch_aniso']);
      L.push('instrument resolution (dataset)\t' + St.instrumentParamsFor(d).map(function(p){return p[0]+' = '+reportVal(d,'inst.'+p[0],6);}).join('\t'));
      L.push('width units\tU,V,W: Gaussian variance (cdeg²); X,Y,Z: Lorentzian width (cdeg); size: nm; strain: ppm');
      L.push('lambda1\t' + i.lambda1 + (i.ratio > 0 && i.lambda2 > 0 ? '\nlambda2\t' + i.lambda2 + '\nratio\t' + i.ratio : ''));
      L.push('radiation\t' + i.radiation + '\npolarisation K\t' + St.polK(i));
      var an=d.stats && d.stats.anomalousData || St.anomalousFor(d);
      L.push('anomalous scattering\t'+(an.enabled?'enabled':'disabled')+'\tsource: '+an.source+'\tlambda1: '+an.wavelength+' A');
      if(an.interpolation && an.enabled)L.push('anomalous interpolation\t'+an.interpolation+'\tenergy (eV): '+an.energyEV);
      if(an.error)L.push('anomalous scattering unavailable\t'+an.error);
      if(Object.keys(an.map || {}).length){L.push('anomalous element\tf_prime (electrons)\tf_double_prime (electrons)');Object.keys(an.map).sort().forEach(function(el){L.push(el+'\t'+an.map[el][0]+'\t'+an.map[el][1]);});}
      L.push('fitted range\t' + i.tthMin + '\t' + i.tthMax + '\npoints\t' + (s ? s.n : 0));
      if (s) {
        L.push('Rp %\t' + pct(s.Rp) + '\nRwp %\t' + pct(s.Rwp) + '\nRexp %\t' + pct(s.Rexp) + '\nchi2\t' + ui.fmt(s.fitted ? s.chi2red : s.gof, 6));
        if (s.fitted) L.push('algorithm\t' + (s.effectiveAlgorithm || 'lm') + (s.pt ? '\nPT backend\t' + (s.pt.backend || 'cpu') + '\nPT replicas\t' + s.pt.chains + '\nPT sweeps\t' + s.pt.sweeps + '\nPT seed\t' + s.pt.seed + (s.pt.fallbackReason ? '\nPT CPU fallback\t' + s.pt.fallbackReason : '') : ''));
        (s.constraintWarnings || []).forEach(function(w){L.push('constraint warning\t'+w);});
        (s.fitWarnings || []).forEach(function(w){L.push('fit warning\t'+w);});
        Object.keys(s.uncertaintyIssues || {}).forEach(function(n){L.push('uncertainty warning\t'+n+': '+s.uncertaintyIssues[n]);});
        L.push('fit\t' + (s.fitted ? (s.global ? 'global, ' : '') + s.iter + ' iterations, ' + s.msg : s.fitError ? 'last fit failed: '+s.fitError+'; current values' : 'not fitted (current values)'));
      }
      L.push('zero\t' + reportVal(d, 'zero') + '\ndisplacement\t' + reportVal(d, 'disp') + '\ntransparency\t' + reportVal(d, 'transp'));
      if (i.bkgType === 'spline') L.push('background (spline)\t' + i.bkgX.map(function (x, k) { return x + ': ' + reportVal(d, 'bga' + k); }).join('\t'));
      else L.push('background (Chebyshev)\t' + St.dsNames(d).filter(function (n) { return /^bkg/.test(n); }).map(function (n) { return reportVal(d, n); }).join('\t'));
      if (i.excl.length) L.push('excluded\t' + i.excl.map(function (r) { return r[0] + '-' + r[1]; }).join('\t'));
      L.push('phases\t' + (St.phasesIn(d).map(function (p) { return p.name; }).join('\t') || 'none'));
      S.phases.forEach(function (ph, pi) {
        if (!St.hasPhase(d, ph)) return;
        var r = s && s.phases && s.phases[pi], cell = cellText(ph, d, true);
        L.push('', '### Phase ' + ph.name + ', ' + St.sgText(ph.sg) + ', ' + ph.sg.system + ', method ' + C.METHOD_LABELS[ph.method]);
        if (ph.method === 'rietveld') L.push('scale\t' + reportVal(d, ph.key + '.scale') + '\nmass (wt%)\t' + (Number.isFinite(W[pi].w) ? (100 * W[pi].w).toFixed(3) : '—'));
        if (ph.method !== 'rietveld') L.push('structural R factors\tnot applicable: free reflection intensities');
        L.push('R_Bragg %\t' + (r && ph.method === 'rietveld' ? pct(r.RBragg) : '—') + '\nR_F %\t' + (r && ph.method === 'rietveld' ? pct(r.RF) : '—'));
        L.push('cell\t' + CELL.map(function (c, k) { return c + ' = ' + cell[k]; }).join('\t') + '\nvolume\t' + (Number.isFinite(W[pi].ct.V) ? W[pi].ct.V.toFixed(4) : '—') +
               '\ncontent\t' + W[pi].ct.formula + '\ndensity\t' + (W[pi].ct.density > 0 ? W[pi].ct.density.toFixed(4) : '—'));
        if(ph.method==='rietveld' && S.calculation==='rietveld' && ph.constraints && ph.constraints.length)L.push('atomic constraints\t'+ph.constraints.length+' GSAS-II relationships (listed once, under Atomic constraints)');
        if (ph.method === 'rietveld') L.push('preferred orientation\t(' + ph.poDir.join(' ') + ')\tr = ' + reportVal(d, ph.key + '.po', 5));
        if(C.usesSeparatedProfile(ph)){var b=C.broadeningConfig(ph.broadening);L.push('sample model\tsize: '+b.size+'; axis '+b.sizeAxis.join(' ')+'\tstrain: '+b.strain+'; axis '+b.strainAxis.join(' '));}
        L.push((C.usesSeparatedProfile(ph)?'sample broadening\t':'legacy effective profile\t') + St.profileNames(ph).map(function (n) { return n + ' = ' + reportVal(d, ph.key + '.' + n, 5); }).join('\t'));
        if (ph.method !== 'rietveld') { var nr = reflOf(d, pi).filter(function (q) { return q.inRange; }).length; L.push('intensities\t' + nr + ' reflections in the fitted range (Save reflections writes them, with their uncertainties)'); }
        if (ph.method === 'rietveld' || ph.atoms.length) L.push(line(['atom', 'type', 'site', 'x', 'y', 'z', 'occ', 'B']) + (ph.method === 'rietveld' ? '' : '\t(Rietveld atomic model; unused by '+C.METHOD_LABELS[ph.method]+')'));
        ph.atoms.forEach(function (at) {
          var pre = ph.key + '.' + at.label + '.';
          L.push(line([at.label, at.type, at.site.wyck + ' ' + at.site.expr.replace(/ /g, '')].concat(['x', 'y', 'z', 'occ', 'B'].map(function (c) { return reportVal(atoms, pre + c, c === 'occ' || c === 'B' ? 4 : 6); }))));
        });
        var rows=reflectionRows(d,pi);
        L.push('', '### Reflections of '+ph.name+' in '+d.name+' · '+C.METHOD_LABELS[ph.method],
          'Reflections in the fitted range: '+(rows.length-1)+'. Wavelength λ1 = '+i.lambda1+' Å. d in Å; 2theta in degrees; m is multiplicity.');
        L.push(ph.method==='rietveld' ? 'F2 = |Fcalc|²; Icalc and profile-partitioned Iobs are integrated reflection intensities.' :
          'I is integrated intensity; sigma is its standard uncertainty; I/(m*Lp) is on the |F|² scale. Flag overlap: coincident profiles, only the sum is determined; zero: WPPF intensity held at zero; blank: neither flag.');
        if(rows.length>1)rows.forEach(function(row){L.push(row);});
        else L.push('No reflection in the fitted range, or calculated reflections are unavailable.');
      });
      L.push('');
    });
    return L.join('\n') + '\n';
  }
  /* The GSAS-II atomic constraints of the Rietveld phases held by the datasets, once per phase ('' when none).
     Constraints belong to the phase, not to a dataset, so the reports print them a single time. */
  function constraintsText(list) {
    if (S.calculation !== 'rietveld') return '';
    var L = [];
    S.phases.forEach(function (ph) {
      if (ph.method !== 'rietveld' || !ph.constraints || !ph.constraints.length) return;
      if (list && !list.some(function (d) { return St.hasPhase(d, ph); })) return;
      if (!L.length) L.push('## Atomic constraints', 'rules\tGSAS-II: hold, equivalence (B = m × A, A independent), constraint equation (sum m_i P_i = c); dependent parameters eliminated exactly');
      L.push('', '### ' + ph.name);
      AtomicConstraints.normalizeAll(ph.constraints).forEach(function (c) { L.push(AtomicConstraints.label(c.kind) + '\t' + AtomicConstraints.text(c)); });
    });
    var AR = typeof AtomRestraints !== 'undefined' ? AtomRestraints : null, head = false;
    S.phases.forEach(function (ph) {
      if (!AR || ph.method !== 'rietveld' || !AR.active(ph.restraints)) return;
      if (list && !list.some(function (d) { return St.hasPhase(d, ph); })) return;
      var rs = AR.normalize(ph.restraints);
      if (!head) { head = true; L.push('## Restraints', 'rules\tsoft distance and angle restraints added to chi2 as extra observations: ((value - nearest bound) / sigma)^2 x weight'); }
      L.push('', '### ' + ph.name, 'weight\t' + rs.weight + '\tsigma distance\t' + rs.sigmaD + ' A\tsigma angle\t' + rs.sigmaA + ' deg');
      rs.text.split(/\r?\n/).forEach(function (line) { if (line.trim()) L.push('rule\t' + line.trim()); });
    });
    return L.length ? L.join('\n') + '\n' : '';
  }
  // One reflection table definition for Save reflections and text/PDF reports.
  // Reports include every reflection in the fitted range, without the UI's 500-row limit.
  function reflectionRows(ds,pi) {
    var ph=S.phases[pi], rv=ph.method==='rietveld';
    var rows=[line(rv ? ['h','k','l','m','d','2theta','F2','Icalc','Iobs'] : ['h','k','l','m','d','2theta','I','sigma','I/(m*Lp)','flag'])];
    reflOf(ds,pi).forEach(function(r){
      if(!r.inRange)return;
      rows.push(line(rv ? [r.h,r.k,r.l,r.m,r.d.toFixed(6),r.tth.toFixed(5),ui.fmt(r.F2,8),ui.fmt(r.Icalc,8),ui.fmt(r.Iobs,8)]
        : [r.h,r.k,r.l,r.m,r.d.toFixed(6),r.tth.toFixed(5),ui.fmt(r.I,8),ui.fmt(r.sigma,6),ui.fmt(r.F2obs,8),[r.group>=0?'overlap':'',r.bound?'zero':''].filter(Boolean).join(';')]));
    });
    return rows;
  }
  function reflText(list) {
    var L = ['# Reflections, ' + RV.version + ', ' + ui.stamp(), '# flag: overlap = exactly coincident reflections (only their summed intensity is determined); zero = intensity held at the non-negative lower bound; blank = neither. Multiple flags are separated by semicolons.'];
    list.forEach(function(d){
      if(!St.calcFor(d))return;
      S.phases.forEach(function(ph,pi){
        if(!St.hasPhase(d,ph))return;
        L.push('', '# '+d.name+', '+ph.name+' ('+St.sgText(ph.sg)+'), '+C.METHOD_LABELS[ph.method]+', lambda1 '+d.inst.lambda1);
        reflectionRows(d,pi).forEach(function(row){L.push(row);});
      });
    });
    return L.join('\n')+'\n';
  }
  function calcText(list) {
    var L = ['# Calculated patterns, ' + RV.version + ', ' + ui.stamp()];
    list.forEach(function (d) {
      var c = St.calcFor(d);
      if (!c) return;
      // a column per phase of the dataset
      var held = S.phases.map(function (p, pi) { return St.hasPhase(d, p) && c.phases[pi] ? pi : -1; }).filter(function (pi) { return pi >= 0; });
      L.push('', '# ' + d.name, line(['2theta', 'Iobs', 'Icalc', 'Ibkg', 'obs-calc'].concat(held.map(function (pi) { return S.phases[pi].name.replace(/\s+/g, '_'); }))));
      for (var i = 0; i < c.tth.length; i++) {
        L.push(line([c.tth[i].toFixed(5), ui.fmt(c.yobs[i], 8), ui.fmt(c.ycalc[i], 8), ui.fmt(c.bkg[i], 8), ui.fmt(c.yobs[i] - c.ycalc[i], 8)]
          .concat(held.map(function (pi) { return ui.fmt(c.phases[pi].y[i], 8); }))));
      }
    });
    return L.join('\n') + '\n';
  }
  function cifQuote(s) {
    s=String(s==null?'':s).replace(/[\r\n]+/g,' ');
    if(s.indexOf("'")<0)return "'"+s+"'";
    if(s.indexOf('"')<0)return '"'+s+'"';
    return '\n;\n'+s+'\n;\n';
  }
  function cifNumber(v,e) {
    if(!Number.isFinite(v))return '?';
    if(Number.isFinite(e) && e>=1e-10){var dp=Math.max(0,Math.min(10,1-Math.floor(Math.log10(e))));return v.toFixed(dp)+'('+Math.round(e*Math.pow(10,dp))+')';}
    return String(+v.toPrecision(12));
  }
  function opXYZ(op) {
    if(op.xyz)return op.xyz;
    return [0,1,2].map(function(i){var t='';for(var j=0;j<3;j++){var a=op.r[3*i+j];if(a)t+=(a>0&&t?'+':'')+(a===-1?'-':a===1?'':String(a))+'xyz'[j];}var v=((op.t[i]%1)+1)%1;if(v)t+=(t?'+':'')+C.fracText(v);return t||'0';}).join(',');
  }
  function cifText(list,powder,onlyPhaseKey) {
    var L=['#\\#CIF_1.1','# Powder 6 calculation export; numerical values belong to each dataset and active method.'];
    list.forEach(function(d,di){
      var ids=[],phaseNames=[],atoms=atomicModel(d);
      St.phasesIn(d).filter(function(ph){return !onlyPhaseKey || ph.key===onlyPhaseKey;}).forEach(function(ph){
        var key='d'+(di+1)+'_'+ph.key,cell=St.cellOf(ph,d.p),pre=ph.key+'.',es=d.esd||{},issues=d.stats && d.stats.uncertaintyIssues || {};
        ids.push(key);phaseNames.push(ph.name);
        L.push('','data_'+key,'_pd_block_id '+cifQuote(key),'_audit_creation_method '+cifQuote('Powder 6 '+C.METHOD_LABELS[S.calculation]+'; dataset '+d.name+(d.stats && d.stats.ok!==false?' — last fit':' — current values, not fitted')),
          '_chemical_name_common '+cifQuote(ph.name),'_space_group_IT_number '+ph.sg.number,'_space_group_name_H-M_alt '+cifQuote(ph.sg.symbol),'_space_group_name_Hall '+cifQuote(ph.sg.hall || '?'));
        CELL.forEach(function(c){L.push('_cell_'+(/^[abc]$/.test(c)?'length_':'angle_')+c+' '+cifNumber(cell && cell[c],(function(){var source=cellSource(ph,c);return source && !issues[pre+source] ? es[pre+source] : NaN;})()));});
        L.push('_cell_volume '+cifNumber(cell && C.cellVolume ? C.cellVolume(cell) : contentVolume(cell)),'loop_','_space_group_symop_id','_space_group_symop_operation_xyz');
        ph.ops.forEach(function(op,i){L.push((i+1)+' '+cifQuote(opXYZ(op)));});
        if(ph.atoms.length){
          if(S.calculation!=='rietveld')L.push('# Rietveld atomic model; unused by '+C.METHOD_LABELS[S.calculation]+'.');
          L.push('loop_','_atom_site_label','_atom_site_type_symbol','_atom_site_fract_x','_atom_site_fract_y','_atom_site_fract_z','_atom_site_occupancy','_atom_site_B_iso_or_equiv');
          ph.atoms.forEach(function(at){var k=pre+at.label+'.';L.push([cifQuote(at.label),cifQuote(at.type)].concat(['x','y','z','occ','B'].map(function(c){return cifNumber(atoms.p[k+c],S.calculation==='rietveld' && !issues[k+c]?es[k+c]:NaN);})).join(' '));});
        }else L.push('# Atomless phase: no atomic coordinates have been invented.');
        if(ph.method==='rietveld' && S.calculation==='rietveld' && ph.constraints && ph.constraints.length)AtomicConstraints.normalizeAll(ph.constraints).forEach(function(c){L.push('# Atomic constraint ('+AtomicConstraints.label(c.kind)+'): '+AtomicConstraints.text(c));});
        Object.keys(issues).filter(function(n){return n.indexOf(pre)===0;}).forEach(function(n){L.push('# Uncertainty unavailable for '+n+': '+issues[n]);});
        L.push('# Instrument profile (dataset): '+C.PROFILE_LABELS[d.inst.resolutionType || 'tch_aniso']);
        L.push('# Sample broadening of '+ph.name);
        St.profileNames(ph).forEach(function(n){L.push('# '+n+' '+cifNumber(St.toDisplay(n,d.p[pre+n]))+(St.isSizeParam(n)?' nm':''));});
      });
      if(powder){
        var calc=St.calcFor(d), stats=statsOf(d), points=St.fitPoints(d);
        L.push('','data_pattern_'+(di+1),'_pd_block_id '+cifQuote('pattern_'+(di+1)),'_pd_spec_special_details '+cifQuote('Dataset '+d.name+'; method '+C.METHOD_LABELS[S.calculation]+'; original intensities, background not subtracted'),
          '_diffrn_radiation_probe '+(d.inst.radiation==='neutron'?'neutron':'x-ray'),
          '_pd_calib_2theta_offset '+cifNumber(-(d.p.zero || 0)));
        if(d.inst.radiation!=='neutron' && d.inst.lambda2>0 && d.inst.ratio>0){
          L.push('loop_','_diffrn_radiation_wavelength_id','_diffrn_radiation_wavelength','_diffrn_radiation_wavelength_wt',
            '1 '+cifNumber(d.inst.lambda1)+' 1','2 '+cifNumber(d.inst.lambda2)+' '+cifNumber(d.inst.ratio));
        }else L.push('_diffrn_radiation_wavelength '+cifNumber(d.inst.lambda1));
        if(stats)L.push('_pd_proc_ls_prof_R_factor '+cifNumber(stats.Rp),'_pd_proc_ls_prof_wR_factor '+cifNumber(stats.Rwp),'_pd_proc_ls_prof_wR_expected '+cifNumber(stats.Rexp));
        if(ids.length){L.push('loop_','_pd_phase_id','_pd_phase_name','_pd_phase_block_id');ids.forEach(function(id,i){L.push((i+1)+' '+cifQuote(phaseNames[i])+' '+cifQuote(id));});}
        if(calc){L.push('loop_','_pd_meas_2theta_scan','_pd_meas_intensity_total','_pd_calc_intensity_total','_pd_calc_intensity_bkg','_pd_proc_ls_weight');for(var j=0;j<calc.tth.length;j++)L.push([calc.tth[j],calc.yobs[j],calc.ycalc[j],calc.bkg[j],points.w[j]].map(function(v){return cifNumber(v);}).join(' '));}
      }
    });
    return L.join('\n')+'\n';
  }
  function contentVolume(cell) {return cell ? cellVolume(cell) : NaN;}
  /* One phase as a structure CIF, from the values of one dataset: its cell, space group and atomic model, with
     the standard uncertainties of the last Rietveld fit. Results → Save CIF writes every selected phase; this
     writes the one whose parameter group the button belongs to, so a user can keep his own structure when the
     fit holds several phases. */
  function savePhaseCif(ph, ds) {
    if (!ph) return;
    var list = (ds ? [ds] : St.selected()).filter(function (d) { return St.hasPhase(d, ph); });
    if (!list.length) { ui.toast('No selected dataset holds ' + ph.name + ' right now.', 'warn'); return; }
    var kind = ph.method === 'rietveld' && S.calculation === 'rietveld' ? 'fitted values' : 'current values, not fitted';
    ui.download('structure_' + String(ph.name).replace(/[^\w.-]+/g, '_') + '_' + ui.fileStamp() + '.cif', cifText(list, false, ph.key), 'chemical/x-cif');
    ui.toast('Saved ' + ph.name + ' (' + kind + ') as a CIF: cell, space group, symmetry operations and atoms.', 'ok');
  }
  function save(kind) {
    if(RV.fitHistory && !RV.fitHistory.viewing()){var checkpoint=RV.layout?RV.layout.record():RV.fitHistory.latest(S.calculation);if(!checkpoint){ui.toast('Select a completed fit before exporting results.','info');return;}return RV.fitHistory.withResult(checkpoint,function(){save(kind);});}
    var list = St.selected();
    if (!list.length) { ui.toast('Select one or more datasets first.', 'warn'); return; }
    if(kind==='hkl'){
      var sources=[];list.forEach(function(d){S.phases.forEach(function(p,i){if(p.method!=='wppf' || !St.hasPhase(d,p))return;var det=reflOf(d,i).filter(function(r){return r.sigma>0;}).map(function(r){return {h:r.h,k:r.k,l:r.l,m:r.m,lp:r.lp,area:r.I,sigma:r.sigma};});if(det.length)sources.push({label:p.name+' in '+d.name,I:{phaseName:p.name+'_'+d.name,det:det}});});});
      if(!sources.length){ui.toast('This run has no WPPF intensity uncertainties.','info');return;}
      if(sources.length===1)RV.solve.saveHkl(sources[0].I);else ui.prompt('Save HKL from this run',[{key:'source',label:'Dataset and phase',type:'select',value:'0',options:sources.map(function(s,i){return [String(i),s.label];})}],'Save HKL').then(function(v){if(v)RV.solve.saveHkl(sources[+v.source].I);});return;
    }
    var stamp = ui.fileStamp();
    if(kind==='cif' || kind==='pdcif'){ui.download(S.calculation+'_results_'+stamp+'.'+(kind==='cif'?'cif':'pdcif'),cifText(list,kind==='pdcif'),'chemical/x-cif');return;}
    if (kind === 'save') { ui.download(S.calculation + '_results_' + stamp + '.txt', reportText(list)); ui.toast('Saved the results of ' + plural(list.length, 'dataset') + '.', 'ok'); }
    else if (kind === 'refl') { ui.download(S.calculation + '_reflections_' + stamp + '.txt', reflText(list)); ui.toast('Saved the reflections of ' + plural(list.length, 'dataset') + '.', 'ok'); }
    else if (kind === 'calc') { ui.download(S.calculation + '_patterns_' + stamp + '.txt', calcText(list)); ui.toast('Saved the observed and calculated patterns of ' + plural(list.length, 'dataset') + '.', 'ok'); }
  }

  function init() {
    $('#calculation-body').addEventListener('click', function (e) { var b = e.target.closest('[data-res]'); if (b) save(b.getAttribute('data-res')); });
    RV.bus.on('acc', function (k) { if (k === 'rietveld-structure') renderStructure(); });
    ['stats', 'selection', 'params', 'phaseStyle', 'phases', 'phaseSel', 'datasets', 'data', 'tables', 'calculation', 'extraction','fitHistory'].forEach(function (ev) { RV.bus.on(ev, refresh); });
    RV.bus.on('tab', function (t) { if (t === 'solve' && dirty) render(); });
  }
  return { init: init, render: render, fill: fill, save: save, savePhaseCif: savePhaseCif, constraintsText: constraintsText, reportText: reportText, globalSummaries: globalSummaries, globalReportText: globalReportText, reflText: reflText, weights: weights, reflOf: reflOf, statsOf: statsOf, cifText:cifText };
})();
