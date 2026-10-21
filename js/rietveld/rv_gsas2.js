/*  Export to GSAS-II: a ZIP file with, for the selected datasets,
 *    phases/<phase>.cif      one CIF per phase (cell, space group with its operators, atoms) at the current values
 *    data/<dataset>.xye      the pattern: 2theta, counts, standard uncertainty
 *    data/<dataset>.instprm  the instrument parameters, with the name of the pattern, so that GSAS-II uses it
 *                            by itself when the pattern is imported
 *    README.txt              the steps in GSAS-II and the values that no file can carry (limits, background, size, strain)
 *  Everything is plain text; the ZIP is written here (stored, no compression), so nothing is needed but the browser.
 *  RV.gsas2.exportSelected()  (File menu, command gsas2);  RV.gsas2.build(list) -> { files, notes }, RV.gsas2.zip(files) -> Uint8Array, for tests.
 *
 *  Conventions that carry over unchanged (GSAS-II source read for each):
 *    Zero        2theta(observed) = 2theta(calculated) + Zero, as the zero point here
 *    Polariz.    Lp polarisation (1 - P) cos^2(2theta) + P, with P = 1 / (1 + K) for the polarisation ratio K of this program
 *    U V W       Gaussian variance, cdeg^2;  X Y Z  Lorentzian width, cdeg:  X / cos(theta) + Y tan(theta) + Z
 *  Not transferable, and listed in the README instead: scale factors (other normalisation), preferred orientation, the
 *  axial-asymmetry terms SL and HL (another model than SH/L), a spline background.
 */
