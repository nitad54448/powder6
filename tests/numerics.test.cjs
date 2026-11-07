// Reference values worked out by hand (closed-form geometry and small linear systems), not read back from the code.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const js = f => require(path.resolve(__dirname, '..', 'js', f));
// the app's modules read the constants as script-scope globals
Object.assign(globalThis, js('constants.js'));
const crystal = js('crystal.js');
const wl = js('wppf_linear.js');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' got ' + a + ', expected ' + b);

test('cell volumes match the closed forms', () => {
  near(crystal.cellVolume({ a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 }), 125, 1e-9, 'cubic');
  near(crystal.cellVolume({ a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 }), 16 * 6 * Math.sin(Math.PI * 2 / 3), 1e-9, 'hexagonal');
  near(crystal.cellVolume({ a: 5, b: 6, c: 7, alpha: 90, beta: 100, gamma: 90 }), 210 * Math.sin(100 * Math.PI / 180), 1e-9, 'monoclinic');
  // rhombohedral cell, a = 5, alpha = 60: V = a^3 sqrt(1 - 3cos^2 + 2cos^3) = a^3 / sqrt(2)
  near(crystal.cellVolume({ a: 5, b: 5, c: 5, alpha: 60, beta: 60, gamma: 60 }), 125 / Math.SQRT2, 1e-9, 'rhombohedral');
});

test('d-spacings match the closed forms', () => {
  const cubic = { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 };
  near(crystal.dSpacing(cubic, 1, 1, 1), 5 / Math.sqrt(3), 1e-12, 'cubic 111');
  near(crystal.dSpacing(cubic, 2, 0, 0), 2.5, 1e-12, 'cubic 200');
  const ortho = { a: 5, b: 6, c: 7, alpha: 90, beta: 90, gamma: 90 };
  near(crystal.dSpacing(ortho, 1, 2, 3), 1 / Math.sqrt(1 / 25 + 4 / 36 + 9 / 49), 1e-12, 'orthorhombic 123');
  const hex = { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 };
  near(crystal.dSpacing(hex, 1, 0, 0), 4 * Math.sqrt(3) / 2, 1e-12, 'hexagonal 100');
  near(crystal.dSpacing(hex, 0, 0, 1), 6, 1e-12, 'hexagonal 001');
  near(crystal.dSpacing(hex, 1, 1, 0), 2, 1e-12, 'hexagonal 110');
  const mono = { a: 5, b: 6, c: 7, alpha: 90, beta: 100, gamma: 90 };
  const sb = Math.sin(100 * Math.PI / 180), cb = Math.cos(100 * Math.PI / 180);
  // 1/d^2 = (h^2/a^2 + l^2/c^2 - 2hl cos(beta)/(ac)) / sin^2(beta) + k^2/b^2
  const q = (1 / 25 + 4 / 49 - 2 * 2 * cb / 35) / (sb * sb) + 9 / 36;
  near(crystal.dSpacing(mono, 1, 3, 2), 1 / Math.sqrt(q), 1e-12, 'monoclinic 132');
});

test('an unusable cell or reflection gives null, not NaN', () => {
  assert.equal(crystal.dSpacing({ a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 }, 0, 0, 0), null);
});

test('Lorentz and polarisation factors match their definitions', () => {
  near(crystal.sharkoLorentzFactor(90), 1 / (0.5 * Math.SQRT1_2), 1e-12, 'L at 90');
  assert.ok(Number.isNaN(crystal.sharkoLorentzFactor(0)) && Number.isNaN(crystal.sharkoLorentzFactor(180)));
  near(crystal.sharkoPolarizationFactor(90, 1), 0.5, 1e-12, 'P at 90 deg, K = 1');
  near(crystal.sharkoPolarizationFactor(0, 1), 1, 1e-12, 'P at 0 deg');
  near(crystal.sharkoPolarizationFactor(60, 0), 1, 1e-12, 'unpolarised-free K = 0 gives 1');
  near(crystal.sharkoPolarizationFactor(60, 1), (1 + 0.25) / 2, 1e-12, 'P at 60 deg, K = 1');
  near(crystal.sharkoLorentzPolarization(90, 1), 0.5 / (0.5 * Math.SQRT1_2), 1e-12, 'Lp at 90');
  assert.equal(crystal.sharkoLorentzPolarization(0, 1), 1, 'a degenerate angle leaves the intensity alone');
  near(crystal.sharkoPolarizationK(0), 1, 0, 'no monochromator');
  near(crystal.sharkoPolarizationK(26.6), Math.cos(26.6 * Math.PI / 180) ** 2, 1e-12, 'monochromator angle');
});

