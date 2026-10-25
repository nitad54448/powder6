/* Soft geometric restraints of a Rietveld phase, written in the distance-rule language of the Wyckoff search
 * (js/distance_rules.js): one rule per line,
 *
 *     Fe1 C1 6 1.6/2.2 oct       six C1 around each Fe1 between 1.6 and 2.2 Å, as an octahedron
 *     Si1 O1 4 1.58/1.66 tet     four O1 around Si1, tetrahedral
 *     O1 O1 - 2.4/               no O1 closer than 2.4 Å to another O1
 *     C1 C2 - 1.38/1.42          the nearest C2 to C1 between 1.38 and 1.42 Å
 *
 * A and B are ATOM LABELS of the phase (case matters; they are unique in a phase), not elements. The symmetry
 * images of B within reach of A are all considered (every operator and neighbouring cell).
 *
 * Each rule becomes residuals added to chi^2 as extra observations:
 *   - a distance outside its window [dmin, dmax]: (d - nearest bound) / sigmaD (flat inside the window; a window
 *     of one value, dmin = dmax, is a target)
 *   - a counted rule "A B N": the N nearest B all use that window; an exact count (N, not N+) also pushes the
 *     (N+1)th nearest B beyond dmax
 *   - a shape: every angle B-A-B' of the N neighbours against the ideal angle of the shape (the nearest of 90 and
 *     180 for the square and the octahedron): (angle - ideal) / sigmaA
 * Optional Rietveld suffix "angle=3" gives shape angles a flat +/-3 degree window.
 * multiplied by sqrt(weight). A phase held by several datasets of one fit counts once, shared between them.
 *
 *    page    :  <script defer src="js/atom_restraints.js">
 *    worker  :  importScripts('wyckoff_limits.js', 'distance_rules.js', 'atom_restraints.js')
 *    node    :  require('./atom_restraints.js')
 */
