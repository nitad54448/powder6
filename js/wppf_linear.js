// wppf_linear.js
// version 1, replaces the "2500 intensities are ordinary LM parameters" model.
// ---------------------------------------------------------------------------
//  SEPARABLE (VARIABLE-PROJECTION) WPPF
//
//  A WPPF model is
//
//      y(x) = SUM_j I_j * phi_j(x; theta) + b(x; beta)
//
//  and it is LINEAR in every I_j. Refining the intensities as ordinary
//  Levenberg-Marquardt parameters therefore throws away the one structural
//  fact that makes the problem tractable:
//
//    * LM crawls towards an answer that a single linear solve gives exactly.
//      With ~2500 reflections and a polish capped at 40 iterations, it never
//      arrives -- the reported fit is a partially converged one.
//    * Every derived quantity (lambda, the trust region, the convergence
//      test) is dominated by 2500 parameters that did not need iterating.
//    * Parallel tempering becomes meaningless: with one random scalar per
//      replica per iteration, the expected number of proposals per parameter
//      is maxIter * nReplicas / nParams. At 200 x 8 / 2525 that is 0.63 --
//      most intensities are never proposed even once, so PT spends the whole
//      time budget doing nothing while looking busy.
//
//  Instead: for any given theta (cell, zero-point, profile) and background,
//  solve for I EXACTLY, then let LM or PT search only theta. That is
//  variable projection (Golub & Pereyra 1973). The reduced objective
//
//      C(theta) = || sqrt(W) (y - b - Phi(theta) * Ihat(theta)) ||^2
//
//  has the same minimiser in theta as the full problem and a search space of
//  ~12-30 dimensions instead of ~2500.
//
//  THE NORMAL MATRIX IS BANDED. Phi^T W Phi has a non-zero entry at (j,k)
//  exactly when reflections j and k have overlapping profile windows. With
//  the reflection list sorted by 2-theta -- which generateMasterHklList
//  guarantees -- that is a narrow skyline, so the exact solve costs
//  O(n * band^2), not O(n^3), and the whole matrix is stored in O(n * band).
//
//  Loading:  browser  script src="js/wppf_linear.js"   (after profile.js)
//            worker   importScripts('wppf_linear.js')  (after profile.js)
//            node     require('./wppf_linear.js')
// ---------------------------------------------------------------------------

'use strict';

// ===========================================================================
//  1. Skyline symmetric positive-definite solver
// ===========================================================================

/**
 * Packed skyline (variable-band) storage for a symmetric matrix.
 *
 * Row i holds columns [first[i], i] contiguously at ptr[i]. This is the exact
 * storage the Cholesky factor needs: the profile/skyline theorem says L has
 * the same envelope as A, so no fill-in escapes it and no zero outside it is
 * ever touched.
 *
 * The n x n dense form of the same matrix would be 50 MB at n = 2500 -- and
 * refineParametersLM allocated one PER ITERATION. This is O(n * band):
 * ~200 kB for the same problem, allocated once.
 */
class SkylineMatrix {
    /** @param {Int32Array|number[]} first first[i] = lowest column in row i. */
    constructor(first) {
        const n = first.length;
        this.n = n;
        this.first = first;
        const ptr = new Int32Array(n + 1);
        let total = 0;
        for (let i = 0; i < n; i++) { ptr[i] = total; total += i - first[i] + 1; }
        ptr[n] = total;
        this.ptr = ptr;
        this.a = new Float64Array(total);
    }
    /** @returns {number} Flat index of (i,j), j <= i, or -1 if outside the envelope. */
    idx(i, j) {
        const f = this.first[i];
        return (j < f || j > i) ? -1 : this.ptr[i] + (j - f);
    }
    get(i, j) { const k = this.idx(i, j); return k < 0 ? 0 : this.a[k]; }
    add(i, j, v) { const k = this.idx(i, j); if (k >= 0) this.a[k] += v; }
    set(i, j, v) { const k = this.idx(i, j); if (k >= 0) this.a[k] = v; }
    zero() { this.a.fill(0); }
    /** @returns {number} Bytes of the packed store. */
    get bytes() { return this.a.byteLength; }
}

