/* Shared phase definitions and starting values. Dataset values live in Datasets. */
RV.phasesTab = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui, esc = ui.esc, C = RVCore;
  var CELL = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'], CELL_LABEL = { a: 'a', b: 'b', c: 'c', alpha: 'α', beta: 'β', gamma: 'γ' };
  var DEC = { cell: 6, x: 6, y: 6, z: 6, occ: 4, B: 4 };
  function $(s) { return document.querySelector(s); }
  // Phase edits change the starting model, never an existing dataset instance.
  function srcDs() { return null; }
  function src() { var d = srcDs(), ph = St.currentPhase(); return d ? d.p : ph ? ph.v : {}; }
  function srcEsd() { var d = srcDs(); return d ? d.esd || {} : {}; }
  function setNumeric(ph,name,value) { var d=srcDs(); return St.setParam(name,value,d ? [d] : [],!d); }
  function fmtNum(v, dec) { return Number.isFinite(v) ? String(+v.toFixed(dec)) : ''; }
  function fmtCount(n) { var r = Math.round(n); return Math.abs(n - r) < 1e-6 ? (r === 1 ? '' : String(r)) : String(+n.toFixed(3)); }

  // cell volume, content, mass and density of a phase with the values v
  function content(ph, v, atoms) {
    atoms = atoms || v;
    var cell = St.cellOf(ph, v), counts = {}, order = [], mass = 0, missing = [];
    ph.atoms.forEach(function (at) {
      var pre = ph.key + '.' + at.label + '.', n = (Number.isFinite(atoms[pre + 'occ']) ? atoms[pre + 'occ'] : 1) * at.site.mult;
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
        '<div class="empty-pane"><p><b>The space-group database is not loaded.</b></p><p>Powder 6 reads sg/all.json and the scattering factors in scatters/: open index.html through a web server (for example <code>python -m http.server</code> in its folder), not from the disk.</p></div>';
      return;
    }
    if (!ph) {
      body.innerHTML = '<div class="empty-pane"><p>No phase yet.</p>' +
                       '<p class="hint">Drop a CIF or pdCIF on this window, or type <code>demo</code> in the command line below for a mixture of NaCl and Si measured twice.</p></div>';
      return;
    }
    var cps = C.cellParams(ph.sg.system, ph.sg.uniqueAxis);
    var can = St.canRietveld(ph);
    body.innerHTML =
      '<p class="hint phase-src" id="phase-src"></p>' +
      '<div class="phase-cols">' +
        '<section class="pblock"><h2>Phase</h2><div class="form-grid">' +
          '<label for="phase-select">Phase name</label><div><span class="phase-control-row phase-name-row"><select id="phase-select" aria-label="Phase name"></select><input type="color" id="ph-color" data-ph="color" aria-label="Phase colour" title="Change phase colour" value="' + RV.plots.phaseColor(S.phases.indexOf(ph)) + '"><button type="button" id="ph-rename" data-act="rename-phase" title="Rename this phase">Edit</button></span></div>' +
          '<label for="ph-sg">Space group</label><div><span class="phase-control-row phase-sg-row"><input id="ph-sg" data-ph="sg" list="sg-list" value="' + esc(ph.sg.symbol) + '" spellcheck="false" autocomplete="off" title="Symbol, number or Hall symbol">' +
            '<button type="button" data-act="sg-convert" title="Describe this structure in another space group or setting: the cell, the atomic positions and the values of every dataset are transformed with it">Convert…</button>' +
            '<button type="button" data-act="sg-browse" title="Choose the space group and its setting by crystal system, centring, symbol or number">Browse…</button></span><small id="ph-sg-info"></small></div>' +
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
        '<p class="hint" id="ph-atom-src"></p>' +
        '<div class="table-wrap"><table class="grid atoms"><thead><tr><th>Label</th><th>Scatterer</th><th>x</th><th>y</th><th>z</th><th>Occ.</th><th>B /Å²</th>' +
        '<th title="Wyckoff position (multiplicity and letter) and the coordinates it allows">Site</th><th></th></tr></thead><tbody id="ph-atoms">' +
        (ph.atoms.map(atomRow).join('') || '<tr><td colspan="9" class="hint">No atoms: Le Bail and WPPF use the cell and space group. Add atoms or import a CIF for Rietveld.</td></tr>') +
        '</tbody></table></div><p class="buttons"><button type="button" data-act="atom">Add atom…</button></p>' +
        '<p class="hint">x, y, z are fractional. A coordinate in grey is set by the site of the atom (shown on the right); typing a value there moves the atom off that site. Occ. is the fraction of the site occupied.</p></section>' +
      (ph.atoms.length ? '<section class="pblock constraints-block"><h2>Atomic constraints <span class="sub" id="ph-ac-n"></span></h2>' +
        '<p class="hint">GSAS-II relationships between the atomic parameters of ' + esc(ph.name) + ': hold, equivalence and constraint equation. Rietveld applies them exactly in every dataset' + (ph.method === 'rietveld' ? '' : '; ' + esc(ph.name) + ' is fitted by ' + esc(C.METHOD_LABELS[ph.method]) + ' now, so they are kept but unused') + '. Constrained parameters are marked in Parameters.</p>' +
        '<div id="ph-ac"></div></section>' : '');
    if ($('#ph-ac')) $('#ph-ac').innerHTML='<p class="hint">'+(ph.constraints || []).map(function(c){return esc(AtomicConstraints.text(c));}).join('; ')+'</p><button type="button" data-edit-method>Edit constraints in Datasets →</button>';
    var acn = $('#ph-ac-n'); if (acn) acn.textContent = ph.constraints && ph.constraints.length ? ph.constraints.length + (ph.constraints.length === 1 ? ' relationship' : ' relationships') : '';
    renderBar();
    values();
    refocus(fk);
  }

  // ---------------------------------------------------------------- values (inputs keep focus: only their content changes)
  function values() {
    var ph = St.currentPhase();
    if (!ph || !$('#phase-select')) return;
    var s = src(), e = srcEsd(), act = document.activeElement, ds = srcDs(ph), list = St.selected(), n = list.filter(function (d) { return St.hasPhase(d, ph); }).length, k = ph.key + '.';
    var atoms = ds ? St.atomicValues(ds) : s, inactive = !!ds && S.calculation !== 'rietveld';
    function put(el, v, dec, esd) {
      if (!el) return;
      if (el !== act) { el.value = fmtNum(v, dec); el.classList.remove('invalid'); }
      el.classList.toggle('has-esd', esd > 0);
      if (el.dataset.tip == null) el.dataset.tip = el.title || '';
      el.title = esd > 0 ? (el.dataset.tip ? el.dataset.tip + '. ' : '') + 'Standard uncertainty ' + ui.fmt(esd, 2) : el.dataset.tip;
    }
    var held = St.holdersOf(ph), others = list.length - n;
    $('#phase-src').textContent = 'Shared phase definition and starting model. Existing dataset values and refinement flags are edited only in Datasets.';
    $('#ph-atom-src').textContent = inactive ? 'Rietveld atomic model of '+ds.name+' · Unused by '+C.METHOD_LABELS[S.calculation]+'. Switch to Rietveld to edit or refine atomic values.' : ds ? 'Rietveld atomic model of '+ds.name+'. Atomic values are used and refined in Rietveld.' : 'Atomic starting model. Rietveld uses the atoms; Le Bail and WPPF use the cell and space group.';
    if (act !== $('#ph-color')) $('#ph-color').value = RV.plots.phaseColor(S.phases.indexOf(ph));
    if (act !== $('#ph-sg')) { $('#ph-sg').value = ph.sg.symbol; $('#ph-sg').classList.remove('invalid'); }
    $('#ph-sg-info').textContent = 'No. ' + ph.sg.number + ', ' + ph.sg.system + (ph.sg.laue ? ', Laue class ' + ph.sg.laue : '') +
      (ph.sg.setting ? ', setting ' + ph.sg.setting : '') + ', ' + ph.ops.length + ' operators' + (ph.sg.hall ? ', Hall ' + ph.sg.hall : '');
    var cell = St.cellOf(ph, s);
    CELL.forEach(function (c) { var el = $('#ph-c-' + c); put(el, cell ? cell[c] : s[k + c], DEC.cell, e[k + c]); });
    var ct = content(ph, s, atoms);
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
        el.readOnly = inactive;
        el.dataset.tip = inactive ? 'Rietveld atomic value; unused by '+C.METHOD_LABELS[S.calculation]+'.' : role === 'free' ? '' : (role === 'fixed' ? c + ' is fixed' : c + ' follows the free coordinates') + ' by site ' + at.site.wyck + ' (' + at.site.expr + '). ' + (ds ? 'This is a shared site definition; deselect datasets to move the atom off the site in the starting model.' : 'Type a value to move the atom off this site.');
        put(el, atoms[pre + c], DEC[c], inactive ? null : e[pre + c]);
        if(!inactive && ds && ds.stats && ds.stats.uncertaintyIssues && ds.stats.uncertaintyIssues[pre+c])el.title=ds.stats.uncertaintyIssues[pre+c];
      });
      ['occ','B'].forEach(function(comp){var el=tr.querySelector('[data-at="'+comp+'"]');el.readOnly=inactive;el.dataset.tip=inactive?'Rietveld atomic value; unused by '+C.METHOD_LABELS[S.calculation]+'.':'';put(el,atoms[pre+comp],DEC[comp],inactive?null:e[pre+comp]);});
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
    if (f === 'sg') {
      var sg = St.resolveSG(v);
      if (!sg) { bad(el, 'Space group not recognised: ' + v + '. Type a symbol (P 21/c, Fm-3m), a number or a Hall symbol.'); return; }
      if (sg.hall === ph.sg.hall) { values(); return; }
      RV.history.take('space group of ' + ph.name);
      St.setPhaseSG(ph, sg);
      ui.toast('Space group of ' + ph.name + ': ' + sg.symbol + ' (' + sg.number + '), ' + sg.system + '. Sites of the ' + ph.atoms.length + ' atoms worked out again.', 'ok');
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
      if (srcDs() && S.calculation !== 'rietveld') { ui.toast('Switch to Rietveld to edit atomic values. They are unused by '+C.METHOD_LABELS[S.calculation]+'.','info'); values(); return; }
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
  async function renamePhase(ph) {
    var key=ph.key,v=await ui.prompt('Rename phase',[{key:'name',label:'Phase name',type:'text',value:ph.name}],'Rename',null,{check:function(v){return v.name.trim()?'':'Enter a phase name.';}});
    if(!v || busy())return;
    ph=St.phaseByKey(key);if(!ph || v.name.trim()===ph.name)return;
    RV.history.take('renaming phase '+ph.name);ph.name=v.name.trim();RV.bus.emit('phases');
  }
  function onClick(e) {
    var chip = e.target.closest('.chip[data-key]');
    if (chip) { St.selectPhase(chip.getAttribute('data-key')); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var a = b.getAttribute('data-act'), ph = St.currentPhase();
    if (a === 'new') RV.cmd.newPhase();
    else if (a === 'cif') RV.cmd.readStructure();
    else if (a === 'simulate') RV.cmd.simulate();
    else if (a === 'orientation') RV.cmd.orientation();
    else if (a === 'atom') RV.cmd.addAtom();
    else if (a === 'rename-phase' && ph && !busy()) renamePhase(ph);
    else if (a === 'sg-browse' && ph && !busy()) openBrowser(ph);
    else if (a === 'sg-convert' && ph && !busy()) convertDialog(ph);
    else if (a === 'preset-load' && ph && !busy()) {RV.app.showTab('datasets');RV.cmd.loadPreset();}
    else if (a === 'preset-save' && ph) RV.cmd.savePreset();
    else if (a === 'del-atom' && ph && !busy()) {
      var label = b.closest('tr').getAttribute('data-atom');
      RV.history.take('deleting atom ' + label);
      var switched = St.removeAtom(ph, label);
      ui.toast('Atom ' + label + ' deleted from ' + ph.name + '.' + (switched ? ' It was the last one: ' + ph.name + ' is now fitted by Le Bail.' : ''), switched ? 'warn' : 'info');
    }
  }

  // ---------------------------------------------------------------- conversion to another space group (js/sg_convert.js)
  function atomList(ph, v) {
    return ph.atoms.map(function (a) {
      var pre = ph.key + '.' + a.label + '.', val = function (c) { return Number.isFinite(v[pre + c]) ? v[pre + c] : ph.v[pre + c]; };
      return { label: a.label, type: a.type, x: val('x'), y: val('y'), z: val('z'), occ: val('occ'), B: val('B') };
    });
  }
  function cellText(c) { return c ? ['a', 'b', 'c'].map(function (k) { return c[k].toFixed(4); }).join(', ') + ' Å; ' + ['alpha', 'beta', 'gamma'].map(function (k) { return c[k].toFixed(3); }).join(', ') + '°' : '—'; }
  // f: { target, mode ('auto' | 'manual'), basis, shift, tol } -> everything the preview shows and the conversion needs
  function convertPlan(ph, f) {
    var K = SGConvert, sg = St.resolveSG(String(f.target || '').trim(), String(f.target || '').trim());
    if (!sg) return { error: 'Space group not recognised: "' + f.target + '". Type a symbol (P 21/n, Fm-3m), a number or a Hall symbol.' };
    var model = symmetryModel(ph, {source:f.source || 'start'});
    var cell = model.cell, norm = function (c) { return normaliseCell(c, sg.system, sg.uniqueAxis); }, t, others = 0;
    if (f.mode === 'auto') {
      if (sg.hall === ph.sg.hall) return { sg: sg, idle: true, error: ph.name + ' is in ' + St.sgText(sg) + (sg.setting ? ', setting ' + sg.setting : '') + ' now. Choose the new space group above (Find narrows the list); to move only the origin or the axes within this group, choose Enter it.' };
      var found = K.findTransforms(ph.ops, sg.ops, cell, { normalise: norm });
      if (!found.length) return { sg: sg, error: 'No change of axes (entries −1, 0, 1) and origin (in eighths) relates ' + St.sgText(ph.sg) + ' and ' + St.sgText(sg) +
        ' with a cell that fits the ' + sg.system + ' metric within 3 %. The new group must be a subgroup, a supergroup or another setting of the old one, in a compatible cell; otherwise enter the transformation (for example a centred or doubled cell) by hand.' };
      t = found[0]; others = found.length - 1;
    } else {
      var P = K.parseBasis(f.basis), p = K.parseShift(f.shift);
      if (!P) return { sg: sg, error: 'New axes: write three vectors in the old axes, e.g. "a+b,-a+b,c" or "2a,b,c"; they must not be coplanar.' };
      if (!p) return { sg: sg, error: 'New origin: three numbers in the old axes, e.g. "0,0,0" or "1/8,1/8,1/8".' };
      var nc = K.transformCell(cell, P);
      t = { P: P, p: p, relation: K.relation(ph.ops, sg.ops, P, p), cell: nc, misfit: K.metricMisfit(nc, norm) };
    }
    var newCell = norm(t.cell);
    if (!newCell) return { sg: sg, error: 'The transformed cell cannot be given the ' + sg.system + ' metric.' };
    var conv = K.convertStructure(model.atoms, ph.ops, sg.ops, cell, t.P, t.p, { tol: f.tol, cell: newCell });
    // every dataset's own (refined) positions must have the new symmetry too
    var dsBad = [];
    if (!conv.violations.length && t.relation !== 'same' && t.relation !== 'subgroup') St.holdersOf(ph).forEach(function (d) {
      var ownModel=symmetryModel(ph,{source:String(d.id)}),c=ownModel.cell;
      var r = K.convertStructure(ownModel.atoms, ph.ops, sg.ops, c, t.P, t.p, { tol: f.tol, cell: norm(K.transformCell(c, t.P)) });
      if (r.violations.length) dsBad.push(d.name + ': ' + r.violations[0]);
    });
    return { sg: sg, t: t, others: others, conv: conv, cell: cell, newCell: newCell, dsBad: dsBad, det: K.det3(t.P), model:model };
  }
  function previewHTML(ph, plan) {
    var K = SGConvert;
    if (plan.error) return '<p class="' + (plan.idle ? 'hint' : 'warn') + '">' + esc(plan.error) + '</p>';
    var t = plan.t, c = plan.conv, rel = {
      same: 'Another setting of the same group: the structure is unchanged, described in new axes.',
      subgroup: 'A subgroup of ' + St.sgText(ph.sg) + ': every atom is kept; sites the lower symmetry no longer relates are split and refine independently.',
      supergroup: 'A supergroup of ' + St.sgText(ph.sg) + ': atoms the new symmetry relates are merged into one site. This is allowed only because the structure has that symmetry within the tolerance.',
      '': 'With this transformation neither group contains the other: every atom must still find its equivalents.' }[t.relation];
    var split = Object.keys(c.split).map(function (l) { return l + ' → ' + c.split[l] + ' sites'; }), merged = c.merged.map(function (g) { return g.join(' + '); });
    var h = '<div class="convert-preview-body"><p><b>' + esc(St.sgText(ph.sg)) + ' → ' + esc(St.sgText(plan.sg)) + (plan.sg.setting ? ', ' + esc(plan.sg.setting) : '') + '.</b> ' + esc(rel) + '</p>' +
      '<dl class="sv-dl"><dt>New axes</dt><dd>a′, b′, c′ = ' + esc(K.formatBasis(t.P)) + (plan.others ? ' <span class="hint">(' + plan.others + ' other equivalent choice' + (plan.others === 1 ? '' : 's') + ' found; Enter it to use another)</span>' : '') + '</dd>' +
      '<dt>New origin</dt><dd>' + esc(K.formatShift(t.p)) + ' in the old axes</dd>' +
      '<dt>Cell</dt><dd>' + esc(cellText(plan.cell)) + '<br>→ ' + esc(cellText(plan.newCell)) + (Math.abs(Math.abs(plan.det) - 1) > 1e-9 ? ' <span class="hint">(volume × ' + (+Math.abs(plan.det).toFixed(4)) + ')</span>' : '') + '</dd>' +
      (t.misfit > 1e-4 ? '<dt>Metric</dt><dd class="warn">The cell was adjusted by up to ' + (100 * t.misfit).toFixed(2) + ' % to obey the ' + esc(plan.sg.system) + ' metric.</dd>' : '') +
      (plan.det < 0 ? '<dt>Hand</dt><dd class="warn">The new axes are left-handed: the structure is inverted.</dd>' : '') +
      '<dt>Atoms</dt><dd>' + ph.atoms.length + ' → ' + c.atoms.length + ' site' + (c.atoms.length === 1 ? '' : 's') + (split.length ? '; split: ' + esc(split.join(', ')) : '') + (merged.length ? '; merged: ' + esc(merged.join(', ')) : '') + '</dd>' +
      '<dt>Cell content</dt><dd>' + (+c.contentNew.toFixed(3)) + ' atoms' + (Math.abs(c.contentNew - c.contentExpected) > 1e-3 ? ' <span class="warn">(expected ' + (+c.contentExpected.toFixed(3)) + ')</span>' : ', as expected') + '</dd></dl>';
    if(plan.model.dataset)h+='<p class="hint">The phase starting model will use '+esc(plan.model.name)+'. Other datasets retain their own converted Rietveld values.</p>';
    if (c.atoms.length) h += '<div class="table-wrap"><table class="grid compact"><thead><tr><th>New site</th><th>From</th><th>x</th><th>y</th><th>z</th><th>Mult.</th></tr></thead><tbody>' +
      c.atoms.slice(0, 40).map(function (a) { return '<tr><td>' + esc(a.label) + '</td><td>' + esc(a.from.label) + '</td><td>' + a.x.toFixed(5) + '</td><td>' + a.y.toFixed(5) + '</td><td>' + a.z.toFixed(5) + '</td><td>' + a.mult + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (c.atoms.length > 40 ? '<p class="hint">and ' + (c.atoms.length - 40) + ' more.</p>' : '');
    var holders = St.holdersOf(ph).length, notes = [];
    notes.push('The cell and the atoms of ' + (holders ? holders + ' dataset' + (holders === 1 ? '' : 's') + ' (each from its own values) and the starting model' : 'the starting model') + ' are converted; their fit results are cleared. Ctrl+Z undoes the conversion.');
    if (ph.constraints && ph.constraints.length) notes.push(ph.constraints.length + ' atomic constraint(s) refer to the old atoms and are removed.');
    var b = C.broadeningConfig(ph.broadening);
    if (b.size === 'ellipsoid' || b.strain === 'stephens') notes.push('Anisotropic size or Stephens strain coefficients refer to the old axes and Laue class: refine them again.');
    var po = K.hklToNew(ph.poDir, t.P);
    if (po.join() !== ph.poDir.join()) notes.push('Preferred orientation (' + ph.poDir.join(' ') + ') becomes (' + po.join(' ') + ').');
    h += '<p class="hint">' + esc(notes.join(' ')) + '</p>';
    if (c.violations.length) h += '<p class="warn"><b>Not converted: the structure does not have this symmetry.</b> ' + esc(c.violations.slice(0, 4).join(' ')) + (c.violations.length > 4 ? ' (' + (c.violations.length - 4) + ' more)' : '') + ' Raise the tolerance if the structure is only slightly distorted, or choose a subgroup.</p>';
    if (plan.dsBad.length) h += '<p class="warn"><b>Not converted:</b> the refined positions of ' + plan.dsBad.length + ' dataset(s) do not have this symmetry. ' + esc(plan.dsBad.slice(0, 2).join(' ')) + '</p>';
    return h + '</div>';
  }
  // preset (from Find higher symmetry): { hall, basis, shift, tol } — the group and the transformation, entered by hand
  async function convertDialog(ph, preset) {
    if (typeof SGConvert === 'undefined' || !S.sgReady) { ui.toast('The space-group database is not loaded.', 'warn'); return; }
    var key = ph.key, last = null;
    var fields = [
      { key: 'find', label: 'Find', type: 'text', value: '', hint: 'A number or a symbol (14, P21/n, Fm-3m, Pnnn:2): the list below keeps the matches.' },
      { key: 'target', label: 'New space group', type: 'select', value: preset ? preset.hall : ph.sg.hall, options: St.allSettings().map(function (s) { return [s.hall, s.number + ' · ' + s.symbol + ' · ' + s.system + (s.setting && s.setting !== 'standard' ? ' · ' + s.setting : '')]; }),
        hint: 'Every setting of the 230 groups. A subgroup splits sites, a supergroup merges atoms the new symmetry relates, another setting changes only the axes.' },
      { key: 'mode', label: 'Transformation', type: 'select', value: preset ? 'manual' : 'auto', options: [['auto', 'Find it'], ['manual', 'Enter it']] },
      { key:'source',label:'Atomic model',type:'select',value:preset && preset.source || 'start',options:[['start','The starting model (Phases)']].concat(St.holdersOf(ph).map(function(d){return [String(d.id),'Dataset '+d.name+' (Rietveld model)'];})),hint:'The chosen model defines the converted phase starting atoms and cell.' },
      { key: 'basis', label: 'New axes a′, b′, c′', type: 'text', value: preset ? preset.basis : 'a,b,c', when: 'mode:manual', hint: 'In the old axes, e.g. a+b,-a+b,c or 2a,b,c.' },
      { key: 'shift', label: 'New origin', type: 'text', value: preset ? preset.shift : '0,0,0', when: 'mode:manual', hint: 'In the old axes, e.g. 1/8,1/8,1/8.' },
      { key: 'tol', label: 'Tolerance /Å', type: 'number', value: preset && preset.tol ? preset.tol : 0.1, hint: 'How far an atom may move to take the new symmetry (supergroups only).' }
    ];
    function read(body) { var o = {}; fields.forEach(function (f) { var e = body.querySelector('[data-key="' + f.key + '"]'); o[f.key] = f.type === 'number' ? ui.parseNum(e.value) : e.value; }); return o; }
    var res = await ui.prompt('Convert ' + ph.name + ' to another space group', fields, 'Convert',
      'Now ' + esc(St.sgText(ph.sg)) + (ph.sg.setting ? ', ' + esc(ph.sg.setting) : '') + ', ' + ph.atoms.length + ' site' + (ph.atoms.length === 1 ? '' : 's') + '. The structure is expanded to the full cell, carried to the new axes and origin, and reduced again with the new symmetry.',
      { wide: true, after: '<div class="convert-preview" data-convert-preview aria-live="polite"></div>',
        onOpen: function (body) {
          var timer = 0, out = body.querySelector('[data-convert-preview]'), find = body.querySelector('[data-key="find"]'), pick = body.querySelector('[data-key="target"]');
          // Find narrows the list to the matches and selects the setting the text names (P21/n -> P121/n1), else the first match
          find.addEventListener('input', function () {
            var norm = function (s) { return String(s).replace(/\s+/g, '').toLowerCase(); }, q = norm(find.value), named = q ? St.resolveSG(find.value.trim()) : null, first = null, keep = false;
            Array.prototype.forEach.call(pick.options, function (o) {
              var label = o.textContent, hit = !q || (/^\d+$/.test(q) ? label.indexOf(q + ' ·') === 0 : norm(label).indexOf(q) >= 0) || (named && o.value === named.hall);
              o.hidden = !hit; o.disabled = !hit;
              if (hit && !first) first = o;
              if (hit && o.value === pick.value) keep = true;
            });
            if (named && Array.prototype.some.call(pick.options, function (o) { return o.value === named.hall; })) pick.value = named.hall;
            else if (!keep && first) pick.value = first.value;
            find.classList.toggle('invalid', !!q && !first);
          });
          // Enter in Find accepts the match; it does not start the conversion
          find.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick.focus(); } });
          function update() {
            var f = read(body), p = St.phaseByKey(key);
            if (!p) return;
            try { last = convertPlan(p, f); } catch (e) { last = { error: e.message }; }
            out.innerHTML = previewHTML(p, last);
          }
          body.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(update, 200); });
          body.addEventListener('change', function (e) {
            // switching to Enter it starts from the transformation that was found
            if (e.target.getAttribute('data-key') === 'mode' && e.target.value === 'manual' && last && last.t) {
              body.querySelector('[data-key="basis"]').value = SGConvert.formatBasis(last.t.P); body.querySelector('[data-key="shift"]').value = SGConvert.formatShift(last.t.p);
            }
            clearTimeout(timer); update();
          });
          update();
        },
        check: function (v, body) {
          var p = St.phaseByKey(key);
          if (!p) return 'The phase is gone.';
          if (!(v.tol > 0 && v.tol <= 2)) return 'The tolerance is a distance between 0 and 2 Å.';
          var chosen = body.querySelector('[data-key="target"]').selectedOptions[0];
          if (!chosen || chosen.disabled) return 'No space group matches the text in Find.';
          last = convertPlan(p, v);
          body.querySelector('[data-convert-preview]').innerHTML = previewHTML(p, last);
          if (last.error) return last.error;
          if (last.conv.violations.length) return 'The structure does not have the symmetry of ' + St.sgText(last.sg) + ' within ' + v.tol + ' Å (see the preview).';
          if (last.dsBad.length) return 'The refined positions of ' + last.dsBad.length + ' dataset(s) do not have the symmetry of ' + St.sgText(last.sg) + ' (see the preview).';
          return '';
        } });
    if (!res || !last || last.error) return;
    ph = St.phaseByKey(key);
    if (!ph || busy()) return;
    var plan = last, from = St.sgText(ph.sg);
    RV.history.take('convert ' + ph.name + ' to ' + plan.sg.symbol);
    if(plan.model.dataset){
      ['a','b','c','alpha','beta','gamma'].forEach(function(c){ph.v[ph.key+'.'+c]=plan.model.cell[c];});
      ph.atoms.forEach(function(a){['x','y','z','occ','B'].forEach(function(c){var n=ph.key+'.'+a.label+'.'+c;ph.v[n]=plan.model.values[n];});});
    }
    var r = St.convertPhase(ph, plan.sg, plan.conv, plan.t.P, plan.t.p);
    var msg = ph.name + ' converted from ' + from + ' to ' + St.sgText(plan.sg) + ' (a′, b′, c′ = ' + SGConvert.formatBasis(plan.t.P) + '; origin ' + SGConvert.formatShift(plan.t.p) + '): ' +
      ph.atoms.length + ' site' + (ph.atoms.length === 1 ? '' : 's') + ', ' + (r.datasets ? r.datasets + ' dataset' + (r.datasets === 1 ? '' : 's') + (r.banks ? ' and ' + r.banks + ' saved calculation' + (r.banks === 1 ? '' : 's') : '') + ' converted' : 'starting model converted') +
      (r.constraintsDropped ? '; ' + r.constraintsDropped + ' atomic constraint(s) removed' : '') + (r.linksDropped ? '; ' + r.linksDropped + ' parameter link(s) to the old atoms removed' : '') + '. Fit again.';
    ui.toast(msg, r.constraintsDropped || r.linksDropped ? 'warn' : 'ok');
  }

  // ---------------------------------------------------------------- missed symmetry (as ADDSYM in PLATON), handed to Convert
  // one setting per group to name what is found in: the standard one, b-unique cell choice 1, origin choice 2, hexagonal axes
  var standardGroups = null;
  function groupsForSearch() {
    if (standardGroups) return standardGroups;
    var by = {};
    St.allSettings().forEach(function (s) { (by[s.number] = by[s.number] || []).push(s); });
    standardGroups = Object.keys(by).map(function (n) {
      var list = by[n], pick = function (d) { return list.filter(function (s) { return s.setting === d; })[0]; };
      var s = pick('standard') || pick('b1') || pick('b') || pick('origin choice 2') || list[0], g = St.resolveSG(s.symbol, s.hall);
      return g ? Object.assign({}, g) : null;
    }).filter(Boolean);
    return standardGroups;
  }
  // f: { source ('start' or a dataset id), tol (Å), cellTol (% and degrees) } -> the search, its conversion and what it adds
  function symmetryModel(ph,f){
    var ds=f.source==='start'?null:St.byId(+f.source);
    if(f.source!=='start' && !ds)throw new Error('The selected atomic dataset is no longer available.');
    var bank=ds && S.calculation!=='rietveld' && ds.calculations && ds.calculations.rietveld;
    var values=ds?Object.assign({},ph.v,ds.p,bank && bank.p,St.atomicValues(ds)):ph.v;
    var cell=St.cellOf(ph,values) || St.cellOf(ph,ph.v);
    return {dataset:ds,values:values,cell:cell,atoms:atomList(ph,values),name:ds?'Dataset '+ds.name+' (Rietveld model)':'The starting model (Phases)'};
  }
  function symmetrySearch(ph, f, model, r, tolOverride) {
    var K = SGConvert, tol = tolOverride || f.tol,cell=model.cell,atoms=model.atoms;
    var out = { r: r, cell: cell, atoms: atoms, tol: tol,sourceName:model.name,source:f.source };
    if (!r.group) return out;
    out.newCell = r.standardCell;
    out.conv = K.convertStructure(atoms, ph.ops, r.group.ops, cell, r.P, r.p, { tol: tol, cell: out.newCell });
    // symmetry per volume: operators per cell over the cell's volume, so a larger or smaller new cell compares fairly
    out.perOld = r.group.ops.length / Math.abs(K.det3(r.P));
    out.added = out.perOld > ph.ops.length + 1e-9;
    out.higher = out.added && !out.conv.violations.length && r.cellWithinTolerance;
    var cur = ph.ops, curIdx = new Map();
    cur.forEach(function (o) { var k = o.r.map(Math.round).join(','); if (!curIdx.has(k)) curIdx.set(k, []); curIdx.get(k).push(o.t); });
    out.missing = r.ops.filter(function (o) {
      var ts = curIdx.get(o.r.map(function (v) { return Math.round(v); }).join(','));
      return !(ts && ts.some(function (t) { return [0, 1, 2].every(function (k) { var d = o.t[k] - t[k]; return Math.abs(d - Math.round(d)) < 0.02; }); }));
    });
    out.centring = cur.filter(function (o) { return o.r.every(function (v, i) { return Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) < 1e-9; }); }).length;
    return out;
  }
  function symmetryHTML(ph, f, s, sweep) {
    var K = SGConvert, r = s.r, h = '<div class="convert-preview-body">';
    h += '<p>Now <b>' + esc(St.sgText(ph.sg)) + '</b>' + (ph.sg.setting && ph.sg.setting !== 'standard' ? ', ' + esc(ph.sg.setting) : '') + ': ' + ph.atoms.length + ' site' + (ph.atoms.length === 1 ? '' : 's') + ', ' + r.points + ' atom' + (r.points === 1 ? '' : 's') + ' in the cell, ' + ph.ops.length + ' operator' + (ph.ops.length === 1 ? '' : 's') + '.</p>';
    h += '<dl class="sv-dl"><dt>Atomic model</dt><dd>' + esc(s.sourceName) + '</dd><dt>Engine</dt><dd>' + esc(r.engine) + ' · public WebAssembly</dd><dt>Cell metric</dt><dd>' + esc(r.latticeSystem || 'not determined') + (r.cellWithinTolerance ? ' within ' : ' exceeds ') + f.cellTol + ' % and ' + f.cellTol + '°</dd>' +
      '<dt>Lattice</dt><dd>' + r.latticePoints + ' lattice point' + (r.latticePoints === 1 ? '' : 's') + ' per cell' + (r.latticePoints > s.centring ? ' <b>(' + (r.latticePoints - s.centring) + ' more than ' + esc(ph.sg.symbol) + ' has: extra centring, or a smaller true cell)</b>' : '') + '</dd>';
    if (!r.group) {
      h += '<dt>Symmetry found</dt><dd class="warn">' + r.ops.length + ' operations, which could not be named as a space group; lower the tolerances.</dd></dl>';
    } else {
      var c = s.conv;
      h += '<dt>Symmetry found</dt><dd><b>' + esc(St.sgText(r.group)) + '</b>' + (r.group.setting && r.group.setting !== 'standard' ? ', ' + esc(r.group.setting) : '') + ' · ' + (s.added ? '<b>higher than ' + esc(ph.sg.symbol) + '</b>' : 'no symmetry beyond ' + esc(ph.sg.symbol)) + '</dd>';
      if (s.added) h += '<dt>New axes</dt><dd>a′, b′, c′ = ' + esc(K.formatBasis(r.P)) + '; origin ' + esc(K.formatShift(r.p)) + ' in the old axes</dd>' +
        '<dt>New cell</dt><dd>' + esc(cellText(s.newCell)) + (r.misfit > 1e-4 ? ' <span class="warn">(adjusted by up to ' + (100 * r.misfit).toFixed(2) + ' % to the ' + esc(r.group.system) + ' metric)</span>' : '') + '</dd>' +
        '<dt>Sites</dt><dd>' + ph.atoms.length + ' → ' + c.atoms.length + '; atoms move by at most ' + c.maxShift.toFixed(3) + ' Å to take the new symmetry</dd>';
      h += '</dl>';
      if(s.added && !r.cellWithinTolerance)h+='<p class="warn">The engine found higher symmetry, but its lattice exceeds the selected cell tolerance. Increase that tolerance to permit conversion.</p>';
      if(s.added && c.violations.length)h+='<p class="warn">Higher symmetry was detected, but conversion is blocked: '+esc(c.violations.slice(0,4).join(' '))+'</p>';
      if (s.missing.length) h += '<p><b>' + s.missing.length + ' operation' + (s.missing.length === 1 ? '' : 's') + ' the structure has and ' + esc(ph.sg.symbol) + ' does not use</b> (in the present axes; the largest miss of an atom):</p><div class="table-wrap"><table class="grid compact"><thead><tr><th>Operation</th><th>Largest miss /Å</th></tr></thead><tbody>' +
        s.missing.slice(0, 24).map(function (o) { return '<tr><td><code>' + esc(o.xyz) + '</code></td><td>' + o.dev.toFixed(3) + '</td></tr>'; }).join('') + '</tbody></table></div>' + (s.missing.length > 24 ? '<p class="hint">and ' + (s.missing.length - 24) + ' more.</p>' : '');
    }
    if (sweep && sweep.length) h += '<p><b>At other tolerances</b> (cell ' + f.cellTol + ' %, ' + f.cellTol + '°):</p><div class="table-wrap"><table class="grid compact"><thead><tr><th>Tolerance /Å</th><th>Space group</th><th>Largest move /Å</th></tr></thead><tbody>' +
      sweep.map(function (w) { return '<tr' + (Math.abs(w.tol - s.tol) < 1e-9 ? ' class="best"' : '') + '><td>' + w.tol + '</td><td>' + (w.error ? '<span class="warn">'+esc(w.error)+'</span>' : w.r.group ? esc(St.sgText(w.r.group)) + (w.added ? w.higher ? '' : ' (conversion blocked)' : ' (no more than now)') : '—') + '</td><td>' + (w.conv ? w.conv.maxShift.toFixed(3) : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    h += '<p class="hint">' + (s.higher ? 'Convert… opens the conversion with this group and transformation; it merges the atoms the new symmetry relates and converts every dataset. Check the result against the data: a powder pattern may not tell a small distortion from the higher symmetry.'
                                        : s.added ? 'Resolve the conversion warnings above before applying this symmetry.' : 'No symmetry beyond ' + esc(ph.sg.symbol) + ' within ' + s.tol + ' Å for '+esc(s.sourceName)+'. If this model was fitted in P1, select its fitted dataset in Positions of. Larger tolerances find pseudo-symmetry; check them against the data.') + '</p>';
    return h + '</div>';
  }
  async function findSymmetryDialog(ph) {
    if (typeof SGConvert === 'undefined' || !S.sgReady) { ui.toast('The space-group database is not loaded.', 'warn'); return; }
    if (!ph.atoms.length) { ui.toast('Find higher symmetry looks at the atoms; ' + ph.name + ' has none.', 'warn'); return; }
    var key = ph.key, last = null, holders = St.holdersOf(ph), timer = 0, job=null, serial=0, closed=false, lastInput=null, submitWhenReady=false;
    var active=RV.workspace && RV.workspace.dataset?RV.workspace.dataset():St.first();
    var preferred=holders.filter(function(d){return d===active;})[0] || holders.filter(function(d){return S.sel.has(d.id);})[0] || holders[0];
    var fields = [
      { key: 'source', label: 'Positions of', type: 'select', value: preferred?String(preferred.id):'start', options: [['start', 'The starting model (Phases)']].concat(holders.map(function (d) { return [String(d.id), 'Dataset ' + d.name + ' (Rietveld model)']; })),hint:'Defaults to the active dataset. Its atomic coordinates and cell are taken together from the Rietveld model.' },
      { key: 'tol', label: 'Atoms within /Å', type: 'number', value: 0.2, hint: 'How far an atom may move to take a symmetry; ADDSYM-like searches commonly use 0.1–0.5 Å.' },
      { key: 'cellTol', label: 'Cell within /% and °', type: 'number', value: 1, hint: 'How far the cell may be from the metric of the higher symmetry, in % for lengths and degrees for angles.' }
    ];
    function read(body) { return { source: body.querySelector('[data-key="source"]').value, tol: ui.parseNum(body.querySelector('[data-key="tol"]').value), cellTol: ui.parseNum(body.querySelector('[data-key="cellTol"]').value) }; }
    function valid(f) { return f.tol > 0 && f.tol <= 2 && f.cellTol > 0 && f.cellTol <= 10; }
    function cancelJob(){serial++;if(job){job.cancel();job=null;}}
    function update(body,f,submit){
      clearTimeout(timer);cancelJob();submitWhenReady=!!submit;last=null;lastInput=null;
      var id=serial,out=body.querySelector('[data-symmetry-report]'),p=St.phaseByKey(key);
      if(!p)return;
      if(!valid(f)){out.innerHTML='<p class="warn">The atom tolerance is between 0 and 2 Å, the cell tolerance between 0 and 10 (% and °).</p>';return;}
      var model;
      try{
        model=symmetryModel(p,f);
        out.innerHTML='<p class="hint">Running public Moyo WebAssembly on '+esc(model.name)+'…</p>';
        var tolerances=[f.tol].concat([.05,.1,.2,.3,.5]).filter(function(t,i,a){return a.indexOf(t)===i;});
        job=SGConvert.symmetryJob(model.atoms,p.ops,model.cell,groupsForSearch(),{tol:f.tol,tolerances:tolerances,lenTol:f.cellTol/100,angTol:f.cellTol});
      }catch(e){out.innerHTML='<p class="warn">The search failed: '+esc(e.message)+'</p>';return;}
      job.promise.then(function(rows){
        if(closed || id!==serial)return;job=null;
        var sweep=rows.map(function(row){
          if(row.error)return {tol:row.tol,r:{group:null},conv:null,error:row.error};
          try{return symmetrySearch(p,f,model,row.r,row.tol);}catch(e){return {tol:row.tol,r:{group:row.r.group},conv:null,error:e.message};}
        }).sort(function(a,b){return a.tol-b.tol;});
        last=sweep.filter(function(row){return row.tol===f.tol;})[0];lastInput=JSON.stringify(f);
        if(!last || last.error){out.innerHTML='<p class="warn">The search failed: '+esc(last && last.error || 'No result from the public WASM engine.')+'</p>';last=null;submitWhenReady=false;return;}
        out.innerHTML=symmetryHTML(p,f,last,sweep);
        var submit=submitWhenReady;submitWhenReady=false;
        if(submit && last.higher)body.parentElement.querySelector('.btns .primary').click();
      }).catch(function(e){if(closed || id!==serial || e.name==='AbortError')return;job=null;last=null;submitWhenReady=false;out.innerHTML='<p class="warn">The search failed: '+esc(e.message)+'</p>';});
    }
    var res = await ui.prompt('Find higher symmetry of ' + ph.name, fields, 'Convert…',
      'Search the selected model’s atomic coordinates and cell. The active dataset’s Rietveld model is selected initially; choose the starting model to search the original atoms instead. Any symmetry change is previewed before applying it.',
      { wide: true, after: '<div class="convert-preview" data-symmetry-report aria-live="polite"></div>',
        onOpen: function (body) {
          body.addEventListener('input',function(){clearTimeout(timer);cancelJob();submitWhenReady=false;timer=setTimeout(function(){update(body,read(body),false);},300);});
          body.addEventListener('change',function(){update(body,read(body),false);});
          update(body,read(body),false);
        },
        check: function (v, body) {
          clearTimeout(timer);
          if (!valid(v)) return 'The atom tolerance is between 0 and 2 Å, the cell tolerance between 0 and 10 (% and °).';
          var p = St.phaseByKey(key);
          if (!p) return 'The phase is gone.';
          if(job || lastInput!==JSON.stringify(v)){update(body,v,true);return 'Checking the current atomic model with public WebAssembly…';}
          if (!last || !last.r.group) return 'No space group was found at these tolerances.';
          if(last.added && !last.r.cellWithinTolerance)return 'Higher symmetry was found, but its lattice needs a larger cell tolerance.';
          if(last.added && last.conv.violations.length)return 'Higher symmetry was found; conversion needs the atomic mismatches shown in the report to be resolved.';
          if (!last.higher) return 'No symmetry beyond ' + St.sgText(p.sg) + ' within ' + v.tol + ' Å: nothing to convert to.';
          return '';
        } });
    closed=true;clearTimeout(timer);cancelJob();
    if (!res || !last || !last.higher) return;
    ph = St.phaseByKey(key);
    if (!ph || busy()) return;
    convertDialog(ph, { hall: last.r.group.hall, basis: SGConvert.formatBasis(last.r.P), shift: SGConvert.formatShift(last.r.p), tol: last.tol,source:last.source });
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
      if (b) document.querySelectorAll('#pane-phases input, #pane-phases select, #pane-phases button[data-act]').forEach(function (el) { el.disabled = true; });
      else { document.querySelectorAll('#pane-phases .phase-bar button[data-act]').forEach(function (el) { el.disabled = false; }); build(); }
    });
    build();
  }

  return { init: init, build: build, values: values, content: content, findSymmetry:findSymmetryDialog };
})();
