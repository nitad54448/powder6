// constants.js
// version 157, 16 aug 2026
// ---------------------------------------------------------------------------
//  SINGLE SOURCE OF TRUTH for the physical and numerical constants shared by
//  the main thread, rietveld_worker.js and
//  charge_flipping_worker.js.
//
//  Why this file exists
//  --------------------
//  PV_GAUSS_AREA, PV_LORENTZ_AREA, GSAS_GAUSSIAN_TO_DEG and STEPHENS_PREFACTOR
//  used to be declared independently in the page and in a
//  worker. Two copies of a physical constant is not a style
//  problem: if one is edited and the other is not, the preview and the fit are
//  computing DIFFERENT profile functions, and nothing in the program can
//  detect it. The refinement converges, the report is self-consistent, and the
//  numbers are wrong.
//
//  Loading
//  -------
//    browser :  script src="constants.js"
//                 (written without angle brackets on purpose: a literal
//                  closing script tag inside this file would terminate the
//                  page early if anyone ever inlined it into index.html)     (before everything else)
//    worker  :  importScripts('constants.js')
//    node    :  require('./constants.js')              (for the unit tests)
//
//  In the first two cases every declaration below lands in the realm's shared
//  script scope, so `PV_G0` etc. are simply visible. The module.exports footer
//  is only for node.
//
//  EVERY numeric literal in this file carries its justification. A constant
//  without a reason is a constant nobody can safely change.
// ---------------------------------------------------------------------------

'use strict';

// ===========================================================================
//  1. Profile truncation window
// ===========================================================================
//  A Gaussian is dead by ~4 FWHM; a Lorentzian is not. At 8 FWHM a pure
//  Lorentzian still loses ~4% of its area to truncation and another ~4% to the
//  pedestal subtraction in prepareVoigt. That in itself is survivable, because
//  the Le Bail extraction measures the area of the profile as actually drawn --
//  but the loss depends on eta, and eta moves as the widths refine, so a FIXED
//  window leaks truncation error straight into the intensity/width
//  correlation. The window is therefore scaled with the Lorentzian content,
//  and the exact analytic area of the UNtruncated shape is carried on the prep
//  object (prep.analyticArea) so integrated intensities can be reported free
//  of the truncation bias.
// ---------------------------------------------------------------------------

/**
 * Window half-width for a PURE GAUSSIAN, in multiples of the FWHM.
 * WHY 8: a Gaussian at 4 FWHM from centre is at exp(-ln2*64) ~ 1e-19 of peak,
 * i.e. below double-precision relevance. 8 is 4 with a factor-of-two margin so
 * that the eta-interpolated window never dips below the Gaussian requirement.
 * @type {number}
 */
const CALCULATION_WINDOW_MULTIPLIER_G = 8.0;

/**
 * Window half-width for a PURE LORENTZIAN, in multiples of the FWHM.
 * WHY 25: the truncated fraction of a Lorentzian beyond n FWHM is
 * (2/pi)*atan(1/(2n)) ~ 1/(pi*n). At n = 8 that is 4.0%; at n = 25 it is 1.3%,
 * and the residual is removed exactly by prep.analyticArea. Going further buys
 * little and costs linearly in evaluation time -- the profile loop is the
 * hottest path in the program.
 * @type {number}
 */
const CALCULATION_WINDOW_MULTIPLIER_L = 25.0;

/**
 * Hard cap on the profile half-window, in DEGREES 2-theta.
 * WHY 10: two purposes. (a) Cost. The window is a multiple of the FWHM, so a
 * refinement that transiently drives a width to a nonsensical value would
 * otherwise make one reflection touch the entire pattern, turning an
 * O(n_peaks * points_per_peak) evaluation into O(n_peaks * n_points) -- a
 * three-orders-of-magnitude stall exactly when the fit is already in trouble.
 * (b) Physics. A genuine Bragg reflection with a half-width beyond 10 deg 2th
 * is not a peak any more; capping there means the cost function stops
 * rewarding "explain the background with one enormous reflection".
 * @type {number}
 */
const PROFILE_WINDOW_MAX_DEG = 10.0;

// ===========================================================================
//  2. Minimum resolvable profile FWHM
// ===========================================================================
//  The floor in force before any data arrives. Every fit job carries its own
//  value instead, derived from that dataset's own step (rv_state.js
//  datasetDef.minFwhm = two data steps).
//
//  A peak narrower than a couple of data steps is not measurable, and letting
//  the refiner go there is exactly how a fit with a bad cell "improves" Rwp:
//  a spike in the wrong place costs less than a broad peak in the wrong place,
//  so the profile collapses instead of the cell correcting.
// ---------------------------------------------------------------------------

