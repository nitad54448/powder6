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

    '_pd_proc_ls_weight': '_pd_proc_ls.weight',
    '_pd_meas_intensity_total_su': '_pd_meas.intensity_total_su',
    '_pd_meas_intensity_total_sigma': '_pd_meas.intensity_total_sigma',
    '_pd_meas_counts_total_su': '_pd_meas.counts_total_su',
    '_pd_proc_intensity_total_su': '_pd_proc.intensity_total_su',
    '_pd_proc_intensity_total_sigma': '_pd_proc.intensity_total_sigma',
    '_pd_proc_intensity_net_su': '_pd_proc.intensity_net_su',
    '_pd_proc_intensity_net_sigma': '_pd_proc.intensity_net_sigma',
    '_pd_phase_block_id': '_pd_phase.block_id',

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
// pdCIF profiles are read independently, with metadata from the same block.
function pdCifReader() {
    if (typeof CifReader !== 'undefined') return CifReader;
    if (typeof require === 'function') return require('./cif_reader.js');
    throw new Error('The shared CIF reader (js/cif_reader.js) is not loaded.');
}
function pdCifNumber(value) {
    if (value == null || value === '?' || value === '.') return NaN;
    const text = String(value).trim();
    return text ? Number(text.replace(/\(\d+\)(?=[eE]|$)/, '')) : NaN;
}
function pdCifUncertainty(value) {
    var m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\((\d+)\)([eE][+-]?\d+)?$/.exec(String(value));
    if (!m) return NaN;
    var decimals = (m[1].split('.')[1] || '').length;
    return Number(m[2]) * Math.pow(10, Number((m[3] || 'e0').slice(1)) - decimals);
}
function parsePdCifFiles(content) {
    const profiles = [];
    for (const block of pdCifReader().parse(content)) {
        const tags = Object.create(null);
        Object.keys(block.values).forEach(k => { tags[cifTag(k)] = block.values[k]; });
        const loops = block.loops.map(loop => ({ tags: loop.tags.map(cifTag), rows: loop.rows }));
        const ANGLE = ['_pd_proc.2theta_corrected', '_pd_meas.2theta_scan'];
        const INTEN = ['_pd_meas.intensity_total', '_pd_meas.counts_total', '_pd_proc.intensity_total', '_pd_proc.intensity_net'];
        const profile = loops.find(loop => loop.tags.some(t => INTEN.includes(t) || t === '_pd_calc.intensity_total'));
        if (!profile) continue;
        const num = pdCifNumber, get = name => tags[name], scalar = name => num(get(name));
        const col = names => profile.tags.findIndex(t => names.includes(t));
        const iA = col(ANGLE), iM = col(INTEN), iC = col(['_pd_calc.intensity_total']);
        const iI = iM >= 0 ? iM : iC, iB = col(['_pd_calc.intensity_bkg', '_pd_proc.intensity_bkg_calc']);
        const iW = col(['_pd_proc_ls.weight']);
        const measuredTag = profile.tags[iI];
        const iS = col([measuredTag + '_su', measuredTag + '_sigma']);
        const tth = [], intensity = [], calc = [], bkg = [], sig = [], weights = [];
        profile.rows.forEach((row, point) => {
            const y = num(row[iI]);
            if (!Number.isFinite(y)) return;
            tth.push(iA >= 0 ? num(row[iA]) : NaN); intensity.push(y);
            calc.push(iM >= 0 && iC >= 0 ? num(row[iC]) : NaN); bkg.push(iB >= 0 ? num(row[iB]) : NaN);
            const uncertainty = iS >= 0 ? num(row[iS]) : pdCifUncertainty(row[iI]);
            if (iS >= 0 && !(uncertainty > 0 && Number.isFinite(uncertainty))) throw new Error('Invalid intensity uncertainty at point ' + (point + 1) + ' in data_' + block.name + '.');
            sig.push(uncertainty);
            if (iW >= 0) {
                const w = num(row[iW]);
                if (!(Number.isFinite(w) && w >= 0)) throw new Error('Invalid intensity weight at point ' + (point + 1) + ' in data_' + block.name + '.');
                weights.push(w);
            }
        });
        if (!intensity.length) throw new Error('No numeric powder profile in data_' + block.name + '.');
        if (iA < 0) {
            const lo = scalar('_pd_meas.2theta_range_min'), hi = scalar('_pd_meas.2theta_range_max');
            let step = scalar('_pd_meas.2theta_range_inc');
            if (!Number.isFinite(step) && Number.isFinite(lo) && Number.isFinite(hi)) step = (hi - lo) / Math.max(1, intensity.length - 1);
            if (!Number.isFinite(lo) || !Number.isFinite(step) || step === 0) throw new Error('The profile has no 2-theta column or valid range in data_' + block.name + '.');
            for (let k = 0; k < tth.length; k++) tth[k] = lo + k * step;
        }
        let wavelength = scalar('_diffrn_radiation_wavelength.value'), wavelength2 = null, ratio21 = null;
        const wl = loops.find(loop => loop.tags.includes('_diffrn_radiation_wavelength.value'));
        if (wl) {
            const iw = wl.tags.indexOf('_diffrn_radiation_wavelength.value'), id = wl.tags.indexOf('_diffrn_radiation_wavelength.id'), wt = wl.tags.indexOf('_diffrn_radiation_wavelength.wt');
            const rows = wl.rows.map((r, i) => ({ id: id >= 0 ? r[id] : String(i + 1), lam: num(r[iw]), wt: wt >= 0 ? num(r[wt]) : 1 })).filter(r => r.lam > 0);
            rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
            if (rows.length) wavelength = rows[0].lam;
            if (rows.length > 1) { wavelength2 = rows[1].lam; ratio21 = rows[1].wt / rows[0].wt; }
        }
        const probe = String(get('_diffrn_radiation.probe') || '').toLowerCase();
        if (probe && !['?', '.', 'x-ray', 'xray', 'neutron'].includes(probe)) throw new Error('Unsupported radiation probe: ' + probe + '.');
        const radiation = probe === 'neutron' ? 'neutron' : /^(x-ray|xray)$/.test(probe) ? 'xray' : null;
        let offset = scalar('_pd_calib.2theta_offset');
        const calibration = loops.find(loop => loop.tags.includes('_pd_calib_xcoord.nominal_2theta') && loop.tags.includes('_pd_calib_xcoord.actual_2theta'));
        if (calibration) {
            const nominal = calibration.tags.indexOf('_pd_calib_xcoord.nominal_2theta'), actual = calibration.tags.indexOf('_pd_calib_xcoord.actual_2theta');
            const shifts = calibration.rows.map(r => num(r[actual]) - num(r[nominal])).filter(Number.isFinite);
            if (shifts.length) {
                const lo = shifts.reduce((a, b) => Math.min(a, b), Infinity), hi = shifts.reduce((a, b) => Math.max(a, b), -Infinity);
                offset = hi - lo <= 1e-3 ? shifts[0] : NaN;
            }
        }
        const cell = {};
        ['a', 'b', 'c', 'alpha', 'beta', 'gamma'].forEach(c => { const v = scalar('_cell.' + (/^[abc]$/.test(c) ? 'length_' : 'angle_') + c); if (Number.isFinite(v)) cell[c] = v; });
        const sg = { symbol: get('_space_group.name_h-m_alt') || null, hall: get('_space_group.name_hall') || null, number: scalar('_space_group.it_number') };
        let hklList = null;
        const refl = loops.find(loop => ['_refln.index_h', '_refln.index_k', '_refln.index_l'].every(t => loop.tags.includes(t)));
        if (refl) {
            const index = t => refl.tags.indexOf(t), value = (r, t) => num(r[index(t)]);
            hklList = refl.rows.map(r => ({ h: value(r, '_refln.index_h'), k: value(r, '_refln.index_k'), l: value(r, '_refln.index_l'),
                d: value(r, '_refln.d_spacing'), wavelengthId: r[index('_refln.wavelength_id')] || '1', Fsq: value(r, '_refln.f_squared_meas'), Fsq_sigma: value(r, '_refln.f_squared_su')
            })).filter(r => [r.h, r.k, r.l].every(Number.isFinite));
        }
        const phases = loops.find(loop => loop.tags.includes('_pd_phase.block_id'));
        const phaseBlockIds = phases ? phases.rows.map(r => r[phases.tags.indexOf('_pd_phase.block_id')]) : null;
        const anySigma = sig.some(s => s > 0 && Number.isFinite(s));
        profiles.push({ tth, intensity, sig: anySigma ? sig.map((s, i) => s > 0 && Number.isFinite(s) ? s : Math.sqrt(Math.max(intensity[i], 1))) : null,
            weights: iW >= 0 ? weights : null, calc: calc.some(Number.isFinite) ? calc : null, bkg: bkg.some(Number.isFinite) ? bkg : null,
            hklList, hasCalculatedData: calc.some(Number.isFinite) || !!(hklList && hklList.some(r => Number.isFinite(r.Fsq))),
            wavelength: wavelength > 0 ? wavelength : null, wavelength2, ratio21, radiation,
            // A scalar or a one-line wavelength loop explicitly describes a single line.
            singleWavelength: wavelength > 0 && !(wavelength2 > 0), zeroShift: Number.isFinite(offset) ? -offset : null,
            cell: Number.isFinite(cell.a) ? cell : null, spaceGroup: sg.symbol || sg.hall || Number.isFinite(sg.number) ? sg : null,
            blockName: block.name, phaseBlockIds });
    }
    if (!profiles.length) throw new Error('No powder profile loop found in the CIF.');
    return profiles;
}
function parsePdCifFile(content) { return parsePdCifFiles(content)[0]; }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parsePdCifFile, parsePdCifFiles, cifTag, PDCIF_TAG_ALIASES };
}
