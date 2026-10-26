// js/cif_structure.js: the tolerant parts of CIF numbers, '?' handling, the cell report and the block contract.
const assert = require('node:assert/strict');
const test = require('node:test');
const CifStructure = require('../js/cif_structure.js');

test('e.s.d.s, exponents and fractions are read; ? and . are not numbers', () => {
  assert.equal(CifStructure.number('0.1234(5)'), 0.1234);
  assert.equal(CifStructure.number('1.2(3)e-2'), 0.012);
  assert.equal(CifStructure.number('1.23(4)(5)'), 1.23);
  assert.equal(CifStructure.number('-0.5(2)'), -0.5);
  assert.equal(CifStructure.number('1/2'), 0.5);
  assert.equal(CifStructure.number('-1/3'), -1 / 3);
  for (const text of ['?', '.', '', 'abc', null, undefined]) assert.ok(Number.isNaN(CifStructure.number(text)), String(text));
  assert.equal(CifStructure.text('?'), '');
  assert.equal(CifStructure.text('.'), '');
  assert.equal(CifStructure.text(' O1 '), 'O1');
});

test('an unknown type or label is empty, and a site whose coordinates are unreadable is counted', () => {
  const r = CifStructure.parse(['data_x',
    '_cell_length_a 5', '_cell_length_b 5', '_cell_length_c 5',
    'loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y', '_atom_site_fract_z',
    'O1 ? 0.1 0.2 0.3', '. O 0.4 0.5 0.6', 'C1 C ? 0.2 0.3'].join('\n'));
  assert.equal(r.atoms.length, 2);
  assert.equal(r.atoms[0].siteLabel, 'O1');
  assert.equal(r.atoms[0].type, '', 'an unknown type lets the caller derive it from the label');
  assert.equal(r.atoms[1].siteLabel, '');
  assert.equal(r.atoms[1].type, 'O');
  assert.equal(r.atomsSkipped, 1, 'the row without a readable x is counted, not dropped in silence');
});

test('the cell reports every value the file did not give', () => {
  const full = CifStructure.parse('data_x\n_cell_length_a 5\n_cell_length_b 6\n_cell_length_c 7\n_cell_angle_alpha 90\n_cell_angle_beta 100\n_cell_angle_gamma 90\n');
  assert.deepEqual(full.cellMissing, []);
  assert.equal(full.cell.beta, 100);
  const partial = CifStructure.parse('data_x\n_cell_length_a 5\n_cell_length_b 6\n');
  assert.deepEqual(partial.cellMissing, ['c', 'alpha', 'beta', 'gamma']);
  const none = CifStructure.parse('data_x\n_space_group_IT_number 1\n');
  assert.equal(none.cell, null);
  assert.deepEqual(none.cellMissing, []);
});

test('one data block per call, and the block count is reported', () => {
  const r = CifStructure.parse('data_a\n_cell_length_a 5\ndata_b\n_cell_length_b 6\n');
  assert.equal(r.blocks, 2);
  assert.equal(r.blockName, 'a');
  assert.equal(r.cell.a, 5);
  assert.ok(Number.isNaN(r.cell.b), 'the second block is not merged in');
});
