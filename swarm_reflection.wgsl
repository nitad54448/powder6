// swarm_reflection.wgsl
// Reciprocal-space |Fcalc|^2 fitness for the Wyckoff search.
//
// ---------------------------------------------------------------------------
//  WHAT THIS IS, AND WHY IT IS THE ONLY SWARM KERNEL
// ---------------------------------------------------------------------------
//  There used to be a sibling, swarm_density.wgsl, which scored a candidate by
//  how much CHARGE FLIPPING DENSITY sat under its atoms. It is DELETED, and
//  the objective with it -- see the reasoning at the top of wyRunWithDevice()
//  in wyckoff_worker.js. In short: point-sampling a map couples this method to
//  the charge-flipping result it exists to be independent of, and the sample
//  is biased in the wrong direction, since a heavy atom's own
//  series-termination ripples dig a trough underneath it and rank it BELOW a
//  light one.
//
//  What that means for anyone editing this file: the shared machinery -- the
//  RNG, the Wyckoff projection, the symmetry expansion, the Metropolis step,
//  the bond-rule penalties, the reduction -- no longer has a second copy to be
//  kept in step with. A fix here is the whole fix. If you resurrect a second
//  objective, resurrect the diffing discipline with it.
//
//  WHY THE DIRECT-SPACE OBJECTIVE IS WORTH HAVING. The density objective can
//  only be as good as the map, and on a heavy-atom structure the map is the
//  weak link: in PbSO4 the lead ripples run at the same amplitude as the
//  oxygen peaks, so the light atoms are not merely hard to see, they are
//  underneath the noise floor. This objective never forms a map. It compares
//  |Fcalc|^2 against |Fobs|^2 directly, so it has no phase problem, no origin
//  or hand ambiguity, and no ripples -- and because the model carries the
//  composition, it cannot invent an atom where there is no scattering to
//  explain it.
//
//  It is also better conditioned. PbSO4 in Pnma has eleven free positional
//  parameters against several hundred observations. Charge flipping solves for
//  thousands of grid amplitudes and phases from the same data.
//
// ---------------------------------------------------------------------------
//  BINDING 5 IS THE ONLY INTERFACE DIFFERENCE
// ---------------------------------------------------------------------------
//  The density kernel binds the map there. This one binds `groupData`, which
//  the host packs as two regions in one buffer:
//
//      [0 .. fTabOff)              per-group metadata, GROUP_STRIDE floats each
//      [fTabOff .. end)            scattering factors, nRefl * nElem floats
//
//  The scattering factors are ALREADY f(s) * exp(-B s^2 / 4), tabulated per
//  (reflection, element) by swScatteringTable on the host. That is why this
//  kernel needs no d-spacings, no B, and no form-factor evaluation: the entire
//  s-dependence has been folded in before the buffer was written.
// ---------------------------------------------------------------------------

struct Params {
    o0: vec4<f32>, o1: vec4<f32>, o2: vec4<f32>,
    r0: vec4<f32>, r1: vec4<f32>, r2: vec4<f32>,
    nTot: f32, maxSites: f32, numParticles: f32, nGroupsActive: f32, 
    nElem: f32, nBondRules: f32, rMinOff: f32, ruleOff: f32,
    fTabOff: f32, nRefl: f32, penClash: f32, penBond: f32,
    penCoord: f32, penScale: f32, centro: f32, pad0: f32,
    symOff: f32, tablesOff: f32, projOff: f32, penGeom: f32,
    // Cartesian -> fractional (original basis), rows: the inverse of the orthogonalisation, for polyhedron moves
    i0: vec4<f32>, i1: vec4<f32>, i2: vec4<f32>,
    // the share of proposals that move a coordination shell as a unit (0: none; the host sets it when a rule counts)
    polyProb: f32, polyPad0: f32, polyPad1: f32, polyPad2: f32,
};

struct ParticleState {
    fit: f32,
    cc: f32,
    pen: f32,
    stepSize: f32,
    temp: f32,
    seed: u32,
    accepted: u32,
    pad: u32,

