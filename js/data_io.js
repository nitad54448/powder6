// data_io.js
// Reads a pdCIF (powder-diffraction CIF) back into a pattern: profile, calculated profile, background,
// wavelength, cell, space group, reflections. parsers.js calls parsePdCifFile().
//
// Powder 6 does not write patterns from here. The writers are not included: (xy, uxd, xra, pdCIF),
// exportPattern(), reflectionStructureFactors() and reflectionHeightsFromFsq(). Nothing called them, and the last
// two depended on integratedPeakArea(), which exists nowhere in this code base.
//
// pdCIF data names come in several spellings (DDLm cif_pd 2.5.0, DDL1 aliases, deprecated items). cifTag() folds
// them onto one name so the reader compares against a single string.

/**
 * Legacy, deprecated and non-standard spellings, mapped to the one name the
 * reader compares against. Keys and values are lower case; CIF data names are
 * case insensitive.
 *
 * Entries marked "not a data name" were never in any dictionary -- they are
 * spellings seen in files from other programs. Keeping them costs one table
 * row and is the difference between loading such a file and rejecting it.
 */
const PDCIF_TAG_ALIASES = {
    // ---- core: cell, symmetry, radiation, audit, refinement ---------------
    '_cell_length_a': '_cell.length_a',
    '_cell_length_b': '_cell.length_b',
    '_cell_length_c': '_cell.length_c',
    '_cell_angle_alpha': '_cell.angle_alpha',
    '_cell_angle_beta': '_cell.angle_beta',
    '_cell_angle_gamma': '_cell.angle_gamma',
    '_space_group_name_h-m_alt': '_space_group.name_h-m_alt',
    '_symmetry_space_group_name_h-m': '_space_group.name_h-m_alt',
    '_space_group_it_number': '_space_group.it_number',
    '_symmetry_int_tables_number': '_space_group.it_number',
    '_space_group_name_hall': '_space_group.name_hall',
    '_symmetry_space_group_name_hall': '_space_group.name_hall',
    '_diffrn_radiation_wavelength': '_diffrn_radiation_wavelength.value',
    '_diffrn_radiation_wavelength_id': '_diffrn_radiation_wavelength.id',
    '_diffrn_radiation_wavelength_wt': '_diffrn_radiation_wavelength.wt',
    '_diffrn_radiation_probe': '_diffrn_radiation.probe',
    '_audit_creation_date': '_audit.creation_date',
    '_audit_creation_method': '_audit.creation_method',
    '_refine_ls_goodness_of_fit_all': '_refine_ls.goodness_of_fit_all',

    // ---- the point id. Four categories define one; PD_DATA holds the key,
    //      the others link to it, so they all mean the same column here.
    '_pd_data_point_id': '_pd_data.point_id',
    '_pd_meas_point_id': '_pd_data.point_id',
    '_pd_meas.point_id': '_pd_data.point_id',
    '_pd_proc_point_id': '_pd_data.point_id',
    '_pd_proc.point_id': '_pd_data.point_id',
    '_pd_calc_point_id': '_pd_data.point_id',
    '_pd_calc.point_id': '_pd_data.point_id',

    // ---- the angle axis ---------------------------------------------------
    '_pd_meas_2theta_scan': '_pd_meas.2theta_scan',
    '_pd_meas_angle_2theta': '_pd_meas.2theta_scan',        // 2.5.0 alias
    '_pd_proc_2theta_corrected': '_pd_proc.2theta_corrected',
    '_pd_meas_2theta_corrected': '_pd_proc.2theta_corrected',  // not a data name
    '_pd_meas_2theta_range_min': '_pd_meas.2theta_range_min',
    '_pd_meas_2theta_range_max': '_pd_meas.2theta_range_max',
    '_pd_meas_2theta_range_inc': '_pd_meas.2theta_range_inc',
    '_pd_meas_number_of_points': '_pd_meas.number_of_points',

    // ---- the intensity columns -------------------------------------------
    '_pd_meas_intensity_total': '_pd_meas.intensity_total',
    '_pd_meas_counts_total': '_pd_meas.counts_total',
    '_pd_proc_intensity_total': '_pd_proc.intensity_total',
    '_pd_proc_intensity_net': '_pd_proc.intensity_net',
    '_pd_calc_intensity_total': '_pd_calc.intensity_total',
    '_pd_proc_intensity_calc': '_pd_calc.intensity_total',     // not a data name
    '_pd_calc_intensity_bkg': '_pd_calc.intensity_bkg',        // 2.5.0, no alias
    '_pd_proc_intensity_bkg_calc': '_pd_proc.intensity_bkg_calc',
    '_pd_proc_intensity_bkg': '_pd_proc.intensity_bkg_calc',   // not a data name

    // ---- figures of merit -------------------------------------------------
    '_pd_proc_ls_prof_wr_factor': '_pd_proc_ls.prof_wr_factor',
    '_pd_proc_ls_prof_r_factor': '_pd_proc_ls.prof_r_factor',

    // ---- deprecated in 2.5.0 ----------------------------------------------
    '_pd_block_id': '_pd_diffractogram.id',
    '_pd_block.id': '_pd_diffractogram.id',
    '_pd_calib_2theta_offset': '_pd_calib.2theta_offset',
    '_pd_calib_2theta_off_point': '_pd_calib_xcoord.nominal_2theta',
    '_pd_calib.2theta_off_point': '_pd_calib_xcoord.nominal_2theta',

    // ---- reflections ------------------------------------------------------
    '_refln_index_h': '_refln.index_h',
    '_refln_index_k': '_refln.index_k',
    '_refln_index_l': '_refln.index_l',
    '_refln_d_spacing': '_refln.d_spacing',
    '_refln_f_squared_meas': '_refln.f_squared_meas',
    '_refln_f_squared_sigma': '_refln.f_squared_su',
    '_refln.f_squared_sigma': '_refln.f_squared_su',
    '_refln_wavelength_id': '_refln.wavelength_id',
    '_pd_refln_wavelength_id': '_refln.wavelength_id',         // deprecated
    '_pd_refln.wavelength_id': '_refln.wavelength_id'           // deprecated
};

