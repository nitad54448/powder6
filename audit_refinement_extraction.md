# Refinement, extraction and structure-solution review

Reviewed 28 October 2026 against the current GSAS-II Read the Docs documentation and its linked Python source. No application code was changed.

## Verified findings

### P1 — Fourier maps combine every independent reflection into one overlap group

Location: `js/fourier_map.js:138` (group key), `js/rietveld_core.js:1667` (the `-1` sentinel), and `js/rietveld/rv_solve.js:368` (propagation to the map).

The extraction records `group = -1` for a reflection without a degenerate overlap. The Fourier map only checks whether `group` is null. It therefore puts every independent reflection into the same `groups[-1]` entry. Its subsequent common-scale calculation makes that entry's measured/model ratio exactly one. Independent observed amplitudes are consequently replaced by the model's relative amplitudes, with the small epsilon pedestal, irrespective of their measured ratios. This compromises observed, difference and 2Fo−Fc maps and can conceal missing atoms.

Reproduction executed with the public `FourierMap.build` API: a P1 cubic 5 Å cell, one unit scatterer at the origin, B=0, two independent reflections (100) and (010), each m=2 and Lp=1, areas 2 and 18, `group:-1`, dmin=2 Å. Swapping their measured areas produces an exactly identical difference map (maximum voxel difference **0**). Removing the group property, which makes the existing code give each reflection its own group, produces a maximum voxel difference **0.02890647016465664** under the same swap. The map sigma is 0.00015920790138724785 with the sentinel collision versus 0.007390296487663393 with independent keys.

Recommended correction: give `group < 0`, null or missing values a reflection-specific key; only share a group for nonnegative overlap IDs. Add a numerical regression using the actual `-1` extraction convention.

GSAS-II's FourierMap uses individual observed and calculated reflection amplitudes, with the model phase, when forming its Fo−Fc and 2Fo−Fc coefficients. This directly supports retaining independent observations. [GSAS-II FourierMap source](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIImath.html#FourierMap).

### P2 — Shared geometric restraints are counted repeatedly in global degrees of freedom

Location: `js/atom_restraints.js:230–236`; `js/rietveld_core.js:2306`.

The restraint implementation deliberately divides its weight by the number of datasets holding the phase. When the structure and cell are shared, the repeated residuals are thus copies of the same geometric observation, normalized to contribute once to the objective and normal matrix. However, refinement uses the full repeated residual vector length as `nRes` in `nPts + nRes - nv - nInt`. Its statistical count increases with the number of holders even though its geometric information has not increased. Reduced chi-squared, parameter ESDs and intensity ESDs are consequently deflated.

Executed reproduction with `AtomRestraints.prepare`: P1 cubic 10 Å cell; A=(0,0,0), B=(0.3,0,0); one `A B - 1/2` distance rule with sigmaD=1 and weight=1. For one dataset the restraint cost is **1**, vector length **1**. For three datasets with the identical shared model the cost remains **1**, but vector length is **3**. The latter is used as three restraint observations. For K geometric residuals duplicated across H holders, the denominator is inflated by `(H−1)K` in the fully shared case.

Recommended correction: define the independent restraint count alongside the residual construction, accounting for sharing. Keep per-dataset independent geometries separate where parameters are local. Also review whether flat-window rows with zero derivative should contribute statistical observations; that requires an explicit statistical convention and was not included as a separate confirmed bug.