/**
 * Minimum resolvable profile FWHM, degrees 2-theta, used where no dataset is
 * involved (tooltips, defaults): the floor that acts in a fit is the one the
 * job carries, two median data steps of its own dataset (rv_state.js
 * medianStep(), datasetDef.minFwhm). The 1e-3 seed is a placeholder for the
 * case where a profile is evaluated before any data is loaded, not a
 * physically meaningful value.
 * @type {number}
 */
let MIN_PROFILE_FWHM_DEG = 1e-3;

/** @returns {number} The current minimum resolvable FWHM, degrees 2-theta. */
function getMinProfileFwhmDeg() { return MIN_PROFILE_FWHM_DEG; }

// ===========================================================================
//  3. Smooth positive branch
// ===========================================================================

/**
 * Smooth positive branch: >= floor, strictly increasing, derivative never 0.
 *     softPositive(x, f) = (x + sqrt(x^2 + 4 f^2)) / 2
 * f at x = 0, ~x for x >> f, ~f^2/|x| for x << -f, d/dx > 0 everywhere.
 *
 * FIX: replaces the `if (sigma_sq_cdeg2 > 0) { ... }` guards in the width
 * calculators. Those guards were a hard dead zone -- once a width combination
 * went non-positive the width stuck at its default value, the one-sided
 * finite-difference column came out identically zero, and the parameter was
 * frozen there for the rest of the fit. It could not recover even after the
 * cell and zero-point had been corrected.
 *
 * This is a fallback now, not an invitation: rietveld_core's variance guard
 * (gaussianVarianceGuards) refuses a refinement step that would make the
 * combined Gaussian variance negative over the fitted range, so the floor is
 * reached only by values outside a fit, or by a fit that started there.
 *
 * @param {number} x     Value to floor.
 * @param {number} floor Strictly positive floor.
 * @returns {number}
 */
function softPositive(x, floor) {
    if (!isFinite(x)) return floor;
    // Rationalise the negative branch: x + sqrt(x*x + 4*f*f) loses
    // all significant digits when a trial variance is far below zero.
    const h = Math.hypot(x, 2 * floor);
    return x < 0 ? floor * (floor / (0.5 * h - 0.5 * x)) : 0.5 * x + 0.5 * h;
}

// ===========================================================================
//  4. Pseudo-Voigt normalisation
// ===========================================================================

/**
 * Peak height of the UNIT-AREA Gaussian, in units of 1/FWHM. = 0.9394372787
 * Exact: 2*sqrt(ln2/pi). Not a fitted number.
 * @type {number}
 */
const PV_G0 = 2 * Math.sqrt(Math.LN2 / Math.PI);

/**
 * Peak height of the UNIT-AREA Lorentzian, in units of 1/FWHM. = 0.6366197724
 * Exact: 2/pi. Not a fitted number.
 * @type {number}
 */
const PV_L0 = 2 / Math.PI;

/** Area of the UNIT-HEIGHT Gaussian, in units of FWHM. = 1.0644670194 @type {number} */
const PV_GAUSS_AREA = 1 / PV_G0;

/** Area of the UNIT-HEIGHT Lorentzian, in units of FWHM. = 1.5707963268 @type {number} */
const PV_LORENTZ_AREA = 1 / PV_L0;

/**
 * Mixing coefficients for a pseudo-Voigt evaluated on UNIT-HEIGHT components.
 *
 * FIX (eta convention). The pseudo-Voigt is defined as eta*L + (1-eta)*G with
 * L and G normalised to unit AREA -- that is what makes eta a mixing fraction,
 * and it is the convention the Thompson-Cox-Hastings eta polynomial was fitted
 * for. This code carries a peak HEIGHT per reflection, so the components are
 * evaluated unit-height and the area normalisation is folded into these
 * coefficients, which are then renormalised so the mixture is still 1 at the
 * peak centre.
 *
 * Mixing unit-height components directly (the previous behaviour) is a
 * DIFFERENT function: L(0)/G(0) = 0.637/0.939 = 0.678 at equal FWHM, so a TCH
 * eta of 0.578 (Gamma_L/Gamma = 0.5) was rendered as a shape whose true area
 * mixing fraction is 0.48. For simple_pvoigt, where eta is refined, that was
 * only a mislabelling; for tch_aniso, where eta is COMPUTED from the
 * polynomial, the modelled Lorentzian content was systematically too high and
 * X / Y had to absorb the difference.
 *
 * @param {number} eta Lorentzian AREA fraction, clamped to [0, 1].
 * @param {number} hg  Gaussian FWHM, degrees 2-theta.
 * @param {number} hl  Lorentzian FWHM, degrees 2-theta.
 * @returns {{cL: number, cG: number}} Weights for unit-HEIGHT components.
 */
