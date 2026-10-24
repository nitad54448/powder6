# Focused code review — 24 October 2026

Scope: Wyckoff proposal generation and search controls, command/result header surfaces. This is not an exhaustive audit of the refinement engine.

## Implemented in 2.23.0

- `swarm_reflection.wgsl`: every MCMC proposal previously perturbed all independent sites. This couples acceptance across unrelated sites and can impede local refinement as the number of sites grows. Proposals now choose one movable site with probability 0.75, retaining collective moves otherwise. Selection excludes zero projectors (fixed special positions and padding). A moved independent site still expands into its full symmetry orbit. Untouched coordinates are copied exactly. The selection is independent of coordinates and the Gaussian displacement is symmetric, so the existing Metropolis acceptance rule remains appropriate.
- `powder6.css`: Datasets/Phases/Method action surfaces, fit-result run bars and Structure result tabs now use `--chrome`. Previously, white panels, near-paper blends and transparent backgrounds produced different surfaces. The Method selector inherits its action surface.

The proposal ratio is an initial algorithm choice, not a benchmarked optimum. Passing an integration test does not establish better convergence or accuracy across structures.

## Remaining findings and improvements

1. **Duplicated adaptation controls.** `js/swarm_wyckoff.js` declares `stepMin`, `stepMax`, `targetAccept` and `stepAdapt`, while the WGSL adaptation block hard-codes its bounds and step multipliers. The JavaScript `SW_STEP_UP`/`SW_STEP_DOWN` constants are unused. Editing the advertised defaults therefore does not update GPU adaptation. Inject these constants through the existing shader injection mechanism, with boundary validation.
2. **Obsolete observation-threshold default.** `SW_DEFAULTS.minObsPerParam` still says 3 and its comment describes withholding at 3, whereas the operative thresholds are `WY_WITHHOLD_OBS_PER_PARAM = 1` and `WY_MIN_OBS_PER_PARAM = 3`. Remove the unused default and correct the explanation; keep withholding and caution distinct.
3. **Searches cannot be replayed from a seed.** Initial coordinates, restarts, replica exchanges and GPU seeds use host `Math.random()`. A GPU seed alone cannot reproduce the run. Thread a seeded host RNG through all of these and save the seed with History. This is needed to compare proposal strategies fairly.
4. **Quench still perturbs every coordinate.** The CPU proposal loop in `quench()` remains collective. Compare site-wise or coordinate-wise descent on the same archived starts before changing it. Special-position free coordinates must remain constrained.
5. **Benchmark convergence, not just successful execution.** Add repeated seeded trials on small and larger asymmetric units, including fixed and free sites. Compare success rate, residual, restraint violations and elapsed time for equal evaluation budgets. The current GPU test checks execution and outputs, not the statistical quality of the search.

## Validation

- All 117 Node tests passed across regressions, CF adaptive/startup, numerics and project unpacking.
- Wyckoff browser/WebGPU integration passed all five checks, including screening and shaped coordination restraints.
- UI consistency browser test timed out in `Runtime.evaluate` twice, including an isolated rerun. The new light/dark surface assertions are present but their passing status is unverified.
- `git diff --check` passed.
