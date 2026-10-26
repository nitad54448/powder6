// Updated for Powder 5 version 179, 5 October 2026.
const SHARKO_OBSERVATIONS_VERSION = '1.1.1';

/* ------------------------------------------------------------------
   Observation preparation for the Wyckoff structure search.

   Everything the correlation fitness needs reduces to two numbers per
   reflection: |Fo|^2 and the powder multiplicity m. How those are obtained
   depends on what the file happened to carry, and the routes are NOT
   interchangeable - applying a correction twice is as wrong as not applying
   it, and both look like a plausible number.

   The route that matters most here is the last one. A file with nothing but
   h k l, d and an intensity is fully usable: m follows from the Laue group,
   which is always known because the space group is, and Lp follows from d and
   the wavelength, which the user supplies in the UI. Measured against a file
   that states both columns explicitly, the reconstruction recovers m exactly
   for all 282 reflections and Lp to 0.067% - the residual being the refined
   zero shift, which no reconstruction can know about. The resulting fitness
   agreed to four decimal places.

   So the only genuinely unrecoverable case is a missing wavelength, which is
   worth a prompt rather than a silent degradation into a map dominated by its
   low-angle reflections.
   ------------------------------------------------------------------ */

/**
 * Powder multiplicity: the orbit size of a reflection under the Laue group.
 *
 * Friedel's law is included, so (h,k,l) and (-h,-k,-l) count once. Pass the
 * ROTATION parts of the space-group operators; the translations are irrelevant
 * to which reflections are equivalent in magnitude.
 */
function powderMultiplicity(h, k, l, rotations) {
    const seen = new Set();
    for (const r of rotations) {
        const H = h * r[0] + k * r[3] + l * r[6];
        const K = h * r[1] + k * r[4] + l * r[7];
        const L = h * r[2] + k * r[5] + l * r[8];
        seen.add(`${H},${K},${L}`);
        seen.add(`${-H},${-K},${-L}`);
    }
    return seen.size;
}

/** 2-theta in degrees from a d-spacing, or null beyond the Ewald limit. */
function twoThetaFromD(d, lambda) {
    if (!(d > 0) || !(lambda > 0)) return null;
    const st = lambda / (2 * d);
    if (st >= 1) return null;             // d < lambda/2 cannot diffract
    return 2 * Math.asin(st) * 180 / Math.PI;
}

/**
 * Lp from 2-theta and the polarisation RATIO K.
 *
 * The canonical implementation lives in crystal.js, which every entry point
 * loads before this file. This is a thin resolver, DELIBERATELY UNDER A
 * DIFFERENT NAME: declaring `sharkoLorentzPolarization` here too would
 * overwrite crystal.js's global, since both are classic scripts sharing one
 * scope and the later declaration wins - so the "delegation" would quietly
 * become a second implementation again, which is the problem this is meant to
 * end. The local body is only reached by a standalone `node observations.js`
 * unit test, where crystal.js was never loaded.
 *
 * NOTE THE ARGUMENT. This takes K, a number, not a polarisation descriptor.
 * normaliseObservations() has already resolved K by the time it gets here, and
 * for a neutron pattern that K is 0. Handing 0 to a descriptor-taking Lp
 * function instead would see it read as a monochromator angle and fall back to
 * K = 1, correcting a neutron dataset as though it came off an X-ray tube - a
 * smooth error reaching 50% at 90 degrees that looks like a temperature factor.
 */
function obsLorentzPolarization(tthDeg, K) {
    // THE LAST COPY OF THE Lp ARITHMETIC IN THIS PROGRAM USED TO BE HERE.
    //
    // It sat behind a `typeof sharkoLorentzPolarization === 'function'` guard
    // as a fallback, and the guard never failed: crystal.js is loaded before
    // this file by the page and by every worker's importScripts, so the branch
    // below it was unreachable. What it was, in practice, was a second
    // implementation of the formula that nothing exercised and no test would
    // ever have caught drifting -- which is exactly how the two copies of
    // cfErfc came to differ by a digit for who knows how long.
    //
    // If crystal.js is genuinely absent the honest outcome is a
    // ReferenceError naming the missing module, not a silent second opinion.
    return sharkoLorentzPolarization(tthDeg, K);
}

/**
 * Reduces a reflection list to |Fo|^2 and m by whichever route the data allows.
 *
 * @param reflections  parsed rows: {h,k,l} plus any of d, twoTheta, multiplicity,
 *                     lp, Ihkl, Fo, sigma
 * @param opts.rotations   rotation parts of the space-group operators (required
 *                         whenever the file does not state m)
 * @param opts.wavelength  Angstrom, from the UI. Required when the file states
 *                         neither |Fo| nor 2theta.
 * @param opts.polarisationK  1 for an unpolarised lab tube, 0 for neutron
 * @param opts.radiation   'xray' | 'neutron'
 *
 * @returns {{rows, route, warnings, errors}} rows carry Fo2, mult, d, twoTheta
 */