/**
 * Fold a data name as it appears in a file onto the canonical name used
 * throughout the reader. Anything not in the table comes back lower-cased and
 * otherwise untouched.
 *
 * @param {string} name  A raw data name, with or without its leading underscore
 *                       already trimmed of surrounding whitespace.
 * @returns {string}
 */
function cifTag(name) {
    const t = String(name).trim().toLowerCase();
    return PDCIF_TAG_ALIASES[t] || t;
}

// ---------------------------------------------------------------------------
//  pdCIF READER
// ---------------------------------------------------------------------------

/**
 * Read a powder profile out of a pdCIF.
 *
 * Deliberately tolerant about which tags carry the angle and the intensity:
 * different producers write _pd_proc.2theta_corrected, _pd_meas.2theta_scan or
 * _pd_meas.2theta_range_* and a file that uses the range form has no angle
 * column at all -- the axis is implied by min, max and the point count. A
 * reader that insists on one spelling rejects most real files.
 *
 * Standard uncertainties in parentheses are stripped: "1234(12)" is a value of
 * 1234, not a parse error.
 *
 * Everything the writer states is read back, not just the profile: the cell,
 * the space group, both wavelengths with the Ka2 ratio, the zero point, the
 * the calculated and background curves and the reflection list. A file that describes a refinement and a
 * reader that returns only two columns of numbers could not restore the fit
 * a file came from -- and the loss was silent, because the tags were all there.
 *
 * hasCalculatedData tells the caller which file this is. A plain
 * experimental scan and a finished refinement are both valid pdCIF, but they
 * need to be LOADED differently: the former has nothing to restore beyond the
 * profile and should go through the normal "generate reflections from the
 * space group" path, while the latter already has real reflection
 * intensities and a real background, and generating fresh ones with a flat
 * placeholder intensity would throw that away.
 *
 * @param {string} content
 * @returns {{tth: number[], intensity: number[],
 *            calc: number[]|null, bkg: number[]|null,
 *            hklList: object[]|null,
 *            hasCalculatedData: boolean,
 *            wavelength: number|null,
 *            wavelength2: number|null, ratio21: number|null,
 *            zeroShift: number|null, cell: object|null,
 *            spaceGroup: object|null}}
 */
