/*  The space-group test (spacegroup_ui.js, SGTEST), without its DOM: Markvardsen, David, Johnson and
 *  Shankland, Acta Cryst. (2001) A57, 47-54, "A probabilistic approach to space-group determination from powder
 *  diffraction data".
 *
 *  Every setting of the Laue class of the phase is a candidate; settings that predict the same absences among the
 *  tested reflections are one group, with one probability (powder data cannot tell them apart). The evidence of a
 *  group integrates the intensities it declares present against a Wilson-like prior, with the full correlation of the
 *  WPPF intensities (their precision matrix, the other parameters integrated out), and pins the ones it declares absent
 *  at zero.
 *
 *  A reflection can only be tested if it was a variable of the WPPF fit: a fit run in a group that already forbids some
 *  reflections never measured them. For a complete test, fit in the condition-free group of the Laue class (P-1,
 *  P2/m, Pmmm, P4/mmm, P6/mmm, Pm-3m, ...): run() says so when it was not.
 *
 *  RV.sgtest.run({ refl: [{ h, k, l, tth, I }] (in 2theta order, I on the scale of |F|^2), Q (n x n precision of I,
 *                  rows of Float64Array, already divided by the variance scale), sigma2 (diagonal errors), fitRec (the
 *                  setting the WPPF fit was run in, as SG_ENGINE.listSettings gives it), cell, lambda,
 *                  marginalised, truncatedTo })
 *  -> { rows: [{ recs, m, untested, lnL, meanIsig, maxIsig, p }], n, laue, openRec, wppfIsOpen, missingCount, ... }
 */
