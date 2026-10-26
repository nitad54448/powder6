/* Elemental mass-attenuation tables: parsing, validation and interpolation.
 *
 * No DOM and no application state: js/rietveld/rv_absorption.js keeps the loaded table, the UI and the
 * Bragg–Brentano estimate, and calls this. The Node suite calls the same functions, which is the point of the
 * split — the table rules are the part that must not drift.
 *
 * A document is either
 *     { energyUnit, source, elements: { Pb: { mu: [[E, mu/rho], ...], unit: 'cm2/g' } } }
 * or that object of elements without the "elements" wrapper. A bare energy is read in the document's
 * energyUnit, else defaultUnit, else eV; an element may override it. The coefficient is always a MASS
 * attenuation, cm²/g — never a linear one, which would be wrong by the density.
 */
var AbsorptionTable = (function () {
  'use strict';

  function unitFactor(unit) {
    const raw = String(unit == null ? '' : unit).trim();
    const u = (raw || 'eV').toLowerCase().replace(/\s/g, '');
    if (u === 'ev') return 1;
    if (u === 'kev') return 1000;
    if (u === 'mev') return 1e6;
    throw new Error('Energy unit must be eV, keV or MeV, not "' + raw + '".');
  }

  /** Periodic-table case, so Fe, fe and FE are one element and a lookup by element symbol always finds it. */
  function elementKey(text) {
    const s = String(text == null ? '' : text).trim();
    if (!/^[A-Za-z]{1,2}$/.test(s)) return '';
    return s.charAt(0).toUpperCase() + (s.length > 1 ? s.charAt(1).toLowerCase() : '');
  }

  /**
   * Validates a whole document and returns { Pb: { rows: [[eV, mu/rho], ...], source } }.
   *
   * Everything is checked before anything is returned, so a caller can replace a working table only with a
   * table that is entirely usable. Keys that are not element symbols are document metadata and are skipped.
   */
  function normalize(doc, defaultUnit) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Expected an elemental absorption JSON object.');
    const source = doc.elements === undefined ? doc : doc.elements;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('"elements" must be an object of element tables.');
    const out = {}, factor = unitFactor(doc.energyUnit || defaultUnit || 'eV');
    Object.keys(source).forEach(function (key) {
      const el = elementKey(key);
      if (!el) return;                                     // document metadata: source, unit, comment, ...
      if (out[el]) throw new Error(el + ': the document holds two entries for this element ("' + key + '").');
      const item = source[key];
      if (!item || typeof item !== 'object' || !Array.isArray(item.mu) || item.mu.length < 2)
        throw new Error(key + ': expected at least two [energy, mass coefficient] pairs.');
      if (item.symbol && elementKey(item.symbol) !== el)
        throw new Error(key + ': symbol "' + item.symbol + '" does not match its key.');
      const unit = String(item.unit == null ? (doc.unit == null ? '' : doc.unit) : item.unit)
        .replace(/\s/g, '').replace(/²/g, '2').replace(/\^/g, '');
      if (unit !== 'cm2/g') throw new Error(key + ': coefficients must have unit cm²/g, not "' + (unit || '(none)') + '".');
      const f = item.energyUnit ? unitFactor(item.energyUnit) : factor;
      let last = -Infinity;
      const rows = item.mu.map(function (pair, i) {
        if (!Array.isArray(pair) || pair.length !== 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || !(pair[0] > 0) || pair[1] < 0)
          throw new Error(key + ': invalid coefficient pair ' + (i + 1) + '.');
        const E = pair[0] * f;
        if (!Number.isFinite(E) || E <= 0) throw new Error(key + ': pair ' + (i + 1) + ' has an energy out of range.');
        if (E < last) throw new Error(key + ': energies must be ordered (pair ' + (i + 1) + ' comes before the one above it); an equal-energy pair is allowed at an absorption edge.');
        last = E;
        return [E, pair[1]];
      });
      out[el] = { rows: rows, source: String(item.source || doc.source || 'user table') };
    });
    if (!Object.keys(out).length) throw new Error('No elemental absorption tables found (keys must be element symbols).');
    return out;
  }


  /**
   * µ/ρ at photon energy E (eV).
   *
   * Log-log inside a bracket (a power law is the right interpolation for attenuation), the post-edge value at
   * a duplicated energy, and a refusal rather than a lie across a sharp edge — linear interpolation over a
   * coarse edge is wrong by a factor, not by a percent.
   */
  function coefficient(table, el, E) {
    if (!table) return { error: 'The absorption table is not loaded.' };
    const key = table[el] ? el : elementKey(el);
    if (!key || !table[key]) return { error: 'No mass attenuation table for ' + el + '.' };
    if (!(E > 0)) return { error: 'A positive photon energy is required.' };
    const rows = table[key].rows, n = rows.length;
    if (!(E >= rows[0][0] && E <= rows[n - 1][0]))
      return { error: key + ': photon energy ' + E.toFixed(1) + ' eV is outside the table (' +
               rows[0][0].toFixed(1) + '–' + rows[n - 1][0].toFixed(1) + ' eV); no extrapolation.' };
    // Upper bound: an exact energy takes the POST-edge row when the table holds two.
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= E) lo = mid + 1; else hi = mid; }
    const a = rows[Math.max(0, lo - 1)];
    if (a[0] === E || lo === n) return { value: a[1] };
    const b = rows[lo];
    if (!(b[0] > a[0])) return { value: a[1] };            // validation keeps this out; never divide by zero
    if (b[1] > a[1] * 1.25 && b[0] / a[0] < 1.2)
      return { error: key + ': ' + E.toFixed(1) + ' eV lies between ' + a[0].toFixed(1) + ' and ' +
               b[0].toFixed(1) + ' eV, across a sharp absorption edge; add resolved edge values instead of interpolating over it.' };
    const t = Math.log(E / a[0]) / Math.log(b[0] / a[0]);
    if (!Number.isFinite(t)) return { value: a[1] };
    return { value: a[1] > 0 && b[1] > 0 ? Math.exp(Math.log(a[1]) + t * Math.log(b[1] / a[1])) : a[1] + t * (b[1] - a[1]) };
  }

  return { unitFactor: unitFactor, elementKey: elementKey, normalize: normalize, coefficient: coefficient };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AbsorptionTable;