if (typeof module !== 'undefined' && module.exports) {
  if (typeof DistanceRules === 'undefined') globalThis.DistanceRules = require('./distance_rules.js');
  if (typeof WY_LIMITS === 'undefined') globalThis.WY_LIMITS = require('./wyckoff_limits.js').WY_LIMITS;
}
var AtomRestraints = (function () {
  'use strict';
  var IDEAL = { 'linear': [180], 'trigonal-planar': [120], 'tetrahedral': [109.4712206], 'square-planar': [90, 180], 'octahedral': [90, 180] };
  var DEFAULTS = Object.freeze({ on: true, text: '', weight: 1, sigmaD: 0.02, sigmaA: 3 });
  function positive(v, d) { var x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; }
  /* the stored form of a phase's restraints: {on, text, weight, sigmaD (Å), sigmaA (°)} */
  function normalize(r) {
    r = r || {};
    return { on: true, text: String(r.text == null ? '' : r.text), weight: positive(r.weight, DEFAULTS.weight), sigmaD: positive(r.sigmaD, DEFAULTS.sigmaD), sigmaA: positive(r.sigmaA, DEFAULTS.sigmaA) };
  }
  function geometries() { return typeof WY_LIMITS !== 'undefined' ? WY_LIMITS.geometries : {}; }
  function parse(text) {
    var out={windows:[],bad:[],warn:[]};
    String(text || '').split(/\r?\n/).forEach(function(line,i){
      var m=/\s+angle=([^\s]+)\s*$/i.exec(line),tol=m?Number(m[1]):null;
      if(m)line=line.slice(0,m.index);
      var p=DistanceRules.parse(line,geometries(),{keepCase:true});
      p.bad.forEach(function(t){out.bad.push(t.replace(/^line 1:/,'line '+(i+1)+':'));});
      p.warn.forEach(function(t){out.warn.push(t.replace(/^line 1:/,'line '+(i+1)+':'));});
      p.windows.forEach(function(w){
        if(m && (!w.geometry || !Number.isFinite(tol) || tol<0 || tol>180)){out.bad.push('line '+(i+1)+': angle= needs a geometry and a tolerance from 0 to 180 degrees');return;}
        if(m)w.angleTol=tol;out.windows.push(w);
      });
    });return out;
  }
  function hasRules(r) { return !!r && /^\s*[^#\s]/m.test(String(r.text || '')); }
  function active(r) { return hasRules(r); }

  /* The rules of a phase against its atom labels: {rules, errors, warnings}. A label is taken as typed, else as the
     one atom whose label differs only in case. */
  function check(atoms, r) {
    var p = parse(normalize(r).text), errors = p.bad.slice(), warnings = p.warn.slice(), labels = (atoms || []).map(function (a) { return a.label; });
    function resolve(name) {
      if (labels.indexOf(name) >= 0) return name;
      var hit = labels.filter(function (l) { return l.toLowerCase() === name.toLowerCase(); });
      return hit.length === 1 ? hit[0] : null;
    }
    var unknown = {};
    var rules = p.windows.map(function (w) {
      var a = resolve(w.a), b = resolve(w.b);
      if (a == null) unknown[w.a] = true;
      if (b == null) unknown[w.b] = true;
      return Object.assign({}, w, { a: a == null ? w.a : a, b: b == null ? w.b : b, ok: a != null && b != null });
    });
    var seen={};rules.forEach(function(w){if(!w.ok)return;var key=ruleKey(w);if(seen[key])errors.push('Duplicate restraint for '+[w.a,w.b].sort().join(' - ')+': keep one distance or geometry rule for this atom pair.');seen[key]=true;});
    Object.keys(unknown).forEach(function (n) { errors.push('"' + n + '" is not an atom label of this phase (' + (labels.length ? labels.join(', ') : 'no atoms') + ')'); });
    return { rules: rules, errors: errors, warnings: warnings };
  }

  function ruleKey(w){return JSON.stringify([w.a,w.b].sort());}
  // Keep the current rule for an atom pair; helpers append only previously unrestrained pairs.
  function merge(atoms,current,addition){
    var base=check(atoms,{text:current});if(base.errors.length)throw new Error(base.errors[0]);
    var seen={},lines=String(current || '').trim()?[String(current).trim()]:[],added=0,skipped=0,conflicts=0;
    base.rules.forEach(function(w){seen[ruleKey(w)]=w;});
    String(addition || '').split(/\r?\n/).forEach(function(line){
      if(!line.trim() || /^\s*#/.test(line))return;
      var c=check(atoms,{text:line});if(c.errors.length)throw new Error(c.errors[0]);
      c.rules.forEach(function(w){var key=ruleKey(w);if(seen[key]){skipped++;var old=seen[key];if(['dmin','dmax','count','countMode','geometry','angleTol'].some(function(k){return old[k]!==w[k];}))conflicts++;return;}seen[key]=w;lines.push(line.trim());added++;});
    });return {text:lines.join('\n'),added:added,skipped:skipped,conflicts:conflicts};
  }

  function metric(cell) {
    var d = Math.PI / 180, ca = Math.cos(cell.alpha * d), cb = Math.cos(cell.beta * d), cg = Math.cos(cell.gamma * d), a = cell.a, b = cell.b, c = cell.c;
    return [a * a, a * b * cg, a * c * cb, a * b * cg, b * b, b * c * ca, a * c * cb, b * c * ca, c * c];
  }
  function quad(G, u, w) {
    return u[0] * (G[0] * w[0] + G[1] * w[1] + G[2] * w[2]) + u[1] * (G[3] * w[0] + G[4] * w[1] + G[5] * w[2]) + u[2] * (G[6] * w[0] + G[7] * w[1] + G[8] * w[2]);
  }
  function wrap1(x) { x -= Math.floor(x); return x > 1 - 1e-5 ? 0 : x; }
  // the distinct positions (mod the lattice) of an atom under all the operators
  function imagesOf(ops, p) {
    var seen = {}, out = [];
    ops.forEach(function (o) {
      var r = o.r, t = o.t, q = [wrap1(r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + t[0]), wrap1(r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + t[1]), wrap1(r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + t[2])];
      var key = q.map(function (x) { return Math.round(x * 1e4); }).join(',');
      if (!seen[key]) { seen[key] = true; out.push(q); }
    });
    return out;
  }
  // the images of the list within rmax of the point a, nearest first: {d, v (fractional vector a -> b)}
  function near(G, a, list, rmax, R, skipSelf) {
    var out = [], r2max = rmax * rmax;
    list.forEach(function (b) {
      var d0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = [Math.round(d0[0]), Math.round(d0[1]), Math.round(d0[2])];
      for (var i = -R; i <= R; i++) for (var j = -R; j <= R; j++) for (var k = -R; k <= R; k++) {
        var v = [d0[0] - n[0] + i, d0[1] - n[1] + j, d0[2] - n[2] + k], r2 = quad(G, v, v);
        if (r2 > r2max || (skipSelf && r2 < 1e-6)) continue;
        out.push({ d: Math.sqrt(r2), v: v });
      }
    });
    return out.sort(function (p, q) { return p.d - q.d; });
  }
  function angle(G, u, w) { var c = quad(G, u, w) / Math.sqrt(quad(G, u, u) * quad(G, w, w)); return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI; }
  function fmt(x, n) { return Number(x).toFixed(n); }

  /* The rows of the rules at the values v of one dataset (or the starting model): [{rule, kind 'd'|'gap'|'ang', text,
     val, lo, hi, dev, sigma}]; dev is the distance (Å) or angle (°) outside the window, 0 inside. A fixed number of
     rows per rule, whatever the geometry (a missing neighbour is taken at the search radius).
     def: {key, atoms [{label, site}], ops, system, uniqueAxis}; ctx: {cellOf, sitePosition} (RVCore's). */
  function rowsOf(def, rs, rules, v, ctx) {
    var pre = def.key + '.', cell = ctx.cellOf(def.system, def.uniqueAxis, function (c) { return v[pre + c]; }), G = metric(cell), pos = {}, imgs = {}, rows = [];
    (def.atoms || []).forEach(function (at) { pos[at.label] = ctx.sitePosition(at.site, [v[pre + at.label + '.x'], v[pre + at.label + '.y'], v[pre + at.label + '.z']]); });
    function images(l) { return imgs[l] || (imgs[l] = imagesOf(def.ops, pos[l])); }
    var shortest = Math.min(cell.a, cell.b, cell.c);
    rules.forEach(function (w, ri) {
      if (!w.ok || !pos[w.a] || !pos[w.b]) return;
      var base = Number.isFinite(w.dmax) ? w.dmax : Number.isFinite(w.dmin) ? w.dmin : 3, rmax = Math.max(base * 1.5 + 0.5, 3), R = Math.max(1, Math.min(3, Math.ceil(rmax / shortest)));
      var nb = near(G, pos[w.a], images(w.b), rmax, R, w.a === w.b), name = w.a + '–' + w.b;
      function dist(k, bounded, label) {
        var d = nb[k] ? nb[k].d : rmax, lo = Number.isFinite(w.dmin) ? w.dmin : null, hi = Number.isFinite(w.dmax) ? w.dmax : null;
        var dev = lo != null && d < lo ? d - lo : hi != null && d > hi ? d - hi : 0;
        rows.push({ rule: ri, kind: 'd', text: label || name, val: d, lo: lo, hi: bounded ? hi : null, dev: dev, sigma: rs.sigmaD });
      }
      if (!(w.count >= 0) || w.count == null) { dist(0, true, name + ' (nearest)'); return; }
      for (var k = 0; k < w.count; k++) dist(k, true, name + ' #' + (k + 1));
      if (w.countMode === 'exact' && Number.isFinite(w.dmax)) {
        var dn = nb[w.count] ? nb[w.count].d : rmax;
        rows.push({ rule: ri, kind: 'gap', text: name + ' #' + (w.count + 1) + ' (beyond the shell)', val: dn, lo: w.dmax, hi: null, dev: dn < w.dmax ? dn - w.dmax : 0, sigma: rs.sigmaD });
      }
      if (w.geometry) {
        var ideal = IDEAL[w.geometry];
        for (var i = 0; i < w.count; i++) for (var j = i + 1; j < w.count; j++) {
          var th = nb[i] && nb[j] ? angle(G, nb[i].v, nb[j].v) : 0, t0 = ideal.reduce(function (best, q) { return Math.abs(q - th) < Math.abs(best - th) ? q : best; }, ideal[0]);
          var tol=w.angleTol || 0,lo=Math.max(0,t0-tol),hi=Math.min(180,t0+tol),dev=th<lo?th-lo:th>hi?th-hi:0;
          rows.push({ rule: ri, kind: 'ang', text: name + ' angle #' + (i + 1) + '–#' + (j + 1), val: th, lo: lo, hi: hi, dev: dev, sigma: rs.sigmaA });
        }
      }
    });
    return rows;
  }
  /* The neighbours of every atom of the phase within rmax(labelA, labelB) Å, symmetry images included, nearest first:
     {A: [{b, d}]}. What "Suggest from the structure" reads; rmax is a function so that it can follow the radii. */
  function contacts(def, v, ctx, rmax) {
    var pre = def.key + '.', cell = ctx.cellOf(def.system, def.uniqueAxis, function (c) { return v[pre + c]; }), G = metric(cell), pos = {}, imgs = {}, out = {};
    var atoms = def.atoms || [], shortest = Math.min(cell.a, cell.b, cell.c);
    atoms.forEach(function (at) { pos[at.label] = ctx.sitePosition(at.site, [v[pre + at.label + '.x'], v[pre + at.label + '.y'], v[pre + at.label + '.z']]); });
    function images(l) { return imgs[l] || (imgs[l] = imagesOf(def.ops, pos[l])); }
    atoms.forEach(function (a) {
      out[a.label] = [];
      atoms.forEach(function (b) {
        var r = rmax(a.label, b.label), R = Math.max(1, Math.min(3, Math.ceil(r / shortest)));
        near(G, pos[a.label], images(b.label), r, R, a.label === b.label).forEach(function (n) { out[a.label].push({ b: b.label, d: n.d }); });
      });
      out[a.label].sort(function (p, q) { return p.d - q.d; });
    });
    return out;
  }
  function rows(def, restr, v, ctx) {
    var rs = normalize(restr), c = check(def.atoms, rs);
    return c.errors.length ? [] : rowsOf(def, rs, c.rules, v, ctx);
  }
  function describe(row) {
    var unit = row.kind === 'ang' ? '°' : ' Å', n = row.kind === 'ang' ? 1 : 3;
    var want = row.kind === 'ang' ? fmt(row.lo, 1)+(row.hi!==row.lo?' - '+fmt(row.hi,1):'')+unit : row.lo != null && row.hi != null ? fmt(row.lo, 2) + ' – ' + fmt(row.hi, 2) + unit : row.lo != null ? '≥ ' + fmt(row.lo, 2) + unit : row.hi != null ? '≤ ' + fmt(row.hi, 2) + unit : '';
    return row.text + ': ' + fmt(row.val, n) + unit + (want ? ' (' + want + ')' : '');
  }

  /* The restraints of a refinement problem ({phases [{key, method, atoms, ops, system, uniqueAxis, restraints}],
     datasets [{phases}]}) as one residual vector over its datasets' values; null when none is active. Throws with a
     readable message when a rule does not fit its phase.
       eval(vals)       Float64Array of residuals (sqrt(weight / holders) applied); its length never changes
       cost(vals)       the sum of squares
       details(vals)    [{phase, dataset, rows}] for the report
       prefixes         the parameter-name prefixes ("p1.") the residuals depend on */
  function prepare(problem, ctx) {
    var list = [], datasets = problem.datasets || [];
    (problem.phases || []).forEach(function (ph) {
      if (ph.method !== 'rietveld' || !active(ph.restraints)) return;
      var rs = normalize(ph.restraints), c = check(ph.atoms, rs);
      if (c.errors.length) throw new Error('Restraints of ' + (ph.name || ph.key) + ': ' + c.errors[0] + '. Fix them, or clear the rules box, under Restraints…');
      var holders = [];
      (problem.values || []).forEach(function (_, d) { if (!datasets[d] || !datasets[d].phases || datasets[d].phases.indexOf(ph.key) >= 0) holders.push(d); });
      if (holders.length) list.push({ def: ph, rs: rs, rules: c.rules, holders: holders, scale: Math.sqrt(rs.weight / holders.length) });
    });
    if (!list.length) return null;
    function each(vals, f) { list.forEach(function (e) { e.holders.forEach(function (d) { f(e, d, rowsOf(e.def, e.rs, e.rules, vals[d], ctx)); }); }); }
    function evaluate(vals) {
      var out = [];
      each(vals, function (e, d, rs) { rs.forEach(function (r) { out.push(r.dev / r.sigma * e.scale); }); });
      return Float64Array.from(out);
    }
    return {
      eval: evaluate,
      cost: function (vals) { var s = 0, r = evaluate(vals); for (var i = 0; i < r.length; i++) s += r[i] * r[i]; return s; },
      details: function (vals) { var out = []; each(vals, function (e, d, rs) { out.push({ phase: e.def.key, dataset: d, rows: rs, scale: e.scale }); }); return out; },
      prefixes: list.map(function (e) { return e.def.key + '.'; })
    };
  }
  return { DEFAULTS: DEFAULTS, normalize: normalize, hasRules: hasRules, active: active, check: check, rows: rows, contacts: contacts, describe: describe, prepare: prepare, parse: parse, merge: merge };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AtomRestraints;