function normaliseObservations(reflections, opts = {}) {
    const rotations = opts.rotations || null;
    const lambda = Number(opts.wavelength);
    const radiation = opts.radiation || 'xray';
    // A neutron beam is unpolarised and there is no polarisation factor at all;
    // forcing K = 0 gives P = 1 rather than the 0.5-to-1 ramp an X-ray tube has.
    const K = radiation === 'neutron' ? 0
            : (Number.isFinite(opts.polarisationK) ? opts.polarisationK : 1);

    const warnings = [], errors = [];
    const src = reflections.filter(r => Number.isFinite(r.h) && Number.isFinite(r.k) &&
                                        Number.isFinite(r.l) && (r.h || r.k || r.l));
    if (!src.length) { errors.push('No usable reflections.'); return { rows: [], route: null, warnings, errors }; }

    const has = f => src.every(r => Number.isFinite(r[f]));
    const haveFo   = has('Fo');
    const haveM    = src.every(r => Number.isFinite(r.multiplicity) && r.multiplicity > 0);
    const haveLp   = src.every(r => Number.isFinite(r.lp) && r.lp > 0);
    const haveI    = has('Ihkl');
    const haveTth  = has('twoTheta');

    // d and 2theta are interconvertible given the wavelength, so fill whichever
    // is missing before choosing a route. This is what makes a file carrying
    // only d as good as one carrying 2theta.
    let derivedTth = 0, derivedD = 0;
    if (Number.isFinite(lambda) && lambda > 0) {
        for (const r of src) {
            if (!Number.isFinite(r.twoTheta) && Number.isFinite(r.d)) {
                const t = twoThetaFromD(r.d, lambda);
                if (t !== null) { r._tth = t; derivedTth++; }
            } else if (Number.isFinite(r.twoTheta) && !Number.isFinite(r.d)) {
                const th = 0.5 * r.twoTheta * Math.PI / 180;
                const s = Math.sin(th);
                if (s > 1e-9) { r._d = lambda / (2 * s); derivedD++; }
            }
        }
    }
    const tthOf = r => Number.isFinite(r.twoTheta) ? r.twoTheta : r._tth;
    const dOf   = r => Number.isFinite(r.d) ? r.d : r._d;
    const anyTth = src.every(r => Number.isFinite(tthOf(r)));

    // Multiplicity: the file's own value is authoritative, because it is what
    // the extraction assumed. Only compute it when the file is silent.
    let multSource = 'file';
    if (!haveM) {
        if (!rotations || !rotations.length) {
            errors.push('The file does not state the powder multiplicity and no symmetry ' +
                        'operators were supplied, so it cannot be reconstructed.');
            return { rows: [], route: null, warnings, errors };
        }
        multSource = 'computed';
        for (const r of src) r._mult = powderMultiplicity(r.h, r.k, r.l, rotations);
    }
    const multOf = r => haveM ? r.multiplicity : r._mult;

    let route, lpSource = 'n/a';
    const rows = [];

    if (haveFo) {
        // Powder 5 removed m and Lp itself, at full precision from the refined
        // 2theta including the zero shift. Nothing further is divided out.
        route = 'Fo';
        for (const r of src) rows.push({ h: r.h, k: r.k, l: r.l, Fo2: r.Fo * r.Fo,
                                         mult: multOf(r), d: dOf(r), twoTheta: tthOf(r),
                                         sigma: r.sigma });
    } else if (haveM && haveLp && haveI) {
        route = 'm_lp';
        for (const r of src) {
            // SIGMA IS SCALED WITH THE VALUE IT BELONGS TO.
            //
            // Fo2 is divided by (m * Lp) and sigma was carried across
            // untouched, so the two ended up in different units: an intensity
            // reduced by a factor of forty sat beside an uncertainty that had
            // not moved. Any weight built from them would have been wrong by
            // that factor, and wrong by a DIFFERENT factor for every
            // reflection, since Lp varies with angle.
            const k = r.multiplicity * r.lp;
            rows.push({ h: r.h, k: r.k, l: r.l,
                        Fo2: r.Ihkl / k,
                        mult: r.multiplicity, d: dOf(r), twoTheta: tthOf(r),
                        sigma: (Number.isFinite(r.sigma) && k > 0) ? r.sigma / k : r.sigma });
        }
    } else if (haveI && anyTth) {
        // The reconstruction route. Lp from the stated model, m from the Laue
        // group. Verified against a file carrying both columns: m exact,
        // Lp to 0.067%.
        route = (haveTth ? 'lp_from_2theta' : 'lp_from_d');
        lpSource = 'computed';
        if (!haveTth && !(lambda > 0)) {
            errors.push('This file gives d but not 2theta, so the wavelength is needed ' +
                        'to remove the Lorentz-polarisation factor. Enter it in the UI.');
            return { rows: [], route: null, warnings, errors };
        }
        for (const r of src) {
            const tth = tthOf(r);
            // sigma scaled with its value, as in the m_lp route above
            const lp = obsLorentzPolarization(tth, K), k = multOf(r) * lp;
            rows.push({ h: r.h, k: r.k, l: r.l, Fo2: r.Ihkl / k,
                        mult: multOf(r), d: dOf(r), twoTheta: tth,
                        sigma: (Number.isFinite(r.sigma) && k > 0) ? r.sigma / k : r.sigma });
        }
    } else if (haveI) {
        route = 'raw';
        for (const r of src) rows.push({ h: r.h, k: r.k, l: r.l, Fo2: r.Ihkl,
                                         mult: multOf(r), d: dOf(r), twoTheta: tthOf(r),
                                         sigma: r.sigma });
        warnings.push('Neither |Fo|, 2theta nor a wavelength is available, so the ' +
                      'Lorentz-polarisation factor could not be removed. The fitness will be ' +
                      'dominated by the low-angle reflections and the search may converge on a ' +
                      'structure that fits only those.');
    } else {
        errors.push('The reflection list carries no intensity column.');
        return { rows: [], route: null, warnings, errors };
    }

    // COVARIANCES OF OVERLAPPED INTENSITIES ([h, k, l, cov] on the intensity
    // scale, from the WPPF fit), scaled into Fo2 units with BOTH reflections'
    // factors, as sigma is with its own. Rows follow src one to one. The Fo route
    // carries no intensity scale to apply, so it carries no covariances.
    if (route !== 'Fo') {
        const scaleOf = new Map();
        rows.forEach((row, i) => {
            const r = src[i], f = route === 'raw' ? 1
                    : route === 'm_lp' ? 1 / (r.multiplicity * r.lp)
                    : 1 / (multOf(r) * obsLorentzPolarization(tthOf(r), K));
            scaleOf.set(row.h + ',' + row.k + ',' + row.l, f);
        });
        rows.forEach((row, i) => {
            const c = src[i].cov, fi = scaleOf.get(row.h + ',' + row.k + ',' + row.l);
            if (!Array.isArray(c) || !c.length || !Number.isFinite(fi)) return;
            row.cov = c.map(p => { const fj = scaleOf.get(p[0] + ',' + p[1] + ',' + p[2]); return Number.isFinite(fj) && Number.isFinite(p[3]) ? [p[0], p[1], p[2], p[3] * fi * fj] : null; })
                       .filter(Boolean);
        });
    }

    const bad = rows.filter(r => !Number.isFinite(r.Fo2) || !(r.d > 0));
    if (bad.length) {
        warnings.push(`${bad.length} reflection(s) dropped: no finite intensity or d-spacing.`);
    }
    const clean = rows.filter(r => Number.isFinite(r.Fo2) && r.d > 0);
    if (!clean.length) { errors.push('No reflections survived normalisation.'); }

    if (derivedTth) warnings.push(`2theta derived from d for ${derivedTth} reflection(s) at lambda = ${lambda} A.`);
    if (multSource === 'computed') warnings.push('Powder multiplicities computed from the Laue group.');

    return { rows: clean, route, multSource, lpSource, warnings, errors,
             dMin: Math.min(...clean.map(r => r.d)), dMax: Math.max(...clean.map(r => r.d)) };
}

