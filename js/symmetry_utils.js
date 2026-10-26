/**
 * Cell geometry for the Wyckoff search: the fractional-to-Cartesian matrix and a reduced basis of the same
 * lattice, with the radius below which independent minimum-image rounding is exact.
 *
 * Loaded by wyckoff_worker.js via importScripts('symmetry_utils.js'); it needs nothing but its own argument,
 * and only sharkoOrthMatrix() and sharkoReducedCell() are called from outside.
 *
 * WHY NOT crystal.js. crystal.js computes the same cell geometry for the fit, but on a degenerate cell it
 * clamps the discriminant and returns a volume near 0, while sharkoCellVolume() returns NaN -- and
 * sharkoOrthMatrix() depends on the NaN to announce a nonsense cell instead of producing near-infinite
 * coordinates. The two are therefore not interchangeable, and this one is the search's.
 *
 * The space-group database is sg/all.json (schema 8): { space_groups: { "62": { number, settings: [ { symbol,
 * hall, sym_ops, wyckoff, ... } ] } } }.
 */

/** Unit-cell volume in A^3 (general triclinic formula). */
function sharkoCellVolume(cell) {
    if (!cell) return NaN;
    const d2r = Math.PI / 180;
    const ca = Math.cos((cell.alpha ?? 90) * d2r);
    const cb = Math.cos((cell.beta  ?? 90) * d2r);
    const cg = Math.cos((cell.gamma ?? 90) * d2r);
    const disc = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg;
    if (!(disc > 0)) return NaN;
    return cell.a * cell.b * cell.c * Math.sqrt(disc);
}

/**
 * Fractional -> Cartesian matrix (row-major 3x3), standard setting with
 * a along x and b in the xy plane.
 */
function sharkoOrthMatrix(cell) {
    const d2r = Math.PI / 180;
    const al = (cell.alpha ?? 90) * d2r, be = (cell.beta ?? 90) * d2r, ga = (cell.gamma ?? 90) * d2r;
    const cosA = Math.cos(al), cosB = Math.cos(be), cosG = Math.cos(ga), sinG = Math.sin(ga);
    const V = sharkoCellVolume(cell);
    return new Float32Array([
        cell.a, cell.b * cosG, cell.c * cosB,
        0,      cell.b * sinG, cell.c * (cosA - cosB * cosG) / sinG,
        0,      0,             V / (cell.a * cell.b * sinG)
    ]);
}

/* ------------------------------------------------------------------
   Lattice reduction, for the minimum-image convention

   THE PROBLEM

   `d = d - round(d)` in fractional coordinates is the minimum-image
   convention every molecular-dynamics code uses, and in a skewed cell it is
   wrong. Independent rounding lands in the box [-1/2, 1/2)^3, and while that
   box holds exactly one representative of every lattice coset, it is not the
   set of SHORTEST representatives. In a monoclinic cell at beta = 120 the box
   corner sits far outside the Wigner-Seitz cell, and a pair of atoms whose
   true separation is 1.8 A through a cell face can be reported at 3.4 A.

   In a Patterson search that is not a cosmetic error. The same routine decides
   the clash penalty and the distance-window restraint, so a missed short
   contact is a physically impossible structure that the swarm is never told
   about, competing on correlation alone against the right answer.

   THE FIX, AND WHY IT IS FREE

   The box does contain the ball of radius w_min/2, where w_min is the smallest
   perpendicular width of the cell. Any separation shorter than that has its
   shortest representative inside the ball, hence inside the box, and since the
   box holds one representative per coset, independent rounding must find it.
   So naive rounding is EXACT below w_min/2 and only unreliable above it.

   w_min is tiny for a skewed basis and large for a compact one, and every
   lattice has a compact basis describing it. Reducing the basis therefore
   raises the radius over which rounding is exact - typically well past any
   contact distance - at no per-distance cost at all. The alternative, testing
   all 27 neighbouring translations inside an O(N^2) loop, costs 27x in the
   hottest loop the kernel has.

   The change of basis is an integer matrix of determinant +/-1, so its inverse
   is integer too and the coordinate transform is exact.
   ------------------------------------------------------------------ */