function pvMixCoeffs(eta, hg, hl) {
    const e = Math.max(0, Math.min(1, eta));
    const wL = e * PV_L0 / Math.max(1e-12, hl);
    const wG = (1 - e) * PV_G0 / Math.max(1e-12, hg);
    const s = wL + wG;
    if (!(s > 0) || !isFinite(s)) return { cL: e, cG: 1 - e };
    return { cL: wL / s, cG: wG / s };
}

// ===========================================================================
//  5. GSAS unit conversions and Stephens anisotropic strain
// ===========================================================================
/*  ============================================================
 *  GSAS profile-function conventions (CW types 3 & 4)
 *  ============================================================
 *  Units of the profile parameters follow GSAS exactly:
 *
 *    Gaussian (Caglioti):   sigma^2[cdeg^2]/(8*ln2)
 *                          = GU*tan^2(th) + GV*tan(th) + GW + GP/cos^2(th)
 *      -> H_G[deg] = sqrt(8*ln2 * sigma^2) / 100
 *
 *    Lorentzian:            gamma_L[cdeg]
 *                          = LX/cos(th) + LY*tan(th)          (TCH)
 *                          = LX/cos(th)                       (Simple/Split)
 *      -> gamma_L[deg] = gamma_L[cdeg] / 100
 *
 *    Conversions (Kaduk & Reid, Powder Diffr. 26, 88, 2011):
 *      GSAS_GU = 1803.4 * FullProf_U          (1803.4 = 100^2/(8*ln2))
 *      GSAS_LX = 100   * FullProf_Y_size   (Powder 6 TCH X = GSAS_LX)
 *      GSAS_LY = 100   * FullProf_X_strain (Powder 6 TCH Y = GSAS_LY)
 *
 *  In this UI:
 *    - Simple pVoigt  GU,GV,GW,GP,LX           = GSAS GU,GV,GW,GP,LX
 *    - TCH            U,V,W                    = GSAS GU,GV,GW
 *                     X = GSAS LX (size,   / cos(th)),  Y = GSAS LY (strain, tan(th))
 *      (GSAS / GSAS-II naming. FullProf uses the opposite one:
 *       X tan(th), Y / cos(th).)
 *    - Split pVoigt   GU_L/R, GV_L/R, GW_L/R, LX_L/R = GSAS units
 *
 *  Stephens (1999) anisotropic strain (TOPAS / GSAS-II form):
 *      M_HKL = SUM S_HKL * h^H k^K l^L            (degree-4 polynomial)
 *      pp    = d^2 * sqrt(max(M_HKL, 0)) / 1000
 *      gamma_L_aniso[deg] = (1.8/pi) * pp * eta     * tan(th)
 *      gamma_G_aniso[deg] = (1.8/pi) * pp * (1-eta) * tan(th)
 *
 *  All width helpers in profile.js return widths in DEGREES 2-theta.
 */

/**
 * sqrt(8*ln2)/100: converts sqrt(sigma^2[cdeg^2]/(8*ln2)) -> FWHM in degrees.
 * The sqrt(8 ln 2) is the exact sigma -> FWHM factor for a Gaussian; the /100
 * is the centidegree -> degree conversion GSAS uses for its width parameters.
 * @type {number}
 */
const GSAS_GAUSSIAN_TO_DEG = Math.sqrt(8 * Math.LN2) / 100.0;

/** 1/100: converts gamma_L[cdeg] -> gamma_L[deg]. @type {number} */
const GSAS_LORENTZIAN_TO_DEG = 1.0 / 100.0;

/**
 * Stephens prefactor, 1.8/pi = 0.5730.
 * WHY this value: it is the canonical constant used by GSAS-II and TOPAS in
 * their implementation of Stephens (1999), J. Appl. Cryst. 32, 281. It folds
 * together the sigma -> FWHM conversion and the 1/1000 scaling built into the
 * definition of pp. It is a CONVENTION, not a derived quantity -- changing it
 * makes the refined S_HKL values incomparable with values from those programs,
 * which is the whole point of matching them.
 * @type {number}
 */