function parsePdCifFile(content) {
    const lines = content.split(/\r?\n/);
    const num = (tok) => {
        if (tok == null) return NaN;
        const t = String(tok).replace(/\(\d+\)$/, '');   // strip the s.u.
        if (t === '?' || t === '.') return NaN;
        return parseFloat(t);
    };

    // ---- scalars we care about -------------------------------------------
    let wavelength = null, rangeMin = NaN, rangeMax = NaN, rangeInc = NaN;
    let zeroShift = null, cifOffset = null;
    let wavelength2 = null, ratio21 = null;
    const cell = {};
    const sgIn = { symbol: null, number: null, hall: null };
    // Quoted CIF strings arrive with their delimiters attached.
    const unq = (v) => v.replace(/^['"]|['"]$/g, '').trim();
    // Keyed on canonical names -- cifTag() has already folded _cell_length_a
    // onto _cell.length_a by the time this is consulted.
    const CELL_TAG = {
        '_cell.length_a': 'a', '_cell.length_b': 'b', '_cell.length_c': 'c',
        '_cell.angle_alpha': 'alpha', '_cell.angle_beta': 'beta', '_cell.angle_gamma': 'gamma'
    };
    for (const raw of lines) {
        const s = raw.trim();
        const m = s.match(/^(_[\w.\-\[\]]+)\s+(.*)$/);
        if (!m) continue;
        // ONE SPELLING FROM HERE ON. A file may use the DDLm names of cif_pd
        // 2.5.0, the DDL1 aliases, or a deprecated item; cifTag() collapses
        // all of them so the tests below name one thing each.
        const tag = cifTag(m[1]), val = m[2].trim();
        if (CELL_TAG[tag] && Number.isFinite(num(val))) cell[CELL_TAG[tag]] = num(val);
        // The _symmetry_* spellings are deprecated but common in files in the
        // wild; PDCIF_TAG_ALIASES folds them onto these two names, so both are
        // still accepted without a second test here.
        else if (tag === '_space_group.name_h-m_alt'
                 && unq(val) && unq(val) !== '?') sgIn.symbol = unq(val);
        else if (tag === '_space_group.it_number'
                 && Number.isFinite(num(val))) sgIn.number = num(val);
        // THE ONE TAG THAT NAMES A SETTING, NOT JUST A NUMBER.
        //
        // See the writer's note on why this is written at all: several IT
        // numbers cover more than one setting, and this is the tag that
        // resolves which one without depending on how the H-M string gets
        // parsed. '_symmetry_space_group_name_hall' is the deprecated
        // spelling of the same tag and arrives here already folded onto it.
        else if (tag === '_space_group.name_hall'
                 && unq(val) && unq(val) !== '?') sgIn.hall = unq(val);
        else if (tag === '_diffrn_radiation_wavelength.value' && Number.isFinite(num(val))) wavelength = num(val);
        else if (tag === '_pd_meas.2theta_range_min') rangeMin = num(val);
        else if (tag === '_pd_meas.2theta_range_max') rangeMax = num(val);
        else if (tag === '_pd_meas.2theta_range_inc') rangeInc = num(val);
        // Deprecated as of cif_pd 2.5.0 and no longer written, but it is what
        // every pdCIF produced before then carries, so it is still read.
        else if (tag === '_pd_calib.2theta_offset' && Number.isFinite(num(val)) &&
                 cifOffset === null) cifOffset = num(val);
    }

    // ---- the 2-theta calibration table, if the file has one ---------------
    //
    // PD_CALIB_XCOORD replaced the single _pd_calib.2theta_offset in cif_pd
    // 2.5.0: instead of one number it lists nominal 2-theta against actual
    // 2-theta and expects the reader to interpolate. The model here is a
    // single refinable zero, so the table is usable here only when it
    // describes a constant shift -- which is the case for the two-row table
    // this program writes, and for any calibration that really is a zero
    // error.
    //
    // A table whose offset VARIES along the axis is deliberately ignored
    // rather than averaged. Collapsing it to one number would be right at
    // one angle and wrong everywhere else, and nothing downstream would show
    // that it had happened; the pattern loads with no zero correction, which
    // is visibly a missing correction rather than an invisible wrong one.
    //
    // Where a file carries both this and the deprecated scalar -- a writer
    // covering both dictionary versions would -- the table wins, because it
    // is the form the current dictionary defines.
    {
        let j = 0;
        while (j < lines.length) {
            if (lines[j].trim().toLowerCase() !== 'loop_') { j++; continue; }
            j++;
            const tags = [];
            while (j < lines.length) {
                const tagLine = lines[j].trim();
                if (!tagLine || tagLine.startsWith('#')) { j++; continue; }
                if (!tagLine.startsWith('_')) break;
                tags.push(cifTag(tagLine)); j++;
            }
            const iN = tags.indexOf('_pd_calib_xcoord.nominal_2theta');
            const iA = tags.indexOf('_pd_calib_xcoord.actual_2theta');
            if (iN < 0 || iA < 0) continue;
            const offsets = [];
            while (j < lines.length) {
                const t = lines[j].trim();
                if (t === '' || t.startsWith('#')) { j++; continue; }
                if (t.startsWith('_') || /^(?:loop_|stop_|data_|save_)/i.test(t)) break;
                const tok = t.split(/\s+/);
                if (tok.length >= tags.length) {
                    const nom = num(tok[iN]), act = num(tok[iA]);
                    if (Number.isFinite(nom) && Number.isFinite(act)) offsets.push(act - nom);
                }
                j++;
            }
            if (!offsets.length) continue;
            // A thousandth of a degree is far below anything a zero refinement
            // resolves, so agreement at that level is a constant offset and
            // not a coincidence.
            const spread = Math.max(...offsets) - Math.min(...offsets);
            if (spread <= 1e-3) cifOffset = offsets[0];
            break;
        }
    }

    // ---- the wavelength loop, if the file uses one ------------------------
    //
    // Scanned separately from the profile loop because it comes first and is
    // tiny. A file written by this program always uses the loop form (the
    // reflection loop refers to a wavelength id), and the loop is the only
    // place a Ka2 component can be stated at all.
    {
        let j = 0;
        while (j < lines.length) {
            if (lines[j].trim().toLowerCase() !== 'loop_') { j++; continue; }
            j++;
            const tags = [];
            while (j < lines.length) {
                const tagLine = lines[j].trim();
                if (!tagLine || tagLine.startsWith('#')) { j++; continue; }
                if (!tagLine.startsWith('_')) break;
                tags.push(cifTag(tagLine)); j++;
            }
            const iW = tags.indexOf('_diffrn_radiation_wavelength.value');
            if (iW < 0) continue;
            const iId = tags.indexOf('_diffrn_radiation_wavelength.id');
            const iWt = tags.indexOf('_diffrn_radiation_wavelength.wt');
            const rows = [];
            while (j < lines.length) {
                const t = lines[j].trim();
                if (t === '' || t.startsWith('#')) { j++; continue; }
                if (t.startsWith('_') || /^(?:loop_|stop_|data_|save_)/i.test(t)) break;
                const tok = t.split(/\s+/);
                if (tok.length >= tags.length) {
                    rows.push({ id: iId >= 0 ? String(tok[iId]) : String(rows.length + 1),
                                lam: num(tok[iW]),
                                wt: iWt >= 0 ? num(tok[iWt]) : 1 });
                }
                j++;
            }
            const good = rows.filter(r => Number.isFinite(r.lam));
            if (!good.length) continue;
            // Sorted by id so "1" is the primary line whatever order it was
            // written in; the weights are relative to that one.
            good.sort((x, y) => String(x.id).localeCompare(String(y.id), undefined, { numeric: true }));
            wavelength = good[0].lam;
            if (good.length > 1) {
                wavelength2 = good[1].lam;
                const w1 = Number.isFinite(good[0].wt) && good[0].wt !== 0 ? good[0].wt : 1;
                const w2 = Number.isFinite(good[1].wt) ? good[1].wt : NaN;
                if (Number.isFinite(w2)) ratio21 = w2 / w1;
            }
            break;
        }
    }

    // ---- the reflection loop, if the file has one --------------------------
    //
    // Only a file with calculated data has one -- a plain experimental scan
    // has no structure model behind it and nothing to put here. What is
    // stored is |F|^2 (see how
    // the file derives it), not a peak height, and it is handed back as
    // |F|^2 unchanged. Turning it into a height needs the exact profile,
    // Lp and multiplicity model the file was fitted with; that conversion
    // belongs to the caller, once it has resolved the space group and has
    // that model in hand, not to this reader.
    let hklList = null;
    {
        let j = 0;
        while (j < lines.length) {
            if (lines[j].trim().toLowerCase() !== 'loop_') { j++; continue; }
            j++;
            const tags = [];
            while (j < lines.length) {
                const tagLine = lines[j].trim();
                if (!tagLine || tagLine.startsWith('#')) { j++; continue; }
                if (!tagLine.startsWith('_')) break;
                tags.push(cifTag(tagLine)); j++;
            }
            const iH = tags.indexOf('_refln.index_h');
            const iK = tags.indexOf('_refln.index_k');
            const iL = tags.indexOf('_refln.index_l');
            if (iH < 0 || iK < 0 || iL < 0) continue;    // not the reflection loop
            const iD  = tags.indexOf('_refln.d_spacing');
            // Covers _refln.wavelength_id and both spellings of the withdrawn
            // _pd_refln.wavelength_id, which older files still use.
            const iWl = tags.indexOf('_refln.wavelength_id');
            const iF  = tags.indexOf('_refln.f_squared_meas');
            // _su in DDLm, _sigma in the DDL1 files this program used to write.
            const iFs = tags.indexOf('_refln.f_squared_su');
            const rows = [];
            while (j < lines.length) {
                const s = lines[j].trim();
                if (s === '' || s.startsWith('#')) { j++; continue; }
                if (s.startsWith('_') || /^(?:loop_|stop_|data_|save_)/i.test(s)) break;
                const tok = s.split(/\s+/);
                if (tok.length >= tags.length) {
                    const h = num(tok[iH]), k = num(tok[iK]), l = num(tok[iL]);
                    if (Number.isFinite(h) && Number.isFinite(k) && Number.isFinite(l)) {
                        rows.push({
                            h, k, l,
                            d: iD >= 0 ? num(tok[iD]) : NaN,
                            wavelengthId: iWl >= 0 ? tok[iWl] : '1',
                            // A bare "?" -- no F^2 could be formed for this
                            // reflection when the file was written -- reads
                            // back as NaN, not as an intensity of zero.
                            Fsq: iF >= 0 ? num(tok[iF]) : NaN,
                            Fsq_sigma: iFs >= 0 ? num(tok[iFs]) : NaN
                        });
                    }
                }
                j++;
            }
            if (rows.length) { hklList = rows; break; }
        }
    }

    // ---- find the profile loop -------------------------------------------
    // Canonical names only: cifTag() has already folded the DDL1 aliases and
    // the non-standard spellings other programs use onto these.
    const ANGLE = ['_pd_proc.2theta_corrected', '_pd_meas.2theta_scan'];
    const INTEN = ['_pd_meas.intensity_total', '_pd_meas.counts_total',
                   '_pd_proc.intensity_total', '_pd_proc.intensity_net'];
    // Present only when a fit produced them. Their absence is exactly the signal used below to tell
    // a plain experimental scan from a file that carries a calculated
    // pattern -- so read them here, aligned 1:1 with tth/intensity, rather
    // than as a separate pass that would have to re-match rows by 2-theta.
    const CALC = ['_pd_calc.intensity_total'];
    // Two names for the same column. _pd_calc.intensity_bkg is what this
    // program now writes; _pd_proc.intensity_bkg_calc is what it used to, and
    // what a background carrying standard uncertainties is written as. A file
    // would not normally have both, and if it did, whichever column comes
    // first is taken -- they describe the same curve.
    const BKG  = ['_pd_calc.intensity_bkg', '_pd_proc.intensity_bkg_calc'];

    const tth = [], intensity = [], calc = [], bkg = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].trim().toLowerCase() !== 'loop_') { i++; continue; }
        i++;
        const tags = [];
        while (i < lines.length) {
            const tagLine = lines[i].trim();
            if (!tagLine || tagLine.startsWith('#')) { i++; continue; }
            if (!tagLine.startsWith('_')) break;
            tags.push(cifTag(tagLine)); i++;
        }
        const iA  = tags.findIndex(t => ANGLE.includes(t));
        const iM  = tags.findIndex(t => INTEN.includes(t));
        const iC  = tags.findIndex(t => CALC.includes(t));
        const iBk = tags.findIndex(t => BKG.includes(t));

        // A PURELY CALCULATED PROFILE IS STILL A PROFILE.
        //
        // This used to require a MEASURED intensity column and skip any loop
        // without one, which meant a simulated pattern -- written by this same
        // program, with _pd_calc_intensity_total and no measurement because
        // none exists -- was rejected as "no powder profile loop found". The
        // writer and the reader disagreed about what a valid file is, and the
        // program could not read back what it had just produced.
        //
        // The calculated column is used as the profile only when there is no
        // measured one. Where both exist the measured column stays the
        // profile and the calculated one stays the model, which is what every
        // caller downstream assumes.
        const iI = (iM >= 0) ? iM : iC;
        if (iI < 0) continue;      // not the profile loop; skip its body
        const calcIsProfile = (iM < 0);

        while (i < lines.length) {
            const s = lines[i].trim();
            if (s === '' || s.startsWith('#')) { i++; continue; }
                if (s.startsWith('_') || /^(?:loop_|stop_|data_|save_)/i.test(s)) break;
            const tok = s.split(/\s+/);
            if (tok.length >= tags.length) {
                const y = num(tok[iI]);
                if (Number.isFinite(y)) {
                    intensity.push(y);
                    tth.push(iA >= 0 ? num(tok[iA]) : NaN);
                    // '?' (no value) parses to NaN through num(), which is
                    // right here too: a point the fit did not cover has no
                    // calculated intensity, not a calculated zero.
                    // When the calculated column IS the profile, do not also
                    // report it as a separate calculated curve: that would
                    // claim a fit exists whose calculated pattern happens to
                    // match the data everywhere, and hasCalculatedData below
                    // would send the file down the "restore a refinement" path.
                    calc.push((iC >= 0 && !calcIsProfile) ? num(tok[iC]) : NaN);
                    bkg.push (iBk >= 0 ? num(tok[iBk]) : NaN);
                }
            }
            i++;
        }
        if (intensity.length) break;
    }

    if (!intensity.length) {
        throw new Error('No powder profile loop found. The file needs a loop_ containing ' +
                        '_pd_meas.intensity_total, _pd_proc.intensity_total or ' +
                        '_pd_calc.intensity_total (or their older _pd_meas_intensity_total ' +
                        'spellings).');
    }

    // The range form: no angle column, the axis is implied.
    if (!Number.isFinite(tth[0])) {
        let step = rangeInc;
        if (!Number.isFinite(step) && Number.isFinite(rangeMin) && Number.isFinite(rangeMax)) {
            step = (rangeMax - rangeMin) / Math.max(1, intensity.length - 1);
        }
        if (!Number.isFinite(rangeMin) || !Number.isFinite(step)) {
            throw new Error('The profile loop has no 2-theta column, and the file does not ' +
                            'give _pd_meas.2theta_range_min / _inc to reconstruct the axis.');
        }
        for (let k = 0; k < intensity.length; k++) tth[k] = rangeMin + k * step;
    }
    // The standard value is NEGATED on the way in: the dictionary's offset,
    // whether it came from the deprecated scalar or from a PD_CALIB_XCOORD
    // table, is (actual - nominal), and this program wants (observed - calculated),
    // which is the same quantity with the opposite sign.
    if (zeroShift === null && cifOffset !== null) zeroShift = -cifOffset;

    // ONLY SOME pdCIF FILES CARRY CALCULATED DATA.
    //
    // A file written by exporting a raw scan has none of this: no calculated
    // column, no reflection loop. A file written after a fit has both. This
    // is the single flag the caller needs to choose between the two loading
    // paths -- restore a finished calculated pattern, or treat the file as a
    // fresh experimental scan -- rather than each caller re-deriving it from
    // whether calc/hklList happen to be non-null.
    const hasCalculatedData = calc.some(Number.isFinite) ||
                              !!(hklList && hklList.some(r => Number.isFinite(r.Fsq)));

    return {
        tth, intensity,
        // null, not an all-NaN array, when the file never had the column --
        // "no data" and "a fit that covers nothing" should not look alike.
        calc: calc.some(Number.isFinite) ? calc : null,
        bkg: bkg.some(Number.isFinite) ? bkg : null,
        hklList, hasCalculatedData,
        wavelength, zeroShift,
        wavelength2, ratio21,
        // Only handed back when the cell is actually complete enough to use.
        // A partial cell applied to the controls would leave a mix of this
        // file's edges and the previous sample's.
        cell: Number.isFinite(cell.a) ? cell : null,
        spaceGroup: (sgIn.symbol || sgIn.hall || Number.isFinite(sgIn.number)) ? sgIn : null
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parsePdCifFile, cifTag, PDCIF_TAG_ALIASES };
}
