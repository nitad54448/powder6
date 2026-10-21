# Corrections

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

The application and fit core report version **2.6**. The project format remains version 2; per-point `weights` is an optional dataset field.

Run the regression checks with:

```sh
node --test tests/regressions.test.cjs
```
