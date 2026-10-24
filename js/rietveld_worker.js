// rietveld_worker.js -- runs one fit (rietveld_core.js) off the main thread: Rietveld, Le Bail and WPPF phases,
// one or several datasets.
//
// The same modules the page uses, in the same order: the profile shape of the fit is the one the page draws. The
// job carries everything else (operators, scattering factors, the data), so nothing is fetched here.
//
//   in : { type: 'refine', id, problem }            a fit
//        { type: 'extract', id, problem, precision } no iteration: statistics, uncertainties and the intensities of
//                                                   the Le Bail and WPPF phases at the current values (the start of
//                                                   the space-group test, charge flipping and the Wyckoff search)
//   out: { type: 'iter', id, it, chi2, maxIter }   after every accepted step
//        { type: 'done', id, result }             RVCore.refine's result
//
// Stop is the page terminating the worker: a refinement has no state worth keeping half-way.
importScripts('constants.js', 'crystal.js', 'profile.js', 'wppf_linear.js', 'atomic_constraints.js', 'wyckoff_limits.js', 'distance_rules.js', 'atom_restraints.js', 'rietveld_core.js', 'pt_gpu.js');

self.onmessage = async function (e) {
    var m = e.data;
    if (!m || (m.type !== 'refine' && m.type !== 'extract')) return;
    var result = await RVCore.refineAsync(m.problem, {
        evaluateOnly: m.type === 'extract',
        precision: m.precision || null,
        onIter: function (p) { self.postMessage({ type: 'iter', id: m.id, it: p.it, chi2: p.chi2, maxIter: p.maxIter }); }
    });
    self.postMessage({ type: 'done', id: m.id, result: result });
};