/**
 * In-place MODIFIED skyline Cholesky, A + E = L L^T, writing L over A.
 *
 * @param {Float64Array} a Packed store (mutated).
 * @param {Int32Array} first
 * @param {Int32Array} ptr
 * @param {number} n
 * @param {number[]} [repairedOut] Collects the indices of repaired pivots.
 * @returns {boolean} False only if a non-finite entry was encountered, which
 *          means the matrix is corrupt rather than merely rank-deficient.
 */
function skylineCholeskyInPlace(a, first, ptr, n, repairedOut, strict = false) {
    for (let i = 0; i < n; i++) {
        const fi = first[i], pi = ptr[i];
        for (let j = fi; j <= i; j++) {
            const fj = first[j], pj = ptr[j];
            let s = a[pi + (j - fi)];
            if (!isFinite(s)) return false;
            const k0 = fi > fj ? fi : fj;
            for (let k = k0; k < j; k++) s -= a[pi + (k - fi)] * a[pj + (k - fj)];
            if (i === j) {
                const orig = Math.abs(a[pi + (j - fi)]);
                // RELATIVE TO THE PIVOT'S OWN DIAGONAL, AND AT THE REPAIR VALUE.
                // The floor was 1e-14 * max(1, orig): absolute whenever the
                // diagonal is below 1, which it is with 1/y weights, so it
                // depended on the units of the weights. Worse, it accepted
                // pivots between 1e-14 and 1e-8 of their diagonal -- columns
                // all but identical to the earlier ones -- whose tiny square
                // roots multiply the rounding by up to 1e7 in every later row:
                // the next Schur complements came out negative, were repaired,
                // and the factor grew to 1e198 and overflowed. A triclinic
                // pattern whose last reflections are cut by the end of the
                // range did exactly that, every WPPF solve failed, and the fit
                // carried zero intensities. A pivot at or below the repair
                // value (normal equations square the condition number, so this
                // is a column correlated to better than 1 - 5e-9) is a
                // dependency and is repaired.
                const floor = strict ? 0 : orig > 0 ? WPPF_PIVOT_REPAIR * orig : 0;
                if (!(s > floor)) {
                    if(strict)return false;
                    // MODIFIED CHOLESKY (Gill-Murray). The pivot is repaired
                    // IN PLACE and the factorisation continues, rather than
                    // restarting the whole thing with a larger global ridge.
                    //
                    // WHY. Exact coincidences are normal, not exceptional:
                    // 333/511, 700/522 and their relatives in a cubic F cell,
                    // and every accidental overlap elsewhere. A global ridge
                    // big enough to factor past all of them also damps the
                    // several hundred intensities that were perfectly well
                    // determined -- measured on a cubic F pattern the global
                    // ladder had to reach 1e-6 relative, a visible bias on a
                    // weak reflection. Repairing only the pivots that fail
                    // leaves every other row exactly as the data determined
                    // it and confines the arbitrariness to the degenerate
                    // subspace, where it belongs.
                    //
                    // The resulting split within a degenerate group is
                    // arbitrary; their SUM is not. repairedOut names them so
                    // the report can say which reflections are affected
                    // instead of printing a number the data cannot support.
                    s = Math.max(floor, (orig > 0 ? orig : 1) * WPPF_PIVOT_REPAIR);
                    if (repairedOut) repairedOut.push(i);
                }
                a[pi + (j - fi)] = Math.sqrt(s);
            } else {
                a[pi + (j - fi)] = s / a[pj + (j - fj)];
            }
        }
    }
    return true;
}

/**
 * Forward/back substitution against a factor produced by the routine above.
 * @returns {boolean} False if the result is not finite.
 */
function skylineSolveInPlace(a, first, ptr, n, x) {
    for (let i = 0; i < n; i++) {
        const fi = first[i], pi = ptr[i];
        let s = x[i];
        for (let k = fi; k < i; k++) s -= a[pi + (k - fi)] * x[k];
        x[i] = s / a[pi + (i - fi)];
    }
    for (let i = n - 1; i >= 0; i--) {
        const fi = first[i];
        const pi = ptr[i];

        x[i] /= a[pi + (i - fi)];
        const xi = x[i];

        for (let j = fi; j < i; j++) {
            x[j] -= a[pi + (j - fi)] * xi;
        }
    }
    for (let i = 0; i < n; i++) if (!isFinite(x[i])) return false;
    return true;
}

