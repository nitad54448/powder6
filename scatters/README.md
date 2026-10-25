# Scattering tables

`xray_wk1995_ions.json` contains ordinary f0 Gaussian coefficients from cctbx WK1995. `neutron.json` contains coherent neutron lengths.

`anomalous_chantler.json` is an unchanged copy of Hephaestus `data/scattering.json`, added 25 October 2026. Its 92 element records cover H through U. Each record contains `source: "Chantler"` and ordered `[energy_eV, f_prime_electrons, f_double_prime_electrons]` rows. The second column is the anomalous correction, not the full scattering factor; it must not have Z subtracted again.

Source: C. T. Chantler et al., [NIST X-Ray Form Factor, Attenuation, and Scattering Tables](https://www.nist.gov/publications/x-ray-form-factor-attenuation-and-scattering-tables). The [XrayDB table documentation](https://xraypy.github.io/XrayDB/xraydb.pdf) describes the f-prime/f-double-prime column convention used by these arrays.

Powder 6 performs bounded linear interpolation in photon energy. It does not claim the spline interpolation of other libraries, invent absent elements, or extrapolate beyond the tabulated range. Exact repeated-energy entries select the last (post-edge) row. The correction is evaluated at lambda1 and applies to the existing pattern/doublet model. Used numerical values and provenance travel with each fit job and completed result.
