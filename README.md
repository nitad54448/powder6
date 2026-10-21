# Powder 6

Version **2.6**, 21 October 2026. See [corrections](CHANGELOG.md).

Refine powder diffraction patterns in the browser. Several phases and several patterns in one session, each phase by **Rietveld**, **Le Bail** or **WPPF**, fitted individually or in one global fit, with **structure solution** from the extracted intensities. Everything runs locally; nothing is uploaded.

Full documentation: [`Powder6_documentation.html`](Powder6_documentation.html): methods, the instrument and Lorentz-polarisation model, peak shapes, every kind of constraint (cell, special positions, atomic constraints, limits, sharing), uncertainties, structure solution, and where Powder 6 differs from Powder 5.

## Features

- Constant-wavelength X-ray and neutron data, Kα₂ doublet, polarisation, sample displacement and transparency.
- Rietveld (atoms, scale, March–Dollase orientation, weight fractions), Le Bail and WPPF phases in the same dataset.
- Individual or global fits, with a shared/local padlock on every parameter.
- LM refinement, or parallel tempering with an LM finish; exact derivatives where the model is linear; special positions constrained, not corrected afterwards; GSAS-II style atomic constraints.
- Chebyshev or spline background, excluded regions, instrument calibration separate from sample broadening.
- Space-group test, charge flipping (WebGPU with CPU fallback) and a Wyckoff-site search (WebGPU), handing the atoms back for a Rietveld fit.
- Readers for xy/csv/txt, PANalytical `.xrdml`, Bruker `.brml`/`.uxd`, Rigaku `.ras`/`.rasx`, Philips `.udf`/`.rd`/`.sd`, GSAS `.xra`/`.esd`, Jade `.mdi`, pdCIF, and project files.
- Results as text, CIF, pdCIF, SHELX HKLF 4 and a PDF report; command line, undo and a restorable log.

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
| `lib/jszip.min.js` | `.brml` and `.rasx` files are refused |
| `absorption.json` | load a table yourself in Datasets → Absorption |
| `Voigt_default.json`, `TCH_default.json`, `Split_default.json` | no starting peak-shape presets (in `TCH_default.json`, X is the 1/cos θ term and Y the tan θ term, as in GSAS-II; "version": 2) |

## Typical workflow

1. Read patterns (File menu or drop them on the window) and check **Datasets → Instrument**.
2. Add phases: **Phases → From CIF**, or a new phase from a space group and cell.
3. In **Solve**, choose Le Bail or WPPF and refine scale and background, then zero and cell, then peak shape.
4. With atoms in the phase, switch it to Rietveld and refine positions, B and occupancies.
5. For an unknown structure: WPPF fit → extract intensities → space-group test → charge flipping or Wyckoff search → back to Rietveld.
6. Save the project, the results or a PDF report from the File menu.

## Command line (bottom of the window)

`fit`, `globalfit`, `stop`, `steps>>cell`, `tick>>p1\.a`, `scales`, `range>>10&80`, `bkg>>6`, `anchors>>12`, `exclude>>a&b`, `method>>wppf`, `phases`, `sharing`, `simulate`, `select>>text`, `demo`, `gsas2`, `undo`, `cmd` (lists the commands), `help` (opens the documentation in a new tab).

## Notes for developers

- `js/rietveld_core.js` is DOM-free and shared by the page and `rietveld_worker.js`.
- CSS variables read by canvas plots (`--plot-*`, `--series-*`, `--phase-*`, `--calc-line`…) must stay plain values (`#hex`, `rgb()`, `px`).
- `powder6.css` is the single source of truth for all light/dark tokens, layout and component styles.
- Run the import, weighting, fit-state and export regression checks with `node --test tests/regressions.test.cjs` (Node.js; no additional packages).

## References

Dragoe (2001), J. Appl. Cryst. 34, 535 (PowderV2, the ancestor of this program); Le Bail, Duroy and Fourquet (1988); Pawley (1981); Toraya (1986); Golub and Pereyra (1973); Thompson, Cox and Hastings (1987); Hill and Howard (1987); Markvardsen, David, Johnson and Shankland (2001); Oszlányi and Sütő (2004, 2005, 2008). The full list is in the documentation.
