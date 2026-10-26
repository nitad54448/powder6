# Code reviews

## 26 October 2026 - profile fitting review (implemented in 2.45.1)

All 17 findings from the follow-up review are addressed: linked global Jacobians; integrated-area covariance; global extraction scope; uniaxial zero starts; negative Stephens variance; moving-cell reflection coverage; HKL-based saved errors; independent doublet positions; area-normalized doublet weights; actual FWHM; feasible boundary steps; feasible GPU best candidates and metadata; conditional-error labels; site-symmetry coordinate errors; profile/geometry reuse; the missing GPU fixture; and the one-iteration Le Bail budget.

Validation: 215/215 Node tests; 12 browser pages (WebGPU PT, WPPF intensities, solve fixes, constraints, restraints, history/stop, UI consistency, workspace, Fourier, project save, UI interactions and pattern-only); all application-script syntax checks and git diff --check passed. The GPU suite includes live replica feasibility, all three fit workers, validation fallback and device loss.

The independent numerical regressions live at the end of tests/regressions.test.cjs. The GPU suite now reads the bundled space-group database and reaches its previously blocked integration checks. Stephens validity is checked over all modelled directions plus additional probes, rather than claimed as a proof over the entire continuous sphere. Existing calculations should be refitted before using corrected profiles or intensity uncertainties.

## 26 October 2026 — saving, project format, rules, reproducibility (implemented in 2.42.0)

Scope: the whole repository at the level of automated evidence (syntax, every Node suite, every browser page) plus a reading of the state/project, distance-rule and search-launch paths. Verified before the fixes: `node --check` on every script, 155/155 Node tests, 26 of 27 browser pages, no undefined module member or DOM id, WGSL injection markers intact.

1. **A saved project was reported as modified (fixed).** `tests/project-save.html` failed intermittently — `Successful save must clear the leave-page warning`. `loadDatabases()` announced `S.sgReady` and the tables before fetching the preset files, whose values are part of the document (`rv_state.js` `projectJSON`); a save between the two took its baseline before `presetDefaults` arrived (`rv_project.js` save) and every later check disagreed. `loadDefaultPresets()` is now one promise (`RV.cmd.defaultPresetsReady()`), started first in `loadDatabases`, awaited by `save()` and by `openProject()`, and `setPresetDefault(type, values, true)` only fills a shape the document lacks.
2. **The saved-state check cloned the archive (fixed).** `snapshot()` ran `RV.solve.archive(false)` — a deep copy of every reflection table and of the precision block — on every save and every `beforeunload`. `RV.solve.archiveFingerprint()` hashes the same values into 32 bits and allocates nothing.
3. **Project size (fixed, format 4).** The precision block (`ints.pre`, 8.6 MB of text for 600 reflections) and a duplicate of the extraction inside the Wyckoff result (`wy.I === ints`, another 10 MB) dominated a solved project. The block is now binary entries `solution/precision.Q.f64` and `solution/precision.index.i32`; a solution stores `intsRef` and `restoreArchive` reconnects it. Format 3 is still read; the writer emits 4.
4. **Distance rules dropped tokens (fixed).** `A B dmin dmax extra` silently ignored the extra token; `A B N dmin dmax` was reported as "dmax below dmin". Both are now named errors with the form to use.
5. **Searches could not be repeated (fixed).** Item 3 of the 24 October list: the Wyckoff search's initial coordinates, restarts, replica exchanges, Gaussian deviates and GPU per-chain seeds now come from one seeded stream (`swSetSeed`/`swSeed` in `js/swarm_wyckoff.js`), fed by a **Seed** field in the Wyckoff and charge-flipping forms, recorded in the Log, the result, History and the project.
6. **Developer notes (fixed).** `CLAUDE.md`'s Node command now uses the glob (it had omitted `anomalous` and `wyckoff-adaptation`).

Still open from the 24 October list: the statistical convergence benchmark (item 5; item 4, site-wise `quench()` proposals, is implemented in 2.42.4).

## Focused code review — 24 October 2026

Scope: Wyckoff proposal generation and search controls, command/result header surfaces. This is not an exhaustive audit of the refinement engine.

Status of its “Remaining findings” (26 October): 1 and 2 are closed (the adaptation constants are injected by `swInject` and covered by `tests/wyckoff-adaptation.test.cjs`; `SW_DEFAULTS.minObsPerParam` no longer exists), 3 is closed (2.42.0, above), 4 is closed (2.42.4), and 5 remains open.

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