const STEPHENS_PREFACTOR = 1.8 / Math.PI;

/**
 * Default Gaussian/Lorentzian split of the Stephens broadening when the user
 * supplies no explicit eta_aniso. 1.0 = purely LORENTZIAN.
 * WHY pure Lorentzian: microstrain broadening from a distribution of lattice
 * parameters produces a peak shape whose tails fall off far more slowly than a
 * Gaussian, and GSAS-II defaults to the Lorentzian-dominated form for the same
 * reason. If your sample's strain broadening is closer to Gaussian, set
 * params.eta_aniso explicitly rather than editing this default.
 * @type {number}
 */
const STEPHENS_DEFAULT_ETA = 1.0;

// ===========================================================================
//  6. Le Bail decomposition
// ===========================================================================
//  Le Bail revival floor.
//
//  BUG FIX (absorbing zero). calculatePattern skips reflections with
//  intensity <= 0, and the decomposition weight is
//      f_j(i) = I_j * phi_j(i) / SUM_k I_k * phi_k(i),
//  so a reflection sitting at exactly zero gets f = 0 at every point, is
//  handed no intensity, and stays at zero forever. Since the extracted area is
//  clipped at zero and the net observed profile is (correctly) allowed to go
//  negative, a reflection whose window happens to sit over background -- which
//  is precisely what happens while the cell or the zero-point is still wrong --
//  had a ~50% chance of dying on the FIRST pass, including during the seeding
//  cycles, and could never come back once the cell was corrected.
//
//  The heights used for modelling are therefore floored at a tiny fraction of
//  the mean, which keeps f_j > 0 so the partition can revive, while
//  contributing nothing measurable to the pattern. The MEASURED quantities --
//  I_integrated and I_sigma -- are reported unclipped, so a genuinely absent
//  reflection is still detectable as I/sigma ~ 0 (or negative) rather than
//  being hidden behind a floor.
// ---------------------------------------------------------------------------

/**
 * Revival floor as a fraction of the mean peak height.
 * WHY 1e-5: it has to clear two bars from opposite directions.
 *   Lower bound  -- it must survive f_j = I_j*phi_j / SUM in double precision
 *                   against neighbours of order 1, so anything below ~1e-12 is
 *                   indistinguishable from the zero it exists to avoid.
 *   Upper bound  -- it must be invisible in the modelled pattern. Counting
 *                   statistics on a 10^4-count peak give ~1% noise; 1e-5 of
 *                   the mean is three orders of magnitude under that, so a
 *                   truly absent reflection contributes nothing measurable.
 * Anything in 1e-8 .. 1e-4 satisfies both; 1e-5 sits in the middle on a log
 * scale. The value is NOT critical -- if a fit is sensitive to it, the problem
 * is elsewhere.
 * @type {number}
 */
const LEBAIL_REVIVAL_FRACTION = 1e-5;

/**
 * Decomposition passes per re-extraction.
 * WHY 6: the Le Bail partition is a fixed-point iteration. Starting from flat
 * intensities it settles to a relative change below ~1e-4 in 4-6 passes on
 * ordinary patterns; 6 buys the margin for heavily overlapped ones. The cost
 * is small next to building n_params Jacobian columns, which is what the
 * surrounding LM iteration does anyway.
 * @type {number}
 */
const LEBAIL_PASSES_PER_ITER = 6;

/**
 * Hard cap on decomposition passes when the extraction is run to convergence.
 *
 * WHY A CONVERGENCE TEST AT ALL: LEBAIL_PASSES_PER_ITER is a fixed count, and
 * a fixed count is either wasteful or wrong depending on the pattern. On a
 * well-separated pattern the partition settles in two passes and the other
 * four are pure cost; on a heavily overlapped one -- the case that actually
 * needs the method -- six is not enough, and the LM then fits its profile
 * parameters against intensities that are still moving. Iterating to a
 * relative change below LEBAIL_PASS_TOL fixes both ends.
 *
 * WHY 24: six times the old fixed count. Nothing that has not settled by then
 * is going to; it is a runaway guard, not a target.
 * @type {number}
 */
const LEBAIL_MAX_PASSES = 24;

/**
 * Relative change in the extracted intensities below which the decomposition
 * is considered settled.
 *
 * WHY 1e-4: the fixed six-pass schedule was chosen because it reached "a
 * relative change below ~1e-4 on ordinary patterns" (see above), so this is
 * the same target, now measured instead of assumed.
 * @type {number}
 */