RV.gsas2 = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, C = RVCore, ui = RV.ui;
  var DEFAULT_RADIUS = 200;                   // mm, the goniometer radius GSAS-II assumes
  var SH_L = 0.002;                           // the GSAS-II default of the axial divergence term

  // ---------------------------------------------------------------- numbers and names
  function num(v, n) {                       // fixed decimals, no "-0"
    if (!Number.isFinite(v)) return '0';
    var s = (Math.abs(v) < 0.5 * Math.pow(10, -n) ? 0 : v).toFixed(n);
    return s;
  }
  function trim(v, n) { return String(parseFloat(num(v, n))); }     // 1.5 rather than 1.500000
  function safeName(s, fallback) {
    var t = String(s == null ? '' : s).replace(/[^A-Za-z0-9._+-]+/g, '_').replace(/^[._]+|_+$/g, '');
    return t || fallback;
  }
  function unique(name, used, ext) {
    var base = name, k = 2;
    while (used[(name + ext).toLowerCase()]) name = base + '_' + (k++);
    used[(name + ext).toLowerCase()] = true;
    return name;
  }
  function cifQuote(s) { return "'" + String(s).replace(/'/g, '') + "'"; }
  function cifWord(s) { var t = String(s); return /^[A-Za-z0-9][A-Za-z0-9_+\-]*$/.test(t) ? t : cifQuote(t); }
  function frac(t) {                         // a translation as n/d, or a decimal when it is not a simple fraction
    t = t - Math.floor(t);
    if (t < 1e-9 || t > 1 - 1e-9) return '';
    var D = [2, 3, 4, 6, 8, 12, 24], i, n;
    for (i = 0; i < D.length; i++) { n = Math.round(t * D[i]); if (Math.abs(t * D[i] - n) < 1e-7) return n + '/' + D[i]; }
    return num(t, 6);
  }
  function opString(op) {                    // x' = R x + t, rows of R in r
    var ax = ['x', 'y', 'z'], rows = [], i, j, s, c, f;
    for (i = 0; i < 3; i++) {
      s = '';
      for (j = 0; j < 3; j++) {
        c = op.r[3 * i + j];
        if (!c) continue;
        s += (c < 0 ? '-' : (s ? '+' : '')) + (Math.abs(c) === 1 ? '' : Math.abs(c) + '*') + ax[j];
      }
      f = frac(op.t[i]);
      if (f) s += '+' + f;
      rows.push(s || '0');
    }
    return rows.join(',');
  }

  // ---------------------------------------------------------------- the CIF of a phase in a dataset
  /* The block holds the cell, the space group (the symbol, the Hall symbol and the operators of the setting this program uses, so that a
     program may take whichever it understands) and the atoms. A phase without atoms (Le Bail with a cell only) gets one placeholder atom,
     because GSAS-II refuses a CIF without an atom loop; the README says so. */
  function cifOf(ph, ds) {
    var p = ds.p, atoms = St.atomicValues(ds), k = ph.key + '.', cell = C.cellOf(ph.sg.system, ph.sg.uniqueAxis, function (c) { return p[k + c]; }), L = [], placeholder = !ph.atoms.length;
    if (!cell) throw new Error('phase ' + ph.name + ' has no usable cell in ' + ds.name);
    L.push('data_' + safeName(ph.name, ph.key));
    L.push("_audit_creation_method 'Powder 6, " + RV.version + "'");
    L.push('_pd_phase_name ' + cifQuote(ph.name));
    ['a', 'b', 'c'].forEach(function (c) { L.push('_cell_length_' + c + ' ' + num(cell[c], 6)); });
    ['alpha', 'beta', 'gamma'].forEach(function (c) { L.push('_cell_angle_' + c + ' ' + num(cell[c], 5)); });
    L.push('_symmetry_space_group_name_H-M ' + cifQuote(ph.sg.symbol));
    if (ph.sg.hall) L.push('_symmetry_space_group_name_Hall ' + cifQuote(ph.sg.hall));
    if (ph.sg.number) L.push('_symmetry_Int_Tables_number ' + ph.sg.number);
    L.push('loop_', '_symmetry_equiv_pos_site_id', '_symmetry_equiv_pos_as_xyz');
    ph.ops.forEach(function (op, i) { L.push((i + 1) + ' ' + opString(op)); });
    L.push('loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y', '_atom_site_fract_z',
           '_atom_site_occupancy', '_atom_site_U_iso_or_equiv', '_atom_site_adp_type');
    if (placeholder) L.push('PLACEHOLDER H 0.00000000 0.00000000 0.00000000 1.0 0.0127 Uiso');
    if (!placeholder && S.calculation !== 'rietveld') L.push('# Rietveld atomic model; unused by ' + C.METHOD_LABELS[S.calculation] + '.');
    ph.atoms.forEach(function (at) {
      var pre = k + at.label + '.', B = atoms[pre + 'B'], occ = atoms[pre + 'occ'];
      L.push([cifWord(at.label), cifWord(at.type), num(atoms[pre + 'x'], 8), num(atoms[pre + 'y'], 8), num(atoms[pre + 'z'], 8),
              num(Number.isFinite(occ) ? occ : 1, 6), num((Number.isFinite(B) ? B : 0) / (8 * Math.PI * Math.PI), 6), 'Uiso'].join(' '));
    });
    return L.join('\n') + '\n';
  }

  // ---------------------------------------------------------------- the pattern
  function xyeOf(ds) {
    var L = ['# Powder 6 export for GSAS-II', '# ' + String(ds.name).replace(/[\r\n]+/g, ' '), '# 2theta /deg, counts, standard uncertainty', '# Points with an imported zero weight are omitted.'], i, s, n = 0;
    for (i = 0; i < ds.tth.length; i++) {
      if (!Number.isFinite(ds.tth[i]) || !Number.isFinite(ds.y[i])) continue;
      var w = St.pointWeight(ds, i);
      if (!(w > 0)) continue;
      s = 1 / Math.sqrt(w);
      L.push(num(ds.tth[i], 5) + ' ' + trim(ds.y[i], 4) + ' ' + trim(s, 6));
      n++;
    }
    if (!n) throw new Error('dataset ' + ds.name + ' has no points');
    return L.join('\n') + '\n';
  }

  // ---------------------------------------------------------------- the instrument parameters
  /* The U V W X Y Z of the dataset when a phase has the separated profile (that is the instrument, and the sample broadening is listed
     in the README); otherwise the profile of the first phase of the dataset, which holds the instrument and the sample together. */
  function profileOf(ds, notes) {
    var phs = St.phasesIn(ds), sep = null, i, ph, p = ds.p, k, g = function (n) { return Number.isFinite(p[k + n]) ? p[k + n] : 0; };
    for (i = 0; i < phs.length; i++) if (C.usesSeparatedProfile(phs[i])) { sep = phs[i]; break; }
    if (sep || !phs.length) {
      var v = {};
      C.INSTRUMENT_PROFILE.forEach(function (q) { v[q[0]] = Number.isFinite(p['inst.' + q[0]]) ? p['inst.' + q[0]] : q[1]; });
      if (!sep) notes.push('No phase in this dataset: the instrument coefficients are the program defaults.');
      return { U: v.U, V: v.V, W: v.W, X: v.X, Y: v.Y, Z: v.Z, SL: v.SL, HL: v.HL };
    }
    ph = phs[0]; k = ph.key + '.';
    if (ph.profileType === 'tch_aniso') {
      notes.push('The Thompson-Cox-Hastings coefficients of ' + ph.name + ' include the sample broadening. In GSAS-II set the size very large (e.g. 100 µm) and the mustrain to 0 so that it is not counted twice.');
      return { U: g('U'), V: g('V'), W: g('W'), X: g('X'), Y: g('Y'), Z: 0, SL: g('SL'), HL: g('HL') };
    }
    if (ph.profileType === 'simple_pvoigt') {
      notes.push('The simple pseudo-Voigt of ' + ph.name + ' is exported as U = GU + GP, V = GV, W = GW + GP (exact: GP / cos² θ = GP + GP tan² θ), X = LX. GSAS-II computes its own mixing from the widths, so eta is not carried; set the size very large and the mustrain to 0 so that the broadening is not counted twice.');
      return { U: g('GU') + g('GP'), V: g('GV'), W: g('GW') + g('GP'), X: g('LX'), Y: 0, Z: 0, SL: 0, HL: 0 };
    }
    notes.push('The split pseudo-Voigt of ' + ph.name + ' has no GSAS-II counterpart: the left and right widths are averaged, so the asymmetry is lost. Set the size very large and the mustrain to 0.');
    return { U: (g('GU_L') + g('GU_R')) / 2, V: (g('GV_L') + g('GV_R')) / 2, W: (g('GW_L') + g('GW_R')) / 2, X: (g('LX_L') + g('LX_R')) / 2, Y: 0, Z: 0, SL: 0, HL: 0 };
  }
  function instprmOf(ds, notes) {
    var i = ds.inst, pr = profileOf(ds, notes), L = [], neutron = i.radiation === 'neutron', two = !neutron && i.ratio > 0 && i.lambda2 > 0,
        K = St.polK(i), bragg = !neutron && i.pol !== 'sync';
    L.push('#GSAS-II instrument parameter file; do not add/delete items!');
    L.push('Type:' + (neutron ? 'PNC' : 'PXC'), 'Bank:1');
    if (two) L.push('Lam1:' + trim(i.lambda1, 6), 'Lam2:' + trim(i.lambda2, 6), 'I(L2)/I(L1):' + trim(i.ratio, 6));
    else L.push('Lam:' + trim(i.lambda1, 6));
    L.push('Zero:' + trim(ds.p.zero || 0, 6));
    L.push('Polariz.:' + (neutron ? '0.0' : trim(1 / (1 + K), 6)), 'Azimuth:0.0');
    ['U', 'V', 'W', 'X', 'Y', 'Z'].forEach(function (n) { L.push(n + ':' + trim(pr[n], 6)); });
    L.push('SH/L:' + SH_L);
    L.push('Diff-type:' + (bragg ? 'Bragg-Brentano' : 'Debye-Scherrer'));
    if (i.radiusMM > 0) L.push('Gonio.radius:' + trim(i.radiusMM, 3));
    if (pr.SL || pr.HL) notes.push('The axial-asymmetry terms SL = ' + trim(pr.SL, 5) + ' and HL = ' + trim(pr.HL, 5) + ' are another model than the SH/L of GSAS-II and are not exported; SH/L is the GSAS-II default ' + SH_L + '.');
    return { text: L.join('\n') + '\n', bragg: bragg };
  }

  // ---------------------------------------------------------------- the README
  function sampleLines(ds, bragg, notes) {
    var p = ds.p, out = [], R = ds.inst.radiusMM > 0 ? ds.inst.radiusMM : DEFAULT_RADIUS, disp = p.disp || 0, tr = p.transp || 0;
    if (!disp && !tr) return out;
    if (!bragg) { notes.push('Sample displacement and transparency are defined for Bragg-Brentano here and are not exported for this geometry.'); return out; }
    // this program: dtwotheta = -(disp / 1000) cos(theta) + transp sin(2 theta), radians; GSAS-II: -(0.09 / (pi R)) (4 Shift cos(theta) + 100 Transparency sin(2 theta)), degrees, Shift in µm
    if (disp) out.push('Sample Parameters, Shift = ' + trim(0.5 * R * disp, 4) + ' µm (for R = ' + trim(R, 3) + ' mm' + (ds.inst.radiusMM > 0 ? '' : ', the GSAS-II default: the radius of this dataset is unknown') + ')');
    if (tr) out.push('Sample Parameters, Transparency = ' + trim(-20 * R * tr, 4) + ' (for R = ' + trim(R, 3) + ' mm)');
    return out;
  }
  function limitsLines(ds) {
    var i = ds.inst, out = ['Limits: ' + trim(i.tthMin != null ? i.tthMin : ds.tth[0], 4) + ' to ' + trim(i.tthMax != null ? i.tthMax : ds.tth[ds.tth.length - 1], 4) + ' degrees 2theta (the fitted range)'];
    if (i.excl && i.excl.length) out.push('Excluded regions: ' + i.excl.map(function (r) { return trim(r[0], 4) + ' to ' + trim(r[1], 4); }).join('; '));
    return out;
  }
  function backgroundLines(ds) {
    var i = ds.inst, p = ds.p, c = [], k;
    if (i.bkgType === 'spline') return ['Background: a spline through ' + i.bkgX.length + ' anchors here; GSAS-II has no equivalent, use a Chebyshev background there.'];
    for (k = 0; k < i.bkgN; k++) c.push(trim(p['bkg' + k] || 0, 5));
    return ['Background: "chebyschev-1" with ' + i.bkgN + ' terms over the Limits above; coefficients ' + (c.length ? c.join(', ') : '(none)') + ' (counts, the same Chebyshev polynomials over the fitted range)'];
  }
  function phaseDataLines(ds, ph) {
    var p = ds.p, k = ph.key + '.', b = ph.broadening || {}, g = function (n) { return Number.isFinite(p[k + n]) ? trim(/^size/.test(n) ? p[k + n] * 1000 : p[k + n], 5) : '-'; }, out = [];
    if (!C.usesSeparatedProfile(ph)) return out;
    out.push(ph.name + ': Size ' + b.size + (b.size === 'ellipsoid' ? ' (' + g('size') + ', ' + g('sizeB') + ', ' + g('sizeC') + ' µm; rotations ' + g('rotA') + ', ' + g('rotB') + ', ' + g('rotC') + ')'
      : b.size === 'uniaxial' ? ' (equatorial ' + g('size') + ', axial ' + g('sizeAxial') + ' µm, axis ' + (b.sizeAxis || [0, 0, 1]).join(' ') + ')' : ' ' + g('size') + ' µm') + ', mixing ' + g('sizeMix'));
    out.push(ph.name + ': Mustrain ' + b.strain + (b.strain === 'stephens' ? ' (Stephens terms ' + C.sampleProfileNames(ph.sg.system, ph.sg.uniqueAxis, b, ph.ops).filter(function (n) { return /^S\d{3}$/.test(n); }).map(function (n) { return n + ' ' + g(n); }).join(', ') + ')'
      : b.strain === 'uniaxial' ? ' (equatorial ' + g('strain') + ', axial ' + g('strainAxial') + ' µε, axis ' + (b.strainAxis || [0, 0, 1]).join(' ') + ')' : ' ' + g('strain') + ' µε') + ', mixing ' + g('strainMix'));
    return out;
  }

  // ---------------------------------------------------------------- build
  function build(list) {
    if (!list || !list.length) throw new Error('select one or more datasets');
    var files = [], notes = [], usedPhase = {}, usedData = {}, byPhase = {}, order = [], readme = [], stamp = ui.stamp ? ui.stamp() : '';
    // the phases of the datasets, one CIF each when the datasets agree on the values, otherwise one per distinct set of values
    list.forEach(function (ds) {
      St.phasesIn(ds).forEach(function (ph) {
        var text = cifOf(ph, ds), g = byPhase[ph.key];
        if (!g) { g = byPhase[ph.key] = { ph: ph, versions: [] }; order.push(ph.key); }
        var v = g.versions.filter(function (x) { return x.text === text; })[0];
        if (v) v.datasets.push(ds); else g.versions.push({ text: text, datasets: [ds] });
      });
    });
    order.forEach(function (key) {
      var g = byPhase[key], many = g.versions.length > 1;
      g.versions.forEach(function (v) {
        var base = safeName(g.ph.name, g.ph.key) + (many ? '__' + safeName(v.datasets[0].name, 'dataset') : '');
        v.file = 'phases/' + unique(base, usedPhase, '.cif') + '.cif';
        files.push({ name: v.file, data: v.text });
      });
      if (many) notes.push('The values of ' + g.ph.name + ' differ between the datasets, so there is one CIF per set of values: ' + g.versions.map(function (v) { return v.file + ' (' + v.datasets.map(function (d) { return d.name; }).join(', ') + ')'; }).join('; ') + '. Import the one you want and add the histograms to it.');
      if (!g.ph.atoms.length) notes.push(g.ph.name + ' has no atoms here: its CIF holds one placeholder atom (H, label PLACEHOLDER) because GSAS-II needs an atom list. Delete or replace it; for a Le Bail fit set the histogram to Le Bail in the Data tab of the phase.');
    });
    readme.push('Datasets');
    list.forEach(function (ds, n) {
      var dnotes = [], base = unique(safeName(ds.name, 'dataset'), usedData, '.xye'), ip = instprmOf(ds, dnotes), phs = St.phasesIn(ds);
      files.push({ name: 'data/' + base + '.xye', data: xyeOf(ds) });
      files.push({ name: 'data/' + base + '.instprm', data: ip.text });
      readme.push('', '[' + (n + 1) + '] ' + ds.name + '   (data/' + base + '.xye with data/' + base + '.instprm)');
      readme.push('    Phases to add to this histogram: ' + (phs.length ? phs.map(function (ph) { var v = byPhase[ph.key].versions.filter(function (x) { return x.datasets.indexOf(ds) >= 0; })[0]; return ph.name + ' (' + v.file + ')'; }).join(', ') : 'none'));
      limitsLines(ds).concat(backgroundLines(ds), sampleLines(ds, ip.bragg, dnotes)).forEach(function (t) { readme.push('    ' + t); });
      phs.forEach(function (ph) { phaseDataLines(ds, ph).forEach(function (t) { readme.push('    Phase Data tab, ' + t); }); });
      dnotes.forEach(function (t) { readme.push('    Note: ' + t); });
    });
    var head = ['Powder 6 export for GSAS-II', 'Written ' + stamp + ' by Powder 6, version ' + RV.version, '',
      'Contents',
      '  phases/   one CIF per phase: cell, space group (symbol, Hall symbol and operators), atoms with occupancy and U_iso = B / (8 pi^2)',
      '  data/     one .xye per dataset (2theta, counts, standard uncertainty) and the .instprm of the same name',
      '',
      'Open in GSAS-II',
      '  1. New project. Import > Phase > from CIF file: select all the files of phases/.',
      '  2. Import > Powder Data > Topas xye: select the .xye files of data/. Keep each .instprm next to its .xye: GSAS-II uses the file of the same',
      '     name as the instrument parameters by itself (otherwise it asks, and you can load the .instprm with Instrument Parameters > Load).',
      '  3. In each phase, Data tab, Add powder histograms: tick the datasets that contain it (listed below).',
      '  4. In each histogram, enter what the files cannot carry (Limits, Background, Sample Parameters, and the Size and Mustrain of the phase), listed below.',
      '  5. Refine the scale factors first, then the background, the cell, the zero, and so on.',
      '', 'What is carried and what is not',
      '  Carried: cell, space group, atoms (positions, occupancies, U_iso); wavelength(s) and their ratio, zero, polarisation, U V W X Y Z.',
      '  Same meaning: Zero is added to the calculated 2theta; Polariz. = 1/(1+K), the GSAS-II form of the polarisation of this program; U V W (cdeg^2),',
      '  X, Y, Z (cdeg) with X / cos(theta) + Y tan(theta) + Z as the Lorentzian width.',
      '  Not carried: scale factors (another normalisation), preferred orientation, anisotropic atomic displacement, the points that GSAS-II drops',
      '  (a point with zero or negative counts gets weight 0 there; here it keeps a weight from sigma = 1).', ''];
    var tail = [];
    if (notes.length) { tail.push('', 'Notes'); notes.forEach(function (t) { tail.push('  - ' + t); }); }
    files.unshift({ name: 'README.txt', data: head.concat(readme, tail).join('\n') + '\n' });
    return { files: files, notes: notes };
  }

  // ---------------------------------------------------------------- ZIP (stored)
  var CRC = null;
  function crc32(b) {
    var c, i, k;
    if (!CRC) { CRC = new Uint32Array(256); for (i = 0; i < 256; i++) { c = i; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[i] = c >>> 0; } }
    c = 0xFFFFFFFF;
    for (i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    var enc = new TextEncoder(), now = new Date(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1),
        date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(), parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data),
          local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(Uint8Array.from(local), name, data);
      central.push(Uint8Array.from([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var csize = 0;
    central.forEach(function (c) { csize += c.length; });
    var end = Uint8Array.from([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(offset), u16(0)));
    var all = parts.concat(central, [end]), total = 0, out, pos = 0;
    all.forEach(function (a) { total += a.length; });
    out = new Uint8Array(total);
    all.forEach(function (a) { out.set(a, pos); pos += a.length; });
    return out;
  }

  // ---------------------------------------------------------------- the command
  function exportSelected() {
    var list = St.selected(), res, bytes;
    if (!list.length) { ui.toast('Select one or more datasets first.', 'warn'); return; }
    try { res = build(list); bytes = zip(res.files); } catch (e) { ui.toast('The export to GSAS-II failed: ' + ((e && e.message) || e), 'err'); return; }
    ui.download('powder6_gsas2_' + ui.fileStamp() + '.zip', bytes, 'application/zip');
    var nPh = res.files.filter(function (f) { return /\.cif$/.test(f.name); }).length;
    ui.toast('Export to GSAS-II: ' + list.length + (list.length === 1 ? ' dataset' : ' datasets') + ' and ' + nPh + (nPh === 1 ? ' phase' : ' phases') + ' in a ZIP file (' + Math.round(bytes.length / 1024) + ' kB). Open its README.txt for the steps in GSAS-II' + (res.notes.length ? '; ' + res.notes.length + (res.notes.length === 1 ? ' note' : ' notes') + ' in it' : '') + '.', res.notes.length ? 'warn' : 'ok');
  }
  return { exportSelected: exportSelected, build: build, zip: zip, cifOf: cifOf, xyeOf: xyeOf, instprmOf: instprmOf };
})();
