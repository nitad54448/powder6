/* Fourier maps of a powder pattern, from the intensities of a WPPF extraction and the model of a phase.
 *
 *   FourierMap.build(opts) -> {N, map (Float32Array, x fastest: i + N (j + N k)), sigma, mean, type, nRefl, nObs,
 *                              dmin, scale, peaks: [{x, y, z, height, sigmas, atom, distance, sign}], notes}
 *
 * opts.cell       {a, b, c, alpha, beta, gamma}
 * opts.ops        every operator of the setting [{r: [9], t: [3]}]
 * opts.atoms      [{label, pos: [x, y, z], occ, B, ff}]  (ff as RVCore's formFactor takes it)
 * opts.radiation  'xray' | 'neutron'
 * opts.formFactor RVCore.formFactor
 * opts.refl       the reflections of the extraction [{h, k, l, m, lp, area, group, inRange}]
 * opts.type       'diff' (Fo - Fc), 'obs' (Fo), '2fofc' (2 Fo - Fc) or 'calc' (Fc); all with the phases of Fc
 * opts.dmin       the resolution limit (Å); raised when the grid would exceed 128 points
 * opts.minSigma   the lowest peak listed, in sigma of the map (default 4)
 * opts.oversample 1 or 2: points per axis relative to the Nyquist minimum
 *
 * A powder pattern gives |F|^2 of a line, not of a reflection. The observed intensity of each overlap group of the
 * extraction is shared among its reflections in proportion to m Lp (|Fc|^2 + e), the partition of the Rietveld
 * method (e, a small share of the mean |Fc|^2, lets a reflection the model forbids come out non-zero). The phases
 * are those of the model, so a map shows the model's own atoms best; a difference map shows what the model lacks.
 * F(000) is left out: the map is relative to its mean. Amplitudes are put on the scale of Fc by one factor for all.
 *
 *    page    :  <script defer src="js/fourier_map.js">
 *    node    :  require('./fourier_map.js')
 */