const LEBAIL_PASS_TOL = 1e-4;

/**
 * Flat seed height the partition restarts from.
 *
 * The extraction restarts from flat on EVERY evaluation (extract() calls
 * leBail() with seed = r === 0), not once per fit. A single pass does not
 * settle, so reusing the previous intensities would carry HISTORY: the cost at
 * a given set of parameters would depend on how the fit arrived there, and the
 * decomposition would adapt to cover mispositioned peaks -- the cost falls
 * while the cell drifts away. Measured on a synthetic cubic pattern, the
 * SETTLED objective is emphatic (Rwp 9.4% at the true cell against 91.3% at
 * the aliased cell+zero-point minimum), but with one pass per iteration the
 * refiner slid into the aliased minimum and reported 81%. Restarting from flat
 * makes the extraction a deterministic function of the parameters, which is
 * what the outer monotonicity guard needs in order to mean anything. PT
 * inherits that for free: its cost() re-extracts at every proposed move, so
 * there is no separate refresh interval to tune.
 *
 * WHY 100 and why the exact value does not matter: the first decomposition
 * pass computes f_j = I_j*phi_j / SUM_k I_k*phi_k, which is invariant under a
 * common scaling of every I_j. Starting all reflections EQUAL is the whole
 * point (it is what makes the extraction path-independent); the magnitude
 * cancels. 100 is simply a readable number in the middle of the range the
 * extracted intensities occupy.
 * @type {number}
 */
const LEBAIL_FLAT_SEED = 100.0;

// ===========================================================================
//  7. Levenberg-Marquardt tuning
// ===========================================================================
//  Finite differences, one probe per parameter kind (fdStep in
//  rietveld_core.js). There is no escalation ladder any more: an older version
//  multiplied the probe by 100 up to five times (1e8 x the base step), and a
//  width parameter sitting in a numerical dead zone could be driven to a
//  nonsensical value, the pattern then changed wildly, `responded` flipped
//  true, and the resulting secant -- across eight orders of magnitude -- was
//  accepted as a derivative.
// ---------------------------------------------------------------------------

/**
 * Base finite-difference probe, as a fraction of the parameter's scale. It
 * acts on the kinds whose step is proportional to the value (the generic
 * default and the background anchors); cell edges use 1e-6 of the edge, and
 * angles, zero, displacement and orientation a fixed step in their own units.
 * WHY 1e-4: for a one-sided difference the total error is
 * O(h * f'') + O(eps_eff / h), minimised at h ~ sqrt(eps_eff). The cost here
 * is a SUM over ~10^3-10^4 points, so its effective relative noise is nearer
 * 1e-12 than machine epsilon, putting the optimum around 1e-6..1e-5. 1e-4 sits
 * deliberately above that: the extra truncation error is tolerable, and the
 * larger probe is far more likely to escape the flat spots the profile
 * functions genuinely have (a width sitting on its soft floor, a Stephens term
 * at zero).
 * @type {number}
 */
const FD_BASE_FRACTION = 1e-4;

/**
 * Consecutive iterations under the fit's cost tolerance (Settings → tolerance,
 * problem.tol, 1e-5 by default) required to declare convergence.
 * WHY 2: one flat step is common mid-fit (a rejected trial, a lambda
 * adjustment); two in a row is not.
 * @type {number}
 */
const LM_CONVERGED_REPEATS = 2;

// ===========================================================================
//  8. Parallel tempering
// ===========================================================================

/**
 * Number of PT replicas (CPU PT and the GPU kernel's chains).
 * WHY 6: the cost is linear in the replica count and every replica evaluates
 * the full pattern, so the ladder has to stay short. Six rungs spread over
 * 1..PT_MAX_TEMP give a temperature ratio of 100^(1/5) ~ 2.5 between
 * neighbours, which keeps their energies overlapping enough to exchange while
 * remaining affordable.
 * @type {number}
 */
const PT_NUM_REPLICAS = 6;

/**
 * Hottest replica temperature, in chi-squared/2 units: the acceptance test is
 * exp(-dChi2 / (2 T)), the coldest replica sits at T = 1. At T = 100 a move
 * that worsens chi-squared by 200 is accepted with probability e^-1 ~ 0.37,
 * which is the definition of a chain that explores freely.
 * @type {number}
 */
const PT_MAX_TEMP = 100;

