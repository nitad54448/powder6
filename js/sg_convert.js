/* A phase carried to another space group by a change of basis (P, p), as in International Tables A, 1.5:
 *
 *   (a', b', c') = (a, b, c) P        p: the new origin in the old basis
 *   x' = P^-1 (x - p)                 G' = P^T G P             h' = h P
 *   (W', w') = (P^-1 W P,  P^-1 (W p + w - p))
 *
 * P is row-major, its COLUMNS are the new basis vectors in the old basis ("a+b,-a+b,c": columns (1,1,0), (-1,1,0), (0,0,1)).
 * The structure is expanded to the full cell in the old group, carried to the new basis and reduced to the orbits of the new
 * group. An image the new group demands that finds no atom of the same kind is a violation: the structure does not have
 * that symmetry, and the conversion is refused rather than inventing or dropping atoms. */
(function (root) {
  'use strict';
  var I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function det3(m) { return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]); }
  function inv3(m) {
    var d = det3(m);
    if (Math.abs(d) < 1e-12) return null;
    return [(m[4] * m[8] - m[5] * m[7]) / d, (m[2] * m[7] - m[1] * m[8]) / d, (m[1] * m[5] - m[2] * m[4]) / d,
            (m[5] * m[6] - m[3] * m[8]) / d, (m[0] * m[8] - m[2] * m[6]) / d, (m[2] * m[3] - m[0] * m[5]) / d,
            (m[3] * m[7] - m[4] * m[6]) / d, (m[1] * m[6] - m[0] * m[7]) / d, (m[0] * m[4] - m[1] * m[3]) / d];
  }
  function mul3(a, b) { var o = new Array(9); for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return o; }
  function mulv(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  function transpose(m) { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }
  function clean(v) { var r = Math.round(v); return Math.abs(v - r) < 1e-9 ? r : v; }
  function wrap(v) { v -= Math.floor(v); if (v > 1 - 1e-9) v = 0; return Math.abs(v) < 1e-12 ? 0 : v; }
  function isInt(v) { return Math.abs(v - Math.round(v)) < 1e-6; }

  // ---------------------------------------------------------------- metric
  function metric(c) {
    var r = Math.PI / 180, ca = Math.cos(c.alpha * r), cb = Math.cos(c.beta * r), cg = Math.cos(c.gamma * r);
    return [c.a * c.a, c.a * c.b * cg, c.a * c.c * cb, c.a * c.b * cg, c.b * c.b, c.b * c.c * ca, c.a * c.c * cb, c.b * c.c * ca, c.c * c.c];
  }
  function cellFromMetric(G) {
    var a = Math.sqrt(G[0]), b = Math.sqrt(G[4]), c = Math.sqrt(G[8]), d = 180 / Math.PI;
    return { a: a, b: b, c: c, alpha: Math.acos(Math.max(-1, Math.min(1, G[5] / (b * c)))) * d, beta: Math.acos(Math.max(-1, Math.min(1, G[2] / (a * c)))) * d, gamma: Math.acos(Math.max(-1, Math.min(1, G[1] / (a * b)))) * d };
  }
  function transformCell(cell, P) { return cellFromMetric(mul3(mul3(transpose(P), metric(cell)), P)); }
  // the length of a fractional difference, the nearest lattice image taken
  function dist(G, a, b) {
    var d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]].map(function (v) { return v - Math.round(v); });
    var best = Infinity;
    for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) for (var k = -1; k <= 1; k++) {
      var e = [d[0] + i, d[1] + j, d[2] + k], q = mulv(G, e), s = e[0] * q[0] + e[1] * q[1] + e[2] * q[2];
      if (s < best) best = s;
    }
    return Math.sqrt(Math.max(0, best));
  }

  // ---------------------------------------------------------------- the transformation as text
  function num(s) {
    s = String(s).trim();
    if (!s) return 1;
    var m = /^([+-]?)(\d*\.?\d+)(?:\/(\d*\.?\d+))?$/.exec(s);
    if (!m) return NaN;
    var v = parseFloat(m[2]) / (m[3] ? parseFloat(m[3]) : 1);
    return m[1] === '-' ? -v : v;
  }
  /** "a+b,-a+b,c" or "1/2a+1/2b, ..." -> P (the columns are a', b', c'); null if it cannot be read or is singular. */
  function parseBasis(text) {
    var parts = String(text || '').replace(/\s+/g, '').toLowerCase().split(/[,;]/);
    if (parts.length !== 3) return null;
    var P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var j = 0; j < 3; j++) {
      var s = parts[j], seen = 0;
      if (!s) return null;
      var re = /([+-]?)([\d.\/]*)\*?([abc])/g, m, used = 0;
      while ((m = re.exec(s))) {
        if (m.index !== used) return null;
        var f = num(m[2] === '' ? '1' : m[2]);
        if (!Number.isFinite(f)) return null;
        P['abc'.indexOf(m[3]) * 3 + j] += m[1] === '-' ? -f : f;
        used = re.lastIndex; seen++;
      }
      if (!seen || used !== s.length) return null;
    }
    return Math.abs(det3(P)) > 1e-9 ? P : null;
  }
  /** "0,0,1/4" or "1/4 0 0" -> p; null if it cannot be read. */
  function parseShift(text) {
    var s = String(text || '').trim();
    if (!s) return [0, 0, 0];
    var parts = s.split(/[\s,;]+/).filter(Boolean);
    if (parts.length !== 3) return null;
    var p = parts.map(function (q) { return /^[+-]?$/.test(q) ? NaN : num(q); });
    return p.every(Number.isFinite) ? p : null;
  }
  function fracText(v) {
    var neg = v < 0, a = Math.abs(v);
    for (var d = 1; d <= 24; d++) { var n = Math.round(a * d); if (Math.abs(a * d - n) < 1e-6) return (neg ? '-' : '') + (d === 1 ? String(n) : n + '/' + d); }
    return String(+v.toFixed(6));
  }
  function formatBasis(P) {
    return [0, 1, 2].map(function (j) {
      var s = '';
      for (var i = 0; i < 3; i++) {
        var c = P[i * 3 + j];
        if (Math.abs(c) < 1e-9) continue;
        var t = Math.abs(Math.abs(c) - 1) < 1e-9 ? '' : fracText(Math.abs(c));
        s += (c < 0 ? '-' : s ? '+' : '') + t + 'abc'.charAt(i);
      }
      return s || '0';
    }).join(',');
  }
  function formatShift(p) { return p.map(fracText).join(','); }
  function isIdentity(P, p) { return P.every(function (v, i) { return Math.abs(v - I3[i]) < 1e-9; }) && (!p || p.every(function (v) { return isInt(v); })); }

  // ---------------------------------------------------------------- operators
  function opToNew(op, P, p, Pi) {
    Pi = Pi || inv3(P);
    var W = op.r, Wn = mul3(mul3(Pi, W), P).map(clean), Wp = mulv(W, p), w = op.t;
    var t = mulv(Pi, [Wp[0] + w[0] - p[0], Wp[1] + w[1] - p[1], Wp[2] + w[2] - p[2]]).map(wrap);
    return { r: Wn, t: t };
  }
  function opToOld(op, P, p, Pi) {
    Pi = Pi || inv3(P);
    var Wo = mul3(mul3(P, op.r), Pi).map(clean), Pw = mulv(P, op.t), Wp = mulv(Wo, p);
    return { r: Wo, t: [Pw[0] + p[0] - Wp[0], Pw[1] + p[1] - Wp[1], Pw[2] + p[2] - Wp[2]].map(wrap) };
  }
  function rotKey(r) { return r.map(function (v) { return Math.round(v); }).join(','); }
  function intRot(r) { return r.every(isInt); }
  // the translations of a group by rotation, for membership tests
  function index(ops) {
    var m = new Map();
    ops.forEach(function (o) { var k = rotKey(o.r); if (!m.has(k)) m.set(k, []); m.get(k).push(o.t); });
    return m;
  }
  function member(op, idx) {
    if (!intRot(op.r)) return false;
    var ts = idx.get(rotKey(op.r));
    if (!ts) return false;
    return ts.some(function (t) { return isInt(op.t[0] - t[0]) && isInt(op.t[1] - t[1]) && isInt(op.t[2] - t[2]); });
  }
  /** How the groups relate in the transformation: 'same', 'subgroup' (the new one is a subgroup of the old one), 'supergroup', or ''. */
  function relation(fromOps, toOps, P, p) {
    var Pi = inv3(P), oldIdx = index(fromOps), newIdx = index(toOps);
    var sub = toOps.every(function (o) { return member(opToOld(o, P, p, Pi), oldIdx); });
    var sup = fromOps.every(function (o) { return member(opToNew(o, P, p, Pi), newIdx); });
    return sub && sup ? 'same' : sub ? 'subgroup' : sup ? 'supergroup' : '';
  }

  // ---------------------------------------------------------------- finding a transformation
  var unimodular = null;
  function candidates() {
    if (unimodular) return unimodular;
    unimodular = [];
    var v = [-1, 0, 1], m = new Array(9);
    (function rec(i) {
      if (i === 9) { if (Math.abs(det3(m) - 1) < 1e-9) unimodular.push(m.slice()); return; }
      for (var k = 0; k < 3; k++) { m[i] = v[k]; rec(i + 1); }
    })(0);
    unimodular.sort(function (a, b) { return offDiagonal(a) - offDiagonal(b); });
    return unimodular;
  }
  function offDiagonal(P) { var n = 0; for (var i = 0; i < 9; i++) if (Math.abs(P[i] - I3[i]) > 1e-9) n++; return n; }
  /* The worst relative misfit between a cell and the same cell made to obey a crystal system (lengths relative,
     angles in degrees / 90): 0 when the cell already has the metric the new group demands. */
  function metricMisfit(cell, normalise) {
    if (!normalise) return 0;
    var n = normalise(cell);
    if (!n) return Infinity;
    return Math.max(Math.abs(n.a - cell.a) / cell.a, Math.abs(n.b - cell.b) / cell.b, Math.abs(n.c - cell.c) / cell.c,
                    Math.abs(n.alpha - cell.alpha) / 90, Math.abs(n.beta - cell.beta) / 90, Math.abs(n.gamma - cell.gamma) / 90);
  }
  /**
   * The basis changes with entries -1, 0, 1 (determinant +1, so the hand is kept) and origin shifts in eighths that relate the
   * two groups (same group, subgroup or supergroup), best first: the smallest metric misfit, then the fewest changed axes, then
   * the smallest shift. opts: { normalise(cell) -> the cell the new system demands, maxMisfit (0.03), limit (8) }.
   */
  function findTransforms(fromOps, toOps, cell, opts) {
    opts = opts || {};
    var maxMisfit = opts.maxMisfit != null ? opts.maxMisfit : 0.03, limit = opts.limit || 8, out = [];
    var oldIdx = index(fromOps), newIdx = index(toOps), oldRot = new Set(fromOps.map(function (o) { return rotKey(o.r); })), newRot = new Set(toOps.map(function (o) { return rotKey(o.r); }));
    var shifts = [];
    for (var i = 0; i < 8; i++) for (var j = 0; j < 8; j++) for (var k = 0; k < 8; k++) shifts.push([i / 8, j / 8, k / 8]);
    shifts.sort(function (a, b) { return shiftSize(a) - shiftSize(b); });
    candidates().forEach(function (P) {
      var Pi = inv3(P).map(clean), newCell = transformCell(cell, P), misfit = metricMisfit(newCell, opts.normalise);
      if (!(misfit <= maxMisfit)) return;
      // the rotation parts first: they do not depend on the shift
      var sub = toOps.every(function (o) { var r = mul3(mul3(P, o.r), Pi).map(clean); return intRot(r) && oldRot.has(rotKey(r)); });
      var sup = fromOps.every(function (o) { var r = mul3(mul3(Pi, o.r), P).map(clean); return intRot(r) && newRot.has(rotKey(r)); });
      if (!sub && !sup) return;
      for (var s = 0; s < shifts.length; s++) {
        var p = shifts[s];
        var okSub = sub && toOps.every(function (o) { return member(opToOld(o, P, p, Pi), oldIdx); });
        var okSup = sup && fromOps.every(function (o) { return member(opToNew(o, P, p, Pi), newIdx); });
        if (okSub || okSup) {
          out.push({ P: P, p: p.map(function (v) { return v > 0.5 + 1e-9 ? v - 1 : v; }), relation: okSub && okSup ? 'same' : okSub ? 'subgroup' : 'supergroup', misfit: misfit, changed: offDiagonal(P), shift: shiftSize(p), compact: compactness(newCell), cell: newCell });
          break;
        }
      }
    });
    var rank = { same: 0, subgroup: 1, supergroup: 2 };
    out.sort(function (a, b) { return (Math.round(a.misfit * 1e4) - Math.round(b.misfit * 1e4)) || ((a.changed > 0) - (b.changed > 0)) || (Math.round(a.compact * 1e3) - Math.round(b.compact * 1e3)) || (acute(a.cell) - acute(b.cell)) || (a.changed - b.changed) || (a.shift - b.shift) || (rank[a.relation] - rank[b.relation]); });
    return out.slice(0, limit);
  }
  // how far an origin shift is from none, a shift of 7/8 counting as -1/8
  function shiftSize(p) { return p.reduce(function (s, v) { var w = v - Math.floor(v); return s + Math.min(w, 1 - w); }, 0); }
  // the convention for oblique cells is obtuse angles (monoclinic beta > 90)
  function acute(c) { return (c.alpha < 89.999) + (c.beta < 89.999) + (c.gamma < 89.999); }
  // a smaller, less oblique cell first: the sum of the edges (relative) and the departure of the angles from 90 degrees
  function compactness(c) { return (c.a + c.b + c.c) / Math.cbrt(Math.max(1e-9, c.a * c.b * c.c)) + (Math.abs(c.alpha - 90) + Math.abs(c.beta - 90) + Math.abs(c.gamma - 90)) / 90; }

  // ---------------------------------------------------------------- the structure
  function inverseOp(o) { var Wi = inv3(o.r).map(clean), t = mulv(Wi, o.t); return { r: Wi, t: [-t[0], -t[1], -t[2]] }; }
  function apply(o, x) { var y = mulv(o.r, x); return [y[0] + o.t[0], y[1] + o.t[1], y[2] + o.t[2]]; }
  // the lattice image of a nearest to b
  function near(a, b) { return [0, 1, 2].map(function (i) { return a[i] - Math.round(a[i] - b[i]); }); }
  function species(a) { return String(a.type) + '|' + (+(Number.isFinite(a.occ) ? a.occ : 1).toFixed(3)); }
  /**
   * atoms [{label, type, x, y, z, occ, B}] in fromOps, cell -> the same structure in toOps after (P, p).
   * opts: { tol (Å, 0.1): how far an image the new group demands may be from an atom of the same kind;
   *         cell: the new cell to measure distances in (default P^T G P) }.
   * Returns { cell, atoms: [{label, type, x, y, z, occ, B, mult, from: {index, label, op, shift}}], violations: [text], contentOld,
   * contentNew, split: {label: n}, merged: [[labels]] }. `from` rebuilds an atom from other values of its source atom: derive().
   */
  function convertStructure(atoms, fromOps, toOps, cell, P, p, opts) {
    opts = opts || {};
    var tol = opts.tol > 0 ? opts.tol : 0.1, Pi = inv3(P), Gold = metric(cell), newCell = opts.cell || transformCell(cell, P), Gnew = metric(newCell);
    // 1. the full cell in the old group
    var full = [], contentOld = 0;
    atoms.forEach(function (a, ai) {
      var x = [a.x, a.y, a.z], pts = [];
      fromOps.forEach(function (o, gi) {
        var y = apply(o, x), t0 = y.map(function (v) { return -Math.floor(v + 1e-9); }), w = [y[0] + t0[0], y[1] + t0[1], y[2] + t0[2]];
        if (pts.some(function (q) { return dist(Gold, q.y, w) < 0.01; })) return;
        pts.push({ ai: ai, gi: gi, t0: t0, y: w });
      });
      contentOld += pts.length * (Number.isFinite(a.occ) ? a.occ : 1);
      full = full.concat(pts);
    });
    // 2. carried into the new cell, every lattice translation that lands inside it
    var corners = [];
    for (var i = 0; i < 8; i++) corners.push(mulv(P, [i & 1, (i >> 1) & 1, (i >> 2) & 1]));
    var lo = [0, 1, 2].map(function (k) { return Math.min.apply(null, corners.map(function (c) { return c[k]; })); });
    var hi = [0, 1, 2].map(function (k) { return Math.max.apply(null, corners.map(function (c) { return c[k]; })); });
    var pts = [];
    full.forEach(function (q) {
      var r = [0, 1, 2].map(function (k) { return [Math.floor(lo[k] - q.y[k] + p[k]) - 1, Math.ceil(hi[k] - q.y[k] + p[k]) + 1]; });
      for (var t0 = r[0][0]; t0 <= r[0][1]; t0++) for (var t1 = r[1][0]; t1 <= r[1][1]; t1++) for (var t2 = r[2][0]; t2 <= r[2][1]; t2++) {
        var xn = mulv(Pi, [q.y[0] + t0 - p[0], q.y[1] + t1 - p[1], q.y[2] + t2 - p[2]]);
        if (!xn.every(function (v) { return v > -1e-7 && v < 1 - 1e-7; })) continue;
        xn = xn.map(function (v) { return v < 0 ? 0 : v; });
        if (pts.some(function (s) { return s.ai === q.ai && dist(Gnew, s.x, xn) < 0.01; })) continue;
        pts.push({ ai: q.ai, gi: q.gi, shift: [q.t0[0] + t0, q.t0[1] + t1, q.t0[2] + t2], x: xn, used: false });
      }
    });
    // 3. the orbits of the new group; each demanded image must find an atom of the same kind
    var violations = [], out = [], perLabel = {}, merged = [];
    var invOps = toOps.map(inverseOp);
    pts.forEach(function (q) {
      if (q.used) return;
      var a = atoms[q.ai], kind = species(a), images = [], members = [], sources = new Set([a.label]);
      toOps.forEach(function (o, gi) {
        var im = apply(o, q.x).map(wrap);
        if (images.some(function (s) { return dist(Gnew, s, im) < 0.01; })) return;
        images.push(im);
        var best = null, bd = Infinity;
        pts.forEach(function (s) { if (species(atoms[s.ai]) !== kind) return; var d = dist(Gnew, s.x, im); if (d < bd) { bd = d; best = s; } });
        if (!best || bd > tol) {
          if (violations.length < 50) violations.push(a.label + ' (' + a.type + '): the new symmetry needs an equivalent atom at ' + im.map(function (v) { return v.toFixed(4); }).join(', ') +
            ' and the nearest ' + a.type + ' of the same occupancy is ' + (best ? bd.toFixed(2) + ' Å away' : 'missing') + ' (tolerance ' + tol + ' Å).');
          return;
        }
        best.used = true; sources.add(atoms[best.ai].label);
        members.push({ g: gi, s: best });
      });
      // the representative: the mean of the images brought back by the inverse operators (exact for a symmetric structure)
      var sum = [0, 0, 0], Bs = 0;
      members.forEach(function (m) { var back = near(apply(invOps[m.g], m.s.x), q.x); sum[0] += back[0]; sum[1] += back[1]; sum[2] += back[2]; Bs += Number.isFinite(atoms[m.s.ai].B) ? atoms[m.s.ai].B : 0; });
      var n = Math.max(1, members.length), rep = members.length ? sum.map(function (v) { return v / n; }) : q.x.slice();
      // shown as the image of the orbit nearest the origin (1/8,1/8,1/8 rather than 7/8,7/8,7/8); the operator that picks it is
      // kept, so that other values of the source atom are carried the same way
      var pick = null;
      toOps.forEach(function (o, gi) {
        var y = apply(o, rep), t = y.map(function (v) { return -Math.floor(v + 1e-9); }), w = [y[0] + t[0], y[1] + t[1], y[2] + t[2]].map(function (v) { return v > 1 - 1e-9 ? 0 : v; });
        var key = w[0] + w[1] + w[2] + 1e-6 * (w[0] * 9 + w[1] * 3 + w[2]);
        if (!pick || key < pick.key - 1e-12) pick = { key: key, x: w, op: gi, shift: t };
      });
      perLabel[a.label] = (perLabel[a.label] || 0) + 1;
      if (sources.size > 1) merged.push(Array.from(sources));
      out.push({ label: a.label, type: a.type, x: pick.x[0], y: pick.x[1], z: pick.x[2], occ: Number.isFinite(a.occ) ? a.occ : 1, B: members.length ? Bs / members.length : a.B, mult: images.length,
                 from: { index: q.ai, label: a.label, op: q.gi, shift: q.shift, newOp: pick.op, newShift: pick.shift } });
    });
    // 4. names: an atom split over several orbits becomes Fe1a, Fe1b, ...
    var count = {};
    out.forEach(function (a) { if (perLabel[a.from.label] > 1) { count[a.from.label] = (count[a.from.label] || 0) + 1; a.label = a.from.label + String.fromCharCode(96 + Math.min(26, count[a.from.label])); } });
    var contentNew = out.reduce(function (s, a) { return s + a.mult * a.occ; }, 0), split = {};
    Object.keys(perLabel).forEach(function (l) { if (perLabel[l] > 1) split[l] = perLabel[l]; });
    return { cell: newCell, atoms: out, violations: violations, contentOld: contentOld, contentExpected: contentOld * Math.abs(det3(P)), contentNew: contentNew, split: split, merged: merged };
  }
  /** The position of a converted atom from other values (a dataset's) of its source atom: x' = P^-1 (W x + w + shift - p),
      then the new-group operator and translation that picked the representative shown. */
  function derive(from, xyzOld, fromOps, P, p, toOps) {
    var o = fromOps[from.op], y = apply(o, xyzOld), Pi = inv3(P);
    var x = mulv(Pi, [y[0] + from.shift[0] - p[0], y[1] + from.shift[1] - p[1], y[2] + from.shift[2] - p[2]]);
    if (toOps && from.newOp != null) { var z = apply(toOps[from.newOp], x); x = [z[0] + from.newShift[0], z[1] + from.newShift[1], z[2] + from.newShift[2]]; }
    return x;
  }
  /** Miller indices (a reciprocal direction) in the new basis: h' = h P. */
  function hklToNew(h, P) { return [0, 1, 2].map(function (j) { return clean(h[0] * P[j] + h[1] * P[3 + j] + h[2] * P[6 + j]); }); }

  var api = { det3: det3, inv3: inv3, metric: metric, cellFromMetric: cellFromMetric, transformCell: transformCell, parseBasis: parseBasis, parseShift: parseShift,
              formatBasis: formatBasis, formatShift: formatShift, isIdentity: isIdentity, opToNew: opToNew, opToOld: opToOld, relation: relation,
              findTransforms: findTransforms, metricMisfit: metricMisfit, convertStructure: convertStructure, derive: derive, hklToNew: hklToNew, IDENTITY: I3.slice() };
  root.SGConvert = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
