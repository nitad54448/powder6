// RV.project.unpack must refuse a damaged or hostile archive with a clear message.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const context = vm.createContext({ console, TextDecoder, TextEncoder, setTimeout, clearTimeout, setImmediate, clearImmediate,
  RV: { state: { S: {} } } });
context.window = context;
vm.runInContext(read('lib/jszip.min.js'), context, { filename: 'jszip.min.js' });
vm.runInContext(read('js/rietveld/rv_project.js'), context, { filename: 'rv_project.js' });
const { JSZip, RV } = context;

// bytes made inside the context: JSZip there does not recognise a typed array of this realm
const f64 = values => { const bytes = new Uint8Array(new Float64Array(values).buffer), out = new (vm.runInContext('Uint8Array', context))(bytes.length); out.set(bytes); return out; };
const i32 = values => { const bytes = new Uint8Array(new Int32Array(values).buffer), out = new (vm.runInContext('Uint8Array', context))(bytes.length); out.set(bytes); return out; };
async function archive(edit) {
  const doc = { format: 'powder6-project', version: 3, datasets: [{ name: 'd', dataKey: 'k1' }],
    observations: [{ key: 'k1', columns: { tth: { path: 'o/tth.f64', length: 3 }, y: { path: 'o/y.f64', length: 3 } } }] };
  const files = { 'o/tth.f64': f64([10, 20, 30]), 'o/y.f64': f64([1, 2, 3]) };
  if (edit) edit(doc, files);
  const zip = new JSZip();
  zip.file('project.json', typeof doc === 'string' ? doc : JSON.stringify(doc));
  for (const [name, data] of Object.entries(files)) if (data) zip.file(name, data);
  return zip.generateAsync({ type: 'uint8array' });
}
const rejects = (edit, pattern) => async () => assert.rejects(async () => RV.project.unpack(await archive(edit)), pattern);

test('a well-formed project unpacks and hands each dataset its columns', async () => {
  const doc = await RV.project.unpack(await archive());
  assert.deepEqual(Array.from(doc.datasets[0].tth), [10, 20, 30]);
  assert.deepEqual(Array.from(doc.datasets[0].y), [1, 2, 3]);
  assert.equal(doc.datasets[0].sig, null);
});

test('a project.json that is not JSON is reported as such', async () => {
  const zip = new JSZip(); zip.file('project.json', '{ not json');
  await assert.rejects(async () => RV.project.unpack(await zip.generateAsync({ type: 'uint8array' })), /not valid JSON/);
});

test('an observation set without its columns object is refused with a message, not a TypeError',
  rejects(doc => { delete doc.observations[0].columns; }, /Invalid observation identifier/));

test('observation keys cannot collide with Object.prototype names',
  rejects(doc => { doc.observations.push({ key: 'k1', columns: {} }); }, /Invalid observation identifier/));

test('a key such as constructor or __proto__ is an ordinary key, not an inherited one', async () => {
  for (const key of ['constructor', '__proto__', 'toString']) {
    const bytes = await archive((doc, files) => { doc.datasets[0].dataKey = key; doc.observations[0].key = key; });
    const doc = await RV.project.unpack(bytes);
    assert.deepEqual(Array.from(doc.datasets[0].tth), [10, 20, 30], key);
  }
});

test('a dataset that points to missing observations is refused',
  rejects(doc => { doc.datasets[0].dataKey = 'nope'; }, /Missing observations for d/));

test('a column that claims a different length than its data is refused',
  rejects(doc => { doc.observations[0].columns.tth.length = 5; }, /length mismatch/));

test('an absurd declared column length is refused before anything is allocated',
  rejects(doc => { doc.observations[0].columns.tth.length = 1e15; }, /Invalid observation column/));

test('a negative or fractional column length is refused',
  rejects(doc => { doc.observations[0].columns.tth.length = -3; }, /Invalid observation column/));

test('a missing column file is refused',
  rejects((doc, files) => { delete files['o/y.f64']; }, /Missing observation column o\/y\.f64/));

test('datasets must be a list',
  rejects(doc => { doc.datasets = {}; }, /Missing project datasets/));

test('versions 3 and 4 are read, anything else is refused',
  rejects(doc => { doc.version = 2; }, /Unsupported project format/));
test('a version 5 archive is refused rather than guessed at',
  rejects(doc => { doc.version = 5; }, /Unsupported project format/));