/** 3x3 integer determinant. */
function _sharkoDet3(m) {
    return m[0] * (m[4] * m[8] - m[5] * m[7])
         - m[1] * (m[3] * m[8] - m[5] * m[6])
         + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Inverse of an integer 3x3 with |det| = 1, exactly, as integers. */
function _sharkoIntInverse3(m) {
    const det = _sharkoDet3(m);
    if (Math.abs(det) !== 1) return null;
    const adj = [
        (m[4] * m[8] - m[5] * m[7]), -(m[1] * m[8] - m[2] * m[7]),  (m[1] * m[5] - m[2] * m[4]),
       -(m[3] * m[8] - m[5] * m[6]),  (m[0] * m[8] - m[2] * m[6]), -(m[0] * m[5] - m[2] * m[3]),
        (m[3] * m[7] - m[4] * m[6]), -(m[0] * m[7] - m[1] * m[6]),  (m[0] * m[4] - m[1] * m[3])
    ];
    return adj.map(v => v / det);
}

/**
 * A reduced basis for the same lattice, with the change of basis and the
 * radius below which independent rounding is provably the nearest image.
 *
 * The reduction is iterated pairwise Gauss reduction - subtract from each
 * vector the nearest integer multiple of each other vector, sort by length,
 * repeat - followed by a small search over the face diagonals of the two
 * shortest vectors, which is what pairwise steps alone can miss. This is not
 * certified Minkowski reduction and does not need to be: `safeRadius` is
 * measured from the basis that actually came out, so the guarantee holds
 * whatever the reduction achieved.
 *
 * @returns {{ orth, xform, safeRadius, widths, changed, M }}
 *   orth       fractional(reduced) -> Cartesian, row-major 3x3
 *   xform      fractional(original) -> fractional(reduced), integer, row-major
 *   safeRadius half the smallest perpendicular width of the reduced cell, in A
 *   changed    false when the original basis was already reduced
 */
function sharkoReducedCell(cell) {
    const orth = sharkoOrthMatrix(cell);
    // Rows of A are the lattice vectors: A = transpose(orth), because orth maps
    // a fractional COLUMN to Cartesian.
    let v = [
        [orth[0], orth[3], orth[6]],
        [orth[1], orth[4], orth[7]],
        [orth[2], orth[5], orth[8]]
    ];
    // M expresses the current basis in the original one; it starts as identity
    // and only ever gains integer multiples of its own rows, so det stays +/-1.
    let M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const nrm = a => dot(a, a);
    const axpy = (i, j, mu) => {                 // row_i -= mu * row_j
        for (let k = 0; k < 3; k++) { v[i][k] -= mu * v[j][k]; M[i][k] -= mu * M[j][k]; }
    };
    const sortByLength = () => {
        const order = [0, 1, 2].sort((a, b) => nrm(v[a]) - nrm(v[b]));
        v = order.map(i => v[i]); M = order.map(i => M[i]);
    };

    for (let pass = 0; pass < 64; pass++) {
        let moved = false;
        sortByLength();
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (i === j) continue;
                const nj = nrm(v[j]);
                if (!(nj > 1e-12)) continue;
                const mu = Math.round(dot(v[i], v[j]) / nj);
                if (mu !== 0) { axpy(i, j, mu); moved = true; }
            }
        }
        // Face diagonals: b3 +/- b1 +/- b2 can be shorter than b3 even when b3
        // is already size-reduced against b1 and b2 separately.
        sortByLength();
        let best = null, bestN = nrm(v[2]);
        for (let c1 = -1; c1 <= 1; c1++) {
            for (let c2 = -1; c2 <= 1; c2++) {
                if (!c1 && !c2) continue;
                const t = [0, 1, 2].map(k => v[2][k] + c1 * v[0][k] + c2 * v[1][k]);
                const n = nrm(t);
                if (n < bestN - 1e-9) { bestN = n; best = [c1, c2]; }
            }
        }
        if (best) {
            for (let k = 0; k < 3; k++) {
                v[2][k] += best[0] * v[0][k] + best[1] * v[1][k];
                M[2][k] += best[0] * M[0][k] + best[1] * M[1][k];
            }
            moved = true;
        }
        if (!moved) break;
    }

    const Mflat = [M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2]];
    const changed = Mflat.some((x, i) => x !== [1, 0, 0, 0, 1, 0, 0, 0, 1][i]);

    // orth' = orth . transpose(M), since A' = M.A and orth = transpose(A).
    const orthR = new Float64Array(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            let sum = 0;
            for (let k = 0; k < 3; k++) sum += orth[r * 3 + k] * Mflat[c * 3 + k];
            orthR[r * 3 + c] = sum;
        }
    }

    // f' = transpose(inverse(M)) . f for a fractional COLUMN vector.
    const Minv = _sharkoIntInverse3(Mflat);
    if (!Minv) {
        // Cannot happen for a determinant-preserving reduction, but a silent
        // wrong answer here would be untraceable, so fall back to no change.
        return { orth: Float64Array.from(orth), xform: new Float64Array([1,0,0,0,1,0,0,0,1]),
                 safeRadius: _sharkoSafeRadius(orth), widths: _sharkoWidths(orth),
                 changed: false, M: [1,0,0,0,1,0,0,0,1], degenerate: true };
    }
    const xform = new Float64Array([Minv[0], Minv[3], Minv[6],
                                    Minv[1], Minv[4], Minv[7],
                                    Minv[2], Minv[5], Minv[8]]);

    const widths = _sharkoWidths(orthR);
    return { orth: orthR, xform, widths, safeRadius: Math.min(...widths) / 2,
             changed, M: Mflat };
}

/** Perpendicular widths of a cell given its fractional->Cartesian matrix. */
function _sharkoWidths(o) {
    const a = [o[0], o[3], o[6]], b = [o[1], o[4], o[7]], c = [o[2], o[5], o[8]];
    const cross = (p, q) => [p[1]*q[2] - p[2]*q[1], p[2]*q[0] - p[0]*q[2], p[0]*q[1] - p[1]*q[0]];
    const len = p => Math.hypot(p[0], p[1], p[2]);
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b);
    const V = Math.abs(a[0]*bc[0] + a[1]*bc[1] + a[2]*bc[2]);
    return [V / len(bc), V / len(ca), V / len(ab)];
}

function _sharkoSafeRadius(o) { return Math.min(..._sharkoWidths(o)) / 2; }

/* Node/worker/browser interop -------------------------------------- */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sharkoCellVolume, sharkoOrthMatrix, sharkoReducedCell };
}
