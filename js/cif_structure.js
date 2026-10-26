/* Structure CIF reader over the shared tokenizer (js/cif_reader.js).
 *
 * One data block per call: rv_commands.readStructures() splits a multi-block file into its blocks and calls
 * this per block, so "the first block" here is the block it was given, not a silent loss of the others.
 *
 * Tolerant where a file is allowed to be vague, strict where a number matters:
 *   - '?' and '.' are "unknown": a label or type becomes '', a number NaN;
 *   - an e.s.d. in parentheses is dropped from any number (0.1234(5), 1.2(3)e-2, 1.23(4)(5));
 *   - a bare fraction is read (1/2, -1/3), which some writers emit for special positions;
 *   - a row whose coordinates are not numbers is skipped and COUNTED (atomsSkipped), never dropped in silence;
 *   - the cell reports which of its six values the file did not give (cellMissing), so the caller can name the
 *     missing parameter instead of letting a default fill it in.
 */
(function (root) {
'use strict';
function reader() {
    if (typeof CifReader !== 'undefined') return CifReader;
    if (typeof require === 'function') return require('./cif_reader.js');
    throw new Error('The shared CIF reader (js/cif_reader.js) is not loaded.');
}
// "1.234(5)" -> 1.234; "1.2(3)e-2" -> 0.012; "1.23(4)(5)" -> 1.23; "1/2" -> 0.5
function simCifNum(tok) {
    if (tok == null) return NaN;
    const text = String(tok).trim();
    if (!text || text === '?' || text === '.') return NaN;
    const fraction = /^([+-]?\d+)\s*\/\s*(\d+)$/.exec(text);
    if (fraction) {
        const v = Number(fraction[1]) / Number(fraction[2]);
        return Number.isFinite(v) ? v : NaN;
    }
    const v = Number(text.replace(/\(\d+\)/g, ''));
    return Number.isFinite(v) ? v : NaN;
}
// '?' and '.' mean "not known"; a label or type of '' lets the caller fall back to the element of the label.
function simCifText(tok) {
    const s = tok == null ? '' : String(tok).trim();
    return (s === '?' || s === '.') ? '' : s;
}
function simCifTokens(line) { return reader().tokens(line).map(t => t.value); }
function simParseStructureCif(text) {
    const blocks = reader().parse(text), block = blocks[0], tags = Object.create(null), atoms = [];
    let atomsSkipped = 0;
    const canon = s => s.toLowerCase().replace(/\./g, '_');
    if (block) Object.keys(block.values).forEach(k => { tags[canon(k)] = block.values[k]; });
    for (const loop of block ? block.loops : []) {
        const headers = loop.tags.map(canon), col = name => headers.indexOf(name);
        const cx = col('_atom_site_fract_x'), cy = col('_atom_site_fract_y'), cz = col('_atom_site_fract_z');
        if (cx < 0 || cy < 0 || cz < 0) continue;
        const cl = col('_atom_site_label'), ct = col('_atom_site_type_symbol'), co = col('_atom_site_occupancy');
        const cb = col('_atom_site_b_iso_or_equiv'), cu = col('_atom_site_u_iso_or_equiv');
        for (const row of loop.rows) {
            const rec = { siteLabel: simCifText(cl >= 0 ? row[cl] : ''), type: simCifText(ct >= 0 ? row[ct] : ''),
                x: simCifNum(row[cx]), y: simCifNum(row[cy]), z: simCifNum(row[cz]), occ: co >= 0 ? simCifNum(row[co]) : 1,
                biso: simCifNum(row[cb]), uiso: simCifNum(row[cu]) };
            if ([rec.x, rec.y, rec.z].every(Number.isFinite)) atoms.push(rec); else atomsSkipped++;
        }
    }
    const g = (...names) => { for (const name of names) if (tags[name] !== undefined) return tags[name]; };
    const a = simCifNum(g('_cell_length_a'));
    const cell = Number.isFinite(a) ? { a, b: simCifNum(g('_cell_length_b')), c: simCifNum(g('_cell_length_c')),
        alpha: simCifNum(g('_cell_angle_alpha')), beta: simCifNum(g('_cell_angle_beta')), gamma: simCifNum(g('_cell_angle_gamma')) } : null;
    const cellMissing = cell ? ['a', 'b', 'c', 'alpha', 'beta', 'gamma'].filter(k => !Number.isFinite(cell[k])) : [];
    const sgName = g('_space_group_name_h-m_alt', '_symmetry_space_group_name_h-m', '_space_group_name_hall', '_symmetry_space_group_name_hall') || null;
    const sgHall = g('_space_group_name_hall', '_symmetry_space_group_name_hall') || null;
    const sgNum = simCifNum(g('_space_group_it_number', '_symmetry_int_tables_number'));
    return { atoms, atomsSkipped, cell, cellMissing, sgName, sgHall,
             sgNumber: Number.isFinite(sgNum) ? sgNum : null, blocks: blocks.length, blockName: block ? block.name : '' };
}
root.CifStructure = { parse: simParseStructureCif, number: simCifNum, text: simCifText, tokens: simCifTokens };
if (typeof module !== 'undefined' && module.exports) module.exports = root.CifStructure;
})(typeof window !== 'undefined' ? window : globalThis);
