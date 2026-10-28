# Structure factors and symmetry audit — 28 October 2026

Review only; application files were not changed. Comparison uses the current GSAS-II Read the Docs developer documentation (69a3d4, 27 October 2026). Formula equivalence was checked by source inspection; no installed GSAS-II executable was used.

## Confirmed findings

### P1: A manual cell contraction can delete the entire structure

Locations: `js/sg_convert.js:137–143`, `js/sg_convert.js:253–269`, `js/sg_convert.js:319–321`; acceptance path `js/rietveld/rv_phases.js:477–485`.

`relation()` checks only the finite operator lists for subgroup inclusion. It does not check that the translations of the proposed new unit cell belong to the old translation lattice. For P1 → P1 with `P = diag(1/2,1,1)`, it reports `same`. `convertStructure()` takes only old atoms whose transformed positions land inside the smaller cell. It never establishes that the original structure repeats with that smaller translation, so missing atoms do not become violations. The cell-content discrepancy is displayed as a warning at `rv_phases.js:401`, but the dialog validation accepts it.

Reproduced using the actual application's `convertPlan` and `applyConversion` functions exposed only inside an in-memory Node VM (no application edit): P1 cell 10,10,10 Å, one C1 at (.75,.1,.1), manual basis `1/2a,b,c`, origin `0,0,0`, tolerance .1 Å. Plan returned `relation:'same'`, `atoms:[]`, `violations:[]`, `dsBad:[]`, `contentExpected:0.5`; applying it left zero atoms and a=5 Å.

Fix direction: validate translation-lattice containment, and validate that every old atom is represented under the proposed smaller translation lattice. Reject an inconsistent contraction rather than treating content mismatch as an informational warning. A total atom-count check alone is insufficient for a multi-element structure.

### P2: Invalid triclinic cells pass the new-phase volume validation

Locations: `js/crystal.js:203–209`; `js/rietveld/rv_commands.js:308`.

`cellVolume()` clamps its determinant factor to 1e-12 before taking a square root. As a result, a nonphysical cell has a positive volume. The new-phase dialog validates each angle independently and calls this helper to require positive volume, so it accepts angles that cannot form a metric tensor. For a=b=c=10 Å, alpha=beta=10°, gamma=170°, it returns 0.001 Å³ even though the metric determinant is negative. `buildInvDsq()` correctly returns null for this cell (`crystal.js:301–305`), so geometry and phase validation disagree; the accepted phase cannot yield a valid reflection list.

Fix direction: reject a nonpositive metric determinant at input and refinement boundaries; make the volume helper report invalidity rather than inventing positive volume. The same clamp in `cellBasis()` should be reviewed.

### P3: Minimum-image distances remain incorrect for sufficiently skew, non-reduced cells

Locations: `js/crystal.js:185–196`; related, even narrower search at `js/sg_convert.js:41–48`.

The finite ±2 translation search in `fracDistance()` is not a general closest-lattice-vector algorithm. For the valid cell a=1, b=c=10 Å, alpha=beta=90°, gamma=1°, displacement (.49,.49,0), it returns 2.6107409367 Å. Explicit search finds 0.3985367856 Å using translation (-5,0,0). These unusual cells can be entered or produced by a manual basis transform. Distances underpin atom matching, deduplication and special-position handling; arbitrary-basis symmetry workflows therefore cannot rely on these routines as exact minimum-image distances.

Fix direction: reduce the lattice or use a metric-bounded closest-vector search. Scope is strongly skew/non-reduced cells, not ordinary orthogonal or standard monoclinic cells.

## Coverage and comparison

