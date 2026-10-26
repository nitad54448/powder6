// The table rules of js/absorption_table.js: units, element keys, ordering, the edge refusal, interpolation.
// These are the parts rv_absorption.js used to carry inline and no test could reach.
const assert = require('node:assert/strict');
const test = require('node:test');
const A = require('../js/absorption_table.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' got ' + a + ', expected ' + b);

test('units are converted to eV, and anything that is not an energy unit is refused', () => {
  assert.equal(A.unitFactor('eV'), 1);
  assert.equal(A.unitFactor(' keV '), 1000);
  assert.equal(A.unitFactor('MeV'), 1e6);
  assert.equal(A.unitFactor(undefined), 1);
  assert.equal(A.unitFactor(''), 1, 'an empty unit is eV, as the readers of bare tables assume');
  assert.throws(() => A.unitFactor('J'), /eV, keV or MeV/);
  assert.throws(() => A.unitFactor('kev2'), /eV, keV or MeV/);
});

test('a document is validated completely, and element keys become one canonical spelling', () => {
  const table = A.normalize({ energyUnit: 'keV', source: 'fixture', elements: {
    Fe: { mu: [[1, 100], [2, 50]], unit: 'cm2/g' },
    PB: { mu: [[1, 2], [2, 1]], unit: 'cm^2/g', source: 'own' },
    comment: 'not an element'
  } });
  assert.deepEqual(Object.keys(table).sort(), ['Fe', 'Pb']);
  assert.deepEqual(table.Fe.rows, [[1000, 100], [2000, 50]]);
  assert.equal(table.Fe.source, 'fixture');
  assert.equal(table.Pb.source, 'own');
  // the same element written twice in two cases is an error, not a silent pick
  assert.throws(() => A.normalize({ Fe: { mu: [[1, 1], [2, 2]], unit: 'cm2/g' }, fe: { mu: [[1, 1], [2, 2]], unit: 'cm2/g' } }), /two entries/);
  for (const bad of [null, [], 'x', { elements: [] }]) assert.throws(() => A.normalize(bad), /Expected|elements/);
  assert.throws(() => A.normalize({ source: 'no elements here' }), /No elemental absorption tables found/);
  assert.throws(() => A.normalize({ Fe: { mu: [[1, 1]], unit: 'cm2/g' } }), /at least two/);
  assert.throws(() => A.normalize({ Fe: { mu: [[1, 1], [2, 2]] } }), /unit cm/);
  assert.throws(() => A.normalize({ Fe: { mu: [[1, 1], [2, 2]], unit: 'cm2/g', symbol: 'Cu' } }), /does not match/);
  assert.throws(() => A.normalize({ Fe: { mu: [[1, 1], [2, -1]], unit: 'cm2/g' } }), /invalid coefficient pair 2/);
  assert.throws(() => A.normalize({ Fe: { mu: [[2, 1], [1, 1]], unit: 'cm2/g' } }), /must be ordered/);
});

test('log-log interpolation, exact rows, duplicated edge energies and the refusal across a sharp edge', () => {
  const t = A.normalize({ elements: {
    Fe: { unit: 'cm2/g', mu: [[1000, 100], [2000, 400]] },
    Pb: { unit: 'cm2/g', mu: [[100, 10], [200, 20], [200, 30], [300, 40]] }
  } });
  near(A.coefficient(t, 'Fe', 1000).value, 100, 1e-9, 'first row');
  near(A.coefficient(t, 'Fe', 2000).value, 400, 1e-9, 'last row');
  near(A.coefficient(t, 'Fe', 1500).value, 100 * Math.pow(4, Math.log(1.5) / Math.log(2)), 1e-9, 'log-log, not linear');
  near(A.coefficient(t, 'fe', 1000).value, 100, 1e-9, 'the element is looked up in any case');
  assert.equal(A.coefficient(t, 'Pb', 200).value, 30, 'an exact energy takes the post-edge row');
  near(A.coefficient(t, 'Pb', 150).value, 15, 1e-9, 'a normal bracket is log-log: 10 * 2^(ln1.5/ln2) = 15');
  near(A.coefficient(t, 'Pb', Math.sqrt(100 * 200)).value, Math.sqrt(10 * 20), 1e-9, 'the geometric-mean energy gives the geometric-mean coefficient');
  const sharp = A.normalize({ elements: { Fe: { unit: 'cm2/g', mu: [[100, 10], [105, 20]] } } });
  const edge = A.coefficient(sharp, 'Fe', 102).error;
  assert.match(edge, /sharp absorption edge/);
  assert.match(edge, /100\.0/);
  assert.match(edge, /105\.0/);
  assert.match(A.coefficient(t, 'Fe', 999).error, /outside the table .*1000\.0.*2000\.0 eV/);
  assert.equal(A.coefficient(t, 'Xx', 1500).error, 'No mass attenuation table for Xx.');
  assert.equal(A.coefficient(null, 'Fe', 1500).error, 'The absorption table is not loaded.');
  assert.match(A.coefficient(t, 'Fe', -1).error, /positive photon energy/);
});
