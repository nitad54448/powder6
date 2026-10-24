/* Molecules to restraint rules: read a molecule (PDB, XYZ or Z-matrix) and write the distance rules
 * (js/distance_rules.js, used by js/atom_restraints.js) that keep its bonded geometry in a Rietveld phase.
 *
 *   MoleculeRules.read(text, {name})  -> {format, atoms: [{name, el, xyz: [x, y, z] (Å)}]}   throws on a bad file
 *   MoleculeRules.rules(atoms, opts)  -> {text, bonds, angles, skipped}
 *       opts.bondTol (Å, 0.03), opts.angleTol (Å on the 1-3 distance, 0.06), opts.factor (bond if d < factor × the
 *       sum of the covalent radii, 1.2), opts.angles (true), opts.only (a set of atom names: the rules for the
 *       atoms of the phase only), opts.skipH (false)
 *   MoleculeRules.radius(el)          covalent radius, Å
 *
 * Bonds become "A B - dmin/dmax"; every pair of atoms two bonds apart (an angle) becomes the same kind of rule on the
 * 1-3 distance, so bond lengths and angles are both held without a separate angle syntax.
 *
 *    page    :  <script defer src="js/molecule_rules.js">
 *    node    :  require('./molecule_rules.js')
 */
var MoleculeRules = (function () {
  'use strict';
  // covalent radii (Å), Cordero et al. 2008
  var RADII = { H: .31, He: .28, Li: 1.28, Be: .96, B: .84, C: .76, N: .71, O: .66, F: .57, Ne: .58, Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06,
    K: 2.03, Ca: 1.76, Sc: 1.7, Ti: 1.6, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.2, As: 1.19, Se: 1.2, Br: 1.2, Kr: 1.16,
    Rb: 2.2, Sr: 1.95, Y: 1.9, Zr: 1.75, Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.4,
    Cs: 2.44, Ba: 2.15, La: 2.07, Hf: 1.75, Ta: 1.7, W: 1.62, Re: 1.51, Os: 1.44, Ir: 1.41, Pt: 1.36, Au: 1.36, Hg: 1.32, Tl: 1.45, Pb: 1.46, Bi: 1.48 };
  function radius(el) { return RADII[el] || 1.5; }
  // the element of a label or a PDB name: the longest leading letters that are an element
  function elementOf(s) {
    var m = /^[A-Za-z]+/.exec(String(s || '').trim());
    if (!m) return 'X';
    var t = m[0], two = t.charAt(0).toUpperCase() + (t.charAt(1) || '').toLowerCase();
    return t.length > 1 && RADII[two] ? two : t.charAt(0).toUpperCase();
  }
  function num(s) { var x = Number(s); return Number.isFinite(x) ? x : NaN; }
  // unique names: a repeated name gets its running number
  function unique(atoms) {
    var seen = {}, count = {};
    atoms.forEach(function (a) { count[a.name] = (count[a.name] || 0) + 1; });
    atoms.forEach(function (a, i) { if (count[a.name] > 1) a.name = a.name + '_' + (i + 1); });
    atoms.forEach(function (a) { if (seen[a.name]) throw new Error('Atom name ' + a.name + ' appears twice.'); seen[a.name] = true; });
    return atoms;
  }

  function readXYZ(lines) {
    var n = parseInt(lines[0], 10), body = lines.slice(Number.isFinite(n) ? 2 : 0), atoms = [];
    body.forEach(function (l) {
      var t = l.trim().split(/\s+/);
      if (t.length < 4 || !(num(t[1]) === num(t[1])) ) return;
      var xyz = [num(t[1]), num(t[2]), num(t[3])];
      if (xyz.some(function (v) { return !Number.isFinite(v); })) return;
      atoms.push({ name: t[0], el: elementOf(t[0]), xyz: xyz });
    });
    if (Number.isFinite(n) && atoms.length > n) atoms.length = n;
    return atoms;
  }
  function readPDB(lines) {
    var atoms = [];
    lines.forEach(function (l) {
      if (!/^(ATOM  |HETATM)/.test(l)) return;
      var alt = l.charAt(16);
      if (alt !== ' ' && alt !== 'A' && alt !== '') return;
      var name = l.substr(12, 4).trim(), xyz = [num(l.substr(30, 8)), num(l.substr(38, 8)), num(l.substr(46, 8))], el = l.substr(76, 2).trim();
      if (xyz.some(function (v) { return !Number.isFinite(v); })) return;
      atoms.push({ name: name, el: el ? elementOf(el) : elementOf(name), xyz: xyz });
    });
    return atoms;
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  // a Z-matrix: "label", "label r1 d", "label r1 d r2 angle", "label r1 d r2 angle r3 dihedral" (references by number or label)
  function readZMatrix(lines) {
    var rows = lines.map(function (l) { return l.trim().split(/[\s,]+/); }).filter(function (t) { return t[0] && t[0].charAt(0) !== '#' && t[0].charAt(0) !== '!'; });
    var atoms = [], index = {};
    rows.forEach(function (t, i) {
      var name = t[0], ref = function (k) { var r = t[k], j = /^\d+$/.test(r) ? parseInt(r, 10) - 1 : index[r]; if (!(j >= 0 && j < i)) throw new Error('Z-matrix line ' + (i + 1) + ': unknown reference "' + r + '".'); return atoms[j].xyz; };
      var xyz, d = num(t[2]), th = num(t[4]) * Math.PI / 180, ph = num(t[6]) * Math.PI / 180;
      if (i === 0) xyz = [0, 0, 0];
      else if (i === 1) { ref(1); if (!(d > 0)) throw new Error('Z-matrix line 2 needs a distance.'); xyz = [0, 0, d]; }
      else {
        var C = ref(1), B = ref(3);
        if (!(d > 0) || !Number.isFinite(th)) throw new Error('Z-matrix line ' + (i + 1) + ' needs a distance and an angle.');
        var bc = unit(sub(C, B)), A, n;
        if (i === 2 || t.length < 7 || !Number.isFinite(ph)) { A = null; n = Math.abs(bc[0]) < 0.9 ? cross(bc, [1, 0, 0]) : cross(bc, [0, 1, 0]); n = unit(n); ph = 0; }
        else { A = ref(5); n = unit(cross(sub(B, A), bc)); }
        var m = cross(n, bc), c = Math.cos(th), s = Math.sin(th);
        xyz = [0, 1, 2].map(function (k) { return C[k] + d * (-bc[k] * c + m[k] * s * Math.cos(ph) + n[k] * s * Math.sin(ph)); });
      }
      atoms.push({ name: name, el: elementOf(name), xyz: xyz }); index[name] = i;
    });
    return atoms;
  }

  function read(text, opts) {
    var lines = String(text || '').split(/\r?\n/), name = String((opts && opts.name) || '').toLowerCase(), atoms, format;
    if (/\.pdb$|\.ent$/.test(name) || lines.some(function (l) { return /^(ATOM  |HETATM)/.test(l); })) { format = 'PDB'; atoms = readPDB(lines); }
    else if (/\.xyz$/.test(name) || /^\s*\d+\s*$/.test(lines[0] || '') || lines.filter(function (l) { return l.trim(); }).every(function (l) { var t = l.trim().split(/\s+/); return t.length === 4 && /^[A-Za-z]/.test(t[0]) && Number.isFinite(num(t[1])) && Number.isFinite(num(t[2])) && Number.isFinite(num(t[3])); })) { format = 'XYZ'; atoms = readXYZ(lines); }
    else { format = 'Z-matrix'; atoms = readZMatrix(lines); }
    if (!atoms.length) throw new Error('No atoms found (PDB, XYZ or Z-matrix expected).');
    return { format: format, atoms: unique(atoms) };
  }

  function dist(a, b) { return Math.hypot(a.xyz[0] - b.xyz[0], a.xyz[1] - b.xyz[1], a.xyz[2] - b.xyz[2]); }
  function f3(x) { return x.toFixed(3); }
  function rules(atoms, opts) {
    opts = opts || {};
    var bondTol = opts.bondTol > 0 ? opts.bondTol : 0.03, angleTol = opts.angleTol > 0 ? opts.angleTol : 0.06, factor = opts.factor > 0 ? opts.factor : 1.2, only = opts.only || null;
    var nb = atoms.map(function () { return []; }), bonds = [], lines = [], seen = {}, skipped = 0;
    var use = atoms.map(function (a) { return !(opts.skipH && a.el === 'H') && (!only || only.has(a.name)); });
    for (var i = 0; i < atoms.length; i++) for (var j = i + 1; j < atoms.length; j++) {
      var d = dist(atoms[i], atoms[j]);
      if (d > 0.4 && d < factor * (radius(atoms[i].el) + radius(atoms[j].el))) { nb[i].push(j); nb[j].push(i); bonds.push([i, j, d]); }
    }
    function win(d, tol) { return Math.max(0.3, d - tol).toFixed(3) + '/' + (d + tol).toFixed(3); }
    function add(i, j, d, tol) {
      var key = Math.min(i, j) + ':' + Math.max(i, j);
      if (seen[key]) return false;
      seen[key] = true;
      if (!use[i] || !use[j]) { skipped++; return false; }
      lines.push(atoms[i].name + ' ' + atoms[j].name + ' - ' + win(d, tol));
      return true;
    }
    var nBonds = 0, nAngles = 0;
    bonds.forEach(function (b) { if (add(b[0], b[1], b[2], bondTol)) nBonds++; });
    if (opts.angles !== false) {
      var one = lines.length;
      lines.push('# 1-3 distances (the angles)');
      atoms.forEach(function (_, c) {
        for (var p = 0; p < nb[c].length; p++) for (var q = p + 1; q < nb[c].length; q++) { if (add(nb[c][p], nb[c][q], dist(atoms[nb[c][p]], atoms[nb[c][q]]), angleTol)) nAngles++; }
      });
      if (lines.length === one + 1) lines.pop();
    }
    return { text: lines.join('\n'), bonds: nBonds, angles: nAngles, skipped: skipped };
  }
  return { read: read, rules: rules, radius: radius, elementOf: elementOf };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MoleculeRules;