    // Best-ever state for this particle's chain, kept so the CPU can batch
    // several generations of dispatches without a chain's discovery being
    // lost when a later Metropolis step accepts a worse move and walks away
    // from it. bestFit is a raw comparison value taken at whatever penScale
    // was active when it was written and is NOT valid to compare directly
    // against a later f_new computed at a different penScale - see the
    // rescoring in the accept block below, which mirrors recordBest() on
    // the JS side. -1e30 in bestFit means "nothing recorded yet".
    bestFit: f32,
    bestCC: f32,
    bestPen: f32,
    bestPad: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<f32>;
@group(0) @binding(1) var<storage, read> particleAssign: array<u32>;
@group(0) @binding(2) var<storage, read> genPack: array<u32>;
@group(0) @binding(3) var<storage, read> staticFloats: array<f32>;
@group(0) @binding(4) var<storage, read> reflPack: array<u32>;
// [group metadata | scattering factor table]; see the header.
@group(0) @binding(5) var<storage, read> groupData: array<f32>;
@group(0) @binding(6) var<storage, read_write> mcmcState: array<ParticleState>;
@group(0) @binding(7) var<uniform> params: Params;

const WG: u32 = 64u;
const MAX_GEN_ATOMS: u32 = 384u; //__MAX_GEN_ATOMS__
const MIN_IMAGE_SHELL: i32 = 0;  //__MIN_IMAGE_SHELL__
// Floats per group in the metadata region.
//   3 -> start, count, Iobs                  (every group weighted equally)
//   4 -> start, count, Iobs, weight          (weight is typically 1/sigma^2)
// Injected by the host exactly like MAX_GEN_ATOMS, so the weighted and
// unweighted packers can share this kernel. It is a compile-time constant, so
// the `weight` branch below folds away entirely when it is 3.
// KERNEL_FOM: wR2-scaled-v2
//
// A CONTRACT MARKER, checked by the host before this kernel is compiled. The
// shader is fetched over HTTP at run time while the JS that reads its output
// ships with the page, so the two can be different vintages: a browser that
// serves a cached copy of this file pairs an OLD kernel with NEW host code.
// That failure is silent and convincing -- the host relabels whatever number
// it is handed, so a kernel computing a different quantity is presented under
// this one's name -- a number that reads like an excellent fit and is not one.
//
// Bump the version whenever the meaning of the value written to
// mcmcState[].cc changes, so an old kernel is refused instead of believed.
const GROUP_STRIDE: u32 = 3u; //__GROUP_STRIDE__
// Injected by the host per run (swInject, sized from js/wyckoff_limits.js), at
// most 32: the rules of one atom are kept as a bitmask in a u32 (myRules).
const MAX_BOND_RULES: u32 = 8u; //__MAX_BOND_RULES__
const RULE_STRIDE: u32 = 7u;   // [aType, bType, dmin, dmax, count, mode, geometry]
// The neighbour vectors a shaped shell needs: MAX_COORD_SLOTS when a rule has
// a geometry, 1 otherwise so a run without shapes carries no extra scratch.
const MAX_GEOM_SLOTS: u32 = 1u; //__MAX_GEOM_SLOTS__
// The squared cosine errors of a shell are weighted by penBond times
// params.penGeom, the Shape weight of the form (default 1).
// `slot` is a FUNCTION-SCOPE array, not workgroup storage, so this constant
// costs nothing against the 16 kB budget that MAX_GEN_ATOMS is competing for.
// It is per-lane scratch: 64 f32 is 256 bytes a thread, and because
// slot[slotOff[k] + m] is dynamically indexed the array was already spilling
// out of registers at 16 -- raising it resizes an existing spill rather than
// creating one.
//
// Injected by the host per run, like MAX_BOND_RULES: 64 unless the
// coordination numbers of the run need more. The per-atom initialisation below
// runs to slotTotal, the slots the rules actually claimed, so a run needing 20
// does not pay for the other 44.
const MAX_COORD_SLOTS: u32 = 64u; //__MAX_COORD_SLOTS__
// POLYHEDRON MOVES. A contract marker like the ones above: the host checks it
// before compiling, so a cached kernel without these moves (and with a shorter
// Params) is refused rather than run with the moves silently missing.
const POLY_MOVES: u32 = 1u; //__POLY_MOVES__
// The partners of one shell a polyhedron move carries, at most (the nearest ones).
const MAX_POLY: u32 = 12u;
const NO_PARTNER_CHARGE: f32 = 5.0;
const COORD_SOFT_A: f32 = 0.25;

// HARD CAPACITIES OF THIS KERNEL. Enforced on the host too - wyckoff_assign.js
// throws in buildAssignmentTables() and buildRestraintTables() before a single
// dispatch - and clamped again here, because WGSL does not trap an
// out-of-range index: it clamps it silently. An overflow therefore shows up
// not as a crash but as two atoms scoring each other's restraints, which is
// indistinguishable from a bad structure.
//
//   MAX_ELEM  - distinct elements in the composition. genPack carries 4 bits
//               of type, so the packing tolerates 16; the binding constraint
//               is local_rMin, which is MAX_ELEM^2 floats of workgroup memory.
//   MAX_SITES - independent Wyckoff sites in one assignment, i.e. the width of
//               prop_sites. The proposal step gives one lane to each site, so
//               this can never usefully exceed the workgroup size of 64.
//
//               32 rather than 16 since a 66-atom molecular structure in a
//               group of order 4 needs 17. The cost is 256 bytes of workgroup
//               memory, 1.6% of the guaranteed 16 kB, and it does not reduce
//               MAX_GEN_ATOMS: swMaxGenAtoms() budgets a flat 20 bytes an atom
//               against 85% of the limit, which already leaves ~3.6 kB spare
//               at the atom cap. Raising it further is cheap in memory and
//               expensive in enumeration: candidate assignments grow steeply
//               with the site budget, and the swarm gains three free
//               coordinates to fit per extra site.
const MAX_ELEM: u32 = 8u;
const MAX_SITES: u32 = 32u;

const TWO_PI: f32 = 6.28318530718;
const NO_NEIGHBOUR: f32 = 1.0e9;

// Murmur-style finalizer, used only to decorrelate the per-lane RNG streams.
//
// The seeding was `seed + lid * 1013u`: an additive offset into one LCG, so
// adjacent lanes ran streams differing by a fixed constant and stayed
// correlated through the permutation. Worse, the seed only advances by the
// number of draws LANE 0 makes, so after a few generations lane 1's stream has
// walked into the region lane 0 already used. Hashing the (seed, lid) pair
// gives each lane an independent-looking stream for three multiplies, once per
// dispatch.
fn hash_u32(x: u32) -> u32 {
    var h = x;
    h ^= h >> 16u;  h *= 0x7feb352du;
    h ^= h >> 15u;  h *= 0x846ca68bu;
    h ^= h >> 16u;
    return h;
}

var<private> rng_state: u32;

fn rand_float() -> f32 {
    rng_state = rng_state * 747796405u + 2891336453u;
    let word = ((rng_state >> ((rng_state >> 28u) + 4u)) ^ rng_state) * 277803737u;
    let res = (word >> 22u) ^ word;
    return f32(res) / 4294967296.0;
}

fn rand_gaussian() -> f32 {
    let u1 = max(rand_float(), 1e-7);
    let u2 = rand_float();
    let r = sqrt(-2.0 * log(u1));
    let theta = TWO_PI * u2;
    return r * cos(theta);
}

fn project_onto_wyckoff(pos: vec3<f32>, p_mat: array<f32, 9>, t_vec: vec3<f32>) -> vec3<f32> {
    var out: vec3<f32>;
    out.x = p_mat[0] * pos.x + p_mat[1] * pos.y + p_mat[2] * pos.z + t_vec.x;
    out.y = p_mat[3] * pos.x + p_mat[4] * pos.y + p_mat[5] * pos.z + t_vec.y;
    out.z = p_mat[6] * pos.x + p_mat[7] * pos.y + p_mat[8] * pos.z + t_vec.z;
    return out - floor(out);
}

var<workgroup> proposal_site: u32; // maxSites means a collective proposal
var<workgroup> prop_sites: array<vec3<f32>, 32>;   // MAX_SITES
// A polyhedron move: the new coordinates of the independent sites it moves, and which ones (bit s).
var<workgroup> poly_new: array<vec3<f32>, 32>;     // MAX_SITES
var<workgroup> poly_mask: u32;
var<workgroup> gx: array<f32, MAX_GEN_ATOMS>;
var<workgroup> gy: array<f32, MAX_GEN_ATOMS>;
var<workgroup> gz: array<f32, MAX_GEN_ATOMS>;
var<workgroup> gT: array<u32, MAX_GEN_ATOMS>;
// 1 for a centring translate of an earlier image of the same site (genPack bit
// 24, set by buildAssignmentTables): skipped in the |F|^2 sums, where it adds
// exactly what its class representative adds, and kept for the contacts.
var<workgroup> gSkip: array<u32, MAX_GEN_ATOMS>;

var<workgroup> rPen: array<f32, WG>;
// ---------------------------------------------------------------------------
//  Accumulators for wR2, THE WEIGHTED RESIDUAL WITH A REFINED SCALE.
//
//  The scale is refined by least squares rather than fitted as a parameter:
//
//      k     = sum(w*Io*Ic) / sum(w*Ic^2)
//      wR2^2 = sum(w*(Io - k*Ic)^2) / sum(w*Io^2)
//
//  Substituting k collapses the numerator to sum(w*Io^2) - sco^2/scc, so
//
//      wR2^2 = 1 - sco^2 / (scc * soo)
//
//  which needs three sums and not six: the mean-carrying terms cancel. An
//  arbitrary overall factor on Icalc leaves this unchanged, while a change in
//  how intensity is DISTRIBUTED between sites does not -- which is what makes
//  it sensitive to which element sits where.
//
//  The fitness reported is 1 - wR2, so it rises towards 1 for a good structure
//  and lands in [0, 1], the range the clash and bond penalties are tuned
//  against.
// ---------------------------------------------------------------------------
var<workgroup> rScc: array<f32, WG>;   // sum w * Icalc^2
var<workgroup> rSoo: array<f32, WG>;   // sum w * Iobs^2
var<workgroup> rSco: array<f32, WG>;   // sum w * Icalc * Iobs
var<workgroup> rSw:  array<f32, WG>;   // sum w
var<workgroup> rSic: array<f32, WG>;   // sum w * Icalc
var<workgroup> rSio: array<f32, WG>;   // sum w * Iobs
var<workgroup> local_rMin: array<f32, 64>;         // MAX_ELEM * MAX_ELEM

// Cartesian lengths of the 27 shell translations, indexed (a+1)*9+(b+1)*3+(c+1).
//
// Constant for the whole cell, so they are computed once per dispatch rather
// than re-derived for every atom pair. They exist to let the counting shell be
// SKIPPED cheaply: an image displaced by t is at least ||t|| - d away, where d
// is the nearest-image distance already in hand, so one subtract and compare
// rejects a translation without the matrix multiply and square root that
// finding its true distance would cost.
var<workgroup> shellLen: array<f32, 27>;


// COUNTING NEIGHBOURS NEEDS EVERY IMAGE, NOT THE NEAREST ONE.
//
// cartDist below returns a single scalar: the distance to the CLOSEST image of
// atom j. That is the right answer for a clash floor and for "how far is the
// nearest partner", and it is the wrong answer for "how many partners are
// there". Two lattice translates of the same j can both sit inside a
// coordination shell whenever the repeat is short enough -- a cubic perovskite
// B cation has its six oxygens as three symmetry images and their three
// translates, so a "B O 6" rule counted three and charged the structure for the
// other three forever. The host reference in contacts.js has always enumerated
// the neighbouring cells and counted each image separately; this makes the
// kernel agree with it.
//
// COUNT_SHELL is applied ONLY to the rule-matching pairs, so the 27x cost falls
// on the handful of A-B pairs a constraint actually names rather than on the
// whole contact loop. Injected like MIN_IMAGE_SHELL; setting it to 0 restores
// the previous nearest-image-only counting.
const COUNT_SHELL: i32 = 1;  //__COUNT_SHELL__

// The fractional separation, in the reduced basis, wrapped to the nearest
// image. Split out of cartDist so the shell can be walked without recomputing
// the basis transform for every translation.
fn fracDelta(p1: vec3<f32>, p2: vec3<f32>) -> vec3<f32> {
    let d = p1 - p2;
    let q = vec3<f32>(
        params.r0.x*d.x + params.r0.y*d.y + params.r0.z*d.z,
        params.r1.x*d.x + params.r1.y*d.y + params.r1.z*d.z,
        params.r2.x*d.x + params.r2.y*d.y + params.r2.z*d.z);
    return q - round(q);
}

/** Cartesian vector of a fractional vector in the reduced basis. */
fn cartVec(t: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(params.o0.x*t.x + params.o0.y*t.y + params.o0.z*t.z,
                     params.o1.x*t.x + params.o1.y*t.y + params.o1.z*t.z,
                     params.o2.x*t.x + params.o2.y*t.y + params.o2.z*t.z);
}

/** Cartesian length of a fractional vector in the reduced basis. */
fn cartLen(t: vec3<f32>) -> f32 {
    return length(cartVec(t));
}

// How far the cosine of the angle between two neighbours of a shaped shell is
// from the shape's (WY_LIMITS.geometries codes). Square-planar and octahedral
// shells have cis (90 degree) and trans (180 degree) pairs, and each pair is
// charged against the nearer of the two.
fn geomCosError(code: u32, c: f32) -> f32 {
    switch code {
        case 1u: { return c + 1.0; }                        // linear, 180
        case 2u: { return c + 0.5; }                        // trigonal planar, 120
        case 3u: { return c + 0.3333333; }                  // tetrahedral, 109.47
        case 4u, 5u: { return min(abs(c), abs(c + 1.0)); }  // square planar, octahedral
        default: { return 0.0; }
    }
}

// ---------------------------------------------------------------------------
//  POLYHEDRON MOVES
//
//  A counted rule ("Fe C 6 1.85/2.05 octahedron") describes a unit: a centre and
//  its shell. Moving the shell's atoms one at a time almost always breaks it, so
//  such a proposal is nearly always rejected and the search spends its steps
//  rebuilding geometry it was given. A polyhedron move takes one centre of a
//  counted rule, its nearest partners in the current structure, and moves them
//  together, in one of three ways:
//
//    translate  the centre and its partners shifted by one random vector
//    rotate     the partners turned about the centre (random axis, an angle
//               that follows the adaptive step size)
//    snap       the partners put at one common distance (the mean, nudged, kept
//               in the rule's window) and, for a shaped rule, on the ideal shape
//               best aligned with the current shell
//
//  Each moved partner is an IMAGE of an independent site; the site takes the
//  coordinates whose image lands at the new position (the inverse of that
//  image's operator), then the usual Wyckoff projection. A site appearing twice
//  in the shell is moved by its nearest image only; its other images follow by
//  symmetry. Nothing else changes: the result is scored and accepted like any
//  proposal, so a move that does not suit the structure (a partner shared with
//  another centre, a shell on a special position) is simply rejected more often.
// ---------------------------------------------------------------------------
fn fracOfCart(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(dot(params.i0.xyz, c), dot(params.i1.xyz, c), dot(params.i2.xyz, c));
}
fn opRead(o: u32, k: u32) -> f32 { return staticFloats[u32(params.symOff) + o * 12u + k]; }
fn opApply(o: u32, p: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(opRead(o, 0u) * p.x + opRead(o, 1u) * p.y + opRead(o, 2u) * p.z + opRead(o, 9u),
                     opRead(o, 3u) * p.x + opRead(o, 4u) * p.y + opRead(o, 5u) * p.z + opRead(o, 10u),
                     opRead(o, 6u) * p.x + opRead(o, 7u) * p.y + opRead(o, 8u) * p.z + opRead(o, 11u));
}
// The site whose image under operator o is q: R^-1 (q - t), R^-1 by the adjugate.
fn opInverseApply(o: u32, q: vec3<f32>) -> vec3<f32> {
    let m0 = opRead(o, 0u); let m1 = opRead(o, 1u); let m2 = opRead(o, 2u);
    let m3 = opRead(o, 3u); let m4 = opRead(o, 4u); let m5 = opRead(o, 5u);
    let m6 = opRead(o, 6u); let m7 = opRead(o, 7u); let m8 = opRead(o, 8u);
    let c00 = m4 * m8 - m5 * m7; let c01 = m5 * m6 - m3 * m8; let c02 = m3 * m7 - m4 * m6;
    let det = m0 * c00 + m1 * c01 + m2 * c02;
    let w = (q - vec3<f32>(opRead(o, 9u), opRead(o, 10u), opRead(o, 11u))) / select(det, 1.0, abs(det) < 1e-6);
    return vec3<f32>(c00 * w.x + (m2 * m7 - m1 * m8) * w.y + (m1 * m5 - m2 * m4) * w.z,
                     c01 * w.x + (m0 * m8 - m2 * m6) * w.y + (m2 * m3 - m0 * m5) * w.z,
                     c02 * w.x + (m1 * m6 - m0 * m7) * w.y + (m0 * m4 - m1 * m3) * w.z);
}
fn randUnit() -> vec3<f32> {
    let v = vec3<f32>(rand_gaussian(), rand_gaussian(), rand_gaussian());
    let l = length(v);
    return select(v / l, vec3<f32>(0.0, 0.0, 1.0), l < 1e-6);
}
fn rotateAbout(v: vec3<f32>, k: vec3<f32>, ang: f32) -> vec3<f32> {
    let c = cos(ang); let s = sin(ang);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
// The ideal directions of a shape (WY_LIMITS.geometries codes), vertex k; the first two set the alignment.
fn shapeCount(code: u32) -> u32 {
    switch code { case 1u: { return 2u; } case 2u: { return 3u; } case 3u, 4u: { return 4u; } case 5u: { return 6u; } default: { return 0u; } }
}
fn shapeVertex(code: u32, k: u32) -> vec3<f32> {
    let s3 = 0.5773503;
    switch code {
        case 1u: { if (k == 0u) { return vec3<f32>(1.0, 0.0, 0.0); } return vec3<f32>(-1.0, 0.0, 0.0); }
        case 2u: {
            if (k == 0u) { return vec3<f32>(1.0, 0.0, 0.0); }
            if (k == 1u) { return vec3<f32>(-0.5, 0.8660254, 0.0); }
            return vec3<f32>(-0.5, -0.8660254, 0.0);
        }
        case 3u: {
            if (k == 0u) { return vec3<f32>(s3, s3, s3); }
            if (k == 1u) { return vec3<f32>(s3, -s3, -s3); }
            if (k == 2u) { return vec3<f32>(-s3, s3, -s3); }
            return vec3<f32>(-s3, -s3, s3);
        }
        case 4u: {
            if (k == 0u) { return vec3<f32>(1.0, 0.0, 0.0); }
            if (k == 1u) { return vec3<f32>(0.0, 1.0, 0.0); }
            if (k == 2u) { return vec3<f32>(-1.0, 0.0, 0.0); }
            return vec3<f32>(0.0, -1.0, 0.0);
        }
        default: {
            if (k == 0u) { return vec3<f32>(1.0, 0.0, 0.0); }
            if (k == 1u) { return vec3<f32>(0.0, 1.0, 0.0); }
            if (k == 2u) { return vec3<f32>(-1.0, 0.0, 0.0); }
            if (k == 3u) { return vec3<f32>(0.0, -1.0, 0.0); }
            if (k == 4u) { return vec3<f32>(0.0, 0.0, 1.0); }
            return vec3<f32>(0.0, 0.0, -1.0);
        }
    }
}
// An orthonormal frame from two directions: e1 along a, e2 in the plane of a and b.
fn frameOf(a: vec3<f32>, b: vec3<f32>) -> mat3x3<f32> {
    let e1 = normalize(a);
    var p = b - dot(b, e1) * e1;
    if (length(p) < 1e-4) {
        // b along a (a linear shell): any perpendicular will do
        let h = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(e1.x) > 0.9);
        p = h - dot(h, e1) * e1;
    }
    let e2 = normalize(p);
    return mat3x3<f32>(e1, e2, cross(e1, e2));
}

// Lane 0 only. Fills poly_new / poly_mask; leaves poly_mask at 0 when no move applies (no counted rule, no centre,
// no partner), and the caller then makes an ordinary proposal.
fn polyPropose(A: u32, gBase: u32, nTot: u32, maxSites: u32, sd: f32) {
    let tb = u32(params.tablesOff) + u32(params.ruleOff);
    let nRules = min(u32(params.nBondRules), MAX_BOND_RULES);
    var nCounted = 0u;
    var k = 0u;
    for (var r = 0u; r < nRules; r = r + 1u) {
        if (u32(staticFloats[tb + r * RULE_STRIDE + 5u]) != 0u) {
            nCounted = nCounted + 1u;
            if (rand_float() < 1.0 / f32(nCounted)) { k = r; }
        }
    }
    if (nCounted == 0u) { return; }
    let rb = tb + k * RULE_STRIDE;
    let ta = u32(staticFloats[rb]);
    let tbType = u32(staticFloats[rb + 1u]);
    let rMin = max(staticFloats[rb + 2u], 0.0);
    let rMax = staticFloats[rb + 3u];
    let nn = min(u32(staticFloats[rb + 4u]), MAX_POLY);
    let geom = u32(staticFloats[rb + 6u]);

    // a centre: an independent site of the rule's first element
    var nCentre = 0u;
    var sc = maxSites;
    var seen: u32 = 0u;
    for (var g = 0u; g < nTot; g = g + 1u) {
        let pk = genPack[gBase + g];
        let s = pk & 0xFFu;
        if (s >= maxSites || ((pk >> 20u) & 0xFu) != ta || (seen & (1u << s)) != 0u) { continue; }
        seen = seen | (1u << s);
        nCentre = nCentre + 1u;
        if (rand_float() < 1.0 / f32(nCentre)) { sc = s; }
    }
    if (sc >= maxSites || nn == 0u) { return; }
    let c = prop_sites[sc];

    // its nn nearest partners: every image of every site of the second element, nearest image of each
    var ld: array<f32, MAX_POLY>;
    var lv: array<vec3<f32>, MAX_POLY>;
    var ls: array<u32, MAX_POLY>;
    var lo: array<u32, MAX_POLY>;
    for (var m = 0u; m < MAX_POLY; m = m + 1u) { ld[m] = NO_NEIGHBOUR; }
    for (var g = 0u; g < nTot; g = g + 1u) {
        let pk = genPack[gBase + g];
        let s = pk & 0xFFu;
        if (s >= maxSites || s == sc || ((pk >> 20u) & 0xFu) != tbType) { continue; }
        let o = (pk >> 8u) & 0xFFFu;
        let img = opApply(o, prop_sites[s]);
        let dv = cartVec(fracDelta(img - floor(img), c));
        let d = length(dv);
        if (d < 1e-4 || d >= ld[nn - 1u]) { continue; }
        var m = nn - 1u;
        loop {
            if (m > 0u && ld[m - 1u] > d) {
                ld[m] = ld[m - 1u]; lv[m] = lv[m - 1u]; ls[m] = ls[m - 1u]; lo[m] = lo[m - 1u];
                m = m - 1u;
            } else { break; }
        }
        ld[m] = d; lv[m] = dv; ls[m] = s; lo[m] = o;
    }
    var nf = 0u;
    for (var m = 0u; m < nn; m = m + 1u) { if (ld[m] < NO_NEIGHBOUR) { nf = nf + 1u; } }
    if (nf == 0u) { return; }

    let kind = rand_float();
    var shift = vec3<f32>(0.0, 0.0, 0.0);
    var nv: array<vec3<f32>, MAX_POLY>;
    for (var m = 0u; m < nf; m = m + 1u) { nv[m] = lv[m]; }
    if (kind < 0.3333333) {
        // translate: one fractional step for the whole unit
        shift = vec3<f32>(rand_gaussian(), rand_gaussian(), rand_gaussian()) * sd;
    } else if (kind < 0.6666667) {
        // rotate the shell about its centre
        let axis = randUnit();
        let ang = rand_gaussian() * clamp(sd * 20.0, 0.05, 0.8);
        for (var m = 0u; m < nf; m = m + 1u) { nv[m] = rotateAbout(lv[m], axis, ang); }
    } else {
        // snap: one distance for the shell, and the ideal shape when the rule has one
        var mean = 0.0;
        for (var m = 0u; m < nf; m = m + 1u) { mean = mean + ld[m]; }
        mean = mean / f32(nf) * (1.0 + 0.03 * rand_gaussian());
        let dT = clamp(mean, max(rMin, 0.3), select(mean, rMax, rMax < 1.0e6));
        let nShape = shapeCount(geom);
        if (nShape >= 2u && nf >= 2u) {
            // align the ideal shape on the nearest partner and the one whose angle to it best matches the shape's
            let u0 = lv[0] / ld[0];
            let cIdeal = dot(shapeVertex(geom, 0u), shapeVertex(geom, 1u));
            var j1 = 1u;
            var bestErr = 1.0e9;
            for (var m = 1u; m < nf; m = m + 1u) {
                let e = abs(dot(u0, lv[m] / ld[m]) - cIdeal);
                if (e < bestErr) { bestErr = e; j1 = m; }
            }
            let Fa = frameOf(u0, lv[j1]);
            let Fi = frameOf(shapeVertex(geom, 0u), shapeVertex(geom, 1u));
            var usedV: u32 = 3u;   // vertices 0 and 1 are taken by partners 0 and j1
            for (var m = 0u; m < nf; m = m + 1u) {
                var vk = 0u;
                if (m == 0u) { vk = 0u; }
                else if (m == j1) { vk = 1u; }
                else {
                    var bestDot = -2.0;
                    vk = nShape;
                    for (var q = 2u; q < nShape; q = q + 1u) {
                        if ((usedV & (1u << q)) != 0u) { continue; }
                        let e = shapeVertex(geom, q);
                        let w = Fa * vec3<f32>(dot(Fi[0], e), dot(Fi[1], e), dot(Fi[2], e));
                        let dd = dot(w, lv[m] / ld[m]);
                        if (dd > bestDot) { bestDot = dd; vk = q; }
                    }
                    if (vk < nShape) { usedV = usedV | (1u << vk); }
                }
                if (vk < nShape) {
                    let e = shapeVertex(geom, vk);
                    nv[m] = Fa * vec3<f32>(dot(Fi[0], e), dot(Fi[1], e), dot(Fi[2], e)) * dT;
                } else {
                    nv[m] = lv[m] / ld[m] * dT;
                }
            }
        } else {
            for (var m = 0u; m < nf; m = m + 1u) { nv[m] = lv[m] / ld[m] * dT; }
        }
    }

    // back to the independent sites: the nearest image of each site carries it
    var mask: u32 = 0u;
    if (kind < 0.3333333) {
        poly_new[sc] = c + shift;
        mask = 1u << sc;
    }
    for (var m = 0u; m < nf; m = m + 1u) {
        let s = ls[m];
        if ((mask & (1u << s)) != 0u) { continue; }
        let dest = c + fracOfCart(nv[m]) + shift;
        poly_new[s] = opInverseApply(lo[m], dest);
        mask = mask | (1u << s);
    }
    poly_mask = mask;
}

fn cartDist(p1: vec3<f32>, p2: vec3<f32>) -> f32 {
    let d = p1 - p2;
    var q = vec3<f32>(
        params.r0.x*d.x + params.r0.y*d.y + params.r0.z*d.z,
        params.r1.x*d.x + params.r1.y*d.y + params.r1.z*d.z,
        params.r2.x*d.x + params.r2.y*d.y + params.r2.z*d.z);
    q = q - round(q);

    var best: f32 = 1.0e30;
    for (var i = -MIN_IMAGE_SHELL; i <= MIN_IMAGE_SHELL; i = i + 1) {
        for (var j = -MIN_IMAGE_SHELL; j <= MIN_IMAGE_SHELL; j = j + 1) {
            for (var k = -MIN_IMAGE_SHELL; k <= MIN_IMAGE_SHELL; k = k + 1) {
                let t = q + vec3<f32>(f32(i), f32(j), f32(k));
                let cx = params.o0.x*t.x + params.o0.y*t.y + params.o0.z*t.z;
                let cy = params.o1.x*t.x + params.o1.y*t.y + params.o1.z*t.z;
                let cz = params.o2.x*t.x + params.o2.y*t.y + params.o2.z*t.z;
                best = min(best, cx*cx + cy*cy + cz*cz);
            }
        }
    }
    return sqrt(best);
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wgId: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {

    let pIdx = wgId.x;
    if (pIdx >= u32(params.numParticles)) { return; }

    let nTot   = min(u32(params.nTot), MAX_GEN_ATOMS);
    let nRules = min(u32(params.nBondRules), MAX_BOND_RULES);
    // Hoisted above the generation loop so gT can be clamped against the
    // COMPOSITION rather than only against MAX_ELEM. Both tables gT indexes
    // are nElem wide, not MAX_ELEM wide: local_rMin is filled to nElem^2 and
    // the scattering row for a reflection is nElem long. A type of 7 in a
    // three-element composition was therefore inside the old clamp and still
    // read past the filled region of one and into the next reflection's row of
    // the other. Unreachable while genType comes from the host's demand index,
    // which is what this clamp is for.
    let nElem      = u32(params.nElem);
    let nElemClamp = min(nElem, MAX_ELEM);
    let maxType    = max(nElemClamp, 1u) - 1u;
    let ruleOff = u32(params.ruleOff);

    // TWO DIFFERENT NUMBERS, AND THEY MUST NOT BE CONFLATED.
    //
    // siteStride is the stride the HOST allocated `particles` and `siteProj`
    // with, so every index derived from it has to use the raw uniform:
    // clamping it would slide every particle's slice of the buffer.
    //
    // maxSites is what THIS KERNEL can hold in prop_sites. The host refuses an
    // assignment with more than MAX_SITES sites, so on any run that starts the
    // two are equal; the min exists only so that a host/kernel mismatch
    // truncates instead of writing past the end of a workgroup array.
    let siteStride = u32(params.maxSites);
    let maxSites   = min(siteStride, MAX_SITES);

        let A     = particleAssign[pIdx];
        // RAW params.nTot, not the clamped `nTot`, for exactly the reason
        // siteStride is raw above: this is the stride the HOST allocated
        // genPack with (nAssign x nTot entries), so clamping it would slide
        // every assignment's row rather than shortening it. The loop below
        // still runs to the clamped `nTot`, so a host/kernel mismatch
        // truncates the cell -- which the reduction and the restraints both
        // survive -- instead of reading another assignment's atoms, which
        // they do not.
        let gBase = A * u32(params.nTot);
        let pBase = pIdx * siteStride * 3u;

        // `particles` is JS-allocated at double length: the first half is
        // the current, live coordinates (what pBase already indexes into);
        // the second half is a best-ever cache, one slot per particle, that
        // only this kernel ever writes and only a Replica Exchange sync
        // reads back.
        let currentStride  = siteStride * 3u;
        let bestBaseOffset = u32(params.numParticles) * currentStride;
        let bestBase       = bestBaseOffset + pIdx * currentStride;

        let sd = mcmcState[pIdx].stepSize;
        rng_state = hash_u32(mcmcState[pIdx].seed ^ (lid * 0x9E3779B9u));

        // The current coordinates first: a polyhedron move reads the whole
        // structure before it moves anything. Untouched sites keep these values
        // exactly; repeated projection could round them.
        if (lid < maxSites) {
            let c0 = pBase + lid * 3u;
            prop_sites[lid] = vec3<f32>(particles[c0], particles[c0 + 1u], particles[c0 + 2u]);
        }
        workgroupBarrier();

        // A polyhedron move in params.polyProb of the proposals (see polyPropose).
        // Otherwise, or when it finds nothing to move: one FREE independent site
        // in 3/4 of proposals. Fixed special positions and padded sites have zero
        // projectors and must not consume attempts. Moving a site moves its full
        // symmetry orbit, never one image.
        if (lid == 0u) {
            proposal_site = maxSites;
            poly_mask = 0u;
            if (params.pad0 > 0.5 && params.polyProb > 0.0 && rand_float() < params.polyProb) {
                polyPropose(A, gBase, nTot, maxSites, sd);
            }
            if (poly_mask == 0u && params.pad0 > 0.5 && rand_float() < 0.75) {
                var nFree = 0u;
                for (var s = 0u; s < maxSites; s = s + 1u) {
                    let b = u32(params.projOff) + (A * siteStride + s) * 12u;
                    var norm = 0.0;
                    for (var j = 0u; j < 9u; j = j + 1u) {
                        norm = norm + abs(staticFloats[b + j]);
                    }
                    if (norm > 1e-6) {
                        nFree = nFree + 1u;
                        // Reservoir selection gives every movable site equal weight.
                        if (rand_float() < 1.0 / f32(nFree)) { proposal_site = s; }
                    }
                }
            }
        }
        workgroupBarrier();
        
        if (lid < maxSites) {
            let s = lid;
            var pos = prop_sites[s];

            let poly = poly_mask != 0u;
            let moving = params.pad0 > 0.5 && select(proposal_site == maxSites || proposal_site == s, (poly_mask & (1u << s)) != 0u, poly);
            if (moving && poly) {
                pos = poly_new[s];
            } else if (moving) {
                pos.x = pos.x + rand_gaussian() * sd;
                pos.y = pos.y + rand_gaussian() * sd;
                pos.z = pos.z + rand_gaussian() * sd;
            }
            
            let p_off = u32(params.projOff);
            // siteStride, NOT maxSites. siteProj was allocated by the host at
            // (nAssign x T.maxSites x 12) floats, so the row for assignment A
            // starts at A * siteStride; using the kernel-clamped value would
            // read another assignment's projector the moment the two differ.
            let b = (A * siteStride + s) * 12u;
            var p_mat: array<f32, 9>;
            for (var i = 0u; i < 9u; i = i + 1u) { p_mat[i] = staticFloats[p_off + b + i]; }
            let t_vec = vec3<f32>(staticFloats[p_off + b + 9u], staticFloats[p_off + b + 10u], staticFloats[p_off + b + 11u]);
            
            // Preserve untouched sites exactly; repeated projection can round them.
            prop_sites[s] = pos;
            if (moving) { prop_sites[s] = project_onto_wyckoff(pos, p_mat, t_vec); }
        }
        
        workgroupBarrier();
        // AFTER THE BARRIER, NOT BEFORE IT.
        //
        // Every lane reads mcmcState[pIdx].seed at the top of this function to
        // build its own stream. Lane 0 then writes the field back. With the
        // write placed before the barrier the two were unsynchronised: lanes in
        // a second subgroup could reach their read only after lane 0 had already
        // stored, and would hash the NEW seed instead of the one the rest of the
        // workgroup used. That is a genuine data race -- it does not corrupt the
        // structure, but it correlates the lane streams and makes a run with a
        // fixed seed non-reproducible, which is exactly what the per-lane hash
        // above exists to prevent.
        //
        // The barrier already had to be here for prop_sites; moving the write
        // below it costs nothing and orders the read against the write.
        if (lid == 0u) {
            mcmcState[pIdx].seed = rng_state;
        }

        for (var g = lid; g < nTot; g = g + WG) {
            let pk = genPack[gBase + g];
            let s  = pk & 0xFFu;
            let o  = (pk >> 8u) & 0xFFFu;
            let ty = (pk >> 20u) & 0xFu;

            let p = prop_sites[s];

            // Symmetry operators are packed 12 floats each: r[9] then t[3].
            // The operator base offset `ob` MUST appear in all twelve reads.
            // It previously appeared in exactly one (the r[0] term), so every
            // symmetry image was built from operator 0's matrix and
            // translation - i.e. the identity - and all N images of a site
            // collapsed onto very nearly the same point. That silently turned
            // the whole search into a fit of one unexpanded asymmetric unit,
            // and it rewarded piling atoms on top of each other, because
            // coincident images each collected the same density.
            let s_off = u32(params.symOff);
            let ob = o * 12u;
            let rb = s_off + ob;
            var n = vec3<f32>(
                p.x*staticFloats[rb+0u] + p.y*staticFloats[rb+1u] + p.z*staticFloats[rb+2u] + staticFloats[rb+9u],
                p.x*staticFloats[rb+3u] + p.y*staticFloats[rb+4u] + p.z*staticFloats[rb+5u] + staticFloats[rb+10u],
                p.x*staticFloats[rb+6u] + p.y*staticFloats[rb+7u] + p.z*staticFloats[rb+8u] + staticFloats[rb+11u]
            );
            n = n - floor(n);





        gx[g] = n.x; gy[g] = n.y; gz[g] = n.z;
        // Clamped ONCE, here, rather than at each of the places gT is read.
        // genPack carries 4 bits of type, so a malformed table could present
        // 15; local_rMin holds MAX_ELEM^2 entries and the scattering table has
        // a row of nElem, so either reader would run off the end.
        gT[g] = min(ty, maxType);
        gSkip[g] = (pk >> 24u) & 1u;
    }
    workgroupBarrier();

    // ----------------------------------------------------------------------
    //  |Fcalc|^2 AGAINST |Fobs|^2, GROUP BY GROUP
    //
    //  Work is split over GROUPS, not over atoms: one thread owns a whole
    //  group and walks its reflections serially. Every thread therefore reads
    //  the full generated cell out of gx/gy/gz/gT, which is a workgroup-memory
    //  broadcast rather than a gather, and no thread has to combine a partial
    //  structure factor with another thread's.
    //
    //  A "group" is a set of reflections the powder pattern cannot separate.
    //  The host has already summed their observed intensities into one number,
    //  so the comparison is made where the measurement actually exists --
    //  summing the calculated intensities the same way. This is the same
    //  reason the report prints overlap clusters rather than trusting the
    //  individual WPPF intensities of a heavily overlapped block.
    //
    //  Iobs is packed as sum(mult * Fo^2) over the group, so Icalc is
    //  accumulated as sum(mult * |F|^2) to match it term for term.
    // ----------------------------------------------------------------------
    // nElem is declared at the top of main() so the generation loop's type
    // clamp can use it; it is the row stride of both the r_min table and the
    // scattering table, and is deliberately NOT clamped where it is used as a
    // stride - see the fill length at nElemSq below.
    let fTabOff = u32(params.fTabOff);
    let nGroups = u32(params.nGroupsActive);
    let nReflTot = u32(params.nRefl);
    let isCentro = params.centro > 0.5;

    var scc: f32 = 0.0;
    var soo: f32 = 0.0;
    var sco: f32 = 0.0;
    var sw:  f32 = 0.0;
    var sic: f32 = 0.0;
    var sio: f32 = 0.0;

    for (var g = lid; g < nGroups; g = g + WG) {
        let gb    = g * GROUP_STRIDE;
        let start = u32(groupData[gb]);
        let count = u32(groupData[gb + 1u]);
        let iObs  = groupData[gb + 2u];

        // Compile-time: with GROUP_STRIDE == 3 this whole branch disappears.
        var wgt: f32 = 1.0;
        if (GROUP_STRIDE >= 4u) { wgt = groupData[gb + 3u]; }
        if (!(wgt > 0.0)) { continue; }

        var iCalc: f32 = 0.0;
        for (var m = 0u; m < count; m = m + 1u) {
            let r = start + m;
            if (r >= nReflTot) { break; }

            // hkl is bit-packed ten bits per index, biased by 512 so negative
            // indices survive. Unpack with a mask, then remove the bias.
            let pk = reflPack[r * 2u];
            let h = f32(i32(pk & 0x3FFu) - 512);
            let k = f32(i32((pk >> 10u) & 0x3FFu) - 512);
            let l = f32(i32((pk >> 20u) & 0x3FFu) - 512);
            let mult = f32(reflPack[r * 2u + 1u]);

            let fBase = fTabOff + r * nElem;

            var fr: f32 = 0.0;
            var fi: f32 = 0.0;
            if (isCentro) {
                // The cell contents are closed under inversion through the
                // origin, so every atom at r has a partner at -r of the same
                // type and the sine terms cancel exactly. F is real, and the
                // hottest loop in the program loses half its transcendentals.
                //
                // The host TESTS this rather than assuming it from the space
                // group: a centrosymmetric group whose inversion centre is not
                // at the origin carries (-I | t) with t nonzero, for which F
                // is complex.
                for (var a = 0u; a < nTot; a = a + 1u) {
                    if (gSkip[a] != 0u) { continue; }
                    // Reduce to one turn BEFORE scaling by 2*pi. At h,k,l up to
                    // +/-511 the unreduced argument reaches ~3200 rad, outside
                    // the range WGSL guarantees for cos/sin and outside what
                    // several backends' hardware instructions reduce well.
                    let q  = h * gx[a] + k * gy[a] + l * gz[a];
                    let ph = TWO_PI * (q - floor(q));
                    fr = fr + groupData[fBase + gT[a]] * cos(ph);
                }
            } else {
                for (var a = 0u; a < nTot; a = a + 1u) {
                    if (gSkip[a] != 0u) { continue; }
                    // See the centrosymmetric branch: reduced to one turn
                    // before scaling, so cos/sin never see a large argument.
                    let q  = h * gx[a] + k * gy[a] + l * gz[a];
                    let ph = TWO_PI * (q - floor(q));
                    let f  = groupData[fBase + gT[a]];
                    fr = fr + f * cos(ph);
                    fi = fi + f * sin(ph);
                }
            }
            iCalc = iCalc + mult * (fr * fr + fi * fi);
        }

        scc = scc + wgt * iCalc * iCalc;
        soo = soo + wgt * iObs  * iObs;
        sco = sco + wgt * iCalc * iObs;
        sw  = sw  + wgt;
        sic = sic + wgt * iCalc;
        sio = sio + wgt * iObs;
    }

    let t_off = u32(params.tablesOff);
    // nElem (declared with the reflection block above) is the ROW STRIDE of the
    // r_min table as the host packed it, so it is not clamped; the fill length
    // is, because local_rMin is MAX_ELEM^2.
    let nElemSq = min(nElem * nElem, MAX_ELEM * MAX_ELEM);
    for (var idx = lid; idx < nElemSq; idx = idx + WG) {
        local_rMin[idx] = staticFloats[t_off + u32(params.rMinOff) + idx];
    }
    if (lid < 27u) {
        // ta/tb/tc, not sa/sb/sc: `sc` is the running sum(w * Icalc) in this
        // function's scope. WGSL lets the inner declaration shadow it, so the
        // old spelling compiled and worked -- and would have stopped working,
        // silently, the moment either declaration moved.
        let ta = i32(lid / 9u) - 1;
        let tb = i32((lid / 3u) % 3u) - 1;
        let tc = i32(lid % 3u) - 1;
        shellLen[lid] = cartLen(vec3<f32>(f32(ta), f32(tb), f32(tc)));
    }
    workgroupBarrier();

    var ruleA: array<u32, MAX_BOND_RULES>;
    var ruleB: array<u32, MAX_BOND_RULES>;
    var ruleMin: array<f32, MAX_BOND_RULES>;
    var ruleMax: array<f32, MAX_BOND_RULES>;
    var ruleN: array<f32, MAX_BOND_RULES>;
    var ruleMode: array<u32, MAX_BOND_RULES>;
    var ruleGeom: array<u32, MAX_BOND_RULES>;
    for (var k = 0u; k < nRules; k = k + 1u) {
        let rb = ruleOff + k * RULE_STRIDE;
        ruleA[k] = u32(staticFloats[t_off + rb]);
        ruleB[k] = u32(staticFloats[t_off + rb + 1u]);
        ruleMin[k] = staticFloats[t_off + rb + 2u];
        ruleMax[k] = staticFloats[t_off + rb + 3u];
        ruleN[k] = staticFloats[t_off + rb + 4u];
        ruleMode[k] = u32(staticFloats[t_off + rb + 5u]);
        // a shape needs the shell's vectors, which only exist when the host sized them
        ruleGeom[k] = select(0u, u32(staticFloats[t_off + rb + 6u]), MAX_GEOM_SLOTS >= MAX_COORD_SLOTS);
    }

    // slotOff[k] is where rule k's nearest-neighbour list starts inside `slot`,
    // and slotN[k] is how many entries it actually got. The two are separate
    // because the coordination numbers can sum past MAX_COORD_SLOTS: the host
    // refuses that up front, but if the two ever drift apart this truncates the
    // last rule rather than letting it write over the first one's distances --
    // an overflow WGSL clamps in silence and that looks exactly like a
    // structure which cannot satisfy its own restraints.
    var slotOff: array<u32, MAX_BOND_RULES>;
    var slotN:   array<u32, MAX_BOND_RULES>;
    // How many slots the rules between them actually claimed. Hoisted out of
    // the block below because the per-atom loop needs it: `slot` is re-declared
    // on every iteration of that loop and has to be re-initialised each time,
    // and initialising all MAX_COORD_SLOTS entries would make the cost of the
    // constant proportional to the constant rather than to the demand. Entries
    // at or above slotTotal are never read - no slotOff[k] + m reaches them -
    // so stopping there is not an approximation.
    var slotTotal: u32 = 0u;
    {
        var acc: u32 = 0u;
        for (var k = 0u; k < nRules; k = k + 1u) {
            slotOff[k] = acc;
            var nk: u32 = 0u;
            if (ruleMode[k] != 0u) {
                nk = min(u32(ruleN[k]), MAX_COORD_SLOTS - acc);
            }
            slotN[k] = nk;
            acc = acc + nk;
        }
        slotTotal = acc;
    }

    var pen: f32 = 0.0;
    for (var i = lid; i < nTot; i = i + WG) {
        let ti = gT[i];
        let pi = vec3<f32>(gx[i], gy[i], gz[i]);

        var myRules: u32 = 0u;
        for (var k = 0u; k < nRules; k = k + 1u) {
            if (ruleA[k] == ti) { myRules = myRules | (1u << k); }
        }
        var nearest: array<f32, MAX_BOND_RULES>;
        var inWindow: array<f32, MAX_BOND_RULES>;
        for (var k = 0u; k < MAX_BOND_RULES; k = k + 1u) {
            nearest[k] = NO_NEIGHBOUR;
            inWindow[k] = 0.0;
        }
        var slot: array<f32, MAX_COORD_SLOTS>;
        for (var m = 0u; m < slotTotal; m = m + 1u) { slot[m] = NO_NEIGHBOUR; }
        // the vector to each slot's neighbour, for shaped shells only
        var slotV: array<vec3<f32>, MAX_GEOM_SLOTS>;

        for (var j = 0u; j < nTot; j = j + 1u) {
            let tj = gT[j];
            let pj = vec3<f32>(gx[j], gy[j], gz[j]);
            let d = cartDist(pi, pj);

            // The clash floor is a statement about the CLOSEST approach, so it
            // stays on the nearest image. j == i is excluded because an atom
            // cannot collide with itself; its lattice translates are handled
            // by the counting pass below, which can legitimately treat them as
            // neighbours in a short-repeat structure.
            if (j != i) {
                let dmin = local_rMin[ti * nElem + tj];
                if (j > i && d < dmin) {
                    let overlap = (dmin - d) / max(dmin, 1e-3);
                    pen = pen + params.penClash * (1.0 + 9.0 * overlap);
                }
            }

            if (myRules == 0u) { continue; }

            // Computed once per PAIR, not once per rule. Two rules naming the
            // same A-B pair were each redoing the basis transform below.
            let qf = fracDelta(pi, pj);
            // The length of the t = 0 image, which is what the triangle
            // inequality in the shell below needs: |qf + t| >= ||t|| - |qf|.
            //
            // NOT `d`. d is cartDist, the minimum over the MIN_IMAGE_SHELL
            // search, so d <= |qf| and using it INFLATES the lower bound -- the
            // skip then rejects translations that are genuinely inside the
            // window. Identical to |qf| whenever MIN_IMAGE_SHELL is 0, which is
            // why this never showed up on a well-shaped cell; the thin cells
            // that set it to 1 are exactly the ones that need the shell.
            let dq = cartLen(qf);

            for (var k = 0u; k < nRules; k = k + 1u) {
                if ((myRules & (1u << k)) == 0u) { continue; }
                if (ruleB[k] != tj) { continue; }

                let nk = slotN[k];
                let counted = (nk > 0u);

                // The nearest partner is exactly what cartDist already returns,
                // so it is taken from d rather than re-derived in the shell.
                // That keeps the mode-0 test exact even when the shell below
                // prunes away the distant images.
                if (j != i) { nearest[k] = min(nearest[k], d); }

                // EVERY IMAGE OF j THAT CAN MATTER, COUNTED SEPARATELY.
                //
                // Distances outside the window still enter the slot list: the
                // deficit is graded on how far each of the N nearest partners
                // misses by, and dropping the far ones would collapse "partner
                // at 2.5 A, wanted 1.65" and "no partner at all" onto one flat
                // penalty, taking the gradient the search descends with it.
                //
                // "Can matter" is the cutoff: an image must either reach the
                // window or beat the worst slot currently held. An image
                // displaced by t is at least ||t|| - d away, so a translation
                // whose length exceeds cutoff + d cannot qualify and is
                // rejected on a subtract, without the matrix multiply and
                // square root its true distance would cost. In a cell wide
                // enough for the host to have compiled COUNT_SHELL to 0 this
                // loop is a single pass; in the thin cells that need the shell
                // it typically keeps two or three translations out of 27.
                var cutoff = ruleMax[k];
                if (counted) { cutoff = max(cutoff, slot[slotOff[k] + nk - 1u]); }
                for (var sa = -COUNT_SHELL; sa <= COUNT_SHELL; sa = sa + 1) {
                for (var sb = -COUNT_SHELL; sb <= COUNT_SHELL; sb = sb + 1) {
                for (var sc = -COUNT_SHELL; sc <= COUNT_SHELL; sc = sc + 1) {
                    let si = u32((sa + 1) * 9 + (sb + 1) * 3 + (sc + 1));
                    if (shellLen[si] - dq > cutoff) { continue; }
                    let dv = cartVec(qf + vec3<f32>(f32(sa), f32(sb), f32(sc)));
                    let dd = length(dv);
                    if (dd < 1.0e-4 && j == i) { continue; }   // the atom itself (another atom on the same point stays in the count)
                    if (dd >= ruleMin[k] && dd <= ruleMax[k]) {
                        inWindow[k] = inWindow[k] + 1.0;
                    }
                    if (counted) {
                        let lo = slotOff[k];
                        let hi = lo + nk;
                        let shaped = ruleGeom[k] != 0u;
                        if (dd < slot[hi - 1u]) {
                            var m = hi - 1u;
                            loop {
                                if (m > lo && slot[m - 1u] > dd) {
                                    slot[m] = slot[m - 1u];
                                    if (shaped) { slotV[m] = slotV[m - 1u]; }
                                    m = m - 1u;
                                } else { break; }
                            }
                            slot[m] = dd;
                            if (shaped) { slotV[m] = dv; }
                            cutoff = max(ruleMax[k], slot[hi - 1u]);
                        }
                    }
                }}}
            }
        }

        for (var k = 0u; k < nRules; k = k + 1u) {
            if ((myRules & (1u << k)) == 0u) { continue; }

            if (ruleMode[k] == 0u) {
                let nk = nearest[k];
                if (nk < NO_NEIGHBOUR && nk > ruleMax[k]) {
                    pen = pen + params.penBond * (nk - ruleMax[k]);
                }
            } else {
                let nk = slotN[k];
                var deficit: f32 = 0.0;
                for (var m = 0u; m < nk; m = m + 1u) {
                    let dm = slot[slotOff[k] + m];
                    if (dm >= NO_NEIGHBOUR) {
                        deficit = deficit + NO_PARTNER_CHARGE;
                    } else {
                        let miss = max(0.0, dm - ruleMax[k]) + max(0.0, ruleMin[k] - dm);
                        deficit = deficit + miss * (1.0 + miss / COORD_SOFT_A);
                    }
                }
                pen = pen + params.penBond * deficit;

                // THE SHAPE OF THE SHELL: the angle between every pair of its
                // nearest partners, against the shape's. Soft, like the rest; the
                // distances are charged above, so this sees directions only.
                if (ruleGeom[k] != 0u && nk >= 2u) {
                    let lo = slotOff[k];
                    var g: f32 = 0.0;
                    for (var m = 0u; m + 1u < nk; m = m + 1u) {
                        let dm = slot[lo + m];
                        if (dm >= NO_NEIGHBOUR) { continue; }
                        for (var n = m + 1u; n < nk; n = n + 1u) {
                            let dn = slot[lo + n];
                            if (dn >= NO_NEIGHBOUR) { continue; }
                            let e = geomCosError(ruleGeom[k], dot(slotV[lo + m], slotV[lo + n]) / max(dm * dn, 1e-6));
                            g = g + e * e;
                        }
                    }
                    pen = pen + params.penBond * params.penGeom * g;
                }

                if (ruleMode[k] == 1u) {
                    pen = pen + params.penCoord * max(0.0, inWindow[k] - ruleN[k]);
                }
            }
        }
    }

    pen = pen * params.penScale;

    rPen[lid] = pen;
    rScc[lid] = scc;
    rSoo[lid] = soo;
    rSco[lid] = sco;
    rSw[lid]  = sw;
    rSic[lid] = sic;
    rSio[lid] = sio;
    workgroupBarrier();

    for (var stride = WG / 2u; stride > 0u; stride = stride >> 1u) {
        if (lid < stride) {
            rPen[lid] = rPen[lid] + rPen[lid + stride];
            rScc[lid] = rScc[lid] + rScc[lid + stride];
            rSoo[lid] = rSoo[lid] + rSoo[lid + stride];
            rSco[lid] = rSco[lid] + rSco[lid + stride];
            rSw[lid]  = rSw[lid]  + rSw[lid + stride];
            rSic[lid] = rSic[lid] + rSic[lid + stride];
            rSio[lid] = rSio[lid] + rSio[lid + stride];
        }
        workgroupBarrier();
    }



if (lid == 0u) {
        var cc: f32 = 0.0;

        // Scale-only weighted wR2:
        // wR2^2 = 1 - sco^2 / (scc * soo)
        //
        // Weighted-mean subtraction would introduce an unphysical
        // additive intensity offset.
        let denom = rScc[0] * rSoo[0];

        if (denom > 1e-20 && rSco[0] > 0.0) {
            let explained = clamp(
                (rSco[0] * rSco[0]) / denom,
                0.0,
                1.0
            );

            let wR2 = sqrt(max(0.0, 1.0 - explained));
            cc = clamp(1.0 - wR2, 0.0, 1.0);
        }


        let pen = rPen[0];
        let f_new = cc - pen;
        
        var st = mcmcState[pIdx];

        // RE-SCORE THE INCUMBENT AT THE CURRENT PENALTY WEIGHT.
        //
        // st.fit was measured at whatever penScale was live when this chain
        // last moved, and the host ramps penScale EVERY generation
        // (penRampStart 0.2 -> penRampEnd 4.0). A straight comparison
        // therefore tests a proposal charged at today's weight against an
        // incumbent charged at an older, gentler one, and the gap grows
        // monotonically with the ramp: by the second half of a run essentially
        // nothing is accepted and the ladder stops sampling.
        //
        // st.cc and st.pen are stored raw (weight 1) for exactly this reason --
        // the same convention exchangeSweep(), recordBest() and the
        // bestRescored comparison below all already use.
        //
        // The guard covers a chain's FIRST evaluation, where the host seeds
        // st.fit with -inf and st.cc with NaN. Without it the NaN propagates
        // and the opening proposal of every restart is rejected.
        var f_old = st.fit;
        if (f_old > -1.0e29) { f_old = st.cc - st.pen * params.penScale; }
        
        if (params.pad0 > 0.5) {
            var accept = false;
            if (f_new >= f_old) {
                accept = true;
            } else {
                rng_state = st.seed;
                let prob = exp((f_new - f_old) / max(st.temp, 1e-9));
                if (rand_float() < prob) {
                    accept = true;
                }
                st.seed = rng_state;
            }
            
            if (accept) {
                st.fit = f_new;
                st.cc = cc;
                st.pen = pen / max(params.penScale, 1e-9);
                st.accepted = st.accepted + 1u;
                
                for (var s = 0u; s < maxSites; s = s + 1u) {
                    let c = pBase + s * 3u;
                    particles[c] = prop_sites[s].x;
                    particles[c + 1u] = prop_sites[s].y;
                    particles[c + 2u] = prop_sites[s].z;
                }

                // Historical best for this chain, at weight 1 (raw), so it
                // can be re-scored against whatever penScale is current at
                // read-back time - the same trick recordBest() uses on the
                // JS side to compare archived entries fairly against a
                // moving penalty ramp. Comparing f_new directly to a stale
                // st.bestFit here would be wrong: an easy structure found
                // early under a gentle ramp would look unbeatable forever.
                let hasBest = st.bestFit > -1.0e29;
                let bestRescored = select(-1.0e30, st.bestCC - st.bestPen * params.penScale, hasBest);
                if (f_new > bestRescored) {
                    st.bestFit = f_new;
                    st.bestCC  = cc;
                    st.bestPen = pen / max(params.penScale, 1e-9);

                    for (var s = 0u; s < maxSites; s = s + 1u) {
                        let c = bestBase + s * 3u;
                        particles[c]      = prop_sites[s].x;
                        particles[c + 1u] = prop_sites[s].y;
                        particles[c + 2u] = prop_sites[s].z;
                    }
                }
            }
            
            let STEP_UP = 1.057596;
            let STEP_DOWN = 0.9762857;
            if (accept) {
                st.stepSize = clamp(st.stepSize * STEP_UP, 2e-4, 0.5);
            } else {
                st.stepSize = clamp(st.stepSize * STEP_DOWN, 2e-4, 0.5);
            }
            
            mcmcState[pIdx] = st;
        } else {
            st.fit = f_new;
            st.cc = cc;
            st.pen = pen / max(params.penScale, 1e-9);
            mcmcState[pIdx] = st;
        }
    }
}