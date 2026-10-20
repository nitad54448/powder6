/* Phase definitions and numerical values of the selected calculation dataset. */
RV.phasesTab = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui, esc = ui.esc, C = RVCore;
  var CELL = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'], CELL_LABEL = { a: 'a', b: 'b', c: 'c', alpha: 'α', beta: 'β', gamma: 'γ' };
  var DEC = { cell: 6, x: 6, y: 6, z: 6, occ: 4, B: 4 };
  function $(s) { return document.querySelector(s); }
  // Use the same first selected dataset as Parameters when it holds the phase.
  // With no selected holder the editor is a starting-model editor.
  function srcDs() { var ph = St.currentPhase(), d = St.first(); return ph && d && St.hasPhase(d,ph) ? d : null; }
  function src() { var d = srcDs(), ph = St.currentPhase(); return d ? d.p : ph ? ph.v : {}; }
  function srcEsd() { var d = srcDs(); return d ? d.esd || {} : {}; }
  function setNumeric(ph,name,value) { var d=srcDs(); return St.setParam(name,value,d ? [d] : [],!d); }
  function fmtNum(v, dec) { return Number.isFinite(v) ? String(+v.toFixed(dec)) : ''; }
  function fmtCount(n) { var r = Math.round(n); return Math.abs(n - r) < 1e-6 ? (r === 1 ? '' : String(r)) : String(+n.toFixed(3)); }

  // cell volume, content, mass and density of a phase with the values v
  function content(ph, v) {
    var cell = St.cellOf(ph, v), counts = {}, order = [], mass = 0, missing = [];
    ph.atoms.forEach(function (at) {
      var pre = ph.key + '.' + at.label + '.', n = (Number.isFinite(v[pre + 'occ']) ? v[pre + 'occ'] : 1) * at.site.mult;
      var el = St.elementOf(at.type) || at.type, w = St.atomicWeight(el);
      if (!(el in counts)) { counts[el] = 0; order.push(el); }
      counts[el] += n;
      if (Number.isFinite(w)) mass += n * w; else if (missing.indexOf(el) < 0) missing.push(el);
    });
    var V = cell ? cellVolume(cell) : NaN;
    return { cell: cell, V: V, mass: mass, density: V > 0 ? mass * 1.6605390666 / V : NaN, missing: missing,
             formula: order.map(function (el) { return el + fmtCount(counts[el]); }).join(' ') };
  }

  // ---------------------------------------------------------------- building
  function renderBar() {
    var bar = $('#phase-select'), cur = St.currentPhase();
    ui.able($('#ph-tab-del'), cur ? '' : 'No phase yet.');
    ui.able($('#ph-tab-atom'), cur ? '' : 'No phase yet.');
    var cb=document.querySelector('[data-atomic-constraints]');if(cb){ui.able(cb,cur && cur.atoms.length?'':'Select a phase with atoms.');cb.textContent='Atomic constraints…'+(cur && cur.constraints && cur.constraints.length?' ('+cur.constraints.length+')':'');}
    if (!bar) return;
    bar.innerHTML = S.phases.map(function (ph, i) {
      return '<option value="' + ph.key + '" style="color:' + RV.plots.phaseColor(i) + '"' + (cur === ph ? ' selected' : '') + '>' + esc(ph.name) + '</option>';
    }).join('');
    bar.disabled = !cur || S.busy;
    if (cur) $('#ph-color').value = RV.plots.phaseColor(S.phases.indexOf(cur));
  }
  function atomRow(at) {
    return '<tr data-atom="' + esc(at.label) + '"><td><input data-at="label" value="' + esc(at.label) + '" spellcheck="false" autocomplete="off" aria-label="Label"></td>' +
      '<td><input data-at="type" list="scat-list" value="' + esc(at.type) + '" spellcheck="false" autocomplete="off" aria-label="Scatterer of ' + esc(at.label) + '"></td>' +
      ['x', 'y', 'z', 'occ', 'B'].map(function (c) { return '<td><input class="num" data-at="' + c + '" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="' + c + ' of ' + esc(at.label) + '"></td>'; }).join('') +
      '<td class="site"></td><td><button type="button" class="icon-btn" data-act="del-atom" title="Delete ' + esc(at.label) + '" aria-label="Delete ' + esc(at.label) + '">✕</button></td></tr>';
  }
  // the field that had the focus before a rebuild (same id, or same column of the same row of atoms) gets it back
  function focusKey(body) {
    var a = document.activeElement;
    if (!a || !body.contains(a) || !a.matches('input, select')) return null;
    var tr = a.closest('tr[data-atom]');
    return { id: a.id, at: a.getAttribute('data-at'), row: tr ? Array.prototype.indexOf.call(tr.parentNode.children, tr) : -1 };
  }
  function refocus(k) {
    if (!k) return;
    var el = k.id ? document.getElementById(k.id) : null;
    if (!el && k.row >= 0) { var tr = $('#ph-atoms') && $('#ph-atoms').children[k.row]; el = tr && tr.querySelector('[data-at="' + k.at + '"]'); }
    if (el && !el.disabled) { el.focus(); if (el.select) el.select(); }
  }
  function build() {
    var body = $('#phase-body'), ph = St.currentPhase(), fk = focusKey(body);
    renderBar();
    if (!S.sgReady) {
      body.innerHTML = S.sgLoading ? '<div class="empty-pane"><p>Loading the space-group database…</p></div>' :
        '<div class="empty-pane"><p><b>The space-group database is not loaded.</b></p><p>Powder 6 reads sg/all.json and the scattering factors in scatters/: open powder6.html through a web server (for example <code>python -m http.server</code> in its folder), not from the disk.</p></div>';
      return;
    }
    if (!ph) {
      body.innerHTML = '<div class="empty-pane"><p>No phase yet.</p>' +
                       '<p class="hint">Drop a CIF or pdCIF on this window, or type <code>demo</code> in the command line below for a mixture of NaCl and Si measured twice.</p></div>';
      return;
    }
    var cps = C.cellParams(ph.sg.system, ph.sg.uniqueAxis);
    var prof = Object.keys(C.PROFILE_PARAMS).map(function (k) { return '<option value="' + k + '"' + (k === ph.profileType ? ' selected' : '') + '>' + esc(C.PROFILE_LABELS[k] || k) + '</option>'; }).join('');
    var can = St.canRietveld(ph);
    body.innerHTML =
      '<p class="hint phase-src" id="phase-src"></p>' +
      '<div class="phase-cols">' +
        '<section class="pblock"><h2>Phase</h2><div class="form-grid">' +
          '<label for="phase-select">Edit phase</label><div><span class="phase-control-row"><select id="phase-select" aria-label="Phase to edit"></select><input type="color" id="ph-color" data-ph="color" aria-label="Phase colour" title="Change phase colour" value="' + RV.plots.phaseColor(S.phases.indexOf(ph)) + '"></span></div>' +
          '<label for="ph-name">Name</label><div><input id="ph-name" data-ph="name" value="' + esc(ph.name) + '" spellcheck="false" autocomplete="off"></div>' +
          '<label for="ph-sg">Space group</label><div><span class="phase-control-row"><input id="ph-sg" data-ph="sg" list="sg-list" value="' + esc(ph.sg.symbol) + '" spellcheck="false" autocomplete="off" title="Symbol, number or Hall symbol">' +
            '<button type="button" data-act="sg-browse" title="Choose the space group and its setting by crystal system, centring, symbol or number">Browse…</button></span><small id="ph-sg-info"></small></div>' +
          '<label for="ph-prof">Peak shape</label><div><span class="with-btn"><select id="ph-prof" data-ph="profile">' + prof + '</select>' +
            '<button type="button" data-act="preset-load" title="Load a peak-shape preset (a peak-shape JSON file: its shape and parameters)">Load…</button><button type="button" data-act="preset-save" title="Save the shape and the parameters of this phase as a preset (peak-shape JSON)">Save…</button></span>' +
            '<small>Separated CW profiles use one instrument resolution for every phase in a dataset. Calibrate / fix it in Datasets before refining sample size and strain. Legacy profiles remain available for older projects.</small></div>' +
          (C.usesSeparatedProfile(ph) ? ['size','strain'].map(function (kind) {
            var b = C.broadeningConfig(ph.broadening), choices = kind === 'size' ? [['isotropic','Isotropic'],['uniaxial','Uniaxial'],['ellipsoid','Ellipsoidal']] : [['isotropic','Isotropic'],['uniaxial','Uniaxial'],['stephens','Stephens quartic']];
            return '<label>' + (kind === 'size' ? 'Crystallite size' : 'Microstrain') + '</label><div><select data-ph="' + kind + 'Model">' + choices.map(function (p) { return '<option value="'+p[0]+'"'+(b[kind]===p[0]?' selected':'')+'>'+p[1]+'</option>'; }).join('') + '</select>' +
              (b[kind] === 'uniaxial' ? '<small>Reciprocal-space axis (h k l)</small><input data-ph="'+kind+'Axis" value="'+b[kind+'Axis'].join(' ')+'" aria-label="'+kind+' axis">' : '') + '</div>';
          }).join('') : '') +
          '<label>Preferred orientation</label><div><span class="hkl">' + [0, 1, 2].map(function (i) { return '<input class="num" data-ph="po' + i + '" value="' + ph.poDir[i] + '" inputmode="decimal" autocomplete="off" aria-label="' + 'hkl'.charAt(i) + ' of the orientation direction">'; }).join('') +
          '</span><small>March–Dollase along this direction; PO r = 1 (Parameters) is no orientation.</small></div>' +
        '</div></section>' +
        '<section class="pblock"><h2>Cell</h2><div class="cell-grid">' + CELL.map(function (c) {
          var on = cps.indexOf(c) >= 0;
          return '<label for="ph-c-' + c + '">' + CELL_LABEL[c] + '</label><input id="ph-c-' + c + '" class="num" data-cell="' + c + '"' + (on ? '' : ' disabled title="Set by the crystal system"') +
                 ' inputmode="decimal" autocomplete="off" spellcheck="false"><span class="u">' + (/^[abc]$/.test(c) ? 'Å' : '°') + '</span>';
        }).join('') + '</div><dl class="cell-info" id="ph-cell-info"></dl></section>' +
      '</div>' +
      '<section class="pblock atoms-block"><h2>Atoms <span class="sub" id="ph-atoms-n"></span></h2>' +
        '<p class="hint">Atomic model of the selected calculation dataset (or the starting model when no dataset holds the selection). Le Bail and WPPF use the cell; Rietveld uses the atoms.</p>' +
        '<div class="table-wrap"><table class="grid atoms"><thead><tr><th>Label</th><th>Scatterer</th><th>x</th><th>y</th><th>z</th><th>Occ.</th><th>B /Å²</th>' +
        '<th title="Wyckoff position (multiplicity and letter) and the coordinates it allows">Site</th><th></th></tr></thead><tbody id="ph-atoms">' +
        (ph.atoms.map(atomRow).join('') || '<tr><td colspan="9" class="hint">No atoms: Le Bail and WPPF use the cell and space group. Add atoms or import a CIF for Rietveld.</td></tr>') +
        '</tbody></table></div><p class="buttons"><button type="button" data-act="atom">Add atom…</button></p>' +
        '<p class="hint">x, y, z are fractional. A coordinate in grey is set by the site of the atom (shown on the right); typing a value there moves the atom off that site. Occ. is the fraction of the site occupied.</p></section>' +
      (ph.atoms.length ? '<section class="pblock constraints-block"><h2>Atomic constraints <span class="sub" id="ph-ac-n"></span></h2>' +
        '<p class="hint">GSAS-II relationships between the atomic parameters of ' + esc(ph.name) + ': hold, equivalence and constraint equation. Rietveld applies them exactly in every dataset' + (ph.method === 'rietveld' ? '' : '; ' + esc(ph.name) + ' is fitted by ' + esc(C.METHOD_LABELS[ph.method]) + ' now, so they are kept but unused') + '. Constrained parameters are marked in Parameters.</p>' +
        '<div id="ph-ac"></div></section>' : '');
    if (RV.constraints && $('#ph-ac')) RV.constraints.mount($('#ph-ac'), ph);
    var acn = $('#ph-ac-n'); if (acn) acn.textContent = ph.constraints && ph.constraints.length ? ph.constraints.length + (ph.constraints.length === 1 ? ' relationship' : ' relationships') : '';
    renderBar();
    values();
    refocus(fk);
  }

  // ---------------------------------------------------------------- values (inputs keep focus: only their content changes)
  function values() {
    var ph = St.currentPhase();
    if (!ph || !$('#ph-name')) return;
    var s = src(), e = srcEsd(), act = document.activeElement, ds = srcDs(ph), list = St.selected(), n = list.filter(function (d) { return St.hasPhase(d, ph); }).length, k = ph.key + '.';
    function put(el, v, dec, esd) {
      if (!el) return;
      if (el !== act) { el.value = fmtNum(v, dec); el.classList.remove('invalid'); }
      el.classList.toggle('has-esd', esd > 0);
      if (el.dataset.tip == null) el.dataset.tip = el.title || '';
      el.title = esd > 0 ? (el.dataset.tip ? el.dataset.tip + '. ' : '') + 'Standard uncertainty ' + ui.fmt(esd, 2) : el.dataset.tip;
    }
    var held = St.holdersOf(ph), others = list.length - n;
    $('#phase-src').textContent = ds ? C.METHOD_LABELS[S.calculation] + ' · ' + ds.name + ' · Same numerical values as Parameters. Edits affect this dataset; phase definitions are shared.' : 'Starting model · Select a dataset holding this phase to edit or inspect its calculation values.';
    if (act !== $('#ph-name')) $('#ph-name').value = ph.name;
    if (act !== $('#ph-color')) $('#ph-color').value = RV.plots.phaseColor(S.phases.indexOf(ph));
    if (act !== $('#ph-sg')) { $('#ph-sg').value = ph.sg.symbol; $('#ph-sg').classList.remove('invalid'); }
    $('#ph-sg-info').textContent = 'No. ' + ph.sg.number + ', ' + ph.sg.system + (ph.sg.laue ? ', Laue class ' + ph.sg.laue : '') +
      (ph.sg.setting ? ', setting ' + ph.sg.setting : '') + ', ' + ph.ops.length + ' operators' + (ph.sg.hall ? ', Hall ' + ph.sg.hall : '');
    var cell = St.cellOf(ph, s);
    CELL.forEach(function (c) { var el = $('#ph-c-' + c); put(el, cell ? cell[c] : s[k + c], DEC.cell, e[k + c]); });
    var ct = content(ph, s);
    $('#ph-cell-info').innerHTML = '<dt>Volume</dt><dd>' + (Number.isFinite(ct.V) ? ct.V.toFixed(3) + ' Å³' : '—') + '</dd>' +
      '<dt>Cell content</dt><dd>' + (esc(ct.formula) || '—') + '</dd>' +
      '<dt>Cell mass</dt><dd>' + (ct.mass > 0 ? ct.mass.toFixed(2) + ' g/mol' : '—') + '</dd>' +
      '<dt>Density</dt><dd>' + (ct.density > 0 ? ct.density.toFixed(4) + ' g/cm³' : '—') + (ct.missing.length ? ' <span class="why">(no atomic weight for ' + esc(ct.missing.join(', ')) + ')</span>' : '') + '</dd>';
    $('#ph-atoms-n').textContent = ph.atoms.length ? ph.atoms.length + (ph.atoms.length === 1 ? ' site' : ' sites') : '';
    var rad = ds ? ds.inst.radiation : (St.first() || S.datasets[0] ? (St.first() || S.datasets[0]).inst.radiation : S.settings.inst.radiation);
    document.querySelectorAll('#ph-atoms tr[data-atom]').forEach(function (tr) {
      var label = tr.getAttribute('data-atom'), at = ph.atoms.filter(function (a) { return a.label === label; })[0];
      if (!at) return;
      var pre = k + at.label + '.';
      ['x', 'y', 'z'].forEach(function (c, i) {
        var el = tr.querySelector('[data-at="' + c + '"]'), role = St.coordRole(at.site, i);
        el.classList.toggle('linked', role !== 'free');
        el.dataset.tip = role === 'free' ? '' : (role === 'fixed' ? c + ' is fixed' : c + ' follows the free coordinates') + ' by site ' + at.site.wyck + ' (' + at.site.expr + '). ' + (ds ? 'This is a shared site definition; deselect datasets to move the atom off the site in the starting model.' : 'Type a value to move the atom off this site.');
        put(el, s[pre + c], DEC[c], e[pre + c]);
        if(ds && ds.stats && ds.stats.uncertaintyIssues && ds.stats.uncertaintyIssues[pre+c])el.title=ds.stats.uncertaintyIssues[pre+c];
      });
      put(tr.querySelector('[data-at="occ"]'), s[pre + 'occ'], DEC.occ, e[pre + 'occ']);
      put(tr.querySelector('[data-at="B"]'), s[pre + 'B'], DEC.B, e[pre + 'B']);
      var ty = tr.querySelector('[data-at="type"]'), f = St.scatterer(at.type);
      if (ty !== act) ty.value = at.type;
      var miss = S.tables && (rad === 'neutron' ? !f.nlabel : !f.xray);
      ty.classList.toggle('invalid', !!miss);
      ty.title = !S.tables ? 'The scattering factors are not loaded.' : miss ? at.type + ' is not in the ' + (rad === 'neutron' ? 'neutron' : 'X-ray') + ' table: this atom scatters nothing.' :
        (rad === 'neutron' ? 'b = ' + f.neutron + ' fm (' + f.nlabel + ')' : 'X-ray form factor of ' + f.xlabel + (/\d[+-]$|[+-]\d+$/.test(at.type) && f.xlabel===St.elementOf(at.type) ? ' (neutral fallback: no ionic entry for '+at.type+' in the loaded table).' : ''));
      var lb = tr.querySelector('[data-at="label"]');
      if (lb !== act) lb.value = at.label;
      tr.querySelector('.site').innerHTML = '<span class="wy">' + esc(at.site.wyck) + '</span> <code>' + esc(at.site.expr) + '</code>';
    });
  }

  // ---------------------------------------------------------------- edits
  function busy() { if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); values(); return true; } return false; }
  function bad(el, msg) { el.classList.add('invalid'); ui.toast(msg, 'warn'); }
  function phaseField(ph, el) {
    var broadKey = el.getAttribute('data-ph');
    if (/^(size|strain)(Model|Axis)$/.test(broadKey)) {
      var broad = C.broadeningConfig(ph.broadening), kind = broadKey.indexOf('size') === 0 ? 'size' : 'strain';
      if (/Axis$/.test(broadKey)) {
        var axis = el.value.trim().split(/[ ,]+/).map(Number);
        if (axis.length !== 3 || !axis.every(Number.isFinite) || !axis.some(function (v) { return v !== 0; })) { bad(el,'Enter three numbers for a nonzero reciprocal-space axis.'); return; }
        broad[kind+'Axis'] = axis;
      } else broad[kind] = el.value;
      RV.history.take('sample broadening model of ' + ph.name);
      ph.broadening = C.broadeningConfig(broad); St.phaseChanged(ph); return;
    }
    var f = el.getAttribute('data-ph'), v = el.value.trim();
    if (f === 'color') { if (!/^#[0-9a-f]{6}$/i.test(v)) return; RV.history.take('phase colour'); ph.color = v; RV.bus.emit('phaseStyle'); return; }
    if (f === 'name') {
      if (!v || v === ph.name) { el.value = ph.name; return; }
      RV.history.take('renaming phase ' + ph.name);
      var old = ph.name; ph.name = v;
      RV.bus.emit('phases');
      ui.toast('Phase ' + old + ' renamed ' + v + '.', 'info');
    } else if (f === 'sg') {
      var sg = St.resolveSG(v);
      if (!sg) { bad(el, 'Space group not recognised: ' + v + '. Type a symbol (P 21/c, Fm-3m), a number or a Hall symbol.'); return; }
      if (sg.hall === ph.sg.hall) { values(); return; }
      RV.history.take('space group of ' + ph.name);
      St.setPhaseSG(ph, sg);
      ui.toast('Space group of ' + ph.name + ': ' + sg.symbol + ' (' + sg.number + '), ' + sg.system + '. Sites of the ' + ph.atoms.length + ' atoms worked out again.', 'ok');
    } else if (f === 'profile') {
      if (v === ph.profileType) return;
      RV.history.take('peak shape of ' + ph.name);
      ph.profileType = v;
      St.phaseChanged(ph);
      ui.toast('Peak shape of ' + ph.name + ': ' + (C.PROFILE_LABELS[v] || v) + '. Its parameters start from their default values.', 'info');
    } else if (/^po\d$/.test(f)) {
      var i = +f.slice(2), x = ui.parseNum(v), dir = ph.poDir.slice();
      dir[i] = x;
      if (!dir.every(Number.isFinite) || dir.every(function (q) { return q === 0; })) { bad(el, 'The orientation direction needs three numbers, not all zero.'); return; }
      if (dir[i] === ph.poDir[i]) return;
      RV.history.take('orientation direction of ' + ph.name);
      ph.poDir = dir;
      St.phaseChanged(ph);
      ui.toast('Preferred orientation of ' + ph.name + ' along (' + dir.join(' ') + ').', 'info');
    }
  }
  function cellField(ph, el) {
    var c = el.getAttribute('data-cell'), v = ui.parseNum(el.value), name = ph.key + '.' + c;
    if (!(v > 0) || (!/^[abc]$/.test(c) && !(v < 180))) { bad(el, 'Not a valid ' + (/^[abc]$/.test(c) ? 'length' : 'angle') + ': ' + el.value + '.'); return; }
    if (v === src()[name]) return;
    RV.history.take('cell of ' + ph.name, { merge: 'cell ' + name });
    setNumeric(ph,name,v);
    ui.toast(ph.name + ': ' + CELL_LABEL[c] + ' = ' + v + (/^[abc]$/.test(c) ? ' Å.' : '°.'), 'info', 'cell ' + name);
  }
  function moveToSite(ph, at, site) {
    var pre = ph.key + '.' + at.label + '.', pos = site.pos;
    at.site = site;
    ph.v[pre + 'x'] = pos[0]; ph.v[pre + 'y'] = pos[1]; ph.v[pre + 'z'] = pos[2];
    St.phaseChanged(ph);
  }
  function coordField(ph, at, comp, v) {
    var i = 'xyz'.indexOf(comp), pre = ph.key + '.' + at.label + '.', s = src(), role = St.coordRole(at.site, i);
    var xyz = [s[pre + 'x'], s[pre + 'y'], s[pre + 'z']];
    if (xyz[i] === v) return;
    xyz[i] = v;
    var cell = St.cellOf(ph, s), pos = role === 'free' ? C.sitePosition(at.site, xyz) : xyz, site = St.siteOf(ph, pos, cell);
    RV.history.take('position of ' + at.label);
    if (role === 'free' && site.stab === at.site.stab) {
      if(setNumeric(ph,pre + comp,v)===false)return;
      ui.toast(at.label + ': ' + comp + ' = ' + v + '.', 'info');
      return;
    }
    if (srcDs()) { ui.toast('This move changes the shared Wyckoff-site definition. Deselect datasets to edit that shared definition.', 'warn'); values(); return; }
    moveToSite(ph, at, site);
    ui.toast(at.label + ' is now on ' + site.wyck + ' (' + site.expr + ')' + (site.free.length ? ', free: ' + site.free.map(function (f) { return 'xyz'.charAt(f); }).join(', ') : ', no free coordinate') + '.', 'info');
  }
  function atomField(ph, label, el) {
    var at = ph.atoms.filter(function (a) { return a.label === label; })[0], f = el.getAttribute('data-at'), raw = el.value.trim();
    if (!at) return;
    if (f === 'label') {
      if (!raw || raw === at.label) { el.value = at.label; return; }
      RV.history.take('renaming atom ' + at.label);
      var nl = St.renameAtom(ph, at.label, raw);
      ui.toast('Atom ' + label + ' renamed ' + nl + '.', 'info');
    } else if (f === 'type') {
      if (!raw || raw === at.type) { el.value = at.type; return; }
      RV.history.take('scatterer of ' + at.label);
      at.type = raw;
      St.phaseChanged(ph);
      var sc = St.scatterer(raw);
      var fallback=S.tables && sc.xray && /\d[+-]$|[+-]\d+$/.test(raw) && sc.xlabel===St.elementOf(raw);
      ui.toast(at.label + ' requests ' + raw + (S.tables && !sc.xray ? ', which is not in the X-ray table' : fallback ? '; the loaded table has no ionic entry, so X-rays use neutral '+sc.xlabel : sc.xray ? '; X-rays use '+sc.xlabel : '') + '.', S.tables && (!sc.xray || fallback) ? 'warn' : 'info');
    } else {
      var v = ui.parseNum(raw);
      if (!Number.isFinite(v)) { bad(el, 'Not a number: ' + raw + '.'); return; }
      if ('xyz'.indexOf(f) >= 0) { coordField(ph, at, f, v); return; }
      var name = ph.key + '.' + at.label + '.' + f;
      if (v === src()[name]) return;
      RV.history.take(f + ' of ' + at.label, { merge: 'atom ' + name });
      if(setNumeric(ph,name,v)===false)return;
      ui.toast(at.label + ': ' + (f === 'occ' ? 'occupancy' : 'B') + ' = ' + v + (f === 'B' ? ' Å².' : '.'), 'info', 'atom ' + name);
    }
  }
  function onChange(e) {
    var el = e.target, ph = St.currentPhase();
    if (el.id === 'phase-select') { if (!busy()) St.selectPhase(el.value); return; }
    if (!ph || !el.matches('input, select')) return;
    if (busy()) return;
    if (el.hasAttribute('data-ph')) phaseField(ph, el);
    else if (el.hasAttribute('data-cell')) cellField(ph, el);
    else if (el.hasAttribute('data-at')) atomField(ph, el.closest('tr').getAttribute('data-atom'), el);
  }
  function onClick(e) {
    var chip = e.target.closest('.chip[data-key]');
    if (chip) { St.selectPhase(chip.getAttribute('data-key')); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var a = b.getAttribute('data-act'), ph = St.currentPhase();
    if (a === 'new') RV.cmd.newPhase();
    else if (a === 'cif') RV.cmd.readStructure();
    else if (a === 'map') RV.cmd.phaseMap();
    else if (a === 'simulate') RV.cmd.simulate();
    else if (a === 'orientation') RV.cmd.orientation();
    else if (a === 'atom') RV.cmd.addAtom();
    else if (a === 'del-phase') RV.cmd.deletePhase();
    else if (a === 'sg-browse' && ph && !busy()) openBrowser(ph);
    else if (a === 'preset-load' && ph && !busy()) RV.cmd.loadPreset();
    else if (a === 'preset-save' && ph) RV.cmd.savePreset();
    else if (a === 'del-atom' && ph && !busy()) {
      var label = b.closest('tr').getAttribute('data-atom');
      RV.history.take('deleting atom ' + label);
      var switched = St.removeAtom(ph, label);
      ui.toast('Atom ' + label + ' deleted from ' + ph.name + '.' + (switched ? ' It was the last one: ' + ph.name + ' is now fitted by Le Bail.' : ''), switched ? 'warn' : 'info');
    }
  }

  // the space-group browser (spacegroup_ui.js); Apply sets the space group of the phase it was opened for
  var browsing = null;
  function openBrowser(ph) {
    if (typeof SGM === 'undefined' || !S.sgReady) { ui.toast('The space-group database is not loaded.', 'warn'); return; }
    browsing = ph.key;
    SGM.open({ number: ph.sg.number, hall: ph.sg.hall });
  }
  function applyBrowsed(rec) {
    var ph = St.phaseByKey(browsing);
    browsing = null;
    if (!ph || !rec) return;
    if (S.busy) { ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    var sg = St.resolveSG(rec.number, rec.hall);
    if (!sg) { ui.toast('Space group ' + (rec.symbol || rec.number) + ' could not be set up.', 'err'); return; }
    if (sg.hall === ph.sg.hall) { ui.toast(ph.name + ' is already in ' + St.sgText(sg) + '.', 'info'); return; }
    RV.history.take('space group of ' + ph.name);
    St.setPhaseSG(ph, sg);
    ui.toast('Space group of ' + ph.name + ': ' + sg.symbol + ' (' + sg.number + '), ' + sg.system + (sg.setting ? ', setting ' + sg.setting : '') + '. Sites of the ' + ph.atoms.length + ' atoms worked out again.', 'ok');
  }

  function init() {
    var pane = $('#pane-phases');
    if (typeof SGM !== 'undefined') SGM.wire(applyBrowsed);
    RV.bus.on('phaseStyle', function () { renderBar(); values(); });
    pane.addEventListener('change', onChange);
    pane.addEventListener('click', onClick);
    pane.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && e.target.matches('#phase-body input')) { e.target.blur(); values(); }
    });
    ['phases', 'phaseSel', 'tables'].forEach(function (ev) { RV.bus.on(ev, build); });
    ['params', 'selection', 'stats', 'data', 'datasets'].forEach(function (ev) { RV.bus.on(ev, values); });
    // a running fit owns the values: the editor is locked until it ends
    RV.bus.on('busy', function (b) {
      if (b) document.querySelectorAll('#pane-phases input, #pane-phases select, #pane-phases .phase-bar button[data-act]').forEach(function (el) { el.disabled = true; });
      else { document.querySelectorAll('#pane-phases .phase-bar button[data-act]').forEach(function (el) { el.disabled = false; }); build(); }
    });
    build();
  }

  return { init: init, build: build, values: values, content: content };
})();