function skyline(rows) {            // rows: full symmetric matrix as arrays; the envelope is each row's first non-zero column
  const n = rows.length, first = new Int32Array(n);
  for (let i = 0; i < n; i++) { let f = i; for (let j = 0; j < i; j++) if (rows[i][j] !== 0) { f = j; break; } first[i] = f; }
  const m = new wl.SkylineMatrix(first);
  for (let i = 0; i < n; i++) for (let j = first[i]; j <= i; j++) m.set(i, j, rows[i][j]);
  return m;
}

test('the skyline Cholesky solve returns the known solution', () => {
  const A = [[4, 1, 0], [1, 3, 1], [0, 1, 2]], x = [1, 2, 3];
  const b = Float64Array.from(A.map(r => r[0] * x[0] + r[1] * x[1] + r[2] * x[2]));
  const res = wl.solveSkylineSPD(skyline(A), b);
  assert.ok(res);
  x.forEach((v, i) => near(res.x[i], v, 1e-12, 'x' + i));
});

test('the skyline product equals the dense product, and an indefinite matrix is refused or repaired', () => {
  const A = [[4, 1, 0, 0], [1, 3, 1, 0], [0, 1, 5, 2], [0, 0, 2, 6]], x = Float64Array.from([1, -2, 3, 0.5]);
  const out = new Float64Array(4);
  wl.skylineMultiply(skyline(A), x, out);
  A.forEach((r, i) => near(out[i], r.reduce((s, v, j) => s + v * x[j], 0), 1e-12, 'row ' + i));
  const bad = wl.solveSkylineSPD(skyline([[1, 2], [2, 1]]), Float64Array.from([1, 1]));
  assert.ok(bad === null || (bad.repaired && bad.repaired.length > 0), 'a negative pivot is not solved silently');
});

test('non-negative least squares clamps a negative component and keeps the rest exact', () => {
  const res = wl.solveNNLS(skyline([[1, 0], [0, 1]]), Float64Array.from([2, -3]));
  const x = res && (res.x || res);
  assert.ok(x, 'a solution is returned');
  near(x[0], 2, 1e-12, 'positive component');
  near(x[1], 0, 1e-12, 'clamped component');
  // coupled case: minimise 0.5 x'Ax - b'x with x >= 0 for A = [[2,1],[1,2]], b = [1,-1]  ->  x = [0.5, 0]
  const c = wl.solveNNLS(skyline([[2, 1], [1, 2]]), Float64Array.from([1, -1]));
  const y = c && (c.x || c);
  near(y[0], 0.5, 1e-12, 'coupled x0'); near(y[1], 0, 1e-12, 'coupled x1');
});

test('the one erfc is exact at zero, matches erfc(1) and is symmetric about it', () => {
  const profile = js('profile.js');
  near(profile.sharkoErfc(0), 1, 1.2e-7, 'erfc(0) is 1 to the approximation error');
  near(profile.sharkoErfc(1), 0.15729920705028513, 1.2e-7, 'erfc(1)');
  for (const x of [0.01, 0.5, 2, 5]) near(profile.sharkoErfc(-x), 2 - profile.sharkoErfc(x), 1e-12, 'erfc(-' + x + ')');
});


test('minimum-image distances include translations beyond a fixed shell in every axis order', () => {
  const cell={a:1,b:10,c:10,alpha:90,beta:90,gamma:1}, G=crystal.metricTensor(cell);
  const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const expected=Math.hypot(-4.51+4.9*Math.cos(Math.PI/180),4.9*Math.sin(Math.PI/180));
  for(const order of permutations){
    const metric=order.map(i=>order.map(j=>G[i][j])), d=order.map(i=>[.49,.49,0][i]);
    near(crystal.fracDistance(metric,...d),expected,1e-10,'skew cell '+order);
    near(crystal.fracDistance(metric,...d.map((v,i)=>v+[7,-4,3][i])),expected,1e-10,'translated image');
    near(crystal.fracDistance(metric,...d.map(v=>-v)),expected,1e-10,'inverted separation');
  }
});

