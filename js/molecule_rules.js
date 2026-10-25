/* Molecules to restraint rules: read a molecule (PDB, MOL/SDF V2000, XYZ or Z-matrix) and write the distance rules
 * (js/distance_rules.js, used by js/atom_restraints.js) that keep its bonded geometry in a Rietveld phase.
 *
 *   MoleculeRules.read(text, {name})  -> {format, atoms: [{name, el, xyz: [x, y, z] (Å)}], cell (PDB CRYST1) or null}
 *                                        throws on a bad file
 *   MoleculeRules.fragment(mol, opts) -> the molecule as atoms of a phase, in fractional coordinates (see below)
 *   MoleculeRules.generalPoint(ops, cell) -> a fractional point far from every symmetry element
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
  // MDL MOL / SDF (V2000), the first molecule: the counts line, then x y z element per atom. Names are the element and
  // its running number (C1, C2, N1 …), since the format has none.
  function readMOL(lines) {
    var c = lines.findIndex(function (l) { return /V2000\s*$/.test(l); });
    if (c < 0) { if (lines.some(function (l) { return /V3000/.test(l); })) throw new Error('MOL V3000 is not read; save the molecule as MOL V2000 (or SDF, PDB, XYZ).'); c = 3; }
    var n = parseInt(String(lines[c] || '').substr(0, 3), 10), atoms = [], count = {};
    if (!(n > 0)) throw new Error('MOL: no atom count on the counts line.');
    for (var i = c + 1; i <= c + n && i < lines.length; i++) {
      var t = lines[i].trim().split(/\s+/), xyz = [num(t[0]), num(t[1]), num(t[2])], el = elementOf(t[3]);
      if (xyz.some(function (v) { return !Number.isFinite(v); })) throw new Error('MOL: atom line ' + (i - c) + ' has no coordinates.');
      count[el] = (count[el] || 0) + 1;
      atoms.push({ name: el + count[el], el: el, xyz: xyz });
    }
    return atoms;
  }
  // CRYST1 of a PDB: the cell its orthogonal coordinates are in (a along x, b in the xy plane); none for the 1 1 1 dummy
  function pdbCell(lines) {
    var l = lines.filter(function (x) { return /^CRYST1/.test(x); })[0];
    if (!l) return null;
    var c = { a: num(l.substr(6, 9)), b: num(l.substr(15, 9)), c: num(l.substr(24, 9)), alpha: num(l.substr(33, 7)), beta: num(l.substr(40, 7)), gamma: num(l.substr(47, 7)) };
    return ['a', 'b', 'c', 'alpha', 'beta', 'gamma'].every(function (k) { return c[k] > 0; }) && !(c.a === 1 && c.b === 1 && c.c === 1) ? c : null;
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
    var lines = String(text || '').split(/\r?\n/), name = String((opts && opts.name) || '').toLowerCase(), atoms, format, cell = null;
    if (/\.(mol|sdf|sd)$/.test(name) || /V[23]000\s*$/.test(lines[3] || '')) { format = 'MOL'; atoms = readMOL(lines); }
    else if (/\.pdb$|\.ent$/.test(name) || lines.some(function (l) { return /^(ATOM  |HETATM)/.test(l); })) { format = 'PDB'; atoms = readPDB(lines); cell = pdbCell(lines); }
    else if (/\.xyz$/.test(name) || /^\s*\d+\s*$/.test(lines[0] || '') || lines.filter(function (l) { return l.trim(); }).every(function (l) { var t = l.trim().split(/\s+/); return t.length === 4 && /^[A-Za-z]/.test(t[0]) && Number.isFinite(num(t[1])) && Number.isFinite(num(t[2])) && Number.isFinite(num(t[3])); })) { format = 'XYZ'; atoms = readXYZ(lines); }
    else { format = 'Z-matrix'; atoms = readZMatrix(lines); }
    if (!atoms.length) throw new Error('No atoms found (PDB, MOL/SDF, XYZ or Z-matrix expected).');
    return { format: format, atoms: unique(atoms), cell: cell };
  }

  // ---------------------------------------------------------------- a molecule put into a cell (Phases → Fragment)
  // Cartesian -> fractional in the standard setting (a along x, b in the xy plane; the PDB convention)
  function toFractional(cell) {
    var d = Math.PI / 180, ca = Math.cos(cell.alpha * d), cb = Math.cos(cell.beta * d), cg = Math.cos(cell.gamma * d), sg = Math.sin(cell.gamma * d);
    var bx = cell.b * cg, by = cell.b * sg, cx = cell.c * cb, cy = cell.c * (ca - cb * cg) / sg, cz = Math.sqrt(Math.max(1e-12, cell.c * cell.c - cx * cx - cy * cy));
    return function (r) { var f2 = r[2] / cz, f1 = (r[1] - cy * f2) / by; return [(r[0] - bx * f1 - cx * f2) / cell.a, f1, f2]; };
  }
  function toCartesian(cell) {
    var d = Math.PI / 180, ca = Math.cos(cell.alpha * d), cb = Math.cos(cell.beta * d), cg = Math.cos(cell.gamma * d), sg = Math.sin(cell.gamma * d);
    var bx = cell.b * cg, by = cell.b * sg, cx = cell.c * cb, cy = cell.c * (ca - cb * cg) / sg, cz = Math.sqrt(Math.max(1e-12, cell.c * cell.c - cx * cx - cy * cy));
    return function (f) { return [cell.a * f[0] + bx * f[1] + cx * f[2], by * f[1] + cy * f[2], cz * f[2]]; };
  }
  /* A point of the cell far from every symmetry element: on a 1/20 grid (shifted by 1/40, off the special fractions),
     the point whose nearest symmetry image is farthest. A molecule centred there sits on a general position and its
     images overlap it least. ops: [{r: 9 numbers by rows, t: 3}], the full list of the space group. */
  function generalPoint(ops, cell) {
    var cart = toCartesian(cell), best = [0.3, 0.2, 0.35], bestD = -1, steps = 20;
    var moving = (ops || []).filter(function (op) {
      var I = op.r.every(function (v, k) { return v === (k % 4 === 0 ? 1 : 0); });
      return !(I && op.t.every(function (t) { return Math.abs(t - Math.round(t)) < 1e-9; }));
    });
    if (!moving.length) return best;
    for (var i = 0; i < steps; i++) for (var j = 0; j < steps; j++) for (var k = 0; k < steps; k++) {
      var p = [(i + 0.5) / steps, (j + 0.5) / steps, (k + 0.5) / steps], m = Infinity;
      for (var o = 0; o < moving.length && m > bestD; o++) {
        var r = moving[o].r, t = moving[o].t, q = [0, 1, 2].map(function (a) { var v = r[3 * a] * p[0] + r[3 * a + 1] * p[1] + r[3 * a + 2] * p[2] + t[a] - p[a]; return v - Math.round(v); });
        var c = cart(q), dd = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
        if (dd < m) m = dd;
      }
      if (m > bestD) { bestD = m; best = p; }
    }
    return best;
  }
  /* The atoms of a molecule as atoms of a phase.
       o.cell     the phase cell (Å, °), used when o.centre is given
       o.centre   [x, y, z] fractional: the centroid of the kept atoms goes there, in the orientation of the file;
                  without it, the file's own cell (mol.cell, a PDB CRYST1) gives the fractional coordinates as they are
       o.skipH    leave the hydrogens out
       o.used     labels already in the phase (a Set): the new ones are numbered past them
     -> {atoms: [{label, el, x, y, z}], named: the molecule with the new labels (hydrogens left out keep a name of
         their own), for rules(named, {only}) }                                                                    */
  function fragment(mol, o) {
    o = o || {};
    var used = new Set(o.used || []), next = {}, named = [], atoms = [];
    var frame = o.centre ? o.cell : mol.cell;
    if (!frame) throw new Error('The file has no cell (CRYST1): give the position of the molecule in the cell.');
    var frac = toFractional(frame), keep = mol.atoms.filter(function (a) { return !(o.skipH && a.el === 'H'); });
    if (!keep.length) throw new Error('The molecule has no atom left once the hydrogens are left out.');
    var g = [0, 1, 2].map(function (k) { return keep.reduce(function (s, a) { return s + a.xyz[k]; }, 0) / keep.length; });
    var g0 = o.centre ? frac(g) : [0, 0, 0], shift = o.centre ? [0, 1, 2].map(function (k) { return o.centre[k] - g0[k]; }) : [0, 0, 0];
    mol.atoms.forEach(function (a, i) {
      if (o.skipH && a.el === 'H') { named.push({ name: '#H' + (i + 1), el: a.el, xyz: a.xyz }); return; }
      var n = next[a.el] || 1;
      while (used.has(a.el + n)) n++;
      next[a.el] = n + 1; used.add(a.el + n);
      var f = frac(a.xyz);
      atoms.push({ label: a.el + n, el: a.el, x: f[0] + shift[0], y: f[1] + shift[1], z: f[2] + shift[2] });
      named.push({ name: a.el + n, el: a.el, xyz: a.xyz });
    });
    return { atoms: atoms, named: named };
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
  // Explicit fragment geometry, encoded as bond and 1-3 distance windows like the molecule guide.
  var SHAPES={linear:[[1,0,0],[-1,0,0]],triangle:[[1,0,0],[-.5,Math.sqrt(3)/2,0],[-.5,-Math.sqrt(3)/2,0]],
    tetrahedron:[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],square:[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]],
    octahedron:[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]};
  function geometryRules(o){
    var kind=o.kind,nb=o.neighbours || [],center=o.center,d=Number(o.distance),tol=Number(o.distanceTol),at=Number(o.angleTol),shape=SHAPES[kind],need=kind==='bond'?1:kind==='angle'?2:shape?shape.length:0;
    if(!need)throw new Error('Choose a geometry.');
    if(!center || nb.length!==(o.mode==='symmetry' && shape?1:need) || new Set([center].concat(nb)).size!==nb.length+1)throw new Error('Choose a central atom and exactly '+need+' distinct neighbours.');
    if(!(d>0) || !Number.isFinite(d) || !(tol>=0) || !Number.isFinite(tol) || tol>=d)throw new Error('Give a positive bond distance and a smaller, nonnegative distance tolerance.');
    if(kind!=='bond' && (!(at>=0) || at>180 || !Number.isFinite(at)))throw new Error('Give an angle tolerance between 0 and 180 degrees.');
    if(o.mode==='symmetry' && shape)return {text:center+' '+nb[0]+' '+shape.length+' '+(d-tol).toFixed(4)+'/'+(d+tol).toFixed(4)+' '+kind+' angle='+at,bonds:shape.length,angles:shape.length*(shape.length-1)/2,pairs:[],symmetry:true};
    var second=kind==='angle'?Number(o.secondDistance):d,target=Number(o.angle),lines=[],pairs=[];
    if(kind==='angle' && (!(second>0) || !Number.isFinite(second) || tol>=second || !(target>0 && target<=180)))throw new Error('Give a positive second bond distance and an angle above 0 and at most 180 degrees.');
    function window(a,b,lo,hi){lines.push(a+' '+b+' - '+lo.toFixed(4)+'/'+hi.toFixed(4));}
    nb.forEach(function(b,i){var r=kind==='angle' && i===1?second:d;window(center,b,r-tol,r+tol);});
    function chord(a,b,deg){return Math.sqrt(Math.max(0,a*a+b*b-2*a*b*Math.cos(deg*Math.PI/180)));}
    if(kind!=='bond')for(var i=0;i<nb.length;i++)for(var j=i+1;j<nb.length;j++){
      var angle=kind==='angle'?target:Math.acos(Math.max(-1,Math.min(1,shape[i].reduce(function(sum,x,k){return sum+x*shape[j][k];},0)/(Math.hypot.apply(null,shape[i])*Math.hypot.apply(null,shape[j])))))*180/Math.PI;
      var rj=kind==='angle'?second:d,lo=chord(d,rj,Math.max(0,angle-at)),hi=chord(d,rj,Math.min(180,angle+at));
      window(nb[i],nb[j],lo,hi);pairs.push({a:nb[i],b:nb[j],angle:angle});
    }
    return {text:lines.join('\n'),bonds:nb.length,angles:pairs.length,pairs:pairs};
  }
  return { read: read, rules: rules, radius: radius, elementOf: elementOf, geometryRules:geometryRules, fragment: fragment, generalPoint: generalPoint };

})();
if (typeof module !== 'undefined' && module.exports) module.exports = MoleculeRules;
