// Voter-population math: Gaussian-mixture pdf/cdf/sampling, the analytic
// population median, and a small seedable PRNG. Pure functions only --
// no DOM -- so this module runs identically on the main thread or inside
// a Web Worker.

// ---- Seeded PRNG -----------------------------------------------------

// mulberry32: fast, deterministic, good-enough (not crypto-grade) 32-bit PRNG.
// Returns a function () => float in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic string hash (cyrb53) used to derive independent per-config
// sub-seeds from a base seed + config label, e.g. hashSeed(42, 'plurality_k2').
// This lets any single {rule,k} config (or the illustrative single-draw)
// be reproduced in isolation, without depending on draw order elsewhere.
export function hashSeed(baseSeed, label) {
  const str = `${baseSeed}::${label}`;
  let h1 = 0xdeadbeef ^ 0,
    h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

// A run-scoped RNG wrapper exposing the primitives simulate.js/primary-rules.js need,
// all backed by a single mulberry32 stream so a given seed reproduces a run exactly.
export function makeRng(seed) {
  const next = mulberry32(seed);
  let spare = null;

  return {
    uniform() {
      return next();
    },
    // Standard normal via Box-Muller, caching the second generated value.
    gaussian() {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      let u1 = 0,
        u2;
      while (u1 === 0) u1 = next(); // avoid log(0)
      u2 = next();
      const r = Math.sqrt(-2 * Math.log(u1));
      const theta = 2 * Math.PI * u2;
      spare = r * Math.sin(theta);
      return r * Math.cos(theta);
    },
    // Uniform random integer in [0, n).
    int(n) {
      return Math.floor(next() * n);
    },
    // Draw `k` distinct indices from [0, n) without replacement (partial Fisher-Yates).
    choiceIndicesWithoutReplacement(n, k) {
      const pool = new Int32Array(n);
      for (let i = 0; i < n; i++) pool[i] = i;
      const out = new Int32Array(k);
      let m = n;
      for (let i = 0; i < k; i++) {
        const j = Math.floor(next() * m);
        out[i] = pool[j];
        m -= 1;
        pool[j] = pool[m];
      }
      return out;
    },
  };
}

// ---- Normal distribution ----------------------------------------------

// Abramowitz & Stegun 7.1.26 approximation to erf, |error| < 1.5e-7.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function normalCdf(x, mu = 0, sigma = 1) {
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

export function normalPdf(x, mu = 0, sigma = 1) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

// ---- Gaussian-mixture population (per-state GMM from states.json) ------

export function mixturePdf(x, state) {
  let s = 0;
  for (let c = 0; c < state.pi.length; c++) {
    s += state.pi[c] * normalPdf(x, state.mu[c], state.sigma[c]);
  }
  return s;
}

// F(x): the population CDF used directly by metric 1 (runoff competitiveness).
export function mixtureCdf(x, state) {
  let s = 0;
  for (let c = 0; c < state.pi.length; c++) {
    s += state.pi[c] * normalCdf(x, state.mu[c], state.sigma[c]);
  }
  return s;
}

// Draw n iid samples from the state's fixed GMM: pick a component per the
// mixture weights, then draw Normal(mu[c], sigma[c]). Matches the semantics
// of sample_from_state() in cces_state_distributions.py (component choice,
// then per-component normal draw) -- exact RNG parity with Python isn't
// required/expected, only distributional parity.
export function sampleMixture(n, state, rng) {
  const out = new Float64Array(n);
  const pi = state.pi;
  for (let i = 0; i < n; i++) {
    const u = rng.uniform();
    let cum = 0,
      c = pi.length - 1;
    for (let cc = 0; cc < pi.length; cc++) {
      cum += pi[cc];
      if (u < cum) {
        c = cc;
        break;
      }
    }
    out[i] = state.mu[c] + state.sigma[c] * rng.gaussian();
  }
  return out;
}

// Analytic population median via bisection on mixtureCdf(x) - 0.5 = 0.
// Bracket derived from the state's own GMM params (not a hardcoded range),
// since some states could have unusual mu/sigma combinations.
// This is a POPULATION-level median (used only for the density chart's
// dashed line) -- distinct from the finite-pool median used for primary
// utility/winner-selection in simulate.js. Do not conflate the two.
export function mixtureMedianAnalytic(state) {
  const muMax = Math.max(...state.mu);
  const muMin = Math.min(...state.mu);
  const sigMax = Math.max(...state.sigma);
  let lo = muMin - 8 * sigMax;
  let hi = muMax + 8 * sigMax;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    if (mixtureCdf(mid, state) < 0.5) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}

// Sample median of a finite pool (the "x_median" used in the paper's
// primary utility formula and this project's stage-4 winner selection).
// Sorts a copy; fine at the pool sizes used here (N ~ a few thousand).
export function median(pool) {
  const arr = Array.from(pool).sort((a, b) => a - b);
  const n = arr.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}