// ===========================================================================
//  8b. Separable (variable-projection) WPPF
// ===========================================================================
//  A WPPF model is linear in every intensity, so for any set of non-linear
//  parameters the intensities are the exact solution of a banded linear
//  least-squares problem rather than something to iterate towards. LM and PT
//  therefore search only the non-linear parameters. See wppf_linear.js.
// ---------------------------------------------------------------------------

/**
 * Relative pivot repair applied by the modified Cholesky when a direction in
 * the intensity normal matrix is not determined by the data.
 *
 * WHY 1e-8 and why it is applied PER PIVOT. Exact coincidences are normal,
 * not exceptional: 333 against 511, 700 against 522 and their relatives in a
 * cubic F cell, plus every accidental overlap elsewhere. A GLOBAL ridge large
 * enough to factor past all of them also damps the several hundred
 * intensities that were perfectly well determined -- measured on a cubic F
 * pattern the global ladder had to reach 1e-6 relative, a visible bias on a
 * weak reflection. Repairing only the pivots that fail leaves every other row
 * exactly as the data determined it. Measured: isolated reflections recover
 * to 1.5e-15 relative, and each coincident group's SUM to 1.9e-15, while the
 * split within a group is arbitrary and reported as such.
 *
 * It is also the FLOOR: a pivot at or below this fraction of its own diagonal
 * is repaired (skylineCholeskyInPlace). Accepting smaller pivots lets their
 * square roots amplify the rounding of every later row until the factor
 * overflows.
 * @type {number}
 */
const WPPF_PIVOT_REPAIR = 1e-8;

/**
 * Normalised column correlation above which two reflections are treated as
 * not separable by the data.
 *
 * WHY 0.9999: exact coincidences give exactly 1 up to rounding on a sum of
 * ~10^2 terms, so anything above 1 - 1e-4 is a coincidence rather than a
 * strong overlap. Genuine severe overlap sits well below this and is reported
 * where it belongs, in the overlap-cluster table, with a sigma that says so.
 * @type {number}
 */
const WPPF_DEGENERACY_CORRELATION = 0.9999;



// ===========================================================================
//  9. Small shared numeric utilities
// ===========================================================================

/**
 * First index i with arr[i] >= target, on an ASCENDING array. O(log n).
 * PERF FIX: replaces `let s=0; while (s<n && arr[s]<target) s++;`, which made
 * every pattern evaluation O(n_peaks * n_points) instead of
 * O(n_peaks * points_per_peak).
 *
 * @param {ArrayLike<number>} arr Ascending array.
 * @param {number} target
 * @returns {number} Index in [0, arr.length].
 */
function lowerBound(arr, target) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo;
}

// Defaults of the charge-flipping form and of the adaptive search (rv_solve.js). Kept beside the other
// numerical constants so the value the form advertises and the value a job starts from are the same.
const CF_DEFAULTS = {
    thresholdSigma: 1.10,
    maxIterations: 1000,
    randomStarts: 3,
    peakMerge: 0.9,
    symLambda: 0.5,
    overlapTolTth: 0.05,
    weakFraction: 0.15,
    weakGrouping: 'cluster'
};

// ---------------------------------------------------------------------------
//  Node export footer. MIN_PROFILE_FWHM_DEG is exposed as a live getter rather
//  than a value so a node consumer sees the current floor, not a snapshot.
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
    const _exports = {
        CALCULATION_WINDOW_MULTIPLIER_G, CALCULATION_WINDOW_MULTIPLIER_L,
        PROFILE_WINDOW_MAX_DEG,
        getMinProfileFwhmDeg, softPositive,
        PV_G0, PV_L0, PV_GAUSS_AREA, PV_LORENTZ_AREA, pvMixCoeffs,
        GSAS_GAUSSIAN_TO_DEG, GSAS_LORENTZIAN_TO_DEG,
        STEPHENS_PREFACTOR, STEPHENS_DEFAULT_ETA,
        LEBAIL_REVIVAL_FRACTION, LEBAIL_PASSES_PER_ITER,
        LEBAIL_MAX_PASSES, LEBAIL_PASS_TOL,
        LEBAIL_FLAT_SEED,
        FD_BASE_FRACTION, LM_CONVERGED_REPEATS,
        PT_NUM_REPLICAS, PT_MAX_TEMP,
        WPPF_PIVOT_REPAIR,
        WPPF_DEGENERACY_CORRELATION,
        CF_DEFAULTS,
        lowerBound
    };
    Object.defineProperty(_exports, 'MIN_PROFILE_FWHM_DEG', {
        enumerable: true,
        get: () => MIN_PROFILE_FWHM_DEG
    });
    module.exports = _exports;
}
