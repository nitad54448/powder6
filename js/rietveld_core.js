/* ===========================================================================
   FIT CORE  --  several phases, several datasets, one least-squares fit,
   each phase by Rietveld, Le Bail or WPPF.
   ===========================================================================

   DOM-free. The page (index.html), the fit worker (rietveld_worker.js) and
   the node tests load the same file, after constants.js, crystal.js,
   profile.js and wppf_linear.js, whose functions it calls unchanged:

     buildPeakContributions()   positions, Ka2, widths, windows       (profile.js)
     intensityDerivativeColumn()  the unit-height profile of a reflection
     getPseudoVoigtArea()       area of the unit-height profile
     calculatePeakShift()       sample displacement and transparency
     normaliseCell(), buildInvDsq(), metricTensor(), fracDistance(),
     cellVolume(), sharkoLp()                                         (crystal.js)
     SkylineMatrix, intensityEnvelope(), solveSkylineNNLS(),
     skylineCholeskyInPlace(), skylineSolveInPlace()              (wppf_linear.js)

   So the peak shape is the same whatever the method. What the method decides
   is where the intensity of each reflection comes from:

     RIETVELD   height_k = S . m_k . Lp(2th_k) . P_k . |F_k|^2 / A_k
                S the scale of the phase in the dataset, m the multiplicity,
                Lp the Lorentz-polarisation factor, P the March-Dollase
                factor, |F|^2 from the atoms, A the area of the unit-height
                profile (profile.js carries heights, the physics gives areas).

     LE BAIL    the intensities are partitioned from the observed pattern
                (Le Bail, Duroy & Fourquet 1988) at every evaluation, from a
                flat start, at the current cell, profile and background.
                Starting from flat each time makes them a function of the
                parameters alone, not of the path the fit took to them, and
                the fit minimises the residual of that function: its Jacobian
                is taken with the partition repeated at the moved values.

     WPPF       the intensities are free least-squares variables (Pawley 1981;
                Toraya 1986), solved exactly and non-negatively at every
                evaluation by variable projection (Golub & Pereyra 1973):
                the fit searches only the non-linear parameters, and the
                Jacobian of every one of them is projected on the complement
                of the intensity columns (Kaufman 1975), which makes the
                normal matrix of the search the Schur complement of the full
                one -- the standard uncertainties are those of a full Pawley
                fit. All the WPPF reflections of a dataset, whatever their
                phase, are solved together, so overlaps between phases are
                handled like overlaps within one.

   Phases of different methods can share a dataset: the Le Bail partition and
   the WPPF solve see the Rietveld phases as part of the calculated pattern.
   A dataset holds the phases its definition lists (every phase by default);
   the others are absent from it: no reflections, no contribution, no names.

   THE MODEL OF ONE DATASET

       y_calc(2th) = background  +  sum_phases  sum_refl  height . profile

   with a Chebyshev polynomial over the fitted range or a monotone cubic spline
   (Fritsch & Carlson 1980) through anchors at fixed 2th, whose heights are the
   parameters. A point of zero weight is excluded: it takes no part in the fit,
   the extraction or the statistics, but the pattern is still calculated there.

   PARAMETERS

   Every value has a name, and every dataset holds its own value of every name
   of its phases (as in Yappari). A refinement chooses which names are free and,
   in a joint fit of several datasets, which free names are SHARED (one value
   for all the datasets of the fit that hold the name, or a listed subset of
   them) or LOCAL (one per dataset). Names:

     zero  disp  transp  bkg0 .. bkgN-1  bga0 .. bgaN-1   the dataset
     p1.scale                                           phase p1 in the dataset
     p1.a .. p1.gamma                                   the free cell edges/angles
     p1.GU p1.GV ...                                    profile (by profile type)
     p1.po                                              March-Dollase r
     p1.Fe1.x  p1.Fe1.y  p1.Fe1.z  p1.Fe1.occ  p1.Fe1.B atoms

   scale, po and the atoms exist for a Rietveld phase only; the intensities of
   Le Bail and WPPF phases are not named parameters (they follow from the
   others) and are returned with every fit, with their uncertainties.

   SPECIAL POSITIONS are constrained, not symmetrised after the fact. Each atom
   carries the free directions of its site (the subspace left invariant by the
   site-symmetry operators) and a constant offset; a coordinate that is not
   free is computed from the free ones, so (x, x, x) has one parameter and its
   Jacobian has one column, not three columns of which two are copies.

   DERIVATIVES

     background (Chebyshev), scale exact (the model is linear in them)
     x y z occ B of every atom     exact d|F|^2 / dp, through the reflections'
                                   unit profiles: no profile is re-evaluated
     po                            difference of the heights only
     spline anchors                differences of the spline
     cell, profile, zero, disp,    forward differences of the pattern of the
     transp                        phase concerned
   then, with WPPF phases in the dataset, projected on the complement of the
   intensity columns; with a Le Bail phase, the intensities partitioned again
   at the moved value (Model.prototype.derivatives says why).

   The local fit is Levenberg-Marquardt, optionally preceded by replica-exchange PT,
   with Marquardt scaling and box limits held by
   an active set, and steps capped per kind of parameter, so a poor start
   cannot fling a cell edge or a coordinate out of range in one iteration.
   =========================================================================== */
