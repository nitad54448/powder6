# Corrections

Versions follow semantic versioning (MAJOR.MINOR.PATCH): a new feature or a change of behaviour raises MINOR, a correction raises PATCH, and a change that older projects or files cannot follow raises MAJOR.

## 2.31.2 — 25 October 2026

1. **Complete constraints, restraints and links guide.** Add a dedicated Links section covering source/target selection, multipliers, offsets and display units, refinement flags, edits in either direction, limits, dependency conflicts, individual/global fits, removal, method setups and persistence. Add worked occupancy examples, the no-freedom case, and a table distinguishing atomic constraints, soft restraints, exact links, sharing and one-time copies.
2. **Documentation consistency audit.** Correct mixed-site instructions to use the grouped sum checkboxes; distinguish equivalence flags from sum-dependent flags; replace the obsolete Constraints and links location; put limits under Datasets / Links / Parameter links and sharing; explain rejection of invalid constrained edits rather than silent clipping. Clarify that the tabbed Helper collects rules only for clipboard copying and that duplicate pruning does not establish global geometric consistency. Update README, built-in help, section navigation and release markers. Section links have no missing targets or duplicate IDs.

## 2.31.1 — 25 October 2026

1. **Restraints introduction.** Show the short description and question-mark help once above the phase headings, matching Constraints, rather than repeating them inside each phase editor.

## 2.31.0 — 25 October 2026

1. **Dataset layout.** Move Copy from the parameter list to its own final accordion below Links. Replace the restraint-rules accordion with a question-mark tooltip beside a short description of what restraints do.
2. **Tabbed rule scratchpad.** Helper uses Geometry, Molecule and Suggest tabs. Add in each tab generates and merges into one collected-rules textbox below the tabs; it does not modify phase or dataset restraints or create Undo entries. Duplicate and conflicting atom-pair rules are pruned, keeping the first rule and reporting conflicts. Cancel closes the helper; Copy validates and copies the collected list to the clipboard. Only the user's paste into the main restraints textbox applies rules; repeated pastes still trigger the main duplicate validator. Clipboard failures offer a selectable manual-copy fallback.
3. **Validation.** Browser checks cover the final Copy accordion, tooltip, tab switching, all three generators, collection merging, conflicts, clipboard copying, Cancel, main-editor paste validation and Undo. Existing molecule and restrained-fit browser checks continue to pass; numerical tests also check conflict counts.

## 2.30.0 — 25 October 2026

1. **Constraint help.** Replace the GSAS-II rules accordion with a small question-mark help button in the introductory description, retaining its explanations as a tooltip.
2. **Restraints layout.** Phase headings use the same colour markers and method labels as Constraints. Remove the Apply checkbox: any rule in the textbox is applied in Rietveld fits, and clearing the box removes the restraints. Legacy disabled flags no longer suppress nonempty rules. A collapsed explanation covers syntax, counts, shapes, symmetry, windows versus sigma, duplicate rules, fitting, helpers and persistence.
3. **One Helper dialog.** Replace the inline geometry, molecule and structure-suggestion panels with a Helper button opening a modal containing all three. Add and Replace update the active phase and its inline textbox, retain duplicate checks and Undo, and return to the editor when invoked from the phase dialog. Browser coverage checks the modal lifecycle, coloured headings, help placement and existing molecule/fit workflows; a numerical regression verifies automatic application and removal.

## 2.29.1 — 25 October 2026

1. **Unique restraint pairs.** Allow one distance or geometry rule per unordered atom-label pair, resolving label aliases before checking. Direct text edits and refinement validation reject repeated pairs even with different windows, counts, shapes or angular tolerances. Geometry helpers, molecule guides and structure suggestions omit repeated pairs; Add keeps existing rules and reports skipped duplicates. Generated angle-distance rules share the same check, so overlapping fragments and repeated additions cannot double-weight those distances. Regression and browser checks cover reversed pairs, aliases, conflicting geometry rules, overlapping fragments and repeated Add.

## 2.29.0 — 25 October 2026

1. **Restraints editor flow.** Show the editable active-restraints textbox first and keep Geometry helper collapsed below it. The helper proposes rules automatically from the chosen settings; Add validates and appends them directly to the active textbox, preserving existing rules and Undo. Remove the separate Preview rules / Add these rules steps. Numeric-field edits preserve the Add button so leaving a field cannot cancel the pending click. Browser checks cover the ordering, automatic proposals, direct append, validation, Undo and button stability.

## 2.28.1 — 25 October 2026

1. **Wyckoff formula help.** Remove both question-mark help markers beside Formula unit. The label and textbox carry the formula explanation and dynamically updated composition, Z and density guidance as tooltips; warnings remain highlighted on the field and label.

## 2.28.0 — 25 October 2026

1. **Dataset restraints and geometry helper.** Rename Atomic Constraints to Constraints, remove the duplicate internal heading, and add Restraints immediately below it and above Links. Each phase of the inspected dataset has the existing rules, weights, geometry checks, molecule guide and structure suggestions available inline.
2. **Generate fragment rules.** Select a central atom and ordered neighbours, choose a bond, angle, tetrahedron, octahedron, square planar, triangle or linear geometry, and enter distance and angle tolerances. Preview the generated rules and deviations before adding them; edits support Undo. Distinct-label angles become 1-3 distance windows at the target bond lengths, so their angular tolerance is approximate when bond lengths vary.
3. **Symmetry-related shells.** Geometry presets can instead use symmetry copies of one neighbour label. Counted shape rules accept an optional Rietveld-only angular window, e.g. `Si1 O1 4 1.59/1.65 tet angle=3`. Angles inside the window add no penalty; deviations outside use the phase's angle sigma and weight. Existing rules without the suffix retain their previous behavior. Windows are stored in the rule text and follow existing project, report and Undo handling.
4. **Validation.** Regression coverage checks all presets, angular-window conversion, invalid selections, ideal and distorted tetrahedra, and symmetry-shell windows. Browser coverage checks section placement, previews, applying rules, Undo, symmetry modes, validation and disabled controls during calculations; the existing molecule-guide and restrained-fitting browser checks also pass.

## 2.27.0 — 25 October 2026

1. **Constraint refinement and edits.** Sum-constraint refine checkboxes enable or fix all terms together, with one fewer independent refinement variable than terms. Partial flags are shown as mixed, tooltips explain the relationship, and equations at their parameter-limit extremes show when no refinement freedom remains. Valid edits update related values while typing; either end of an equivalence or dataset parameter link can be edited, updating its source and dependents while preserving limits. Invalid edits leave all values unchanged.
2. **Dataset controls.** Copy has independent Values and Refinement flags options, a destination selector for all other datasets or one named dataset, and a Copy button. Atomic Constraints exposes the editor directly; Links is a separate section with parameter limits and sharing beneath it. Remove redundant selection/fit buttons, their unused handlers, and the extra Links title. Scope equation styles so constrained values and refine checkboxes keep their row alignment.
3. **Fourier and structure views.** Periodic density surfaces include equivalent peaks on cell faces and edges. Fourier, charge-flipping and Wyckoff formula help moves to tooltips. Autoscale and Reset view appear only when the view has changed.
4. **Validation.** Add regression coverage for grouped refine flags, constrained edits in both directions, dataset-link propagation, bound-limited sums and periodic density boundaries; add browser pages for constraint alignment and editing. The 96 Node regression tests passed. Browser checks for Fourier maps and constraint alignment passed; the later constraint-edit browser runs timed out.

## 2.26.2 — 24 October 2026

1. **Fourier peak threshold.** The peak list of a Fourier map starts at a setting, Peaks above (σ), default 4 instead of the fixed 2.5 σ, which listed mostly noise in powder maps. The setting is remembered.

## 2.26.1 — 24 October 2026

1. **Set on a structure-solution run.** Restoring a saved charge-flipping or Wyckoff run from History put its intensities back marked out of date (`stale` was saved with the record), so the Structure tab dropped them and the run showed without its extraction. They are now marked current when adopted, and are kept under the phase-and-dataset key as well. `tests/history-stop.html` passes again.

## 2.26.0 — 24 October 2026