/**
 * Overall temperature factor from a Wilson plot.
 *
 * B is worth 0.31 in correlation on real PbSO4 data - 0.65 at B = 0 against
 * 0.97 at the optimum - so it is not optional. But it is also structure
 * independent: <|F|^2> over a shell depends only on the cell contents, so B
 * can be fixed once from the data and the composition before any search runs,
 * and never touched again.
 *
 *     ln( <Fo^2> / sum_j f_j(s)^2 )  =  ln K  -  2 B s^2/4
 *
 * The slope against (s/2)^2 gives -2B. Shells with too few reflections or a
 * non-positive mean are skipped rather than allowed to drag the fit.
 *
 * @param rows      from normaliseObservations()
 * @param demand    [{element, z, count}] - the cell contents
 * @param formFactor  (element, s) -> f, from scatterers.js. Falls back to Z.
 */
function wilsonB(rows, demand, formFactor, options = {}) {
    const nShells = options.shells ?? 10;
    const minPer = options.minPerShell ?? 5;

    const s = rows.map(r => 1 / r.d);
    const smin = Math.min(...s), smax = Math.max(...s);
    const span = Math.max(1e-9, smax - smin);

    const sumI = new Float64Array(nShells), sumS = new Float64Array(nShells);
    const cnt = new Int32Array(nShells);
    for (let i = 0; i < rows.length; i++) {
        const b = Math.min(nShells - 1, Math.floor((s[i] - smin) / span * nShells));
        sumI[b] += rows[i].Fo2; sumS[b] += s[i]; cnt[b]++;
    }

    const xs = [], ys = [];
    for (let b = 0; b < nShells; b++) {
        if (cnt[b] < minPer) continue;
        const sBar = sumS[b] / cnt[b];
        const meanI = sumI[b] / cnt[b];
        if (!(meanI > 0)) continue;
        let sigF2 = 0;
        for (const dmd of demand) {
            let f = formFactor ? formFactor(dmd.element, sBar) : null;
            if (!Number.isFinite(f)) f = dmd.z;
            sigF2 += dmd.count * f * f;
        }
        if (!(sigF2 > 0)) continue;
        const stol2 = (sBar / 2) * (sBar / 2);
        xs.push(stol2);
        ys.push(Math.log(meanI / sigF2));
    }

    if (xs.length < 3) {
        return { B: 0, scale: 1, ok: false,
                 note: `Only ${xs.length} usable shell(s); B left at 0. ` +
                       `A wrong B lowers the peak correlation but barely moves where it is, ` +
                       `so this degrades the search rather than breaking it.` };
    }

    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < xs.length; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const n = xs.length;
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return { B: 0, scale: 1, ok: false, note: 'Degenerate Wilson fit.' };
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;

    // slope = -2B. A negative B would mean intensity RISING with angle, which
    // is unphysical for a static structure and usually means the data has been
    // sharpened already or the corrections were applied twice. Clamp and say so.
    let B = -slope / 2;
    let note = null;
    if (!(B > 0)) {
        note = `The Wilson slope gives B = ${B.toFixed(2)}, which is unphysical. ` +
               `Intensity rising with angle usually means Lp or a sharpening was applied twice. ` +
               `B has been clamped to 0.`;
        B = 0;
    } else if (B > 20) {
        note = `B = ${B.toFixed(1)} is very high; check that Lp was removed.`;
    }
    return { B, scale: Math.exp(intercept), ok: true, shells: n, note };
}

