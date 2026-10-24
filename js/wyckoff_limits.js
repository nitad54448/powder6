/* The limits and defaults of the Wyckoff search, in one place.
 *
 * Read by the page (js/rietveld/rv_solve.js: the form, its validation and the constraint check), by the worker
 * (js/wyckoff_worker.js, js/wyckoff_assign.js, js/swarm_wyckoff.js) and, through swInject(), by the kernel
 * swarm_reflection.wgsl, whose rule and neighbour-slot arrays are sized from these numbers when it is compiled.
 *
 *    page    :  <script defer src="js/wyckoff_limits.js">
 *    worker  :  importScripts('wyckoff_limits.js')
 *    node    :  require('./wyckoff_limits.js')
 */
const WY_LIMITS = Object.freeze({
  // Distance constraints. A run with up to baseRules rules and baseCoordSlots neighbour slots compiles the kernel
  // at those sizes; a larger run compiles it at its own size, up to the maxima. maxRules is bounded by the 32-bit
  // mask the kernel keeps of the rules of each atom.
  baseRules: 8,
  maxRules: 32,
  baseCoordSlots: 64,
  maxCoordSlots: 256,
  // Caps of the enumeration: distinct sites of one element and reuses of one position.
  maxSitesPerElement: 24,
  // Assignments enumerated for one Z, at most.
  maxAssignments: 4000,
  // Values of Z searched when Z is on Auto.
  maxZSearches: 12,
  // Z typed or scanned, at most (the largest general multiplicity).
  zMax: 192,
  // How Z on Auto is ranked inside the density window: nearest this volume per atom (A^3), with a nudge for a Z
  // that divides, or is a multiple of, the group order.
  vpaTypical: 16,
  zFavouredBonus: 0.10,
  maxAtomsPerCell: 512,
  // The density window of the form (g/cm3), and the absolute bounds a typed Z must respect.
  rhoWindow: [1, 22],
  rhoAbsolute: [0.5, 22.5],
  // Shortest contact (A), the form's range.
  minContact: [0, 4],
  // The form's ranges and defaults.
  particles: [64, 1536],
  iterations: [10, 10000],
  restarts: [1, 10],
  // Shape weight: how strongly the angles of shaped shells count, as a multiple of the bond penalty.
  shapeWeight: [0, 10],
  defaults: Object.freeze({ rhoMin: 2, rhoMax: 10, maxZ: 3, particles: 512, iterations: 2000, restarts: 4, minContact: 1.0, shapeWeight: 1 }),
  // The screening stage: when the assignments need more than fullWaves waves, every one is first searched for
  // screenFraction of the iterations (at least screenMinIterations, one restart), and only the best fullWaves
  // waves' worth go on to the full search.
  fullWaves: 2,
  screenFraction: 0.1,
  screenMinIterations: 60,
  // Shapes a counted coordination shell can be given ("S O 4 1.40/1.60 tetrahedron"): the code the kernel reads,
  // the number of neighbours, and the words the constraint box accepts. The names are the ones the site-symmetry
  // filter of the enumeration knows (wyckoff_assign.js, coordinationCompatible).
  geometries: Object.freeze({
    'linear':          Object.freeze({ code: 1, count: 2, words: ['linear'] }),
    'trigonal-planar': Object.freeze({ code: 2, count: 3, words: ['triangle', 'triangular', 'trigonal', 'trigonal-planar'] }),
    'tetrahedral':     Object.freeze({ code: 3, count: 4, words: ['tetrahedron', 'tetrahedral', 'tetra'] }),
    'square-planar':   Object.freeze({ code: 4, count: 4, words: ['square', 'square-planar', 'planar'] }),
    'octahedral':      Object.freeze({ code: 5, count: 6, words: ['octahedron', 'octahedral', 'octa'] })
  })
});

if (typeof module !== 'undefined' && module.exports) module.exports = { WY_LIMITS };
