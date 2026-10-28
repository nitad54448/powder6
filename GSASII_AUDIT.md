# Powder 6 comparison with GSAS-II

Implementation update: version 2.49.1 addresses the P1/P2 findings below. The anomalous Fourier combination now produces an explicit refusal because the map engine does not implement that correction. The two P3 findings remain outside the requested main-issue fixes. See [the correction notes](CHANGELOG.md). The topic reports below preserve the original review evidence.

Correction validation: **254 Node tests passed**, plus browser suites for Fourier maps (8 checks), conversion/file workflows (6), subgroups (2), and file readers (6). The standalone `node audit_refinement_repro.cjs` now verifies the corrected Fourier response and shared-restraint count. No installed GSAS-II execution was used.

28 October 2026 · Powder 6 version 2.49.0 · Review only; application code unchanged.

Three agents reviewed profiles/corrections, structure/symmetry, and refinement/extraction in parallel. The primary reviewer checked file exchange and assembled these results. The comparison used GSAS-II Read the Docs and its rendered implementation source. It did not run an installed GSAS-II executable, and does not establish numerical equivalence across programs.

## Findings, in recommended repair order

| Priority | Finding | Location | Evidence / impact |
|---|---|---|---|
| P1 | Independent Fourier observations collapse into one overlap group | `js/fourier_map.js:138` | Extraction uses group=-1 for independent peaks. Swapping measured areas 2 and 18 leaves the difference map exactly unchanged; independent group keys restore a nonzero response. Affects observed, difference and 2Fo-Fc maps. |
| P1 | Manual cell contraction can delete the entire atomic model | `js/sg_convert.js:137`, `js/rietveld/rv_phases.js:477` | P1, cell 10/10/10, C at (.75,.1,.1), manual basis 1/2a,b,c: accepted plan, no violations, then zero atoms and a=5. The smaller translation lattice is not validated. Trigger requires an inconsistent manual transform; ordinary valid subgroup conversion was not shown to fail. |
| P2 | Multi-bank GSAS input silently retains only its first bank | `js/parsers.js:749` | Two valid CW banks produce one pattern and no warning. Import every bank or explicitly report the restriction. |
| P2 | GSAS STD counter counts do not enter statistical weights | `js/parsers.js:774` | The I2 counter is stripped, and sigma is omitted. For counter n, expected variance is I/n; fallback variance I is wrong when n differs from one. |
| P2 | XYE output rounds small positive values to zero | `js/rietveld/rv_gsas2.js:104` | y=1e-7 and sigma=1e-8 export as 0 0. GSAS-II then drops the observation's weight. Zeroed sigma on larger intensities replaces supplied weights with counting weights. |
| P2 | Shared restraints inflate the global degrees of freedom | `js/rietveld_core.js:2306` | For fully shared geometry, H copies of K restraints contribute one normalized objective but HK statistical rows. Denominator excess is (H-1)K, lowering reduced chi-square and derived ESDs. |
| P2 | Fourier maps omit enabled anomalous corrections | `js/rietveld/rv_fourier.js:75` | Core Rietveld corrections do not reach the Fourier API. Established by input/formula tracing, without a numerical end-to-end anomalous-map benchmark. |
| P2 | Invalid triclinic metrics pass new-phase volume validation | `js/crystal.js:203`, `js/rietveld/rv_commands.js:308` | a=b=c=10, alpha=beta=10, gamma=170 returns positive volume although the metric determinant is negative. Reflection generation subsequently rejects the metric. |
| P3 | Fixed minimum-image search fails for extreme skew cells | `js/crystal.js:185` | Valid non-reduced cell a=1,b=c=10,gamma=1 degree gives 2.61074 Angstrom versus 0.398537 for the reproduced displacement. |
| P3 | Secondary-line sample size broadening uses lambda1 | `js/profile.js:1070` | Cu K-alpha example gives a 0.248% secondary size-width discrepancy against using lambda2. This is an internal consistency issue; GSAS-II also approximates secondary broadening, so this is not evidence of worse GSAS-II agreement. |

P1 denotes high-impact wrong results/model loss under the stated trigger, P2 a material data/statistical or validation defect, and P3 a limited numerical issue. Detailed reports explain each reproduction and recommended correction.

## Coverage of the requested areas

| Area | Review outcome | Detailed report |
|---|---|---|
| CW width/shape, asymmetry, size/strain, doublet | Instrument and separated sample width conventions agree algebraically. Empirical SL/HL differs from GSAS-II FCJ; tail and doublet approximations differ. | [Profiles and corrections](audit_profiles_corrections.md) |
| Instrument/sample corrections | LP and shift conventions checked; scale conventions explain overall normalization differences. No physical absorption-intensity, surface-roughness or TOF model; weight fractions lack propagated ESDs. | [Profiles and corrections](audit_profiles_corrections.md) |
| Structure factors | Inspected f0, complex anomalous core intensities, signed neutron lengths, isotropic B/U, occupancy/multiplicity and March-Dollase formulas are consistent. Atomic anisotropic Uij is unsupported. | [Structure and symmetry](audit_structure_symmetry.md) |
| Refinement engine | R factors, reduced chi-square/GOF reporting, LM, exact constraint elimination, joint matrices and covariance paths checked. Shared-restraint count issue remains. | [Refinement and extraction](audit_refinement_extraction.md) |
| GSAS-II/file exchange | ZIP is a transfer bundle requiring manual setup, not a GPX project. Instrument export exists; GSAS instrument-file import does not. Pattern-reader and XYE findings above. CIF is isotropic and relies on symbol/Hall/number resolution rather than operator-only setting inference. | [File exchange](audit_file_exchange.md) |
| Extraction/solution | Nonnegative WPPF, Le Bail, charge flipping and Fourier reviewed. Existing CF checks passed; Fourier observation grouping needs urgent correction. | [Refinement and extraction](audit_refinement_extraction.md) |
| Symmetry | Site constraints, cell constraints, reflection generation and basis algebra inspected. Manual contraction, invalid metric and extreme skew-distance defects reproduced. No exhaustive independent subgroup benchmark. | [Structure and symmetry](audit_structure_symmetry.md) |

## Validation and sources

The complete existing Node suite passed: `node --test tests/*.test.cjs` — **247 passed, 0 failed**. Focused reproductions exercise real parsers, exporters, Fourier builds and conversion planning/application through Node/VM. Passing existing tests does not cover the newly found cases. Browser UI end-to-end, installed GSAS-II imports/refinements, and exhaustive GPU agreement were not run.

Primary comparison sources:

- [GSAS-II structure/refinement modules](https://gsas-ii.readthedocs.io/en/latest/GSASIIstruc.html)
- [GSAS-II powder profile and correction source](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIIpwd.html)
- [GSAS-II Fourier and computation routines](https://gsas-ii.readthedocs.io/en/latest/GSASIImath.html)
- [GSAS-II importer documentation](https://gsas-ii.readthedocs.io/en/latest/imports.html)
- [GSAS-II instrument-file reader](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIIfiles.html#ReadInstprm)

The linked topic reports contain more specific source links and the limits of each comparison. Formula inspection without a finding means no discrepancy was verified in that scope, not proof of full implementation equivalence.
