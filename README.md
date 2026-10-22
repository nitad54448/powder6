# Powder 6

Version **2.6**, 21 October 2026. See [corrections](CHANGELOG.md).

Refine powder diffraction patterns in the browser. Several phases and several patterns in one session, each phase by **Rietveld**, **Le Bail** or **WPPF**, fitted individually or in one global fit, with **structure solution** from the extracted intensities. Everything runs locally; nothing is uploaded.

Full documentation: [`Powder6_documentation.html`](Powder6_documentation.html): methods, the instrument and Lorentz-polarisation model, peak shapes, every kind of constraint (cell, special positions, atomic constraints, limits, sharing), uncertainties, structure solution, and where Powder 6 differs from Powder 5.

## Features

- Constant-wavelength X-ray and neutron data, Kα₂ doublet, polarisation, sample displacement and transparency.
- Rietveld (atoms, scale, March–Dollase orientation, weight fractions), Le Bail and WPPF phases in the same dataset.
- Individual or global fits, with a shared/local padlock on every parameter.
- LM refinement, or WebGPU parallel tempering with a double-precision LM finish and automatic CPU fallback; exact derivatives where the model is linear; special positions constrained, not corrected afterwards; GSAS-II style atomic constraints.
- Chebyshev or spline background, excluded regions, instrument calibration separate from sample broadening.
- Profile diagnostics for negative Gaussian variance, dependent refinement variables and missing uncertainties; explanations remain with saved results. See [ill-conditioned profile refinements](Powder6_documentation.html#profile-conditioning).
- Space-group test, charge flipping (WebGPU with CPU fallback) and a Wyckoff-site search (WebGPU), handing the atoms back for a Rietveld fit.
- Readers for xy/csv/txt, PANalytical `.xrdml`, Bruker `.brml`/`.uxd`, Rigaku `.ras`/`.rasx`, Philips `.udf`/`.rd`/`.sd`, GSAS `.xra`/`.esd`, Jade `.mdi`, pdCIF, and project files.
- Results as text, CIF, pdCIF, SHELX HKLF 4 and a PDF report; command line, edit undo, and persistent calculation History with Set/Keep.
- Compressed `.powder6` projects, saved dataset groups, and overview/focused inspection for large series.

## Run it

Serve the folder over HTTP (browsers block `fetch` on `file://`):

```
python -m http.server 8000
```

Open `http://localhost:8000/index.html` in a current Chrome, Edge or Firefox. The Wyckoff search needs WebGPU (Chrome or Edge).

Press **F9** to fit, **Ctrl+S** to save the project, **Ctrl+Z** to undo. Try the **load the demo** link in the empty Datasets panel, or type `demo` (NaCl and Si). **File → Export to GSAS-II** writes a ZIP (CIF per phase, `.xye` and `.instprm` per dataset, README).

## Files

```
index.html, powder6.css            the program
Powder6_documentation.html         full documentation
charge_flipping.wgsl               GPU kernel, charge flipping
swarm_reflection.wgsl              GPU kernel, Wyckoff search
js/                                code and workers
js/rietveld/                       the Powder 6 application modules
```

Data files the page fetches. Without them the program still starts, but loses the feature in the last column:

| Path | Without it |
|---|---|
| `sg/all.json` | no space groups: no new phases, CIF import or Solve |
| `scatters/index.json` and element files | Rietveld calculations and the demo are unavailable; Le Bail and WPPF remain usable |
| `lib/jszip.min.js` | compressed projects, `.brml` and `.rasx` files are unavailable |
| `absorption.json` | automatic elemental attenuation estimates are unavailable; restore the file beside index.html and reload |

## Typical workflow

1. Read patterns (File menu or drop them on the window) and check **Datasets → Instrument**.
2. Add phases: **Phases → From CIF**, or a new phase from a space group and cell.
3. In **Commands → Method**, choose Le Bail or WPPF. In **Datasets**, choose a coloured dataset tab and set its values, refinement flags, bounds, sharing and links. Phase definitions and starting models are in **Phases**; numerical conditions are in **Settings**.
4. With atoms in the phase, switch it to Rietveld and refine positions, B and occupancies.
5. For an unknown structure: WPPF fit → **Commands → Structure** to extract intensities, test the space group and run charge flipping or a Wyckoff search → inspect **Results → Structure** → transfer atoms to the phase and fit by Rietveld.
6. Press **FIT** or F9 from any view. Inspect the **Le Bail**, **WPPF** or **Rietveld** results tab and choose a completed run. **Use as start** restores that run into the working setup; **Keep** protects it. Save a compressed `.powder6` project from File.

On the pattern, Ctrl+click places a background anchor at the cursor's angle and height; right-drag an anchor to move it. Ctrl+Shift+drag still marks exclusions. Filled magenta anchors are refinable, hollow grey anchors are fixed, and editing an anchor shows a yellow vertical guide. Edit exact X/Y coordinates and the Y refinement flag together in the dataset tab's **Background** group. Plots has separate **Anchors**, **Backgnd**, **Phases**, **Refl** and **Backgnd subtract** controls. Anchors is greyed out when no plotted dataset uses spline anchors, in a multi-dataset Overview, or during background subtraction; its checked preference is preserved. Chebyshev backgrounds use coefficients rather than anchor points. Each dataset has independent **Sample** and **Resolution** refinement checkboxes. Each method retains its own background and fitted results; Le Bail and WPPF results display the retained Rietveld atomic model as unused.

## Workspace and stored calculations

The workspace has two independently navigable panels, inspired by Powder5. **Commands** contains **Datasets, Phases, Method, Structure, Settings**. **Results** contains **Plots, Le Bail, WPPF, Rietveld, Structure, Log, History**. Drag the wider divider by its visible grip to resize them; arrow keys resize it too, and **⇄ Panels** swaps their positions. Dataset checkboxes under **Datasets for fitting and plotting** define one target set for fitting and plotting. Use **All datasets**, saved groups or range selection, then choose **Overview** or **Inspect one dataset** for large series.

**About** is immediately left of **⇄ Panels**. In Phases, **Edit** beside the colour picker renames the phase; each row in **Choose a phase** has a remove icon. Dataset groups save selections for reuse without linking parameters; **Delete selected** sits beside **Save group**. Exclusions are inside the active dataset after Background. Resolution loads and saves calibrations above the coefficients and detects their profile type automatically.

Choose the instrument profile only in the dataset's **Instrument resolution → Profile** control. TCH is the default; pseudo-Voigt and split pseudo-Voigt also use independent sample size and strain for each phase contribution. There is one TCH choice. Phases contains the crystallographic and sample-broadening models. `absorption.json` loads automatically at startup. The copy controls name their source dataset and copy matching parameter values and refinement flags; they are hidden with fewer than two datasets. FIT runs the method selected in **Commands → Method**, without a separate Next calculation inspector.

Each coloured dataset tab is the single editor for that dataset's values and refinement flags: acquisition corrections, instrument resolution, background, geometry and phase contributions, including cell, atoms, sample broadening and orientation. Edits and group checkboxes apply only to the active dataset, independently of fit/plot membership. Bounds, sharing and exact links are also edited in Datasets. Phases edits shared definitions and starting models, without rewriting existing dataset values. Method selects the next calculation and phase inclusion. Algorithm, PT settings, iteration limits, tolerance and weighting are edited in **Settings / Numerical conditions**. FIT uses the current values of the selected datasets for the active method. When shared parameters have different starting values in a global fit, a dialog requires an explicit choice of a dataset value or a custom value. Exact links may connect different phases or datasets; dependent refinement flags are disabled. Each dependent links directly to an independent source; link chains are rejected. Phase-level atomic equivalences, sums and holds are edited in **Datasets / Constraints and links**.

Method places a short instruction and any missing-prerequisite warning beside **Fit selected datasets**, with setup controls directly below. Charge flipping and Wyckoff settings sit directly inside their respective Structure blocks. The space-group test's **Number of reflections** defaults to the available determined intensities, capped at 600 for the matrix calculation. It accepts only whole numbers from 4 to the smaller of the available count and 600, and stays disabled until enough intensities are extracted. A changed count rebuilds the precision block for those lowest-angle reflections before testing; it does not discard the other extracted intensities.

Empty views show the next useful step: Datasets shows only its loading hint and demo link, Phases hides its chooser until a phase exists, and Method hides its setup until both phases and datasets exist. Repeated fits continue from the dataset's current values: if Le Bail refines a lattice from 3.5 to 3.49 Å, the next Le Bail fit starts at 3.49 Å. The shared phase starting model remains at 3.5 Å. Edit the dataset value, undo the fit or restore a saved run to return to an earlier starting point.

After CF, **Name them from the formula** is a checkbox for atom transfer. Checked: assign element types to the selected sites using the current Formula unit and Z in Commands → Structure when copying atoms. Unchecked: retain the edited types. Editing a site's element unchecks it automatically. Toggling it leaves the sites and phase unchanged; the phase changes only after confirming **Atoms to the phase**. Excluded peaks remain excluded, and the archived CF result is preserved.

**Structure → Charge flipping → Adapt search to data quality** enables an optional search with a preview before Run. It assesses raw WPPF I/σ, three resolution shells, measured d min and overlap using each reflection's fitted FWHM. It compares three combinations of density threshold, weak fraction and symmetry strength with 6–12 total starts; each combination gets independent seeds, paired across settings. Every start uses the same observations and overlap groups, with no additional intensity cutoff. Manual settings are retained when switching modes. Missing or conditional uncertainties are reported as limited guidance.

Adaptive results retain the actual settings, seeds and CF residuals, plus map correlations after periodic grid translations and inversion. Agreement is counted across different seeds; the lowest CF residual selects the retained map, and agreement is reported separately. Parameter choices and the 0.90 correlation threshold are explicit heuristics, not calibrated confidence or proof of a structure. Inspect the sites and chemistry and validate by Rietveld refinement. See the user guide for the exact search rules and literature basis.

Each method's results show one completed run, with a selector for previous runs. Inspecting or exporting an older run preserves the working method, selection and parameter values; **Latest** follows newly completed runs. **Use as start** explicitly restores the viewed run. Structure results similarly separate settings from space-group output, CF maps/sites and Wyckoff candidates. History shows one selected record with storage controls:

- **Set** restores the run's model, dataset values, refinement flags, settings and saved results into the working setup, including fixed external parameter sources. It does not launch a fit or mark the run as kept. Global fits restore their whole set.
- **Keep** protects the stored run from automatic pruning and includes it in compact project saves. It does not change the working model or select a calculation as the starting point. Kept runs show **★ Kept** in selectors and a badge on the History card; **Unkeep** removes this protection. Explicit deletion remains available when the run is not current.

Set and Keep are independent: use both to restore a run and retain it for later. Automatic pruning uses a configurable 100 MB budget and 20 recent unkept records per method; each method's current result is also protected while current. Undo keeps 40 recent editing states in memory and shares observation/result arrays.

Project format 3 uses a compressed `.powder6` archive. Observation columns are binary 64-bit values and are stored once, with JSON model and history metadata. Full saves include retained history; compact saves include current results and kept records. CF sites and candidates are retained; density grids are optional. The completed save reports its compressed size.

## Command line (bottom of the window)

`fit`, `globalfit`, `stop`, `steps>>cell`, `tick>>p1\.a`, `scales`, `range>>10&80`, `bkg>>6`, `anchors>>12`, `exclude>>a&b`, `method>>wppf`, `phases`, `sharing`, `simulate`, `select>>text`, `demo`, `gsas2`, `undo`, `cmd` (lists the commands), `help` (opens the documentation in a new tab).

## Notes for developers

- `js/rietveld_core.js` is DOM-free and shared by the page and `rietveld_worker.js`.
- CSS variables read by canvas plots (`--plot-*`, `--series-*`, `--phase-*`, `--calc-line`…) must stay plain values (`#hex`, `rgb()`, `px`).
- `powder6.css` is the single source of truth for all light/dark tokens, layout and component styles.
- Run the import, weighting, fit-state and export regression checks with `node --test tests/regressions.test.cjs` (Node.js; no additional packages).
- GPU numerical checks: serve the repository and open `tests/webgpu-pt.html`, or run `node tests/run-webgpu.cjs` with Chrome/Edge installed. These execute actual shaders for every fit method and profile type, compare trial costs with the CPU model, and exercise a complete GPU PT search followed by CPU LM.
- Browser interaction checks: open `tests/ui-interactions.html` through the local server, or run `node tests/run-webgpu.cjs "C:/Program Files/Google/Chrome/Application/chrome.exe" tests/ui-interactions.html`. These check cursor placement on all intensity scales, anchor dragging and undo, marker styles, Solve group controls and atomic model displays.
- Workspace checks: open `tests/workspace.html`, or pass it as the test-page argument to the same browser runner. Exercises independent panels and swapping, real fits, previous-run inspection/export, explicit restoration, structure output selection, History Set/Keep, resolution/atom-transfer targets, compressed reopening and 250 dataset tabs.
- CF transfer checks: use `tests/cf-transfer.html` with the same runner. Exercises deferred formula naming, selected-site transfer, manual element types, cancellation and archived-result preservation.
- Adaptive CF: `node --test tests/cf-adaptive.test.cjs` checks quality response, common overlap grouping, reproducible CPU searches, map translation/inversion and P1 site extraction. Run `tests/cf-adaptive.html` with the browser runner for real WPPF extraction, GPU/CPU CF workers, recorded search metadata, stopping, failed starts and restoration of manual settings.

PT uses WebGPU automatically inside the fit worker for Rietveld, Le Bail and WPPF. Proposals, pattern evaluation, joint nonnegative intensity solves, acceptance and replica exchange run on the GPU. It validates initial and perturbed trial costs against the CPU model and checks promising candidates in double precision. Device failures, resource limits, unconverged intensity solves or failed validation restart the original CPU PT. Results and text exports record the backend and fallback reason. The final LM fit, uncertainties and reported intensities always use the CPU model in double precision. The Wyckoff search already has its own GPU replica-exchange implementation.

## References

Dragoe (2001), J. Appl. Cryst. 34, 535 (PowderV2, the ancestor of this program); Le Bail, Duroy and Fourquet (1988); Pawley (1981); Toraya (1986); Golub and Pereyra (1973); Thompson, Cox and Hastings (1987); Hill and Howard (1987); Markvardsen, David, Johnson and Shankland (2001); Oszlányi and Sütő (2004, 2005, 2008). The full list is in the documentation.
