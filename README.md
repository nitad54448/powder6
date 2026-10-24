# Powder 6

Version **2.22.7**, 24 October 2026. See [corrections](CHANGELOG.md).

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
- Structure → Space group has **Test** for systematic absences of the extracted powder intensities and **ADDSYM** for symmetry of an atomic model. Find higher symmetry… calls the public, locally bundled Moyo 0.21.0 WebAssembly API in a worker. The starting model, a dataset’s Rietveld model, or after a Le Bail or WPPF fit the dataset’s refined cell with its atoms can be selected. See [atomic-model symmetry](#atomic-model-symmetry) and the [bundled Moyo code](#bundled-moyo-code).
- Phases → Convert… carries a phase to another space group or setting (subgroups split sites, supergroups merge them when the structure has the symmetry); cell, positions and every dataset are transformed.
- Compressed `.project` files (`.archive` and the `.powder6` files of earlier versions open too), and overview/focused inspection for large series.

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
js/symmetry_worker.js              calls the public Moyo WebAssembly API
lib/moyo/                          bundled Moyo 0.21.0 bindings, WASM and license
```

Supporting files loaded locally. Without them the program still starts, but loses the feature in the last column:

| Path | Without it |
|---|---|
| `sg/all.json` | no space groups: no new phases, CIF import or Solve |
| `scatters/index.json` and element files | Rietveld calculations and the demo are unavailable; Le Bail and WPPF remain usable |
| `lib/jszip.min.js` | compressed projects, `.brml` and `.rasx` files are unavailable |
| `lib/moyo/moyo_wasm.js` and `lib/moyo/moyo_wasm_bg.wasm` | Find higher symmetry cannot run; the powder-intensity Test remains available |
| `absorption.json` | automatic elemental attenuation estimates are unavailable; restore the file beside index.html and reload |

## Typical workflow

1. Read patterns (**Datasets → Read patterns…**, the File menu, or drop them on the window) and check **Datasets → Instrument**.
2. Add phases: **Phases → Read CIF…**, or **New phase…** from a space group and cell.
3. In **Commands → Method**, choose Le Bail or WPPF. In **Datasets**, choose a coloured dataset tab and set its values, refinement flags, bounds, sharing and links. Phase definitions and starting models are in **Phases**; numerical conditions are in **Settings**.
4. With atoms in the phase, switch it to Rietveld and refine positions, B and occupancies.
5. For an unknown structure: WPPF fit → **Commands → Structure** to extract intensities, test the space group and run charge flipping or a Wyckoff search → inspect **Results → Structure** → transfer atoms to the phase and fit by Rietveld.
6. Press **FIT** or F9 from any view. Inspect the **Le Bail**, **WPPF** or **Rietveld** results tab and choose a completed run. **Use as start** restores that run into the working setup; **Keep** protects it. Save a compressed `.project` file from File (Ctrl+S): after the options, a Save As dialog lets you choose the name and folder; browsers without one download it to their download folder, and the message names the file.

On the pattern, Ctrl+click places a background anchor at the cursor's angle and height; right-drag an anchor to move it. Ctrl+Shift+drag still marks exclusions. Filled magenta anchors are refinable, hollow grey anchors are fixed, and editing an anchor shows a yellow vertical guide. Edit exact X/Y coordinates and the Y refinement flag together in the dataset tab's **Background** group. Plots has separate **Anchors**, **Backgnd**, **Phases**, **Refl** and **Subtract** controls. Anchors is greyed out when no plotted dataset uses spline anchors, in a multi-dataset Overview, or during background subtraction; its checked preference is preserved. Chebyshev backgrounds use coefficients rather than anchor points; changing the fitted range re-expresses those coefficients to preserve the curve at retained angles. Each dataset has independent **Sample** and **Resolution** refinement checkboxes. Each method retains its own background and fitted results; Le Bail and WPPF results display the retained Rietveld atomic model as unused.

## Atomic-model symmetry

Open **Commands → Structure → Space group**. **Test · powder intensities** compares systematic absences using extracted WPPF intensities. **ADDSYM · atomic model → Find higher symmetry…** searches an existing atomic model and needs no intensity extraction or WPPF fit. The blue buttons have the same styling.

Choose the phase, then use **Positions of** to select **The starting model (Phases)**, a dataset’s **Rietveld model**, or, after a Le Bail or WPPF fit, a dataset’s **refined cell with its atoms**. The active dataset is selected initially. A Rietveld model supplies its coordinates and cell together; while using Le Bail or WPPF, these come from its saved Rietveld calculation. Changing this selection searches that model independently.

The atomic distance tolerance defaults to **0.2 Å**; the report also scans **0.05, 0.1, 0.2, 0.3, 0.5, 0.75 and 1 Å** and names the tolerance at which a higher symmetry appears. The allowed adjustment of the cell defaults to **1 % for lengths and 1° for angles**, checked separately. Atoms of one type whose occupancies differ by less than **0.02** (adjustable) count as one kind, and mixed sites are searched as one atom of the combined kind. The report identifies the selected model, engine, returned space group, axes, origin, cell and atomic mismatches. A detected higher group remains visible when conversion is blocked by a tolerance or a model mismatch. **Convert…** previews the change, retains the selected atomic source and explains adoption of its atoms and cell as the phase’s starting model. Every dataset’s Rietveld model is checked before applying the conversion; Ctrl+Z restores the previous state.

**ADDSYM is the interface label; the implementation is Moyo, not PLATON’s ADDSYM code.** The search uses the supplied full-cell positions, expanded with the assigned group, and compares stored atom types and occupancies. In P1, the model must contain every atom of the full cell. The returned group describes the supplied model at the selected tolerances. If all rows remain P1, inspect the full-cell atom list, types, occupancies and cell before drawing a conclusion. See [the help file](Powder6_documentation.html#s-addsym) for the controls and limitations.

## Workspace and stored calculations

The workspace has two independently navigable panels, inspired by Powder5. **Commands** contains **Datasets, Phases, Method, Structure, Settings**. **Results** contains **Plots, Le Bail, WPPF, Rietveld, Structure, Log, History**. Drag the wider divider by its visible grip to resize them; arrow keys resize it too, and **⇄ Panels** swaps their positions. Dataset checkboxes under **Datasets for fitting and plotting** define one target set for fitting and plotting. Use **All datasets** or range selection, then choose **Overview** or **Inspect one dataset** for large series.

**About** is immediately left of **⇄ Panels**. In Phases, **Edit** beside the colour picker renames the phase; each row in **Choose a phase** has a remove icon. **Delete selected** sits beside the dataset scope menu. Exclusions are inside the active dataset after Background. Resolution loads and saves calibrations above the coefficients and detects their profile type automatically.

Choose the instrument profile only in the dataset's **Instrument resolution → Profile** control. TCH is the default; pseudo-Voigt and split pseudo-Voigt also use independent sample size and strain for each phase contribution. There is one TCH choice. Phases contains the crystallographic and sample-broadening models. `absorption.json` loads automatically at startup. The copy controls name their source dataset and copy matching parameter values and refinement flags; they are hidden with fewer than two datasets. FIT runs the method selected in **Commands → Method**, without a separate Next calculation inspector.

Each coloured dataset accordion is the single editor for that dataset's values and refinement flags: acquisition corrections, instrument resolution, background, geometry and phase contributions, including cell, atoms, sample broadening and orientation. Edits and group checkboxes apply only to the active dataset, independently of fit/plot membership. Bounds, sharing and exact links are also edited in Datasets. Phases edits shared definitions and starting models, without rewriting existing dataset values. Method selects the next calculation and phase inclusion. Algorithm, PT settings, iteration limits, tolerance and weighting are edited in **Settings / Numerical conditions**. FIT uses the current values of the selected datasets for the active method. When shared parameters have different starting values in a global fit, a dialog requires an explicit choice of a dataset value or a custom value. Exact links may connect different phases or datasets; dependent refinement flags are disabled. Each dependent links directly to an independent source; link chains are rejected. Phase-level atomic equivalences, sums and holds are edited in **Datasets / Constraints and links**.

Switching methods restores that method’s saved setup and results. Unchanged calculated plots and inspected fit results are reused when their cached values remain valid. Acquisition settings, including wavelength, remain dataset properties across method changes.

Method places a short instruction and any missing-prerequisite warning beside **Fit selected datasets**, with setup controls directly below. Charge flipping and Wyckoff settings sit directly inside their respective Structure blocks. The space-group test's **Number of reflections** defaults to the available determined intensities, capped at 600 for the matrix calculation. It accepts only whole numbers from 4 to the smaller of the available count and 600, and stays disabled until enough intensities are extracted. A changed count rebuilds the precision block for those lowest-angle reflections before testing; it does not discard the other extracted intensities.

Empty views show the next useful step: Datasets shows Read patterns… and Simulate… with its loading hint and demo link, as Phases shows New phase… and Read CIF…, Phases hides its chooser until a phase exists, and Method hides its setup until both phases and datasets exist. Repeated fits continue from the dataset's current values: if Le Bail refines a lattice from 3.5 to 3.49 Å, the next Le Bail fit starts at 3.49 Å. The shared phase starting model remains at 3.5 Å. Edit the dataset value, undo the fit or restore a saved run to return to an earlier starting point.

After CF, **Name them from the formula** is a checkbox for atom transfer. Checked: assign element types to the selected sites using the current Formula unit and Z in Commands → Structure when copying atoms. Unchecked: retain the edited types. Editing a site's element unchecks it automatically. Toggling it leaves the sites and phase unchanged; the phase changes only after confirming **Atoms to the phase**. Excluded peaks remain excluded, and the archived CF result is preserved.

CF startup reports preparation, shader loading and compilation before completed-cycle percentages. GPU startup waits are bounded, a stalled GPU falls back to the CPU, and Stop remains available during preparation.

**Structure → Charge flipping → Adapt search to data quality** enables an optional search with a preview before Run. It assesses raw WPPF I/σ, three resolution shells, measured d min and overlap using each reflection's fitted FWHM. It compares three combinations of density threshold, weak fraction and symmetry strength with 6–128 total starts (manual mode: 1–128); each combination gets independent seeds, paired across settings. Every start uses the same observations and overlap groups, with no additional intensity cutoff. Manual settings are retained when switching modes. Missing or conditional uncertainties are reported as limited guidance.

Adaptive results retain the actual settings, seeds and CF residuals, plus map correlations after periodic grid translations and inversion. Agreement is counted across different seeds; the lowest CF residual selects the retained map, and agreement is reported separately. Parameter choices and the 0.90 correlation threshold are explicit heuristics, not calibrated confidence or proof of a structure. Inspect the sites and chemistry and validate by Rietveld refinement. See the user guide for the exact search rules and literature basis.

Each method's results show one completed run, with a selector for previous runs. Inspecting or exporting an older run preserves the working method, selection and parameter values; **Latest** follows newly completed runs. **Use as start** explicitly restores the viewed run. Structure results similarly separate settings from space-group output, CF maps/sites and Wyckoff candidates. History shows one selected record with storage controls:

- **Set** restores the run's model, dataset values, refinement flags, settings and saved results into the working setup, including fixed external parameter sources. It does not launch a fit or mark the run as kept. Global fits restore their whole set.
- **Keep** protects the stored run from automatic pruning and includes it in compact project saves. It does not change the working model or select a calculation as the starting point. Kept runs show **★ Kept** in selectors and a badge on the History card; **Unkeep** removes this protection. Explicit deletion remains available when the run is not current.

Set and Keep are independent: use both to restore a run and retain it for later. Automatic pruning uses a configurable 100 MB budget and 20 recent unkept records per method, with separate quotas of the same size for charge-flipping and Wyckoff results, so structure searches never push out fits; each method's current result is also protected while current. Delete asks for confirmation (Ctrl+Z undoes it). History shows every detail of the chosen run and can be saved as JSON (with observations) or as a text report; it is read back only as part of a project. Undo keeps 40 recent editing states in memory and shares observation/result arrays.

Project format 3 uses a compressed archive saved as `.project`; `.archive`, `.powder6` (versions before 2.8) and any zip holding `project.json` are opened. Observation columns are binary 64-bit values and are stored once, with JSON model and history metadata. Full saves include retained history; compact saves include current results and kept records. CF sites and candidates are retained; density grids are optional. The completed save reports its compressed size.

Reading a project (File → Read project) replaces the previous session’s datasets, instrument parameters (including both wavelengths and their ratio), model, saved method states, numerical options, profile defaults and structure-search settings, and clears every restore point: the project is read as it was saved and cannot be undone. The active method’s intensities, remembered parameter values and a hand-loaded absorption table come back with it. Old extraction and display caches are cleared. Fields absent from older projects use clean defaults rather than values from the previous session.

## Bundled Moyo code

Powder 6 includes the compiled public [`@spglib/moyo-wasm` 0.21.0](lib/moyo/package.json) package. No npm installation or compilation is needed to run the supplied copy.

| Local file | Role |
|---|---|
| [`lib/moyo/moyo_wasm.js`](lib/moyo/moyo_wasm.js) | Public JavaScript bindings and WASM loader |
| [`lib/moyo/moyo_wasm_bg.wasm`](lib/moyo/moyo_wasm_bg.wasm) | Compiled symmetry engine |
| [`js/symmetry_worker.js`](js/symmetry_worker.js) | Imports the bindings, initializes the local binary and calls `analyze_cell(JSON.stringify(cell), tolerance, 'Standard')` |
| [`js/sg_convert.js`](js/sg_convert.js) | Prepares the full-cell lattice, fractional positions and type identifiers; interprets Moyo’s axes, origin and standardized lattice |
| [`js/rietveld/rv_phases.js`](js/rietveld/rv_phases.js) | Model selection, search report, cancellation and conversion preview |
| [`lib/moyo/NOTICE.md`](lib/moyo/NOTICE.md), [`LICENSE-MIT`](lib/moyo/LICENSE-MIT) | Attribution and redistribution terms |

The worker receives lattice vectors, positions and type identifiers; it receives no assigned space-group number. All analysis runs in the browser using the locally served files. Moyo does not require WebGPU. Upstream offers MIT OR Apache-2.0; the bundled copy is distributed under its included MIT license. Preserve the copyright and permission notice when redistributing it. Source and API: [Moyo](https://github.com/spglib/moyo), [moyo-wasm documentation](https://spglib.github.io/moyo/js/).

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
- Symmetry checks: use `tests/project-symmetry.html` for the public WASM engine, representative space groups and project state; `tests/addsym-pbso4.html` for known Pnma PbSO₄ coordinates supplied as a P1 dataset’s fitted values, source selection, WPPF/Rietveld cells, conversion and undo; and `tests/convert-files.html` for conversion previews and project files. These fixtures verify the integration and transformations; they do not run an actual PbSO₄ refinement. Pass each page to the same browser runner.
- Wyckoff search: `tests/wyckoff-search.html` runs the real GPU search on a simulated P-1 PbO₂ after a WPPF fit, with enough assignments to be screened and more than eight distance rules, and checks the two stages, the progress and the live best structure. It needs WebGPU.
- CF transfer checks: use `tests/cf-transfer.html` with the same runner. Exercises deferred formula naming, selected-site transfer, manual element types, cancellation and archived-result preservation.
- Adaptive CF: `node --test tests/cf-adaptive.test.cjs` checks quality response, common overlap grouping, reproducible CPU searches, map translation/inversion and P1 site extraction. Run `tests/cf-adaptive.html` with the browser runner for real WPPF extraction, GPU/CPU CF workers, recorded search metadata, stopping, failed starts and restoration of manual settings.

PT uses WebGPU automatically inside the fit worker for Rietveld, Le Bail and WPPF. Proposals, pattern evaluation, joint nonnegative intensity solves, acceptance and replica exchange run on the GPU. It validates initial and perturbed trial costs against the CPU model and checks promising candidates in double precision. Device failures, resource limits, unconverged intensity solves or failed validation restart the original CPU PT. Results and text exports record the backend and fallback reason. The final LM fit, uncertainties and reported intensities always use the CPU model in double precision. The Wyckoff search already has its own GPU replica-exchange implementation.

## References

Dragoe (2001), J. Appl. Cryst. 34, 535 (PowderV2, the ancestor of this program); Le Bail, Duroy and Fourquet (1988); Pawley (1981); Toraya (1986); Golub and Pereyra (1973); Thompson, Cox and Hastings (1987); Hill and Howard (1987); Markvardsen, David, Johnson and Shankland (2001); Oszlányi and Sütő (2004, 2005, 2008). The full list is in the documentation.

Moyo: Kohei Shinohara (2026), *moyo: A fast and robust crystal symmetry finder, written in Rust*, [doi:10.6084/m9.figshare.31081162.v1](https://doi.org/10.6084/m9.figshare.31081162.v1).

Interface checks: `node tests/run-webgpu.cjs "" tests/ui-consistency.html` covers theme contrast, keyboard navigation, dialog names, action targets and narrow viewports.