/**
 * Solve A x = b for a symmetric skyline A, repairing rank deficiency locally.
 *
 * WHY THE RIDGE. Exactly coincident reflections -- 333 and 511 in a cubic
 * cell, and every other accidental coincidence -- give identical profile
 * columns, so Phi^T W Phi is exactly singular and only their SUM is
 * determined by the data. A plain Cholesky returns null there and the whole
 * intensity solve fails, on a situation that is not an error but a property
 * of the sample.
 *
 * The ridge escalates from zero, so a well-posed system is solved EXACTLY;
 * only a genuinely degenerate one is damped, and then by the smallest amount
 * that makes it factorable. What comes back for a coincident pair is the
 * minimum-norm split of their combined intensity, which is the honest answer:
 * the sum is right, the split is arbitrary, and intensityOverlapClusters in
 * the report is what tells the user so.
 *
 * @param {SkylineMatrix} A Untouched (the factorisation works on a copy).
 * @param {Float64Array} b Right-hand side (untouched).
 * @param {Float64Array} [scratchA] Reusable factor store, length >= A.a.length.
 * @param {Float64Array} [x] Reusable solution vector, length >= n.
 * @returns {{x: Float64Array, repaired: number[]}|null} null only if the
 *          matrix holds a non-finite entry. `repaired` lists the reflection
 *          indices whose pivot had to be propped up: those reflections are
 *          not individually determined, only their group sum is.
 */
/** Restart an ordinary Cholesky with a tiny relative diagonal regularizer
 * if modified Cholesky overflows on many dependent tail columns. */
function factorSkylineSPD(A, fac, repaired = []) {
    fac.set(A.a);
    if(skylineCholeskyInPlace(fac,A.first,A.ptr,A.n,repaired)){
        let stable=true;for(let i=0;i<A.n;i++){let sum=0;for(let j=A.first[i];j<=i;j++)sum+=fac[A.ptr[i]+j-A.first[i]]**2;
            if(!Number.isFinite(sum) || sum>2*Math.max(Math.abs(A.a[A.ptr[i]+i-A.first[i]]),1e-300)){stable=false;break;}}
        if(stable)return {fac,repaired,ridge:0};
    }
    for(let ridge=1e-12;ridge<=1e-6;ridge*=100){
        fac.set(A.a);for(let i=0;i<A.n;i++){const j=A.ptr[i]+i-A.first[i];fac[j]+=ridge*Math.max(Math.abs(A.a[j]),1e-300);}
        if(skylineCholeskyInPlace(fac,A.first,A.ptr,A.n,null,true))return {fac,repaired,ridge};
    }return null;
}

function solveSkylineSPD(A, b, scratchA, x) {
    const n = A.n, a0 = A.a, first = A.first, ptr = A.ptr;
    const fac = (scratchA && scratchA.length >= a0.length)
        ? scratchA.subarray(0, a0.length) : new Float64Array(a0.length);
    const sol = (x && x.length >= n) ? x.subarray(0, n) : new Float64Array(n);

    const repaired = [];
    if (!factorSkylineSPD(A,fac,repaired)) return null;
    sol.set(b.subarray(0, n));
    if (!skylineSolveInPlace(fac, first, ptr, n, sol)) return null;
    return { x: sol, repaired };
}

/**
 * Matrix-vector product for the packed skyline store: out = A x.
 *
 * @param {SkylineMatrix} A
 * @param {ArrayLike<number>} x
 * @param {Float64Array} out
 * @returns {void}
 */
function skylineMultiply(A, x, out) {
    const n = A.n, a = A.a, first = A.first, ptr = A.ptr;
    for (let i = 0; i < n; i++) out[i] = 0;
    for (let i = 0; i < n; i++) {
        const f = first[i], p = ptr[i];
        let acc = 0;
        for (let j = f; j < i; j++) {
            const v = a[p + (j - f)];
            if (v !== 0) { acc += v * x[j]; out[j] += v * x[i]; }   // symmetric
        }
        out[i] += acc + a[p + (i - f)] * x[i];
    }
}

