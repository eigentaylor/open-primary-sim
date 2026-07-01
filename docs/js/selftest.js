// Debug-only smoke tests, loaded only behind ?debug=1 (see main.js). Uses
// console.assert rather than a test framework, per the project's no-build-
// step constraint. Failures print to the console; nothing is asserted in
// the DOM or blocks app usage.

import { mixtureCdf, sampleMixture, mixtureMedianAnalytic, makeRng, median } from './distributions.js';
import { runSweep } from './sweep.js';
import { loadStatesData } from './data-loader.js';

console.log('[selftest] running debug self-tests...');

// 1. mixtureCdf reference values, computed offline via scipy.stats.norm.cdf
// against docs/data/states.json (see scripts/build_states_json.py's output).
async function testMixtureCdf() {
  const data = await loadStatesData();
  const cases = [
    ['CA', -0.3, 0.29434524],
    ['CA', 0.0, 0.6569839],
    ['CA', 0.3, 0.88836058],
    ['OH', -0.3, 0.23555084],
    ['OH', 0.0, 0.56005149],
    ['OH', 0.3, 0.83776991],
    ['WA', -0.3, 0.27191147],
    ['WA', 0.0, 0.63808974],
    ['WA', 0.3, 0.88769],
  ];
  for (const [code, x, expected] of cases) {
    const actual = mixtureCdf(x, data.states[code]);
    const ok = Math.abs(actual - expected) < 1e-4;
    console.assert(ok, `[selftest] mixtureCdf(${x}, ${code}) = ${actual}, expected ${expected}`);
  }
  console.log('[selftest] mixtureCdf reference checks done');
}

// 2. sampleMixture should reproduce each state's mean/median/std (from the
// Python-computed states.json) within sampling tolerance at large N -- this
// cross-checks the JS GMM port against the Python source of truth.
async function testSampleMixtureMoments() {
  const data = await loadStatesData();
  const rng = makeRng(12345);
  const N = 50000;
  for (const code of ['CA', 'OH', 'WA']) {
    const s = data.states[code];
    const pool = sampleMixture(N, s, rng);
    let sum = 0;
    for (let i = 0; i < N; i++) sum += pool[i];
    const sampleMean = sum / N;
    const sampleMedian = median(pool);
    let sq = 0;
    for (let i = 0; i < N; i++) sq += (pool[i] - sampleMean) ** 2;
    const sampleStd = Math.sqrt(sq / N);

    const tol = 0.02; // generous given N=50k and mixture variance
    console.assert(
      Math.abs(sampleMean - s.mean) < tol,
      `[selftest] ${code} sampled mean ${sampleMean} vs expected ${s.mean}`
    );
    console.assert(
      Math.abs(sampleMedian - s.median) < tol,
      `[selftest] ${code} sampled median ${sampleMedian} vs expected ${s.median}`
    );
    console.assert(
      Math.abs(sampleStd - s.std) < tol,
      `[selftest] ${code} sampled std ${sampleStd} vs expected ${s.std}`
    );
  }
  console.log('[selftest] sampleMixture moment checks done');
}

// 3. mixtureMedianAnalytic sanity: for a symmetric single-mode state (mu1=mu2),
// the median should equal that shared mean exactly (up to bisection tolerance).
function testSymmetricMedian() {
  const symmetric = { pi: [0.5, 0.5], mu: [0, 0], sigma: [1, 1] };
  const m = mixtureMedianAnalytic(symmetric);
  console.assert(Math.abs(m) < 1e-5, `[selftest] symmetric median = ${m}, expected ~0`);
  console.log('[selftest] symmetric median check done');
}

// 4. Rigged VSE=100% check: a synthetic single-component state where the
// candidate pool is small/degenerate enough that the CC should reliably
// reach the general and win, driving winner utility == CC utility -> VSE=100.
function testVseHundredWhenWinnerEqualsCc() {
  const synthetic = { pi: [1.0], mu: [0], sigma: [1], std: 1, median: 0, mean: 0 };
  const config = { N: 2000, nSim: 50, M: 10, delta: 1, gamma: 0, tau: 0.25 };
  // k=10 (== M) guarantees every candidate advances, so the CC always
  // reaches the general and, per stage 4, always wins (closest-to-median
  // among "finalists" == closest-to-median among all M candidates).
  const results = runSweep(synthetic, [{ rule: 'plurality', k: 10 }], config, 999);
  const r = results['plurality_k10'];
  console.assert(r.consensusCapture === 1, `[selftest] expected consensusCapture=1 at k=M, got ${r.consensusCapture}`);
  console.assert(r.vse !== null && Math.abs(r.vse - 100) < 1e-6, `[selftest] expected VSE=100 at k=M, got ${r.vse}`);
  console.log('[selftest] VSE=100% rigged check done');
}

Promise.all([testMixtureCdf(), testSampleMixtureMoments()])
  .then(() => {
    testSymmetricMedian();
    testVseHundredWhenWinnerEqualsCc();
    console.log('[selftest] all self-tests completed (see above for any assertion failures)');
  })
  .catch((err) => console.error('[selftest] failed to run', err));