RV.sgtest = (function () {
  'use strict';
  var C = RVCore;

  // ---------------------------------------------------------------- small dense linear algebra (symmetric, PD)
  function chol(A) {
    var n = A.length, L = [], i, j, k;
    for (i = 0; i < n; i++) L.push(new Float64Array(n));
    for (i = 0; i < n; i++) {
      for (j = 0; j <= i; j++) {
        var s = A[i][j];
        for (k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) { if (!(s > 0) || !isFinite(s)) return null; L[i][i] = Math.sqrt(s); }
        else L[i][j] = s / L[j][j];
      }
    }
    return L;
  }
  function cholLogDet(L) { var s = 0; for (var i = 0; i < L.length; i++) s += 2 * Math.log(L[i][i]); return s; }
  function cholSolve(L, b) {
    var n = L.length, y = new Float64Array(n), x = new Float64Array(n), i, k, s;
    for (i = 0; i < n; i++) { s = b[i]; for (k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    for (i = n - 1; i >= 0; i--) { s = y[i]; for (k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }
  function cholInverseDiag(L) {
    var n = L.length, d = new Float64Array(n), e = new Float64Array(n);
    for (var c = 0; c < n; c++) { e.fill(0); e[c] = 1; d[c] = cholSolve(L, e)[c]; }
    return d;
  }

  // ---------------------------------------------------------------- space groups
  var PROBE = [];
  for (var h = -3; h <= 3; h++) for (var k = -3; k <= 3; k++) for (var l = -3; l <= 3; l++) if (h || k || l) PROBE.push([h, k, l]);
  var opsCache = new Map();
  function opsOf(rec) {
    var key = rec.number + '|' + rec.hall;
    if (!opsCache.has(key)) opsCache.set(key, C.expandOps(rec.sym_ops || [], rec.centring_translations));
    return opsCache.get(key);
  }
  function allowed(rec, h, k, l) { return C.isAllowed(h, k, l, opsOf(rec)); }
  function isConditionFree(rec) {
    if (!rec || !rec.sym_ops) return false;
    for (var i = 0; i < PROBE.length; i++) if (!allowed(rec, PROBE[i][0], PROBE[i][1], PROBE[i][2])) return false;
    return true;
  }
  // every setting of the Laue class (SG_ENGINE.listSettings leaves out the rhombohedral-axes ones)
  function candidates(laue) {
    var out = [];
    if (typeof SG_ENGINE === 'undefined') return out;
    for (var num = 1; num <= 230; num++) {
      var entries;
      try { entries = SG_ENGINE.listSettings(num) || []; } catch (e) { entries = []; }
      entries.forEach(function (rec) { if (rec && rec.laue_class === laue && rec.sym_ops) out.push(rec); });
    }
    return out;
  }
  function label(rec) { return String(rec.symbol || rec.standard_symbol || '#' + rec.number).replace(/\s+/g, ' ').trim(); }
  // the listSettings record of a phase's space group
  function recordOf(sg) {
    if (typeof SG_ENGINE === 'undefined' || !sg) return null;
    var list = SG_ENGINE.listSettings(sg.number) || [];
    return list.filter(function (r) { return r.hall === sg.hall; })[0] || list.filter(function (r) { return r.symbol === sg.symbol; })[0] || null;
  }

  // ---------------------------------------------------------------- the test
  function run(inp) {
    var refl = inp.refl, Q = inp.Q, sigma2 = inp.sigma2, n = refl.length, fit = inp.fitRec;
    if (!fit) return { error: 'The space group of the phase is not in the database.' };
    if (n < 4) return { error: 'Only ' + n + ' usable WPPF intensities: far too few to say anything about the space group.' };
    var laue = fit.laue_class;
    var Ivec = Float64Array.from(refl, function (r) { return r.I; }), cvec = new Float64Array(n), i, j;
    for (i = 0; i < n; i++) { var s = 0; for (j = 0; j < n; j++) s += Q[i][j] * Ivec[j]; cvec[i] = s; }
    var sig = new Float64Array(n);
    for (i = 0; i < n; i++) sig[i] = Math.sqrt(Math.max(1e-300, sigma2[i]));

    // tau^2, the Wilson-like scale of the reflections a candidate declares present, from a sliding window over that
    // candidate's free set only (refl is in 2theta order); the measurement variance subtracted, floored at it
    function tauForFreeSet(free) {
      var nf = free.length, tau2 = new Float64Array(nf), q;
      if (!nf) return tau2;
      var globalMS = 0;
      for (q = 0; q < nf; q++) { var I0 = refl[free[q]].I; globalMS += I0 * I0; }
      globalMS = Math.max(1e-12, globalMS / nf);
      var win = Math.max(10, Math.min(nf, Math.round(nf / 5)));
      for (var a = 0; a < nf; a++) {
        var lo = Math.max(0, Math.min(nf - win, a - (win >> 1))), hi = Math.min(nf, lo + win), s2 = 0, v = 0, c = 0;
        for (q = lo; q < hi; q++) { var I1 = refl[free[q]].I; s2 += I1 * I1; var sv = sigma2[free[q]]; if (isFinite(sv)) v += sv; c++; }
        var t = c ? (s2 - v) / c : 0, fl = isFinite(sigma2[free[a]]) ? sigma2[free[a]] : 0;
        if (!(t > fl)) t = fl;
        if (!(t > 0) || !isFinite(t)) t = globalMS;
        tau2[a] = t;
      }
      return tau2;
    }
    // evidence of a candidate given the reflections it declares absent; B = Q_ff + diag(1/tau^2) is positive definite
    // even when Q is singular, so exact coincidences are harmless here
    function evidence(ext) {
      var isExt = new Uint8Array(n);
      ext.forEach(function (a) { isExt[a] = 1; });
      var free = [];
      for (var q = 0; q < n; q++) if (!isExt[q]) free.push(q);
      var nf = free.length;
      if (!nf) return 0;
      var tau2 = tauForFreeSet(free), B = [];
      for (var a = 0; a < nf; a++) {
        var row = new Float64Array(nf), qa = Q[free[a]];
        for (var b = 0; b < nf; b++) row[b] = qa[free[b]];
        row[a] += 1 / tau2[a];
        B.push(row);
      }
      var LB = chol(B);
      if (!LB) return null;
      var bvec = Float64Array.from(free, function (x) { return cvec[x]; }), y = cholSolve(LB, bvec), quad = 0, lnTau = 0;
      for (a = 0; a < nf; a++) { quad += bvec[a] * y[a]; lnTau += Math.log(tau2[a]); }
      return -0.5 * (lnTau + cholLogDet(LB) - quad);
    }

    var cands = candidates(laue);
    if (!cands.length) return { error: 'No space-group setting found for the Laue class ' + laue + '.' };
    var openRec = cands.filter(isConditionFree)[0] || null, wppfIsOpen = isConditionFree(fit);

    // reflections the WPPF model never contained (forbidden by the group it was fitted in), so never tested
    var missing = null;
    if (!wppfIsOpen && openRec && inp.cell && inp.lambda > 0) {
      try {
        var have = new Set(refl.map(function (r) { return r.h + ',' + r.k + ',' + r.l; })), loT = refl[0].tth, hiT = refl[n - 1].tth;
        var dmin = inp.lambda / (2 * Math.sin(Math.min(179, hiT + 0.5) * Math.PI / 360));
        missing = C.generateReflections(inp.cell, opsOf(openRec), dmin * 0.999).filter(function (r) {
          var sT = inp.lambda / (2 * r.d0);
          if (!(sT < 1)) return false;
          var t = 2 * Math.asin(sT) * 180 / Math.PI;
          return t >= loT - 0.05 && t <= hiT + 0.05 && !have.has(r.h + ',' + r.k + ',' + r.l) && !(fit && allowed(fit, r.h, r.k, r.l));
        }).map(function (r) { return [r.h, r.k, r.l]; });
      } catch (e) { missing = null; }
    }

    var groups = new Map();
    cands.forEach(function (rec) {
      var sigStr = '', ext = [];
      for (var q = 0; q < n; q++) { if (allowed(rec, refl[q].h, refl[q].k, refl[q].l)) sigStr += '1'; else { sigStr += '0'; ext.push(q); } }
      var row = groups.get(sigStr);
      if (!row) {
        row = { ext: ext, recs: [], untested: 0 };
        if (missing) missing.forEach(function (m) { if (!allowed(rec, m[0], m[1], m[2])) row.untested++; });
        groups.set(sigStr, row);
      }
      row.recs.push(rec);
    });

    var rows = [];
    groups.forEach(function (row) {
      var e = row.ext, m = e.length, lnL = evidence(e);
      if (lnL === null || !isFinite(lnL)) return;
      var meanIsig = 0, maxIsig = 0;
      e.forEach(function (q) { var z = refl[q].I / sig[q]; meanIsig += z; if (Math.abs(z) > Math.abs(maxIsig)) maxIsig = z; });
      if (m) meanIsig /= m;
      rows.push({ recs: row.recs, m: m, ext: e, untested: row.untested, lnL: lnL, meanIsig: meanIsig, maxIsig: maxIsig });
    });
    if (!rows.length) return { error: 'No candidate space group could be evaluated.' };
    // a flat prior over the distinct sets of absences
    var maxLn = -Infinity, norm = 0;
    rows.forEach(function (r) { if (r.lnL > maxLn) maxLn = r.lnL; });
    rows.forEach(function (r) { r.w = Math.exp(r.lnL - maxLn); norm += r.w; });
    rows.forEach(function (r) { r.p = r.w / norm; });
    rows.sort(function (a, b) { return b.p - a.p; });
    return { rows: rows, n: n, laue: laue, fitRec: fit, openRec: openRec, wppfIsOpen: wppfIsOpen, missingCount: missing ? missing.length : 0,
             sigmaExact: !!inp.sigmaExact, marginalised: !!inp.marginalised, truncatedTo: inp.truncatedTo || 0 };
  }

  /* The input of run() from the precision block of an extraction (RVCore.refine with precision): the reflections of
     the block in |F|^2-like units, I = area / (m Lp) = f h with f = K / (m Lp), and Q_I = Q_h / (s2 f_i f_j). */
  function inputFrom(pre, phaseRefl) {
    var n = pre.n, refl = [], f = new Float64Array(n), i, j;
    for (i = 0; i < n; i++) {
      var r = phaseRefl[pre.index[i]];
      f[i] = r.K > 0 && r.m > 0 && r.lp > 0 ? r.K / (r.m * r.lp) : 1;
      refl.push({ h: r.h, k: r.k, l: r.l, tth: r.tth, I: Math.max(0, r.height) * f[i], area: r.Icalc, sigma: r.sigma });
    }
    var s2 = pre.s2 > 0 ? pre.s2 : 1, Q = [];
    for (i = 0; i < n; i++) {
      var row = new Float64Array(n);
      for (j = 0; j < n; j++) { var v = pre.Q[i * n + j] / (s2 * f[i] * f[j]); row[j] = isFinite(v) ? v : 0; }
      Q.push(row);
    }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) { var m = 0.5 * (Q[i][j] + Q[j][i]); Q[i][j] = m; Q[j][i] = m; }
    // marginal variances from Q^-1 where it exists, the conditional 1/Q_ii where reflections coincide exactly
    var sigma2 = new Float64Array(n), L = chol(Q), exact = false;
    if (L) {
      var d = cholInverseDiag(L);
      exact = true;
      for (i = 0; i < n; i++) { if (!(d[i] > 0) || !isFinite(d[i])) { exact = false; break; } sigma2[i] = d[i]; }
    }
    if (!exact) for (i = 0; i < n; i++) sigma2[i] = Q[i][i] > 0 && isFinite(Q[i][i]) ? 1 / Q[i][i] : Infinity;
    return { refl: refl, Q: Q, sigma2: sigma2, sigmaExact: exact, marginalised: true };
  }

  return { run: run, inputFrom: inputFrom, candidates: candidates, isConditionFree: isConditionFree, recordOf: recordOf, label: label };
})();