GSAS-II builds geometric penalties by phase, rather than by every histogram, and includes its restraint term count in the global GOF denominator. [Penalty construction](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIIstrMath.html#penaltyFxn), [refinement statistics](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIIstrMain.html#RefineCore).

### P2 — Fourier calculations drop enabled anomalous scattering

Location: `js/rietveld/rv_fourier.js:47–53,75`; `js/fourier_map.js:80–92`.

The Rietveld model accepts dataset-specific anomalous corrections (`js/rietveld_core.js:666,741–779`), but `atomsOf` sends the Fourier engine only f0/neutron factors. Its API has no wavelength/anomalous argument, and `calcF` computes only real `formFactor(...)`. Thus the phases and calculated amplitudes used in a map cannot represent the enabled anomalous Rietveld model. This is especially material near an absorption edge or for elements with different dispersion corrections. It cannot be repaired by the single fitted scale alone.

Recommended correction: define an explicit powder anomalous Fourier convention and pass the required scattering data through, or disable/warn for this unsupported combination. This finding is established by tracing inputs and formulae; a full numerical end-to-end anomalous map regression was not run.

## Checked behavior and intentional differences

| Area | Assessment |
|---|---|
| Rp, Rwp, Rexp | Core definitions follow weighted profile residual sums and gross observed intensities. Excluded points are omitted. Internal fractions are converted to percentages by the UI. |
| GOF versus reduced chi-squared | `datasetStats.gof` contains reduced chi-squared despite its internal name. Current reporting labels this as reduced chi-squared, and the global summary reports its square root as GOF. This is a naming difference, not a demonstrated display bug. |
| Joint refinement | Dataset normal matrices accumulate into one system; shared variables are counted once in the global parameter count. Cross-dataset links contribute derivatives to affected datasets. |
| Least squares | CPU Levenberg–Marquardt with damping, scaled equations, bounds, variance guards, exact linear/atomic derivatives and numerical derivatives where needed. GPU/CPU parallel tempering is optional and receives a CPU LM finish. This differs from GSAS-II's default analytic Hessian/SVD options without being intrinsically incorrect. |
| Constraints | Exact affine elimination of holds, equivalences, sums and parameter links. Site-dependent coordinates get propagated covariance. Its allowed rule set is narrower than GSAS-II's generalized constraint system. |
| Restraints | Distance/angle window penalties enter the objective and normal equations. Their dead bands and count rules are intentional and differ from GSAS-II's usual target/esd geometric restraints. See the statistical issue above. |
| WPPF/Pawley | Nonnegative joint skyline solve across phases, variable projection and Schur-complement covariance. Nonnegative intensities are a deliberate difference from a Pawley fit that allows negative observations. Degenerate/truncated-column diagnostics exist. |
| Le Bail | Starts afresh at each evaluation, uses a WPPF initialization stage, then partition/refinement cycles with background held. Its estimates and uncertainties should not be expected to match GSAS-II bit for bit. |
| Charge flipping | Symmetry expansion, Friedel pairing, real-density initialization, CPU/GPU fallback and weak-reflection updates have substantive regressions. No new confirmed CF algorithm bug found in this review. |
| Fourier limitations | F(000) is omitted; map mean is relative. Grid capped at 128³ with resolution reduction. Unknown observed coefficients use model completion. Overlap partition has an epsilon pedestal and model phases. These are explicit choices, not equivalence to an unbiased density reconstruction. |

GSAS-II's documented global refinement and Le Bail interfaces provide the comparison points for joint fitting/extraction. [Structure submodules](https://gsas-ii.readthedocs.io/en/latest/GSASIIstruc.html). Its calculation module documents Hessian minimization and Fourier/charge-flipping routines. [Computation module](https://gsas-ii.readthedocs.io/en/latest/GSASIImath.html).

## Validation

Executed `node --test tests/numerics.test.cjs tests/regressions.test.cjs tests/review-fixes.test.cjs tests/cf-physics.test.cjs tests/cf-startup.test.cjs`: **176 tests passed, zero failures**. Separate direct numerical reproductions above also completed. The existing passing suite does not cover the independent Fourier `group=-1` collision or the shared-restraint statistical count.

Run `node audit_refinement_repro.cjs` for the two standalone reproductions. Its assertions document the current erroneous behavior rather than prescribing a future regression-test expectation.

This is a targeted source and numerical review, not a GSAS-II executable cross-validation or an exhaustive audit of every GPU path.