(function (root) {
'use strict';

var VERSION = '2.6';
var TWO_PI = 2 * Math.PI, D2R = Math.PI / 180, R2D = 180 / Math.PI;
var METHODS = ['rietveld', 'lebail', 'wppf'];
var METHOD_LABELS = { rietveld: 'Rietveld', lebail: 'Le Bail', wppf: 'WPPF' };

// the Le Bail and WPPF constants of constants.js (a top-level `const` is visible by name, not as a property of the
// global object), with powder5's values if the file is absent
function constant(name, fallback) {
    switch (name) {
        case 'LEBAIL_FLAT_SEED': return typeof LEBAIL_FLAT_SEED !== 'undefined' ? LEBAIL_FLAT_SEED : fallback;
        case 'LEBAIL_MAX_PASSES': return typeof LEBAIL_MAX_PASSES !== 'undefined' ? LEBAIL_MAX_PASSES : fallback;
        case 'LEBAIL_PASSES_PER_ITER': return typeof LEBAIL_PASSES_PER_ITER !== 'undefined' ? LEBAIL_PASSES_PER_ITER : fallback;
        case 'LEBAIL_PASS_TOL': return typeof LEBAIL_PASS_TOL !== 'undefined' ? LEBAIL_PASS_TOL : fallback;
        case 'LEBAIL_REVIVAL_FRACTION': return typeof LEBAIL_REVIVAL_FRACTION !== 'undefined' ? LEBAIL_REVIVAL_FRACTION : fallback;
        case 'WPPF_DEGENERACY_CORRELATION': return typeof WPPF_DEGENERACY_CORRELATION !== 'undefined' ? WPPF_DEGENERACY_CORRELATION : fallback;
        default: return fallback;
    }
}
var LB = {
    seed: constant('LEBAIL_FLAT_SEED', 100), maxPasses: constant('LEBAIL_MAX_PASSES', 24),
    minPasses: constant('LEBAIL_PASSES_PER_ITER', 6), tol: constant('LEBAIL_PASS_TOL', 1e-4),
    revival: constant('LEBAIL_REVIVAL_FRACTION', 1e-5)
};
var DEGENERACY = constant('WPPF_DEGENERACY_CORRELATION', 0.9999);

// ---------------------------------------------------------------------------
//  SYMMETRY
// ---------------------------------------------------------------------------

function tVec(o) {
    if (Array.isArray(o.t_num) && Number(o.t_den)) return o.t_num.map(function (n) { return Number(n) / Number(o.t_den); });
    return Array.isArray(o.t) ? o.t.map(Number) : [0, 0, 0];
}
function wrap(v) { v -= Math.floor(v); return Math.abs(v - 1) < 1e-9 ? 0 : v; }

/**
 * Every operator of a setting: sym_ops crossed with the centring translations
 * and deduplicated -- correct whether or not the database already folded the
 * centring into sym_ops (simulation.js's simSymmetry() does the same).
 * @returns {{r:number[], t:number[]}[]}
 */
function expandOps(symOps, centrings) {
    var cen = (Array.isArray(centrings) && centrings.length) ? centrings.map(tVec) : [[0, 0, 0]];
    var seen = new Set(), out = [];
    (symOps || []).forEach(function (op) {
        if (!op || !Array.isArray(op.r) || op.r.length !== 9) return;
        var r = op.r.map(Number), t0 = tVec(op);
        cen.forEach(function (c) {
            var t = [wrap(t0[0] + c[0]), wrap(t0[1] + c[1]), wrap(t0[2] + c[2])];
            var key = r.join(',') + '|' + t.map(function (v) { return Math.round(v * 5040); }).join(',');
            if (!seen.has(key)) { seen.add(key); out.push({ r: r, t: t }); }
        });
    });
    if (!out.length) out.push({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
    return out;
}

function isIdentityR(r) { return r[0] === 1 && r[4] === 1 && r[8] === 1 && !r[1] && !r[2] && !r[3] && !r[5] && !r[6] && !r[7]; }

/**
 * Coset representatives of the operators modulo the centring translations,
 * and the number of centring translations. For an allowed reflection every
 * centring vector c has h.c integral, so the sum over all operators is
 * |C| times the sum over the representatives: four times less work in an
 * F-centred cell.
 */
function cosets(ops) {
    var C = ops.filter(function (o) { return isIdentityR(o.r); }).map(function (o) { return o.t; });
    if (!C.length) C = [[0, 0, 0]];
    var reps = [];
    ops.forEach(function (o) {
        var dup = reps.some(function (q) {
            if (q.r.join() !== o.r.join()) return false;
            return C.some(function (c) {
                for (var i = 0; i < 3; i++) { var d = o.t[i] - q.t[i] - c[i]; if (Math.abs(d - Math.round(d)) > 1e-6) return false; }
                return true;
            });
        });
        if (!dup) reps.push(o);
    });
    return { reps: reps, nCentring: C.length, centrings: C };
}

/** The rotation parts with Friedel's law: the Laue group, acting on row vectors h' = h R. */
function laueRotations(ops) {
    var map = new Map();
    ops.forEach(function (o) {
        [o.r, o.r.map(function (v) { return -v; })].forEach(function (r) { var k = r.join(','); if (!map.has(k)) map.set(k, r); });
    });
    return Array.from(map.values());
}
function hR(h, k, l, r) { return [h * r[0] + k * r[3] + l * r[6], h * r[1] + k * r[4] + l * r[7], h * r[2] + k * r[5] + l * r[8]]; }

/** Extinct iff some (R, t) has hR = h and h.t not an integer (exact, from the operators). */
function isAllowed(h, k, l, ops) {
    for (var i = 0; i < ops.length; i++) {
        var r = ops[i].r, t = ops[i].t;
        if (h * r[0] + k * r[3] + l * r[6] !== h || h * r[1] + k * r[4] + l * r[7] !== k || h * r[2] + k * r[5] + l * r[8] !== l) continue;
        var p = h * t[0] + k * t[1] + l * t[2];
        if (Math.abs(p - Math.round(p)) > 1e-6) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
//  CELL
// ---------------------------------------------------------------------------

/** The cell parameters a crystal system leaves free (monoclinic: the oblique angle of the unique axis). */
function cellParams(system, uniqueAxis) {
    switch (String(system || '').toLowerCase()) {
        case 'cubic': return ['a'];
        case 'tetragonal': case 'hexagonal': case 'trigonal': case 'rhombohedral': return ['a', 'c'];
        case 'orthorhombic': return ['a', 'b', 'c'];
        case 'monoclinic': return ['a', 'b', 'c', { a: 'alpha', c: 'gamma' }[uniqueAxis] || 'beta'];
        default: return ['a', 'b', 'c', 'alpha', 'beta', 'gamma'];
    }
}
/** Full cell from the values of a phase (prefix 'p1.'), the system's constraints applied. */
function cellOf(system, uniqueAxis, get) {
    var p = {};
    cellParams(system, uniqueAxis).forEach(function (c) { p[c] = get(c); });
    return normaliseCell(p, system, uniqueAxis || 'b');
}

// ---------------------------------------------------------------------------
//  REFLECTIONS
// ---------------------------------------------------------------------------

/**
 * The reflections of a phase down to dmin: one per Laue orbit (Friedel pairs
 * merged), systematic absences removed with the operators, sorted by
 * decreasing d. Each carries its multiplicity and its equivalents (for the
 * preferred-orientation average).
 * Optional box: maximum absolute Miller indices, without the initial metric
 * cutoff. GPU PT uses this complete envelope and filters it at each trial cell.
 * @returns {{h:number,k:number,l:number,m:number,eq:Int16Array}[]}
 */
function generateReflections(cell, ops, dmin, box) {
    var f = buildInvDsq(cell);
    if (!f || !(dmin > 0)) return [];
    var lim = 1 / (dmin * dmin) * (1 + 1e-9), rots = laueRotations(ops);
    var hmax = box ? box[0] : Math.floor(cell.a / dmin), kmax = box ? box[1] : Math.floor(cell.b / dmin), lmax = box ? box[2] : Math.floor(cell.c / dmin);
    var seen = new Set(), out = [];
    for (var h = -hmax; h <= hmax; h++) for (var k = -kmax; k <= kmax; k++) for (var l = -lmax; l <= lmax; l++) {
        if (!h && !k && !l) continue;
        var q = invDsq(f, h, k, l);
        if (!(q > 0) || (!box && q > lim)) continue;
        // canonical member: the most non-negative indices, then the largest (H, K, L) -- (1 1 0) rather than (2 -1 0)
        // in a hexagonal cell, (0 1 2) rather than (1 0 -2), the indices the literature uses
        var ch = -1e9, ck = 0, cl = 0, cp = -1, orbit = new Map();
        for (var i = 0; i < rots.length; i++) {
            var v = hR(h, k, l, rots[i]), np = (v[0] >= 0) + (v[1] >= 0) + (v[2] >= 0);
            orbit.set(v[0] + ',' + v[1] + ',' + v[2], v);
            if (np > cp || (np === cp && (v[0] > ch || (v[0] === ch && (v[1] > ck || (v[1] === ck && v[2] > cl)))))) { cp = np; ch = v[0]; ck = v[1]; cl = v[2]; }
        }
        if (ch !== h || ck !== k || cl !== l) continue;
        var key = h + ',' + k + ',' + l;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!isAllowed(h, k, l, ops)) continue;
        var eq = new Int16Array(orbit.size * 3), n = 0;
        orbit.forEach(function (vv) { eq[n++] = vv[0]; eq[n++] = vv[1]; eq[n++] = vv[2]; });
        out.push({ h: h, k: k, l: l, m: orbit.size, eq: eq, d0: 1 / Math.sqrt(q) });
    }
    out.sort(function (a, b) { return b.d0 - a.d0 || b.h - a.h || b.k - a.k || b.l - a.l; });
    return out;
}

// ---------------------------------------------------------------------------
//  SITE SYMMETRY: the free directions of a special position
// ---------------------------------------------------------------------------

function fracText(v) {
    if (Math.abs(v) < 1e-9) return '0';
    for (var den = 1; den <= 24; den++) {
        var num = Math.round(v * den);
        if (Math.abs(num / den - v) < 1e-6) return den === 1 ? String(num) : num + '/' + den;
    }
    return v.toFixed(4);
}

/**
 * The site of a point: its stabiliser among the operators (images within tolA
 * angstrom of it, the minimum-image distance of crystal.js), the multiplicity
 * N / |stabiliser|, the position projected exactly onto the site, and the
 * free directions.
 *
 * The free directions are the null space of the stacked (R - I) of the
 * stabiliser, in reduced row-echelon form with the columns taken z, y, x, so
 * that x stays free whenever it can: x,x,x has x free and y = x, z = x.
 * Each free coordinate f gets a basis vector with 1 at f and 0 at the other
 * free ones, and r0 holds what the site fixes, so that
 *
 *     r = r0 + sum_f u_f . basis_f        with u_f the value of coordinate f.
 */
function siteSymmetry(ops, xyz, cell, tolA) {
    var tol = tolA > 0 ? tolA : 0.02, G = metricTensor(cell), x = xyz.map(Number);
    var stab = [], sum = [0, 0, 0];
    ops.forEach(function (o) {
        var r = o.r, t = o.t;
        var y = [r[0] * x[0] + r[1] * x[1] + r[2] * x[2] + t[0], r[3] * x[0] + r[4] * x[1] + r[5] * x[2] + t[1], r[6] * x[0] + r[7] * x[1] + r[8] * x[2] + t[2]];
        var d = [y[0] - x[0], y[1] - x[1], y[2] - x[2]], L = d.map(Math.round);
        if (fracDistance(G, d[0] - L[0], d[1] - L[1], d[2] - L[2]) < tol) {
            stab.push(o);
            for (var i = 0; i < 3; i++) sum[i] += y[i] - L[i];
        }
    });
    var ns = Math.max(1, stab.length), pos = sum.map(function (v) { return v / ns; });
    // stacked (R - I), columns in the order z, y, x
    var rows = [];
    stab.forEach(function (o) {
        for (var i = 0; i < 3; i++) {
            var row = [o.r[i * 3 + 2] - (i === 2 ? 1 : 0), o.r[i * 3 + 1] - (i === 1 ? 1 : 0), o.r[i * 3] - (i === 0 ? 1 : 0)];
            if (row.some(function (v) { return Math.abs(v) > 1e-12; })) rows.push(row);
        }
    });
    var piv = [], rr = 0;                                  // RREF
    for (var c = 0; c < 3 && rr < rows.length; c++) {
        var best = -1, bv = 1e-9;
        for (var i = rr; i < rows.length; i++) if (Math.abs(rows[i][c]) > bv) { bv = Math.abs(rows[i][c]); best = i; }
        if (best < 0) continue;
        var tmp = rows[rr]; rows[rr] = rows[best]; rows[best] = tmp;
        var p = rows[rr][c];
        for (var j = 0; j < 3; j++) rows[rr][j] /= p;
        for (i = 0; i < rows.length; i++) if (i !== rr && Math.abs(rows[i][c]) > 1e-12) {
            var fct = rows[i][c];
            for (j = 0; j < 3; j++) rows[i][j] -= fct * rows[rr][j];
        }
        piv.push({ col: c, row: rr });
        rr++;
    }
    var pivotCols = piv.map(function (q) { return q.col; });
    var colToCoord = [2, 1, 0], free = [], basis = {};
    [2, 1, 0].forEach(function (col) {                     // columns of x, y, z
        if (pivotCols.indexOf(col) >= 0) return;
        var b = [0, 0, 0];
        b[colToCoord[col]] = 1;
        piv.forEach(function (q) { b[colToCoord[q.col]] = -rows[q.row][col]; });
        b = b.map(function (v) { return Math.abs(v) < 1e-12 ? 0 : v; });
        free.push(colToCoord[col]);
        basis[colToCoord[col]] = b;
    });
    var r0 = pos.slice();
    free.forEach(function (f) { var u = pos[f]; for (var i = 0; i < 3; i++) r0[i] -= u * basis[f][i]; });
    r0 = r0.map(function (v) { return Math.abs(v) < 1e-12 ? 0 : v; });
    var names = ['x', 'y', 'z'], expr = [0, 1, 2].map(function (i) {
        if (free.indexOf(i) >= 0) return names[i];
        var s = '';
        free.forEach(function (f) {
            var cf = basis[f][i];
            if (Math.abs(cf) < 1e-12) return;
            var mag = Math.abs(cf), txt = Math.abs(mag - 1) < 1e-9 ? '' : fracText(mag);
            s += (cf < 0 ? '-' : (s ? '+' : '')) + txt + names[f];
        });
        var c0 = r0[i];
        if (Math.abs(c0) > 1e-9 || !s) s += (s && c0 > 0 ? '+' : '') + fracText(c0);
        return s;
    });
    return { stab: ns, mult: Math.round(ops.length / ns), free: free, basis: basis, r0: r0, pos: pos, expr: expr.join(', ') };
}

/** Coordinates from the free values: r = r0 + sum_f u_f basis_f. */
function sitePosition(site, u) {
    var r = site.r0.slice();
    site.free.forEach(function (f) { var b = site.basis[f], v = u[f]; r[0] += v * b[0]; r[1] += v * b[1]; r[2] += v * b[2]; });
    return r;
}

// ---------------------------------------------------------------------------
//  SCATTERING
// ---------------------------------------------------------------------------

/** f(s), s = 1/d. X-ray Gaussians are defined against stol = s/2 (scatterers.js, note 1); a neutron length is constant. */
function formFactor(ff, radiation, s) {
    if (radiation === 'neutron') return ff && Number.isFinite(ff.neutron) ? ff.neutron : 0;
    var e = ff && ff.xray;
    if (!e) return 0;
    var q = (s / 2) * (s / 2), f = e.c || 0;
    for (var i = 0; i < e.a.length; i++) f += e.a[i] * Math.exp(-e.b[i] * q);
    return f;
}

// ---------------------------------------------------------------------------
//  PROFILE PARAMETERS, BY PROFILE TYPE (names as profile.js reads them)
// ---------------------------------------------------------------------------

var INSTRUMENT_PROFILE = [['U',2],['V',-2],['W',5],['X',1],['Y',0],['Z',0],['SL',0],['HL',0]];
var SAMPLE_PROFILE = [['size',1],['sizeAxial',1],['sizeB',1],['sizeC',1],['rotA',0],['rotB',0],['rotC',0],['strain',0],['strainAxial',0],['sizeMix',1],['strainMix',1]];
['400','040','004','220','202','022','310','301','130','103','031','013','211','121','112'].forEach(function (n) { SAMPLE_PROFILE.push(['S'+n,0]); });
function broadeningConfig(b) {
    b = b || {};
    function axis(a) { return Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) && a.some(function (v) { return v !== 0; }) ? a.slice() : [0,0,1]; }
    return { size: ['isotropic','uniaxial','ellipsoid'].indexOf(b.size) >= 0 ? b.size : 'isotropic',
             strain: ['isotropic','uniaxial','stephens'].indexOf(b.strain) >= 0 ? b.strain : 'isotropic', sizeAxis: axis(b.sizeAxis), strainAxis: axis(b.strainAxis) };
}
function sampleProfileNames(system, uniqueAxis, broadening, ops) {
    var b = broadeningConfig(broadening), out = ['size','sizeMix','strainMix'];
    if (b.size === 'uniaxial') out.push('sizeAxial');
    if (b.size === 'ellipsoid') out = ['size','sizeB','sizeC','rotA','rotB','rotC','sizeMix','strainMix'];
    if (b.strain === 'isotropic') out.push('strain');
    else if (b.strain === 'uniaxial') out.push('strain','strainAxial');
    else { var basis=gsasStephensBasis(ops);out=out.concat(basis?basis.map(function(t){return t.name;}):gsasStrainKeys(system, uniqueAxis)); }
    return out;
}
var PROFILE_PARAMS = {
    gsas_cw: SAMPLE_PROFILE,
    simple_pvoigt: [['GU', 2], ['GV', -2], ['GW', 5], ['GP', 0], ['LX', 1], ['eta', 0.5]],
    tch_aniso: [['U', 17.4], ['V', -45.2], ['W', 16.5], ['X', 6.7], ['Y', 3.0], ['SL', 0.1], ['HL', -0.25]],
    split_pvoigt: [['GU_L', 2], ['GV_L', -2], ['GW_L', 5], ['LX_L', 1], ['GU_R', 2], ['GV_R', -2], ['GW_R', 5], ['LX_R', 1], ['eta_split', 0.5]]
};
var PROFILE_LABELS = { gsas_cw: 'Thompson-Cox-Hastings', simple_pvoigt: 'Pseudo-Voigt', tch_aniso: 'Thompson-Cox-Hastings', split_pvoigt: 'Split pseudo-Voigt' };
var INSTRUMENT_PROFILE_TYPES = ['tch_aniso','simple_pvoigt','split_pvoigt'];

// Canonical instrument coefficients. X always means /cos(theta), Y tan(theta).
// Voigt retains its independent mixture; Split retains each flank separately.
function instrumentProfileParams(type) {
    if (type === 'simple_pvoigt') return INSTRUMENT_PROFILE.slice(0, 6).concat([['eta',0.5]]);
    if (type === 'split_pvoigt') return [['U_L',2],['V_L',-2],['W_L',5],['X_L',1],['U_R',2],['V_R',-2],['W_R',5],['X_R',1],['eta_split',0.5]];
    return INSTRUMENT_PROFILE;
}
var ALL_INSTRUMENT_PROFILE = INSTRUMENT_PROFILE.concat([['eta',0.5]], instrumentProfileParams('split_pvoigt'));
function usesSeparatedProfile(phase) { return phase.profileType === 'gsas_cw' || phase.separatedProfile === true; }

// ---------------------------------------------------------------------------
//  PARAMETER NAMES
// ---------------------------------------------------------------------------

var CELL_NAMES = { a: 1, b: 1, c: 1, alpha: 1, beta: 1, gamma: 1 };

/** What a name refers to: { kind, phase (key), atom (label), comp }. */
function classify(name) {
    var m;
    if ((m = /^inst\.([A-Za-z_][A-Za-z_0-9]*)$/.exec(name))) return { kind: 'instrument', comp: m[1] };
    if (name === 'zero' || name === 'disp' || name === 'transp') return { kind: name };
    if ((m = /^bkg(\d+)$/.exec(name))) return { kind: 'bkg', index: +m[1] };
    if ((m = /^bga(\d+)$/.exec(name))) return { kind: 'bga', index: +m[1] };
    if ((m = /^(p\d+)\.([A-Za-z_][A-Za-z_0-9]*)$/.exec(name))) {
        if (m[2] === 'scale') return { kind: 'scale', phase: m[1] };
        if (m[2] === 'po') return { kind: 'po', phase: m[1] };
        if (CELL_NAMES[m[2]]) return { kind: 'cell', phase: m[1], comp: m[2] };
        return { kind: 'profile', phase: m[1], comp: m[2] };
    }
    if ((m = /^(p\d+)\.([^.]+)\.(x|y|z|occ|B)$/.exec(name))) return { kind: 'atom', phase: m[1], atom: m[2], comp: m[3] };
    return { kind: 'unknown' };
}

/** Default limits by kind; the page may override them per name. */
function defaultLimits(name, value) {
    var c = classify(name);
    switch (c.kind) {
        case 'scale': return [0, Infinity];
        case 'cell': return CELL_NAMES[c.comp] && /^[abc]$/.test(c.comp) ? [0.5 * value, 2 * value] : [30, 150];
        case 'atom': return c.comp === 'occ' ? [0, 2] : c.comp === 'B' ? [-2, 30] : [-Infinity, Infinity];
        case 'po': return [0.1, 5];
        case 'zero': return [-2, 2];
        // a Lorentzian width (and the Gaussian size term) below zero is floored by profile.js, where it has no
        // effect at all: the fit would wander off there and lose the parameter
        case 'instrument': return /^eta/.test(c.comp) ? [0, 1] : /^(X(?:_[LR])?|Y|Z|SL)$/.test(c.comp) ? [0, Infinity] : [-Infinity, Infinity];
        case 'profile':
            if (/^size(?:Axial|B|C)?$/.test(c.comp)) return [0.001, 10];
            if (/^(sizeMix|strainMix)$/.test(c.comp)) return [0, 1];
            if (/^strain/.test(c.comp)) return [0, 1e6];
            if (/^S(?:400|040|004)$/.test(c.comp)) return [0, Infinity];
            return /^eta/.test(c.comp) ? [0, 1] : /^(LX|LX_L|LX_R|X|Y|GP)$/.test(c.comp) ? [0, Infinity] : [-Infinity, Infinity];
        default: return [-Infinity, Infinity];
    }
}

/** Largest change of one iteration, by kind (the whole step is scaled down to respect every cap). */
function stepCap(c, v) {
    switch (c.kind) {
        case 'cell': return /^[abc]$/.test(c.comp) ? 0.02 * Math.abs(v) + 1e-6 : 1;
        case 'atom': return c.comp === 'occ' ? 0.2 : c.comp === 'B' ? 2 : 0.05;
        case 'zero': return 0.1;
        case 'disp': return 100;
        case 'transp': return 0.01;
        case 'po': return 0.25;
        case 'instrument': return /^(SL|HL)$/.test(c.comp) ? 0.01 : 0.5 * Math.max(Math.abs(v), 1);
        case 'profile': return /^(sizeMix|strainMix)$/.test(c.comp) ? 0.2 : /^size/.test(c.comp) ? 0.2 * Math.max(Math.abs(v), 0.001) : /^eta/.test(c.comp) ? 0.25 : /^(SL|HL)$/.test(c.comp) ? 0.05 : 0.5 * Math.max(Math.abs(v), 5);
        default: return Infinity;
    }
}

/** Forward-difference step, by kind. */
function fdStep(c, v) {
    var a = Math.abs(v);
    switch (c.kind) {
        case 'cell': return /^[abc]$/.test(c.comp) ? Math.max(1e-6 * a, 1e-6) : 1e-4;
        case 'zero': return 1e-4;
        case 'disp': return 1e-2;
        case 'transp': return 1e-6;
        case 'po': return 1e-4;
        case 'bga': return Math.max(1e-4 * a, 1e-3);
        default: return Math.max(1e-4 * a, 1e-5);
    }
}

/** The names a phase of this method can refine at all (a Le Bail or WPPF phase has no scale, orientation or atoms). */
function methodAllows(method, kind) {
    return method === 'rietveld' || !(kind === 'scale' || kind === 'po' || kind === 'atom');
}

// ---------------------------------------------------------------------------
//  SPLINE BACKGROUND (monotone cubic Hermite, Fritsch-Carlson tangents; the
//  interpolant of profile.js, evaluated in one sweep over a sorted axis)
// ---------------------------------------------------------------------------

function splineSlopes(xs, ys) {
    var n = xs.length, h = new Float64Array(n - 1), d = new Float64Array(n - 1), m = new Float64Array(n), i;
    for (i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (h[i] * d[i - 1] + h[i - 1] * d[i]) / (h[i - 1] + h[i]);
    for (i = 0; i < n - 1; i++) {
        if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
        var a = m[i] / d[i], b = m[i + 1] / d[i], tau = a * a + b * b;
        if (tau > 9) { var f = 3 / Math.sqrt(tau); m[i] = a * d[i] * f; m[i + 1] = b * d[i] * f; }
    }
    return { h: h, m: m };
}

/**
 * The spline through (xs, ys) at every point of a sorted axis, flat outside
 * the anchors. Fewer than two anchors: a constant (or zero).
 */
function splineValues(tth, xs, ys) {
    var n = tth.length, out = new Float64Array(n), na = xs ? xs.length : 0;
    if (!na) return out;
    if (na === 1) { out.fill(ys[0] || 0); return out; }
    var s = splineSlopes(xs, ys), seg = 0;
    for (var i = 0; i < n; i++) {
        var t = tth[i];
        if (t <= xs[0]) { out[i] = ys[0]; continue; }
        if (t >= xs[na - 1]) { out[i] = ys[na - 1]; continue; }
        while (seg < na - 2 && xs[seg + 1] <= t) seg++;
        while (seg > 0 && xs[seg] > t) seg--;
        var hi = s.h[seg], u = hi > 1e-12 ? (t - xs[seg]) / hi : 0, u2 = u * u, u3 = u2 * u;
        out[i] = (2 * u3 - 3 * u2 + 1) * ys[seg] + (u3 - 2 * u2 + u) * hi * s.m[seg] + (-2 * u3 + 3 * u2) * ys[seg + 1] + (u3 - u2) * hi * s.m[seg + 1];
    }
    return out;
}

// ---------------------------------------------------------------------------
//  THE MODEL
// ---------------------------------------------------------------------------

/**
 * problem = {
 *   phases:   [{ key, method ('rietveld' | 'lebail' | 'wppf'), system, uniqueAxis, profileType, ops, poDir,
 *                atoms: [{ label, ff: { xray: {a,b,c}, neutron }, site: { free, basis, r0, stab, mult } }] }],
 *   datasets: [{ id, tth, y, w, lambda1, lambda2, ratio, polK, radiation, minFwhm,
 *                bkgType ('cheb' | 'spline'), bkgN (Chebyshev terms), bkgX (spline anchor positions),
 *                phases (the keys of the phases in the dataset; absent: every phase) }],
 *   values:   [ { name: value } for each dataset ]
 * }
 * tth / y / w hold the points of the fitted range; a point of weight 0 is excluded.
 */
function Model(problem) {
    var self = this;
    this.lbAsWppf = false;      // the first stage of a Le Bail fit: its phases solved as WPPF ones (see refine)
    this.phases = problem.phases.map(function (p) {
        var cs = cosets(p.ops), method = METHODS.indexOf(p.method) >= 0 ? p.method : 'rietveld';
        return { def: p, method: method, reps: cs.reps, nCent: cs.nCentring, prefix: p.key + '.', cellNames: cellParams(p.system, p.uniqueAxis),
                 profNames: usesSeparatedProfile(p) ? sampleProfileNames(p.system,p.uniqueAxis,p.broadening,p.ops) : (PROFILE_PARAMS[p.profileType] || PROFILE_PARAMS.simple_pvoigt).map(function (q) { return q[0]; }) };
    });
    this.datasets = problem.datasets.map(function (d) {
        if (!(d.tth && d.tth.length >= 2)) throw new Error('a dataset has fewer than two points in its fitted range');
        var n = d.tth.length, lo = d.tth[0], hi = d.tth[n - 1], T = [], spline = d.bkgType === 'spline';
        for (var k = 0; k < (spline ? 0 : (d.bkgN || 0)); k++) T.push(new Float64Array(n));
        for (var i = 0; i < n; i++) {                       // Chebyshev polynomials over the fitted range
            var x = hi > lo ? 2 * (d.tth[i] - lo) / (hi - lo) - 1 : 0;
            if (T.length > 0) T[0][i] = 1;
            if (T.length > 1) T[1][i] = x;
            for (k = 2; k < T.length; k++) T[k][i] = 2 * x * T[k - 1][i] - T[k - 2][i];
        }
        // trapezoid weights of the included points (the Le Bail integrals), and the number of points fitted
        var trap = new Float64Array(n), nFit = 0;
        for (i = 0; i < n; i++) {
            if (!(d.w[i] > 0)) continue;
            nFit++;
            trap[i] = 0.5 * ((i > 0 ? d.tth[i] - d.tth[i - 1] : 0) + (i < n - 1 ? d.tth[i + 1] - d.tth[i] : 0));
        }
        var bx = spline ? (d.bkgX || []).map(Number).filter(Number.isFinite).sort(function (a, b) { return a - b; }) : [];
        // the phases in the dataset: a phase absent from it has no reflections there and adds nothing
        var has = self.phases.map(function (P) { return !Array.isArray(d.phases) || d.phases.indexOf(P.def.key) >= 0; });
        self.phases.forEach(function (P, pi) {
            if (!has[pi] || P.method !== 'rietveld') return;
            (P.def.atoms || []).forEach(function (at) {
                var ff = at.ff, x = ff && ff.xray, neutron = d.radiation === 'neutron';
                var valid = neutron ? ff && Number.isFinite(ff.neutron) : x && x.a && x.b && x.a.length > 0 && x.a.length === x.b.length && Array.from(x.a).every(Number.isFinite) && Array.from(x.b).every(Number.isFinite) && Number.isFinite(x.c);
                if (!valid) throw new Error('Missing ' + (neutron ? 'neutron' : 'X-ray') + ' scattering factor for ' + P.def.key + '.' + at.label + '.');
            });
        });
        return { def: d, n: n, T: T, spline: spline, bkgX: bx, trap: trap, nFit: nFit, refl: [], nnls: {}, has: has };
    });
    // reflections of each phase in each dataset, from the start values, with 2 % of margin for the cell to move
    this.datasets.forEach(function (D, di) {
        var d = D.def, v = problem.values[di], lmax = Math.max(d.lambda1, d.ratio > 0 && d.lambda2 > 0 ? d.lambda2 : 0);
        var tmax = Math.min(179, d.tth[D.n - 1] + 3), dmin = lmax / (2 * Math.sin(tmax * D2R / 2)) * 0.98;
        D.refl = self.phases.map(function (P, pi) {
            if (!D.has[pi]) return [];
            var cell = cellOf(P.def.system, P.def.uniqueAxis, function (c) { return v[P.prefix + c]; });
            return cell ? generateReflections(cell, P.def.ops, dmin) : [];
        });
    });
}

Model.prototype.methodOf = function (P) { return this.lbAsWppf && P.method === 'lebail' ? 'wppf' : P.method; };

/** Profile parameters of phase P in dataset D, as profile.js reads them. */
Model.prototype.profileParams = function (P, D, v) {
    var o = { profileType: P.def.profileType || 'simple_pvoigt', system: P.def.system,
              lambda: D.def.lambda1, lambda2: D.def.lambda2 || 0, ratio: D.def.ratio || 0, zeroShift: v.zero || 0,
              minFwhm: D.def.minFwhm > 0 ? D.def.minFwhm : (typeof getMinProfileFwhmDeg === 'function' ? getMinProfileFwhmDeg() : MIN_PROFILE_FWHM_DEG) };
    P.profNames.forEach(function (n) { o[n] = v[P.prefix + n]; });
    if (usesSeparatedProfile(P.def)) {
        var instrumentType=D.def.resolutionType || P.def.profileType;
        instrumentProfileParams(instrumentType).forEach(function (p) { o[p[0]] = Number.isFinite(v['inst.' + p[0]]) ? v['inst.' + p[0]] : p[1]; });
        o.profileType = instrumentType === 'gsas_cw' ? 'tch_aniso' : instrumentType; o.separated = true;
        o.broadening = broadeningConfig(P.def.broadening);
        o.cell = cellOf(P.def.system, P.def.uniqueAxis, function (c) { return v[P.prefix + c]; });
        o.uniqueAxis = P.def.uniqueAxis;
        if(o.broadening.strain==='stephens')o.stephensBasis=gsasStephensBasis(P.def.ops);
    }
    return o;
};

function profileParamsFor(def, dataset, values) {
    return Model.prototype.profileParams({def:def,prefix:def.key+'.',profNames:usesSeparatedProfile(def) ? sampleProfileNames(def.system,def.uniqueAxis,def.broadening,def.ops) : (PROFILE_PARAMS[def.profileType] || PROFILE_PARAMS.simple_pvoigt).map(function(p){return p[0];})},{def:dataset},values);
}

/**
 * Geometry of phase P in dataset D: d, Bragg angle (displacement and
 * transparency included), the hkl objects profile.js wants.
 */
Model.prototype.geometry = function (P, D, v, pi) {
    var cell = cellOf(P.def.system, P.def.uniqueAxis, function (c) { return v[P.prefix + c]; });
    var f = cell && buildInvDsq(cell), list = D.refl[pi], lam = D.def.lambda1, out = new Array(list.length);
    var shiftP = { profileType: 'simple_pvoigt', shft: v.disp || 0, trns: v.transp || 0 };
    for (var k = 0; k < list.length; k++) {
        var R = list[k], q = f ? invDsq(f, R.h, R.k, R.l) : NaN, s = Math.sqrt(q), sinT = lam * s / 2, tth = NaN;
        if (q > 0 && sinT < 1) {
            tth = 2 * Math.asin(sinT) * R2D;
            tth += calculatePeakShift(tth, shiftP);
        }
        out[k] = { h_orig: R.h, k_orig: R.k, l_orig: R.l, h: R.h, k: R.k, l: R.l, d: 1 / s, s: s, tth: tth, intensity: 0, m: R.m };
    }
    return { cell: cell, form: f, hkl: out };
};

/**
 * |F|^2 of every reflection, and with grad the exact derivatives with respect
 * to the free structural parameters of the phase: x y z (free ones), occ, B.
 * F = sum_j occ_j f_j exp(-B_j s^2/4) (m_j/|reps|) sum_reps exp(2 pi i h.(R r_j + t))
 * (the centring factor |C| folded into m_j / |reps| = |C| / stab_j).
 */
Model.prototype.structure = function (P, D, v, geo, grad) {
    var atoms = P.def.atoms || [], nA = atoms.length, reps = P.reps, nR = reps.length, rad = D.def.radiation, pre = P.prefix;
    var A = atoms.map(function (at) {
        var u = [v[pre + at.label + '.x'], v[pre + at.label + '.y'], v[pre + at.label + '.z']];
        return { pos: sitePosition(at.site, u), occ: v[pre + at.label + '.occ'], B: v[pre + at.label + '.B'], w0: (at.site.mult || 1) / nR, at: at };
    });
    var hkl = geo.hkl, n = hkl.length, F2 = new Float64Array(n), G = null;
    // gradient slots: per atom, the free coordinates, then occ, then B
    var slots = [];
    if (grad) {
        A.forEach(function (a, j) {
            a.at.site.free.forEach(function (fc) { slots.push({ j: j, kind: 'xyz', fc: fc, b: a.at.site.basis[fc], name: pre + a.at.label + '.' + 'xyz'[fc] }); });
            slots.push({ j: j, kind: 'occ', name: pre + a.at.label + '.occ' });
            slots.push({ j: j, kind: 'B', name: pre + a.at.label + '.B' });
        });
        G = slots.map(function () { return new Float64Array(n); });
    }
    var Aj = new Float64Array(nA), Bj = new Float64Array(nA), dA = new Float64Array(nA * 3), dB = new Float64Array(nA * 3);
    for (var k = 0; k < n; k++) {
        var R = hkl[k];
        if (!Number.isFinite(R.tth)) continue;
        var s = R.s, s2 = s * s, Ar = 0, Br = 0;
        for (var j = 0; j < nA; j++) {
            var a = A[j], wj = a.occ * formFactor(a.at.ff, rad, s) * Math.exp(-a.B * s2 / 4) * a.w0, c = 0, sn = 0, dc0 = 0, dc1 = 0, dc2 = 0, ds0 = 0, ds1 = 0, ds2 = 0;
            for (var q = 0; q < nR; q++) {
                var r = reps[q].r, t = reps[q].t;
                var H0 = R.h * r[0] + R.k * r[3] + R.l * r[6], H1 = R.h * r[1] + R.k * r[4] + R.l * r[7], H2 = R.h * r[2] + R.k * r[5] + R.l * r[8];
                var ph = TWO_PI * (H0 * a.pos[0] + H1 * a.pos[1] + H2 * a.pos[2] + R.h * t[0] + R.k * t[1] + R.l * t[2]);
                var cs = Math.cos(ph), si = Math.sin(ph);
                c += cs; sn += si;
                if (grad) { dc0 -= H0 * si; dc1 -= H1 * si; dc2 -= H2 * si; ds0 += H0 * cs; ds1 += H1 * cs; ds2 += H2 * cs; }
            }
            Aj[j] = wj * c; Bj[j] = wj * sn;
            Ar += Aj[j]; Br += Bj[j];
            if (grad) {
                dA[j * 3] = TWO_PI * wj * dc0; dA[j * 3 + 1] = TWO_PI * wj * dc1; dA[j * 3 + 2] = TWO_PI * wj * dc2;
                dB[j * 3] = TWO_PI * wj * ds0; dB[j * 3 + 1] = TWO_PI * wj * ds1; dB[j * 3 + 2] = TWO_PI * wj * ds2;
            }
        }
        F2[k] = Ar * Ar + Br * Br;
        if (grad) {
            for (var g = 0; g < slots.length; g++) {
                var sl = slots[g], jj = sl.j;
                if (sl.kind === 'xyz') {
                    var b = sl.b, dAr = dA[jj * 3] * b[0] + dA[jj * 3 + 1] * b[1] + dA[jj * 3 + 2] * b[2],
                        dBr = dB[jj * 3] * b[0] + dB[jj * 3 + 1] * b[1] + dB[jj * 3 + 2] * b[2];
                    G[g][k] = 2 * (Ar * dAr + Br * dBr);
                } else if (sl.kind === 'occ') {
                    var oc = A[jj].occ;
                    if (Math.abs(oc) > 1e-12) G[g][k] = 2 * (Ar * Aj[jj] + Br * Bj[jj]) / oc;
                    else {                                     // occ = 0: the contribution per unit occupancy
                        var w1 = formFactor(A[jj].at.ff, rad, s) * Math.exp(-A[jj].B * s2 / 4) * A[jj].w0, c1 = 0, s1 = 0;
                        for (q = 0; q < nR; q++) {
                            var rr = reps[q].r, tt = reps[q].t;
                            var p1 = TWO_PI * ((R.h * rr[0] + R.k * rr[3] + R.l * rr[6]) * A[jj].pos[0] + (R.h * rr[1] + R.k * rr[4] + R.l * rr[7]) * A[jj].pos[1] +
                                               (R.h * rr[2] + R.k * rr[5] + R.l * rr[8]) * A[jj].pos[2] + R.h * tt[0] + R.k * tt[1] + R.l * tt[2]);
                            c1 += Math.cos(p1); s1 += Math.sin(p1);
                        }
                        G[g][k] = 2 * (Ar * w1 * c1 + Br * w1 * s1);
                    }
                } else G[g][k] = 2 * (Ar * Aj[jj] + Br * Bj[jj]) * (-s2 / 4);
            }
        }
    }
    return { F2: F2, slots: slots, grad: G };
};

/** March-Dollase factor of each reflection, averaged over its equivalents. */
Model.prototype.preferredOrientation = function (P, D, v, geo, pi, rOverride) {
    var r = rOverride != null ? rOverride : v[P.prefix + 'po'], list = D.refl[pi], n = list.length, out = new Float64Array(n).fill(1);
    var dir = P.def.poDir || [0, 0, 1], f = geo.form;
    if (!(r > 0) || Math.abs(r - 1) < 1e-12 || !f) return out;
    var g = function (a, b) {
        return a[0] * b[0] * f.aa + a[1] * b[1] * f.bb + a[2] * b[2] * f.cc +
               (a[0] * b[1] + a[1] * b[0]) * f.ab / 2 + (a[1] * b[2] + a[2] * b[1]) * f.bc / 2 + (a[0] * b[2] + a[2] * b[0]) * f.ac / 2;
    };
    var H = dir, HH = g(H, H), r2 = r * r, ir = 1 / r;
    if (!(HH > 0)) return out;
    for (var k = 0; k < n; k++) {
        var eq = list[k].eq, m = eq.length / 3, sum = 0;
        for (var e = 0; e < m; e++) {
            var hv = [eq[e * 3], eq[e * 3 + 1], eq[e * 3 + 2]], hh = g(hv, hv), c = g(hv, H) / Math.sqrt(hh * HH), c2 = Math.min(1, c * c);
            sum += Math.pow(r2 * c2 + (1 - c2) * ir, -1.5);
        }
        out[k] = sum / m;
    }
    return out;
};

/**
 * One phase in one dataset: geometry, profiles (unit-height columns), the
 * area of each unit profile (K) and Lp, the heights and the pattern.
 *
 * Rietveld: the heights from the structure (opts.structure, opts.po reuse
 * those of an earlier evaluation). Le Bail and WPPF: the heights are given --
 * opts.heights (held as heights) or opts.areas (held as areas, so a change of
 * width changes the height) -- or left at zero for the extraction of the
 * dataset to fill in.
 */
Model.prototype.evalPhase = function (pi, di, v, opts) {
    opts = opts || {};
    var P = this.phases[pi], D = this.datasets[di], tth = D.def.tth, n = D.n, method = this.methodOf(P);
    if (!D.has[pi]) return absentPhase(method, n);
    var geo = this.geometry(P, D, v, pi), hkl = geo.hkl, nr = hkl.length, k;
    var prof = this.profileParams(P, D, v);
    var contribs = buildPeakContributions(tth, hkl, prof);
    var buckets = new Array(nr);
    for (k = 0; k < nr; k++) buckets[k] = [];
    contribs.forEach(function (c) { buckets[c.peakIndex].push(c); });
    var cols = new Array(nr), K = new Float64Array(nr), lp = new Float64Array(nr), polK = D.def.polK, zero = v.zero || 0;
    for (k = 0; k < nr; k++) {
        var R = hkl[k];
        cols[k] = null;
        if (!buckets[k].length || !Number.isFinite(R.tth)) continue;
        var tc = R.tth + zero, a = getPseudoVoigtArea(tc, R, prof);
        if (!(a > 0)) continue;
        cols[k] = intensityDerivativeColumn(tth, buckets, k);
        K[k] = a; lp[k] = sharkoLp(tc, { K: polK });
    }
    var out = { method: method, geo: geo, cols: cols, K: K, lp: lp, prof: prof, height: new Float64Array(nr), area: new Float64Array(nr),
                y: null, fixed: false, st: null, po: null, unit: null, factor: null, S: 0 };
    if (method === 'rietveld') {
        var st = opts.structure || this.structure(P, D, v, geo, !!opts.grad);
        var po = opts.po || this.preferredOrientation(P, D, v, geo, pi);
        var S = v[P.prefix + 'scale'] || 0, unit = new Float64Array(nr), factor = new Float64Array(nr);
        for (k = 0; k < nr; k++) {
            if (!cols[k]) continue;
            factor[k] = hkl[k].m * lp[k] * po[k] / K[k];          // height per unit S |F|^2
            unit[k] = factor[k] * st.F2[k];                       // height for S = 1
            out.height[k] = S * unit[k];
        }
        out.st = st; out.po = po; out.unit = unit; out.factor = factor; out.S = S;
    } else if (opts.heights) {
        for (k = 0; k < nr; k++) out.height[k] = cols[k] ? (opts.heights[k] || 0) : 0;
        out.fixed = true;
    } else if (opts.areas) {
        for (k = 0; k < nr; k++) out.height[k] = cols[k] ? (opts.areas[k] || 0) / K[k] : 0;
        out.fixed = true;
    }
    render(out, n);
    return out;
};

/** A phase absent from a dataset: no reflections, nothing to extract (fixed), a pattern of zeros. */
function absentPhase(method, n) {
    var none = new Float64Array(0);
    return { method: method, geo: { cell: null, form: null, hkl: [] }, cols: [], K: none, lp: none, prof: null, height: none, area: none,
             y: new Float64Array(n), fixed: true, absent: true, st: method === 'rietveld' ? { F2: none, slots: [], grad: [] } : null,
             po: method === 'rietveld' ? none : null, unit: none, factor: none, S: 0 };
}

/** The pattern of a phase from its heights, and the areas. */
function render(ph, n) {
    var y = new Float64Array(n), cols = ph.cols, h = ph.height;
    for (var k = 0; k < cols.length; k++) {
        var col = cols[k], hk = h[k];
        ph.area[k] = col ? hk * ph.K[k] : 0;
        if (!col || !hk) continue;
        for (var i = 0, vals = col.values, s = col.start; i < vals.length; i++) y[s + i] += hk * vals[i];
    }
    ph.y = y;
}
function addTo(a, b) { for (var i = 0; i < a.length; i++) a[i] += b[i]; }

Model.prototype.background = function (di, v) {
    var D = this.datasets[di];
    if (D.spline) return splineValues(D.def.tth, D.bkgX, this.splineY(D, v));
    var y = new Float64Array(D.n);
    for (var k = 0; k < D.T.length; k++) {
        var b = v['bkg' + k] || 0;
        if (!b) continue;
        var T = D.T[k];
        for (var i = 0; i < D.n; i++) y[i] += b * T[i];
    }
    return y;
};
Model.prototype.splineY = function (D, v) {
    var ys = new Float64Array(D.bkgX.length);
    for (var j = 0; j < ys.length; j++) ys[j] = v['bga' + j] || 0;
    return ys;
};

/**
 * Le Bail partition of the phases listed in lb, to convergence:
 *
 *     h_k  <-  sum_i c_i f_ki (y_i - b_i) / sum_i c_i phi_ki,
 *     f_ki = min(1, h_k phi_ki / y_net,calc,i)
 *
 * the partition of the net observed counts in proportion to the calculated
 * contributions (Le Bail et al. 1988), integrated with trapezoid weights c_i
 * over the included points, the reflection's share of every other phase
 * included in y_net,calc. seed: start from flat heights. The variance of the
 * extracted height propagates the point variances 1/w_i through the partition
 * with its fractions held, as is standard: sigma^2 = sum (c f)^2 / w / (sum c phi)^2.
 * The observed share is reported unclipped (lbRaw); the height carried to the
 * pattern is floored at a small fraction of the mean, so that no reflection
 * reaches the absorbing state h = 0.
 */
Model.prototype.leBail = function (di, parts, lb, rest, bkg, seed) {
    var D = this.datasets[di], n = D.n, y = D.def.y, w = D.def.w, trap = D.trap;
    var ynet = new Float64Array(n), tc = new Float64Array(n), i, k, q;
    for (i = 0; i < n; i++) ynet[i] = y[i] - bkg[i];
    if (seed) lb.forEach(function (pi) { var ph = parts[pi]; for (var k2 = 0; k2 < ph.cols.length; k2++) ph.height[k2] = ph.cols[k2] ? LB.seed : 0; });
    var raw = lb.map(function (pi) { return new Float64Array(parts[pi].cols.length); });
    var sig = lb.map(function (pi) { return new Float64Array(parts[pi].cols.length).fill(NaN); });
    var lbChange = 0;
    for (var pass = 0; pass < LB.maxPasses; pass++) {
        tc.set(rest);
        for (q = 0; q < lb.length; q++) {
            var P0 = parts[lb[q]];
            for (k = 0; k < P0.cols.length; k++) {
                var c0 = P0.cols[k], h0 = P0.height[k];
                if (!c0 || !h0) continue;
                for (i = 0; i < c0.values.length; i++) tc[c0.start + i] += h0 * c0.values[i];
            }
        }
        var sumH = 0, cntH = 0;
        for (q = 0; q < lb.length; q++) {
            var ph = parts[lb[q]], rq = raw[q], sq = sig[q];
            for (k = 0; k < ph.cols.length; k++) {
                var col = ph.cols[k];
                if (!col) { rq[k] = 0; sq[k] = NaN; continue; }
                var h = ph.height[k], num = 0, den = 0, vr = 0, vals = col.values, st = col.start;
                for (i = 0; i < vals.length; i++) {
                    var idx = st + i, ci = trap[idx], phi = vals[i];
                    if (!(ci > 0) || !(phi > 0)) continue;
                    den += ci * phi;
                    var t = tc[idx];
                    if (t > 1e-9) {
                        var f = h * phi / t;
                        if (f > 1) f = 1;
                        num += ci * f * ynet[idx];
                        var cf = ci * f;
                        vr += cf * cf / w[idx];
                    }
                }
                rq[k] = den > 0 ? num / den : 0;
                sq[k] = den > 0 ? Math.sqrt(vr) / den : NaN;
                if (rq[k] > 0) { sumH += rq[k]; cntH++; }
            }
        }
        var floor = cntH ? LB.revival * sumH / cntH : 0, dn = 0, dd = 0;
        for (q = 0; q < lb.length; q++) {
            var ph2 = parts[lb[q]];
            for (k = 0; k < ph2.cols.length; k++) {
                if (!ph2.cols[k]) continue;
                var hn = Math.max(floor, raw[q][k]);
                dn += Math.abs(hn - ph2.height[k]); dd += Math.abs(hn);
                ph2.height[k] = hn;
            }
        }
        lbChange = dd > 0 ? dn / dd : 0;
        if (pass + 1 >= LB.minPasses && lbChange < LB.tol) break;
    }
    lb.forEach(function (pi, q2) { var ph3 = parts[pi]; ph3.lbRaw = raw[q2]; ph3.lbSigma = sig[q2]; ph3.lbSettled = lbChange < LB.tol; render(ph3, n); });
};

/**
 * The normal matrix Phi'W Phi of a set of intensity columns, as a skyline:
 * the reflections put in the order of their windows so that the matrix is a
 * narrow band. A reflection whose window holds no included point is
 * undetermined (a unit diagonal, so the matrix stays factorable).
 */
function normalSet(D, items) {
    var w = D.def.w, j, q, i;
    items.sort(function (a, b) { return a.col.start - b.col.start || a.col.values.length - b.col.values.length; });
    var m = items.length, start = new Int32Array(m), stop = new Int32Array(m);
    items.forEach(function (it, jj) { start[jj] = it.col.start; stop[jj] = it.col.start + it.col.values.length; });
    var first = intensityEnvelope(start, stop), A = new SkylineMatrix(first);
    for (j = 0; j < m; j++) {
        var cj = items[j].col.values, sj = start[j], ej = stop[j], base = A.ptr[j] - first[j];
        for (q = first[j]; q <= j; q++) {
            var ck = items[q].col.values, sk = start[q], lo = sj > sk ? sj : sk, hi = ej < stop[q] ? ej : stop[q];
            if (lo >= hi) continue;
            var s = 0;
            for (i = lo; i < hi; i++) s += cj[i - sj] * ck[i - sk] * w[i];
            A.a[base + q] = s;
        }
    }
    var undet = new Uint8Array(m);
    for (j = 0; j < m; j++) if (!(A.get(j, j) > 0)) { A.set(j, j, 1); undet[j] = 1; }
    return { items: items, m: m, start: start, stop: stop, first: first, ptr: A.ptr, A: A, undet: undet, passive: null, fac: null };
}

/** The factor of the normal matrix of a set restricted to its free intensities (the others masked out), for the projections. */
function factorSet(set, passive) {
    var m = set.m, first = set.first, fac = Float64Array.from(set.A.a), j, q;
    for (j = 0; j < m; j++) {
        var f0 = first[j], p0 = set.ptr[j] - f0;
        if (!passive[j]) { for (q = f0; q < j; q++) fac[p0 + q] = 0; fac[p0 + j] = 1; }
        else for (q = f0; q < j; q++) if (!passive[q]) fac[p0 + q] = 0;
    }
    set.passive = passive;
    set.fac = skylineCholeskyInPlace(fac, first, set.ptr, m, null) ? fac : null;
    return set;
}

/**
 * The WPPF intensities of the phases listed in wp, all solved together:
 * min || sqrt(W) (target - Phi h) ||^2 with h >= 0 (Lawson-Hanson active set
 * on the skyline normal matrix of wppf_linear.js, warm-started from the last
 * solve of the dataset). ph.free marks the intensities the constraint leaves
 * free. Returns the set, factored on the free ones.
 */
Model.prototype.wppf = function (di, parts, wp, target, cacheKey) {
    var D = this.datasets[di], w = D.def.w, items = [], j, i;
    wp.forEach(function (pi) {
        var ph = parts[pi], cols = ph.cols;
        ph.free = new Uint8Array(cols.length);
        for (var k = 0; k < cols.length; k++) if (cols[k]) items.push({ pi: pi, k: k, col: cols[k] });
    });
    var set = normalSet(D, items), m = set.m, rhs = new Float64Array(m);
    for (j = 0; j < m; j++) {
        if (set.undet[j]) continue;
        var cj = items[j].col.values, sj = set.start[j], r = 0;
        for (i = 0; i < cj.length; i++) r += cj[i] * w[sj + i] * target[sj + i];
        rhs[j] = r;
    }
    var key = cacheKey || 'wppf', cache = D.nnls[key] || (D.nnls[key] = {});
    if (cache.nnlsN !== m) cache.nnlsReady = false;
    if (!cache.fac || cache.fac.length < set.A.a.length) cache.fac = new Float64Array(set.A.a.length);
    if (!cache.sol || cache.sol.length < m) cache.sol = new Float64Array(m);
    var res = m ? solveSkylineNNLS(set.A, rhs, cache) : { x: new Float64Array(0), bound: [] };
    var x = res ? res.x : new Float64Array(m), passive = new Uint8Array(m);
    for (j = 0; j < m; j++) passive[j] = (!set.undet[j] && x[j] > 0) ? 1 : 0;
    items.forEach(function (it, jj) { parts[it.pi].height[it.k] = passive[jj] ? x[jj] : 0; parts[it.pi].free[it.k] = passive[jj]; });
    wp.forEach(function (pi) { render(parts[pi], D.n); });
    set.failed = !res;
    return factorSet(set, passive);
};

/**
 * Fill in the intensities of the Le Bail and WPPF phases of a dataset that
 * were not given: the WPPF solve sees everything else as fixed, the Le Bail
 * partition sees everything else as calculated; with both kinds in one
 * dataset the two alternate, the WPPF solve last. Returns the WPPF set,
 * factored on its free intensities (null without WPPF phases) -- or, with
 * projectAll, the set of every intensity column, the Le Bail ones counted as
 * free, which is how the final uncertainties treat them: as the
 * least-squares intensities the partition approximates.
 */
Model.prototype.extract = function (di, parts, bkg, projectAll) {
    var D = this.datasets[di], n = D.n, y = D.def.y, lb = [], wp = [];
    parts.forEach(function (ph, pi) {
        if (ph.fixed) return;
        if (ph.method === 'lebail') lb.push(pi); else if (ph.method === 'wppf') wp.push(pi);
    });
    if (!lb.length && !wp.length) return null;
    var base = new Float64Array(n);
    parts.forEach(function (ph, pi) { if (lb.indexOf(pi) < 0 && wp.indexOf(pi) < 0) addTo(base, ph.y); });
    var ws = null, rounds = lb.length && wp.length ? 4 : 1;
    for (var r = 0; r < rounds; r++) {
        if (lb.length) {
            var rest = Float64Array.from(base);
            wp.forEach(function (pi) { addTo(rest, parts[pi].y); });
            this.leBail(di, parts, lb, rest, bkg, r === 0);
        }
        if (wp.length) {
            var target = new Float64Array(n);
            for (var i = 0; i < n; i++) target[i] = y[i] - bkg[i] - base[i];
            lb.forEach(function (pi) { var yy = parts[pi].y; for (var i2 = 0; i2 < n; i2++) target[i2] -= yy[i2]; });
            ws = this.wppf(di, parts, wp, target);
        }
    }
    if (!lb.length || !projectAll) return ws;
    var items = [];
    lb.concat(wp).forEach(function (pi) {
        var ph = parts[pi];
        for (var k = 0; k < ph.cols.length; k++) if (ph.cols[k]) items.push({ pi: pi, k: k, col: ph.cols[k] });
    });
    var set = normalSet(D, items), passive = new Uint8Array(set.m);
    for (var j = 0; j < set.m; j++) {
        var it = set.items[j], ph2 = parts[it.pi];
        passive[j] = !set.undet[j] && (ph2.method === 'lebail' || ph2.free[it.k]) ? 1 : 0;
    }
    set.all = true;
    return factorSet(set, passive);
};

/**
 * The whole dataset: background, every phase, the sum. opts.held: the areas
 * at which to hold Le Bail phases ({ phase index: areas }), as during the step
 * of a Le Bail cycle; without it they are extracted afresh. opts.projectAll:
 * see extract.
 */
Model.prototype.evalDataset = function (di, v, opts) {
    opts = opts || {};
    // PT may explore outside the initial-cell envelope used for local LM.
    // Refresh only when cell values change, so every trial has its reflections.
    if (this.dynamicReflections) {
        var self = this, dataset = this.datasets[di], def = dataset.def;
        var key = this.phases.map(function (P) { return P.cellNames.map(function (c) { return v[P.prefix + c]; }).join(','); }).join(';');
        if (dataset.reflectionCellKey !== key) {
            var lmax = Math.max(def.lambda1, def.ratio > 0 && def.lambda2 > 0 ? def.lambda2 : 0);
            var tmax = Math.min(179, def.tth[dataset.n - 1] + 3), dmin = lmax / (2 * Math.sin(tmax * D2R / 2)) * 0.98;
            dataset.refl = this.phases.map(function (P, pi) {
                if (!dataset.has[pi]) return [];
                var cell = cellOf(P.def.system, P.def.uniqueAxis, function (c) { return v[P.prefix + c]; });
                return cell ? generateReflections(cell, P.def.ops, dmin) : [];
            });
            dataset.reflectionCellKey = key;
        }
    }
    var bkg = this.background(di, v), parts = [], held = opts.held || null;
    for (var pi = 0; pi < this.phases.length; pi++) {
        var po = { grad: !!opts.grad };
        if (held && held[pi] && this.methodOf(this.phases[pi]) === 'lebail') po.areas = held[pi];
        parts.push(this.evalPhase(pi, di, v, po));
    }
    var ws = this.extract(di, parts, bkg, !!opts.projectAll), y = Float64Array.from(bkg);
    parts.forEach(function (ph) { addTo(y, ph.y); });
    return { y: y, bkg: bkg, phases: parts, ws: ws };
};

/** The areas of the Le Bail phases of an evaluation, to hold them during the step of a cycle. */
function heldAreas(ev) {
    var o = null;
    ev.phases.forEach(function (ph, pi) { if (ph.method === 'lebail') { o = o || {}; o[pi] = Float64Array.from(ph.area); } });
    return o;
}

/** sum of a column of reflection unit profiles weighted by dh (a derivative of the heights) */
function combine(cols, dh, n) {
    var out = new Float64Array(n);
    for (var k = 0; k < cols.length; k++) {
        var c = cols[k], w = dh[k];
        if (!c || !w) continue;
        for (var i = 0, v = c.values, s = c.start; i < v.length; i++) out[s + i] += w * v[i];
    }
    return out;
}

/**
 * Projection of a derivative column u on the complement of the free WPPF
 * intensity columns (in the metric W), in place: u <- u - Phi (Phi'WPhi)^-1 Phi'W u.
 * keep: return b = Phi'W u (every intensity) and z = (Phi'WPhi)^-1 b (the free ones).
 */
function project(ws, w, u, keep) {
    var m = ws.m, items = ws.items, b = new Float64Array(m), j, i;
    for (j = 0; j < m; j++) {
        var c = items[j].col, s = c.start, vals = c.values, acc = 0;
        for (i = 0; i < vals.length; i++) acc += vals[i] * w[s + i] * u[s + i];
        b[j] = acc;
    }
    var z = new Float64Array(m);
    if (ws.fac) {
        for (j = 0; j < m; j++) z[j] = ws.passive[j] ? b[j] : 0;
        if (!skylineSolveInPlace(ws.fac, ws.first, ws.ptr, m, z)) z.fill(0);
        for (j = 0; j < m; j++) {
            var zj = z[j];
            if (!ws.passive[j] || !zj) continue;
            var c2 = items[j].col, s2 = c2.start, v2 = c2.values;
            for (i = 0; i < v2.length; i++) u[s2 + i] -= zj * v2[i];
        }
    }
    return keep ? { b: b, z: z } : null;
}

/** How each kind of phase is held while one parameter is moved for a difference. */
function heldFor(ph, kind) {
    if (ph.method === 'rietveld') return kind === 'cell' ? {} : { structure: ph.st, po: ph.po };
    if (ph.method === 'lebail') return { areas: ph.area };
    return { heights: ph.height };
}

/**
 * Derivative columns d y_calc / d p of dataset di for the variables listed
 * (names), at the values v, from the evaluation ev (evalDataset with grad).
 * The intensities of Le Bail phases are held (as areas); with WPPF phases in
 * the dataset every column is then projected on the complement of their
 * columns (variable projection), and proj, if given, receives b and z of each
 * name for the uncertainties of the intensities.
 */
Model.prototype.derivatives = function (di, v, ev, names, proj) {
    var self = this, D = this.datasets[di], n = D.n, out = {}, w = D.def.w;
    var gradIndex = ev.phases.map(function (ph) { var m = {}; if (ph.st) ph.st.slots.forEach(function (sl, g) { m[sl.name] = g; }); return m; });
    var phaseIndex = {};
    this.phases.forEach(function (P, i) { phaseIndex[P.def.key] = i; });
    names.forEach(function (name) {
        var c = classify(name), pi = c.phase && phaseIndex[c.phase] != null ? phaseIndex[c.phase] : -1, ph = pi >= 0 ? ev.phases[pi] : null, col, k;
        if (c.kind === 'bkg') col = D.T[c.index] ? Float64Array.from(D.T[c.index]) : new Float64Array(n);
        else if (c.kind === 'bga') {
            col = new Float64Array(n);
            if (D.spline && c.index < D.bkgX.length) {
                var ys = self.splineY(D, v), hb = fdStep(c, ys[c.index]);
                ys[c.index] += hb;
                var yb = splineValues(D.def.tth, D.bkgX, ys);
                for (var i0 = 0; i0 < n; i0++) col[i0] = (yb[i0] - ev.bkg[i0]) / hb;
            }
        } else if (c.kind === 'unknown' || (c.phase && !ph) || (ph && !methodAllows(ph.method, c.kind))) col = new Float64Array(n);
        else if (c.kind === 'scale') col = combine(ph.cols, ph.unit, n);
        else if (c.kind === 'atom') {
            var g = gradIndex[pi][name];
            if (g == null) col = new Float64Array(n);              // a constrained coordinate: no column
            else {
                var gv = ph.st.grad[g], dh = new Float64Array(gv.length);
                for (k = 0; k < gv.length; k++) dh[k] = ph.S * ph.factor[k] * gv[k];
                col = combine(ph.cols, dh, n);
            }
        } else if (c.kind === 'po') {
            var r = v[name], h = fdStep(c, r), po2 = self.preferredOrientation(self.phases[pi], D, v, ph.geo, pi, r + h);
            var dh2 = new Float64Array(ph.height.length);
            for (k = 0; k < dh2.length; k++) dh2[k] = ph.po[k] > 0 ? ph.height[k] * (po2[k] / ph.po[k] - 1) / h : 0;
            col = combine(ph.cols, dh2, n);
        } else {
            // Symmetric derivatives avoid a one-sided slope bias near the minimum.
            var h0 = fdStep(c, v[name]), lim = defaultLimits(name,v[name]);
            var plus = v[name]+h0 <= lim[1], minus = v[name]-h0 >= lim[0];
            var vp=Object.assign({},v), vm=Object.assign({},v);
            vp[name]=plus ? v[name]+h0 : v[name]; vm[name]=minus ? v[name]-h0 : v[name];
            var dStep=vp[name]-vm[name];
            col = new Float64Array(n);
            var list = (c.kind === 'cell' || c.kind === 'profile') ? [pi] : self.phases.map(function (_, i) { return i; });
            if(dStep) list.forEach(function(p){
              var ep=plus ? self.evalPhase(p,di,vp,heldFor(ev.phases[p],c.kind)).y : ev.phases[p].y;
              var em=minus ? self.evalPhase(p,di,vm,heldFor(ev.phases[p],c.kind)).y : ev.phases[p].y;
              for(var i=0;i<n;i++)col[i]+=(ep[i]-em[i])/dStep;
            });
        }
        if (ev.ws && ev.ws.m) {
            var pr = project(ev.ws, w, col, !!proj);
            if (proj) proj[name] = pr;
        }
        out[name] = col;
    });
    return out;
};

// ---------------------------------------------------------------------------
//  LINEAR ALGEBRA (small dense systems; the selected inverse of a skyline)
// ---------------------------------------------------------------------------

function cholesky(A, n) {
    var L = new Float64Array(n * n);
    for (var i = 0; i < n; i++) for (var j = 0; j <= i; j++) {
        var s = A[i * n + j];
        for (var k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) { if (!(s > 0) || !isFinite(s)) return null; L[i * n + i] = Math.sqrt(s); }
        else L[i * n + j] = s / L[j * n + j];
    }
    return L;
}
function cholSolve(L, b, n) {
    var x = new Float64Array(n), i, k, s;
    for (i = 0; i < n; i++) { s = b[i]; for (k = 0; k < i; k++) s -= L[i * n + k] * x[k]; x[i] = s / L[i * n + i]; }
    for (i = n - 1; i >= 0; i--) { s = x[i]; for (k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
    return x;
}
/** Solve A x = b for a symmetric positive semi-definite A, with a growing ridge if needed. */
function solveSPD(A, b, n) {
    var L = cholesky(A, n);
    if (L) return cholSolve(L, b, n);
    var tr = 0;
    for (var i = 0; i < n; i++) tr += Math.abs(A[i * n + i]);
    var ridge = (tr / Math.max(n, 1)) * 1e-12 || 1e-300;
    for (var a = 0; a < 10; a++, ridge *= 100) {
        var B = Float64Array.from(A);
        for (i = 0; i < n; i++) B[i * n + i] += ridge;
        L = cholesky(B, n);
        if (L) return cholSolve(L, b, n);
    }
    return null;
}
/** Inverse of a symmetric positive-definite matrix scaled to unit diagonal first (better conditioned); null if singular. */
function invSPD(A, n) {
    var d = new Float64Array(n), S = new Float64Array(n * n), i, j;
    for (i = 0; i < n; i++) d[i] = A[i * n + i] > 0 ? 1 / Math.sqrt(A[i * n + i]) : 0;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) S[i * n + j] = A[i * n + j] * d[i] * d[j];
    var L = cholesky(S, n);
    if (!L) return null;
    for (i=0;i<n;i++) if (L[i*n+i] < 1e-6) return null;
    var inv = new Float64Array(n * n), e = new Float64Array(n);
    for (j = 0; j < n; j++) {
        e.fill(0); e[j] = 1;
        var col = cholSolve(L, e, n);
        for (i = 0; i < n; i++) inv[i * n + j] = col[i] * d[i] * d[j];
    }
    return inv;
}

/** Diagnose failed joint covariance without inventing uncertainties from a
 * ridge or pseudoinverse. Pivoted Cholesky of the unit-diagonal normal matrix
 * finds dependent combinations, including those involving more than two
 * variables. Names are attached by the caller, with dataset scope. */
function normalDependence(A, n) {
    var order = Array.from({length:n}, function(_,i){return i;}), diag = new Float64Array(n),
        scale = new Float64Array(n), L = new Float64Array(n*n), rank = 0;
    for(var i=0;i<n;i++){scale[i]=A[i*n+i]>0?1/Math.sqrt(A[i*n+i]):0;diag[i]=scale[i]?1:0;}
    for(var k=0;k<n;k++){
        var best=k;
        for(i=k+1;i<n;i++)if(diag[i]>diag[best])best=i;
        if(!(diag[best]>1e-10))break;
        var tmp=order[k];order[k]=order[best];order[best]=tmp;
        var td=diag[k];diag[k]=diag[best];diag[best]=td;
        for(var j=0;j<k;j++){tmp=L[k*n+j];L[k*n+j]=L[best*n+j];L[best*n+j]=tmp;}
        L[k*n+k]=Math.sqrt(diag[k]);
        for(i=k+1;i<n;i++){
            var s=A[order[i]*n+order[k]]*scale[order[i]]*scale[order[k]];
            for(j=0;j<k;j++)s-=L[i*n+j]*L[k*n+j];
            L[i*n+k]=s/L[k*n+k];diag[i]-=L[i*n+k]*L[i*n+k];
        }
        rank++;
    }
    var groups=[];
    for(var t=rank;t<n;t++){
        var weights=new Float64Array(rank), largest=1;
        for(i=rank-1;i>=0;i--){var r=L[t*n+i];for(j=i+1;j<rank;j++)r-=L[j*n+i]*weights[j];weights[i]=r/L[i*n+i];largest=Math.max(largest,Math.abs(weights[i]));}
        var group=[order[t]];
        for(i=0;i<rank;i++)if(Math.abs(weights[i])>largest*1e-4)group.push(order[i]);
        groups.push(group.sort(function(a,b){return a-b;}));
    }
    return {rank:rank,groups:groups};
}

/** Validate the instrument's Gaussian polynomial over the fitted angular
 * range, including an interior minimum. Negative V is allowed; it is the
 * combined variance that must be non-negative. This is a diagnostic only:
 * never silently reset fitted values or refinement choices. */
function instrumentProfileWarnings(model, di, v) {
    var D=model.datasets[di], active=model.phases.find(function(P,i){return D.has[i] && usesSeparatedProfile(P.def);});
    if(!active || !D.n)return [];
    var type=D.def.resolutionType || active.def.profileType, suffixes=type==='split_pvoigt'?['_L','_R']:[''], out=[];
    var lo=Math.tan(Math.max(1e-6,Math.min(179.999999,D.def.tth[0]))*Math.PI/360),
        hi=Math.tan(Math.max(1e-6,Math.min(179.999999,D.def.tth[D.n-1]))*Math.PI/360);
    suffixes.forEach(function(suffix){
        var keys=['U','V','W'].map(function(k){return k+suffix;}), defaults=instrumentProfileParams(type),
            p=keys.map(function(k){var fallback=defaults.find(function(p){return p[0]===k;});return Number.isFinite(v['inst.'+k])?v['inst.'+k]:fallback?fallback[1]:0;}),
            candidates=[lo,hi];
        if(p[0]>0){var vertex=-p[1]/(2*p[0]);if(vertex>lo && vertex<hi)candidates.push(vertex);}
        var worst=candidates.map(function(t){return {t:t,value:(p[0]*t+p[1])*t+p[2]};}).sort(function(a,b){return a.value-b.value;})[0];
        if(worst.value < -1e-9)out.push('Instrument Gaussian variance ('+keys.join(', ')+') is negative: minimum '+worst.value.toPrecision(5)+' cdeg^2 at 2theta '+(2*Math.atan(worst.t)*180/Math.PI).toFixed(2)+' deg. Sample broadening or the width floor can hide this invalid instrument profile and make its coefficients poorly determined. Check the resolution calibration; negative V alone is allowed.');
    });
    return out;
}

/**
 * The entries of Z = (L L')^-1 inside the envelope of a skyline Cholesky
 * factor L (Takahashi, Fagan & Chen 1973), from L' Z = L^-1:
 *
 *     Z_ij = -sum_{k>i} L_ki Z_kj / L_ii             (j > i, in the envelope)
 *     Z_ii = (1/L_ii - sum_{k>i} L_ki Z_ki) / L_ii
 *
 * taken from the last row up. Every Z_kj needed lies inside the envelope, so
 * the cost is that of the factorisation, O(n band^2), not O(n^3).
 */
function selectedInverse(L, first, ptr, m) {
    var Z = new Float64Array(L.length), cnt = new Int32Array(m + 1), i, k, a, b;
    for (k = 0; k < m; k++) for (i = first[k]; i < k; i++) cnt[i + 1]++;
    for (i = 0; i < m; i++) cnt[i + 1] += cnt[i];
    var below = new Int32Array(cnt[m]), fill = Int32Array.from(cnt.subarray(0, m));
    for (k = 0; k < m; k++) for (i = first[k]; i < k; i++) below[fill[i]++] = k;
    for (i = m - 1; i >= 0; i--) {
        var lii = L[ptr[i] + (i - first[i])], o0 = cnt[i], o1 = cnt[i + 1];
        for (a = o0; a < o1; a++) {
            var j = below[a], s = 0;
            for (b = o0; b < o1; b++) {
                var kk = below[b], lki = L[ptr[kk] + (i - first[kk])];
                s += lki * (kk >= j ? Z[ptr[kk] + (j - first[kk])] : Z[ptr[j] + (kk - first[j])]);
            }
            Z[ptr[j] + (i - first[j])] = -s / lii;
        }
        var s2 = 0;
        for (b = o0; b < o1; b++) { var k2 = below[b]; s2 += L[ptr[k2] + (i - first[k2])] * Z[ptr[k2] + (i - first[k2])]; }
        Z[ptr[i] + (i - first[i])] = (1 / lii - s2) / lii;
    }
    return Z;
}

// ---------------------------------------------------------------------------
//  STATISTICS
// ---------------------------------------------------------------------------

/**
 * R factors of a dataset and, for each phase, the Rietveld partition of the
 * observed intensity: I_obs,k = I_calc,k . sum_i y_ki (y_o - y_b) / (y_c - y_b)
 * / sum_i y_ki, with y_ki the profile of reflection k. R_Bragg and R_F follow.
 * Excluded points (weight 0) take no part. nPar includes the intensities of
 * the Le Bail and WPPF phases.
 */
function datasetStats(D, ev, nPar) {
    var y = D.def.y, w = D.def.w, n = D.n, sw = 0, sr = 0, sa = 0, so = 0, nFit = 0;
    for (var i = 0; i < n; i++) {
        if (!(w[i] > 0)) continue;
        var d = y[i] - ev.y[i];
        sr += w[i] * d * d; sw += w[i] * y[i] * y[i]; sa += Math.abs(d); so += Math.abs(y[i]); nFit++;
    }
    var dof = Math.max(1, nFit - nPar), Rwp = Math.sqrt(sr / sw), Rexp = Math.sqrt(dof / sw);
    var phases = ev.phases.map(function (ph) {
        var num = 0, den = 0, numF = 0, denF = 0, nRefl = 0, obs = new Float64Array(ph.height.length);
        for (var k = 0; k < ph.height.length; k++) {
            var col = ph.cols[k], hk = ph.height[k];
            if (!col || !(hk > 0)) { obs[k] = NaN; continue; }
            var sc = 0, s0 = 0;
            for (var j = 0, vals = col.values, st = col.start; j < vals.length; j++) {
                var idx = st + j;
                if (!(w[idx] > 0)) continue;
                var yk = hk * vals[j], net = ev.y[idx] - ev.bkg[idx];
                if (net > 1e-12 * Math.abs(ev.y[idx]) + 1e-300) { sc += yk * (y[idx] - ev.bkg[idx]) / net; s0 += yk; }
            }
            if (!(s0 > 0)) { obs[k] = NaN; continue; }
            var Ic = ph.area[k], Io = Ic * sc / s0;
            obs[k] = Io; nRefl++;
            num += Math.abs(Io - Ic); den += Math.abs(Io);
            numF += Math.abs(Math.sqrt(Math.max(Io, 0)) - Math.sqrt(Ic)); denF += Math.sqrt(Math.max(Io, 0));
        }
        return { RBragg: den > 0 ? num / den : NaN, RF: denF > 0 ? numF / denF : NaN, nRefl: nRefl, Iobs: obs, method: ph.method };
    });
    return { n: nFit, chi2: sr, sumWeightedObserved2: sw, sumAbsObserved: so, sumAbsResidual: sa, Rp: so > 0 ? sa / so : NaN, Rwp: Rwp, Rexp: Rexp, gof: (Rwp / Rexp) * (Rwp / Rexp), phases: phases };
}

/** The number of intensities an evaluation determined: Le Bail reflections with data, free WPPF ones. */
function intensityCount(ev) {
    var n = 0;
    if (ev.ws && ev.ws.passive) for (var j = 0; j < ev.ws.m; j++) if (ev.ws.passive[j]) n++;
    if (ev.ws && ev.ws.all) return n;                    // the Le Bail ones are in the set
    ev.phases.forEach(function (ph) {
        if (ph.method !== 'lebail' || !ph.lbSigma) return;
        for (var k = 0; k < ph.cols.length; k++) if (ph.cols[k] && Number.isFinite(ph.lbSigma[k])) n++;
    });
    return n;
}

/**
 * Exactly coincident WPPF reflections: the pivots the modified Cholesky of
 * the full normal matrix had to repair, each expanded to every reflection
 * whose column is parallel to it (as in wppf_linear.js). Returns group ids by
 * position in the working set, -1 for a reflection on its own.
 */
function degenerateGroups(ws) {
    var m = ws.m, gid = new Int32Array(m).fill(-1);
    if (!m) return gid;
    var fac = Float64Array.from(ws.A.a), rep = [];
    if (!skylineCholeskyInPlace(fac, ws.first, ws.ptr, m, rep)) return gid;
    var A = ws.A, groups = [];
    rep.forEach(function (i) {
        var dii = A.get(i, i);
        if (!(dii > 0) || ws.undet[i]) return;
        var mem = [i];
        for (var j = ws.first[i]; j < i; j++) { var djj = A.get(j, j); if (djj > 0 && !ws.undet[j] && Math.abs(A.get(i, j) / Math.sqrt(dii * djj)) > DEGENERACY) mem.push(j); }
        for (var k = i + 1; k < m; k++) { if (ws.first[k] > i) continue; var dkk = A.get(k, k); if (dkk > 0 && !ws.undet[k] && Math.abs(A.get(k, i) / Math.sqrt(dii * dkk)) > DEGENERACY) mem.push(k); }
        var g = groups.find(function (gr) { return mem.some(function (x) { return gr.indexOf(x) >= 0; }); });
        if (g) mem.forEach(function (x) { if (g.indexOf(x) < 0) g.push(x); }); else groups.push(mem);
    });
    groups.forEach(function (g, gi) { if (g.length > 1) g.forEach(function (x) { gid[x] = gi; }); });
    return gid;
}

/**
 * The intensities of the Le Bail and WPPF phases of one evaluated dataset,
 * per phase, in the order of the phase's reflections: area (the integrated
 * Ka1 intensity, the convention of the Rietveld model: area = S m Lp P |F|^2),
 * sigma(area), and for WPPF whether the constraint holds it at zero and
 * whether it is exactly coincident with another.
 *
 * WPPF uncertainties are marginal, the non-linear parameters integrated out,
 * when cov is given: the intensity block of the inverse of the full normal
 * matrix is N^-1 + Y S^-1 Y' (Woodbury) with N the intensity normal matrix,
 * S the projected normal matrix of the parameters, Y = N^-1 Phi'W U -- the
 * diagonal of N^-1 from the selected inverse of its skyline factor, Y from
 * the projections. cov = { s2, inv (unscaled, over the free variables),
 * slots: [{ e (row of inv), z }] }. Without cov they are conditional on the
 * parameters. An intensity held at zero gets the conditional variance of a
 * free one, 1 / (N_kk - N_kP N_PP^-1 N_Pk).
 */
function intensityTables(ev, s2, cov, D) {
    var out = ev.phases.map(function () { return null; });
    ev.phases.forEach(function (ph, pi) {
        if (ph.method === 'rietveld') return;
        var nr = ph.cols.length, t = { method: ph.method, area: Float64Array.from(ph.area), sigma: new Float64Array(nr).fill(NaN),
                                        obs: new Float64Array(nr).fill(NaN), bound: new Uint8Array(nr), group: new Int32Array(nr).fill(-1) };
        if (ph.method === 'lebail') {
            for (var k = 0; k < nr; k++) {
                if (!ph.cols[k]) continue;
                t.sigma[k] = ph.lbSigma ? ph.lbSigma[k] * ph.K[k] : NaN;
                t.obs[k] = ph.lbRaw ? ph.lbRaw[k] * ph.K[k] : NaN;
            }
        }
        out[pi] = t;
    });
    // exactly coincident Le Bail reflections (the partition splits them in proportion to their start, which is
    // arbitrary): from the normal matrix of their columns, as for WPPF
    var lbItems = [];
    ev.phases.forEach(function (ph, pi) {
        if (ph.method === 'lebail') for (var k = 0; k < ph.cols.length; k++) if (ph.cols[k]) lbItems.push({ pi: pi, k: k, col: ph.cols[k] });
    });
    if (lbItems.length && D) {
        var lset = normalSet(D, lbItems), lgid = degenerateGroups(lset);
        lset.items.forEach(function (it, j) { out[it.pi].group[it.k] = lgid[j] >= 0 ? 1000 + lgid[j] : -1; });
    }
    var ws = ev.ws;
    if (ws && ws.m && ws.fac) {
        var m = ws.m, Z = selectedInverse(ws.fac, ws.first, ws.ptr, m), gid = degenerateGroups(ws), sc = s2 > 0 ? s2 : 1;
        var slots = cov && cov.slots ? cov.slots : [], ns = slots.length, inv = cov ? cov.inv : null, ne = cov ? cov.ne : 0;
        var col = new Float64Array(m);
        for (var j = 0; j < m; j++) {
            var it = ws.items[j], t2 = out[it.pi], ph2 = ev.phases[it.pi], v = NaN;
            if (ph2.method === 'lebail') continue;            // its uncertainty is that of the partition
            t2.group[it.k] = gid[j];
            if (ws.passive[j]) {
                v = Z[ws.ptr[j] + (j - ws.first[j])];
                if (inv && ns) {
                    var add = 0;
                    for (var a = 0; a < ns; a++) {
                        var za = slots[a].z[j];
                        if (!za) continue;
                        for (var b = 0; b < ns; b++) add += za * inv[slots[a].e * ne + slots[b].e] * slots[b].z[j];
                    }
                    v += add;
                }
            } else if (!ws.undet[j]) {
                // conditional variance of a reflection held at zero, as if it were free
                col.fill(0);
                var A = ws.A, nkk = A.get(j, j);
                for (var q = ws.first[j]; q < j; q++) if (ws.passive[q]) col[q] = A.get(j, q);
                for (q = j + 1; q < m; q++) if (ws.first[q] <= j && ws.passive[q]) col[q] = A.get(q, j);
                var zc = Float64Array.from(col);
                if (skylineSolveInPlace(ws.fac, ws.first, ws.ptr, m, zc)) {
                    var dot = 0;
                    for (q = 0; q < m; q++) dot += col[q] * zc[q];
                    var schur = nkk - dot;
                    v = schur > 1e-12 * nkk ? 1 / schur : 1 / nkk;
                } else v = 1 / nkk;
                t2.bound[it.k] = 1;
            }
            t2.sigma[it.k] = v >= 0 ? Math.sqrt(sc * v) * ph2.K[it.k] : NaN;
        }
    }
    return out;
}

/**
 * The precision of the WPPF intensities of one phase in one dataset, the
 * non-linear parameters integrated out (the Schur complement of the full
 * normal matrix): Q = N_RR - C_R A'^-1 C_R', A' = S + C'Y the normal matrix
 * of the parameters with only this dataset's intensities eliminated, over the
 * maxRefl lowest-angle reflections R of the phase (the space-group test of
 * Markvardsen et al. 2001 wants the information there, as powder5 did).
 * In height units, not divided by s2. Returns { index (reflections of the
 * phase), Q (n x n) }.
 */
var MAX_PRECISION_REFLECTIONS=600;
function precisionBlock(ev, pi, maxRefl, cov) {
    maxRefl=Number.isSafeInteger(maxRefl) && maxRefl>0?Math.min(maxRefl,MAX_PRECISION_REFLECTIONS):MAX_PRECISION_REFLECTIONS;
    var ws = ev.ws;
    if (!ws || !ws.m) return null;
    var R = [];
    for (var j = 0; j < ws.m; j++) if (ws.items[j].pi === pi && !ws.undet[j]) R.push(j);
    var ph = ev.phases[pi];
    R.sort(function (a, b) { return ph.geo.hkl[ws.items[a].k].tth - ph.geo.hkl[ws.items[b].k].tth; });
    var available=R.length;
    if (R.length > maxRefl) R.length = maxRefl;
    var n = R.length, Q = new Float64Array(n * n), A = ws.A;
    for (var a = 0; a < n; a++) for (var b = 0; b <= a; b++) {
        var ja = R[a], jb = R[b], hi = Math.max(ja, jb), lo = Math.min(ja, jb), v = A.idx(hi, lo) >= 0 ? A.get(hi, lo) : 0;
        Q[a * n + b] = v; Q[b * n + a] = v;
    }
    var slots = cov && cov.slots ? cov.slots : [], ns = slots.length;
    if (ns && cov.S) {
        var Ap = new Float64Array(ns * ns);
        for (a = 0; a < ns; a++) for (b = 0; b < ns; b++) {
            var s = cov.S[slots[a].e * cov.ne + slots[b].e], za = slots[a], zb = slots[b];
            for (j = 0; j < ws.m; j++) if (ws.passive[j]) s += za.b[j] * zb.z[j];
            Ap[a * ns + b] = s;
        }
        var Ai = invSPD(Ap, ns);
        if (Ai) {
            for (a = 0; a < n; a++) for (b = 0; b <= a; b++) {
                var t = 0;
                for (var p = 0; p < ns; p++) {
                    var ca = slots[p].b[R[a]];
                    if (!ca) continue;
                    for (var q = 0; q < ns; q++) t += ca * Ai[p * ns + q] * slots[q].b[R[b]];
                }
                Q[a * n + b] -= t;
                if (a !== b) Q[b * n + a] = Q[a * n + b];
            }
        }
    }
    return { index: R.map(function (jj) { return ws.items[jj].k; }), Q: Q, n: n, available:available };
}

// ---------------------------------------------------------------------------
//  THE FIT
// ---------------------------------------------------------------------------

/**
 * problem as for Model, plus
 *   vars:   [{ name, d, ds }]  d = index of the dataset, or -1: shared by the datasets listed in ds (indices; every
 *           dataset of the problem without it)
 *   limits: { name: [lo, hi] }  (defaults from defaultLimits)
 *   maxIter, tol (relative chi^2 change, twice in a row)
 * opts.onIter({ it, chi2, Rwp }), opts.shouldStop()
 * opts.evaluateOnly: no iteration -- the statistics, uncertainties and
 * intensities at the start values (what the space-group test, charge
 * flipping and the Wyckoff search start from).
 * opts.precision: { dataset, phase (index), maxRefl }: return the precision
 * block of that phase's WPPF intensities as well.
 * Returns { ok, msg, iter, chi2, dof, values, esd, stats, intensities, ms }.
 */
function* refineSteps(problem, opts) {
    opts = opts || {};
    var t0 = Date.now();
    try {
        var constraints=null,originalVariableCount=(problem.vars || []).length;
        if((problem.parameterLinks || []).length || problem.phases.some(function(p){return p.method==='rietveld' && p.constraints && p.constraints.length;})){
            if(typeof AtomicConstraints==='undefined')throw new Error('Atomic constraint module is not loaded.');
            constraints=AtomicConstraints.prepare(problem);
            problem=Object.assign({},problem,{vars:constraints.vars,values:constraints.values});
        }
        var model = new Model(problem), nd = model.datasets.length, vars = problem.vars || [], nv = vars.length, only = !!opts.evaluateOnly;
        var algorithm = problem.algorithm || 'lm', ptInfo = null, progressTotal = 0;
        if (!only && algorithm !== 'lm' && algorithm !== 'pt') throw new Error('unknown refinement algorithm: ' + algorithm);
        var values = problem.values.map(function (v) { return Object.assign({}, v); });
        if (!nv && !only && !originalVariableCount) throw new Error('nothing is ticked to refine');
        var info = vars.map(function (vr) {
            var ds = vr.d >= 0 ? [vr.d] : (Array.isArray(vr.ds) && vr.ds.length ? vr.ds.filter(function (i) { return i >= 0 && i < nd; }) : model.datasets.map(function (_, i) { return i; }));
            if (!ds.length) throw new Error('no dataset for ' + vr.name);
            var c = classify(vr.name), v0 = values[ds[0]][vr.name];
            if (!Number.isFinite(v0)) throw new Error('no start value for ' + vr.name);
            var lim = constraints ? constraints.limits[vars.indexOf(vr)] : (problem.limits && problem.limits[vr.name]) || defaultLimits(vr.name, v0);
            return { c: c, lo: lim[0], hi: lim[1], ds: ds };
        });
        var x = new Float64Array(nv);
        vars.forEach(function (vr, j) { x[j] = only ? values[info[j].ds[0]][vr.name] : Math.min(info[j].hi,Math.max(info[j].lo,values[info[j].ds[0]][vr.name])); });
        function apply(xv) {
            var out = values.map(function (v) { return Object.assign({}, v); });
            vars.forEach(function (vr, j) { info[j].ds.forEach(function (d) { out[d][vr.name] = xv[j]; }); });
            return constraints ? constraints.apply(out,xv) : out;
        }
        if(constraints && !constraints.valid(apply(x)))throw new Error('Constrained starting values are outside parameter limits. Edit the atomic constraints or starting values.');
        var nPts = 0;
        model.datasets.forEach(function (D) { nPts += D.nFit; });
        if (!(nPts > 0)) throw new Error('every point of the fitted range is excluded');
        // chi^2 at vals; held: per dataset, the areas at which to hold Le Bail phases (a Le Bail cycle)
        function cost(vals, held, engine) {
            if(constraints && !constraints.valid(vals))return Infinity;
            var s = 0, costModel = engine || model;
            for (var d = 0; d < nd; d++) {
                var ev = costModel.evalDataset(d, vals[d], { held: held ? held[d] : null }), y = costModel.datasets[d].def.y, w = costModel.datasets[d].def.w;
                for (var i = 0; i < ev.y.length; i++) { if (!(w[i] > 0)) continue; var r = y[i] - ev.y[i]; s += w[i] * r * r; }
                if (!(s < Infinity)) return Infinity;
            }
            return s;
        }
        // normal equations at xv: A = J'WJ, g = J'W(y - ycalc), with the variables of each dataset (only: a subset). The
        // intensities are extracted afresh; held returns the Le Bail areas, to hold during the step of a cycle.
        function normal(xv, onlyIdx, keep, projectAll) {
            var vals = apply(xv), A = new Float64Array(nv * nv), g = new Float64Array(nv), f = 0, evs = [], projs = [], held = [];
            for (var d = 0; d < nd; d++) {
                var D = model.datasets[d], ev = model.evalDataset(d, vals[d], { grad: true, projectAll: !!projectAll }), idx = [];
                held[d] = heldAreas(ev);
                for (var j = 0; j < nv; j++) if (info[j].ds.indexOf(d) >= 0 && (!onlyIdx || onlyIdx.indexOf(j) >= 0)) idx.push(j);
                var pj = keep ? {} : null;
                var needed=idx.map(function(j2){return vars[j2].name;}), linked=constraints ? constraints.links.filter(function(l){return l.d===d && l.terms.some(function(t){return idx.indexOf(t[0])>=0;});}) : [];
                linked.forEach(function(l){if(needed.indexOf(l.name)<0)needed.push(l.name);});
                var cols = model.derivatives(d, vals[d], ev, needed, pj);
                var J = idx.map(function(j2){var col=linked.length?Float64Array.from(cols[vars[j2].name]):cols[vars[j2].name];linked.forEach(function(l){l.terms.forEach(function(t){if(t[0]===j2)for(var q=0;q<col.length;q++)col[q]+=t[1]*cols[l.name][q];});});return col;}), y = D.def.y, w = D.def.w, r = new Float64Array(D.n);
                for (var i = 0; i < D.n; i++) { if (!(w[i] > 0)) continue; r[i] = y[i] - ev.y[i]; f += w[i] * r[i] * r[i]; }
                for (var a = 0; a < idx.length; a++) {
                    var Ja = J[a], ga = 0;
                    for (i = 0; i < D.n; i++) ga += w[i] * Ja[i] * r[i];
                    g[idx[a]] += ga;
                    for (var b = 0; b <= a; b++) {
                        var Jb = J[b], s = 0;
                        for (i = 0; i < D.n; i++) s += w[i] * Ja[i] * Jb[i];
                        A[idx[a] * nv + idx[b]] += s;
                        if (a !== b) A[idx[b] * nv + idx[a]] += s;
                    }
                }
                if (keep) { evs[d] = ev; projs[d] = { idx: idx, p: pj }; }
            }
            return { A: A, g: g, f: f, evs: evs, projs: projs, held: held };
        }

        /*
         * Levenberg-Marquardt from x. Stage 'vp': every evaluation extracts its intensities afresh -- Rietveld and WPPF
         * phases, and Le Bail phases while model.lbAsWppf solves them as WPPF ones. Stage 'lebail': Le Bail cycles, the
         * intensities partitioned at the start of each iteration and held, as areas, during its step (the classic
         * algorithm); it converges when chi^2 stops falling or every shift is below a tenth of its uncertainty, since a
         * re-partition moves chi^2 a little by itself. The background is held in the cycles at what the first stage
         * found: the partition hands every count under a reflection to it, so a background refined in the same cycles
         * can sink while the peaks broaden to take up the difference, a little more at every cycle.
         */
        var itTotal = 0, nStages = 1, msg = only ? 'evaluated at the current values' : 'iteration limit reached', a, b, j;
        function lm(stage, maxIter) {
            var cycle = stage === 'lebail', f = cost(apply(x), null), held = null, it, out = 'iteration limit reached';
            if (!(f < Infinity)) throw new Error('the model gives non-finite values at the start values');
            if (algorithm === 'pt' && opts.onIter) opts.onIter({it:itTotal, chi2:f, maxIter:progressTotal, stage:stage});
            var mu = 1e-3, nu = 2, conv = 0, NE2 = null, tol = problem.tol > 0 ? problem.tol : 1e-5;
            for (it = 0; it < maxIter; it++) {
                if (opts.shouldStop && opts.shouldStop()) { out = 'stopped'; break; }
                if (!NE2) { NE2 = normal(x); if (cycle) { held = NE2.held; f = NE2.f; } }
                var A = NE2.A, g = NE2.g, F = [];
                for (j = 0; j < nv; j++) {
                    if (cycle && (info[j].c.kind === 'bkg' || info[j].c.kind === 'bga')) continue;
                    var atLo = x[j] <= info[j].lo + 1e-12 * (1 + Math.abs(info[j].lo)), atHi = x[j] >= info[j].hi - 1e-12 * (1 + Math.abs(info[j].hi));
                    if (!((atLo && g[j] < 0) || (atHi && g[j] > 0)) && A[j * nv + j] > 0) F.push(j);
                }
                if (!F.length) { out = 'all refined parameters are at their limits, or have no effect'; break; }
                var nF = F.length, Mx = new Float64Array(nF * nF), bx = new Float64Array(nF), scales = F.map(function(q){return 1/Math.sqrt(A[q*nv+q]);});
                var grad = 0, noise = Math.sqrt(Math.max(f/Math.max(1,nPts-nv),1e-30));
                F.forEach(function(q,a){grad=Math.max(grad,Math.abs(g[q])*scales[a]/noise);});
                if(!cycle && (f < 1e-24 || grad < 1e-4)) { out='converged: projected gradient below tolerance'; break; }
                for (a = 0; a < nF; a++) {
                    bx[a] = g[F[a]]*scales[a];
                    for (b = 0; b < nF; b++) Mx[a * nF + b] = A[F[a] * nv + F[b]]*scales[a]*scales[b];
                    Mx[a * nF + a] += mu;
                }
                var dx = solveSPD(Mx, bx, nF);
                if (!dx) { mu *= nu; nu *= 2; if (mu > 1e30) { out = 'singular system: some refined parameters cannot be told apart'; break; } continue; }
                // Active coupled bounds (for sums of three or more occupancies).
                // Solve the damped Newton step on the active constraint faces;
                // this permits motion along a boundary rather than stopping there.
                var coupled=constraints && constraints.links.some(function(l){return l.terms.length>1;}), activeRows=[];
                if(coupled){
                    var currentValues=apply(x), faces=[];
                    constraints.links.forEach(function(l){
                        var value=currentValues[l.d][l.name],sign=value<=l.limits[0]+1e-9?-1:value>=l.limits[1]-1e-9?1:0;
                        if(!sign)return;var row=new Float64Array(nF);
                        l.terms.forEach(function(t){var i=F.indexOf(t[0]);if(i>=0)row[i]+=sign*t[1]*scales[i];});
                        if(row.some(function(v){return v!==0;}))faces.push(row);
                    });
                    var unconstrained=Float64Array.from(dx), ignored=[];
                    for(var ac=0;ac<4*faces.length+4;ac++){
                        dx=Float64Array.from(unconstrained);
                        var na=activeRows.length;
                        if(na){
                            var inverses=activeRows.map(function(i){return solveSPD(Mx,faces[i],nF);}),gram=new Float64Array(na*na),rr=new Float64Array(na);
                            for(a=0;a<na;a++){for(var qi=0;qi<nF;qi++)rr[a]+=faces[activeRows[a]][qi]*unconstrained[qi];for(b=0;b<na;b++)for(qi=0;qi<nF;qi++)gram[a*na+b]+=faces[activeRows[a]][qi]*inverses[b][qi];}
                            var multipliers=solveSPD(gram,rr,na);
                            if(!multipliers){ignored.push(activeRows.pop());continue;}
                            var negative=-1;for(a=0;a<na;a++)if(multipliers[a]<-1e-10){negative=a;break;}
                            if(negative>=0){activeRows.splice(negative,1);continue;}
                            for(a=0;a<na;a++)for(qi=0;qi<nF;qi++)dx[qi]-=inverses[a][qi]*multipliers[a];
                        }
                        var hit=-1;for(var fi=0;fi<faces.length;fi++){if(activeRows.indexOf(fi)>=0 || ignored.indexOf(fi)>=0)continue;var dot=0;for(a=0;a<nF;a++)dot+=faces[fi][a]*dx[a];if(dot>1e-12){hit=fi;break;}}
                        if(hit<0)break;activeRows.push(hit);
                    }
                }
                // shift limits per parameter (a relaxation of each shift, as in the classic Rietveld programs): one
                // parameter the data hardly constrain would otherwise shrink the whole step and stall all the others
                var xn = Float64Array.from(x), step = new Float64Array(nv);
                for (a = 0; a < nF; a++) {
                    var q = F[a], cap = stepCap(info[q].c, x[q]), sh = Math.max(-cap, Math.min(cap, dx[a]*scales[a]));
                    xn[q] = Math.min(info[q].hi, Math.max(info[q].lo, x[q] + sh)); step[q] = xn[q] - x[q];
                }
                if(coupled){
                    var capFactor=1;
                    for(a=0;a<nF;a++){var qq=F[a],shift=dx[a]*scales[a],capLim=stepCap(info[qq].c,x[qq]);if(shift)capFactor=Math.min(capFactor,capLim/Math.abs(shift),shift>0?(info[qq].hi-x[qq])/shift:(info[qq].lo-x[qq])/shift);}
                    for(a=0;a<nF;a++){qq=F[a];xn[qq]=x[qq]+Math.max(0,capFactor)*dx[a]*scales[a];step[qq]=xn[qq]-x[qq];}
                }
                if(constraints){
                    var alpha=1, old=apply(x), proposed=apply(xn);
                    constraints.links.forEach(function(l){var v=old[l.d][l.name],delta=proposed[l.d][l.name]-v;if(delta>0)alpha=Math.min(alpha,(l.limits[1]-v)/delta);else if(delta<0)alpha=Math.min(alpha,(l.limits[0]-v)/delta);});
                    if(alpha<1)for(a=0;a<nv;a++){xn[a]=x[a]+Math.max(0,alpha)*step[a];step[a]=xn[a]-x[a];}
                }
                var pred = 0, sAs = 0;
                for (a = 0; a < nv; a++) { if (!step[a]) continue; pred += 2 * g[a] * step[a]; var tt = 0; for (b = 0; b < nv; b++) tt += A[a * nv + b] * step[b]; sAs += step[a] * tt; }
                pred -= sAs;
                var fn = cost(apply(xn), cycle ? held : null);
                if (fn < f) {
                    var rho = pred > 0 ? (f - fn) / pred : 0.5, rel = (f - fn) / f, small = true;
                    {
                        var s2 = Math.max(f,1e-30) / Math.max(1, nPts - nv);
                        for (a = 0; a < nF; a++) { qq = F[a]; if (Math.abs(step[qq]) * Math.sqrt(A[qq * nv + qq] / s2) > 0.1) { small = false; break; } }
                    }
                    x = xn; f = fn; NE2 = null;
                    mu *= Math.max(1 / 3, 1 - Math.pow(2 * rho - 1, 3)); nu = 2;
                    itTotal++;
                    if (opts.onIter) opts.onIter({ it: itTotal, chi2: f, maxIter: progressTotal || maxIter * nStages, stage: stage });
                    if ((rel < tol && small) || (cycle && small)) { if (++conv >= 2) { out = 'converged: χ² change below the tolerance'; it++; break; } } else conv = 0;
                } else {
                    mu *= nu; nu *= 2;
                    if (mu > 1e20) { out = grad < 1e-3 ? 'converged: projected gradient below tolerance' : 'stalled: no improving LM step; inspect correlated parameters and limits'; break; }
                }
            }
            return out;
        }

        // Replica-exchange parallel tempering on chi²/2, before local LM.
        // Each replica uses symmetric random-walk proposals with reflecting box
        // bounds. Only the declared variables move; apply() keeps global/local
        // dataset sharing identical to the LM path. Best-so-far is never lost.
        var ptSetup = null;
        function preparePT() {
            if (ptSetup) return ptSetup;
            var config = problem.pt || {};
            var sweeps = config.sweeps == null ? 200 : config.sweeps;
            var chains = config.chains == null ? 6 : config.chains;
            var maxTemp = config.maxTemp == null ? 100 : config.maxTemp;
            var seed = config.seed == null ? 12345 : config.seed;
            if (!Number.isInteger(sweeps) || sweeps < 10 || sweeps > 100000 ||
                !Number.isInteger(chains) || chains < 2 || chains > 16 ||
                !Number.isFinite(maxTemp) || maxTemp <= 1 || maxTemp > 1e6 ||
                !Number.isInteger(seed) || seed < 1 || seed > 2147483647) throw new Error('invalid parallel-tempering settings');
            model.dynamicReflections = true;
            var initialCost = cost(apply(x), null);
            if (!Number.isFinite(initialCost)) throw new Error('non-finite starting cost for PT');
            var curvature = normal(x).A, scales = new Float64Array(nv);
            for (var q = 0; q < nv; q++) {
                var cap = stepCap(info[q].c, x[q]);
                var natural = Number.isFinite(cap) ? 0.15 * cap : 0.1 * Math.max(1, Math.abs(x[q]));
                var sensitivity = curvature[q * nv + q] > 0 ? 1 / Math.sqrt(curvature[q * nv + q]) : natural;
                scales[q] = Math.max(natural, Math.min(4 * natural, sensitivity), 1e-8);
            }
            ptSetup = { sweeps:sweeps, chains:chains, maxTemp:maxTemp, seed:seed, initialCost:initialCost, scales:scales };
            return ptSetup;
        }
        function temper(maxIt, stages) {
            var setup = preparePT(), sweeps = setup.sweeps, chains = setup.chains, maxTemp = setup.maxTemp, seed = setup.seed, scales = setup.scales;
            var randomState = seed >>> 0;
            function random() {
                randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
                return ((randomState >>> 0) + 0.5) / 4294967296;
            }
            function gaussian() { return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random()); }
            function reflect(value, low, high) {
                if (!Number.isFinite(value)) return NaN;
                if (Number.isFinite(low) && Number.isFinite(high)) {
                    var span = high - low;
                    if (!(span > 0)) return low;
                    var folded = ((value - low) % (2 * span) + 2 * span) % (2 * span);
                    return low + (folded <= span ? folded : 2 * span - folded);
                }
                if (value < low) return low + (low - value);
                if (value > high) return high - (value - high);
                return value;
            }
            var initialCost = setup.initialCost;
            var bestCost = initialCost, best = Float64Array.from(x), replicas = [], temperatures = [];
            for (var r = 0; r < chains; r++) {
                temperatures[r] = Math.pow(maxTemp, r / (chains - 1));
                replicas[r] = { x: Float64Array.from(x), cost: initialCost };
            }
            ptInfo = { backend:'cpu', chains: chains, sweeps: 0, requestedSweeps: sweeps, maxTemp: maxTemp, seed: seed,
                       proposals: 0, accepted: 0, swapAttempts: 0, swaps: 0, initialChi2: initialCost, bestChi2: initialCost };
            progressTotal = sweeps + maxIt * stages;
            for (var sweep = 0; sweep < sweeps; sweep++) {
                if (opts.shouldStop && opts.shouldStop()) { x = best; ptInfo.bestChi2 = bestCost; return false; }
                for (r = 0; r < chains; r++) {
                    if (opts.shouldStop && opts.shouldStop()) { x = best; ptInfo.bestChi2 = bestCost; return false; }
                    var replica = replicas[r], coordinate = Math.floor(random() * nv), proposal = Float64Array.from(replica.x);
                    proposal[coordinate] = reflect(proposal[coordinate] + gaussian() * scales[coordinate] * Math.sqrt(temperatures[r]), info[coordinate].lo, info[coordinate].hi);
                    if (!Number.isFinite(proposal[coordinate])) continue;
                    var candidateCost;
                    try { candidateCost = cost(apply(proposal), null); } catch (invalidTrial) { candidateCost = Infinity; }
                    ptInfo.proposals++;
                    if (Number.isFinite(candidateCost) &&
                        (candidateCost <= replica.cost || Math.log(random()) < (replica.cost - candidateCost) / (2 * temperatures[r]))) {
                        replica.x = proposal; replica.cost = candidateCost; ptInfo.accepted++;
                        if (candidateCost < bestCost) { bestCost = candidateCost; best = Float64Array.from(proposal); }
                    }
                }
                // Alternate disjoint adjacent pairs, preserving detailed balance.
                for (r = sweep % 2; r < chains - 1; r += 2) {
                    var left = replicas[r], right = replicas[r + 1];
                    var logAcceptance = 0.5 * (1 / temperatures[r] - 1 / temperatures[r + 1]) * (left.cost - right.cost);
                    ptInfo.swapAttempts++;
                    if (logAcceptance >= 0 || Math.log(random()) < logAcceptance) {
                        replicas[r] = right; replicas[r + 1] = left; ptInfo.swaps++;
                    }
                }
                ptInfo.sweeps++; itTotal++; ptInfo.bestChi2 = bestCost;
                if (opts.onIter) opts.onIter({ it: itTotal, chi2: bestCost, maxIter: progressTotal, stage: 'pt' });
            }
            x = best;
            return true;
        }

        if(!only && !nv)msg='converged: all ticked parameters are fixed by exact constraints';
        if (!only && nv) {
            var hasLB = model.phases.some(function (P) { return P.method === 'lebail'; }), maxIt = opts.maxIter || problem.maxIter || 20;
            nStages = hasLB ? 2 : 1;
            // a Le Bail fit starts as a WPPF one: variable projection is exact and does not need a good start, the
            // partition does -- from a poor cell or profile it extracts intensities at the wrong places and the
            // cycles can settle on a profile that only fits them. The cycles then take over from there.
            model.lbAsWppf = hasLB;
            // a linear start for the scales and the background (the model is linear in them): one Gauss-Newton step on
            // those alone, from the current values, before the full fit
            var lin = [];
            vars.forEach(function (vr, jj) { var k = info[jj].c.kind; if (k === 'scale' || k === 'bkg' || k === 'bga') lin.push(jj); });
            if (lin.length && opts.linearStart !== false) {
                var NE = normal(x, lin), nl = lin.length, M = new Float64Array(nl * nl), rhs = new Float64Array(nl);
                for (a = 0; a < nl; a++) { rhs[a] = NE.g[lin[a]]; for (b = 0; b < nl; b++) M[a * nl + b] = NE.A[lin[a] * nv + lin[b]]; }
                var dl = solveSPD(M, rhs, nl);
                if (dl) {
                    var xt = Float64Array.from(x);
                    for (a = 0; a < nl; a++) xt[lin[a]] = Math.min(info[lin[a]].hi, Math.max(info[lin[a]].lo, x[lin[a]] + dl[a]));
                    if (cost(apply(xt), null) < NE.f) x = xt;
                }
            }
            progressTotal = maxIt * nStages;
            var continueFit = true;
            if (algorithm === 'pt') {
                var setup = preparePT();
                var ptModel = model;
                var accelerated = yield { problem:problem, model:model, constraints:constraints, x:Float64Array.from(x), info:info, setup:setup,
                    apply:apply, cost:function (xv) { return cost(apply(xv), null, ptModel); },
                    shouldStop:opts.shouldStop, onIter:function (p) { if (opts.onIter) opts.onIter(p); }, maxIter:setup.sweeps+maxIt*nStages };
                if (accelerated && accelerated.x) {
                    var candidate = accelerated.x;
                    if (candidate.length !== nv || !Array.from(candidate).every(function(v,j){return Number.isFinite(v) && v>=info[j].lo && v<=info[j].hi;})) throw new Error('Invalid WebGPU PT result');
                    // Re-score on the CPU before the double-precision LM finish.
                    var checked = cost(apply(candidate), null);
                    if (!Number.isFinite(checked)) throw new Error('Non-finite WebGPU PT result');
                    if (checked <= setup.initialCost) x = Float64Array.from(candidate);
                    ptInfo = accelerated.pt; ptInfo.bestChi2 = Math.min(checked, setup.initialCost);
                    itTotal += ptInfo.sweeps; progressTotal = setup.sweeps + maxIt * nStages;
                    continueFit = !accelerated.stopped;
                } else {
                    // A failed GPU attempt may have populated the CPU validator's
                    // intensity caches. Restart PT with a fresh model and scales.
                    if (accelerated && accelerated.fallbackReason) {
                        model = new Model(Object.assign({}, problem, {values:apply(x)}));
                        model.lbAsWppf = hasLB; ptSetup = null;
                    }
                    continueFit = temper(maxIt, nStages);
                    if (accelerated && accelerated.fallbackReason) ptInfo.fallbackReason = accelerated.fallbackReason;
                }
            }
            if (algorithm === 'pt') {
                model = new Model(Object.assign({}, problem, {values:apply(x)}));
                model.lbAsWppf = hasLB;
            }
            msg = continueFit ? lm('vp', maxIt) : 'stopped';
            model.lbAsWppf = false;
            if (hasLB && msg !== 'stopped') {
                var m2 = lm('lebail', maxIt);
                msg = m2 === 'iteration limit reached' && /^converged/.test(msg) ? 'Le Bail cycles: iteration limit reached' : m2;
            }
        }
        var it = itTotal;

        // standard uncertainties from the normal matrix at the solution, scaled by the reduced chi^2 (the intensities
        // of Le Bail and WPPF phases counted among the parameters)
        var fin = normal(x, null, true, true), nInt = 0;
        fin.evs.forEach(function (ev) { nInt += intensityCount(ev); });
        var dof = Math.max(1, nPts - nv - nInt), chi2red = fin.f / dof, esdX = new Float64Array(nv).fill(NaN), idxE = [], inactive = [], onBounds = [], inv = null;
        for (j = 0; j < nv; j++) {
            var onB = x[j] <= info[j].lo + 1e-9 * (1 + Math.abs(info[j].lo)) || x[j] >= info[j].hi - 1e-9 * (1 + Math.abs(info[j].hi));
            onBounds[j]=onB;
            if (!onB) { if(fin.A[j * nv + j] > 0)idxE.push(j);else inactive.push(j); }
        }
        var ne = idxE.length, Ms = new Float64Array(ne * ne);
        if (ne) {
            for (a = 0; a < ne; a++) for (b = 0; b < ne; b++) Ms[a * ne + b] = fin.A[idxE[a] * nv + idxE[b]];
            inv = invSPD(Ms, ne);
            if (inv) for (a = 0; a < ne; a++) { var vv = chi2red * inv[a * ne + a]; if (vv >= 0) esdX[idxE[a]] = Math.sqrt(vv); }
        }
        var outVals = apply(x), esd = model.datasets.map(function () { return {}; }), uncertaintyIssues = model.datasets.map(function(){return {};});
        var fitWarnings=model.datasets.map(function(_,d){return instrumentProfileWarnings(model,d,outVals[d]);}), dependentIssues={};
        function variableLabel(jj){return vars[jj].name+(nd>1?(info[jj].ds.length>1?' (shared)':' (dataset '+(info[jj].ds[0]+1)+')'):'');}
        if(!inv && ne){
            var dependence=normalDependence(Ms,ne), diagnostics=[];
            dependence.groups.forEach(function(group){
                var slots=group.map(function(i){return idxE[i];}), message='Cannot distinguish the combined effects of '+slots.map(variableLabel).join(', ')+'. Fix redundant variables or supply independent calibration/data.';
                slots.forEach(function(jj){dependentIssues[jj]=message;});
                if(diagnostics.indexOf(message)<0)diagnostics.push(message);
            });
            var headline='Joint uncertainties unavailable: singular or ill-conditioned refinement'+(diagnostics.length?' ('+dependence.rank+' independent directions among '+ne+' interior variables).':'.');
            fitWarnings.forEach(function(w){w.push(headline);diagnostics.slice(0,8).forEach(function(s){w.push(s);});if(diagnostics.length>8)w.push((diagnostics.length-8)+' additional dependent combinations.');});
        }
        inactive.forEach(function(jj){info[jj].ds.forEach(function(d){fitWarnings[d].push(variableLabel(jj)+' has no measurable effect at the current values (zero derivative). Hold it fixed or check the model and width floor.');});});
        vars.forEach(function (vr, jj) { info[jj].ds.forEach(function (d) {
            var e=esdX[jj], c=info[jj].c;
            if(c.kind==='atom' && /^[xyz]$/.test(c.comp) && e>=0.5){uncertaintyIssues[d][vr.name]='Coordinate is not constrained within half a unit cell';e=NaN;}
            else if(!Number.isFinite(e) && !onBounds[jj])uncertaintyIssues[d][vr.name]=inactive.indexOf(jj)>=0?'Uncertainty unavailable: this variable has zero derivative at the current values.':dependentIssues[jj] || 'Joint covariance unavailable because other refined variables cannot be distinguished; this does not establish that this parameter is unconstrained.';
            esd[d][vr.name]=e;
        }); });
        if(constraints)constraints.links.forEach(function(l){
            var variance=0,available=true;
            l.terms.forEach(function(t){var a=idxE.indexOf(t[0]);if(a<0){available=false;return;}l.terms.forEach(function(u){var b=idxE.indexOf(u[0]);if(b<0)available=false;else if(inv)variance+=t[1]*u[1]*inv[a*ne+b]*chi2red;else available=false;});});
            var value=outVals[l.d][l.name],bound=l.terms.length && (Number.isFinite(l.limits[0]) && value<=l.limits[0]+1e-9 || Number.isFinite(l.limits[1]) && value>=l.limits[1]-1e-9);
            var e=available && !bound?Math.sqrt(Math.max(0,variance)):NaN;
            if(classify(l.name).kind==='atom' && /^[xyz]$/.test(classify(l.name).comp) && e>=0.5)e=NaN;
            esd[l.d][l.name]=e;if(!Number.isFinite(e))uncertaintyIssues[l.d][l.name]='Dependent uncertainty unavailable: singular, bounded or ill-conditioned independent variables';
        });
        var posE = {};
        idxE.forEach(function (jj, e) { posE[jj] = e; });
        var precision = null;
        var stats = [], intensities = [];
        model.datasets.forEach(function (D, d) {
            var ev = fin.evs[d], nPar = intensityCount(ev);
            for (var j2 = 0; j2 < nv; j2++) if (info[j2].ds.indexOf(d) >= 0) nPar++;
            var st = datasetStats(D, ev, nPar);
            st.phases.forEach(function (p) { delete p.Iobs; });
            st.nInt = intensityCount(ev); st.nPar = nPar;
            stats.push(st);
            var slots = [];
            if (inv && ev.ws) fin.projs[d].idx.forEach(function (jj) {
                var pr = fin.projs[d].p[vars[jj].name];
                if (pr && posE[jj] != null) slots.push({ e: posE[jj], z: pr.z, b: pr.b });
            });
            var cov = inv ? { inv: inv, ne: ne, S: Ms, slots: slots } : null;
            intensities.push(intensityTables(ev, chi2red, cov, D));
            if (opts.precision && opts.precision.dataset === d) {
                precision = precisionBlock(ev, opts.precision.phase, opts.precision.maxRefl, cov);
                if (precision) precision.s2 = chi2red;
            }
        });
        return { ok: true, algorithm: only ? 'evaluate' : algorithm, effectiveAlgorithm: only ? 'evaluate' : algorithm === 'pt' ? 'pt+lm' : 'lm', pt: ptInfo, msg: msg, iter: it, chi2: fin.f, chi2red: chi2red, dof: dof, nPts: nPts, nVar: nv, nInt: nInt,
                 constraintWarnings:constraints ? constraints.warnings : [], constraintNames:constraints ? constraints.names : [], values: outVals, esd: esd, covarianceOK:!nv || !!inv && !inactive.length, uncertaintyIssues:uncertaintyIssues, fitWarnings:fitWarnings, stats: stats, intensities: intensities, precision: precision, ms: Date.now() - t0 };
    } catch (e) {
        if (opts.rethrow) throw e;
        return { ok: false, msg: String((e && e.message) || e), ms: Date.now() - t0 };
    }
}

// The synchronous entry point remains available to plots, Node and CPU-only callers.
// Only the worker's async entry point awaits GPU dispatch/readback at the PT boundary.
function refine(problem, opts) {
    var run = refineSteps(problem, opts), step = run.next();
    while (!step.done) step = run.next();
    return step.value;
}
async function refineAsync(problem, opts) {
    opts = opts || {};
    var run = refineSteps(problem, opts), step = run.next();
    while (!step.done) {
        var accelerated = null;
        try {
            var backend = opts.ptBackend || (root.RVPTGPU && root.RVPTGPU.run);
            if (backend) accelerated = await backend(step.value);
            else accelerated = { fallbackReason:'WebGPU PT module is unavailable.' };
        } catch (e) { accelerated = { fallbackReason:String(e && e.message || e) }; }
        step = run.next(accelerated);
    }
    return step.value;
}

/**
 * The calculated pattern of one dataset, with everything a plot or a table
 * needs. The intensities of Le Bail and WPPF phases are extracted at these
 * values, with uncertainties conditional on them (a fit gives marginal ones).
 */
function evaluate(problem, di) {
    if((problem.parameterLinks || []).length || problem.phases.some(function(p){return p.method==='rietveld' && p.constraints && p.constraints.length;})){
        if(typeof AtomicConstraints==='undefined')throw new Error('Atomic constraint module is not loaded.');
        problem=Object.assign({},problem,{values:AtomicConstraints.prepare(problem).values});
    }
    var model = new Model(problem), d = di || 0, v = problem.values[d], ev = model.evalDataset(d, v);
    var D = model.datasets[d], nInt = intensityCount(ev), st = datasetStats(D, ev, nInt);
    var s2 = st.n > nInt ? st.chi2 / (st.n - nInt) : 1, tables = intensityTables(ev, s2, null, D);
    return {
        tth: D.def.tth, yobs: D.def.y, ycalc: ev.y, bkg: ev.bkg, stats: st, nInt: nInt,
        phases: ev.phases.map(function (ph, pi) {
            var t = tables[pi];
            return { y: ph.y, cell: ph.geo.cell, method: ph.method,
                     refl: ph.geo.hkl.map(function (R, k) {
                         return { h: R.h, k: R.k, l: R.l, m: R.m, d: R.d, tth: R.tth + (v.zero || 0), F2: ph.st ? ph.st.F2[k] : NaN, height: ph.height[k],
                                  Icalc: ph.area[k], Iobs: st.phases[pi].Iobs[k], inRange: !!ph.cols[k],
                                  sigma: t ? t.sigma[k] : NaN, Iext: t && ph.method === 'lebail' ? t.obs[k] : (t ? t.area[k] : NaN),
                                  bound: t ? !!t.bound[k] : false, group: t ? t.group[k] : -1, K: ph.K[k], lp: ph.lp[k] };
                     }) };
        })
    };
}

root.RVCore = {
    VERSION: VERSION, METHODS: METHODS, METHOD_LABELS: METHOD_LABELS, expandOps: expandOps, cosets: cosets, laueRotations: laueRotations, isAllowed: isAllowed,
    cellParams: cellParams, cellOf: cellOf, generateReflections: generateReflections, siteSymmetry: siteSymmetry,
    sitePosition: sitePosition, formFactor: formFactor, profileParamsFor: profileParamsFor, INSTRUMENT_PROFILE: INSTRUMENT_PROFILE, INSTRUMENT_PROFILE_TYPES:INSTRUMENT_PROFILE_TYPES, ALL_INSTRUMENT_PROFILE: ALL_INSTRUMENT_PROFILE, instrumentProfileParams: instrumentProfileParams, usesSeparatedProfile: usesSeparatedProfile, SAMPLE_PROFILE: SAMPLE_PROFILE, broadeningConfig: broadeningConfig, sampleProfileNames: sampleProfileNames, PROFILE_PARAMS: PROFILE_PARAMS, PROFILE_LABELS: PROFILE_LABELS,
    classify: classify, defaultLimits: defaultLimits, methodAllows: methodAllows, Model: Model, refine: refine, refineAsync:refineAsync, evaluate: evaluate,
    datasetStats: datasetStats, solveSPD: solveSPD, invSPD: invSPD, normalDependence:normalDependence, fracText: fracText, splineValues: splineValues, MAX_PRECISION_REFLECTIONS:MAX_PRECISION_REFLECTIONS,
    selectedInverse: selectedInverse
};
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