var FourierMap = (function () {
  'use strict';
  var TWO_PI = 2 * Math.PI, MAX_N = 128;

  function metric(c) {
    var d = Math.PI / 180, ca = Math.cos((c.alpha == null ? 90 : c.alpha) * d), cb = Math.cos((c.beta == null ? 90 : c.beta) * d), cg = Math.cos((c.gamma == null ? 90 : c.gamma) * d);
    return [c.a * c.a, c.a * c.b * cg, c.a * c.c * cb, c.a * c.b * cg, c.b * c.b, c.b * c.c * ca, c.a * c.c * cb, c.b * c.c * ca, c.c * c.c];
  }
  function inv3(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  function volume(G) { return Math.sqrt(Math.max(0, G[0] * (G[4] * G[8] - G[5] * G[7]) - G[1] * (G[3] * G[8] - G[5] * G[6]) + G[2] * (G[3] * G[7] - G[4] * G[6]))); }
  function wrap1(x) { x -= Math.floor(x); return x > 1 - 1e-5 ? 0 : x; }

  // the distinct positions (mod the lattice) of an atom under all the operators
  function orbit(ops, p) {
    var seen = {}, out = [];
    ops.forEach(function (o) {
      var r = o.r, t = o.t, q = [wrap1(r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + t[0]), wrap1(r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + t[1]), wrap1(r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + t[2])];
      var key = q.map(function (x) { return Math.round(x * 1e4); }).join(',');
      if (!seen[key]) { seen[key] = true; out.push(q); }
    });
    return out;
  }
  // the distinct rotation parts, and the canonical member of the class of a reflection (the Laue class: R^T h and -R^T h)
  function rotations(ops) {
    var seen = {}, out = [];
    ops.forEach(function (o) { var key = o.r.join(','); if (!seen[key]) { seen[key] = true; out.push(o.r); } });
    return out;
  }
  function canonical(h, k, l, rots) {
    var best = null;
    for (var i = 0; i < rots.length; i++) {
      var r = rots[i], H = [h * r[0] + k * r[3] + l * r[6], h * r[1] + k * r[4] + l * r[7], h * r[2] + k * r[5] + l * r[8]];
      for (var s = 1; s >= -1; s -= 2) {
        var a = s * H[0], b = s * H[1], c = s * H[2];
        if (!best || a > best[0] || (a === best[0] && (b > best[1] || (b === best[1] && c > best[2])))) best = [a, b, c];
      }
    }
    return best[0] + ',' + best[1] + ',' + best[2];
  }
  // every (h, k, l) with d >= dmin, both signs
  function sphere(cell, dmin) {
    var G = metric(cell), Gi = inv3(G), q = 1 / (dmin * dmin), out = [], hm = Math.floor(cell.a / dmin), km = Math.floor(cell.b / dmin), lm = Math.floor(cell.c / dmin);
    for (var h = -hm; h <= hm; h++) for (var k = -km; k <= km; k++) for (var l = -lm; l <= lm; l++) {
      if (!h && !k && !l) continue;
      var s2 = h * (Gi[0] * h + Gi[1] * k + Gi[2] * l) + k * (Gi[3] * h + Gi[4] * k + Gi[5] * l) + l * (Gi[6] * h + Gi[7] * k + Gi[8] * l);
      if (s2 <= q * (1 + 1e-9)) out.push([h, k, l, s2]);
    }
    return out;
  }
  // the complex structure factors of hkl = [[h, k, l, 1/d^2]]
  function calcF(atoms, ops, hkl, formFactor, radiation) {
    var orbits = atoms.map(function (a) { return orbit(ops, a.pos); }), re = new Float64Array(hkl.length), im = new Float64Array(hkl.length);
    for (var n = 0; n < hkl.length; n++) {
      var h = hkl[n][0], k = hkl[n][1], l = hkl[n][2], s = Math.sqrt(hkl[n][3]), sr = 0, si = 0;
      for (var j = 0; j < atoms.length; j++) {
        var a = atoms[j], w = a.occ * formFactor(a.ff, radiation, s) * Math.exp(-a.B * s * s / 4), c = 0, sn = 0, o = orbits[j];
        for (var q = 0; q < o.length; q++) { var ph = TWO_PI * (h * o[q][0] + k * o[q][1] + l * o[q][2]); c += Math.cos(ph); sn += Math.sin(ph); }
        sr += w * c; si += w * sn;
      }
      re[n] = sr; im[n] = si;
    }
    return { re: re, im: im };
  }

  // in-place radix-2 FFT of one line of a 3D array (forward: exp(-i ...))
  function fftLine(re, im, off, stride, N, tr, ti, cosT, sinT) {
    var i, j, k;
    for (i = 0; i < N; i++) { tr[i] = re[off + i * stride]; ti[i] = im[off + i * stride]; }
    for (i = 1, j = 0; i < N; i++) {
      var bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var x = tr[i]; tr[i] = tr[j]; tr[j] = x; x = ti[i]; ti[i] = ti[j]; ti[j] = x; }
    }
    for (var len = 2; len <= N; len <<= 1) {
      var half = len >> 1, step = N / len;
      for (i = 0; i < N; i += len) for (k = 0; k < half; k++) {
        var wr = cosT[k * step], wi = -sinT[k * step], a = i + k, b = a + half;
        var xr = tr[b] * wr - ti[b] * wi, xi = tr[b] * wi + ti[b] * wr;
        tr[b] = tr[a] - xr; ti[b] = ti[a] - xi; tr[a] += xr; ti[a] += xi;
      }
    }
    for (i = 0; i < N; i++) { re[off + i * stride] = tr[i]; im[off + i * stride] = ti[i]; }
  }
  function fft3(re, im, N) {
    var tr = new Float64Array(N), ti = new Float64Array(N), cosT = new Float64Array(N / 2 || 1), sinT = new Float64Array(N / 2 || 1);
    for (var i = 0; i < N / 2; i++) { cosT[i] = Math.cos(TWO_PI * i / N); sinT[i] = Math.sin(TWO_PI * i / N); }
    var N2 = N * N;
    for (var a = 0; a < N; a++) for (var b = 0; b < N; b++) fftLine(re, im, a * N2 + b * N, 1, N, tr, ti, cosT, sinT);
    for (a = 0; a < N; a++) for (b = 0; b < N; b++) fftLine(re, im, a * N2 + b, N, N, tr, ti, cosT, sinT);
    for (a = 0; a < N; a++) for (b = 0; b < N; b++) fftLine(re, im, a * N + b, N2, N, tr, ti, cosT, sinT);
  }
  function pow2(n) { var p = 4; while (p < n) p <<= 1; return p; }

  /* The amplitudes of the reflections of the sphere: {fo, fc, known} (known: inside an overlap group of the extraction) */
  function observed(opts, hkl, F, rots) {
    var cls = {}, rep = {};
    opts.refl.forEach(function (r, i) { if (r.inRange && Number.isFinite(r.area) && r.m > 0 && r.lp > 0) cls[canonical(r.h, r.k, r.l, rots)] = i; });
    var amp2 = new Float64Array(hkl.length), mean2 = 0, nz = 0;
    for (var n = 0; n < hkl.length; n++) { amp2[n] = F.re[n] * F.re[n] + F.im[n] * F.im[n]; mean2 += amp2[n]; nz++; }
    var eps = 0.02 * (nz ? mean2 / nz : 0) + 1e-12, idx = {};
    for (n = 0; n < hkl.length; n++) { var key = canonical(hkl[n][0], hkl[n][1], hkl[n][2], rots); if (cls[key] != null && idx[key] == null) idx[key] = n; }
    // |Fc|^2 of each extracted reflection, from its own member of the sphere
    var groups = {}, fc2 = {};
    opts.refl.forEach(function (r, i) {
      var key = canonical(r.h, r.k, r.l, rots);
      if (cls[key] !== i || idx[key] == null) return;
      fc2[i] = amp2[idx[key]];
      var g = groups[r.group == null ? 'r' + i : r.group] || (groups[r.group == null ? 'r' + i : r.group] = { A: 0, W: 0, members: [] });
      g.A += Math.max(0, r.area); g.W += r.m * r.lp * (fc2[i] + eps); g.members.push(i);
    });
    var sumA = 0, sumW = 0;
    Object.keys(groups).forEach(function (g) { sumA += groups[g].A; sumW += groups[g].W; });
    var rbar = sumW > 0 && sumA > 0 ? sumA / sumW : 1, ratio = {};
    Object.keys(groups).forEach(function (g) { var G = groups[g], q = G.W > 0 ? G.A / G.W / rbar : 1; G.members.forEach(function (i) { ratio[canonical(opts.refl[i].h, opts.refl[i].k, opts.refl[i].l, rots)] = { q: q, i: i }; }); });
    var fo = new Float64Array(hkl.length), known = new Uint8Array(hkl.length), nObs = 0;
    for (n = 0; n < hkl.length; n++) {
      var c = canonical(hkl[n][0], hkl[n][1], hkl[n][2], rots), t = ratio[c], fc = Math.sqrt(amp2[n]);
      if (t) { fo[n] = Math.sqrt(Math.max(0, (amp2[n] + eps) * t.q)); known[n] = 1; nObs++; } else fo[n] = fc;
    }
    return { fo: fo, fc: Float64Array.from(amp2, Math.sqrt), known: known, nObs: nObs, scale: rbar };
  }

  function minDist2(G, a, b) { var d0 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]].map(function (v) { return v - Math.round(v); }), best = Infinity; for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) for (var k = -1; k <= 1; k++) { var x = d0[0] + i, y = d0[1] + j, z = d0[2] + k, s = x * (G[0] * x + G[1] * y + G[2] * z) + y * (G[3] * x + G[4] * y + G[5] * z) + z * (G[6] * x + G[7] * y + G[8] * z); if (s < best) best = s; } return Math.max(0, best); } function nearestAtom(cell, G, orbits, atoms, p) {
    var best = { atom: null, distance: Infinity };
    orbits.forEach(function (o, j) {
      o.forEach(function (q) {
        var r2 = minDist2(G, p, q);
        if (r2 < best.distance * best.distance) best = { atom: atoms[j].label, distance: Math.sqrt(r2) };
      });
    });
    return best;
  }
  // 3-point parabola: the offset of the extremum from the centre sample, in samples
  function vertex(m, c, p) { var den = m - 2 * c + p; return den ? Math.max(-0.5, Math.min(0.5, 0.5 * (m - p) / den)) : 0; }

  function peaks(map, N, mean, sigma, cell, G, orbits, atoms, sign, limit, minSigma) {
    var N2 = N * N, found = [], thr = minSigma * sigma;
    function at(i, j, k) { return map[((i + N) % N) + N * (((j + N) % N) + N * ((k + N) % N))]; }
    for (var k = 0; k < N; k++) for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
      var v = sign * (map[i + N * j + N2 * k] - mean);
      if (v < thr) continue;
      var top = true;
      for (var dk = -1; dk <= 1 && top; dk++) for (var dj = -1; dj <= 1 && top; dj++) for (var di = -1; di <= 1; di++) {
        if ((di || dj || dk) && sign * (at(i + di, j + dj, k + dk) - mean) > v) { top = false; break; }
      }
      if (!top) continue;
      var c = at(i, j, k), p = [(i + vertex(at(i - 1, j, k), c, at(i + 1, j, k))) / N, (j + vertex(at(i, j - 1, k), c, at(i, j + 1, k))) / N, (k + vertex(at(i, j, k - 1), c, at(i, j, k + 1))) / N];
      p = p.map(function (x) { return x - Math.floor(x); });
      var near = nearestAtom(cell, G, orbits, atoms, p);
      found.push({ x: p[0], y: p[1], z: p[2], height: c - mean, sigmas: (c - mean) / sigma, sign: sign, atom: near.atom, distance: near.distance });
    }
    found.sort(function (a, b) { return sign * (b.height - a.height); });
    // one entry per symmetry-equivalent set: drop peaks that are an image of a stronger one
    return found.slice(0, limit * 6);
  }

  function build(opts) {
    var cell = opts.cell, ops = opts.ops, atoms = opts.atoms || [], notes = [];
    if (!atoms.length) throw new Error('A Fourier map takes its phases from the model: the phase has no atoms.');
    if (!(opts.refl || []).length) throw new Error('No extracted intensities.');
    var type = opts.type || 'diff', G = metric(cell), V = volume(G), dmin = Math.max(0.3, opts.dmin > 0 ? opts.dmin : 1), rots = rotations(ops);
    var minSigma = opts.minSigma > 0 ? opts.minSigma : 4, over = opts.oversample === 2 ? 2 : 1, N, hkl;
    for (;;) {
      var hm = Math.max(Math.floor(cell.a / dmin), Math.floor(cell.b / dmin), Math.floor(cell.c / dmin));
      N = pow2((2 * hm + 1) * over);
      if (N <= MAX_N) break;
      if (over === 2) over = 1; else { dmin *= 1.1; }
    }
    if (dmin !== (opts.dmin > 0 ? opts.dmin : 1) && opts.dmin > 0) notes.push('The resolution was lowered to ' + dmin.toFixed(2) + ' Å to keep the grid within ' + MAX_N + '³.');
    hkl = sphere(cell, dmin);
    var F = calcF(atoms, ops, hkl, opts.formFactor, opts.radiation), obs = observed(opts, hkl, F, rots);
    var re = new Float64Array(N * N * N), im = new Float64Array(N * N * N), N2 = N * N;
    for (var n = 0; n < hkl.length; n++) {
      var fc = obs.fc[n], fo = obs.fo[n], c = type === 'obs' ? fo : type === 'diff' ? fo - fc : type === '2fofc' ? 2 * fo - fc : fc;
      if (!fc) { if (type === 'calc') continue; }
      var cr = fc > 1e-12 ? F.re[n] / fc : 1, ci = fc > 1e-12 ? F.im[n] / fc : 0;       // the phase of Fc (0 for a zero Fc)
      var i = ((hkl[n][0] % N) + N) % N, j = ((hkl[n][1] % N) + N) % N, k = ((hkl[n][2] % N) + N) % N;
      re[i + N * j + N2 * k] += c * cr / V; im[i + N * j + N2 * k] += c * ci / V;
    }
    fft3(re, im, N);
    var map = new Float32Array(N * N * N), sum = 0, sum2 = 0;
    for (n = 0; n < map.length; n++) { map[n] = re[n]; sum += re[n]; sum2 += re[n] * re[n]; }
    var mean = sum / map.length, sigma = Math.sqrt(Math.max(0, sum2 / map.length - mean * mean));
    var orbits = atoms.map(function (a) { return orbit(ops, a.pos); }), list = [];
    if (sigma > 0) {
      list = peaks(map, N, mean, sigma, cell, G, orbits, atoms, 1, 40, minSigma);
      if (type === 'diff') list = list.concat(peaks(map, N, mean, sigma, cell, G, orbits, atoms, -1, 40, minSigma));
    }
    // one entry per set of equivalent positions: keep the strongest, count the others
    var kept = [];
    list.forEach(function (p) {
      var img = orbit(ops, [p.x, p.y, p.z]), dup = kept.find(function (q) {
        if (q.sign !== p.sign) return false;
        return img.some(function (o) { return minDist2(G, [q.x, q.y, q.z], o) < 0.16; });
      });
      if (dup) dup.copies = (dup.copies || 1) + 1; else { p.copies = 1; kept.push(p); }
    });
    kept.sort(function (a, b) { return Math.abs(b.sigmas) - Math.abs(a.sigmas); });
    return { N: N, map: map, sigma: sigma, mean: mean, type: type, nRefl: hkl.length, nObs: obs.nObs, dmin: dmin, scale: obs.scale, peaks: kept.slice(0, 40), notes: notes, volume: V, minSigma: minSigma };
  }
  return { build: build, sphere: sphere, calcF: calcF, canonical: canonical, rotations: rotations, orbit: orbit, fft3: fft3, metric: metric };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = FourierMap;