test('minimum-image sphere search matches exhaustive images for oblique metrics', () => {
  let seed=48271;
  const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let trial=0;trial<60;trial++){
    const basis=[[1+random()*2,random()*2-1,random()*2-1],[0,1+random()*2,random()*2-1],[0,0,1+random()*2]];
    const G=[0,1,2].map(i=>[0,1,2].map(j=>basis.reduce((s,r)=>s+r[i]*r[j],0)));
    const d=[random()-.5,random()-.5,random()-.5];let best=Infinity;
    for(let i=-4;i<=4;i++)for(let j=-4;j<=4;j++)for(let k=-4;k<=4;k++){
      const v=[d[0]+i,d[1]+j,d[2]+k];
      const sq=basis.reduce((s,r)=>s+Math.pow(r.reduce((t,x,a)=>t+x*v[a],0),2),0);best=Math.min(best,sq);
    }
    near(crystal.fracDistance(G,...d),Math.sqrt(best),1e-11,'exhaustive trial '+trial);
  }
});

test('minimum-image search stays exact in a strongly skewed, non-reduced cell', () => {
  const G=crystal.metricTensor({a:2,b:20,c:7,alpha:85,beta:86,gamma:3});
  const sq=v=>v.reduce((s,x,i)=>s+x*v.reduce((t,y,j)=>t+G[i][j]*y,0),0);
  for(const d of [[.31,.27,.11],[-.42,.48,.37],[.5,-.13,-.29]]){
    let best=Infinity;
    for(let i=-30;i<=30;i++)for(let j=-6;j<=6;j++)for(let k=-6;k<=6;k++)best=Math.min(best,sq([d[0]+i,d[1]+j,d[2]+k]));
    near(crystal.fracDistance(G,...d),Math.sqrt(best),1e-10,'skewed cell '+d);
  }
});

test('a metric without a real cell keeps a finite distance and zero separation stays zero', () => {
  const cells=[{a:5,b:5,c:5,alpha:125,beta:125,gamma:125},{a:5,b:5,c:5,alpha:60,beta:60,gamma:120}];
  for(const G of cells.map(crystal.metricTensor).concat([[[1,2,0],[2,1,0],[0,0,1]]])){
    assert.equal(crystal.fracDistance(G,0,0,0),0);
    assert.ok(Number.isFinite(crystal.fracDistance(G,.31,.27,.11)),'finite distance');
  }
});

test('a non-finite separation in an oblique cell is beyond every cutoff', () => {
  const G=crystal.metricTensor({a:5,b:6,c:7,alpha:80,beta:100,gamma:110});
  assert.equal(crystal.fracDistance(G,NaN,0,0),Infinity);
});

test('almost singular cells return a real image within a bounded search', () => {
  const cells=[{a:10,b:10,c:10,alpha:90,beta:90,gamma:1e-6},{a:10,b:10,c:10,alpha:30,beta:40,gamma:70}];
  for(const cell of cells){
    const G=crystal.metricTensor(cell), start=performance.now();
    for(let i=0;i<200;i++)assert.ok(Number.isFinite(crystal.fracDistance(G,.31+i*.001,.27,.11)),'finite distance');
    // about 0.1 ms per call bounded; an unbounded search takes about 900 ms per call
    assert.ok(performance.now()-start<2000,'bounded search');
  }
});

test('doublet size broadening uses each line wavelength and preserves the source area ratio', () => {
  const profile=js('profile.js');
  const p={profileType:'tch_aniso',separated:true,U:0,V:0,W:0,X:0,Y:0,Z:0,size:.1,sizeMix:1,strain:0,lambda:1.540598,lambda2:1.544426,ratio:.5,minFwhm:1e-6};
  const peak={tth:80,d:p.lambda/(2*Math.sin(40*Math.PI/180)),h_orig:1,k_orig:0,l_orig:0};
  const axis=Float64Array.from({length:2001},(_,i)=>70+i*.01), cs=profile.buildPeakContributions(axis,[peak],p);
  assert.equal(cs.length,2);
  for(let i=0;i<2;i++){
    const wavelength=i?p.lambda2:p.lambda, t=2*Math.asin(wavelength/(2*peak.d));
    const expected=.018*wavelength/(Math.PI*p.size*Math.cos(t/2));
    // Compare the untruncated TCH width; pedestal subtraction changes the displayed FWHM.
    near(cs[i].prep.fwhm,expected,1e-7,'line '+i);
  }
  near(cs[1].weight*profile.preparedProfileArea(cs[1].prep)/profile.preparedProfileArea(cs[0].prep),.5,1e-12,'integrated ratio');
  assert.equal(p.lambda,1.540598,'input parameters remain unchanged');
});
