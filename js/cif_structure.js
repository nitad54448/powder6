/* ===========================================================================
   CIF STRUCTURE READER  --  cell, space group and atom sites of a crystal-
   structure CIF (first data block only). Extracted unchanged from the
   earlier simulation module, the only part of it used here.

   CifStructure.parse(text) -> { atoms: [{siteLabel, type, x, y, z, occ, biso, uiso}],
                                 cell: {a,b,c,alpha,beta,gamma} | null,
                                 sgName, sgHall, sgNumber, blocks, blockName }
   =========================================================================== */
(function (root) {
'use strict';

/** Strip a CIF standard uncertainty: "0.1234(5)" is a value, not a syntax error. */
function simCifNum(tok) {
    if (tok == null) return NaN;
    const s = String(tok).trim().replace(/\(\d+\)\s*$/, '');
    if (s === '' || s === '?' || s === '.') return NaN;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : NaN;
}

/** Split a CIF data line into tokens, respecting quotes. */
function simCifTokens(line) {
    const out = [];
    const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
        out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    }
    return out;
}

/**
 * Parse a crystal-structure CIF.
 *
 * Only the first data block is read. Multi-block CIFs are common (a deposition
 * with several phases), and silently merging their atom lists would produce a
 * structure that exists in none of them; taking the first and saying so is
 * recoverable, and the user can split the file.
 *
 * @returns {{atoms: object[], cell: object|null, sgName: string|null,
 *            sgNumber: number|null, blocks: number, blockName: string}}
 */
function simParseStructureCif(text) {
    const rawLines = String(text).split(/\r?\n/);

    // Fold semicolon text fields into single tokens so they cannot be mistaken
    // for tags or loop rows. Their content is never needed here, but a
    // multi-line publication title containing the word "loop_" would otherwise
    // derail the parser.
    const lines = [];
    let inText = false;
    for (const raw of rawLines) {
        if (raw.startsWith(';')) { inText = !inText; lines.push(inText ? "';'" : ''); continue; }
        lines.push(inText ? '' : raw);
    }

    const tags = {};
    const atoms = [];
    let blocks = 0, blockName = '';
    // DDLm names (_cell.length_a, _atom_site.fract_x) folded onto the DDL1
    // spelling every lookup below uses. Only the DDL1 form was recognised, and
    // the pdCIF writer emits DDLm -- so a structure exported from
    // the simulation could not be read back into it ("no _atom_site_fract_x
    // loop"). For every tag read here the category/object split is the first
    // '.', so one replace is exact.
    const canonTag = (s) => String(s).toLowerCase().replace(/\./g, '_');
    let stop = false;

    for (let i = 0; i < lines.length && !stop; i++) {
        const line = lines[i];
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;

        if (/^data_/i.test(t)) {
            blocks++;
            if (blocks === 1) blockName = t.slice(5);
            else { stop = true; break; }   // first block only
            continue;
        }

        if (/^loop_$/i.test(t)) {
            // Collect the header, then the rows.
            const headers = [];
            let j = i + 1;
            for (; j < lines.length; j++) {
                const h = lines[j].trim();
                if (!h || h.startsWith('#')) continue;
                if (h.startsWith('_')) { headers.push(canonTag(h.split(/\s+/)[0])); continue; }
                break;
            }
            // The values of a loop are one stream of tokens: a row may wrap over
            // several lines, so the stream is cut every headers.length tokens.
            const stream = [];
            for (; j < lines.length; j++) {
                const r = lines[j].trim();
                if (!r || r.startsWith('#')) continue;
                if (r.startsWith('_') || /^(?:loop_|stop_|save_)/i.test(r) || /^data_/i.test(r)) break;
                for (const tk of simCifTokens(r)) stream.push(tk);
            }
            const rows = [], nh = headers.length;
            if (nh > 0) for (let k = 0; k + nh <= stream.length; k += nh) rows.push(stream.slice(k, k + nh));
            i = j - 1;

            const col = (name) => headers.indexOf(name);
            const cx = col('_atom_site_fract_x');
            if (cx >= 0) {
                const cy = col('_atom_site_fract_y'), cz = col('_atom_site_fract_z');
                const cl = col('_atom_site_label'), ct = col('_atom_site_type_symbol');
                const co = col('_atom_site_occupancy');
                const cb = col('_atom_site_b_iso_or_equiv');
                const cu = col('_atom_site_u_iso_or_equiv');

                // Rows were rebuilt from the token stream above (wrapped lines
                // included); a row too short for the columns used is skipped.
                const need = Math.max(cx, cy, cz, cl, ct, co, cb, cu) + 1;
                for (const r of rows) {
                    if (r.length < need) continue;
                    const rec = {
                        siteLabel: cl >= 0 ? r[cl] : '',
                        type: ct >= 0 ? r[ct] : '',
                        x: simCifNum(r[cx]),
                        y: cy >= 0 ? simCifNum(r[cy]) : NaN,
                        z: cz >= 0 ? simCifNum(r[cz]) : NaN,
                        occ: co >= 0 ? simCifNum(r[co]) : 1,
                        biso: cb >= 0 ? simCifNum(r[cb]) : NaN,
                        uiso: cu >= 0 ? simCifNum(r[cu]) : NaN
                    };
                    if ([rec.x, rec.y, rec.z].every(Number.isFinite)) atoms.push(rec);
                }
            }
            continue;
        }

        if (t.startsWith('_')) {
            const toks = simCifTokens(t);
            if (toks.length >= 2) tags[canonTag(toks[0])] = toks.slice(1).join(' ');
            continue;
        }
    }

    const g = (...names) => {
        for (const n of names) if (tags[n] !== undefined) return tags[n];
        return undefined;
    };
    const cellA = simCifNum(g('_cell_length_a'));
    const cell = Number.isFinite(cellA) ? {
        a: cellA,
        b: simCifNum(g('_cell_length_b')),
        c: simCifNum(g('_cell_length_c')),
        alpha: simCifNum(g('_cell_angle_alpha')),
        beta: simCifNum(g('_cell_angle_beta')),
        gamma: simCifNum(g('_cell_angle_gamma'))
    } : null;

    const sgName = g('_space_group_name_h-m_alt', '_symmetry_space_group_name_h-m',
                     '_space_group_name_hall', '_symmetry_space_group_name_hall') || null;
    // Kept separately: the Hall symbol names one setting exactly, so it is the
    // first thing the resolver tries, not just a fallback for a missing H-M.
    const sgHall = g('_space_group_name_hall', '_symmetry_space_group_name_hall') || null;
    const sgNum = simCifNum(g('_space_group_it_number', '_symmetry_int_tables_number'));

    return { atoms, cell, sgName, sgHall, sgNumber: Number.isFinite(sgNum) ? sgNum : null,
             blocks, blockName };
}

root.CifStructure = { parse: simParseStructureCif, number: simCifNum, tokens: simCifTokens };

})(typeof window !== 'undefined' ? window : globalThis);