/**
 * Variance of a group's observed intensity, sum(mult * Fo2) over its members.
 *
 * The members' variances add, AND twice their covariances: overlapped WPPF
 * intensities are strongly anti-correlated (what one takes the other cannot),
 * so the sum is far better determined than the independent sum of variances
 * says, and ignoring that under-weights exactly the overlapped groups. A
 * member's cov holds [h, k, l, cov(Fo2, Fo2')] for partners, each pair once
 * (normaliseObservations). Without covariances this is the independent sum.
 *
 * Shared by swPackReflections (the search) and crGroupReflections (the
 * coordinate refinement) so the two weight the same residual.
 *
 * @param {Array} members rows with mult, sigma (of Fo2), optional cov
 * @returns {number|null} null when a member has no usable sigma
 */
function obsGroupVariance(members) {
    let v = 0;
    const byHkl = new Map();
    for (const r of members) {
        if (!(Number.isFinite(r.sigma) && r.sigma > 0)) return null;
        const sm = r.mult * r.sigma;
        v += sm * sm;
        byHkl.set(r.h + ',' + r.k + ',' + r.l, r);
    }
    if (!(v > 0)) return null;
    let c = 0;
    if (members.length > 1) for (const r of members) {
        if (!Array.isArray(r.cov)) continue;
        for (const p of r.cov) {
            const o = byHkl.get(p[0] + ',' + p[1] + ',' + p[2]);
            if (o && o !== r && Number.isFinite(p[3])) c += 2 * r.mult * o.mult * p[3];
        }
    }
    // a covariance that rounding or a French-Wilson value pushed past positive
    // definiteness is floored, rather than giving one group an unbounded weight
    return Math.max(v + c, 1e-3 * v);
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SHARKO_OBSERVATIONS_VERSION, powderMultiplicity, twoThetaFromD,
                       obsLorentzPolarization, normaliseObservations,
                       wilsonB, obsGroupVariance };
}