/**
 * NON-NEGATIVE least squares for the intensities, by Lawson-Hanson active set
 * on the normal equations.
 *
 * WHY. An integrated intensity is m|F|^2 times positive factors, so it cannot
 * be negative. The unconstrained solve does not know that, and on a pattern
 * with exact overlaps it does not merely produce noise around zero: it splits
 * a coincident pair into a large positive and a large negative whose sum is
 * right. On PbSO4, (3,4,4) and (7,2,3) coincide at d = 0.998 and came out at
 * roughly -3650 and +1170. Both numbers are meaningless individually, and the
 * positive one is the more dangerous because nothing about it looks wrong.
 *
 * Constraining the solve is the fix Sivia and David argue for: the prior that
 * intensity is non-negative is real information, and imposing it is not
 * cosmetic tidying but the removal of a physically impossible region from the
 * parameter space. What it buys here is that a coincident pair can no longer
 * trade a negative against a positive -- the pair's intensity has to be
 * distributed between two non-negative numbers, which is what the data
 * actually determines.
 *
 * ON THE SKYLINE, NOT A DENSE SUBMATRIX. The passive set is a scattered
 * subset, so its submatrix has no envelope to inherit and a dense
 * factorisation would be O(|P|^3) inside a loop that already runs once per
 * refinement iteration. Instead the bound variables are masked out of a COPY
 * of the packed store -- zero row, zero column, unit diagonal, zero
 * right-hand side -- which leaves the reduced problem exactly and keeps the
 * existing O(n * band) Cholesky. Masking costs one pass over the store, the
 * same order as the factorisation it feeds.
 *
 * WARM STARTED. After the first call the passive set barely moves between
 * refinement iterations, so the loop usually exits in one or two passes and
 * the cost is close to the unconstrained solve it replaces.
 *
 * @param {SkylineMatrix} A Normal matrix (untouched).
 * @param {Float64Array} b Right-hand side (untouched).
 * @param {object} [cache] Reusable scratch; carries `nnlsPassive` between calls.
 * @returns {{x:Float64Array, repaired:number[], bound:number[],
 *            iterations:number, converged:boolean}|null}
 */

