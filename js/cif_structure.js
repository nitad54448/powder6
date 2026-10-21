/* Structure CIF reader. Shared tokenization keeps comments and wrapped loop
 * rows out of the atom data and permits scalar values on following lines. */
(function (root) {
'use strict';
function reader() {
    if (typeof CifReader !== 'undefined') return CifReader;
    if (typeof require === 'function') return require('./cif_reader.js');
    throw new Error('The shared CIF reader (js/cif_reader.js) is not loaded.');
}
function simCifNum(tok) {
    if (tok == null || tok === '?' || tok === '.') return NaN;
    const text = String(tok).trim();
    const v = text ? Number(text.replace(/\(\d+\)(?=[eE]|$)/, '')) : NaN;
    return Number.isFinite(v) ? v : NaN;
}
function simCifTokens(line) { return reader().tokens(line).map(t => t.value); }
function simParseStructureCif(text) {
    const blocks = reader().parse(text), block = blocks[0], tags = Object.create(null), atoms = [];
    const canon = s => s.toLowerCase().replace(/\./g, '_');
    if (block) Object.keys(block.values).forEach(k => { tags[canon(k)] = block.values[k]; });
    for (const loop of block ? block.loops : []) {
        const headers = loop.tags.map(canon), col = name => headers.indexOf(name);
        const cx = col('_atom_site_fract_x'), cy = col('_atom_site_fract_y'), cz = col('_atom_site_fract_z');
        if (cx < 0 || cy < 0 || cz < 0) continue;
        const cl = col('_atom_site_label'), ct = col('_atom_site_type_symbol'), co = col('_atom_site_occupancy');
        const cb = col('_atom_site_b_iso_or_equiv'), cu = col('_atom_site_u_iso_or_equiv');
        for (const row of loop.rows) {
            const rec = { siteLabel: cl >= 0 ? row[cl] : '', type: ct >= 0 ? row[ct] : '',
                x: simCifNum(row[cx]), y: simCifNum(row[cy]), z: simCifNum(row[cz]), occ: co >= 0 ? simCifNum(row[co]) : 1,
                biso: simCifNum(row[cb]), uiso: simCifNum(row[cu]) };
            if ([rec.x, rec.y, rec.z].every(Number.isFinite)) atoms.push(rec);
        }
    }
    const g = (...names) => { for (const name of names) if (tags[name] !== undefined) return tags[name]; };
    const a = simCifNum(g('_cell_length_a'));
    const cell = Number.isFinite(a) ? { a, b: simCifNum(g('_cell_length_b')), c: simCifNum(g('_cell_length_c')),
        alpha: simCifNum(g('_cell_angle_alpha')), beta: simCifNum(g('_cell_angle_beta')), gamma: simCifNum(g('_cell_angle_gamma')) } : null;
    const sgName = g('_space_group_name_h-m_alt', '_symmetry_space_group_name_h-m', '_space_group_name_hall', '_symmetry_space_group_name_hall') || null;
    const sgHall = g('_space_group_name_hall', '_symmetry_space_group_name_hall') || null;
    const sgNum = simCifNum(g('_space_group_it_number', '_symmetry_int_tables_number'));
    return { atoms, cell, sgName, sgHall, sgNumber: Number.isFinite(sgNum) ? sgNum : null, blocks: blocks.length, blockName: block ? block.name : '' };
}
root.CifStructure = { parse: simParseStructureCif, number: simCifNum, tokens: simCifTokens };
})(typeof window !== 'undefined' ? window : globalThis);
