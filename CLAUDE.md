# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Powder 6: a no-build, no-dependency browser app for Rietveld / Le Bail / WPPF refinement of powder diffraction patterns, plus structure solution (charge flipping, Wyckoff search) and symmetry tools. Plain scripts loaded by `index.html`; there is no bundler, no `package.json`, no lint step.

## Commands

Serve over HTTP (browsers block `fetch` on `file://`): `python -m http.server 8000`, then open `http://localhost:8000/index.html`.

Tests (no install needed; Node 24 and Chrome or Edge):
- Node suites: `node --test tests/*.test.cjs` (regressions, anomalous, cf-adaptive, cf-startup, numerics, project-unpack, density-boundaries, wyckoff-adaptation); GitHub Actions (`.github/workflows/tests.yml`) runs the same glob on every push
- One Node test: `node --test --test-name-pattern="part of the test name" tests/regressions.test.cjs`
- A browser page (headless Chrome, with WebGPU): `node tests/run-webgpu.cjs "" tests/<name>.html` (the `""` picks Chrome/Edge from the default Windows paths; pass an executable path otherwise). Pages: `workspace`, `parameter-controls`, `subgroups`, `ui-interactions`, `ui-consistency`, `pattern-only`, `project-save`, `project-symmetry`, `addsym-pbso4`, `convert-files`, `file-readers`, `phase-atoms`, `solve-fixes`, `history-stop`, `cf-transfer`, `cf-adaptive`, `wyckoff-search`, `webgpu-pt`, `wppf-intensities`, `constraint-layout`, `constraint-refine`, `restraints`, `restraints-helper`, `wyckoff-helper`, `fourier` (every `tests/*.html`; a new page goes in this list). Add a page by writing `tests/x.html` + `tests/x.js` that sets `window.browserTestResult = {ok, results}` (see `tests/solve-fixes.*`).
- Several browser pages can run in parallel, but the whole set at once occasionally times out the two ADDSYM pages; rerun those alone.

## Rules of this repo

- **Every change bumps the version and adds a CHANGELOG section**, unasked: `RV.version` in `js/rietveld/rv_ui.js` (semver: feature or behaviour change = MINOR, fix = PATCH), a new top section in `CHANGELOG.md`, and the version line in `Powder6_documentation.html` ("Recent changes"). README/documentation text that a change makes stale is updated in the same commit.
- Git stores LF (`* text=auto` in `.gitattributes`); in the working tree most files are CRLF and some LF (`powder6.css`, several `js/*.js`). Keep each file's own ending, uniform: Git Bash `sed -i` rewrites CRLF files as LF (convert back, or edit another way), Python must read and write bytes (or `newline=''`) and must not write `\r\n` into an LF file. Git's LF-to-CRLF warnings are expected.
- CSS (`powder6.css`): every font size, radius and control height is one of the tokens of `:root` (`--fs-*`, `--radius*`, `--ctl-h*`), colours are variables (no hex in rules, no `!important` except the global `[hidden]` and the busy cursor), and a new rule goes in its section, next to the rules it adapts, not at the end of the file. Spacing is the scale `--sp-1…5` (4, 8, 12, 16, 24 px) and `--inset` (the side margin of a panel), tabs are `--tab-h` high, shadows are `--shadow-1`, `--shadow-pop` and `--shadow-3`; style by class, not by `#id` (an id is for the script). Boxes of one look (cards, accordions) share one rule. Panel layouts use flexible columns (`minmax`, `fr`), not fixed pixel widths, because the command panel is resizable. Help that belongs to a whole block is one question-mark icon at the right end of its accordion title (`block()` in `rv_solve.js`, `.acc > summary .acc-help`), never a mark after a field; field help is the tooltip of its label and control.
- Code style is dense ES5-style (`var`, `function`) in `js/rietveld/`, long single-line statements are normal; match the surrounding file.
- Commit messages are the version number as subject (e.g. `2.15.0`) with a short body.

## Architecture

**Two layers.** Reusable numerics live in `js/*.js` (UMD-style: browser globals, `importScripts` in workers, `module.exports` for Node tests); the application is `js/rietveld/rv_*.js`, namespace `RV`, loaded as ordered `defer` scripts in `index.html` (`rv_app.js` checks every module is present before starting; load order matters).