| Area | Powder 6 behavior inspected | Assessment |
|---|---|---|
| X-ray f0 | `scatterers.js`, `rietveld_core.js:382–390`: Gaussian coefficients evaluated at sin(theta)/lambda = (1/d)/2 | Matches expected variable convention; Waasmaier–Kirfel coefficients may differ numerically from another selected GSAS-II table |
| Anomalous scattering | Dataset f-prime/f-double-prime with energy interpolation; `rietveld_core.js:741–815` computes Friedel-pair average | Core complex-intensity formula is correct for an untextured powder pair; independent wavelength-dependent anomalous factors of the doublet were not numerically cross-checked |
| Neutron | Signed coherent lengths retained, independent of scattering angle; zero lengths accepted | Correct basic nuclear CW model; no claim of magnetic, resonant complex-neutron or isotope-selection parity |
| Displacement parameters | Scalar B with exp(-B/(4d²)); CIF Uiso converted by 8 pi² | Correct isotropic convention. No six-component atomic Uij model exists; anisotropic peak broadening is a separate feature |
| CIF anisotropic atoms | `cif_structure.js:47–61` reads only Biso/Uiso; `rv_commands.js:342` defaults absent values to B=.5 | Capability gap: a CIF with only an anisotropic tensor loses its ADP information. A warning or explicit Ueq conversion would be preferable; no full anisotropic import is implemented |
| Occupancy/site multiplicity | `rietveld_core.js:750–789` multiplies occupancy by site multiplicity / coset-representative count | Correct accounting for stabilisers and centring in inspected code |
| Preferred orientation | `rietveld_core.js:821–842`: reciprocal-metric March–Dollase correction averaged over reflection equivalents | Same basic model as GSAS-II `GetPrefOri`; Powder 6 does not implement the broader spherical-harmonic texture choices |
| Lattice conventions | `crystal.js:80–111`, `rietveld_core.js:207–220`: cubic/tetragonal/orthorhombic/monoclinic metric constraints; R groups use hexagonal axes | Coherent implementation for supported settings; rhombohedral-axis :R input is explicitly unsupported, not a general setting conversion |
| Special positions | `rietveld_core.js:308–370`: stabiliser, coordinate null-space, exact dependent coordinates | Approach is sound for valid cells and closed stabilisers; 0.02 Å tolerance can snap near-special input by design |
| Reflection generation | `rietveld_core.js:250–281`: actual operator orbits + Friedel mates, multiplicity, systematic absences | No concrete discrepancy found by inspection. a/dmin, b/dmin, c/dmin bounds are valid even for oblique cells |
| Cell transforms | `sg_convert.js`: G'=PᵀGP, x'=P^-1(x-p), reciprocal h'=hP | Algebra agrees with declared basis convention; the contraction validation defect above remains |
| Subgroups | `sg_subgroups.js`, Moyo standardisation, conversion UI | Existing regression covers maximal Fm-3m subgroups and conversion; no exhaustive independent 230-group subgroup benchmark performed |

## Verification

GSAS-II export setting caveat: Powder 6 exports setting-qualified symbols such as `Fd-3m:1`, Hall names and explicit symmetry operators. The GSAS-II CIF phase reader does not simply ignore the latter: its lines 741–794 compare operators and can invoke Bilbao standardisation or apply an origin-1-to-origin-2 shift. A lack of Hall-symbol parsing alone therefore does not establish a silent origin error. No installed-GSAS-II round-trip result was obtained, so alternative-origin exchange remains a validation limitation rather than a confirmed defect here.

`node --test tests/numerics.test.cjs tests/anomalous.test.cjs tests/cif-structure.test.cjs tests/regressions.test.cjs`: **169 passed, 0 failed**. Additional standalone Node calculations reproduced all three findings. The contraction was also reproduced through actual application plan/application functions in a VM.

## Primary references

- [GSAS-II structure-factor and refinement routines](https://gsas-ii.readthedocs.io/en/latest/GSASIIstruc.html#GSASII.GSASIIstrMath.StructureFactor2)
- [GSAS-II structure-factor / preferred-orientation source](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIIstrMath.html#GetPrefOri)
- [GSAS-II lattice transforms, site symmetry and cell constraints](https://gsas-ii.readthedocs.io/en/latest/GSASIIutil.html#GSASII.GSASIIlattice.TransformCell)
- [GSAS-II CIF phase reader source](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/imports/G2phase_CIF.html)

The defect reproductions above are direct observations of Powder 6. GSAS-II documentation provides the comparison baseline, rather than evidence that GSAS-II was run on these same fixtures.