// The WPPF precision block: its own entries in a version 4 archive, the flat matrix and index in project.json before.
test('the precision block of a version 4 archive comes back as the matrix RV.sgtest reads', async () => {
  const bytes = await archive((doc, files) => {
    doc.version = 4;
    doc.solutionState = { ints: { pre: { n: 2, available: 2, s2: 1.5,
      Q: { path: 'solution/precision.Q.f64', length: 4 }, index: { path: 'solution/precision.index.i32', length: 2 } } } };
    files['solution/precision.Q.f64'] = f64([1, 0.25, 0.25, 2]);
    files['solution/precision.index.i32'] = i32([0, 7]);
  });
  const doc = await RV.project.unpack(bytes);
  // Array.from: the values are decoded inside the vm realm, whose Array is not this realm's
  assert.deepEqual(Array.from(doc.solutionState.ints.pre.Q), [1, 0.25, 0.25, 2]);
  assert.deepEqual(Array.from(doc.solutionState.ints.pre.index), [0, 7]);
  assert.equal(doc.solutionState.ints.pre.s2, 1.5);
});
test('a version 3 archive that kept the precision block in project.json still reads', async () => {
  const doc = await RV.project.unpack(await archive(doc => {
    doc.solutionState = { ints: { pre: { n: 2, available: 2, s2: 1, Q: [1, 0, 0, 1], index: [0, 1] } } };
  }));
  assert.deepEqual(Array.from(doc.solutionState.ints.pre.Q), [1, 0, 0, 1]);
  assert.deepEqual(Array.from(doc.solutionState.ints.pre.index), [0, 1]);
});
test('a precision block whose entries are missing or the wrong size is refused',
  rejects(doc => {
    doc.version = 4;
    doc.solutionState = { ints: { pre: { n: 2, Q: { path: 'solution/precision.Q.f64', length: 4 }, index: { path: 'solution/precision.index.i32', length: 2 } } } };
  }, /Missing the WPPF precision block/));
test('a precision block that claims more values than its entry holds is refused', async () => {
  const bytes = await archive((doc, files) => {
    doc.version = 4;
    doc.solutionState = { ints: { pre: { n: 2, Q: { path: 'solution/precision.Q.f64', length: 9 }, index: { path: 'solution/precision.index.i32', length: 2 } } } };
    files['solution/precision.Q.f64'] = f64([1, 0.25, 0.25, 2]);
    files['solution/precision.index.i32'] = i32([0, 7]);
  });
  await assert.rejects(async () => RV.project.unpack(bytes), /precision block length mismatch/);
});

// Small limits exercise actual ZIP metadata and decoding without huge fixtures.
function limited(overrides) {
  const sandbox=vm.createContext({console,TextDecoder,TextEncoder,setTimeout,clearTimeout,setImmediate,clearImmediate,RV:{state:{S:{}}}});
  sandbox.window=sandbox;
  vm.runInContext(read('lib/jszip.min.js'),sandbox);
  const source=read('js/rietveld/rv_project.js').replace(/var LIMITS=\{[^;]+;/,match=>match+'Object.assign(LIMITS,'+JSON.stringify(overrides)+');');
  vm.runInContext(source,sandbox);
  return async bytes=>sandbox.RV.project.unpack(new (vm.runInContext('Uint8Array',sandbox))(bytes));
}
test('archive entry counts are enforced',async()=>{
  await assert.rejects(()=>limited({files:2})(archiveBytes),/Too many files/);
});
let archiveBytes;
test.before(async()=>{archiveBytes=await archive();});
test('cumulative inflated bytes include unreferenced entries',async()=>{
  const stored=await archive((doc,files)=>{files['unused.txt']='x'.repeat(3000);});
  const zip=await JSZip.loadAsync(stored),bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  assert.ok(bytes.byteLength<2000);
  await assert.rejects(()=>limited({archive:2000})(bytes),/uncompressed size/);
});
test('decoded allocation budget counts repeated references and temporary copies',async()=>{
  const bytes=await archive(doc=>{
    for(let i=2;i<=20;i++)doc.observations.push({key:'k'+i,columns:doc.observations[0].columns});
  });
  // Budget permits the JSON and one observation, but not all repeated columns.
  const zip=await JSZip.loadAsync(bytes),jsonSize=zip.file('project.json')._data.uncompressedSize;
  await assert.rejects(()=>limited({decoded:jsonSize*4+100})(bytes),/decoded observations.*memory limit/);
});

function precisionArchive(edit) {
  return archive((doc, files) => {
    doc.version=4;
    doc.solutionState={ints:{pre:{n:2,Q:{path:'q',length:4},index:{path:'ix',length:2}}}};
    files.q=f64([1,0,0,1]);files.ix=i32([0,1]);
    if(edit)edit(doc.solutionState.ints.pre);
  });
}
test('precision allocations count against the decoded budget alongside observations',async()=>{
  const bytes=await precisionArchive(),zip=await JSZip.loadAsync(bytes),jsonSize=zip.file('project.json')._data.uncompressedSize;
  await assert.rejects(()=>limited({decoded:jsonSize*4+96+100})(bytes),/decoded precision block.*memory limit/);
});
test('precision index sizes and signed lengths are validated before decoding',async()=>{
  for(const length of [-1,1.5,1e15])await assert.rejects(()=>precisionArchive(pre=>{pre.index.length=length;}).then(bytes=>RV.project.unpack(bytes)),/Invalid WPPF precision block/);
  await assert.rejects(()=>precisionArchive(pre=>{pre.index.length=3;}).then(bytes=>RV.project.unpack(bytes)),/precision index length mismatch/);
});