**State.** `RV.state` (`rv_state.js`) owns everything: `S.datasets`, `S.phases`, per-method banks (`calculations` for rietveld/lebail/wppf), shared flags, limits, parameter links, settings. Parameters are flat named maps (`p1.a`, `p1.Fe1.x`, `bkg0`, `inst.U`…; `RVCore.classify(name)` parses them). A phase holds the starting model (`ph.v`); each dataset holds its own values (`ds.p`, `ds.fit`, `ds.esd`). Changes are announced on `RV.bus`. `RV.history` keeps restore points (undo); `RV.fitHistory` keeps calculation records. Projects are zip files (`rv_project.js`, JSZip) with `project.json` from `St.projectJSON`, validated by `prepareProject` and applied by `commitProject`: anything new in state must be added to save, load, restore points (`RV.history`) and History restore. Format 4 keeps every large numeric block in its own binary entry (observation columns, `solution/precision.*`), never in the JSON; the saved-state comparison uses `RV.solve.archiveFingerprint()`, not a copy of the archive, and any async startup load that writes state (the preset files, `RV.cmd.defaultPresetsReady()`) must be awaited before a save or a project open takes its snapshot.

**Fitting.** `js/rietveld_core.js` (+ `profile.js`, `crystal.js`, `wppf_linear.js`, `atomic_constraints.js`) does the model and the LM / parallel-tempering fit; it runs in `rietveld_worker.js` pooled by `RV.pool` (`rv_commands.js`). Fit modes: individual (parallel, independent), global (one joint fit, shared parameters). WebGPU parallel tempering is `pt_gpu.js`.

**Structure solution (the Solve/Structure tab, `rv_solve.js`).** WPPF extraction -> space-group test (`rv_sgtest.js`) -> charge flipping (`charge_flipping_worker.js` + `charge_flipping.wgsl`, GPU with CPU fallback) or Wyckoff search (`wyckoff_worker.js` -> `swarm_wyckoff.js` + `swarm_reflection.wgsl`, WebGPU only) -> atoms handed back to the phase. The Wyckoff pieces are tied together: `js/wyckoff_limits.js` is the single source of limits/defaults/shape definitions read by the page, the worker and (injected as constants at compile time) the kernel; `wyckoff_assign.js` enumerates Wyckoff assignments and packs distance rules; the kernel's array sizes are injected by `swInject`, and a kernel older than the host is refused by marker checks. Changing a rule/parameter layout means changing the WGSL, the packer and the injector together.

**Restraints and maps.** `js/distance_rules.js` is the one parser of the rule language (`A B N dmin/dmax [shape]`), used by the Wyckoff search (elements) and by the Rietveld restraints (`atom_restraints.js`: atom labels; soft rows added to chi^2 and to the normal equations in `rietveld_core.js`, with numerical derivatives; stored as `ph.restraints`, edited in `rv_restraints.js`, molecule files in `molecule_rules.js`). Fourier maps: `fourier_map.js` (pure) and `rv_fourier.js`, a fourth Structure result kind `fo` with no run history.

**Symmetry.** Space-group data: `sg/all.json` (+ `sg_engine.js` resolver, `sg_convert.js` for change-of-basis conversion, `sg_subgroups.js` for the maximal t/k subgroups the Subgroups… dialog lists, named by Moyo). ADDSYM uses the bundled Moyo WASM in `symmetry_worker.js` (one persistent module worker); the page-side logic is in `rv_phases.js` and `sg_convert.js`.

**Data in/out.** Pattern readers: `parsers.js`, `data_io.js`; structures: `cif_reader.js`, `cif_structure.js`; scattering tables in `scatters/`; exports in `rv_results.js`, `rv_gsas2.js`, `rv_pdf.js`.

## Gotchas

- Tests run the real app in an iframe/headless Chrome; many UI checks depend on exact labels and element ids, so renaming a button usually means updating `tests/workspace.js` and docs.
- The Node tests load app modules into a `vm` context (see `app()` in `tests/regressions.test.cjs`): a new module needed there must be added to its file list.
- Scratch/experiment scripts belong outside the repo; `test_files/` holds real patterns and CIFs used by tests.
