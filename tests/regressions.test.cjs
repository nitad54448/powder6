const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const database = JSON.parse(read('sg/all.json'));
const tables = {
  xray: JSON.parse(read('scatters/xray_wk1995_ions.json')),
  neutron: JSON.parse(read('scatters/neutron.json'))
};
const plain = value => JSON.parse(JSON.stringify(value));

function app(withTables = true) {
  const storage = new Map(), messages = [];
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, TextDecoder, TextEncoder,
    performance, setTimeout, clearTimeout, navigator: { hardwareConcurrency: 2 },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    RV: { version: '2.6', bus: { emit() {}, on() {} }, ui: {
      readBuffer: f => f.arrayBuffer(), toast: (message, kind) => messages.push({ message, kind }),
      log() {}, logLoad() {}, progress() {}, confirm: async () => true,
      fmt: String, esc: String, stamp: () => '2026-10-21', fileStamp: () => '20261021'
    } }
  });
  context.window = context;
  for (const file of ['constants', 'crystal', 'profile', 'wppf_linear', 'atomic_constraints', 'rietveld_core',
    'cif_reader', 'data_io', 'parsers', 'cif_structure']) {
    vm.runInContext(read('js/' + file + '.js'), context, { filename: file + '.js' });
  }
  context.SG_DATABASE = database;
  for (const file of ['js/sg_engine.js', 'js/rietveld/rv_state.js', 'js/rietveld/rv_commands.js',
    'js/rietveld/rv_results.js', 'js/rietveld/rv_gsas2.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const state = context.RV.state;
  state.S.sgReady = true;
  if (withTables) state.setTables(tables);
  return { context, state, S: state.S, core: context.RVCore, messages, storage,
    run: source => vm.runInContext(source, context) };
}

function file(name, text) {
  const bytes = new TextEncoder().encode(text);
  return { name, arrayBuffer: async () => bytes.buffer };
}

function model(a = app()) {
  a.S.calculation = 'rietveld';
  for (const [name, length] of [['Si', 5], ['Na', 7]]) {
    a.state.addPhase(a.state.makePhase({ name, sg: a.state.resolveSG(221), cell: { a: length },
      atoms: [{ label: name + '1', type: name, x: 0, y: 0, z: 0, B: 0.5, occ: 1 }] }));
  }
  const ds = a.state.makeDataset({ name: 'mixture', tth: Array.from({ length: 150 }, (_, i) => 10 + i * 0.5),
    y: Array(150).fill(100), inst: { bkgN: 1, lambda2: 0, ratio: 0 } });
  a.S.datasets.push(ds); a.state.selectIds([ds.id]);
  ds.p['p1.scale'] = 0.002; ds.p['p2.scale'] = 0.003; ds.p.bkg0 = 17;
  ds.y = a.core.evaluate(a.state.problemFor([ds]), 0).ycalc;
  Object.keys(ds.fit).forEach(k => { ds.fit[k] = k === 'bkg0'; });
  return { ...a, ds };
}

function fitted(a = model()) {
  const job = a.state.jobFor(a.ds), result = a.core.refine(job);
  assert.equal(result.ok, true, result.msg);
  a.state.applyResult([a.ds], result, job, false);
  return a;
}

test('scale estimation recovers both phase scales and the constant background', () => {
  const a = model();
  a.ds.p['p1.scale'] = 1e-9; a.ds.p['p2.scale'] = 1e-9; a.ds.p.bkg0 = 1;
  assert.equal(a.state.estimateScales(a.ds), true);
  assert.ok(Math.abs(a.ds.p['p1.scale'] - 0.002) < 1e-10);
  assert.ok(Math.abs(a.ds.p['p2.scale'] - 0.003) < 1e-10);
  assert.ok(Math.abs(a.ds.p.bkg0 - 17) < 1e-8);
});

test('ESD, FXYE and XYE uncertainties reach the fit weights', async () => {
  const a = app();
  await a.context.RV.cmd.readFiles([
    file('scan.esd', 'BANK 1 2 1 CONST 1000 100 0 0 ESD\n100 2 400 30'),
    file('scan.gsa', 'BANK 1 2 1 CONST 1000 100 0 0 FXYE\n1000 100 2\n1100 400 30'),
    file('scan.xye', '10 100 2\n11 400 30')
  ]);
  assert.equal(a.S.datasets.length, 3);
  for (const ds of a.S.datasets) {
    assert.deepEqual(Array.from(ds.sig), [2, 30]);
    assert.deepEqual(Array.from(a.state.fitPoints(ds).w), [0.25, 1 / 900]);
  }
});

test('uncertainties and explicit weights follow sorted, filtered and duplicate points', () => {
  const a = app();
  const parsed = a.run("normalizeParsedData({tth:[12,NaN,10,11,11],intensity:[120,5,100,110,999],sig:[12,1,2,3,9],weights:[.1,.2,.3,0,.9]})");
  assert.deepEqual(plain(parsed), { tth: [10, 11, 12], intensity: [100, 110, 120], sig: [2, 3, 12], weights: [0.3, 0, 0.1] });
  assert.throws(() => a.run("detectAndParseFile('bad.esd','BANK 1 2 1 CONST 1000 100 0 0 ESD\\n100 0 400 30')"), /uncertainty/);
  assert.throws(() => a.run("parseDataFile('10 100 0\\n11 400 30','bad.xye')"), /uncertainty/);
});

test('pdCIF weights, including zero, survive unit weights, projects and undo', async () => {
  const a = app();
  await a.context.RV.cmd.readFiles([file('weights.cif', 'data_weights\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n_pd_proc_ls_weight\n10 100 .25\n11 400 0\n12 500 .1\n')]);
  let ds = a.S.datasets[0];
  assert.deepEqual(Array.from(a.state.fitPoints(ds).w), [0.25, 0, 0.1]);
  a.state.commitProject(a.state.prepareProject(JSON.parse(a.state.projectJSON([]))));
  ds = a.S.datasets[0];
  assert.deepEqual(Array.from(ds.weights), [0.25, 0, 0.1]);
  a.context.RV.history.take('weight change'); a.state.setSetting('weight', 'unit');
  assert.deepEqual(Array.from(a.state.fitPoints(ds).w), [1, 0, 1]);
  a.context.RV.history.undo(); ds = a.S.datasets[0];
  assert.deepEqual(Array.from(a.state.fitPoints(ds).w), [0.25, 0, 0.1]);
});

test('adding and removing phases invalidates active and saved calculation results', () => {
  for (const action of ['add', 'remove']) {
    const a = fitted(); a.state.saveCalculation();
    assert.equal(a.ds.stats.Rwp, 0);
    if (action === 'remove') a.state.removePhase('p1');
    else a.state.addPhase(a.state.makePhase({ name: 'extra', sg: a.state.resolveSG(221), cell: { a: 8 },
      atoms: [{ label: 'C1', type: 'C', x: 0, y: 0, z: 0 }] }));
    assert.equal(a.ds.stats, null); assert.equal(Object.keys(a.ds.esd).length, 0);
    assert.equal(a.ds.calculations.rietveld.stats, null);
    assert.equal(a.ds.calculations.rietveld.ints, null);
    assert.equal(a.context.RV.results.statsOf(a.ds).fitted, false);
  }
});

test('each pdCIF block retains its wavelength and every profile is imported', async () => {
  const text = 'data_cu\n_diffrn_radiation_wavelength 1.540598\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n10 100\n11 200\ndata_co\n_diffrn_radiation_wavelength 1.788965\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n20 300\n21 400\n';
  const a = app(); a.context.input = text;
  const profiles = a.run('parsePdCifFiles(input)');
  assert.deepEqual(Array.from(profiles, p => p.wavelength), [1.540598, 1.788965]);
  await a.context.RV.cmd.readFiles([file('multi.cif', text)]);
  assert.equal(a.S.datasets.length, 2);
  assert.deepEqual(Array.from(a.S.datasets, d => d.inst.lambda1), [1.540598, 1.788965]);
  assert.deepEqual(Array.from(a.S.datasets[0].y), [100, 200]);
  assert.deepEqual(Array.from(a.S.datasets[1].y), [300, 400]);
});

test('neutron and explicit single-line pdCIF imports do not acquire a doublet', async () => {
  const a = app();
  for (const probe of ['neutron', 'x-ray']) {
    await a.context.RV.cmd.readFiles([file('single.cif', 'data_single\n_diffrn_radiation.probe ' + probe + '\n_diffrn_radiation_wavelength 1.540598\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n10 100\n11 200\n')]);
    const inst = a.S.datasets[0].inst;
    assert.equal(inst.radiation, probe === 'neutron' ? 'neutron' : 'xray');
    assert.equal(inst.lambda2, 0); assert.equal(inst.ratio, 0);
    if (probe === 'neutron') assert.equal(a.state.polK(inst), 0);
  }
});

test('CIF comments, quoted hashes, wrapped rows and multiline fields preserve atoms', () => {
  const a = app();
  a.context.input = "data_test\n_chemical_name_common\n;\nloop_\ndata_not_a_block\n;\n_cell_length_a\n5\n_space_group_IT_number 1\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n'C#1' C .1 .2 .3 # note with arbitrary tokens\nO1 O .4\n.5 .6 # another note\n";
  const cif = a.run('CifStructure.parse(input)');
  assert.equal(cif.blocks, 1); assert.equal(cif.cell.a, 5); assert.equal(cif.atoms.length, 2);
  assert.equal(cif.atoms[0].siteLabel, 'C#1'); assert.equal(cif.atoms[1].z, 0.6);
  a.context.input = 'data_p\nloop_\n_pd_meas_2theta_scan\n_pd_meas_intensity_total\n10\n100 # comment\n11 200\n';
  assert.deepEqual(Array.from(a.run('parsePdCifFile(input).intensity')), [100, 200]);
  assert.throws(() => a.run("CifStructure.parse('data_bad\\nloop_\\n_atom_site_label\\n_atom_site_fract_x\\nC1')"), /Incomplete CIF loop/);
});

test('Rietveld rejects missing factors in the UI and fit core; zero neutron lengths remain valid', () => {
  const a = model(); a.S.tables = null;
  assert.match(a.state.calculationIssue(), /Missing scattering factors/);
  assert.throws(() => a.state.jobFor(a.ds), /Missing scattering factors/);
  const result = a.core.refine(a.state.problemFor([a.ds]), { evaluateOnly: true });
  assert.equal(result.ok, false); assert.match(result.msg, /Missing X-ray scattering factor/);
  a.state.setCalculation('wppf');
  assert.equal(a.state.calculationIssue(), '');
  a.state.setCalculation('rietveld');
  a.state.setTables({ neutron: { table: { Si: { b_coh: 0 }, Na: { b_coh: -3 } } } });
  a.ds.inst.radiation = 'neutron';
  assert.equal(a.state.calculationIssue(), '');
  assert.equal(a.core.refine(a.state.problemFor([a.ds]), { evaluateOnly: true }).ok, true);
});

test('pdCIF export/reimport preserves radiation, wavelengths, zero, weights and phase associations', async () => {
  const a = model(), first = a.ds;
  first.phases = ['p1']; first.inst.ratio = 0.47; first.inst.lambda2 = 1.544426; first.p.zero = 0.12;
  first.weights = Float64Array.from(first.tth, (_, i) => i === 5 ? 0 : 0.25);
  a.state.invalidate(first);
  const second = a.state.makeDataset({ name: 'neutron', tth: first.tth, y: first.y, phases: ['p2'],
    inst: { radiation: 'neutron', lambda1: 1.8, lambda2: 0, ratio: 0, bkgN: 1 }, p: { zero: -0.07 } });
  a.S.datasets.push(second);
  const text = a.context.RV.results.cifText([first, second], true);
  a.context.input = text;
  const profiles = a.run('parsePdCifFiles(input)');
  assert.equal(profiles[0].wavelength2, 1.544426); assert.equal(profiles[0].ratio21, 0.47);
  assert.equal(profiles[0].zeroShift, 0.12); assert.equal(profiles[0].weights[5], 0);
  assert.equal(profiles[1].radiation, 'neutron'); assert.equal(profiles[1].zeroShift, -0.07);
  const b = app(); await b.context.RV.cmd.readFiles([file('roundtrip.cif', text)]);
  assert.equal(b.messages.filter(m => m.kind === 'err').length, 0, JSON.stringify(b.messages));
  assert.equal(b.S.datasets.length, 2); assert.equal(b.S.phases.length, 2);
  assert.equal(b.S.datasets[0].phases.length, 1); assert.equal(b.S.datasets[1].phases.length, 1);
  assert.notEqual(b.S.datasets[0].phases[0], b.S.datasets[1].phases[0]);
  assert.equal(b.S.datasets[0].inst.ratio, 0.47); assert.equal(b.S.datasets[1].inst.radiation, 'neutron');
  assert.equal(b.S.datasets[1].p.zero, -0.07);
});

test('undo of a project load restores weighting, defaults, fit results and persisted settings', async () => {
  const a = fitted();
  const originalWeight = Array.from(a.state.fitPoints(a.ds).w);
  const project = JSON.parse(a.state.projectJSON([]));
  project.settings.weight = 'unit'; project.settings.bkgN = 2; project.settings.nAnchors = 4; project.settings.inst.lambda1 = 2;
  await a.context.RV.cmd.openProject(JSON.stringify(project));
  assert.equal(a.S.settings.weight, 'unit');
  a.context.RV.history.undo();
  const restored = a.S.datasets[0];
  assert.equal(a.S.settings.weight, 'poisson'); assert.equal(a.S.settings.bkgN, 6); assert.equal(a.S.settings.nAnchors, 12);
  assert.equal(a.S.settings.inst.lambda1, 1.540598); assert.equal(restored.stats.weight, 'poisson');
  assert.deepEqual(Array.from(a.state.fitPoints(restored).w), originalWeight);
  assert.equal(JSON.parse(a.storage.get('powder6.settings')).weight, 'poisson');
});

test('bundled powder data and pdCIF fixtures remain readable', async () => {
  const a = app();
  for (const name of fs.readdirSync(path.join(root, 'test_files'))) {
    const bytes = fs.readFileSync(path.join(root, 'test_files', name));
    a.context.inputName = name;
    a.context.inputBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parsed = await a.run('(async()=>normalizeParsedData(await detectAndParseBuffer(inputName,inputBytes),inputName))()');
    assert.ok(parsed.tth.length > 2, name);
    assert.ok(parsed.tth[0] < parsed.tth[parsed.tth.length - 1], name);
  }
});

test('GSAS-II export respects imported weights and omits zero-weight observations', () => {
  const a = model();
  a.ds.weights = Float64Array.from(a.ds.tth, (_, i) => i === 5 ? 0 : 0.25);
  const lines = a.context.RV.gsas2.xyeOf(a.ds).split('\n').filter(line => line && !line.startsWith('#'));
  assert.equal(lines.length, a.ds.tth.length - 1);
  assert.equal(Number(lines[0].trim().split(/\s+/)[2]), 2);
  assert.ok(!lines.some(line => Number(line.split(/\s+/)[0]) === a.ds.tth[5]));
});

test('pdCIF range axes, wavelength loops, calibration and reflection aliases still work', () => {
  const a = app();
  a.context.input = `data_range
_cell_length_a 5
_space_group_name_Hall 'P 1'
_pd_meas_2theta_range_min 10
_pd_meas_2theta_range_inc .5
loop_
_diffrn_radiation_wavelength_id
_diffrn_radiation_wavelength
_diffrn_radiation_wavelength_wt
2 1.544426 .5
1 1.540598 1
loop_
_pd_calib_xcoord.nominal_2theta
_pd_calib_xcoord.actual_2theta
10 9.9
20 19.9
loop_
_refln_index_h
_refln_index_k
_refln_index_l
_refln_f_squared_meas
_refln_f_squared_sigma
1 0 0 100 5
loop_
_pd_meas_intensity_total
_pd_calc_intensity_total
_pd_calc_intensity_bkg
100(2) 98 4
200(3) 195 5
`;
  const p = a.run('parsePdCifFile(input)');
  assert.deepEqual(Array.from(p.tth), [10, 10.5]);
  assert.deepEqual(Array.from(p.sig), [2, 3]);
  assert.deepEqual(Array.from(p.calc), [98, 195]);
  assert.deepEqual(Array.from(p.bkg), [4, 5]);
  assert.equal(p.wavelength, 1.540598); assert.equal(p.ratio21, 0.5);
  assert.ok(Math.abs(p.zeroShift - 0.1) < 1e-12);
  assert.equal(p.hklList[0].Fsq_sigma, 5); assert.equal(p.spaceGroup.hall, 'P 1');
  assert.equal(p.cell.a, 5); assert.equal(p.hasCalculatedData, true);
  a.context.input = 'data_calc\nloop_\n_pd_meas_2theta_scan\n_pd_calc_intensity_total\n10 100\n11 200\n';
  const simulation = a.run('parsePdCifFile(input)');
  assert.equal(simulation.hasCalculatedData, false); assert.equal(simulation.calc, null);
});

test('the bundled demo generates patterns and its default Rietveld fit succeeds', async () => {
  const a = app(); await a.context.RV.cmd.demo();
  assert.equal(a.S.datasets.length, 2); assert.equal(a.S.phases.length, 2);
  const job = a.state.jobFor(a.S.datasets[0]); job.maxIter = 5;
  const result = a.core.refine(job);
  assert.equal(result.ok, true, result.msg);
  assert.ok(Number.isFinite(result.stats[0].Rwp));
});