function solveSkylineNNLS(A, b, cache) {
    const n = A.n;
    const c = cache || {};

    if (!c.nnlsMask || c.nnlsMask.length < A.a.length)
        c.nnlsMask = new Float64Array(A.a.length);
    if (!c.nnlsRhs || c.nnlsRhs.length < n)
        c.nnlsRhs = new Float64Array(n);
    if (!c.nnlsW || c.nnlsW.length < n)
        c.nnlsW = new Float64Array(n);
    if (!c.nnlsGx || c.nnlsGx.length < n)
        c.nnlsGx = new Float64Array(n);
    if (!c.nnlsX || c.nnlsX.length < n)
        c.nnlsX = new Float64Array(n);

    const mask = c.nnlsMask;
    const rhs = c.nnlsRhs;
    const w = c.nnlsW;
    const gx = c.nnlsGx;
    const x = c.nnlsX;

    const warm = c.nnlsReady === true && c.nnlsN === n;
    c.nnlsReady = false;

    const passive = (c.nnlsPassive && c.nnlsPassive.length === n)
        ? c.nnlsPassive : new Uint8Array(n);
    c.nnlsPassive = passive;

    for (let j = 0; j < n; j++) {
        if (warm) {
            // Previous non-negative solution is a feasible starting point,
            // even when the matrix or background has changed.
            x[j] = Number.isFinite(x[j]) && x[j] > 0 ? x[j] : 0;
            passive[j] = x[j] > 0 ? 1 : 0;
        } else {
            // Cold start: try all variables together, then remove those
            // that hit zero. Avoid adding every reflection one by one.
            x[j] = 0;
            passive[j] = 1;
        }
    }

    let cMax = 0;
    for (let j = 0; j < n; j++) {
        const v = Math.abs(b[j]);
        if (v > cMax) cMax = v;
    }
    const tol = 1e-10 * Math.max(cMax, 1);
    const first = A.first;
    const ptr = A.ptr;

    function solveMasked() {
        mask.set(A.a);

        for (let i = 0; i < n; i++) {
            const f = first[i];
            const p = ptr[i];

            if (!passive[i]) {
                for (let j = f; j <= i; j++)
                    mask[p + (j - f)] = 0;

                mask[p + (i - f)] = 1;
                rhs[i] = 0;
            } else {
                for (let j = f; j < i; j++) {
                    if (!passive[j]) mask[p + (j - f)] = 0;
                }
                rhs[i] = b[i];
            }
        }

        const tmp = { n, a: mask, first, ptr };
        return solveSkylineSPD(tmp, rhs, c.fac, c.sol);
    }

    let iterations = 0;
    let converged = false;
    let last = null;
    const maxSolves = Math.max(32, 10 * n);

    while (iterations < maxSolves) {
        // Always re-solve the passive set for the CURRENT matrix/RHS.
        // Reusing the previous intensities without this is incorrect.
        const res = solveMasked();
        iterations++;
        if (!res) return null;

        last = res;
        const s = res.x;

        // Move towards the restricted solution while staying feasible.
        let alpha = 1;
        let hit = -1;

        for (let j = 0; j < n; j++) {
            if (passive[j] && s[j] <= 0) {
                const den = x[j] - s[j];
                const t = den > 0 ? x[j] / den : 0;

                if (hit < 0 || t < alpha) {
                    alpha = t;
                    hit = j;
                }
            }
        }

        if (hit >= 0) {
            for (let j = 0; j < n; j++) {
                if (!passive[j]) continue;

                x[j] = Math.max(0, x[j] + alpha * (s[j] - x[j]));

                // At a cold start alpha can be zero. Keep variables
                // whose restricted solution points into the feasible set.
                if (x[j] === 0 && s[j] <= 0) passive[j] = 0;
            }

            // Drop the limiting variable explicitly despite roundoff.
            x[hit] = 0;
            passive[hit] = 0;
            continue;
        }

        for (let j = 0; j < n; j++)
            x[j] = passive[j] ? s[j] : 0;

        // Check whether a bound variable should enter the passive set.
        skylineMultiply(A, x, gx);

        let best = -1;
        let bestW = tol;

        for (let j = 0; j < n; j++) {
            w[j] = b[j] - gx[j];
            if (!Number.isFinite(w[j])) return null;

            if (!passive[j] && w[j] > bestW) {
                bestW = w[j];
                best = j;
            }
        }

        if (best < 0) {
            converged = true;
            break;
        }

        passive[best] = 1;
    }

    // Do not report an unfinished active-set solve as successful.
    if (!converged) return null;

    c.nnlsN = n;
    c.nnlsReady = true;

    const bound = [];
    for (let j = 0; j < n; j++) {
        if (!passive[j]) {
            x[j] = 0;
            bound.push(j);
        }
    }

    const out = new Float64Array(n);
    out.set(x.subarray(0, n));

    return {
        x: out,
        repaired: (last && last.repaired) || [],
        bound,
        iterations,
        converged
    };
}
// ===========================================================================
//  2. The intensity normal-matrix envelope
// ===========================================================================

/**
 * Envelope of the intensity normal matrix: first[j] is the lowest-indexed
 * reflection whose data window overlaps j's.
 *
 * Computed exactly, not from a fixed bandwidth guess. The backward walk stops
 * only when NO earlier reflection can still reach -- `maxStopPrefix` carries
 * the running maximum of stop[], so one unusually wide low-angle reflection
 * cannot be skipped over.
 *
 * @param {Int32Array} start
 * @param {Int32Array} stop
 * @returns {Int32Array} first, with first[j] <= j.
 */
function intensityEnvelope(start, stop) {
    const n = start.length;
    const first = new Int32Array(n);
    const maxStopPrefix = new Int32Array(n);
    let run = -1;
    for (let j = 0; j < n; j++) { if (stop[j] > run) run = stop[j]; maxStopPrefix[j] = run; }
    for (let j = 0; j < n; j++) {
        let lo = j;
        if (stop[j] > start[j]) {
            for (let k = j - 1; k >= 0; k--) {
                if (stop[k] > start[j] && stop[k] > start[k]) lo = k;
                else if (maxStopPrefix[k] <= start[j]) break;
            }
        }
        first[j] = lo;
    }
    return first;
}


// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SkylineMatrix, skylineCholeskyInPlace, skylineSolveInPlace, solveSkylineSPD, factorSkylineSPD,
        skylineMultiply, solveNNLS: solveSkylineNNLS, intensityEnvelope
    };
}
