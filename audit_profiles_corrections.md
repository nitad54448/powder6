# GSAS-II comparison: peak profiles and instrument/sample corrections

Reviewed 28 October 2026. Review only: application files were not changed.

## Findings and limits

### P3 — Secondary-line crystallite-size broadening uses the primary wavelength

Location: `js/profile.js:1070` and `js/profile.js:414`.

The second component receives its own angle, but `prepareVoigt(basePos2, ..., params)` receives the original `params.lambda`. The separated size expression is proportional to `lambda / (D cos(theta))`; the secondary component therefore combines theta2 with lambda1. For a consistent two-wavelength physical model, prepare that component with lambda2. Instrument and strain terms should continue to use their appropriate angle dependence.

Executed a Node/VM reproduction loading `constants.js`, `crystal.js` and `profile.js`: separated TCH, no instrument width, size=0.1 micrometre (100 nm), Lorentzian size mixing=1, strain=0, lambda1=1.540598, lambda2=1.544426, primary angle=80 degrees. The component positions are 80 and 80.2391274695 degrees. Current secondary Lorentz width is 0.1154303696 degrees; using lambda2 in the size expression yields 0.1157171851 degrees, a -0.247859% error. The absolute effect for a normal K-alpha doublet is small.

This is an internal physical consistency issue, **not a demonstrated discrepancy against GSAS-II's own second-line approximation**: the GSAS-II implementation also reuses primary-reflection broadening values for its secondary component. Do not present this as evidence that Powder 6 is less accurate than GSAS-II for doublets overall. Powder 6 uses the exact secondary Bragg relation, whereas the compared GSAS-II code uses a first-order angle offset.

### Intentional model difference — SL/HL is empirical and cannot be transferred as FCJ SH/L

Locations: `js/profile.js:609–615`, `js/profile.js:737–740`, `js/rietveld/rv_gsas2.js:146`.

Powder 6 defines `a = SL/tan(theta) + HL`, then changes the profile coordinate by `delta /= 1 - clamp(a*delta, -0.95, 0.95)`. This is an empirical asymmetric coordinate warp. It is not the Finger–Cox–Jephcoat axial-divergence convolution used by GSAS-II. In particular the same low-angle-sided warp remains possible at high angles; the parameters are not physical source/sample lengths. The exporter already recognizes the difference and warns that these terms are not exported.

Treat calibrated SL/HL values as specific to Powder 6. For cross-program peak-shape agreement, a proper FCJ option is needed; renaming/copying coefficients is insufficient. Documentation around `Powder6_documentation.html:403` calls these axial asymmetry terms but could state the empirical nature as clearly as the exporter does. [GSAS-II FCJ function documentation/source](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIIpwd.html#getFCJVoigt3).

### Missing capability — Attenuation estimates do not apply absorption intensity corrections

Locations: `js/rietveld/rv_absorption.js:83–94`, `js/rietveld_core.js:877–884`.

The absorption module estimates attenuation and a Bragg–Brentano transparency displacement. The calculated integrated Rietveld intensity contains scale, multiplicity, LP, March–Dollase and F squared. It contains no cylindrical/flat-plate absorption multiplier, no Suortti surface roughness and no extinction correction. This is a feature boundary, not an incorrect implementation of an existing correction. A reader should not interpret the Absorption panel as enabling intensity absorption correction. GSAS-II supplies geometry-dependent absorption and surface roughness functions. [GSAS-II absorption and roughness source](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIIpwd.html#Absorb).

Consequently angle-dependent absorption/roughness can be absorbed into refined B, orientation and scale rather than corrected physically. Appropriate sample geometry must be considered before comparing those results with GSAS-II.

### Missing capability — Weight fractions have no propagated uncertainty

Location: `js/rietveld/rv_results.js:66–76`.

The returned objects contain mass fraction `w` but no uncertainty; neither cross-phase scale covariance nor cell/content uncertainty is propagated to it. This limits quantitative phase analysis even when parameter uncertainties are available. Point estimates follow the documented `S*Mcell*V` convention; do not replace that by GSAS-II's numerical scale formula without converting the scale convention first.

### Unsupported — TOF

Powder 6's model is constant-wavelength and uses a 2-theta axis. `js/parsers.js:756–760` accepts GSAS constant-angle `CONST`/`CONS` banks, not TOF bank conversion. No difC/difA/difB calibration, TOF pulse profile, wavelength spectrum or TOF Lorentz model is implemented. GSAS-II TOF files are outside the present supported scope; neutron support here means constant-wavelength neutron patterns.

## Verified agreement / deliberate differences

- `js/profile.js:414–420`: separated isotropic/uniaxial sample size and strain formulas and Gaussian/Lorentzian mixing agree algebraically with the GSAS-II CW expressions.
- `js/profile.js:417–418`: instrument variance is `U*tan(theta)^2 + V*tan(theta) + W`; Lorentz width is `X/cos(theta) + Y*tan(theta) + Z`. Gaussian variance and Lorentz widths use cdeg squared and cdeg respectively. The size UI converts nanometres to internal micrometres (`rv_state.js:368–369`).
- `js/profile.js:1054–1075`: each doublet line has an independently calculated position and sample displacement/transparency correction. Height weighting uses the primary/secondary profile-area ratio, preserving the documented integrated-primary intensity convention. Source ratio is not simply a peak-height ratio.
- `js/crystal.js:396–449`: LP is angle-dependent Lorentz times normalized polarization. The factor-of-two difference from GSAS-II's Lorentz normalization is an overall scale convention, not an angle-dependent bug. Neutron/no-polarization uses K=0 explicitly.
- `js/profile.js:117–118`: Powder 6 displacement/transparency are normalized coefficients; direct numerical transfer of GSAS-II micron/centimetre sample parameters is invalid. The UI documents a radius-based conversion. Zero is an additive angle offset.
- `js/rietveld_core.js:549–562`: spline background is a monotonic cubic interpolant. The alternate background is Chebyshev. Both are intentional supported models; these do not cover all GSAS-II background options.
- `js/profile.js:690–714`: finite support and pedestal subtraction differ from GSAS-II profile evaluation. Reported areas use the untruncated function, while rendering subtracts the pedestal. This documented convention needs to remain visible in precision cross-program comparisons, especially for very broad peaks reaching the 10-degree window cap.

The width/source comparison used [GSAS-II structure mathematics source](https://gsas-ii.readthedocs.io/en/latest/_modules/GSASII/GSASIIstrMath.html#GetSampleSigGam). Its functions also show the separate native-unit TOF treatment and covariance-based mass fractions. Exact output equality was not claimed: the reviewed implementations intentionally use different asymmetry, tail and doublet approximations.

## Validation performed

Read current local code and documentation; inspected the current GSAS-II Read the Docs rendered source. Executed the focused numerical reproduction above. No browser end-to-end or full numerical benchmark against an installed GSAS-II was performed in this subreview. No other concrete arithmetic error was verified in the separated CW width formulas.