1. **Fourier maps.** Commands → Structure has a Fourier map block beside the space-group test, charge flipping and the Wyckoff search, and Results → Structure a Fourier map view. It builds a difference (Fo − Fc), observed (Fo), 2Fo − Fc or calculated map of the selected phase from the WPPF intensities of the selected dataset and the phases of the atoms of its model (the dataset's values or the starting model). The observed intensity of each overlap group is shared among its reflections in proportion to m·Lp·(|Fc|² + ε); one factor puts the amplitudes on the scale of Fc; an FFT on a cubic grid (at most 128³, optional finer grid) gives the map. The isosurface uses the charge-flipping density viewer (level in σ, holes of a difference map, cell, atoms, PNG, JSON). A peak table lists the extrema above 2.5 σ, one per set of equivalent positions, with the nearest atom and its distance; Add atom… puts a positive peak into the phase with the scatterer you name.
2. New modules `js/fourier_map.js` (structure factors, partition, FFT, peaks; no dependency on the page) and `js/rietveld/rv_fourier.js`; Structure results gain a fourth kind, `fo`, with no run history (maps are recomputed on demand and are not saved in projects).
3. Tests: a Node test (a difference map of a Na-only NaCl model finds the Cl site 2.8 Å from Na) and the browser page `tests/fourier.html` (real WPPF extraction, the strongest difference peak on the Cl site, the viewer, the atom-less refusal).

## 2.25.0 — 24 October 2026

1. **Rietveld restraints.** A phase can carry soft distance and angle restraints (Phases → Restraints…), written in the distance-rule language of the Wyckoff search (`Fe1 C1 6 1.6/2.2 oct`, `C1 C2 - 1.38/1.42`, `O1 O1 - 2.4/`) with atom labels instead of elements. Values outside their window add ((value − nearest bound)/σ)² × weight to χ² as extra observations, with σ(distance), σ(angle) and a weight set per phase. They enter the normal equations (numerical derivatives of the restraint rows, so uncertainties include them) and the degrees of freedom; Rwp and the other agreement factors stay those of the pattern. The symmetry images of the second atom are searched. Parallel tempering with restraints runs on the CPU. They are saved in projects, restore points and the reports.
2. **Molecule guide.** Reads a PDB, XYZ or Z-matrix molecule (or pasted text) and writes a rule for every bond and every 1-3 distance (the angles), matching the atoms of the file to the atoms of the phase by name or by order and leaving out atoms the phase does not have. **Suggest from the structure** writes counted rules from the contacts of the current model.
3. **One rule parser.** The parser of the Wyckoff distance constraints moved unchanged into `js/distance_rules.js`, shared with the restraints. New modules `js/atom_restraints.js`, `js/molecule_rules.js` and `js/rietveld/rv_restraints.js`; the fitting worker loads the first two.
4. Tests: Node (shared parser, restraint geometry through the symmetry images, a restrained fit, projects/undo/rename, molecule files) and the browser page `tests/restraints.html`.

## 2.24.8 — 24 October 2026

1. **Philips UDF RawScan.** Read packed intensity rows using DataAngleRange and ScanStepSize, with LabdaAlpha1/2 and RatioAlpha21 metadata. Preserve all complete points and warn when the stated endpoint disagrees or the closing marker is missing. Recognized UDF/RD/SD files no longer fall back to interpreting counts as angle/intensity pairs when parsing fails. Regression coverage includes sfmo_x3_299.udf (9,574 points).

## 2.24.7 — 24 October 2026

1. **GSAS channel-count mismatches.** Load complete numeric points when fewer points are present than the BANK header declares, and show a warning with both counts. Do not pad missing intensities or uncertainties. Malformed numeric records, incomplete ESD pairs and fewer than two complete points remain errors.

## 2.24.6 — 24 October 2026

1. **Observed patterns without a phase.** Opening patterns selects the Plots results view. A saved background-subtraction setting no longer hides observed points when a calculated background is unavailable: show raw intensities with an explanatory note and matching axes. Apply subtraction only when all plotted datasets have calculated backgrounds, outside the multi-dataset overview. Phase requirements still apply to refinement.

## 2.24.5 — 24 October 2026

1. **Automatic WPPF intensity preparation.** Remove the manual Extract intensities button. Structure selects the phase/dataset source and automatically prepares its uncertainty and correlation information after WPPF fitting, including multiphase datasets. Cache prepared sources by dataset and phase, and show availability or the fit prerequisite. Failed preparations do not retry continuously.

## 2.24.4 — 24 October 2026

1. **Structure preparation.** Move phase/dataset selection and extraction into an Extract intensities accordion. Show the extraction prerequisite beside the button, and explain that ADDSYM does not need intensities. Keep manual extraction available for single-phase datasets as well as automatic extraction after WPPF fitting.

## 2.24.3 — 24 October 2026

1. **Distinct application header.** Give the Powder 6 command bar a muted blue background in light mode and a slate-blue background in dark mode, with a stronger bottom rule and subtle shadow. The title uses the accent colour to match its diffraction icon. Panel toolbars retain their neutral surface.

## 2.24.2 — 24 October 2026

1. **Help theme switch.** Replace the help's plain theme button with a Light/Dark slider in a sticky top-right toolbar, matching the main program's toggle. Both labels remain visible and the selected mode is emphasized. The contents and anchor scrolling account for the toolbar; it is hidden when printing.

## 2.24.1 — 24 October 2026

1. **Help appearance.** Documentation uses the program's saved theme before first paint, with a user-controlled theme switch. Switching the help theme affects the current help page; reopening follows the program again. Remove reading-width caps so paragraphs, notes and examples use the available content width.

## 2.24.0 — 24 October 2026

1. **One dataset selection section.** Remove Selection and batch and its duplicate editable table. Move fit mode, Fit selected datasets and selection actions into the Datasets accordion. Each dataset row has Edit for its name and colour, with automatic theme colour available. Custom colours apply to plots and headings and survive project saving, Undo and calculation History.

## 2.23.1 — 24 October 2026

1. **Palette refinement.** Spread the early dataset colours across blue, burnt orange, teal, purple, ochre, magenta and olive, with corresponding light colours in dark mode. Phase colours follow the same palette. Darker amber active anchors, stronger fixed anchors, background curves and axis colours improve plot annotation contrast in light mode; dark-mode axes and fixed anchors are brighter. Existing solid/dashed curves and filled/hollow anchor markers retain their roles.

## 2.23.0 — 24 October 2026

1. **Wyckoff proposals.** Three quarters of MCMC proposals move one free independent Wyckoff site (and its entire symmetry orbit); the rest retain collective moves. Fixed positions and padding are excluded from single-site selection, and untouched sites retain their exact coordinates. This reduces the coupled rejection of otherwise useful local moves in larger structures.
2. **Panel surfaces.** Datasets, Phases and Method action headers, fit-result run selectors and Structure result tabs share the theme's chrome background in light and dark mode.

## 2.22.7 — 24 October 2026

1. **Selection and batch fit mode.** Show Individual / Global when at least two datasets are selected, synchronized with Commands / Method. The Fit selected datasets button respects that mode instead of forcing individual fits. Updated the instructions to refer to dataset accordions.

## 2.22.6 — 24 October 2026

Removed the redundant Refinement parameters button from Selection and batch; it only reopened the Datasets view without revealing or scrolling to the editor.

1. **Interface consistency and readability.** Shared control borders have stronger contrast in both themes; the default light-theme dataset and phase colours meet normal-text contrast on the workspace; placeholders use readable text contrast; editable parameter fields have visible boundaries. Small labels and structure-report tables use the shared type scale (at least 12 px), with larger default plot labels. Scientific values retain tabular numerals and monospaced parameter editing.
2. **Keyboard and assistive technology.** Focus indicators retain a visible outline even on controls with their own shadows and in forced-colour mode. Dialogs expose their visible title as their accessible name, the workspace skip-link has a focusable destination, History tabs support arrow keys/Home/End with one tab stop, and Structure tabs explicitly identify their panels. Switching dataset accordions retains keyboard focus, and their headings remain available for inspection while a calculation runs.
3. **Compact actions.** Remove, help, previous/next and parameter sharing controls use consistent targets of at least 24 px; parameter grids accommodate their larger actions. Fixed parameters no longer fade their sharing controls below readable contrast.
4. **Browser checks.** Added an interface consistency page covering light/dark text and control contrast, focus outlines, selected-dataset accordions, History keyboard navigation, Structure panel relationships, dialog titles and desktop/tablet/narrow viewport overflow.

## 2.22.5 — 24 October 2026

1. **Selected dataset accordions.** Show a coloured accordion heading for every selected dataset instead of only the active one. Opening a heading selects that dataset for inspection and places the parameter editor under it, without changing the fit selection.

## 2.22.4 — 24 October 2026

1. **Dataset list controls.** Hide the Fit / plot datasets selector and Delete selected button with fewer than nine datasets, matching the Find field. Individual selection checkboxes and row remove buttons remain available.

## 2.22.3 — 24 October 2026

1. **Datasets layout.** Datasets, the coloured active dataset name, and Selection and batch are accordions without white outer cards. The active dataset name appears only in the accordion heading; use the Datasets list to switch patterns. Each list row has a remove icon matching the phase remove controls, with confirmation and undo.

## 2.22.2 — 24 October 2026

1. **File menu cleanup.** Removed the duplicate Report (PDF) entry; PDF reports remain available from the Report button in the top bar.
2. **Instrument profiles and File menu cleanup.** Instrument-profile reading and saving remain in the dataset's Profile dialog; the duplicate File entries and their separator have been removed, along with the sample-broadening Load and Save entries. The dialog is titled Instrument profile and uses Read instrument profile / Save instrument profile; the Datasets button is labelled Profile to save space.

## 2.22.1 — 24 October 2026

1. **Calculation method accessibility.** The Le Bail, WPPF and Rietveld selector in Commands → Method is now a radio group instead of tabs referring to the separate Results panel. Its appearance is unchanged; all four arrow keys move focus and select the next or previous method, wrapping at either end. The selected result run remains independent.
2. **Cancellation, Structure tabs and project validation.** Escape stops a running calculation even from inspection controls; Structure result tabs support Left/Right, Home and End; project import rejects uncertainty and weight arrays whose lengths differ from the observations. These corrections were committed immediately before this release.

## 2.22.0 — 24 October 2026

1. **Le Bail ran twice the maximum iterations.** A Le Bail fit has two stages (a WPPF start, then the cycles) and each was given the whole budget, so 30 iterations could become 60. Maximum iterations is now the budget of the whole fit: the WPPF start uses at most half and the cycles what it left (at least one).
2. **Phases: starting model and datasets.** A phase holds the starting model and each dataset its own values (a fit changes the dataset's, an edit in Phases the starting model's), which is by design but left no way to carry one into the other. Under the atoms: **Starting model → datasets…** copies the cell and/or the atoms of the starting model into every dataset holding the phase, or one of them (fit results cleared, flags kept; the atoms also go into the saved Rietveld model of a dataset fitted by another method now); **Dataset → starting model…** makes a dataset's values (its fitted ones after a fit) the starting model. Both are undone with Ctrl+Z.
3. **Phases: a Structure block** (an accordion under the atoms) draws the structure of the phase with the viewer of Results and Structure (picture, coordination, distances), for the starting model or a dataset's model, chosen in Model.
4. **Find higher symmetry converts at once.** Its button is **Convert** and it applies the conversion it reported (setting, axes, origin, tolerance, atomic source) instead of opening the Convert… dialog again with an empty Find box; the dialog opens only when the conversion needs a look (atoms off the new symmetry, a dataset whose positions lack it), and then with the reason.
5. **Wyckoff search: a summary in the Log.** The Log no longer lists every Z, wave, restart and assignment as the search runs; at the end it shows the result of each Z, the ranking, the values of Z that failed and the warnings, and says how many lines the whole search log has. The whole log is kept in History (Search log).
6. File → **Read project…** (was Open project…), like Read patterns… and Read CIF….
7. Tests: the Le Bail iteration budget; the Phases Structure block and both copy buttons; the ADDSYM pages follow the direct conversion; the Wyckoff page checks that the Log is a summary and reads the whole search log from the result.

## 2.21.0 — 24 October 2026

A review of the refinement, charge-flipping and Wyckoff mathematics.

1. **Charge flipping: the phase relation of the space group had the wrong sign.** The map is ρ = Σ F exp(+2πi h·x) (the inverse transform of the worker), for which F(hR) = F(h)·exp(+2πi h·t); the starting grid and the symmetrisation (CPU and WGSL) used exp(−2πi h·t), i.e. the operators (R, −t) of the inverted group. Groups whose translations are 0 or ½, and centrosymmetric groups with the origin on −1, were unaffected; with 4₁, 3₁, 6₁ screws, d-glides or origin choice 1 the iteration solved the enantiomorph or an origin-shifted copy, and only the search over both hands and many origins in Build structure put it right. On a P4₁ test the map now obeys the group as written (residual 4·10⁻²⁶ against 6·10⁴ for the inverted relation) and the hand search keeps hand +1.
2. **Transparency estimates had the wrong sign.** A penetrating beam moves the peaks to lower angle, Δ2θ = −sin 2θ/(2µR), so with Δ2θ = t sin 2θ a real specimen has t = −1/(2µR). The tooltips gave µeff = 1/(2Rt) for t > 0 and an expected t90 = +1/(2Rµ90); both now use the physical sign (the GSAS-II export already did).
3. **A failed WPPF intensity solve set every intensity to zero without a word, and it failed on ordinary patterns.** Root cause: the modified Cholesky of the intensity normal matrix accepted pivots down to 1e-14 × max(1, diagonal), which is absolute when the diagonal is below 1 (as it is with 1/y weights) and lets nearly dependent columns through; their tiny pivots amplified the rounding of every later row until the factor overflowed (10¹⁹⁸ on a triclinic test pattern whose last reflections are cut by the end of the range), every solve on that pattern failed, and the fit carried zero intensities. A pivot at or below 1e-8 of its own diagonal (the repair value) is now treated as a dependency and repaired; the factor stays bounded (24 repairs, residual 5e-16 on that pattern). In addition the non-negative solve is retried from a cold start, and if it still fails a trial step is refused and a fit or an evaluation stops with a message, instead of returning (or handing to charge flipping and the Wyckoff search) an extraction of zeros.
4. The largest displacement step per iteration was 100 (0.1 rad·cos θ, up to 5.7°); it is 2 (about 0.11°, like the zero point's 0.1°).
5. Wyckoff search, imported reflection files without an Lp column: Fo² was divided by m·Lp but σ was not, so the weights were wrong by (m·Lp)², differently for every reflection. σ is now scaled with its value, as it already was when the file carries Lp.
6. With parameter links in a dataset that has WPPF phases, the marginal uncertainties of the intensities used the projection of the variable's own column, while its Jacobian column carries the linked columns too; the projections are now combined the same way.
7. **Anomalous dispersion.** Datasets → Instrument takes f′ and f″ per element at λ1 (`Fe -3.36 3.20, O 0.05 0.03`, from tables for the wavelength; no values are invented). They enter the Rietveld structure factors as f₀ + f′ + i f″, Friedel-averaged as a powder line requires, (|F(h)|² + |F(−h)|²)/2, with exact derivatives, in the CPU model and the WebGPU PT kernel alike. Saved with the instrument in projects, restore points and the History; without entries every number is bit-for-bit what it was.
8. **The SL/HL asymmetry is included in the peak area.** The asymmetry stretches one flank and compresses the other, which changes the area, while the normaliser was that of the symmetric peak (up to 17 % off for strong low-angle asymmetry). The change is integrated (Gauss–Legendre panels to the clamp point, closed-form tails beyond), within 5·10⁻⁴ of a brute-force integral, in profile.js and the WebGPU PT kernel. The untruncated-area normalisation itself is kept: it recovers the full integrated intensity while the background takes up the tails beyond the window.
9. **Wyckoff search and coordinate refinement: overlapped groups are weighted with the WPPF covariances.** The variance of a group's summed intensity was the sum of the members' variances; overlapped WPPF intensities are strongly anti-correlated, so the sum is far better determined (on a synthetic pair with correlation −0.99, σ of the sum 3.2 instead of 39.7). The extraction now keeps the covariances of overlapping reflections (from the selected inverse and the Woodbury term), and both the search and the final refinement use Σσ² + 2Σcov (one shared function, so they weight the same residual).
10. Wyckoff search: the scattering table used the d of a group's first member for every member; each reflection now has its own.
11. Wyckoff search: structure factors are summed over one image per centring class (the centring translates are flagged in the generated-atom table and skipped in the reflection sums; the contacts still see the whole cell): the hottest loop of the search does a half of its work for C, A, B and I lattices, a third for R and a quarter for F. Reflections the centring forbids are left out of the fitness (their calculated intensity is zero in the full cell).
12. Wyckoff enumeration: four-coordinate oxygen is no longer assumed tetrahedral (it is square planar on an inversion centre in NbO), so an "O … 4" constraint without a stated shape no longer removes such assignments.
13. Parallel tempering: a sweep is now one proposal per refined variable per replica, then one round of exchanges (it was one proposal per replica, so 200 sweeps moved each of 30 variables about seven times). The default is 50 sweeps; the run time of a sweep grows with the number of ticked parameters.
14. Comments and documentation: the Le Bail description matches the code (the areas are held during a cycle and in its Jacobian), the derivatives of cell, profile and geometry are central differences, and a stale note that the WPPF solve has no non-negativity constraint is corrected.
15. Tests: the WPPF solve on the near-singular triclinic pattern, the CF phase relation on P4₁, the anomalous structure factor against an explicit Friedel average, the asymmetric area against a brute-force integral, the centring reduction of the Wyckoff tables (C, R, F), the σ and covariance scaling of the observations and the group variance, the transparency sign, and a WebGPU PT case with f′ and f″.

## 2.20.0 — 24 October 2026

1. Excluded regions are rows in the style of the background anchors: **From** and **To** 2θ boxes, an **Apply** tick, a **×** that removes the zone, and one header over the columns. **Add zone** (formerly Exclude…) opens a window for the start and the end angle. Unticking Apply keeps the zone in the list but takes it out of the fit, the pattern shading, the extraction and the statistics (the zone moves to `inst.exclOff`), to compare fits with and without it; ticking it brings it back. The zones kept aside are saved in projects, restore points and the History, and a project of an earlier version has none. The command Excluded regions of selected… (one text for all zones) and Ctrl+Shift+drag on the pattern still work on the zones applied.
2. Structure: the two notes above the box (what the pane does, the WebGPU budget) are one paragraph; a **warning** appears when no WebGPU is found, pointing to Troubleshooting. The sentence "Single-phase WPPF: …" and the status line are gone (the Extract button's tooltip says what is missing or how the WPPF fit ended; the bar of phase, dataset and Extract is hidden for a single phase, as the extraction is automatic after the WPPF fit, which the documentation now says). Troubleshooting lists how to switch on the browser's hardware (video) acceleration for Chrome, Edge, Firefox and Safari, and the other causes of a missing WebGPU.
3. Datasets: the search box of the datasets list appears from nine datasets. The accordion of parameter limits and sharing no longer starts with a blank space, a line and a title that repeats its own.
4. A uniform look. One spacing scale (`--sp-1…5` = 4, 8, 12, 16, 24 px) and one side margin of the panels (`--inset`) replace the padding of 10, 12, 14, 16, 18, 22 and 26 px that had grown panel by panel, and the command panel no longer overrides the paddings of the stage; every tab bar is `--tab-h` high (it was 38, 39, 40 and 44 px); buttons, segmented controls and header buttons share one padding; the datasets list is an accordion like the others. Three shadows (`--shadow-1`, `--shadow-pop`, `--shadow-3`) replace seven; dialogs, menus and the space-group browser share one box, one head and one foot; the two round help buttons, the header buttons, the two progress tracks, `.hint` and `.note`, `.warn` and `.sv-warn` are one rule each, and the `.sg-btn` buttons are plain buttons. The 28 selectors by `#id` are classes (an id is for the script); the conventions are in CLAUDE.md.
5. The hint of the Charge flipping accordion no longer says "in the worker of powder5" (a note for the developer); it says it runs on the GPU where there is one, otherwise on the CPU.
6. Tests: zones (add, apply, edit, refuse a zone of no width, remove, undo, kept in the instrument copy and the project), and a Node test that the zones kept aside never reach the fit.

## 2.19.0 — 24 October 2026

1. Settings: every box has one width, whatever the label (a long label wraps onto two lines), and the label and box columns follow the width of the panel.
2. Datasets → Background (spline): one header (Anchor, 2θ, Intensity, Fit) instead of a label on each row; the 2θ and Intensity boxes are the same box (the intensity box lost its look when the anchor was not refined); a **×** on each row removes that anchor (the same removal as Ctrl+click on it, with undo; at least two anchors stay).
3. The parameter rows of Datasets, the anchor rows and the table of parameter limits and sharing take their column widths from the width of the panel (flexible columns instead of fixed pixels), so the Parameters no longer need a horizontal scroll bar when the panel is narrow. The limits table is smaller (smaller boxes and type, "Shared" for the long column title, a dash for the parameters that always have one value per dataset).
4. Stylesheet clean-up for a consistent look: the font sizes follow one scale (`--fs-xs` 11, `--fs-sm` 12, `--fs-md` 13, `--fs-lg` 14, `--fs-xl` 15, `--fs-h` 17, `--fs-xxl` 20 px; the halves, 11.5 12.5 13.5 14.5, join the nearest); the radii, the control heights and the dialog backdrop are tokens; the red of `.load-error` and the white of the danger buttons are the theme's `--err` and a new `--on-err` (the danger buttons were white on light red in the dark theme); `--accent` is `--blue` in the rules; cards, accordions and the Structure bar share one box rule; 51 rules of selectors no page uses any more (the old Fit side panel, the calculation cards, the Delete button style, …) and five `[hidden]` rules that the global one makes redundant are removed; the minified block at the end of the file is written like the rest and put in its place before the narrow-window rules, which are merged into one 920 px block. The conventions are in CLAUDE.md.
5. Tests: the anchor table (header, remove buttons, same boxes for X and Y, removal keeps the other heights, two stay, undo), the one width of the Settings boxes and the limits table fitting the panel.

## 2.18.0 — 24 October 2026

1. The **Mode** selector (Individual / Global), its separator and its explanation are hidden while one dataset is selected, as Global is not available then; they appear with two or more.
2. The help text of the fields of the Wyckoff search, the charge-flipping form and Settings is now a tooltip on the label and on the box (the long distance-constraint syntax included), not a line under the box, so a label is always level with its box. Labels that have a tooltip show the help cursor.
3. Phases: the note over the phase list no longer promises that a double-click inspects the phase in Phases (the list is already in that tab, so the double-click and the Enter key did nothing more than a click); both are removed.

## 2.17.0 — 24 October 2026

1. ADDSYM finds the symmetry of a structure refined in P1. A converged P1 Rietveld refinement of PbSO4 (24 free atoms, from a start 0.1 Å off) was recognised as Pnma only at 0.75 Å, beyond the 0.5 Å the scan stopped at, so the report said there was no other symmetry. The scan now runs 0.05, 0.1, 0.2, 0.3, 0.5, 0.75 and 1 Å. When the entered tolerance finds nothing higher but a larger one does, the report names the group, the tolerance and the largest atom move, and a **Use … Å** button sets the tolerance. The hint explains that atoms refined from powder data scatter, and a symmetry operation can need about twice that scatter.
2. Structure pane: the two notes above the box (what the pane does, the WebGPU budget), the box and the three methods now share one left edge; the box lists its facts on separate lines (single phase and its source, then the state of the WPPF fit) instead of one run-on sentence.
3. The three methods of the Structure pane (Space group, Charge flipping, Wyckoff search) start closed in every session; what is opened afterwards is still remembered until the page is closed or reloaded.

## 2.16.3 — 24 October 2026

1. Opening a project checks the archive before using it: `project.json` must be valid JSON and a plain object, observation sets must carry their column lists, a column's declared length must be a plain non-negative number that matches the stored data (and is refused before any memory is allocated when absurd), and the numbers of sets and the size of `project.json` are bounded. A damaged or hostile file now fails with a message instead of a `TypeError` or an out-of-memory error. Observation keys are held in a prototype-free map, so a key such as `constructor` or `__proto__` is an ordinary key.
2. Two errors that were swallowed silently are now reported: a failing result callback of the ADDSYM symmetry sweep goes to the browser console, and a symmetry result that cannot be drawn while the other tolerances are checked is written to the Log.
3. Tests: `tests/numerics.test.cjs` checks cell volumes, d-spacings (cubic, hexagonal, orthorhombic, monoclinic), the Lorentz and polarisation factors and the skyline Cholesky, product and non-negative least-squares solvers against closed-form values; `tests/project-unpack.test.cjs` checks the archive validation. A GitHub Actions workflow (`.github/workflows/tests.yml`) runs the Node suites on every push.

## 2.16.2 — 24 October 2026

1. The View / Inspect line under the plot toolbar is hidden unless two or more datasets are selected (and on the Plots tab): with one dataset, Overlay, Overview and Inspect one dataset are the same picture, so its selector, its stepping arrows and its "1 dataset(s) selected" note were only noise. It returns as soon as a second dataset is selected.
2. The documentation now says what the three views are: Overlay (datasets on the same axes, each with fit and difference, a sample of them beyond the Maximum plots setting), Overview (one thin normalised trace per dataset, stacked, without fit curves or anchors, for long series) and Inspect one dataset (full detail of one).

## 2.16.1 — 24 October 2026

1. The plot toolbar checkbox **Backgnd subtract** is now **Subtract** (its tooltip still says what it subtracts), so the row with the Save PNG button is shorter. Three sentences of the start page, the documentation and the README that still offered "saved groups" (removed in 2.12.0) now point to All datasets and Shift+click ranges.

## 2.16.0 — 24 October 2026

1. A cleaner window. The **Commands** and **Results** headings above the two tab rows are removed (the tabs already name each panel; the panels keep their accessible names). The plot's help line ("Drag: zoom; Shift-drag: pan…") is removed from under the toolbar and replaced by a small round **i** at the right end of the first toolbar row, on the line of Linear / √I / log I. Hovering it, or tabbing to it, opens a tooltip listing every mouse control of the plot: drag, wheel and Alt+wheel, Shift-drag and right-drag, double-click, Ctrl+click anchors, right-drag an anchor, Ctrl+Shift+drag exclusions, legend clicks. The icon stays at the top right when the toolbar wraps.
2. Every session starts as a Cu X-ray tube (Kα1 1.540598 Å, Kα2 1.544426 Å, ratio 0.5, tube polarisation). The instrument of the previous session, kept in the browser, used to become the start of the next one, so after a Co tube, neutrons or an opened project a new pattern began with that instrument. The other remembered settings are kept. A pattern whose file gives a wavelength or radiation, the Instrument dialog and an opened project still set it as before.
3. Tests: the plot "i" (position on the first row, right edge, accessibility, tooltip text, hidden until hover or focus, inside its panel) and the absence of the headings and of the help line; a stored neutron instrument does not survive a restart.

## 2.15.0 — 24 October 2026

1. Histogram matching (added in 2.13.0) is removed from charge flipping: the option, its worker and GPU code, its tests and its documentation. Measured atom by atom on PbSO₄ powder-like data with a known answer, charge flipping already finds every Pb and S and 14–16 of the 16 O without it, and with it finds 11–15 O; on small P1 test structures it changed nothing. Its higher map correlation came from a smoother map, not a more correct one. In 2.13 a matched cycle could also become the kept map, because its R is lower without the map being better. The charge-flipping worker and kernel are back to their 2.12.1 state.
2. Kept from 2.13: the volume per atom (16 Å³) and the group-order preference of the Wyckoff Auto Z live in `js/wyckoff_limits.js`.

## 2.14.1 — 23 October 2026

1. Read structures (CIF)… is now **Read CIF…**, in the Phases toolbar and the File menu, to save space; messages asking for a phase say the same. Atomic constraints… keeps its name: "Constraints" alone would be confused with the parameter links between datasets and the Wyckoff distance constraints.

## 2.14.0 — 23 October 2026

1. Wyckoff search: **Shape weight** (default 1, 0–10) sets how strongly the angles of shaped shells count, as a multiple of the bond penalty; 0 switches the angle term off and keeps the shape's site-symmetry filter. It travels in the kernel's spare parameter slot; the Log states it when a shape is used. Its range and default are in `js/wyckoff_limits.js`.
2. Documentation: the penalties table gives every term as the kernel computes it, including that the bond penalty (0.10) is divided by the number of neighbour slots charged across the cell and the coordination penalty (0.03) by the number of counted centres, the 0.25 Å softness and the flat charge of 5 for an empty slot, the shape term and a worked comparison, the 0.2 to 4.0 ramp, and that the weights steer the search but never rank its results.

## 2.13.1 — 23 October 2026

1. Wyckoff distance constraints accept shortened shapes: two letters or more of a shape's name, when they belong to one shape only (`lin`, `tri`, `tet`, `sq`, `oct`, or `li`, `tr`, `te`, `oc`). The constraint box shows an example with a shape (`S O 4 1.40/1.60 tet`) in its placeholder and its hint.
2. Histogram matching with Z on Auto takes the Z of the Wyckoff solution of the same intensities, else the Wyckoff search's own Auto rule (density window, the multiples of Z the positions allow, nearest 16 Å³ per atom, favouring divisors and multiples of the group order), instead of a separate 18 Å³-per-atom estimate. The note under the checkbox and the Log say which Z was used. The 16 Å³ and the group-order nudge now live in `js/wyckoff_limits.js`, read by both.

## 2.13.0 — 23 October 2026

1. Charge flipping: **Apply histogram matching** (off by default). Every 5 cycles from cycle 10 the flip is replaced by matching the map to the density histogram expected for the cell contents (Zhang and Main 1990; with charge flipping on powder data, Baerlocher, McCusker and Palatinus 2007). The target comes from two random structures of the formula unit × Z (typed, or estimated at 18 Å³ per non-H atom) with the X-ray scattering factors or neutron lengths of the elements, on exactly the reflections of the run, with the overall B of a Wilson plot of the data. The matched map keeps its mean and σ. The GPU (four new kernels) and the CPU do the same arithmetic; the GPU map agrees with the CPU reference after the first matching step (correlation 0.994 on a synthetic P1 structure). The Log names the target, and the results give the schedule, atom count and Wilson B.
2. Wyckoff search: a counted distance constraint may end with a shape, `linear`, `triangle`, `tetrahedron`, `square` or `octahedron` (`S O 4 1.40/1.60 tetrahedron`). The kernel keeps the vectors of each centre's nearest partners and charges the angles between them against the shape's, holding the polyhedron within that centre's own shell. The shape also activates the existing site-symmetry filter for elements it could not infer (a stated tetrahedron keeps Cu off inversion centres; a stated square does not). It costs no extra rule or slot, and a run without shapes compiles the kernel without the vector scratch. The count must match the shape, and an upper distance is required.
3. The shape definitions (names, counts, kernel codes, accepted words) are in `js/wyckoff_limits.js` with the other Wyckoff limits. The kernel's rule records have seven fields (the geometry code), and a cached older kernel is refused by its missing marker.
4. Tests: Node checks of the histogram target (Wilson B, skewed atomic distribution), of the matching step (rank order, mean and σ kept, quantiles imposed), of the CPU search with matching, and of the shape packing and filter; `tests/cf-histogram.html` compares GPU and CPU matching and runs a full GPU search; `tests/wyckoff-search.html` also runs a shaped shell on the GPU.

## 2.12.1 — 23 October 2026

1. Datasets and Phases now mirror each other. The empty Datasets tab shows Read patterns… and Simulate… (its toolbar used to appear only once a dataset existed, so the tab offered only a sentence and the demo link), as Phases always shows New phase…, Read structures (CIF)… and Simulate….
2. One name per action: Read patterns… in the File menu and the Datasets tab (was Read powder patterns… in File), Read structures (CIF)… in the File menu and the Phases tab (was Read a structure CIF… and From CIF / pdCIF…). New phase… is no longer in the Refine menu, which is about fitting; it stays in the Phases tab. Messages asking for a phase point to Phases instead of Refine.

## 2.12.0 — 23 October 2026

1. Dataset groups are removed. They only saved a fixed list of datasets for reselection, linked nothing, could not be edited or deleted, and looked like a second selection concept. Datasets are chosen with the selection alone: All, Shift+click ranges, checkboxes and the search box. Save group… is gone from the dataset toolbar, the scope menu offers the selection and all datasets, and projects, restore points and History restores no longer carry groups.

## 2.11.1 — 23 October 2026

1. Convert…: in the New space group list the standard setting of each of the 230 groups (standard, b-unique cell choice 1, origin choice 2, hexagonal axes: the settings ADDSYM names its results in) is in bold and ends in “· standard”; the closed list is bold while a standard setting is chosen. Typing “standard” in Find lists only them. Browsers that draw the list natively (Safari on macOS) show the label but not the bold.

## 2.11.0 — 23 October 2026

1. Wyckoff search, speed. Every wave of assignments cost restarts × iterations, and pruning acted only inside a wave, so an enumeration of up to 4000 assignments (10 per wave at 512 particles) could ask for 400 full waves. When the assignments need more than two waves, each is now screened first (10 % of the iterations, at least 60, one restart), re-scored on every reflection group, and only the best two waves’ worth get the full search, continuing from what the screening found. A simulated P-1 PbO₂ screens 155 assignments in 31 short waves and searches 10 in full.
2. Wyckoff search, equivalent assignments. Assignments related by an origin shift (quarters of the cell) or the inversion that maps the space group onto itself give the same intensities and distances and are now searched once: P-1 Pb₂O₂ goes from 477 to 78 assignments, Pnma PbSO₄ from 35 to 20, NaCl in P4/mmm from 12 to the 3 genuinely different placements.
3. Wyckoff search, scoring. The full-resolution re-score before ranking and after a Stop now covers every assignment of a wave, including those retired by the prune; they kept the score of the easier partial reflection set and could be ranked above full-resolution scores.
4. Wyckoff search, distance constraints. Up to 32 rules and 256 coordination slots (8 and 64 before). The kernel is compiled with the sizes each run needs, so a run within 8 rules and 64 slots pays nothing for the larger maxima. A cached kernel older than the page is refused instead of silently dropping the rules beyond its own size.
5. Wyckoff search, one source of truth. Its limits and defaults (rules, slots, sites per element, assignments, values of Z, density windows, contact, particles, iterations, restarts, screening) live in `js/wyckoff_limits.js`, read by the page, the worker and the kernel. The worker used 1000 iterations and 6 values of Z when the page sent none, against 2000 and 3 on the page, and accepted up to 24 values of Z against 12 on the page.
6. Wyckoff search, progress. The worker now forwards the live best structure, its assignment and its wR2 with each progress message (they were dropped, so a second Stop could not keep the running best). The bar covers screening, full search and every value of Z, and the wR2 shown is the residual rather than the penalised fitness.
7. ADDSYM after WPPF. A dataset fitted by Le Bail or WPPF offers its refined cell with its atoms (the Rietveld atoms when there are any, otherwise the atoms of the phase) besides its Rietveld model, so the search runs directly after a WPPF fit. The label no longer calls such a model a Rietveld model.
8. ADDSYM, occupancies and mixed sites. Atoms of one type whose occupancies differ by less than the new Occupancies within (default 0.02) are one kind of atom, in the search and in the conversion, which gives merged atoms their mean occupancy; refined occupancies of equivalent sites (0.987 and 0.991) no longer hide the higher symmetry. Atoms of different kinds on one point (a mixed site) are searched as one atom of their combined kind instead of being refused by the engine.
9. ADDSYM, responsiveness. The engine stays loaded in one worker between searches, the chosen tolerance is shown as soon as it is done while the sweep continues, an edit firing both input and change events searches once, and the timeout scales with the size of the cell. The former in-page symmetry finder, which only the tests still used, is removed; the Node regression now checks the Moyo engine the program runs, plus occupancy and mixed-site cases.
10. Opening a project clears every restore point and reads the project as saved: Undo no longer returns to the previous session. The confirmation says so.
11. Projects bring back the extracted intensities of the active method (Results reflection lists were empty until a refit), the values each dataset remembers for parameters it does not hold at the moment, and an absorption table loaded by hand. A Wyckoff result that is also a saved History record is stored once.
12. Saved Structure options are checked against the type of each option when a project opens; numbers typed in the form are kept (they were dropped on reload). The formula unit, Z and distance constraints belong to the project and are no longer kept by the browser between sessions.
13. Restoring a run from History keeps the Structure options (formula unit, Z, distance constraints); it reset them to the defaults.
14. Tests: Node checks for assignment equivalence, wave allocation, more than eight rules, the kernel markers, project intensities and remembered values, and opening a project without undo; `tests/wyckoff-search.html` runs the real GPU search end to end.

## 2.10.4 — 23 October 2026

1. ADDSYM calls the public Moyo WebAssembly API in a cancellable module worker and reports its returned group, standardized lattice, axes and origin. Engine errors and conversion restrictions are visible instead of being presented as no higher symmetry.
2. The active dataset’s fitted Rietveld model is now selected initially. Searches use its coordinates and cell together, including the saved Rietveld calculation while using WPPF or Le Bail. Previously the starting atoms were selected by default, and choosing a dataset could combine Rietveld coordinates with the WPPF cell.
3. Conversion keeps the chosen atomic source, previews adoption of that fitted model as the phase’s starting atoms and cell, and validates each dataset against its own Rietveld model. Stale starting atoms no longer veto a valid conversion of the selected fitted model. Undo restores the previous starting model and calculation banks.
4. A PbSO₄ browser regression supplies known Pnma coordinates as the fitted values of a 24-atom P1 phase, with an arbitrary origin and a separately distorted starting model. It checks detection, atomic-source changes, the saved Rietveld cell while using WPPF, conversion to five Pnma sites with Pb₄S₄O₁₆ content, undo, worker cancellation and engine errors. The six other crystal-system examples and existing conversion/project checks remain covered.

## 2.10.3 — 23 October 2026

1. ADDSYM’s Find higher symmetry… button uses the same blue primary style as Test the space groups. The dialog validates the submitted atomic source and tolerances before opening Convert…; pressing Enter before the delayed preview updated previously passed the old tolerance to conversion. Pending preview updates are cleared when the dialog closes.
2. Browser checks now exercise the first button click with the local WASM engine still unloaded, immediate submission after changing tolerance, phase selection independent of the active phase, and refusal to convert an already symmetric Pnma phase. Detection and conversion remain verified for Pnma and five other representative space groups.

## 2.10.2 — 23 October 2026

1. Charge flipping reports GPU preparation, shader loading and compilation, and the first calculation cycle instead of displaying a fixed 0 % during startup. Adapter/device requests and shader loading have 15-second timeouts; pipeline compilation and first-cycle validation have 30-second timeouts, followed by CPU fallback. Compilation is asynchronous. A failed GPU is bypassed for the remaining random starts of that search. Tests exercise stalled adapters, devices, shader transfers and compilation, verify the CPU fallback against the same seeded calculation, and check the running panel’s startup/cycle progress and Stop action.
2. The symmetry controls are visibly grouped under Commands → Structure → Space group: **Test · powder intensities** and **ADDSYM · atomic model**. Find higher symmetry… has moved out of the Phases toolbar into ADDSYM, with its own phase selector and no WPPF requirement. The Pnma dialog-to-conversion regression now uses this route.

## 2.10.1 — 23 October 2026

1. Find higher symmetry uses the locally bundled Moyo 0.21.0 WebAssembly engine (MIT license), including its standard-setting axes and origin shift. Atom mismatches are measured, and length and angle tolerances are checked independently. Browser regressions cover Pnma, Fm-3m, Fd-3m with an origin change, rhombohedral, hexagonal and monoclinic structures, and the full Pnma search-to-conversion workflow. Pmmm versus Pnma from powder intensities remains the systematic-absence test in Structure; a higher-symmetry search operates on the supplied atomic model.
2. Project loading clears the previous structure-search and extraction caches, restores saved fit mode, selected phase, profile defaults and search settings, and populates the selection before refreshing views. Acquisition wavelengths remain dataset properties across method changes; older projects use clean defaults for missing fields. Refreshing fit controls no longer overwrites the saved global-fit preference.
3. Chebyshev background coefficients are re-expressed when the fitted range changes, preserving the curve at the retained angles, including backgrounds restored from another method. Signed slope and curvature are checked against an independent polynomial with diffraction peaks and exclusions in Rietveld, Le Bail and WPPF.
4. Method changes preserve cached plots of unchanged calculations. Repeated inspection of an immutable saved fit also reuses its evaluated patterns instead of solving its intensities again on each UI refresh; project loading clears these caches.

## 2.10.0 — 23 October 2026

1. Phases → **Find higher symmetry…** looks for symmetry a structure has but its space group does not use, in the manner of ADDSYM in PLATON (after Le Page's MISSYM), and hands the result to Convert…. It works on the starting model or on the refined positions of any dataset holding the phase, with a distance tolerance for the atoms (0.2 Å by default) and a tolerance for the cell (1 % and 1°).
   - The structure is expanded to the full cell; lattice translations that map every atom onto one of the same kind give the true primitive cell (extra centring, or a smaller cell); the rotations its Delaunay-reduced lattice allows within the cell tolerance are tested for a translation that maps all atoms onto atoms of the same kind; the group they form is named in the standard setting (standard, b-unique cell choice 1, origin choice 2, hexagonal axes for R groups), with the new axes and origin.
   - The report gives the cell metric, the lattice points per cell, the group found and whether it is higher than the present one, the new cell, how the sites merge and how far atoms must move, the operations the structure has and the present group does not use (with the largest miss of an atom), and the group found at 0.05, 0.1, 0.2, 0.3 and 0.5 Å.
   - Convert… opens the conversion already set to that group and transformation; the conversion merges the atoms and converts every dataset, as before.
   - Checked on NaCl, Si (Fd-3m origin 2), CsCl, W, spinel, wurtzite, Mg, Bi₂Te₃ (R-3m), rutile, anatase, P2₁/c, C2/c, Pnma, P2₁2₁2₁ and P-1 structures written in P1: each is named correctly, in well under a second.
2. Convert…: the tolerance is now how far an atom may move to take the new symmetry (the distance to the symmetric average), as in the new search; before, two equivalent atoms each moved by up to the tolerance could be refused. Atoms merged from the pieces of one split atom get its name back (Na1a … Na1d → Na1).

## 2.9.2 — 23 October 2026

1. Convert…: the new space group is chosen from a drop-down list of all 520 settings of the 230 groups (number · symbol · crystal system · setting), with a Find box above it that keeps the matches as you type a number or a symbol and selects the setting the text names (14 → P121/c1, P21/n → P121/n1, Pnnn:2). Enter in Find accepts the match instead of starting the conversion; a Find with no match is refused. The previous field showed a drop-down arrow that opened an empty list.
2. The space-group suggestions of the Phases field and of New phase list every setting, written as the fields write them (Fm-3m, P121/n1), labelled with number, crystal system and setting. They used the spaced symbols of the 230 standard settings only ("F m -3 m"), so the list stayed empty for a field holding "Fm-3m" and other settings could not be picked.
3. Typed space-group symbols resolve to the right setting. The exact symbol of every setting now gives that setting (origin choice 2 of 30 groups, such as Pnnn:2, used to give origin choice 1); short monoclinic symbols give the standard b-unique setting (P 21/c → P121/c1, it gave P121/a1; P21/n, which was not recognised, → P121/n1); and a monoclinic number gives the standard setting (14 → P121/c1).

## 2.9.1 — 23 October 2026

1. Phases: the space-group row now uses the same columns as the phase-name row, so the space-group field lines up with the phase name, Convert… sits under the colour selection and Browse… under Edit, all at the same size. Browse… no longer wraps onto a line of its own.

## 2.9.0 — 23 October 2026

1. One running panel for every calculation (fits, extraction, space-group test, charge flipping, Wyckoff search), at the top centre under the header instead of a small card in the bottom-right corner. It shows what is running, its progress (the same as the progress bars of the footer and of Commands → Structure, which it now mirrors) with the elapsed time, a progress bar, and the only Stop of the page: a red ■ Stop button that also names its key, Esc.
2. The formula unit and Z rows say what each method does with them, instead of the same sentence twice. Charge flipping: the formula is optional and only names the peaks (count × Z atoms per cell, strongest scatterer on the highest peaks); Z = Auto comes from the highest peak. Wyckoff search: the formula is required and is exactly what is placed; Z = Auto tries every Z with a plausible density.

## 2.8.0 — 23 October 2026

1. Phases → **Convert…** (left of Browse…) describes a phase in another space group or setting. The structure is expanded to the full cell, carried to the new axes and origin, and reduced with the new symmetry; the cell, the atomic positions, B and occupancies of the starting model, of every dataset holding the phase (each from its own refined values) and of their saved calculations are converted, with their fit flags. The transformation (new axes a′, b′, c′ and origin) is found automatically among axis changes with entries −1, 0, 1 and origin shifts in eighths, or entered by hand (e.g. "a+b,-a+b,c", "1/8,1/8,1/8"). A live preview shows how the groups relate (same group in another setting, subgroup, supergroup), the old and new cells, the sites that split or merge, and the cell content.
   - A subgroup splits sites (Fe1 → Fe1a, Fe1b); a supergroup merges atoms the new symmetry relates, and is refused, with the atom and distance named, when the structure or any dataset's refined positions lack that symmetry within the tolerance (0.1 Å by default).
   - The preferred-orientation direction and uniaxial broadening axes follow the new axes; anisotropic size and Stephens strain coefficients are flagged for refinement; atomic constraints and parameter links of the old atoms are removed and counted. Fit results are cleared; Ctrl+Z undoes the conversion.
2. Projects are saved with the extension **.project**. Opening accepts .project, .archive, the .powder6 files of earlier versions, and any zip that holds a project.json, whatever its name; other zips still go to the pattern readers.

## 2.7.1 — 23 October 2026

1. Saving a project always ends with a message and, unless cancelled, a file. After the options, Choose file… opens the browser's Save As dialog before compression, so the name and folder are chosen while the click still counts; the compressed project is then written there. Where the browser has no Save As (or refuses it), the project downloads to its download folder and the message gives the file name and where to look if the browser held the download. Saving while a calculation runs, with nothing to save, a cancel, and a failure while compressing or writing each give a message instead of nothing. Download links stay valid long enough for large files.

## 2.7.0 — 22 October 2026

1. Charge flipping accepts up to 128 random starts (adaptive mode 6–128, manual 1–128). Adaptive mode keeps only the twelve lowest-R density maps for the map-agreement check, so a large budget does not hold every map in memory.
2. A stopped Wyckoff search keeps its solution. The worker reports each finished value of Z as soon as it is refined, and the page keeps the live best structure of the Z still running. A second Stop, a worker crash or an error after a stop now keeps what was already received instead of discarding it; such a result is labelled, and a structure taken from the live search is marked as not refined. A new CF or Wyckoff result also resets the result selector to the latest solution.
3. The Wyckoff worker's list of solutions per Z now carries `ranked` and `obsPerParam`, so the “Unranked” caution appears for those solutions too.
4. History lists all the information of the chosen run: run settings and refinement options, global summary, phases, limits and shared parameters, and for each dataset its statistics, phase R factors, warnings, every parameter with its e.s.d. and refinement flag, and the instrument and background. Charge-flipping and Wyckoff records list their settings, solutions, sites, random starts and search log.
5. History can be saved: Save History writes every record with its results and observations as JSON; Save run report and Save report of all runs write the same information as text. Both use the Save As dialog where the browser has one, and fall back to a download when it refuses. History is read back only as part of a project.
6. Set on a charge-flipping or Wyckoff record restores the intensities the solution was made from (it wrote a field nothing read). If its phase or dataset is gone, the solution is still shown and a warning says the intensities could not be restored.
7. Charge-flipping and Wyckoff records have their own pruning quotas (the History count setting applies to each), so structure searches no longer push WPPF fits out of History. Pruning and the “working setup differs” check no longer re-serialize every record on each update.
8. Deleting a History run asks first, and says so when the run is kept; Ctrl+Z restores it.
9. After Stop, the Wyckoff search refines its best structure before returning it. A toast, the progress bar and the busy card ask the user to wait while it does; a second Stop still ends at once with the unrefined search positions.
10. Opening a project checks its History record by record: unknown kinds, duplicate ids and missing models are rejected; runs whose observations are not in the project are left out and named in the Log instead of failing later at Set; the record counter is repaired so new runs never reuse a saved id.
11. index.html now holds the complete layout (Commands and Results panels, result tabs, History, Structure results). The start-up code that rebuilt the page from an older layout is gone, so the markup is what you see. There is a single About control, and the PowderV2 reference appears once.
12. Accessibility: the File/Data/Refine buttons form a labelled group of menu buttons instead of an incomplete menubar; the space-group dialog hides its axis-choice row with the `hidden` attribute instead of inline styles, and its search fields have labels.
13. Scripts load deferred from the head in their dependency order. Start-up checks that every module is present and, if one is not, names it on the page instead of failing on an undefined value.
14. `ui.saveTextFile` is generic (title, file type and remembered folder are options); the instrument-resolution export passes its own.
15. Comments that named powder5.html as the host page now name index.html and rv_solve.js.
16. The plot keeps its zoom when the model changes: a new space group, cell, phase, method or refit redraws the curves in the region being inspected. It rescales only when what is plotted changes (the datasets shown, their observations, the intensity scale, background subtraction or the view mode), or on Autoscale / double-click.
17. Method lists what the fit will refine, grouped (scales, background terms, zero and geometry, cell, sample profile, resolution, preferred orientation, atomic positions, B and occupancies per phase, and the reflection intensities of WPPF and Le Bail phases), instead of only a count.
18. A WPPF fit with nothing ticked is allowed: the reflection intensities are variables of their own and are refined at the current cell and profile. Rietveld and Le Bail still need a ticked parameter.
19. Charge flipping places every element of the formula it can. A heavy atom needing fewer atoms per cell than its peak's site holds (for example 2 Fe on a peak that landed slightly off a 2-fold inversion centre) has the peak moved onto the nearest free special position of small enough multiplicity, up to 0.6 Å away; the move is shown in the sites table. Elements that still cannot be placed are named in the toast and under the sites table instead of being silently left out.
20. A Wyckoff composition blocked by a stated coordination number now says so. A constraint such as “Fe C 1 1.2/1.8” gives Fe a coordination of 1; an odd coordination cannot sit on an inversion centre, which can leave Fe no position. The error names the constraint, the excluded positions and the syntax for a distance window alone (“Fe C - 1.2/1.8”), instead of advising to raise the site caps; the constraint editor warns about odd coordination numbers as they are typed.
21. A Wyckoff failure for a single value of Z is written to the Log once, as the error, instead of twice.

## 2.6 — 21 October 2026

1. Restored phase-scale and constant-background estimation by removing a call to an obsolete model method. Estimation also clears results that no longer describe the current values.
2. Preserved supplied uncertainties in GSAS ESD/FXYE and XYE imports. Sorting, filtering and duplicate removal keep uncertainty and weight columns aligned. pdCIF weights, including zero-weight exclusions, survive project saves, undo and exports.
3. Invalidated fit statistics, parameter uncertainties and extracted intensities when phases are added or deleted, including results stored for other calculation methods.
4. Kept pdCIF metadata within its data block. Files containing several profiles import each profile separately, retaining its wavelength and referenced phase assignments.
5. Preserved neutron radiation on pdCIF import. Neutron and explicitly single-wavelength files no longer acquire an assumed X-ray doublet.
6. Shared CIF tokenization now handles inline comments, quoted values, wrapped loop rows, scalar values on following lines and semicolon text fields. Incomplete rows produce an error instead of silently dropping atoms.
7. Blocked Rietveld calculations when required scattering factors are missing, both before dispatch and inside the fit core. Valid zero and negative neutron scattering lengths remain supported; Le Bail and WPPF do not require atomic scattering tables.
8. Included radiation type, both doublet wavelengths and their intensity ratio, and the zero correction in pdCIF exports. Imported weights are also respected by GSAS-II exports; points with an imported zero weight are omitted from XYE output.
9. Restored weighting and calculation defaults with undo, together with the saved refinement state, and persisted the restored settings.
10. Added automatic WebGPU parallel tempering for Rietveld, Le Bail and WPPF, including pattern evaluation, intensity solves and replica exchange. Trial costs are validated against the CPU model; GPU failures restart CPU PT. Final LM refinement and uncertainties remain double precision. Results record the backend and fallback reason.
11. Added right-drag background anchors, exact cursor placement in angle and intensity, a yellow guide while editing, and distinct fixed/refinable markers. Split Solve's Sample and Resolution refinement controls. Le Bail/WPPF atom displays and structure exports now use the Rietveld atomic model; method-specific backgrounds and fitted results are preserved.
12. Gave refinable background anchors a dedicated magenta colour in both themes, independent of dataset colours. Fixed anchors remain hollow grey and the active editing guide remains yellow.
13. Split the workspace into independently navigable Commands and Results panels, using Powder5 as a layout reference while retaining Rietveld. Commands contains Datasets, Phases, Method, Structure and Settings. Results contains Plots, Le Bail, WPPF, Rietveld, Structure, Log and History. Each results view shows one selected run; inspecting/exporting previous fits leaves the working setup untouched, with explicit Use as start/Set restoration. Structure inputs and outputs are separate. Panels can be resized and swapped, with the order remembered. Coloured dataset tabs remain the sole editors of dataset values and refinement flags.
14. Added named dataset groups, focused inspection and an observation overview for large selections. FIT uses the selected datasets and their current values for the active method. Conflicting shared starting values in global fits require an explicit dataset value or custom value. Plot controls independently toggle anchors, background, phases, reflections and background subtraction.
15. Added persistent immutable calculation checkpoints, grouped batch/global restoration, Keep, count/byte budgets, protected current results and structure-solution provenance. Setting an older fit makes it the method's current result.
16. Added explicit dataset targets for resolution and sample imports, and phase/assignment targets for structure transfers. Resolution function types now belong to datasets, including in CPU and WebGPU calculations. Exact parameter links can connect phases and datasets and eliminate dependent variables.
17. Added a dedicated About action left of Panels and made the application title static. Phase renaming uses Edit beside the colour picker; phase removal is available on each phase row. Removed redundant Method/Structure headings, moved dataset deletion beside Save group and exclusions after Background, and replaced the resolution-function selector with calibration Load/Save actions and automatic profile detection.
18. Widened the divider and added a visible resize grip. Exclusions use the standard dataset group header. Absorption data loads automatically without a toolbar button. Copy controls identify their source and parameter/flag scope and hide for a single dataset. Instrument profiles are selected only in Datasets, with TCH as the default and independent sample size/strain for all available families. Removed the Next calculation inspector, Method navigation shortcuts and History heading; FIT follows the selected command method.
19. Flattened Method setup and CF/Wyckoff settings, putting concise instructions and prerequisite warnings in the FIT block. Renamed the space-group count to Number of reflections, defaulted it to the available intensities (maximum 600), and added strict integer/range validation; changing it rebuilds the precision block used by the test. Kept runs now carry a visible marker in selectors and History cards, with Set versus Keep explained in the interface and documentation.
20. Simplified empty views: hide the phase chooser without phases, show only the loading hint and demo link without datasets, and hide Method setup until both exist. Documented that successive fits start from each dataset's latest working values.
21. Greyed out Anchors when the plotted view cannot display spline anchors, retaining its saved preference. Replaced CF formula naming with a checkbox applied when copying atoms; selected sites, manual element types, cancellation and archived results are preserved.
22. Added optional CF adaptation with a data assessment and parameter-plan preview: raw I/σ and resolution shells, fitted-width overlap grouping shared by CPU/GPU, three settings across 6–12 starts, paired independent seeds and map comparisons allowing periodic translations and inversion. Search parameters, seeds, errors and correlations are retained in History and reports. Manual settings remain available, no extra intensity cutoff is applied, and stopping preserves the best completed map. Fixed P1 site extraction to keep its unconstrained origin. The parameter rules are documented as heuristics with controlled numerical and workflow validation.

23. Added profile-conditioning diagnostics: negative instrument Gaussian variance over the fitted range, locally dependent parameter combinations and zero-effect variables. Results and dataset statistics retain the reasons in reports, History and projects. Missing uncertainties are labelled as unavailable rather than declaring every affected parameter unconstrained. Fixed numerical cancellation in the negative-variance width continuation on CPU and WebGPU; refinement flags and fitted coefficients are preserved.

The application and fit core report version **2.6**. Projects now use format 3 in a compressed `.powder6` archive, with binary observations stored once and persistent calculation history.

Run the regression checks with:

```sh
node --test tests/regressions.test.cjs
```
